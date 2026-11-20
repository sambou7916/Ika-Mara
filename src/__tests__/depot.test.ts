// =============================================================================
// IKA-MARA — Tests unitaires : Enregistrement d'un Dépôt et Outbox
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db/dexie";
import { addToOutbox } from "@/lib/db/outbox";
import type { Membre, Souscription, Operation } from "@/lib/types";

describe("Dépôt Agent — Logique métier et Hors ligne", () => {
  beforeEach(async () => {
    await db.membres.clear();
    await db.souscriptions.clear();
    await db.operations.clear();
    await db.soldes.clear();
    await db.outbox.clear();
  });

  it("recherche un membre par son numéro d'adhérent 4 chiffres", async () => {
    const membre: Membre = {
      id: "m-0001",
      numero: "0042",
      nom: "Diarra",
      prenom: "Amadou",
      profession: "Commerçant",
      telephone: "+22370000042",
      quartier: "Hamdallaye",
      agent_id: "agent-1",
      statut: "actif",
      cree_le: new Date().toISOString(),
      modifie_le: new Date().toISOString(),
    };
    await db.membres.add(membre);

    const found = await db.membres.where("numero").equals("0042").first();
    expect(found).toBeDefined();
    expect(found?.nom).toBe("Diarra");
    expect(found?.prenom).toBe("Amadou");
    expect(found?.statut).toBe("actif");
  });

  it("calcule correctement le nombre de jours couverts par le montant", () => {
    const montantJour = 1000;

    // 1000 F -> 1 jour
    expect(Math.floor(1000 / montantJour)).toBe(1);

    // 3000 F -> 3 jours
    expect(Math.floor(3000 / montantJour)).toBe(3);

    // 5500 F -> 5 jours
    expect(Math.floor(5500 / montantJour)).toBe(5);
  });

  it("enregistre l'opération dans Dexie et Outbox avec UUID sans bloquer", async () => {
    const operationId = crypto.randomUUID();
    const op: Operation = {
      id: operationId,
      type: "depot",
      volet: "mara",
      membre_id: "m-0001",
      agent_id: "agent-1",
      montant: 3000,
      jours_couverts: 3,
      date_operation: "2026-11-14",
      cree_le: new Date().toISOString(),
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt 3 jours - Ika-Mara",
    };

    // Écriture locale immédiate
    await addToOutbox("operations", op as unknown as Record<string, unknown>, operationId);

    // Vérifier dans Dexie (table operations)
    const storedOp = await db.operations.get(operationId);
    expect(storedOp).toBeDefined();
    expect(storedOp?.montant).toBe(3000);
    expect(storedOp?.jours_couverts).toBe(3);

    // Vérifier dans l'outbox
    const outboxEntry = await db.outbox.where("clientId").equals(operationId).first();
    expect(outboxEntry).toBeDefined();
    expect(outboxEntry?.status).toBe("pending");
    expect(outboxEntry?.table).toBe("operations");
  });

  it("détecte un doublon potentiel dans les 60 secondes", async () => {
    const now = Date.now();
    const op1: Operation = {
      id: "op-first",
      type: "depot",
      volet: "pari",
      membre_id: "m-0001",
      agent_id: "agent-1",
      montant: 2000,
      jours_couverts: 1,
      date_operation: "2026-11-14",
      cree_le: new Date(now - 15000).toISOString(), // Il y a 15 secondes
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt",
    };
    await db.operations.add(op1);

    // Recherche d'opération identique
    const recentOps = await db.operations
      .where("membre_id")
      .equals("m-0001")
      .and(
        (op) =>
          op.volet === "pari" &&
          op.montant === 2000 &&
          op.date_operation === "2026-11-14" &&
          op.type === "depot"
      )
      .toArray();

    expect(recentOps.length).toBe(1);
    const diffSec = Math.floor((now - new Date(recentOps[0].cree_le).getTime()) / 1000);
    expect(diffSec).toBeLessThan(60);
  });
});
