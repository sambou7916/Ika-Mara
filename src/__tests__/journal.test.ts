// =============================================================================
// IKA-MARA — Tests unitaires : Journal et Remise de Collecte (/agent/journal)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db/dexie";
import { addToOutbox } from "@/lib/db/outbox";
import type { Operation, Membre, Souscription, RemiseCollecte } from "@/lib/types";

describe("Journal et Remise — Règles Métier & Outbox", () => {
  const today = new Date().toISOString().split("T")[0];
  const agentId = "agent-uuid-001";

  beforeEach(async () => {
    await db.operations.clear();
    await db.membres.clear();
    await db.souscriptions.clear();
    await db.remises.clear();
    await db.outbox.clear();
  });

  it("calcule correctement le montant attendu de la remise (somme dépôts du jour)", async () => {
    // 3 dépôts enregistrés aujourd'hui
    const op1: Operation = {
      id: "op-1",
      type: "depot",
      volet: "mara",
      membre_id: "m-1",
      agent_id: agentId,
      montant: 1000,
      jours_couverts: 1,
      date_operation: today,
      cree_le: new Date().toISOString(),
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt",
    };
    const op2: Operation = {
      id: "op-2",
      type: "depot",
      volet: "pari",
      membre_id: "m-2",
      agent_id: agentId,
      montant: 3000,
      jours_couverts: 1,
      date_operation: today,
      cree_le: new Date().toISOString(),
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt",
    };
    // Opération annulée (ne doit PAS être incluse dans le montant attendu)
    const opAnnulee: Operation = {
      id: "op-annulee",
      type: "depot",
      volet: "mara",
      membre_id: "m-3",
      agent_id: agentId,
      montant: 5000,
      jours_couverts: 1,
      date_operation: today,
      cree_le: new Date().toISOString(),
      annule_ref: null,
      statut: "annulee",
      motif: "Erreur",
    };

    await db.operations.bulkAdd([op1, op2, opAnnulee]);

    const opsDuJour = await db.operations
      .where("date_operation")
      .equals(today)
      .toArray();

    const depotsValides = opsDuJour.filter(
      (op) =>
        op.agent_id === agentId &&
        (op.type === "depot" || op.type === "remboursement") &&
        op.statut !== "annulee"
    );

    const attendu = depotsValides.reduce((sum, op) => sum + op.montant, 0);
    expect(attendu).toBe(4000); // 1000 + 3000 = 4000 (les 5000 annulés sont exclus)
  });

  it("identifie les membres non visités ayant une cotisation due", async () => {
    // Membre 1 : a payé aujourd'hui
    const m1: Membre = {
      id: "m-1",
      numero: "0001",
      nom: "Diarra",
      prenom: "Amadou",
      profession: "Boutiquier",
      telephone: "+22370000001",
      quartier: "Hamdallaye",
      agent_id: agentId,
      statut: "actif",
      cree_le: new Date().toISOString(),
      modifie_le: new Date().toISOString(),
    };

    // Membre 2 : n'a PAS payé aujourd'hui
    const m2: Membre = {
      id: "m-2",
      numero: "0002",
      nom: "Traoré",
      prenom: "Fanta",
      profession: "Commerçante",
      telephone: "+22370000002",
      quartier: "Badalabougou",
      agent_id: agentId,
      statut: "actif",
      cree_le: new Date().toISOString(),
      modifie_le: new Date().toISOString(),
    };

    await db.membres.bulkAdd([m1, m2]);

    // Souscriptions actives
    await db.souscriptions.bulkAdd([
      {
        id: "s-1",
        membre_id: "m-1",
        volet: "mara",
        montant_jour: 1000,
        parts_commission: 1,
        date_debut: "2026-01-01",
        statut: "active",
        cree_le: new Date().toISOString(),
        modifie_le: new Date().toISOString(),
      },
      {
        id: "s-2",
        membre_id: "m-2",
        volet: "mara",
        montant_jour: 2000,
        parts_commission: 1,
        date_debut: "2026-01-01",
        statut: "active",
        cree_le: new Date().toISOString(),
        modifie_le: new Date().toISOString(),
      },
    ]);

    // Dépôt uniquement pour m1
    await db.operations.add({
      id: "op-m1",
      type: "depot",
      volet: "mara",
      membre_id: "m-1",
      agent_id: agentId,
      montant: 1000,
      jours_couverts: 1,
      date_operation: today,
      cree_le: new Date().toISOString(),
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt",
    });

    const ops = await db.operations.where("date_operation").equals(today).toArray();
    const membresPayes = new Set(ops.map((op) => op.membre_id));

    const membres = await db.membres.where("agent_id").equals(agentId).toArray();
    const nonVisites = membres.filter((m) => !membresPayes.has(m.id));

    expect(nonVisites.length).toBe(1);
    expect(nonVisites[0].numero).toBe("0002");
    expect(nonVisites[0].nom).toBe("Traoré");
  });

  it("enregistre une remise de collecte avec écart et statut a_confirmer dans Dexie et Outbox", async () => {
    const remiseId = crypto.randomUUID();
    const montantAttendu = 10000;
    const montantRemis = 9000;
    const ecart = montantRemis - montantAttendu; // -1000 (manquant)

    const nouvelleRemise: RemiseCollecte = {
      id: remiseId,
      agent_id: agentId,
      date_remise: today,
      montant_attendu: montantAttendu,
      montant_remis: montantRemis,
      montant: montantRemis,
      ecart,
      motif: "Billet abîmé refusé par le commerçant, à récupérer demain",
      commentaire: "Attendu: 10000 F | Remis: 9000 F | Écart: -1000 F",
      statut: "a_confirmer",
      cree_le: new Date().toISOString(),
    };

    // Écriture locale
    await addToOutbox(
      "remises_collecte",
      nouvelleRemise as unknown as Record<string, unknown>,
      remiseId
    );

    // Vérifier dans Dexie table remises
    const stored = await db.remises.get(remiseId);
    expect(stored).toBeDefined();
    expect(stored?.montant_remis).toBe(9000);
    expect(stored?.ecart).toBe(-1000);
    expect(stored?.statut).toBe("a_confirmer");

    // Vérifier dans l'outbox
    const outbox = await db.outbox.where("clientId").equals(remiseId).first();
    expect(outbox).toBeDefined();
    expect(outbox?.table).toBe("remises_collecte");
    expect(outbox?.status).toBe("pending");
  });
});
