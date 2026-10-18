<script setup lang="ts">
import { NLayoutHeader, NText } from 'naive-ui'

import { ServicesSelect, ServicesFilter } from '@/entities/session'
import { useAppHeader } from '../hooks/app-header'

import AppLogo from './AppLogo.vue'
import MenuButton from './MenuButton.vue'

// Stamped from package.json at build time: one source of truth for the version.
const APP_VERSION = __APP_VERSION__

const { isEntered } = useAppHeader()
</script>

<template>
  <NLayoutHeader bordered class="app-header">
    <div class="constant-header">
      <AppLogo />
      <ServicesFilter v-if="isEntered" class="constant-services-filter" />

      <div class="header-content">
        <NText class="app-version">{{ APP_VERSION }}</NText>
        <MenuButton :is-entered="isEntered" />
      </div>
    </div>

    <div v-if="isEntered" class="extra-header">
      <ServicesSelect />
    </div>
  </NLayoutHeader>
</template>
