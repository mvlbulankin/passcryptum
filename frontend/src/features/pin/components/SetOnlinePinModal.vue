<script setup lang="ts">
import {
  useDialog,
  NIcon,
  NModal,
  NSpace,
  NInput,
  useMessage,
  useLoadingBar,
} from 'naive-ui'
import { ref } from 'vue'
import { MIN_PIN_LENGTH, pinCustody } from '#/core'
import { KeyOutline, LockClosedOutline } from '@vicons/ionicons5'

import { FormSubmit } from '@/shared'
import { showPublicKeyError } from '@/features/storage/lib/public-key-error'
import { isCalculationInProgress } from '@/entities/session'
import { session, showSetOnlinePinModal } from '../model'

const pin = ref('')

const dialog = useDialog()
const message = useMessage()
const loadingBar = useLoadingBar()

const clearForm = () => {
  pin.value = ''
}

const stop = () => {
  loadingBar.finish()
  isCalculationInProgress.value = false
}

const fail = () => {
  loadingBar.error()
  message.error('Failed to set online PIN')
  isCalculationInProgress.value = false
}

const onSubmit = () => {
  if (pin.value.length < MIN_PIN_LENGTH) {
    message.error(`PIN must be at least ${MIN_PIN_LENGTH} characters`)

    return
  }

  loadingBar.start()
  isCalculationInProgress.value = true

  pinCustody
    .store('online', pin.value, session.originBuffer())
    .then(result => {
      if (result.ok) {
        message.success('Online PIN has been set')
        stop()
        showSetOnlinePinModal.value = false
        clearForm()
      } else if (result.reason === 'unknownProfile') {
        stop()
        showPublicKeyError(dialog)
      } else {
        fail()
      }
    })
    .catch(fail)
}
</script>

<template>
  <NModal
    v-model:show="showSetOnlinePinModal"
    preset="card"
    class="app-modal"
    title="Setting online PIN"
    @after-leave="clearForm"
  >
    <form @submit.prevent="onSubmit">
      <NSpace vertical size="large">
        <NInput
          v-model:value="pin"
          size="large"
          type="password"
          placeholder="Enter a PIN (8+ characters)"
          show-password-on="click"
          :input-props="{ name: 'PIN' }"
          :disabled="isCalculationInProgress"
        >
          <template #prefix>
            <NIcon :component="KeyOutline" />
          </template>
        </NInput>

        <FormSubmit :disabled="pin.length < MIN_PIN_LENGTH">
          <template #icon>
            <LockClosedOutline />
          </template>
        </FormSubmit>
      </NSpace>
    </form>
  </NModal>
</template>
