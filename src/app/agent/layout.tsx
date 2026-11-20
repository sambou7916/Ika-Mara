"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { initSync } from "@/lib/sync/engine";
import { getLocalAuth } from "@/lib/db/dexie";
import SyncBadge from "@/components/SyncBadge";

/**
 * Layout agent — mobile-first.
 * 
 * - En-tête avec marque et composant SyncBadge
 * - Navigation du bas partagée : Accueil, Dépôt, Membres, Journal, Plus
 * - Moteur de synchronisation initialisé
 */
export default function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isConnexionPage = pathname === "/agent/connexion";
  // Session agent locale vérifiée (portefeuille présent sur l'appareil)
  const [agentPret, setAgentPret] = useState(false);

  useEffect(() => {
    if (isConnexionPage) return;
    let actif = true;

    async function verifierSessionAgent() {
      let identifiant: string | null = null;
      try {
        identifiant = localStorage.getItem("ika_current_agent");
      } catch {
        identifiant = null;
      }
      const auth = identifiant ? await getLocalAuth(identifiant) : undefined;
      if (!actif) return;

      // Pas d'agent connecté sur cet appareil (ex. : aperçu depuis l'admin) :
      // sans portefeuille local, aucun membre ni dépôt n'est possible.
      if (!auth || auth.isBlocked) {
        router.replace("/agent/connexion");
        return;
      }
      setAgentPret(true);
      void initSync();
    }

    void verifierSessionAgent();
    return () => {
      actif = false;
    };
  }, [isConnexionPage, router]);

  if (isConnexionPage) {
    return <div className="min-h-screen bg-primary-950">{children}</div>;
  }

  if (!agentPret) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm font-medium text-slate-500">Vérification de la session agent…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-gray-900">
      {/* En-tête mobile */}
      <header className="sticky top-0 z-30 bg-primary-900 safe-top">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <Link href="/agent" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-400 text-xs font-extrabold text-primary-950 shadow-sm">
              IM
            </span>
            <span className="text-base font-bold tracking-tight text-white">
              IKA-MARA
            </span>
          </Link>

          <SyncBadge />
        </div>
      </header>

      {/* Contenu principal */}
      <main className="mx-auto w-full max-w-lg flex-1 pb-24 pt-3 px-4">
        {children}
      </main>

      {/* Barre de navigation du bas partagée : Accueil, Dépôt, Membres, Journal, Plus */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-md safe-bottom">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
          {/* 1. Accueil */}
          <NavTab
            href="/agent"
            label="Accueil"
            isActive={pathname === "/agent"}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            }
          />

          {/* 2. Dépôt */}
          <NavTab
            href="/agent/depot"
            label="Dépôt"
            isActive={pathname.startsWith("/agent/depot")}
            highlight
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            }
          />

          {/* 3. Membres */}
          <NavTab
            href="/agent/membres"
            label="Membres"
            isActive={pathname.startsWith("/agent/membres")}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            }
          />

          {/* 4. Journal */}
          <NavTab
            href="/agent/journal"
            label="Journal"
            isActive={pathname.startsWith("/agent/journal")}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          />

          {/* 5. Plus */}
          <NavTab
            href="/agent/plus"
            label="Plus"
            isActive={pathname.startsWith("/agent/plus")}
            icon={
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            }
          />
        </div>
      </nav>
    </div>
  );
}

function NavTab({
  href,
  label,
  icon,
  isActive,
  highlight = false,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  highlight?: boolean;
}) {
  if (highlight) {
    return (
      <Link
        href={href}
        className="group relative -top-2 flex flex-col items-center"
      >
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 ${
            isActive
              ? "bg-accent-400 text-primary-950 ring-4 ring-accent-100"
              : "bg-accent-400 text-primary-950 hover:bg-accent-300"
          }`}
        >
          {icon}
        </div>
        <span
          className={`mt-1 text-xs font-bold ${
            isActive ? "text-primary-700" : "text-gray-600"
          }`}
        >
          {label}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`flex flex-col items-center gap-1 transition-colors ${
        isActive
          ? "text-primary-700 font-semibold"
          : "text-gray-400 hover:text-gray-600"
      }`}
    >
      <div className={`transition-transform ${isActive ? "scale-110" : ""}`}>
        {icon}
      </div>
      <span className="text-xs tracking-tight">{label}</span>
    </Link>
  );
}
