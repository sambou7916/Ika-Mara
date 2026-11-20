import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

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
  runtimeCaching: [
    ...defaultCache,
    // Précacher les pages agent pour le mode hors ligne
    {
      urlPattern: /^\/agent(\/.*)?$/,
      handler: "NetworkFirst",
      options: {
        cacheName: "agent-pages",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 24 heures
        },
        networkTimeoutSeconds: 3,
      },
    },
    // Cache des API de synchronisation
    {
      urlPattern: /^\/api\/sync/,
      handler: "NetworkOnly",
    },
  ],
});

serwist.addEventListeners();
