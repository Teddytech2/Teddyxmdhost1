# TEDDY-XMD — Login Gate and Shared Coin Promo Codes

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
5. The promo list shows active and revoked codes, including the number of successful customer claims. Select **Revoke code** to stop any further customer claims, even if the code has already been used by other customers.

A promo code is **shared across customers**: every distinct account email can redeem the same code once. For example, 20 different emails can each claim `TEDDY100` and each receive 100 coins. The same normalized email cannot claim that code again. Admins can revoke a code at any time to stop future claims; coins already awarded are not removed. Codes created under the previous globally-single-use behavior remain usable by other emails, while their original claimant remains blocked from claiming again.

## Customer: redeem a promo code

1. Sign in or register.
2. Open **Wallet**.
3. Find **Have a promo code?**, enter the code and select **Claim coins**.
4. On success, the awarded coins are added to the wallet and a wallet transaction is recorded. The balance and transaction history refresh.

Unknown, revoked and already-claimed-by-this-email codes show a clear error. The server records each redemption by promo code and normalized email, with a unique compound database index and MongoDB transaction. This prevents repeat claims by the same email, including concurrent requests, while allowing different emails to redeem the shared code.

## API additions

- `POST /api/promo-codes/claim` — authenticated customer redemption, once per normalized email for each code.
- `POST /api/admin/promo-codes` — admin creates a code.
- `GET /api/admin/promo-codes` — admin lists recent codes and total successful claim counts.
- `POST /api/admin/promo-codes/:id/revoke` — admin revokes an active shared code and stops future claims.

No new Heroku config vars are required. Existing MongoDB Atlas configuration is reused. The existing application already uses MongoDB transactions for wallet/deployment accounting, so promo redemption follows the same transaction requirement.

## Deployment and verification

Deploy the full project contents from this ZIP to the existing Heroku app and restart the dyno. Keep existing environment variables, database and user records unchanged. Verify with a temporary admin-created code and a real test customer account; confirm the balance and `promo_code` transaction, then redeem the same code using two different customer emails and confirm both receive the coins; then retry with the first email and confirm it is rejected. Also test concurrent claims from the same email and confirm only one wallet credit is recorded. Verify that a signed-out browser sees only the authentication screen and that a signed-in user can access their dashboard and deploy page.

Static JavaScript syntax checks and source-level auth/route checks are performed for this package. A live Heroku/MongoDB browser round-trip is not claimed because production credentials are not available in this workspace.
