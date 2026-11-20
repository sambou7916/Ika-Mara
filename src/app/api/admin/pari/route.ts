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
 * GET /api/admin/pari
 * Actions possibles via query param "action" :
 * - liste_cycles (défaut)
 * - detail_cycle (avec cycle_id)
 * - membres_eligibles (pour la création)
 * - decaissements (avec filtres période et personne)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "liste_cycles";
    const cycleId = searchParams.get("cycle_id");

    // -------------------------------------------------------------
    // 1. LISTE DES CYCLES
    // -------------------------------------------------------------
    if (action === "liste_cycles") {
      const { data: cycles, error } = await serviceRole
        .from("cycles_pari")
        .select(`
          id, nom, montant_pot, periodicite, date_debut, date_fin, statut,
          part_journaliere, duree_tour_jours, nombre_participants,
          tour_courant, methode_ordre, parts_commission, cree_le
        `)
        .order("cree_le", { ascending: false });

      if (error) throw error;

      // Récupérer le décompte des tours versés pour chaque cycle
      const { data: toursStats } = await serviceRole
        .from("tours_pari")
        .select("cycle_id, statut");

      const statsMap: Record<string, { total: number; verses: number }> = {};
      (toursStats || []).forEach((t) => {
        if (!statsMap[t.cycle_id]) statsMap[t.cycle_id] = { total: 0, verses: 0 };
        statsMap[t.cycle_id].total += 1;
        if (t.statut === "verse") statsMap[t.cycle_id].verses += 1;
      });

      const cyclesAvecProgression = (cycles || []).map((c) => {
        const stats = statsMap[c.id] || { total: c.nombre_participants || 0, verses: 0 };
        return {
          ...c,
          tours_total: stats.total,
          tours_verses: stats.verses,
          progression_pourcentage:
            stats.total > 0 ? Math.round((stats.verses / stats.total) * 100) : 0,
        };
      });

      return NextResponse.json({
        success: true,
        action: "liste_cycles",
        cycles: cyclesAvecProgression,
      });
    }

    // -------------------------------------------------------------
    // 2. DÉTAIL D'UN CYCLE (Vue cycle, Tour courant, Retards)
    // -------------------------------------------------------------
    if (action === "detail_cycle") {
      if (!cycleId) {
        return NextResponse.json({ success: false, error: "cycle_id requis" }, { status: 400 });
      }

      // Informations du cycle
      const { data: cycle, error: cycleErr } = await serviceRole
        .from("cycles_pari")
        .select("*")
        .eq("id", cycleId)
        .single();

      if (cycleErr || !cycle) {
        return NextResponse.json({ success: false, error: "Cycle introuvable" }, { status: 404 });
      }

      // Participants du cycle ordonnés avec infos membres
      const { data: participants, error: partErr } = await serviceRole
        .from("participants_pari")
        .select(`
          id, cycle_id, membre_id, ordre, statut, motif_suspension,
          date_suspension, penalite_appliquee, cree_le,
          membres:membre_id (id, numero, nom, prenom, telephone, quartier, agent_id)
        `)
        .eq("cycle_id", cycleId)
        .order("ordre", { ascending: true });

      if (partErr) throw partErr;

      // Tours du cycle
      const { data: tours, error: toursErr } = await serviceRole
        .from("tours_pari")
        .select(`
          id, cycle_id, numero_tour, beneficiaire_id, montant_verse,
          date_tour, date_debut, date_fin, montant_cagnotte,
          montant_commission, montant_net, statut, date_decaissement,
          decaisse_par, operation_decaissement_id,
          membres:beneficiaire_id (id, numero, nom, prenom, telephone)
        `)
        .eq("cycle_id", cycleId)
        .order("numero_tour", { ascending: true });

      if (toursErr) throw toursErr;

      // Tour courant (premier tour en attente ou le dernier si tout versé)
      const tourCourant =
        (tours || []).find((t) => t.statut === "en_attente") ||
        (tours && tours.length > 0 ? tours[tours.length - 1] : null);

      let cagnotteCollectee = 0;
      let participantsRetard: Array<{
        membre_id: string;
        numero: string;
        nom: string;
        prenom: string;
        telephone: string | null;
        quartier: string | null;
        cotise: number;
        attendu: number;
        manquant: number;
        jours_retard: number;
      }> = [];

      if (tourCourant) {
        const dateDebutTour = tourCourant.date_debut || cycle.date_debut;
        const dateFinTour = tourCourant.date_fin || tourCourant.date_tour;

        // Récupérer toutes les opérations pari de type 'depot' validées pour ce tour
        const membreIds = (participants || []).map((p: any) => p.membre_id);
        const { data: cotisationsOps } = await serviceRole
          .from("operations")
          .select("membre_id, montant, date_operation")
          .eq("volet", "pari")
          .eq("type", "depot")
          .eq("statut", "validee")
          .in("membre_id", membreIds)
          .gte("date_operation", dateDebutTour)
          .lte("date_operation", dateFinTour);

        const cotiseParMembre: Record<string, number> = {};
        (cotisationsOps || []).forEach((op) => {
          cotiseParMembre[op.membre_id] = (cotiseParMembre[op.membre_id] || 0) + op.montant;
        });

        cagnotteCollectee = Object.values(cotiseParMembre).reduce((s, v) => s + v, 0);

        // Montant attendu par membre pour le tour entier
        const attenduParMembre = cycle.part_journaliere * cycle.duree_tour_jours;

        // Calculer les retards à date
        const now = new Date();
        const dateDebObj = new Date(dateDebutTour);
        const diffJoursEcoules = Math.max(
          0,
          Math.floor((now.getTime() - dateDebObj.getTime()) / (1000 * 3600 * 24)) + 1
        );
        const joursEcoules = Math.min(cycle.duree_tour_jours, diffJoursEcoules);
        const attenduADate = joursEcoules * cycle.part_journaliere;

        participantsRetard = (participants || [])
          .filter((p: any) => p.statut === "actif")
          .map((p: any) => {
            const m = p.membres;
            const cotise = cotiseParMembre[p.membre_id] || 0;
            const manquant = Math.max(0, attenduADate - cotise);
            const joursRetard =
              cycle.part_journaliere > 0 ? Math.ceil(manquant / cycle.part_journaliere) : 0;

            return {
              membre_id: p.membre_id,
              numero: m?.numero || "",
              nom: m?.nom || "",
              prenom: m?.prenom || "",
              telephone: m?.telephone || null,
              quartier: m?.quartier || null,
              cotise,
              attendu: attenduADate,
              manquant,
              jours_retard: joursRetard,
            };
          })
          .filter((p) => p.manquant > 0);
      }

      // Commission calculée pour le tour
      const commissionTour = (cycle.parts_commission || 1) * cycle.part_journaliere;
      const montantNetTour = tourCourant
        ? Math.max(0, (tourCourant.montant_cagnotte || cycle.montant_pot) - commissionTour)
        : 0;

      return NextResponse.json({
        success: true,
        action: "detail_cycle",
        cycle,
        participants: participants || [],
        tours: tours || [],
        tour_courant: tourCourant
          ? {
              ...tourCourant,
              cagnotte_collectee: cagnotteCollectee,
              cagnotte_cible: tourCourant.montant_cagnotte || cycle.montant_pot,
              cagnotte_suffisante:
                cagnotteCollectee >= (tourCourant.montant_cagnotte || cycle.montant_pot),
              montant_manquant: Math.max(
                0,
                (tourCourant.montant_cagnotte || cycle.montant_pot) - cagnotteCollectee
              ),
              commission_tour: commissionTour,
              montant_net: montantNetTour,
              participants_retard: participantsRetard,
            }
          : null,
      });
    }

    // -------------------------------------------------------------
    // 3. MEMBRES ÉLIGIBLES (Pour sélection création d'un cycle)
    // -------------------------------------------------------------
    if (action === "membres_eligibles") {
      const { data: membres, error } = await serviceRole
        .from("membres")
        .select(`
          id, numero, nom, prenom, telephone, quartier, statut,
          profiles:agent_id (nom, identifiant)
        `)
        .eq("statut", "actif")
        .order("numero", { ascending: true });

      if (error) throw error;

      return NextResponse.json({
        success: true,
        action: "membres_eligibles",
        membres: membres || [],
      });
    }

    // -------------------------------------------------------------
    // 4. LISTE DES DÉCAISSEMENTS EFFECTUÉS AVEC FILTRES
    // -------------------------------------------------------------
    if (action === "decaissements") {
      const periode = searchParams.get("periode") || ""; // jour, mois, annee
      const membreFiltre = searchParams.get("beneficiaire_id") || "";
      const search = searchParams.get("search")?.trim().toLowerCase() || "";

      let query = serviceRole
        .from("tours_pari")
        .select(`
          id, cycle_id, numero_tour, date_decaissement, date_tour,
          montant_cagnotte, montant_commission, montant_net,
          cycles_pari:cycle_id (nom),
          membres:beneficiaire_id (id, numero, nom, prenom, telephone, quartier)
        `)
        .eq("statut", "verse")
        .order("date_decaissement", { ascending: false });

      if (membreFiltre) {
        query = query.eq("beneficiaire_id", membreFiltre);
      }

      const now = new Date();
      if (periode === "jour") {
        const today = now.toISOString().slice(0, 10);
        query = query.gte("date_decaissement", today);
      } else if (periode === "mois") {
        const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .slice(0, 10);
        query = query.gte("date_decaissement", firstDayMonth);
      } else if (periode === "annee") {
        const firstDayYear = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
        query = query.gte("date_decaissement", firstDayYear);
      }

      const { data: decaissements, error } = await query;
      if (error) throw error;

      let list = decaissements || [];
      if (search) {
        list = list.filter((d: any) => {
          const m = d.membres;
          const cycleNom = d.cycles_pari?.nom || "";
          const str = `${m?.numero} ${m?.nom} ${m?.prenom} ${m?.telephone} ${cycleNom}`.toLowerCase();
          return str.includes(search);
        });
      }

      const totalDecaisse = list.reduce((sum, d) => sum + (d.montant_net || 0), 0);
      const totalCommissions = list.reduce((sum, d) => sum + (d.montant_commission || 0), 0);

      return NextResponse.json({
        success: true,
        action: "decaissements",
        decaissements: list,
        totaux: {
          total_decaisse: totalDecaisse,
          total_commissions: totalCommissions,
          nombre: list.length,
        },
      });
    }

    return NextResponse.json({ success: false, error: "Action GET non reconnue" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Pari GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/pari
 * Traitement des actions d'administration Ika-Pari :
 * - creer_cycle
 * - tirer_au_sort
 * - reordonner
 * - suspendre_participant
 * - decaisser_tour
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

    // 1. CRÉATION D'UN CYCLE DE TONTINE
    if (action === "creer_cycle") {
      const {
        nom,
        date_debut,
        part_journaliere,
        duree_tour_jours,
        parts_commission,
        membre_ids,
      } = body;

      if (!nom || !date_debut || !part_journaliere || !duree_tour_jours || !membre_ids) {
        return NextResponse.json(
          { success: false, error: "Tous les paramètres obligatoires doivent être renseignés." },
          { status: 400 }
        );
      }

      if (!Array.isArray(membre_ids) || membre_ids.length < 2) {
        return NextResponse.json(
          { success: false, error: "Sélectionnez au moins 2 membres pour démarrer un cycle." },
          { status: 400 }
        );
      }

      const { data: cycleId, error: rpcErr } = await serviceRole.rpc("creer_cycle_pari", {
        p_nom: nom.trim(),
        p_date_debut: date_debut,
        p_part_journaliere: Number(part_journaliere),
        p_duree_tour_jours: Number(duree_tour_jours),
        p_parts_commission: Number(parts_commission || 1),
        p_membre_ids: membre_ids,
        p_admin_id: adminId,
      });

      if (rpcErr) {
        console.error("[Creer Cycle Pari RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec de création du cycle" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        cycle_id: cycleId,
        message: `Cycle « ${nom} » créé avec succès (${membre_ids.length} tours générés).`,
      });
    }

    // 2. TIRAGE AU SORT DE L'ORDRE DE PASSAGE
    if (action === "tirer_au_sort") {
      const { cycle_id } = body;
      if (!cycle_id) {
        return NextResponse.json({ success: false, error: "cycle_id requis" }, { status: 400 });
      }

      const { data: resultats, error: rpcErr } = await serviceRole.rpc("tirer_au_sort_ordre_pari", {
        p_cycle_id: cycle_id,
        p_admin_id: adminId,
      });

      if (rpcErr) {
        console.error("[Tirage au sort Pari RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec du tirage au sort" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        resultats,
        message: "Tirage au sort effectué et figé avec succès dans le journal d'audit.",
      });
    }

    // 3. RÉORDONNANCEMENT MANUEL
    if (action === "reordonner") {
      const { cycle_id, ordres } = body;
      if (!cycle_id || !Array.isArray(ordres)) {
        return NextResponse.json(
          { success: false, error: "cycle_id et liste des ordres requis" },
          { status: 400 }
        );
      }

      const { error: rpcErr } = await serviceRole.rpc("reordonner_participants_pari", {
        p_cycle_id: cycle_id,
        p_ordres: ordres,
        p_admin_id: adminId,
      });

      if (rpcErr) {
        console.error("[Reordonner Pari RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec du réordonnancement" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Ordre de passage mis à jour avec succès.",
      });
    }

    // 4. SUSPENSION D'UN PARTICIPANT EN DÉFAUT
    if (action === "suspendre_participant") {
      const { cycle_id, membre_id, motif } = body;
      if (!cycle_id || !membre_id || !motif || !motif.trim()) {
        return NextResponse.json(
          { success: false, error: "Le motif de suspension est obligatoire." },
          { status: 400 }
        );
      }

      const { data: resSuspension, error: rpcErr } = await serviceRole.rpc(
        "suspendre_participant_pari",
        {
          p_cycle_id: cycle_id,
          p_membre_id: membre_id,
          p_motif: motif.trim(),
          p_admin_id: adminId,
        }
      );

      if (rpcErr) {
        console.error("[Suspendre Participant Pari RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec de suspension du participant" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        ...resSuspension,
      });
    }

    // 5. DÉCAISSEMENT ATOMIQUE DU TOUR
    if (action === "decaisser_tour") {
      const { tour_id } = body;
      if (!tour_id) {
        return NextResponse.json({ success: false, error: "tour_id requis" }, { status: 400 });
      }

      const { data: resDecaissement, error: rpcErr } = await serviceRole.rpc(
        "decaisser_tour_pari",
        {
          p_tour_id: tour_id,
          p_admin_id: adminId,
        }
      );

      if (rpcErr) {
        console.error("[Decaissement Pari RPC Error] :", rpcErr);
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec du décaissement du tour" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        ...resDecaissement,
      });
    }

    return NextResponse.json({ success: false, error: "Action POST non reconnue" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Pari POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
