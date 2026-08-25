/*
 * **First import in the app, deliberately.** It declares the cascade layer order, and a layer's
 * position is fixed the first time its name is seen — so this has to be in front of Vuetify's
 * stylesheet, which `./plugins/vuetify` pulls in. See styles/layers.scss.
 */
import './styles/layers.scss'

import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { vuetify } from './plugins/vuetify'
import { router } from './router'
/* After the plugin: these rules read the theme's custom properties, which Vuetify defines. */
import './styles/main.scss'

createApp(App).use(createPinia()).use(vuetify).use(router).mount('#app')
