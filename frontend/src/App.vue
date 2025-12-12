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

// Public rooms
const createPublic = ref(false)
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
    isPublic: createPublic.value
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
// Clipboard (NEW)
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
    // Fallback for some environments
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
            <input v-model="userName" placeholder="Your name" />
            <button class="btn" @click="acceptName">Continue</button>
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

            <button class="btn btn-ghost back-btn" @click="backFromSessionToName">
              ← Back to name
            </button>

            <!-- Create -->
            <div class="stack">
              <label class="label">Create a room</label>
              <input v-model="newRoomCode" placeholder="New room code" />

              <label class="check-row">
                <input type="checkbox" v-model="createPublic" />
                <span>Public</span>
              </label>

              <button class="btn" @click="createRoom">Create Room</button>
            </div>

            <div class="divider"></div>

            <!-- Join -->
            <div class="stack">
              <label class="label">Join a room</label>
              <input v-model="roomId" placeholder="Existing room code" />
              <button class="btn" @click="joinRoom()">Join Room</button>
            </div>

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
            <!-- Room ID row with copy button (NEW) -->
            <div class="room-id-row">
              <p class="room-id-label"><strong>Room ID:</strong></p>
              <p class="room-id-value">{{ roomId }}</p>

              <button class="copy-btn" @click="copyRoomId" :title="copied ? 'Copied!' : 'Copy room id'">
                <span v-if="!copied">📋</span>
                <span v-else>✓</span>
              </button>
            </div>

            <p><strong>You:</strong> {{ userName }}</p>

            <label class="spectator-row">
              <input type="checkbox" v-model="isSpectator" @change="setSpectator" />
              <span>Spectator</span>
            </label>

            <button class="btn btn-ghost" @click="closeSession">Close Session</button>
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
              >
                {{ c }}
              </button>
            </div>

            <div class="buttons">
              <button class="btn" @click="revealVotes">Reveal Votes</button>
              <button class="btn btn-ghost" @click="resetVotes">Reset</button>
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

<style scoped>
.page { min-height: 100vh; background: #0f1115; color: #f5f7ff; }
.app-header { width: 100vw; display: flex; justify-content: center; align-items: center; padding: 1.6rem 0 1.2rem; margin-left: calc(50% - 50vw); }
.app-header h1 { font-size: 2.8rem; margin: 0; }

.container { padding: 0 1.25rem; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
.content { width: 100%; display: flex; flex-direction: column; align-items: center; }
.stage { width: 100%; display: flex; justify-content: center; margin-top: 1rem; }

.card, .panel { background: #161a22; border: 1px solid #2a3142; border-radius: 12px; box-shadow: 0 10px 24px rgba(0,0,0,0.35); }
.center-card { width: min(560px, 92vw); padding: 1.25rem; display: flex; flex-direction: column; align-items: center; gap: 0.9rem; }
.stack { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 0.6rem; }

.current-name { width: 100%; padding: 0.55rem 0.7rem; border-radius: 12px; border: 1px solid rgba(42,49,66,0.9); background: rgba(15,17,21,0.35); display: flex; justify-content: center; align-items: baseline; gap: 0.45rem; }
.current-name-label { color: #cbd3e6; font-weight: 800; }
.current-name-value { color: #f5f7ff; font-weight: 900; }

.back-btn { width: 100%; margin-top: -0.1rem; margin-bottom: 0.4rem; display: flex; justify-content: center; }

input { padding: 0.6rem 0.75rem; width: 320px; max-width: 82vw; border-radius: 10px; border: 1px solid #2a3142; background: #0f1115; color: #f5f7ff; }
input::placeholder { color: #9aa3b2; }

.label { color: #cbd3e6; font-weight: 700; }

.btn { padding: 0.65rem 1rem; border-radius: 10px; border: 1px solid #2a3142; background: #2b68ff; color: #fff; font-weight: 700; cursor: pointer; }
.btn-ghost { background: transparent; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }

.divider { width: 100%; height: 1px; background: #2a3142; margin: 0.75rem 0; }

/* Check rows */
.check-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: #cbd3e6;
  font-weight: 800;
  width: 320px;
  max-width: 82vw;
  justify-content: flex-start;
}
.check-row input {
  width: auto;
  max-width: none;
  accent-color: #2b68ff;
}

/* Public rooms list */
.public-rooms { width: 100%; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #2a3142; }
.public-rooms-title { width: 100%; text-align: left; color: #cbd3e6; font-weight: 900; margin-bottom: 0.5rem; }
.public-empty { width: 100%; text-align: left; color: #9aa3b2; font-weight: 700; padding: 0.5rem 0.2rem; }
.public-list { list-style: none; padding: 0; margin: 0; width: 100%; display: flex; flex-direction: column; gap: 0.45rem; }
.public-item { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; padding: 0.55rem 0.7rem; border-radius: 10px; border: 1px solid rgba(42,49,66,0.9); background: rgba(15,17,21,0.35); cursor: pointer; }
.public-item:hover { background: rgba(255,255,255,0.06); }
.public-room-id { font-weight: 900; color: #f5f7ff; }
.public-users { font-weight: 800; color: #cbd3e6; }

/* PANELS */
.panel { position: fixed; top: 1rem; width: 240px; padding: 1rem; z-index: 1000; }
.panel-left { left: 1rem; }
.panel-right { right: 1rem; }

.spectator-row { margin: 0.4rem 0 0.6rem; display: flex; align-items: center; gap: 0.55rem; color: #cbd3e6; font-weight: 800; }
.spectator-row input { width: auto; max-width: none; accent-color: #2b68ff; }

/* Participants panel */
.panel-title { margin: 0; font-size: 1.05rem; font-weight: 900; color: #f5f7ff; }
.panel-list { list-style: none; padding: 0; margin: 0.75rem 0 0; display: flex; flex-direction: column; gap: 0.45rem; }
.panel-list-item { display: flex; align-items: center; gap: 0.55rem; padding: 0.35rem 0.45rem; border-radius: 10px; border: 1px solid rgba(42,49,66,0.8); background: rgba(15,17,21,0.35); }
.dot { width: 8px; height: 8px; border-radius: 999px; background: rgba(43,104,255,0.9); box-shadow: 0 0 0 3px rgba(43,104,255,0.15); flex: 0 0 auto; }
.dot.spect { background: rgba(148,163,184,0.95); box-shadow: 0 0 0 3px rgba(148,163,184,0.18); }
.panel-name { font-weight: 800; color: #f5f7ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }

.badge {
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  border: 1px solid rgba(42,49,66,0.9);
  background: rgba(148,163,184,0.12);
  color: #cbd3e6;
  flex: 0 0 auto;
}
.badge-cheater {
  border-color: rgba(239,68,68,0.55);
  background: rgba(239,68,68,0.14);
  color: #fecaca;
}

/* MIDDLE */
.middle { margin: 170px auto 0; width: clamp(620px, 40vw, 980px); display: flex; flex-direction: column; align-items: center; gap: 1rem; }

/* STATUS */
.status { width: 100%; padding: 1rem; }
.status-row { display: flex; justify-content: space-between; margin-bottom: 0.75rem; }
.status-title, .status-count { font-weight: 900; }
.status-count { color: #cbd3e6; }
.status-subtitle { font-weight: 800; color: #cbd3e6; margin-bottom: 0.4rem; }
.status-empty { font-weight: 700; color: #cbd3e6; }
.status-ok { color: #a7f3d0; }
.status-hint { margin-top: 0.8rem; color: #9aa3b2; font-weight: 700; }

/* CHIPS */
.chips { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.chip { padding: 0.25rem 0.6rem; border-radius: 999px; border: 1px solid #2a3142; font-weight: 700; }
.chip-voted { background: rgba(34,197,94,0.15); color: #bbf7d0; }
.chip-waiting { background: rgba(239,68,68,0.15); color: #fecaca; }

/* VOTING */
.cards { display: flex; gap: 0.85rem; flex-wrap: wrap; justify-content: center; }
.card-btn { min-width: 72px; padding: 0.85rem 1.05rem; border-radius: 12px; border: 1px solid #2a3142; background: #161a22; color: #fff; font-weight: 900; cursor: pointer; }
.card-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.card-btn.selected { border-color: #2b68ff; box-shadow: 0 0 0 3px rgba(43,104,255,0.25); }
.buttons { display: flex; gap: 0.75rem; }

/* Votes list */
.votes-card { width: 100%; padding: 1rem; }
.vote-list { list-style: none; padding: 0; margin: 0.75rem 0 0; display: flex; flex-direction: column; gap: 0.45rem; }
.vote-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.5rem 0.7rem; border-radius: 10px; border: 1px solid rgba(42,49,66,0.9); background: rgba(15,17,21,0.35); }
.vote-name { font-weight: 800; color: #f5f7ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.5rem; }
.inline-cheater {
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  padding: 0.16rem 0.45rem;
  border-radius: 999px;
  border: 1px solid rgba(239,68,68,0.55);
  background: rgba(239,68,68,0.14);
  color: #fecaca;
}
.vote-value { font-weight: 900; color: #f5f7ff; padding: 0.15rem 0.55rem; border-radius: 999px; border: 1px solid rgba(42,49,66,0.9); background: rgba(22,26,34,0.8); flex: 0 0 auto; }

/* Ø average aligned left */
.avg-left { margin-top: 0.9rem; padding-top: 0.75rem; border-top: 1px solid #2a3142; width: 100%; display: flex; justify-content: flex-start; align-items: baseline; gap: 0.6rem; }
.avg-symbol { font-weight: 900; color: #cbd3e6; }
.avg-number { font-weight: 900; color: #f5f7ff; }

/* -------------------- */
/* NEW: Room ID copy row */
/* -------------------- */
.room-id-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.room-id-label,
.room-id-value {
  margin: 0;
}

.room-id-value {
  font-weight: 900;
  color: #f5f7ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.copy-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(42,49,66,0.9);
  background: rgba(15,17,21,0.35);
  color: #cbd3e6;
  cursor: pointer;
}

.copy-btn:hover {
  background: rgba(255,255,255,0.06);
  color: #f5f7ff;
}

/* RESPONSIVE */
@media (max-width: 1100px) {
  .panel { position: static; width: min(92vw, 980px); margin: 0.5rem auto; }
  .middle { margin-top: 1rem; width: min(92vw, 980px); }
}
</style>
