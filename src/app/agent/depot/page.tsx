"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { addToOutbox } from "@/lib/db/outbox";
import { onOutboxChange } from "@/lib/sync/engine";
import type { Membre, Souscription, Operation, VoletType, SoldeMembre } from "@/lib/types";
import { formatMontant, parseMontant, libelleVolet } from "@/lib/utils/format";

function NouveauDepotContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // États du formulaire
  const [numero, setNumero] = useState<string>("");
  const [selectedVolet, setSelectedVolet] = useState<VoletType | null>(null);
  const [montant, setMontant] = useState<number>(0);
  const [dateOperation, setDateOperation] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState<boolean>(false);
  const [duplicateSecondsAgo, setDuplicateSecondsAgo] = useState<number>(0);

  // Pré-remplissage via URL (ex: ?membre=0001 ou ?numero=0001)
  useEffect(() => {
    const paramNumero = searchParams.get("membre") || searchParams.get("numero");
    if (paramNumero && paramNumero.length === 4) {
      setNumero(paramNumero);
    }
  }, [searchParams]);

  // Recherche du membre dans Dexie dès que 4 chiffres sont saisis
  const membre = useLiveQuery(async () => {
    if (numero.trim().length !== 4) return null;
    const m = await db.membres.where("numero").equals(numero.trim()).first();
    return m ?? null;
  }, [numero]);

  // Souscriptions actives du membre
  const souscriptions = useLiveQuery(async () => {
    if (!membre?.id) return [];
    return db.souscriptions
      .where("membre_id")
      .equals(membre.id)
      .and((s) => s.statut === "active")
      .toArray();
  }, [membre?.id]);

  // Sélection automatique du premier volet disponible
  useEffect(() => {
    if (souscriptions && souscriptions.length > 0) {
      if (!selectedVolet || !souscriptions.some((s) => s.volet === selectedVolet)) {
        const first = souscriptions[0];
        setSelectedVolet(first.volet);
        setMontant(first.montant_jour);
      }
    } else {
      setSelectedVolet(null);
    }
  }, [souscriptions, selectedVolet]);

  // Souscription actuellement sélectionnée
  const currentSouscription = useMemo(() => {
    if (!souscriptions || !selectedVolet) return null;
    return souscriptions.find((s) => s.volet === selectedVolet) ?? null;
  }, [souscriptions, selectedVolet]);

  // Mettre à jour le montant par défaut quand le volet change
  function handleSelectVolet(volet: VoletType) {
    setSelectedVolet(volet);
    const sub = souscriptions?.find((s) => s.volet === volet);
    if (sub) {
      setMontant(sub.montant_jour);
    }
  }

  // Calcul des arriérés pour le volet sélectionné
  const arrieres = useLiveQuery(async () => {
    if (!membre?.id || !currentSouscription) {
      return { joursEnRetard: 0, montantDu: 0 };
    }

    const mId = membre.id;
    const v = currentSouscription.volet;
    const montantJour = currentSouscription.montant_jour;

    // Déterminer la date de départ pour le calcul
    const now = new Date();
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);
    const dateDebutSouscription = new Date(currentSouscription.date_debut);
    const dateReference =
      dateDebutSouscription > debutMois ? dateDebutSouscription : debutMois;

    // Nombre de jours dus jusqu'à aujourd'hui inclus
    const msDiff = now.getTime() - dateReference.getTime();
    const joursDus = Math.max(
      1,
      Math.floor(msDiff / (1000 * 60 * 60 * 24)) + 1
    );

    // Calculer le total des jours déjà couverts par les dépôts sur cette période
    const ops = await db.operations
      .where("membre_id")
      .equals(mId)
      .and(
        (op) =>
          op.volet === v &&
          (op.type === "depot" || op.type === "remboursement") &&
          op.statut === "validee" &&
          new Date(op.date_operation) >= dateReference
      )
      .toArray();

    const joursPayes = ops.reduce(
      (sum, op) => sum + (op.jours_couverts || 1),
      0
    );

    const retard = Math.max(0, joursDus - joursPayes);
    return {
      joursEnRetard: retard,
      montantDu: retard * montantJour,
    };
  }, [membre?.id, currentSouscription]);

  // Calcul du nombre de jours couverts par le montant saisi
  const joursCouverts = useMemo(() => {
    if (!currentSouscription || currentSouscription.montant_jour <= 0) return 1;
    const j = Math.floor(montant / currentSouscription.montant_jour);
    return j > 0 ? j : 1;
  }, [montant, currentSouscription]);

  // Vérifier la détection de doublon (même membre, volet, montant, date dans les 60s)
  async function checkForDuplicate(): Promise<number | null> {
    if (!membre?.id || !selectedVolet) return null;

    const recentOps = await db.operations
      .where("membre_id")
      .equals(membre.id)
      .and(
        (op) =>
          op.volet === selectedVolet &&
          op.montant === montant &&
          op.date_operation === dateOperation &&
          op.type === "depot" &&
          op.statut !== "annulee"
      )
      .toArray();

    const now = Date.now();
    for (const op of recentOps) {
      const opTime = new Date(op.cree_le).getTime();
      const diffSec = Math.floor((now - opTime) / 1000);
      if (diffSec >= 0 && diffSec < 60) {
        return diffSec;
      }
    }

    return null;
  }

  // Soumission du formulaire
  async function handleSubmit(e?: React.FormEvent, forceDuplicate = false) {
    if (e) e.preventDefault();
    setErreur(null);

    if (!membre) {
      setErreur("Veuillez sélectionner un adhérent valide");
      return;
    }

    if (membre.statut !== "actif") {
      setErreur("Ce membre est inactif. Dépôt impossible.");
      return;
    }

    if (!selectedVolet || !currentSouscription) {
      setErreur("Veuillez choisir un volet de cotisation");
      return;
    }

    if (!montant || montant <= 0) {
      setErreur("Le montant doit être supérieur à zéro");
      return;
    }

    // Vérifier les doublons de moins de 60 secondes
    if (!forceDuplicate) {
      const duplicateSec = await checkForDuplicate();
      if (duplicateSec !== null) {
        setDuplicateSecondsAgo(duplicateSec);
        setShowDuplicateModal(true);
        return;
      }
    }

    setLoading(true);

    try {
      // 1. Récupérer l'agent courant
      const currentId =
        typeof window !== "undefined"
          ? localStorage.getItem("ika_current_agent")
          : null;
      const agentAuth = currentId
        ? await db.agentAuth.get(currentId.toUpperCase())
        : null;

      const agentId = agentAuth?.agentId || "00000000-0000-0000-0000-000000000000";

      // 2. Générer l'identifiant UUID client
      const operationId = crypto.randomUUID();

      // 3. Construire l'opération
      const nouvelleOperation: Operation = {
        id: operationId,
        type: "depot",
        volet: selectedVolet,
        membre_id: membre.id,
        agent_id: agentId,
        montant: Math.round(montant),
        jours_couverts: joursCouverts,
        date_operation: dateOperation,
        cree_le: new Date().toISOString(),
        annule_ref: null,
        statut: "validee",
        motif: `Dépôt ${joursCouverts} jour(s) - ${libelleVolet(selectedVolet)}`,
      };

      // 4. Écrire dans Dexie & Outbox
      await addToOutbox("operations", nouvelleOperation as unknown as Record<string, unknown>, operationId);

      // 5. Mettre à jour le solde localement dans la table soldes
      const existingSolde = await db.soldes
        .where("[membre_id+volet]")
        .equals([membre.id, selectedVolet])
        .first();

      if (existingSolde) {
        await db.soldes.update(existingSolde.membre_id, {
          solde: (existingSolde.solde || 0) + montant,
        });
      } else {
        const newSolde: SoldeMembre = {
          membre_id: membre.id,
          numero: membre.numero,
          nom: membre.nom,
          prenom: membre.prenom,
          agent_id: agentId,
          volet: selectedVolet,
          solde: montant,
        };
        await db.soldes.put(newSolde);
      }

      // 6. Déclencher la notification d'outbox (déclenche la synchro si en ligne)
      void onOutboxChange();

      // 7. Rediriger vers le reçu
      router.push(`/agent/recu?id=${operationId}`);
    } catch (err) {
      console.error("[Depot] Erreur enregistrement :", err);
      setErreur(
        err instanceof Error ? err.message : "Erreur lors de l'enregistrement"
      );
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Link
            href="/agent"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 text-gray-700 shadow-sm active:scale-95"
          >
            ‹
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Nouveau dépôt</h1>
        </div>

        <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
          ⚡ Hors-ligne garanti
        </span>
      </div>

      {erreur && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800">
          ⚠️ {erreur}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* 1. Saisie du numéro d'adhérent */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <label
            htmlFor="numero"
            className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1.5"
          >
            Numéro d&apos;adhérent (4 chiffres)
          </label>

          <div className="relative">
            <input
              id="numero"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={numero}
              onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))}
              placeholder="0001"
              autoFocus
              className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-4 py-3 text-center font-mono text-2xl font-bold tracking-widest text-primary-950 placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-300 focus:border-primary-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
            {numero.length === 4 && (
              <span className="absolute right-3.5 top-3.5 text-base">
                {membre ? "✅" : "❌"}
              </span>
            )}
          </div>

          {/* Affichage des données du membre dès 4 chiffres */}
          {numero.length === 4 && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              {membre ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-gray-900">
                      {membre.prenom} {membre.nom}
                    </p>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
                        membre.statut === "actif"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {membre.statut === "actif" ? "Actif" : "Inactif"}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500">
                    {membre.profession || "Profession non renseignée"} · Quartier :{" "}
                    <strong className="text-gray-700">
                      {membre.quartier || "Non précisé"}
                    </strong>
                  </p>

                  {membre.statut !== "actif" && (
                    <p className="mt-1 text-xs font-semibold text-red-600">
                      ⛔ Ce membre est actuellement inactif. Tout encaissement
                      est bloqué.
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-center py-1">
                  <p className="text-xs font-medium text-red-600">
                    Adhérent introuvable avec le numéro « {numero} ».
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 2. Sélecteur de volet (si le membre est trouvé et actif) */}
        {membre && membre.statut === "actif" && (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600">
                Volet de cotisation
              </label>

              {souscriptions && souscriptions.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {souscriptions.map((sub) => {
                    const isSelected = selectedVolet === sub.volet;
                    const colorBorder =
                      sub.volet === "mara"
                        ? "border-green-600 text-green-700 bg-green-50/50"
                        : sub.volet === "pari"
                        ? "border-amber-600 text-amber-700 bg-amber-50/50"
                        : "border-red-600 text-red-700 bg-red-50/50";

                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => handleSelectVolet(sub.volet)}
                        className={`flex flex-col items-center justify-center rounded-xl p-2.5 text-center transition-all border ${
                          isSelected
                            ? `${colorBorder} ring-2 ring-primary-500/30 font-bold`
                            : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <span className="text-xs capitalize font-bold">
                          {sub.volet}
                        </span>
                        <span className="text-xs text-gray-500 font-mono mt-0.5">
                          {formatMontant(sub.montant_jour)}/j
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl">
                  Ce membre n&apos;a aucune souscription active.
                </p>
              )}

              {/* Indicateur d'arriérés */}
              {arrieres && selectedVolet && (
                <div
                  className={`mt-2 rounded-xl p-2.5 text-xs font-medium flex items-center justify-between ${
                    arrieres.joursEnRetard > 0
                      ? "bg-amber-50 border border-amber-200 text-amber-900"
                      : "bg-emerald-50 border border-emerald-200 text-emerald-900"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{arrieres.joursEnRetard > 0 ? "⚠️" : "✓"}</span>
                    <span>
                      {arrieres.joursEnRetard > 0
                        ? `${arrieres.joursEnRetard} jour${
                            arrieres.joursEnRetard > 1 ? "s" : ""
                          } non réglé${
                            arrieres.joursEnRetard > 1 ? "s" : ""
                          }`
                        : "Cotisations à jour"}
                    </span>
                  </div>

                  <span className="font-mono font-bold">
                    {arrieres.joursEnRetard > 0
                      ? `${formatMontant(arrieres.montantDu)} dus`
                      : "0 F"}
                  </span>
                </div>
              )}
            </div>

            {/* 3. Montant et Jours couverts */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="montant"
                  className="block text-xs font-bold uppercase tracking-wider text-gray-600"
                >
                  Montant versé (F CFA)
                </label>
                {joursCouverts > 1 && (
                  <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-bold text-primary-800 animate-pulse">
                    Couvre {joursCouverts} jours
                  </span>
                )}
              </div>

              <div className="relative">
                <input
                  id="montant"
                  type="text"
                  inputMode="numeric"
                  value={montant ? montant.toLocaleString("fr-FR") : ""}
                  onChange={(e) => setMontant(parseMontant(e.target.value))}
                  placeholder="1 000"
                  className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-4 py-3.5 text-right font-mono text-2xl font-bold text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                />
                <span className="absolute left-4 top-4 text-sm font-bold text-gray-400">
                  F CFA
                </span>
              </div>

              {/* Raccourcis faciles au pouce */}
              {currentSouscription && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setMontant(currentSouscription.montant_jour)}
                    className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200 active:scale-95"
                  >
                    1 j ({formatMontant(currentSouscription.montant_jour)})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMontant(currentSouscription.montant_jour * 2)
                    }
                    className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200 active:scale-95"
                  >
                    2 j ({formatMontant(currentSouscription.montant_jour * 2)})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMontant(currentSouscription.montant_jour * 5)
                    }
                    className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200 active:scale-95"
                  >
                    5 j
                  </button>
                  {arrieres && arrieres.montantDu > 0 && (
                    <button
                      type="button"
                      onClick={() => setMontant(arrieres.montantDu)}
                      className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 hover:bg-amber-200 active:scale-95"
                    >
                      Régler arriérés ({formatMontant(arrieres.montantDu)})
                    </button>
                  )}
                </div>
              )}

              {/* 4. Date de l'opération */}
              <div className="pt-2 border-t border-gray-100">
                <label
                  htmlFor="dateOperation"
                  className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1"
                >
                  Date de l&apos;opération
                </label>
                <input
                  id="dateOperation"
                  type="date"
                  value={dateOperation}
                  onChange={(e) => setDateOperation(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-3 py-2 text-sm font-medium text-gray-800 focus:border-primary-600 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {/* Bouton d'action principal */}
            <button
              type="submit"
              disabled={loading || !montant || montant <= 0}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary-700 py-4 px-4 font-bold text-white shadow-lg shadow-primary-700/20 transition-all active:scale-[0.98] hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 text-base"
            >
              {loading ? (
                <>
                  <svg
                    className="h-5 w-5 animate-spin text-white"
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
                  <span>Enregistrement en cours…</span>
                </>
              ) : (
                <span>
                  Valider le dépôt · {formatMontant(montant)}{" "}
                  {joursCouverts > 1 ? `(${joursCouverts} j)` : ""}
                </span>
              )}
            </button>
          </>
        )}
      </form>

      {/* Modal d'avertissement de double enregistrement (< 60 secondes) */}
      {showDuplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl text-gray-900 animate-scaleIn">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-2xl text-amber-600 mb-3">
              ⚠️
            </div>

            <h3 className="text-base font-bold text-gray-900">
              Dépôt identique récent détecté
            </h3>

            <p className="mt-2 text-xs text-gray-600 leading-relaxed">
              Une opération de{" "}
              <strong className="text-gray-900 font-mono">
                {formatMontant(montant)}
              </strong>{" "}
              a déjà été enregistrée pour ce membre il y a seulement{" "}
              <strong className="text-amber-700">
                {duplicateSecondsAgo} seconde{duplicateSecondsAgo > 1 ? "s" : ""}
              </strong>
              .
            </p>

            <p className="mt-2 text-xs text-gray-500">
              Voulez-vous vraiment enregistrer un second versement identique ?
            </p>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowDuplicateModal(false)}
                className="flex-1 rounded-xl border border-gray-300 bg-white py-3 text-xs font-bold text-gray-700 hover:bg-gray-50 active:scale-95"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowDuplicateModal(false);
                  void handleSubmit(undefined, true);
                }}
                className="flex-1 rounded-xl bg-amber-600 py-3 text-xs font-bold text-white shadow-md hover:bg-amber-700 active:scale-95"
              >
                Confirmer quand même
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NouveauDepotPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center p-6 text-gray-500">
          <p className="text-sm font-semibold">Chargement du formulaire…</p>
        </div>
      }
    >
      <NouveauDepotContent />
    </Suspense>
  );
}
