import {
  base64ToUint8Array,
  getKeyPairFromSeed,
  uint8ArrayToBase64,
} from '../../shared'
import { WireError } from './wire-error'
import {
  concatUint8Arrays,
  createSignature,
  generateNonce,
  generateTimestamp,
} from './protocol'
import { profilesUrl, credentialsUrl } from './urls'
import type { Transport, WireClient, WireRequest } from './types'

// Protocol v2 (ADR-0001): every request declares its version and every
// signature binds the HTTP method — a captured GET can no longer be
// replayed as a DELETE, and the server's one-sided window applies.
const protocolVersion = '2'

const versionHeaders = { 'Protocol-Version': protocolVersion }

const methodBytes = (method: string) => new TextEncoder().encode(method)

// v2 signed messages: method ‖ timestamp ‖ nonce (header recipes) and
// method ‖ timestamp ‖ nonce ‖ payload (body recipes). The nonce is what
// keeps two requests in the same second from sharing a signature.
const headerMessage = (
  method: string,
  timestamp: Uint8Array,
  nonce: Uint8Array,
) => concatUint8Arrays(concatUint8Arrays(methodBytes(method), timestamp), nonce)

// b64(sig ‖ ts ‖ payload) with the v2 signature over method ‖ ts ‖ payload.
const signedBody = (
  method: string,
  secretKey: Uint8Array,
  payload: Uint8Array,
  nonce: Uint8Array,
) => {
  const timestamp = generateTimestamp()
  const combined = concatUint8Arrays(timestamp, payload)

  const signature = createSignature(
    concatUint8Arrays(
      concatUint8Arrays(methodBytes(method), concatUint8Arrays(timestamp, nonce)),
      payload,
    ),
    secretKey,
  )

  return uint8ArrayToBase64(concatUint8Arrays(signature, combined))
}

// Runs one request through the transport, turning transport failures into
// WireError('network'). HTTP statuses stay raw: each endpoint recipe maps
// them itself, because the contract gives each status a meaning.
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
    const raw = JSON.parse(body) as string

    return base64ToUint8Array(raw)
  } catch {
    throw new WireError('malformedResponse')
  }
}

export const createWireClient = (transport: Transport): WireClient => {
  const getServices = async (keyPairSeed: Uint8Array) => {
    const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)
    const timestamp = generateTimestamp()
    const nonce = generateNonce()

    const signature = createSignature(
      headerMessage('GET', timestamp, nonce),
      secretKey,
    )

    const { status, body } = await send(transport, {
      method: 'GET',
      url: profilesUrl(),
      headers: {
        ...versionHeaders,
        'Content-Type': 'application/json',
        'Public-Key': uint8ArrayToBase64(publicKey),
        'Timestamp': uint8ArrayToBase64(timestamp),
        'Nonce': uint8ArrayToBase64(nonce),
        'Signature': uint8ArrayToBase64(signature),
      },
    })

    if (status === 200) {
      return parseJsonStringBody(body)
    }

    if (status === 204) {
      return null
    }

    throw forbiddenOrUnexpected(status)
  }

  const setServices = async (keyPairSeed: Uint8Array, encrypted: Uint8Array) => {
    const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)
    const nonce = generateNonce()

    const { status } = await send(transport, {
      method: 'POST',
      url: profilesUrl(),
      body: signedBody('POST', secretKey, encrypted, nonce),
      headers: {
        ...versionHeaders,
        'Content-Type': 'application/json',
        'Public-Key': uint8ArrayToBase64(publicKey),
        'Nonce': uint8ArrayToBase64(nonce),
      },
    })

    if (status !== 200) {
      throw forbiddenOrUnexpected(status)
    }
  }

  const clearServices = async (
    keyPairSeed: Uint8Array,
  ): Promise<'cleared' | 'already-empty'> => {
    const { secretKey, publicKey } = getKeyPairFromSeed(keyPairSeed)
    const timestamp = generateTimestamp()
    const nonce = generateNonce()

    const signature = createSignature(
      headerMessage('DELETE', timestamp, nonce),
      secretKey,
    )

    const { status } = await send(transport, {
      method: 'DELETE',
      url: profilesUrl(),
      headers: {
        ...versionHeaders,
        'Content-Type': 'application/json',
        'Public-Key': uint8ArrayToBase64(publicKey),
        'Timestamp': uint8ArrayToBase64(timestamp),
        'Nonce': uint8ArrayToBase64(nonce),
        'Signature': uint8ArrayToBase64(signature),
      },
    })

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
    const { status, body } = await send(transport, {
      method: 'GET',
      url: credentialsUrl(),
      headers: {
        ...versionHeaders,
        'Content-Type': 'application/json',
        'Public-Key': uint8ArrayToBase64(publicKey),
        'Hashed-Pin': uint8ArrayToBase64(hashedPin),
        'Protector': uint8ArrayToBase64(protector),
        'Timestamp': uint8ArrayToBase64(generateTimestamp()),
      },
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
    const nonce = generateNonce()

    const { status, body } = await send(transport, {
      method: 'POST',
      url: credentialsUrl(),
      body: signedBody('POST', secretKey, entropy, nonce),
      headers: {
        ...versionHeaders,
        'Content-Type': 'application/json',
        'Public-Key': uint8ArrayToBase64(publicKey),
        'Hashed-Pin': uint8ArrayToBase64(hashedPin),
        'Nonce': uint8ArrayToBase64(nonce),
      },
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
    const { status } = await send(transport, {
      method: 'DELETE',
      url: credentialsUrl(),
      headers: {
        ...versionHeaders,
        'Content-Type': 'application/json',
        'Public-Key': uint8ArrayToBase64(publicKey),
        'Protector': uint8ArrayToBase64(protector),
        'Timestamp': uint8ArrayToBase64(generateTimestamp()),
      },
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
