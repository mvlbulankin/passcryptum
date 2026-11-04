import { ref } from 'vue'
import type { CustodyKind } from '#/core'

import { session } from '@/entities/session'

/**
 * Which custody the set-PIN modal is about; null while it is hidden. One
 * modal, one flag — the online/offline difference lives in the kind.
 */
export const setPinKind = ref<CustodyKind | null>(null)

export { session }
