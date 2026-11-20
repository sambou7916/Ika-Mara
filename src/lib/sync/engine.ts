// =============================================================================
// IKA-MARA — Moteur de synchronisation
// =============================================================================
// Synchronise l'outbox locale avec le serveur Supabase, puis met à jour le
// portefeuille local (soldes, membres, décisions de l'administrateur).
//
// Principes :
// - Envoi entrée par entrée, dans l'ordre, vers POST /api/sync avec le
//   client_id ; le serveur fait INSERT … ON CONFLICT (id) DO NOTHING.
// - Déclencheurs : ouverture de l'app, événement « online », retour au
//   premier plan, intervalle de 60 s si en ligne, bouton manuel, nouvelle
//   écriture dans l'outbox.
// - Reprise automatique après échec avec backoff exponentiel (2 s → 5 min).
// - Après l'envoi : GET /api/sync → Dexie (le serveur fait foi, les
//   écritures locales non confirmées sont ré-appliquées).
// - Une opération en erreur n'est JAMAIS supprimée automatiquement.
// =============================================================================

import type {
  OutboxEntry,
  PortefeuilleAgent,
  SyncPushResponse,
  SyncResponse,
  SyncState,
} from "@/lib/types";
import { countPending, countErrors, resetStuckEntries } from "@/lib/db/outbox";
import { db, loadPortfolio, purgeAgentData, clearLocalData } from "@/lib/db/dexie";
import { createClient } from "@/lib/supabase/client";
import { pinToPassword } from "@/lib/utils/pin";
import { ENTETE_APPAREIL, getAppareilId } from "@/lib/utils/appareil";
import { syncOutbox, type SendOutcome, type Transport } from "./queue";
import { calculerBackoff, classerErreur, libelleErreur } from "./errors";

// --- Configuration ---

const SYNC_INTERVAL_MS = 60_000; // 60 secondes
const PULL_MIN_INTERVAL_MS = 5 * 60_000; // rafraîchissement auto max toutes les 5 min
const REQUEST_TIMEOUT_MS = 15_000;

// --- Types internes ---

type SyncListener = (state: SyncState) => void;

export interface SyncNowOptions {
  /** Déclenché par l'agent : reprend aussi les refus définitifs et force le rafraîchissement */
  manuel?: boolean;
  /** Forcer le téléchargement du portefeuille après l'envoi */
  forcerPull?: boolean;
}

// --- État global ---

let syncState: SyncState = {
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  pendingCount: 0,
  errorCount: 0,
  lastSyncAt: null,
  lastPullAt: null,
  isSyncing: false,
  isPulling: false,
  lastError: null,
  nextRetryAt: null,
};

const listeners: Set<SyncListener> = new Set();
let syncTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let echecsConsecutifs = 0;
let isInitialized = false;
let syncEnCours: Promise<SyncResponse | null> | null = null;

// --- Abonnement à l'état ---

export function getSyncState(): SyncState {
  return { ...syncState };
}

export function subscribeSyncState(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(getSyncState());
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  const state = getSyncState();
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      // Ne pas bloquer les autres listeners
    }
  });
}

function updateState(partial: Partial<SyncState>): void {
  syncState = { ...syncState, ...partial };
  notifyListeners();
}

async function rafraichirCompteurs(): Promise<void> {
  const [pending, errors] = await Promise.all([countPending(), countErrors()]);
  updateState({ pendingCount: pending, errorCount: errors });
}

// --- Cycle de vie ---

/**
 * Initialise le moteur (appelé à l'ouverture de l'espace agent).
 */
export async function initSync(): Promise<void> {
  if (isInitialized) return;
  isInitialized = true;

  // Entrées « syncing » laissées par une coupure précédente → pending
  const stuck = await resetStuckEntries();
  if (stuck > 0) {
    console.log(`[Sync] ${stuck} opération(s) interrompue(s) remise(s) en attente`);
  }

  await rafraichirCompteurs();

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
  }

  startPeriodicSync();

  // Ouverture de l'app : envoyer l'outbox puis rafraîchir le portefeuille
  if (syncState.isOnline) {
    void syncNow({ forcerPull: true });
  }
}

/**
 * Arrête le moteur (déconnexion).
 */
export function stopSync(): void {
  isInitialized = false;

  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  clearRetryTimer();

  if (typeof window !== "undefined") {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    document.removeEventListener("visibilitychange", handleVisibility);
  }
}

// --- Synchronisation ---

/**
 * Envoie l'outbox puis met à jour le portefeuille local.
 * Si une synchro est déjà en cours, rejoint celle-ci.
 */
export function syncNow(options: SyncNowOptions = {}): Promise<SyncResponse | null> {
  if (syncEnCours) return syncEnCours;
  syncEnCours = executerSync(options).finally(() => {
    syncEnCours = null;
  });
  return syncEnCours;
}

async function executerSync(options: SyncNowOptions): Promise<SyncResponse | null> {
  if (typeof navigator !== "undefined") {
    syncState.isOnline = navigator.onLine;
  }
  if (!syncState.isOnline) {
    updateState({ lastError: "Hors ligne : les opérations restent sur l'appareil." });
    return null;
  }

  clearRetryTimer();
  updateState({ isSyncing: true, lastError: null, nextRetryAt: null });

  try {
    // 1. Envoi de l'outbox, dans l'ordre
    const run = await syncOutbox(fetchTransport, {
      inclureDefinitives: options.manuel === true,
    });

    if (run.raisonInterruption === "suspendu") {
      await gererSuspension();
      return null;
    }
    if (run.erreurs.some((e) => e.code === "APPAREIL_REVOQUE")) {
      await gererRevocation();
      return null;
    }

    const envoyees = run.inserees + run.doublons;

    // Synchroniser un éventuel changement de PIN local en attente
    await synchroniserChangementPin();

    // 2. Récupération des données serveur (si le réseau a tenu)
    const doitTirer =
      !run.interrompue &&
      (options.manuel ||
        options.forcerPull ||
        envoyees > 0 ||
        !syncState.lastPullAt ||
        Date.now() - new Date(syncState.lastPullAt).getTime() > PULL_MIN_INTERVAL_MS);

    let erreurPull: string | null = null;
    if (doitTirer) {
      erreurPull = await refreshPortfolioInterne();
    }

    await rafraichirCompteurs();

    // 3. Backoff si la passe a été interrompue ou si le pull a échoué
    const echec = run.interrompue || erreurPull !== null;
    if (echec) {
      planifierReessai();
    } else {
      echecsConsecutifs = 0;
    }

    const derniereErreur = run.interrompue
      ? run.erreurs[run.erreurs.length - 1]?.message ?? "Synchronisation interrompue"
      : erreurPull ??
      (run.erreurs.length > 0
        ? `${run.erreurs.length} opération(s) refusée(s) — voir le détail`
        : null);

    updateState({
      isSyncing: false,
      lastSyncAt: run.interrompue ? syncState.lastSyncAt : new Date().toISOString(),
      lastError: derniereErreur,
    });

    return {
      success: run.erreurs.length === 0 && erreurPull === null,
      synced: envoyees,
      errors: run.erreurs.map((e) => ({ clientId: e.clientId, error: e.message })),
      serverTime: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur de synchronisation";
    console.error("[Sync] Erreur :", message);
    await rafraichirCompteurs();
    planifierReessai();
    updateState({ isSyncing: false, lastError: message });
    return null;
  }
}

/**
 * « Mettre à jour mon portefeuille » : envoie d'abord l'outbox puis
 * télécharge les données du serveur.
 */
export async function refreshPortfolio(): Promise<{ success: boolean; error: string | null }> {
  const res = await syncNow({ manuel: true, forcerPull: true });
  if (res === null) {
    return { success: false, error: syncState.lastError ?? "Synchronisation impossible" };
  }
  return { success: res.success, error: res.success ? null : syncState.lastError };
}

/**
 * Télécharge le portefeuille (GET /api/sync) et l'applique dans Dexie.
 * @returns null si succès, sinon un message d'erreur lisible.
 */
async function refreshPortfolioInterne(): Promise<string | null> {
  updateState({ isPulling: true });
  try {
    const token = await getAccessToken();
    if (!token) return libelleErreur("SESSION_EXPIREE");

    const response = await fetchAvecDelai("/api/sync", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, [ENTETE_APPAREIL]: getAppareilId() },
    });

    if (response.status === 403) {
      const body = await lireJson(response);
      if (body?.error === "AGENT_SUSPENDU" || body?.code === "AGENT_SUSPENDU") {
        await gererSuspension();
        return libelleErreur("AGENT_SUSPENDU");
      }
      if (body?.code === "APPAREIL_REVOQUE") {
        await gererRevocation();
        return libelleErreur("APPAREIL_REVOQUE");
      }
    }
    if (response.status === 401) return libelleErreur("SESSION_EXPIREE");
    if (!response.ok) return libelleErreur("ERREUR_SERVEUR");

    const body = (await response.json()) as { success: boolean; data?: PortefeuilleAgent };
    if (!body.success || !body.data) return libelleErreur("ERREUR_SERVEUR");

    await loadPortfolio(body.data);
    updateState({ lastPullAt: new Date().toISOString() });
    return null;
  } catch (error) {
    const estDelai = error instanceof DOMException && error.name === "AbortError";
    return libelleErreur(estDelai ? "DELAI_DEPASSE" : "RESEAU");
  } finally {
    updateState({ isPulling: false });
  }
}

// --- Transport HTTP ---

/**
 * Envoie une entrée de l'outbox à POST /api/sync.
 * Toute absence de réponse est traitée comme une coupure (réessai).
 */
const fetchTransport: Transport = async (entry: OutboxEntry): Promise<SendOutcome> => {
  const token = await getAccessToken();
  if (!token) {
    return { ok: false, kind: "session", code: "SESSION_EXPIREE" };
  }

  let response: Response;
  try {
    response = await fetchAvecDelai("/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        [ENTETE_APPAREIL]: getAppareilId(),
      },
      body: JSON.stringify({
        table: entry.table,
        clientId: entry.clientId,
        payload: entry.payload,
      }),
    });
  } catch (error) {
    const estDelai = error instanceof DOMException && error.name === "AbortError";
    return { ok: false, kind: "reseau", code: estDelai ? "DELAI_DEPASSE" : "RESEAU" };
  }

  const body = (await lireJson(response)) as (SyncPushResponse & { code?: string; error?: string }) | null;

  if (response.ok && body && body.success) {
    return { ok: true, statut: body.statut === "doublon" ? "doublon" : "insere" };
  }

  if (response.status === 401) {
    return { ok: false, kind: "session", code: "SESSION_EXPIREE" };
  }

  const code = body?.code ?? (body && !body.success ? body.error : undefined) ?? "ERREUR_SERVEUR";
  const kind = classerErreur(response.status, code);
  return { ok: false, kind, code, message: body && !body.success ? body.error : undefined };
};

async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = createClient();
    // getSession rafraîchit automatiquement le jeton s'il a expiré
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function fetchAvecDelai(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function lireJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// --- Synchronisation du code PIN ---

/**
 * Pousse vers Supabase Auth un changement de PIN effectué hors ligne.
 */
export async function synchroniserChangementPin(): Promise<void> {
  try {
    const list = await db.agentAuth.toArray();
    const auth = list.find((a) => a.pendingPinUpdate);
    if (auth && auth.pendingPinUpdate) {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: pinToPassword(auth.pendingPinUpdate),
      });
      if (!error) {
        await db.agentAuth.update(auth.identifiant, {
          pendingPinUpdate: null,
        });
        console.log("[Sync] Code PIN mis à jour sur le serveur Supabase.");
      }
    }
  } catch (err) {
    console.warn("[Sync] Report de la mise à jour serveur du code PIN :", err);
  }
}

// --- Suspension ---

async function gererSuspension(): Promise<void> {
  console.warn("[Sync] Agent suspendu détecté côté serveur. Purge locale immédiate.");
  stopSync();
  await purgeAgentData();
  try {
    await createClient().auth.signOut();
  } catch {
    // hors ligne : la purge locale suffit
  }
  updateState({ isSyncing: false, pendingCount: 0, errorCount: 0 });
  if (typeof window !== "undefined") {
    window.location.href = "/agent/connexion?motif=suspendu";
  }
}

// --- Révocation de l'appareil ---

/**
 * L'administrateur a révoqué cet appareil (ou réinitialisé le PIN) :
 * on efface le portefeuille et l'empreinte du PIN, puis on exige une
 * nouvelle connexion en ligne. L'OUTBOX EST CONSERVÉE : les opérations en
 * attente seront envoyées après la reconnexion (jamais supprimées).
 */
async function gererRevocation(): Promise<void> {
  console.warn("[Sync] Appareil révoqué par l'administrateur. Reconnexion en ligne exigée.");
  stopSync();
  await clearLocalData(); // ne touche pas à l'outbox
  await db.agentAuth.clear();
  try {
    localStorage.removeItem("ika_current_agent");
  } catch {
    // stockage indisponible
  }
  try {
    await createClient().auth.signOut({ scope: "local" });
  } catch {
    // hors ligne : la session locale est effacée quoi qu'il arrive
  }
  updateState({ isSyncing: false });
  if (typeof window !== "undefined") {
    window.location.href = "/agent/connexion?motif=revoque";
  }
}

// --- Backoff exponentiel ---

function planifierReessai(): void {
  echecsConsecutifs++;
  const delai = calculerBackoff(echecsConsecutifs);
  clearRetryTimer();
  const nextRetryAt = Date.now() + delai;
  updateState({ nextRetryAt });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    updateState({ nextRetryAt: null });
    if (syncState.isOnline) void syncNow();
  }, delai);
}

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

// --- Déclencheurs ---

function handleOnline(): void {
  updateState({ isOnline: true });
  echecsConsecutifs = 0; // le réseau revient : on repart d'un délai court
  void syncNow();
}

function handleOffline(): void {
  clearRetryTimer();
  updateState({ isOnline: false, nextRetryAt: null });
}

function handleVisibility(): void {
  if (document.visibilityState === "visible" && syncState.isOnline) {
    void syncNow();
  }
}

function startPeriodicSync(): void {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => {
    if (syncState.isOnline && !syncState.isSyncing && !retryTimer) {
      void syncNow();
    }
  }, SYNC_INTERVAL_MS);
}

/**
 * À appeler après chaque écriture dans l'outbox (dépôt, demande, remise).
 * Déclenche un envoi rapide si en ligne.
 */
export async function onOutboxChange(): Promise<void> {
  await rafraichirCompteurs();
  if (syncState.isOnline && !syncState.isSyncing) {
    // Petit délai pour regrouper les écritures rapprochées
    setTimeout(() => void syncNow(), 500);
  }
}
