# Zen Sync Server Core

Shared internal helpers for the Zen Notes sync runtimes.

This package is not a standalone server. It contains:

- common HTTP helpers
- JSON file storage helpers
- optimistic sync envelope helpers
- shared snapshot/envelope primitives

Used by:

- `packages/zen-sync-personal-server`
- `packages/zen-sync-server` (Zen Sync Cloud runtime)
