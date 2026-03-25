// ArcTip — content script bridge (isolated world)
// Relays ARCTIP_ETH messages from chrome.runtime (popup/background) to the
// MAIN-world ethereum_bridge.js via window.postMessage, and back.

(function () {
  const TAG = "ARCTIP_BRIDGE";
  const pending = new Map(); // id -> sendResponse callback
  let reqId = 0;

  // Receive results from the MAIN-world bridge and resolve waiting callbacks
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.tag !== TAG || d.dir !== "eth->cs") return;

    const cb = pending.get(d.id);
    if (!cb) return;
    pending.delete(d.id);

    if (d.error !== undefined) {
      cb({ error: d.error, code: d.code });
    } else {
      cb({ result: d.result });
    }
  });

  // Receive requests forwarded by background.js and proxy to MAIN world
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "ARCTIP_ETH") return false;

    const id = ++reqId;
    pending.set(id, sendResponse);

    window.postMessage(
      { tag: TAG, dir: "cs->eth", id, method: msg.method, params: msg.params },
      "*"
    );

    return true; // keep the message channel open for the async reply
  });
})();
