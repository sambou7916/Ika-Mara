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
 * GET /api/admin/mara
 * Données pour les 3 onglets : Dépôts, Retraits à valider, Soldes.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab") || "depots";
    const dateDebut = searchParams.get("date_debut") || "";
    const dateFin = searchParams.get("date_fin") || "";
    const agentId = searchParams.get("agent_id") || "";
    const search = searchParams.get("search")?.trim() || "";

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const firstDayOfYear = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);

    // Récupérer les paramètres appliqués à Ika-Mara
    const { data: paramsRows } = await serviceRole
      .from("parametres")
      .select("cle, valeur")
      .in("cle", ["delai_min_retrait_jours", "frais_retrait_pourcent", "frais_retrait_fixe"]);

    const parametresMara: Record<string, number> = {
      delai_min_retrait_jours: 30,
      frais_retrait_pourcent: 0,
      frais_retrait_fixe: 0,
    };

    (paramsRows || []).forEach((p) => {
      parametresMara[p.cle] = Number(p.valeur) || 0;
    });

    // 1. Liste des agents disponibles pour filtrer
    const { data: agents } = await serviceRole
      .from("profiles")
      .select("id, nom, identifiant")
      .eq("role", "agent")
      .order("nom");

    // ------------------ ONGLET 1 : DÉPÔTS ------------------
    if (tab === "depots") {
      // Totaux globaux
      const [depotsJourRes, depotsMoisRes, depotsAnneeRes] = await Promise.all([
        serviceRole
          .from("operations")
          .select("montant")
          .eq("volet", "mara")
          .eq("type", "depot")
          .eq("statut", "validee")
          .eq("date_operation", todayStr),
        serviceRole
          .from("operations")
          .select("montant")
          .eq("volet", "mara")
          .eq("type", "depot")
          .eq("statut", "validee")
          .gte("date_operation", firstDayOfMonth),
        serviceRole
          .from("operations")
          .select("montant")
          .eq("volet", "mara")
          .eq("type", "depot")
          .eq("statut", "validee")
          .gte("date_operation", firstDayOfYear),
      ]);

      const totalJour = (depotsJourRes.data || []).reduce((s, o) => s + (o.montant || 0), 0);
      const totalMois = (depotsMoisRes.data || []).reduce((s, o) => s + (o.montant || 0), 0);
      const totalAnnee = (depotsAnneeRes.data || []).reduce((s, o) => s + (o.montant || 0), 0);

      // Requête filtrée pour la liste des dépôts
      let query = serviceRole
        .from("operations")
        .select(`
          id, montant, jours_couverts, date_operation, cree_le, statut, motif, annule_ref,
          membres:membre_id (id, numero, nom, prenom, telephone, quartier),
          profiles:agent_id (id, nom, identifiant)
        `)
        .eq("volet", "mara")
        .eq("type", "depot")
        .order("cree_le", { ascending: false })
        .limit(200);

      if (dateDebut) query = query.gte("date_operation", dateDebut);
      if (dateFin) query = query.lte("date_operation", dateFin);
      if (agentId) query = query.eq("agent_id", agentId);

      const { data: depots, error } = await query;
      if (error) throw error;

      let depotsFiltres = depots || [];
      if (search) {
        depotsFiltres = depotsFiltres.filter((d: any) => {
          const m = d.membres;
          const str = `${m?.numero} ${m?.nom} ${m?.prenom} ${m?.telephone} ${m?.quartier}`.toLowerCase();
          return str.includes(search.toLowerCase());
        });
      }

      const totalFiltre = depotsFiltres.reduce((s, o) => s + (o.montant || 0), 0);

      return NextResponse.json({
        success: true,
        tab: "depots",
        totaux: {
          total_jour: totalJour,
          total_mois: totalMois,
          total_annee: totalAnnee,
          total_filtre: totalFiltre,
        },
        depots: depotsFiltres,
        agents: agents || [],
        parametres: parametresMara,
      });
    }

    // ------------------ ONGLET 2 : RETRAITS À VALIDER ------------------
    if (tab === "retraits") {
      // 1. Récupérer les décisions déjà prises
      const { data: decisionsPrises } = await serviceRole
        .from("decisions_demandes")
        .select("demande_id");
      const idsTraites = new Set((decisionsPrises || []).map((d) => d.demande_id));

      // 2. Récupérer toutes les demandes de retrait
      const { data: demandes, error } = await serviceRole
        .from("operations")
        .select(`
          id, montant, date_operation, cree_le, statut, motif,
          membres:membre_id (id, numero, nom, prenom, telephone, quartier, cree_le),
          profiles:agent_id (id, nom, identifiant)
        `)
        .eq("volet", "mara")
        .eq("type", "demande_retrait")
        .order("cree_le", { ascending: false });

      if (error) throw error;

      // Filtrer les demandes en attente non encore décidées
      const demandesEnAttente = (demandes || []).filter((d) => !idsTraites.has(d.id));

      // 3. Récupérer le solde disponible pour chaque membre demandeur
      const membreIds = Array.from(new Set(demandesEnAttente.map((d: any) => d.membres?.id).filter(Boolean)));

      let soldesMap: Record<string, number> = {};
      if (membreIds.length > 0) {
        const { data: soldesRows } = await serviceRole
          .from("soldes_membres")
          .select("membre_id, solde")
          .eq("volet", "mara")
          .in("membre_id", membreIds);

        (soldesRows || []).forEach((s) => {
          soldesMap[s.membre_id] = s.solde || 0;
        });
      }

      const retraitsAvecSolde = demandesEnAttente.map((d: any) => {
        const soldeDispo = soldesMap[d.membres?.id] || 0;
        const ancienneteJours = d.membres?.cree_le
          ? Math.floor((now.getTime() - new Date(d.membres.cree_le).getTime()) / (1000 * 3600 * 24))
          : 0;

        const delaiAtteint = ancienneteJours >= parametresMara.delai_min_retrait_jours;
        const soldeSuffisant = soldeDispo >= (d.montant || 0);

        return {
          ...d,
          solde_disponible: soldeDispo,
          anciennete_jours: ancienneteJours,
          delai_atteint: delaiAtteint,
          solde_suffisant: soldeSuffisant,
          peut_valider: delaiAtteint && soldeSuffisant,
        };
      });

      return NextResponse.json({
        success: true,
        tab: "retraits",
        retraits: retraitsAvecSolde,
        parametres: parametresMara,
        agents: agents || [],
      });
    }

    // ------------------ ONGLET 3 : SOLDES ÉPARGNE ------------------
    if (tab === "soldes") {
      // Récupérer la vue des soldes par membre
      const { data: soldesRows, error } = await serviceRole
        .from("soldes_membres")
        .select(`
          membre_id, numero, nom, prenom, agent_id, solde
        `)
        .eq("volet", "mara")
        .order("solde", { ascending: false });

      if (error) throw error;

      // Récupérer les profils agents et détails membres
      const { data: membresDetails } = await serviceRole
        .from("membres")
        .select(`
          id, quartier, telephone, statut,
          profiles:agent_id (nom, identifiant)
        `);

      const membresMap: Record<string, any> = {};
      (membresDetails || []).forEach((m) => {
        membresMap[m.id] = m;
      });

      // Calculer les cumuls détaillés (dépôts, commissions, retraits)
      const { data: opsMara } = await serviceRole
        .from("operations")
        .select("membre_id, type, montant")
        .eq("volet", "mara")
        .eq("statut", "validee");

      const cumulsMap: Record<string, { depots: number; retraits: number; commissions: number }> = {};
      (opsMara || []).forEach((op) => {
        if (!cumulsMap[op.membre_id]) {
          cumulsMap[op.membre_id] = { depots: 0, retraits: 0, commissions: 0 };
        }
        if (op.type === "depot") cumulsMap[op.membre_id].depots += op.montant;
        if (op.type === "retrait") cumulsMap[op.membre_id].retraits += op.montant;
        if (op.type === "commission") cumulsMap[op.membre_id].commissions += op.montant;
      });

      let soldesComplets = (soldesRows || []).map((s) => {
        const mInfo = membresMap[s.membre_id] || {};
        const cumuls = cumulsMap[s.membre_id] || { depots: 0, retraits: 0, commissions: 0 };
        return {
          membre_id: s.membre_id,
          numero: s.numero,
          nom: s.nom,
          prenom: s.prenom,
          quartier: mInfo.quartier || "—",
          telephone: mInfo.telephone || "—",
          statut_membre: mInfo.statut || "actif",
          agent_id: s.agent_id,
          agent_nom: mInfo.profiles?.nom || "—",
          agent_identifiant: mInfo.profiles?.identifiant || "—",
          cumul_depots: cumuls.depots,
          cumul_retraits: cumuls.retraits,
          cumul_commissions: cumuls.commissions,
          solde_net: s.solde || 0,
        };
      });

      if (agentId) {
        soldesComplets = soldesComplets.filter((s) => s.agent_id === agentId || s.agent_identifiant === agentId);
      }

      if (search) {
        const q = search.toLowerCase();
        soldesComplets = soldesComplets.filter((s) =>
          `${s.numero} ${s.nom} ${s.prenom} ${s.quartier} ${s.agent_nom}`.toLowerCase().includes(q)
        );
      }

      const totalEpargneNet = soldesComplets.reduce((sum, s) => sum + s.solde_net, 0);

      return NextResponse.json({
        success: true,
        tab: "soldes",
        total_epargne_net: totalEpargneNet,
        soldes: soldesComplets,
        agents: agents || [],
        parametres: parametresMara,
      });
    }

    return NextResponse.json({ success: false, error: "Onglet non reconnu" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Mara GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/mara
 * Validation atomique ou refus motivé d'une demande de retrait d'épargne.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { adminId, serviceRole } = auth;

    const body = await request.json();
    const { action, demande_id, motif } = body;

    if (!demande_id) {
      return NextResponse.json({ success: false, error: "Identifiant de demande requis" }, { status: 400 });
    }

    // 1. Validation de la demande de retrait
    if (action === "valider_retrait") {
      const { data: retraitId, error: valError } = await serviceRole.rpc("valider_demande_retrait", {
        p_demande_id: demande_id,
        p_admin_id: adminId,
        p_motif: motif || null,
      });

      if (valError) {
        console.error("[Validation Retrait Error] :", valError);
        return NextResponse.json(
          { success: false, error: valError.message || "Échec de validation du retrait" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        retrait_id: retraitId,
        message: "Demande de retrait validée avec succès. L'opération de retrait et le décaissement ont été enregistrés.",
      });
    }

    // 2. Refus de la demande de retrait
    if (action === "refuser_retrait") {
      if (!motif || !motif.trim()) {
        return NextResponse.json(
          { success: false, error: "Le motif de refus est obligatoire" },
          { status: 400 }
        );
      }

      const { error: refError } = await serviceRole.rpc("rejeter_demande_retrait", {
        p_demande_id: demande_id,
        p_admin_id: adminId,
        p_motif: motif.trim(),
      });

      if (refError) {
        console.error("[Refus Retrait Error] :", refError);
        return NextResponse.json(
          { success: false, error: refError.message || "Échec du rejet" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Demande de retrait rejetée. Le motif a été consigné pour le membre et l'agent.",
      });
    }

    return NextResponse.json({ success: false, error: "Action non reconnue" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Mara POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
