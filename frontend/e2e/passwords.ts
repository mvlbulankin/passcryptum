// Every origin password the suite signs in with. Profiles exist only after an
// admin onboards the password's public key, so the list must be known before
// the stack starts (see e2e/start-stack.ts).
export const E2E_PASSWORDS = [
  'correct horse battery staple e2e',
  'definitely not the password',
  'sync between devices e2e',
  'file round trip e2e',
  'android emulation e2e',
]
