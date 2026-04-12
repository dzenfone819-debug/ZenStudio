import Dexie from "dexie";

export interface LocalVaultProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface LocalVaultRegistryState {
  activeVaultId: string;
  vaults: LocalVaultProfile[];
}

const REGISTRY_STORAGE_KEY = "zen-notes.local-vaults";
const DEFAULT_LOCAL_VAULT_ID = "local-default";

function now() {
  return Date.now();
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function sanitizeLocalVaultName(value: string) {
  return value.trim().slice(0, 80);
}

function createDefaultVaultProfile(): LocalVaultProfile {
  const timestamp = now();

  return {
    id: DEFAULT_LOCAL_VAULT_ID,
    name: "Main vault",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function getFallbackRegistry(): LocalVaultRegistryState {
  const defaultVault = createDefaultVaultProfile();

  return {
    activeVaultId: defaultVault.id,
    vaults: [defaultVault]
  };
}

function normalizeRegistryState(value: unknown): LocalVaultRegistryState {
  if (!value || typeof value !== "object") {
    return getFallbackRegistry();
  }

  const record = value as Record<string, unknown>;
  const vaults = Array.isArray(record.vaults)
    ? record.vaults
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const vault = entry as Record<string, unknown>;
          const id = typeof vault.id === "string" ? vault.id : "";
          const name = typeof vault.name === "string" ? sanitizeLocalVaultName(vault.name) : "";

          if (!id || !name) {
            return null;
          }

          return {
            id,
            name,
            createdAt: typeof vault.createdAt === "number" ? vault.createdAt : now(),
            updatedAt: typeof vault.updatedAt === "number" ? vault.updatedAt : now()
          } satisfies LocalVaultProfile;
        })
        .filter(Boolean) as LocalVaultProfile[]
    : [];

  if (vaults.length === 0) {
    return getFallbackRegistry();
  }

  const activeVaultId =
    typeof record.activeVaultId === "string" && vaults.some((vault) => vault.id === record.activeVaultId)
      ? record.activeVaultId
      : vaults[0].id;

  return {
    activeVaultId,
    vaults
  };
}

function readRegistryFromStorage() {
  if (!canUseStorage()) {
    return getFallbackRegistry();
  }

  const raw = window.localStorage.getItem(REGISTRY_STORAGE_KEY);

  if (!raw) {
    const fallback = getFallbackRegistry();
    window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeRegistryState(parsed);
    window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    const fallback = getFallbackRegistry();
    window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }
}

function writeRegistryToStorage(state: LocalVaultRegistryState) {
  if (!canUseStorage()) {
    return state;
  }

  window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(state));
  return state;
}

function buildRegistryState(vaults: LocalVaultProfile[], activeVaultId: string): LocalVaultRegistryState {
  const nextVaults = vaults.length > 0 ? vaults : [createDefaultVaultProfile()];
  const nextActiveVaultId = nextVaults.some((vault) => vault.id === activeVaultId)
    ? activeVaultId
    : nextVaults[0].id;

  return {
    activeVaultId: nextActiveVaultId,
    vaults: nextVaults.sort((left, right) => left.createdAt - right.createdAt)
  };
}

export function buildLocalVaultDatabaseName(localVaultId: string) {
  return `zen-notes-db-${localVaultId}`;
}

export function getLocalVaultRegistry() {
  return readRegistryFromStorage();
}

export function listLocalVaultProfiles() {
  return getLocalVaultRegistry().vaults;
}

export function getStoredActiveLocalVaultId() {
  return getLocalVaultRegistry().activeVaultId;
}

export function setStoredActiveLocalVaultId(localVaultId: string) {
  const registry = getLocalVaultRegistry();
  const nextState = buildRegistryState(registry.vaults, localVaultId);
  writeRegistryToStorage(nextState);
  return nextState.activeVaultId;
}

export function createLocalVaultProfile(name: string) {
  const registry = getLocalVaultRegistry();
  const normalizedName = sanitizeLocalVaultName(name);

  if (!normalizedName) {
    throw new Error("LOCAL_VAULT_NAME_REQUIRED");
  }

  const timestamp = now();
  const nextVault: LocalVaultProfile = {
    id: crypto.randomUUID(),
    name: normalizedName,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const nextState = buildRegistryState([...registry.vaults, nextVault], nextVault.id);
  writeRegistryToStorage(nextState);
  return nextVault;
}

export function renameLocalVaultProfile(localVaultId: string, name: string) {
  const registry = getLocalVaultRegistry();
  const normalizedName = sanitizeLocalVaultName(name);

  if (!normalizedName) {
    throw new Error("LOCAL_VAULT_NAME_REQUIRED");
  }

  const nextVaults = registry.vaults.map((vault) =>
    vault.id === localVaultId
      ? {
          ...vault,
          name: normalizedName,
          updatedAt: now()
        }
      : vault
  );
  const nextState = buildRegistryState(nextVaults, registry.activeVaultId);
  writeRegistryToStorage(nextState);
  return nextState.vaults.find((vault) => vault.id === localVaultId) ?? null;
}

export function getNextLocalVaultAfterDelete(localVaultId: string) {
  const registry = getLocalVaultRegistry();
  const remainingVaults = registry.vaults.filter((vault) => vault.id !== localVaultId);

  if (remainingVaults.length === 0) {
    throw new Error("LOCAL_VAULT_LAST");
  }

  if (registry.activeVaultId !== localVaultId) {
    return registry.activeVaultId;
  }

  return remainingVaults[0].id;
}

export function removeLocalVaultProfile(localVaultId: string) {
  const registry = getLocalVaultRegistry();
  const remainingVaults = registry.vaults.filter((vault) => vault.id !== localVaultId);

  if (remainingVaults.length === 0) {
    throw new Error("LOCAL_VAULT_LAST");
  }

  const nextActiveVaultId =
    registry.activeVaultId === localVaultId ? remainingVaults[0].id : registry.activeVaultId;
  const nextState = buildRegistryState(remainingVaults, nextActiveVaultId);
  writeRegistryToStorage(nextState);

  return nextState;
}

export async function deleteLocalVaultDatabase(localVaultId: string) {
  await Dexie.delete(buildLocalVaultDatabaseName(localVaultId));
}
