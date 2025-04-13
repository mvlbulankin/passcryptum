<script setup lang="ts">
import { NButton, useDialog } from 'naive-ui'
import { Close } from '@vicons/ionicons5'

import { useDeleteServices } from '../lib/delete-services-from-server'

const dialog = useDialog()
const { deleteServices } = useDeleteServices()

const onClick = () => {
  dialog.warning({
    title: 'Services will be deleted from server',
    content: 'Are you sure you want to delete your services from server?',
    positiveText: 'Delete',
    negativeText: 'Cancel',
    onPositiveClick() {
      deleteServices()
    },
  })
}
</script>

<template>
  <NButton strong secondary type="error" size="large" @click="onClick">
    <template #icon>
      <Close />
    </template>
    Delete all services from server
  </NButton>
</template>
