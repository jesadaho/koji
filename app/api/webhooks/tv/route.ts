import { POST as LegacyPost } from "@/app/api/webhooks/tv/close/route";

/**
 * TradingView webhook (recommended endpoint).
 *
 * This is an alias of `/api/webhooks/tv/close` for backward compatibility.
 * The handler supports both:
 * - cmd: CLOSE_POSITION
 * - cmd: OPEN_POSITION
 */
export const POST = LegacyPost;

