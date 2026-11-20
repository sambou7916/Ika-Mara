// =============================================================================
// IKA-MARA — Tests unitaires : file d'envoi de l'outbox (moteur de synchro)
// =============================================================================
// Le transport HTTP est remplacé par un faux serveur qui reproduit le
// comportement de sync_operation : INSERT … ON CONFLICT (id) DO NOTHING.
//
// Scénarios :
// - Ordre d'envoi (FIFO)
// - Double envoi : réponse perdue, déclenchements simultanés, doublon local
// - Coupure en plein envoi (exception réseau, application fermée)
// - Reprise : tout part, rien n'est perdu ni compté deux fois
// - Erreurs définitives / transitoires : jamais supprimées
// - Backoff exponentiel, motifs lisibles, portefeuille préservé
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { db, loadPortfolio } from "@/lib/db/dexie";
import { addToOutbox } from "@/lib/db/outbox";
import { processOutbox, syncOutbox, type SendOutcome, type Transport } from "@/lib/sync/queue";
import {
  calculerBackoff,
  classerErreur,
  libelleErreur,
  BACKOFF_MAX_MS,
} from "@/lib/sync/errors";
import type { Operation, OutboxEntry } from "@/lib/types";

// --- Faux serveur idempotent -------------------------------------------------

interface FauxServeur {
  /** Opérations stockées côté serveur, indexées par client_id */
  operations: Map<string, Record<string, unknown>>;
  /** Nombre de requêtes reçues (y compris les doublons) */
  appels: string[];
  transport: Transport;
}

/**
 * @param comportement Permet de simuler une panne pour le n-ième appel.
 *   - "coupure-avant"  : la requête n'arrive pas au serveur
 *   - "coupure-apres"  : le serveur enregistre, mais la réponse est perdue
 *   - SendOutcome      : réponse d'erreur imposée
 */
function creerFauxServeur(
  comportement: (n: number, entry: OutboxEntry) => "ok" | "coupure-avant" | "coupure-apres" | SendOutcome = () => "ok"
): FauxServeur {
  const serveur: FauxServeur = {
    operations: new Map(),
    appels: [],
    transport: async (entry) => {
      const n = serveur.appels.length + 1;
      serveur.appels.push(entry.clientId);
      const action = comportement(n, entry);

      if (action === "coupure-avant") throw new TypeError("Failed to fetch");
      if (typeof action === "object") return action;

      // INSERT … ON CONFLICT (id) DO NOTHING
      const existait = serveur.operations.has(entry.clientId);
      if (!existait) serveur.operations.set(entry.clientId, entry.payload);

      if (action === "coupure-apres") throw new TypeError("Network connection lost");
      return { ok: true, statut: existait ? "doublon" : "insere" };
    },
  };
  return serveur;
}

function totalServeur(serveur: FauxServeur): number {
  let total = 0;
  serveur.operations.forEach((p) => (total += Number(p.montant)));
  return total;
}

// --- Données de test -----------------------------------------------------------

let horloge = 1_700_000_000_000;

function depot(montant: number, overrides: Partial<Operation> = {}): Operation {
  return {
    id: crypto.randomUUID(),
    type: "depot",
    volet: "mara",
    membre_id: "membre-0042",
    agent_id: "agent-001",
    montant,
    jours_couverts: 1,
    date_operation: "2026-11-15",
    cree_le: new Date().toISOString(),
    annule_ref: null,
    statut: "validee",
    motif: null,
    ...overrides,
  };
}

/** Ajoute des dépôts dans l'outbox avec des dates de création croissantes. */
async function empiler(...montants: number[]): Promise<OutboxEntry[]> {
  const entries: OutboxEntry[] = [];
  for (const m of montants) {
    const op = depot(m);
    const entry = await addToOutbox("operations", op as unknown as Record<string, unknown>, op.id);
    horloge += 1000;
    await db.outbox.update(entry.localId!, { createdAt: horloge });
    entries.push({ ...entry, createdAt: horloge });
  }
  return entries;
}

beforeEach(async () => {
  await db.outbox.clear();
  await db.operations.clear();
  await db.remises.clear();
  await db.membres.clear();
  await db.soldes.clear();
});

// =============================================================================

describe("File d'envoi — ordre", () => {
  it("envoie les entrées dans l'ordre de saisie et vide l'outbox", async () => {
    const entries = await empiler(1000, 2000, 3000);
    const serveur = creerFauxServeur();

    const res = await processOutbox(serveur.transport);

    expect(serveur.appels).toEqual(entries.map((e) => e.clientId));
    expect(res.inserees).toBe(3);
    expect(res.interrompue).toBe(false);
    expect(await db.outbox.count()).toBe(0);
    // L'opération locale reste visible après synchro
    expect(await db.operations.count()).toBe(3);
  });

  it("n'envoie rien quand l'outbox est vide", async () => {
    const serveur = creerFauxServeur();
    const res = await processOutbox(serveur.transport);
    expect(res.traitees).toBe(0);
    expect(serveur.appels).toHaveLength(0);
  });
});

describe("File d'envoi — double envoi", () => {
  it("réponse perdue : le renvoi est ignoré par le serveur, le dépôt n'est compté qu'une fois", async () => {
    const [e1] = await empiler(5000);
    // 1er appel : le serveur enregistre puis la connexion tombe
    const serveur = creerFauxServeur((n) => (n === 1 ? "coupure-apres" : "ok"));

    const passe1 = await processOutbox(serveur.transport);
    expect(passe1.interrompue).toBe(true);
    expect(passe1.raisonInterruption).toBe("reseau");
    // L'entrée reste dans l'outbox, faute de confirmation
    const restante = await db.outbox.where("clientId").equals(e1.clientId).first();
    expect(restante?.status).toBe("pending");

    const passe2 = await processOutbox(serveur.transport);
    expect(passe2.doublons).toBe(1);
    expect(passe2.inserees).toBe(0);

    expect(serveur.appels).toEqual([e1.clientId, e1.clientId]);
    expect(serveur.operations.size).toBe(1);
    expect(totalServeur(serveur)).toBe(5000);
    expect(await db.outbox.count()).toBe(0);
  });

  it("deux déclenchements simultanés (bouton + online) n'envoient chaque entrée qu'une fois", async () => {
    await empiler(1000, 1000, 1000);
    const serveur = creerFauxServeur();

    const [r1, r2] = await Promise.all([
      syncOutbox(serveur.transport),
      syncOutbox(serveur.transport),
    ]);

    expect(r1).toBe(r2); // même passe partagée
    expect(serveur.appels).toHaveLength(3);
    expect(new Set(serveur.appels).size).toBe(3);
    expect(totalServeur(serveur)).toBe(3000);
  });

  it("même client_id présent deux fois dans l'outbox : un seul envoi, les deux entrées sont soldées", async () => {
    const op = depot(2500);
    await addToOutbox("operations", op as unknown as Record<string, unknown>, op.id);
    await addToOutbox("operations", op as unknown as Record<string, unknown>, op.id);
    const serveur = creerFauxServeur();

    const res = await processOutbox(serveur.transport);

    expect(serveur.appels).toEqual([op.id]);
    expect(res.inserees).toBe(1);
    expect(res.doublons).toBe(1);
    expect(serveur.operations.size).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it("deux dépôts distincts du même membre s'additionnent (client_id différents)", async () => {
    await empiler(1000, 1000);
    const serveur = creerFauxServeur();
    await processOutbox(serveur.transport);
    expect(serveur.operations.size).toBe(2);
    expect(totalServeur(serveur)).toBe(2000);
  });
});

describe("File d'envoi — coupure en plein envoi", () => {
  it("s'arrête à la coupure : envoyées soldées, entrée coupée et suivantes conservées", async () => {
    const entries = await empiler(1000, 2000, 3000, 4000);
    const serveur = creerFauxServeur((n) => (n === 3 ? "coupure-avant" : "ok"));

    const res = await processOutbox(serveur.transport);

    expect(res.inserees).toBe(2);
    expect(res.interrompue).toBe(true);
    expect(res.raisonInterruption).toBe("reseau");
    // La 4e n'a même pas été tentée
    expect(serveur.appels).toEqual(entries.slice(0, 3).map((e) => e.clientId));

    const restantes = await db.outbox.orderBy("createdAt").toArray();
    expect(restantes.map((e) => e.clientId)).toEqual([entries[2].clientId, entries[3].clientId]);
    expect(restantes[0].status).toBe("pending");
    expect(restantes[0].retries).toBe(1);
    expect(restantes[0].lastError).toMatch(/Connexion interrompue/);
    expect(restantes[1].retries).toBe(0);
    // Aucune entrée bloquée en « syncing »
    expect(await db.outbox.where("status").equals("syncing").count()).toBe(0);
  });

  it("application fermée pendant l'envoi : l'entrée « syncing » est reprise à la passe suivante", async () => {
    const [e1, e2] = await empiler(1000, 2000);
    // Simule une passe tuée net après markSyncing
    await db.outbox.update(e1.localId!, { status: "syncing", lastAttempt: Date.now() });

    const serveur = creerFauxServeur();
    const res = await processOutbox(serveur.transport);

    expect(serveur.appels).toEqual([e1.clientId, e2.clientId]);
    expect(res.inserees).toBe(2);
    expect(await db.outbox.count()).toBe(0);
  });

  it("délai dépassé côté transport : traité comme une coupure, rien n'est perdu", async () => {
    await empiler(1000);
    const serveur = creerFauxServeur(() => ({ ok: false, kind: "reseau", code: "DELAI_DEPASSE" }));

    const res = await processOutbox(serveur.transport);

    expect(res.interrompue).toBe(true);
    const e = await db.outbox.toCollection().first();
    expect(e?.status).toBe("pending");
    expect(e?.lastError).toMatch(/pas répondu à temps/);
  });
});

describe("File d'envoi — reprise", () => {
  it("après une coupure, la reprise envoie tout le reste sans doublon ni perte", async () => {
    const entries = await empiler(500, 1000, 1500, 2000, 2500);
    let reseauCoupe = true;
    const serveur = creerFauxServeur((n) => (reseauCoupe && n === 2 ? "coupure-apres" : "ok"));

    await processOutbox(serveur.transport);
    expect(await db.outbox.count()).toBe(4); // 1 soldée, 4 restantes

    reseauCoupe = false;
    const reprise = await processOutbox(serveur.transport);

    expect(reprise.interrompue).toBe(false);
    expect(reprise.doublons).toBe(1); // la 2e avait atteint le serveur
    expect(reprise.inserees).toBe(3);
    expect(await db.outbox.count()).toBe(0);
    expect(serveur.operations.size).toBe(5);
    expect(totalServeur(serveur)).toBe(7500);
    expect([...serveur.operations.keys()]).toEqual(entries.map((e) => e.clientId));
  });

  it("plusieurs coupures successives : chaque passe avance jusqu'à vider la file", async () => {
    await empiler(100, 200, 300, 400, 500, 600);
    let compteur = 0;
    // Une coupure tous les 3 appels
    const serveur = creerFauxServeur(() => (++compteur % 3 === 0 ? "coupure-avant" : "ok"));

    let passes = 0;
    while ((await db.outbox.count()) > 0 && passes < 10) {
      await processOutbox(serveur.transport);
      passes++;
    }

    expect(await db.outbox.count()).toBe(0);
    expect(serveur.operations.size).toBe(6);
    expect(totalServeur(serveur)).toBe(2100);
  });

  it("erreur serveur temporaire (500) : passe interrompue puis réessai automatique réussi", async () => {
    await empiler(1000, 2000);
    let panne = true;
    const serveur = creerFauxServeur((n) =>
      panne && n === 1 ? { ok: false, kind: "transitoire", code: "ERREUR_SERVEUR" } : "ok"
    );

    const r1 = await processOutbox(serveur.transport);
    expect(r1.interrompue).toBe(true);
    expect(r1.raisonInterruption).toBe("transitoire");
    expect(serveur.appels).toHaveLength(1); // l'ordre est préservé : on n'envoie pas la 2e

    const enErreur = await db.outbox.where("status").equals("error").first();
    expect(enErreur?.errorKind).toBe("transitoire");

    panne = false;
    const r2 = await processOutbox(serveur.transport); // passe automatique
    expect(r2.inserees).toBe(2);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("File d'envoi — erreurs jamais supprimées", () => {
  const refusMembre: SendOutcome = { ok: false, kind: "definitive", code: "MEMBRE_HORS_PORTEFEUILLE" };

  it("refus définitif : l'entrée reste en erreur avec un motif lisible et les suivantes partent", async () => {
    const [e1, e2, e3] = await empiler(1000, 2000, 3000);
    const serveur = creerFauxServeur((_, entry) => (entry.clientId === e2.clientId ? refusMembre : "ok"));

    const res = await processOutbox(serveur.transport);

    expect(res.interrompue).toBe(false);
    expect(res.inserees).toBe(2);
    expect(res.erreurs).toHaveLength(1);
    expect(serveur.operations.has(e1.clientId)).toBe(true);
    expect(serveur.operations.has(e3.clientId)).toBe(true);

    const restante = await db.outbox.toArray();
    expect(restante).toHaveLength(1);
    expect(restante[0].clientId).toBe(e2.clientId);
    expect(restante[0].status).toBe("error");
    expect(restante[0].errorKind).toBe("definitive");
    expect(restante[0].errorCode).toBe("MEMBRE_HORS_PORTEFEUILLE");
    expect(restante[0].lastError).toBe("Ce membre n'appartient plus à votre portefeuille.");
    // L'opération locale reste aussi visible sur la fiche membre
    expect(await db.operations.get(e2.clientId)).toBeDefined();
  });

  it("passes automatiques : le refus définitif n'est pas renvoyé en boucle mais n'est jamais supprimé", async () => {
    await empiler(1000);
    const serveur = creerFauxServeur(() => refusMembre);

    await processOutbox(serveur.transport);
    for (let i = 0; i < 5; i++) {
      await processOutbox(serveur.transport); // passes automatiques
    }

    expect(serveur.appels).toHaveLength(1);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toCollection().first())?.status).toBe("error");
  });

  it("synchro manuelle : le refus définitif est retenté, et soldé s'il est enfin accepté", async () => {
    const [e1] = await empiler(1000);
    let refuse = true;
    const serveur = creerFauxServeur(() => (refuse ? refusMembre : "ok"));

    await processOutbox(serveur.transport);
    await processOutbox(serveur.transport, { inclureDefinitives: true });
    expect(serveur.appels).toHaveLength(2);
    expect((await db.outbox.toCollection().first())?.retries).toBe(2);

    refuse = false; // l'admin a corrigé le portefeuille
    await processOutbox(serveur.transport, { inclureDefinitives: true });
    expect(serveur.operations.has(e1.clientId)).toBe(true);
    expect(await db.outbox.count()).toBe(0);
  });

  it("agent suspendu : la passe s'arrête sans rien supprimer de l'outbox", async () => {
    await empiler(1000, 2000);
    const serveur = creerFauxServeur(() => ({ ok: false, kind: "suspendu", code: "AGENT_SUSPENDU" }));

    const res = await processOutbox(serveur.transport);

    expect(res.raisonInterruption).toBe("suspendu");
    expect(serveur.appels).toHaveLength(1);
    expect(await db.outbox.count()).toBe(2); // la purge est du ressort du moteur
  });
});

describe("Erreurs — classement, motifs et backoff", () => {
  it("classe les réponses du serveur", () => {
    expect(classerErreur(403, "AGENT_SUSPENDU")).toBe("suspendu");
    expect(classerErreur(401, null)).toBe("session");
    expect(classerErreur(500, "ERREUR_SERVEUR")).toBe("transitoire");
    expect(classerErreur(503, null)).toBe("transitoire");
    expect(classerErreur(422, "MONTANT_INVALIDE")).toBe("definitive");
  });

  it("fournit des motifs lisibles en français", () => {
    expect(libelleErreur("MEMBRE_INACTIF")).toMatch(/inactif/);
    expect(libelleErreur("MONTANT_INVALIDE")).toMatch(/entier positif en F CFA/);
    expect(libelleErreur("CODE_INCONNU", "violation de contrainte")).toBe(
      "Refusé par le serveur : violation de contrainte"
    );
    expect(libelleErreur(null)).toBe("Erreur inconnue lors de la synchronisation.");
  });

  it("backoff exponentiel plafonné à 5 minutes", () => {
    expect(calculerBackoff(0)).toBe(0);
    expect(calculerBackoff(1)).toBe(2_000);
    expect(calculerBackoff(2)).toBe(4_000);
    expect(calculerBackoff(3)).toBe(8_000);
    expect(calculerBackoff(8)).toBe(256_000);
    expect(calculerBackoff(9)).toBe(BACKOFF_MAX_MS);
    expect(calculerBackoff(50)).toBe(BACKOFF_MAX_MS);
  });
});

describe("Mise à jour du portefeuille après envoi", () => {
  it("le serveur fait foi, mais les opérations encore dans l'outbox ne disparaissent pas", async () => {
    const [enAttente] = await empiler(3000);
    const opServeur = depot(1000);

    await loadPortfolio({
      membres: [],
      souscriptions: [],
      operations: [opServeur],
      soldes: [],
      parametres: [],
      remises: [],
      credits: [],
      decisions: [
        {
          id: crypto.randomUUID(),
          demande_id: crypto.randomUUID(),
          decision: "acceptee",
          montant_accorde: 50000,
          motif: null,
          decide_le: new Date().toISOString(),
        },
      ],
    });

    const ids = (await db.operations.toArray()).map((o) => o.id).sort();
    expect(ids).toEqual([opServeur.id, enAttente.clientId].sort());
    expect(await db.decisions.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it("remises confirmées par l'admin : le statut serveur remplace le statut local", async () => {
    const id = crypto.randomUUID();
    await db.remises.put({
      id,
      agent_id: "agent-001",
      date_remise: "2026-11-14",
      montant_attendu: 10000,
      montant_remis: 10000,
      montant: 10000,
      ecart: 0,
      motif: null,
      commentaire: null,
      statut: "a_confirmer",
      cree_le: new Date().toISOString(),
    });

    await loadPortfolio({
      membres: [],
      souscriptions: [],
      operations: [],
      soldes: [],
      parametres: [],
      remises: [{ ...(await db.remises.get(id))!, statut: "validee" }],
    });

    expect((await db.remises.get(id))?.statut).toBe("validee");
  });
});
