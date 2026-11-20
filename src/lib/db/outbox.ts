// =============================================================================
// IKA-MARA — Outbox (file d'attente hors ligne)
// =============================================================================
// Chaque écriture (dépôt, demande, remise…) est d'abord enregistrée localement
// dans l'outbox avec un UUID v4 généré sur le téléphone.
// La synchronisation la pousse vers le serveur.
// Une opération en erreur N'EST JAMAIS SUPPRIMÉE.
// =============================================================================

import { v4 as uuidv4 } from "uuid";
import { db } from "./dexie";
import type { OutboxEntry, OutboxStatus, Operation, RemiseCollecte, SyncErrorKind } from "@/lib/types";

/**
 * Génère un UUID v4 pour identifier une opération côté client.
 */
export function generateClientId(): string {
  return uuidv4();
}

/**
 * Ajoute une opération ou remise dans l'outbox locale.
 * L'enregistrement est aussi écrit localement pour affichage immédiat (optimistic UI).
 *
 * @returns L'entrée outbox créée
 */
export async function addToOutbox(
  table: string,
  payload: Record<string, unknown>,
  clientId?: string
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    clientId: clientId ?? generateClientId(),
    table,
    payload,
    status: "pending",
    retries: 0,
    lastError: null,
    createdAt: Date.now(),
    lastAttempt: null,
  };

  await db.transaction("rw", [db.outbox, db.operations, db.remises], async () => {
    // Ajouter à l'outbox
    entry.localId = await db.outbox.add(entry);

    // Écrire localement selon la table
    if (table === "operations") {
      const op = payload as unknown as Operation;
      await db.operations.put(op);
    } else if (table === "remises_collecte") {
      const remise = payload as unknown as RemiseCollecte;
      await db.remises.put(remise);
    }
  });

  return entry;
}

/**
 * Récupère les entrées à envoyer, dans l'ordre de création (FIFO).
 *
 * - Toujours : entrées « pending » et entrées en erreur récupérable
 *   (réseau, serveur, session).
 * - Les refus définitifs (erreur métier) ne sont repris que lors d'une
 *   synchronisation manuelle (`inclureDefinitives = true`) pour éviter de
 *   boucler indéfiniment sur une opération invalide.
 */
export async function getPendingEntries(
  inclureDefinitives = true
): Promise<OutboxEntry[]> {
  const entries = await db.outbox
    .where("status")
    .anyOf(["pending", "error"] as OutboxStatus[])
    .toArray();

  return entries
    .filter(
      (e) =>
        e.status === "pending" ||
        inclureDefinitives ||
        e.errorKind !== "definitive"
    )
    .sort(
      (a, b) =>
        a.createdAt - b.createdAt || (a.localId ?? 0) - (b.localId ?? 0)
    );
}

/**
 * Marque une entrée comme « en cours de synchronisation ».
 */
export async function markSyncing(localId: number): Promise<void> {
  await db.outbox.update(localId, {
    status: "syncing" as OutboxStatus,
    lastAttempt: Date.now(),
  });
}

/**
 * Marque une entrée comme synchronisée avec succès et la retire de l'outbox.
 * Note : on supprime l'entrée outbox mais l'opération locale reste.
 * C'est le SEUL cas où une entrée quitte l'outbox : confirmation serveur.
 */
export async function markSynced(localId: number): Promise<void> {
  await db.outbox.delete(localId);
}

/**
 * Marque une entrée en erreur (JAMAIS supprimée).
 */
export async function markError(
  localId: number,
  error: string,
  kind: SyncErrorKind = "transitoire",
  code: string | null = null
): Promise<void> {
  const entry = await db.outbox.get(localId);
  if (entry) {
    await db.outbox.update(localId, {
      status: "error" as OutboxStatus,
      retries: (entry.retries ?? 0) + 1,
      lastError: error,
      lastAttempt: Date.now(),
      errorKind: kind,
      errorCode: code,
    });
  }
}

/**
 * Remet une entrée en attente après une coupure réseau pendant son envoi.
 * Le serveur a peut-être reçu l'opération : le renvoi est sans risque
 * grâce à l'idempotence (ON CONFLICT DO NOTHING).
 */
export async function markRetryLater(
  localId: number,
  message: string,
  kind: SyncErrorKind = "reseau",
  code: string | null = null
): Promise<void> {
  const entry = await db.outbox.get(localId);
  if (entry) {
    await db.outbox.update(localId, {
      status: "pending" as OutboxStatus,
      retries: (entry.retries ?? 0) + 1,
      lastError: message,
      lastAttempt: Date.now(),
      errorKind: kind,
      errorCode: code,
    });
  }
}

/**
 * Remet une entrée en erreur dans la file d'attente.
 */
export async function retryEntry(localId: number): Promise<void> {
  await db.outbox.update(localId, {
    status: "pending" as OutboxStatus,
    lastError: null,
    errorKind: null,
    errorCode: null,
  });
}

/**
 * Remet toutes les entrées en erreur dans la file d'attente.
 */
export async function retryAllErrors(): Promise<number> {
  const errors = await db.outbox
    .where("status")
    .equals("error" as OutboxStatus)
    .toArray();

  await Promise.all(
    errors.map((e) =>
      db.outbox.update(e.localId!, {
        status: "pending" as OutboxStatus,
        lastError: null,
        errorKind: null,
        errorCode: null,
      })
    )
  );

  return errors.length;
}

/**
 * Compte le nombre d'entrées en attente (pending + error + syncing).
 */
export async function countPending(): Promise<number> {
  return db.outbox.count();
}

/**
 * Compte le nombre d'entrées en erreur.
 */
export async function countErrors(): Promise<number> {
  return db.outbox.where("status").equals("error" as OutboxStatus).count();
}

/**
 * Réinitialise les entrées « syncing » qui sont bloquées (ex. coupure réseau).
 * Appelé au démarrage pour reprendre la synchronisation interrompue.
 */
export async function resetStuckEntries(): Promise<number> {
  const stuck = await db.outbox
    .where("status")
    .equals("syncing" as OutboxStatus)
    .toArray();

  await Promise.all(
    stuck.map((e) =>
      db.outbox.update(e.localId!, {
        status: "pending" as OutboxStatus,
      })
    )
  );

  return stuck.length;
}
