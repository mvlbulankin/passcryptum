import { sign } from 'tweetnacl'
import { describe, it, expect } from 'vitest'

import { createWireClient } from '../index'
import type { Transport } from '../index'

// Fixed throwaway keypair: the protocol doesn't care where the seed came from.
const seed = new Uint8Array(32).fill(0xab)
const { publicKey } = sign.keyPair.fromSeed(seed)

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

const fromB64 = (text: string) =>
  Uint8Array.from(atob(text), c => c.charCodeAt(0))

const concat = (a: Uint8Array, b: Uint8Array) => {
  const tmp = new Uint8Array(a.length + b.length)

  tmp.set(a, 0)
  tmp.set(b, a.length)

  return tmp
}

let capturedRequest: {
  method: string
  url: string
  body?: string
  headers: Record<string, string>
} | null = null

const fakeTransport =
  (
    responder: () =>
      | { status: number; body: string }
      | Promise<{ status: number; body: string }>,
  ): Transport =>
  request => {
    capturedRequest = request

    return Promise.resolve(responder())
  }

// The GET/DELETE /api/profiles/ header recipe: Timestamp + Nonce + Signature
// over method ‖ timestamp ‖ nonce. Verifies the framing from the protocol
// spec, not by recomputing the client's internals.
const expectSignedTimestampHeaders = (method: string) => {
  // the request declares its protocol version (ADR-0003)
  expect(capturedRequest?.headers['Protocol-Version']).toBe('2')

  expect(capturedRequest?.headers['Public-Key']).toBe(b64(publicKey))

  const tsBytes = fromB64(capturedRequest!.headers.Timestamp)

  expect(tsBytes).toHaveLength(4)

  const ts = new DataView(tsBytes.buffer).getUint32(0, true)

  expect(Math.abs(Date.now() / 1000 - ts)).toBeLessThanOrEqual(300)

  const sigBytes = fromB64(capturedRequest!.headers.Signature)

  expect(sigBytes).toHaveLength(64)

  // the signature covers method ‖ timestamp ‖ nonce (ADR-0003)
  const nonce = fromB64(capturedRequest!.headers.Nonce)

  expect(nonce).toHaveLength(16)

  const message = concat(concat(methodBytes(method), tsBytes), nonce)

  expect(sign.detached.verify(message, sigBytes, publicKey)).toBe(true)
}

const methodBytes = (method: string) => new TextEncoder().encode(method)

// The POST body recipe: b64(sig(64) ‖ ts(4 LE) ‖ payload), signature over
// method ‖ ts ‖ nonce ‖ payload.
const expectSignedBodyFraming = (method: string, payload: Uint8Array) => {
  expect(capturedRequest?.headers['Protocol-Version']).toBe('2')

  const raw = fromB64(capturedRequest!.body!)

  expect(raw).toHaveLength(64 + 4 + payload.length)

  const sig = raw.slice(0, 64)
  const tsBytes = raw.slice(64, 68)
  const sent = raw.slice(68)

  expect(sent).toEqual(payload)

  // the signature covers method ‖ ts ‖ nonce ‖ payload
  const nonce = fromB64(capturedRequest!.headers.Nonce)

  expect(nonce).toHaveLength(16)

  const message = concat(
    concat(methodBytes(method), concat(tsBytes, nonce)),
    sent,
  )

  expect(sign.detached.verify(message, sig, publicKey)).toBe(true)
}

describe('Wire Protocol client — getServices', () => {
  it('sends the signed GET /api/profiles/ recipe and returns the blob bytes', async () => {
    const blob = new Uint8Array([1, 2, 3, 4, 5])

    const wire = createWireClient(
      fakeTransport(() => ({
        status: 200,
        body: JSON.stringify(b64(blob)),
      })),
    )

    const encrypted = await wire.getServices(seed)

    expect(capturedRequest?.method).toBe('GET')
    expect(capturedRequest?.url).toMatch(/\/api\/profiles\/$/)
    expectSignedTimestampHeaders('GET')
    expect(capturedRequest?.body).toBeUndefined()
    expect(encrypted).toEqual(blob)
  })

  it('maps 204 to null, 403 to forbidden, 500 to unexpectedStatus', async () => {
    const withStatus = (status: number) =>
      createWireClient(fakeTransport(() => ({ status, body: '' })))

    expect(await withStatus(204).getServices(seed)).toBeNull()

    await expect(withStatus(403).getServices(seed)).rejects.toMatchObject({
      kind: 'forbidden',
    })

    await expect(withStatus(500).getServices(seed)).rejects.toMatchObject({
      kind: 'unexpectedStatus',
    })
  })

  it('maps transport failures to network and bad bodies to malformedResponse', async () => {
    const brokenTransport: Transport = () =>
      Promise.reject(new TypeError('fetch failed'))

    await expect(
      createWireClient(brokenTransport).getServices(seed),
    ).rejects.toMatchObject({ kind: 'network' })

    const garbageBody = createWireClient(
      fakeTransport(() => ({ status: 200, body: 'not json' })),
    )

    await expect(garbageBody.getServices(seed)).rejects.toMatchObject({
      kind: 'malformedResponse',
    })
  })
})

describe('Wire Protocol client — clearServices', () => {
  it('sends the signed DELETE /api/profiles/ recipe', async () => {
    const wire = createWireClient(
      fakeTransport(() => ({ status: 200, body: '' })),
    )

    const result = await wire.clearServices(seed)

    expect(capturedRequest?.method).toBe('DELETE')
    expect(capturedRequest?.url).toMatch(/\/api\/profiles\/$/)
    expectSignedTimestampHeaders('DELETE')
    expect(capturedRequest?.body).toBeUndefined()
    expect(result).toBe('cleared')
  })

  it('maps 204 to already-empty and 403 to forbidden', async () => {
    const withStatus = (status: number) =>
      createWireClient(fakeTransport(() => ({ status, body: '' })))

    expect(await withStatus(204).clearServices(seed)).toBe('already-empty')

    await expect(withStatus(403).clearServices(seed)).rejects.toMatchObject({
      kind: 'forbidden',
    })
  })
})

describe('Wire Protocol client — getEntropy', () => {
  it('sends the unsigned GET /api/credentials/ recipe (no Signature header)', async () => {
    const entropy = new Uint8Array([7, 7, 7])
    const hashedPin = new Uint8Array(64).fill(3)
    const protector = new Uint8Array(32).fill(5)

    const wire = createWireClient(
      fakeTransport(() => ({
        status: 200,
        body: JSON.stringify(b64(entropy)),
      })),
    )

    const result = await wire.getEntropy(publicKey, hashedPin, protector)

    expect(capturedRequest?.method).toBe('GET')
    expect(capturedRequest?.url).toMatch(/\/api\/credentials\/$/)

    // All four factors as headers — and no signature (factor auth)
    expect(capturedRequest?.headers['Public-Key']).toBe(b64(publicKey))
    expect(capturedRequest?.headers['Hashed-Pin']).toBe(b64(hashedPin))
    expect(capturedRequest?.headers.Protector).toBe(b64(protector))

    const tsBytes = fromB64(capturedRequest!.headers.Timestamp)

    expect(tsBytes).toHaveLength(4)
    expect(capturedRequest?.headers.Signature).toBeUndefined()

    expect(result).toEqual(entropy)
  })

  it('maps 403 to forbidden', async () => {
    const wire = createWireClient(
      fakeTransport(() => ({ status: 403, body: '' })),
    )

    await expect(
      wire.getEntropy(publicKey, new Uint8Array(64), new Uint8Array(32)),
    ).rejects.toMatchObject({ kind: 'forbidden' })
  })
})

describe('Wire Protocol client — createCredential', () => {
  it('sends the signed POST /api/credentials/ recipe and returns the protector', async () => {
    const entropy = new Uint8Array([1, 1, 1, 1])
    const hashedPin = new Uint8Array(64).fill(9)
    const protector = new Uint8Array(32).fill(2)

    const wire = createWireClient(
      fakeTransport(() => ({
        status: 200,
        body: JSON.stringify(b64(protector)),
      })),
    )

    const result = await wire.createCredential(seed, hashedPin, entropy)

    expect(capturedRequest?.method).toBe('POST')
    expect(capturedRequest?.url).toMatch(/\/api\/credentials\/$/)

    expect(capturedRequest?.headers['Public-Key']).toBe(b64(publicKey))
    expect(capturedRequest?.headers['Hashed-Pin']).toBe(b64(hashedPin))

    expectSignedBodyFraming('POST', entropy)
    expect(result).toEqual(protector)
  })
})

describe('Wire Protocol client — deleteCredential', () => {
  it('sends the unsigned DELETE /api/credentials/ recipe (no Signature)', async () => {
    const protector = new Uint8Array(32).fill(4)

    const wire = createWireClient(
      fakeTransport(() => ({ status: 200, body: '' })),
    )

    await wire.deleteCredential(publicKey, protector)

    expect(capturedRequest?.method).toBe('DELETE')
    expect(capturedRequest?.url).toMatch(/\/api\/credentials\/$/)

    expect(capturedRequest?.headers['Public-Key']).toBe(b64(publicKey))
    expect(capturedRequest?.headers.Protector).toBe(b64(protector))

    const tsBytes = fromB64(capturedRequest!.headers.Timestamp)

    expect(tsBytes).toHaveLength(4)
    expect(capturedRequest?.headers.Signature).toBeUndefined()
    expect(capturedRequest?.body).toBeUndefined()
  })

  it('maps 403 to forbidden', async () => {
    const wire = createWireClient(
      fakeTransport(() => ({ status: 403, body: '' })),
    )

    await expect(
      wire.deleteCredential(publicKey, new Uint8Array(32)),
    ).rejects.toMatchObject({ kind: 'forbidden' })
  })
})

describe('Wire Protocol client — setServices', () => {
  it('sends POST /api/profiles/ with the signed body framing', async () => {
    const blob = new Uint8Array([9, 9, 9])

    const wire = createWireClient(
      fakeTransport(() => ({ status: 200, body: '' })),
    )

    await wire.setServices(seed, blob)

    expect(capturedRequest?.method).toBe('POST')
    expect(capturedRequest?.url).toMatch(/\/api\/profiles\/$/)

    // Signature travels in the body, not in headers
    expect(capturedRequest?.headers['Public-Key']).toBe(b64(publicKey))
    expect(capturedRequest?.headers.Timestamp).toBeUndefined()
    expect(capturedRequest?.headers.Signature).toBeUndefined()

    expectSignedBodyFraming('POST', blob)
  })

  it('maps 403 to forbidden', async () => {
    const wire = createWireClient(
      fakeTransport(() => ({ status: 403, body: '' })),
    )

    await expect(
      wire.setServices(seed, new Uint8Array()),
    ).rejects.toMatchObject({ kind: 'forbidden' })
  })
})

// The endpoint table is the single place an endpoint's recipe lives. This
// pins that the builder still produces what the protocol expects for every
// row — a new endpoint, or an edited factor list, cannot drift silently.
describe('endpoint recipes', () => {
  const client = createWireClient(
    fakeTransport(() => ({ status: 200, body: '"AAAA"' })),
  )
  const protector = new Uint8Array(32).fill(1)
  const hashedPin = new Uint8Array(32).fill(2)
  const payload = new Uint8Array(4).fill(3)

  const cases: Array<[string, () => Promise<unknown>, string, string]> = [
    ['getServices', () => client.getServices(seed), 'GET', '/api/profiles/'],
    [
      'setServices',
      () => client.setServices(seed, payload),
      'POST',
      '/api/profiles/',
    ],
    [
      'clearServices',
      () => client.clearServices(seed),
      'DELETE',
      '/api/profiles/',
    ],
    [
      'getEntropy',
      () => client.getEntropy(publicKey, hashedPin, protector),
      'GET',
      '/api/credentials/',
    ],
    [
      'createCredential',
      () => client.createCredential(seed, hashedPin, payload),
      'POST',
      '/api/credentials/',
    ],
    [
      'deleteCredential',
      () => client.deleteCredential(publicKey, protector),
      'DELETE',
      '/api/credentials/',
    ],
  ]

  it.each(cases)(
    '%s sends its declared method and URL',
    async (_name, run, method, url) => {
      await run().catch(() => undefined)

      expect(capturedRequest?.method).toBe(method)
      expect(capturedRequest?.url).toContain(url)
    },
  )

  it('carries a nonce on every signed endpoint, and none on the unsigned two', async () => {
    // The nonce is the replay key on every signed request; how the signature
    // travels differs — a header for the header recipes, inside the body
    // for the body recipes (ADR-0003).
    const signed: Array<() => Promise<unknown>> = [
      () => client.getServices(seed),
      () => client.setServices(seed, payload),
      () => client.clearServices(seed),
      () => client.createCredential(seed, hashedPin, payload),
    ]
    const unsigned: Array<() => Promise<unknown>> = [
      () => client.getEntropy(publicKey, hashedPin, protector),
      () => client.deleteCredential(publicKey, protector),
    ]

    for (const run of signed) {
      await run().catch(() => undefined)

      expect(capturedRequest?.headers.Nonce).toBeDefined()
    }

    for (const run of unsigned) {
      await run().catch(() => undefined)

      expect(capturedRequest?.headers.Signature).toBeUndefined()
      expect(capturedRequest?.headers.Nonce).toBeUndefined()
    }
  })

  it('sends the signature in the header for header recipes, in the body for body recipes', async () => {
    await client.getServices(seed).catch(() => undefined)
    expect(capturedRequest?.headers.Signature).toBeDefined()
    expect(capturedRequest?.body).toBeUndefined()

    await client.setServices(seed, payload).catch(() => undefined)
    // b64(sig(64) ‖ ts(4) ‖ payload): no Signature header, a body instead.
    expect(capturedRequest?.headers.Signature).toBeUndefined()
    expect(capturedRequest?.body).toBeDefined()
    expect(Buffer.from(capturedRequest!.body!, 'base64').length).toBe(
      64 + 4 + payload.length,
    )
  })

  it('carries exactly the factors each endpoint declares', async () => {
    await client
      .getEntropy(publicKey, hashedPin, protector)
      .catch(() => undefined)
    expect(capturedRequest?.headers['Hashed-Pin']).toBeDefined()
    expect(capturedRequest?.headers.Protector).toBeDefined()

    await client
      .createCredential(seed, hashedPin, payload)
      .catch(() => undefined)
    expect(capturedRequest?.headers['Hashed-Pin']).toBeDefined()
    expect(capturedRequest?.headers.Protector).toBeUndefined()

    await client.deleteCredential(publicKey, protector).catch(() => undefined)
    expect(capturedRequest?.headers['Hashed-Pin']).toBeUndefined()
    expect(capturedRequest?.headers.Protector).toBeDefined()
  })
})
