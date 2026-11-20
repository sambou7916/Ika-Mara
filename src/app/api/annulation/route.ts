import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/annulation
 *
 * Annulation d'une opération financière par écriture inverse.
 * Motif obligatoire + inscription dans audit_log.
 * Réservé aux administrateurs.
 */
export async function POST(request: NextRequest) {
  try {
    const serviceRole = createServiceRoleClient();
    const clientSupabase = createServerSupabaseClient();

    // 1. Authentification admin
    const {
      data: { user },
    } = await clientSupabase.auth.getUser();

    let adminUser = user;
    if (!adminUser) {
      const authHeader = request.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "");
        const { data } = await serviceRole.auth.getUser(token);
        adminUser = data.user;
      }
    }

    if (!adminUser) {
      return NextResponse.json(
        { success: false, error: "Non authentifié" },
        { status: 401 }
      );
    }

    const { data: profile } = await serviceRole
      .from("profiles")
      .select("role, statut")
      .eq("id", adminUser.id)
      .single();

    if (!profile || profile.role !== "admin" || profile.statut !== "actif") {
      return NextResponse.json(
        { success: false, error: "Action réservée aux administrateurs" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { operationId, motif } = body;

    if (!operationId) {
      return NextResponse.json(
        { success: false, error: "Identifiant d'opération requis" },
        { status: 400 }
      );
    }

    if (!motif || typeof motif !== "string" || motif.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Le motif d'annulation est obligatoire" },
        { status: 400 }
      );
    }

    // 2. Appel de la fonction SQL sécurisée annuler_operation
    const { data: annulationId, error } = await serviceRole.rpc(
      "annuler_operation",
      {
        p_operation_id: operationId,
        p_agent_id: adminUser.id,
        p_motif: motif.trim(),
      }
    );

    if (error) {
      console.error("[Annulation API] Erreur SQL :", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      annulationId,
      message: "Opération annulée avec succès par écriture inverse.",
    });
  } catch (err: unknown) {
    console.error("[Annulation API] Erreur :", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Erreur serveur",
      },
      { status: 500 }
    );
  }
}
