<script setup lang="ts">
import { NButton, useDialog } from 'naive-ui'
import { CloudUploadOutline } from '@vicons/ionicons5'

import { useUploadServices } from '../lib/upload-services-to-server'

const dialog = useDialog()
const { uploadServices, areServicesEmpty } = useUploadServices()

const onClick = () => {
  dialog.warning({
    title: 'Services will be uploaded to server',
    content: 'Are you sure you want to upload your services to server?',
    positiveText: 'Upload',
    negativeText: 'Cancel',
    onPositiveClick() {
      uploadServices()
    },
  })
}
</script>

<template>
  <NButton
    strong
    tertiary
    size="large"
    type="primary"
    :disabled="areServicesEmpty"
    @click="onClick"
  >
    <template #icon>
      <CloudUploadOutline />
    </template>
    Upload services to server
  </NButton>
</template>
