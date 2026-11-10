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
