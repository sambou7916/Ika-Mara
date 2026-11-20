import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Middleware Next.js — gestion de l'authentification et du contrôle d'accès selon le rôle.
 *
 * - /login, /api/* : publics (aucun appel réseau à Supabase ici)
 * - /agent/* : publics côté serveur. L'espace agent fonctionne HORS LIGNE :
 *   ses pages ne contiennent aucune donnée (tout vient de l'appareil) et sont
 *   gardées sur le téléphone. Le contrôle d'accès est fait par le layout agent
 *   (PIN vérifié localement, PBKDF2) et par /api/sync (jeton + appareil lié).
 *   Une redirection serveur ici empêcherait de garder ces pages hors ligne.
 * - /admin/* : réservé au rôle 'admin' actif (redirection vers /login ou /agent)
 */

const PUBLIC_PATHS = ["/login", "/agent", "/api/"];

function redirectToLogin(request: NextRequest, error: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", error);
  return NextResponse.redirect(loginUrl);
}

/** Lit le rôle du profil (null en cas d'échec). */
async function lireRole(userId: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=role`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0].role : null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pages publiques : on sort avant tout appel à Supabase (évite un aller-retour réseau)
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  // Si non authentifié
  if (!user) {
    if (pathname.startsWith("/agent")) {
      return NextResponse.redirect(new URL("/agent/connexion", request.url));
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Racine : orienter selon le rôle (admin → /admin, sinon → /agent)
  if (pathname === "/") {
    const role = await lireRole(user.id);
    return NextResponse.redirect(new URL(role === "admin" ? "/admin" : "/agent", request.url));
  }

  // Protection spécifique /admin/* : réservé au rôle admin actif
  if (pathname.startsWith("/admin")) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return redirectToLogin(request, "Configuration serveur incomplète");
    }

    try {
      const profileRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=role,statut`,
        {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
          cache: "no-store",
        }
      );
      if (!profileRes.ok) {
        return redirectToLogin(request, "Impossible de vérifier vos droits. Réessayez.");
      }
      const profiles = await profileRes.json();
      const profile = Array.isArray(profiles) && profiles.length > 0 ? profiles[0] : null;

      if (profile?.statut === "suspendu") {
        return redirectToLogin(request, "Votre compte est suspendu. Contactez l'administrateur.");
      }
      if (profile?.role === "agent") {
        return NextResponse.redirect(new URL("/agent", request.url));
      }
      if (!profile || profile.role !== "admin" || profile.statut !== "actif") {
        return redirectToLogin(request, "Accès réservé aux administrateurs");
      }
    } catch {
      // Échec de vérification : on refuse l'accès (jamais d'ouverture par défaut)
      return redirectToLogin(request, "Impossible de vérifier vos droits. Réessayez.");
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)",
  ],
};
