# Final Testing Checklist & Results

Compiled at the end of Week 3 — Day 5. Covers the project's final acceptance criteria, what was tested, how, and the outcome. Where something wasn't exercised, that's stated explicitly rather than assumed passing.

## Acceptance criteria

| # | Criterion | Status | How verified |
|---|---|---|---|
| 1 | Authentication works correctly | ✅ Pass | Automated REST suite (register/login success + 6 negative cases: missing fields, invalid email, short password, duplicate email, wrong password, unknown email) — 29/29 assertions passing (see Postman collection run below) |
| 2 | Users can create private conversations | ✅ Pass | Backend socket test suite + Playwright browser suite + live production smoke test |
| 3 | Users can create and participate in group conversations | ✅ Pass | Manual + screenshot walkthrough with 3 users (Alice, Bob, Carol) — group created, message broadcast to all 3, presence count correct |
| 4 | Messages are delivered in real time | ✅ Pass | Backend test suite (delivery event), Playwright suite, live smoke test |
| 5 | Messages persist in the database | ✅ Pass | REST message-history endpoint verified after reconnect/refresh in multiple test runs |
| 6 | Online/offline presence works correctly | ✅ Pass | Manual walkthrough (green/grey dot updates on connect/disconnect); covered incidentally by Day 3 test suite |
| 7 | Typing indicators work correctly | ✅ Pass | Implemented and manually verified in Day 3; not re-run in Day 5 (no code touched this indicator) |
| 8 | Delivery and read receipts work | ✅ Pass | Backend suite (`message_delivered`/`message_read` events, DB persistence), Playwright suite (status tick progression ✓ → ✓✓ grey → ✓✓ blue) |
| 9 | Unread counts work | ✅ Pass | Backend suite (count reflects new messages, resets after read), Playwright suite (sidebar badge after reload) |
| 10 | Messages can be edited and deleted according to authorization rules | ✅ Pass | Backend suite (owner succeeds, non-owner rejected for both edit and delete), Playwright suite (UI reflects edit/delete in real time for both parties) |
| 11 | Notifications work | ✅ Pass | Playwright suite (in-app toast) + fixed a real bug this session where a brand-new conversation's first notification showed "Someone" instead of the sender's name |
| 12 | Pagination works for message history | ✅ Pass | Backend suite (`limit`/`before` params respected) |
| 13 | Socket reconnection is handled | ✅ Pass | Added a visible connection status (Connecting/Reconnecting/Offline/error) this session; verified via a real backend restart forcing a live socket drop and recovery |
| 14 | Unauthorized access is blocked | ✅ Pass | Postman negative suite (403 for non-member reading a conversation, 401 for every protected route without a token) + socket-side membership checks on every event |
| 15 | The application is responsive | ✅ Pass (after a fix) | **Found and fixed a real bug this session:** the conversation sidebar was hidden below the `sm` breakpoint with no way to reopen it, making chat unusable on mobile. Fixed with a list ↔ chat toggle; verified at 375px/768px/1440px with Playwright, including the full send/edit/delete flow at mobile width, with zero regression on desktop (13/13 desktop suite still passing) |
| 16 | No major console/server errors remain | ✅ Pass | Fixed a duplicate-message rendering bug (React key warning) and a Mongoose deprecation warning found during this session's testing; clean console/logs on the flows exercised |
| 17 | Production deployment works | ✅ Pass | Verified via a live two-user smoke test against the deployed Vercel frontend + Railway backend after each push |
| 18 | README and API/Socket documentation are complete | ✅ Pass | README now has Features, Tech Stack, API Endpoints, Socket.io Events, Testing (REST + manual multi-user + reconnection), Screenshots, and per-day build logs |

## What was NOT individually exercised

Being explicit about scope, per the project's own instruction to distinguish real results from assumptions:

- **Video demonstration** — not produced (screenshots in `docs/screenshots/` cover the same flows: register → private chat → read receipts → edit/delete → group chat → mobile).
- **Simultaneous edit/delete by two users on the same message** — not specifically tested; the ownership check (only the sender can edit/delete their own message) makes this scenario about DB write ordering, not authorization, and Mongoose's `findById` + `save()` pattern used here doesn't add extra protection against a genuine race — a low-probability, low-impact edge case (last write wins) that wasn't reproduced under test.
- **User removed from a group mid-session** — there's no "remove member" feature in this app to exercise (out of scope for Days 1–5), so this edge case doesn't currently apply.
- **Logout while inside a chat / socket disconnect mid-send** — not individually scripted; general reconnection handling (above) covers the broader "connection drops" case.
- **Very large message history (thousands of messages) performance** — pagination is implemented and unit-tested for correctness (respects `limit`), but not load-tested with a large seeded dataset.
- **Cross-browser testing** — all automated testing used Chromium (via Playwright); not verified in Firefox/Safari.

## How to reproduce these results

- **REST API:** import `postman-collection.json`, run **Auth > Register User A** through **Register User D**, then run the rest of the collection top to bottom (or use Postman's Collection Runner). Every request has an assertion; a clean run shows all green.
- **Real-time / multi-user:** follow the "Socket.io / real-time messaging — manual multi-user walkthrough" steps in the main README's Testing section.
- **Mobile:** open the deployed frontend URL on a phone, or use browser dev tools' device toolbar at 375×667 — the conversation list and chat view should each take the full screen with a back button between them, matching `docs/screenshots/09-mobile-conversation-list.png` and `10-mobile-chat-view.png`.
