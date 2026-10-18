import { sign, secretbox } from 'tweetnacl'
import { describe, it, expect } from 'vitest'

import { createWireClient } from '../index'

// Cross-language integration: the REAL frontend wire client against a REAL
// backend. The contract suite proves the backend against a Go client; this
// proves the same protocol from the TypeScript side (framing, signing, the
// v2 Hashed-Pin KDF, base64 headers) — the seam neither suite covers alone.
//
// Opt-in: set PC_BASE_URL (and PC_PRIVATE_SEED, PC_PUBLIC_KEY of an onboarded
// profile) to run. Skipped otherwise, like the Go contract suite.
const base = process.env.PC_BASE_URL
const seedB64 = process.env.PC_PRIVATE_SEED
const pubB64 = process.env.PC_PUBLIC_KEY

const itLive = base && seedB64 && pubB64 ? it : it.skip

const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length)

  out.set(a, 0)
  out.set(b, a.length)

  return out
}

const methodBytes = (m: string) => new TextEncoder().encode(m)

const transport =
  (method: string) =>
  async ({ url, body, headers }: { url: string; body?: string; headers: Record<string, string> }) => {
    // Same layout the app produces, signed the v2 way, sent with fetch.
    void method

    const target = url.replace(/^https?:\/\/[^/]+/, base as string)
    const response = await fetch(target, { method, headers, body })
    const text = await response.text()

    if (response.status >= 400) {
      console.log(
        '[live]', method, target, response.status, JSON.stringify(text),
        'pub=', headers['Public-Key']?.slice(0, 10),
        'sig=', headers.Signature?.slice(0, 10),
        'expectedPub=', toB64(sign.keyPair.fromSeed(fromB64(seedB64 as string)).publicKey).slice(0, 10),
      )
    }

    return { status: response.status, body: text }
  }

describe.skipIf(!base || !seedB64 || !pubB64)('wire client against a live backend', () => {
  // Parsed lazily per test: with no env the suite is skipped and tweetnacl
  // must never see an empty seed.
  const keypair = () => {
    const seed = fromB64(seedB64 as string)

    return { seed, ...sign.keyPair.fromSeed(seed) }
  }

  const iv = new Uint8Array(24).fill(7)
  const key = new Uint8Array(32).fill(9)

  itLive('round-trips an encrypted services blob (set → get → clear)', async () => {
    const { seed } = keypair()
    const wire = createWireClient((req) => transport(req.method)(req))
    const plaintext = new TextEncoder().encode('{"services":{"e2e":{}}}')
    const encrypted = secretbox(plaintext, iv, key)

    await wire.setServices(seed, encrypted)

    const fetched = await wire.getServices(seed)

    expect(fetched).not.toBeNull()

    const decrypted = secretbox.open(new Uint8Array(fetched!), iv, key)

    expect(decrypted).not.toBeNull()
    expect(new TextDecoder().decode(new Uint8Array(decrypted!))).toBe(
      '{"services":{"e2e":{}}}',
    )

    await wire.clearServices(seed)
    expect(await wire.getServices(seed)).toBeNull()
  })

  itLive('issues and reads back a credential through the v2 Hashed-Pin KDF', async () => {
    const { seed, publicKey } = keypair()
    const wire = createWireClient((req) => transport(req.method)(req))

    const pin = 'CorrectHorse1'

    const pinDigest = new Uint8Array(
      await crypto.subtle.digest('SHA-512', new TextEncoder().encode(pin)),
    )

    const imported = await crypto.subtle.importKey('raw', new Uint8Array(pinDigest).buffer, 'PBKDF2', false, [
      'deriveBits',
    ])

    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-512', salt: new Uint8Array(publicKey).buffer, iterations: 600_000 },
      imported,
      32 * 8,
    )

    const hashedPin = new Uint8Array(bits)

    const entropy = secretbox(new TextEncoder().encode('origin-buffer-like'), iv, key)
    const protector = await wire.createCredential(seed, hashedPin, entropy)

    expect(protector).toHaveLength(32)

    const got = await wire.getEntropy(publicKey, hashedPin, protector)

    expect(new Uint8Array(got)).toEqual(entropy)

    // A wrong pin is refused.
    await expect(
      wire.getEntropy(publicKey, new Uint8Array(32).fill(1), protector),
    ).rejects.toMatchObject({ kind: 'forbidden' })

    await wire.deleteCredential(publicKey, protector)
  })

  itLive('rejects a captured GET signature replayed as DELETE (v2 method binding)', async () => {
    const { secretKey, publicKey } = keypair()
    // Craft the two requests by hand: sign "GET", send as DELETE.
    const ts = new Uint8Array(4)

    new DataView(ts.buffer).setUint32(0, Math.floor(Date.now() / 1000), true)

    const url = `${base}/api/profiles/`
    const nonce = crypto.getRandomValues(new Uint8Array(16))

    const headers = {
      'Protocol-Version': '2',
      'Public-Key': toB64(publicKey),
      'Timestamp': toB64(ts),
      'Nonce': toB64(nonce),
      'Signature': toB64(
        sign.detached(concat(concat(methodBytes('GET'), ts), nonce), secretKey),
      ),
    }

    const response = await fetch(url, { method: 'DELETE', headers })

    expect(response.status).toBe(400)
  })
})
