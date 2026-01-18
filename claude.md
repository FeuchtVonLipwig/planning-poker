# Planning Poker Web Application

A real-time collaborative planning poker application for agile teams to vote on story point estimates.

## Tech Stack

- **Frontend**: Vue 3 (Composition API with `<script setup>`), TypeScript, Vite
- **Backend**: Express.js, Socket.IO
- **Styling**: Custom CSS (dark theme, no framework)
- **Real-time**: Socket.IO (WebSocket with polling fallback)

## Project Structure

```
planning-poker/
├── frontend/                 # Vue 3 SPA
│   ├── src/
│   │   ├── App.vue          # Main component (contains all UI logic and state)
│   │   ├── socket.ts        # Socket.IO client configuration
│   │   ├── style.css        # Global styles (dark theme, animations)
│   │   ├── router/index.ts  # Vue Router configuration
│   │   └── views/           # Page components
│   ├── vite.config.ts       # Vite build configuration
│   └── package.json
├── backend/
│   ├── server.js            # Express + Socket.IO server (room management, voting)
│   └── package.json
└── package.json             # Root scripts for build/start
```

## Commands

```bash
# Development (run in separate terminals)
cd frontend && npm install && npm run dev    # Frontend at http://localhost:5173
cd backend && npm install && npm run dev     # Backend at http://localhost:3000

# Production (from root)
npm run build    # Build frontend
npm run start    # Serve at http://localhost:3000
```

## Architecture

### Application Flow (3 Steps)

1. **Name Entry** (Step 1): User enters name, stored in localStorage
2. **Session Selection** (Step 2): Create/join room, configure settings, browse public rooms
3. **Voting Session** (Step 3): Card selection, reveal/reset, participant management

### State Management

All state lives in `App.vue` using Vue 3 `ref()`:
- Core: `step`, `roomId`, `userName`, `participants`, `selectedCard`, `votes`, `revealed`
- Settings: `autoReveal`, `tShirtMode`, `isSpectator`
- UI: `showVotesModal`, `celebrationActive`, `flippedMap`, `cheaters`

### LocalStorage Persistence

- `userName` - User's display name
- `isSpectator` - Spectator mode preference
- `autoReveal` - Auto-reveal setting
- `tShirtMode` - T-shirt size mode preference

### Socket Events

**Client → Server:**
- `create-room`, `join-room`, `join-or-create-room` - Room management
- `vote`, `reveal`, `reset` - Voting actions
- `set-spectator`, `set-auto-reveal`, `set-tshirt-mode` - Settings
- `leave-room`, `get-public-rooms`

**Server → Client:**
- `room-created`, `users-updated`, `votes-updated` - State sync
- `revealed`, `reset`, `room-settings-updated` - Actions
- `cheaters-updated`, `public-rooms-updated`, `error`

### Backend Room Structure (server.js)

```javascript
rooms[roomId] = {
  users: [{id, name, spectator}],
  votes: {[userId]: value},
  revealed: boolean,
  public: boolean,
  autoReveal: boolean,
  tShirtMode: boolean,
  cheaters: {[userId]: true}
}
```

## Key Features

### Voting
- **Card Values**: Fibonacci (0, 1, 2, 3, 5, 8, 13, 21, ?) or T-Shirt (XS, S, M, L, XL, ?)
- **Auto-reveal**: Automatically reveals when all non-spectators have voted
- **Cheater Detection**: Marks users who vote after reveal (shown with badge)

### Rooms
- **Public/Private**: Public rooms appear in browsable list
- **URL Joining**: `/room/[roomId]?private=true` or `?public=true`
- **Room Settings**: Auto-reveal and T-shirt mode are room-wide settings

### User Settings
- **Spectator Mode**: Excluded from vote counts and auto-reveal logic
- **Name**: Persisted across sessions

### UI/UX
- **3D Card Flip**: Sequential flip animation with random delays on reveal
- **Confetti**: Triggers when all participants vote the same value
- **Responsive**: Desktop (side panels) / Mobile (stacked layout) at 1100px breakpoint

## Styling

- **Theme**: Dark (`#0f1115` background)
- **Accent**: Blue (`#2b68ff`)
- **Animations**: Card hover lift, 3D flip, confetti falling (all CSS)

## Important Implementation Details

1. **Spectators** are filtered from active participant counts and auto-reveal logic
2. **T-shirt values** (XS-XL) convert to numbers (1-5) for average calculation
3. **Average** excludes "?" cards and non-numeric values
4. **Modal vote order**: Numeric ascending, then alphabetical
5. **Cache strategy**: Assets cached forever, index.html never cached
6. **Switching T-shirt mode** resets all votes to prevent scale mixing

## URL Routing

- `/` - Home (Step 1: name entry)
- `/room/[roomId]` - Direct room join (auto-creates if not exists)
- Query params: `?private=true` or `?public=true` for room visibility
