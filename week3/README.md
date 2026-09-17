# Week 3 — Day-by-Day Snapshots

Each `DayN/` folder is a complete, standalone copy of the project exactly as it stood at the end of that day. These are for evaluation purposes only — the actual, current app lives at the repo root.

- **Day1/** — Project setup, MongoDB connection, JWT authentication (register/login/protected routes), user profile endpoints, initial chat data models (User, Conversation, ConversationMember, Message), and the frontend auth UI (Login, Register, Dashboard, Profile).
- **Day2/** — Socket.io integration (authenticated connections, conversation rooms, real-time send/receive messaging), conversation create/list/message-history APIs, and the Chat UI (user list, message thread, connection status indicator). Backend moved from Vercel to Railway since Socket.io needs a persistent server.
- **Day3/** — Group conversations, online/offline presence (multi-tab aware), typing indicators, unread-message indicator, password show/hide toggle, and a reworked Chat UI with a real conversation list and group/chat creation panels.
- **Day4/** — Message delivery/read receipts with status ticks, owner-only message editing and soft-delete, in-app + browser notifications (deduped), persistent unread counts, and paginated/infinite-scroll message history with scroll position preservation.

## archive/

Placeholder for deprecated/old files, if any are set aside in future days.
