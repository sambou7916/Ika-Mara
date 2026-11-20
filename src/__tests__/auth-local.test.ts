// =============================================================================
// IKA-MARA — Tests unitaires : Authentification Locale Agent & PBKDF2
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { hashPin, verifyPin, bytesToHex, hexToBytes } from "@/lib/utils/crypto";
import {
  IkaMara,
  saveLocalAuth,
  getLocalAuth,
  recordFailedAttempt,
  resetFailedAttempts,
  purgeAgentData,
  db,
} from "@/lib/db/dexie";
import type { LocalAgentAuth } from "@/lib/types";

describe("Crypto — PBKDF2 PIN Hashing", () => {
  it("hache un code PIN et génère un sel valide de 16 octets (32 caractères hex)", async () => {
    const pin = "1234";
    const { hash, salt } = await hashPin(pin);

    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // SHA-256 = 32 octets = 64 caractères hex
    expect(salt).toBeDefined();
    expect(salt.length).toBe(32); // 16 octets = 32 caractères hex
  });

  it("vérifie avec succès le code PIN correct", async () => {
    const pin = "7890";
    const { hash, salt } = await hashPin(pin);

    const isValid = await verifyPin(pin, hash, salt);
    expect(isValid).toBe(true);
  });

  it("rejette un code PIN incorrect", async () => {
    const correctPin = "1111";
    const wrongPin = "2222";
    const { hash, salt } = await hashPin(correctPin);

    const isValid = await verifyPin(wrongPin, hash, salt);
    expect(isValid).toBe(false);
  });

  it("fonctionne également pour un code PIN à 6 chiffres", async () => {
    const pin6 = "123456";
    const { hash, salt } = await hashPin(pin6);

    expect(await verifyPin(pin6, hash, salt)).toBe(true);
    expect(await verifyPin("654321", hash, salt)).toBe(false);
  });

  it("convertit correctement hex <-> bytes", () => {
    const original = "deadbeef1234";
    const bytes = hexToBytes(original);
    const hex = bytesToHex(bytes);
    expect(hex).toBe(original);
  });
});

describe("Dexie — Gestion du compte local et blocage 5 essais", () => {
  beforeEach(async () => {
    await db.agentAuth.clear();
    await db.membres.clear();
    await db.operations.clear();
  });

  it("sauvegarde et récupère les identifiants locaux de l'agent", async () => {
    const { hash, salt } = await hashPin("1111");
    const authData: LocalAgentAuth = {
      identifiant: "AGT001",
      agentId: "agent-uuid-001",
      nom: "Traoré Boubacar",
      telephone: "+22370000002",
      statut: "actif",
      pinHash: hash,
      pinSalt: salt,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: null,
      lastLoginAt: Date.now(),
    };

    await saveLocalAuth(authData);

    const retrieved = await getLocalAuth("agt001"); // Insensible à la casse
    expect(retrieved).toBeDefined();
    expect(retrieved?.identifiant).toBe("AGT001");
    expect(retrieved?.nom).toBe("Traoré Boubacar");
    expect(retrieved?.pinHash).toBe(hash);
  });

  it("incrémente les tentatives échouées et bloque au 5ème essai", async () => {
    const { hash, salt } = await hashPin("2222");
    await saveLocalAuth({
      identifiant: "AGT002",
      agentId: "agent-uuid-002",
      nom: "Diallo Aminata",
      telephone: "+22370000003",
      statut: "actif",
      pinHash: hash,
      pinSalt: salt,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: null,
      lastLoginAt: Date.now(),
    });

    // 1er essai raté
    let res = await recordFailedAttempt("AGT002");
    expect(res.attempts).toBe(1);
    expect(res.isBlocked).toBe(false);

    // 2e, 3e, 4e essai
    await recordFailedAttempt("AGT002");
    await recordFailedAttempt("AGT002");
    res = await recordFailedAttempt("AGT002");
    expect(res.attempts).toBe(4);
    expect(res.isBlocked).toBe(false);

    // 5e essai -> blocage automatique
    res = await recordFailedAttempt("AGT002");
    expect(res.attempts).toBe(5);
    expect(res.isBlocked).toBe(true);

    const agent = await getLocalAuth("AGT002");
    expect(agent?.isBlocked).toBe(true);
    expect(agent?.blockedAt).not.toBeNull();
  });

  it("réinitialise le compteur après un mot de passe correct", async () => {
    const { hash, salt } = await hashPin("3333");
    await saveLocalAuth({
      identifiant: "AGT003",
      agentId: "agent-uuid-003",
      nom: "Keita Oumar",
      telephone: null,
      statut: "actif",
      pinHash: hash,
      pinSalt: salt,
      failedAttempts: 3,
      isBlocked: false,
      blockedAt: null,
      lastLoginAt: Date.now(),
    });

    await resetFailedAttempts("AGT003");

    const agent = await getLocalAuth("AGT003");
    expect(agent?.failedAttempts).toBe(0);
    expect(agent?.isBlocked).toBe(false);
  });

  it("purgeAgentData efface toutes les données locales en cas de suspension", async () => {
    // Insérer des données
    const { hash, salt } = await hashPin("4444");
    await saveLocalAuth({
      identifiant: "AGT004",
      agentId: "agent-uuid-004",
      nom: "Sissoko Fanta",
      telephone: null,
      statut: "actif",
      pinHash: hash,
      pinSalt: salt,
      failedAttempts: 0,
      isBlocked: false,
      blockedAt: null,
      lastLoginAt: Date.now(),
    });

    await db.membres.add({
      id: "m-001",
      numero: "0001",
      nom: "Koné",
      prenom: "Drissa",
      profession: "Commerçant",
      telephone: "+22370000009",
      quartier: "Hamdallaye",
      agent_id: "agent-uuid-004",
      statut: "actif",
      cree_le: new Date().toISOString(),
      modifie_le: new Date().toISOString(),
    });

    expect(await db.agentAuth.count()).toBe(1);
    expect(await db.membres.count()).toBe(1);

    // Suspension -> Purge complète
    await purgeAgentData();

    expect(await db.agentAuth.count()).toBe(0);
    expect(await db.membres.count()).toBe(0);
  });
});
