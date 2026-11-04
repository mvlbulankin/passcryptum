import {
  base64ToUint8Array,
  uint8ArrayToBase64,
  getKeyPairFromSeed,
} from '../../shared'
import {
  concatUint8Arrays,
  createSignature,
  generateNonce,
  generateTimestamp,
} from './protocol'
import { credentialsUrl, profilesUrl } from './urls'
import type { Transport, WireRequest, WireResponse } from './types'
import { WireError } from './wire-error'

// The Wire Protocol client's implementation.
//
// An endpoint is a row of data: method, URL, which factors the request
// carries, and which way it is signed. One builder turns a row into a
// request; each call site then reads the statuses the contract defines for
// that endpoint (200/204/403 mean different things per endpoint, so that
// mapping stays with the caller). Before this, each of the six endpoints was
// a closure that rebuilt the same version headers, base64 block and status
// ladder by hand — so every protocol tweak (the version header, the nonce)
// had to be applied in several places in one file.
//
// Nothing here changes the bytes: framing, signing and the status
// vocabulary are the same ones ADR-0003 pins and wire.spec.ts checks.

const protocolVersion = '2'

/** How a request proves it is the Profile it claims. */
type Signing =
  | 'none' // factor auth: public key + protector (+ PIN), no signature
  | 'header' // signature over method ‖ ts ‖ nonce
  | 'body' // b64(sig ‖ ts ‖ payload), signature over method ‖ ts ‖ nonce ‖ payload

type Recipe = {
  method: 'GET' | 'POST' | 'DELETE'
  url: string
  signing: Signing
  /** Extra factors beyond the public key, sent as base64 headers. */
  factors?: readonly ('hashedPin' | 'protector')[]
}

const ENDPOINTS = {
  getServices: {
    method: 'GET',
    url: profilesUrl(),
    signing: 'header',
  },
  setServices: {
    method: 'POST',
    url: profilesUrl(),
    signing: 'body',
  },
  clearServices: {
    method: 'DELETE',
    url: profilesUrl(),
    signing: 'header',
  },
  getEntropy: {
    method: 'GET',
    url: credentialsUrl(),
    signing: 'none',
    factors: ['hashedPin', 'protector'],
  },
  createCredential: {
    method: 'POST',
    url: credentialsUrl(),
    signing: 'body',
    factors: ['hashedPin'],
  },
  deleteCredential: {
    method: 'DELETE',
    url: credentialsUrl(),
    signing: 'none',
    factors: ['protector'],
  },
} as const satisfies Record<string, Recipe>

export type EndpointName = keyof typeof ENDPOINTS

const methodBytes = (method: string) => new TextEncoder().encode(method)

/** The signed message for header recipes: method ‖ timestamp ‖ nonce. */
const headerMessage = (
  method: string,
  timestamp: Uint8Array,
  nonce: Uint8Array,
) => concatUint8Arrays(concatUint8Arrays(methodBytes(method), timestamp), nonce)

/** b64(sig ‖ ts ‖ payload), with the signature over method ‖ ts ‖ nonce ‖ payload. */
const signedBody = (
  method: string,
  secretKey: Uint8Array,
  payload: Uint8Array,
  nonce: Uint8Array,
) => {
  const timestamp = generateTimestamp()

  const signature = createSignature(
    concatUint8Arrays(
      concatUint8Arrays(methodBytes(method), timestamp),
      concatUint8Arrays(nonce, payload),
    ),
    secretKey,
  )

  return uint8ArrayToBase64(
    concatUint8Arrays(signature, concatUint8Arrays(timestamp, payload)),
  )
}

type Params = {
  /** Required for every endpoint: the Profile identifier. */
  publicKey: Uint8Array
  secretKey?: Uint8Array
  hashedPin?: Uint8Array
  protector?: Uint8Array
  payload?: Uint8Array
}

const baseHeaders = (): Record<string, string> => ({
  'Protocol-Version': protocolVersion,
  'Content-Type': 'application/json',
})

type Factor = 'hashedPin' | 'protector'

/** Header name and the caller's material for each factor, in one place. */
const FACTORS: Record<
  Factor,
  { header: string; value: (params: Params) => Uint8Array | undefined }
> = {
  hashedPin: {
    header: 'Hashed-Pin',
    value: params => params.hashedPin,
  },
  protector: {
    header: 'Protector',
    value: params => params.protector,
  },
}

const factorHeaders = (recipe: Recipe, params: Params) => {
  const headers: Record<string, string> = {}

  for (const factor of recipe.factors ?? []) {
    const { header, value } = FACTORS[factor as Factor]
    const material = value(params)

    if (!material) {
      throw new Error(`wire: ${factor} is required by this endpoint`)
    }

    headers[header] = uint8ArrayToBase64(material)
  }

  return headers
}

/** Turns a recipe row plus the caller's material into a WireRequest. */
export const buildRequest = (recipe: Recipe, params: Params): WireRequest => {
  const headers: Record<string, string> = {
    ...baseHeaders(),
    'Public-Key': uint8ArrayToBase64(params.publicKey),
    ...factorHeaders(recipe, params),
  }

  if (recipe.signing === 'body') {
    const nonce = generateNonce()

    if (!params.secretKey) {
      throw new Error('wire: a body-signed endpoint needs the secret key')
    }

    headers.Nonce = uint8ArrayToBase64(nonce)

    return {
      method: recipe.method,
      url: recipe.url,
      headers,
      body: signedBody(
        recipe.method,
        params.secretKey,
        params.payload ?? new Uint8Array(0),
        nonce,
      ),
    }
  }

  // Both the signed and the factor-auth endpoints carry a timestamp; the
  // signed ones bind it into the signature.
  const timestamp = generateTimestamp()

  headers.Timestamp = uint8ArrayToBase64(timestamp)

  if (recipe.signing === 'header') {
    const nonce = generateNonce()

    if (!params.secretKey) {
      throw new Error('wire: a signed endpoint needs the secret key')
    }

    headers.Nonce = uint8ArrayToBase64(nonce)
    headers.Signature = uint8ArrayToBase64(
      createSignature(
        headerMessage(recipe.method, timestamp, nonce),
        params.secretKey,
      ),
    )
  }

  return { method: recipe.method, url: recipe.url, headers }
}

// Runs one request through the transport, turning transport failures into
// WireError('network'). HTTP statuses stay raw: the endpoint recipes map
// them, because the contract gives each status a meaning.
const send = async (transport: Transport, request: WireRequest) => {
  try {
    return await transport(request)
  } catch (e) {
    if (e instanceof WireError) {
      throw e
    }

    throw new WireError('network')
  }
}

// 403 is the contract's only defined failure; everything else is unexpected.
const forbiddenOrUnexpected = (status: number): WireError =>
  status === 403
    ? new WireError('forbidden', status)
    : new WireError('unexpectedStatus', status)

// Success bodies are bare JSON-encoded strings ("base64blob").
const parseJsonStringBody = (body: string): Uint8Array => {
  try {
    return base64ToUint8Array(JSON.parse(body) as string)
  } catch {
    throw new WireError('malformedResponse')
  }
}

export const createWireClient = (transport: Transport) => {
  const call = async (
    name: EndpointName,
    params: Params,
  ): Promise<WireResponse> =>
    send(transport, buildRequest(ENDPOINTS[name], params))

  const getServices = async (keyPairSeed: Uint8Array) => {
    const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)
    const response = await call('getServices', { publicKey, secretKey })

    if (response.status === 200) {
      return parseJsonStringBody(response.body)
    }

    if (response.status === 204) {
      return null
    }

    throw forbiddenOrUnexpected(response.status)
  }

  const setServices = async (
    keyPairSeed: Uint8Array,
    encrypted: Uint8Array,
  ) => {
    const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)

    const { status } = await call('setServices', {
      publicKey,
      secretKey,
      payload: encrypted,
    })

    if (status !== 200) {
      throw forbiddenOrUnexpected(status)
    }
  }

  const clearServices = async (
    keyPairSeed: Uint8Array,
  ): Promise<'cleared' | 'already-empty'> => {
    const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)
    const { status } = await call('clearServices', { publicKey, secretKey })

    if (status === 200) {
      return 'cleared'
    }

    if (status === 204) {
      return 'already-empty'
    }

    throw forbiddenOrUnexpected(status)
  }

  const getEntropy = async (
    publicKey: Uint8Array,
    hashedPin: Uint8Array,
    protector: Uint8Array,
  ) => {
    const { status, body } = await call('getEntropy', {
      publicKey,
      hashedPin,
      protector,
    })

    if (status === 200) {
      return parseJsonStringBody(body)
    }

    throw forbiddenOrUnexpected(status)
  }

  const createCredential = async (
    keyPairSeed: Uint8Array,
    hashedPin: Uint8Array,
    entropy: Uint8Array,
  ) => {
    const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)

    const { status, body } = await call('createCredential', {
      publicKey,
      secretKey,
      hashedPin,
      payload: entropy,
    })

    if (status === 200) {
      return parseJsonStringBody(body)
    }

    throw forbiddenOrUnexpected(status)
  }

  const deleteCredential = async (
    publicKey: Uint8Array,
    protector: Uint8Array,
  ) => {
    const { status } = await call('deleteCredential', {
      publicKey,
      protector,
    })

    if (status !== 200) {
      throw forbiddenOrUnexpected(status)
    }
  }

  return {
    getServices,
    setServices,
    clearServices,
    getEntropy,
    createCredential,
    deleteCredential,
  }
}
