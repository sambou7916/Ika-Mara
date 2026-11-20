/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Vrai pour une adresse de l'espace agent (/agent, /agent/...). */
function estPageAgent(url: URL, sameOrigin: boolean): boolean {
  return sameOrigin && /^\/agent(\/.*)?$/.test(url.pathname);
}

/**
 * Mode hors ligne de l'espace agent
 *
 * - Les pages agent (/agent, /agent/depot, /agent/recu …) sont gardées sur le
 *   téléphone dès l'installation (liste dans next.config.mjs) et servies
 *   depuis cette copie, avec ou sans internet. Une nouvelle mise en ligne
 *   remplace la copie automatiquement.
 * - Les paramètres d'adresse (?id=…, ?numero=…, ?membre=…) sont ignorés pour
 *   retrouver la page : /agent/recu?id=X utilise la copie de /agent/recu.
 *   Seul « _rsc » (navigation interne de Next.js) est conservé, pour que ces
 *   requêtes ne reçoivent jamais une page HTML.
 * - Navigation interne (RSC) : toujours par le réseau. Hors ligne, elle échoue
 *   et Next.js recharge la page, servie alors depuis la copie locale.
 * - Les données viennent de l'appareil (Dexie) ; /api/sync n'est jamais en cache.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    ignoreURLParametersMatching: [/^(?!_rsc$).+$/],
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  // La première règle qui correspond s'applique : les règles propres à
  // IKA-MARA passent donc AVANT le cache par défaut.
  runtimeCaching: [
    // Synchronisation : jamais de cache (le serveur fait foi)
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/sync"),
      handler: new NetworkOnly(),
    },
    // Navigation interne de l'espace agent : réseau uniquement (voir plus haut)
    {
      matcher: ({ request, url, sameOrigin }) =>
        estPageAgent(url, sameOrigin) &&
        (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  // Page agent absente de la copie locale et réseau coupé : accueil agent
  fallbacks: {
    entries: [
      {
        url: "/agent",
        matcher: ({ request }) =>
          request.mode === "navigate" && new URL(request.url).pathname.startsWith("/agent"),
      },
    ],
  },
});

serwist.addEventListeners();
