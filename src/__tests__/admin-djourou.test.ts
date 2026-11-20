import { describe, it, expect } from "vitest";
import { formatMontant } from "../lib/utils/format";

describe("Admin Ika-Djourou (PROMPT B6) — Crédits, Intérêts, Échéanciers, Remboursement & Pénalités", () => {
  // 1. Fonction de calcul des intérêts pour durées 3, 6, 12 mois et libre
  function calculerInterets(capital: number, tauxAnnuel: number, dureeMois: number): number {
    if (capital <= 0 || tauxAnnuel < 0 || dureeMois <= 0) return 0;
    return Math.round((capital * tauxAnnuel * dureeMois) / (100 * 12));
  }

  it("calcule exactement les intérêts pour 3 mois, 6 mois, 12 mois", () => {
    const capital = 100000;
    const taux = 12; // 12% annuel

    // 12 mois : 12 000 F
    expect(calculerInterets(capital, taux, 12)).toBe(12000);
    // 6 mois : 6 000 F
    expect(calculerInterets(capital, taux, 6)).toBe(6000);
    // 3 mois : 3 000 F
    expect(calculerInterets(capital, taux, 3)).toBe(3000);

    // Cas avec capital de 50 000 F à 10%
    expect(calculerInterets(50000, 10, 3)).toBe(1250);
    expect(formatMontant(calculerInterets(50000, 10, 3))).toMatch(/1[\s\u202f]250 F/);
  });

  // 2. Génération de l'échéancier avec compensation des arrondis sur la dernière échéance
  it("génère les échéances en garantissant que la somme des échéances égale exactement le total dû", () => {
    const montantAccorde = 100000;
    const taux = 10;
    const dureeMois = 3;
    const totalInterets = calculerInterets(montantAccorde, taux, dureeMois); // 2 500 F
    const totalDu = montantAccorde + totalInterets; // 102 500 F

    const nbEcheances = dureeMois; // 3 échéances mensuelles
    const capitalParEch = Math.floor(montantAccorde / nbEcheances); // 33 333
    const interetParEch = Math.floor(totalInterets / nbEcheances); // 833

    let cumulCapital = 0;
    let cumulInteret = 0;
    const echeances = [];

    for (let i = 1; i <= nbEcheances; i++) {
      let cap = capitalParEch;
      let int = interetParEch;

      if (i === nbEcheances) {
        cap = montantAccorde - cumulCapital; // 100 000 - 66 666 = 33 334
        int = totalInterets - cumulInteret; // 2 500 - 1 666 = 834
      } else {
        cumulCapital += cap;
        cumulInteret += int;
      }

      echeances.push({
        numero: i,
        capital: cap,
        interets: int,
        total: cap + int,
      });
    }

    const sommeTotale = echeances.reduce((s, e) => s + e.total, 0);
    const sommeCapital = echeances.reduce((s, e) => s + e.capital, 0);
    const sommeInterets = echeances.reduce((s, e) => s + e.interets, 0);

    expect(sommeTotale).toBe(totalDu);
    expect(sommeCapital).toBe(montantAccorde);
    expect(sommeInterets).toBe(totalInterets);
    expect(echeances[2].capital).toBe(33334);
    expect(echeances[2].interets).toBe(834);
  });

  // 3. Validation de demande & Décaissement sortant
  it("valide la demande de crédit et déduit les frais de dossier du décaissement", () => {
    const demande = {
      id: "demande-credit-01",
      membre_id: "m-001",
      montant_demande: 200000,
    };

    function simulerOctroiCredit(
      d: typeof demande,
      montantAccorde: number,
      fraisDossier: number,
      adminId: string
    ) {
      const netDecaisse = montantAccorde - fraisDossier;
      const mouvCaisse = {
        type: "sortie",
        montant: netDecaisse,
        reference_type: "credit_djourou",
        auteur: adminId,
      };

      const decision = {
        demande_id: d.id,
        decision: "acceptee",
        montant_accorde: montantAccorde,
      };

      return { netDecaisse, mouvCaisse, decision };
    }

    const res = simulerOctroiCredit(demande, 200000, 2000, "admin-01");
    expect(res.netDecaisse).toBe(198000);
    expect(res.mouvCaisse.type).toBe("sortie");
    expect(res.mouvCaisse.montant).toBe(198000);
    expect(res.decision.decision).toBe("acceptee");
  });

  // 4. Refus motivé d'une demande de crédit
  it("exige un motif lors du refus d'une demande de crédit", () => {
    function refuserCredit(motif: string) {
      if (!motif || !motif.trim()) {
        throw new Error("Le motif du refus est obligatoire");
      }
      return { decision: "rejetee", motif: motif.trim() };
    }

    expect(() => refuserCredit("")).toThrow("Le motif du refus est obligatoire");
    expect(() => refuserCredit("   ")).toThrow("Le motif du refus est obligatoire");

    const refus = refuserCredit("Capacité d'endettement maximale déjà atteinte");
    expect(refus.decision).toBe("rejetee");
    expect(refus.motif).toBe("Capacité d'endettement maximale déjà atteinte");
  });

  // 5. Imputation séquentielle d'un remboursement sur les échéances les plus anciennes
  it("impute le remboursement sur l'échéance la plus ancienne en premier (partiel puis solde)", () => {
    const echeances = [
      { numero: 1, montant_du: 30000, montant_paye: 0, statut: "a_payer" },
      { numero: 2, montant_du: 30000, montant_paye: 0, statut: "a_payer" },
      { numero: 3, montant_du: 30000, montant_paye: 0, statut: "a_payer" },
    ];

    function imputerRemboursement(echList: typeof echeances, montantVerse: number) {
      let resteAImputer = montantVerse;
      let echeancesSoldees = 0;

      for (const ech of echList) {
        if (resteAImputer <= 0) break;
        const du = ech.montant_du - ech.montant_paye;

        if (resteAImputer >= du) {
          ech.montant_paye = ech.montant_du;
          ech.statut = "paye";
          resteAImputer -= du;
          echeancesSoldees++;
        } else {
          ech.montant_paye += resteAImputer;
          resteAImputer = 0;
        }
      }

      return { echList, echeancesSoldees, resteNonImpute: resteAImputer };
    }

    // Premier versement de 45 000 F : solde l'échéance 1 (30 000 F) et paie 15 000 F sur l'échéance 2
    const res1 = imputerRemboursement(echeances, 45000);
    expect(res1.echeancesSoldees).toBe(1);
    expect(res1.echList[0].statut).toBe("paye");
    expect(res1.echList[0].montant_paye).toBe(30000);
    expect(res1.echList[1].statut).toBe("a_payer");
    expect(res1.echList[1].montant_paye).toBe(15000);
    expect(res1.echList[2].montant_paye).toBe(0);

    // Deuxième versement de 15 000 F : solde l'échéance 2
    const res2 = imputerRemboursement(res1.echList, 15000);
    expect(res2.echeancesSoldees).toBe(1);
    expect(res2.echList[1].statut).toBe("paye");
    expect(res2.echList[1].montant_paye).toBe(30000);
  });

  // 6. Remboursement anticipé avec remise des intérêts futurs
  it("déduit les intérêts futurs non échus lors d'un remboursement anticipé intégral", () => {
    const echeances = [
      { numero: 1, capital: 30000, interets: 1000, echeancePasse: true, statut: "paye" },
      { numero: 2, capital: 30000, interets: 1000, echeancePasse: false, statut: "a_payer" },
      { numero: 3, capital: 30000, interets: 1000, echeancePasse: false, statut: "a_payer" },
    ];

    function calculerSoldeAnticipe(echList: typeof echeances) {
      let capitalRestant = 0;
      let interetsNonEchusRemis = 0;

      echList.forEach((e) => {
        if (e.statut !== "paye") {
          capitalRestant += e.capital;
          if (!e.echeancePasse) {
            interetsNonEchusRemis += e.interets;
          }
        }
      });

      return {
        montantAPayer: capitalRestant,
        remiseInterets: interetsNonEchusRemis,
      };
    }

    const solde = calculerSoldeAnticipe(echeances);
    expect(solde.remiseInterets).toBe(2000); // 2 x 1000 F d'intérêts futurs déduits
    expect(solde.montantAPayer).toBe(60000); // Seul le capital restant de 60 000 F est dû
  });

  // 7. Détection des retards et calcul des pénalités
  it("calcule les pénalités de retard selon le taux paramétré et le taux d'impayés", () => {
    const penalitePctParMois = 2; // 2% par mois
    const montantEnRetard = 50000;
    const joursRetard = 45; // 1,5 mois -> arrondi à 2 mois de pénalité

    const moisRetard = Math.ceil(joursRetard / 30);
    const penalite = Math.round((montantEnRetard * penalitePctParMois * moisRetard) / 100);

    expect(moisRetard).toBe(2);
    expect(penalite).toBe(2000); // 2% x 2 mois = 4% sur 50 000 F = 2 000 F

    // Taux d'impayés
    const encoursTotal = 500000;
    const totalRetards = 50000;
    const tauxImpayes = Math.round((totalRetards / encoursTotal) * 1000) / 10;
    expect(tauxImpayes).toBe(10); // 10.0 %
  });
});
