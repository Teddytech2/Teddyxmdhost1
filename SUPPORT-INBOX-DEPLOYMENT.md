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
