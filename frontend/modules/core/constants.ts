export const LS_KEY_PIN = 'pin'

export const LS_KEY_PROTECTOR = 'protector'

export const LS_KEY_PUBLIC_KEY = 'public_key'

export const LS_KEY_RANDOM_STRING = 'random_string'

// The online custody's own salt. It is deliberately separate from
// LS_KEY_RANDOM_STRING (the offline salt): a shared salt made the two
// custodities destroy each other — setting an online PIN re-salted the
// offline blob, and revoking the online PIN deleted the offline one's salt
// (ADR-0008). LS_KEY_RANDOM_STRING keeps its old name because it is still
// the offline salt; no compatibility read exists for the pre-split layout.
export const LS_KEY_ONLINE_RANDOM_STRING = 'online_random_string'

export const PIN_BUFFER_BYTE_LENGTH = 48

export const PIN_BUFFER_ITERATIONS = 2 ** 19

export const ORIGIN_BUFFER_BYTE_LENGTH = 256

export const ORIGIN_BUFFER_ITERATIONS = 2 ** 18

export const PASSWORD_BUFFER_BYTE_LENGTH = 64

export const PASSWORD_BUFFER_ITERATIONS = 2 ** 4

export const WIRE_PIN_ITERATIONS = 600_000

// ADR-0003 §5: the client enforces a minimum PIN length to bound the
// dictionary space the KDF has to defend.
export const MIN_PIN_LENGTH = 8

export const LS_KEY_MODE = 'onlineMode'

export const LS_KEY_VISITED = 'isVisited'
