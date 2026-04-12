const registerNameInput = document.querySelector("#register-name");
const registerEmailInput = document.querySelector("#register-email");
const registerPasswordInput = document.querySelector("#register-password");
const registerButton = document.querySelector("#register-button");
const loginEmailInput = document.querySelector("#login-email");
const loginPasswordInput = document.querySelector("#login-password");
const loginButton = document.querySelector("#login-button");
const logoutButton = document.querySelector("#logout-button");
const refreshVaultsButton = document.querySelector("#refresh-vaults-button");
const createVaultButton = document.querySelector("#create-vault-button");
const vaultNameInput = document.querySelector("#vault-name");
const vaultIdInput = document.querySelector("#vault-id");
const portalStatus = document.querySelector("#portal-status");
const authGrid = document.querySelector("#auth-grid");
const accountOverviewPanel = document.querySelector("#account-overview-panel");
const accountOverview = document.querySelector("#account-overview");
const createVaultPanel = document.querySelector("#create-vault-panel");
const vaultsPanel = document.querySelector("#vaults-panel");
const vaultList = document.querySelector("#vault-list");
const vaultTemplate = document.querySelector("#vault-template");

const SESSION_STORAGE_KEY = "zen-sync-account-session";
let sessionToken = window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "";

function setStatus(message, tone = "neutral") {
  portalStatus.textContent = message;
  portalStatus.dataset.tone = tone;
}

async function requestJson(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
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

function setSessionToken(nextToken) {
  sessionToken = nextToken;

  if (nextToken) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, nextToken);
  } else {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function setLoggedOutState() {
  authGrid.classList.remove("hidden");
  logoutButton.classList.add("hidden");
  accountOverviewPanel.classList.add("hidden");
  createVaultPanel.classList.add("hidden");
  vaultsPanel.classList.add("hidden");
  vaultList.innerHTML = '<div class="empty-state">Sign in to load your vaults.</div>';
}

function renderOverview(payload) {
  accountOverview.innerHTML = "";
  accountOverview.append(
    createChip(`Name: ${payload.user.name}`),
    createChip(`Email: ${payload.user.email ?? "Not set"}`),
    createChip(`Vaults: ${payload.vaultCount}`),
    createChip(`Last login: ${formatDate(payload.user.lastLoginAt)}`),
    createChip(`Session expires: ${formatDate(payload.session.expiresAt)}`)
  );
}

async function loadVaultTokens(vaultId, tokenListNode) {
  tokenListNode.innerHTML = "";

  const payload = await requestJson(`/v1/account/vaults/${encodeURIComponent(vaultId)}/tokens`);
  const tokens = payload.tokens ?? [];

  if (!tokens.length) {
    tokenListNode.append(createChip("No sync tokens yet"));
    return;
  }

  tokens.forEach((token) => {
    tokenListNode.append(
      createChip(`${token.label} • last used ${formatDate(token.lastUsedAt)}`, "token-chip")
    );
  });
}

async function issueToken(vaultId, labelInput, tokenResultNode, tokenListNode) {
  const payload = await requestJson(`/v1/account/vaults/${encodeURIComponent(vaultId)}/tokens`, {
    method: "POST",
    body: JSON.stringify({
      label: labelInput.value.trim()
    })
  });

  tokenResultNode.textContent = `Copy this sync token now: ${payload.token}`;
  tokenResultNode.classList.remove("hidden");
  labelInput.value = "";
  await loadVaultTokens(vaultId, tokenListNode);
}

function renderVaults(vaults) {
  vaultList.innerHTML = "";

  if (!vaults.length) {
    vaultList.innerHTML =
      '<div class="empty-state">No vaults yet. Create your first personal vault above.</div>';
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
    void card;
  });
}

async function loadPortal() {
  if (!sessionToken) {
    setLoggedOutState();
    setStatus("Register a new account or sign in with an existing one.");
    return;
  }

  try {
    const [mePayload, vaultsPayload] = await Promise.all([
      requestJson("/v1/auth/me"),
      requestJson("/v1/account/vaults")
    ]);

    authGrid.classList.add("hidden");
    logoutButton.classList.remove("hidden");
    accountOverviewPanel.classList.remove("hidden");
    createVaultPanel.classList.remove("hidden");
    vaultsPanel.classList.remove("hidden");
    renderOverview(mePayload);
    renderVaults(vaultsPayload.vaults ?? []);
    setStatus("Account loaded. You can now manage personal vaults and sync tokens.", "success");
  } catch (error) {
    setSessionToken("");
    setLoggedOutState();
    setStatus(error.message, "error");
  }
}

async function handleAuth(endpoint, payload, successMessage) {
  const authPayload = await requestJson(endpoint, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  setSessionToken(authPayload.session?.token ?? "");
  await loadPortal();
  setStatus(successMessage, "success");
}

registerButton.addEventListener("click", () => {
  handleAuth(
    "/v1/auth/register",
    {
      name: registerNameInput.value.trim(),
      email: registerEmailInput.value.trim(),
      password: registerPasswordInput.value
    },
    "Account created and signed in."
  ).catch((error) => {
    setStatus(error.message, "error");
  });
});

loginButton.addEventListener("click", () => {
  handleAuth(
    "/v1/auth/login",
    {
      email: loginEmailInput.value.trim(),
      password: loginPasswordInput.value
    },
    "Signed in."
  ).catch((error) => {
    setStatus(error.message, "error");
  });
});

logoutButton.addEventListener("click", () => {
  requestJson("/v1/auth/logout", {
    method: "POST"
  })
    .catch(() => undefined)
    .finally(() => {
      setSessionToken("");
      setLoggedOutState();
      setStatus("Signed out.");
    });
});

createVaultButton.addEventListener("click", () => {
  requestJson("/v1/account/vaults", {
    method: "POST",
    body: JSON.stringify({
      name: vaultNameInput.value.trim(),
      id: vaultIdInput.value.trim()
    })
  })
    .then(() => {
      vaultNameInput.value = "";
      vaultIdInput.value = "";
      return loadPortal();
    })
    .catch((error) => {
      setStatus(error.message, "error");
    });
});

refreshVaultsButton.addEventListener("click", () => {
  loadPortal().catch((error) => {
    setStatus(error.message, "error");
  });
});

void loadPortal();
