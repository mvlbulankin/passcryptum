import { generatePassword } from '#/core'
import { LoginData, ServiceData, passwordLengthVariants } from '#/services'

import { writeToClipboard } from '@/shared'
import { session } from '@/entities/session'

export const writePasswordToClipboard = (
  service: ServiceData,
  login: LoginData,
) => {
  writeToClipboard(
    generatePassword(
      session.entropy(),
      service.name,
      login.name,
      login.version,
      service.useSpecialCharacters,
      passwordLengthVariants[service.passwordLengthIndex],
    ),
  )
}
