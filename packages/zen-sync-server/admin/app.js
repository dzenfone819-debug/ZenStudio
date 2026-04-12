const adminTokenInput = document.querySelector("#admin-token");
const connectButton = document.querySelector("#connect-admin");
const adminStatus = document.querySelector("#admin-status");
const refreshButton = document.querySelector("#refresh-vaults");
const createVaultButton = document.querySelector("#create-vault");
const vaultNameInput = document.querySelector("#vault-name");
const vaultIdInput = document.querySelector("#vault-id");
const vaultList = document.querySelector("#vault-list");
const vaultTemplate = document.querySelector("#vault-template");

const ADMIN_TOKEN_STORAGE_KEY = "zen-sync-admin-token";
let adminToken = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? "";

if (adminToken) {
  adminTokenInput.value = adminToken;
}

function setStatus(message, tone = "neutral") {
  adminStatus.textContent = message;
  adminStatus.dataset.tone = tone;
}

async function requestJson(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `HTTP_${response.status}`);
  }

  return payload;
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "Never";
  }

  return new Date(timestamp).toLocaleString();
}

function createChip(text, className = "stat-chip") {
  const chip = document.createElement("span");
  chip.className = className;
  chip.textContent = text;
  return chip;
}

async function loadVaultTokens(vaultId, tokenListNode) {
  tokenListNode.innerHTML = "";

  const payload = await requestJson(`/v1/admin/vaults/${encodeURIComponent(vaultId)}/tokens`);
  const tokens = payload.tokens ?? [];

  if (tokens.length === 0) {
    tokenListNode.append(createChip("No tokens yet"));
    return;
  }

  tokens.forEach((token) => {
    tokenListNode.append(
      createChip(`${token.label} • last used ${formatDate(token.lastUsedAt)}`, "token-chip")
    );
  });
}

async function issueToken(vaultId, labelInput, tokenResultNode, tokenListNode) {
  const payload = await requestJson(`/v1/admin/vaults/${encodeURIComponent(vaultId)}/tokens`, {
    method: "POST",
    body: JSON.stringify({
      label: labelInput.value.trim()
    })
  });

  tokenResultNode.textContent = `Copy this token now: ${payload.token}`;
  tokenResultNode.classList.remove("hidden");
  labelInput.value = "";
  await loadVaultTokens(vaultId, tokenListNode);
}

function renderVaults(vaults) {
  vaultList.innerHTML = "";

  if (!vaults.length) {
    vaultList.innerHTML = '<div class="empty-state">No vaults yet. Create the first one above.</div>';
    return;
  }

  vaults.forEach((vault) => {
    const fragment = vaultTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".vault-card");
    const nameNode = fragment.querySelector(".vault-name");
    const idNode = fragment.querySelector(".vault-id");
    const metaNode = fragment.querySelector(".vault-meta");
    const statsNode = fragment.querySelector(".vault-stats");
    const tokenLabelInput = fragment.querySelector(".token-label-input");
    const issueButton = fragment.querySelector(".issue-token-button");
    const tokenResultNode = fragment.querySelector(".token-result");
    const tokenListNode = fragment.querySelector(".token-list");

    nameNode.textContent = vault.name;
    idNode.textContent = `vaultId: ${vault.id}`;
    metaNode.textContent = `${vault.tokenCount} token(s)`;
    statsNode.append(
      createChip(`Last revision: ${vault.lastRevision ?? "none"}`),
      createChip(`Last sync: ${formatDate(vault.lastSyncAt)}`),
      createChip(`Updated: ${formatDate(vault.updatedAt)}`)
    );

    issueButton.addEventListener("click", () =>
      issueToken(vault.id, tokenLabelInput, tokenResultNode, tokenListNode).catch((error) => {
        setStatus(error.message, "error");
      })
    );

    loadVaultTokens(vault.id, tokenListNode).catch((error) => {
      setStatus(error.message, "error");
    });

    vaultList.append(card);
  });
}

async function loadVaults() {
  const payload = await requestJson("/v1/admin/vaults");
  renderVaults(payload.vaults ?? []);
  setStatus("Connected. Vault registry loaded.", "success");
}

connectButton.addEventListener("click", () => {
  adminToken = adminTokenInput.value.trim();
  window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
  loadVaults().catch((error) => {
    setStatus(error.message, "error");
  });
});

refreshButton.addEventListener("click", () => {
  loadVaults().catch((error) => {
    setStatus(error.message, "error");
  });
});

createVaultButton.addEventListener("click", () => {
  requestJson("/v1/admin/vaults", {
    method: "POST",
    body: JSON.stringify({
      name: vaultNameInput.value.trim(),
      id: vaultIdInput.value.trim()
    })
  })
    .then(() => {
      vaultNameInput.value = "";
      vaultIdInput.value = "";
      return loadVaults();
    })
    .catch((error) => {
      setStatus(error.message, "error");
    });
});

if (adminToken) {
  loadVaults().catch((error) => {
    setStatus(error.message, "error");
  });
}
