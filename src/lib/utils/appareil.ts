// =============================================================================
// IKA-MARA — Identifiant d'appareil
// =============================================================================
// Chaque navigateur/téléphone reçoit un identifiant aléatoire persistant.
// Il est envoyé au serveur (en-tête X-Appareil-Id) à chaque synchronisation :
// l'administrateur peut ainsi révoquer un appareil précis.
// =============================================================================

const CLE = "ika_appareil_id";

/** En-tête HTTP portant l'identifiant d'appareil. */
export const ENTETE_APPAREIL = "X-Appareil-Id";

/** Valeur stockée dans profiles.device_id quand l'admin a révoqué l'appareil. */
export const APPAREIL_REVOQUE = "revoque";

/** Retourne l'identifiant de cet appareil (créé au premier appel). */
export function getAppareilId(): string {
  try {
    let id = localStorage.getItem(CLE);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLE, id);
    }
    return id;
  } catch {
    // Stockage indisponible : identifiant de session (révocation moins fine)
    return "inconnu";
  }
}
