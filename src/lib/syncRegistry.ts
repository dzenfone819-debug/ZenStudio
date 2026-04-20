import type {
  AppSettings,
  SyncConnection,
  SyncConnectionProvider,
  SyncVaultBinding
} from "../types";

const SYNC_REGISTRY_STORAGE_KEY = "zen-notes.sync-registry";
const SYNC_REGISTRY_VERSION = 1;

interface SyncRegistryState {
  version: number;
  connections: SyncConnection[];
  bindings: SyncVaultBinding[];
}

function now() {
  return Date.now();
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function sanitizeProvider(value: unknown): SyncConnectionProvider | null {
  return value === "selfHosted" || value === "hosted" || value === "googleDrive" ? value : null;
}

function sanitizeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeConnection(entry: unknown): SyncConnection | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const provider = sanitizeProvider(record.provider);
  const id = sanitizeText(record.id, 80);
  const label = sanitizeText(record.label, 120);
  const serverUrl = sanitizeText(record.serverUrl, 512);

  if (!provider || !id || !label || !serverUrl) {
    return null;
  }

  const timestamp = now();

  return {
    id,
    provider,
    label,
    serverUrl,
    managementToken: sanitizeText(record.managementToken, 512),
    sessionToken: sanitizeText(record.sessionToken, 1024),
    tokenExpiresAt: typeof record.tokenExpiresAt === "number" ? record.tokenExpiresAt : null,
    userId: sanitizeText(record.userId, 120) || null,
    userName: sanitizeText(record.userName, 160),
    userEmail: sanitizeText(record.userEmail, 160),
    createdAt: typeof record.createdAt === "number" ? record.createdAt : timestamp,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : timestamp
  };
}

function normalizeBinding(entry: unknown, connectionIds: Set<string>): SyncVaultBinding | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = sanitizeText(record.id, 120);
  const localVaultId = sanitizeText(record.localVaultId, 120);
  const connectionId = sanitizeText(record.connectionId, 120);
  const remoteVaultId = sanitizeText(record.remoteVaultId, 120);

  if (!id || !localVaultId || !connectionId || !remoteVaultId || !connectionIds.has(connectionId)) {
    return null;
  }

  const timestamp = now();
  const status =
    record.syncStatus === "idle" ||
    record.syncStatus === "syncing" ||
    record.syncStatus === "error" ||
    record.syncStatus === "disabled"
      ? record.syncStatus
      : "idle";

  return {
    id,
    localVaultId,
    connectionId,
    remoteVaultId,
    remoteVaultName: sanitizeText(record.remoteVaultName, 160) || remoteVaultId,
    syncToken: sanitizeText(record.syncToken, 1024),
    syncStatus: status,
    lastSyncAt: typeof record.lastSyncAt === "number" ? record.lastSyncAt : null,
    syncCursor: sanitizeText(record.syncCursor, 160) || null,
    lastError: sanitizeText(record.lastError, 240) || null,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : timestamp,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : timestamp
  };
}

function createEmptyRegistry(): SyncRegistryState {
  return {
    version: SYNC_REGISTRY_VERSION,
    connections: [],
    bindings: []
  };
}

function normalizeRegistryState(value: unknown): SyncRegistryState {
  if (!value || typeof value !== "object") {
    return createEmptyRegistry();
  }

  const record = value as Record<string, unknown>;
  const connections = Array.isArray(record.connections)
    ? record.connections.map(normalizeConnection).filter(Boolean) as SyncConnection[]
    : [];
  const connectionIds = new Set(connections.map((connection) => connection.id));
  const bindings = Array.isArray(record.bindings)
    ? record.bindings
        .map((entry) => normalizeBinding(entry, connectionIds))
        .filter(Boolean) as SyncVaultBinding[]
    : [];

  return {
    version: SYNC_REGISTRY_VERSION,
    connections: connections.sort((left, right) => left.createdAt - right.createdAt),
    bindings: bindings.sort((left, right) => left.createdAt - right.createdAt)
  };
}

function readRegistryFromStorage() {
  if (!canUseStorage()) {
    return createEmptyRegistry();
  }

  const raw = window.localStorage.getItem(SYNC_REGISTRY_STORAGE_KEY);

  if (!raw) {
    const fallback = createEmptyRegistry();
    window.localStorage.setItem(SYNC_REGISTRY_STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeRegistryState(parsed);
    window.localStorage.setItem(SYNC_REGISTRY_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    const fallback = createEmptyRegistry();
    window.localStorage.setItem(SYNC_REGISTRY_STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }
}

function writeRegistryToStorage(state: SyncRegistryState) {
  if (!canUseStorage()) {
    return state;
  }

  window.localStorage.setItem(SYNC_REGISTRY_STORAGE_KEY, JSON.stringify(state));
  return state;
}

function writeNormalizedRegistry(state: SyncRegistryState) {
  return writeRegistryToStorage({
    version: SYNC_REGISTRY_VERSION,
    connections: [...state.connections].sort((left, right) => left.createdAt - right.createdAt),
    bindings: [...state.bindings].sort((left, right) => left.createdAt - right.createdAt)
  });
}

function buildConnectionLabel(provider: SyncConnectionProvider, serverUrl: string) {
  try {
    const hostname = new URL(serverUrl).hostname;

    if (provider === "hosted") {
      return `Zen Cloud · ${hostname}`;
    }

    if (provider === "selfHosted") {
      return `Self-hosted · ${hostname}`;
    }

    return `Google Drive · ${hostname}`;
  } catch {
    return provider === "hosted" ? "Zen Cloud" : provider === "selfHosted" ? "Self-hosted" : "Google Drive";
  }
}

export function getSyncRegistry() {
  return readRegistryFromStorage();
}

export function listSyncConnections() {
  return getSyncRegistry().connections;
}

export function listSyncBindings() {
  return getSyncRegistry().bindings;
}

export function getSyncBindingForVault(localVaultId: string) {
  return getSyncRegistry().bindings.find((binding) => binding.localVaultId === localVaultId) ?? null;
}

export function createSyncConnection(input: {
  provider: SyncConnectionProvider;
  serverUrl: string;
  label?: string;
  managementToken?: string;
  sessionToken?: string;
  tokenExpiresAt?: number | null;
  userId?: string | null;
  userName?: string;
  userEmail?: string;
}) {
  const serverUrl = sanitizeText(input.serverUrl, 512);

  if (!serverUrl) {
    throw new Error("SYNC_SERVER_URL_REQUIRED");
  }

  const registry = getSyncRegistry();
  const timestamp = now();
  const connection: SyncConnection = {
    id: crypto.randomUUID(),
    provider: input.provider,
    label: sanitizeText(input.label, 120) || buildConnectionLabel(input.provider, serverUrl),
    serverUrl,
    managementToken: sanitizeText(input.managementToken, 512),
    sessionToken: sanitizeText(input.sessionToken, 1024),
    tokenExpiresAt: typeof input.tokenExpiresAt === "number" ? input.tokenExpiresAt : null,
    userId: sanitizeText(input.userId, 120) || null,
    userName: sanitizeText(input.userName, 160),
    userEmail: sanitizeText(input.userEmail, 160),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  writeNormalizedRegistry({
    ...registry,
    connections: [...registry.connections, connection]
  });

  return connection;
}

export function updateSyncConnection(connectionId: string, patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt">>) {
  const registry = getSyncRegistry();
  const nextConnections = registry.connections.map((connection) =>
    connection.id === connectionId
      ? {
          ...connection,
          label:
            typeof patch.label === "string"
              ? sanitizeText(patch.label, 120) || connection.label
              : connection.label,
          serverUrl:
            typeof patch.serverUrl === "string"
              ? sanitizeText(patch.serverUrl, 512) || connection.serverUrl
              : connection.serverUrl,
          managementToken:
            typeof patch.managementToken === "string"
              ? sanitizeText(patch.managementToken, 512)
              : connection.managementToken,
          sessionToken:
            typeof patch.sessionToken === "string"
              ? sanitizeText(patch.sessionToken, 1024)
              : connection.sessionToken,
          tokenExpiresAt:
            typeof patch.tokenExpiresAt === "number" || patch.tokenExpiresAt === null
              ? patch.tokenExpiresAt ?? null
              : connection.tokenExpiresAt,
          userId:
            typeof patch.userId === "string" || patch.userId === null
              ? sanitizeText(patch.userId, 120) || null
              : connection.userId,
          userName:
            typeof patch.userName === "string"
              ? sanitizeText(patch.userName, 160)
              : connection.userName,
          userEmail:
            typeof patch.userEmail === "string"
              ? sanitizeText(patch.userEmail, 160)
              : connection.userEmail,
          updatedAt: now()
        }
      : connection
  );

  writeNormalizedRegistry({
    ...registry,
    connections: nextConnections
  });

  return nextConnections.find((connection) => connection.id === connectionId) ?? null;
}

export function removeSyncConnection(connectionId: string) {
  const registry = getSyncRegistry();
  const nextRegistry = {
    ...registry,
    connections: registry.connections.filter((connection) => connection.id !== connectionId),
    bindings: registry.bindings.filter((binding) => binding.connectionId !== connectionId)
  };

  writeNormalizedRegistry(nextRegistry);
  return nextRegistry;
}

export function upsertSyncBinding(input: {
  localVaultId: string;
  connectionId: string;
  remoteVaultId: string;
  remoteVaultName?: string;
  syncToken: string;
  syncStatus?: SyncVaultBinding["syncStatus"];
  lastSyncAt?: number | null;
  syncCursor?: string | null;
  lastError?: string | null;
}) {
  const registry = getSyncRegistry();
  const existingBinding = registry.bindings.find((binding) => binding.localVaultId === input.localVaultId) ?? null;
  const timestamp = now();

  const binding: SyncVaultBinding = {
    id: existingBinding?.id ?? crypto.randomUUID(),
    localVaultId: sanitizeText(input.localVaultId, 120),
    connectionId: sanitizeText(input.connectionId, 120),
    remoteVaultId: sanitizeText(input.remoteVaultId, 120),
    remoteVaultName: sanitizeText(input.remoteVaultName, 160) || sanitizeText(input.remoteVaultId, 120),
    syncToken: sanitizeText(input.syncToken, 1024),
    syncStatus: input.syncStatus ?? existingBinding?.syncStatus ?? "idle",
    lastSyncAt:
      typeof input.lastSyncAt === "number" || input.lastSyncAt === null
        ? input.lastSyncAt ?? null
        : existingBinding?.lastSyncAt ?? null,
    syncCursor:
      typeof input.syncCursor === "string" || input.syncCursor === null
        ? sanitizeText(input.syncCursor, 160) || null
        : existingBinding?.syncCursor ?? null,
    lastError:
      typeof input.lastError === "string" || input.lastError === null
        ? sanitizeText(input.lastError, 240) || null
        : existingBinding?.lastError ?? null,
    createdAt: existingBinding?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  if (!binding.localVaultId || !binding.connectionId || !binding.remoteVaultId || !binding.syncToken) {
    throw new Error("SYNC_BINDING_REQUIRED");
  }

  const nextBindings = existingBinding
    ? registry.bindings.map((entry) => (entry.id === existingBinding.id ? binding : entry))
    : [...registry.bindings, binding];

  writeNormalizedRegistry({
    ...registry,
    bindings: nextBindings
  });

  return binding;
}

export function clearSyncBinding(localVaultId: string) {
  const registry = getSyncRegistry();
  const nextRegistry = {
    ...registry,
    bindings: registry.bindings.filter((binding) => binding.localVaultId !== localVaultId)
  };

  writeNormalizedRegistry(nextRegistry);
  return nextRegistry;
}

export function updateSyncBindingState(
  localVaultId: string,
  patch: Partial<Pick<SyncVaultBinding, "syncStatus" | "lastSyncAt" | "syncCursor" | "lastError">>
) {
  const registry = getSyncRegistry();
  const nextBindings = registry.bindings.map((binding) =>
    binding.localVaultId === localVaultId
      ? {
          ...binding,
          syncStatus: patch.syncStatus ?? binding.syncStatus,
          lastSyncAt:
            typeof patch.lastSyncAt === "number" || patch.lastSyncAt === null
              ? patch.lastSyncAt ?? null
              : binding.lastSyncAt,
          syncCursor:
            typeof patch.syncCursor === "string" || patch.syncCursor === null
              ? sanitizeText(patch.syncCursor, 160) || null
              : binding.syncCursor,
          lastError:
            typeof patch.lastError === "string" || patch.lastError === null
              ? sanitizeText(patch.lastError, 240) || null
              : binding.lastError,
          updatedAt: now()
        }
      : binding
  );

  writeNormalizedRegistry({
    ...registry,
    bindings: nextBindings
  });

  return nextBindings.find((binding) => binding.localVaultId === localVaultId) ?? null;
}

export function removeBindingsForLocalVault(localVaultId: string) {
  return clearSyncBinding(localVaultId);
}

export async function migrateSyncRegistryFromLegacyVaultSettings(
  localVaultIds: string[],
  readSettings: (localVaultId: string) => Promise<AppSettings | null>
) {
  const existing = getSyncRegistry();

  if (existing.connections.length > 0 || existing.bindings.length > 0) {
    return existing;
  }

  const timestamp = now();
  const connections: SyncConnection[] = [];
  const bindings: SyncVaultBinding[] = [];
  const selfHostedConnectionMap = new Map<string, SyncConnection>();
  const hostedConnectionMap = new Map<string, SyncConnection>();

  for (const localVaultId of localVaultIds) {
    const settings = await readSettings(localVaultId);

    if (!settings) {
      continue;
    }

    if (
      settings.syncProvider === "selfHosted" &&
      settings.selfHostedUrl.trim() &&
      settings.selfHostedVaultId.trim() &&
      settings.selfHostedToken.trim()
    ) {
      const key = settings.selfHostedUrl.trim();
      let connection = selfHostedConnectionMap.get(key) ?? null;

      if (!connection) {
        connection = {
          id: crypto.randomUUID(),
          provider: "selfHosted",
          label: buildConnectionLabel("selfHosted", settings.selfHostedUrl),
          serverUrl: settings.selfHostedUrl.trim(),
          managementToken: "",
          sessionToken: "",
          tokenExpiresAt: null,
          userId: null,
          userName: "",
          userEmail: "",
          createdAt: timestamp,
          updatedAt: timestamp
        };
        selfHostedConnectionMap.set(key, connection);
        connections.push(connection);
      }

      bindings.push({
        id: crypto.randomUUID(),
        localVaultId,
        connectionId: connection.id,
        remoteVaultId: settings.selfHostedVaultId.trim(),
        remoteVaultName: settings.selfHostedVaultId.trim(),
        syncToken: settings.selfHostedToken.trim(),
        syncStatus: settings.syncStatus,
        lastSyncAt: settings.lastSyncAt,
        syncCursor: settings.syncCursor,
        lastError: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    if (
      settings.syncProvider === "hosted" &&
      settings.hostedUrl.trim() &&
      settings.hostedVaultId.trim() &&
      settings.hostedSyncToken.trim()
    ) {
      const key = `${settings.hostedUrl.trim()}::${settings.hostedUserId ?? "anon"}`;
      let connection = hostedConnectionMap.get(key) ?? null;

      if (!connection) {
        connection = {
          id: crypto.randomUUID(),
          provider: "hosted",
          label:
            settings.hostedUserName.trim() ||
            buildConnectionLabel("hosted", settings.hostedUrl),
          serverUrl: settings.hostedUrl.trim(),
          managementToken: "",
          sessionToken: settings.hostedSessionToken.trim(),
          tokenExpiresAt: null,
          userId: settings.hostedUserId,
          userName: settings.hostedUserName.trim(),
          userEmail: settings.hostedUserEmail.trim(),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        hostedConnectionMap.set(key, connection);
        connections.push(connection);
      }

      bindings.push({
        id: crypto.randomUUID(),
        localVaultId,
        connectionId: connection.id,
        remoteVaultId: settings.hostedVaultId.trim(),
        remoteVaultName: settings.hostedVaultId.trim(),
        syncToken: settings.hostedSyncToken.trim(),
        syncStatus: settings.syncStatus,
        lastSyncAt: settings.lastSyncAt,
        syncCursor: settings.syncCursor,
        lastError: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  }

  const migrated = {
    version: SYNC_REGISTRY_VERSION,
    connections,
    bindings
  } satisfies SyncRegistryState;

  writeNormalizedRegistry(migrated);
  return migrated;
}
