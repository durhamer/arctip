// ArcTip popup script — Manifest V3 / ES module
// Relies on window.ethereum (MetaMask or compatible)

const ARC_CHAIN_ID = "0x4CE4F2"; // 5042002 decimal
const ARC_CHAIN_ID_DEC = 5042002;
const ARC_RPC = "https://rpc.testnet.arc.network";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const USDC_DECIMALS = 6;

// Filled after deployment — override via storage if needed
const DEFAULT_REGISTRY = "";
const DEFAULT_TIPJAR = "";

// Minimal ABIs (function signatures only)
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const REGISTRY_ABI = [
  "function isRegistered(address) view returns (bool)",
  "function getAddressByHandle(string) view returns (address)",
  "function register(string handle, string url)",
];
const TIPJAR_ABI = [
  "function tip(address creator, uint256 amount, string message)",
  "function previewTip(uint256 amount) view returns (uint256 creatorAmount, uint256 fee)",
  "function feeBps() view returns (uint256)",
];

// ── State ──────────────────────────────────────────────────────────────────

let provider = null;
let signer = null;
let usdcContract = null;
let registryContract = null;
let tipJarContract = null;
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

// Minimal ethers-like encoding — use raw eth_call / eth_sendTransaction
// We use the injected provider directly via EIP-1193 to avoid bundling ethers.
async function ethCall(to, sig, params) {
  const data = encodeCall(sig, params);
  const result = await window.ethereum.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  return result;
}

// Very small ABI encoder for the signatures we need
function encodeCall(sig, args) {
  const selector = keccak256Selector(sig);
  if (!args || args.length === 0) return selector;
  return selector + encodeArgs(sig, args);
}

// We embed a tiny keccak256 selector lookup via known sigs
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

function keccak256Selector(sig) {
  const name = sig.split("(")[0];
  const found = Object.keys(SELECTORS).find((k) => k.startsWith(name + "("));
  if (found) return SELECTORS[found];
  throw new Error(`Unknown selector for: ${sig}`);
}

function padLeft(hex, bytes) {
  return hex.replace("0x", "").padStart(bytes * 2, "0");
}

function encodeArgs(sig, args) {
  // Only handles the types we use: address, uint256, string, string+string, address+uint256+string
  const types = sig
    .slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"))
    .split(",")
    .map((t) => t.trim());

  let head = "";
  let tail = "";
  let headSize = types.length * 32;

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
      // Pad to 32-byte boundary
      const padded = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, "0");
      tail += lenHex + padded;
    }
  });

  return head + tail;
}

function decodeUint256(hex) {
  return BigInt(hex);
}

function decodeAddress(hex) {
  return "0x" + hex.slice(-40);
}

function decodeBool(hex) {
  return BigInt(hex) !== 0n;
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  // Load stored contract addresses
  const stored = await chrome.storage.local.get(["registry", "tipjar"]);
  if (stored.registry) contractAddresses.registry = stored.registry;
  if (stored.tipjar) contractAddresses.tipjar = stored.tipjar;

  setupEventListeners();

  if (window.ethereum) {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts.length > 0) {
      await connectWallet();
    }
    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged", () => location.reload());
  }
}

// ── Wallet ─────────────────────────────────────────────────────────────────

async function connectWallet() {
  try {
    if (!window.ethereum) throw new Error("MetaMask not detected");

    showStatus("Connecting…");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    walletAddress = accounts[0];

    // Ensure Arc Testnet
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
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
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_CHAIN_ID }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ARC_CHAIN_ID,
            chainName: "Arc Testnet",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
            rpcUrls: [ARC_RPC],
            blockExplorerUrls: ["https://testnet.arcscan.app"],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

async function refreshBalance() {
  if (!walletAddress) return;
  const raw = await ethCall(USDC_ADDRESS, "balanceOf(address)", [walletAddress]);
  const balance = decodeUint256(raw);
  ui.usdcBalance.textContent = formatUsdc(balance);
}

// ── Tip ────────────────────────────────────────────────────────────────────

async function resolveCreator(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith("0x")) return trimmed;

  // Treat as handle — lookup via registry
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
    showStatus("Approving USDC…");
    const approveTx = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: walletAddress,
          to: USDC_ADDRESS,
          data: encodeCall("approve(address,uint256)", [contractAddresses.tipjar, amount]),
        },
      ],
    });
    showStatus(`Approve tx: ${approveTx.slice(0, 10)}… waiting`);
    await waitForTx(approveTx);

    // Step 2: tip
    showStatus("Sending tip…");
    const tipTx = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: walletAddress,
          to: contractAddresses.tipjar,
          data: encodeCall("tip(address,uint256,string)", [creatorAddr, amount, message]),
        },
      ],
    });
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
    const receipt = await window.ethereum.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });
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
    showStatus("Registering…");
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: walletAddress,
          to: contractAddresses.registry,
          data: encodeCall("register(string,string)", [handle, url]),
        },
      ],
    });
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
    // Returns (uint256 creatorAmount, uint256 fee) = 64 bytes
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
    if (!walletAddress && k !== "tip") return; // guard
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

  // Quick amount buttons
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
