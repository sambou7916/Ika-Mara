import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { identifiantToEmail, pinToPassword, validatePin, validateIdentifiant } from "@/lib/utils/pin";

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
 * GET /api/admin/agents
 * Liste des agents avec statistiques de membres et collecte du mois en cours.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;

    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);

    // 1. Récupérer tous les agents
    const { data: agents, error: agentsError } = await serviceRole
      .from("profiles")
      .select("id, nom, telephone, identifiant, statut, device_id, derniere_synchro_le, cree_le")
      .eq("role", "agent")
      .order("cree_le", { ascending: false });

    if (agentsError) throw agentsError;

    // 2. Récupérer le nombre de membres par agent
    const { data: membres } = await serviceRole
      .from("membres")
      .select("id, agent_id, statut");

    // 3. Récupérer les dépôts du mois par agent
    const { data: depotsMois } = await serviceRole
      .from("operations")
      .select("agent_id, montant")
      .eq("type", "depot")
      .eq("statut", "validee")
      .gte("date_operation", firstDayOfMonth);

    // 4. Calculer le prochain identifiant suggéré (ex: AGT-003 ou AGT003)
    const existingIds = (agents || []).map((a) => a.identifiant.toUpperCase());
    let nextNum = 1;
    while (existingIds.includes(`AGT${String(nextNum).padStart(3, "0")}`) || existingIds.includes(`AGT-${String(nextNum).padStart(3, "0")}`)) {
      nextNum++;
    }
    const prochainIdentifiant = `AGT-${String(nextNum).padStart(3, "0")}`;

    // Agréger les données
    const agentsWithStats = (agents || []).map((agent) => {
      const agentMembres = (membres || []).filter((m) => m.agent_id === agent.id);
      const agentDepots = (depotsMois || []).filter((d) => d.agent_id === agent.id);
      const totalCollecteMois = agentDepots.reduce((sum, d) => sum + (d.montant || 0), 0);

      return {
        ...agent,
        nombre_membres: agentMembres.length,
        collecte_mois: totalCollecteMois,
      };
    });

    return NextResponse.json({
      success: true,
      agents: agentsWithStats,
      prochain_identifiant: prochainIdentifiant,
    });
  } catch (err: unknown) {
    console.error("[Admin Agents GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/agents
 * Création d'un agent de collecte via clé service Supabase (jamais exposée au client).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { adminId, serviceRole } = auth;

    const body = await request.json();
    const { nom, telephone, identifiant, pin_provisoire } = body;

    // Validations
    if (!nom || !nom.trim()) {
      return NextResponse.json({ success: false, error: "Le nom de l'agent est requis" }, { status: 400 });
    }

    const normId = identifiant?.trim().toUpperCase().replace(/\s+/g, "");
    const idValidation = validateIdentifiant(normId);
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    const pinValidation = validatePin(pin_provisoire);
    if (!pinValidation.valid) {
      return NextResponse.json({ success: false, error: pinValidation.error }, { status: 400 });
    }

    // Vérifier si l'identifiant existe déjà dans profiles
    const { data: existProfile } = await serviceRole
      .from("profiles")
      .select("id")
      .eq("identifiant", normId)
      .maybeSingle();

    if (existProfile) {
      return NextResponse.json(
        { success: false, error: `L'identifiant ${normId} est déjà utilisé.` },
        { status: 400 }
      );
    }

    // Créer le compte Supabase Auth via admin API
    const technicalEmail = identifiantToEmail(normId);

    const { data: authUser, error: createAuthError } =
      await serviceRole.auth.admin.createUser({
        email: technicalEmail,
        password: pinToPassword(pin_provisoire),
        email_confirm: true,
        user_metadata: {
          nom: nom.trim(),
          role: "agent",
          identifiant: normId,
        },
      });

    if (createAuthError || !authUser.user) {
      console.error("[Create Agent Auth Error] :", createAuthError);
      return NextResponse.json(
        { success: false, error: createAuthError?.message || "Impossible de créer le compte Auth" },
        { status: 500 }
      );
    }

    // Créer le profil correspondant
    const { data: newProfile, error: profileError } = await serviceRole
      .from("profiles")
      .insert({
        id: authUser.user.id,
        role: "agent",
        nom: nom.trim(),
        telephone: telephone?.trim() || null,
        identifiant: normId,
        statut: "nouveau", // Nouveau par défaut, passe à actif à la 1ère connexion
      })
      .select()
      .single();

    if (profileError) {
      // Nettoyer le compte auth si échec profil
      await serviceRole.auth.admin.deleteUser(authUser.user.id);
      throw profileError;
    }

    // Tracer dans audit_log
    await serviceRole.from("audit_log").insert({
      qui: adminId,
      quoi: "creation_agent",
      apres: newProfile,
      details: `Création de l'agent ${normId} - ${nom.trim()} avec PIN provisoire`,
    });

    return NextResponse.json({
      success: true,
      agent: newProfile,
      message: `Agent ${normId} créé avec succès avec le PIN provisoire.`,
    });
  } catch (err: unknown) {
    console.error("[Admin Agents POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
