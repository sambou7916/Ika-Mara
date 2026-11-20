import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Vert forêt de marque IKA-MARA (échelle complète, 950 inclus)
        primary: {
          50: "#effaf3",
          100: "#d8f3e3",
          200: "#b4e6ca",
          300: "#82d1a8",
          400: "#4fb582",
          500: "#2d9965",
          600: "#1f7c51",
          700: "#1a6343",
          800: "#174f37",
          900: "#13402e",
          950: "#0b2a1e",
        },
        // Orange doré d'accent (boutons d'action, mises en avant)
        accent: {
          50: "#fff8eb",
          100: "#feedc7",
          200: "#fdd98a",
          300: "#fcc24d",
          400: "#f6a623",
          500: "#e88b0c",
          600: "#cd6a07",
          700: "#aa4b0a",
          800: "#8a3a0f",
          900: "#723010",
        },
        // Couleurs des volets (le rouge est réservé aux erreurs)
        mara: { DEFAULT: "#059669", light: "#d1fae5", dark: "#065f46" },
        pari: { DEFAULT: "#d97706", light: "#fef3c7", dark: "#92400e" },
        djourou: { DEFAULT: "#7c3aed", light: "#ede9fe", dark: "#5b21b6" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        // Montants, numéros, identifiants : Poppins aussi (chiffres tabulaires via globals.css)
        mono: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        "card-hover": "0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)",
        cta: "0 1px 2px 0 rgb(232 139 12 / 0.25), 0 6px 16px -6px rgb(232 139 12 / 0.55)",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
};
export default config;
