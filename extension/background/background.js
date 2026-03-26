// ArcTip background service worker (Manifest V3)

const ARC_CHAIN_ID = "0x4CEF52"; // 5042002 decimal

// Fetch a URL from the service worker context (no CORS restrictions).
async function bgFetch(url) {
  console.log("[ArcTip bg] bgFetch →", url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const text = resp.ok ? await resp.text() : null;
    console.log("[ArcTip bg] bgFetch ←", resp.status, url);
    return { status: resp.status, text };
  } catch (err) {
    clearTimeout(timer);
    console.warn("[ArcTip bg] bgFetch error:", err.message, url);
    return { status: 0, text: null };
  }
}

// Listen for messages from popup or content scripts.
// NOTE: handlers that need async responses must return `true` synchronously
// so Chrome keeps the message channel open.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[ArcTip bg] message received:", msg.type);

  // ── Synchronous handlers ────────────────────────────────────────────────

  if (msg.type === "GET_CHAIN_ID") {
    sendResponse({ chainId: ARC_CHAIN_ID });
    return false;
  }

  if (msg.type === "SAVE_CONTRACTS") {
    chrome.storage.local.set({ registry: msg.registry, tipjar: msg.tipjar });
    sendResponse({ ok: true });
    return false;
  }

  // ── Async handlers — must return true immediately ───────────────────────

  if (msg.type === "GET_CONTRACTS") {
    chrome.storage.local.get(["registry", "tipjar"], (data) => sendResponse(data));
    return true;
  }

  // Verify a Twitter handle's bio contains the given code.
  // Runs inside the service worker (no CORS restrictions).
  // Strategy 1: twitter.com profile page (full HTML, includes bio)
  // Strategy 2: syndication API (fallback)
  if (msg.type === "VERIFY_BIO") {
    const { handle, code } = msg;
    const h = (handle || "").replace(/^@/, "").trim();
    console.log("[ArcTip bg] VERIFY_BIO handle:", h, "code:", code);

    if (!h || !code) {
      sendResponse({ found: false, rateLimit: false, error: "missing handle or code" });
      return false;
    }

    (async () => {
      // Strategy 1: twitter.com profile page
      const r1 = await bgFetch(`https://twitter.com/${h}`);
      console.log("[ArcTip bg] twitter.com status:", r1.status);

      if (r1.status === 200 && r1.text !== null) {
        const found = r1.text.includes(code);
        console.log("[ArcTip bg] twitter.com found:", found);
        sendResponse({ found, rateLimit: false });
        return;
      }

      // Strategy 2: syndication API
      const r2 = await bgFetch(
        `https://syndication.twitter.com/srv/timeline-profile/screen-name/${h}`
      );
      console.log("[ArcTip bg] syndication status:", r2.status);

      if (r2.status === 200 && r2.text !== null) {
        const found = r2.text.includes(code);
        console.log("[ArcTip bg] syndication found:", found);
        sendResponse({ found, rateLimit: false });
        return;
      }

      const rateLimit = r1.status === 429 && r2.status === 429;
      console.warn("[ArcTip bg] VERIFY_BIO all strategies failed, statuses:", r1.status, r2.status);
      sendResponse({ found: false, rateLimit, error: `${r1.status}/${r2.status}` });
    })();

    return true;
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
            error: "Bridge not ready on this page. Try refreshing the tab or navigating to any website.",
          });
        } else {
          sendResponse(resp);
        }
      });
    });
    return true;
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
