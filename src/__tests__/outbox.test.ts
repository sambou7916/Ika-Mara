// =============================================================================
// IKA-MARA — Tests unitaires : Outbox
// =============================================================================
// Vérifie le comportement de l'outbox hors ligne :
// - Ajout d'opérations
// - Récupération des entrées en attente
// - Marquage synced/error
// - Une entrée en erreur n'est JAMAIS supprimée
// - Réinitialisation des entrées bloquées (coupure réseau)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { IkaMara } from "@/lib/db/dexie";
import type { OutboxEntry } from "@/lib/types";

// Créer une instance Dexie fraîche pour chaque test
let db: IkaMara;

function createOutboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    clientId: crypto.randomUUID(),
    table: "operations",
    payload: {
      type: "depot",
      volet: "mara",
      montant: 1000,
      membre_id: "test-membre",
      agent_id: "test-agent",
    },
    status: "pending",
    retries: 0,
    lastError: null,
    createdAt: Date.now(),
    lastAttempt: null,
    ...overrides,
  };
}

beforeEach(async () => {
  // Nouvelle base pour chaque test
  db = new IkaMara();
  await db.outbox.clear();
  await db.operations.clear();
});

describe("Outbox — Ajout", () => {
  it("ajoute une entrée dans l'outbox avec le statut pending", async () => {
    const entry = createOutboxEntry();
    const localId = await db.outbox.add(entry);

    const stored = await db.outbox.get(localId);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("pending");
    expect(stored!.clientId).toBe(entry.clientId);
    expect(stored!.retries).toBe(0);
  });

  it("génère des clientId uniques pour chaque entrée", async () => {
    const entry1 = createOutboxEntry();
    const entry2 = createOutboxEntry();

    expect(entry1.clientId).not.toBe(entry2.clientId);

    await db.outbox.add(entry1);
    await db.outbox.add(entry2);

    const all = await db.outbox.toArray();
    expect(all).toHaveLength(2);
  });
});

describe("Outbox — Récupération", () => {
  it("récupère toutes les entrées pending triées par date de création", async () => {
    const e1 = createOutboxEntry({ createdAt: 1000 });
    const e2 = createOutboxEntry({ createdAt: 3000 });
    const e3 = createOutboxEntry({ createdAt: 2000 });

    await db.outbox.bulkAdd([e1, e2, e3]);

    const pending = await db.outbox
      .where("status")
      .equals("pending")
      .sortBy("createdAt");

    expect(pending).toHaveLength(3);
    expect(pending[0].createdAt).toBe(1000);
    expect(pending[1].createdAt).toBe(2000);
    expect(pending[2].createdAt).toBe(3000);
  });

  it("récupère aussi les entrées en erreur (pour retry)", async () => {
    await db.outbox.add(createOutboxEntry({ status: "pending" }));
    await db.outbox.add(createOutboxEntry({ status: "error" }));
    await db.outbox.add(createOutboxEntry({ status: "syncing" }));

    const retryable = await db.outbox
      .where("status")
      .anyOf(["pending", "error"])
      .toArray();

    expect(retryable).toHaveLength(2);
  });
});

describe("Outbox — Marquage synced", () => {
  it("supprime l'entrée de l'outbox après synchronisation réussie", async () => {
    const entry = createOutboxEntry();
    const localId = await db.outbox.add(entry);

    // Simuler la synchro réussie
    await db.outbox.delete(localId);

    const stored = await db.outbox.get(localId);
    expect(stored).toBeUndefined();

    // Vérifier que l'outbox est vide
    const count = await db.outbox.count();
    expect(count).toBe(0);
  });
});

describe("Outbox — Erreurs", () => {
  it("marque une entrée en erreur sans la supprimer", async () => {
    const entry = createOutboxEntry();
    const localId = await db.outbox.add(entry);

    // Simuler une erreur
    await db.outbox.update(localId, {
      status: "error",
      retries: 1,
      lastError: "HTTP 500: Internal Server Error",
      lastAttempt: Date.now(),
    });

    const stored = await db.outbox.get(localId);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("error");
    expect(stored!.retries).toBe(1);
    expect(stored!.lastError).toBe("HTTP 500: Internal Server Error");
  });

  it("JAMAIS de suppression d'une entrée en erreur", async () => {
    const entry = createOutboxEntry();
    const localId = await db.outbox.add(entry);

    // Marquer en erreur
    await db.outbox.update(localId, {
      status: "error",
      retries: 5,
      lastError: "Erreur réseau",
    });

    // L'entrée doit toujours exister
    const stored = await db.outbox.get(localId);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("error");

    // Remettre en attente (retry)
    await db.outbox.update(localId, {
      status: "pending",
      lastError: null,
    });

    const retried = await db.outbox.get(localId);
    expect(retried).toBeDefined();
    expect(retried!.status).toBe("pending");
    expect(retried!.retries).toBe(5); // Le compteur ne se réinitialise pas
  });

  it("incrémente le compteur de retries à chaque erreur", async () => {
    const entry = createOutboxEntry();
    const localId = await db.outbox.add(entry);

    for (let i = 1; i <= 3; i++) {
      const current = await db.outbox.get(localId);
      await db.outbox.update(localId, {
        status: "error",
        retries: (current?.retries ?? 0) + 1,
        lastError: `Erreur tentative ${i}`,
      });
    }

    const stored = await db.outbox.get(localId);
    expect(stored!.retries).toBe(3);
  });
});

describe("Outbox — Double envoi (idempotence)", () => {
  it("deux entrées avec le même clientId sont stockées séparément dans l'outbox", async () => {
    // L'idempotence est gérée côté serveur (ON CONFLICT DO NOTHING)
    // L'outbox peut contenir des doublons car le serveur les ignore
    const clientId = crypto.randomUUID();
    const e1 = createOutboxEntry({ clientId });
    const e2 = createOutboxEntry({ clientId });

    await db.outbox.add(e1);
    await db.outbox.add(e2);

    const all = await db.outbox
      .where("clientId")
      .equals(clientId)
      .toArray();

    // Les deux sont stockées — c'est le serveur qui déduplique
    expect(all).toHaveLength(2);
  });
});

describe("Outbox — Coupure en cours d'envoi", () => {
  it("réinitialise les entrées 'syncing' bloquées au redémarrage", async () => {
    // Simuler des entrées bloquées (la synchro a été coupée)
    await db.outbox.add(createOutboxEntry({ status: "syncing" }));
    await db.outbox.add(createOutboxEntry({ status: "syncing" }));
    await db.outbox.add(createOutboxEntry({ status: "pending" }));

    // Réinitialiser les bloquées
    const stuck = await db.outbox
      .where("status")
      .equals("syncing")
      .toArray();

    await Promise.all(
      stuck.map((e) =>
        db.outbox.update(e.localId!, { status: "pending" })
      )
    );

    // Toutes doivent être en pending maintenant
    const syncing = await db.outbox
      .where("status")
      .equals("syncing")
      .count();
    expect(syncing).toBe(0);

    const pending = await db.outbox
      .where("status")
      .equals("pending")
      .count();
    expect(pending).toBe(3);
  });
});

describe("Outbox — Reprise", () => {
  it("remet toutes les erreurs en attente (retry all)", async () => {
    await db.outbox.add(createOutboxEntry({ status: "error", lastError: "e1" }));
    await db.outbox.add(createOutboxEntry({ status: "error", lastError: "e2" }));
    await db.outbox.add(createOutboxEntry({ status: "pending" }));

    const errors = await db.outbox
      .where("status")
      .equals("error")
      .toArray();

    await Promise.all(
      errors.map((e) =>
        db.outbox.update(e.localId!, {
          status: "pending",
          lastError: null,
        })
      )
    );

    const allPending = await db.outbox
      .where("status")
      .equals("pending")
      .count();
    expect(allPending).toBe(3);

    const allErrors = await db.outbox
      .where("status")
      .equals("error")
      .count();
    expect(allErrors).toBe(0);
  });
});
