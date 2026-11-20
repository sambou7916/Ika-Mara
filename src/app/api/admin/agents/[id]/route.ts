import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { pinToPassword, validatePin } from "@/lib/utils/pin";
import { APPAREIL_REVOQUE } from "@/lib/utils/appareil";

export const dynamic = "force-dynamic";

/** Vérification du rôle admin */
async function checkAdmin(request: NextRequest) {
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

  if (!adminUser) return null;

  const { data: profile } = await serviceRole
    .from("profiles")
    .select("id, role, statut")
    .eq("id", adminUser.id)
    .single();

  if (!profile || profile.role !== "admin" || profile.statut !== "actif") {
    return null;
  }

  return { adminId: adminUser.id, serviceRole };
}

/**
 * GET /api/admin/agents/[id]
 * Fiche détaillée de l'agent : identité, appareil, dernière synchro,
 * portefeuille de membres et performance mensuelle.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;
    const { id } = params;

    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);

    // 1. Profil de l'agent
    const { data: agent, error: agentError } = await serviceRole
      .from("profiles")
      .select("id, nom, telephone, identifiant, statut, device_id, derniere_synchro_le, cree_le, modifie_le")
      .eq("id", id)
      .eq("role", "agent")
      .single();

    if (agentError || !agent) {
      return NextResponse.json({ success: false, error: "Agent introuvable" }, { status: 404 });
    }

    // 2. Membres du portefeuille
    const { data: membres } = await serviceRole
      .from("membres")
      .select(`
        id, numero, nom, prenom, profession, telephone, quartier, statut, cree_le,
        souscriptions (id, volet, montant_jour, statut)
      `)
      .eq("agent_id", id)
      .order("numero");

    // 3. Dépôts du mois pour cet agent
    const { data: depotsMois } = await serviceRole
      .from("operations")
      .select("membre_id, montant, date_operation")
      .eq("agent_id", id)
      .eq("type", "depot")
      .eq("statut", "validee")
      .gte("date_operation", firstDayOfMonth);

    // 4. Remises du mois pour cet agent
    const { data: remisesMois } = await serviceRole
      .from("remises_collecte")
      .select("id, montant_attendu, montant_remis, ecart, date_remise, statut, motif")
      .eq("agent_id", id)
      .gte("date_remise", firstDayOfMonth)
      .order("date_remise", { ascending: false });

    // 5. Calcul de la performance
    const totalCollecteMois = (depotsMois || []).reduce((sum, d) => sum + (d.montant || 0), 0);
    const membresServisMois = new Set((depotsMois || []).map((d) => d.membre_id)).size;
    const totalMembres = (membres || []).length;
    const regularite = totalMembres > 0 ? Math.round((membresServisMois / totalMembres) * 100) : 0;

    const totalRemisMois = (remisesMois || []).reduce(
      (sum, r) => sum + (r.montant_remis ?? r.montant_attendu ?? 0),
      0
    );
    const totalEcartsMois = (remisesMois || []).reduce((sum, r) => sum + (r.ecart || 0), 0);
    const remisesLitigieuses = (remisesMois || []).filter((r) => r.ecart !== 0 || r.statut === "a_confirmer").length;

    // Récupérer la liste des autres agents pour la réaffectation
    const { data: autresAgents } = await serviceRole
      .from("profiles")
      .select("id, nom, identifiant")
      .eq("role", "agent")
      .neq("id", id)
      .eq("statut", "actif")
      .order("nom");

    return NextResponse.json({
      success: true,
      agent,
      portefeuille: membres || [],
      autres_agents: autresAgents || [],
      performance: {
        collecte_mois: totalCollecteMois,
        membres_servis_mois: membresServisMois,
        total_membres: totalMembres,
        regularite_pourcent: regularite,
        total_remises_mois: totalRemisMois,
        total_ecarts_mois: totalEcartsMois,
        remises_litigieuses_count: remisesLitigieuses,
      },
      remises_recentes: (remisesMois || []).slice(0, 10),
    });
  } catch (err: unknown) {
    console.error("[Admin Agent Detail GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/agents/[id]
 * Actions d'administration : suspendre, réactiver, révoquer appareil, réinitialiser PIN.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { adminId, serviceRole } = auth;
    const { id } = params;

    const body = await request.json();
    const { action, nouveau_pin } = body;

    const { data: agent } = await serviceRole
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();

    if (!agent) {
      return NextResponse.json({ success: false, error: "Agent introuvable" }, { status: 404 });
    }

    // 1. Action : Suspendre
    if (action === "suspendre") {
      await serviceRole
        .from("profiles")
        .update({ statut: "suspendu", modifie_le: new Date().toISOString() })
        .eq("id", id);

      await serviceRole.from("audit_log").insert({
        qui: adminId,
        quoi: "suspension_agent",
        avant: { statut: agent.statut },
        apres: { statut: "suspendu" },
        details: `Suspension de l'agent ${agent.identifiant} (${agent.nom}). Dès sa prochaine synchro, son appareil sera purgé.`,
      });

      return NextResponse.json({
        success: true,
        message: `L'agent ${agent.identifiant} a été suspendu. Ses accès et données locales seront purgés lors de la prochaine tentative de synchro.`,
      });
    }

    // 2. Action : Réactiver
    if (action === "reactiver") {
      await serviceRole
        .from("profiles")
        .update({ statut: "actif", modifie_le: new Date().toISOString() })
        .eq("id", id);

      await serviceRole.from("audit_log").insert({
        qui: adminId,
        quoi: "reactivation_agent",
        avant: { statut: agent.statut },
        apres: { statut: "actif" },
        details: `Réactivation de l'agent ${agent.identifiant} (${agent.nom}).`,
      });

      return NextResponse.json({
        success: true,
        message: `L'agent ${agent.identifiant} est à nouveau actif.`,
      });
    }

    // 3. Action : Révoquer l'appareil
    if (action === "revoquer_appareil") {
      await serviceRole
        .from("profiles")
        .update({ device_id: APPAREIL_REVOQUE, modifie_le: new Date().toISOString() })
        .eq("id", id);

      await serviceRole.from("audit_log").insert({
        qui: adminId,
        quoi: "revocation_appareil",
        avant: { device_id: agent.device_id },
        apres: { device_id: APPAREIL_REVOQUE },
        details: `Révocation de l'appareil (device_id: ${agent.device_id || "aucun"}) pour l'agent ${agent.identifiant}.`,
      });

      return NextResponse.json({
        success: true,
        message: `L'appareil de l'agent ${agent.identifiant} a été révoqué. Une ré-authentification avec nouveau téléchargement sera exigée.`,
      });
    }

    // 4. Action : Réinitialiser le PIN
    if (action === "reinitialiser_pin") {
      const pinValidation = validatePin(nouveau_pin);
      if (!pinValidation.valid) {
        return NextResponse.json({ success: false, error: pinValidation.error }, { status: 400 });
      }

      // Mise à jour du mot de passe dans Supabase Auth
      const { error: pwdError } = await serviceRole.auth.admin.updateUserById(id, {
        password: pinToPassword(nouveau_pin),
      });

      if (pwdError) {
        throw pwdError;
      }

      // Révoquer le device_id pour forcer la saisie du nouveau PIN avec vérification en ligne
      await serviceRole
        .from("profiles")
        .update({ device_id: APPAREIL_REVOQUE, modifie_le: new Date().toISOString() })
        .eq("id", id);

      await serviceRole.from("audit_log").insert({
        qui: adminId,
        quoi: "reinitialisation_pin_agent",
        details: `Réinitialisation du code PIN pour l'agent ${agent.identifiant} (${agent.nom}).`,
      });

      return NextResponse.json({
        success: true,
        message: `Code PIN réinitialisé avec succès pour l'agent ${agent.identifiant}. L'appareil a été révoqué pour forcer la nouvelle connexion.`,
      });
    }

    return NextResponse.json({ success: false, error: "Action non reconnue" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Agent Action POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
