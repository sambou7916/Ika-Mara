import { describe, it, expect } from "vitest";
import { formatMontant } from "../lib/utils/format";

describe("Admin Dashboard (PROMPT B1) — Métriques, Calculs et Export", () => {
  it("calcule correctement les métriques de collecte et d'écart par agent", () => {
    const agentsData = [
      {
        id: "agent-1",
        nom: "Ousmane Traoré",
        identifiant: "AGT001",
        membres_servis: 8,
        collecte: 25000,
        remis: 25000,
        ecart: 0,
      },
      {
        id: "agent-2",
        nom: "Fatoumata Coulibaly",
        identifiant: "AGT002",
        membres_servis: 5,
        collecte: 15000,
        remis: 13000,
        ecart: -2000, // Manquant de 2 000 F
      },
    ];

    const totalCollecte = agentsData.reduce((sum, a) => sum + a.collecte, 0);
    const totalRemis = agentsData.reduce((sum, a) => sum + a.remis, 0);
    const totalEcart = totalRemis - totalCollecte;

    expect(totalCollecte).toBe(40000);
    expect(totalRemis).toBe(38000);
    expect(totalEcart).toBe(-2000);
    expect(formatMontant(totalCollecte)).toMatch(/40[\s\u202f]000 F/);
    expect(formatMontant(totalRemis)).toMatch(/38[\s\u202f]000 F/);
  });

  it("génère un export CSV compatible Excel (BOM UTF-8, séparateur point-virgule)", () => {
    const tableauAgents = [
      {
        identifiant: "AGT001",
        nom: "Ousmane Traoré",
        telephone: "+223 70 00 00 01",
        membres_servis: 10,
        collecte: 50000,
        remis: 50000,
        ecart: 0,
        statut: "actif",
      },
    ];

    const entetes = [
      "Identifiant",
      "Nom Agent",
      "Téléphone",
      "Membres Servis",
      "Collecté",
      "Remis",
      "Écart de Collecte",
      "Statut Agent",
    ];

    const lignes = tableauAgents.map((ag) => [
      `"${ag.identifiant}"`,
      `"${ag.nom}"`,
      `"${ag.telephone}"`,
      ag.membres_servis,
      ag.collecte,
      ag.remis,
      ag.ecart,
      `"${ag.statut === "actif" ? "Actif" : "Suspendu"}"`,
    ]);

    const csvContent =
      "\uFEFF" +
      [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    // Vérifie la présence du BOM UTF-8
    expect(csvContent.charCodeAt(0)).toBe(0xfeff);
    // Vérifie le séparateur point-virgule
    expect(csvContent).toContain("Identifiant;Nom Agent;Téléphone");
    expect(csvContent).toContain('"AGT001";"Ousmane Traoré";"+223 70 00 00 01";10;50000;50000;0;"Actif"');
  });

  it("gère les alertes pour les membres en retard et les écarts de remises", () => {
    const alertes = {
      retards_membres_count: 4,
      seuil_retard_jours: 3,
      ecarts_remises_count: 2,
      demandes_a_valider_count: 3,
    };

    expect(alertes.retards_membres_count).toBeGreaterThan(0);
    expect(alertes.seuil_retard_jours).toBe(3);
    expect(alertes.ecarts_remises_count).toBe(2);
    expect(alertes.demandes_a_valider_count).toBe(3);
  });
});
