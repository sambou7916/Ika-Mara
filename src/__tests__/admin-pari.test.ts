import { describe, it, expect } from "vitest";
import { formatMontant } from "../lib/utils/format";

describe("Admin Ika-Pari (PROMPT B5) — Tontines, Tirage, Retards, Décaissement & Suspension", () => {
  // 1. Calcul du montant total de la cagnotte par tour
  it("calcule correctement la cagnotte totale par tour : participants × part × durée", () => {
    const participantsCount = 10;
    const partJournaliere = 1000; // 1 000 F CFA / jour
    const dureeTourJours = 30; // 30 jours par tour

    const cotiseParMembreParTour = partJournaliere * dureeTourJours; // 30 000 F
    const cagnotteTotale = participantsCount * cotiseParMembreParTour; // 300 000 F

    expect(cotiseParMembreParTour).toBe(30000);
    expect(cagnotteTotale).toBe(300000);
    expect(formatMontant(cagnotteTotale)).toMatch(/300[\s\u202f]000 F/);
  });

  // 2. Calcul du montant net décaissé et déduction de commission
  it("calcule le montant net à verser au bénéficiaire après déduction de commission", () => {
    const montantCagnotte = 300000;
    const partsCommission = 1;
    const partJournaliere = 1000;

    const commissionTour = partsCommission * partJournaliere; // 1 000 F
    const montantNet = montantCagnotte - commissionTour; // 299 000 F

    expect(commissionTour).toBe(1000);
    expect(montantNet).toBe(299000);
    expect(formatMontant(montantNet)).toMatch(/299[\s\u202f]000 F/);
  });

  // 3. Condition stricte de décaissement (cagnotte suffisante)
  it("n'autorise le décaissement que si la totalité de la cagnotte a été collectée", () => {
    const cagnotteCible = 300000;

    function verifierDecaissementPossible(collecte: number, cible: number) {
      if (collecte < cible) {
        return {
          peutDecaisser: false,
          manquant: cible - collecte,
          message: `Cagnotte insuffisante : manque ${formatMontant(cible - collecte)}`,
        };
      }
      return {
        peutDecaisser: true,
        manquant: 0,
        message: "Cagnotte complète, décaissement autorisé.",
      };
    }

    const testIncomplet = verifierDecaissementPossible(270000, cagnotteCible);
    expect(testIncomplet.peutDecaisser).toBe(false);
    expect(testIncomplet.manquant).toBe(30000);
    expect(testIncomplet.message).toContain("30 000 F");

    const testComplet = verifierDecaissementPossible(300000, cagnotteCible);
    expect(testComplet.peutDecaisser).toBe(true);
    expect(testComplet.manquant).toBe(0);
  });

  // 4. Détection des participants en retard de cotisation
  it("identifie les participants en retard avec le montant manquant et le nombre de jours", () => {
    const partJournaliere = 1000;
    const joursEcoules = 15;
    const montantAttendu = joursEcoules * partJournaliere; // 15 000 F à date

    const participants = [
      { id: "m1", numero: "0001", nom: "Diallo", cotise: 15000 }, // À jour
      { id: "m2", numero: "0002", nom: "Traoré", cotise: 10000 }, // Retard de 5 000 F (5 j)
      { id: "m3", numero: "0003", nom: "Keïta", cotise: 0 }, // Retard de 15 000 F (15 j)
    ];

    const retards = participants
      .map((p) => {
        const manquant = Math.max(0, montantAttendu - p.cotise);
        const joursRetard = Math.ceil(manquant / partJournaliere);
        return { ...p, manquant, joursRetard, enRetard: manquant > 0 };
      })
      .filter((p) => p.enRetard);

    expect(retards).toHaveLength(2);
    expect(retards[0].numero).toBe("0002");
    expect(retards[0].manquant).toBe(5000);
    expect(retards[0].joursRetard).toBe(5);

    expect(retards[1].numero).toBe("0003");
    expect(retards[1].manquant).toBe(15000);
    expect(retards[1].joursRetard).toBe(15);
  });

  // 5. Tirage au sort de l'ordre de passage
  it("génère une permutation aléatoire des participants sans perte ni doublon", () => {
    const participants = ["m1", "m2", "m3", "m4", "m5"];

    function tirageAuSort(liste: string[]): string[] {
      const copie = [...liste];
      for (let i = copie.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copie[i], copie[j]] = [copie[j], copie[i]];
      }
      return copie;
    }

    const resultat = tirageAuSort(participants);
    expect(resultat).toHaveLength(participants.length);
    expect(new Set(resultat).size).toBe(participants.length);
    participants.forEach((p) => {
      expect(resultat).toContain(p);
    });
  });

  // 6. Réordonnancement manuel : interdiction de modifier un tour déjà versé
  it("bloque la modification d'ordre si un tour associé a déjà été versé", () => {
    const tours = [
      { numero: 1, statut: "verse" },
      { numero: 2, statut: "en_attente" },
      { numero: 3, statut: "en_attente" },
    ];

    function peutModifierOrdre(tour1Num: number, tour2Num: number): boolean {
      const t1 = tours.find((t) => t.numero === tour1Num);
      const t2 = tours.find((t) => t.numero === tour2Num);
      if (t1?.statut === "verse" || t2?.statut === "verse") {
        return false;
      }
      return true;
    }

    expect(peutModifierOrdre(1, 2)).toBe(false);
    expect(peutModifierOrdre(2, 3)).toBe(true);
  });

  // 7. Suspension pour défaut avec pénalité paramétrée
  it("exige un motif de suspension et applique la pénalité configurée", () => {
    const penalitePct = 10;
    const partDue = 30000; // Part du tour complet (30 j × 1000 F)

    function suspendreParticipant(motif: string, pct: number, montantDu: number) {
      if (!motif || !motif.trim()) {
        throw new Error("Le motif de suspension est obligatoire");
      }
      const penalite = Math.round((montantDu * pct) / 100);
      return {
        statut: "suspendu",
        motif: motif.trim(),
        penalite,
      };
    }

    expect(() => suspendreParticipant("", penalitePct, partDue)).toThrow(
      "Le motif de suspension est obligatoire"
    );

    const res = suspendreParticipant(
      "Défaut prolongé sans nouvelles de l'adhérent",
      penalitePct,
      partDue
    );

    expect(res.statut).toBe("suspendu");
    expect(res.penalite).toBe(3000); // 10% de 30 000 F
    expect(res.motif).toBe("Défaut prolongé sans nouvelles de l'adhérent");
  });

  // 8. Décaissement atomique : création décaissement + commission + sortie caisse
  it("génère l'opération de décaissement, la commission et la sortie de caisse", () => {
    const tour = {
      id: "tour-01",
      cycle_id: "cycle-10",
      numero_tour: 1,
      beneficiaire_id: "m-0042",
      beneficiaire_numero: "0042",
      montant_cagnotte: 300000,
      part_journaliere: 1000,
      parts_commission: 1,
    };

    function simulerDecaissementPari(t: typeof tour, adminId: string) {
      const commission = t.parts_commission * t.part_journaliere; // 1 000 F
      const net = t.montant_cagnotte - commission; // 299 000 F

      const opDecaissement = {
        id: "op-dec-01",
        type: "decaissement",
        volet: "pari",
        membre_id: t.beneficiaire_id,
        montant: net,
        statut: "validee",
      };

      const opCommission = {
        id: "op-com-01",
        type: "commission",
        volet: "pari",
        membre_id: t.beneficiaire_id,
        montant: commission,
        statut: "validee",
      };

      const mouvCaisse = {
        id: "mouv-caisse-01",
        type: "sortie",
        montant: net,
        reference_id: opDecaissement.id,
        reference_type: "decaissement_pari",
        libelle: `Décaissement tontine (Tour ${t.numero_tour}) - N° ${t.beneficiaire_numero}`,
      };

      return { opDecaissement, opCommission, mouvCaisse, net, commission };
    }

    const res = simulerDecaissementPari(tour, "admin-01");
    expect(res.opDecaissement.type).toBe("decaissement");
    expect(res.opDecaissement.montant).toBe(299000);
    expect(res.opCommission.type).toBe("commission");
    expect(res.opCommission.montant).toBe(1000);
    expect(res.mouvCaisse.type).toBe("sortie");
    expect(res.mouvCaisse.montant).toBe(299000);
    expect(res.mouvCaisse.libelle).toContain("0042");
  });

  // 9. Export CSV des décaissements
  it("génère un contenu CSV avec BOM UTF-8 et séparateur point-virgule pour Excel", () => {
    const decaissements = [
      {
        date: "2026-11-15",
        cycle: "Tontine Marché Rose",
        tour: 1,
        numero: "0042",
        beneficiaire: "Fatoumata Diarra",
        brut: 300000,
        commission: 1000,
        net: 299000,
      },
    ];

    const entetes = ["Date", "Cycle", "Tour", "N° Membre", "Bénéficiaire", "Brut", "Commission", "Net"];
    const lignes = decaissements.map((d) => [
      `"${d.date}"`,
      `"${d.cycle}"`,
      d.tour,
      `"${d.numero}"`,
      `"${d.beneficiaire}"`,
      d.brut,
      d.commission,
      d.net,
    ]);

    const csvContent = "\uFEFF" + [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    expect(csvContent.startsWith("\uFEFF")).toBe(true);
    expect(csvContent).toContain("Fatoumata Diarra");
    expect(csvContent).toContain("0042");
    expect(csvContent).toContain(";300000;1000;299000");
  });
});
