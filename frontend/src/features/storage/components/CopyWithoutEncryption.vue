<script setup lang="ts">
import { stringify } from '#/services'
import { getVault } from '#/core'

import AbstractCopyServices from './AbstractCopyServices.vue'

const getDecryptedText = async () => {
  const services = await getVault().read()

  return services ? stringify(services) : null
}
</script>

<template>
  <AbstractCopyServices
    type="warning"
    confirm-copy
    :get-data="getDecryptedText"
  >
    Copy without encryption
  </AbstractCopyServices>
</template>
