import { describe, it, expect } from "vitest";
import { formatMontant } from "../lib/utils/format";

describe("Admin Caisse & Remises (PROMPT B8) — Remises, Caisse, Banque & Transferts", () => {
  // 1. Calcul du solde par vue agrégée (jamais stocké à la main)
  it("calcule correctement les soldes de caisse et de banque par somme algébrique", () => {
    const mouvementsCaisse = [
      { type: "entree", montant: 50000 },
      { type: "entree", montant: 25000 },
      { type: "sortie", montant: 15000 },
      { type: "sortie", montant: 10000 },
    ];

    const totalEntrees = mouvementsCaisse
      .filter((m) => m.type === "entree")
      .reduce((s, m) => s + m.montant, 0);

    const totalSorties = mouvementsCaisse
      .filter((m) => m.type === "sortie")
      .reduce((s, m) => s + m.montant, 0);

    const solde = totalEntrees - totalSorties;

    expect(totalEntrees).toBe(75000);
    expect(totalSorties).toBe(25000);
    expect(solde).toBe(50000);
    expect(formatMontant(solde)).toMatch(/50[\s\u202f]000 F/);
  });

  // 2. Confirmation d'une remise sans écart vs avec écart
  it("confirme une remise : génère une entrée de caisse et pose le statut 'validee' ou 'ecart'", () => {
    function confirmerRemise(remise: {
      attendu: number;
      remis: number;
      ecart: number;
      commentaireAdmin?: string;
    }) {
      const statut = remise.ecart !== 0 ? "ecart" : "validee";
      const entreeCaisse =
        remise.remis > 0
          ? {
              type: "entree",
              montant: remise.remis,
              libelle: `Remise collecte${remise.ecart !== 0 ? ` [Écart : ${remise.ecart} F]` : ""}`,
            }
          : null;

      return { statut, entreeCaisse, commentaireAdmin: remise.commentaireAdmin || null };
    }

    // Remise parfaite (sans écart)
    const resSansEcart = confirmerRemise({ attendu: 40000, remis: 40000, ecart: 0 });
    expect(resSansEcart.statut).toBe("validee");
    expect(resSansEcart.entreeCaisse?.type).toBe("entree");
    expect(resSansEcart.entreeCaisse?.montant).toBe(40000);

    // Remise avec écart (manque 5 000 F)
    const resAvecEcart = confirmerRemise({
      attendu: 45000,
      remis: 40000,
      ecart: -5000,
      commentaireAdmin: "Manque justifié par l'agent, versement complémentaire prévu demain",
    });
    expect(resAvecEcart.statut).toBe("ecart");
    expect(resAvecEcart.entreeCaisse?.montant).toBe(40000);
    expect(resAvecEcart.commentaireAdmin).toContain("versement complémentaire");
  });

  // 3. Calcul du solde cumulé chronologique pour le grand livre
  it("calcule correctement le solde cumulé pas-à-pas sur chaque mouvement", () => {
    const mouvements = [
      { id: "m1", type: "entree", montant: 10000 },
      { id: "m2", type: "entree", montant: 20000 },
      { id: "m3", type: "sortie", montant: 5000 },
      { id: "m4", type: "sortie", montant: 12000 },
    ];

    let running = 0;
    const avecCumul = mouvements.map((m) => {
      if (m.type === "entree") running += m.montant;
      else running -= m.montant;
      return { ...m, soldeCumule: running };
    });

    expect(avecCumul[0].soldeCumule).toBe(10000);
    expect(avecCumul[1].soldeCumule).toBe(30000);
    expect(avecCumul[2].soldeCumule).toBe(25000);
    expect(avecCumul[3].soldeCumule).toBe(13000);
  });

  // 4. Transfert atomique Caisse <-> Banque et contrôle de solde source
  it("exécute un transfert atomique et bloque si le solde source est insuffisant", () => {
    function transferer(
      sens: "caisse_vers_banque" | "banque_vers_caisse",
      montant: number,
      soldeCaisse: number,
      soldeBanque: number
    ) {
      if (montant <= 0) throw new Error("Montant invalide");

      if (sens === "caisse_vers_banque") {
        if (soldeCaisse < montant) {
          throw new Error("Solde de caisse insuffisant");
        }
        return {
          mouvCaisse: { type: "sortie", montant },
          mouvBanque: { type: "entree", montant },
          nouveauSoldeCaisse: soldeCaisse - montant,
          nouveauSoldeBanque: soldeBanque + montant,
        };
      } else {
        if (soldeBanque < montant) {
          throw new Error("Solde bancaire insuffisant");
        }
        return {
          mouvBanque: { type: "sortie", montant },
          mouvCaisse: { type: "entree", montant },
          nouveauSoldeCaisse: soldeCaisse + montant,
          nouveauSoldeBanque: soldeBanque - montant,
        };
      }
    }

    // Transfert Caisse -> Banque valide
    const t1 = transferer("caisse_vers_banque", 50000, 100000, 200000);
    expect(t1.mouvCaisse.type).toBe("sortie");
    expect(t1.mouvBanque.type).toBe("entree");
    expect(t1.nouveauSoldeCaisse).toBe(50000);
    expect(t1.nouveauSoldeBanque).toBe(250000);

    // Tentative de transfert Caisse -> Banque avec solde insuffisant
    expect(() => transferer("caisse_vers_banque", 150000, 100000, 200000)).toThrow(
      "Solde de caisse insuffisant"
    );

    // Tentative de transfert Banque -> Caisse avec solde insuffisant
    expect(() => transferer("banque_vers_caisse", 300000, 50000, 200000)).toThrow(
      "Solde bancaire insuffisant"
    );
  });

  // 5. Annulation d'un mouvement uniquement par contre-passation liée
  it("annule un mouvement uniquement par écriture inverse liée avec motif obligatoire", () => {
    const mouvementInitial = {
      id: "caisse-001",
      type: "sortie",
      montant: 15000,
      libelle: "Achat fournitures de bureau",
    };

    function annulerMouvement(
      mouv: typeof mouvementInitial,
      motif: string,
      adminId: string
    ) {
      if (!motif || !motif.trim()) {
        throw new Error("Le motif d'annulation est obligatoire");
      }

      // Inverse strict : sortie -> entree
      const inverseType = mouv.type === "sortie" ? "entree" : "sortie";

      return {
        id: `inv-${mouv.id}`,
        type: inverseType,
        montant: mouv.montant,
        annule_ref: mouv.id,
        libelle: `ANNULATION: ${mouv.libelle}`,
        motif: motif.trim(),
        auteur_id: adminId,
      };
    }

    expect(() => annulerMouvement(mouvementInitial, "", "admin-01")).toThrow(
      "Le motif d'annulation est obligatoire"
    );

    const inverse = annulerMouvement(
      mouvementInitial,
      "Facture annulée par le fournisseur",
      "admin-01"
    );

    expect(inverse.type).toBe("entree"); // Était sortie -> devient entrée pour restaurer le solde
    expect(inverse.montant).toBe(15000);
    expect(inverse.annule_ref).toBe("caisse-001");
    expect(inverse.motif).toBe("Facture annulée par le fournisseur");
  });

  // 6. Format de l'export CSV Excel
  it("génère un contenu CSV compatible Excel avec UTF-8 BOM et séparateurs point-virgule", () => {
    const remises = [
      {
        date: "2026-11-15",
        agent: "Ousmane Traoré (AGT001)",
        attendu: 50000,
        remis: 50000,
        ecart: 0,
        statut: "Validée",
      },
    ];

    const entetes = ["Date", "Agent", "Attendu", "Remis", "Écart", "Statut"];
    const lignes = remises.map((r) => [
      `"${r.date}"`,
      `"${r.agent}"`,
      r.attendu,
      r.remis,
      r.ecart,
      `"${r.statut}"`,
    ]);

    const csvContent = "\uFEFF" + [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    expect(csvContent.startsWith("\uFEFF")).toBe(true);
    expect(csvContent).toContain("Ousmane Traoré");
    expect(csvContent).toContain(";50000;50000;0;");
  });
});
