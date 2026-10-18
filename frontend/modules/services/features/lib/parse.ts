import {
  LoginData,
  ServiceData,
  ServicesConfig,
  CompressedConfig,
  CompressedLogins,
  CompressedServiceData,
} from '../../types'
import { isValidPasswordLengthIndex } from '../../shared'

const decompressLogins = (logins: CompressedLogins): LoginData[] =>
  Object.entries(logins).map(([name, version]) => {
    if (!Number.isFinite(version)) {
      throw new Error(`The login "${name}" has a non-numeric version`)
    }

    return { name, version }
  })

const decompressServiceData = (
  name: string,
  data: CompressedServiceData,
): ServiceData => {
  const options = Array.isArray(data) ? data[0] : 5
  const logins = Array.isArray(data) ? data[1] : data

  if (![0, 1, 2, 3, 4, 5, 6, 7].includes(options)) {
    throw new Error(`The service "${name}" has invalid options: ${options}`)
  }

  const passwordLengthIndex = options >> 1

  if (!isValidPasswordLengthIndex(passwordLengthIndex)) {
    throw new Error(
      `The service "${name}" has an invalid password length index: ${passwordLengthIndex}`,
    )
  }

  return {
    name,
    passwordLengthIndex,
    useSpecialCharacters: Boolean(options & 1),
    logins: decompressLogins(logins),
  }
}

export const parse = (data: string | null): ServicesConfig => {
  try {
    return Object.entries(JSON.parse(data as string) as CompressedConfig).map(
      ([name, data]) => decompressServiceData(name, data),
    )
  } catch (e) {
    void e

    return []
  }
}
