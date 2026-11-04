<script setup lang="ts">
import { ref, watch, nextTick, h } from 'vue'
import {
  NCard,
  NTabs,
  NSpace,
  NTabPane,
  TabsInst,
  useMessage,
  useLoadingBar,
  useDialog,
} from 'naive-ui'

import { createElementRef } from '@/shared'
import { AppInfo } from '@/widgets/app-info'
import {
  isOnlinePinSet,
  isOfflinePinSet,
  enterByPin,
  enterByPassword,
  isCalculationInProgress,
  runBlocking,
  session,
  useVaultSync,
} from '@/entities/session'
import { isOnlineMode, useChangeOnlineMode } from '@/features/online-mode'

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
const { downloadServices } = useVaultSync()

const onEnterPin = async (pin: string) => {
  try {
    await runBlocking(() => enterByPin(pin), loadingBar)
  } catch (e) {
    // The attempt's message already says what failed (wrong PIN, no stored
    // PIN, network): do not overwrite it with a blanket guess.
    message.error(e instanceof Error ? e.message : 'Sign in failed')
  }
}

const onEnterPassword = async (password: string) => {
  try {
    await runBlocking(() => enterByPassword(password), loadingBar)

    if (!session.hasVisited()) {
      promptOnlineMode()
    }
  } catch (e) {
    void e
    message.error('Wrong password')
  }
}

const promptOnlineMode = () => {
  if (isOnlineMode.value) {
    session.markVisited()

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

      session.markVisited()
    },
    onNegativeClick() {
      session.markVisited()
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
  </NSpace>
</template>
