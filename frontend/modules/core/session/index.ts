// Session — everything that belongs to being logged in: the derived secret
// material, the vault, the mode and the PIN flags. Consumers use narrow
// accessors; nothing reaches a raw buffer after exit().

export { createSession } from './lib/session'

export { SessionClosedError } from './lib/types'

export type {
  Session,
  SessionDeps,
  SessionMode,
  SessionStorage,
  StarterKit,
  TransportKeys,
} from './lib/types'
