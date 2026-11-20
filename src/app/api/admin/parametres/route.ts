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
 * GET /api/admin/parametres
 * Actions supportées via searchParams "action" :
 * - liste (défaut) : paramètres par section avec version et auteur
 * - audit : journal d'audit filtrable par utilisateur et date
 * - export_complet : sauvegarde complète de la base (membres, operations, credits, remises)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "liste";

    // 1. LISTE DES PARAMÈTRES PAR SECTION
    if (action === "liste") {
      const { data: rows, error } = await serviceRole
        .from("parametres")
        .select(`
          cle, valeur, section, description, version, modifie_le, modifie_par,
          profiles:modifie_par (nom, identifiant)
        `)
        .order("section")
        .order("cle");

      if (error) throw error;

      // Structuration par section
      const sections: Record<string, any[]> = {
        commission: [],
        credit: [],
        retrait: [],
        alertes: [],
        recus: [],
      };

      (rows || []).forEach((p: any) => {
        const sec = p.section || "recus";
        if (!sections[sec]) sections[sec] = [];
        sections[sec].push(p);
      });

      return NextResponse.json({
        success: true,
        action: "liste",
        parametres: rows || [],
        sections,
      });
    }

    // 2. JOURNAL D'AUDIT FILTRABLE
    if (action === "audit") {
      const utilisateurId = searchParams.get("utilisateur_id") || "";
      const dateDebut = searchParams.get("date_debut") || "";
      const dateFin = searchParams.get("date_fin") || "";
      const limite = Number(searchParams.get("limite")) || 100;

      let query = serviceRole
        .from("audit_log")
        .select(`
          id, qui, quoi, avant, apres, details, quand, ip,
          profiles:qui (id, nom, identifiant, role)
        `)
        .order("quand", { ascending: false })
        .limit(limite);

      if (utilisateurId) query = query.eq("qui", utilisateurId);
      if (dateDebut) query = query.gte("quand", dateDebut);
      if (dateFin) query = query.lte("quand", dateFin + "T23:59:59.999Z");

      const { data: logs, error } = await query;
      if (error) throw error;

      // Récupérer la liste des utilisateurs pour le filtre
      const { data: utilisateurs } = await serviceRole
        .from("profiles")
        .select("id, nom, identifiant, role")
        .order("nom");

      return NextResponse.json({
        success: true,
        action: "audit",
        logs: logs || [],
        utilisateurs: utilisateurs || [],
      });
    }

    // 3. EXPORT COMPLET / SAUVEGARDE
    if (action === "export_complet") {
      const [membresRes, operationsRes, creditsRes, souscriptionsRes, caisseRes] =
        await Promise.all([
          serviceRole.from("membres").select("*").order("numero"),
          serviceRole
            .from("operations")
            .select("*")
            .order("date_operation", { ascending: false })
            .limit(2000),
          serviceRole.from("credits").select("*").order("date_octroi"),
          serviceRole.from("souscriptions").select("*"),
          serviceRole.from("caisse_mouvements").select("*").order("date_mouvement"),
        ]);

      return NextResponse.json({
        success: true,
        action: "export_complet",
        date_sauvegarde: new Date().toISOString(),
        donnees: {
          membres: membresRes.data || [],
          operations: operationsRes.data || [],
          credits: creditsRes.data || [],
          souscriptions: souscriptionsRes.data || [],
          caisse_mouvements: caisseRes.data || [],
        },
      });
    }

    return NextResponse.json({ success: false, error: "Action inconnue" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Paramètres GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/parametres
 * Mise à jour versionnée de paramètres avec journalisation audit_log.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { adminId, serviceRole } = auth;

    const body = await request.json();
    const { action, cle, valeur, modifications } = body;

    // 1. Modification d'un paramètre unique
    if (action === "modifier_parametre") {
      if (!cle || valeur === undefined) {
        return NextResponse.json(
          { success: false, error: "Clé et valeur requises." },
          { status: 400 }
        );
      }

      const { data: resModif, error: rpcErr } = await serviceRole.rpc("mettre_a_jour_parametre", {
        p_cle: cle,
        p_valeur: valeur,
        p_admin_id: adminId,
      });

      if (rpcErr) {
        return NextResponse.json(
          { success: false, error: rpcErr.message || "Échec de mise à jour" },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        ...resModif,
      });
    }

    // 2. Modification par lot (ex: validation d'une section entière)
    if (action === "modifier_section" && modifications && typeof modifications === "object") {
      const cles = Object.keys(modifications);
      for (const k of cles) {
        const val = modifications[k];
        const { error: rpcErr } = await serviceRole.rpc("mettre_a_jour_parametre", {
          p_cle: k,
          p_valeur: val,
          p_admin_id: adminId,
        });
        if (rpcErr) throw rpcErr;
      }

      return NextResponse.json({
        success: true,
        message: `${cles.length} paramètre(s) mis à jour avec succès.`,
      });
    }

    return NextResponse.json({ success: false, error: "Action POST non reconnue" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[Admin Paramètres POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
