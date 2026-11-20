import withSerwistInit from "@serwist/next";

// Version du déploiement : change à chaque mise en ligne, pour que les
// téléphones remplacent leur copie hors ligne des pages agent.
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || String(Date.now());

// Pages agent gardées sur le téléphone dès l'installation, pour fonctionner
// hors connexion même si l'agent ne les a jamais ouvertes avec internet.
const PAGES_AGENT_HORS_LIGNE = [
  "/agent",
  "/agent/connexion",
  "/agent/depot",
  "/agent/recu",
  "/agent/membres",
  "/agent/fiche",
  "/agent/demandes",
  "/agent/journal",
  "/agent/synchro",
  "/agent/plus",
  "/agent/compte",
  "/agent/aide",
];

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries: PAGES_AGENT_HORS_LIGNE.map((url) => ({ url, revision })),
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Anciennes adresses (liens déjà partagés) → nouvelles pages hors ligne
  async redirects() {
    return [
      { source: "/agent/recu/:id", destination: "/agent/recu?id=:id", permanent: false },
      {
        source: "/agent/membres/:numero(\\d+)",
        destination: "/agent/fiche?numero=:numero",
        permanent: false,
      },
    ];
  },
  webpack: (config, { dev }) => {
    // En développement : cache webpack en mémoire uniquement.
    // La sérialisation compressée du cache disque fait planter Node
    // sur les machines à faible RAM (« Array buffer allocation failed »).
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },
};

export default withSerwist(nextConfig);
