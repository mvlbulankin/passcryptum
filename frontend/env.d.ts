/// <reference types="vite/client" />

declare module '*.vue' {
  import { Component } from 'vue'

  const component: Component

  export default component
}

// Stamped at build time from package.json (vite define).
declare const __APP_VERSION__: string
