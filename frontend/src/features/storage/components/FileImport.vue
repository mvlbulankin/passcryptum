<script setup lang="ts">
import { DocumentOutline } from '@vicons/ionicons5'
import { NH4, NButton, useMessage, useLoadingBar } from 'naive-ui'
import { checkForEmptiness } from '#/services'

import { session, importServices } from '@/entities/session'

const message = useMessage()
const loadingBar = useLoadingBar()
const element = document.createElement('input')

element.setAttribute('type', 'file')
element.setAttribute('hidden', '')
// Attached to the document so the control is reachable (assistive tech,
// automation); the visible affordance stays the button below.
document.body.append(element)

element.addEventListener('change', async () => {
  const [file] = Array.from(element.files as FileList)

  element.value = ''

  if (!file) {
    return
  }

  loadingBar.start()

  const config = await session.vault().importBytes(await file.arrayBuffer())

  if (!config || checkForEmptiness(config)) {
    loadingBar.error()
    message.error('An error occurred while importing')

    return
  }

  // importServices persists through the vault; writing again here would
  // store an unmerged copy over the merged one.
  await importServices(config)
  loadingBar.finish()
  message.success('Services have been imported')
})

const onClick = () => element.click()
</script>

<template>
  <NH4>Import services from file</NH4>

  <NButton strong secondary size="large" type="primary" @click="onClick">
    <template #icon>
      <DocumentOutline />
    </template>

    Select file
  </NButton>
</template>
