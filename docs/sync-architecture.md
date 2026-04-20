# Sync Architecture Roadmap

This document freezes the payload contract for the next sync phases so Google Drive and E2EE can be implemented without rewriting the current multi-vault engine.

## Current State

- Local vaults already use separate IndexedDB databases.
- `self-hosted` and `hosted` transports are already split.
- Multi-vault binding is already implemented in the client.
- Conflict strategy is already `duplicate conflicted copy`.
- Delta sync already exists for the HTTP providers.

## What Is Still Missing

- Google Drive `appDataFolder` provider.
- End-to-end encryption for synced payloads.
- A stable envelope contract that can be reused by all providers.

## Envelope Strategy

We keep the current plain snapshot envelope working as-is and add metadata for future encrypted payloads.

### Plain Envelope

```ts
{
  revision: string | null,
  snapshot: SyncSnapshot,
  metadata: {
    schemaVersion: 1,
    payloadMode: "plain",
    vault: SyncVaultDescriptor | null,
    encryption: null
  }
}
```

### Secure Envelope

```ts
{
  revision: string | null,
  metadata: {
    schemaVersion: 1,
    payloadMode: "encrypted",
    vault: SyncVaultDescriptor | null,
    encryption: SyncEncryptionDescriptor
  },
  encryptedSnapshot: SyncEncryptedPayload
}
```

## E2EE Plan

The first E2EE implementation is vault-scoped and passphrase-based.

- KDF: `PBKDF2-SHA-256`
- Cipher: `AES-GCM-256`
- Salt: per vault
- IV: per encrypted payload
- Key check: derived from the passphrase and vault GUID

This gives us:

- one encryption identity per vault
- deterministic passphrase validation without storing the passphrase
- a transport-neutral encrypted blob that can be stored on HTTP backends or in Google Drive

## Google Drive Plan

Google Drive will use `appDataFolder`, not a user-visible folder.

### Manifest

One manifest file in `appDataFolder` tracks remote vault records:

- vault id
- human-readable name
- Drive file id
- last revision
- update timestamp

### Vault Files

Each vault is stored as its own file in `appDataFolder`.

- plain mode: current snapshot envelope
- encrypted mode: secure envelope

This keeps remote vaults isolated and matches the current multi-vault architecture.

## Rollout Order

1. Lock the envelope and encryption contract.
2. Add Google Drive transport and remote vault catalog support.
3. Enable E2EE write/read flows for sync payloads.
4. Add passphrase UX, recovery/export, and cross-device bootstrap.
5. Harden with integration tests and migration tests.

## Rules For Future Work

- Do not change the vault binding model.
- Do not merge all vaults into one remote blob.
- Keep provider-specific auth separate from provider-neutral payload logic.
- Treat E2EE as a payload layer, not as a special server mode.
