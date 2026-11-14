# TEDDY-XMD — Login Gate and Single-Use Coin Promo Codes

## Login and dashboard visibility

- The dashboard is hidden in the initial HTML and is revealed only after `/api/me` confirms an authenticated session.
- If the session is missing or invalid, the site shows the sign-in / sign-up screen and hides dashboard navigation and the support shortcut.
- Dashboard navigation also checks the authenticated user client-side. Sensitive dashboard APIs, including deployment and wallet endpoints, remain protected by the existing `requireAuth` middleware; admin promo management uses both `requireAuth` and `requireAdmin`.
- Registering or signing in creates the existing session and then reveals the dashboard. No existing accounts or sessions are migrated or deleted.

## Admin: create and revoke promo codes

1. Sign in with an administrator account.
2. Open **Admin panel** → **Promo codes**.
3. Enter a code (4–32 letters, numbers or hyphens) and the whole number of Teddy Coins it awards.
4. Select **Create promo code**. Codes are stored uppercase and are case-insensitive when redeemed.
5. The promo list shows active, claimed and revoked codes. Select **Revoke code** to disable an active code before it is claimed.

A promo code is **globally single-use**: exactly one customer can redeem it. A claimed code cannot be revoked retroactively. A revoked code cannot be redeemed.

## Customer: redeem a promo code

1. Sign in or register.
2. Open **Wallet**.
3. Find **Have a promo code?**, enter the code and select **Claim coins**.
4. On success, the awarded coins are added to the wallet and a wallet transaction is recorded. The balance and transaction history refresh.

Unknown, revoked and already-claimed codes show a clear error. The server enforces single-use atomically inside a MongoDB transaction, so simultaneous redemption attempts cannot credit two accounts.

## API additions

- `POST /api/promo-codes/claim` — authenticated customer redemption.
- `POST /api/admin/promo-codes` — admin creates a code.
- `GET /api/admin/promo-codes` — admin lists recent codes and claimant details.
- `POST /api/admin/promo-codes/:id/revoke` — admin revokes an unclaimed active code.

No new Heroku config vars are required. Existing MongoDB Atlas configuration is reused. The existing application already uses MongoDB transactions for wallet/deployment accounting, so promo redemption follows the same transaction requirement.

## Deployment and verification

Deploy the full project contents from this ZIP to the existing Heroku app and restart the dyno. Keep existing environment variables, database and user records unchanged. Verify with a temporary admin-created code and a real test customer account; confirm the balance and `promo_code` transaction, then attempt to redeem the same code again and confirm the second attempt is rejected. Also verify that a signed-out browser sees only the authentication screen and that a signed-in user can access their dashboard and deploy page.

Static JavaScript syntax checks and source-level auth/route checks are performed for this package. A live Heroku/MongoDB browser round-trip is not claimed because production credentials are not available in this workspace.
