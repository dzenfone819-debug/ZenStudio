# Zen Sync Server

Optional multi-vault self-hosted sync server for Zen Notes.

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
- `GET /v1/state` and `PUT /v1/state`
  Legacy alias for the `default` vault
- `GET /v1/vaults/:vaultId/state`
- `PUT /v1/vaults/:vaultId/state`
- `GET /v1/admin/vaults`
- `POST /v1/admin/vaults`
- `GET /v1/admin/vaults/:vaultId/tokens`
- `POST /v1/admin/vaults/:vaultId/tokens`

## Admin UI

Open:

```bash
http://localhost:8787/admin
```

Use `ADMIN_TOKEN` to connect, then create vaults and issue tokens for them.

Each vault is isolated and has its own snapshot history, revision counter, and bearer tokens.

The server stores a full sync snapshot plus a monotonic `revision` per vault and uses optimistic concurrency on `baseRevision`.
