(function () {
  const $ = (id) => document.getElementById(id);

  function show(el, on) {
    el.classList.toggle("hidden", !on);
  }

  async function api(path, opts = {}) {
    const idToken = liff.getIDToken();
    const headers = {
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(idToken ? { Authorization: "Bearer " + idToken } : {}),
      ...opts.headers,
    };
    const res = await fetch("/api/liff" + path, { ...opts, headers });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text || res.statusText };
    }
    if (!res.ok) {
      const err = new Error(data?.error || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function loadMeta() {
    const { shortcuts } = await fetch("/api/liff/meta").then((r) => r.json());
    const dl = $("syms");
    if (dl && Array.isArray(shortcuts)) {
      dl.innerHTML = shortcuts.map((s) => `<option value="${s}">`).join("");
    }
  }

  async function refreshAlerts() {
    const { alerts } = await api("/alerts");
    const list = $("alert-list");
    const empty = $("alert-empty");
    list.innerHTML = "";
    if (!alerts.length) {
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    for (const a of alerts) {
      const row = document.createElement("div");
      row.className = "alert-item";
      const cond = a.direction === "above" ? "≥" : "≤";
      row.innerHTML = `<div><strong>${a.coinId}</strong><br/><span style="color:var(--muted);font-size:.85rem">${cond} ${a.targetUsd} USDT</span></div>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "danger";
      btn.textContent = "ลบ";
      btn.onclick = async () => {
        if (!confirm("ลบการแจ้งเตือนนี้?")) return;
        try {
          await api("/alerts/" + encodeURIComponent(a.id), { method: "DELETE" });
          await refreshAlerts();
        } catch (e) {
          alert(e.message || "ลบไม่สำเร็จ");
        }
      };
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  async function main() {
    const loading = $("screen-loading");
    const setup = $("screen-setup");
    const app = $("app");

    let cfg;
    try {
      cfg = await fetch("/api/liff/config").then((r) => r.json());
    } catch {
      setup.textContent = "โหลด config ไม่ได้ — ตรวจสอบเครือข่าย";
      show(loading, false);
      show(setup, true);
      return;
    }

    if (!cfg.liffId) {
      setup.innerHTML =
        "<p><strong>ยังไม่ตั้งค่า LIFF</strong></p><p class=\"sub\" style=\"color:var(--muted)\">ใส่ <code>LIFF_ID</code> ใน <code>.env</code> แล้วรีสตาร์ทเซิร์ฟเวอร์</p>";
      show(loading, false);
      show(setup, true);
      return;
    }

    if (!cfg.channelIdConfigured) {
      setup.innerHTML =
        "<p><strong>ยังไม่ตั้งค่า Channel ID</strong></p><p class=\"sub\" style=\"color:var(--muted)\">ใส่ <code>LINE_CHANNEL_ID</code> (ตัวเลขจาก Basic settings ของ OA) เพื่อยืนยันตัวตน LIFF</p>";
      show(loading, false);
      show(setup, true);
      return;
    }

    try {
      await liff.init({ liffId: cfg.liffId, withLoginOnExternalBrowser: true });
    } catch (e) {
      setup.textContent = "LIFF init ล้มเหลว: " + (e.message || e);
      show(loading, false);
      show(setup, true);
      return;
    }

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    show(loading, false);
    show(app, true);

    try {
      const p = await liff.getProfile();
      $("welcome").textContent = "สวัสดี " + (p.displayName || "") + " — MEXC Futures USDT";
    } catch {
      /* ignore */
    }

    await loadMeta();

    $("btn-price").onclick = async () => {
      const sym = $("q-symbol").value.trim();
      const box = $("price-result");
      const errEl = $("price-err");
      show(box, false);
      show(errEl, false);
      if (!sym) {
        show(errEl, true);
        errEl.textContent = "ใส่สัญญาหรือย่อ";
        return;
      }
      try {
        const d = await api("/price?symbol=" + encodeURIComponent(sym));
        box.innerHTML =
          '<div class="price-box">' +
          d.contract +
          "</div><div style=\"margin-top:.5rem;color:var(--muted);font-size:.9rem\">" +
          Number(d.priceUsdt).toLocaleString("en-US", { maximumFractionDigits: 8 }) +
          " USDT</div><div style=\"margin-top:.35rem;font-size:.85rem\">" +
          (d.signal || "") +
          "</div>";
        show(box, true);
      } catch (e) {
        show(errEl, true);
        errEl.textContent = e.message || "ดึงราคาไม่สำเร็จ";
      }
    };

    $("btn-add").onclick = async () => {
      const errEl = $("add-err");
      show(errEl, false);
      const symbol = $("a-symbol").value.trim();
      const direction = $("a-dir").value;
      const target = Number($("a-target").value);
      if (!symbol || !Number.isFinite(target) || target <= 0) {
        show(errEl, true);
        errEl.textContent = "กรอกสัญญาและเป้าราคาให้ครบ";
        return;
      }
      try {
        await api("/alerts", {
          method: "POST",
          body: JSON.stringify({ symbol, direction, target }),
        });
        $("a-target").value = "";
        await refreshAlerts();
      } catch (e) {
        show(errEl, true);
        errEl.textContent = e.message || "บันทึกไม่สำเร็จ";
      }
    };

    try {
      await refreshAlerts();
    } catch (e) {
      setup.innerHTML =
        "<p>ล็อกอินแล้วแต่เรียก API ไม่ได้</p><p class=\"sub\" style=\"color:var(--muted)\">" +
        (e.message || "") +
        "</p><p class=\"sub\" style=\"color:var(--muted)\">ตรวจสอบว่า LIFF เปิด scope <code>openid</code> และ Endpoint URL ชี้มาที่โดเมนนี้</p>";
      show(app, false);
      show(setup, true);
    }
  }

  main().catch((e) => {
    $("screen-loading").textContent = "ข้อผิดพลาด: " + (e.message || e);
  });
})();
