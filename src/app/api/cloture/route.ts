import { type NextRequest, NextResponse } from "next/server";
import { POST as commissionsPOST } from "@/app/api/admin/commissions/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/cloture
 * Point d'entrée de clôture mensuelle (délégué au contrôleur admin).
 */
export async function POST(request: NextRequest) {
  return commissionsPOST(request);
}
