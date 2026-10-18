import { createApp } from 'vue'

import { App, watchHeight, watchIdleLogout, registerServiceWorker } from './app'

watchHeight()
watchIdleLogout()
registerServiceWorker()
createApp(App).mount('#app')
Object.defineProperty(window, 'WebSocket', { value: null })
