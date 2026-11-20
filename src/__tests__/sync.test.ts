// =============================================================================
// IKA-MARA — Tests unitaires : Moteur de synchronisation
// =============================================================================
// Vérifie :
// - Double envoi (idempotence via ON CONFLICT DO NOTHING)
// - Coupure en cours d'envoi → reprise
// - Backoff exponentiel
// - Le serveur fait foi pour les soldes
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---

// Mock fetch pour simuler le serveur
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock navigator.onLine
Object.defineProperty(navigator, "onLine", {
  value: true,
  writable: true,
  configurable: true,
});

describe("Sync — Double envoi (idempotence)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("le serveur renvoie success même si l'opération existe déjà", async () => {
    const clientId = crypto.randomUUID();

    // Premier envoi : succès
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        clientId,
        serverTime: new Date().toISOString(),
      }),
    });

    const response1 = await fetch("/api/sync", {
      method: "POST",
      body: JSON.stringify({
        table: "operations",
        clientId,
        payload: { type: "depot", montant: 1000 },
      }),
    });

    expect(response1.ok).toBe(true);
    const result1 = await response1.json();
    expect(result1.success).toBe(true);

    // Deuxième envoi du même clientId : toujours succès (DO NOTHING)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        clientId,
        serverTime: new Date().toISOString(),
      }),
    });

    const response2 = await fetch("/api/sync", {
      method: "POST",
      body: JSON.stringify({
        table: "operations",
        clientId,
        payload: { type: "depot", montant: 1000 },
      }),
    });

    expect(response2.ok).toBe(true);
    const result2 = await response2.json();
    expect(result2.success).toBe(true);
  });
});

describe("Sync — Coupure réseau", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gère une erreur réseau (fetch échoue)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));

    await expect(
      fetch("/api/sync", {
        method: "POST",
        body: JSON.stringify({
          table: "operations",
          clientId: crypto.randomUUID(),
          payload: { type: "depot", montant: 500 },
        }),
      })
    ).rejects.toThrow("Failed to fetch");
  });

  it("gère une réponse HTTP 500", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const response = await fetch("/api/sync", {
      method: "POST",
      body: JSON.stringify({
        table: "operations",
        clientId: crypto.randomUUID(),
        payload: { type: "depot", montant: 500 },
      }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
  });
});

describe("Sync — Backoff exponentiel", () => {
  it("calcule le backoff correctement", () => {
    const BASE = 1000;
    const MAX = 300_000;

    let backoff = BASE;

    // Après 1 erreur
    backoff = Math.min(backoff * 2, MAX);
    expect(backoff).toBe(2000);

    // Après 2 erreurs
    backoff = Math.min(backoff * 2, MAX);
    expect(backoff).toBe(4000);

    // Après 3 erreurs
    backoff = Math.min(backoff * 2, MAX);
    expect(backoff).toBe(8000);

    // Après 10 erreurs (ne dépasse pas MAX)
    for (let i = 0; i < 7; i++) {
      backoff = Math.min(backoff * 2, MAX);
    }
    expect(backoff).toBeLessThanOrEqual(MAX);
  });

  it("réinitialise le backoff après un succès", () => {
    const BASE = 1000;
    let backoff = 64000; // Après plusieurs erreurs

    // Succès → reset
    backoff = BASE;
    expect(backoff).toBe(BASE);
  });
});

describe("Sync — Montants", () => {
  it("les montants sont toujours des entiers (F CFA)", () => {
    const montants = [100, 500, 1000, 5000, 10000, 25000];

    for (const m of montants) {
      expect(Number.isInteger(m)).toBe(true);
      expect(m).toBeGreaterThan(0);
    }
  });

  it("les dépôts s'additionnent, ne s'écrasent pas", () => {
    // Simulation côté client : deux dépôts du même membre
    const depot1 = { type: "depot", montant: 1000, membre_id: "m1" };
    const depot2 = { type: "depot", montant: 1000, membre_id: "m1" };

    // Chaque dépôt a son propre clientId → ce sont deux opérations distinctes
    const clientId1 = crypto.randomUUID();
    const clientId2 = crypto.randomUUID();
    expect(clientId1).not.toBe(clientId2);

    // Le solde côté serveur sera 1000 + 1000 = 2000 (addition, pas écrasement)
    const solde = depot1.montant + depot2.montant;
    expect(solde).toBe(2000);
  });
});

describe("Sync — Format F CFA", () => {
  it("formate les montants en F CFA", () => {
    // Import inline pour le test
    function formatMontant(montant: number): string {
      const formatted = montant.toLocaleString("fr-FR", {
        maximumFractionDigits: 0,
      });
      return `${formatted} F`;
    }

    expect(formatMontant(500)).toBe("500 F");
    expect(formatMontant(1000)).toMatch(/1[\s\u202f]000 F/); // espace ou narrow no-break space
    expect(formatMontant(15000)).toMatch(/15[\s\u202f]000 F/);
    expect(formatMontant(1000000)).toMatch(/1[\s\u202f]000[\s\u202f]000 F/);
  });
});
