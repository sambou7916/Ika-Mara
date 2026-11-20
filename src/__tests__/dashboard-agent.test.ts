// =============================================================================
// IKA-MARA — Tests unitaires : Métriques Tableau de Bord Agent
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db/dexie";
import { formatMontant } from "@/lib/utils/format";
import type { Operation, Membre } from "@/lib/types";

describe("Dashboard Agent — Calculs en temps réel", () => {
  const today = new Date().toISOString().split("T")[0];
  const hier = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  beforeEach(async () => {
    await db.operations.clear();
    await db.membres.clear();
    await db.outbox.clear();
  });

  it("calcule correctement le total collecté aujourd'hui et les membres distincts servis", async () => {
    const agentId = "agent-1";

    const ops: Operation[] = [
      // Opérations du jour (agent-1)
      {
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
        motif: null,
      },
      {
        id: "op-2",
        type: "depot",
        volet: "pari",
        membre_id: "m-1", // Même membre servi une 2ème fois
        agent_id: agentId,
        montant: 2000,
        jours_couverts: 1,
        date_operation: today,
        cree_le: new Date().toISOString(),
        annule_ref: null,
        statut: "validee",
        motif: null,
      },
      {
        id: "op-3",
        type: "depot",
        volet: "djourou",
        membre_id: "m-2", // 2ème membre
        agent_id: agentId,
        montant: 5000,
        jours_couverts: 1,
        date_operation: today,
        cree_le: new Date().toISOString(),
        annule_ref: null,
        statut: "validee",
        motif: null,
      },
      // Opération d'hier (ne doit PAS être comptée)
      {
        id: "op-4",
        type: "depot",
        volet: "mara",
        membre_id: "m-3",
        agent_id: agentId,
        montant: 10000,
        jours_couverts: 1,
        date_operation: hier,
        cree_le: new Date(Date.now() - 86400000).toISOString(),
        annule_ref: null,
        statut: "validee",
        motif: null,
      },
      // Opération annulée (ne doit PAS être comptée)
      {
        id: "op-5",
        type: "depot",
        volet: "mara",
        membre_id: "m-4",
        agent_id: agentId,
        montant: 3000,
        jours_couverts: 1,
        date_operation: today,
        cree_le: new Date().toISOString(),
        annule_ref: null,
        statut: "annulee",
        motif: null,
      },
    ];

    await db.operations.bulkAdd(ops);

    // Exécution du calcul
    const allOps = await db.operations.toArray();
    const depotsAujourdhui = allOps.filter(
      (op) =>
        op.date_operation === today &&
        op.type === "depot" &&
        op.statut !== "annulee" &&
        op.agent_id === agentId
    );

    // Total collecté = 1000 + 2000 + 5000 = 8000 F
    const totalCollecte = depotsAujourdhui.reduce((acc, op) => acc + op.montant, 0);
    expect(totalCollecte).toBe(8000);
    expect(formatMontant(totalCollecte)).toBe("8 000 F");

    // Membres distincts = m-1 et m-2 (2 membres)
    const membresDistincts = new Set(depotsAujourdhui.map((op) => op.membre_id));
    expect(membresDistincts.size).toBe(2);

    // Répartition par volet
    const mara = depotsAujourdhui
      .filter((op) => op.volet === "mara")
      .reduce((sum, op) => sum + op.montant, 0);
    const pari = depotsAujourdhui
      .filter((op) => op.volet === "pari")
      .reduce((sum, op) => sum + op.montant, 0);
    const djourou = depotsAujourdhui
      .filter((op) => op.volet === "djourou")
      .reduce((sum, op) => sum + op.montant, 0);

    expect(mara).toBe(1000);
    expect(pari).toBe(2000);
    expect(djourou).toBe(5000);
  });
});
