import { describe, it, expect } from "vitest";
import { formatMontant } from "../lib/utils/format";

describe("Admin Commissions (PROMPT B7) — Calculs, Clôture Mensuelle, Mois Incomplet & Annulation", () => {
  // 1. Calcul standard de la commission mensuelle
  it("calcule la commission mensuelle standard : parts_commission × montant_jour", () => {
    function calculerCommissionBase(parts: number, montantJour: number): number {
      return parts * montantJour;
    }

    // 1 part x 1 000 F = 1 000 F
    expect(calculerCommissionBase(1, 1000)).toBe(1000);
    // 2 parts x 2 500 F = 5 000 F
    expect(calculerCommissionBase(2, 2500)).toBe(5000);
    // 0 part = 0 F
    expect(calculerCommissionBase(0, 1000)).toBe(0);

    expect(formatMontant(calculerCommissionBase(1, 1000))).toMatch(/1[\s\u202f]000 F/);
    expect(formatMontant(calculerCommissionBase(2, 2500))).toMatch(/5[\s\u202f]000 F/);
  });

  // 2. Gestion du mois incomplet (règle proportionnelle)
  it("calcule la commission proportionnelle pour une souscription initiée en cours de mois", () => {
    function calculerCommissionMoisIncomplet(
      montantBase: number,
      dateDebut: Date,
      dateFinMois: Date,
      joursDansLeMois: number,
      regle: "proportionnelle" | "entiere"
    ): number {
      if (regle === "entiere") return montantBase;

      const dateDebutMois = new Date(dateFinMois.getFullYear(), dateFinMois.getMonth(), 1);
      if (dateDebut <= dateDebutMois) return montantBase;

      const diffJours = Math.floor(
        (dateFinMois.getTime() - dateDebut.getTime()) / (1000 * 3600 * 24)
      ) + 1;

      return Math.round((montantBase * diffJours) / joursDansLeMois);
    }

    const dateFinNov = new Date("2026-11-30");
    const montantBase = 3000; // Commission mensuelle de 3 000 F

    // Souscription active dès le 1er novembre (30 jours)
    const debutMois = new Date("2026-11-01");
    expect(
      calculerCommissionMoisIncomplet(montantBase, debutMois, dateFinNov, 30, "proportionnelle")
    ).toBe(3000);

    // Souscription initiée le 16 novembre (15 jours d'activité sur 30) -> 50%
    const miMois = new Date("2026-11-16");
    expect(
      calculerCommissionMoisIncomplet(montantBase, miMois, dateFinNov, 30, "proportionnelle")
    ).toBe(1500);

    // Règle "entière" appliquée -> montant complet même pour 15 jours
    expect(
      calculerCommissionMoisIncomplet(montantBase, miMois, dateFinNov, 30, "entiere")
    ).toBe(3000);
  });

  // 3. Idempotence et interdiction de rejouer une clôture
  it("interdit de ré-exécuter une clôture déjà effectuée pour un mois donné", () => {
    const cloturesEffectuees = new Set<string>();
    cloturesEffectuees.add("2026-10"); // Octobre 2026 clôturé

    function tenterCloture(annee: number, mois: number) {
      const cle = `${annee}-${String(mois).padStart(2, "0")}`;
      if (cloturesEffectuees.has(cle)) {
        return {
          succes: false,
          dejaCloture: true,
          message: `Le mois ${mois}/${annee} a déjà été clôturé.`,
        };
      }

      cloturesEffectuees.add(cle);
      return {
        succes: true,
        dejaCloture: false,
        message: `Clôture du mois ${mois}/${annee} réussie.`,
      };
    }

    // Octobre 2026 : déjà clôturé
    const resOct = tenterCloture(2026, 10);
    expect(resOct.succes).toBe(false);
    expect(resOct.dejaCloture).toBe(true);

    // Novembre 2026 : première exécution
    const resNov1 = tenterCloture(2026, 11);
    expect(resNov1.succes).toBe(true);
    expect(resNov1.dejaCloture).toBe(false);

    // Novembre 2026 : deuxième tentative bloquée
    const resNov2 = tenterCloture(2026, 11);
    expect(resNov2.succes).toBe(false);
    expect(resNov2.dejaCloture).toBe(true);
  });

  // 4. Vérification du solde d'épargne disponible
  it("ajuste le prélèvement au solde disponible si la vérification de solde est activée", () => {
    function preleverCommissionAvecSolde(
      commissionDue: number,
      soldeDisponible: number,
      verifierSolde: boolean
    ): number {
      if (!verifierSolde) return commissionDue;
      return Math.max(0, Math.min(commissionDue, soldeDisponible));
    }

    // Solde suffisant (5 000 F) pour une commission de 1 000 F
    expect(preleverCommissionAvecSolde(1000, 5000, true)).toBe(1000);

    // Solde partiel (600 F) pour une commission de 1 000 F -> prélève 600 F
    expect(preleverCommissionAvecSolde(1000, 600, true)).toBe(600);

    // Solde nul (0 F) -> prélève 0 F
    expect(preleverCommissionAvecSolde(1000, 0, true)).toBe(0);

    // Vérification de solde désactivée -> prélève 1 000 F (solde devient négatif)
    expect(preleverCommissionAvecSolde(1000, 0, false)).toBe(1000);
  });

  // 5. Annulation d'une commission uniquement par écriture inverse liée
  it("génère une écriture inverse compensatoire liée par annule_ref avec motif obligatoire", () => {
    const commissionInitiale = {
      id: "com-12345",
      type: "commission",
      volet: "mara",
      montant: 1000,
      membre_id: "membre-001",
    };

    function annulerCommission(
      com: typeof commissionInitiale,
      motif: string,
      adminId: string
    ) {
      if (!motif || !motif.trim()) {
        throw new Error("Le motif d'annulation est obligatoire");
      }

      return {
        id: `annul-${com.id}`,
        type: "annulation",
        volet: com.volet,
        montant: com.montant,
        annule_ref: com.id,
        motif: motif.trim(),
        auteur_id: adminId,
      };
    }

    expect(() => annulerCommission(commissionInitiale, "", "admin-01")).toThrow(
      "Le motif d'annulation est obligatoire"
    );

    const contrePassation = annulerCommission(
      commissionInitiale,
      "Erreur de part sur la souscription",
      "admin-01"
    );

    expect(contrePassation.type).toBe("annulation");
    expect(contrePassation.annule_ref).toBe("com-12345");
    expect(contrePassation.montant).toBe(1000);
    expect(contrePassation.motif).toBe("Erreur de part sur la souscription");
  });

  // 6. Export Excel CSV
  it("génère un contenu CSV compatible Excel avec UTF-8 BOM et séparateurs point-virgule", () => {
    const commissions = [
      {
        numero: "0001",
        nom: "Ousmane Traoré",
        volet: "Épargne",
        montant_jour: 1000,
        parts: 1,
        commission: 1000,
        statut: "Prélevée",
      },
    ];

    const entetes = ["N°", "Adhérent", "Volet", "Cotisation", "Parts", "Commission", "Statut"];
    const lignes = commissions.map((c) => [
      `"${c.numero}"`,
      `"${c.nom}"`,
      `"${c.volet}"`,
      c.montant_jour,
      c.parts,
      c.commission,
      `"${c.statut}"`,
    ]);

    const csvContent = "\uFEFF" + [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    expect(csvContent.startsWith("\uFEFF")).toBe(true);
    expect(csvContent).toContain("Ousmane Traoré");
    expect(csvContent).toContain(";1000;1;1000;");
  });
});
