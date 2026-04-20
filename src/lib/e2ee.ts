import type {
  SyncEncryptedPayload,
  SyncEncryptionCipher,
  SyncEncryptionDescriptor,
  SyncVaultDescriptor
} from "../types";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const PBKDF2_ITERATIONS = 310_000;
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12;
const ENCRYPTION_VERSION = 1 as const;
const KDF = "pbkdf2-sha256" as const;
const CIPHER: SyncEncryptionCipher = "aes-gcm-256";
const KEY_CHECK_PREFIX = "zen-sync-key-check:v1";

type DerivedKeyBundle = {
  cryptoKey: CryptoKey;
  rawKey: Uint8Array;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface EncryptSyncPayloadResult {
  descriptor: SyncEncryptionDescriptor;
  payload: SyncEncryptedPayload;
  contentHash: string;
}

function ensureCryptoSupport() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WEB_CRYPTO_UNAVAILABLE");
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });

  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array) {
  return new Uint8Array(bytes).buffer;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function normalizePassphrase(passphrase: string) {
  const value = passphrase.trim();

  if (!value) {
    throw new Error("PASSPHRASE_REQUIRED");
  }

  return value;
}

async function sha256Base64(payload: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(payload));
  return bytesToBase64(new Uint8Array(digest));
}

async function deriveKeyBundle(
  passphrase: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS
): Promise<DerivedKeyBundle> {
  ensureCryptoSupport();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(normalizePassphrase(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations
    },
    keyMaterial,
    AES_KEY_LENGTH
  );
  const rawKey = new Uint8Array(derivedBits);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    {
      name: "AES-GCM",
      length: AES_KEY_LENGTH
    },
    false,
    ["encrypt", "decrypt"]
  );

  return {
    cryptoKey,
    rawKey
  };
}

async function createKeyCheck(rawKey: Uint8Array, vaultGuid: string | null) {
  const prefix = TEXT_ENCODER.encode(`${KEY_CHECK_PREFIX}:${vaultGuid ?? "global"}`);
  const combined = new Uint8Array(prefix.length + rawKey.length);

  combined.set(prefix, 0);
  combined.set(rawKey, prefix.length);

  return sha256Base64(combined);
}

export function createPlainSyncDescriptor(vault: SyncVaultDescriptor | null = null) {
  return {
    schemaVersion: 1 as const,
    payloadMode: "plain" as const,
    vault,
    encryption: null
  };
}

export async function createEncryptionDescriptor(
  passphrase: string,
  vault: SyncVaultDescriptor | null,
  options?: {
    iterations?: number;
    keyId?: string | null;
    salt?: string | null;
  }
) {
  const saltBytes = options?.salt ? base64ToBytes(options.salt) : randomBytes(16);
  const iterations = options?.iterations ?? PBKDF2_ITERATIONS;
  const { rawKey } = await deriveKeyBundle(passphrase, saltBytes, iterations);

  return {
    version: ENCRYPTION_VERSION,
    state: "ready",
    keyId: options?.keyId ?? crypto.randomUUID(),
    kdf: KDF,
    iterations,
    salt: bytesToBase64(saltBytes),
    keyCheck: await createKeyCheck(rawKey, vault?.vaultGuid ?? null)
  } satisfies SyncEncryptionDescriptor;
}

export async function verifyEncryptionPassphrase(
  passphrase: string,
  descriptor: SyncEncryptionDescriptor,
  vault: SyncVaultDescriptor | null
) {
  if (!descriptor.salt) {
    throw new Error("ENCRYPTION_SALT_MISSING");
  }

  const salt = base64ToBytes(descriptor.salt);
  const { rawKey } = await deriveKeyBundle(
    passphrase,
    salt,
    descriptor.iterations ?? PBKDF2_ITERATIONS
  );
  const keyCheck = await createKeyCheck(rawKey, vault?.vaultGuid ?? null);

  if (descriptor.keyCheck && descriptor.keyCheck !== keyCheck) {
    throw new Error("INVALID_PASSPHRASE");
  }

  return true;
}

export async function encryptSyncPayload<T>(
  payload: T,
  passphrase: string,
  input: {
    vault: SyncVaultDescriptor | null;
    descriptor?: SyncEncryptionDescriptor | null;
  }
): Promise<EncryptSyncPayloadResult> {
  ensureCryptoSupport();

  const descriptor =
    input.descriptor && input.descriptor.salt
      ? input.descriptor
      : await createEncryptionDescriptor(passphrase, input.vault);
  const salt = descriptor.salt ? base64ToBytes(descriptor.salt) : randomBytes(16);
  const { cryptoKey } = await deriveKeyBundle(passphrase, salt, descriptor.iterations ?? PBKDF2_ITERATIONS);
  const iv = randomBytes(IV_LENGTH);
  const serialized = TEXT_ENCODER.encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    cryptoKey,
    serialized
  );

  return {
    descriptor,
    payload: {
      version: ENCRYPTION_VERSION,
      cipher: CIPHER,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted))
    },
    contentHash: await sha256Base64(serialized)
  };
}

export async function decryptSyncPayload<T>(
  payload: SyncEncryptedPayload,
  passphrase: string,
  descriptor: SyncEncryptionDescriptor,
  vault: SyncVaultDescriptor | null
) {
  ensureCryptoSupport();

  if (!descriptor.salt) {
    throw new Error("ENCRYPTION_SALT_MISSING");
  }

  const salt = base64ToBytes(descriptor.salt);
  const { cryptoKey, rawKey } = await deriveKeyBundle(
    passphrase,
    salt,
    descriptor.iterations ?? PBKDF2_ITERATIONS
  );
  const keyCheck = await createKeyCheck(rawKey, vault?.vaultGuid ?? null);

  if (descriptor.keyCheck && descriptor.keyCheck !== keyCheck) {
    throw new Error("INVALID_PASSPHRASE");
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(payload.iv)
    },
    cryptoKey,
    base64ToBytes(payload.ciphertext)
  );

  return JSON.parse(TEXT_DECODER.decode(decrypted)) as T;
}
