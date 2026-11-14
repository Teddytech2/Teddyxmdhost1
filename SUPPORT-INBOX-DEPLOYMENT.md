# TEDDY-XMD Support Inbox — deployment notes

## Where the inbox appears
After deploying this updated project, sign in to the website with an account whose database role is `admin`. The admin-only **Support Inbox** item is now a separate navigation destination (desktop sidebar and mobile navigation). It is separate from Telegram notifications and separate from the general Admin panel.

## Replying to messages
Open **Support Inbox**, select a customer's conversation, and use the **Reply to this message** control below any non-system message. The composer at the bottom sends the reply into that customer's existing MongoDB conversation. The customer sees the reply in their floating website Support Chat on its next automatic refresh. **Reply to All Customers** remains a separate confirmed broadcast action.

## Deploying the correct code
Upload/deploy this ZIP's project contents to the same hosting app/repository that serves the website, then restart/redeploy the app. Merely receiving Telegram notifications does not update the website frontend. After deployment, hard-refresh the website or clear its cached page, sign out/in, and use the admin account.

## Requirements
Keep the existing `MONGODB_URI`, session/authentication configuration and other existing environment variables unchanged. Telegram notifications use `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`; website inbox/replies are stored and delivered through the website API and MongoDB and do not require Telegram to be open.

## Verification limitation
Static syntax checks are included in the handoff. Live MongoDB, production authentication, customer isolation and browser-based end-to-end delivery must still be verified against the deployed environment with real test accounts.

## What was corrected in this build
- The inbox conversation list now has a Support-Inbox-specific display rule, so the generic `.mobile-list { display:none }` rule no longer hides it on desktop or tablet. The inbox uses a two-pane layout on wide screens and stacks the list and viewer on narrow screens.
- The frontend explicitly validates that `/api/admin/support/conversations` returned a JSON array, safely handles populated `userId` objects and message arrays, and sorts messages chronologically before selecting the latest preview.
- Customer, admin and system messages have distinct visual treatments. The selected ticket is refreshed automatically by the existing polling loop, and replies continue to POST to the existing ticket-ID-specific admin reply endpoint.
- API failures are shown in the inbox with a retry action. Existing API routes, authentication middleware, MongoDB schema and Telegram webhook/notification code were not replaced.

## Verification performed for this handoff
- `node --check server.js` passed.
- The complete inline browser JavaScript extracted from `public/index.html` passed `node --check`.
- The inbox layout rules and responsive breakpoints were checked in the delivered stylesheet.
- A live authenticated MongoDB/Telegram round-trip was not possible in this build environment because production credentials and the deployed customer ticket are not available here. No dummy conversations or messages were added. Before going live, sign in as an admin and verify the existing ticket `TKT-92434963`, then send a reply and confirm it appears in the customer's existing support chat.
