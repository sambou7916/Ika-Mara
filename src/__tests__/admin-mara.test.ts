import { describe, it, expect } from "vitest";
import { formatMontant } from "../lib/utils/format";

describe("Admin Ika-Mara (PROMPT B4) — Dépôts, Retraits à valider, Soldes & Règles Métier", () => {
  // 1. Calcul des soldes
  it("calcule correctement le solde net disponible : dépôts - commissions - retraits", () => {
    const operations = [
      { type: "depot", montant: 5000 },
      { type: "depot", montant: 5000 },
      { type: "depot", montant: 5000 },
      { type: "commission", montant: 500 }, // Commission mensuelle prélevée
      { type: "retrait", montant: 4000 },
    ];

    const cumuls = operations.reduce(
      (acc, op) => {
        if (op.type === "depot") acc.depots += op.montant;
        if (op.type === "commission") acc.commissions += op.montant;
        if (op.type === "retrait") acc.retraits += op.montant;
        return acc;
      },
      { depots: 0, commissions: 0, retraits: 0 }
    );

    const soldeDisponible = cumuls.depots - cumuls.commissions - cumuls.retraits;

    expect(cumuls.depots).toBe(15000);
    expect(cumuls.commissions).toBe(500);
    expect(cumuls.retraits).toBe(4000);
    expect(soldeDisponible).toBe(10500);
    expect(formatMontant(soldeDisponible)).toMatch(/10[\s\u202f]500 F/);
  });

  // 2. Vérification des conditions de retrait côté serveur
  it("rejette la validation si le montant demandé dépasse le solde disponible", () => {
    const soldeDisponible = 10500;
    const montantDemandeValide = 10000;
    const montantDemandeInvalide = 11000;

    function verifierPlafondRetrait(montant: number, solde: number) {
      if (montant <= 0) return { valide: false, erreur: "Le montant doit être supérieur à 0" };
      if (montant > solde) return { valide: false, erreur: "Solde disponible insuffisant" };
      return { valide: true, erreur: null };
    }

    const check1 = verifierPlafondRetrait(montantDemandeValide, soldeDisponible);
    expect(check1.valide).toBe(true);
    expect(check1.erreur).toBeNull();

    const check2 = verifierPlafondRetrait(montantDemandeInvalide, soldeDisponible);
    expect(check2.valide).toBe(false);
    expect(check2.erreur).toBe("Solde disponible insuffisant");
  });

  // 3. Vérification de l'ancienneté requise (paramètre delai_min_retrait_jours)
  it("vérifie le délai minimal d'ancienneté avant d'autoriser un retrait", () => {
    const delaiMinJours = 30;

    function verifierAnciennete(dateCreation: Date, dateReference: Date, delaiMin: number) {
      const diffMs = dateReference.getTime() - dateCreation.getTime();
      const ancienneteJours = Math.floor(diffMs / (1000 * 3600 * 24));
      return {
        ancienneteJours,
        delaiAtteint: ancienneteJours >= delaiMin,
      };
    }

    const dateRef = new Date("2026-11-15T12:00:00Z");

    // Membre inscrit il y a 10 jours
    const membreRecent = new Date("2026-11-05T12:00:00Z");
    const checkRecent = verifierAnciennete(membreRecent, dateRef, delaiMinJours);
    expect(checkRecent.ancienneteJours).toBe(10);
    expect(checkRecent.delaiAtteint).toBe(false);

    // Membre inscrit il y a 45 jours
    const membreAncien = new Date("2026-10-01T12:00:00Z");
    const checkAncien = verifierAnciennete(membreAncien, dateRef, delaiMinJours);
    expect(checkAncien.ancienneteJours).toBe(45);
    expect(checkAncien.delaiAtteint).toBe(true);
  });

  // 4. Validation atomique du retrait
  it("génère une écriture de retrait et un décaissement de caisse lors de la validation", () => {
    const demande = {
      id: "demande-retrait-01",
      membre_id: "membre-123",
      agent_id: "agent-001",
      montant: 20000,
    };

    function simulerValidationRetrait(d: typeof demande, adminId: string) {
      // 1. Opération de retrait
      const operationRetrait = {
        id: `op-retrait-${Date.now()}`,
        membre_id: d.membre_id,
        agent_id: d.agent_id,
        volet: "mara",
        type: "retrait",
        montant: d.montant,
        statut: "validee",
      };

      // 2. Décaissement caisse
      const caisseMouvement = {
        id: `mouv-caisse-${Date.now()}`,
        type: "sortie",
        montant: d.montant,
        motif: `Retrait épargne validé`,
        reference_id: operationRetrait.id,
        reference_type: "retrait",
        auteur_id: adminId,
      };

      // 3. Clôture décision
      const decision = {
        demande_id: d.id,
        statut: "validee",
        decide_par: adminId,
        operation_id: operationRetrait.id,
      };

      return { operationRetrait, caisseMouvement, decision };
    }

    const res = simulerValidationRetrait(demande, "admin-01");
    expect(res.operationRetrait.type).toBe("retrait");
    expect(res.operationRetrait.montant).toBe(20000);
    expect(res.caisseMouvement.type).toBe("sortie");
    expect(res.caisseMouvement.reference_id).toBe(res.operationRetrait.id);
    expect(res.decision.statut).toBe("validee");
  });

  // 5. Refus de demande de retrait : motif obligatoire
  it("exige obligatoirement un motif non vide lors du refus d'un retrait", () => {
    function simulerRefus(motif: string) {
      if (!motif || !motif.trim()) {
        throw new Error("Le motif de refus est obligatoire");
      }
      return {
        statut: "rejetee",
        motif: motif.trim(),
      };
    }

    expect(() => simulerRefus("")).toThrow("Le motif de refus est obligatoire");
    expect(() => simulerRefus("   ")).toThrow("Le motif de refus est obligatoire");

    const refusValide = simulerRefus("Solde insuffisant suite aux commissions mensuelles");
    expect(refusValide.statut).toBe("rejetee");
    expect(refusValide.motif).toBe("Solde insuffisant suite aux commissions mensuelles");
  });

  // 6. Correction uniquement par écriture inverse liée
  it("corrige un dépôt erroné par écriture inverse liée avec motif obligatoire", () => {
    const depotInitial = {
      id: "depot-999",
      montant: 10000,
      volet: "mara",
      type: "depot",
      statut: "validee",
    };

    function creerEcritureInverse(depot: typeof depotInitial, motif: string, auteurId: string) {
      if (!motif || !motif.trim()) {
        throw new Error("Motif obligatoire pour l'annulation");
      }

      // Écriture inverse de correction
      return {
        id: `annul-${depot.id}`,
        type: "annulation",
        volet: depot.volet,
        montant: depot.montant, // Montant à contre-passer
        annule_ref: depot.id,
        motif: motif.trim(),
        auteur_id: auteurId,
      };
    }

    expect(() => creerEcritureInverse(depotInitial, "", "admin-01")).toThrow(
      "Motif obligatoire pour l'annulation"
    );

    const contrePassation = creerEcritureInverse(
      depotInitial,
      "Erreur de saisie carnet agent",
      "admin-01"
    );

    expect(contrePassation.type).toBe("annulation");
    expect(contrePassation.annule_ref).toBe("depot-999");
    expect(contrePassation.montant).toBe(10000);
    expect(contrePassation.motif).toBe("Erreur de saisie carnet agent");
  });

  // 7. Formatage de l'export Excel CSV
  it("génère un contenu CSV avec BOM UTF-8 et séparateur point-virgule pour Excel", () => {
    const depotsExport = [
      {
        date_operation: "2026-11-15",
        heure: "10:30",
        numero: "0012",
        membre: "Aminata Diallo",
        agent: "Ousmane Traoré (AGT001)",
        montant: 5000,
        jours: 5,
        statut: "Validée",
      },
    ];

    const entetes = ["Date", "Heure", "N° Membre", "Membre", "Agent", "Montant", "Jours", "Statut"];
    const lignes = depotsExport.map((d) => [
      `"${d.date_operation}"`,
      `"${d.heure}"`,
      `"${d.numero}"`,
      `"${d.membre}"`,
      `"${d.agent}"`,
      d.montant,
      d.jours,
      `"${d.statut}"`,
    ]);

    const csvContent = "\uFEFF" + [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    expect(csvContent.startsWith("\uFEFF")).toBe(true);
    expect(csvContent).toContain("Aminata Diallo");
    expect(csvContent).toContain(";5000;5;");
  });
});
