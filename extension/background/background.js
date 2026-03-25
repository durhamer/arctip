// ArcTip background service worker (Manifest V3)

const ARC_CHAIN_ID = "0x4CE4F2";

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_CHAIN_ID") {
    sendResponse({ chainId: ARC_CHAIN_ID });
    return true;
  }

  if (msg.type === "SAVE_CONTRACTS") {
    chrome.storage.local.set({
      registry: msg.registry,
      tipjar: msg.tipjar,
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "GET_CONTRACTS") {
    chrome.storage.local.get(["registry", "tipjar"], (data) => {
      sendResponse(data);
    });
    return true; // async response
  }
});

// On install/update, set defaults
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.storage.local.set({
      registry: "",
      tipjar: "",
      pendingTip: null,
    });
  }
});
