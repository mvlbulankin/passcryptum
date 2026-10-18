<script setup lang="ts">
import { getDataDecrypted } from '#/core'

import AbstractCopyServices from './AbstractCopyServices.vue'
</script>

<template>
  <AbstractCopyServices
    type="warning"
    confirm-copy
    :get-data="getDataDecrypted"
  >
    Copy without encryption
  </AbstractCopyServices>
</template>
