<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import {
  NA,
  NCard,
  NTabs,
  NSpace,
  NTabPane,
  TabsInst,
  useMessage,
  useLoadingBar,
  useDialog,
} from 'naive-ui'
import { h } from 'vue'
import { getSession, getKeyPairFromSeed, uint8ArrayToBase64 } from '#/core'

import { createElementRef } from '@/shared'
import { AppInfo } from '@/widgets/app-info'
import {
  isOnlinePinSet,
  isOfflinePinSet,
  enterByPin,
  enterByPassword,
  isCalculationInProgress,
} from '@/entities/session'
import { isOnlineMode, useChangeOnlineMode } from '@/features/online-mode'
import { useDownloadServices } from '@/features/storage/lib/download-services-from-server'

import LoginForm from './LoginForm.vue'

const tabs = {
  PIN: 'pin',
  PASSWORD: 'password',
}

const message = useMessage()
const loadingBar = useLoadingBar()
const dialog = useDialog()
const tabsInstRef = createElementRef<TabsInst>()

const hasPin = () =>
  isOnlineMode.value ? isOnlinePinSet.value : isOfflinePinSet.value

const currentTab = ref(hasPin() ? tabs.PIN : tabs.PASSWORD)

const { toggleOnlineMode } = useChangeOnlineMode()
const { downloadServices } = useDownloadServices()

const onEnterPin = async (pin: string) => {
  loadingBar.start()

  try {
    await enterByPin(pin)
    loadingBar.finish()
  } catch (e) {
    void e
    loadingBar.error()
    message.error('Wrong PIN')
  }
}

const onEnterPassword = async (password: string) => {
  loadingBar.start()

  try {
    await enterByPassword(password)
    loadingBar.finish()

    const { keyPairSeed } = getSession()
    const { publicKey } = getKeyPairFromSeed(keyPairSeed)
    const currentPublicKey = uint8ArrayToBase64(publicKey)
    const storedPublicKey = localStorage.getItem('isVisited')

    if (!storedPublicKey || storedPublicKey !== currentPublicKey) {
      promptOnlineMode()
    }
  } catch (e) {
    void e
    loadingBar.error()
    message.error('Wrong password')
  }
}

const promptOnlineMode = () => {
  if (isOnlineMode.value) {
    const { keyPairSeed } = getSession()
    const { publicKey } = getKeyPairFromSeed(keyPairSeed)
    const currentPublicKey = uint8ArrayToBase64(publicKey)

    localStorage.setItem('isVisited', currentPublicKey)

    return
  }

  dialog.info({
    title: 'Enable Online Mode?',
    content: () =>
      h('div', [
        h('p', 'Would you like to enable online mode?'),
        h(
          'p',
          'Online mode provides secure cloud storage and syncing of your services across devices.',
        ),
      ]),
    positiveText: 'Yes',
    negativeText: 'No',
    async onPositiveClick() {
      toggleOnlineMode()

      try {
        await downloadServices()
      } catch (e) {
        void e
      }

      const { keyPairSeed } = getSession()
      const { publicKey } = getKeyPairFromSeed(keyPairSeed)
      const currentPublicKey = uint8ArrayToBase64(publicKey)

      localStorage.setItem('isVisited', currentPublicKey)
    },
    onNegativeClick() {
      const { keyPairSeed } = getSession()
      const { publicKey } = getKeyPairFromSeed(keyPairSeed)
      const currentPublicKey = uint8ArrayToBase64(publicKey)

      localStorage.setItem('isVisited', currentPublicKey)
    },
  })
}

watch(hasPin, newHasPin => {
  currentTab.value = newHasPin ? tabs.PIN : tabs.PASSWORD
  nextTick(() => tabsInstRef.value?.syncBarPosition())
})
</script>

<template>
  <NSpace vertical size="large">
    <NCard title="Sign in">
      <NTabs
        ref="tabsInstRef"
        v-model:value="currentTab"
        size="large"
        type="segment"
      >
        <NTabPane
          tab="PIN"
          :name="tabs.PIN"
          :disabled="isCalculationInProgress || !hasPin()"
        >
          <LoginForm
            :disabled="isCalculationInProgress"
            :placeholder="
              isOnlineMode ? 'Enter online PIN' : 'Enter offline PIN'
            "
            @enter="onEnterPin"
          />
        </NTabPane>

        <NTabPane
          tab="Password"
          :name="tabs.PASSWORD"
          :disabled="isCalculationInProgress"
        >
          <LoginForm
            :disabled="isCalculationInProgress"
            placeholder="Enter password"
            @enter="onEnterPassword"
          />
        </NTabPane>
      </NTabs>
    </NCard>

    <AppInfo />

    <NCard title="Previous version">
      <NA href="https://v1.passcryptum.com">v1.passcryptum.com</NA>
    </NCard>
  </NSpace>
</template>
