// ArcTip background service worker (Manifest V3)

const ARC_CHAIN_ID = "0x4CEF52"; // 5042002 decimal

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

  // Route Ethereum requests from popup to the active tab's bridge content script
  if (msg.type === "ARCTIP_ETH") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) {
        sendResponse({ error: "No active tab found. Please open a web page first." });
        return;
      }
      chrome.tabs.sendMessage(tab.id, msg, (resp) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            error:
              "Bridge not ready on this page. Try refreshing the tab or navigating to any website.",
          });
        } else {
          sendResponse(resp);
        }
      });
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
