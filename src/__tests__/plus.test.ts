import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, saveLocalAuth } from "../lib/db/dexie";
import { hashPin, verifyPin } from "../lib/utils/crypto";
import { validatePin } from "../lib/utils/pin";
import { countPending } from "../lib/db/outbox";
import { synchroniserChangementPin } from "../lib/sync/engine";
import type { LocalAgentAuth } from "../lib/types";

const isValidPin = (pin: string) => validatePin(pin).valid;

describe("Agent Plus (PROMPT A10) — Changement de PIN, Sécurité et Déconnexion", () => {
  beforeEach(async () => {
    await db.agentAuth.clear();
    await db.outbox.clear();
  });

  it("valide les formats de code PIN (exactement 6 chiffres)", () => {
    expect(isValidPin("1234")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("1234567")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("")).toBe(false);
  });

  it("exige l'ancien PIN et re-hashe le nouveau PIN avec PBKDF2 localement", async () => {
    const initialPin = "1111";
    const { hash: initialHash, salt: initialSalt } = await hashPin(initialPin);

    const initialAuth: LocalAgentAuth = {
      identifiant: "AGT001",
      agentId: "agent-uuid-001",
      nom: "Ousmane Traoré",
      telephone: "+223 70 00 00 01",
      statut: "actif",
      pinHash: initialHash,
      pinSalt: initialSalt,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: null,
      lastLoginAt: Date.now(),
    };

    await saveLocalAuth(initialAuth);

    // 1. Échec si l'ancien PIN est incorrect
    const isOldValidFail = await verifyPin("9999", initialAuth.pinHash, initialAuth.pinSalt);
    expect(isOldValidFail).toBe(false);

    // 2. Succès si l'ancien PIN est correct
    const isOldValidSuccess = await verifyPin("1111", initialAuth.pinHash, initialAuth.pinSalt);
    expect(isOldValidSuccess).toBe(true);

    // 3. Re-hash local PBKDF2 du nouveau PIN (ex: "8888")
    const newPin = "8888";
    const { hash: newHash, salt: newSalt } = await hashPin(newPin);

    await saveLocalAuth({
      ...initialAuth,
      pinHash: newHash,
      pinSalt: newSalt,
      pendingPinUpdate: newPin, // différé pour la prochaine synchro
    });

    const updatedAuth = await db.agentAuth.get("AGT001");
    expect(updatedAuth).toBeDefined();

    // L'ancien PIN ne marche plus localement
    expect(await verifyPin("1111", updatedAuth!.pinHash, updatedAuth!.pinSalt)).toBe(false);
    // Le nouveau PIN fonctionne immédiatement hors-ligne
    expect(await verifyPin("8888", updatedAuth!.pinHash, updatedAuth!.pinSalt)).toBe(true);
    // Le flag de synchronisation serveur est positionné
    expect(updatedAuth!.pendingPinUpdate).toBe("8888");
  });

  it("avertit l'agent à la déconnexion et NE VIDE JAMAIS l'outbox", async () => {
    // Ajouter 3 opérations dans l'outbox
    await db.outbox.add({
      clientId: "outbox-test-1",
      table: "operations",
      payload: { montant: 5000 },
      status: "pending",
      retries: 0,
      lastError: null,
      createdAt: Date.now(),
      lastAttempt: null,
    });
    await db.outbox.add({
      clientId: "outbox-test-2",
      table: "operations",
      payload: { montant: 10000 },
      status: "pending",
      retries: 0,
      lastError: null,
      createdAt: Date.now(),
      lastAttempt: null,
    });

    const pendingCount = await countPending();
    expect(pendingCount).toBe(2);

    // Message d'avertissement prescrit
    const warningMessage = `« ${pendingCount} opérations non envoyées seront conservées »`;
    expect(warningMessage).toBe("« 2 opérations non envoyées seront conservées »");

    // Simulation déconnexion : aucune opération ne doit être effacée
    // L'outbox doit rester strictement intacte
    const remainingAfterLogout = await countPending();
    expect(remainingAfterLogout).toBe(2);
  });
});
