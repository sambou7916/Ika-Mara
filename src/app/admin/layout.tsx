"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Icon, { type IconName } from "@/components/ui/Icon";
import { cn } from "@/components/ui/utils";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Pastille de couleur du volet */
  volet?: "mara" | "pari" | "djourou";
}

const NAV_GROUPS: { titre: string; items: NavItem[] }[] = [
  {
    titre: "Pilotage",
    items: [
      { href: "/admin", label: "Tableau de bord", icon: "dashboard" },
      { href: "/admin/membres", label: "Membres", icon: "users" },
      { href: "/admin/agents", label: "Agents", icon: "user" },
    ],
  },
  {
    titre: "Volets",
    items: [
      { href: "/admin/mara", label: "Ika-Mara · Épargne", icon: "wallet", volet: "mara" },
      { href: "/admin/pari", label: "Ika-Pari · Tontine", icon: "cycle", volet: "pari" },
      { href: "/admin/djourou", label: "Ika-Djourou · Crédit", icon: "credit", volet: "djourou" },
    ],
  },
  {
    titre: "Finances",
    items: [
      { href: "/admin/commissions", label: "Commissions", icon: "chart" },
      { href: "/admin/caisse", label: "Caisse & remises", icon: "bank" },
    ],
  },
  {
    titre: "Administration",
    items: [
      { href: "/admin/audit", label: "Journal d'audit", icon: "audit" },
      { href: "/admin/parametres", label: "Paramètres", icon: "settings" },
    ],
  },
];

const VOLET_DOT: Record<NonNullable<NavItem["volet"]>, string> = {
  mara: "bg-mara",
  pari: "bg-pari",
  djourou: "bg-djourou",
};

/**
 * Layout Administrateur IKA-MARA
 * - Menu latéral groupé (ordinateur)
 * - Tiroir coulissant (mobile)
 * - Bouton de déconnexion
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Fermer le tiroir à chaque changement de page
  useEffect(() => {
    setIsMobileDrawerOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      // scope « local » : efface la session même si l'appel réseau échoue
      await createClient().auth.signOut({ scope: "local" });
    } catch {
      // Ignorer : la session locale est supprimée quoi qu'il arrive
    }
    // Rechargement complet : vide le cache du routeur Next.js
    window.location.href = "/login";
  };

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const navigation = (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Navigation principale">
      {NAV_GROUPS.map((groupe) => (
        <div key={groupe.titre}>
          <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-accent-400/80">
            {groupe.titre}
          </p>
          <ul className="space-y-0.5">
            {groupe.items.map((item) => {
              const actif = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={actif ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      actif
                        ? "bg-white/10 text-white ring-1 ring-inset ring-white/10"
                        : "text-primary-100/75 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <Icon
                      name={item.icon}
                      className={cn(
                        "h-5 w-5",
                        actif ? "text-accent-400" : "text-primary-300/70 group-hover:text-primary-100"
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.volet && (
                      <span className={cn("h-2 w-2 rounded-full", VOLET_DOT[item.volet])} />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const piedDeMenu = (
    <div className="border-t border-white/10 p-3">
      <Link
        href="/agent"
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-primary-100/75 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Icon name="phone" className="h-5 w-5 text-primary-300/70" />
        Aperçu espace agent
      </Link>
      <button
        type="button"
        onClick={handleLogout}
        className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200"
      >
        <Icon name="logout" className="h-5 w-5" />
        Se déconnecter
      </button>
    </div>
  );

  const logo = (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-400 font-display text-xs font-extrabold text-primary-950">
        IM
      </span>
      <div className="leading-tight">
        <p className="font-display text-base font-bold tracking-tight text-white">IKA-MARA</p>
        <p className="text-xs font-medium text-primary-200/70">Administration</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* ----------------- MENU LATÉRAL (ordinateur) ----------------- */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-gradient-to-b from-primary-900 to-primary-950 lg:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-5">{logo}</div>
        {navigation}
        {piedDeMenu}
      </aside>

      {/* ----------------- TIROIR (mobile) ----------------- */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setIsMobileDrawerOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-gradient-to-b from-primary-900 to-primary-950 shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
              {logo}
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                className="btn h-9 w-9 p-0 text-primary-100 hover:bg-white/10 hover:text-white"
                aria-label="Fermer le menu"
              >
                <Icon name="close" />
              </button>
            </div>
            {navigation}
            {piedDeMenu}
          </div>
        </div>
      )}

      {/* ----------------- CONTENU ----------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* En-tête mobile */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-primary-900 px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setIsMobileDrawerOpen(true)}
            className="btn h-9 w-9 p-0 text-white hover:bg-white/10"
            aria-label="Ouvrir le menu"
          >
            <Icon name="menu" />
          </button>
          <span className="font-display text-base font-bold tracking-tight text-white">
            IKA-MARA
          </span>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
