import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { LIBELLES_ERREURS } from "@/lib/sync/errors";
import { ENTETE_APPAREIL } from "@/lib/utils/appareil";

/**
 * /api/sync — Synchronisation hors ligne.
 *
 * POST : reçoit UNE entrée de l'outbox { table, clientId, payload }.
 *   Insertion idempotente via les fonctions SQL sync_operation / sync_remise :
 *   INSERT … ON CONFLICT (id) DO NOTHING (id = client_id du téléphone).
 *   Réponses :
 *     200 { success: true, statut: "insere" | "doublon", clientId }
 *     401 { success: false, code: "SESSION_EXPIREE" }
 *     403 { success: false, code: "AGENT_SUSPENDU" }
 *     422 { success: false, code: <refus métier> }   → erreur définitive
 *     500 { success: false, code: "ERREUR_SERVEUR" } → réessai automatique
 *
 * GET : portefeuille de l'agent (membres, souscriptions, opérations, soldes,
 *   paramètres) + décisions de l'administrateur (remises confirmées, crédits,
 *   décisions sur les demandes).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLES_AUTORISEES: Record<string, string> = {
  operations: "sync_operation",
  remises_collecte: "sync_remise",
};

function refus(code: string, status: number, detail?: string) {
  return NextResponse.json(
    { success: false, code, error: detail ?? LIBELLES_ERREURS[code] ?? code },
    { status }
  );
}

/**
 * Vrai si le jeton provient d'une authentification par mot de passe (PIN)
 * de moins de 5 minutes. Le champ `amr` du JWT Supabase garde l'horodatage
 * de la saisie du mot de passe, même après un rafraîchissement de session.
 * (La signature du jeton est déjà vérifiée par auth.getUser.)
 */
function pinSaisiRecemment(token: string): boolean {
  try {
    const charge = token.split(".")[1];
    const json = JSON.parse(Buffer.from(charge, "base64url").toString("utf8")) as {
      amr?: Array<{ method?: string; timestamp?: number }>;
    };
    const saisie = json.amr?.find((a) => a.method === "password")?.timestamp;
    return typeof saisie === "number" && Date.now() / 1000 - saisie < 5 * 60;
  } catch {
    return false;
  }
}

/**
 * Authentifie l'appelant et vérifie qu'il s'agit d'un agent actif,
 * utilisant l'appareil autorisé (profiles.device_id).
 *
 * Appareil :
 * - `enregistrer` (connexion en ligne avec PIN) : cet appareil devient l'appareil lié ;
 * - aucun appareil lié encore (comptes existants) : le premier appareil vu est lié ;
 * - appareil différent ou révoqué par l'admin : 403 APPAREIL_REVOQUE.
 */
async function authentifierAgent(
  request: NextRequest,
  supabase: SupabaseClient,
  options: { enregistrer?: boolean } = {}
): Promise<{ agentId: string } | NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return refus("SESSION_EXPIREE", 401);

  const token = authHeader.slice("Bearer ".length);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return refus("SESSION_EXPIREE", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("statut, role, device_id")
    .eq("id", user.id)
    .single();

  if (!profile) return refus("SESSION_EXPIREE", 401);
  if (profile.statut === "suspendu") return refus("AGENT_SUSPENDU", 403);
  // Seul un agent a un portefeuille. Un admin (aperçu espace agent) recevrait
  // un portefeuille vide qui écraserait les données locales, et ses dépôts
  // seraient rattachés à l'admin. 401 = erreur de session récupérable :
  // l'outbox est conservée et renvoyée après reconnexion d'un agent.
  if (profile.role !== "agent") {
    return refus(
      "SESSION_EXPIREE",
      401,
      "Session agent requise : reconnectez-vous avec votre identifiant agent."
    );
  }

  // Contrôle de l'appareil
  const appareilId = request.headers.get(ENTETE_APPAREIL)?.trim() || null;
  const lie: string | null = profile.device_id ?? null;

  // L'enregistrement n'est accepté qu'après une saisie récente du PIN : une
  // session ancienne (appareil révoqué) ne peut pas se ré-enregistrer seule.
  const enregistrementAutorise = options.enregistrer && pinSaisiRecemment(token);

  if (appareilId && (enregistrementAutorise || lie === null)) {
    // Connexion en ligne avec PIN, ou premier appareil d'un compte existant
    if (lie !== appareilId) {
      await supabase
        .from("profiles")
        .update({ device_id: appareilId, modifie_le: new Date().toISOString() })
        .eq("id", user.id);
    }
  } else if (lie !== null && lie !== appareilId) {
    // Appareil révoqué par l'admin, ou remplacé par un autre appareil
    return refus("APPAREIL_REVOQUE", 403);
  }

  return { agentId: user.id };
}

export async function POST(request: NextRequest) {
  const supabase = createServiceRoleClient();

  try {
    const auth = await authentifierAgent(request, supabase);
    if (auth instanceof NextResponse) return auth;
    const { agentId } = auth;

    let body: { table?: unknown; clientId?: unknown; payload?: unknown };
    try {
      body = await request.json();
    } catch {
      return refus("DONNEES_INVALIDES", 422);
    }

    const { table, clientId, payload } = body;

    if (
      typeof table !== "string" ||
      typeof clientId !== "string" ||
      !UUID_RE.test(clientId) ||
      !payload ||
      typeof payload !== "object"
    ) {
      return refus("DONNEES_INVALIDES", 422);
    }

    const fonction = TABLES_AUTORISEES[table];
    if (!fonction) return refus("TABLE_NON_AUTORISEE", 422);

    // INSERT … ON CONFLICT (id) DO NOTHING (dans la fonction SQL)
    const { data, error } = await supabase.rpc(fonction, {
      p_agent_id: agentId,
      p_client_id: clientId,
      p_payload: payload,
    });

    if (error) {
      const code = codeDepuisErreurPg(error);
      if (code === "ERREUR_SERVEUR") {
        console.error("[Sync] Erreur serveur :", error);
        return refus("ERREUR_SERVEUR", 500);
      }

      // Refus définitif : consigné pour l'administrateur (jamais supprimé)
      await supabase
        .rpc("sync_journaliser_erreur", {
          p_agent_id: agentId,
          p_client_id: clientId,
          p_table: table,
          p_payload: payload,
          p_code: code,
          p_message: error.message,
        })
        .then(({ error: logError }) => {
          if (logError) console.error("[Sync] Journalisation impossible :", logError);
        });

      return refus(code, 422);
    }

    return NextResponse.json({
      success: true,
      statut: data === "doublon" ? "doublon" : "insere",
      clientId,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Sync] Erreur inattendue :", error);
    return refus("ERREUR_SERVEUR", 500);
  }
}

/**
 * Traduit une erreur Postgres/PostgREST en code métier.
 * - Exceptions levées par sync_* : le message EST le code (MEMBRE_INACTIF…)
 * - Classe 22 (données) / 23 (contraintes) : DONNEES_INVALIDES
 * - Autres : ERREUR_SERVEUR (temporaire → réessai)
 */
function codeDepuisErreurPg(error: { code?: string; message?: string }): string {
  const message = (error.message ?? "").trim();
  if (LIBELLES_ERREURS[message]) return message;
  const pgCode = error.code ?? "";
  if (pgCode.startsWith("22") || pgCode.startsWith("23")) return "DONNEES_INVALIDES";
  return "ERREUR_SERVEUR";
}

export async function GET(request: NextRequest) {
  const supabase = createServiceRoleClient();

  try {
    // ?enregistrer_appareil=1 : envoyé uniquement juste après une connexion
    // en ligne avec PIN (cet appareil devient l'appareil lié de l'agent)
    const enregistrer = request.nextUrl.searchParams.get("enregistrer_appareil") === "1";
    const auth = await authentifierAgent(request, supabase, { enregistrer });
    if (auth instanceof NextResponse) return auth;
    const { agentId } = auth;

    const { data: membresData, error: membresError } = await supabase
      .from("membres")
      .select("*")
      .eq("agent_id", agentId);
    if (membresError) throw membresError;

    const membreIds = (membresData ?? []).map((m: { id: string }) => m.id);

    const il_y_a_30_jours = new Date(Date.now() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const [souscriptions, operations, soldes, parametres, remises, credits, decisions] =
      await Promise.all([
        membreIds.length
          ? supabase.from("souscriptions").select("*").in("membre_id", membreIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("operations")
          .select("*")
          .eq("agent_id", agentId)
          .order("cree_le", { ascending: false })
          .limit(500),
        // La vue renvoie une ligne « volet NULL, solde 0 » pour les membres sans
        // opération (LEFT JOIN) : inutile, et sans clé valide pour l'appareil.
        supabase
          .from("soldes_membres")
          .select("*")
          .eq("agent_id", agentId)
          .not("volet", "is", null),
        supabase.from("parametres").select("*"),
        supabase
          .from("remises_collecte")
          .select("*")
          .eq("agent_id", agentId)
          .gte("date_remise", il_y_a_30_jours),
        supabase.from("credits").select("*").eq("agent_id", agentId),
        supabase
          .from("decisions_demandes")
          .select("id, demande_id, decision, montant_accorde, motif, decide_le")
          .eq("agent_id", agentId),
      ]);

    const premiereErreur = [souscriptions, operations, soldes, parametres, remises, credits, decisions]
      .map((r) => r.error)
      .find(Boolean);
    if (premiereErreur) throw premiereErreur;

    return NextResponse.json({
      success: true,
      data: {
        membres: membresData ?? [],
        souscriptions: souscriptions.data ?? [],
        operations: operations.data ?? [],
        soldes: soldes.data ?? [],
        parametres: parametres.data ?? [],
        remises: remises.data ?? [],
        credits: credits.data ?? [],
        decisions: decisions.data ?? [],
      },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Sync] Erreur chargement portefeuille :", error);
    return refus("ERREUR_SERVEUR", 500);
  }
}
