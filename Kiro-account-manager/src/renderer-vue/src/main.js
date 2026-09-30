import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@lingyzh/ui/styles.css'
import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')
