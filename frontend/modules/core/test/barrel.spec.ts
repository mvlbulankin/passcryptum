import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, it, expect } from 'vitest'

// The core module's public surface is an intention list, not a file listing.
// Two properties are enforced here, mechanically, so they cannot rot:
//
//  1. src/ imports only names the barrel actually exports (a typo or a
//     removed export fails instead of silently working through a deep path);
//  2. src/ never reaches into modules/core/**: the seam is the barrel.
const ROOT = join(__dirname, '../../..')
const CORE = join(ROOT, 'modules/core')
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

/** Names the barrel exports (value exports only, types are erased). */
const barrelExports = (): Set<string> => {
  const source = read(join(CORE, 'index.ts'))

  const names = [...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap(
    match => match[1].split(','),
  )

  return new Set(
    names
      .map(name => name.replace(/\btype\s+/, '').trim())
      .filter(Boolean)
      .map(name => name.split(/\s+as\s+/).pop() as string),
  )
}

describe('core barrel is the seam', () => {
  it('src never imports from modules/core internals', () => {
    const offenders = walk(SRC).filter(file =>
      /from\s+['"](?:#\/core\/|.*modules\/core\/)/.test(read(file)),
    )

    expect(offenders.map(file => relative(ROOT, file))).toEqual([])
  })

  it('src only uses names the barrel exports', () => {
    const exported = barrelExports()
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const source = read(file)

      for (const match of source.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]#\/core['"]/g,
      )) {
        for (const raw of match[1].split(',')) {
          const name = raw.replace(/\btype\s+/, '').trim()

          if (name && !exported.has(name)) {
            offenders.push(`${relative(ROOT, file)}: ${name}`)
          }
        }
      }

      // Namespace and default imports would bypass the list entirely.
      if (/import\s+\*\s+as\s+\w+\s+from\s+['"]#\/core['"]/.test(source)) {
        offenders.push(`${relative(ROOT, file)}: namespace import`)
      }
    }

    expect(offenders).toEqual([])
  })
})
