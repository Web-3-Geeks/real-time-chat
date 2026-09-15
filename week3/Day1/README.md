# Real-Time Chat App

A full-stack real-time chat application built incrementally as part of a Netixol internship project. Built with React (Vite + Tailwind CSS) on the frontend and Node.js/Express + MongoDB on the backend.

## Tech Stack

- **Frontend:** React (Vite), Tailwind CSS, React Router, Axios
- **Backend:** Node.js, Express.js
- **Database:** MongoDB (Atlas)
- **Auth:** JWT (jsonwebtoken) + bcryptjs for password hashing
- **Deployment:** Vercel (frontend and backend deployed as separate projects)

## Project Structure

This is a monorepo. The repo root always holds the current, complete app.

```
real-time-chat/
├── frontend/        # React app (Vite + Tailwind)
├── backend/         # Express API
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

Backend runs on `http://localhost:5000`.

### Frontend

```bash
cd frontend
npm install
```

Create a `.env` file in `frontend/` (see `.env.example`):

```
VITE_API_URL=http://localhost:5000/api
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
| GET | `/api/users/me` | Yes | Get the authenticated user's profile |
| PATCH | `/api/users/me` | Yes | Update `name` and/or `avatar` |

Protected routes require an `Authorization: Bearer <token>` header.

A Postman collection covering these endpoints is available at [`postman-collection.json`](postman-collection.json).

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
- **`process.exit(1)` was removed from the MongoDB connection error handler** — appropriate for a traditional long-running server, but dangerous in a serverless environment (Vercel) where it crashes the entire function on any transient DB error instead of just failing that one request.
- **Backend is temporarily deployed to Vercel** to meet a submission deadline. Vercel's serverless functions do not support persistent WebSocket connections, so once Socket.io is introduced for real-time messaging, the backend will need to move to a platform like Render or Railway.
- **Dashboard's "Welcome" message is conditional** on how the user arrived (fresh registration vs. login) — "Welcome back" only makes sense for a returning, logged-in user.

## Deployment

- Frontend: deployed on Vercel (root directory: `frontend`)
- Backend: deployed on Vercel as a separate project (root directory: `backend`) — see the architectural note above regarding its limitations for future real-time features.
