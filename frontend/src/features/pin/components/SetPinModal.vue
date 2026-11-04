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
import { computed, ref } from 'vue'
import { MIN_PIN_LENGTH, pinCustody } from '#/core'
import { KeyOutline, LockClosedOutline } from '@vicons/ionicons5'

import { FormSubmit } from '@/shared'
import { showPublicKeyError } from '@/features/storage/lib/public-key-error'
import { isCalculationInProgress, runBlocking } from '@/entities/session'
import { session, setPinKind } from '../model'

const pin = ref('')

const dialog = useDialog()
const message = useMessage()
const loadingBar = useLoadingBar()

// The one set-PIN form; the kind decides the title, the texts and how a
// refusal is explained. The twins it replaces had already drifted apart
// (one hardened its failure paths, the other did not).
const kind = computed(() => setPinKind.value)

const isOnline = computed(() => kind.value === 'online')

const title = computed(() =>
  isOnline.value ? 'Setting online PIN' : 'Setting offline PIN',
)

const successText = computed(() =>
  isOnline.value ? 'Online PIN has been set' : 'Offline PIN has been set',
)

const show = computed({
  get: () => kind.value !== null,
  set(next: boolean) {
    if (!next) {
      setPinKind.value = null
    }
  },
})

const clearForm = () => {
  pin.value = ''
}

const onSubmit = () => {
  if (pin.value.length < MIN_PIN_LENGTH || kind.value === null) {
    message.error(`PIN must be at least ${MIN_PIN_LENGTH} characters`)

    return
  }

  const target = kind.value
  const { value } = pin

  void runBlocking(
    () => pinCustody.store(target, value, session.originBuffer()),
    loadingBar,
  )
    .then(result => {
      if (result.ok) {
        message.success(successText.value)
        setPinKind.value = null
        clearForm()
      } else if (result.reason === 'unknownProfile') {
        // Only the online hand-over can be refused this way, and only it
        // explains the refusal with the public-key dialog.
        showPublicKeyError(dialog)
      } else {
        message.error(
          `Failed to set ${isOnline.value ? 'online' : 'offline'} PIN`,
        )
      }
    })
    .catch(() => {
      message.error(
        `Failed to set ${isOnline.value ? 'online' : 'offline'} PIN`,
      )
    })
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    class="app-modal"
    :title="title"
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
