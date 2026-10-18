import { test as base, expect } from '@playwright/test'

// The stack (Go binary + SQLite + onboarded profiles) is prepared by
// e2e/start-stack.ts on the host before the browser container starts; see
// e2e/run.sh. Tests share it and run in order: scenarios build on each other
// (device 1 uploads, device 2 downloads) — that is the product flow.
export const test = base.extend({})

export { expect }
