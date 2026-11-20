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
 * GET /api/admin/commissions
 * Liste détaillée des commissions par membre/volet, totaux acquis / à prélever,
 * et statut de clôture mensuelle.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const annee = Number(searchParams.get("annee")) || now.getFullYear();
    const mois = Number(searchParams.get("mois")) || now.getMonth() + 1;
    const agentId = searchParams.get("agent_id") || "";
    const voletFilter = searchParams.get("volet") || "";
    const search = searchParams.get("search")?.trim().toLowerCase() || "";

    const dateDebutMois = new Date(annee, mois - 1, 1).toISOString().slice(0, 10);
    const dateFinMois = new Date(annee, mois, 0).toISOString().slice(0, 10);
    const debutAnnee = new Date(annee, 0, 1).toISOString().slice(0, 10);
    const finAnnee = new Date(annee, 11, 31).toISOString().slice(0, 10);

    // 1. Vérifier si ce mois a été officiellement clôturé
    const { data: clotureRow } = await serviceRole
      .from("clotures_mensuelles")
      .select(`
        id, annee, mois, nombre_commissions, montant_total, cloture_le,
        profiles:cloture_par (nom)
      `)
      .eq("annee", annee)
      .eq("mois", mois)
      .maybeSingle();

    // 2. Récupérer les commissions déjà prélevées pour ce mois
    let opsQuery = serviceRole
      .from("operations")
      .select(`
        id, montant, date_operation, cree_le, volet, membre_id, agent_id, annule_ref,
        membres:membre_id (id, numero, nom, prenom, telephone, quartier),
        profiles:agent_id (id, nom, identifiant)
      `)
      .eq("type", "commission")
      .eq("statut", "validee")
      .gte("date_operation", dateDebutMois)
      .lte("date_operation", dateFinMois);

    const { data: commissionsOps, error: opsErr } = await opsQuery;
    if (opsErr) throw opsErr;

    // 3. Récupérer le cumul des commissions de toute l'année
    const { data: commissionsAnneeOps } = await serviceRole
      .from("operations")
      .select("montant")
      .eq("type", "commission")
      .eq("statut", "validee")
      .gte("date_operation", debutAnnee)
      .lte("date_operation", finAnnee);

    const totalAnnee = (commissionsAnneeOps || []).reduce((s, o) => s + (o.montant || 0), 0);
    const totalAcquis = (commissionsOps || []).reduce((s, o) => s + (o.montant || 0), 0);

    // 4. Récupérer toutes les souscriptions actives pour calculer celles à prélever
    let sousQuery = serviceRole
      .from("souscriptions")
      .select(`
        id, membre_id, volet, montant_jour, parts_commission, date_debut, statut,
        membres:membre_id (
          id, numero, nom, prenom, telephone, quartier, agent_id,
          profiles:agent_id (id, nom, identifiant)
        )
      `)
      .eq("statut", "active")
      .lte("date_debut", dateFinMois);

    const { data: souscriptions, error: sousErr } = await sousQuery;
    if (sousErr) throw sousErr;

    // 5. Récupérer la liste des agents
    const { data: agents } = await serviceRole
      .from("profiles")
      .select("id, nom, identifiant")
      .eq("role", "agent")
      .order("nom");

    // Indexer les commissions déjà prélevées par `membre_id + volet`
    const preleveesMap: Record<string, any> = {};
    (commissionsOps || []).forEach((op: any) => {
      const key = `${op.membre_id}_${op.volet}`;
      preleveesMap[key] = op;
    });

    // 6. Construire la liste unifiée détaillée par souscription
    let lignes = (souscriptions || []).map((s: any) => {
      const m = s.membres;
      const key = `${s.membre_id}_${s.volet}`;
      const opPrelevee = preleveesMap[key];

      const estPrelevee = Boolean(opPrelevee);
      const montantCommission = estPrelevee
        ? opPrelevee.montant
        : (s.parts_commission || 1) * s.montant_jour;

      return {
        souscription_id: s.id,
        membre_id: s.membre_id,
        numero: m?.numero || "—",
        nom: m?.nom || "—",
        prenom: m?.prenom || "—",
        telephone: m?.telephone || "—",
        quartier: m?.quartier || "—",
        agent_id: m?.agent_id || "",
        agent_nom: m?.profiles?.nom || "—",
        agent_identifiant: m?.profiles?.identifiant || "—",
        volet: s.volet,
        montant_jour: s.montant_jour,
        parts_commission: s.parts_commission || 1,
        montant_commission: montantCommission,
        statut_prelevement: estPrelevee ? "prelevee" : "a_prelever",
        operation_id: opPrelevee ? opPrelevee.id : null,
        date_prelevement: opPrelevee ? opPrelevee.date_operation : null,
        annule_ref: opPrelevee?.annule_ref || null,
      };
    });

    // Filtres
    if (agentId) {
      lignes = lignes.filter((l) => l.agent_id === agentId);
    }
    if (voletFilter) {
      lignes = lignes.filter((l) => l.volet === voletFilter);
    }
    if (search) {
      lignes = lignes.filter((l) =>
        `${l.numero} ${l.nom} ${l.prenom} ${l.quartier} ${l.agent_nom}`
          .toLowerCase()
          .includes(search)
      );
    }

    const totalAPrelever = lignes
      .filter((l) => l.statut_prelevement === "a_prelever")
      .reduce((s, l) => s + l.montant_commission, 0);

    return NextResponse.json({
      success: true,
      annee,
      mois,
      cloture: {
        est_cloture: Boolean(clotureRow),
        date_cloture: clotureRow?.cloture_le || null,
        cloture_par: (clotureRow as any)?.profiles?.nom || null,
        nombre_commissions: clotureRow?.nombre_commissions || 0,
        montant_total: clotureRow?.montant_total || 0,
      },
      cartes: {
        commissions_acquises: totalAcquis,
        commissions_a_prelever: totalAPrelever,
        membres_concernes: souscriptions?.length || 0,
        total_annee: totalAnnee,
      },
      lignes,
      agents: agents || [],
    });
  } catch (err: unknown) {
    console.error("[Admin Commissions GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/commissions
 * Exécution de la clôture mensuelle idempotente.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { adminId, serviceRole } = auth;

    const body = await request.json();
    const { annee, mois } = body;

    if (!annee || !mois || mois < 1 || mois > 12) {
      return NextResponse.json(
        { success: false, error: "Année et mois valides requis" },
        { status: 400 }
      );
    }

    const { data: resCloture, error: rpcErr } = await serviceRole.rpc("cloturer_mois", {
      p_annee: Number(annee),
      p_mois: Number(mois),
      p_admin_id: adminId,
    });

    if (rpcErr) {
      console.error("[Cloturer Mois RPC Error] :", rpcErr);
      return NextResponse.json(
        { success: false, error: rpcErr.message || "Échec de la clôture du mois" },
        { status: 400 }
      );
    }

    if (resCloture && resCloture.deja_cloture) {
      return NextResponse.json({
        success: false,
        deja_cloture: true,
        message: resCloture.message,
      });
    }

    return NextResponse.json({
      success: true,
      ...resCloture,
    });
  } catch (err: unknown) {
    console.error("[Admin Commissions POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
