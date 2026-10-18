<script setup lang="ts">
import { uint8ArrayToBase64 } from '#/core'

import { session } from '@/entities/session/model/private'
import { CopyButton } from '@/shared'
import { isCalculationInProgress } from '@/entities/session'

const getPublicKey = () => uint8ArrayToBase64(session.publicKey())
</script>

<template>
  <CopyButton
    strong
    tertiary
    size="large"
    type="primary"
    :get-content="getPublicKey"
    :disabled="isCalculationInProgress"
  >
    Copy public key
  </CopyButton>
</template>
