<script setup lang="ts">
import { Close } from '@vicons/ionicons5'
import { NButton, useDialog, useMessage, useLoadingBar } from 'naive-ui'

import { rmService, runBlocking } from '@/entities/session'
import { service, isServiceDetailsShown } from '../model'

const dialog = useDialog()
const message = useMessage()
const loadingBar = useLoadingBar()

const onClick = () => {
  dialog.warning({
    title: 'Service will be deleted',
    content: `Are you sure you want to delete the service '${service.name}'?`,
    positiveText: 'Delete',
    negativeText: 'Cancel',
    onPositiveClick() {
      isServiceDetailsShown.value = false

      void runBlocking(() => rmService(service.name), loadingBar).then(() => {
        message.info(`The service '${service.name}' has been deleted`)
      })
    },
  })
}
</script>

<template>
  <NButton strong secondary type="error" size="large" @click="onClick">
    <template #icon>
      <Close />
    </template>

    Delete service
  </NButton>
</template>
