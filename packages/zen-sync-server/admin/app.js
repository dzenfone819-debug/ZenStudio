const adminTokenInput = document.querySelector("#admin-token");
const connectButton = document.querySelector("#connect-admin");
const adminStatus = document.querySelector("#admin-status");
const refreshButton = document.querySelector("#refresh-vaults");
const createUserButton = document.querySelector("#create-user");
const createVaultButton = document.querySelector("#create-vault");
const userNameInput = document.querySelector("#user-name");
const userIdInput = document.querySelector("#user-id");
const vaultNameInput = document.querySelector("#vault-name");
const vaultIdInput = document.querySelector("#vault-id");
const userList = document.querySelector("#user-list");
const vaultList = document.querySelector("#vault-list");
const userTemplate = document.querySelector("#user-template");
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

function createVaultCard(vault, options = {}) {
  const { nested = false } = options;
  const fragment = vaultTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".vault-card");
  const nameNode = fragment.querySelector(".vault-name");
  const idNode = fragment.querySelector(".vault-id");
  const ownerNode = fragment.querySelector(".vault-owner");
  const metaNode = fragment.querySelector(".vault-meta");
  const statsNode = fragment.querySelector(".vault-stats");
  const tokenLabelInput = fragment.querySelector(".token-label-input");
  const issueButton = fragment.querySelector(".issue-token-button");
  const tokenResultNode = fragment.querySelector(".token-result");
  const tokenListNode = fragment.querySelector(".token-list");

  if (nested) {
    card.classList.add("is-nested");
  }

  nameNode.textContent = vault.name;
  idNode.textContent = `vaultId: ${vault.id}`;
  metaNode.textContent = `${vault.tokenCount} token(s)`;

  if (vault.ownerName) {
    ownerNode.textContent = `Owner: ${vault.ownerName}`;
    ownerNode.classList.remove("hidden");
  }

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

  return card;
}

function renderStandaloneVaults(vaults) {
  vaultList.innerHTML = "";

  if (!vaults.length) {
    vaultList.innerHTML =
      '<div class="empty-state">No standalone vaults yet. Create one above for the classic self-hosted flow.</div>';
    return;
  }

  vaults.forEach((vault) => {
    vaultList.append(createVaultCard(vault));
  });
}

function renderUsers(users, vaults) {
  userList.innerHTML = "";

  if (!users.length) {
    userList.innerHTML =
      '<div class="empty-state">No user spaces yet. Create the first one above to prepare a hosted account structure.</div>';
    return;
  }

  users.forEach((user) => {
    const fragment = userTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".user-card");
    const nameNode = fragment.querySelector(".user-name");
    const idNode = fragment.querySelector(".user-id");
    const metaNode = fragment.querySelector(".user-meta");
    const statsNode = fragment.querySelector(".user-stats");
    const createVaultNameInput = fragment.querySelector(".user-vault-name-input");
    const createVaultIdInput = fragment.querySelector(".user-vault-id-input");
    const createVaultInUserButton = fragment.querySelector(".issue-user-vault-button");
    const userVaultListNode = fragment.querySelector(".user-vault-list");
    const userVaults = vaults.filter((vault) => vault.ownerUserId === user.id);

    nameNode.textContent = user.name;
    idNode.textContent = `userId: ${user.id}`;
    metaNode.textContent = user.email || `${user.vaultCount} vault(s)`;

    statsNode.append(
      createChip(`Vaults: ${user.vaultCount}`),
      createChip(`Tokens: ${user.tokenCount}`),
      createChip(`Last activity: ${formatDate(user.lastActivityAt)}`)
    );

    createVaultInUserButton.addEventListener("click", () => {
      requestJson(`/v1/admin/users/${encodeURIComponent(user.id)}/vaults`, {
        method: "POST",
        body: JSON.stringify({
          name: createVaultNameInput.value.trim(),
          id: createVaultIdInput.value.trim()
        })
      })
        .then(() => {
          createVaultNameInput.value = "";
          createVaultIdInput.value = "";
          return loadControlPlane();
        })
        .catch((error) => {
          setStatus(error.message, "error");
        });
    });

    if (!userVaults.length) {
      userVaultListNode.innerHTML =
        '<div class="empty-state compact">No vaults yet for this user space.</div>';
    } else {
      userVaults.forEach((vault) => {
        userVaultListNode.append(createVaultCard(vault, { nested: true }));
      });
    }

    userList.append(card);
  });
}

async function loadControlPlane() {
  const [usersPayload, vaultsPayload] = await Promise.all([
    requestJson("/v1/admin/users"),
    requestJson("/v1/admin/vaults")
  ]);
  const users = usersPayload.users ?? [];
  const vaults = vaultsPayload.vaults ?? [];
  const standaloneVaults = vaults.filter((vault) => !vault.ownerUserId);

  renderUsers(users, vaults);
  renderStandaloneVaults(standaloneVaults);
  setStatus("Connected. Hosted-ready registry loaded.", "success");
}

connectButton.addEventListener("click", () => {
  adminToken = adminTokenInput.value.trim();
  window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
  loadControlPlane().catch((error) => {
    setStatus(error.message, "error");
  });
});

refreshButton.addEventListener("click", () => {
  loadControlPlane().catch((error) => {
    setStatus(error.message, "error");
  });
});

createUserButton.addEventListener("click", () => {
  requestJson("/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      name: userNameInput.value.trim(),
      id: userIdInput.value.trim()
    })
  })
    .then(() => {
      userNameInput.value = "";
      userIdInput.value = "";
      return loadControlPlane();
    })
    .catch((error) => {
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
      return loadControlPlane();
    })
    .catch((error) => {
      setStatus(error.message, "error");
    });
});

if (adminToken) {
  loadControlPlane().catch((error) => {
    setStatus(error.message, "error");
  });
}
