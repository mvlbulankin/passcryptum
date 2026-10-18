import { describe, it, expect } from 'vitest'

import {
  add,
  checkForEmptiness,
  createEmptyServices,
  deleteLogin,
  deleteService,
  updateServicePreferences,
  updateVersionOfLogin,
} from '../lib/operations'

import type { ServicesConfig } from '../../types'

// The service mutators are the largest unit in the repo and had no specs.
// They all share one contract: mutate in place, throw on a missing target.
const fixture = (): ServicesConfig => [
  {
    name: 'github.com',
    passwordLengthIndex: 2,
    useSpecialCharacters: true,
    logins: [{ name: 'me', version: 1 }],
  },
  {
    name: 'gitlab.com',
    passwordLengthIndex: 0,
    useSpecialCharacters: false,
    logins: [],
  },
]

describe('add', () => {
  it('prepends a new service with defaults', () => {
    const config = createEmptyServices()

    add(config, 'github.com', 'me')

    expect(config).toEqual([
      {
        name: 'github.com',
        passwordLengthIndex: 2,
        useSpecialCharacters: true,
        logins: [{ name: 'me', version: 1 }],
      },
    ])
  })

  it('adds a service without a login', () => {
    const config = createEmptyServices()

    add(config, 'github.com')

    expect(config[0].logins).toEqual([])
  })

  it('rejects an empty service name', () => {
    expect(() => add(createEmptyServices(), '')).toThrow(
      'The name of a new service can not be empty',
    )
  })

  it('adds a login to an existing service, at the front', () => {
    const config = fixture()

    add(config, 'github.com', 'work')

    expect(config[0].logins.map(l => l.name)).toEqual(['work', 'me'])
    expect(config).toHaveLength(2)
  })

  it('does not duplicate a login that is already there', () => {
    const config = fixture()

    add(config, 'github.com', 'me')

    expect(config[0].logins).toHaveLength(1)
  })

  it('leaves the config untouched when the login is empty', () => {
    const config = fixture()

    add(config, 'github.com', '')

    expect(config[0].logins).toHaveLength(1)
  })
})

describe('deleteService', () => {
  it('removes the named service only', () => {
    const config = fixture()

    deleteService(config, 'github.com')

    expect(config.map(s => s.name)).toEqual(['gitlab.com'])
  })

  it('throws when the service is missing', () => {
    expect(() => deleteService(fixture(), 'nope.example')).toThrow(
      'The service "nope.example" does not exist',
    )
  })

  // Regression: the old code did config.splice(config.indexOf(...), 1). If the
  // lookup were ever relaxed to return undefined, indexOf would be -1 and
  // splice(-1, 1) would silently delete the LAST service instead.
  it('never removes an unrelated service on a failed lookup', () => {
    const config = fixture()

    expect(() => deleteService(config, 'nope.example')).toThrow()
    expect(config).toHaveLength(2)
  })
})

describe('deleteLogin', () => {
  it('removes the named login', () => {
    const config = fixture()

    deleteLogin(config, 'github.com', 'me')

    expect(config[0].logins).toEqual([])
  })

  it('silently ignores a missing login', () => {
    const config = fixture()

    deleteLogin(config, 'github.com', 'ghost')

    expect(config[0].logins).toHaveLength(1)
  })

  it('throws when the service is missing', () => {
    expect(() => deleteLogin(fixture(), 'nope', 'me')).toThrow(
      'The service "nope" does not exist',
    )
  })
})

describe('updateVersionOfLogin', () => {
  it('bumps the login version', () => {
    const config = fixture()

    updateVersionOfLogin(config, 'github.com', 'me', 7)

    expect(config[0].logins[0].version).toBe(7)
  })

  it('throws for a missing login and leaves versions alone', () => {
    const config = fixture()

    expect(() => updateVersionOfLogin(config, 'github.com', 'ghost', 7)).toThrow(
      'The login "ghost" does not exist',
    )
    expect(config[0].logins[0].version).toBe(1)
  })
})

describe('updateServicePreferences', () => {
  it('updates length index and special characters', () => {
    const config = fixture()

    updateServicePreferences(config, 'github.com', 3, false)

    expect(config[0]).toMatchObject({
      passwordLengthIndex: 3,
      useSpecialCharacters: false,
    })
  })

  it('rejects an out-of-range length index before touching the config', () => {
    const config = fixture()

    expect(() => updateServicePreferences(config, 'github.com', 9, true)).toThrow(
      'Invalid password length index',
    )
    expect(config[0].passwordLengthIndex).toBe(2)
  })

  it('throws for a missing service', () => {
    expect(() => updateServicePreferences(fixture(), 'nope', 1, true)).toThrow()
  })
})

describe('createEmptyServices and checkForEmptiness', () => {
  it('an empty config reports empty, a filled one does not', () => {
    const config = createEmptyServices()

    expect(checkForEmptiness(config)).toBe(true)

    add(config, 'a.com')

    expect(checkForEmptiness(config)).toBe(false)
  })
})
