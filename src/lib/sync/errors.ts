// =============================================================================
// IKA-MARA — Erreurs de synchronisation
// =============================================================================
// Traduit les réponses du serveur (ou l'absence de réponse) en :
// - une nature d'erreur (réessai automatique ou non)
// - un motif lisible en français pour l'agent et l'administrateur
// =============================================================================

import type { SyncErrorKind } from "@/lib/types";

/** Codes métier renvoyés par POST /api/sync (et par les fonctions SQL sync_*) */
export const LIBELLES_ERREURS: Record<string, string> = {
  // Réseau / transport
  RESEAU: "Connexion interrompue pendant l'envoi. Nouvel essai automatique.",
  DELAI_DEPASSE: "Le serveur n'a pas répondu à temps. Nouvel essai automatique.",
  ERREUR_SERVEUR: "Le serveur a rencontré un problème. Nouvel essai automatique.",
  // Session / compte
  SESSION_EXPIREE: "Session expirée. Reconnectez-vous avec internet pour envoyer vos opérations.",
  AGENT_SUSPENDU: "Votre compte agent a été suspendu par l'administrateur.",
  APPAREIL_REVOQUE:
    "Cet appareil a été révoqué par l'administrateur. Reconnectez-vous avec internet : vos opérations en attente seront envoyées ensuite.",
  // Refus métier (définitifs)
  DONNEES_INVALIDES: "Données de l'opération incomplètes ou invalides.",
  TABLE_NON_AUTORISEE: "Type d'enregistrement non autorisé pour la synchronisation.",
  TYPE_NON_AUTORISE: "Ce type d'opération ne peut pas être saisi par un agent.",
  MONTANT_INVALIDE: "Montant invalide : il doit être un nombre entier positif en F CFA.",
  MEMBRE_INTROUVABLE: "Membre introuvable sur le serveur.",
  MEMBRE_HORS_PORTEFEUILLE: "Ce membre n'appartient plus à votre portefeuille.",
  MEMBRE_INACTIF: "Ce membre est inactif : l'opération a été refusée.",
  SOUSCRIPTION_INACTIVE: "Aucune souscription active pour ce volet.",
  REMISE_DEJA_FAITE: "Une remise de collecte existe déjà pour cette date.",
};

/** Codes considérés comme temporaires (réessai automatique) */
const CODES_TRANSITOIRES = new Set(["RESEAU", "DELAI_DEPASSE", "ERREUR_SERVEUR"]);

/**
 * Retourne un motif lisible pour un code d'erreur.
 */
export function libelleErreur(code: string | null | undefined, messageBrut?: string): string {
  if (code && LIBELLES_ERREURS[code]) return LIBELLES_ERREURS[code];
  if (messageBrut && messageBrut.trim().length > 0) {
    return `Refusé par le serveur : ${messageBrut.trim().slice(0, 160)}`;
  }
  return "Erreur inconnue lors de la synchronisation.";
}

/**
 * Détermine la nature d'une erreur à partir du statut HTTP et du code.
 */
export function classerErreur(httpStatus: number, code?: string | null): SyncErrorKind {
  if (code === "AGENT_SUSPENDU") return "suspendu";
  // Appareil révoqué : erreur de session récupérable (l'outbox est conservée
  // et renvoyée après la nouvelle connexion en ligne)
  if (code === "APPAREIL_REVOQUE") return "session";
  if (httpStatus === 401 || code === "SESSION_EXPIREE") return "session";
  if (code && CODES_TRANSITOIRES.has(code)) return "transitoire";
  if (httpStatus >= 500 || httpStatus === 429 || httpStatus === 408) return "transitoire";
  if (httpStatus === 0) return "reseau";
  return "definitive";
}

/** Indique si une nature d'erreur donne lieu à un réessai automatique. */
export function estRecuperable(kind: SyncErrorKind): boolean {
  return kind === "reseau" || kind === "transitoire" || kind === "session";
}

// --- Backoff exponentiel ---

export const BACKOFF_BASE_MS = 2_000; // 2 s
export const BACKOFF_MAX_MS = 300_000; // 5 min

/**
 * Délai avant la prochaine tentative automatique après `echecs` échecs
 * consécutifs : 2 s, 4 s, 8 s, 16 s… plafonné à 5 min.
 */
export function calculerBackoff(echecs: number): number {
  if (echecs <= 0) return 0;
  const delai = BACKOFF_BASE_MS * Math.pow(2, echecs - 1);
  return Math.min(delai, BACKOFF_MAX_MS);
}
