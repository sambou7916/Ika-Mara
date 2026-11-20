// =============================================================================
// IKA-MARA — Détection réseau avancée
// =============================================================================
// Combine navigator.onLine et un ping léger vers Supabase pour vérifier
// la véritable connectivité Internet (au-delà de la simple liaison WiFi/4G).
// =============================================================================

/**
 * Vérifie la véritable connectivité réseau avec un ping léger vers Supabase.
 * @param timeoutMs Délai d'abandon en millisecondes (défaut : 3000ms)
 * @returns true si la connexion Internet est active et Supabase est joignable
 */
export async function checkNetworkConnectivity(timeoutMs = 3000): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return false;
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return typeof navigator !== "undefined" ? navigator.onLine : true;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Requête HEAD / GET légère sur l'endpoint de santé Supabase Auth
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);
    // Tout statut HTTP valide (même 401 ou 200) prouve que Supabase répond
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}
