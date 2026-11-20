// =============================================================================
// IKA-MARA — Authentification par identifiant + PIN
// =============================================================================
// L'agent se connecte avec son identifiant (ex: « AGT001 ») et son PIN (6 chiffres).
// Côté Supabase, on dérive un email technique : identifiant@ika-mara.local
// Le PIN sert de mot de passe.
// =============================================================================

/**
 * Dérive un email technique à partir de l'identifiant de l'agent.
 * Ex : « AGT001 » → « agt001@ika-mara.local »
 */
export function identifiantToEmail(identifiant: string): string {
  return `${identifiant.toLowerCase().trim()}@ika-mara.local`;
}

/**
 * Extrait l'identifiant depuis un email technique.
 * Ex : « agt001@ika-mara.local » → « AGT001 »
 */
export function emailToIdentifiant(email: string): string {
  return email.split("@")[0].toUpperCase();
}

/**
 * Convertit un PIN en mot de passe Supabase Auth.
 * Supabase impose au moins 6 caractères : on préfixe le PIN (6 chiffres).
 * Préfixe conservé pour rester compatible avec les comptes existants. L'utilisateur ne saisit que son PIN.
 */
export function pinToPassword(pin: string): string {
  return `IKA-${pin}`;
}

/**
 * Valide le format d'un PIN (exactement 6 chiffres).
 */
export function validatePin(pin: string): {
  valid: boolean;
  error?: string;
} {
  if (!pin || pin.length === 0) {
    return { valid: false, error: "Le PIN est requis" };
  }
  if (!/^\d{6}$/.test(pin)) {
    return {
      valid: false,
      error: "Le PIN doit contenir exactement 6 chiffres",
    };
  }
  return { valid: true };
}

/**
 * Valide le format d'un identifiant.
 */
export function validateIdentifiant(identifiant: string): {
  valid: boolean;
  error?: string;
} {
  if (!identifiant || identifiant.trim().length === 0) {
    return { valid: false, error: "L'identifiant est requis" };
  }
  if (identifiant.trim().length < 3) {
    return {
      valid: false,
      error: "L'identifiant doit contenir au moins 3 caractères",
    };
  }
  return { valid: true };
}
