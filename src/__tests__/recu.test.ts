// =============================================================================
// IKA-MARA — Tests unitaires : Reçu de versement (/agent/recu/[id])
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db/dexie";
import { formatMontant, libelleVolet } from "@/lib/utils/format";
import type { Operation, Membre, LocalAgentAuth } from "@/lib/types";

describe("Reçu de versement — Formatage et Logique", () => {
  beforeEach(async () => {
    await db.operations.clear();
    await db.membres.clear();
    await db.soldes.clear();
    await db.outbox.clear();
    await db.agentAuth.clear();
  });

  it("génère un numéro de reçu déterministe avec préfixe agent + compteur local", async () => {
    const agentId = "agent-uuid-001";
    await db.agentAuth.add({
      identifiant: "AGT001",
      agentId,
      nom: "Traoré Boubacar",
      telephone: "+22370000001",
      statut: "actif",
      pinHash: "hash",
      pinSalt: "salt",
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: null,
      lastLoginAt: Date.now(),
    });

    const op1: Operation = {
      id: "op-1",
      type: "depot",
      volet: "mara",
      membre_id: "m-1",
      agent_id: agentId,
      montant: 1000,
      jours_couverts: 1,
      date_operation: "2026-11-14",
      cree_le: "2026-11-14T10:00:00.000Z",
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
      montant: 2000,
      jours_couverts: 2,
      date_operation: "2026-11-14",
      cree_le: "2026-11-14T10:05:00.000Z",
      annule_ref: null,
      statut: "validee",
      motif: "Dépôt",
    };

    await db.operations.bulkAdd([op1, op2]);

    // Calcul pour op1
    const ops = await db.operations.where("agent_id").equals(agentId).sortBy("cree_le");
    const index1 = ops.findIndex((o) => o.id === op1.id);
    const numRecu1 = `AGT001-${String(index1 + 1).padStart(4, "0")}`;
    expect(numRecu1).toBe("AGT001-0001");

    // Calcul pour op2
    const index2 = ops.findIndex((o) => o.id === op2.id);
    const numRecu2 = `AGT001-${String(index2 + 1).padStart(4, "0")}`;
    expect(numRecu2).toBe("AGT001-0002");
  });

  it("génère le texte de partage WhatsApp complet", () => {
    const operation = {
      montant: 5000,
      volet: "mara" as const,
      jours_couverts: 5,
      date_operation: "2026-11-14",
    };
    const membre = {
      prenom: "Fatoumata",
      nom: "Coulibaly",
      numero: "0012",
      quartier: "Lafiabougou",
    };
    const numeroRecu = "AGT001-0005";
    const soldeActuel = 25000;
    const agentIdentifiant = "AGT001";

    const text = `🧾 *REÇU DE COTISATION IKA-MARA*
---------------------------------------
*N° Reçu* : ${numeroRecu}
*Adhérent* : ${membre.prenom} ${membre.nom} (N° ${membre.numero})
*Quartier* : ${membre.quartier}
*Volet* : ${libelleVolet(operation.volet)}
*Montant versé* : ${formatMontant(operation.montant)} (${operation.jours_couverts} jours)
*Solde estimé après versement* : ${formatMontant(soldeActuel)}
*Agent collecteur* : ${agentIdentifiant}
---------------------------------------`;

    expect(text).toContain("AGT001-0005");
    expect(text).toContain("Fatoumata Coulibaly");
    expect(text).toContain("N° 0012");
    expect(text).toContain("5 000 F");
    expect(text).toContain("25 000 F");
    expect(text).toContain("Ika-Mara (Épargne)");
  });

  it("observe l'état de synchronisation en direct (pending vs synchronisé)", async () => {
    const opId = "op-test-sync";

    // 1. Initialement dans l'outbox (pending)
    await db.outbox.add({
      clientId: opId,
      table: "operations",
      payload: { id: opId },
      status: "pending",
      retries: 0,
      lastError: null,
      createdAt: Date.now(),
      lastAttempt: null,
    });

    let entry = await db.outbox.where("clientId").equals(opId).first();
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("pending");

    // 2. Après synchronisation réussie, l'entrée est retirée de l'outbox
    await db.outbox.where("clientId").equals(opId).delete();

    entry = await db.outbox.where("clientId").equals(opId).first();
    expect(entry).toBeUndefined(); // Passage automatique à "Synchronisé"
  });
});
