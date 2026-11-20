"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { formatMontant, formatDate, formatDateTime, badgeVolet, libelleVolet } from "@/lib/utils/format";

interface AgentOption {
  id: string;
  nom: string;
  identifiant: string;
}

interface CommissionLigne {
  souscription_id: string;
  membre_id: string;
  numero: string;
  nom: string;
  prenom: string;
  telephone: string;
  quartier: string;
  agent_id: string;
  agent_nom: string;
  agent_identifiant: string;
  volet: "mara" | "pari" | "djourou";
  montant_jour: number;
  parts_commission: number;
  montant_commission: number;
  statut_prelevement: "prelevee" | "a_prelever";
  operation_id: string | null;
  date_prelevement: string | null;
  annule_ref: string | null;
}

const MOIS_NOMS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export default function AdminCommissionsPage() {
  const now = new Date();
  const [annee, setAnnee] = useState<number>(now.getFullYear());
  const [mois, setMois] = useState<number>(now.getMonth() + 1);

  // Filtres
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [voletFilter, setVoletFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Données
  const [lignes, setLignes] = useState<CommissionLigne[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [cartes, setCartes] = useState({
    commissions_acquises: 0,
    commissions_a_prelever: 0,
    membres_concernes: 0,
    total_annee: 0,
  });
  const [cloture, setCloture] = useState<{
    est_cloture: boolean;
    date_cloture: string | null;
    cloture_par: string | null;
    nombre_commissions: number;
    montant_total: number;
  }>({
    est_cloture: false,
    date_cloture: null,
    cloture_par: null,
    nombre_commissions: 0,
    montant_total: 0,
  });

  // Modal Clôture
  const [showClotureModal, setShowClotureModal] = useState<boolean>(false);
  const [clotureLoading, setClotureLoading] = useState<boolean>(false);

  // Modal Annulation (écriture inverse)
  const [commissionToCancel, setCommissionToCancel] = useState<CommissionLigne | null>(null);
  const [cancelMotif, setCancelMotif] = useState<string>("");
  const [cancelLoading, setCancelLoading] = useState<boolean>(false);

  // États génériques
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Chargement des données
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set("annee", String(annee));
      p.set("mois", String(mois));
      if (agentFilter) p.set("agent_id", agentFilter);
      if (voletFilter) p.set("volet", voletFilter);
      if (search) p.set("search", search);

      const res = await fetch(`/api/admin/commissions?${p.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Erreur de chargement");

      setLignes(json.lignes || []);
      setAgents(json.agents || []);
      if (json.cartes) setCartes(json.cartes);
      if (json.cloture) setCloture(json.cloture);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    startTransition(() => {
      fetchData();
    });
  }, [annee, mois, agentFilter, voletFilter]);

  // Exécution de la clôture mensuelle
  const handleCloturerMois = async () => {
    setClotureLoading(true);
    try {
      const res = await fetch("/api/admin/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annee, mois }),
      });
      const json = await res.json();
      if (!json.success) {
        if (json.deja_cloture) {
          alert(json.message);
          setShowClotureModal(false);
          fetchData();
          return;
        }
        throw new Error(json.error || "Échec de la clôture");
      }

      setNotification({ type: "ok", msg: json.message });
      setShowClotureModal(false);
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur lors de la clôture");
    } finally {
      setClotureLoading(false);
      setTimeout(() => setNotification(null), 6000);
    }
  };

  // Annulation par écriture inverse
  const handleAnnulerCommission = async () => {
    if (!commissionToCancel || !commissionToCancel.operation_id) return;
    if (!cancelMotif.trim()) {
      alert("Le motif d'annulation est obligatoire.");
      return;
    }

    setCancelLoading(true);
    try {
      const res = await fetch("/api/annulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id: commissionToCancel.operation_id,
          motif: cancelMotif.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec de l'annulation");

      setNotification({ type: "ok", msg: json.message });
      setCommissionToCancel(null);
      setCancelMotif("");
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur d'annulation");
    } finally {
      setCancelLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Export Excel CSV
  const handleExportExcel = () => {
    if (lignes.length === 0) return;

    const entetes = [
      "N° Adhérent",
      "Nom & Prénom",
      "Téléphone",
      "Quartier",
      "Agent Collecteur",
      "Volet",
      "Cotisation Journalière (F CFA)",
      "Parts Commission",
      "Montant Commission (F CFA)",
      "Statut Prélèvement",
      "Date Prélèvement",
    ];

    const lignesExport = lignes.map((l) => [
      `"${l.numero}"`,
      `"${l.prenom} ${l.nom}"`,
      `"${l.telephone}"`,
      `"${l.quartier}"`,
      `"${l.agent_nom} (${l.agent_identifiant})"`,
      `"${libelleVolet(l.volet)}"`,
      l.montant_jour,
      l.parts_commission,
      l.montant_commission,
      `"${l.statut_prelevement === "prelevee" ? "Prélevée" : "À prélever"}"`,
      `"${l.date_prelevement ? formatDate(l.date_prelevement) : "—"}"`,
    ]);

    const csvContent =
      "\uFEFF" +
      [entetes.join(";"), ...lignesExport.map((row) => row.join(";"))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IKA-MARA_Commissions_${MOIS_NOMS[mois - 1]}_${annee}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast de notification */}
      {notification && (
        <div
          className={`flex items-center justify-between rounded-xl p-4 text-sm font-medium shadow-lg transition-all ${
            notification.type === "ok"
              ? "bg-emerald-600 text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          <span>{notification.msg}</span>
          <button onClick={() => setNotification(null)} className="ml-3 text-white/80 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* En-tête : Titre & Sélecteur Mois/Année & Bouton Clôture */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
              Comptabilité
            </span>
            <span className="text-xs text-gray-500">IKA-MARA</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-950 sm:text-3xl">
            Commissions & Clôture mensuelle
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Prélèvement automatique des commissions par souscription (défaut : 1 part × montant journalier)
          </p>
        </div>

        {/* Sélecteur de période et action Clôture */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={mois}
            onChange={(e) => setMois(Number(e.target.value))}
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-800 shadow-xs focus:border-amber-500 focus:outline-hidden"
          >
            {MOIS_NOMS.map((nom, idx) => (
              <option key={idx + 1} value={idx + 1}>
                {nom}
              </option>
            ))}
          </select>

          <select
            value={annee}
            onChange={(e) => setAnnee(Number(e.target.value))}
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-800 shadow-xs focus:border-amber-500 focus:outline-hidden"
          >
            {[2024, 2025, 2026, 2027].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          {cloture.est_cloture ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
              <span>✅</span> Mois déjà clôturé
            </span>
          ) : (
            <button
              onClick={() => setShowClotureModal(true)}
              className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700 active:scale-95"
            >
              ⚡ Clôturer le mois de {MOIS_NOMS[mois - 1]}
            </button>
          )}
        </div>
      </div>

      {/* Bannière d'état de clôture */}
      {cloture.est_cloture && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-950">
          <div>
            <span className="font-bold">Clôture officielle enregistrée : </span>
            {cloture.nombre_commissions} commissions prélevées pour un total de{" "}
            <strong>{formatMontant(cloture.montant_total)}</strong>
          </div>
          <span className="text-emerald-700">
            Effectuée {cloture.date_cloture ? formatDateTime(cloture.date_cloture) : ""}
            {cloture.cloture_par ? ` par ${cloture.cloture_par}` : ""}
          </span>
        </div>
      )}

      {/* Cartes métriques clés */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Commissions acquises
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 sm:text-2xl">
            {formatMontant(cartes.commissions_acquises)}
          </p>
          <span className="text-xs text-gray-500">Prélevées pour {MOIS_NOMS[mois - 1]}</span>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            À prélever
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-amber-700 sm:text-2xl">
            {formatMontant(cartes.commissions_a_prelever)}
          </p>
          <span className="text-xs text-gray-500">Souscriptions en attente</span>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Souscriptions actives
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-gray-900 sm:text-2xl">
            {cartes.membres_concernes}
          </p>
          <span className="text-xs text-gray-500">Adhérents avec cotisation active</span>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-xs">
          <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
            Cumul Année {annee}
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-amber-950 sm:text-2xl">
            {formatMontant(cartes.total_annee)}
          </p>
          <span className="text-xs text-amber-700">Revenus de gestion annuels</span>
        </div>
      </div>

      {/* Barre de filtres et d'export */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600">Filtrer par agent</label>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:border-amber-500 focus:outline-hidden"
            >
              <option value="">Tous les agents</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.nom} ({ag.identifiant})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600">Filtrer par volet</label>
            <select
              value={voletFilter}
              onChange={(e) => setVoletFilter(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:border-amber-500 focus:outline-hidden"
            >
              <option value="">Tous les volets</option>
              <option value="mara">Ika-Mara (Épargne)</option>
              <option value="pari">Ika-Pari (Tontine)</option>
              <option value="djourou">Ika-Djourou (Crédit)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600">Rechercher membre</label>
            <input
              type="text"
              placeholder="N° ou nom adhérent…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-amber-500 focus:outline-hidden"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 active:scale-95 disabled:opacity-50"
            >
              {loading ? "Chargement…" : "Appliquer les filtres"}
            </button>
            <button
              onClick={() => {
                setAgentFilter("");
                setVoletFilter("");
                setSearch("");
                setTimeout(() => fetchData(), 50);
              }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Réinitialiser
            </button>
          </div>

          <button
            onClick={handleExportExcel}
            disabled={lignes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
          >
            <span>📥 Exporter Excel (.csv)</span>
          </button>
        </div>
      </div>

      {/* Tableau détaillé des commissions par membre/volet */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-bold text-gray-950">
            Détail des commissions pour {MOIS_NOMS[mois - 1]} {annee} ({lignes.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                <th className="py-3 px-4">Adhérent</th>
                <th className="py-3 px-4">Agent</th>
                <th className="py-3 px-4 text-center">Volet</th>
                <th className="py-3 px-4 text-right">Cotisation/jour</th>
                <th className="py-3 px-4 text-center">Parts</th>
                <th className="py-3 px-4 text-right">Commission</th>
                <th className="py-3 px-4 text-center">Statut</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lignes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-gray-500">
                    Aucune commission ne correspond aux filtres
                  </td>
                </tr>
              ) : (
                lignes.map((l) => {
                  const estPrelevee = l.statut_prelevement === "prelevee";
                  const badgeColor = badgeVolet(l.volet);

                  return (
                    <tr key={`${l.membre_id}_${l.volet}`} className="hover:bg-gray-50/50">
                      <td className="py-3 px-4">
                        <Link
                          href={`/admin/membres/${l.membre_id}`}
                          className="font-bold text-gray-900 hover:underline"
                        >
                          {l.prenom} {l.nom}
                        </Link>
                        <span className="block font-mono text-xs text-gray-500">
                          N° {l.numero} · {l.quartier}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-gray-800">{l.agent_nom}</span>
                        <span className="block font-mono text-xs text-gray-500">
                          {l.agent_identifiant}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeColor}`}
                        >
                          {libelleVolet(l.volet)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-gray-700 whitespace-nowrap">
                        {formatMontant(l.montant_jour)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-700">
                          {l.parts_commission} part(s)
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-900 whitespace-nowrap">
                        {formatMontant(l.montant_commission)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {estPrelevee ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                            Prélevée
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                            À prélever
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {estPrelevee && l.operation_id && !l.annule_ref && (
                          <button
                            onClick={() => {
                              setCommissionToCancel(l);
                              setCancelMotif("");
                            }}
                            className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          >
                            Annuler
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL : CONFIRMATION DE CLÔTURE MENSUELLE                                */}
      {/* ========================================================================= */}
      {showClotureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-950">
              Clôturer le mois de {MOIS_NOMS[mois - 1]} {annee}
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Cette action prélèvera la commission mensuelle pour toutes les souscriptions actives de ce mois. L'opération est idempotente et ne pourra pas être ré-exécutée une fois validée.
            </p>

            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Souscriptions à clôturer :</span>
                <span className="font-bold text-gray-900">{cartes.membres_concernes}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Montant total estimé :</span>
                <span className="font-mono font-bold text-amber-900">
                  {formatMontant(cartes.commissions_a_prelever)}
                </span>
              </div>
              <div className="text-xs text-gray-500 pt-1 border-t border-amber-200/60">
                Règle appliquée : prorata temporis pour les souscriptions débutées en cours de mois.
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClotureModal(false)}
                disabled={clotureLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleCloturerMois}
                disabled={clotureLoading}
                className="rounded-xl bg-amber-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-700 active:scale-95 disabled:opacity-40"
              >
                {clotureLoading ? "Clôture en cours…" : "Confirmer la clôture"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : ANNULATION PAR ÉCRITURE INVERSE                                  */}
      {/* ========================================================================= */}
      {commissionToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-700">
              Annulation d'une commission (écriture inverse)
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Conformément à la règle d'immuabilité financière d'IKA-MARA, cette commission sera contre-passée par une écriture inverse liée avec motif obligatoire.
            </p>

            <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs">
              <p>
                <strong>Adhérent :</strong> N° {commissionToCancel.numero} · {commissionToCancel.prenom} {commissionToCancel.nom}
              </p>
              <p>
                <strong>Montant :</strong> {formatMontant(commissionToCancel.montant_commission)} ({libelleVolet(commissionToCancel.volet)})
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold text-gray-700">
                Motif obligatoire de l'annulation *
              </label>
              <textarea
                rows={3}
                required
                value={cancelMotif}
                onChange={(e) => setCancelMotif(e.target.value)}
                placeholder="Ex : Erreur de souscription ou geste commercial..."
                className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-rose-500 focus:outline-hidden"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCommissionToCancel(null);
                  setCancelMotif("");
                }}
                disabled={cancelLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleAnnulerCommission}
                disabled={cancelLoading || !cancelMotif.trim()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 disabled:opacity-40"
              >
                {cancelLoading ? "Annulation…" : "Confirmer la contre-passation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
