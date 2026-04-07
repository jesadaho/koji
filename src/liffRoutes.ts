import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "./config";
import { verifyLiffIdToken } from "./liffAuth";
import { addAlert, listAlertsForUser, removeAlertById } from "./alertsStore";
import { resolveContractSymbol, BASE_TO_CONTRACT } from "./coinMap";
import { fetchSimplePrices, formatSignal } from "./cryptoService";

export const liffRouter = Router();

declare global {
  namespace Express {
    interface Request {
      lineUserId?: string;
    }
  }
}

function requireChannelId(_req: Request, res: Response, next: NextFunction): void {
  if (!config.lineChannelId) {
    res.status(503).json({ error: "ตั้งค่า LINE_CHANNEL_ID ในเซิร์ฟเวอร์ก่อน (ใช้ยืนยัน LIFF)" });
    return;
  }
  next();
}

async function authenticateLiff(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    res.status(401).json({ error: "ต้องล็อกอิน LINE" });
    return;
  }
  const idToken = raw.slice(7).trim();
  if (!idToken) {
    res.status(401).json({ error: "ต้องล็อกอิน LINE" });
    return;
  }
  try {
    const { userId } = await verifyLiffIdToken(idToken, config.lineChannelId!);
    req.lineUserId = userId;
    next();
  } catch {
    res.status(401).json({ error: "โทเคนไม่ถูกต้องหรือหมดอายุ ลองปิดแล้วเปิดแอปใหม่" });
  }
}

liffRouter.get("/config", (_req, res) => {
  res.json({
    liffId: config.liffId ?? null,
    channelIdConfigured: Boolean(config.lineChannelId),
  });
});

liffRouter.get("/meta", (_req, res) => {
  const shortcuts = Object.keys(BASE_TO_CONTRACT).sort();
  res.json({
    shortcuts,
    hint: "พิมพ์ย่อ (btc) หรือสัญญาเต็ม (BTC_USDT)",
  });
});

liffRouter.use(requireChannelId);
liffRouter.use(authenticateLiff);

liffRouter.get("/alerts", async (req, res) => {
  const list = await listAlertsForUser(req.lineUserId!);
  res.json({ alerts: list });
});

liffRouter.post("/alerts", async (req, res) => {
  const { symbol, direction, target } = req.body ?? {};
  if (direction !== "above" && direction !== "below") {
    res.status(400).json({ error: "direction ต้องเป็น above หรือ below" });
    return;
  }
  const t = typeof target === "number" ? target : Number(target);
  if (!Number.isFinite(t) || t <= 0) {
    res.status(400).json({ error: "target ต้องเป็นตัวเลขบวก" });
    return;
  }
  if (typeof symbol !== "string" || !symbol.trim()) {
    res.status(400).json({ error: "ระบุ symbol" });
    return;
  }
  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    res.status(400).json({ error: "ไม่รู้จักคู่นี้" });
    return;
  }
  const row = await addAlert({
    userId: req.lineUserId!,
    coinId: resolved.contractSymbol,
    symbolLabel: resolved.label,
    direction,
    targetUsd: t,
  });
  res.status(201).json({ alert: row });
});

liffRouter.delete("/alerts/:id", async (req, res) => {
  const ok = await removeAlertById(req.lineUserId!, req.params.id);
  if (!ok) {
    res.status(404).json({ error: "ไม่พบการแจ้งเตือน" });
    return;
  }
  res.status(204).end();
});

liffRouter.get("/price", async (req, res) => {
  const q = req.query.symbol;
  const symbol = typeof q === "string" ? q : "";
  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    res.status(400).json({ error: "ไม่รู้จักคู่นี้" });
    return;
  }
  try {
    const prices = await fetchSimplePrices([resolved.contractSymbol]);
    const quote = prices[resolved.contractSymbol];
    if (!quote) {
      res.status(502).json({ error: "ดึงราคาไม่สำเร็จ" });
      return;
    }
    res.json({
      contract: resolved.contractSymbol,
      priceUsdt: quote.usd,
      change24hPercent: quote.usd_24h_change,
      signal: formatSignal(quote.usd_24h_change),
    });
  } catch {
    res.status(502).json({ error: "MEXC ไม่พร้อม" });
  }
});
