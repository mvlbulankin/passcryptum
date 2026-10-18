export const LS_KEY_PIN = 'pin'

export const LS_KEY_PROTECTOR = 'protector'

export const LS_KEY_PUBLIC_KEY = 'public_key'

export const LS_KEY_RANDOM_STRING = 'random_string'

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
