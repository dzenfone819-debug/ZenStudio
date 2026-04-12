import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const MAX_BODY_BYTES = 128 * 1024 * 1024;

function now() {
  return Date.now();
}

function createEmptySnapshot() {
  return {
    deviceId: "server",
    exportedAt: 0,
    projects: [],
    folders: [],
    tags: [],
    notes: [],
    assets: [],
    tombstones: []
  };
}

function createEmptyEnvelope() {
  return {
    revision: null,
    snapshot: createEmptySnapshot()
  };
}

function createEmptyRegistry() {
  return {
    schemaVersion: 1,
    vaults: [],
    tokens: []
  };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function getBearerToken(request) {
  const authHeader = request.headers.authorization ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }

  return authHeader.slice("Bearer ".length).trim();
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

function deriveVaultId(name) {
  const derived = sanitizeVaultId(name);
  return derived || `vault-${randomUUID().slice(0, 8)}`;
}

function getVaultStateFile(vaultId) {
  return path.join(VAULTS_DIR, `${vaultId}.json`);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDataDirs() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(VAULTS_DIR, { recursive: true });
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readRegistry() {
  const parsed = await readJsonFile(REGISTRY_FILE, createEmptyRegistry());

  return {
    schemaVersion: 1,
    vaults: Array.isArray(parsed.vaults) ? parsed.vaults : [],
    tokens: Array.isArray(parsed.tokens) ? parsed.tokens : []
  };
}

async function writeRegistry(registry) {
  await writeJsonFile(REGISTRY_FILE, registry);
}

async function readVaultEnvelope(vaultId) {
  const parsed = await readJsonFile(getVaultStateFile(vaultId), createEmptyEnvelope());

  return {
    revision: typeof parsed.revision === "string" ? parsed.revision : null,
    snapshot: parsed.snapshot && typeof parsed.snapshot === "object" ? parsed.snapshot : createEmptySnapshot()
  };
}

async function writeVaultEnvelope(vaultId, envelope) {
  await writeJsonFile(getVaultStateFile(vaultId), envelope);
}

async function migrateLegacySingleVault(registry) {
  const defaultVaultId = "default";
  const defaultVaultExists = registry.vaults.some((vault) => vault.id === defaultVaultId);
  const legacyExists = await fileExists(LEGACY_STATE_FILE);
  const defaultVaultFileExists = await fileExists(getVaultStateFile(defaultVaultId));
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

  if (changed) {
    await writeRegistry(nextRegistry);
  }

  return nextRegistry;
}

async function ensureInitialized() {
  await ensureDataDirs();
  const registry = await readRegistry();
  return migrateLegacySingleVault(registry);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, contentType, payload) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(payload);
}

function isAdminAuthorized(request) {
  return getBearerToken(request) === ADMIN_TOKEN;
}

function getVaultById(registry, vaultId) {
  return registry.vaults.find((vault) => vault.id === vaultId) ?? null;
}

function getAuthorizedTokenRecord(registry, vaultId, tokenValue) {
  const tokenHash = hashToken(tokenValue);
  return (
    registry.tokens.find((token) => token.vaultId === vaultId && token.tokenHash === tokenHash) ?? null
  );
}

async function markTokenUsed(registry, tokenId) {
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

function collectBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

async function serveAdminAsset(response, relativePath, contentType) {
  const payload = await readFile(path.join(ADMIN_DIR, relativePath), "utf8");
  sendText(response, 200, contentType, payload);
}

function buildVaultList(registry) {
  return registry.vaults
    .map((vault) => ({
      ...vault,
      tokenCount: registry.tokens.filter((token) => token.vaultId === vault.id).length
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createTokenValue(vaultId) {
  return `znt_${vaultId}_${randomUUID().replace(/-/g, "")}`;
}

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "INVALID_REQUEST" });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS"
      });
      response.end();
      return;
    }

    const registry = await ensureInitialized();
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        vaultCount: registry.vaults.length
      });
      return;
    }

    if (pathname === "/admin" || pathname === "/admin/") {
      await serveAdminAsset(response, "index.html", "text/html; charset=utf-8");
      return;
    }

    if (pathname === "/admin/app.js") {
      await serveAdminAsset(response, "app.js", "text/javascript; charset=utf-8");
      return;
    }

    if (pathname === "/admin/styles.css") {
      await serveAdminAsset(response, "styles.css", "text/css; charset=utf-8");
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
      const requestedId = sanitizeVaultId(payload?.id ?? "");
      const name = String(payload?.name ?? "").trim() || "New vault";
      const vaultId = requestedId || deriveVaultId(name);

      if (!vaultId) {
        sendJson(response, 400, { error: "VAULT_ID_REQUIRED" });
        return;
      }

      if (getVaultById(registry, vaultId)) {
        sendJson(response, 409, { error: "VAULT_ALREADY_EXISTS" });
        return;
      }

      const nextRegistry = {
        ...registry,
        vaults: [
          ...registry.vaults,
          {
            id: vaultId,
            name,
            createdAt: now(),
            updatedAt: now(),
            lastRevision: null,
            lastSyncAt: null
          }
        ]
      };

      await writeRegistry(nextRegistry);
      await writeVaultEnvelope(vaultId, createEmptyEnvelope());

      sendJson(response, 201, {
        vault: buildVaultList(nextRegistry).find((vault) => vault.id === vaultId)
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
        tokens: registry.tokens
          .filter((token) => token.vaultId === vaultId)
          .map((token) => ({
            id: token.id,
            vaultId: token.vaultId,
            label: token.label,
            createdAt: token.createdAt,
            lastUsedAt: token.lastUsedAt ?? null
          }))
      });
      return;
    }

    if (vaultTokenMatch && request.method === "POST") {
      if (!isAdminAuthorized(request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const vaultId = sanitizeVaultId(vaultTokenMatch[1]);

      if (!getVaultById(registry, vaultId)) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      const payload = await collectBody(request);
      const label = String(payload?.label ?? "").trim() || "Client token";
      const tokenValue = createTokenValue(vaultId);
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

      sendJson(response, 201, {
        token: tokenValue,
        tokenMeta: {
          id: nextToken.id,
          vaultId: nextToken.vaultId,
          label: nextToken.label,
          createdAt: nextToken.createdAt,
          lastUsedAt: nextToken.lastUsedAt
        }
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

      if (request.method === "GET") {
        sendJson(response, 200, await readVaultEnvelope(stateVaultId));
        return;
      }

      const currentState = await readVaultEnvelope(stateVaultId);
      const payload = await collectBody(request);
      const baseRevision =
        payload && typeof payload === "object" && "baseRevision" in payload
          ? payload.baseRevision ?? null
          : null;
      const snapshot =
        payload && typeof payload === "object" && "snapshot" in payload && payload.snapshot
          ? payload.snapshot
          : null;

      if (!snapshot || typeof snapshot !== "object") {
        sendJson(response, 400, { error: "SNAPSHOT_REQUIRED" });
        return;
      }

      if (currentState.revision !== baseRevision) {
        sendJson(response, 409, currentState);
        return;
      }

      const nextEnvelope = {
        revision: `rev-${Date.now()}-${randomUUID()}`,
        snapshot: {
          ...snapshot,
          exportedAt: Date.now()
        }
      };

      await writeVaultEnvelope(stateVaultId, nextEnvelope);
      await updateVaultMeta(registryWithUsage, stateVaultId, {
        lastRevision: nextEnvelope.revision,
        lastSyncAt: Date.now()
      });

      sendJson(response, 200, nextEnvelope);
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
  console.log(`Zen sync server listening on http://localhost:${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Admin UI: http://localhost:${PORT}/admin`);
});
