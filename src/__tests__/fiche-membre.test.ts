// =============================================================================
// IKA-MARA — Tests unitaires : Fiche Membre (/agent/membres/[numero])
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db/dexie";
import { formatMontant } from "@/lib/utils/format";
import type { Membre, Souscription, Operation, SoldeMembre } from "@/lib/types";

describe("Fiche Membre — Calcul des Soldes Locaux et Outbox", () => {
  beforeEach(async () => {
    await db.membres.clear();
    await db.souscriptions.clear();
    await db.soldes.clear();
    await db.operations.clear();
    await db.outbox.clear();
  });

  it("calcule le solde local = solde serveur + dépôts locaux non synchronisés", async () => {
    const membreId = "m-0042";

    // 1. Solde serveur du dernier téléchargement : 10 000 F en épargne (mara)
    const soldeServeur: SoldeMembre = {
      membre_id: membreId,
      numero: "0042",
      nom: "Diarra",
      prenom: "Amadou",
      agent_id: "agent-1",
      volet: "mara",
      solde: 10000,
    };
    await db.soldes.add(soldeServeur);

    // 2. Dépôt local de 2 000 F effectué hors ligne (enregistré dans operations et outbox)
    const opLocalId = "op-local-1";
    const opLocal: Operation = {
      id: opLocalId,
      type: "depot",
      volet: "mara",
      membre_id: membreId,
      agent_id: "agent-1",
      montant: 2000,
      jours_couverts: 2,
      date_operation: "2026-11-15",
      cree_le: new Date().toISOString(),
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt local",
    };
    await db.operations.add(opLocal);

    // L'opération est présente dans l'outbox
    await db.outbox.add({
      clientId: opLocalId,
      table: "operations",
      payload: { id: opLocalId },
      status: "pending",
      retries: 0,
      lastError: null,
      createdAt: Date.now(),
      lastAttempt: null,
    });

    // 3. Calcul
    const outbox = await db.outbox.toArray();
    const pendingIds = new Set(outbox.map((e) => e.clientId));

    const sServeur = (await db.soldes.where("[membre_id+volet]").equals([membreId, "mara"]).first())?.solde ?? 0;
    const ops = await db.operations.where("membre_id").equals(membreId).toArray();

    let deltaLocal = 0;
    for (const op of ops) {
      if (pendingIds.has(op.id) && op.volet === "mara") {
        if (op.type === "depot") deltaLocal += op.montant;
        else if (op.type === "retrait") deltaLocal -= op.montant;
      }
    }

    const soldeFinal = sServeur + deltaLocal;
    // 10 000 F + 2 000 F = 12 000 F
    expect(soldeFinal).toBe(12000);
    expect(formatMontant(soldeFinal)).toBe("12 000 F");
  });

  it("identifie les opérations en attente de synchronisation parmi les 10 dernières", async () => {
    const membreId = "m-0042";

    // Opération 1 synchronisée (pas dans l'outbox)
    await db.operations.add({
      id: "op-synced",
      type: "depot",
      volet: "mara",
      membre_id: membreId,
      agent_id: "agent-1",
      montant: 1000,
      jours_couverts: 1,
      date_operation: "2026-11-14",
      cree_le: "2026-11-14T10:00:00Z",
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt",
    });

    // Opération 2 en attente (présente dans l'outbox)
    await db.operations.add({
      id: "op-pending",
      type: "depot",
      volet: "mara",
      membre_id: membreId,
      agent_id: "agent-1",
      montant: 1000,
      jours_couverts: 1,
      date_operation: "2026-11-15",
      cree_le: "2026-11-15T10:00:00Z",
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt",
    });

    await db.outbox.add({
      clientId: "op-pending",
      table: "operations",
      payload: { id: "op-pending" },
      status: "pending",
      retries: 0,
      lastError: null,
      createdAt: Date.now(),
      lastAttempt: null,
    });

    const pendingIds = new Set((await db.outbox.toArray()).map((e) => e.clientId));
    const allOps = await db.operations.where("membre_id").equals(membreId).toArray();

    const taggedOps = allOps.map((op) => ({
      ...op,
      isPending: pendingIds.has(op.id),
    }));

    const pending = taggedOps.find((op) => op.id === "op-pending");
    const synced = taggedOps.find((op) => op.id === "op-synced");

    expect(pending?.isPending).toBe(true);
    expect(synced?.isPending).toBe(false);
  });
});
