"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { formatMontant, formatDate, formatDateTime } from "@/lib/utils/format";

type TabType = "depots" | "retraits" | "soldes";

interface ParametresMara {
  delai_min_retrait_jours: number;
  frais_retrait_pourcent: number;
  frais_retrait_fixe: number;
}

interface AgentOption {
  id: string;
  nom: string;
  identifiant: string;
}

interface DepotItem {
  id: string;
  montant: number;
  jours_couverts: number;
  date_operation: string;
  cree_le: string;
  statut: string;
  motif: string | null;
  annule_ref: string | null;
  membres?: {
    id: string;
    numero: string;
    nom: string;
    prenom: string;
    telephone: string | null;
    quartier: string | null;
  };
  profiles?: {
    id: string;
    nom: string;
    identifiant: string;
  };
}

interface RetraitItem {
  id: string;
  montant: number;
  date_operation: string;
  cree_le: string;
  statut: string;
  motif: string | null;
  membres?: {
    id: string;
    numero: string;
    nom: string;
    prenom: string;
    telephone: string | null;
    quartier: string | null;
    cree_le: string;
  };
  profiles?: {
    id: string;
    nom: string;
    identifiant: string;
  };
  solde_disponible: number;
  anciennete_jours: number;
  delai_atteint: boolean;
  solde_suffisant: boolean;
  peut_valider: boolean;
}

interface RetraitEffectueItem {
  id: string;
  montant: number;
  date_operation: string;
  cree_le: string;
  motif: string | null;
  membres?: {
    id: string;
    numero: string;
    nom: string;
    prenom: string;
    telephone: string | null;
    quartier: string | null;
  };
  profiles?: {
    id: string;
    nom: string;
    identifiant: string;
  };
  /** Solde d'épargne actuel du membre (après ce retrait et les suivants) */
  solde_actuel: number;
}

interface SoldeItem {
  membre_id: string;
  numero: string;
  nom: string;
  prenom: string;
  quartier: string;
  telephone: string;
  statut_membre: string;
  agent_nom: string;
  agent_identifiant: string;
  cumul_depots: number;
  cumul_retraits: number;
  cumul_commissions: number;
  solde_net: number;
}

export default function AdminMaraPage() {
  const [activeTab, setActiveTab] = useState<TabType>("depots");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Données communes
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [parametres, setParametres] = useState<ParametresMara>({
    delai_min_retrait_jours: 30,
    frais_retrait_pourcent: 0,
    frais_retrait_fixe: 0,
  });

  // Filtres
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [search, setSearch] = useState("");

  // Onglet 1 : Dépôts
  const [depots, setDepots] = useState<DepotItem[]>([]);
  const [totauxDepots, setTotauxDepots] = useState({
    total_jour: 0,
    total_mois: 0,
    total_annee: 0,
    total_filtre: 0,
  });

  // Onglet 2 : Retraits à valider
  const [retraits, setRetraits] = useState<RetraitItem[]>([]);
  const [retraitsEffectues, setRetraitsEffectues] = useState<RetraitEffectueItem[]>([]);
  const [retraitToValidate, setRetraitToValidate] = useState<RetraitItem | null>(null);
  const [retraitToRefuse, setRetraitToRefuse] = useState<RetraitItem | null>(null);
  const [refusMotif, setRefusMotif] = useState("");
  const [submittingAction, setSubmittingAction] = useState(false);

  // Onglet 3 : Soldes
  const [soldes, setSoldes] = useState<SoldeItem[]>([]);
  const [totalEpargneNet, setTotalEpargneNet] = useState(0);

  // Modal d'annulation de dépôt (écriture inverse)
  const [depotToCancel, setDepotToCancel] = useState<DepotItem | null>(null);
  const [cancelMotif, setCancelMotif] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);

  // Chargement des données selon l'onglet
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("tab", activeTab);
      if (dateDebut) params.set("date_debut", dateDebut);
      if (dateFin) params.set("date_fin", dateFin);
      if (selectedAgent) params.set("agent_id", selectedAgent);
      if (search) params.set("search", search);

      const res = await fetch(`/api/admin/mara?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || "Erreur de chargement des données");
      }

      if (json.agents) setAgents(json.agents);
      if (json.parametres) setParametres(json.parametres);

      if (activeTab === "depots") {
        setDepots(json.depots || []);
        if (json.totaux) setTotauxDepots(json.totaux);
      } else if (activeTab === "retraits") {
        setRetraits(json.retraits || []);
        setRetraitsEffectues(json.retraits_effectues || []);
      } else if (activeTab === "soldes") {
        setSoldes(json.soldes || []);
        setTotalEpargneNet(json.total_epargne_net || 0);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  // Rechargement automatique : changement d'onglet, de dates, d'agent ou de
  // recherche (la saisie est attendue 400 ms pour ne pas appeler le serveur
  // à chaque touche).
  useEffect(() => {
    const minuteur = setTimeout(() => {
      startTransition(() => {
        fetchData();
      });
    }, 400);
    return () => clearTimeout(minuteur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dateDebut, dateFin, selectedAgent, search]);

  // Validation d'un retrait
  const handleValiderRetrait = async () => {
    if (!retraitToValidate) return;
    setSubmittingAction(true);
    try {
      const res = await fetch("/api/admin/mara", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "valider_retrait",
          demande_id: retraitToValidate.id,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Échec de validation");
      }
      const r = retraitToValidate;
      setNotification({
        type: "ok",
        msg: `Retrait de ${formatMontant(r.montant)} validé pour ${r.membres?.prenom ?? ""} ${
          r.membres?.nom ?? ""
        }. Solde restant : ${formatMontant(r.solde_disponible - r.montant)}.`,
      });
      setRetraitToValidate(null);
      fetchData();
    } catch (err: unknown) {
      setNotification({ type: "err", msg: err instanceof Error ? err.message : "Erreur de validation" });
    } finally {
      setSubmittingAction(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Refus d'un retrait (motif obligatoire)
  const handleRefuserRetrait = async () => {
    if (!retraitToRefuse) return;
    if (!refusMotif.trim()) {
      alert("Le motif de refus est obligatoire.");
      return;
    }
    setSubmittingAction(true);
    try {
      const res = await fetch("/api/admin/mara", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refuser_retrait",
          demande_id: retraitToRefuse.id,
          motif: refusMotif.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Échec du refus");
      }
      setNotification({ type: "ok", msg: json.message || "Demande de retrait refusée." });
      setRetraitToRefuse(null);
      setRefusMotif("");
      fetchData();
    } catch (err: unknown) {
      setNotification({ type: "err", msg: err instanceof Error ? err.message : "Erreur lors du refus" });
    } finally {
      setSubmittingAction(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Annulation d'un dépôt (écriture inverse liée)
  const handleAnnulerDepot = async () => {
    if (!depotToCancel) return;
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
          operation_id: depotToCancel.id,
          motif: cancelMotif.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Échec de l'annulation");
      }
      setNotification({ type: "ok", msg: json.message || "Opération annulée par écriture inverse." });
      setDepotToCancel(null);
      setCancelMotif("");
      fetchData();
    } catch (err: unknown) {
      setNotification({ type: "err", msg: err instanceof Error ? err.message : "Erreur d'annulation" });
    } finally {
      setCancelLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Export Excel des dépôts
  const handleExportDepotsExcel = () => {
    if (depots.length === 0) return;

    const entetes = [
      "Date Opération",
      "Heure Saisie",
      "N° Membre",
      "Adhérent",
      "Téléphone",
      "Quartier",
      "Agent",
      "Identifiant Agent",
      "Montant (F CFA)",
      "Jours Couverts",
      "Statut",
    ];

    const lignes = depots.map((d) => [
      `"${d.date_operation}"`,
      `"${new Date(d.cree_le).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}"`,
      `"${d.membres?.numero || ""}"`,
      `"${(d.membres?.prenom || "") + " " + (d.membres?.nom || "")}"`,
      `"${d.membres?.telephone || ""}"`,
      `"${d.membres?.quartier || ""}"`,
      `"${d.profiles?.nom || ""}"`,
      `"${d.profiles?.identifiant || ""}"`,
      d.montant,
      d.jours_couverts,
      `"${d.statut === "validee" ? "Validée" : "Annulée"}"`,
    ]);

    const csvContent =
      "\uFEFF" +
      [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IKA-MARA_Depots_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export Excel des soldes
  const handleExportSoldesExcel = () => {
    if (soldes.length === 0) return;

    const entetes = [
      "N° Membre",
      "Prénom & Nom",
      "Téléphone",
      "Quartier",
      "Agent Référent",
      "Cumul Dépôts (F CFA)",
      "Cumul Commissions (F CFA)",
      "Cumul Retraits (F CFA)",
      "Solde Net Disponible (F CFA)",
      "Statut Adhérent",
    ];

    const lignes = soldes.map((s) => [
      `"${s.numero}"`,
      `"${s.prenom} ${s.nom}"`,
      `"${s.telephone}"`,
      `"${s.quartier}"`,
      `"${s.agent_nom} (${s.agent_identifiant})"`,
      s.cumul_depots,
      s.cumul_commissions,
      s.cumul_retraits,
      s.solde_net,
      `"${s.statut_membre}"`,
    ]);

    const csvContent =
      "\uFEFF" +
      [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IKA-MARA_Soldes_Epargne_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // IDs des opérations déjà annulées dans la liste des dépôts
  const idsAnnules = new Set(
    depots.filter((d) => d.annule_ref).map((d) => d.annule_ref)
  );

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
          <button
            onClick={() => setNotification(null)}
            className="ml-3 text-white/80 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* En-tête de la page */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
              Volet Épargne
            </span>
            <span className="text-xs text-gray-500">IKA-MARA</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-950 sm:text-3xl">
            Gestion Ika-Mara
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Collecte quotidienne, validation sécurisée des retraits et suivi des soldes disponibles
          </p>
        </div>

        {/* Bannière des paramètres appliqués */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2 text-xs text-emerald-950">
          <span className="font-semibold text-emerald-900">Règles en vigueur :</span>
          <span className="rounded bg-white/80 px-2 py-0.5 font-medium shadow-xs">
            Délai min : <strong className="text-emerald-800">{parametres.delai_min_retrait_jours} jours</strong>
          </span>
          <span className="rounded bg-white/80 px-2 py-0.5 font-medium shadow-xs">
            Frais retrait : <strong className="text-emerald-800">{parametres.frais_retrait_pourcent} %</strong>
          </span>
        </div>
      </div>

      {/* Barre des 3 onglets */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-2 sm:space-x-8" aria-label="Onglets Ika-Mara">
          <button
            onClick={() => setActiveTab("depots")}
            className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "depots"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Dépôts quotidiens</span>
          </button>

          <button
            onClick={() => setActiveTab("retraits")}
            className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "retraits"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Retraits à valider</span>
            {retraits.length > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">
                {retraits.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("soldes")}
            className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "soldes"
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Soldes par membre</span>
          </button>
        </nav>
      </div>

      {/* Barre de filtrage commune / spécifique */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {activeTab === "depots" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600">Date début</label>
                <input
                  type="date"
                  value={dateDebut}
                  onChange={(e) => setDateDebut(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600">Date fin</label>
                <input
                  type="date"
                  value={dateFin}
                  onChange={(e) => setDateFin(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600">Agent collecteur</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:border-emerald-500 focus:outline-hidden"
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
            <label className="block text-xs font-semibold text-gray-600">Rechercher membre</label>
            <input
              type="text"
              placeholder="N° ou nom adhérent…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-hidden"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
            >
              {loading ? "Chargement…" : "Appliquer les filtres"}
            </button>
            <button
              onClick={() => {
                setDateDebut("");
                setDateFin("");
                setSelectedAgent("");
                setSearch("");
                // Le rechargement suit automatiquement le changement des filtres
              }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Réinitialiser
            </button>
          </div>

          {activeTab === "depots" && (
            <button
              onClick={handleExportDepotsExcel}
              disabled={depots.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
            >
              <span>📥 Exporter Excel (.csv)</span>
            </button>
          )}

          {activeTab === "soldes" && (
            <button
              onClick={handleExportSoldesExcel}
              disabled={soldes.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
            >
              <span>📥 Exporter les soldes (.csv)</span>
            </button>
          )}
        </div>
      </div>

      {/* Erreur de chargement */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 1 : DÉPÔTS                                                         */}
      {/* ========================================================================= */}
      {activeTab === "depots" && (
        <div className="space-y-6">
          {/* Cartes des totaux */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-bold tracking-wider text-gray-400 uppercase">
                Aujourd'hui
              </span>
              <p className="mt-1 font-mono text-xl font-bold text-emerald-700 sm:text-2xl">
                {formatMontant(totauxDepots.total_jour)}
              </p>
              <span className="text-xs text-gray-500">Dépôts validés du jour</span>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-bold tracking-wider text-gray-400 uppercase">
                Ce mois
              </span>
              <p className="mt-1 font-mono text-xl font-bold text-gray-900 sm:text-2xl">
                {formatMontant(totauxDepots.total_mois)}
              </p>
              <span className="text-xs text-gray-500">Cumul du mois en cours</span>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-bold tracking-wider text-gray-400 uppercase">
                Cette année
              </span>
              <p className="mt-1 font-mono text-xl font-bold text-gray-900 sm:text-2xl">
                {formatMontant(totauxDepots.total_annee)}
              </p>
              <span className="text-xs text-gray-500">Collecte annuelle</span>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-xs">
              <span className="text-xs font-bold tracking-wider text-emerald-700 uppercase">
                Total sélection
              </span>
              <p className="mt-1 font-mono text-xl font-bold text-emerald-900 sm:text-2xl">
                {formatMontant(totauxDepots.total_filtre)}
              </p>
              <span className="text-xs text-emerald-700">Selon les filtres appliqués</span>
            </div>
          </div>

          {/* Tableau des dépôts */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-900">
                Historique des dépôts ({depots.length})
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/75 font-semibold text-gray-600">
                    <th className="py-3 px-4">Date & Heure</th>
                    <th className="py-3 px-4">Adhérent</th>
                    <th className="py-3 px-4">Agent collecteur</th>
                    <th className="py-3 px-4 text-right">Montant</th>
                    <th className="py-3 px-4 text-center">Jours</th>
                    <th className="py-3 px-4 text-center">Statut</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {depots.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-500">
                        Aucun dépôt ne correspond aux critères
                      </td>
                    </tr>
                  ) : (
                    depots.map((d) => {
                      const estAnnule = d.statut === "annulee" || idsAnnules.has(d.id);
                      return (
                        <tr key={d.id} className="hover:bg-gray-50/50">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="font-semibold text-gray-900">
                              {formatDate(d.date_operation)}
                            </span>
                            <span className="block text-xs text-gray-400">
                              {new Date(d.cree_le).toLocaleTimeString("fr-FR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <Link
                              href={`/admin/membres/${d.membres?.id}`}
                              className="font-bold text-gray-900 hover:text-emerald-700 hover:underline"
                            >
                              {d.membres?.prenom} {d.membres?.nom}
                            </Link>
                            <span className="block text-xs text-gray-500 font-mono">
                              N° {d.membres?.numero} · {d.membres?.quartier || "—"}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-gray-800">
                              {d.profiles?.nom || "—"}
                            </span>
                            <span className="block font-mono text-xs text-gray-500">
                              {d.profiles?.identifiant}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-sm font-bold text-emerald-800 whitespace-nowrap">
                            {formatMontant(d.montant)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-700">
                              {d.jours_couverts} j
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {estAnnule ? (
                              <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">
                                Annulé
                              </span>
                            ) : (
                              <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                                Validé
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {!estAnnule && (
                              <button
                                onClick={() => {
                                  setDepotToCancel(d);
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 2 : RETRAITS À VALIDER                                             */}
      {/* ========================================================================= */}
      {activeTab === "retraits" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">
              Demandes de retrait d'épargne en attente ({retraits.length})
            </h2>
          </div>

          {retraits.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
              <span className="text-3xl">✨</span>
              <p className="mt-2 text-sm font-bold text-gray-900">
                Toutes les demandes de retrait ont été traitées
              </p>
              <p className="text-xs text-gray-500">
                Aucune demande en attente de validation pour le volet Ika-Mara.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {retraits.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-xs font-bold text-emerald-700">
                        N° {r.membres?.numero}
                      </span>
                      <h3 className="text-lg font-bold text-gray-950">
                        {r.membres?.prenom} {r.membres?.nom}
                      </h3>
                      <p className="text-xs text-gray-500">
                        Tél : {r.membres?.telephone || "—"} · Quartier : {r.membres?.quartier || "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="block text-xs font-semibold text-gray-400">
                        Montant demandé
                      </span>
                      <span className="font-mono text-xl font-bold text-emerald-900">
                        {formatMontant(r.montant)}
                      </span>
                    </div>
                  </div>

                  {/* Détails financiers et règles de retrait */}
                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-3 text-xs sm:grid-cols-3">
                    <div>
                      <span className="text-gray-500">Solde disponible :</span>
                      <p
                        className={`font-mono font-bold ${
                          r.solde_suffisant ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {formatMontant(r.solde_disponible)}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Reste après retrait :</span>
                      <p
                        className={`font-mono font-bold ${
                          r.solde_suffisant ? "text-gray-900" : "text-rose-600"
                        }`}
                      >
                        {r.solde_suffisant
                          ? formatMontant(r.solde_disponible - r.montant)
                          : `manque ${formatMontant(r.montant - r.solde_disponible)}`}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Ancienneté membre :</span>
                      <p
                        className={`font-mono font-bold ${
                          r.delai_atteint ? "text-emerald-700" : "text-amber-600"
                        }`}
                      >
                        {r.anciennete_jours} jours (min {parametres.delai_min_retrait_jours} j)
                      </p>
                    </div>
                  </div>

                  {/* Alertes d'éligibilité */}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {!r.solde_suffisant && (
                      <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 font-semibold text-rose-800">
                        ⚠️ Solde insuffisant pour ce montant
                      </span>
                    )}
                    {!r.delai_atteint && (
                      <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                        ⚠️ Délai minimal de retrait non atteint ({r.anciennete_jours}/{parametres.delai_min_retrait_jours} j)
                      </span>
                    )}
                    {r.peut_valider && (
                      <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                        ✅ Toutes les conditions sont remplies
                      </span>
                    )}
                  </div>

                  {/* Motif de la demande de l'agent si présent */}
                  {r.motif && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-2.5 text-xs text-gray-700">
                      <span className="font-bold text-gray-900">Motif indiqué : </span>
                      {r.motif}
                    </div>
                  )}

                  {/* Date et agent */}
                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-500">
                    <span>Transmis par : <strong className="text-gray-800">{r.profiles?.nom}</strong></span>
                    <span>{formatDateTime(r.cree_le)}</span>
                  </div>

                  {/* Actions Valider / Refuser */}
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setRetraitToRefuse(r);
                        setRefusMotif("");
                      }}
                      className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 active:scale-95"
                    >
                      Refuser…
                    </button>

                    <button
                      onClick={() => setRetraitToValidate(r)}
                      disabled={!r.peut_valider}
                      className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 disabled:opacity-40"
                    >
                      Valider le retrait
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Historique : retraits déjà effectués et solde restant du membre */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-900">
                Retraits effectués ({retraitsEffectues.length})
              </h2>
              <p className="text-xs text-gray-500">
                Montant retiré et ce qui reste aujourd&apos;hui sur l&apos;épargne du membre
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/75 font-semibold text-gray-600">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Adhérent</th>
                    <th className="py-3 px-4">Agent</th>
                    <th className="py-3 px-4 text-right">Montant retiré</th>
                    <th className="py-3 px-4 text-right">Solde restant</th>
                    <th className="py-3 px-4 text-center">Fiche</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {retraitsEffectues.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-500">
                        Aucun retrait effectué pour le moment
                      </td>
                    </tr>
                  ) : (
                    retraitsEffectues.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 whitespace-nowrap text-gray-700">
                          {formatDateTime(r.cree_le)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-gray-900">
                            {r.membres?.prenom} {r.membres?.nom}
                          </span>
                          <span className="block font-mono text-xs text-gray-500">
                            N° {r.membres?.numero}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-800">{r.profiles?.nom ?? "—"}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                          − {formatMontant(r.montant)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm font-bold text-emerald-800 whitespace-nowrap">
                          {formatMontant(r.solde_actuel)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {r.membres?.id && (
                            <Link
                              href={`/admin/membres/${r.membres.id}`}
                              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Voir →
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 3 : SOLDES PAR MEMBRE                                             */}
      {/* ========================================================================= */}
      {activeTab === "soldes" && (
        <div className="space-y-6">
          {/* Carte d'encours global d'épargne */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-xs">
              <span className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
                Encours global d'épargne Ika-Mara
              </span>
              <p className="mt-1 font-mono text-3xl font-bold text-emerald-950">
                {formatMontant(totalEpargneNet)}
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                Dépôts nets cumulés de tous les épargnants (Dépôts − Commissions − Retraits)
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
              <span className="text-xs font-bold tracking-wider text-gray-400 uppercase">
                Membres avec épargne active
              </span>
              <p className="mt-1 font-mono text-3xl font-bold text-gray-900">
                {soldes.length}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Adhérents inscrits au volet Ika-Mara
              </p>
            </div>
          </div>

          {/* Tableau des soldes par membre */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-900">
                Position des épargnants ({soldes.length})
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/75 font-semibold text-gray-600">
                    <th className="py-3 px-4">N°</th>
                    <th className="py-3 px-4">Adhérent</th>
                    <th className="py-3 px-4">Agent</th>
                    <th className="py-3 px-4 text-right">Dépôts</th>
                    <th className="py-3 px-4 text-right">Commissions</th>
                    <th className="py-3 px-4 text-right">Retraits</th>
                    <th className="py-3 px-4 text-right">Solde disponible</th>
                    <th className="py-3 px-4 text-center">Fiche</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {soldes.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-500">
                        Aucun solde trouvé
                      </td>
                    </tr>
                  ) : (
                    soldes.map((s) => (
                      <tr key={s.membre_id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 font-mono font-bold text-gray-900">
                          {s.numero}
                        </td>
                        <td className="py-3 px-4">
                          <Link
                            href={`/admin/membres/${s.membre_id}`}
                            className="font-bold text-gray-900 hover:text-emerald-700 hover:underline"
                          >
                            {s.prenom} {s.nom}
                          </Link>
                          <span className="block text-xs text-gray-500">
                            {s.telephone} · {s.quartier}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-medium text-gray-800">{s.agent_nom}</span>
                          <span className="block font-mono text-xs text-gray-500">
                            {s.agent_identifiant}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-gray-700 whitespace-nowrap">
                          {formatMontant(s.cumul_depots)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-amber-700 whitespace-nowrap">
                          {formatMontant(s.cumul_commissions)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-rose-700 whitespace-nowrap">
                          {formatMontant(s.cumul_retraits)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm font-bold text-emerald-800 whitespace-nowrap">
                          {formatMontant(s.solde_net)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Link
                            href={`/admin/membres/${s.membre_id}`}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Voir →
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : CONFIRMATION VALIDATION RETRAIT                                  */}
      {/* ========================================================================= */}
      {retraitToValidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-950">
              Valider le retrait d'épargne
            </h3>
            <p className="mt-2 text-xs text-gray-600">
              Vous êtes sur le point de valider ce retrait. Une opération financière de retrait et un décaissement de caisse seront enregistrés de manière atomique.
            </p>

            <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-xs">
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Adhérent :</span>
                <span className="font-bold text-gray-900">
                  {retraitToValidate.membres?.prenom} {retraitToValidate.membres?.nom} (N° {retraitToValidate.membres?.numero})
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Montant à décaisser :</span>
                <span className="font-mono font-bold text-emerald-800">
                  {formatMontant(retraitToValidate.montant)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Solde restant après retrait :</span>
                <span className="font-mono font-bold text-gray-700">
                  {formatMontant(retraitToValidate.solde_disponible - retraitToValidate.montant)}
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRetraitToValidate(null)}
                disabled={submittingAction}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleValiderRetrait}
                disabled={submittingAction}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
              >
                {submittingAction ? "Validation en cours…" : "Confirmer le retrait"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : REFUS DE RETRAIT (MOTIF OBLIGATOIRE)                              */}
      {/* ========================================================================= */}
      {retraitToRefuse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-700">
              Refuser la demande de retrait
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Veuillez indiquer le motif du refus. Cette justification sera enregistrée et communiquée à l'adhérent et à l'agent collecteur.
            </p>

            <div className="mt-3">
              <label className="block text-xs font-bold text-gray-700">
                Motif du refus (obligatoire) *
              </label>
              <textarea
                rows={3}
                value={refusMotif}
                onChange={(e) => setRefusMotif(e.target.value)}
                placeholder="Ex : Délai de 30 jours non atteint, solde insuffisant, etc."
                className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-xs focus:border-rose-500 focus:outline-hidden"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRetraitToRefuse(null);
                  setRefusMotif("");
                }}
                disabled={submittingAction}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleRefuserRetrait}
                disabled={submittingAction || !refusMotif.trim()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 disabled:opacity-50"
              >
                {submittingAction ? "Traitement…" : "Enregistrer le refus"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : ANNULATION D'UN DÉPÔT PAR ÉCRITURE INVERSE                        */}
      {/* ========================================================================= */}
      {depotToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-700">
              Annulation d'un dépôt par écriture inverse
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Conformément à la règle d'immuabilité d'IKA-MARA, aucune opération financière n'est supprimée. Une écriture inverse compensatoire sera générée et liée à cette opération.
            </p>

            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs">
              <p>
                <strong>Montant du dépôt :</strong> {formatMontant(depotToCancel.montant)}
              </p>
              <p>
                <strong>Adhérent :</strong> {depotToCancel.membres?.prenom} {depotToCancel.membres?.nom}
              </p>
              <p>
                <strong>Date :</strong> {formatDate(depotToCancel.date_operation)}
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold text-gray-700">
                Motif obligatoire de l'annulation *
              </label>
              <textarea
                rows={3}
                value={cancelMotif}
                onChange={(e) => setCancelMotif(e.target.value)}
                placeholder="Ex : Erreur de saisie de l'agent sur le carnet..."
                className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-xs focus:border-rose-500 focus:outline-hidden"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDepotToCancel(null);
                  setCancelMotif("");
                }}
                disabled={cancelLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={handleAnnulerDepot}
                disabled={cancelLoading || !cancelMotif.trim()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 disabled:opacity-50"
              >
                {cancelLoading ? "Annulation…" : "Confirmer l'annulation inverse"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
