<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
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

// Room settings
const autoReveal = ref(false)
const tShirtMode = ref(false)

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
// LocalStorage
// --------------------
const NAME_STORAGE_KEY = 'planning_poker_name'
const SPECTATOR_STORAGE_KEY = 'planning_poker_spectator'
const AUTO_REVEAL_STORAGE_KEY = 'planning_poker_auto_reveal'
const TSHIRT_MODE_STORAGE_KEY = 'planning_poker_tshirt_mode'

// Gold
const GOLD_STORAGE_KEY = 'planning_poker_gold'
const LAST_GOLD_ROUND_KEY = 'planning_poker_gold_last_round'
const gold = ref<number>(0)

// pending gold for THIS client (received from server, applied when modal closes)
const pendingGold = ref<number>(0)
const pendingGoldRound = ref<number | null>(null)

// floating +X animation
const goldFloatAmount = ref<number>(0)
const showGoldFloat = ref(false)
let goldFloatTimer: number | null = null

function triggerGoldFloat(amount: number) {
  if (amount <= 0) return
  goldFloatAmount.value = amount
  showGoldFloat.value = true
  if (goldFloatTimer) window.clearTimeout(goldFloatTimer)
  goldFloatTimer = window.setTimeout(() => {
    showGoldFloat.value = false
    goldFloatAmount.value = 0
    goldFloatTimer = null
  }, 1200)
}

// --------------------
// URL helpers
// --------------------
const pendingRoomFromUrl = ref<string | null>(null)
const pendingVisibilityFromUrl = ref<'private' | 'public' | null>(null)

function getRoomIdFromUrl(): string | null {
  const path = window.location.pathname || '/'
  const match = path.match(/^\/room\/([^/]+)\/?$/)
  if (!match || !match[1]) return null
  return decodeURIComponent(match[1])
}

function getVisibilityFromUrl(): 'private' | 'public' | null {
  try {
    const sp = new URLSearchParams(window.location.search)
    const priv = sp.get('private')
    const pub = sp.get('public')

    const isTrue = (v: string | null) => v === 'true' || v === '1' || v === 'yes'

    if (isTrue(priv)) return 'private'
    if (isTrue(pub)) return 'public'
    return null
  } catch {
    return null
  }
}

function setUrlToRoom(id: string, visibility: 'private' | 'public' | null) {
  const base = `/room/${encodeURIComponent(id)}`
  const next =
    visibility === 'private' ? `${base}?private=true`
    : visibility === 'public' ? `${base}?public=true`
    : base

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
  if (pendingVisibilityFromUrl.value === 'private') return `${base}?private=true`
  if (pendingVisibilityFromUrl.value === 'public') return `${base}?public=true`
  return base
}

function applySpectatorToRoom() {
  if (!roomId.value) return
  if (isSpectator.value) selectedCard.value = null
  socket.emit("set-spectator", { roomId: roomId.value, spectator: isSpectator.value })
}

function loadGoldFromStorage() {
  try {
    const saved = window.localStorage.getItem(GOLD_STORAGE_KEY)
    if (saved !== null) {
      const n = Number(saved)
      gold.value = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
    }
  } catch {}
}

function saveGoldToStorage() {
  try { window.localStorage.setItem(GOLD_STORAGE_KEY, String(gold.value)) } catch {}
}

function getLastAppliedRound(): number {
  try {
    const v = window.localStorage.getItem(LAST_GOLD_ROUND_KEY)
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function setLastAppliedRound(roundKey: number) {
  try { window.localStorage.setItem(LAST_GOLD_ROUND_KEY, String(roundKey)) } catch {}
}

function applyPendingGoldIfAny() {
  if (pendingGold.value <= 0) return
  if (pendingGoldRound.value === null) return

  // tiny safety: do not apply same round twice (in this tab / after refresh)
  const last = getLastAppliedRound()
  if (pendingGoldRound.value <= last) {
    pendingGold.value = 0
    pendingGoldRound.value = null
    return
  }

  gold.value += pendingGold.value
  saveGoldToStorage()
  setLastAppliedRound(pendingGoldRound.value)

  triggerGoldFloat(pendingGold.value)

  pendingGold.value = 0
  pendingGoldRound.value = null
}

onMounted(() => {
  try {
    const saved = window.localStorage.getItem(NAME_STORAGE_KEY)
    if (saved && !userName.value) userName.value = saved
  } catch {}

  try {
    const savedSpect = window.localStorage.getItem(SPECTATOR_STORAGE_KEY)
    if (savedSpect !== null) isSpectator.value = savedSpect === 'true'
  } catch {}

  try {
    const savedAuto = window.localStorage.getItem(AUTO_REVEAL_STORAGE_KEY)
    if (savedAuto !== null) autoReveal.value = savedAuto === 'true'
  } catch {}

  try {
    const savedTs = window.localStorage.getItem(TSHIRT_MODE_STORAGE_KEY)
    if (savedTs !== null) tShirtMode.value = savedTs === 'true'
  } catch {}

  loadGoldFromStorage()

  const rid = getRoomIdFromUrl()
  pendingVisibilityFromUrl.value = getVisibilityFromUrl()

  if (rid) {
    pendingRoomFromUrl.value = rid
    roomId.value = rid
  }

  window.addEventListener('popstate', () => {
    const newRid = getRoomIdFromUrl()
    pendingRoomFromUrl.value = newRid
    pendingVisibilityFromUrl.value = getVisibilityFromUrl()
    if (newRid) roomId.value = newRid
  })
})

watch(isSpectator, (val) => {
  try {
    window.localStorage.setItem(SPECTATOR_STORAGE_KEY, String(!!val))
  } catch {}
})

watch(autoReveal, (val) => {
  try {
    window.localStorage.setItem(AUTO_REVEAL_STORAGE_KEY, String(!!val))
  } catch {}
})

watch(tShirtMode, (val) => {
  try {
    window.localStorage.setItem(TSHIRT_MODE_STORAGE_KEY, String(!!val))
  } catch {}
})

// Clear inline errors when user edits inputs again
watch(userName, () => { nameError.value = null; serverError.value = null })
watch(newRoomCode, () => { createRoomError.value = null; serverError.value = null })
watch(roomId, () => { joinRoomError.value = null; serverError.value = null })
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

const everyoneIsSpectator = computed(() => activeParticipants.value.length === 0)

const cardOptions = computed(() => {
  return tShirtMode.value
    ? ['XS', 'S', 'M', 'L', 'XL', '?']
    : ['0', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?']
})

function valueToNumber(v: string): number {
  const map: Record<string, number> = { XS: 1, S: 2, M: 3, L: 4, XL: 5 }
  if (map[v] !== undefined) return map[v]
  const n = Number(v)
  return Number.isFinite(n) ? n : Number.NaN
}

/**
 * Modal display order: LOW → HIGH left-to-right
 */
const votesForModal = computed(() => {
  const vmap = activeVotesMap.value
  const entries = Object.entries(vmap).map(([id, value]) => {
    const name = participants.value.find(p => p.id === id)?.name || id
    const num = valueToNumber(value)
    const isNumeric = Number.isFinite(num)
    const isCheater = !!cheaters.value[id]
    return { id, name, value, isNumeric, num, isCheater }
  })

  entries.sort((a, b) => {
    if (a.isNumeric && b.isNumeric) return a.num - b.num
    if (a.isNumeric && !b.isNumeric) return -1
    if (!a.isNumeric && b.isNumeric) return 1
    return String(a.value).localeCompare(String(b.value))
  })

  return entries
})

const averageInfo = computed(() => {
  const nums = Object.values(activeVotesMap.value || {})
    .map(valueToNumber)
    .filter(n => Number.isFinite(n))

  if (nums.length === 0) return { avgText: 'N/A', count: 0 }

  const sum = nums.reduce((acc, n) => acc + n, 0)
  const avg = sum / nums.length
  const avgText = Number.isInteger(avg) ? String(avg) : avg.toFixed(2)

  return { avgText, count: nums.length }
})

// --------------------
// Celebration logic (confetti only)
// --------------------
const celebrationActive = ref(false)
let celebrationTimer: number | null = null

function clearCelebration() {
  celebrationActive.value = false
  if (celebrationTimer) window.clearTimeout(celebrationTimer)
  celebrationTimer = null
}

function triggerCelebration() {
  if (celebrationActive.value) return
  celebrationActive.value = true
  celebrationTimer = window.setTimeout(() => {
    celebrationActive.value = false
    celebrationTimer = null
  }, 1800)
}

const allVotesSame = computed(() => {
  const values = votesForModal.value.map(e => e.value)
  if (values.length === 0) return false
  return values.every(v => v === values[0])
})

function areAllFlippedNow(): boolean {
  const ids = votesForModal.value.map(e => e.id)
  if (ids.length === 0) return false
  return ids.every(id => !!flippedMap.value[id])
}

function shouldCelebrateNow(): boolean {
  return votesForModal.value.length >= 2 && allVotesSame.value
}

const confettiColors = [
  '#facc15', // yellow
  '#fb7185', // pink
  '#fb923c', // orange
  '#60a5fa', // blue
  '#a78bfa', // purple
  '#f472b6', // pink (alt)
  '#34d399', // green
  '#f87171'  // red
]

const confettiPieces = Array.from({ length: 34 }, (_, i) => ({
  id: i,
  left: (i * 7) % 100,
  delay: (i % 10) * 0.05,
  dur: 0.9 + (i % 7) * 0.14,
  rot: (i * 37) % 360,
  color: confettiColors[i % confettiColors.length]
}))

// --------------------
// Votes flip animation (modal)
// --------------------
const flippedMap = ref<Record<string, boolean>>({})
let flipTimers: number[] = []

function clearFlipTimers() {
  for (const t of flipTimers) window.clearTimeout(t)
  flipTimers = []
}

function startFlipSequence() {
  clearFlipTimers()
  clearCelebration()

  const next: Record<string, boolean> = {}
  for (const e of votesForModal.value) next[e.id] = false
  flippedMap.value = next

  for (const e of votesForModal.value) {
    const delay = Math.floor(Math.random() * 2001)
    const timer = window.setTimeout(() => {
      flippedMap.value = { ...flippedMap.value, [e.id]: true }

      if (areAllFlippedNow() && shouldCelebrateNow()) {
        triggerCelebration()
      }
    }, delay)
    flipTimers.push(timer)
  }
}

onBeforeUnmount(() => {
  clearFlipTimers()
  clearCelebration()
  if (goldFloatTimer) window.clearTimeout(goldFloatTimer)
})

watch(showVotesModal, (open) => {
  if (open) startFlipSequence()
  else {
    clearFlipTimers()
    clearCelebration()
  }
})

// --------------------
// Socket events
// --------------------
socket.on("room-created", (id: string) => {
  roomId.value = id
  step.value = 3

  pendingVisibilityFromUrl.value = isPrivate.value ? 'private' : null
  setUrlToRoom(id, pendingVisibilityFromUrl.value)

  applySpectatorToRoom()
})

socket.on("users-updated", (users: any[]) => {
  participants.value = users
  const me = participants.value.find(p => p.id === socket.id)
  if (me && typeof me.spectator === 'boolean') {
    isSpectator.value = !!me.spectator
  }
})

socket.on("votes-updated", (v) => { votes.value = v })

socket.on("revealed", () => {
  revealed.value = true
  showVotesModal.value = true

  // new reveal → clear any leftover pending
  pendingGold.value = 0
  pendingGoldRound.value = null
})

socket.on("reset", () => {
  votes.value = {}
  revealed.value = false
  selectedCard.value = null
  cheaters.value = {}
  showVotesModal.value = false
  flippedMap.value = {}
  clearFlipTimers()
  clearCelebration()

  pendingGold.value = 0
  pendingGoldRound.value = null
})

socket.on("public-rooms-updated", (rooms: PublicRoom[]) => {
  publicRooms.value = Array.isArray(rooms) ? rooms : []
})

socket.on("cheaters-updated", (c: Record<string, boolean>) => {
  cheaters.value = c || {}
})

socket.on("room-settings-updated", (settings: { autoReveal?: boolean; tShirtMode?: boolean }) => {
  if (typeof settings?.autoReveal === 'boolean') autoReveal.value = settings.autoReveal
  if (typeof settings?.tShirtMode === 'boolean') tShirtMode.value = settings.tShirtMode
})

// NEW: server broadcasts gold awards once; each client stores their own pending
socket.on("gold-awarded", (payload: { roundKey: number; awards: Record<string, number> }) => {
  const roundKey = Number(payload?.roundKey || 0)
  const awards = payload?.awards || {}

  const my = awards[socket.id] || 0
  if (my > 0 && roundKey > 0) {
    pendingGold.value = my
    pendingGoldRound.value = roundKey

    // If modal is already closed (edge case), apply immediately
    if (!showVotesModal.value) {
      applyPendingGoldIfAny()
    }
  }
})

socket.on("error", (msg: string) => {
  const text = String(msg || 'Unknown error')

  if (step.value === 1) { nameError.value = text; return }
  if (/room code already exists/i.test(text)) { createRoomError.value = text; return }
  if (/room not found/i.test(text)) { joinRoomError.value = text; return }

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
  if (!trimmed) { nameError.value = "Please enter your name"; return }

  try { window.localStorage.setItem(NAME_STORAGE_KEY, trimmed) } catch {}

  if (pendingRoomFromUrl.value) {
    const id = pendingRoomFromUrl.value.trim()
    roomId.value = id

    socket.emit("join-or-create-room", {
      roomId: id,
      name: trimmed,
      autoReveal: autoReveal.value,
      tShirtMode: tShirtMode.value,
      isPrivate: pendingVisibilityFromUrl.value === 'private',
      isPublic: pendingVisibilityFromUrl.value === 'public'
    })

    step.value = 3
    setUrlToRoom(id, pendingVisibilityFromUrl.value)

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
  pendingVisibilityFromUrl.value = null
  setUrlHome()
}

const createRoom = () => {
  const code = newRoomCode.value.trim()
  if (!code) { createRoomError.value = "Enter a room code"; return }

  socket.emit("create-room", {
    roomCode: code,
    name: userName.value.trim(),
    isPrivate: isPrivate.value,
    autoReveal: autoReveal.value,
    tShirtMode: tShirtMode.value
  })
}

const joinRoom = (idOverride?: string) => {
  const id = (idOverride ?? roomId.value).trim()
  if (!id) { joinRoomError.value = "Enter room code"; return }

  roomId.value = id
  socket.emit("join-room", { roomId: id, name: userName.value.trim() })
  step.value = 3
  pendingRoomFromUrl.value = id

  pendingVisibilityFromUrl.value = null
  setUrlToRoom(id, null)

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

const setTShirtMode = () => {
  if (!roomId.value) return
  selectedCard.value = null
  showVotesModal.value = false
  socket.emit("set-tshirt-mode", { roomId: roomId.value, tShirtMode: tShirtMode.value })
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
  // 1) Tell server "someone closed" -> server will compute+broadcast ONCE
  socket.emit("votes-modal-closed", { roomId: roomId.value })

  // 2) Close for THIS client
  showVotesModal.value = false

  // 3) Apply pending gold now (if we already received it)
  applyPendingGoldIfAny()

  // 4) Reset round
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
  pendingVisibilityFromUrl.value = null
  flippedMap.value = {}
  clearFlipTimers()
  clearCelebration()
  pendingGold.value = 0
  pendingGoldRound.value = null
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

    <!-- GOLD HUD (always bottom-right) -->
    <div class="gold-hud" aria-label="Gold">
      <div v-if="showGoldFloat" class="gold-float">+{{ goldFloatAmount }}</div>
      <div class="gold-text">
        <span class="gold-label">Gold</span>
        <span class="gold-value">{{ gold }}</span>
      </div>
    </div>

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

            <!-- T-Shirt mode -->
            <label class="spectator-row">
              <input type="checkbox" v-model="tShirtMode" @change="setTShirtMode" />
              <span>T-Shirt mode</span>
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

                <div class="status-body">
                  <div v-if="voted.length === 0" class="status-empty">No votes yet</div>
                  <div v-else class="chips">
                    <span v-for="p in voted" :key="p.id" class="chip chip-voted">{{ p.name }}</span>
                  </div>
                </div>
              </div>

              <div class="status-section">
                <div class="status-subtitle">Waiting for</div>

                <div class="status-body">
                  <div v-if="everyoneIsSpectator" class="status-empty status-hint">
                    Everyone is a spectator (no votes will be counted).
                  </div>

                  <div v-else-if="notVoted.length === 0" class="status-empty status-ok">
                    Everyone voted
                  </div>

                  <div v-else class="chips">
                    <span v-for="p in notVoted" :key="p.id" class="chip chip-waiting">{{ p.name }}</span>
                  </div>
                </div>
              </div>
            </div>

            <h2 class="section-title">Pick a card</h2>

            <div class="cards">
              <button
                v-for="c in cardOptions"
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
              <!-- Confetti overlay only -->
              <div v-if="celebrationActive" class="celebration" aria-hidden="true">
                <div class="confetti">
                  <span
                    v-for="p in confettiPieces"
                    :key="p.id"
                    class="confetti-piece"
                    :style="{
                      left: p.left + '%',
                      animationDelay: p.delay + 's',
                      animationDuration: p.dur + 's',
                      transform: `rotate(${p.rot}deg)`,
                      backgroundColor: p.color
                    }"
                  />
                </div>
              </div>

              <div class="modal">
                <div class="card votes-card">
                  <div class="modal-header">
                    <h3 class="modal-title">Votes</h3>
                  </div>

                  <!-- Cards centered -->
                  <div class="vote-cards" aria-label="Votes revealed">
                    <div
                      v-for="entry in votesForModal"
                      :key="entry.id"
                      class="vote-card-wrap"
                    >
                      <div class="vote-card-3d">
                        <div class="vote-card-inner" :class="{ flipped: !!flippedMap[entry.id] }">
                          <div class="vote-card-face vote-card-back" aria-hidden="true"></div>
                          <div class="vote-card-face vote-card-front">
                            <div class="vote-card-value">{{ entry.value }}</div>
                          </div>
                        </div>
                      </div>

                      <div class="vote-card-name">
                        <span class="vote-card-name-text">{{ entry.name }}</span>
                        <span v-if="entry.isCheater" class="inline-cheater">CHEATER</span>
                      </div>
                    </div>
                  </div>

                  <div class="avg-center">
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
