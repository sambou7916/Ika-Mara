import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/dashboard?periode=jour|mois|annee
 *
 * Endpoint sécurisé fournissant les métriques agrégées du tableau de bord admin.
 * Réservé aux administrateurs.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const periode = (searchParams.get("periode") || "jour") as "jour" | "mois" | "annee";

    // 1. Vérifier l'authentification de l'administrateur
    const clientSupabase = createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await clientSupabase.auth.getUser();

    // Si pas de session cookie, vérifier le header Authorization
    let adminUser = user;
    const serviceRole = createServiceRoleClient();

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

    // Vérifier le rôle admin
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

    // 2. Définir les bornes temporelles
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);

    const firstDayOfYear = new Date(now.getFullYear(), 0, 1)
      .toISOString()
      .slice(0, 10);

    let dateDebutPeriode: string;
    let labelPeriode: string;

    if (periode === "annee") {
      dateDebutPeriode = firstDayOfYear;
      labelPeriode = `Année ${now.getFullYear()}`;
    } else if (periode === "mois") {
      dateDebutPeriode = firstDayOfMonth;
      const monthNames = [
        "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
        "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
      ];
      labelPeriode = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    } else {
      dateDebutPeriode = todayStr;
      labelPeriode = "Aujourd'hui";
    }

    // 3. Récupérer les paramètres (seuil de retard)
    const { data: paramSeuil } = await serviceRole
      .from("parametres")
      .select("valeur")
      .eq("cle", "seuil_alerte_retard_jours")
      .single();

    const seuilRetardJours = typeof paramSeuil?.valeur === "number"
      ? paramSeuil.valeur
      : typeof paramSeuil?.valeur === "string"
      ? parseInt(paramSeuil.valeur, 10) || 3
      : 3;

    // 4. Exécuter les requêtes en parallèle
    const [
      agentsRes,
      depotsAujourdhuiRes,
      commissionsMoisRes,
      creditsActifsRes,
      soldeCaisseRes,
      operationsPeriodeRes,
      remisesPeriodeRes,
      alertesRemisesRes,
      alertesDemandesRes,
      alertesEcheancesRes,
    ] = await Promise.all([
      // Tous les agents actifs
      serviceRole
        .from("profiles")
        .select("id, nom, identifiant, telephone, statut")
        .eq("role", "agent")
        .order("nom"),

      // 1. Collecte du jour (dépôts validés du jour)
      serviceRole
        .from("operations")
        .select("montant")
        .eq("type", "depot")
        .eq("statut", "validee")
        .eq("date_operation", todayStr),

      // 2. Commissions du mois
      serviceRole
        .from("operations")
        .select("montant")
        .eq("type", "commission")
        .eq("statut", "validee")
        .gte("date_operation", firstDayOfMonth),

      // 3. Encours de crédit (crédits en cours)
      serviceRole
        .from("credits")
        .select("montant_accorde, montant_rembourse")
        .eq("statut", "en_cours"),

      // 4. Solde caisse
      serviceRole
        .from("caisse_mouvements")
        .select("type, montant"),

      // Opérations de la période pour les agents (dépôts)
      serviceRole
        .from("operations")
        .select("agent_id, membre_id, montant")
        .eq("type", "depot")
        .eq("statut", "validee")
        .gte("date_operation", dateDebutPeriode),

      // Remises de la période pour les agents
      serviceRole
        .from("remises_collecte")
        .select("agent_id, montant_attendu, montant_remis, ecart, statut")
        .gte("date_remise", dateDebutPeriode),

      // Alerte 1 : Remises avec écarts ou à confirmer
      serviceRole
        .from("remises_collecte")
        .select("id, ecart, statut")
        .or("statut.eq.a_confirmer,ecart.neq.0"),

      // Alerte 2 : Demandes à valider
      serviceRole
        .from("operations")
        .select("id, type")
        .in("type", ["demande_retrait", "demande_credit"])
        .eq("statut", "en_attente"),

      // Alerte 3 : Échéances en retard
      serviceRole
        .from("echeances")
        .select("id, date_echeance")
        .eq("statut", "en_retard"),
    ]);

    // Calcul des cartes
    const collecteDuJour = (depotsAujourdhuiRes.data || []).reduce(
      (sum, op) => sum + (op.montant || 0),
      0
    );

    const commissionsDuMois = (commissionsMoisRes.data || []).reduce(
      (sum, op) => sum + (op.montant || 0),
      0
    );

    const encoursCredit = (creditsActifsRes.data || []).reduce(
      (sum, c) => sum + Math.max(0, (c.montant_accorde || 0) - (c.montant_rembourse || 0)),
      0
    );

    let soldeCaisse = 0;
    if (soldeCaisseRes.data && soldeCaisseRes.data.length > 0) {
      soldeCaisse = soldeCaisseRes.data.reduce((sum, m) => {
        return m.type === "entree" ? sum + m.montant : sum - m.montant;
      }, 0);
    } else {
      // Si pas de table de mouvements directe, calcul par défaut depuis les remises
      const { data: allRemises } = await serviceRole
        .from("remises_collecte")
        .select("montant_remis")
        .eq("statut", "validee");
      soldeCaisse = (allRemises || []).reduce((sum, r) => sum + (r.montant_remis || 0), 0);
    }

    // Calcul du tableau par agent
    const agents = agentsRes.data || [];
    const opsPeriode = operationsPeriodeRes.data || [];
    const remisesPeriode = remisesPeriodeRes.data || [];

    const tableauAgents = agents.map((agent) => {
      // Opérations de cet agent
      const agentOps = opsPeriode.filter((o) => o.agent_id === agent.id);
      const membresServisSet = new Set(agentOps.map((o) => o.membre_id));
      const montantCollecte = agentOps.reduce((sum, o) => sum + (o.montant || 0), 0);

      // Remises de cet agent
      const agentRemises = remisesPeriode.filter((r) => r.agent_id === agent.id);
      const montantRemis = agentRemises.reduce(
        (sum, r) => sum + (r.montant_remis ?? r.montant_attendu ?? 0),
        0
      );

      const ecart = montantRemis - montantCollecte;

      return {
        id: agent.id,
        nom: agent.nom,
        identifiant: agent.identifiant,
        telephone: agent.telephone,
        statut: agent.statut,
        membres_servis: membresServisSet.size,
        collecte: montantCollecte,
        remis: montantRemis,
        ecart: ecart,
      };
    });

    // Alertes
    const ecartsRemisesCount = (alertesRemisesRes.data || []).length;
    const demandesAValiderCount = (alertesDemandesRes.data || []).length;
    const retardsEcheancesCount = (alertesEcheancesRes.data || []).length;

    return NextResponse.json({
      success: true,
      periode,
      label_periode: labelPeriode,
      date_debut: dateDebutPeriode,
      date_fin: todayStr,
      cartes: {
        collecte_du_jour: collecteDuJour,
        commissions_du_mois: commissionsDuMois,
        encours_credit: encoursCredit,
        solde_caisse: soldeCaisse,
      },
      tableau_agents: tableauAgents,
      alertes: {
        retards_membres_count: retardsEcheancesCount,
        seuil_retard_jours: seuilRetardJours,
        ecarts_remises_count: ecartsRemisesCount,
        demandes_a_valider_count: demandesAValiderCount,
      },
    });
  } catch (error: unknown) {
    console.error("[Admin API Dashboard] Erreur :", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erreur serveur",
      },
      { status: 500 }
    );
  }
}
