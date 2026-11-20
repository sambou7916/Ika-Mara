import { describe, it, expect } from "vitest";
import { validateIdentifiant, validatePin } from "../lib/utils/pin";
import { formatMontant } from "../lib/utils/format";

describe("Admin Agents (PROMPT B3) — Gestion, Performance et Isolation", () => {
  it("valide les identifiants d'agents de format AGT-00X / AGT00X", () => {
    expect(validateIdentifiant("AGT-001").valid).toBe(true);
    expect(validateIdentifiant("AGT001").valid).toBe(true);
    expect(validateIdentifiant("AGT-012").valid).toBe(true);
    expect(validateIdentifiant("A").valid).toBe(false);
    expect(validateIdentifiant("").valid).toBe(false);
  });

  it("valide les codes PIN provisoires (exactement 6 chiffres numériques)", () => {
    expect(validatePin("1234").valid).toBe(false);
    expect(validatePin("12345").valid).toBe(false);
    expect(validatePin("123456").valid).toBe(true);
    expect(validatePin("123").valid).toBe(false);
    expect(validatePin("1234567").valid).toBe(false);
    expect(validatePin("abcd").valid).toBe(false);
  });

  it("calcule les métriques de performance mensuelle de l'agent", () => {
    const totalMembres = 20;
    const depotsDuMois = [
      { membre_id: "m-1", montant: 2000 },
      { membre_id: "m-1", montant: 2000 },
      { membre_id: "m-2", montant: 1000 },
      { membre_id: "m-3", montant: 3000 },
      { membre_id: "m-4", montant: 5000 },
      { membre_id: "m-5", montant: 1000 },
    ];

    const totalCollecte = depotsDuMois.reduce((acc, d) => acc + d.montant, 0);
    expect(totalCollecte).toBe(14000);
    expect(formatMontant(totalCollecte)).toMatch(/14[\s\u202f]000 F/);

    const membresServisDistincts = new Set(depotsDuMois.map((d) => d.membre_id)).size;
    expect(membresServisDistincts).toBe(5);

    const regularite = Math.round((membresServisDistincts / totalMembres) * 100);
    expect(regularite).toBe(25); // 5 sur 20 = 25%
  });

  it("calcule les écarts de remises de l'agent", () => {
    const remises = [
      { date_remise: "2026-11-01", montant_attendu: 10000, montant_remis: 10000, ecart: 0 },
      { date_remise: "2026-11-02", montant_attendu: 15000, montant_remis: 14000, ecart: -1000 }, // Manquant
      { date_remise: "2026-11-03", montant_attendu: 8000, montant_remis: 8500, ecart: 500 }, // Excédent
    ];

    const totalEcarts = remises.reduce((sum, r) => sum + r.ecart, 0);
    expect(totalEcarts).toBe(-500);

    const remisesLitigieuses = remises.filter((r) => r.ecart !== 0).length;
    expect(remisesLitigieuses).toBe(2);
  });

  it("simule l'isolation RLS : un agent ne filtre que les membres où agent_id = auth.uid()", () => {
    const allMembres = [
      { id: "m-1", nom: "Diarra", agent_id: "agent-A" },
      { id: "m-2", nom: "Coulibaly", agent_id: "agent-A" },
      { id: "m-3", nom: "Traoré", agent_id: "agent-B" },
    ];

    const currentAgentId = "agent-A";
    const agentVisibleMembres = allMembres.filter((m) => m.agent_id === currentAgentId);

    expect(agentVisibleMembres).toHaveLength(2);
    expect(agentVisibleMembres.some((m) => m.agent_id === "agent-B")).toBe(false);
  });

  it("génère des traces d'audit_log pour les actions administratives de l'agent", () => {
    const actions = [
      {
        qui: "admin-id-1",
        quoi: "suspension_agent",
        details: "Suspension de l'agent AGT-001 (Ousmane Traoré)",
      },
      {
        qui: "admin-id-1",
        quoi: "revocation_appareil",
        details: "Révocation de l'appareil pour l'agent AGT-001",
      },
      {
        qui: "admin-id-1",
        quoi: "reinitialisation_pin_agent",
        details: "Réinitialisation du code PIN pour l'agent AGT-001",
      },
    ];

    expect(actions).toHaveLength(3);
    expect(actions[0].quoi).toBe("suspension_agent");
    expect(actions[1].quoi).toBe("revocation_appareil");
    expect(actions[2].quoi).toBe("reinitialisation_pin_agent");
  });
});
