# Mirsal — deploy guide

Three parts: **(1) Cloudflare backend + web app → (2) test in browser → (3) Android app in AIDE.**

## What you need
- Your Cloudflare account (free plan is enough: Workers, D1, Durable Objects).
- A place to run 3 commands: a computer, **or** a free GitHub Codespace opened from your phone's browser (see "Phone-only").

## 1. Deploy to Cloudflare

### 1a. Create an API token (once)
Cloudflare dashboard → My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers**, then add permission **Account · D1 · Edit**. Copy the token. Also copy your **Account ID** (Workers & Pages page, right side).

### 1b. Commands
```bash
unzip mirsal.zip && cd mirsal
export CLOUDFLARE_API_TOKEN=...      # the token from 1a
export CLOUDFLARE_ACCOUNT_ID=...     # your account id
npm install
npx wrangler d1 create mirsal-db     # prints a database_id
```
Open `wrangler.jsonc` and replace `PUT-YOUR-D1-DATABASE-ID-HERE` with that id, then:
```bash
npm run deploy
```
It prints your URL, e.g. `https://mirsal.<your-subdomain>.workers.dev`. Open it, create an account, done.
Database tables are created automatically on first use (no migration step).

### Phone-only
Create a GitHub repo → upload the zip → open it in **Codespaces** (github.com → Code → Codespaces). In the terminal run `unzip`, and the commands above. No local install needed.

### Optional: calls on mobile data (TURN)
Voice/video work on Wi-Fi with STUN only, but carriers often need a relay. Cloudflare dashboard → Realtime → TURN → create a key, then Worker `mirsal` → Settings → Variables and Secrets → add secrets `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. The app picks them up automatically (`/api/ice`).

## 2. Test
Open the URL on two devices/browsers, register two users, search one from the other (＋ button), chat, send an image/voice note, call.

## 3. Android app in AIDE
1. Copy the `android/` folder to your phone and open it in AIDE (Open Project → `android`).
2. Build & install. On first launch it asks for your server address — enter the `workers.dev` URL from step 1.
3. Allow camera/microphone when asked (needed for calls/voice notes).
The app is the web app in a WebView plus a small background service that shows real notifications every ~20 s while the app is closed.
`targetSdkVersion` is 28 on purpose (AIDE's toolchain); sideloaded APKs install fine on current Android.

## How it works / honest limits
- **Accounts:** username + password. The password never leaves the device: it is turned into a login secret (server stores only a hash of it) and a separate key that encrypts your private-key backup. **Forgotten password = lost message history.**
- **Encryption:** each chat has a random AES-256 key, wrapped per member with ECDH P-256. The server stores only ciphertext. Safety numbers are computed from real public keys. Not implemented: adding members later, key rotation, forward secrecy (this is not the Signal protocol). Private key is kept in the browser's localStorage while signed in.
- **Attachments** live inside D1 rows (2 MB limit): images are auto-shrunk, other files/voice notes ≤ ~900 KB. For bigger files add R2 later.
- **Presence/realtime** run through one Durable Object — fine for thousands of simultaneous users, not millions.
- **Android notifications** are polled (not FCM), so Doze mode can delay them. Instant push needs Firebase.
- Group calls are not supported (1:1 only). Login throttling is per username (8 failures / 10 min).
- I could not run Cloudflare or compile the Android code in my sandbox. Verified here: the API against a SQLite-backed D1 stand-in (2 test suites), the crypto flows (3 tests), the Worker type-check and bundle. **Not verified:** the Vite build, live WebSocket/Durable Object behavior, WebRTC, and the Android build. Expect to fix small things on first run.

## Local development
`npm run dev:worker` (backend on :8787) and `npm run dev` (UI on :5173). Tests: `npm test`.
