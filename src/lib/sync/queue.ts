// =============================================================================
// IKA-MARA — File d'envoi de l'outbox (cœur testable du moteur de synchro)
// =============================================================================
// Parcourt l'outbox Dexie DANS L'ORDRE de création et envoie chaque entrée
// via un « transport » injecté (fetch vers /api/sync en production, faux
// serveur dans les tests).
//
// Garanties :
// - Une seule passe à la fois (verrou en mémoire) : deux déclenchements
//   simultanés (bouton + événement online) n'envoient rien en double.
// - Coupure en plein envoi : l'entrée en cours reste dans l'outbox (pending)
//   et la passe s'arrête ; elle sera renvoyée à la reprise. Le serveur
//   ignore le doublon éventuel (INSERT … ON CONFLICT DO NOTHING).
// - Une entrée ne quitte l'outbox QUE sur confirmation du serveur
//   (« insere » ou « doublon »). Une entrée en erreur n'est JAMAIS supprimée.
// - Refus métier (définitif) : l'entrée passe en erreur avec un motif
//   lisible et la passe continue avec les suivantes.
// =============================================================================

import type { OutboxEntry, SyncErrorKind } from "@/lib/types";
import {
  getPendingEntries,
  markSyncing,
  markSynced,
  markError,
  markRetryLater,
  resetStuckEntries,
} from "@/lib/db/outbox";
import { libelleErreur } from "./errors";

/** Résultat de l'envoi d'une entrée par le transport */
export type SendOutcome =
  | { ok: true; statut: "insere" | "doublon" }
  | { ok: false; kind: SyncErrorKind; code: string; message?: string };

/** Fonction d'envoi d'une entrée (doit être idempotente côté serveur) */
export type Transport = (entry: OutboxEntry) => Promise<SendOutcome>;

export interface QueueOptions {
  /** Reprendre aussi les refus définitifs (synchro manuelle). Défaut : false */
  inclureDefinitives?: boolean;
}

export interface QueueRunResult {
  /** Entrées examinées */
  traitees: number;
  /** Entrées confirmées par le serveur (nouvelles insertions) */
  inserees: number;
  /** Entrées déjà présentes côté serveur (renvoi ignoré) */
  doublons: number;
  /** Échecs (l'entrée reste dans l'outbox) */
  erreurs: Array<{ clientId: string; kind: SyncErrorKind; code: string; message: string }>;
  /** La passe s'est arrêtée avant la fin (réseau, serveur, session, suspension) */
  interrompue: boolean;
  /** Nature de l'interruption, le cas échéant */
  raisonInterruption: SyncErrorKind | null;
}

/**
 * Exécute UNE passe sur l'outbox (sans verrou — voir `syncOutbox`).
 */
export async function processOutbox(
  transport: Transport,
  options: QueueOptions = {}
): Promise<QueueRunResult> {
  const result: QueueRunResult = {
    traitees: 0,
    inserees: 0,
    doublons: 0,
    erreurs: [],
    interrompue: false,
    raisonInterruption: null,
  };

  // Aucune passe n'est active (verrou) : toute entrée « syncing » provient
  // d'une passe interrompue brutalement (application fermée, coupure).
  await resetStuckEntries();

  const entries = await getPendingEntries(options.inclureDefinitives ?? false);
  const confirmes = new Set<string>();

  for (const entry of entries) {
    if (entry.localId === undefined) continue;
    result.traitees++;

    // Même clientId déjà confirmé dans cette passe : inutile de renvoyer
    if (confirmes.has(entry.clientId)) {
      await markSynced(entry.localId);
      result.doublons++;
      continue;
    }

    await markSyncing(entry.localId);

    let outcome: SendOutcome;
    try {
      outcome = await transport(entry);
    } catch (err) {
      // Exception du transport = pas de réponse exploitable (coupure)
      outcome = {
        ok: false,
        kind: "reseau",
        code: "RESEAU",
        message: err instanceof Error ? err.message : undefined,
      };
    }

    if (outcome.ok) {
      await markSynced(entry.localId);
      confirmes.add(entry.clientId);
      if (outcome.statut === "doublon") result.doublons++;
      else result.inserees++;
      continue;
    }

    const message = libelleErreur(outcome.code, outcome.message);
    result.erreurs.push({
      clientId: entry.clientId,
      kind: outcome.kind,
      code: outcome.code,
      message,
    });

    switch (outcome.kind) {
      case "definitive":
        // Refus métier : visible en erreur, on continue avec les suivantes
        await markError(entry.localId, message, "definitive", outcome.code);
        continue;

      case "transitoire":
        // Serveur indisponible : on garde l'ordre et on réessaiera plus tard
        await markError(entry.localId, message, "transitoire", outcome.code);
        break;

      case "reseau":
      case "session":
        // Le serveur a peut-être reçu l'opération : elle sera renvoyée
        await markRetryLater(entry.localId, message, outcome.kind, outcome.code);
        break;

      case "suspendu":
        await markRetryLater(entry.localId, message, "suspendu", outcome.code);
        break;
    }

    // Toute erreur non définitive interrompt la passe
    result.interrompue = true;
    result.raisonInterruption = outcome.kind;
    break;
  }

  return result;
}

// --- Verrou : une seule passe à la fois ---

let passeEnCours: Promise<QueueRunResult> | null = null;

/**
 * Lance une passe sur l'outbox, ou rejoint la passe déjà en cours.
 * Deux appels simultanés partagent le même résultat : aucune entrée
 * n'est envoyée deux fois en parallèle.
 */
export function syncOutbox(
  transport: Transport,
  options: QueueOptions = {}
): Promise<QueueRunResult> {
  if (passeEnCours) return passeEnCours;

  passeEnCours = processOutbox(transport, options).finally(() => {
    passeEnCours = null;
  });

  return passeEnCours;
}

/** Indique si une passe est en cours. */
export function isQueueRunning(): boolean {
  return passeEnCours !== null;
}
