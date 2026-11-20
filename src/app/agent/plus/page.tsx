"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db, saveLocalAuth } from "@/lib/db/dexie";
import { countPending } from "@/lib/db/outbox";
import { hashPin, verifyPin } from "@/lib/utils/crypto";
import { pinToPassword, validatePin } from "@/lib/utils/pin";
import { subscribeSyncState, stopSync, syncNow } from "@/lib/sync/engine";
import { formatDateTime } from "@/lib/utils/format";
import { createClient } from "@/lib/supabase/client";
import type { SyncState } from "@/lib/types";

const isValidPin = (pin: string) => validatePin(pin).valid;

// Version officielle de l'application
const APP_VERSION = "1.0.0";

/**
 * /agent/plus — Écran « Plus »
 * Liste de liens : Demandes, Synchronisation, Mon compte, Aide, Déconnexion.
 * Informations : Version de l'application et date de dernière synchronisation.
 */
export default function AgentPlusPage() {
  const supabase = createClient();

  // Données de l'agent
  const agentAuthList = useLiveQuery(() => db.agentAuth.toArray(), []);
  const agentAuth = agentAuthList && agentAuthList.length > 0 ? agentAuthList[0] : null;

  // État de la synchronisation (dernière date de synchro, en cours, etc.)
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

  useEffect(() => {
    return subscribeSyncState(setSyncState);
  }, []);

  // Nombre d'opérations dans l'outbox (en attente + en cours + en erreur)
  const totalOutboxCount = useLiveQuery(() => countPending(), []);

  // État changement de PIN (modal rapide Mon compte)
  const [showPinModal, setShowPinModal] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);
  const [isUpdatingPin, setIsUpdatingPin] = useState(false);

  // État déconnexion
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(null);

    if (!agentAuth) {
      setPinError("Données d'agent introuvables.");
      return;
    }

    if (!isValidPin(oldPin)) {
      setPinError("L'ancien code PIN doit comporter 6 chiffres.");
      return;
    }

    if (!isValidPin(newPin)) {
      setPinError("Le nouveau code PIN doit comporter 6 chiffres.");
      return;
    }

    if (newPin !== confirmPin) {
      setPinError("Le nouveau code PIN et la confirmation ne correspondent pas.");
      return;
    }

    setIsUpdatingPin(true);
    try {
      // 1. Vérifier l'ancien PIN localement contre le hash PBKDF2 stocké
      const isOldValid = await verifyPin(oldPin, agentAuth.pinHash, agentAuth.pinSalt);
      if (!isOldValid) {
        setPinError("L'ancien code PIN est incorrect.");
        setIsUpdatingPin(false);
        return;
      }

      // 2. Re-hash local PBKDF2 avec nouveau sel
      const { hash: newHash, salt: newSalt } = await hashPin(newPin);

      // 3. Tenter la mise à jour serveur si en ligne
      let pendingServerUpdate = newPin;
      try {
        const { error: serverError } = await supabase.auth.updateUser({ password: pinToPassword(newPin) });
        if (!serverError) {
          pendingServerUpdate = "";
        }
      } catch {
        // Hors ligne : sera mis à jour à la prochaine synchro
      }

      // 4. Mettre à jour dans Dexie
      await saveLocalAuth({
        ...agentAuth,
        pinHash: newHash,
        pinSalt: newSalt,
        failedAttempts: 0,
        pendingPinUpdate: pendingServerUpdate || null,
      });

      setPinSuccess(
        pendingServerUpdate
          ? "Code PIN modifié localement (sera synchronisé avec le serveur)."
          : "Code PIN modifié avec succès !"
      );
      setOldPin("");
      setNewPin("");
      setConfirmPin("");
      setTimeout(() => {
        setShowPinModal(false);
        setPinSuccess(null);
      }, 1500);
    } catch (err: unknown) {
      setPinError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setIsUpdatingPin(false);
    }
  };

  /**
   * Déconnexion sécurisée :
   * Ne vide JAMAIS l'outbox locale.
   */
  const handleLogout = async () => {
    setIsLoggingOut(true);
    stopSync();
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Ignorer si hors-ligne
    } finally {
      // Oublier l'agent courant (le profil et l'outbox restent sur l'appareil)
      try {
        localStorage.removeItem("ika_current_agent");
      } catch {
        // Stockage indisponible : sans effet
      }
      setIsLoggingOut(false);
      // Rechargement complet vers la page de connexion (vide le cache du routeur)
      window.location.href = "/agent/connexion";
    }
  };

  const opsEnAttente = totalOutboxCount ?? 0;

  return (
    <div className="space-y-5 pb-6">
      {/* En-tête */}
      <div className="pt-1">
        <h1 className="text-xl font-bold text-gray-900">Plus</h1>
        <p className="text-xs text-gray-500">
          Options de l'application, sécurité et informations
        </p>
      </div>

      {/* Carte Résumé Agent */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-base font-bold text-primary-800">
            {agentAuth?.nom ? agentAuth.nom.substring(0, 2).toUpperCase() : "AG"}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-gray-900 truncate">
              {agentAuth?.nom || "Agent IKA-MARA"}
            </h2>
            <p className="text-xs font-semibold text-primary-700">
              ID : {agentAuth?.identifiant || "Non défini"}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            Connecté
          </span>
        </div>
      </div>

      {/* Liste des liens demandés par le Prompt A10 */}
      <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 shadow-sm overflow-hidden">
        {/* 1. Demandes (/agent/demandes) */}
        <Link
          href="/agent/demandes"
          className="flex items-center justify-between p-4 hover:bg-gray-50 transition active:bg-gray-100"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 text-lg">
              📝
            </span>
            <div>
              <p className="text-sm font-bold text-gray-900">Demandes</p>
              <p className="text-xs text-gray-500">Retraits d'épargne et demandes de crédit</p>
            </div>
          </div>
          <span className="text-gray-400 text-lg">›</span>
        </Link>

        {/* 2. Synchronisation (/agent/synchro) */}
        <Link
          href="/agent/synchro"
          className="flex items-center justify-between p-4 hover:bg-gray-50 transition active:bg-gray-100"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600 text-lg">
              🔄
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-gray-900">Synchronisation</p>
                {opsEnAttente > 0 && (
                  <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.2 text-xs font-bold text-white">
                    {opsEnAttente}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {opsEnAttente === 0
                  ? "Toutes les opérations sont à jour"
                  : `${opsEnAttente} opération(s) dans l'outbox`}
              </p>
            </div>
          </div>
          <span className="text-gray-400 text-lg">›</span>
        </Link>

        {/* 3. Mon compte (changement de PIN avec ancien PIN) */}
        <Link
          href="/agent/compte"
          className="flex items-center justify-between p-4 hover:bg-gray-50 transition active:bg-gray-100"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 text-lg">
              👤
            </span>
            <div>
              <p className="text-sm font-bold text-gray-900">Mon compte</p>
              <p className="text-xs text-gray-500">Profil, identité et changement de code PIN</p>
            </div>
          </div>
          <span className="text-gray-400 text-lg">›</span>
        </Link>

        {/* 4. Aide (page statique) */}
        <Link
          href="/agent/aide"
          className="flex items-center justify-between p-4 hover:bg-gray-50 transition active:bg-gray-100"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-lg">
              📖
            </span>
            <div>
              <p className="text-sm font-bold text-gray-900">Aide</p>
              <p className="text-xs text-gray-500">Guide d'utilisation et règles de collecte</p>
            </div>
          </div>
          <span className="text-gray-400 text-lg">›</span>
        </Link>

        {/* 5. Déconnexion */}
        <button
          type="button"
          onClick={() => setShowLogoutModal(true)}
          className="flex w-full items-center justify-between p-4 text-left hover:bg-red-50/50 transition active:bg-red-50"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-600 text-lg">
              🚪
            </span>
            <div>
              <p className="text-sm font-bold text-red-700">Déconnexion</p>
              <p className="text-xs text-gray-500">Fermer la session sur cet appareil</p>
            </div>
          </div>
          <span className="text-gray-400 text-lg">›</span>
        </button>
      </div>

      {/* Bloc Informations : Version et Date de dernière synchro */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
          Informations système
        </h3>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">Version de l'application</span>
          <span className="font-mono font-bold text-gray-800">v{APP_VERSION}</span>
        </div>
        <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-2">
          <span className="text-gray-500">Dernière synchronisation</span>
          <span className="font-medium text-gray-800">
            {syncState.lastSyncAt
              ? formatDateTime(syncState.lastSyncAt)
              : "Aucune synchro récente"}
          </span>
        </div>
      </div>

      {/* Raccourci rapide changement de PIN en popin */}
      <div className="px-1 text-center">
        <button
          type="button"
          onClick={() => {
            setShowPinModal(true);
            setPinError(null);
            setPinSuccess(null);
          }}
          className="text-xs font-semibold text-primary-700 hover:underline"
        >
          Modifier rapidement mon code PIN ici
        </button>
      </div>

      {/* Modal Changement de PIN */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-gray-900">
              Modifier le code PIN
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Saisissez votre ancien PIN pour définir un nouveau PIN à 6 chiffres.
            </p>

            <form onSubmit={handlePinSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700">
                  Ancien code PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={oldPin}
                  onChange={(e) => setOldPin(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-center text-lg tracking-widest focus:border-primary-500 focus:outline-none"
                  placeholder="••••••"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700">
                  Nouveau code PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-center text-lg tracking-widest focus:border-primary-500 focus:outline-none"
                  placeholder="••••••"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700">
                  Confirmer le nouveau PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-center text-lg tracking-widest focus:border-primary-500 focus:outline-none"
                  placeholder="••••••"
                  required
                />
              </div>

              {pinError && (
                <div className="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-600 border border-red-200">
                  ⚠️ {pinError}
                </div>
              )}

              {pinSuccess && (
                <div className="rounded-lg bg-emerald-50 p-2 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  ✓ {pinSuccess}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowPinModal(false)}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingPin}
                  className="flex-1 rounded-xl bg-primary-700 py-2.5 text-xs font-bold text-white shadow hover:bg-primary-800 disabled:opacity-50"
                >
                  {isUpdatingPin ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmation Déconnexion avec avertissement spécifique Prompt A10 */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-gray-900">
              Confirmer la déconnexion
            </h3>

            {opsEnAttente > 0 ? (
              <div className="mt-3 rounded-xl bg-amber-50 p-3.5 border border-amber-200 text-xs text-amber-900 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5 text-amber-800">
                  <span>⚠️</span>
                  <span>Opérations en attente</span>
                </p>
                <p className="font-semibold text-amber-950">
                  « {opsEnAttente} opérations non envoyées seront conservées »
                </p>
                <p className="text-xs text-amber-800">
                  Ces données ne seront pas effacées de cet appareil. Elles seront
                  automatiquement transmises au serveur dès votre prochaine connexion.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-600">
                Êtes-vous sûr de vouloir vous déconnecter de votre session agent ?
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 rounded-xl border border-gray-300 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-xs font-bold text-white shadow hover:bg-red-700 disabled:opacity-50"
              >
                {isLoggingOut ? "Déconnexion..." : "Se déconnecter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
