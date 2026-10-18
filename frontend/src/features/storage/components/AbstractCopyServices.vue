<script setup lang="ts">
import { useDialog } from 'naive-ui'

import { CopyButton } from '@/shared'
import { areServicesEmpty } from '@/entities/session'

const props = defineProps<{
  getData(): Promise<null | string>
  confirmCopy?: boolean
}>()

const dialog = useDialog()

// Copying the entire decrypted vault hands every secret to the OS
// clipboard (history, cloud sync). Require an explicit confirmation, the
// same way destructive server actions do.
const confirmWholeVaultCopy = () =>
  new Promise<boolean>(resolve => {
    dialog.warning({
      title: 'Copy the entire vault?',
      content:
        'All logins and passwords will be placed in the clipboard in plaintext. Clipboard contents may be stored by the OS or synced to the cloud.',
      positiveText: 'Copy',
      negativeText: 'Cancel',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })

const getContent = async () => {
  const data = await props.getData()

  return data || ''
}
</script>

<template>
  <CopyButton
    strong
    tertiary
    size="large"
    v-bind="$attrs"
    :get-content="getContent"
    :confirm="confirmCopy ? confirmWholeVaultCopy : undefined"
    :disabled="areServicesEmpty"
  >
    <slot />
  </CopyButton>
</template>
