<script setup lang="ts">
import { stringify } from '#/services'

import { session } from '@/entities/session'

import AbstractCopyServices from './AbstractCopyServices.vue'

// The encrypted text, formatted the way the app stores it.
const getEncryptedText = async () => {
  const services = await session.vault().read()

  return services ? stringify(services) : null
}
</script>

<template>
  <AbstractCopyServices type="primary" :get-data="getEncryptedText">
    Copy storage text
  </AbstractCopyServices>
</template>
