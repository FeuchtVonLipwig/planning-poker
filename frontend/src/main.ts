import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'  

import { io } from "socket.io-client";

export const socket = io("http://localhost:3000");

const app = createApp(App)

app.use(router)

app.mount('#app')
