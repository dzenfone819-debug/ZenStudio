# Zen Studio

Zen Studio is an offline-first orbital notes app with:

- orbital vault visualization
- rich text notes
- canvas notes
- multi-vault local storage
- sync through self-hosted, hosted, and Google Drive providers

## Local Run

```bash
npm install
npm run dev
```

## Personal Sync Server

```bash
SYNC_TOKEN=local-dev-token npm run sync-server
```

## Google Drive Setup

Google Drive sync uses OAuth in the browser and stores remote vaults in the hidden `appDataFolder`.

1. Copy the env template:

```bash
cp .env.example .env
```

2. Set your Google OAuth web client id:

```env
VITE_GOOGLE_DRIVE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

3. Start the app and connect Google Drive from:

`Settings → Synchronization → Add connection → Google Drive`

Detailed setup guide:

- [docs/google-drive-setup.md](docs/google-drive-setup.md)

## Current State

- self-hosted sync works
- hosted sync works
- Google Drive provider is wired in
- E2EE contract is prepared, but full runtime rollout is still ahead
