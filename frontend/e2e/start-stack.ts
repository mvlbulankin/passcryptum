#!/usr/bin/env node
// Prepares the stack the e2e suite runs against, on the HOST: builds the Go
// binary, onboards every test profile, starts the server, waits for it. The
// browser itself runs in a container (frontend/e2e/run.sh) because the host
// lacks Chromium's system libraries — the split is why this lives here and
// not in a Playwright globalSetup.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { derivePublicKey } from './derive.ts'
import { E2E_PASSWORDS } from './passwords.ts'

const here = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(here, '../../backend')
// The browser reaches the host by name; 127.0.0.1 inside the container is
// the container itself. TLS on top (Caddy) keeps this a secure context — the
// Web Crypto API is undefined otherwise and every login would fail.
const port = 8901
const bindAddr = `0.0.0.0:${port}`

const main = async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'passcryptum-e2e-'))
  const dbPath = join(workDir, 'passcryptum.db')
  const bin = join(workDir, 'passcryptum')

  // The SPA is embedded at build time: build it and drop it into
  // backend/web exactly as the Dockerfile does (the checked-in copy is a
  // placeholder).
  const frontendDir = resolve(here, '..')

  console.log('[e2e] building the frontend...')
  spawnSyncOrThrow('npm', ['run', 'build'], frontendDir)
  rmSync(join(backendDir, 'web'), { recursive: true, force: true })
  cpSync(join(frontendDir, 'dist'), join(backendDir, 'web'), { recursive: true })

  console.log('[e2e] building the binary...')
  spawnSyncOrThrow('go', ['build', '-o', bin, '.'], backendDir)

  const env = { ...process.env, PC_DB: dbPath }

  const run = (args: string[]) =>
    spawnSyncOrThrow(bin, args, backendDir, env)

  const keys = run(['genkey'])
  const seed = keys.match(/seed\(private\):\s+(\S+)/)?.[1] as string
  const publicKey = keys.match(/public:\s+(\S+)/)?.[1] as string

  run(['add-public-key', publicKey])
  console.log(`[e2e] server key: ${publicKey.slice(0, 12)}`)

  for (const password of E2E_PASSWORDS) {
    const derived = await derivePublicKey(password)

    console.log(`[e2e] onboard ${JSON.stringify(password)} -> ${derived.slice(0, 12)}`)
    console.log(run(['add-public-key', derived]).trim())
  }

  console.log(`[e2e] serving on ${bindAddr} (db: ${dbPath})`)

  const server = spawn(bin, ['serve', bindAddr], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  })

  const stack = { origin: `http://127.0.0.1:${port}`, publicKey, seed: '' }

  writeFileSync(join(workDir, 'stack.json'), JSON.stringify(stack))

  const deadline = Date.now() + 20_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${stack.origin}/manifest.json`)

      if (response.ok) {
        break
      }
    } catch {
      // not up yet
    }

    await new Promise<void>(resolve => {
      setTimeout(resolve, 100)
    })
  }

  // Print the pid so the caller can tear the server down.
  // The seed/public pair lets the live wire suite sign requests as this
  // profile (it is onboarded above).
  process.stdout.write(
    `E2E_SERVER_PID=${server.pid}\n` +
      `E2E_WORKDIR=${workDir}\n` +
      `E2E_SEED=${seed}\n` +
      `E2E_PUB=${publicKey}\n`,
  )
}

function spawnSyncOrThrow(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf-8',
  })

  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr}`)
  }

  return result.stdout as string
}

await main()
