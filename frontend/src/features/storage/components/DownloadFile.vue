<script setup lang="ts">
import { NButton, useLoadingBar } from 'naive-ui'
import { DownloadOutline } from '@vicons/ionicons5'

import {
  session,
  sessionId,
  areServicesEmpty,
  runBlocking,
} from '@/entities/session'

const loadingBar = useLoadingBar()
const linkElement = document.createElement('a')
const BINARY_MIME_TYPE = 'application/octet-stream'

const onClick = async () => {
  const buffer = await runBlocking(
    () => session.vault().exportBytes(),
    loadingBar,
  )

  if (!buffer) {
    throw new Error('There is nothing to download')
  }

  const blob = new Blob([new Uint8Array(buffer).buffer], {
    type: BINARY_MIME_TYPE,
  })

  linkElement.href = URL.createObjectURL(blob)
  linkElement.download = `${sessionId.value}.dat`

  linkElement.click()
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
      <DownloadOutline />
    </template>

    Download file
  </NButton>
</template>
