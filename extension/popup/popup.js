// ArcTip popup script — Manifest V3 / ES module
// window.ethereum is NOT available in extension popups.
// All Ethereum calls are routed through:
//   popup -> background.js -> bridge.js (isolated) -> ethereum_bridge.js (MAIN) -> MetaMask
console.log("[ArcTip] popup.js loaded");

const ARC_CHAIN_ID = "0x4CEF52"; // 5042002 decimal

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const USDC_DECIMALS = 6;

const DEFAULT_REGISTRY = "0x6E5f2F17C239e883113712EeC563EF2DE675752D";
const DEFAULT_TIPJAR = "0x078aF8b465a8be934E3c48e99a634A875B71e369";

// ── Handle normalisation ───────────────────────────────────────────────────
// Contract stores handles WITH "@" prefix (e.g. "@alice").
// We normalise all user input before any contract interaction so that typing
// "alice" and "@alice" both resolve correctly.

function normalizeHandle(input) {
  const stripped = input.trim().replace(/^@+/, "");
  return stripped ? "@" + stripped : "";
}

// ── Selectors (tiny keccak lookup) ────────────────────────────────────────

const SELECTORS = {
  "balanceOf(address)":          "0x70a08231",
  "approve(address,uint256)":    "0x095ea7b3",
  "isRegistered(address)":       "0xc3c5a547",
  "getAddressByHandle(string)":  "0xb589c169",
  "register(string,string)":     "0x3ffbd47f",
  "tip(address,uint256,string)": "0xb008c34e",
  "previewTip(uint256)":         "0xd3cafef9",
  "feeBps()":                    "0x24a9d853",
  "verifyBio()":                 "0x11d650cc",
  "getVerificationLevel(address)": "0x20e21535",
  "getCreator(address)":           "0xa0210309",
  "unregister()":                  "0xe79a198f",
};

// ── State ──────────────────────────────────────────────────────────────────

let walletAddress = null;
let contractAddresses = { registry: DEFAULT_REGISTRY, tipjar: DEFAULT_TIPJAR };

// Registration verification state (persisted across popup open/close)
let verifyCode = null;
let pendingHandle = null;

function saveVerifState(step) {
  chrome.storage.local.set({
    verif_state: {
      handle: pendingHandle,
      code: verifyCode,
      step,
      url: ui.regUrl ? ui.regUrl.value.trim() : "",
    },
  });
}

function clearVerifState() {
  chrome.storage.local.remove("verif_state");
}

// Check on-chain registration status for the connected wallet.
// Returns true if registered (and updates UI), false otherwise.
async function checkRegistrationStatus() {
  if (!walletAddress || !contractAddresses.registry) return false;
  try {
    const raw = await ethCall(contractAddresses.registry, "getCreator(address)", [walletAddress]);
    const creator = decodeCreator(raw);
    if (creator.registered) {
      clearVerifState();
      ui.regInfoHandle.textContent = creator.handle;
      ui.regInfoUrl.textContent = creator.url;
      ui.regInfoUrl.href = creator.url;
      ui.regInfoLevel.textContent =
        creator.verificationLevel >= 1 ? "Bio Verified ✅" : "Unverified ⚠️";
      showSection("register");
      showRegStep(ui.regStepRegistered);
      return true;
    }
  } catch (err) {
    console.warn("[ArcTip] checkRegistrationStatus failed:", err);
  }
  return false;
}

async function unregisterCreator() {
  if (!confirm("Unregister? This will remove your handle from the registry.")) return;
  try {
    ui.btnUnregister.disabled = true;
    showStatus("Unregistering… (check MetaMask)");
    const tx = await ethRequest("eth_sendTransaction", [
      {
        from: walletAddress,
        to: contractAddresses.registry,
        data: encodeCall("unregister()", []),
      },
    ]);
    await waitForTx(tx);
    showStatus("Unregistered.", "success");
    setTimeout(() => {
      hideStatus();
      showRegStep(ui.regStep1);
    }, 1500);
  } catch (err) {
    showStatus(err.message || "Unregister failed", "error");
  } finally {
    ui.btnUnregister.disabled = false;
  }
}

async function restoreVerifState() {
  const { verif_state } = await chrome.storage.local.get("verif_state");
  if (!verif_state) return;

  pendingHandle = verif_state.handle;
  verifyCode = verif_state.code;

  showSection("register");

  if (verif_state.step === 2) {
    ui.regHandle.value = pendingHandle;
    ui.verifyCodeDisplay.textContent = verifyCode;
    ui.verifyResult.classList.add("hidden");
    showRegStep(ui.regStep2);
  } else if (verif_state.step === 3) {
    ui.regHandleDisplay.value = pendingHandle;
    ui.regUrl.value = verif_state.url || `https://twitter.com/${pendingHandle.replace("@", "")}`;
    showRegStep(ui.regStep3);
  }
}

// ── DOM refs ───────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const ui = {
  walletDisconnected: $("wallet-disconnected"),
  walletConnected: $("wallet-connected"),
  walletAddress: $("wallet-address"),
  usdcBalance: $("usdc-balance"),
  btnConnect: $("btn-connect"),
  sectionTip: $("section-tip"),
  sectionRegister: $("section-register"),
  inputCreator: $("input-creator"),
  inputAmount: $("input-amount"),
  inputMessage: $("input-message"),
  tipPreview: $("tip-preview"),
  previewNet: $("preview-net"),
  previewFee: $("preview-fee"),
  btnTip: $("btn-tip"),
  creatorWarning: $("creator-warning"),
  status: $("status"),
  navTip: $("nav-tip"),
  navRegister: $("nav-register"),
  // Register multi-step
  regSectionTitle: $("reg-section-title"),
  regStepRegistered: $("reg-step-registered"),
  regInfoHandle: $("reg-info-handle"),
  regInfoUrl: $("reg-info-url"),
  regInfoLevel: $("reg-info-level"),
  btnUnregister: $("btn-unregister"),
  regStep1: $("reg-step-1"),
  regStep2: $("reg-step-2"),
  regStep3: $("reg-step-3"),
  regHandle: $("reg-handle"),
  btnGenCode: $("btn-gen-code"),
  verifyCodeDisplay: $("verify-code-display"),
  btnCopyCode: $("btn-copy-code"),
  btnCheckBio: $("btn-check-bio"),
  btnBackStep1: $("btn-back-step1"),
  verifyResult: $("verify-result"),
  regHandleDisplay: $("reg-handle-display"),
  regUrl: $("reg-url"),
  btnRegister: $("btn-register"),
};

// ── Ethereum bridge ────────────────────────────────────────────────────────
// Routes requests through: background.js → content/bridge.js → inject/ethereum_bridge.js

function ethRequest(method, params = []) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "ARCTIP_ETH", method, params }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp) {
        reject(new Error("No response from bridge. Refresh the active tab and try again."));
        return;
      }
      if (resp.error !== undefined) {
        const err = new Error(resp.error);
        if (resp.code !== undefined) err.code = resp.code;
        reject(err);
        return;
      }
      resolve(resp.result);
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatUsdc(raw) {
  return (Number(raw) / 10 ** USDC_DECIMALS).toFixed(2) + " USDC";
}

function parseUsdc(human) {
  return BigInt(Math.round(parseFloat(human) * 10 ** USDC_DECIMALS));
}

function showStatus(msg, type = "loading") {
  ui.status.textContent = msg;
  ui.status.className = `status status--${type}`;
  ui.status.classList.remove("hidden");
}

function hideStatus() {
  ui.status.classList.add("hidden");
}

function padLeft(hex, bytes) {
  return hex.replace("0x", "").padStart(bytes * 2, "0");
}

function keccak256Selector(sig) {
  const found = Object.keys(SELECTORS).find((k) => k.startsWith(sig.split("(")[0] + "("));
  if (found) return SELECTORS[found];
  throw new Error(`Unknown selector for: ${sig}`);
}

function encodeArgs(sig, args) {
  const types = sig
    .slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"))
    .split(",")
    .map((t) => t.trim());

  let head = "";
  let tail = "";
  const headSize = types.length * 32;

  types.forEach((type, i) => {
    if (type === "address") {
      head += padLeft(args[i].toLowerCase(), 32);
    } else if (type === "uint256") {
      head += padLeft(BigInt(args[i]).toString(16), 32);
    } else if (type === "string" || type === "bytes") {
      const offset = headSize + tail.length / 2;
      head += padLeft(offset.toString(16), 32);
      const bytes = new TextEncoder().encode(String(args[i]));
      const lenHex = padLeft(bytes.length.toString(16), 32);
      let dataHex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const padded = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, "0");
      tail += lenHex + padded;
    }
  });

  return head + tail;
}

function encodeCall(sig, args) {
  const selector = keccak256Selector(sig);
  if (!args || args.length === 0) return selector;
  return selector + encodeArgs(sig, args);
}

function decodeUint256(hex) {
  return BigInt(hex);
}

function decodeAddress(hex) {
  return "0x" + hex.slice(-40);
}

function decodeUint8(hex) {
  return parseInt(hex.replace("0x", "").slice(-2), 16);
}

// Decode the Creator struct returned by getCreator(address).
// ABI layout: outer offset (word 0 = 0x20), then struct at word 1:
//   [1] handle offset (relative to struct start, bytes)
//   [2] url offset
//   [3] bool registered
//   [4] uint256 registeredAt
//   [5] uint8 verificationLevel
//   … string data …
function decodeCreator(hex) {
  const data = hex.replace("0x", "");
  function uintAt(wordIndex) {
    return BigInt("0x" + data.slice(wordIndex * 64, (wordIndex + 1) * 64));
  }
  function strAt(baseWord, relOffsetBytes) {
    const strWord = baseWord + relOffsetBytes / 32;
    const len = Number(uintAt(strWord));
    if (len === 0) return "";
    const hexStr = data.slice((strWord + 1) * 64, (strWord + 1) * 64 + len * 2);
    return new TextDecoder().decode(
      new Uint8Array(hexStr.match(/../g).map((b) => parseInt(b, 16)))
    );
  }
  const base = 1; // struct starts at word 1 (outer offset = 0x20)
  const handleOffset = Number(uintAt(base));
  const urlOffset    = Number(uintAt(base + 1));
  const registered   = Number(uintAt(base + 2)) !== 0;
  // base+3 is registeredAt (unused here)
  const verificationLevel = Number(uintAt(base + 4));
  return {
    handle: strAt(base, handleOffset),
    url:    strAt(base, urlOffset),
    registered,
    verificationLevel,
  };
}

async function ethCall(to, sig, params) {
  const data = encodeCall(sig, params);
  return ethRequest("eth_call", [{ to, data }, "latest"]);
}

// ── Verification code ──────────────────────────────────────────────────────

function generateVerifyCode() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  arr.forEach((b) => (suffix += chars[b % chars.length]));
  return `arctip-verify-${suffix}`;
}

// All bio verification is routed through the background service worker,
// which is not subject to CORS restrictions.
function checkTwitterBio(handle, code) {
  console.log("[ArcTip popup] checkTwitterBio called — handle:", handle, "code:", code);
  return new Promise((resolve, reject) => {
    console.log("[ArcTip popup] sending VERIFY_BIO to background…");
    chrome.runtime.sendMessage({ type: "VERIFY_BIO", handle, code }, (resp) => {
      const err = chrome.runtime.lastError;
      console.log("[ArcTip popup] VERIFY_BIO response:", resp, "lastError:", err);
      if (err || !resp) {
        reject(new Error(
          `Background service unavailable: ${err ? err.message : "no response"}. Try reloading the extension.`
        ));
        return;
      }
      if (resp.rateLimit) {
        reject(new Error("Twitter 暫時限流，請等 2 分鐘後重試"));
        return;
      }
      if (resp.error && !resp.found) {
        reject(new Error(`無法驗證 Bio（${resp.error}），請稍後再試`));
        return;
      }
      resolve(resp.found);
    });
  });
}


// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  console.log("[ArcTip] init() started");
  const stored = await chrome.storage.local.get(["registry", "tipjar"]);
  if (stored.registry) contractAddresses.registry = stored.registry;
  if (stored.tipjar) contractAddresses.tipjar = stored.tipjar;

  setupEventListeners();
  console.log("[ArcTip] event listeners registered");

  // Attempt silent reconnect if already connected
  try {
    const accounts = await ethRequest("eth_accounts");
    if (accounts && accounts.length > 0) {
      await connectWallet();
    }
  } catch (_) {
    // Not connected yet or bridge not ready — stay in disconnected state
  }
}

// ── Wallet ─────────────────────────────────────────────────────────────────

async function connectWallet() {
  try {
    showStatus("Connecting…");

    const accounts = await ethRequest("eth_requestAccounts");
    walletAddress = accounts[0];

    // Ensure Arc Testnet
    const chainId = await ethRequest("eth_chainId");
    if (chainId.toLowerCase() !== ARC_CHAIN_ID.toLowerCase()) {
      await switchToArcTestnet();
    }

    ui.walletDisconnected.classList.add("hidden");
    ui.walletConnected.classList.remove("hidden");
    ui.sectionTip.classList.remove("hidden");
    ui.walletAddress.textContent = `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;

    await refreshBalance();
    const alreadyRegistered = await checkRegistrationStatus();
    if (!alreadyRegistered) {
      await restoreVerifState();
    }
    hideStatus();
  } catch (err) {
    showStatus(err.message || "Connection failed", "error");
  }
}

async function switchToArcTestnet() {
  try {
    await ethRequest("wallet_switchEthereumChain", [{ chainId: ARC_CHAIN_ID }]);
  } catch (switchError) {
    if (switchError.code === 4902) {
      await ethRequest("wallet_addEthereumChain", [
        {
          chainId: ARC_CHAIN_ID,
          chainName: "Arc Testnet",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://rpc.testnet.arc.network"],
          blockExplorerUrls: ["https://testnet.arcscan.app"],
        },
      ]);
    } else {
      throw switchError;
    }
  }
}

async function refreshBalance() {
  if (!walletAddress) return;
  const raw = await ethCall(USDC_ADDRESS, "balanceOf(address)", [walletAddress]);
  ui.usdcBalance.textContent = formatUsdc(decodeUint256(raw));
}

// ── Tip ────────────────────────────────────────────────────────────────────

async function resolveCreator(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith("0x")) return trimmed;
  if (!contractAddresses.registry) throw new Error("Registry address not configured");
  const handle = normalizeHandle(trimmed);
  const raw = await ethCall(contractAddresses.registry, "getAddressByHandle(string)", [handle]);
  const addr = decodeAddress(raw);
  if (addr === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Handle "${trimmed}" not registered`);
  }
  return addr;
}

async function getVerificationLevel(creatorAddr) {
  if (!contractAddresses.registry) return 0;
  try {
    const raw = await ethCall(
      contractAddresses.registry,
      "getVerificationLevel(address)",
      [creatorAddr]
    );
    return decodeUint8(raw);
  } catch (_) {
    return 0;
  }
}

async function checkAndWarnCreator(creatorInput) {
  if (!creatorInput.trim()) {
    ui.creatorWarning.classList.add("hidden");
    return;
  }
  try {
    const addr = await resolveCreator(creatorInput);
    const level = await getVerificationLevel(addr);
    if (level === 0) {
      ui.creatorWarning.classList.remove("hidden");
    } else {
      ui.creatorWarning.classList.add("hidden");
    }
  } catch (_) {
    // If creator not found, hide warning (sendTip will surface the error)
    ui.creatorWarning.classList.add("hidden");
  }
}

async function sendTip() {
  if (!contractAddresses.tipjar) {
    showStatus("TipJar address not set. Check settings.", "error");
    return;
  }

  const creatorInput = ui.inputCreator.value.trim();
  const amountStr = ui.inputAmount.value.trim();
  const message = ui.inputMessage.value.trim();

  if (!creatorInput || !amountStr) {
    showStatus("Fill in creator and amount", "error");
    return;
  }

  try {
    ui.btnTip.disabled = true;
    showStatus("Resolving creator…");

    const creatorAddr = await resolveCreator(creatorInput);

    // Check verification level and surface warning
    const level = await getVerificationLevel(creatorAddr);
    if (level === 0) {
      ui.creatorWarning.classList.remove("hidden");
    } else {
      ui.creatorWarning.classList.add("hidden");
    }

    const amount = parseUsdc(amountStr);

    // Step 1: approve
    showStatus("Approving USDC… (check MetaMask)");
    const approveTx = await ethRequest("eth_sendTransaction", [
      {
        from: walletAddress,
        to: USDC_ADDRESS,
        data: encodeCall("approve(address,uint256)", [contractAddresses.tipjar, amount]),
      },
    ]);
    showStatus(`Approve tx: ${approveTx.slice(0, 10)}… waiting`);
    await waitForTx(approveTx);

    // Step 2: tip
    showStatus("Sending tip… (check MetaMask)");
    const tipTx = await ethRequest("eth_sendTransaction", [
      {
        from: walletAddress,
        to: contractAddresses.tipjar,
        data: encodeCall("tip(address,uint256,string)", [creatorAddr, amount, message]),
      },
    ]);
    await waitForTx(tipTx);

    showStatus(`Tip sent! Tx: ${tipTx}`, "success");
    await refreshBalance();
    ui.inputAmount.value = "";
    ui.inputMessage.value = "";
    ui.tipPreview.classList.add("hidden");
  } catch (err) {
    showStatus(err.message || "Transaction failed", "error");
  } finally {
    ui.btnTip.disabled = false;
  }
}

async function waitForTx(txHash, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const receipt = await ethRequest("eth_getTransactionReceipt", [txHash]);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Transaction timeout");
}

// ── Register (multi-step bio verification) ─────────────────────────────────

function showRegStep(step) {
  [ui.regStepRegistered, ui.regStep1, ui.regStep2, ui.regStep3].forEach((el) =>
    el.classList.add("hidden")
  );
  step.classList.remove("hidden");
  ui.regSectionTitle.textContent =
    step === ui.regStepRegistered ? "Creator Profile" : "Register as Creator";
}

function startVerification() {
  const raw = ui.regHandle.value.trim();
  if (!raw) {
    showStatus("Enter your Twitter handle first", "error");
    return;
  }
  pendingHandle = normalizeHandle(raw);
  verifyCode = generateVerifyCode();

  ui.verifyCodeDisplay.textContent = verifyCode;
  ui.verifyResult.classList.add("hidden");
  showRegStep(ui.regStep2);
  hideStatus();
  saveVerifState(2);
}

async function checkBio() {
  console.log("[ArcTip popup] checkBio called — pendingHandle:", pendingHandle, "verifyCode:", verifyCode);
  ui.btnCheckBio.disabled = true;
  ui.verifyResult.classList.add("hidden");
  showStatus("Checking Twitter bio…");

  try {
    const found = await checkTwitterBio(pendingHandle, verifyCode);
    if (found) {
      showStatus("Bio verified!", "success");
      ui.verifyResult.textContent = "✅ Verification code found in bio!";
      ui.verifyResult.style.color = "var(--success)";
      ui.verifyResult.classList.remove("hidden");

      setTimeout(() => {
        hideStatus();
        ui.regHandleDisplay.value = pendingHandle;
        ui.regUrl.value = `https://twitter.com/${pendingHandle.replace("@", "")}`;
        showRegStep(ui.regStep3);
        saveVerifState(3);
      }, 800);
    } else {
      showStatus("Code not found in bio.", "error");
      ui.verifyResult.textContent =
        "❌ Code not found. Make sure you saved your Twitter bio and try again.";
      ui.verifyResult.style.color = "var(--error)";
      ui.verifyResult.classList.remove("hidden");
    }
  } catch (err) {
    showStatus(err.message || "Could not verify bio. Try again.", "error");
  } finally {
    ui.btnCheckBio.disabled = false;
  }
}

async function registerCreator() {
  if (!contractAddresses.registry) {
    showStatus("Registry address not set", "error");
    return;
  }
  const handle = ui.regHandleDisplay.value.trim();
  const url = ui.regUrl.value.trim();
  if (!handle || !url) {
    showStatus("Fill in all fields", "error");
    return;
  }

  try {
    ui.btnRegister.disabled = true;

    // Step 1: register() — sets verificationLevel = 0
    showStatus("Registering… (check MetaMask)");
    const registerTx = await ethRequest("eth_sendTransaction", [
      {
        from: walletAddress,
        to: contractAddresses.registry,
        data: encodeCall("register(string,string)", [handle, url]),
      },
    ]);
    showStatus(`Register tx: ${registerTx.slice(0, 10)}… waiting`);
    await waitForTx(registerTx);

    // Step 2: verifyBio() — upgrades verificationLevel to 1
    showStatus("Upgrading verification… (check MetaMask)");
    const verifyTx = await ethRequest("eth_sendTransaction", [
      {
        from: walletAddress,
        to: contractAddresses.registry,
        data: encodeCall("verifyBio()", []),
      },
    ]);
    await waitForTx(verifyTx);

    showStatus("Registered & verified! ✅", "success");

    // Clear registration flow state and show the registered profile
    ui.regHandle.value = "";
    ui.regUrl.value = "";
    verifyCode = null;
    pendingHandle = null;
    setTimeout(async () => {
      hideStatus();
      await checkRegistrationStatus();
    }, 1500);
  } catch (err) {
    showStatus(err.message || "Registration failed", "error");
  } finally {
    ui.btnRegister.disabled = false;
  }
}

function copyCode() {
  navigator.clipboard.writeText(verifyCode || "").then(() => {
    ui.btnCopyCode.textContent = "Copied!";
    setTimeout(() => (ui.btnCopyCode.textContent = "Copy"), 1500);
  });
}

// ── Preview ────────────────────────────────────────────────────────────────

async function updatePreview() {
  const amountStr = ui.inputAmount.value;
  if (!amountStr || isNaN(parseFloat(amountStr)) || parseFloat(amountStr) <= 0) {
    ui.tipPreview.classList.add("hidden");
    ui.btnTip.disabled = true;
    return;
  }

  ui.btnTip.disabled = !walletAddress;

  if (!contractAddresses.tipjar) return;

  try {
    const amount = parseUsdc(amountStr);
    const raw = await ethCall(contractAddresses.tipjar, "previewTip(uint256)", [amount]);
    const creatorAmount = BigInt("0x" + raw.replace("0x", "").slice(0, 64));
    const fee = BigInt("0x" + raw.replace("0x", "").slice(64, 128));
    ui.previewNet.textContent = formatUsdc(creatorAmount);
    ui.previewFee.textContent = formatUsdc(fee);
    ui.tipPreview.classList.remove("hidden");
  } catch (_) {
    ui.tipPreview.classList.add("hidden");
  }
}

// ── Nav ────────────────────────────────────────────────────────────────────

function showSection(name) {
  const sections = { tip: ui.sectionTip, register: ui.sectionRegister };
  const navBtns = { tip: ui.navTip, register: ui.navRegister };

  Object.entries(sections).forEach(([k, el]) => {
    if (!walletAddress && k !== "tip") return;
    el.classList.toggle("hidden", k !== name);
  });
  Object.entries(navBtns).forEach(([k, btn]) => {
    btn.classList.toggle("active", k === name);
  });
}

// ── Event listeners ────────────────────────────────────────────────────────

function setupEventListeners() {
  ui.btnConnect.addEventListener("click", connectWallet);
  ui.btnTip.addEventListener("click", sendTip);
  ui.inputAmount.addEventListener("input", updatePreview);

  // Creator verification warning on blur
  ui.inputCreator.addEventListener("blur", () => checkAndWarnCreator(ui.inputCreator.value));

  document.querySelectorAll("[data-amount]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ui.inputAmount.value = btn.dataset.amount;
      updatePreview();
    });
  });

  ui.navTip.addEventListener("click", () => showSection("tip"));
  ui.navRegister.addEventListener("click", () => showSection("register"));

  // Register multi-step
  ui.btnGenCode.addEventListener("click", startVerification);
  ui.btnCheckBio.addEventListener("click", checkBio);
  ui.btnCopyCode.addEventListener("click", copyCode);
  ui.btnBackStep1.addEventListener("click", () => {
    hideStatus();
    verifyCode = null;
    pendingHandle = null;
    clearVerifState();
    showRegStep(ui.regStep1);
  });
  ui.btnRegister.addEventListener("click", registerCreator);
  ui.btnUnregister.addEventListener("click", unregisterCreator);
}

// ── Boot ───────────────────────────────────────────────────────────────────

init();
