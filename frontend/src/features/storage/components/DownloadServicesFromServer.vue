<script setup lang="ts">
import { NButton } from 'naive-ui'
import { CloudDownloadOutline } from '@vicons/ionicons5'

import { isCalculationInProgress } from '@/entities/session'

import { useDownloadServices } from '../lib/download-services-from-server'

const { downloadServices } = useDownloadServices()

const onClick = () => {
  downloadServices()
}
</script>

<template>
  <NButton
    strong
    tertiary
    size="large"
    type="primary"
    :disabled="isCalculationInProgress"
    @click="onClick"
  >
    <template #icon>
      <CloudDownloadOutline />
    </template>
    Download services from server
  </NButton>
</template>
