const vaultPassphraseCache = new Map<string, string>();

function normalizeLocalVaultId(localVaultId: string) {
  return localVaultId.trim();
}

export function unlockVaultEncryptionSession(localVaultId: string, passphrase: string) {
  const normalizedLocalVaultId = normalizeLocalVaultId(localVaultId);

  if (!normalizedLocalVaultId) {
    throw new Error("LOCAL_VAULT_ID_REQUIRED");
  }

  vaultPassphraseCache.set(normalizedLocalVaultId, passphrase);
}

export function lockVaultEncryptionSession(localVaultId: string) {
  vaultPassphraseCache.delete(normalizeLocalVaultId(localVaultId));
}

export function hasVaultEncryptionSession(localVaultId: string) {
  return vaultPassphraseCache.has(normalizeLocalVaultId(localVaultId));
}

export function getVaultEncryptionSessionPassphrase(localVaultId: string) {
  return vaultPassphraseCache.get(normalizeLocalVaultId(localVaultId)) ?? null;
}

export function clearVaultEncryptionSessions() {
  vaultPassphraseCache.clear();
}
