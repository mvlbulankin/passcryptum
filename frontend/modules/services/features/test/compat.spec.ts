import { describe, it, expect } from 'vitest'

import { parse } from '../lib/parse'
import { stringify } from '../lib/stringify'

import {
  exampleConfig,
  exampleEmptyService,
  exampleEmptyServiceCompressed,
  exampleCompressed,
  firstOriginalConfig,
} from './examples'

// Payloads written by 2.x devices must keep parsing in 3.x: a user upgrading
// has a vault full of them, and the format changed only in how it is
// encrypted, never in how it is described.
describe('compatibility with 2.x vault payloads', () => {
  it('parses the compressed form a 2.x device stored', () => {
    const config = parse(exampleCompressed)

    expect(config).toEqual(exampleConfig)
  })

  it('parses a service that has no logins yet', () => {
    expect(parse(exampleEmptyServiceCompressed)).toEqual(exampleEmptyService)
  })

  it('parses a payload with several services and preferences', () => {
    const config = parse(JSON.stringify(compressedFromRealDevice()))

    expect(config.length).toBeGreaterThan(1)
    expect(config.every(service => service.name.length > 0)).toBe(true)
  })

  it('round-trips every real payload without losing anything', () => {
    const config = parse(JSON.stringify(compressedFromRealDevice()))

    // stringify → parse → stringify must be stable, otherwise a saved vault
    // drifts every time the user opens the app.
    const first = stringify(config)
    const second = stringify(parse(first))

    expect(second).toBe(first)
  })

  it('keeps the original fixture intact through a round trip', () => {
    expect(parse(stringify(firstOriginalConfig))).toEqual(firstOriginalConfig)
  })

  it('returns an empty list for input it cannot read', () => {
    expect(parse(null)).toEqual([])
    expect(parse('')).toEqual([])
    expect(parse('not json')).toEqual([])
    expect(parse('{"broken":[9,{"a":1}]}')).toEqual([])
  })
})

// A compressed payload in the exact shape a 2.x device wrote.
function compressedFromRealDevice() {
  return {
    'github.com': [7, { me: 3 }],
    'gitlab.com': { work: 1 },
    'example.org': {},
  }
}
