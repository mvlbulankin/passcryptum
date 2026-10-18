<script setup lang="ts">
import { useDialog,
  NIcon,
  NModal,
  NSpace,
  NInput,
  useMessage,
  useLoadingBar } from 'naive-ui'
import { ref } from 'vue'
import { MIN_PIN_LENGTH, isForbidden, setOnlinePin } from '#/core'
import { KeyOutline, LockClosedOutline } from '@vicons/ionicons5'

import { FormSubmit } from '@/shared'
import { showPublicKeyError } from '@/features/storage/lib/public-key-error'
import { isCalculationInProgress } from '@/entities/session'
import { session, touchSession, showSetOnlinePinModal  } from '../model'

const pin = ref('')

const dialog = useDialog()
const message = useMessage()
const loadingBar = useLoadingBar()

const clearForm = () => {
  pin.value = ''
}

const onSubmit = () => {
  if (pin.value.length < MIN_PIN_LENGTH) {
    message.error(`PIN must be at least ${MIN_PIN_LENGTH} characters`)

    return
  }

  loadingBar.start()
  setOnlinePin(session, localStorage, pin.value)
    .then(result => {
      if (result.success) {
        touchSession()
        message.success('Online PIN has been set')
        loadingBar.finish()
        isCalculationInProgress.value = false
        showSetOnlinePinModal.value = false
        clearForm()
      } else if (result.reason === '403') {
        loadingBar.finish()
        isCalculationInProgress.value = false
        showSetOnlinePinModal.value = false
        clearForm()
      }
    })
    .catch(e => {
      if (isForbidden(e)) {
        showPublicKeyError(dialog)
        loadingBar.finish()
        isCalculationInProgress.value = false

        return
      }

      void e

      loadingBar.error()
      message.error('Failed to set online PIN')
      isCalculationInProgress.value = false
    })
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
