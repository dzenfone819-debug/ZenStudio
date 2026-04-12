# Zen Sync Server

Optional multi-vault self-hosted sync server for Zen Notes.

Now also includes:

- a hosted-ready registry layer with `user spaces`, so vaults can either stay standalone or belong to a specific user owner
- optional account auth with email/password sessions
- a user-facing account portal for creating personal vaults and sync tokens

## Run

```bash
SYNC_TOKEN=local-dev-token ADMIN_TOKEN=local-admin-token npm run sync-server
```

Optional environment variables:

- `PORT` - server port, default `8787`
- `SYNC_TOKEN` - legacy/default vault bearer token, used for the auto-created `default` vault
- `ADMIN_TOKEN` - bearer token for the built-in admin panel
- `SYNC_DATA_DIR` - directory where `registry.json` and per-vault snapshot files are stored

## API

- `GET /health`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `GET /v1/account/vaults`
- `POST /v1/account/vaults`
- `GET /v1/account/vaults/:vaultId/tokens`
- `POST /v1/account/vaults/:vaultId/tokens`
- `GET /v1/state` and `PUT /v1/state`
  Legacy alias for the `default` vault
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

Each vault is isolated and has its own snapshot history, revision counter, and bearer tokens.
User spaces now support two modes:

- control-plane only entries created from admin
- authenticated end-user accounts created through the account portal or auth API

The server stores a full sync snapshot plus a monotonic `revision` per vault and uses optimistic concurrency on `baseRevision`.
