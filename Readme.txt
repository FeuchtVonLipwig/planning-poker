1️⃣ Check your project structure

Make sure your folder layout looks like this:

project-root/
├─ backend/
│  └─ server.js
├─ frontend/
│  ├─ package.json
│  ├─ src/
│  │  ├─ main.ts
│  │  └─ App.vue
│  └─ vite.config.ts


App.vue must exist in frontend/src/.

main.ts must import App.vue correctly:

import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')


2️⃣ Decide how to run

You have two options:

Option A — Development mode (recommended for now)

Open frontend folder terminal:

cd frontend
npm install
npm run dev


Open browser:

http://localhost:5173/


Vite serves the frontend live.

The backend (server.js) should also be running in another terminal to handle WebSocket events.

Option B — Production mode (build + backend)

In frontend folder:

npm install
npm run build


In backend folder:

node server.js

3️⃣ Check socket connection

In dev mode (5173) you might need to point your socket to the backend explicitly:

// socket.ts
import { io } from "socket.io-client"
export const socket = io("http://localhost:3000") // must match backend port


Otherwise the frontend won’t connect to the backend and may fail silently.
Open browser:

http://localhost:3000/


Express serves the built frontend from frontend/dist.


4️⃣ Clear cache / restart everything

Sometimes old builds cause this Vue placeholder issue:

Stop all servers (Ctrl + C).

Delete frontend/node_modules/.vite and dist if present:

cd frontend
rm -rf node_modules/.vite dist
npm install


Restart frontend (npm run dev) and backend (node server.js).

If you want, I can give you a step-by-step “ready-to-run” setup for your exact project so both frontend and backend work together from scratch, including sockets, room creation, and custom room codes — this will guarantee it works.

Do you want me to do that?