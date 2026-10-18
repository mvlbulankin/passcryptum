<script setup lang="ts">
import { stringify } from '#/services'
import { getVault } from '#/core'

import AbstractCopyServices from './AbstractCopyServices.vue'

// The encrypted text, formatted the way the app stores it.
const getEncryptedText = async () => {
  const services = await getVault().read()

  return services ? stringify(services) : null
}
</script>

<template>
  <AbstractCopyServices type="primary" :get-data="getEncryptedText">
    Copy storage text
  </AbstractCopyServices>
</template>
