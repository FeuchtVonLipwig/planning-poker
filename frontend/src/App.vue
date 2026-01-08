<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { socket } from './socket'

// --- State ---
const step = ref(1) // 1 = name, 2 = room selection, 3 = session
const roomId = ref('')
const newRoomCode = ref('')
const userName = ref('')
const participants = ref<{ id: string; name: string }[]>([])
const selectedCard = ref<string | null>(null)
const votes = ref<Record<string, string>>({})
const revealed = ref(false)

// optional: if you already have public rooms list in your UI, keep it
const publicRooms = ref<{ roomId: string; usersCount: number }[]>([])

// If user opened /room/<id>, we store it here
const roomFromUrl = ref<string | null>(null)

// Full room URL to copy
const roomUrl = computed(() => {
  if (!roomId.value) return ''
  return `${window.location.origin}/room/${encodeURIComponent(roomId.value)}`
})

function setUrlToRoom(id: string) {
  const next = `/room/${encodeURIComponent(id)}`
  if (window.location.pathname !== next) {
    window.history.pushState({}, '', next)
  }
}

function setUrlHome() {
  if (window.location.pathname !== '/') {
    window.history.pushState({}, '', '/')
  }
}

// --- WebSocket events ---
socket.on('room-created', (id: string) => {
  roomId.value = id
  step.value = 3
  setUrlToRoom(id)
})

socket.on('users-updated', (users: any[]) => {
  participants.value = users
})

socket.on('votes-updated', (v) => {
  votes.value = v
})

socket.on('revealed', () => {
  revealed.value = true
})

socket.on('reset', () => {
  votes.value = {}
  revealed.value = false
  selectedCard.value = null
})

socket.on('public-rooms-updated', (rooms: any[]) => {
  publicRooms.value = rooms
})

socket.on('error', (msg: string) => {
  alert(msg)
})

// --- URL parsing ---
function parseRoomFromUrl(): string | null {
  const path = window.location.pathname || '/'
  const match = path.match(/^\/room\/([^/]+)\/?$/)

  if (!match || !match[1]) return null

  return decodeURIComponent(match[1])
}

onMounted(() => {
  const id = parseRoomFromUrl()
  if (id) {
    roomFromUrl.value = id
    roomId.value = id // show it if you ever go back to step 2
  }

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    const newId = parseRoomFromUrl()
    roomFromUrl.value = newId
    if (newId) roomId.value = newId
  })
})

// --- Actions ---
const acceptName = () => {
  if (!userName.value.trim()) return alert('Please enter your name')

  // If user opened a room URL, go directly into that session (join or create-private)
  if (roomFromUrl.value) {
    joinRoomById(roomFromUrl.value)
    step.value = 3
    return
  }

  step.value = 2
}

function joinRoomById(id: string) {
  roomId.value = id
  socket.emit('join-room', { roomId: id, name: userName.value })
  setUrlToRoom(id)
}

const createRoom = () => {
  if (!newRoomCode.value) return alert('Enter a room code to create')

  // NOTE: server will auto-join creator if we pass name
  socket.emit('create-room', { roomCode: newRoomCode.value, name: userName.value, public: false })
}

const joinRoom = () => {
  if (!roomId.value) return alert('Enter room code')
  joinRoomById(roomId.value)
  step.value = 3
}

const voteCard = (value: string) => {
  selectedCard.value = value
  if (!roomId.value) return
  socket.emit('vote', { roomId: roomId.value, value })
}

const revealVotes = () => {
  if (!roomId.value) return
  socket.emit('reveal', roomId.value)
}

const resetVotes = () => {
  if (!roomId.value) return
  socket.emit('reset', roomId.value)
  selectedCard.value = null
}

const closeSession = () => {
  // go back to room selection (step 2) but keep name
  step.value = 2
  roomId.value = ''
  newRoomCode.value = ''
  participants.value = []
  votes.value = {}
  selectedCard.value = null
  revealed.value = false

  // leaving session URL
  roomFromUrl.value = null
  setUrlHome()
}

const backToName = () => {
  step.value = 1
  roomId.value = ''
  newRoomCode.value = ''
  participants.value = []
  votes.value = {}
  selectedCard.value = null
  revealed.value = false

  roomFromUrl.value = null
  setUrlHome()
}

const copyRoomUrl = async () => {
  if (!roomUrl.value) return
  try {
    await navigator.clipboard.writeText(roomUrl.value)
    alert('Room link copied!')
  } catch {
    // fallback
    const tmp = document.createElement('textarea')
    tmp.value = roomUrl.value
    document.body.appendChild(tmp)
    tmp.select()
    document.execCommand('copy')
    document.body.removeChild(tmp)
    alert('Room link copied!')
  }
}
</script>

<template>
  <div class="page">
    <header class="app-header">
      <h1>Planning Poker</h1>
    </header>

    <div class="container">
      <div class="content">

        <!-- Screen 1: Name -->
        <div v-if="step === 1" class="stage">
          <div class="card center-card">
            <div class="stack">
              <div class="label">Enter your name</div>
              <input
                v-model="userName"
                placeholder="Your name"
                @keydown.enter.prevent="acceptName"
              />
              <button class="btn" @click="acceptName">Continue</button>

              <div v-if="roomFromUrl" class="status-hint">
                You’re opening room: <strong>{{ roomFromUrl }}</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- Screen 2: Room selection -->
        <div v-if="step === 2" class="stage">
          <div class="card center-card">
            <div class="stack">
              <div class="current-name">
                <span class="current-name-label">Current name:</span>
                <span class="current-name-value">{{ userName }}</span>
              </div>

              <div class="back-btn">
                <button class="btn btn-ghost" @click="backToName">Back to name</button>
              </div>

              <div class="divider"></div>

              <div class="stack">
                <div class="label">Create a room</div>
                <input
                  v-model="newRoomCode"
                  placeholder="New room code"
                  @keydown.enter.prevent="createRoom"
                />
                <button class="btn" @click="createRoom">Create Room</button>
              </div>

              <div class="divider"></div>

              <div class="stack">
                <div class="label">Join a room</div>
                <input
                  v-model="roomId"
                  placeholder="Existing room code"
                  @keydown.enter.prevent="joinRoom"
                />
                <button class="btn" @click="joinRoom">Join Room</button>
              </div>

              <!-- If you already show public rooms, you can keep using publicRooms here -->
              <div class="public-rooms">
                <div class="public-rooms-title">Public rooms</div>

                <div v-if="publicRooms.length === 0" class="public-empty">
                  No available public rooms
                </div>

                <ul v-else class="public-list">
                  <li
                    v-for="r in publicRooms"
                    :key="r.roomId"
                    class="public-item"
                    @click="joinRoomById(r.roomId); step = 3"
                  >
                    <span class="public-room-id">{{ r.roomId }}</span>
                    <span class="public-users">{{ r.usersCount }} users</span>
                  </li>
                </ul>
              </div>

            </div>
          </div>
        </div>

        <!-- Screen 3: Session -->
        <div v-if="step === 3">
          <!-- Top-left panel -->
          <div class="panel panel-left">
            <div class="panel-title">Session</div>

            <div class="room-id-row">
              <p class="room-id-label"><strong>Room:</strong></p>
              <p class="room-id-value">{{ roomId }}</p>

              <!-- Copy ROOM URL -->
              <button class="copy-btn" @click="copyRoomUrl" title="Copy room link">
                📋
              </button>
            </div>

            <p><strong>You:</strong> {{ userName }}</p>

            <button class="btn btn-ghost" @click="closeSession">Close Session</button>
          </div>

          <!-- Top-right panel -->
          <div class="panel panel-right">
            <div class="panel-title">Participants</div>
            <ul class="panel-list">
              <li v-for="p in participants" :key="p.id" class="panel-list-item">
                <span class="dot"></span>
                <span class="panel-name">{{ p.name }}</span>
              </li>
            </ul>
          </div>

          <!-- Center content -->
          <div class="middle">
            <div class="card status">
              <div class="status-row">
                <div class="status-title">Vote</div>
                <div class="status-count">{{ Object.keys(votes).length }} / {{ participants.length }}</div>
              </div>
              <div class="status-subtitle">Pick a card</div>

              <div class="cards">
                <button
                  v-for="c in ['1','2','3','5','8','13','20','40','100','?']"
                  :key="c"
                  class="card-btn"
                  :class="{ selected: selectedCard === c }"
                  @click="voteCard(c)"
                >
                  {{ c }}
                </button>
              </div>

              <div class="buttons" style="margin-top: 1rem;">
                <button class="btn" @click="revealVotes">Reveal Votes</button>
                <button class="btn btn-ghost" @click="resetVotes">Reset</button>
              </div>
            </div>

            <div v-if="revealed" class="card votes-card">
              <div class="panel-title">Votes</div>
              <ul class="vote-list">
                <li v-for="(v, id) in votes" :key="id" class="vote-row">
                  <span class="vote-name">
                    {{ participants.find(p => p.id === id)?.name || id }}
                  </span>
                  <span class="vote-value">{{ v }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* Keep your component-specific styles minimal.
   You said you moved styles to global style.css, so usually nothing is needed here. */
</style>
