<script setup lang="ts">
import { computed } from 'vue'
import { useDialog } from 'naive-ui'

import { CopyButton } from '@/shared'
import { areServicesEmpty, session } from '@/entities/session'
import { createVaultCopies, type VaultCopyForm } from '../lib/vault-copies'

const props = defineProps<{ form: VaultCopyForm; type?: string }>()

const dialog = useDialog()

const copies = computed(() =>
  session.isActive() ? createVaultCopies(session.vault()) : null,
)

const copy = computed(() => (copies.value ? copies.value[props.form] : null))

// Handing every secret to the OS clipboard (history, cloud sync) asks
// first — the rule comes from the form, not from a prop a caller could
// forget to pass.
const confirm = () => {
  const { confirmation } = copy.value ?? {}

  if (!confirmation) {
    return Promise.resolve(true)
  }

  return new Promise<boolean>(resolve => {
    dialog.warning({
      title: confirmation.title,
      content: confirmation.content,
      positiveText: 'Copy',
      negativeText: 'Cancel',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

const getContent = async () =>
  copy.value ? (await copy.value.read()) || '' : ''
</script>

<template>
  <CopyButton
    strong
    tertiary
    size="large"
    :type="type"
    :get-content="getContent"
    :confirm="copy?.confirmation ? confirm : undefined"
    :disabled="areServicesEmpty"
  >
    {{ copy?.label }}
  </CopyButton>
</template>
