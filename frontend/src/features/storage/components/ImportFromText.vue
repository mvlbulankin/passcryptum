<script setup lang="ts">
import { ref } from 'vue'
import { BookOutline, ClipboardOutline } from '@vicons/ionicons5'
import { NH4, NIcon, NInput, NSpace, useMessage, useLoadingBar } from 'naive-ui'
import { checkForEmptiness } from '#/services'

import {
  session,
  importServices,
  isCalculationInProgress,
} from '@/entities/session'
import { FormSubmit } from '@/shared'

const message = useMessage()
const servicesString = ref('')
const loadingBar = useLoadingBar()

const onSubmit = async () => {
  const text = servicesString.value

  servicesString.value = ''
  isCalculationInProgress.value = true
  loadingBar.start()

  // The vault accepts both pasted plaintext (a JSON export) and an
  // encrypted blob — one entry point, no format guessing in the caller.
  const config = await session.vault().importText(text)

  isCalculationInProgress.value = false

  if (!config || checkForEmptiness(config)) {
    loadingBar.error()
    message.error('An error occurred while importing')

    return
  }

  await importServices(config)
  loadingBar.finish()
  message.success('Services have been imported')
}
</script>

<template>
  <NH4>Import services from text</NH4>

  <form @submit.prevent="onSubmit">
    <NSpace vertical size="large">
      <NInput
        v-model:value="servicesString"
        size="large"
        placeholder="Paste the text"
        :disabled="isCalculationInProgress"
        :input-props="{ name: 'Paste services text' }"
      >
        <template #prefix>
          <NIcon :component="ClipboardOutline" />
        </template>
      </NInput>

      <FormSubmit :disabled="!servicesString">
        <template #icon>
          <BookOutline />
        </template>

        <template #text>Import</template>
      </FormSubmit>
    </NSpace>
  </form>
</template>
