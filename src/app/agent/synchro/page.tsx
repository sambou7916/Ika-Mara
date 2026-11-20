"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { retryEntry } from "@/lib/db/outbox";
import { refreshPortfolio, subscribeSyncState, syncNow } from "@/lib/sync/engine";
import type { OutboxEntry, SyncState } from "@/lib/types";
import {
  formatDateTime,
  formatMontant,
  formatRelativeTime,
  libelleOperation,
  libelleVolet,
} from "@/lib/utils/format";

/**
 * /agent/synchro — État de la synchronisation et file d'attente (outbox).
 *
 * - État global (en ligne / hors ligne / en cours / prochaine tentative)
 * - Compteurs : en attente, en erreur
 * - Liste des opérations en erreur (motif lisible) puis en attente
 * - « Synchroniser maintenant » et « Mettre à jour mon portefeuille »
 * - Aucune opération n'est supprimée depuis cet écran.
 */
export default function AgentSynchroPage() {
  const [syncState, setSyncState] = useState<SyncState>({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    pendingCount: 0,
    errorCount: 0,
    lastSyncAt: null,
    lastPullAt: null,
    isSyncing: false,
    isPulling: false,
    lastError: null,
    nextRetryAt: null,
  });
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  useEffect(() => subscribeSyncState(setSyncState), []);

  // Compte à rebours de la prochaine tentative automatique
  useEffect(() => {
    if (!syncState.nextRetryAt) return;
    const t = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(t);
  }, [syncState.nextRetryAt]);

  // Outbox en direct, dans l'ordre d'envoi
  const entries = useLiveQuery(() => db.outbox.orderBy("createdAt").toArray(), []);

  // Noms des membres pour un affichage lisible
  const membres = useLiveQuery(() => db.membres.toArray(), []);
  const nomsMembres = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of membres ?? []) map.set(m.id, `${m.numero} · ${m.prenom} ${m.nom}`);
    return map;
  }, [membres]);

  const enErreur = (entries ?? []).filter((e) => e.status === "error");
  const enAttente = (entries ?? []).filter((e) => e.status !== "error");

  const occupe = syncState.isSyncing || syncState.isPulling === true;
  const secondesAvantReessai = syncState.nextRetryAt
    ? Math.max(0, Math.ceil((syncState.nextRetryAt - maintenant) / 1000))
    : null;

  function afficher(type: "ok" | "erreur", texte: string) {
    setMessage({ type, texte });
    setTimeout(() => setMessage(null), 5000);
  }

  async function handleSync() {
    const res = await syncNow({ manuel: true });
    if (!res) {
      afficher("erreur", syncState.isOnline ? "Synchronisation impossible pour le moment." : "Vous êtes hors ligne. Les opérations restent sur l'appareil.");
    } else if (res.success) {
      afficher("ok", res.synced > 0 ? `${res.synced} opération(s) envoyée(s) au serveur.` : "Tout est déjà synchronisé.");
    } else {
      afficher("erreur", `${res.synced} envoyée(s), ${res.errors.length} en erreur. Voir le détail ci-dessous.`);
    }
  }

  async function handlePortefeuille() {
    const res = await refreshPortfolio();
    if (res.success) afficher("ok", "Portefeuille mis à jour : soldes, membres et décisions de l'administrateur.");
    else afficher("erreur", res.error ?? "Mise à jour impossible.");
  }

  async function handleRetry(entry: OutboxEntry) {
    if (entry.localId === undefined) return;
    await retryEntry(entry.localId);
    await syncNow({ manuel: true });
  }

  return (
    <div className="space-y-4 pb-4">
      {/* En-tête */}
      <div className="flex items-center gap-2 pt-1">
        <Link
          href="/agent"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm active:scale-95"
          aria-label="Retour à l'accueil"
        >
          ‹
        </Link>
        <h1 className="text-lg font-bold text-gray-900">Synchronisation</h1>
      </div>

      {/* État global */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span
            className={`h-3 w-3 rounded-full ${
              occupe ? "animate-pulse bg-primary-500" : syncState.isOnline ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-900">
              {syncState.isSyncing
                ? "Envoi des opérations…"
                : syncState.isPulling
                ? "Mise à jour du portefeuille…"
                : syncState.isOnline
                ? "En ligne"
                : "Hors ligne"}
            </p>
            <p className="text-xs text-gray-500">
              {syncState.isOnline
                ? "Les opérations sont envoyées automatiquement."
                : "Les opérations sont conservées sur l'appareil et partiront au retour du réseau."}
            </p>
          </div>
        </div>

        {/* Compteurs */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-amber-50 p-3 text-center">
            <p className="text-2xl font-bold text-amber-700">{enAttente.length}</p>
            <p className="text-xs font-semibold text-amber-800">En attente</p>
          </div>
          <div className={`rounded-xl p-3 text-center ${enErreur.length ? "bg-red-50" : "bg-slate-50"}`}>
            <p className={`text-2xl font-bold ${enErreur.length ? "text-red-700" : "text-gray-400"}`}>
              {enErreur.length}
            </p>
            <p className={`text-xs font-semibold ${enErreur.length ? "text-red-800" : "text-gray-500"}`}>
              En erreur
            </p>
          </div>
        </div>

        <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <div className="flex justify-between">
            <dt>Dernier envoi réussi</dt>
            <dd className="font-medium text-gray-700">
              {syncState.lastSyncAt ? formatDateTime(syncState.lastSyncAt) : "—"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Portefeuille mis à jour</dt>
            <dd className="font-medium text-gray-700">
              {syncState.lastPullAt ? formatDateTime(syncState.lastPullAt) : "—"}
            </dd>
          </div>
          {secondesAvantReessai !== null && (
            <div className="flex justify-between">
              <dt>Nouvel essai automatique</dt>
              <dd className="font-medium text-primary-700">dans {secondesAvantReessai} s</dd>
            </div>
          )}
        </dl>

        {syncState.lastError && !occupe && (
          <p className="mt-3 rounded-xl bg-red-50 p-2.5 text-xs font-medium text-red-700">
            ⚠️ {syncState.lastError}
          </p>
        )}
      </section>

      {/* Retour d'action */}
      {message && (
        <p
          role="status"
          className={`rounded-xl border p-3 text-xs font-semibold ${
            message.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {message.texte}
        </p>
      )}

      {/* Actions */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={occupe || !syncState.isOnline}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-4 py-3.5 font-bold text-white shadow-md transition-all hover:bg-primary-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncState.isSyncing ? "Synchronisation en cours…" : "Synchroniser maintenant"}
        </button>
        <button
          type="button"
          onClick={() => void handlePortefeuille()}
          disabled={occupe || !syncState.isOnline}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-primary-200 bg-white px-4 py-3 text-sm font-bold text-primary-800 shadow-sm transition-all hover:bg-primary-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncState.isPulling ? "Mise à jour…" : "Mettre à jour mon portefeuille"}
        </button>
        {!syncState.isOnline && (
          <p className="text-center text-xs text-gray-500">
            Connexion internet requise pour synchroniser.
          </p>
        )}
      </div>

      {/* Opérations en erreur */}
      {enErreur.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-red-700">
            En erreur ({enErreur.length})
          </h2>
          <p className="px-1 text-xs text-gray-500">
            Ces opérations ne sont jamais supprimées. Elles restent visibles par vous et par l&apos;administrateur.
          </p>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm">
            {enErreur.map((entry) => (
              <LigneOutbox
                key={entry.localId}
                entry={entry}
                nomMembre={nomsMembres.get(String(entry.payload.membre_id ?? ""))}
                onRetry={entry.errorKind === "definitive" ? () => void handleRetry(entry) : undefined}
                desactive={occupe || !syncState.isOnline}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Opérations en attente */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
            En attente ({enAttente.length})
          </h2>
          <span className="text-xs text-gray-400">Envoi dans l&apos;ordre de saisie</span>
        </div>

        {entries === undefined ? (
          <div className="h-16 animate-pulse rounded-2xl bg-gray-100" />
        ) : enAttente.length > 0 ? (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {enAttente.map((entry) => (
              <LigneOutbox
                key={entry.localId}
                entry={entry}
                nomMembre={nomsMembres.get(String(entry.payload.membre_id ?? ""))}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-xs text-gray-500">
            Aucune opération en attente. Tout est synchronisé avec le serveur.
          </div>
        )}
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------------

function LigneOutbox({
  entry,
  nomMembre,
  onRetry,
  desactive,
}: {
  entry: OutboxEntry;
  nomMembre?: string;
  onRetry?: () => void;
  desactive?: boolean;
}) {
  const p = entry.payload as Record<string, unknown>;
  const estRemise = entry.table === "remises_collecte";
  const montant = Number(estRemise ? p.montant_remis ?? p.montant : p.montant) || 0;

  const titre = estRemise
    ? `Remise de collecte du ${String(p.date_remise ?? "")}`
    : `${libelleOperation(String(p.type ?? "depot"))} · ${libelleVolet(String(p.volet ?? "mara"))}`;

  const statut =
    entry.status === "error"
      ? { libelle: "Erreur", classe: "bg-red-100 text-red-700" }
      : entry.status === "syncing"
      ? { libelle: "Envoi…", classe: "bg-primary-100 text-primary-700" }
      : entry.lastError
      ? { libelle: "Nouvel essai", classe: "bg-amber-100 text-amber-800" }
      : { libelle: "En attente", classe: "bg-amber-50 text-amber-700" };

  return (
    <li className="p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold text-gray-900">{titre}</p>
          {!estRemise && (
            <p className="truncate text-xs text-gray-500">{nomMembre ?? "Membre inconnu sur l'appareil"}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono font-bold text-gray-900">{formatMontant(montant)}</p>
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statut.classe}`}>
            {statut.libelle}
          </span>
        </div>
      </div>

      <p className="mt-1 text-xs text-gray-400">
        Saisie {formatRelativeTime(new Date(entry.createdAt))}
        {entry.retries > 0 && ` · ${entry.retries} tentative(s)`}
        {" · "}réf. {entry.clientId.slice(0, 8)}
      </p>

      {entry.lastError && (
        <p className={`mt-1.5 rounded-lg p-2 text-xs ${entry.status === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
          {entry.lastError}
        </p>
      )}

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={desactive}
          className="mt-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Réessayer l&apos;envoi
        </button>
      )}
    </li>
  );
}
