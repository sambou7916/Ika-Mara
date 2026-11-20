import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/membres/reaffecter
 * Réaffectation en masse de membres à un agent cible avec enregistrement dans audit_log.
 */
export async function POST(request: NextRequest) {
  try {
    const serviceRole = createServiceRoleClient();
    const clientSupabase = createServerSupabaseClient();

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
      return NextResponse.json({ success: false, error: "Non authentifié" }, { status: 401 });
    }

    const { data: profile } = await serviceRole
      .from("profiles")
      .select("role, statut")
      .eq("id", adminUser.id)
      .single();

    if (!profile || profile.role !== "admin" || profile.statut !== "actif") {
      return NextResponse.json(
        { success: false, error: "Accès réservé aux administrateurs" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { membre_ids, target_agent_id } = body;

    if (!Array.isArray(membre_ids) || membre_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "Aucun membre sélectionné pour la réaffectation" },
        { status: 400 }
      );
    }

    if (!target_agent_id) {
      return NextResponse.json(
        { success: false, error: "L'agent cible est obligatoire" },
        { status: 400 }
      );
    }

    // Récupérer le nom de l'agent cible
    const { data: agentCible } = await serviceRole
      .from("profiles")
      .select("id, nom, identifiant")
      .eq("id", target_agent_id)
      .eq("role", "agent")
      .single();

    if (!agentCible) {
      return NextResponse.json(
        { success: false, error: "L'agent sélectionné est introuvable" },
        { status: 400 }
      );
    }

    // Mettre à jour les membres et historiser
    let count = 0;
    for (const mId of membre_ids) {
      const { data: membreActuel } = await serviceRole
        .from("membres")
        .select("id, agent_id, numero, nom, prenom")
        .eq("id", mId)
        .single();

      if (membreActuel && membreActuel.agent_id !== target_agent_id) {
        await serviceRole
          .from("membres")
          .update({
            agent_id: target_agent_id,
            modifie_le: new Date().toISOString(),
          })
          .eq("id", mId);

        // Audit log
        await serviceRole.from("audit_log").insert({
          qui: adminUser.id,
          quoi: "reaffectation_agent",
          avant: { membre_id: mId, ancien_agent_id: membreActuel.agent_id },
          apres: { membre_id: mId, nouveau_agent_id: target_agent_id },
          details: `Réaffectation du membre ${membreActuel.numero} (${membreActuel.nom}) vers ${agentCible.nom} (${agentCible.identifiant})`,
        });

        count++;
      }
    }

    return NextResponse.json({
      success: true,
      count,
      message: `${count} membre(s) réaffecté(s) avec succès à ${agentCible.nom}.`,
    });
  } catch (err: unknown) {
    console.error("[Reaffectation API] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
