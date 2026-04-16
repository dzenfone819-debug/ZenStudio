import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BODY_BYTES = 128 * 1024 * 1024;

export function now() {
  return Date.now();
}

export function createEmptySnapshot() {
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

export function createEmptyEnvelope() {
  return {
    revision: null,
    snapshot: createEmptySnapshot()
  };
}

export function buildNextEnvelope(snapshot) {
  return {
    revision: `rev-${Date.now()}-${randomUUID()}`,
    snapshot: {
      ...snapshot,
      exportedAt: Date.now()
    }
  };
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function readJsonFile(filePath, fallbackValue) {
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

export async function writeJsonFile(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export function getBearerToken(request) {
  const authHeader = request.headers.authorization ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }

  return authHeader.slice("Bearer ".length).trim();
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS"
  });
  response.end(JSON.stringify(payload));
}

export function sendText(response, statusCode, contentType, payload) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(payload);
}

export async function collectBody(request) {
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

export async function serveStaticAsset(response, baseDir, relativePath, contentType) {
  const payload = await readFile(path.join(baseDir, relativePath), "utf8");
  sendText(response, 200, contentType, payload);
}

export async function handleOptimisticSyncRoute({
  request,
  response,
  readEnvelope,
  writeEnvelope,
  onAfterWrite
}) {
  if (request.method === "GET") {
    sendJson(response, 200, await readEnvelope());
    return true;
  }

  const currentEnvelope = await readEnvelope();
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
    return true;
  }

  if (currentEnvelope.revision !== baseRevision) {
    sendJson(response, 409, currentEnvelope);
    return true;
  }

  const nextEnvelope = buildNextEnvelope(snapshot);
  await writeEnvelope(nextEnvelope);
  await onAfterWrite?.(nextEnvelope);

  sendJson(response, 200, nextEnvelope);
  return true;
}

export function sendCorsNoContent(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS"
  });
  response.end();
}
