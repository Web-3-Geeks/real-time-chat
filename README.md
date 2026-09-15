# Real-Time Chat App

A full-stack real-time chat application built incrementally as part of a Netixol internship project. Built with React (Vite + Tailwind CSS) on the frontend and Node.js/Express + Socket.io + MongoDB on the backend.

## Tech Stack

- **Frontend:** React (Vite), Tailwind CSS, React Router, Axios, Socket.io Client
- **Backend:** Node.js, Express.js, Socket.io
- **Database:** MongoDB (Atlas)
- **Auth:** JWT (jsonwebtoken) + bcryptjs for password hashing — used for both REST requests and Socket.io connection authentication
- **Deployment:** Frontend on Vercel, backend on Railway (a persistent Node process — required for Socket.io, since Vercel's serverless functions don't support long-lived WebSocket connections)

## Project Structure

This is a monorepo. The repo root always holds the current, complete app.

```
real-time-chat/
├── frontend/        # React app (Vite + Tailwind)
├── backend/         # Express API + Socket.io server
│   └── socket/      # Socket.io connection auth, rooms, message events
├── week3/           # Per-day snapshots for evaluation (Day1, Day2, ...)
└── postman-collection.json
```

## Setup & Run Locally

### Backend

```bash
cd backend
npm install
```

Create a `.env` file in `backend/` (see `.env.example`):

```
PORT=5000
MONGO_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_jwt_secret_key
FRONTEND_URL=http://localhost:5173
```

```bash
npm run dev
```

Backend runs on `http://localhost:5000` (REST API and Socket.io on the same server/port).

### Frontend

```bash
cd frontend
npm install
```

Create a `.env` file in `frontend/` (see `.env.example`):

```
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

```bash
npm run dev
```

Frontend runs on `http://localhost:5173`.

## API Endpoints

| Method | Endpoint | Auth required | Description |
|---|---|---|---|
| GET | `/api/health` | No | Health check |
| POST | `/api/auth/register` | No | Register a new user |
| POST | `/api/auth/login` | No | Log in and receive a JWT |
| GET | `/api/auth/me` | Yes | Get the authenticated user (session check) |
| GET | `/api/users` | Yes | List all other users (to start a conversation) |
| GET | `/api/users/me` | Yes | Get the authenticated user's profile |
| PATCH | `/api/users/me` | Yes | Update `name` and/or `avatar` |
| POST | `/api/conversations` | Yes | Find or create a private conversation with `recipientId` |
| GET | `/api/conversations` | Yes | List the authenticated user's conversations, with the other member and last message |
| GET | `/api/conversations/:conversationId/messages` | Yes | Get message history for a conversation (chronological, paginated via `limit`/`before`) |

Protected routes require an `Authorization: Bearer <token>` header.

## Socket.io Events

The Socket.io connection is authenticated using the same JWT as the REST API, passed via the handshake: `io(url, { auth: { token } })`.

| Event | Direction | Payload | Description |
|---|---|---|---|
| `join_conversation` | Client → Server | `conversationId`, ack callback | Verifies membership, joins the Socket.io room for that conversation |
| `leave_conversation` | Client → Server | `conversationId` | Leaves the room |
| `send_message` | Client → Server | `{ conversationId, content }`, ack callback | Validates membership + content, saves the message, broadcasts it to the room |
| `receive_message` | Server → Client | `{ id, conversationId, senderId, content, createdAt }` | Sent to every socket in the room (including the sender) when a new message arrives |

### Testing Socket.io / real-time messaging

1. Run the backend and frontend locally (or use the deployed URLs).
2. Register two different user accounts.
3. Open the app in two separate browser sessions (e.g., one normal window and one incognito window, or two different browsers) — one per user.
4. Log in as a different user in each, go to **Chats**, and select the other user from the list.
5. Send a message from one tab — it should appear in the other tab immediately, without a page refresh. Refreshing either tab should reload the same message history from the database.

The Postman collection (`postman-collection.json`) covers the REST auth/user endpoints; Socket.io events are tested via the UI as described above rather than through Postman.

## Week 3 — Day 1: Project Setup, Database Design & Authentication

**What was built:**

- Backend project structure separating `routes`, `controllers`, `models`, `middleware`, `config`, and `utils`.
- MongoDB connection via Mongoose, with environment variables for the DB connection string, JWT secret, and frontend URL.
- User registration with validation (required fields, email format, minimum password length), duplicate-email rejection, and bcrypt password hashing.
- Login with JWT generation on success.
- `protect` middleware that verifies the JWT and attaches the authenticated user to `req.user`, used to guard `/api/auth/me` and `/api/users/me`.
- User profile endpoints (`GET`/`PATCH /api/users/me`).
- Mongoose models for `User`, `Conversation`, `ConversationMember`, and `Message`, designed for the messaging features planned in upcoming days.
- Frontend: Login, Register, Dashboard, and Profile pages, an `AuthContext` for global auth state (persisted to `localStorage`), a `ProtectedRoute` component guarding the dashboard/profile routes, and an Axios instance that automatically attaches the JWT to outgoing requests.
- Styled with Tailwind CSS, following a reference dashboard design (sidebar navigation, card-based layout).

**Key architectural decisions:**

- **`bcryptjs` over `bcrypt`** — pure-JS implementation, avoids native build issues on Windows.
- **Auth state in React Context (`AuthContext`)** rather than prop-drilling, since login state is needed by the sidebar, protected routes, and multiple pages.
- **Both `GET /api/auth/me` and `GET /api/users/me`** exist because the task specified both explicitly (one as an auth/session check, one as a user-resource endpoint), even though they currently return the same data.
- **`process.exit(1)` was removed from the MongoDB connection error handler** — appropriate for a traditional long-running server, but dangerous in a serverless environment where it crashes the entire function on any transient DB error instead of just failing that one request.
- **Dashboard's "Welcome" message is conditional** on how the user arrived (fresh registration vs. login) — "Welcome back" only makes sense for a returning, logged-in user.

## Week 3 — Day 2: Socket.io Integration, Rooms & Real-Time Messaging

**What was built:**

- Socket.io server attached to the same HTTP server as Express, with a handshake-level auth middleware (`io.use`) that verifies the JWT and attaches `socket.userId`, same as the REST `protect` middleware.
- `join_conversation` / `leave_conversation` events with membership verification against `ConversationMember` before joining a room, rejecting non-members.
- `send_message` event: validates membership and content (rejecting empty/whitespace-only messages), saves the message, and broadcasts it to the conversation's room (including back to the sender, so the UI never needs to optimistically render a message it hasn't confirmed).
- `POST /api/conversations` (find-or-create a private conversation) and `GET /api/conversations` (list with last message preview) and `GET /api/conversations/:id/messages` (paginated history).
- Frontend: a Socket.io client singleton (`api/socket.js`) connected on login and disconnected on logout, wired into `AuthContext` with a `socketStatus` ('connecting' | 'connected' | 'disconnected' | 'error') exposed to the UI. A full Chat page (user list, message thread, connection indicator, send form) and a Dashboard that now shows real recent conversations instead of a placeholder.

**Key architectural decisions / bugs found and fixed:**

- **Backend moved from Vercel to Railway.** Vercel's serverless functions don't support persistent WebSocket connections, which Socket.io needs. Railway runs a normal long-lived Node process, so `server.js` was simplified to always call `httpServer.listen()` (no more conditional based on `NODE_ENV`), and the Vercel-specific `vercel.json` for the backend was removed.
- **MongoDB connection is lazily established per-request** (via Express middleware calling `connectDB()`, which caches the connection after the first successful connect) rather than once at startup — needed because serverless/on-demand platforms can spin up a fresh process per request, and the app must not try to run a query before the DB connection exists.
- **Race condition in conversation creation:** if two users started a conversation with each other at almost the same moment, both requests could independently pass the "does a conversation already exist?" check before either had created one, resulting in two separate conversations — the two users would then be in different Socket.io rooms and never see each other's messages. Fixed with a unique, sparse `pairKey` field on `Conversation` (sorted, joined user IDs) and a create-then-catch-duplicate-key pattern, so the database itself guarantees only one conversation per user pair.
- **Mongoose indexes were not being built reliably** on connect in this setup; `connectDB()` now explicitly calls `Conversation.syncIndexes()` after connecting to guarantee the `pairKey` uniqueness constraint actually exists.
- **`send_message`/`receive_message` avoid duplicate rendering** by never optimistically adding a sent message to the UI — the frontend only ever appends a message when the `receive_message` event arrives (which happens for the sender too), so there's exactly one source of truth for what's on screen.

## Deployment

- **Frontend:** [real-time-chat-frontend-steel.vercel.app](https://real-time-chat-frontend-steel.vercel.app) — deployed on Vercel (root directory: `frontend`).
- **Backend:** deployed on Railway (root directory: backend, via a root-level `package.json` wrapper — `npm --prefix backend install && npm --prefix backend start` — for compatibility with platforms that expect a single app at the repo root). Railway was chosen because it runs a persistent process, which Socket.io requires.
