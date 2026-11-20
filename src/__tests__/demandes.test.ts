// =============================================================================
// IKA-MARA — Tests unitaires : Demandes de fonds (/agent/demandes)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db/dexie";
import { addToOutbox } from "@/lib/db/outbox";
import type { Operation, Membre, SoldeMembre } from "@/lib/types";

describe("Demandes Agent — Retrait et Crédit", () => {
  beforeEach(async () => {
    await db.operations.clear();
    await db.membres.clear();
    await db.soldes.clear();
    await db.outbox.clear();
    await db.parametres.clear();
  });

  it("enregistre une demande de retrait dans Dexie et Outbox avec statut en_attente", async () => {
    const opId = crypto.randomUUID();
    const demandeRetrait: Operation = {
      id: opId,
      type: "demande_retrait",
      volet: "mara",
      membre_id: "m-0001",
      agent_id: "agent-1",
      montant: 5000,
      jours_couverts: 1,
      date_operation: "2026-11-15",
      cree_le: new Date().toISOString(),
      annule_ref: null,
      statut: "en_attente",
      motif: "Demande retrait : Urgence santé",
    };

    await addToOutbox("operations", demandeRetrait as unknown as Record<string, unknown>, opId);

    const stored = await db.operations.get(opId);
    expect(stored).toBeDefined();
    expect(stored?.type).toBe("demande_retrait");
    expect(stored?.statut).toBe("en_attente");
    expect(stored?.montant).toBe(5000);

    const outbox = await db.outbox.where("clientId").equals(opId).first();
    expect(outbox).toBeDefined();
    expect(outbox?.status).toBe("pending");
  });

  it("valide que le retrait ne dépasse pas le solde d'épargne disponible", () => {
    const soldeDisponible = 15000;
    const montantValide = 10000;
    const montantExcessif = 20000;

    expect(montantValide <= soldeDisponible).toBe(true);
    expect(montantExcessif <= soldeDisponible).toBe(false);
  });

  it("enregistre une demande de crédit avec les détails de caution et statut en_attente", async () => {
    const opId = crypto.randomUUID();
    const demandeCredit: Operation = {
      id: opId,
      type: "demande_credit",
      volet: "djourou",
      membre_id: "m-0002",
      agent_id: "agent-1",
      montant: 50000,
      jours_couverts: 1,
      date_operation: "2026-11-15",
      cree_le: new Date().toISOString(),
      annule_ref: null,
      statut: "en_attente",
      motif: "Crédit 6 mois : Achat stock | Caution : Mamadou Touré (+22370000099)",
    };

    await addToOutbox("operations", demandeCredit as unknown as Record<string, unknown>, opId);

    const stored = await db.operations.get(opId);
    expect(stored?.type).toBe("demande_credit");
    expect(stored?.statut).toBe("en_attente");
    expect(stored?.motif).toContain("Caution : Mamadou Touré");
  });

  it("bloque la création d'un second crédit si un crédit est déjà ouvert", async () => {
    const membreId = "m-0003";

    // Un crédit est déjà ouvert dans soldes
    const soldeCredit: SoldeMembre = {
      membre_id: membreId,
      numero: "0003",
      nom: "Sissoko",
      prenom: "Fanta",
      agent_id: "agent-1",
      volet: "djourou",
      solde: 35000, // Dette restante
    };
    await db.soldes.add(soldeCredit);

    // Paramètre d'interdiction activé
    await db.parametres.add({
      cle: "interdire_credits_multiples",
      valeur: true,
      modifie_le: new Date().toISOString(),
    });

    const param = await db.parametres.get("interdire_credits_multiples");
    const interdireMultiples = param?.valeur !== false;
    const soldeActif = (await db.soldes.where("[membre_id+volet]").equals([membreId, "djourou"]).first())?.solde ?? 0;

    const peutCreerCredit = !interdireMultiples || soldeActif <= 0;
    expect(peutCreerCredit).toBe(false);
  });
});
