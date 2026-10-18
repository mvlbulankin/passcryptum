<script setup lang="ts">
import { NP, NCard } from 'naive-ui'

import GitHubLink from './GitHubLink.vue'
import ExternalLink from './ExternalLink.vue'
</script>

<template>
  <NCard title="For your information">
    <NP>
      Passcryptum works offline: all&nbsp;passwords are derived on&nbsp;your
      device from your origin password.
    </NP>

    <NP>
      Online mode additionally keeps an&nbsp;encrypted copy of&nbsp;your
      services on&nbsp;your own server, so&nbsp;your devices stay in&nbsp;sync.
      The&nbsp;server cannot read it.
    </NP>

    <NP>
      Read
      <GitHubLink path="#passcryptum">the instructions</GitHubLink>
      in&nbsp;our repository.
    </NP>

    <NP>
      You can also join
      <ExternalLink url="t.me/passcryptum">our Telegram channel</ExternalLink>.
    </NP>
  </NCard>
</template>
