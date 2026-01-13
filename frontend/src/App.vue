<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
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
const showVotesModal = ref(false)

const isSpectator = ref(false)

// Rooms
const isPrivate = ref(false) // default = PUBLIC
type PublicRoom = { roomId: string; users: number }
const publicRooms = ref<PublicRoom[]>([])

// Room setting (auto reveal)
const autoReveal = ref(false)

// Cheaters (current reveal round)
const cheaters = ref<Record<string, boolean>>({})

// Copy feedback
const copied = ref(false)
const copiedWhat = ref<'id' | 'url' | null>(null)
let copiedTimer: number | null = null

// --------------------
// Inline Errors
// --------------------
const nameError = ref<string | null>(null)
const createRoomError = ref<string | null>(null)
const joinRoomError = ref<string | null>(null)
const serverError = ref<string | null>(null)

// --------------------
// LocalStorage (remember name + spectator + auto-reveal preference)
// --------------------
const NAME_STORAGE_KEY = 'planning_poker_name'
const SPECTATOR_STORAGE_KEY = 'planning_poker_spectator'
const AUTO_REVEAL_STORAGE_KEY = 'planning_poker_auto_reveal'

// --------------------
// URL helpers
// --------------------
const pendingRoomFromUrl = ref<string | null>(null)
const pendingPrivateFromUrl = ref(false)

function getRoomIdFromUrl(): string | null {
  const path = window.location.pathname || '/'
  const match = path.match(/^\/room\/([^/]+)\/?$/)
  if (!match || !match[1]) return null
  return decodeURIComponent(match[1])
}

// supports: ?Prive=true, ?prive=true, ?private=true
function getIsPrivateFromUrl(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search)
    const v =
      sp.get('Prive') ??
      sp.get('prive') ??
      sp.get('private')
    if (v === null) return false
    return v === 'true' || v === '1' || v === 'yes'
  } catch {
    return false
  }
}

function setUrlToRoom(id: string, makePrivate: boolean) {
  const base = `/room/${encodeURIComponent(id)}`
  const next = makePrivate ? `${base}?Prive=true` : base
  const current = `${window.location.pathname}${window.location.search || ''}`

  if (current !== next) {
    window.history.pushState({}, '', next)
  }
}

function setUrlHome() {
  if (window.location.pathname !== '/' || window.location.search) {
    window.history.pushState({}, '', '/')
  }
}

function currentRoomUrl(): string {
  const base = `${window.location.origin}/room/${encodeURIComponent(roomId.value)}`
  return pendingPrivateFromUrl.value ? `${base}?Prive=true` : base
}

/**
 * Apply the locally stored spectator preference to the current room.
 * Safe to call any time after roomId is set and we're in step 3.
 */
function applySpectatorToRoom() {
  if (!roomId.value) return
  if (isSpectator.value) selectedCard.value = null
  socket.emit("set-spectator", { roomId: roomId.value, spectator: isSpectator.value })
}

onMounted(() => {
  // restore name
  try {
    const saved = window.localStorage.getItem(NAME_STORAGE_KEY)
    if (saved && !userName.value) userName.value = saved
  } catch {
    // ignore
  }

  // restore spectator preference
  try {
    const savedSpect = window.localStorage.getItem(SPECTATOR_STORAGE_KEY)
    if (savedSpect !== null) {
      isSpectator.value = savedSpect === 'true'
    }
  } catch {
    // ignore
  }

  // restore auto-reveal preference (default for NEW rooms)
  try {
    const savedAuto = window.localStorage.getItem(AUTO_REVEAL_STORAGE_KEY)
    if (savedAuto !== null) {
      autoReveal.value = savedAuto === 'true'
    }
  } catch {
    // ignore
  }

  // URL room detection (+ private param)
  const rid = getRoomIdFromUrl()
  pendingPrivateFromUrl.value = getIsPrivateFromUrl()

  if (rid) {
    pendingRoomFromUrl.value = rid
    roomId.value = rid
  }

  // Handle back/forward navigation
  window.addEventListener('popstate', () => {
    const newRid = getRoomIdFromUrl()
    pendingRoomFromUrl.value = newRid
    pendingPrivateFromUrl.value = getIsPrivateFromUrl()
    if (newRid) roomId.value = newRid
  })
})

// Persist spectator preference whenever the checkbox changes
watch(isSpectator, (val) => {
  try {
    window.localStorage.setItem(SPECTATOR_STORAGE_KEY, String(!!val))
  } catch {
    // ignore
  }
})

// Persist auto-reveal preference (this is the user's default for creating rooms)
watch(autoReveal, (val) => {
  try {
    window.localStorage.setItem(AUTO_REVEAL_STORAGE_KEY, String(!!val))
  } catch {
    // ignore
  }
})

// Clear inline errors when user edits inputs again
watch(userName, () => {
  nameError.value = null
  serverError.value = null
})
watch(newRoomCode, () => {
  createRoomError.value = null
  serverError.value = null
})
watch(roomId, () => {
  joinRoomError.value = null
  serverError.value = null
})
watch(step, () => {
  nameError.value = null
  createRoomError.value = null
  joinRoomError.value = null
  serverError.value = null
})

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

const hasAnyVote = computed(() => Object.keys(activeVotesMap.value || {}).length > 0)
const canReveal = computed(() => hasAnyVote.value && revealed.value === false)
const canReset = computed(() => hasAnyVote.value)

// helper for “everyone is spectator” case
const everyoneIsSpectator = computed(() => activeParticipants.value.length === 0)

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

  // If user created a private room, include ?Prive=true in the URL
  // Also store this so copyUrl() includes it.
  pendingPrivateFromUrl.value = !!isPrivate.value
  setUrlToRoom(id, pendingPrivateFromUrl.value)

  applySpectatorToRoom()
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
  showVotesModal.value = true
})

socket.on("reset", () => {
  votes.value = {}
  revealed.value = false
  selectedCard.value = null
  cheaters.value = {}
  showVotesModal.value = false
})

socket.on("public-rooms-updated", (rooms: PublicRoom[]) => {
  publicRooms.value = Array.isArray(rooms) ? rooms : []
})

socket.on("cheaters-updated", (c: Record<string, boolean>) => {
  cheaters.value = c || {}
})

socket.on("room-settings-updated", (settings: { autoReveal?: boolean }) => {
  if (typeof settings?.autoReveal === 'boolean') {
    autoReveal.value = settings.autoReveal
  }
})

// Replace browser alerts with inline errors
socket.on("error", (msg: string) => {
  const text = String(msg || 'Unknown error')

  if (step.value === 1) {
    nameError.value = text
    return
  }

  if (/room code already exists/i.test(text)) {
    createRoomError.value = text
    return
  }

  if (/room not found/i.test(text)) {
    joinRoomError.value = text
    return
  }

  serverError.value = text
})

watch(step, (s) => {
  if (s === 2) socket.emit("get-public-rooms")
})

// --------------------
// Actions
// --------------------
const acceptName = () => {
  const trimmed = userName.value.trim()
  if (!trimmed) {
    nameError.value = "Please enter your name"
    return
  }

  try {
    window.localStorage.setItem(NAME_STORAGE_KEY, trimmed)
  } catch {
    // ignore
  }

  // If URL has /room/<id>, go directly to room
  if (pendingRoomFromUrl.value) {
    const id = pendingRoomFromUrl.value.trim()
    roomId.value = id

    // IMPORTANT:
    // If the room doesn't exist yet, server should create it as private if URL param says so.
    socket.emit("join-or-create-room", {
      roomId: id,
      name: trimmed,
      autoReveal: autoReveal.value,
      isPrivate: pendingPrivateFromUrl.value
    })

    step.value = 3
    setUrlToRoom(id, pendingPrivateFromUrl.value)

    applySpectatorToRoom()
    return
  }

  step.value = 2
  socket.emit("get-public-rooms")
}

const backFromSessionToName = () => {
  roomId.value = ''
  newRoomCode.value = ''
  step.value = 1
  pendingRoomFromUrl.value = null
  pendingPrivateFromUrl.value = false
  setUrlHome()
}

const createRoom = () => {
  const code = newRoomCode.value.trim()
  if (!code) {
    createRoomError.value = "Enter a room code"
    return
  }
  socket.emit("create-room", {
    roomCode: code,
    name: userName.value.trim(),
    isPrivate: isPrivate.value,
    autoReveal: autoReveal.value
  })
}

const joinRoom = (idOverride?: string) => {
  const id = (idOverride ?? roomId.value).trim()
  if (!id) {
    joinRoomError.value = "Enter room code"
    return
  }

  roomId.value = id
  socket.emit("join-room", { roomId: id, name: userName.value.trim() })
  step.value = 3
  pendingRoomFromUrl.value = id

  // Joining by code should not force private mode.
  // (If you opened via bookmark URL, that flow uses acceptName() above.)
  pendingPrivateFromUrl.value = false
  setUrlToRoom(id, false)

  applySpectatorToRoom()
}

const setSpectator = () => {
  if (isSpectator.value) selectedCard.value = null
  socket.emit("set-spectator", { roomId: roomId.value, spectator: isSpectator.value })
}

const setAutoReveal = () => {
  if (!roomId.value) return
  socket.emit("set-auto-reveal", { roomId: roomId.value, autoReveal: autoReveal.value })
}

const voteCard = (value: string) => {
  if (isSpectator.value) return
  selectedCard.value = value
  socket.emit("vote", { roomId: roomId.value, value })
}

const revealVotes = () => {
  if (!canReveal.value) return
  socket.emit("reveal", roomId.value)
}

const closeVotesModal = () => {
  showVotesModal.value = false
  resetVotes()
}

const resetVotes = () => {
  if (!canReset.value) return
  socket.emit("reset", roomId.value)
  selectedCard.value = null
}

const closeSession = () => {
  const oldRoom = roomId.value
  if (oldRoom) socket.emit("leave-room", { roomId: oldRoom })

  step.value = 2
  roomId.value = ''
  participants.value = []
  votes.value = {}
  selectedCard.value = null
  revealed.value = false
  showVotesModal.value = false
  cheaters.value = {}
  pendingRoomFromUrl.value = null
  pendingPrivateFromUrl.value = false
  setUrlHome()
  socket.emit("get-public-rooms")
}

// --------------------
// Clipboard
// --------------------
function setCopied(which: 'id' | 'url') {
  copied.value = true
  copiedWhat.value = which
  if (copiedTimer) window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    copied.value = false
    copiedWhat.value = null
    copiedTimer = null
  }, 1200)
}

async function copyTextToClipboard(text: string, which: 'id' | 'url') {
  try {
    await navigator.clipboard.writeText(text)
    setCopied(which)
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(which)
    } catch {
      serverError.value = "Could not copy to clipboard."
    }
  }
}

const copyId = async () => {
  if (!roomId.value) return
  await copyTextToClipboard(roomId.value, 'id')
}

const copyUrl = async () => {
  if (!roomId.value) return
  await copyTextToClipboard(currentRoomUrl(), 'url')
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
              <div v-if="nameError" class="error-text">{{ nameError }}</div>

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

            <!-- Server error (general) -->
            <div v-if="serverError" class="error-banner">{{ serverError }}</div>

            <!-- Create -->
            <form class="stack" @submit.prevent="createRoom">
              <label class="label">Create a room</label>
              <input v-model="newRoomCode" placeholder="New room code" />
              <div v-if="createRoomError" class="error-text">{{ createRoomError }}</div>

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
              <div v-if="joinRoomError" class="error-text">{{ joinRoomError }}</div>

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
        <div v-if="step === 3" class="room-layout">
          <!-- LEFT PANEL -->
          <div class="panel panel-left">
            <div class="room-id-row">
              <p class="room-id-label"><strong>Room ID:</strong></p>
              <p class="room-id-value">{{ roomId }}</p>
            </div>

            <ul class="copy-links" aria-label="Copy options">
              <li>
                <button class="link-btn" type="button" @click="copyId">
                  <span v-if="copied && copiedWhat === 'id'">✓</span>
                  <span v-else>•</span>
                  Copy ID
                </button>
              </li>
              <li>
                <button class="link-btn" type="button" @click="copyUrl">
                  <span v-if="copied && copiedWhat === 'url'">✓</span>
                  <span v-else>•</span>
                  Copy URL
                </button>
              </li>
            </ul>

            <!-- Auto-reveal -->
            <label class="spectator-row">
              <input type="checkbox" v-model="autoReveal" @change="setAutoReveal" />
              <span>Auto-reveal</span>
            </label>

            <p><strong>You:</strong> {{ userName }}</p>

            <label class="spectator-row">
              <input type="checkbox" v-model="isSpectator" @change="setSpectator" />
              <span>Spectator</span>
            </label>

            <button class="btn btn-ghost" @click="closeSession" type="button">Leave Room</button>
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

                <div v-if="everyoneIsSpectator" class="status-empty status-hint">
                  <!-- intentionally blank; hint shown below -->
                </div>

                <div v-else-if="notVoted.length === 0" class="status-empty status-ok">
                  Everyone voted
                </div>

                <div v-else class="chips">
                  <span v-for="p in notVoted" :key="p.id" class="chip chip-waiting">{{ p.name }}</span>
                </div>
              </div>

              <div v-if="everyoneIsSpectator" class="status-hint">
                Everyone is a spectator (no votes will be counted).
              </div>
            </div>

            <h2 class="section-title">Pick a card</h2>

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
              <button class="btn" @click="revealVotes" type="button" :disabled="!canReveal">
                Reveal Votes
              </button>
              <button class="btn btn-ghost" @click="resetVotes" type="button" :disabled="!canReset">
                Reset
              </button>
            </div>

            <!-- MODAL: Votes -->
            <div v-if="showVotesModal" class="modal-backdrop" @click.self="closeVotesModal">
              <div class="modal">
                <div class="card votes-card">
                  <div class="modal-header">
                    <h3 class="modal-title">Votes</h3>
                  </div>

                  <ul class="vote-list">
                    <li v-for="entry in sortedVotes" :key="entry.id" class="vote-row">
                      <span class="vote-name">
                        {{ entry.name }}
                        <span v-if="entry.isCheater" class="inline-cheater">CHEATER</span>
                      </span>
                      <span class="vote-value">{{ entry.value }}</span>
                    </li>
                  </ul>

                  <div class="avg-right">
                    <span class="avg-symbol">Ø</span>
                    <span class="avg-number">{{ averageInfo.avgText }}</span>
                  </div>

                  <div class="modal-footer">
                    <button class="btn" type="button" @click="closeVotesModal">
                      Close
                    </button>
                  </div>

                </div>
              </div>
            </div>

          </main>
        </div>

      </div>
    </div>
  </div>
</template>
