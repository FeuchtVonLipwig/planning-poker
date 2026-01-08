<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { socket } from './socket'

type Participant = { id: string; name: string; spectator?: boolean }

// --- State ---
const step = ref(1) // 1=name, 2=room select, 3=session
const userName = ref('')
const roomId = ref('')
const newRoomCode = ref('')
const createPublic = ref(false)

const participants = ref<Participant[]>([])
const spectatorMe = ref(false)

const selectedCard = ref<string | null>(null)
const votes = ref<Record<string, string>>({})
const revealed = ref(false)

// public room list
const publicRooms = ref<{ roomId: string; usersCount: number }[]>([])

// URL join
const roomFromUrl = ref<string | null>(null)

// cheater tracking (vote changed after reveal)
const cheaters = ref<Set<string>>(new Set())
const votesSnapshotAtReveal = ref<Record<string, string>>({})

// ---------- Helpers ----------
function parseRoomFromUrl(): string | null {
  const path = window.location.pathname || '/'
  const match = path.match(/^\/room\/([^/]+)\/?$/)
  if (!match || !match[1]) return null
  return decodeURIComponent(match[1])
}

function setUrlToRoom(id: string) {
  const next = `/room/${encodeURIComponent(id)}`
  if (window.location.pathname !== next) window.history.pushState({}, '', next)
}

function setUrlHome() {
  if (window.location.pathname !== '/') window.history.pushState({}, '', '/')
}

const roomUrl = computed(() => {
  if (!roomId.value) return ''
  return `${window.location.origin}/room/${encodeURIComponent(roomId.value)}`
})

function nameOf(id: string) {
  return participants.value.find(p => p.id === id)?.name || id
}

function isSpectator(id: string) {
  return !!participants.value.find(p => p.id === id)?.spectator
}

// Participants who should vote = not spectators
const voters = computed(() => participants.value.filter(p => !p.spectator))

const waitingFor = computed(() => {
  const votedIds = new Set(Object.keys(votes.value))
  return voters.value.filter(p => !votedIds.has(p.id))
})

const everyoneVoted = computed(() => waitingFor.value.length === 0 && voters.value.length > 0)

function parseNumeric(v: string): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const revealedVotesSorted = computed(() => {
  const rows = Object.entries(votes.value).map(([id, v]) => {
    const num = parseNumeric(v)
    return { id, name: nameOf(id), value: v, num }
  })

  // Highest first: numeric desc, then non-numeric last
  rows.sort((a, b) => {
    const an = a.num
    const bn = b.num
    if (an === null && bn === null) return 0
    if (an === null) return 1
    if (bn === null) return -1
    return bn - an
  })

  return rows
})

const averageNumeric = computed(() => {
  // Only count numeric votes from non-spectators
  const nums: number[] = []
  for (const [id, v] of Object.entries(votes.value)) {
    if (isSpectator(id)) continue
    const n = parseNumeric(v)
    if (n !== null) nums.push(n)
  }
  if (nums.length === 0) return null
  const sum = nums.reduce((a, b) => a + b, 0)
  return Math.round((sum / nums.length) * 100) / 100
})

// ---------- Socket events ----------
socket.on('room-created', (id: string) => {
  roomId.value = id
  step.value = 3
  setUrlToRoom(id)
})

socket.on('users-updated', (users: Participant[]) => {
  participants.value = users
})

socket.on('votes-updated', (v: Record<string, string>) => {
  // Cheater detection: if revealed and a vote changed compared to snapshot
  if (revealed.value) {
    for (const [id, value] of Object.entries(v)) {
      const before = votesSnapshotAtReveal.value[id]
      if (before !== undefined && before !== value) {
        cheaters.value.add(id)
      }
    }
  }
  votes.value = v
})

socket.on('revealed', () => {
  revealed.value = true
  votesSnapshotAtReveal.value = { ...votes.value }
})

socket.on('reset', () => {
  votes.value = {}
  revealed.value = false
  selectedCard.value = null
  cheaters.value = new Set()
  votesSnapshotAtReveal.value = {}
})

socket.on('public-rooms-updated', (rooms: any[]) => {
  publicRooms.value = rooms
})

socket.on('error', (msg: string) => {
  alert(msg)
})

// ---------- Lifecycle ----------
onMounted(() => {
  const id = parseRoomFromUrl()
  if (id) {
    roomFromUrl.value = id
    roomId.value = id
  }

  window.addEventListener('popstate', () => {
    const newId = parseRoomFromUrl()
    roomFromUrl.value = newId
    if (newId) roomId.value = newId
  })
})

// ---------- Actions ----------
const acceptName = () => {
  if (!userName.value.trim()) return alert('Please enter your name')

  // If opened via /room/<id>, jump straight into that session (join or create private)
  if (roomFromUrl.value) {
    joinRoomById(roomFromUrl.value)
    step.value = 3
    return
  }

  step.value = 2
}

function joinRoomById(id: string) {
  roomId.value = id
  spectatorMe.value = false
  socket.emit('join-room', { roomId: id, name: userName.value })
  setUrlToRoom(id)
}

const createRoom = () => {
  if (!newRoomCode.value) return alert('Enter a room code to create')
  spectatorMe.value = false
  socket.emit('create-room', { roomCode: newRoomCode.value, name: userName.value, public: createPublic.value })
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
  // Back to room selection, keep name
  step.value = 2
  roomId.value = ''
  newRoomCode.value = ''
  createPublic.value = false

  participants.value = []
  votes.value = {}
  selectedCard.value = null
  revealed.value = false
  cheaters.value = new Set()
  votesSnapshotAtReveal.value = {}

  spectatorMe.value = false
  roomFromUrl.value = null
  setUrlHome()
}

const backToName = () => {
  step.value = 1
  roomId.value = ''
  newRoomCode.value = ''
  createPublic.value = false

  participants.value = []
  votes.value = {}
  selectedCard.value = null
  revealed.value = false
  cheaters.value = new Set()
  votesSnapshotAtReveal.value = {}

  spectatorMe.value = false
  roomFromUrl.value = null
  setUrlHome()
}

const toggleSpectator = () => {
  if (!roomId.value) return
  socket.emit('set-spectator', { roomId: roomId.value, spectator: spectatorMe.value })
  // when switching to spectator, also clear selected card locally (optional but sensible)
  if (spectatorMe.value) selectedCard.value = null
}

const copyRoomUrl = async () => {
  if (!roomUrl.value) return
  try {
    await navigator.clipboard.writeText(roomUrl.value)
    alert('Room link copied!')
  } catch {
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

        <!-- Screen 1 -->
        <div v-if="step === 1" class="stage">
          <div class="card center-card">
            <div class="stack">
              <div class="label">Enter your name</div>
              <input v-model="userName" placeholder="Your name" @keydown.enter.prevent="acceptName" />
              <button class="btn" @click="acceptName">Continue</button>

              <div v-if="roomFromUrl" class="status-hint">
                You’re opening room: <strong>{{ roomFromUrl }}</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- Screen 2 -->
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

              <!-- Create -->
              <div class="stack">
                <div class="label">Create a room</div>
                <input v-model="newRoomCode" placeholder="New room code" @keydown.enter.prevent="createRoom" />

                <label class="check-row">
                  <input type="checkbox" v-model="createPublic" />
                  public
                </label>

                <button class="btn" @click="createRoom">Create Room</button>
              </div>

              <div class="divider"></div>

              <!-- Join -->
              <div class="stack">
                <div class="label">Join a room</div>
                <input v-model="roomId" placeholder="Existing room code" @keydown.enter.prevent="joinRoom" />
                <button class="btn" @click="joinRoom">Join Room</button>
              </div>

              <!-- Public rooms -->
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

        <!-- Screen 3 -->
        <div v-if="step === 3">
          <!-- Left panel -->
          <div class="panel panel-left">
            <div class="panel-title">Session</div>

            <div class="room-id-row">
              <p class="room-id-label"><strong>Room:</strong></p>
              <p class="room-id-value">{{ roomId }}</p>
              <button class="copy-btn" @click="copyRoomUrl" title="Copy room link">📋</button>
            </div>

            <p><strong>You:</strong> {{ userName }}</p>

            <label class="spectator-row">
              <input type="checkbox" v-model="spectatorMe" @change="toggleSpectator" />
              spectator
            </label>

            <button class="btn btn-ghost" @click="closeSession">Close Session</button>
          </div>

          <!-- Right panel -->
          <div class="panel panel-right">
            <div class="panel-title">Participants</div>
            <ul class="panel-list">
              <li v-for="p in participants" :key="p.id" class="panel-list-item">
                <span class="dot" :class="{ spect: p.spectator }"></span>
                <span class="panel-name">{{ p.name }}</span>

                <span v-if="p.spectator" class="badge">SPECT</span>
                <span v-if="cheaters.has(p.id)" class="badge badge-cheater">CHEATER</span>
              </li>
            </ul>
          </div>

          <!-- Middle -->
          <div class="middle">

            <!-- Status: who still needs to vote -->
            <div class="card status">
              <div class="status-row">
                <div class="status-title">Status</div>
                <div class="status-count">
                  {{ Object.keys(votes).length }} / {{ voters.length }}
                </div>
              </div>

              <div class="status-subtitle">Waiting for</div>

              <div v-if="everyoneVoted" class="status-empty status-ok">
                Everyone voted
              </div>

              <div v-else class="chips">
                <span v-for="p in waitingFor" :key="p.id" class="chip chip-waiting">
                  {{ p.name }}
                </span>
              </div>

              <div class="status-hint" v-if="voters.length === 0">
                No voters in room (everyone is spectator)
              </div>
            </div>

            <!-- Vote -->
            <div class="card status">
              <div class="status-row">
                <div class="status-title">Vote</div>
                <div class="status-count"></div>
              </div>

              <div class="cards">
                <button
                  v-for="c in ['1','2','3','5','8','13','20','40','100','?']"
                  :key="c"
                  class="card-btn"
                  :class="{ selected: selectedCard === c }"
                  :disabled="spectatorMe"
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

            <!-- Revealed votes -->
            <div v-if="revealed" class="card votes-card">
              <div class="panel-title">Votes</div>

              <ul class="vote-list">
                <li v-for="row in revealedVotesSorted" :key="row.id" class="vote-row">
                  <span class="vote-name">
                    {{ row.name }}
                    <span v-if="cheaters.has(row.id)" class="inline-cheater">CHEATER</span>
                    <span v-if="isSpectator(row.id)" class="badge">SPECT</span>
                  </span>
                  <span class="vote-value">{{ row.value }}</span>
                </li>
              </ul>

              <div class="avg-left" v-if="averageNumeric !== null">
                <span class="avg-symbol">Ø</span>
                <span class="avg-number">{{ averageNumeric }}</span>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* All styling lives in src/style.css */
</style>
