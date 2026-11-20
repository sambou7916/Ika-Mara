import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

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
 * GET /api/admin/caisse
 * Récupère les soldes calculés par vues SQL et les données pour les 3 onglets :
 * - remises (remises des agents, contrôles des écarts)
 * - caisse (mouvements avec solde cumulé dynamique)
 * - banque (mouvements bancaires et solde cumulé)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab") || "remises";
    const dateDebut = searchParams.get("date_debut") || "";
    const dateFin = searchParams.get("date_fin") || "";
    const agentId = searchParams.get("agent_id") || "";
    const statutFilter = searchParams.get("statut") || "";
    const typeFilter = searchParams.get("type") || "";

    // 0. SOLDES CALCULÉS PAR VUES SQL (JAMAIS STOCKÉS EN DUR)
    const [soldeCaisseRes, soldeBanqueRes, alertesRemisesRes, agentsRes] = await Promise.all([
      serviceRole.from("solde_caisse").select("*").single(),
      serviceRole.from("solde_banque").select("*").single(),
      serviceRole
        .from("remises_collecte")
        .select("id, statut, ecart"),
      serviceRole
        .from("profiles")
        .select("id, nom, identifiant")
        .eq("role", "agent")
        .order("nom"),
    ]);

    const soldeCaisse = soldeCaisseRes.data?.solde || 0;
    const soldeBanque = soldeBanqueRes.data?.solde || 0;
    const totalTresorerie = soldeCaisse + soldeBanque;

    const remisesEnAttenteCount = (alertesRemisesRes.data || []).filter(
      (r) => r.statut === "a_confirmer"
    ).length;
    const remisesEcartsCount = (alertesRemisesRes.data || []).filter(
      (r) => r.statut === "ecart" || (r.statut === "a_confirmer" && r.ecart !== 0)
    ).length;

    const cartesTresorerie = {
      solde_caisse: soldeCaisse,
      total_entrees_caisse: soldeCaisseRes.data?.total_entrees || 0,
      total_sorties_caisse: soldeCaisseRes.data?.total_sorties || 0,
      solde_banque: soldeBanque,
      total_entrees_banque: soldeBanqueRes.data?.total_entrees || 0,
      total_sorties_banque: soldeBanqueRes.data?.total_sorties || 0,
      total_tresorerie: totalTresorerie,
      remises_en_attente_count: remisesEnAttenteCount,
      remises_ecarts_count: remisesEcartsCount,
    };

    // -------------------------------------------------------------
    // 1. ONGLET REMISES DE COLLECTE
    // -------------------------------------------------------------
    if (tab === "remises") {
      let query = serviceRole
        .from("remises_collecte")
        .select(`
          id, agent_id, montant, montant_attendu, montant_remis,
          ecart, motif, statut, commentaire_admin, confirme_le, cree_le, date_remise,
          profiles:agent_id (id, nom, identifiant, telephone),
          admin:confirme_par (nom)
        `)
        .order("date_remise", { ascending: false })
        .order("cree_le", { ascending: false });

      if (dateDebut) query = query.gte("date_remise", dateDebut);
      if (dateFin) query = query.lte("date_remise", dateFin);
      if (agentId) query = query.eq("agent_id", agentId);
      if (statutFilter) query = query.eq("statut", statutFilter);

      const { data: remises, error } = await query;
      if (error) throw error;

      return NextResponse.json({
        success: true,
        tab: "remises",
        cartes: cartesTresorerie,
        remises: remises || [],
        agents: agentsRes.data || [],
      });
    }

    // -------------------------------------------------------------
    // 2. ONGLET MOUVEMENTS DE CAISSE AVEC SOLDE CUMULÉ DYNAMIQUE
    // -------------------------------------------------------------
    if (tab === "caisse") {
      let query = serviceRole
        .from("caisse_mouvements")
        .select("*")
        .order("date_mouvement", { ascending: true })
        .order("cree_le", { ascending: true });

      if (dateDebut) query = query.gte("date_mouvement", dateDebut);
      if (dateFin) query = query.lte("date_mouvement", dateFin);
      if (typeFilter) query = query.eq("type", typeFilter);

      const { data: rawMouvements, error } = await query;
      if (error) throw error;

      // Calcul du solde cumulé chronologique
      let runningSolde = 0;
      const mouvementsAvecSolde = (rawMouvements || []).map((m) => {
        if (m.type === "entree") {
          runningSolde += m.montant;
        } else {
          runningSolde -= m.montant;
        }
        return {
          ...m,
          solde_cumule: runningSolde,
        };
      });

      // Présentation du plus récent au plus ancien pour l'affichage utilisateur
      mouvementsAvecSolde.reverse();

      return NextResponse.json({
        success: true,
        tab: "caisse",
        cartes: cartesTresorerie,
        mouvements: mouvementsAvecSolde,
        agents: agentsRes.data || [],
      });
    }

    // -------------------------------------------------------------
    // 3. ONGLET BANQUE & TRANSFERTS AVEC SOLDE CUMULÉ
    // -------------------------------------------------------------
    if (tab === "banque") {
      let query = serviceRole
        .from("banque_mouvements")
        .select("*")
        .order("date_mouvement", { ascending: true })
        .order("cree_le", { ascending: true });

      if (dateDebut) query = query.gte("date_mouvement", dateDebut);
      if (dateFin) query = query.lte("date_mouvement", dateFin);
      if (typeFilter) query = query.eq("type", typeFilter);

      const { data: rawBanque, error } = await query;
      if (error) throw error;

      let runningBanque = 0;
      const mouvementsBanque = (rawBanque || []).map((m) => {
        if (m.type === "entree") {
          runningBanque += m.montant;
        } else {
          runningBanque -= m.montant;
        }
        return {
          ...m,
          solde_cumule: runningBanque,
        };
      });

      mouvementsBanque.reverse();

      return NextResponse.json({
        success: true,
        tab: "banque",
        cartes: cartesTresorerie,
        mouvements: mouvementsBanque,
        agents: agentsRes.data || [],
      });
    }

    return NextResponse.json({ success: false, error: "Onglet inconnu" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Caisse GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/caisse
 * Actions :
 * - confirmer_remise
 * - mouvement_caisse
 * - mouvement_banque
 * - transfert
 * - annuler_mouvement
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { adminId, serviceRole } = auth;

    const body = await request.json();
    const { action } = body;

    // 1. CONFIRMATION D'UNE REMISE DE COLLECTE
    if (action === "confirmer_remise") {
      const { remise_id, commentaire } = body;
      if (!remise_id) {
        return NextResponse.json({ success: false, error: "remise_id requis" }, { status: 400 });
      }

      const { data: resConf, error: rpcErr } = await serviceRole.rpc("confirmer_remise_collecte", {
        p_remise_id: remise_id,
        p_admin_id: adminId,
        p_commentaire: commentaire || null,
      });

      if (rpcErr) {
        console.error("[Confirmer Remise RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec de confirmation de la remise" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        ...resConf,
      });
    }

    // 2. SAISIE MANUELLE CAISSE (ENTRÉE OU SORTIE AVEC MOTIF OBLIGATOIRE)
    if (action === "mouvement_caisse") {
      const { type, montant, libelle, motif } = body;
      if (!type || !montant || !libelle || !motif || !motif.trim()) {
        return NextResponse.json(
          { success: false, error: "Tous les champs (y compris le motif obligatoire) sont requis." },
          { status: 400 }
        );
      }

      const { data: mId, error: rpcErr } = await serviceRole.rpc("ajouter_mouvement_caisse", {
        p_type: type,
        p_montant: Number(montant),
        p_libelle: libelle.trim(),
        p_motif: motif.trim(),
        p_admin_id: adminId,
      });

      if (rpcErr) {
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec d'enregistrement" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        mouvement_id: mId,
        message: "Mouvement de caisse enregistré avec succès.",
      });
    }

    // 3. SAISIE MANUELLE BANQUE
    if (action === "mouvement_banque") {
      const { type, montant, libelle, motif } = body;
      if (!type || !montant || !libelle) {
        return NextResponse.json(
          { success: false, error: "Type, montant et libellé sont requis." },
          { status: 400 }
        );
      }

      const { data: mId, error: rpcErr } = await serviceRole.rpc("ajouter_mouvement_banque", {
        p_type: type,
        p_montant: Number(montant),
        p_libelle: libelle.trim(),
        p_motif: motif?.trim() || "Opération bancaire manuelle",
        p_admin_id: adminId,
      });

      if (rpcErr) {
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec d'enregistrement" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        mouvement_id: mId,
        message: "Mouvement bancaire enregistré avec succès.",
      });
    }

    // 4. TRANSFERT CAISSE <-> BANQUE
    if (action === "transfert") {
      const { sens, montant, libelle } = body;
      if (!sens || !montant || Number(montant) <= 0) {
        return NextResponse.json(
          { success: false, error: "Sens et montant valide requis." },
          { status: 400 }
        );
      }

      const { data: resTransf, error: rpcErr } = await serviceRole.rpc("transferer_caisse_banque", {
        p_sens: sens,
        p_montant: Number(montant),
        p_libelle: libelle || null,
        p_admin_id: adminId,
      });

      if (rpcErr) {
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec du transfert" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        ...resTransf,
      });
    }

    // 5. ANNULATION D'UN MOUVEMENT PAR CONTRE-PASSATION (ÉCRITURE INVERSE LIÉE)
    if (action === "annuler_mouvement") {
      const { module: mod, mouvement_id, motif } = body;
      if (!mouvement_id || !motif || !motif.trim()) {
        return NextResponse.json(
          { success: false, error: "Le motif d'annulation est obligatoire." },
          { status: 400 }
        );
      }

      const rpcName = mod === "banque" ? "annuler_mouvement_banque" : "annuler_mouvement_caisse";
      const { data: invId, error: rpcErr } = await serviceRole.rpc(rpcName, {
        p_mouvement_id: mouvement_id,
        p_motif: motif.trim(),
        p_admin_id: adminId,
      });

      if (rpcErr) {
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec de l'annulation" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        mouvement_inverse_id: invId,
        message: "Mouvement annulé avec succès par contre-passation.",
      });
    }

    return NextResponse.json({ success: false, error: "Action POST inconnue" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Caisse POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
