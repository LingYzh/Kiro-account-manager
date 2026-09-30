import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { setClipboardWriter } from '@lingyzh/ui'
import '@lingyzh/ui/styles.css'
import App from './App.vue'

setClipboardWriter(function writeClipboard(text) {
    return navigator.clipboard.writeText(text)
})
createApp(App).use(createPinia()).mount('#app')
