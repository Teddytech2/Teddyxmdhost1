# TEDDY-XMD support inbox update — audit results

## Implemented
- Dedicated admin support inbox with conversation list, customer identity/email, ticket/conversation ID, latest message and timestamp, unread count, status, search and status filter.
- Conversation viewer with full history, message input and a dedicated Send Reply button.
- Admin reply endpoint writes to the existing `SupportTicket` MongoDB model; the customer chat reads only conversations owned by the authenticated customer and polls every five seconds while open.
- Customer chat loads historical messages across that customer's conversations and displays sender/timestamps plus sent/delivered labels.
- Open/Pending/Resolved status actions, including reopening a resolved conversation.
- Reply to All targets every registered non-admin customer, creates a conversation where necessary, confirms before sending, rejects reused broadcast IDs and reports per-customer failures.
- Customer and admin message submissions include idempotency IDs to suppress duplicate writes on retries.
- Telegram notification integration uses `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`; website replies are independent of Telegram. Removed configuration references to `TELEGRAM_ADMIN_USER_ID` and the optional webhook secret.
- Existing user authentication, MongoDB connection, deployment and payment code were retained.
- Removed/kept absent normal-customer Support tickets navigation and login/register support-ticket links; floating chat and admin inbox remain.

## Checks actually run
- PASS: `node --check server.js`
- PASS: `node --check config.js`
- PASS: extracted inline JavaScript from `public/index.html` and ran `node --check`.
- PASS: scanned inline onclick/onsubmit/onchange handler references; no unresolved top-level handler names were found.
- PASS: searched project for `TELEGRAM_ADMIN_USER_ID` and `TELEGRAM_WEBHOOK_SECRET` in runtime/config/sample references; no runtime/config dependencies remain.
- PASS: checked project source for ordinary-customer `Support tickets` navigation/link references; none remain.

## Not run / requires deployment credentials
- MongoDB persistence and real API integration tests.
- Two-account isolation test with Customer A and Customer B.
- Admin authorization tests against a live session/database.
- Browser-level end-to-end tests (Playwright/Puppeteer are not included in the archive/environment).
- Live customer polling, Telegram notification delivery, broadcast delivery against real registered users, and hosting startup.
- Dependency installation timed out in this environment; the archive did not include `node_modules`.

No production behavior is claimed as verified. Deploy to a staging instance connected to a test MongoDB database and complete the listed integration checks before replacing the live site.
