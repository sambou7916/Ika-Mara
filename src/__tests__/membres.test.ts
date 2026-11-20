// =============================================================================
// IKA-MARA — Tests unitaires : Liste & Recherche des Membres (/agent/membres)
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db/dexie";
import type { Membre } from "@/lib/types";

function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

describe("Membres Agent — Recherche locale et Normalisation", () => {
  beforeEach(async () => {
    await db.membres.clear();
  });

  it("normalise correctement les textes avec accents (NFD)", () => {
    expect(normalizeText("Modibo Keïta")).toBe("modibo keita");
    expect(normalizeText("Fatoumata Sangaré")).toBe("fatoumata sangare");
    expect(normalizeText("Djénéba")).toBe("djeneba");
    expect(normalizeText("Aïssata")).toBe("aissata");
  });

  it("trouve un membre par préfixe de numéro ou numéro complet", async () => {
    const membres: Membre[] = [
      {
        id: "m-1",
        numero: "0001",
        nom: "Diarra",
        prenom: "Amadou",
        profession: "Boutiquier",
        telephone: "+22370000001",
        quartier: "Hamdallaye",
        agent_id: "agent-1",
        statut: "actif",
        cree_le: new Date().toISOString(),
        modifie_le: new Date().toISOString(),
      },
      {
        id: "m-2",
        numero: "0042",
        nom: "Keïta",
        prenom: "Modibo",
        profession: "Tailleur",
        telephone: "+22370000042",
        quartier: "Badalabougou",
        agent_id: "agent-1",
        statut: "actif",
        cree_le: new Date().toISOString(),
        modifie_le: new Date().toISOString(),
      },
    ];

    await db.membres.bulkAdd(membres);

    // Recherche par préfixe "00" -> trouve les deux
    const q1 = "00";
    const res1 = (await db.membres.toArray()).filter((m) =>
      m.numero.startsWith(q1)
    );
    expect(res1.length).toBe(2);

    // Recherche par numéro complet "0042" -> trouve Modibo
    const q2 = "0042";
    const res2 = (await db.membres.toArray()).filter(
      (m) => m.numero === q2 || m.numero.startsWith(q2)
    );
    expect(res2.length).toBe(1);
    expect(res2[0].nom).toBe("Keïta");
  });

  it("trouve un membre même si la recherche ne contient pas les accents", async () => {
    const m: Membre = {
      id: "m-keita",
      numero: "0015",
      nom: "Keïta",
      prenom: "Sékou",
      profession: "Enseignant",
      telephone: "+22370000015",
      quartier: "Lafiabougou",
      agent_id: "agent-1",
      statut: "actif",
      cree_le: new Date().toISOString(),
      modifie_le: new Date().toISOString(),
    };
    await db.membres.add(m);

    // L'utilisateur tape "sekou keita" sans accents
    const q = normalizeText("sekou keita");
    const all = await db.membres.toArray();

    const matches = all.filter((membre) => {
      const full = normalizeText(`${membre.prenom} ${membre.nom}`);
      return full.includes(q);
    });

    expect(matches.length).toBe(1);
    expect(matches[0].numero).toBe("0015");
  });

  it("trie les membres avec retards en tête de liste", () => {
    const liste = [
      { numero: "0001", nom: "A", joursRetard: 0 },
      { numero: "0002", nom: "B", joursRetard: 3 },
      { numero: "0003", nom: "C", joursRetard: 5 },
      { numero: "0004", nom: "D", joursRetard: 1 },
    ];

    // Tri retards d'abord (du plus grand retard au plus petit)
    liste.sort((a, b) => {
      if (b.joursRetard !== a.joursRetard) {
        return b.joursRetard - a.joursRetard;
      }
      return a.numero.localeCompare(b.numero);
    });

    expect(liste[0].numero).toBe("0003"); // 5 jours
    expect(liste[1].numero).toBe("0002"); // 3 jours
    expect(liste[2].numero).toBe("0004"); // 1 jour
    expect(liste[3].numero).toBe("0001"); // 0 jour (à jour)
  });
});
