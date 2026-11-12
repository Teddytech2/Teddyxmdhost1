# TEDDY TECH BOT DEPLOYER — fixes in this build

This update repairs broken JavaScript template interpolation in the backend. The affected code was generating malformed Heroku API URLs, GitHub repository URLs, GitHub `app.json` URLs, Paystack API URLs, deployment log URLs, payment references, and deployment descriptions.

It also allows the web dashboard, account registration, and sign-in to start when Paystack or Heroku credentials are not configured. Those integrations now return a clear configuration error only when the relevant action is requested. MongoDB and the administrator account remain required for the panel to start.

## Before redeploying

1. Keep this repository private because `config.js` contains service credentials.
2. Confirm `MONGODB_URI`, `SESSION_SECRET`, and `ADMIN.EMAIL` / `ADMIN.PASSWORD` in `config.js` are correct.
3. Set a valid Heroku Platform API key in Heroku Config Vars (`HEROKU_API_KEY`) before deploying apps.
4. Set a valid Paystack secret key before enabling wallet top-ups (`PAYSTACK_SECRET_KEY`). Paystack is not required for account registration or login.
5. Keep `PUBLIC_URL` set to this panel's public HTTPS URL for payment callbacks.
6. Deploy with `npm start` / `node server.js` on Node.js 20 or later.

## What was not changed

- Existing MongoDB users, wallets, payments, and deployment records are not deleted.
- The 10-coin deployment charge and existing Paystack pricing remain unchanged.
- Existing UI, app catalogue, build-log views, admin tools, and Android project files are retained.

If a deployment still fails after these code fixes, check the Heroku API response shown in the dashboard / Heroku logs. A missing or invalid Heroku API key, a private GitHub repository, or a repository without a valid root `app.json` will still prevent deployment.


## Heroku Config Vars (required)
Set `MONGODB_URI`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `HEROKU_API_KEY`, and (if using top-ups) `PAYSTACK_SECRET_KEY` in Heroku Settings > Config Vars. The application no longer contains fallback database credentials or default admin credentials in `config.js`. Rotate the MongoDB database user's password because the previous connection string was embedded in an earlier project ZIP.


## Additional fixes in this package
- Paystack callback accepts both `reference` and `trxref`; successful verification refreshes the wallet and displays an explicit success message.
- Normal accounts remain restricted to their own deployments and app-management routes. Admin global visibility remains intentional.
- Telegram Binance notifications now check Telegram API responses and surface delivery errors. The Telegram webhook is registered automatically when `PUBLIC_URL` and the bot token are configured.
- Telegram approval callbacks are restricted to `TELEGRAM_ADMIN_USER_ID` (recommended), which supports approvals from a group notification chat without confusing the group chat ID with the approving user's ID.
- Set `TELEGRAM_ADMIN_USER_ID` and optionally `TELEGRAM_WEBHOOK_SECRET` in Heroku Config Vars before testing Binance receipts.


## Manual international M-Pesa payment option
- Added a separate M-Pesa manual payment method; Binance Pay remains unchanged.
- Recipient defaults: `254799963583`, account name `Wycliffe Kibet`.
- Optional Heroku Config Vars: `MPESA_RECEIVER_PHONE`, `MPESA_RECEIVER_NAME`.
- Customers choose their country, see the KES amount and recipient instructions, enter their transfer reference, and upload a payment screenshot.
- The screenshot and order details are sent to the configured Telegram admin chat with Approve / Reject buttons. Coins are credited only after an authorized admin approves.
- This is manual verification, not a direct mobile-money API. International send-to-M-Pesa availability depends on each sender's country and transfer provider. The UI intentionally does not invent universal USSD codes or promise unsupported country routes.


## International M-Pesa transfer instructions
The M-Pesa manual payment screen now asks customers to choose their country and mobile-money network. It shows a USSD guide only for selected routes currently documented in the code (Uganda MTN MoMo `*165#`, Tanzania Vodacom `*150*00#`, Rwanda MTN MoMo `*830#`). Other country/network combinations show app-based instructions and explicitly require the provider to support Kenya Safaricom M-Pesa payout. These routes depend on the sender's operator menu and current service availability; customers must stop if Kenya/M-Pesa is not offered. The amount to send is the KES order amount converted by the provider at its displayed rate, plus any provider fees.
