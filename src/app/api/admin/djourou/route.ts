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
 * GET /api/admin/djourou
 * Gère les métriques du tableau de bord et les données des 3 onglets :
 * - demandes (avec historique du membre)
 * - en_cours (avec échéancier)
 * - en_retard (avec pénalités et taux d'impayés)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab") || "demandes";
    const creditId = searchParams.get("credit_id");
    const search = searchParams.get("search")?.trim().toLowerCase() || "";

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    // -------------------------------------------------------------
    // 0. MÉTRIQUES GLOBALES DU TABLEAU DE BORD CRÉDIT
    // -------------------------------------------------------------
    const [creditsActifsRes, rembourseMoisRes, echeancesRetardRes, demandesAttenteRes] =
      await Promise.all([
        serviceRole
          .from("credits")
          .select("id, montant_accorde, montant_rembourse, total_du")
          .eq("statut", "en_cours"),
        serviceRole
          .from("operations")
          .select("montant")
          .eq("volet", "djourou")
          .eq("type", "remboursement")
          .eq("statut", "validee")
          .gte("date_operation", firstDayMonth),
        serviceRole
          .from("echeances")
          .select("credit_id, montant_du, montant_paye, date_echeance")
          .lt("date_echeance", todayStr)
          .eq("statut", "a_payer"),
        serviceRole
          .from("operations")
          .select("id")
          .eq("volet", "djourou")
          .eq("type", "demande_credit"),
      ]);

    // Décisions déjà prises sur les demandes
    const { data: decisionsPrises } = await serviceRole
      .from("decisions_demandes")
      .select("demande_id");
    const idsDecides = new Set((decisionsPrises || []).map((d) => d.demande_id));

    const nbDemandesEnAttente = (demandesAttenteRes.data || []).filter(
      (d) => !idsDecides.has(d.id)
    ).length;

    const encoursTotal = (creditsActifsRes.data || []).reduce(
      (s, c) => s + Math.max(0, (c.total_du || c.montant_accorde) - c.montant_rembourse),
      0
    );

    const rembourseDuMois = (rembourseMoisRes.data || []).reduce(
      (s, o) => s + (o.montant || 0),
      0
    );

    const retardsMontant = (echeancesRetardRes.data || []).reduce(
      (s, ech) => s + Math.max(0, ech.montant_du - ech.montant_paye),
      0
    );

    const creditsEnRetardIds = new Set(
      (echeancesRetardRes.data || []).map((ech) => ech.credit_id)
    );
    const nbCreditsEnRetard = creditsEnRetardIds.size;

    const tauxImpayes =
      encoursTotal > 0 ? Math.round((retardsMontant / encoursTotal) * 1000) / 10 : 0;

    const tableauBord = {
      encours_total: encoursTotal,
      rembourse_du_mois: rembourseDuMois,
      retards_montant: retardsMontant,
      nb_credits_retard: nbCreditsEnRetard,
      taux_impayes: tauxImpayes,
      nb_demandes_en_attente: nbDemandesEnAttente,
    };

    // -------------------------------------------------------------
    // 1. ONGLET DEMANDES : DEMANDES EN ATTENTE & HISTORIQUE DU MEMBRE
    // -------------------------------------------------------------
    if (tab === "demandes") {
      const { data: demandesOps, error } = await serviceRole
        .from("operations")
        .select(`
          id, montant, date_operation, cree_le, motif,
          membres:membre_id (id, numero, nom, prenom, telephone, quartier, profession, cree_le),
          profiles:agent_id (id, nom, identifiant)
        `)
        .eq("volet", "djourou")
        .eq("type", "demande_credit")
        .order("cree_le", { ascending: false });

      if (error) throw error;

      const demandesEnAttente = (demandesOps || []).filter((d) => !idsDecides.has(d.id));
      const membreIds = Array.from(
        new Set(demandesEnAttente.map((d: any) => d.membres?.id).filter(Boolean))
      );

      // Récupérer l'historique complet pour ces membres
      let soldesEpargneMap: Record<string, number> = {};
      let regulariteMap: Record<string, { depots30j: number; depots90j: number }> = {};
      let creditsPassesMap: Record<string, { rembourses: number; en_cours: number }> = {};

      if (membreIds.length > 0) {
        // 1. Soldes d'épargne (Ika-Mara)
        const { data: soldesRows } = await serviceRole
          .from("soldes_membres")
          .select("membre_id, solde")
          .eq("volet", "mara")
          .in("membre_id", membreIds);

        (soldesRows || []).forEach((s) => {
          soldesEpargneMap[s.membre_id] = s.solde || 0;
        });

        // 2. Régularité des dépôts
        const { data: depotsRecents } = await serviceRole
          .from("operations")
          .select("membre_id, date_operation")
          .eq("type", "depot")
          .eq("statut", "validee")
          .in("membre_id", membreIds)
          .gte("date_operation", ninetyDaysAgo);

        (depotsRecents || []).forEach((op) => {
          if (!regulariteMap[op.membre_id]) {
            regulariteMap[op.membre_id] = { depots30j: 0, depots90j: 0 };
          }
          regulariteMap[op.membre_id].depots90j += 1;
          if (op.date_operation >= thirtyDaysAgo) {
            regulariteMap[op.membre_id].depots30j += 1;
          }
        });

        // 3. Crédits passés
        const { data: creditsRows } = await serviceRole
          .from("credits")
          .select("membre_id, statut")
          .in("membre_id", membreIds);

        (creditsRows || []).forEach((c) => {
          if (!creditsPassesMap[c.membre_id]) {
            creditsPassesMap[c.membre_id] = { rembourses: 0, en_cours: 0 };
          }
          if (c.statut === "rembourse") creditsPassesMap[c.membre_id].rembourses += 1;
          if (c.statut === "en_cours") creditsPassesMap[c.membre_id].en_cours += 1;
        });
      }

      // Enrichissement des demandes
      const demandesEnrichies = demandesEnAttente.map((d: any) => {
        const m = d.membres;
        const reg = regulariteMap[m?.id] || { depots30j: 0, depots90j: 0 };
        const histCredits = creditsPassesMap[m?.id] || { rembourses: 0, en_cours: 0 };

        return {
          ...d,
          historique: {
            solde_epargne: soldesEpargneMap[m?.id] || 0,
            depots_30j: reg.depots30j,
            depots_90j: reg.depots90j,
            credits_rembourses: histCredits.rembourses,
            credits_en_cours: histCredits.en_cours,
            anciennete_jours: m?.cree_le
              ? Math.floor(
                  (now.getTime() - new Date(m.cree_le).getTime()) / (1000 * 3600 * 24)
                )
              : 0,
          },
        };
      });

      return NextResponse.json({
        success: true,
        tab: "demandes",
        tableau_bord: tableauBord,
        demandes: demandesEnrichies,
      });
    }

    // -------------------------------------------------------------
    // 2. ONGLET EN COURS : CRÉDITS ACTIFS & ÉCHÉANCIERS
    // -------------------------------------------------------------
    if (tab === "en_cours") {
      let query = serviceRole
        .from("credits")
        .select(`
          id, montant_accorde, montant_rembourse, taux_interet,
          date_octroi, date_echeance, statut, periodicite, duree_mois,
          total_interets, total_du, frais_dossier, cree_le,
          membres:membre_id (id, numero, nom, prenom, telephone, quartier),
          profiles:agent_id (id, nom, identifiant)
        `)
        .eq("statut", "en_cours")
        .order("date_octroi", { ascending: false });

      const { data: creditsActifs, error } = await query;
      if (error) throw error;

      // Si un crédit spécifique est demandé pour son échéancier
      let echeances = null;
      if (creditId) {
        const { data: echData } = await serviceRole
          .from("echeances")
          .select("*")
          .eq("credit_id", creditId)
          .order("numero", { ascending: true });
        echeances = echData;
      }

      let list = (creditsActifs || []).map((c: any) => {
        const total = c.total_du || c.montant_accorde;
        const reste = Math.max(0, total - c.montant_rembourse);
        const progression = total > 0 ? Math.round((c.montant_rembourse / total) * 100) : 0;

        return {
          ...c,
          reste_du: reste,
          progression,
        };
      });

      if (search) {
        list = list.filter((c: any) => {
          const m = c.membres;
          const str = `${m?.numero} ${m?.nom} ${m?.prenom} ${m?.telephone} ${m?.quartier}`.toLowerCase();
          return str.includes(search);
        });
      }

      return NextResponse.json({
        success: true,
        tab: "en_cours",
        tableau_bord: tableauBord,
        credits: list,
        echeances,
      });
    }

    // -------------------------------------------------------------
    // 3. ONGLET EN RETARD : CRÉDITS EN SOUFFRANCE & PÉNALITÉS
    // -------------------------------------------------------------
    if (tab === "en_retard") {
      // Récupérer le taux de pénalité paramétré
      const { data: paramPenalite } = await serviceRole
        .from("parametres")
        .select("valeur")
        .eq("cle", "penalite_retard_credit_pourcent")
        .single();
      const penalitePct = Number(paramPenalite?.valeur) || 2;

      // Récupérer toutes les échéances échues non soldées
      const { data: echeancesEnRetard, error } = await serviceRole
        .from("echeances")
        .select(`
          id, credit_id, numero, montant_du, montant_paye, date_echeance, statut,
          credits:credit_id (
            id, montant_accorde, montant_rembourse, total_du, date_octroi,
            membres:membre_id (id, numero, nom, prenom, telephone, quartier),
            profiles:agent_id (id, nom, identifiant)
          )
        `)
        .lt("date_echeance", todayStr)
        .eq("statut", "a_payer")
        .order("date_echeance", { ascending: true });

      if (error) throw error;

      // Regrouper par crédit
      const parCredit: Record<string, any> = {};
      (echeancesEnRetard || []).forEach((ech: any) => {
        const cid = ech.credit_id;
        const c = ech.credits;
        const diffDays = Math.max(
          1,
          Math.floor((now.getTime() - new Date(ech.date_echeance).getTime()) / (1000 * 3600 * 24))
        );
        const montantManquant = Math.max(0, ech.montant_du - ech.montant_paye);

        if (!parCredit[cid]) {
          parCredit[cid] = {
            credit_id: cid,
            credit: c,
            montant_retard: 0,
            max_jours_retard: 0,
            echeances: [],
          };
        }

        parCredit[cid].montant_retard += montantManquant;
        parCredit[cid].max_jours_retard = Math.max(parCredit[cid].max_jours_retard, diffDays);
        parCredit[cid].echeances.push({
          numero: ech.numero,
          date_echeance: ech.date_echeance,
          montant_du: ech.montant_du,
          montant_paye: ech.montant_paye,
          manquant: montantManquant,
          jours_retard: diffDays,
        });
      });

      const retardsList = Object.values(parCredit).map((item: any) => {
        // Pénalité = % paramétré sur le montant en retard × (jours_retard / 30)
        const moisRetard = Math.max(1, Math.ceil(item.max_jours_retard / 30));
        const penalite = Math.round((item.montant_retard * penalitePct * moisRetard) / 100);

        return {
          ...item,
          penalite_calculee: penalite,
          penalite_taux_pct: penalitePct,
        };
      });

      return NextResponse.json({
        success: true,
        tab: "en_retard",
        tableau_bord: tableauBord,
        retards: retardsList,
      });
    }

    return NextResponse.json({ success: false, error: "Onglet inconnu" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Djourou GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/djourou
 * Traite les actions d'octroi, de rejet et de remboursement de crédit :
 * - valider_credit
 * - refuser_credit
 * - rembourser
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

    // 1. VALIDATION ET OCTROI D'UN CRÉDIT (AVEC ÉCHÉANCIER ATOMIQUE)
    if (action === "valider_credit") {
      const {
        demande_id,
        montant_accorde,
        taux_interet,
        frais_dossier,
        periodicite,
        duree_mois,
      } = body;

      if (!demande_id || !montant_accorde || !duree_mois) {
        return NextResponse.json(
          { success: false, error: "Tous les paramètres financiers obligatoires doivent être renseignés." },
          { status: 400 }
        );
      }

      const { data: creditId, error: rpcErr } = await serviceRole.rpc("valider_demande_credit", {
        p_demande_id: demande_id,
        p_admin_id: adminId,
        p_montant_accorde: Number(montant_accorde),
        p_taux_interet: Number(taux_interet || 0),
        p_frais_dossier: Number(frais_dossier || 0),
        p_periodicite: periodicite || "mensuel",
        p_duree_mois: Number(duree_mois),
      });

      if (rpcErr) {
        console.error("[Valider Credit RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec de validation du crédit" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        credit_id: creditId,
        message: "Crédit validé avec succès. L'échéancier et le décaissement de caisse ont été créés.",
      });
    }

    // 2. REFUS D'UNE DEMANDE DE CRÉDIT (MOTIF OBLIGATOIRE)
    if (action === "refuser_credit") {
      const { demande_id, motif } = body;
      if (!demande_id || !motif || !motif.trim()) {
        return NextResponse.json(
          { success: false, error: "Le motif du refus est obligatoire." },
          { status: 400 }
        );
      }

      const { error: rpcErr } = await serviceRole.rpc("rejeter_demande_credit", {
        p_demande_id: demande_id,
        p_admin_id: adminId,
        p_motif: motif.trim(),
      });

      if (rpcErr) {
        console.error("[Refuser Credit RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec du rejet" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Demande de crédit refusée. Le motif a été consigné pour l'adhérent.",
      });
    }

    // 3. ENREGISTREMENT ET IMPUTATION D'UN REMBOURSEMENT (PARTIEL / ANTICIPÉ)
    if (action === "rembourser") {
      const { credit_id, montant, motif, est_anticipe } = body;
      if (!credit_id || !montant || Number(montant) <= 0) {
        return NextResponse.json(
          { success: false, error: "Montant de remboursement invalide." },
          { status: 400 }
        );
      }

      const { data: resRemboursement, error: rpcErr } = await serviceRole.rpc(
        "imputer_remboursement_credit",
        {
          p_credit_id: credit_id,
          p_montant: Number(montant),
          p_agent_id: adminId,
          p_motif: motif || null,
          p_est_anticipe: Boolean(est_anticipe),
        }
      );

      if (rpcErr) {
        console.error("[Imputer Remboursement RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec de l'imputation du remboursement" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        ...resRemboursement,
        message: "Remboursement imputé avec succès sur les échéances les plus anciennes.",
      });
    }

    return NextResponse.json({ success: false, error: "Action POST inconnue" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Djourou POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
