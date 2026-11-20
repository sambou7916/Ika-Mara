"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeSyncState } from "@/lib/sync/engine";
import { checkNetworkConnectivity } from "@/lib/sync/network";
import type { SyncState } from "@/lib/types";

/**
 * SyncBadge — Indicateur de statut de synchronisation dans l'en-tête.
 * 
 * - Vert « En ligne » (fond vert doux, texte vert)
 * - Orange « Hors ligne » (fond orange doux, texte ambre)
 * - Compteur d'opérations en attente (outbox)
 * - Détection du réseau : navigator.onLine + ping léger Supabase
 * - Au clic / toucher : redirection vers /agent/synchro
 */
export default function SyncBadge() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    pendingCount: 0,
    lastSyncAt: null,
    isSyncing: false,
    lastError: null,
  });

  const [verifiedOnline, setVerifiedOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // Écouter l'état du moteur de synchronisation
  useEffect(() => {
    const unsubscribe = subscribeSyncState((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  // Vérification de la connectivité réelle (navigator.onLine + ping Supabase)
  useEffect(() => {
    let isMounted = true;

    async function verify() {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (isMounted) setVerifiedOnline(false);
        return;
      }
      const canReachServer = await checkNetworkConnectivity();
      if (isMounted) {
        setVerifiedOnline(canReachServer);
      }
    }

    // Vérification initiale
    void verify();

    // Réagir aux changements de connectivité système
    const handleOnline = () => void verify();
    const handleOffline = () => {
      if (isMounted) setVerifiedOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Ping régulier toutes les 25 secondes
    const interval = setInterval(() => {
      void verify();
    }, 25000);

    return () => {
      isMounted = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, []);

  function handleClick() {
    router.push("/agent/synchro");
  }

  const effectiveOnline = verifiedOnline && state.isOnline;
  const hasPending = state.pendingCount > 0;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-all active:scale-95 ${
        state.isSyncing
          ? "bg-primary-50 text-primary-700 border border-primary-200"
          : effectiveOnline
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
          : "bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100"
      }`}
      aria-label="Statut de synchronisation - toucher pour gérer"
      title="Voir l'état de synchronisation"
    >
      {state.isSyncing ? (
        <>
          <svg
            className="h-3 w-3 animate-spin text-primary-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span>Synchro…</span>
        </>
      ) : effectiveOnline ? (
        <>
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm" />
          <span>En ligne</span>
        </>
      ) : (
        <>
          <span className="h-2 w-2 rounded-full bg-amber-500 shadow-sm" />
          <span>Hors ligne</span>
        </>
      )}

      {/* Compteur d'opérations en attente */}
      {hasPending && (
        <span
          className={`ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-xs font-bold ${
            (state.errorCount ?? 0) > 0
              ? "bg-red-600 text-white"
              : effectiveOnline
              ? "bg-emerald-600 text-white"
              : "bg-amber-600 text-white"
          }`}
          title={
            (state.errorCount ?? 0) > 0
              ? `${state.errorCount} opération(s) en erreur`
              : `${state.pendingCount} opération(s) en attente`
          }
        >
          {state.pendingCount}
        </span>
      )}
    </button>
  );
}
