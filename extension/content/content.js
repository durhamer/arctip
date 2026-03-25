// ArcTip content script
// Detects creator pages on Twitter/X and YouTube, injects a "Tip" button

(function () {
  "use strict";

  const PLATFORM = detectPlatform();
  if (!PLATFORM) return;

  let injected = new WeakSet();

  // Observe DOM mutations to catch dynamically loaded profiles
  const observer = new MutationObserver(() => injectButtons());
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial pass
  setTimeout(injectButtons, 1500);

  // ── Platform detection ──────────────────────────────────────────────────

  function detectPlatform() {
    const host = location.hostname;
    if (host.includes("twitter.com") || host.includes("x.com")) return "twitter";
    if (host.includes("youtube.com")) return "youtube";
    return null;
  }

  // ── Button injection ────────────────────────────────────────────────────

  function injectButtons() {
    if (PLATFORM === "twitter") injectTwitterButtons();
    if (PLATFORM === "youtube") injectYoutubeButtons();
  }

  function injectTwitterButtons() {
    // Profile header action bar
    const profileActions = document.querySelectorAll('[data-testid="userActions"]');
    profileActions.forEach((el) => {
      if (injected.has(el)) return;
      injected.add(el);

      const handle = extractTwitterHandle();
      if (!handle) return;

      el.appendChild(createTipButton(handle, "twitter"));
    });
  }

  function injectYoutubeButtons() {
    // Channel page subscribe button area
    const subscribeBtns = document.querySelectorAll("#subscribe-button, #inner-header-container");
    subscribeBtns.forEach((el) => {
      if (injected.has(el)) return;
      injected.add(el);

      const channelName = extractYoutubeChannel();
      if (!channelName) return;

      const wrapper = document.createElement("div");
      wrapper.style.cssText = "display:inline-flex; align-items:center; margin-left:8px;";
      wrapper.appendChild(createTipButton(channelName, "youtube"));
      el.parentElement?.insertBefore(wrapper, el.nextSibling);
    });
  }

  // ── Handle extraction ───────────────────────────────────────────────────

  function extractTwitterHandle() {
    // URL pattern: twitter.com/<handle>
    const match = location.pathname.match(/^\/([A-Za-z0-9_]+)/);
    if (match && !["home", "explore", "notifications", "messages", "i"].includes(match[1])) {
      return "@" + match[1];
    }
    return null;
  }

  function extractYoutubeChannel() {
    const match =
      location.pathname.match(/\/@([^/]+)/) ||
      location.pathname.match(/\/channel\/([^/]+)/) ||
      location.pathname.match(/\/c\/([^/]+)/);
    return match ? match[1] : null;
  }

  // ── Button creation ─────────────────────────────────────────────────────

  function createTipButton(handle, platform) {
    const btn = document.createElement("button");
    btn.textContent = "⚡ Tip";
    btn.setAttribute("data-arctip", "true");
    btn.setAttribute("title", `Send USDC tip to ${handle} via ArcTip`);

    Object.assign(btn.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      background: "#6c63ff",
      color: "#fff",
      border: "none",
      borderRadius: "20px",
      padding: "6px 14px",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      fontFamily: "inherit",
      transition: "background 0.15s",
      marginLeft: "8px",
    });

    btn.addEventListener("mouseenter", () => (btn.style.background = "#7c74ff"));
    btn.addEventListener("mouseleave", () => (btn.style.background = "#6c63ff"));

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTipModal(handle, platform);
    });

    return btn;
  }

  // ── Tip modal ───────────────────────────────────────────────────────────

  function openTipModal(handle, platform) {
    // Remove any existing modal
    document.getElementById("arctip-modal")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "arctip-modal";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "999999",
      fontFamily: "-apple-system, sans-serif",
    });

    overlay.innerHTML = `
      <div style="background:#1a1d27;border-radius:16px;padding:24px;width:340px;
                  box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#e8eaf0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div style="font-weight:700;font-size:16px;">⚡ ArcTip</div>
          <button id="arctip-close" style="background:none;border:none;color:#8890a8;
                  font-size:20px;cursor:pointer;padding:0;">×</button>
        </div>
        <div style="color:#8890a8;font-size:12px;margin-bottom:16px;">
          Tipping <strong style="color:#e8eaf0;">${handle}</strong> on ${platform}
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:11px;color:#8890a8;margin-bottom:4px;">Amount (USDC)</label>
          <input id="arctip-amount" type="number" value="1" min="0.1" step="0.1"
            style="width:100%;background:#232638;border:1px solid #2e3248;border-radius:6px;
                   color:#e8eaf0;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;" />
          <div style="display:flex;gap:6px;margin-top:6px;">
            ${[1,5,10].map(v=>`<button data-quick="${v}" style="flex:1;background:#232638;border:1px solid #2e3248;
              border-radius:6px;color:#8890a8;padding:5px;font-size:11px;cursor:pointer;">$${v}</button>`).join("")}
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:11px;color:#8890a8;margin-bottom:4px;">Message (optional)</label>
          <input id="arctip-msg" type="text" placeholder="Love your content!" maxlength="280"
            style="width:100%;background:#232638;border:1px solid #2e3248;border-radius:6px;
                   color:#e8eaf0;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box;" />
        </div>
        <button id="arctip-send"
          style="width:100%;background:#6c63ff;color:#fff;border:none;border-radius:8px;
                 padding:11px;font-size:13px;font-weight:600;cursor:pointer;">
          Open ArcTip Wallet
        </button>
        <div id="arctip-status" style="margin-top:10px;font-size:11px;color:#8890a8;text-align:center;"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Bind quick amounts
    overlay.querySelectorAll("[data-quick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        overlay.querySelector("#arctip-amount").value = btn.dataset.quick;
      });
    });

    overlay.querySelector("#arctip-close").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector("#arctip-send").addEventListener("click", () => {
      const amount = overlay.querySelector("#arctip-amount").value;
      const msg = overlay.querySelector("#arctip-msg").value;

      // Pass tip intent to extension popup via storage
      chrome.storage.local.set({ pendingTip: { handle, platform, amount, msg } }, () => {
        overlay.querySelector("#arctip-status").textContent =
          "Opening ArcTip extension — approve the tip in the popup.";
      });
    });
  }
})();
