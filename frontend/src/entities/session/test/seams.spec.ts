import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, it, expect } from 'vitest'

// src/ has two seams. modules/core enforces its own (core/test/barrel.spec);
// entities/session had none — the seam was a convention, and it had already
// been bypassed. These checks make it mechanical, the same way.
//
//  1. nothing reaches into entities/session's internals (its barrel only);
//  2. no feature imports another feature's internals (the barrel only).
const ROOT = join(__dirname, '../../../..')
const SRC = join(ROOT, 'src')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)

    if (statSync(full).isDirectory()) {
      return walk(full)
    }

    return /\.(ts|vue)$/.test(entry) ? [full] : []
  })

const read = (file: string) => readFileSync(file, 'utf-8')

/** Any import from `dir/...` that is not exactly `dir`. */
const deepImports = (source: string, dir: string): string[] => {
  const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const pattern = new RegExp(
    `from\\s+['"]${escaped}/(?!index['"])([^'"]+)['"]`,
    'g',
  )

  return [...source.matchAll(pattern)].map(match => match[1])
}

describe('src seams are barrels', () => {
  it('nothing imports entities/session internals', () => {
    const offenders = walk(SRC).flatMap(file =>
      deepImports(read(file), '@/entities/session').map(
        path => `${relative(ROOT, file)} -> ${path}`,
      ),
    )

    expect(offenders).toEqual([])
  })

  it('no feature imports another feature internals', () => {
    const featureOf = (file: string) => {
      const match = relative(ROOT, file).match(/^src\/features\/([^/]+)\//)

      return match?.[1]
    }

    const offenders = walk(join(SRC, 'features')).flatMap(file => {
      const own = featureOf(file)

      return [
        ...read(file).matchAll(
          /from\s+['"]@\/features\/([a-z-]+)(\/[^'"]*)?['"]/g,
        ),
      ]
        .filter(([, target, deep]) => target !== own && deep)
        .map(
          ([, target, deep]) => `${relative(ROOT, file)} -> ${target}${deep}`,
        )
    })

    expect(offenders).toEqual([])
  })
})
