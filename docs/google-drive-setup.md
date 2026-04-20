# Google Drive Setup

This project supports Google Drive sync through the hidden `appDataFolder` space.

## What You Need

- A Google Cloud project
- Google Drive API enabled
- An OAuth 2.0 **Web application** client
- A local `.env` file with `VITE_GOOGLE_DRIVE_CLIENT_ID`

## 1. Enable Google Drive API

In Google Cloud Console:

1. Create or open your project.
2. Open **APIs & Services**.
3. Enable **Google Drive API**.

## 2. Create OAuth Client

In Google Cloud Console:

1. Open **APIs & Services → Credentials**.
2. Create **OAuth client ID**.
3. Choose **Web application**.
4. Add your local dev origins to **Authorized JavaScript origins**.

Typical local origins:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

If you use a different Vite port, add that origin too.

## 3. Configure Local Env

Create a local `.env` file in the repo root:

```bash
cp .env.example .env
```

Then set:

```env
VITE_GOOGLE_DRIVE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

## 4. Run The App

```bash
npm install
npm run dev
```

Open the app, then:

1. Go to `Settings`
2. Open `Synchronization`
3. Click `Add connection`
4. Choose `Google Drive`
5. Authorize access

After authorization, Zen Studio stores vault data in Google Drive `appDataFolder`, not in the user-visible Drive UI.

## 5. What To Expect

- Google Drive becomes a regular sync method inside the existing multi-vault UI.
- Each remote vault gets its own file in `appDataFolder`.
- A manifest file tracks available remote vaults.
- If the OAuth access token expires, the app asks for re-authorization from the sync UI.

## Current Limitation

At the current stage:

- Google Drive sync works through snapshot sync
- delta sync for Google Drive is not implemented yet
- encrypted Google Drive payload import is not enabled yet

The payload contract is already prepared for future E2EE rollout.
