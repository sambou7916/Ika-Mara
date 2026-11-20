// =============================================================================
// IKA-MARA — Chiffrement et Hachage local (PBKDF2)
// =============================================================================
// Dérivation de clé PBKDF2 avec SHA-256 et 100 000 itérations via Web Crypto API.
// Utilisé pour vérifier le code PIN de l'agent sans connexion réseau.
// =============================================================================

function getCrypto(): Crypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto API non disponible");
}

/**
 * Convertit un Uint8Array en chaîne hexadécimale.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convertit une chaîne hexadécimale en Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Hache un code PIN avec PBKDF2 et un sel (généré ou fourni).
 * 
 * @param pin Code PIN à 6 chiffres
 * @param saltHex Sel optionnel en hexadécimal (16 octets / 32 caractères)
 * @returns Objet avec le hash et le sel en hexadécimal
 */
export async function hashPin(
  pin: string,
  saltHex?: string
): Promise<{ hash: string; salt: string }> {
  const cryptoObj = getCrypto();
  const enc = new TextEncoder();

  const saltBytes = saltHex
    ? hexToBytes(saltHex)
    : cryptoObj.getRandomValues(new Uint8Array(16));

  const keyMaterial = await cryptoObj.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const derivedBits = await cryptoObj.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256 // 32 octets = 256 bits
  );

  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(saltBytes),
  };
}

/**
 * Vérifie un code PIN par rapport au hash et au sel stockés.
 * 
 * @param pin Code PIN fourni
 * @param storedHash Hash PBKDF2 stocké (hex)
 * @param storedSalt Sel stocké (hex)
 * @returns boolean true si le PIN correspond
 */
export async function verifyPin(
  pin: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  const { hash: computedHash } = await hashPin(pin, storedSalt);
  return computedHash === storedHash;
}
