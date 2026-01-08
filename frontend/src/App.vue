<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { socket } from './socket'

// --------------------
// State
// --------------------
const step = ref(1)
const roomId = ref('')
const newRoomCode = ref('')
const userName = ref('')

type Participant = { id: string; name: string; spectator?: boolean }
const participants = ref<Participant[]>([])

const selectedCard = ref<string | null>(null)
const votes = ref<Record<string, string>>({})
const revealed = ref(false)

const isSpectator = ref(false)

// Rooms (CHANGED: clean private checkbox)
const isPrivate = ref(false) // default = PUBLIC
type PublicRoom = { roomId: string; users: number }
const publicRooms = ref<PublicRoom[]>([])

// Cheaters (current reveal round)
const cheaters = ref<Record<string, boolean>>({})

// Copy feedback
const copied = ref(false)
let copiedTimer: number | null = null

// --------------------
// Derived
// --------------------
const activeParticipants = computed(() =>
  participants.value.filter(p => !p.spectator)
)

const activeVotesMap = computed(() => {
  const allowedIds = new Set(activeParticipants.value.map(p => p.id))
  const filtered: Record<string, string> = {}
  for (const [id, v] of Object.entries(votes.value || {})) {
    if (allowedIds.has(id)) filtered[id] = v
  }
  return filtered
})

const voted = computed(() => {
  const v = activeVotesMap.value
  return activeParticipants.value.filter(p => p.id in v)
})

const notVoted = computed(() => {
  const v = activeVotesMap.value
  return activeParticipants.value.filter(p => !(p.id in v))
})

const voteCountText = computed(() =>
  `${voted.value.length}/${activeParticipants.value.length} voted`
)

// Sort votes highest first; non-numeric at bottom
const sortedVotes = computed(() => {
  const vmap = activeVotesMap.value
  const entries = Object.entries(vmap).map(([id, value]) => {
    const name = participants.value.find(p => p.id === id)?.name || id
    const num = Number(value)
    const isNumeric = Number.isFinite(num)
    const isCheater = !!cheaters.value[id]
    return { id, name, value, isNumeric, num, isCheater }
  })

  entries.sort((a, b) => {
    if (a.isNumeric && b.isNumeric) return b.num - a.num
    if (a.isNumeric && !b.isNumeric) return -1
    if (!a.isNumeric && b.isNumeric) return 1
    return String(a.value).localeCompare(String(b.value))
  })

  return entries
})

// Average of numeric votes only
const averageInfo = computed(() => {
  const nums = Object.values(activeVotesMap.value || {})
    .map(v => Number(v))
    .filter(n => Number.isFinite(n))

  if (nums.length === 0) return { avgText: 'N/A', count: 0 }

  const sum = nums.reduce((acc, n) => acc + n, 0)
  const avg = sum / nums.length
  const avgText = Number.isInteger(avg) ? String(avg) : avg.toFixed(2)

  return { avgText, count: nums.length }
})

// --------------------
// Socket events
// --------------------
socket.on("room-created", (id: string) => {
  roomId.value = id
  step.value = 3
})

socket.on("users-updated", (users: any[]) => {
  participants.value = users

  const me = participants.value.find(p => p.id === socket.id)
  if (me && typeof me.spectator === 'boolean') {
    isSpectator.value = !!me.spectator
  }
})

socket.on("votes-updated", (v) => {
  votes.value = v
})

socket.on("revealed", () => {
  revealed.value = true
})

socket.on("reset", () => {
  votes.value = {}
  revealed.value = false
  selectedCard.value = null
  cheaters.value = {}
})

socket.on("public-rooms-updated", (rooms: PublicRoom[]) => {
  publicRooms.value = Array.isArray(rooms) ? rooms : []
})

socket.on("cheaters-updated", (c: Record<string, boolean>) => {
  cheaters.value = c || {}
})

socket.on("error", (msg: string) => alert(msg))

// Refresh public rooms list on entering Session screen
watch(step, (s) => {
  if (s === 2) socket.emit("get-public-rooms")
})

// --------------------
// Actions
// --------------------
const acceptName = () => {
  if (!userName.value.trim()) return alert("Please enter your name")
  step.value = 2
  socket.emit("get-public-rooms")
}

const backFromSessionToName = () => {
  roomId.value = ''
  newRoomCode.value = ''
  step.value = 1
}

const createRoom = () => {
  if (!newRoomCode.value.trim()) return alert("Enter a room code")
  socket.emit("create-room", {
    roomCode: newRoomCode.value,
    name: userName.value,
    isPrivate: isPrivate.value
  })
}

const joinRoom = (idOverride?: string) => {
  const id = (idOverride ?? roomId.value).trim()
  if (!id) return alert("Enter room code")
  roomId.value = id
  socket.emit("join-room", { roomId: id, name: userName.value })
  step.value = 3
}

const setSpectator = () => {
  if (isSpectator.value) selectedCard.value = null
  socket.emit("set-spectator", { roomId: roomId.value, spectator: isSpectator.value })
}

const voteCard = (value: string) => {
  if (isSpectator.value) return
  selectedCard.value = value
  socket.emit("vote", { roomId: roomId.value, value })
}

const revealVotes = () => socket.emit("reveal", roomId.value)

const resetVotes = () => {
  socket.emit("reset", roomId.value)
  selectedCard.value = null
}

const closeSession = () => {
  step.value = 2
  roomId.value = ''
  participants.value = []
  votes.value = {}
  selectedCard.value = null
  revealed.value = false
  isSpectator.value = false
  cheaters.value = {}
  socket.emit("get-public-rooms")
}

// --------------------
// Clipboard
// --------------------
const copyRoomId = async () => {
  if (!roomId.value) return
  try {
    await navigator.clipboard.writeText(roomId.value)

    copied.value = true
    if (copiedTimer) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copied.value = false
      copiedTimer = null
    }, 1200)
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = roomId.value
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)

      copied.value = true
      if (copiedTimer) window.clearTimeout(copiedTimer)
      copiedTimer = window.setTimeout(() => {
        copied.value = false
        copiedTimer = null
      }, 1200)
    } catch {
      alert("Could not copy to clipboard.")
    }
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

        <!-- STEP 1 -->
        <div v-if="step === 1" class="stage">
          <div class="card center-card">
            <h2>Enter your name</h2>
            <label class="label">Name</label>

            <form class="stack" @submit.prevent="acceptName">
              <input v-model="userName" placeholder="Your name" />
              <button class="btn" type="submit">Continue</button>
            </form>
          </div>
        </div>

        <!-- STEP 2 -->
        <div v-if="step === 2" class="stage">
          <div class="card center-card">
            <h2>Session</h2>

            <div class="current-name">
              <span class="current-name-label">Current name:</span>
              <span class="current-name-value">{{ userName }}</span>
            </div>

            <button class="btn btn-ghost back-btn" @click="backFromSessionToName" type="button">
              ← Back to name
            </button>

            <!-- Create -->
            <form class="stack" @submit.prevent="createRoom">
              <label class="label">Create a room</label>
              <input v-model="newRoomCode" placeholder="New room code" />

              <!-- CHANGED: Public is default, checkbox is Private -->
              <label class="check-row">
                <input type="checkbox" v-model="isPrivate" />
                <span>Private</span>
              </label>

              <button class="btn" type="submit">Create Room</button>
            </form>

            <div class="divider"></div>

            <!-- Join -->
            <form class="stack" @submit.prevent="joinRoom()">
              <label class="label">Join a room</label>
              <input v-model="roomId" placeholder="Existing room code" />
              <button class="btn" type="submit">Join Room</button>
            </form>

            <!-- Public rooms list -->
            <div class="public-rooms">
              <div class="public-rooms-title">Available public rooms</div>

              <div v-if="publicRooms.length === 0" class="public-empty">
                No available public rooms
              </div>

              <ul v-else class="public-list">
                <li
                  v-for="r in publicRooms"
                  :key="r.roomId"
                  class="public-item"
                  @click="joinRoom(r.roomId)"
                  role="button"
                  tabindex="0"
                >
                  <span class="public-room-id">{{ r.roomId }}</span>
                  <span class="public-users">{{ r.users }} user{{ r.users === 1 ? '' : 's' }}</span>
                </li>
              </ul>
            </div>

          </div>
        </div>

        <!-- STEP 3 -->
        <div v-if="step === 3">
          <!-- LEFT PANEL -->
          <div class="panel panel-left">
            <div class="room-id-row">
              <p class="room-id-label"><strong>Room ID:</strong></p>
              <p class="room-id-value">{{ roomId }}</p>

              <button
                class="copy-btn"
                @click="copyRoomId"
                type="button"
                :title="copied ? 'Copied!' : 'Copy room id'"
              >
                <span v-if="!copied">📋</span>
                <span v-else>✓</span>
              </button>
            </div>

            <p><strong>You:</strong> {{ userName }}</p>

            <label class="spectator-row">
              <input type="checkbox" v-model="isSpectator" @change="setSpectator" />
              <span>Spectator</span>
            </label>

            <button class="btn btn-ghost" @click="closeSession" type="button">Close Session</button>
          </div>

          <!-- RIGHT PANEL -->
          <div class="panel panel-right">
            <h3 class="panel-title">Participants</h3>
            <ul class="panel-list">
              <li v-for="p in participants" :key="p.id" class="panel-list-item">
                <span class="dot" :class="{ spect: !!p.spectator }"></span>
                <span class="panel-name">{{ p.name }}</span>

                <span v-if="p.spectator" class="badge">SPECTATOR</span>
                <span v-else-if="cheaters[p.id]" class="badge badge-cheater">CHEATER</span>
              </li>
            </ul>
          </div>

          <!-- MIDDLE -->
          <main class="middle">
            <div class="card status">
              <div class="status-row">
                <div class="status-title">Estimation status</div>
                <div class="status-count">{{ voteCountText }}</div>
              </div>

              <div class="status-section">
                <div class="status-subtitle">Voted</div>
                <div v-if="voted.length === 0" class="status-empty">No votes yet</div>
                <div v-else class="chips">
                  <span v-for="p in voted" :key="p.id" class="chip chip-voted">{{ p.name }}</span>
                </div>
              </div>

              <div class="status-section">
                <div class="status-subtitle">Waiting for</div>
                <div v-if="notVoted.length === 0" class="status-empty status-ok">
                  Everyone voted
                </div>
                <div v-else class="chips">
                  <span v-for="p in notVoted" :key="p.id" class="chip chip-waiting">{{ p.name }}</span>
                </div>
              </div>

              <div v-if="activeParticipants.length === 0" class="status-hint">
                Everyone is a spectator (no votes will be counted).
              </div>
            </div>

            <h2 class="section-title">Vote</h2>

            <div class="cards">
              <button
                v-for="c in ['1','2','3','5','8','13','20','40','100','?']"
                :key="c"
                class="card-btn"
                :class="{ selected: selectedCard === c }"
                :disabled="isSpectator"
                @click="voteCard(c)"
                type="button"
              >
                {{ c }}
              </button>
            </div>

            <div class="buttons">
              <button class="btn" @click="revealVotes" type="button">Reveal Votes</button>
              <button class="btn btn-ghost" @click="resetVotes" type="button">Reset</button>
            </div>

            <div v-if="revealed" class="card votes-card">
              <h3>Votes</h3>

              <ul class="vote-list">
                <li v-for="entry in sortedVotes" :key="entry.id" class="vote-row">
                  <span class="vote-name">
                    {{ entry.name }}
                    <span v-if="entry.isCheater" class="inline-cheater">CHEATER</span>
                  </span>
                  <span class="vote-value">{{ entry.value }}</span>
                </li>
              </ul>

              <div class="avg-left">
                <span class="avg-symbol">Ø</span>
                <span class="avg-number">{{ averageInfo.avgText }}</span>
              </div>
            </div>
          </main>
        </div>

      </div>
    </div>
  </div>
</template>
