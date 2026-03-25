// ArcTip popup script — Manifest V3 / ES module
// window.ethereum is NOT available in extension popups.
// All Ethereum calls are routed through:
//   popup -> background.js -> bridge.js (isolated) -> ethereum_bridge.js (MAIN) -> MetaMask

const ARC_CHAIN_ID = "0x4CEF52"; // 5042002 decimal

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const USDC_DECIMALS = 6;

const DEFAULT_REGISTRY = "";
const DEFAULT_TIPJAR = "";

// ── Selectors (tiny keccak lookup) ────────────────────────────────────────

const SELECTORS = {
  "balanceOf(address)": "0x70a08231",
  "approve(address,uint256)": "0x095ea7b3",
  "isRegistered(address)": "0x15e40de4",
  "getAddressByHandle(string)": "0xb5be4b16",
  "register(string,string)": "0x7d0b2eff",
  "tip(address,uint256,string)": "0xf0350c04",
  "previewTip(uint256)": "0x54eef2ef",
  "feeBps()": "0xb33d2e26",
};

// ── State ──────────────────────────────────────────────────────────────────

let walletAddress = null;
let contractAddresses = { registry: DEFAULT_REGISTRY, tipjar: DEFAULT_TIPJAR };

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
  status: $("status"),
  navTip: $("nav-tip"),
  navRegister: $("nav-register"),
  regHandle: $("reg-handle"),
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

async function ethCall(to, sig, params) {
  const data = encodeCall(sig, params);
  return ethRequest("eth_call", [{ to, data }, "latest"]);
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const stored = await chrome.storage.local.get(["registry", "tipjar"]);
  if (stored.registry) contractAddresses.registry = stored.registry;
  if (stored.tipjar) contractAddresses.tipjar = stored.tipjar;

  setupEventListeners();

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
  const raw = await ethCall(contractAddresses.registry, "getAddressByHandle(string)", [trimmed]);
  const addr = decodeAddress(raw);
  if (addr === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Handle "${trimmed}" not registered`);
  }
  return addr;
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

// ── Register ───────────────────────────────────────────────────────────────

async function registerCreator() {
  if (!contractAddresses.registry) {
    showStatus("Registry address not set", "error");
    return;
  }
  const handle = ui.regHandle.value.trim();
  const url = ui.regUrl.value.trim();
  if (!handle || !url) {
    showStatus("Fill in handle and URL", "error");
    return;
  }
  try {
    ui.btnRegister.disabled = true;
    showStatus("Registering… (check MetaMask)");
    const txHash = await ethRequest("eth_sendTransaction", [
      {
        from: walletAddress,
        to: contractAddresses.registry,
        data: encodeCall("register(string,string)", [handle, url]),
      },
    ]);
    await waitForTx(txHash);
    showStatus("Registered! Tx: " + txHash, "success");
    ui.regHandle.value = "";
    ui.regUrl.value = "";
  } catch (err) {
    showStatus(err.message || "Registration failed", "error");
  } finally {
    ui.btnRegister.disabled = false;
  }
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
  ui.btnRegister.addEventListener("click", registerCreator);
  ui.inputAmount.addEventListener("input", updatePreview);

  document.querySelectorAll("[data-amount]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ui.inputAmount.value = btn.dataset.amount;
      updatePreview();
    });
  });

  ui.navTip.addEventListener("click", () => showSection("tip"));
  ui.navRegister.addEventListener("click", () => showSection("register"));
}

// ── Boot ───────────────────────────────────────────────────────────────────

init();
