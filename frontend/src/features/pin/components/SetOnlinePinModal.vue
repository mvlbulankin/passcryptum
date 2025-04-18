<script setup lang="ts">
import { useDialog } from 'naive-ui'
import {
  NIcon,
  NModal,
  NSpace,
  NInput,
  useMessage,
  useLoadingBar,
} from 'naive-ui'
import { ref } from 'vue'
import { setOnlinePin } from '#/core'
import { KeyOutline, LockClosedOutline } from '@vicons/ionicons5'

import { FormSubmit } from '@/shared'
import { setOnlinePinState, isCalculationInProgress } from '@/entities/session'

import { showSetOnlinePinModal } from '../model'

const pin = ref('')
const dialog = useDialog()
const message = useMessage()
const loadingBar = useLoadingBar()

const clearForm = () => {
  pin.value = ''
}

const onSubmit = () => {
  loadingBar.start()
  setOnlinePin(pin.value, dialog)
    .then(result => {
      if (result.success) {
        setOnlinePinState(true)
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
          placeholder="Enter any PIN"
          show-password-on="click"
          :input-props="{ name: 'PIN' }"
          :disabled="isCalculationInProgress"
        >
          <template #prefix>
            <NIcon :component="KeyOutline" />
          </template>
        </NInput>

        <FormSubmit :disabled="!pin">
          <template #icon>
            <LockClosedOutline />
          </template>
        </FormSubmit>
      </NSpace>
    </form>
  </NModal>
</template>
