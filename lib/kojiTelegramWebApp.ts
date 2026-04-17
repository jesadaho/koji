/**
 * โหลด https://telegram.org/js/telegram-web-app.js และเรียก WebApp.ready() / expand()
 */
export async function loadTelegramWebApp(): Promise<NonNullable<Window["Telegram"]>> {
  if (typeof window === "undefined") {
    throw new Error("Telegram WebApp ใช้ได้เฉพาะในเบราว์เซอร์");
  }
  const existing = window.Telegram;
  if (existing?.WebApp) {
    return existing;
  }

  const id = "koji-telegram-web-app-js";
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.id = id;
    el.src = "https://telegram.org/js/telegram-web-app.js";
    el.async = true;
    document.head.appendChild(el);
  }

  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      if (window.Telegram?.WebApp) resolve();
      else reject(new Error("Telegram WebApp ไม่พร้อมหลังโหลดสคริปต์"));
    };
    if (window.Telegram?.WebApp) {
      done();
      return;
    }
    el!.addEventListener("load", () => done());
    el!.addEventListener("error", () => reject(new Error("โหลด telegram-web-app.js ไม่สำเร็จ")));
  });

  const tg = window.Telegram!;
  return tg;
}

export function getTelegramInitData(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initData?.trim() ?? "";
}

export function prepareTelegramMiniAppShell(): void {
  const w = window.Telegram?.WebApp;
  if (!w) return;
  try {
    w.ready();
    w.expand();
  } catch {
    /* ignore */
  }
}

export function getTelegramMiniAppDisplayName(): string {
  const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!u) return "";
  const parts = [u.first_name, u.last_name].filter(Boolean);
  return parts.join(" ").trim() || u.username?.trim() || "";
}
