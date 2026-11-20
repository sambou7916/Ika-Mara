// =============================================================================
// IKA-MARA — Base de données locale (Dexie / IndexedDB)
// =============================================================================
// Stockage hors ligne : membres, souscriptions, soldes, paramètres de l'agent.
// L'outbox est dans une table séparée (voir outbox.ts).
// =============================================================================

import Dexie, { type EntityTable } from "dexie";
import type {
  Membre,
  Souscription,
  Operation,
  SoldeMembre,
  Parametre,
  OutboxEntry,
  LocalAgentAuth,
  RemiseCollecte,
  Credit,
  DecisionDemande,
  PortefeuilleAgent,
} from "@/lib/types";

/**
 * Schéma de la base Dexie locale pour IKA-MARA.
 */
export class IkaMara extends Dexie {
  membres!: EntityTable<Membre, "id">;
  souscriptions!: EntityTable<Souscription, "id">;
  operations!: EntityTable<Operation, "id">;
  soldes!: EntityTable<SoldeMembre, "membre_id">;
  parametres!: EntityTable<Parametre, "cle">;
  outbox!: EntityTable<OutboxEntry, "localId">;
  agentAuth!: EntityTable<LocalAgentAuth, "identifiant">;
  remises!: EntityTable<RemiseCollecte, "id">;
  credits!: EntityTable<Credit, "id">;
  decisions!: EntityTable<DecisionDemande, "id">;

  constructor() {
    super("ika-mara");

    this.version(1).stores({
      // Indexer les champs utiles pour les requêtes hors ligne
      membres:
        "id, numero, agent_id, statut, nom, [agent_id+statut]",
      souscriptions:
        "id, membre_id, volet, statut, [membre_id+volet]",
      operations:
        "id, membre_id, agent_id, type, volet, date_operation, [agent_id+date_operation]",
      soldes:
        "[membre_id+volet], membre_id, agent_id, volet",
      parametres:
        "cle",
      outbox:
        "++localId, clientId, status, table, createdAt",
      agentAuth:
        "identifiant, agentId, isBlocked",
      remises:
        "id, agent_id, date_remise, statut",
    });

    // v2 : décisions de l'administrateur téléchargées lors de la synchro
    this.version(2).stores({
      credits: "id, membre_id, statut",
      decisions: "id, demande_id, decision",
    });
  }
}

/** Instance singleton de la base locale */
export const db = new IkaMara();

/**
 * Vide toutes les tables locales (déconnexion de l'agent).
 */
export async function clearLocalData(): Promise<void> {
  await db.transaction(
    "rw",
    [db.membres, db.souscriptions, db.operations, db.soldes, db.parametres, db.remises, db.credits, db.decisions],
    async () => {
      await db.membres.clear();
      await db.souscriptions.clear();
      await db.operations.clear();
      await db.soldes.clear();
      await db.parametres.clear();
      await db.remises.clear();
      await db.credits.clear();
      await db.decisions.clear();
      // NE PAS vider l'outbox — les opérations en attente doivent persister
    }
  );
}

/**
 * Purge complète lors d'une suspension d'agent :
 * Efface les données opérationnelles ET les données d'authentification locales.
 */
export async function purgeAgentData(): Promise<void> {
  await db.transaction(
    "rw",
    [db.membres, db.souscriptions, db.operations, db.soldes, db.parametres, db.agentAuth, db.outbox, db.remises, db.credits, db.decisions],
    async () => {
      await db.membres.clear();
      await db.souscriptions.clear();
      await db.operations.clear();
      await db.soldes.clear();
      await db.parametres.clear();
      await db.agentAuth.clear();
      await db.outbox.clear();
      await db.remises.clear();
      await db.credits.clear();
      await db.decisions.clear();
    }
  );
}

/**
 * Charge le portefeuille de l'agent depuis le serveur vers Dexie.
 * Appelé au premier login et après chaque synchronisation.
 *
 * Le serveur fait foi : les tables sont remplacées par les données serveur,
 * PUIS les écritures locales encore présentes dans l'outbox (en attente ou en
 * erreur) sont ré-appliquées, afin qu'aucune opération non synchronisée ne
 * disparaisse de l'écran de l'agent.
 */
export async function loadPortfolio(data: PortefeuilleAgent): Promise<void> {
  await db.transaction(
    "rw",
    [db.membres, db.souscriptions, db.operations, db.soldes, db.parametres, db.remises, db.credits, db.decisions, db.outbox],
    async () => {
      await db.membres.clear();
      await db.souscriptions.clear();
      await db.operations.clear();
      await db.soldes.clear();
      await db.parametres.clear();

      if (data.membres?.length) await db.membres.bulkPut(data.membres);
      if (data.souscriptions?.length)
        await db.souscriptions.bulkPut(data.souscriptions);
      if (data.operations?.length)
        await db.operations.bulkPut(data.operations);
      if (data.soldes?.length) await db.soldes.bulkPut(data.soldes);
      if (data.parametres?.length)
        await db.parametres.bulkPut(data.parametres);

      // Décisions admin : remplacées seulement si le serveur les a fournies
      if (data.remises) {
        await db.remises.clear();
        if (data.remises.length) await db.remises.bulkPut(data.remises);
      }
      if (data.credits) {
        await db.credits.clear();
        if (data.credits.length) await db.credits.bulkPut(data.credits);
      }
      if (data.decisions) {
        await db.decisions.clear();
        if (data.decisions.length) await db.decisions.bulkPut(data.decisions);
      }

      // Ré-appliquer les écritures locales non encore confirmées par le serveur
      const enAttente = await db.outbox.toArray();
      for (const entry of enAttente) {
        if (entry.table === "operations") {
          await db.operations.put(entry.payload as unknown as Operation);
        } else if (entry.table === "remises_collecte") {
          await db.remises.put(entry.payload as unknown as RemiseCollecte);
        }
      }
    }
  );
}

// --- Fonctions d'authentification locale ---

/**
 * Récupère les données d'authentification locale pour un identifiant.
 */
export async function getLocalAuth(
  identifiant: string
): Promise<LocalAgentAuth | undefined> {
  return db.agentAuth.get(identifiant.trim().toUpperCase());
}

/**
 * Enregistre ou met à jour les données d'authentification locale de l'agent.
 */
export async function saveLocalAuth(auth: LocalAgentAuth): Promise<void> {
  await db.agentAuth.put({
    ...auth,
    identifiant: auth.identifiant.trim().toUpperCase(),
  });
}

/**
 * Enregistre un échec de tentative de saisie du PIN.
 * Bloque le compte à 5 tentatives.
 */
export async function recordFailedAttempt(
  identifiant: string
): Promise<{ isBlocked: boolean; attempts: number }> {
  const normId = identifiant.trim().toUpperCase();
  const auth = await db.agentAuth.get(normId);
  if (!auth) {
    return { isBlocked: false, attempts: 1 };
  }

  const nextAttempts = (auth.failedAttempts || 0) + 1;
  const isBlocked = nextAttempts >= 5;

  await db.agentAuth.update(normId, {
    failedAttempts: nextAttempts,
    isBlocked,
    blockedAt: isBlocked ? Date.now() : auth.blockedAt,
  });

  return { isBlocked, attempts: nextAttempts };
}

/**
 * Réinitialise le compteur d'échecs après un PIN correct.
 */
export async function resetFailedAttempts(identifiant: string): Promise<void> {
  const normId = identifiant.trim().toUpperCase();
  await db.agentAuth.update(normId, {
    failedAttempts: 0,
    isBlocked: false,
    blockedAt: null,
    lastLoginAt: Date.now(),
  });
}
