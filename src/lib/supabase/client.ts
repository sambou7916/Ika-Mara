import { createBrowserClient } from "@supabase/ssr";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Client Supabase côté navigateur (composants client).
 * Utilise les clés publiques ANON uniquement.
 * Résilient en SSR (Node.js 20) et contre l'absence temporaire de variables d'environnement.
 */
export function createClient() {
  if (typeof window !== "undefined" && browserClient) {
    return browserClient;
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://placeholder-ikamaraproject.supabase.co";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder";

  const client = createBrowserClient(supabaseUrl, supabaseKey);

  if (typeof window !== "undefined") {
    browserClient = client;
  }

  return client;
}
