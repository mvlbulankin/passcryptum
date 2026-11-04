<script setup lang="ts">
import { ref, computed } from 'vue'
import { AddCircleOutline, PersonAddOutline } from '@vicons/ionicons5'
import { NIcon, NModal, NSpace, NInput, useLoadingBar } from 'naive-ui'

import { FormSubmit } from '@/shared'
import {
  addServiceAndLogin,
  isCalculationInProgress,
  runBlocking,
} from '@/entities/session'
import { service, showAddLoginModal } from '../model'

const loginName = ref('')
const loadingBar = useLoadingBar()

const loginAlreadyExists = computed(() =>
  service.logins.some(({ name }) => loginName.value.trim() === name),
)

const clearForm = () => {
  loginName.value = ''
}

const onSubmit = () => {
  const login = loginName.value

  clearForm()

  void runBlocking(
    () => addServiceAndLogin(service.name, login),
    loadingBar,
  ).then(() => {
    showAddLoginModal.value = false
  })
}
</script>

<template>
  <NModal
    v-model:show="showAddLoginModal"
    preset="card"
    class="app-modal"
    title="Login addition"
    @after-leave="clearForm"
  >
    <form @submit.prevent="onSubmit">
      <NSpace vertical size="large">
        <NInput
          v-model:value="loginName"
          size="large"
          placeholder="Enter login"
          :input-props="{ name: 'Login' }"
          :disabled="isCalculationInProgress"
        >
          <template #prefix>
            <NIcon :component="PersonAddOutline" />
          </template>
        </NInput>

        <FormSubmit :disabled="!loginName || loginAlreadyExists">
          <template #icon>
            <AddCircleOutline />
          </template>
        </FormSubmit>
      </NSpace>
    </form>
  </NModal>
</template>
