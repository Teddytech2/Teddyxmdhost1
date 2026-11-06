# TEDDY TECH BOT DEPLOYER — Multi-user edition

A multi-user Heroku bot deployment portal with Teddy Coins, MongoDB Atlas, Paystack and per-user app ownership.

## Features
- Public user registration and sign-in.
- Admin account seeded from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- MongoDB Atlas stores accounts, sessions, wallets, payments, deployments and transaction history.
- Every bot deployment costs **10 Teddy Coins**.
- Coin pricing: **10 coins = KSh 50**. KES packs can be purchased through Paystack.
- USD checkout is card-only and starts at Paystack's **$2 minimum**. Default configured rate is $0.40 per 10 coins, so USD checkout starts at 50 coins ($2). Change `USD_PER_10_COINS` only after checking Paystack minimums and your intended price.
- Paystack payments are verified server-side before coins are credited. Callback and signed webhook processing are idempotent.
- Users can see and manage only apps they deployed. Admin can see every Heroku app and all users/payments/deployments.
- The built-in catalogue contains TEDDY-XMD ULTRA, JUNE ULTRA and CYPHERX BOT. Their GitHub repositories are configured by the administrator; customers do not enter repository URLs. Each bot has a **Get SESSION_ID** link that opens the pairing website. A SESSION_ID is required for every deployment.
- Heroku setup/build logs, runtime logs, restart, redeploy and delete actions.
- Failed Heroku setup/build automatically refunds the 10-coin deployment charge.

## Configure `config.js` before deploying

Edit `config.js` and fill in these values directly:
- `ADMIN.EMAIL` and `ADMIN.PASSWORD` — your administrator login.
- `HEROKU_API_KEY` — your Heroku API key.
- `MONGODB_URI` — your MongoDB Atlas connection string.
- `PAYSTACK_SECRET_KEY` — your Paystack secret key.
- `PUBLIC_URL` — the full URL of this panel on Heroku.
- `SESSION_SECRET` — a unique random string of at least 32 characters.
- `PROTECTED_APP_NAMES` — names of this panel and any apps customers must not manage.

The default pricing is already configured: every new bot deployment costs 10 coins; redeployments are free, and 10 coins cost KSh 50. The default USD rate is $0.40 per 10 coins, subject to Paystack's $2 minimum.

**Security:** Keep the GitHub repository private when placing live credentials in `config.js`. Never share the ZIP or commit it to a public repository. Environment variables supplied by Heroku can override the values in `config.js`. Set `NODE_ENV=production` if you prefer to configure it in Heroku; otherwise `config.js` defaults to production.

## First admin login
On first startup, the app creates the admin user using `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The admin email and password are read from `config.js`; replace the placeholders before the first startup. If that email already exists in MongoDB, its role is promoted to `admin`; its password is not overwritten. To preserve your existing login, set the same admin email/password you currently use before the first startup with this MongoDB database.

## Paystack setup
1. Add your Paystack secret key to `PAYSTACK_SECRET_KEY` in Heroku Config Vars.
2. Set the Paystack webhook URL to `https://YOUR-PANEL-DOMAIN/api/payments/webhook`.
3. Test with Paystack test keys first.
4. For USD card payments, your Kenya-based Paystack account must be enabled to accept USD/international payments. Paystack's current USD transaction minimum is $2.00. The default pack price therefore requires at least 50 coins for USD checkout.
5. Payment value is only credited after server-side verification of successful status, amount, currency and customer email.

## Deploy a bot
1. Sign up or sign in.
2. Buy Teddy Coins. KES allows 10 coins for KSh 50. USD card checkout has a $2 minimum.
3. Select a bot category, enter its public GitHub repository URL and branch.
4. Load `app.json` to confirm the repository is deployable and enter required environment variables.
5. Enter a unique Heroku app name and deploy. A new deployment costs 10 coins. Redeployments of an existing app are free.
6. In My applications, use **Environment variables** to view and edit that app’s Heroku Config Vars. Save changes to apply them; set a variable to `null` in the JSON editor to remove it. Only the app owner (or admin) can edit its variables.
6. View the live Heroku build logs. If Heroku reports a failed setup/build, the deployment charge is refunded automatically.

## Important
- This version deploys **public GitHub repositories**. Private repositories are not supported by Heroku's unauthenticated source tarball URL.
- Each user's app list and management actions are filtered by ownership stored in MongoDB. Admin has global access.
- Do not commit real API keys, MongoDB URI, admin password or session secret to GitHub.


## WhatsApp pairing website

The **Get SESSION_ID** buttons open the configured pairing website: `https://teddyxmdpair-60b69f1c4cee.herokuapp.com/`. The URL can be overridden using the `PAIRING_WEBSITE_URL` Heroku Config Var. Generate a session there, copy it, then return to the deployer and paste it into the SESSION_ID field.

## Heroku app name suggestions
The Deploy a bot page includes a configurable name prefix (default: `teddyxhost`), a **Suggest available name** button, and a **Check custom name** button. Suggestions append a random suffix (for example, `teddyxhost-a1b2c3`) and check the connected Heroku account before displaying the name. Users can edit the suggested name or enter their own. Heroku is the final authority for global name availability; if another Heroku customer claims a name between the pre-check and deployment, the deployment is rejected and the coin charge is refunded. Change the default prefix in `config.js` using `DEFAULT_HEROKU_APP_PREFIX`.


### WhatsApp support contact

Set `SUPPORT_WHATSAPP` in `config.js` to your WhatsApp number in international format using digits only (default: `254799963583`). The website displays a floating **WhatsApp Support** button on the login and dashboard screens, plus a support link on the sign-in page.


## Built-in bot pairing links

The Get SESSION_ID button opens the pairing page documented by each bot's official repository README:

- TEDDY-XMD ULTRA: https://teddyxmdpair-60b69f1c4cee.herokuapp.com/
- JUNE ULTRA: https://pair-junex.onrender.com/ (Pair Code 1)
- CYPHERX BOT: https://pair.cypherxbot.space/ (Server 1)

These links are configured per bot; the deployer does not send every bot to the TEDDY-XMD pairing page.
