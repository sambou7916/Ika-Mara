import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Vérifie que l'utilisateur est un admin actif */
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
 * GET /api/admin/membres
 * Liste paginée et filtrable des membres avec leurs souscriptions.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { serviceRole } = auth;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "15", 10)));
    const search = searchParams.get("search")?.trim() || "";
    const agentId = searchParams.get("agent_id") || "";
    const volet = searchParams.get("volet") || "";
    const statut = searchParams.get("statut") || "";

    // 1. Récupérer les agents disponibles pour le filtre et l'assignation
    const { data: agents } = await serviceRole
      .from("profiles")
      .select("id, nom, identifiant")
      .eq("role", "agent")
      .order("nom");

    // 2. Prochain numéro libre à 4 chiffres
    const { data: prochainNumero } = await serviceRole.rpc("generer_numero_membre");

    // 3. Construction de la requête membres
    let query = serviceRole
      .from("membres")
      .select(
        `
        id,
        numero,
        nom,
        prenom,
        profession,
        telephone,
        quartier,
        statut,
        agent_id,
        photo_url,
        cree_le,
        profiles:agent_id (id, nom, identifiant),
        souscriptions (id, volet, montant_jour, parts_commission, statut)
      `,
        { count: "exact" }
      );

    if (statut) {
      query = query.eq("statut", statut);
    }
    if (agentId) {
      query = query.eq("agent_id", agentId);
    }
    if (search) {
      query = query.or(
        `numero.ilike.%${search}%,nom.ilike.%${search}%,prenom.ilike.%${search}%,telephone.ilike.%${search}%,quartier.ilike.%${search}%`
      );
    }

    // Tri par numéro croissant
    query = query.order("numero", { ascending: true });

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: membres, count, error } = await query;
    if (error) throw error;

    // Filtrer par volet côté serveur si demandé
    let membresFiltres = membres || [];
    if (volet) {
      membresFiltres = membresFiltres.filter((m) =>
        m.souscriptions?.some(
          (s: { volet: string; statut: string }) => s.volet === volet && s.statut === "active"
        )
      );
    }

    return NextResponse.json({
      success: true,
      membres: membresFiltres,
      total: count || 0,
      page,
      limit,
      total_pages: Math.ceil((count || 0) / limit),
      agents: agents || [],
      prochain_numero: prochainNumero || "0001",
    });
  } catch (err: unknown) {
    console.error("[Admin Membres GET] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/membres
 * Création ou modification d'un membre avec gestion de ses souscriptions.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await checkAdmin(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Non autorisé" }, { status: 403 });
    }
    const { adminId, serviceRole } = auth;

    const body = await request.json();
    const {
      id, // si fourni : modification, sinon création
      numero,
      nom,
      prenom,
      profession,
      telephone,
      quartier,
      agent_id,
      photo_url,
      statut,
      souscriptions, // array de { volet, actif, montant_jour, parts_commission }
    } = body;

    if (!nom?.trim() || !prenom?.trim()) {
      return NextResponse.json(
        { success: false, error: "Le nom et le prénom sont obligatoires" },
        { status: 400 }
      );
    }

    if (!agent_id) {
      return NextResponse.json(
        { success: false, error: "L'agent référent est obligatoire" },
        { status: 400 }
      );
    }

    // Souscriptions activées : montant journalier entier > 0, parts entières ≥ 0.
    // Vérifié AVANT toute écriture (le membre est enregistré avant ses souscriptions).
    if (Array.isArray(souscriptions)) {
      const NOMS_VOLETS: Record<string, string> = { mara: "Ika-Mara", pari: "Ika-Pari", djourou: "Ika-Djourou" };
      for (const sub of souscriptions) {
        if (!sub?.volet || !sub.actif) continue;
        const nomVolet = NOMS_VOLETS[sub.volet] ?? sub.volet;
        const montant = Number(sub.montant_jour);
        const parts = Number(sub.parts_commission);
        if (!Number.isInteger(montant) || montant <= 0) {
          return NextResponse.json(
            { success: false, error: `Saisissez le montant journalier du volet ${nomVolet} (entier supérieur à 0).` },
            { status: 400 }
          );
        }
        if (!Number.isInteger(parts) || parts < 0) {
          return NextResponse.json(
            { success: false, error: `Parts de commission invalides pour le volet ${nomVolet} (entier, 0 ou plus).` },
            { status: 400 }
          );
        }
      }
    }

    let membreId = id;
    let numeroFinal = numero;

    // Si création, attribuer le prochain numéro si non fourni
    if (!membreId) {
      if (!numeroFinal) {
        const { data: numGen } = await serviceRole.rpc("generer_numero_membre");
        numeroFinal = numGen || "0001";
      }

      // Vérifier l'unicité du numéro
      const { data: existNum } = await serviceRole
        .from("membres")
        .select("id")
        .eq("numero", numeroFinal)
        .maybeSingle();

      if (existNum) {
        return NextResponse.json(
          { success: false, error: `Le numéro d'adhérent ${numeroFinal} est déjà attribué` },
          { status: 400 }
        );
      }

      const { data: newMembre, error: insertError } = await serviceRole
        .from("membres")
        .insert({
          numero: numeroFinal,
          nom: nom.trim(),
          prenom: prenom.trim(),
          profession: profession?.trim() || null,
          telephone: telephone?.trim() || null,
          quartier: quartier?.trim() || null,
          agent_id,
          photo_url: photo_url?.trim() || null,
          statut: statut || "actif",
        })
        .select()
        .single();

      if (insertError) throw insertError;
      membreId = newMembre.id;

      // Journaliser dans audit_log
      await serviceRole.from("audit_log").insert({
        qui: adminId,
        quoi: "creation_membre",
        apres: newMembre,
        details: `Création du membre ${numeroFinal} - ${prenom} ${nom}`,
      });
    } else {
      // Modification
      const { data: ancienMembre } = await serviceRole
        .from("membres")
        .select("*")
        .eq("id", membreId)
        .single();

      const { data: updatedMembre, error: updateError } = await serviceRole
        .from("membres")
        .update({
          nom: nom.trim(),
          prenom: prenom.trim(),
          profession: profession?.trim() || null,
          telephone: telephone?.trim() || null,
          quartier: quartier?.trim() || null,
          agent_id,
          photo_url: photo_url?.trim() || null,
          statut: statut || "actif",
          modifie_le: new Date().toISOString(),
        })
        .eq("id", membreId)
        .select()
        .single();

      if (updateError) throw updateError;

      await serviceRole.from("audit_log").insert({
        qui: adminId,
        quoi: "modification_membre",
        avant: ancienMembre,
        apres: updatedMembre,
        details: `Modification du membre ${numeroFinal} - ${prenom} ${nom}`,
      });
    }

    // Gestion des souscriptions si fournies
    if (Array.isArray(souscriptions)) {
      for (const sub of souscriptions) {
        const { volet, actif, montant_jour, parts_commission } = sub;
        if (!volet) continue;

        const statutSouscription = actif ? "active" : "suspendue";

        // Vérifier si une souscription existe déjà pour ce volet
        const { data: existSub } = await serviceRole
          .from("souscriptions")
          .select("*")
          .eq("membre_id", membreId)
          .eq("volet", volet)
          .maybeSingle();

        // Volets actifs : valeurs déjà validées plus haut. Volet désactivé avec un
        // champ vidé : on conserve les valeurs enregistrées (jamais de valeur inventée).
        const montantSaisi = Number(montant_jour);
        const partsSaisies = Number(parts_commission);
        const montantJourNum =
          Number.isInteger(montantSaisi) && montantSaisi > 0
            ? montantSaisi
            : existSub?.montant_jour ?? 0;
        const partsCommNum =
          Number.isInteger(partsSaisies) && partsSaisies >= 0
            ? partsSaisies
            : existSub?.parts_commission ?? 1;

        if (existSub) {
          // Historiser les changements si modification
          if (
            existSub.montant_jour !== montantJourNum ||
            existSub.parts_commission !== partsCommNum ||
            existSub.statut !== statutSouscription
          ) {
            // Mise à jour
            await serviceRole
              .from("souscriptions")
              .update({
                montant_jour: montantJourNum,
                parts_commission: partsCommNum,
                statut: statutSouscription,
                modifie_le: new Date().toISOString(),
              })
              .eq("id", existSub.id);

            // Inscription dans historique_souscriptions
            await serviceRole.from("historique_souscriptions").insert([
              {
                souscription_id: existSub.id,
                champ_modifie: "montant_jour_et_parts",
                ancienne_valeur: `montant: ${existSub.montant_jour} F, parts: ${existSub.parts_commission}, statut: ${existSub.statut}`,
                nouvelle_valeur: `montant: ${montantJourNum} F, parts: ${partsCommNum}, statut: ${statutSouscription}`,
                modifie_par: adminId,
              },
            ]);
          }
        } else if (actif) {
          // Nouvelle souscription active
          const { data: newSub } = await serviceRole
            .from("souscriptions")
            .insert({
              membre_id: membreId,
              volet,
              montant_jour: montantJourNum,
              parts_commission: partsCommNum,
              statut: "active",
            })
            .select()
            .single();

          if (newSub) {
            await serviceRole.from("historique_souscriptions").insert({
              souscription_id: newSub.id,
              champ_modifie: "creation",
              ancienne_valeur: null,
              nouvelle_valeur: `Création volet ${volet}: ${montantJourNum} F/j, parts: ${partsCommNum}`,
              modifie_par: adminId,
            });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      membreId,
      message: "Membre enregistré avec succès",
    });
  } catch (err: unknown) {
    console.error("[Admin Membres POST] Erreur :", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
