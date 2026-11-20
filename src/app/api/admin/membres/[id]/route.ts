import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Vérification admin */
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
 * GET /api/admin/membres/[id]
 * Fiche complète : identité, soldes, arriérés, souscriptions, historique et opérations.
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

    // 1. Membre avec profil agent
    const { data: membre, error: membreError } = await serviceRole
      .from("membres")
      .select(`
        id, numero, nom, prenom, profession, telephone, quartier, photo_url,
        statut, agent_id, cree_le, modifie_le,
        profiles:agent_id (id, nom, identifiant, telephone)
      `)
      .eq("id", id)
      .single();

    if (membreError || !membre) {
      return NextResponse.json({ success: false, error: "Membre introuvable" }, { status: 404 });
    }

    // 2. Souscriptions et leur historique
    const { data: souscriptions } = await serviceRole
      .from("souscriptions")
      .select(`
        id, volet, montant_jour, parts_commission, date_debut, statut, cree_le,
        historique_souscriptions (id, champ_modifie, ancienne_valeur, nouvelle_valeur, modifie_le)
      `)
      .eq("membre_id", id);

    // 3. Soldes par volet
    const { data: soldes } = await serviceRole
      .from("soldes_membres")
      .select("volet, solde")
      .eq("membre_id", id);

    // 4. Arriérés de crédits
    const { data: arrieres } = await serviceRole
      .from("arrieres_membres")
      .select("*")
      .eq("membre_id", id);

    // 5. Toutes les opérations financières
    const { data: operations } = await serviceRole
      .from("operations")
      .select(`
        id, type, volet, montant, jours_couverts, date_operation, cree_le,
        statut, motif, annule_ref,
        profiles:agent_id (nom, identifiant)
      `)
      .eq("membre_id", id)
      .order("cree_le", { ascending: false });

    return NextResponse.json({
      success: true,
      membre,
      souscriptions: souscriptions || [],
      soldes: soldes || [],
      arrieres: arrieres || [],
      operations: operations || [],
    });
  } catch (err: unknown) {
    console.error("[Admin Membre Detail GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/membres/[id]
 * RÈGLE ABSOLUE : Jamais de DELETE physique si des opérations existent !
 * Si des opérations existent, bascule statut = inactif avec message clair.
 */
export async function DELETE(
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

    // Vérifier si le membre a des opérations
    const { count: opCount } = await serviceRole
      .from("operations")
      .select("id", { count: "exact", head: true })
      .eq("membre_id", id);

    if (opCount && opCount > 0) {
      // Opérations existantes -> REFUS DE SUPPRESSION PHYSIQUE
      // Mise au statut inactif
      await serviceRole
        .from("membres")
        .update({ statut: "inactif", modifie_le: new Date().toISOString() })
        .eq("id", id);

      await serviceRole.from("audit_log").insert({
        qui: adminId,
        quoi: "desactivation_membre",
        details: `Désactivation forcée du membre ${id} car ${opCount} opération(s) financière(s) y sont rattachées.`,
      });

      return NextResponse.json({
        success: true,
        deactivated: true,
        message: `Impossible de supprimer ce membre car ${opCount} opération(s) financière(s) y sont rattachées. Le membre a été automatiquement passé au statut « Inactif ».`,
      });
    }

    // Si aucune opération financière n'existe : suppression autorisée
    const { error: delError } = await serviceRole
      .from("membres")
      .delete()
      .eq("id", id);

    if (delError) throw delError;

    await serviceRole.from("audit_log").insert({
      qui: adminId,
      quoi: "suppression_membre_vierge",
      details: `Suppression physique du membre ${id} (aucune opération financière rattachée).`,
    });

    return NextResponse.json({
      success: true,
      deactivated: false,
      message: "Membre supprimé avec succès.",
    });
  } catch (err: unknown) {
    console.error("[Admin Membre DELETE] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
