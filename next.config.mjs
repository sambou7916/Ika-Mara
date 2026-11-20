import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
