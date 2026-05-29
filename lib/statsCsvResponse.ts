import { NextResponse } from "next/server";
import { statsCsvFilename } from "@/lib/statsCsv";

export { statsCsvFilename };

/** หัวข้อสำหรับ Telegram.WebApp.downloadFile (ดู core.telegram.org/bots/webapps) */
export function statsCsvAttachmentResponse(csv: string, filename: string): NextResponse {
  const safeName = filename.replace(/[^\w.\-]+/g, "_");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
