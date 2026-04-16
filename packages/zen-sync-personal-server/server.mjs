import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectBody,
  createEmptyEnvelope,
  ensureDir,
  fileExists,
  getBearerToken,
  handleOptimisticSyncRoute,
  now,
  readJsonFile,
  sendCorsNoContent,
  sendJson,
  sendText,
  serveStaticAsset,
  writeJsonFile
} from "../zen-sync-server-core/common.mjs";

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SYNC_DATA_DIR
  ? path.resolve(process.env.SYNC_DATA_DIR)
  : path.join(SERVER_DIR, ".data");
const STATIC_DIR = path.join(SERVER_DIR, "public");
const PERSONAL_CONFIG_FILE = path.join(DATA_DIR, "personal-config.json");
const PERSONAL_REGISTRY_FILE = path.join(DATA_DIR, "registry.json");
const VAULTS_DIR = path.join(DATA_DIR, "vaults");
const LEGACY_SYNC_TOKEN = String(process.env.SYNC_TOKEN ?? "").trim();
const ENV_MANAGEMENT_TOKEN = String(process.env.SYNC_MANAGEMENT_TOKEN ?? "").trim();

function sanitizeVaultId(rawValue) {
  const candidate = String(rawValue ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return candidate;
}

function sanitizeDisplayName(rawValue, fallbackValue) {
  const candidate = String(rawValue ?? "").trim().slice(0, 120);
  return candidate || fallbackValue;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createManagementToken() {
  return `zpm_${randomUUID().replace(/-/g, "")}`;
}

function createVaultSyncToken(vaultId) {
  return `zpt_${vaultId}_${randomUUID().replace(/-/g, "")}`;
}

function createEmptyRegistry() {
  return {
    schemaVersion: 1,
    vaults: [],
    tokens: []
  };
}

function getVaultStateFile(vaultId) {
  return path.join(VAULTS_DIR, `${vaultId}.json`);
}

function buildVaultList(registry) {
  return registry.vaults
    .map((vault) => ({
      ...vault,
      tokenCount: registry.tokens.filter((token) => token.vaultId === vault.id).length
    }))
    .sort((left, right) => left.createdAt - right.createdAt);
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

async function readConfig() {
  const parsed = await readJsonFile(PERSONAL_CONFIG_FILE, null);

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return parsed;
}

async function writeConfig(config) {
  await writeJsonFile(PERSONAL_CONFIG_FILE, config);
}

async function readRegistry() {
  const parsed = await readJsonFile(PERSONAL_REGISTRY_FILE, createEmptyRegistry());
  const timestamp = now();

  return {
    schemaVersion: 1,
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
              createdAt: typeof vault.createdAt === "number" ? vault.createdAt : timestamp,
              updatedAt: typeof vault.updatedAt === "number" ? vault.updatedAt : timestamp,
              lastRevision: typeof vault.lastRevision === "string" ? vault.lastRevision : null,
              lastSyncAt: typeof vault.lastSyncAt === "number" ? vault.lastSyncAt : null
            };
          })
          .filter(Boolean)
      : [],
    tokens: Array.isArray(parsed.tokens)
      ? parsed.tokens
          .map((entry) => {
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
              createdAt: typeof token.createdAt === "number" ? token.createdAt : timestamp,
              lastUsedAt: typeof token.lastUsedAt === "number" ? token.lastUsedAt : null
            };
          })
          .filter(Boolean)
      : []
  };
}

async function writeRegistry(registry) {
  await writeJsonFile(PERSONAL_REGISTRY_FILE, registry);
}

async function readVaultEnvelope(vaultId) {
  const parsed = await readJsonFile(getVaultStateFile(vaultId), createEmptyEnvelope());

  return {
    revision: typeof parsed.revision === "string" ? parsed.revision : null,
    snapshot:
      parsed.snapshot && typeof parsed.snapshot === "object"
        ? parsed.snapshot
        : createEmptyEnvelope().snapshot
  };
}

async function writeVaultEnvelope(vaultId, envelope) {
  await writeJsonFile(getVaultStateFile(vaultId), envelope);
}

async function ensureDefaultVaultState(vaultId) {
  if (!(await fileExists(getVaultStateFile(vaultId)))) {
    await writeVaultEnvelope(vaultId, createEmptyEnvelope());
  }
}

async function ensureInitialized() {
  await ensureDir(DATA_DIR);
  await ensureDir(VAULTS_DIR);

  const timestamp = now();
  const storedConfig = await readConfig();
  const legacyVaultId =
    storedConfig && typeof storedConfig.vaultId === "string" ? sanitizeVaultId(storedConfig.vaultId) : "";
  const defaultVaultId = legacyVaultId || "default";
  const defaultVaultName =
    storedConfig && typeof storedConfig.defaultVaultName === "string"
      ? sanitizeDisplayName(storedConfig.defaultVaultName, "Default vault")
      : "Default vault";
  const managementToken =
    ENV_MANAGEMENT_TOKEN ||
    (storedConfig && typeof storedConfig.managementToken === "string"
      ? String(storedConfig.managementToken).trim()
      : "") ||
    createManagementToken();

  let registry = await readRegistry();
  let changed = false;

  if (!registry.vaults.some((vault) => vault.id === defaultVaultId)) {
    registry = {
      ...registry,
      vaults: [
        ...registry.vaults,
        {
          id: defaultVaultId,
          name: defaultVaultName,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastRevision: null,
          lastSyncAt: null
        }
      ]
    };
    changed = true;
  }

  const legacyVaultToken =
    LEGACY_SYNC_TOKEN ||
    (storedConfig && typeof storedConfig.token === "string" ? String(storedConfig.token).trim() : "");

  if (legacyVaultToken) {
    const legacyHash = hashToken(legacyVaultToken);
    const hasLegacyToken = registry.tokens.some(
      (token) => token.vaultId === defaultVaultId && token.tokenHash === legacyHash
    );

    if (!hasLegacyToken) {
      registry = {
        ...registry,
        tokens: [
          ...registry.tokens,
          {
            id: `legacy-${defaultVaultId}`,
            vaultId: defaultVaultId,
            label: "Legacy default token",
            tokenHash: legacyHash,
            createdAt: timestamp,
            lastUsedAt: null
          }
        ]
      };
      changed = true;
    }
  } else {
    const defaultTokenExists = registry.tokens.some((token) => token.vaultId === defaultVaultId);

    if (!defaultTokenExists) {
      const tokenValue = createVaultSyncToken(defaultVaultId);
      registry = {
        ...registry,
        tokens: [
          ...registry.tokens,
          {
            id: randomUUID(),
            vaultId: defaultVaultId,
            label: "Default vault token",
            tokenHash: hashToken(tokenValue),
            createdAt: timestamp,
            lastUsedAt: null
          }
        ]
      };
      await writeConfig({
        mode: "personal",
        managementToken,
        defaultVaultId,
        defaultVaultName,
        token: tokenValue,
        createdAt:
          storedConfig && typeof storedConfig.createdAt === "number" ? storedConfig.createdAt : timestamp,
        updatedAt: timestamp
      });
      changed = true;
    }
  }

  if (changed) {
    await writeRegistry(registry);
  }

  await ensureDefaultVaultState(defaultVaultId);

  const config = {
    mode: "personal",
    managementToken,
    defaultVaultId,
    defaultVaultName,
    createdAt:
      storedConfig && typeof storedConfig.createdAt === "number" ? storedConfig.createdAt : timestamp,
    updatedAt: timestamp
  };

  await writeConfig(config);

  return {
    config,
    registry: changed ? await readRegistry() : registry
  };
}

function getAuthorizedManagement(config, request) {
  return getBearerToken(request) === config.managementToken;
}

function getAuthorizedTokenRecord(registry, vaultId, tokenValue) {
  const tokenHash = hashToken(tokenValue);
  return (
    registry.tokens.find((token) => token.vaultId === vaultId && token.tokenHash === tokenHash) ?? null
  );
}

function getVaultById(registry, vaultId) {
  return registry.vaults.find((vault) => vault.id === vaultId) ?? null;
}

async function markTokenUsed(registry, tokenId) {
  const token = registry.tokens.find((entry) => entry.id === tokenId);

  if (token && (token.lastUsedAt ?? 0) > now() - 60_000) {
    return registry;
  }

  const nextRegistry = {
    ...registry,
    tokens: registry.tokens.map((entry) =>
      entry.id === tokenId
        ? {
            ...entry,
            lastUsedAt: now()
          }
        : entry
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

async function createVaultRecord(registry, payload) {
  const name = sanitizeDisplayName(payload?.name, "New vault");
  const requestedId = sanitizeVaultId(payload?.id ?? "");
  const vaultId = requestedId || sanitizeVaultId(name) || `vault-${randomUUID().slice(0, 8)}`;

  if (registry.vaults.some((vault) => vault.id === vaultId)) {
    return {
      statusCode: 409,
      error: "VAULT_ALREADY_EXISTS"
    };
  }

  const timestamp = now();
  const nextRegistry = {
    ...registry,
    vaults: [
      ...registry.vaults,
      {
        id: vaultId,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastRevision: null,
        lastSyncAt: null
      }
    ]
  };

  await writeRegistry(nextRegistry);
  await ensureDefaultVaultState(vaultId);

  return {
    statusCode: 201,
    nextRegistry,
    vault: buildVaultList(nextRegistry).find((vault) => vault.id === vaultId) ?? null
  };
}

async function issueVaultToken(registry, vaultId, labelValue) {
  if (!getVaultById(registry, vaultId)) {
    return {
      statusCode: 404,
      error: "VAULT_NOT_FOUND"
    };
  }

  const tokenValue = createVaultSyncToken(vaultId);
  const nextToken = {
    id: randomUUID(),
    vaultId,
    label: sanitizeDisplayName(labelValue, "Client token"),
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

function renderSetupPage(config, registry) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Zen Sync Personal</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <span class="eyebrow">Zen Sync Personal</span>
        <h1>Personal self-hosted sync for one owner with many vaults.</h1>
        <p>
          This runtime stays minimal and local-first, but it can now host multiple remote vaults on
          one personal server. The app manages vault bindings through a single management token.
        </p>
      </section>

      <section class="card">
        <h2>Server setup</h2>
        <dl class="details">
          <div>
            <dt>Mode</dt>
            <dd>Single-user multi-vault</dd>
          </div>
          <div>
            <dt>Default vault</dt>
            <dd><code>${config.defaultVaultId}</code></dd>
          </div>
          <div>
            <dt>Management token</dt>
            <dd>Stored in <code>${PERSONAL_CONFIG_FILE}</code> and used by the app to create/list remote vaults.</dd>
          </div>
          <div>
            <dt>Vault count</dt>
            <dd>${registry.vaults.length}</dd>
          </div>
        </dl>
      </section>

      <section class="card">
        <h2>What the app can do</h2>
        <ul class="feature-list">
          <li>List remote vaults on this personal server</li>
          <li>Create separate remote vaults for local vaults</li>
          <li>Issue per-vault sync tokens</li>
          <li>Keep vault snapshots isolated instead of merging everything into one blob</li>
        </ul>
      </section>
    </main>
  </body>
</html>`;
}

const bootstrap = await ensureInitialized();

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

    const { config } = await ensureInitialized();
    const registry = await readRegistry();
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/" && request.method === "GET") {
      sendText(response, 200, "text/html; charset=utf-8", renderSetupPage(config, registry));
      return;
    }

    if (pathname === "/styles.css" && request.method === "GET") {
      await serveStaticAsset(response, STATIC_DIR, "styles.css", "text/css; charset=utf-8");
      return;
    }

    if (pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        mode: "personal",
        defaultVaultId: config.defaultVaultId,
        vaultCount: registry.vaults.length
      });
      return;
    }

    if (pathname === "/v1/capabilities" && request.method === "GET") {
      sendJson(response, 200, {
        mode: "personal",
        product: "Zen Sync Personal",
        features: {
          selfHosted: true,
          hostedAccounts: false,
          adminUi: false,
          accountPortal: false,
          multiUser: false,
          multiVault: true,
          standaloneRegistry: true,
          managementApi: true
        },
        defaultVaultId: config.defaultVaultId
      });
      return;
    }

    if (pathname === "/v1/personal/vaults" && request.method === "GET") {
      if (!getAuthorizedManagement(config, request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      sendJson(response, 200, {
        vaults: buildVaultList(registry)
      });
      return;
    }

    if (pathname === "/v1/personal/vaults" && request.method === "POST") {
      if (!getAuthorizedManagement(config, request)) {
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

    const personalVaultTokenMatch = pathname.match(/^\/v1\/personal\/vaults\/([a-z0-9-_]{1,64})\/tokens$/i);

    if (personalVaultTokenMatch && request.method === "GET") {
      if (!getAuthorizedManagement(config, request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const vaultId = sanitizeVaultId(personalVaultTokenMatch[1]);

      if (!getVaultById(registry, vaultId)) {
        sendJson(response, 404, { error: "VAULT_NOT_FOUND" });
        return;
      }

      sendJson(response, 200, {
        tokens: registry.tokens
          .filter((token) => token.vaultId === vaultId)
          .map(buildTokenMeta)
          .sort((left, right) => left.createdAt - right.createdAt)
      });
      return;
    }

    if (personalVaultTokenMatch && request.method === "POST") {
      if (!getAuthorizedManagement(config, request)) {
        sendJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const vaultId = sanitizeVaultId(personalVaultTokenMatch[1]);
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

    const stateMatch = pathname.match(/^\/v1\/vaults\/([a-z0-9-_]{1,64})\/state$/i);
    const legacyDefaultStateRoute = pathname === "/v1/state" ? ["", config.defaultVaultId] : null;
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
        onAfterWrite: async (envelope) => {
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

server.listen(PORT, () => {
  console.log(`Zen Sync Personal listening on http://localhost:${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Default vault: ${bootstrap.config.defaultVaultId}`);
  console.log(`Management token: ${bootstrap.config.managementToken}`);
});
