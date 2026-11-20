/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // La première règle qui correspond s'applique : les règles propres à
  // IKA-MARA passent donc AVANT le cache par défaut.
  runtimeCaching: [
    // Synchronisation : jamais de cache (le serveur fait foi)
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/sync"),
      handler: new NetworkOnly(),
    },
    // Pages agent : réseau d'abord, copie locale pour le mode hors ligne
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && /^\/agent(\/.*)?$/.test(url.pathname),
      handler: new NetworkFirst({
        cacheName: "agent-pages",
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60, // 24 heures
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
