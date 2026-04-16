# Zen Sync Personal

Minimal personal self-hosted sync server for Zen Notes.

This runtime is intentionally small, but it now supports a practical single-user multi-vault workflow:

- one user space on one server
- many remote vaults on that server
- one management token for vault administration
- per-vault sync tokens for actual client sync
- no hosted accounts
- no admin panel
- no managed cloud control plane

## Run

```bash
npm run sync-server
```

You can also use the explicit alias:

```bash
npm run sync-server:personal
```

Optional environment variables:

- `PORT` - server port, default `8787`
- `SYNC_DATA_DIR` - where personal config, registry, and per-vault snapshots are stored
- `SYNC_TOKEN` - optional legacy/default vault sync token
- `SYNC_MANAGEMENT_TOKEN` - optional fixed management token; if omitted the server generates one and stores it in `personal-config.json`

On startup the server prints:

- server URL
- data directory
- default vault id
- management token

## Client setup

In Zen Notes:

- open the Sync manager
- add a `Self-hosted` connection
- paste the server URL
- paste the printed management token
- create remote vaults or bind local vaults to existing remote vaults

If you prefer a manual flow, you can also issue a vault token from the API and bind a vault manually in the client.

## Routes

Public sync routes:

- `GET /`
- `GET /health`
- `GET /v1/capabilities`
- `GET /v1/state`
- `PUT /v1/state`
- `GET /v1/vaults/:vaultId/state`
- `PUT /v1/vaults/:vaultId/state`

Management routes:

- `GET /v1/personal/vaults`
- `POST /v1/personal/vaults`
- `GET /v1/personal/vaults/:vaultId/tokens`
- `POST /v1/personal/vaults/:vaultId/tokens`
