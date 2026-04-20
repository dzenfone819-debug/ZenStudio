import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { createServer } from "node:http";
import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyChangeSetToSnapshot,
  buildChangeSetFromSnapshots,
  collapseChangeSets,
  collectBody,
  createEmptyEnvelope,
  createEmptyChangeSet,
  ensureDir,
  fileExists,
  getBearerToken,
  handleOptimisticSyncRoute,
  isChangeSetEmpty,
  isEncryptedEnvelope,
  normalizeChangeSet,
  normalizeStoredEnvelope,
  now,
  pruneChangeHistory,
  readJsonFile,
  sendCorsNoContent,
  sendJson,
  serveStaticAsset,
  writeJsonFile
} from "../zen-sync-server-core/common.mjs";

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const SYNC_TOKEN = process.env.SYNC_TOKEN ?? "local-dev-token";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "local-admin-token";
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SYNC_DATA_DIR
  ? path.resolve(process.env.SYNC_DATA_DIR)
  : path.join(SERVER_DIR, ".data");
const VAULTS_DIR = path.join(DATA_DIR, "vaults");
const REGISTRY_FILE = path.join(DATA_DIR, "registry.json");
const LEGACY_STATE_FILE = path.join(DATA_DIR, "state.json");
const ADMIN_DIR = path.join(SERVER_DIR, "admin");
const ACCOUNT_DIR = path.join(SERVER_DIR, "account");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MIN_PASSWORD_LENGTH = 8;

function createEmptyRegistry() {
  return {
    schemaVersion: 3,
    users: [],
    vaults: [],
    tokens: [],
    sessions: []
  };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(rawValue) {
  return String(rawValue ?? "").trim().toLowerCase().slice(0, 160);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeDisplayName(rawValue, fallbackValue) {
  const candidate = String(rawValue ?? "").trim().slice(0, 120);
  return candidate || fallbackValue;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string" || !storedHash.startsWith("scrypt$")) {
    return false;
  }

  const [, salt, expectedHex] = storedHash.split("$");

  if (!salt || !expectedHex) {
    return false;
  }

  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(password, salt, expected.length);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createSessionTokenValue() {
  return `zns_${randomUUID().replace(/-/g, "")}`;
}

function sanitizeVaultId(rawValue) {
  const candidate = String(rawValue ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return candidate;
}

function sanitizeUserId(rawValue) {
  const candidate = String(rawValue ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return candidate;
}

function deriveVaultId(name) {
  const derived = sanitizeVaultId(name);
  return derived || `vault-${randomUUID().slice(0, 8)}`;
}

function deriveUserId(name) {
  const derived = sanitizeUserId(name);
  return derived || `user-${randomUUID().slice(0, 8)}`;
}

function buildAvailableId(candidate, exists, prefix) {
  if (!exists(candidate)) {
    return candidate;
  }

  const base = candidate.slice(0, 52) || prefix;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomUUID().slice(0, 4);
    const nextCandidate = `${base}-${suffix}`.slice(0, 64);

    if (!exists(nextCandidate)) {
      return nextCandidate;
    }
  }

  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function getVaultStateFile(vaultId) {
  return path.join(VAULTS_DIR, `${vaultId}.json`);
}

function getVaultJournalFile(vaultId) {
  return path.join(VAULTS_DIR, `${vaultId}.journal.json`);
}

async function ensureDataDirs() {
  await ensureDir(DATA_DIR);
  await ensureDir(VAULTS_DIR);
}

function normalizeTokenRecord(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const token = entry;
  const id = typeof token.id === "string" ? token.id : "";
  const vaultId = sanitizeVaultId(token.vaultId);
  const tokenHash = typeof token.tokenHash === "string" ? token.tokenHash.trim() : "";

  if (!id || !vaultId || !tokenHash) {
    return null;
  }

  return {
    id,
    vaultId,
    label: sanitizeDisplayName(token.label, "Client token"),
    tokenHash,
    createdAt: typeof token.createdAt === "number" ? token.createdAt : now(),
    lastUsedAt: typeof token.lastUsedAt === "number" ? token.lastUsedAt : null
  };
}

function normalizeSessionRecord(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const session = entry;
  const id = typeof session.id === "string" ? session.id : "";
  const userId = sanitizeUserId(session.userId);
  const tokenHash = typeof session.tokenHash === "string" ? session.tokenHash.trim() : "";
  const expiresAt = typeof session.expiresAt === "number" ? session.expiresAt : 0;

  if (!id || !userId || !tokenHash || expiresAt <= 0) {
    return null;
  }

  return {
    id,
    userId,
    tokenHash,
    createdAt: typeof session.createdAt === "number" ? session.createdAt : now(),
    lastUsedAt: typeof session.lastUsedAt === "number" ? session.lastUsedAt : null,
    expiresAt
  };
}

async function readRegistry() {
  const parsed = await readJsonFile(REGISTRY_FILE, createEmptyRegistry());

  return {
    schemaVersion: 3,
    users: Array.isArray(parsed.users)
      ? parsed.users
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }

            const user = entry;
            const id = sanitizeUserId(user.id);
            const name = sanitizeDisplayName(user.name, "");

            if (!id || !name) {
              return null;
            }

            return {
              id,
              name,
              email: normalizeEmail(user.email) || null,
              passwordHash: typeof user.passwordHash === "string" ? user.passwordHash : null,
              role: user.role === "admin" ? "admin" : "member",
              createdAt: typeof user.createdAt === "number" ? user.createdAt : now(),
              updatedAt: typeof user.updatedAt === "number" ? user.updatedAt : now(),
              lastLoginAt: typeof user.lastLoginAt === "number" ? user.lastLoginAt : null
            };
          })
          .filter(Boolean)
      : [],
    vaults: Array.isArray(parsed.vaults)
      ? parsed.vaults
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }

            const vault = entry;
            const id = sanitizeVaultId(vault.id);
            const name = sanitizeDisplayName(vault.name, "");

            if (!id || !name) {
              return null;
            }

            return {
              id,
              name,
              ownerUserId: typeof vault.ownerUserId === "string" ? sanitizeUserId(vault.ownerUserId) || null : null,
              createdAt: typeof vault.createdAt === "number" ? vault.createdAt : now(),
              updatedAt: typeof vault.updatedAt === "number" ? vault.updatedAt : now(),
              lastRevision: typeof vault.lastRevision === "string" ? vault.lastRevision : null,
              lastSyncAt: typeof vault.lastSyncAt === "number" ? vault.lastSyncAt : null
            };
          })
          .filter(Boolean)
      : [],
    tokens: Array.isArray(parsed.tokens) ? parsed.tokens.map(normalizeTokenRecord).filter(Boolean) : [],
    sessions: Array.isArray(parsed.sessions)
      ? parsed.sessions.map(normalizeSessionRecord).filter(Boolean)
      : []
  };
}

async function writeRegistry(registry) {
  await writeJsonFile(REGISTRY_FILE, registry);
}

async function readVaultEnvelope(vaultId) {
  const parsed = await readJsonFile(getVaultStateFile(vaultId), createEmptyEnvelope());
  return normalizeStoredEnvelope(parsed);
}

async function writeVaultEnvelope(vaultId, envelope) {
  await writeJsonFile(getVaultStateFile(vaultId), envelope);
}

async function readVaultJournal(vaultId) {
  const parsed = await readJsonFile(getVaultJournalFile(vaultId), []);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      return {
        revision: typeof entry.revision === "string" ? entry.revision : null,
        baseRevision:
          typeof entry.baseRevision === "string" || entry.baseRevision === null
            ? entry.baseRevision ?? null
            : null,
        createdAt: typeof entry.createdAt === "number" ? entry.createdAt : now(),
        changes: normalizeChangeSet(entry.changes, "server")
      };
    })
    .filter((entry) => entry && entry.revision);
}

async function writeVaultJournal(vaultId, journal) {
  await writeJsonFile(getVaultJournalFile(vaultId), pruneChangeHistory(journal));
}

function pruneExpiredSessions(registry) {
  const timestamp = now();
  const nextSessions = registry.sessions.filter((session) => session.expiresAt > timestamp);

  if (nextSessions.length === registry.sessions.length) {
    return registry;
  }

  return {
    ...registry,
    sessions: nextSessions
  };
}

async function migrateLegacySingleVault(registry) {
  const defaultVaultId = "default";
  const defaultVaultExists = registry.vaults.some((vault) => vault.id === defaultVaultId);
  const legacyExists = await fileExists(LEGACY_STATE_FILE);
  const defaultVaultFileExists = await fileExists(getVaultStateFile(defaultVaultId));
  const defaultVaultJournalExists = await fileExists(getVaultJournalFile(defaultVaultId));
  let nextRegistry = registry;
  let changed = false;

  if (!defaultVaultExists) {
    nextRegistry = {
      ...nextRegistry,
      vaults: [
        ...nextRegistry.vaults,
        {
          id: defaultVaultId,
          name: "Default vault",
          ownerUserId: null,
          createdAt: now(),
          updatedAt: now(),
          lastRevision: null,
          lastSyncAt: null
        }
      ]
    };
    changed = true;
  }

  if (legacyExists && !defaultVaultFileExists) {
    await copyFile(LEGACY_STATE_FILE, getVaultStateFile(defaultVaultId));

    const defaultEnvelope = await readVaultEnvelope(defaultVaultId);
    nextRegistry = {
      ...nextRegistry,
      vaults: nextRegistry.vaults.map((vault) =>
        vault.id === defaultVaultId
          ? {
              ...vault,
              updatedAt: now(),
              lastRevision: defaultEnvelope.revision,
              lastSyncAt: defaultEnvelope.snapshot?.exportedAt ?? null
            }
          : vault
      )
    };
    changed = true;
  }

  const legacyDefaultTokenHash = hashToken(SYNC_TOKEN);
  const defaultTokenExists = nextRegistry.tokens.some(
    (token) => token.vaultId === defaultVaultId && token.tokenHash === legacyDefaultTokenHash
  );

  if (!defaultTokenExists) {
    nextRegistry = {
      ...nextRegistry,
      tokens: [
        ...nextRegistry.tokens,
        {
          id: `legacy-${defaultVaultId}`,
          vaultId: defaultVaultId,
          label: "Legacy default token",
          tokenHash: legacyDefaultTokenHash,
          createdAt: now(),
          lastUsedAt: null
        }
      ]
    };
    changed = true;
  }

  if (!defaultVaultFileExists && !legacyExists) {
    await writeVaultEnvelope(defaultVaultId, createEmptyEnvelope());
    changed = true;
  }

  if (!defaultVaultJournalExists) {
    await writeVaultJournal(defaultVaultId, []);
  }

  const prunedRegistry = pruneExpiredSessions(nextRegistry);

  if (prunedRegistry !== nextRegistry) {
    nextRegistry = prunedRegistry;
    changed = true;
  }

  if (changed) {
    await writeRegistry(nextRegistry);
  }

  return nextRegistry;
}

async function ensureInitialized() {
  await ensureDataDirs();
  const registry = await readRegistry();
  const nextRegistry = await migrateLegacySingleVault(registry);

  await Promise.all(
    nextRegistry.vaults.map(async (vault) => {
      if (!(await fileExists(getVaultJournalFile(vault.id)))) {
        await writeVaultJournal(vault.id, []);
      }
    })
  );

  return nextRegistry;
}

function buildSnapshotFallbackFeed(envelope) {
  return {
    mode: "snapshot",
    revision: envelope.revision,
    baseRevision: null,
    changes: null,
    snapshot: isEncryptedEnvelope(envelope) ? null : envelope.snapshot,
    metadata: envelope.metadata ?? null
  };
}

function isAdminAuthorized(request) {
  return getBearerToken(request) === ADMIN_TOKEN;
}

function getVaultById(registry, vaultId) {
  return registry.vaults.find((vault) => vault.id === vaultId) ?? null;
}

function getUserById(registry, userId) {
  return registry.users.find((user) => user.id === userId) ?? null;
}

function findUserByEmail(registry, email) {
  const normalizedEmail = normalizeEmail(email);
  return registry.users.find((user) => user.email === normalizedEmail) ?? null;
}

function isVaultOwnedByUser(vault, userId) {
  return vault.ownerUserId === userId;
}

function getAuthorizedTokenRecord(registry, vaultId, tokenValue) {
  const tokenHash = hashToken(tokenValue);
  return (
    registry.tokens.find((token) => token.vaultId === vaultId && token.tokenHash === tokenHash) ?? null
  );
}

function getAuthorizedSessionRecord(registry, tokenValue) {
  const tokenHash = hashToken(tokenValue);
  const timestamp = now();

  return (
    registry.sessions.find((session) => session.tokenHash === tokenHash && session.expiresAt > timestamp) ??
    null
  );
}

async function markTokenUsed(registry, tokenId) {
  const existingToken = registry.tokens.find((token) => token.id === tokenId);

  if (existingToken && (existingToken.lastUsedAt ?? 0) > now() - 60_000) {
    return registry;
  }

  const nextRegistry = {
    ...registry,
    tokens: registry.tokens.map((token) =>
      token.id === tokenId
        ? {
            ...token,
            lastUsedAt: now()
          }
        : token
    )
  };

  await writeRegistry(nextRegistry);
  return nextRegistry;
}

async function markSessionUsed(registry, sessionId) {
  const existingSession = registry.sessions.find((session) => session.id === sessionId);

  if (existingSession && (existingSession.lastUsedAt ?? 0) > now() - 60_000) {
    return registry;
  }

  const nextRegistry = {
    ...registry,
    sessions: registry.sessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            lastUsedAt: now()
          }
        : session
    )
  };

  await writeRegistry(nextRegistry);
  return nextRegistry;
}

async function updateVaultMeta(registry, vaultId, patch) {
  const nextRegistry = {
    ...registry,
    vaults: registry.vaults.map((vault) =>
      vault.id === vaultId
        ? {
            ...vault,
            ...patch,
            updatedAt: now()
          }
        : vault
    )
  };

  await writeRegistry(nextRegistry);
  return nextRegistry;
}

async function appendVaultJournalEntry(vaultId, entry) {
  const journal = await readVaultJournal(vaultId);
  await writeVaultJournal(vaultId, [...journal, entry]);
}

function buildPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? null,
    role: user.role ?? "member",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt ?? null,
    hasPassword: Boolean(user.passwordHash)
  };
}

function buildTokenMeta(token) {
  return {
    id: token.id,
    vaultId: token.vaultId,
    label: token.label,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt ?? null
  };
}

function buildVaultList(registry) {
  return registry.vaults
    .map((vault) => ({
      ...vault,
      ownerUserId: vault.ownerUserId ?? null,
      ownerName: vault.ownerUserId ? getUserById(registry, vault.ownerUserId)?.name ?? null : null,
      tokenCount: registry.tokens.filter((token) => token.vaultId === vault.id).length
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildUserList(registry) {
  return registry.users
    .map((user) => {
      const userVaults = registry.vaults.filter((vault) => vault.ownerUserId === user.id);
      const vaultIds = new Set(userVaults.map((vault) => vault.id));

      return {
        ...buildPublicUser(user),
        vaultCount: userVaults.length,
        tokenCount: registry.tokens.filter((token) => vaultIds.has(token.vaultId)).length,
        lastActivityAt: userVaults.reduce(
          (latest, vault) => Math.max(latest, vault.lastSyncAt ?? vault.updatedAt ?? 0),
          0
        )
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildOwnedVaultList(registry, userId) {
  return buildVaultList(registry).filter((vault) => vault.ownerUserId === userId);
}

function listVaultTokens(registry, vaultId) {
  return registry.tokens
    .filter((token) => token.vaultId === vaultId)
    .map(buildTokenMeta)
    .sort((left, right) => left.createdAt - right.createdAt);
}

async function issueVaultToken(registry, vaultId, labelValue) {
  if (!getVaultById(registry, vaultId)) {
    return {
      statusCode: 404,
      error: "VAULT_NOT_FOUND"
    };
  }

  const label = sanitizeDisplayName(labelValue, "Client token");
  const tokenValue = `znt_${vaultId}_${randomUUID().replace(/-/g, "")}`;
  const nextToken = {
    id: randomUUID(),
    vaultId,
    label,
    tokenHash: hashToken(tokenValue),
    createdAt: now(),
    lastUsedAt: null
  };
  const nextRegistry = {
    ...registry,
    tokens: [...registry.tokens, nextToken]
  };

  await writeRegistry(nextRegistry);

  return {
    statusCode: 201,
    nextRegistry,
    token: tokenValue,
    tokenMeta: buildTokenMeta(nextToken)
  };
}

async function createVaultRecord(registry, payload) {
  const requestedId = sanitizeVaultId(payload?.id ?? "");
  const name = sanitizeDisplayName(payload?.name, "New vault");
  const ownerUserId =
    payload && typeof payload.ownerUserId === "string"
      ? sanitizeUserId(payload.ownerUserId) || null
      : null;

  if (ownerUserId && !getUserById(registry, ownerUserId)) {
    return {
      statusCode: 404,
      error: "USER_NOT_FOUND"
    };
  }

  const vaultId = requestedId || buildAvailableId(deriveVaultId(name), (value) => Boolean(getVaultById(registry, value)), "vault");

  if (!vaultId) {
    return {
      statusCode: 400,
      error: "VAULT_ID_REQUIRED"
    };
  }

  if (requestedId && getVaultById(registry, vaultId)) {
    return {
      statusCode: 409,
      error: "VAULT_ALREADY_EXISTS"
    };
  }

  const nextRegistry = {
    ...registry,
    vaults: [
      ...registry.vaults,
      {
        id: vaultId,
        name,
        ownerUserId,
        createdAt: now(),
        updatedAt: now(),
        lastRevision: null,
        lastSyncAt: null
      }
    ]
  };

  await writeRegistry(nextRegistry);
  await writeVaultEnvelope(vaultId, createEmptyEnvelope());
  await writeVaultJournal(vaultId, []);

  return {
    statusCode: 201,
    nextRegistry,
    vault: buildVaultList(nextRegistry).find((vault) => vault.id === vaultId)
  };
}

async function deleteVaultRecord(registry, vaultId) {
  const vault = getVaultById(registry, vaultId);

  if (!vault) {
    return {
      statusCode: 404,
      error: "VAULT_NOT_FOUND"
    };
  }

  const nextRegistry = {
    ...registry,
    vaults: registry.vaults.filter((entry) => entry.id !== vaultId),
    tokens: registry.tokens.filter((entry) => entry.vaultId !== vaultId)
  };

  await writeRegistry(nextRegistry);
  await rm(getVaultStateFile(vaultId), {
    force: true
  });
  await rm(getVaultJournalFile(vaultId), {
    force: true
  });

  return {
    statusCode: 200,
    nextRegistry,
    vaultId
  };
}

async function createUserRecord(registry, payload, options = {}) {
  const allowCustomId = options.allowCustomId === true;
  const requireCredentials = options.requireCredentials === true;
  const requestedId = allowCustomId ? sanitizeUserId(payload?.id ?? "") : "";
  const name = sanitizeDisplayName(payload?.name, options.defaultName ?? "New user space");
  const email = normalizeEmail(payload?.email);
  const password = typeof payload?.password === "string" ? payload.password : "";

  if (email) {
    if (!isValidEmail(email)) {
      return {
        statusCode: 400,
        error: "INVALID_EMAIL"
      };
    }

    if (findUserByEmail(registry, email)) {
      return {
        statusCode: 409,
        error: "EMAIL_ALREADY_EXISTS"
      };
    }
  }

  if (requireCredentials) {
    if (!email) {
      return {
        statusCode: 400,
        error: "EMAIL_REQUIRED"
      };
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        statusCode: 400,
        error: "PASSWORD_TOO_SHORT"
      };
    }
  }

  const userId =
    requestedId ||
    buildAvailableId(deriveUserId(name), (value) => Boolean(getUserById(registry, value)), "user");

  if (!userId) {
    return {
      statusCode: 400,
      error: "USER_ID_REQUIRED"
    };
  }

  if (requestedId && getUserById(registry, userId)) {
    return {
      statusCode: 409,
      error: "USER_ALREADY_EXISTS"
    };
  }

  const nextUser = {
    id: userId,
    name,
    email: email || null,
    passwordHash: password ? hashPassword(password) : null,
    role: "member",
    createdAt: now(),
    updatedAt: now(),
    lastLoginAt: null
  };
  const nextRegistry = {
    ...registry,
    users: [...registry.users, nextUser]
  };

  await writeRegistry(nextRegistry);

  return {
    statusCode: 201,
    nextRegistry,
    user: buildPublicUser(nextUser)
  };
}

async function createSessionForUser(registry, userId) {
  const timestamp = now();
  const tokenValue = createSessionTokenValue();
  const nextSession = {
    id: randomUUID(),
    userId,
    tokenHash: hashToken(tokenValue),
    createdAt: timestamp,
    lastUsedAt: timestamp,
    expiresAt: timestamp + SESSION_TTL_MS
  };
  const nextRegistry = {
    ...pruneExpiredSessions(registry),
    users: registry.users.map((user) =>
      user.id === userId
        ? {
            ...user,
            updatedAt: timestamp,
            lastLoginAt: timestamp
          }
        : user
    ),
    sessions: [...pruneExpiredSessions(registry).sessions, nextSession]
  };

  await writeRegistry(nextRegistry);

  return {
    nextRegistry,
    token: tokenValue,
    session: {
      id: nextSession.id,
      createdAt: nextSession.createdAt,
      expiresAt: nextSession.expiresAt
    },
    user: buildPublicUser(getUserById(nextRegistry, userId))
  };
}

async function removeSession(registry, sessionId) {
  const nextRegistry = {
    ...registry,
    sessions: registry.sessions.filter((session) => session.id !== sessionId)
  };

  await writeRegistry(nextRegistry);
  return nextRegistry;
}

async function getAuthenticatedAccountContext(registry, request) {
  const tokenValue = getBearerToken(request);

  if (!tokenValue) {
    return null;
  }

  const session = getAuthorizedSessionRecord(registry, tokenValue);

  if (!session) {
    return null;
  }

  const user = getUserById(registry, session.userId);

  if (!user) {
    return null;
  }

  const nextRegistry = await markSessionUsed(registry, session.id);

  return {
    registry: nextRegistry,
    session: nextRegistry.sessions.find((entry) => entry.id === session.id) ?? session,
    user: getUserById(nextRegistry, user.id) ?? user
  };
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "INVALID_REQUEST" });
      return;
    }

    if (request.method === "OPTIONS") {
      sendCorsNoContent(response);
      return;
    }

    const registry = await ensureInitialized();
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        mode: "cloud",
        userCount: registry.users.length,
        vaultCount: registry.vaults.length,
        sessionCount: registry.sessions.length
      });
      return;
    }

    if (pathname === "/v1/capabilities" && request.method === "GET") {
      sendJson(response, 200, {
        mode: "cloud",
        product: "Zen Sync Cloud",
        features: {
          selfHosted: true,
          hostedAccounts: true,
          adminUi: true,
          accountPortal: true,
          multiUser: true,
          multiVault: true,
          standaloneRegistry: true,
          deltaSync: true
        }
      });
      return;
    }

    if (pathname === "/admin" || pathname === "/admin/") {
      await serveStaticAsset(response, ADMIN_DIR, "index.html", "text/html; charset=utf-8");
      return;
    }

    if (pathname === "/admin/app.js") {
      await serveStaticAsset(response, ADMIN_DIR, "app.js", "text/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/admin/styles.css") {
      await serveStaticAsset(response, ADMIN_DIR, "styles.css", "text/css; charset=utf-8");
      return;
    }

    if (pathname === "/account" || pathname === "/account/") {
      await serveStaticAsset(response, ACCOUNT_DIR, "index.html", "text/html; charset=utf-8");
      return;
    }

    if (pathname === "/account/app.js") {
      await serveStaticAsset(response, ACCOUNT_DIR, "app.js", "text/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/account/styles.css") {
      await serveStaticAsset(response, ACCOUNT_DIR, "styles.css", "text/css; charset=utf-8");
      return;
    }

    if (pathname === "/v1/auth/register" && request.method === "POST") {
      const payload = await collectBody(request);
      const created = await createUserRecord(registry, payload, {
        allowCustomId: false,
        requireCredentials: true,
        defaultName: "New account"
      });

      if (created.error) {
        sendJson(response, created.statusCode, { error: created.error });
        return;
      }

      const session = await createSessionForUser(created.nextRegistry, created.user.id);

      sendJson(response, 201, {
        user: session.user,
        session: {
          ...session.session,
          token: session.token
        }
      });
      return;
    }

    if (pathname === "/v1/auth/login" && request.method === "POST") {
      const payload = await collectBody(request);
      const email = normalizeEmail(payload?.email);
      const password = typeof payload?.password === "string" ? payload.password : "";

      if (!email || !password) {
        sendJson(response, 400, { error: "EMAIL_AND_PASSWORD_REQUIRED" });
        return;
      }

      const user = findUserByEmail(registry, email);

      if (!user || !verifyPassword(password, user.passwordHash)) {
        sendJson(response, 401, { error: "INVALID_CREDENTIALS" });
        return;
      }

      const session = await createSessionForUser(registry, user.id);

      sendJson(response, 200, {
        user: session.user,
        session: {
          ...session.session,
          token: session.token
        }
      });
      return;
    }

    if (pathname === "/v1/auth/logout" && request.method === "POST") {
      const context = await getAuthenticatedAccountContext(registry, request);

      if (!context) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      await removeSession(context.registry, context.session.id);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (pathname === "/v1/auth/me" && request.method === "GET") {
      const context = await getAuthenticatedAccountContext(registry, request);

      if (!context) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      sendJson(response, 200, {
        user: buildPublicUser(context.user),
        session: {
          id: context.session.id,
          createdAt: context.session.createdAt,
          expiresAt: context.session.expiresAt
        },
        vaultCount: buildOwnedVaultList(context.registry, context.user.id).length
      });
      return;
    }

    if (pathname === "/v1/account/vaults" && request.method === "GET") {
      const context = await getAuthenticatedAccountContext(registry, request);

      if (!context) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      sendJson(response, 200, {
        user: buildPublicUser(context.user),
        vaults: buildOwnedVaultList(context.registry, context.user.id)
      });
      return;
    }

    if (pathname === "/v1/account/vaults" && request.method === "POST") {
      const context = await getAuthenticatedAccountContext(registry, request);

      if (!context) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const payload = await collectBody(request);
      const created = await createVaultRecord(context.registry, {
        ...payload,
        ownerUserId: context.user.id
      });

      if (created.error) {
        sendJson(response, created.statusCode, { error: created.error });
        return;
      }

      sendJson(response, created.statusCode, {
        vault: created.vault
      });
      return;
    }

    const accountVaultMatch = pathname.match(/^\/v1\/account\/vaults\/([a-z0-9-_]{1,64})$/i);

    if (accountVaultMatch && request.method === "DELETE") {
      const context = await getAuthenticatedAccountContext(registry, request);

      if (!context) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const vaultId = sanitizeVaultId(accountVaultMatch[1]);
      const vault = getVaultById(context.registry, vaultId);

      if (!vault || !isVaultOwnedByUser(vault, context.user.id)) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      const removed = await deleteVaultRecord(context.registry, vaultId);

      if (removed.error) {
        sendJson(response, removed.statusCode, {
          error: removed.error
        });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        vaultId: removed.vaultId
      });
      return;
    }

    const accountVaultTokenMatch = pathname.match(/^\/v1\/account\/vaults\/([a-z0-9-_]{1,64})\/tokens$/i);

    if (accountVaultTokenMatch && request.method === "GET") {
      const context = await getAuthenticatedAccountContext(registry, request);

      if (!context) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const vaultId = sanitizeVaultId(accountVaultTokenMatch[1]);
      const vault = getVaultById(context.registry, vaultId);

      if (!vault || !isVaultOwnedByUser(vault, context.user.id)) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      sendJson(response, 200, {
        vault: buildOwnedVaultList(context.registry, context.user.id).find((entry) => entry.id === vaultId) ?? null,
        tokens: listVaultTokens(context.registry, vaultId)
      });
      return;
    }

    if (accountVaultTokenMatch && request.method === "POST") {
      const context = await getAuthenticatedAccountContext(registry, request);

      if (!context) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const vaultId = sanitizeVaultId(accountVaultTokenMatch[1]);
      const vault = getVaultById(context.registry, vaultId);

      if (!vault || !isVaultOwnedByUser(vault, context.user.id)) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      const payload = await collectBody(request);
      const issued = await issueVaultToken(context.registry, vaultId, payload?.label);

      if (issued.error) {
        sendJson(response, issued.statusCode, { error: issued.error });
        return;
      }

      sendJson(response, issued.statusCode, {
        token: issued.token,
        tokenMeta: issued.tokenMeta
      });
      return;
    }

    if (pathname === "/v1/admin/users" && request.method === "GET") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      sendJson(response, 200, {
        users: buildUserList(registry)
      });
      return;
    }

    if (pathname === "/v1/admin/users" && request.method === "POST") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const payload = await collectBody(request);
      const created = await createUserRecord(registry, payload, {
        allowCustomId: true,
        requireCredentials: false,
        defaultName: "New user space"
      });

      if (created.error) {
        sendJson(response, created.statusCode, { error: created.error });
        return;
      }

      sendJson(response, created.statusCode, {
        user: buildUserList(created.nextRegistry).find((user) => user.id === created.user.id)
      });
      return;
    }

    if (pathname === "/v1/admin/vaults" && request.method === "GET") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      sendJson(response, 200, {
        vaults: buildVaultList(registry)
      });
      return;
    }

    if (pathname === "/v1/admin/vaults" && request.method === "POST") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const payload = await collectBody(request);
      const created = await createVaultRecord(registry, payload);

      if (created.error) {
        sendJson(response, created.statusCode, { error: created.error });
        return;
      }

      sendJson(response, created.statusCode, {
        vault: created.vault
      });
      return;
    }

    const userVaultMatch = pathname.match(/^\/v1\/admin\/users\/([a-z0-9-_]{1,64})\/vaults$/i);

    if (userVaultMatch && request.method === "GET") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const userId = sanitizeUserId(userVaultMatch[1]);
      const user = getUserById(registry, userId);

      if (!user) {
        sendJson(response, 404, { error: "USER_NOT_FOUND" });
        return;
      }

      sendJson(response, 200, {
        user: buildPublicUser(user),
        vaults: buildOwnedVaultList(registry, userId)
      });
      return;
    }

    if (userVaultMatch && request.method === "POST") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const userId = sanitizeUserId(userVaultMatch[1]);

      if (!getUserById(registry, userId)) {
        sendJson(response, 404, { error: "USER_NOT_FOUND" });
        return;
      }

      const payload = await collectBody(request);
      const created = await createVaultRecord(registry, {
        ...payload,
        ownerUserId: userId
      });

      if (created.error) {
        sendJson(response, created.statusCode, { error: created.error });
        return;
      }

      sendJson(response, created.statusCode, {
        vault: created.vault
      });
      return;
    }

    const vaultTokenMatch = pathname.match(/^\/v1\/admin\/vaults\/([a-z0-9-_]{1,64})\/tokens$/i);

    if (vaultTokenMatch && request.method === "GET") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const vaultId = sanitizeVaultId(vaultTokenMatch[1]);

      if (!getVaultById(registry, vaultId)) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      sendJson(response, 200, {
        tokens: listVaultTokens(registry, vaultId)
      });
      return;
    }

    if (vaultTokenMatch && request.method === "POST") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const vaultId = sanitizeVaultId(vaultTokenMatch[1]);
      const payload = await collectBody(request);
      const issued = await issueVaultToken(registry, vaultId, payload?.label);

      if (issued.error) {
        sendJson(response, issued.statusCode, { error: issued.error });
        return;
      }

      sendJson(response, issued.statusCode, {
        token: issued.token,
        tokenMeta: issued.tokenMeta
      });
      return;
    }

    const changesMatch = pathname.match(/^\/v1\/vaults\/([a-z0-9-_]{1,64})\/changes$/i);
    const legacyDefaultChangesRoute = pathname === "/v1/changes" ? ["", "default"] : null;
    const changesVaultId = sanitizeVaultId(changesMatch?.[1] ?? legacyDefaultChangesRoute?.[1] ?? "");

    if (changesVaultId && (request.method === "GET" || request.method === "POST")) {
      const vault = getVaultById(registry, changesVaultId);

      if (!vault) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      const tokenValue = getBearerToken(request);
      const tokenRecord = tokenValue ? getAuthorizedTokenRecord(registry, changesVaultId, tokenValue) : null;

      if (!tokenRecord) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const registryWithUsage = await markTokenUsed(registry, tokenRecord.id);
      const currentEnvelope = await readVaultEnvelope(changesVaultId);

      if (request.method === "GET") {
        if (currentEnvelope.metadata?.payloadMode === "encrypted") {
          sendJson(response, 200, buildSnapshotFallbackFeed(currentEnvelope));
          return;
        }

        const sinceRevision = url.searchParams.get("since")?.trim() ?? "";

        if (!sinceRevision || !currentEnvelope.revision) {
          sendJson(response, 200, buildSnapshotFallbackFeed(currentEnvelope));
          return;
        }

        if (sinceRevision === currentEnvelope.revision) {
          sendJson(response, 200, {
            mode: "delta",
            revision: currentEnvelope.revision,
            baseRevision: sinceRevision,
            changes: createEmptyChangeSet("server"),
            snapshot: null
          });
          return;
        }

        const journal = await readVaultJournal(changesVaultId);
        const cursorIndex = journal.findIndex((entry) => entry.revision === sinceRevision);

        if (cursorIndex === -1) {
          sendJson(response, 200, buildSnapshotFallbackFeed(currentEnvelope));
          return;
        }

        sendJson(response, 200, {
          mode: "delta",
          revision: currentEnvelope.revision,
          baseRevision: sinceRevision,
          changes: collapseChangeSets(journal.slice(cursorIndex + 1).map((entry) => entry.changes)),
          snapshot: null
        });
        return;
      }

      const payload = await collectBody(request);
      const baseRevision =
        payload && typeof payload === "object" && "baseRevision" in payload
          ? payload.baseRevision ?? null
          : null;
      const rawChanges =
        payload && typeof payload === "object" && "changes" in payload ? payload.changes : null;
      const changes = normalizeChangeSet(rawChanges, "server");

      if (currentEnvelope.metadata?.payloadMode === "encrypted") {
        sendJson(response, 409, {
          error: "DELTA_SYNC_UNAVAILABLE",
          revision: currentEnvelope.revision
        });
        return;
      }

      if (currentEnvelope.revision !== baseRevision) {
        sendJson(response, 409, {
          error: "SYNC_REVISION_CONFLICT",
          revision: currentEnvelope.revision
        });
        return;
      }

      if (isChangeSetEmpty(changes)) {
        sendJson(response, 200, {
          revision: currentEnvelope.revision
        });
        return;
      }

      const nextSnapshot = applyChangeSetToSnapshot(currentEnvelope.snapshot, changes);
      const nextEnvelope = {
        ...currentEnvelope,
        revision: `rev-${Date.now()}-${randomUUID()}`,
        snapshot: {
          ...nextSnapshot,
          exportedAt: Date.now()
        }
      };

      await writeVaultEnvelope(changesVaultId, nextEnvelope);
      await appendVaultJournalEntry(changesVaultId, {
        revision: nextEnvelope.revision,
        baseRevision,
        createdAt: now(),
        changes: {
          ...changes,
          exportedAt: nextEnvelope.snapshot.exportedAt
        }
      });
      await updateVaultMeta(registryWithUsage, changesVaultId, {
        lastRevision: nextEnvelope.revision,
        lastSyncAt: Date.now()
      });

      sendJson(response, 200, {
        revision: nextEnvelope.revision
      });
      return;
    }

    const stateMatch = pathname.match(/^\/v1\/vaults\/([a-z0-9-_]{1,64})\/state$/i);
    const legacyDefaultStateRoute = pathname === "/v1/state" ? ["", "default"] : null;
    const stateVaultId = sanitizeVaultId(stateMatch?.[1] ?? legacyDefaultStateRoute?.[1] ?? "");

    if (stateVaultId && (request.method === "GET" || request.method === "PUT")) {
      const vault = getVaultById(registry, stateVaultId);

      if (!vault) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      const tokenValue = getBearerToken(request);
      const tokenRecord = tokenValue ? getAuthorizedTokenRecord(registry, stateVaultId, tokenValue) : null;

      if (!tokenRecord) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const registryWithUsage = await markTokenUsed(registry, tokenRecord.id);
      await handleOptimisticSyncRoute({
        request,
        response,
        readEnvelope: () => readVaultEnvelope(stateVaultId),
        writeEnvelope: (envelope) => writeVaultEnvelope(stateVaultId, envelope),
        onAfterWrite: async (envelope, previousEnvelope) => {
          if (isEncryptedEnvelope(envelope) || isEncryptedEnvelope(previousEnvelope)) {
            await writeVaultJournal(stateVaultId, []);
            await updateVaultMeta(registryWithUsage, stateVaultId, {
              lastRevision: envelope.revision,
              lastSyncAt: Date.now()
            });
            return;
          }

          const changeSet = buildChangeSetFromSnapshots(previousEnvelope?.snapshot, envelope.snapshot);

          if (!isChangeSetEmpty(changeSet)) {
            await appendVaultJournalEntry(stateVaultId, {
              revision: envelope.revision,
              baseRevision: previousEnvelope?.revision ?? null,
              createdAt: now(),
              changes: changeSet
            });
          }

          await updateVaultMeta(registryWithUsage, stateVaultId, {
            lastRevision: envelope.revision,
            lastSyncAt: Date.now()
          });
        }
      });
      return;
    }

    sendJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SERVER_ERROR";
    sendJson(response, 500, { error: message });
  }
});

await ensureInitialized();

server.listen(PORT, () => {
  console.log(`Zen Sync Cloud listening on http://localhost:${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Admin UI: http://localhost:${PORT}/admin`);
  console.log(`Account UI: http://localhost:${PORT}/account`);
});
