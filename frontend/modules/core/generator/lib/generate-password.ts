import { createPassword } from './create-password'

/** Derives a service password. Entropy is passed in: the generator stays pure. */
export const generatePassword = (
  entropy: Uint8Array,
  serviceName: string,
  login: string,
  version: number,
  useSymbols: boolean,
  length: number,
) =>
  createPassword(
    new Uint8Array(entropy).buffer as ArrayBuffer,
    serviceName,
    login,
    version,
    useSymbols,
    length,
  )
