# Zen Sync Cloud

Managed multi-account cloud sync server for Zen Notes.

This is the hosted/cloud runtime. It keeps the full control plane:

- account registration and login
- user-owned vault spaces
- token issuing
- admin UI
- account portal
- multi-vault sync

For the minimal free self-hosted runtime use [`../zen-sync-personal-server`](../zen-sync-personal-server/README.md).

## Run

```bash
npm run sync-server:cloud
```

Optional environment variables:

- `PORT` - server port, default `8787`
- `SYNC_TOKEN` - legacy/default vault bearer token, used for the auto-created `default` vault
- `ADMIN_TOKEN` - bearer token for the built-in admin panel
- `SYNC_DATA_DIR` - directory where `registry.json` and per-vault snapshot files are stored

## API

- `GET /health`
- `GET /v1/capabilities`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `GET /v1/account/vaults`
- `POST /v1/account/vaults`
- `GET /v1/account/vaults/:vaultId/tokens`
- `POST /v1/account/vaults/:vaultId/tokens`
- `GET /v1/state` and `PUT /v1/state`
- `GET /v1/vaults/:vaultId/state`
- `PUT /v1/vaults/:vaultId/state`
- `GET /v1/admin/vaults`
- `POST /v1/admin/vaults`
- `GET /v1/admin/users`
- `POST /v1/admin/users`
- `GET /v1/admin/users/:userId/vaults`
- `POST /v1/admin/users/:userId/vaults`
- `GET /v1/admin/vaults/:vaultId/tokens`
- `POST /v1/admin/vaults/:vaultId/tokens`

## Admin UI

Open:

```bash
http://localhost:8787/admin
```

Use `ADMIN_TOKEN` to connect, then create standalone vaults or user-owned vaults and issue tokens for them.

## Account UI

Open:

```bash
http://localhost:8787/account
```

Register a user account or sign in, then create personal vaults and issue sync tokens for the Zen Notes client.
