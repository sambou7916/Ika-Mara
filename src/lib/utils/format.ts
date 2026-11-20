// =============================================================================
// IKA-MARA — Utilitaires de formatage
// =============================================================================
// Montants en F CFA : entiers, format « 1 000 F », jamais de décimales.
// Interface en français.
// =============================================================================

/**
 * Formate un montant entier en F CFA.
 * Ex : 15000 → « 15 000 F »
 *      1000  → « 1 000 F »
 *      500   → « 500 F »
 *
 * @param montant - Montant en F CFA (entier)
 * @param avecDevise - Ajouter « F » à la fin (défaut: true)
 */
export function formatMontant(montant: number, avecDevise = true): string {
  // Arrondir au cas où (ne devrait jamais arriver)
  const entier = Math.round(montant);

  // Formater avec des espaces comme séparateur de milliers
  const formatted = entier.toLocaleString("fr-FR", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });

  return avecDevise ? `${formatted} F` : formatted;
}

/**
 * Parse un montant depuis une chaîne formatée.
 * Ex : « 15 000 F » → 15000
 *      « 1,000 »   → 1000
 */
export function parseMontant(value: string): number {
  // Retirer tout sauf les chiffres et le signe négatif
  const cleaned = value.replace(/[^\d-]/g, "");
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Formate une date en français.
 * Ex : « 14 nov. 2026 »
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Formate une date et heure en français.
 * Ex : « 14 nov. 2026, 22:45 »
 */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Formate un temps relatif en français.
 * Ex : « il y a 5 min », « il y a 2 h », « il y a 3 j »
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffH = Math.floor(diffMin / 60);
  const diffJ = Math.floor(diffH / 24);

  if (diffSec < 60) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffH < 24) return `il y a ${diffH} h`;
  if (diffJ < 30) return `il y a ${diffJ} j`;
  return formatDate(d);
}

/**
 * Libellé français d'un volet.
 */
export function libelleVolet(volet: string): string {
  const labels: Record<string, string> = {
    mara: "Ika-Mara (Épargne)",
    pari: "Ika-Pari (Tontine)",
    djourou: "Ika-Djourou (Crédit)",
  };
  return labels[volet] ?? volet;
}

/**
 * Libellé français d'un type d'opération.
 */
export function libelleOperation(type: string): string {
  const labels: Record<string, string> = {
    depot: "Dépôt",
    retrait: "Retrait",
    remboursement: "Remboursement",
    commission: "Commission",
    decaissement: "Décaissement",
    annulation: "Annulation",
    demande_retrait: "Demande de retrait",
    demande_credit: "Demande de crédit",
  };
  return labels[type] ?? type;
}

/**
 * Classe CSS pour la couleur d'un volet.
 */
export function couleurVolet(volet: string): string {
  const colors: Record<string, string> = {
    mara: "text-green-700 bg-green-100",
    pari: "text-amber-700 bg-amber-100",
    djourou: "text-red-700 bg-red-100",
  };
  return colors[volet] ?? "text-gray-700 bg-gray-100";
}

/**
 * Classe Tailwind pour le badge d'un volet.
 */
export function badgeVolet(volet: string): string {
  const badges: Record<string, string> = {
    mara: "badge-mara",
    pari: "badge-pari",
    djourou: "badge-djourou",
  };
  return badges[volet] ?? "";
}
