"use client";

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db, saveLocalAuth } from "@/lib/db/dexie";
import { hashPin, verifyPin } from "@/lib/utils/crypto";
import { pinToPassword, validatePin } from "@/lib/utils/pin";
import { formatDateTime } from "@/lib/utils/format";
import { createClient } from "@/lib/supabase/client";

const isValidPin = (pin: string) => validatePin(pin).valid;

/**
 * /agent/compte — Écran « Mon compte »
 * Profil agent, coordonnées, et changement sécurisé de PIN (exigeant l'ancien PIN).
 */
export default function AgentComptePage() {
  const supabase = createClient();
  const agentAuthList = useLiveQuery(() => db.agentAuth.toArray(), []);
  const agentAuth = agentAuthList && agentAuthList.length > 0 ? agentAuthList[0] : null;

  // Formulaire changement de PIN
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);
  const [isUpdatingPin, setIsUpdatingPin] = useState(false);

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
      // 1. Vérifier l'ancien PIN localement contre le hash PBKDF2
      const isOldValid = await verifyPin(oldPin, agentAuth.pinHash, agentAuth.pinSalt);
      if (!isOldValid) {
        setPinError("L'ancien code PIN est incorrect.");
        setIsUpdatingPin(false);
        return;
      }

      // 2. Hasher le nouveau PIN avec un nouveau sel
      const { hash: newHash, salt: newSalt } = await hashPin(newPin);

      // 3. Tenter la mise à jour serveur Supabase si le réseau est disponible
      let pendingServerUpdate = newPin;
      try {
        const { error: serverError } = await supabase.auth.updateUser({ password: pinToPassword(newPin) });
        if (!serverError) {
          pendingServerUpdate = ""; // Déjà appliqué côté serveur
        }
      } catch {
        // En mode hors ligne, la synchro serveur se fera lors de la prochaine synchronisation
      }

      // 4. Mettre à jour dans Dexie (re-hash local immédiat)
      await saveLocalAuth({
        ...agentAuth,
        pinHash: newHash,
        pinSalt: newSalt,
        failedAttempts: 0,
        pendingPinUpdate: pendingServerUpdate || null,
      });

      setPinSuccess(
        pendingServerUpdate
          ? "Code PIN modifié localement ! La mise à jour serveur aura lieu à la prochaine synchro."
          : "Code PIN modifié et synchronisé avec succès !"
      );
      setOldPin("");
      setNewPin("");
      setConfirmPin("");
    } catch (err: unknown) {
      setPinError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setIsUpdatingPin(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {/* En-tête */}
      <div className="flex items-center gap-2 pt-1">
        <Link
          href="/agent/plus"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm active:scale-95"
          aria-label="Retour au menu Plus"
        >
          ‹
        </Link>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Mon compte</h1>
          <p className="text-xs text-gray-500">Identité et sécurité de votre session</p>
        </div>
      </div>

      {/* Profil de l'agent */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100 text-lg font-bold text-primary-800">
            {agentAuth?.nom ? agentAuth.nom.substring(0, 2).toUpperCase() : "AG"}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 truncate">
              {agentAuth?.nom || "Agent IKA-MARA"}
            </h2>
            <p className="text-xs font-semibold text-primary-700">
              Identifiant : {agentAuth?.identifiant || "Non défini"}
            </p>
            {agentAuth?.telephone && (
              <p className="text-xs text-gray-500">Tél : {agentAuth.telephone}</p>
            )}
          </div>
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
            {agentAuth?.statut === "actif" ? "Actif" : "En service"}
          </span>
        </div>

        {agentAuth?.lastLoginAt && (
          <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-400">
            Dernière connexion : {formatDateTime(new Date(agentAuth.lastLoginAt))}
          </div>
        )}
      </div>

      {/* Formulaire Changement de PIN */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600 text-base">
            🔒
          </span>
          <div>
            <h2 className="text-sm font-bold text-gray-900">Changer de code PIN</h2>
            <p className="text-xs text-gray-500">Saisissez l'ancien code puis le nouveau (6 chiffres)</p>
          </div>
        </div>

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
              Nouveau code PIN (6 chiffres)
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
              Confirmer le nouveau code PIN
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
            <div className="rounded-xl bg-red-50 p-2.5 text-xs font-semibold text-red-600 border border-red-200">
              ⚠️ {pinError}
            </div>
          )}

          {pinSuccess && (
            <div className="rounded-xl bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
              ✓ {pinSuccess}
            </div>
          )}

          {agentAuth?.pendingPinUpdate && (
            <div className="rounded-xl bg-amber-50 p-2.5 text-xs font-medium text-amber-800 border border-amber-200">
              ℹ️ Un nouveau PIN a été enregistré localement et sera mis à jour sur le serveur dès la prochaine synchronisation en ligne.
            </div>
          )}

          <button
            type="submit"
            disabled={isUpdatingPin}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-700 py-3 text-xs font-bold text-white shadow-sm hover:bg-primary-800 active:scale-98 disabled:opacity-50"
          >
            {isUpdatingPin ? "Modification en cours..." : "Modifier mon code PIN"}
          </button>
        </form>
      </div>
    </div>
  );
}
