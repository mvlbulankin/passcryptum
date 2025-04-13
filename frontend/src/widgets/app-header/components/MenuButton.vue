<script setup lang="ts">
import {
  Menu,
  LogoGithub,
  ServerOutline,
  LogOutOutline,
  LockOpenOutline,
  ColorFillOutline,
  AddCircleOutline,
  LockClosedOutline,
  CloudDoneOutline,
  CloudOfflineOutline,
} from '@vicons/ionicons5'
import { computed, h, type Component } from 'vue'
import { NDropdown, NButton, NIcon, NSwitch } from 'naive-ui'

import { useChangeTheme } from '@/features/theme'
import { StorageDrawer, openStorage } from '@/features/storage'
import {
  useDeleteOnlinePin,
  useDeleteOfflinePin,
  setOnlinePin,
  setOfflinePin,
  SetOnlinePinModal,
  SetOfflinePinModal,
} from '@/features/pin'
import { addService, AddServiceModal } from '@/features/add-service'
import { useExit, isCalculationInProgress } from '@/entities/session'
import { useChangeOnlineMode, isOnlineMode } from '@/features/online-mode'

const { exit } = useExit()
const props = defineProps<{ isEntered: boolean }>()
const { themeName, changeTheme } = useChangeTheme()
const { toggleOnlineMode } = useChangeOnlineMode()
const { deleteOnlinePin, isDeleteOnlinePinDisabled } = useDeleteOnlinePin()
const { deleteOfflinePin, isDeleteOfflinePinDisabled } = useDeleteOfflinePin()

const renderIcon = (icon: Component) => () =>
  h(NIcon, null, { default: () => h(icon) })

const onlineModeIcon = computed(() =>
  renderIcon(isOnlineMode.value ? CloudDoneOutline : CloudOfflineOutline),
)

const options = computed(() => [
  {
    key: 'onlineMode',
    label: () =>
      h(
        NSwitch,
        {
          'value': isOnlineMode.value,
          'onUpdate:value': toggleOnlineMode,
          'disabled': isCalculationInProgress.value,
          'railStyle': ({ checked }: { checked: boolean }) => ({
            background: checked ? '#18a058' : '#d03050',
          }),
        },
        {
          checked: () => 'Online',
          unchecked: () => 'Offline',
        },
      ),
    icon: onlineModeIcon.value,
  },
  ...(props.isEntered
    ? [
        {
          key: 'storage',
          label: 'Storage',
          icon: renderIcon(ServerOutline),
        },
        {
          key: 'addService',
          label: 'Add a service',
          icon: renderIcon(AddCircleOutline),
        },
        ...(isOnlineMode.value
          ? [
              {
                key: 'setOnlinePin',
                label: 'Set online PIN',
                icon: renderIcon(LockClosedOutline),
              },
            ]
          : [
              {
                key: 'setOfflinePin',
                label: 'Set offline PIN',
                icon: renderIcon(LockClosedOutline),
              },
            ]),
      ]
    : []),
  ...(isOnlineMode.value
    ? [
        {
          key: 'deleteOnlinePin',
          label: 'Delete online PIN',
          disabled: isDeleteOnlinePinDisabled.value,
          icon: renderIcon(LockOpenOutline),
        },
      ]
    : [
        {
          key: 'deleteOfflinePin',
          label: 'Delete offline PIN',
          disabled: isDeleteOfflinePinDisabled.value,
          icon: renderIcon(LockOpenOutline),
        },
      ]),
  {
    key: 'changeTheme',
    label: () => themeName.value,
    icon: renderIcon(ColorFillOutline),
  },
  {
    key: 'github',
    label: () =>
      h(
        'a',
        {
          href: 'https://github.com/nelkor/passcryptum',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'GitHub',
      ),
    icon: renderIcon(LogoGithub),
  },
  ...(props.isEntered
    ? [
        {
          key: 'signOut',
          label: 'Sign out',
          icon: renderIcon(LogOutOutline),
        },
      ]
    : []),
])

const handleSelect = (key: string) => {
  switch (key) {
    case 'changeTheme':
      changeTheme()
      break
    case 'deleteOfflinePin':
      deleteOfflinePin()
      break
    case 'deleteOnlinePin':
      deleteOnlinePin()
      break
    case 'signOut':
      exit()
      break
    case 'setOfflinePin':
      setOfflinePin()
      break
    case 'setOnlinePin':
      setOnlinePin()
      break
    case 'addService':
      addService()
      break
    case 'storage':
      openStorage()
      break
  }
}
</script>

<template>
  <NDropdown
    size="huge"
    trigger="click"
    :options="options"
    @select="handleSelect"
  >
    <NButton quaternary class="header-menu" :disabled="isCalculationInProgress">
      <template #icon>
        <Menu />
      </template>
    </NButton>
  </NDropdown>

  <SetOfflinePinModal />
  <SetOnlinePinModal />
  <StorageDrawer />
  <AddServiceModal />
</template>
