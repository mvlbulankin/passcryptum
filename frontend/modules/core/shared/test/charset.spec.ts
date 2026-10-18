import { describe, it, expect } from 'vitest'

import { capitals, getCharset } from '../lib/charset'

describe('getCharset', () => {
  it('always offers lowercase, uppercase and digits', () => {
    const [upper, lower, digits] = getCharset(false)

    expect(upper).toBe(capitals)
    expect(lower).toBe('abcdefghijklmnopqrstuvwxyz')
    expect(digits).toBe('0123456789')
  })

  it('adds exactly one group with special characters', () => {
    const plain = getCharset(false)
    const special = getCharset(true)

    expect(special).toHaveLength(plain.length + 1)
    expect(special.slice(0, plain.length)).toEqual(plain)
  })

  it('has no duplicate characters within a group', () => {
    for (const group of getCharset(true)) {
      expect(new Set(group).size).toBe(group.length)
    }
  })

  // The generated password picks a character by index modulo the group size,
  // so a group must never be empty (division by zero / undefined char).
  it('never returns an empty group', () => {
    for (const group of getCharset(true)) {
      expect(group.length).toBeGreaterThan(0)
    }
  })

  it('does not contain whitespace or quotes that break shell pasting', () => {
    const all = getCharset(true).join('')

    expect(all).not.toMatch(/\s/)
    expect(all).not.toContain("'")
    expect(all).not.toContain('\\')
  })
})
