# TEDDY-XMD DEPLOYER

Private admin-only Heroku deployment and management panel for `https://github.com/Teddyxmd/TEDDY-XMD`.

## Features
- Admin-only email/password login (no registration)
- Reads the repository's `app.json` from GitHub
- Deploys a new Heroku app through the Heroku Platform API App Setups endpoint
- Lists Heroku apps and displays app URLs/status
- Views recent logs, restarts apps, redeploys latest GitHub source, and deletes apps with typed confirmation
- Server-side Heroku API key; it is never sent to the browser

## 1. Configure
```bash
npm install
```
Edit the included `config.js` file before starting.
Edit `config.js` and set:
- `ADMIN.EMAIL`
- `ADMIN.PASSWORD` (use a long unique password)
- `HEROKU_API_KEY`
- `SESSION_SECRET` (long random secret)
- `GITHUB.BRANCH` if the bot repository uses a branch other than `main`

`config.js` is ignored by Git. Never commit it or share your Heroku API key.

## 2. Run locally
```bash
npm start
```
Open `http://localhost:3000`.

## 3. Host this panel on Heroku
Create a separate Heroku app for the panel (do not use the same app name as a bot deployment). Push this project to a private GitHub repository, then create a Heroku app connected to that repository or deploy it with Heroku CLI.

Set these Heroku Config Vars on the panel app:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `HEROKU_API_KEY`
- `SESSION_SECRET`
- `PROTECTED_APP_NAMES` (comma-separated; include the panel's own Heroku app name)

The settings in `config.js` are defaults; environment variables override them on Heroku. You can edit `config.js` as requested, but keep the GitHub repository private if it contains real credentials. Heroku Config Vars are safer for production secrets.

**Important:** Add the panel app name to `PROTECTED_APP_NAMES` so the dashboard refuses to restart/redeploy/delete it. Keep `HEROKU_API_KEY` and credentials secret.

## How deployment works
The panel reads `app.json` from the configured public GitHub repository, then submits the repository's GitHub source tarball to `POST /app-setups`. Heroku creates and builds the bot app. Redeploy submits the latest repository source to the selected app's Builds endpoint.

Heroku's App Setups API requires a gzipped tar archive with an `app.json` manifest and supports environment overrides. It is not available for Heroku Fir generation apps. Check the official Heroku documentation and your account's current app/stack eligibility before use.

## Notes / limitations
- The GitHub repository must be public for the direct GitHub tarball source URL used by this starter.
- The selected branch must contain `app.json` at the repository root.
- Required `app.json` environment variables must be supplied on the deployment form unless the manifest supplies a value or generator.
- The Heroku API may reject app creation if account verification, app limits, region/stack availability, or billing requirements prevent it.
- Logs are fetched as a recent snapshot, not a continuously streaming live tail.
- The panel uses Express's in-memory session store. For production multi-instance hosting, replace it with a persistent session store.

## TEDDY-XMD Android app
The installed app reads `public/app-config.json` on launch. Update `websiteUrl` and `allowedHosts` there to redirect it to a different HTTPS dashboard without rebuilding the APK. Keep the original app-config host online; see `ANDROID-APP-README.md`.

The repository now includes an Android WebView app in `android/`. It opens the private deployment dashboard and uses the provided Teddy Tech image as its launcher icon. GitHub Actions builds a debug APK and places it at `public/downloads/TEDDY-XMD.apk`; the dashboard's **Install TEDDY-XMD** buttons download that file after the build commit is deployed. See `ANDROID-APP-README.md`.
