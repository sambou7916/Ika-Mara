"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { addToOutbox } from "@/lib/db/outbox";
import { onOutboxChange } from "@/lib/sync/engine";
import { formatMontant, parseMontant, libelleVolet } from "@/lib/utils/format";
import type { Operation, Membre, RemiseCollecte } from "@/lib/types";

type JournalTab = "operations" | "non_visites" | "remise";

export default function JournalAgentPage() {
  const [activeTab, setActiveTab] = useState<JournalTab>("operations");

  // Champs de la remise de collecte
  const [montantRemisInput, setMontantRemisInput] = useState<string>("");
  const [motifEcart, setMotifEcart] = useState<string>("");
  const [loadingRemise, setLoadingRemise] = useState<boolean>(false);
  const [erreurRemise, setErreurRemise] = useState<string | null>(null);
  const [succesRemise, setSuccesRemise] = useState<string | null>(null);

  // Date du jour (YYYY-MM-DD local)
  const todayStr = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  // Données Dexie observées en temps réel
  const data = useLiveQuery(async () => {
    const currentId =
      typeof window !== "undefined"
        ? localStorage.getItem("ika_current_agent")
        : null;

    const agent = currentId
      ? await db.agentAuth.get(currentId.toUpperCase())
      : null;
    const agentId = agent?.agentId;

    // 1. Charger opérations, membres, souscriptions, outbox et remises
    const [allOps, allMembres, allSouscriptions, outboxEntries, allRemises] =
      await Promise.all([
        db.operations.toArray(),
        db.membres.toArray(),
        db.souscriptions.toArray(),
        db.outbox.toArray(),
        db.remises.toArray(),
      ]);

    // Filtrer les opérations du jour de l'agent
    let opsDuJour = allOps.filter((op) => op.date_operation === todayStr);
    if (agentId) {
      opsDuJour = opsDuJour.filter(
        (op) => !op.agent_id || op.agent_id === agentId
      );
    }

    // Trier les opérations par ordre antéchronologique (les plus récentes d'abord)
    opsDuJour.sort((a, b) => b.cree_le.localeCompare(a.cree_le));

    const pendingOpIds = new Set(
      outboxEntries
        .filter((e) => e.table === "operations")
        .map((e) => e.clientId)
    );

    // Dépôts valides (hors annulations)
    const depotsDuJour = opsDuJour.filter(
      (op) =>
        (op.type === "depot" || op.type === "remboursement") &&
        op.statut !== "annulee"
    );

    // Calcul des totaux
    const totalCollecte = depotsDuJour.reduce(
      (sum, op) => sum + (Number(op.montant) || 0),
      0
    );

    const totalMara = depotsDuJour
      .filter((op) => op.volet === "mara")
      .reduce((sum, op) => sum + (Number(op.montant) || 0), 0);

    const totalPari = depotsDuJour
      .filter((op) => op.volet === "pari")
      .reduce((sum, op) => sum + (Number(op.montant) || 0), 0);

    const totalDjourou = depotsDuJour
      .filter((op) => op.volet === "djourou")
      .reduce((sum, op) => sum + (Number(op.montant) || 0), 0);

    // Membres du portefeuille de l'agent
    let membresAgent = allMembres.filter((m) => m.statut === "actif");
    if (agentId) {
      membresAgent = membresAgent.filter((m) => m.agent_id === agentId);
    }

    // Set des membres ayant au moins un versement aujourd'hui
    const membresServisIds = new Set(depotsDuJour.map((op) => op.membre_id));

    // Membres non visités (membres actifs avec souscription active sans aucun dépôt aujourd'hui)
    const membresNonVisites = membresAgent
      .filter((m) => !membresServisIds.has(m.id))
      .map((m) => {
        const subs = allSouscriptions.filter(
          (s) => s.membre_id === m.id && s.statut === "active"
        );
        const montantJourTotal = subs.reduce((sum, s) => sum + s.montant_jour, 0);
        return {
          ...m,
          montantJourTotal,
          souscriptionsCount: subs.length,
        };
      })
      .filter((m) => m.souscriptionsCount > 0);

    // 2. Vérifier si une remise a déjà été effectuée aujourd'hui par cet agent
    const remiseDuJour = allRemises.find(
      (r) =>
        r.date_remise === todayStr &&
        (!agentId || r.agent_id === agentId)
    );

    // Map rapide des noms de membres
    const membresMap = new Map<string, Membre>();
    for (const m of allMembres) {
      membresMap.set(m.id, m);
    }

    return {
      agent,
      opsDuJour,
      depotsDuJour,
      totalCollecte,
      totalMara,
      totalPari,
      totalDjourou,
      membresNonVisites,
      remiseDuJour,
      pendingOpIds,
      membresMap,
    };
  }, [todayStr]);

  const montantAttendu = data?.totalCollecte ?? 0;

  // Calcul de l'écart de remise
  const montantRemisNumerique = useMemo(() => {
    if (montantRemisInput === "") return montantAttendu;
    return parseMontant(montantRemisInput);
  }, [montantRemisInput, montantAttendu]);

  const ecartRemise = montantRemisNumerique - montantAttendu;

  // Validation et soumission de la remise de collecte
  async function handleValiderRemise(e: React.FormEvent) {
    e.preventDefault();
    setErreurRemise(null);
    setSuccesRemise(null);

    if (ecartRemise !== 0 && !motifEcart.trim()) {
      setErreurRemise(
        `Un écart de ${formatMontant(
          Math.abs(ecartRemise)
        )} a été constaté (${ecartRemise < 0 ? "manquant" : "excédent"}). Le motif de l'écart est obligatoire.`
      );
      return;
    }

    setLoadingRemise(true);

    try {
      const currentId =
        typeof window !== "undefined"
          ? localStorage.getItem("ika_current_agent")
          : null;
      const agent = currentId
        ? await db.agentAuth.get(currentId.toUpperCase())
        : null;
      const agentId = agent?.agentId || "00000000-0000-0000-0000-000000000000";

      const remiseId = crypto.randomUUID();

      const nouvelleRemise: RemiseCollecte = {
        id: remiseId,
        agent_id: agentId,
        date_remise: todayStr,
        montant_attendu: montantAttendu,
        montant_remis: montantRemisNumerique,
        montant: montantRemisNumerique,
        ecart: ecartRemise,
        motif: ecartRemise !== 0 ? motifEcart.trim() : null,
        commentaire:
          ecartRemise !== 0
            ? `Attendu: ${montantAttendu} F | Remis: ${montantRemisNumerique} F | Écart: ${ecartRemise} F | Motif: ${motifEcart.trim()}`
            : `Remise intégrale : ${montantRemisNumerique} F`,
        statut: "a_confirmer", // En attente de validation par l'administrateur
        cree_le: new Date().toISOString(),
      };

      // Écriture locale immédiate dans Dexie & Outbox
      await addToOutbox(
        "remises_collecte",
        nouvelleRemise as unknown as Record<string, unknown>,
        remiseId
      );

      void onOutboxChange();

      setSuccesRemise(
        "Remise de collecte enregistrée avec succès. Elle est en attente de confirmation par l'administrateur."
      );
    } catch (err) {
      console.error("[Remise] Erreur :", err);
      setErreurRemise(
        err instanceof Error ? err.message : "Erreur lors de la remise"
      );
    } finally {
      setLoadingRemise(false);
    }
  }

  const todayFormatted = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const opsCount = data?.depotsDuJour?.length ?? 0;
  const nonVisitesCount = data?.membresNonVisites?.length ?? 0;
  const isRemiseFaite = !!data?.remiseDuJour;

  return (
    <div className="space-y-4">
      {/* 1. En-tête */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <p className="text-xs font-semibold capitalize text-primary-700">
            {todayFormatted}
          </p>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Journal & Remise
          </h1>
        </div>

        <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
          Hors-ligne garanti
        </span>
      </div>

      {/* 2. Onglets de sélection */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-gray-200/80 p-1 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab("operations")}
          className={`rounded-xl py-2.5 transition-all text-center ${
            activeTab === "operations"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Opérations ({opsCount})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("non_visites")}
          className={`rounded-xl py-2.5 transition-all text-center ${
            activeTab === "non_visites"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Non visités ({nonVisitesCount})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("remise")}
          className={`rounded-xl py-2.5 transition-all text-center ${
            activeTab === "remise"
              ? "bg-white text-primary-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Remise {isRemiseFaite ? "✓" : ""}
        </button>
      </div>

      {/* =====================================================================
          ONGLET 1 : OPÉRATIONS DU JOUR
      ===================================================================== */}
      {activeTab === "operations" && (
        <div className="space-y-3.5">
          {/* Carte Résumé de Collecte */}
          <div className="rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-primary-950 p-5 text-white shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary-200">
                Total collecté aujourd&apos;hui
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm">
                {opsCount} opération{opsCount > 1 ? "s" : ""}
              </span>
            </div>

            <p className="mt-2 font-mono text-3xl font-bold text-white">
              {formatMontant(data?.totalCollecte ?? 0)}
            </p>

            {/* Répartition par volet */}
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-xs">
              <div>
                <span className="text-xs text-green-300 font-bold block">
                  Ika-Mara
                </span>
                <span className="font-mono font-bold text-white text-xs">
                  {formatMontant(data?.totalMara ?? 0)}
                </span>
              </div>

              <div>
                <span className="text-xs text-amber-300 font-bold block">
                  Ika-Pari
                </span>
                <span className="font-mono font-bold text-white text-xs">
                  {formatMontant(data?.totalPari ?? 0)}
                </span>
              </div>

              <div>
                <span className="text-xs text-red-300 font-bold block">
                  Ika-Djourou
                </span>
                <span className="font-mono font-bold text-white text-xs">
                  {formatMontant(data?.totalDjourou ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Liste des opérations du jour */}
          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
              Journal des encaissements ({opsCount})
            </h2>

            {data?.opsDuJour && data.opsDuJour.length > 0 ? (
              <div className="divide-y divide-gray-100 rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden text-xs">
                {data.opsDuJour.map((op) => {
                  const m = data.membresMap.get(op.membre_id);
                  const isPending = data.pendingOpIds.has(op.id);
                  const heure = new Date(op.cree_le).toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <Link
                      key={op.id}
                      href={`/agent/recu?id=${op.id}`}
                      className="flex items-center justify-between p-3.5 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-primary-900">
                            N° {m?.numero || "????"}
                          </span>
                          <span className="font-bold text-gray-900">
                            {m?.prenom} {m?.nom}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="capitalize font-semibold text-gray-700">
                            {libelleVolet(op.volet)}
                          </span>
                          <span>· {heure}</span>

                          {/* Badge de synchro */}
                          {isPending ? (
                            <span className="rounded-full bg-amber-50 px-1.5 py-0.2 text-xs font-bold text-amber-800 border border-amber-200">
                              ⏳ en attente
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-50 px-1.5 py-0.2 text-xs font-bold text-emerald-800 border border-emerald-200">
                              ✓ synchro
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-mono font-bold text-sm text-gray-900">
                          +{formatMontant(op.montant)}
                        </p>
                        <span className="text-xs text-primary-600 font-semibold">
                          Reçu ›
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center text-xs text-gray-400">
                <span className="text-3xl block mb-1">📋</span>
                Aucun encaissement enregistré aujourd&apos;hui.
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          ONGLET 2 : MEMBRES NON VISITÉS
      ===================================================================== */}
      {activeTab === "non_visites" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Membres à visiter ({nonVisitesCount})
            </h2>
            <span className="text-xs text-gray-400">
              Cotisation due sans versement aujourd&apos;hui
            </span>
          </div>

          {data?.membresNonVisites && data.membresNonVisites.length > 0 ? (
            <div className="space-y-2">
              {data.membresNonVisites.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-col items-center justify-center rounded-xl bg-primary-100 text-primary-900 font-mono font-bold text-xs">
                      <span className="text-[8px] font-bold opacity-60">N°</span>
                      <span>{m.numero}</span>
                    </div>

                    <div>
                      <p className="text-sm font-bold text-gray-900">
                        {m.prenom} {m.nom}
                      </p>
                      <p className="text-xs text-gray-500">
                        {m.quartier || "Quartier non précisé"} ·{" "}
                        <strong className="text-gray-700 font-mono">
                          {formatMontant(m.montantJourTotal)}/j
                        </strong>
                      </p>
                    </div>
                  </div>

                  <Link
                    href={`/agent/depot?membre=${m.numero}`}
                    className="flex items-center gap-1 rounded-xl bg-primary-700 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-800 active:scale-95"
                  >
                    <span>➕</span>
                    <span>Encaisser</span>
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center text-xs text-emerald-800 bg-emerald-50/50">
              <span className="text-3xl block mb-2">🎉</span>
              <p className="font-bold text-sm">Tournée terminée !</p>
              <p className="mt-1 text-gray-600">
                Tous les adhérents cotisants de votre portefeuille ont été
                encaissés aujourd&apos;hui.
              </p>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          ONGLET 3 : REMISE DE COLLECTE
      ===================================================================== */}
      {activeTab === "remise" && (
        <div className="space-y-4">
          {/* Si la remise a déjà été effectuée aujourd'hui */}
          {data?.remiseDuJour ? (
            <div className="rounded-3xl border border-emerald-300 bg-emerald-50/80 p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white text-xl shadow-md">
                  ✓
                </div>
                <div>
                  <h3 className="text-base font-bold text-emerald-950">
                    Remise de collecte effectuée
                  </h3>
                  <p className="text-xs text-emerald-800 font-medium">
                    Date : {data.remiseDuJour.date_remise} · Statut :{" "}
                    <span className="font-bold underline">
                      {data.remiseDuJour.statut === "validee"
                        ? "Validée par l'admin"
                        : "À confirmer (validation admin)"}
                    </span>
                  </p>
                </div>
              </div>

              {/* Détails montants */}
              <div className="rounded-2xl bg-white p-4 space-y-2 text-xs border border-emerald-200">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Montant attendu :</span>
                  <span className="font-mono font-bold text-gray-900">
                    {formatMontant(data.remiseDuJour.montant_attendu)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Montant remis :</span>
                  <span className="font-mono font-bold text-primary-900 text-sm">
                    {formatMontant(data.remiseDuJour.montant_remis)}
                  </span>
                </div>

                {data.remiseDuJour.ecart !== 0 && (
                  <div className="flex items-center justify-between border-t border-gray-100 pt-1.5">
                    <span className="text-amber-800 font-bold">
                      Écart ({data.remiseDuJour.ecart < 0 ? "manquant" : "excédent"}) :
                    </span>
                    <span className="font-mono font-bold text-amber-700">
                      {formatMontant(Math.abs(data.remiseDuJour.ecart))}
                    </span>
                  </div>
                )}

                {data.remiseDuJour.motif && (
                  <div className="border-t border-gray-100 pt-1.5 text-gray-600">
                    <span className="font-semibold text-gray-500">Motif de l&apos;écart :</span>{" "}
                    {data.remiseDuJour.motif}
                  </div>
                )}
              </div>

              {/* Règle de verrouillage */}
              <div className="rounded-xl bg-white/70 p-3 text-xs text-gray-600 border border-emerald-200">
                🔒 <strong>Opérations verrouillées :</strong> La remise de
                collecte étant enregistrée, les écritures de cette journée sont
                désormais figées côté agent. La confirmation officielle
                arrivera lors de la validation par l&apos;administrateur.
              </div>
            </div>
          ) : (
            /* Formulaire pour effectuer la remise de collecte */
            <form
              onSubmit={handleValiderRemise}
              className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-4"
            >
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Clôture et remise de collecte
                </h3>
                <p className="text-xs text-gray-500">
                  Validez le montant des cotisations collectées aujourd&apos;hui à
                  remettre à la structure.
                </p>
              </div>

              {erreurRemise && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 font-medium">
                  ⚠️ {erreurRemise}
                </div>
              )}

              {succesRemise && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 font-medium">
                  ✓ {succesRemise}
                </div>
              )}

              {/* Récapitulatif montant attendu */}
              <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Montant attendu (dépôts du jour)
                </span>
                <p className="mt-1 font-mono text-3xl font-bold text-primary-900">
                  {formatMontant(montantAttendu)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Calculé depuis Dexie sur les {opsCount} encaissement(s) du jour.
                </p>
              </div>

              {/* Saisie montant remis */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="montantRemis"
                    className="block text-xs font-bold uppercase tracking-wider text-gray-600"
                  >
                    Montant remis (F CFA)
                  </label>
                  <button
                    type="button"
                    onClick={() => setMontantRemisInput(String(montantAttendu))}
                    className="text-xs font-bold text-primary-700 hover:underline"
                  >
                    Remettre l&apos;exact ({formatMontant(montantAttendu)})
                  </button>
                </div>

                <div className="relative">
                  <input
                    id="montantRemis"
                    type="text"
                    inputMode="numeric"
                    value={
                      montantRemisInput !== ""
                        ? parseMontant(montantRemisInput).toLocaleString("fr-FR")
                        : montantAttendu.toLocaleString("fr-FR")
                    }
                    onChange={(e) => setMontantRemisInput(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-4 py-3.5 text-right font-mono text-2xl font-bold text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none"
                  />
                  <span className="absolute left-4 top-4 text-sm font-bold text-gray-400">
                    F CFA
                  </span>
                </div>
              </div>

              {/* Affichage de l'écart */}
              {ecartRemise !== 0 && (
                <div
                  className={`rounded-2xl p-3 text-xs border ${
                    ecartRemise < 0
                      ? "bg-amber-50 border-amber-200 text-amber-900"
                      : "bg-primary-50 border-primary-200 text-primary-900"
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span>
                      Écart constaté ({ecartRemise < 0 ? "Manquant" : "Excédent"}) :
                    </span>
                    <span className="font-mono text-sm">
                      {formatMontant(Math.abs(ecartRemise))}
                    </span>
                  </div>

                  <p className="mt-1 text-xs">
                    {ecartRemise < 0
                      ? "Le montant remis est inférieur au total encaissé."
                      : "Le montant remis est supérieur au total encaissé."}
                  </p>
                </div>
              )}

              {/* Champ Motif obligatoire si écart */}
              {ecartRemise !== 0 && (
                <div>
                  <label
                    htmlFor="motifEcart"
                    className="block text-xs font-bold uppercase tracking-wider text-red-700 mb-1"
                  >
                    Motif de l&apos;écart (obligatoire)
                  </label>
                  <textarea
                    id="motifEcart"
                    rows={2}
                    value={motifEcart}
                    onChange={(e) => setMotifEcart(e.target.value)}
                    placeholder="Expliquez la cause du manquant ou de l'excédent…"
                    className="w-full rounded-xl border border-amber-300 bg-amber-50/30 p-3 text-xs font-medium text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none"
                  />
                </div>
              )}

              {/* Bouton de validation de la remise */}
              <button
                type="submit"
                disabled={loadingRemise || (ecartRemise !== 0 && !motifEcart.trim())}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary-700 py-4 px-4 font-bold text-white shadow-lg active:scale-95 hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 text-sm"
              >
                {loadingRemise ? (
                  <span>Enregistrement de la remise…</span>
                ) : (
                  <span>
                    Valider la remise · {formatMontant(montantRemisNumerique)}
                  </span>
                )}
              </button>

              <p className="text-xs text-gray-400 text-center leading-tight">
                🔒 Dès validation, la collecte du jour sera transmise à la caisse
                et les opérations seront verrouillées côté agent.
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
