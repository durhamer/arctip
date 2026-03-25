// ArcTip — Ethereum bridge (MAIN world)
// Runs inside the page's JS context so it can access window.ethereum (MetaMask).
// Communicates with the isolated-world content script via window.postMessage.

(function () {
  const TAG = "ARCTIP_BRIDGE";

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.tag !== TAG || d.dir !== "cs->eth") return;

    const { id, method, params } = d;

    // Special ping to check MetaMask availability
    if (method === "__PING__") {
      window.postMessage(
        { tag: TAG, dir: "eth->cs", id, result: { available: !!window.ethereum } },
        "*"
      );
      return;
    }

    try {
      if (!window.ethereum) throw new Error("MetaMask not detected");
      const result = await window.ethereum.request({ method, params });
      window.postMessage({ tag: TAG, dir: "eth->cs", id, result }, "*");
    } catch (err) {
      window.postMessage(
        { tag: TAG, dir: "eth->cs", id, error: err.message || String(err), code: err.code },
        "*"
      );
    }
  });
})();
