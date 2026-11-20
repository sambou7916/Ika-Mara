"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { formatMontant, formatDate, formatDateTime } from "@/lib/utils/format";
import MontantInput from "@/components/ui/MontantInput";

type TabType = "remises" | "caisse" | "banque";

interface CartesTresorerie {
  solde_caisse: number;
  total_entrees_caisse: number;
  total_sorties_caisse: number;
  solde_banque: number;
  total_entrees_banque: number;
  total_sorties_banque: number;
  total_tresorerie: number;
  remises_en_attente_count: number;
  remises_ecarts_count: number;
}

interface RemiseItem {
  id: string;
  agent_id: string;
  montant: number;
  montant_attendu: number;
  montant_remis: number;
  ecart: number;
  motif: string | null;
  statut: "a_confirmer" | "validee" | "rejetee" | "ecart";
  commentaire_admin: string | null;
  confirme_le: string | null;
  cree_le: string;
  date_remise: string;
  profiles?: {
    id: string;
    nom: string;
    identifiant: string;
    telephone: string | null;
  };
  admin?: {
    nom: string;
  };
}

interface MouvementItem {
  id: string;
  type: "entree" | "sortie";
  montant: number;
  libelle: string;
  reference_type: string | null;
  reference_id: string | null;
  date_mouvement: string;
  cree_le: string;
  annule_ref: string | null;
  motif: string | null;
  solde_cumule: number;
}

interface AgentOption {
  id: string;
  nom: string;
  identifiant: string;
}

export default function AdminCaissePage() {
  const [activeTab, setActiveTab] = useState<TabType>("remises");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Données
  const [cartes, setCartes] = useState<CartesTresorerie>({
    solde_caisse: 0,
    total_entrees_caisse: 0,
    total_sorties_caisse: 0,
    solde_banque: 0,
    total_entrees_banque: 0,
    total_sorties_banque: 0,
    total_tresorerie: 0,
    remises_en_attente_count: 0,
    remises_ecarts_count: 0,
  });

  const [remises, setRemises] = useState<RemiseItem[]>([]);
  const [mouvementsCaisse, setMouvementsCaisse] = useState<MouvementItem[]>([]);
  const [mouvementsBanque, setMouvementsBanque] = useState<MouvementItem[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);

  // Filtres
  const [dateDebut, setDateDebut] = useState<string>("");
  const [dateFin, setDateFin] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [statutFilter, setStatutFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  // Modal Confirmation Remise
  const [remiseToConfirm, setRemiseToConfirm] = useState<RemiseItem | null>(null);
  const [commentaireAdmin, setCommentaireAdmin] = useState<string>("");
  const [confirmLoading, setConfirmLoading] = useState<boolean>(false);

  // Modal Saisie Manuelle (Caisse / Banque)
  const [showManualModal, setShowManualModal] = useState<"caisse" | "banque" | null>(null);
  const [manualType, setManualType] = useState<"entree" | "sortie">("entree");
  const [manualMontant, setManualMontant] = useState<number>(0);
  const [manualLibelle, setManualLibelle] = useState<string>("");
  const [manualMotif, setManualMotif] = useState<string>("");
  const [manualLoading, setManualLoading] = useState<boolean>(false);

  // Modal Transfert Caisse <-> Banque
  const [showTransferModal, setShowTransferModal] = useState<boolean>(false);
  const [transferSens, setTransferSens] = useState<"caisse_vers_banque" | "banque_vers_caisse">("caisse_vers_banque");
  const [transferMontant, setTransferMontant] = useState<number>(0);
  const [transferLibelle, setTransferLibelle] = useState<string>("");
  const [transferLoading, setTransferLoading] = useState<boolean>(false);

  // Modal Annulation par écriture inverse
  const [mouvementToCancel, setMouvementToCancel] = useState<{ item: MouvementItem; module: "caisse" | "banque" } | null>(null);
  const [cancelMotif, setCancelMotif] = useState<string>("");
  const [cancelLoading, setCancelLoading] = useState<boolean>(false);

  // Chargement des données selon l'onglet
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set("tab", activeTab);
      if (dateDebut) p.set("date_debut", dateDebut);
      if (dateFin) p.set("date_fin", dateFin);
      if (agentFilter) p.set("agent_id", agentFilter);
      if (statutFilter) p.set("statut", statutFilter);
      if (typeFilter) p.set("type", typeFilter);

      const res = await fetch(`/api/admin/caisse?${p.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Erreur de chargement");

      if (json.cartes) setCartes(json.cartes);
      if (json.agents) setAgents(json.agents);

      if (activeTab === "remises") {
        setRemises(json.remises || []);
      } else if (activeTab === "caisse") {
        setMouvementsCaisse(json.mouvements || []);
      } else if (activeTab === "banque") {
        setMouvementsBanque(json.mouvements || []);
      }
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
  }, [activeTab, dateDebut, dateFin, agentFilter, statutFilter, typeFilter]);

  // Confirmation de remise
  const handleConfirmRemise = async () => {
    if (!remiseToConfirm) return;
    setConfirmLoading(true);
    try {
      const res = await fetch("/api/admin/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirmer_remise",
          remise_id: remiseToConfirm.id,
          commentaire: commentaireAdmin.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec de confirmation");

      setNotification({ type: "ok", msg: json.message });
      setRemiseToConfirm(null);
      setCommentaireAdmin("");
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur de confirmation");
    } finally {
      setConfirmLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Enregistrement mouvement manuel
  const handleManualMouvement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showManualModal || manualMontant <= 0 || !manualLibelle.trim() || !manualMotif.trim()) {
      alert("Tous les champs (y compris le motif obligatoire) sont requis.");
      return;
    }

    setManualLoading(true);
    try {
      const actionName = showManualModal === "banque" ? "mouvement_banque" : "mouvement_caisse";
      const res = await fetch("/api/admin/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          type: manualType,
          montant: Number(manualMontant),
          libelle: manualLibelle.trim(),
          motif: manualMotif.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec d'enregistrement");

      setNotification({ type: "ok", msg: json.message });
      setShowManualModal(null);
      setManualMontant(0);
      setManualLibelle("");
      setManualMotif("");
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setManualLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Transfert Caisse <-> Banque
  const handleTransfert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (transferMontant <= 0) {
      alert("Veuillez saisir un montant valide.");
      return;
    }

    setTransferLoading(true);
    try {
      const res = await fetch("/api/admin/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfert",
          sens: transferSens,
          montant: Number(transferMontant),
          libelle: transferLibelle.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec du transfert");

      setNotification({ type: "ok", msg: json.message });
      setShowTransferModal(false);
      setTransferMontant(0);
      setTransferLibelle("");
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur lors du transfert");
    } finally {
      setTransferLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Annulation par écriture inverse
  const handleAnnulerMouvement = async () => {
    if (!mouvementToCancel) return;
    if (!cancelMotif.trim()) {
      alert("Le motif d'annulation est obligatoire.");
      return;
    }

    setCancelLoading(true);
    try {
      const res = await fetch("/api/admin/caisse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "annuler_mouvement",
          module: mouvementToCancel.module,
          mouvement_id: mouvementToCancel.item.id,
          motif: cancelMotif.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec de l'annulation");

      setNotification({ type: "ok", msg: json.message });
      setMouvementToCancel(null);
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
    let entetes: string[] = [];
    let lignes: any[][] = [];
    let filename = "";

    if (activeTab === "remises") {
      filename = `IKA-MARA_Remises_Collecte_${new Date().toISOString().slice(0, 10)}.csv`;
      entetes = ["Date Remise", "Agent", "Identifiant", "Attendu (F CFA)", "Remis (F CFA)", "Écart (F CFA)", "Statut", "Motif Agent", "Commentaire Admin"];
      lignes = remises.map((r) => [
        `"${formatDate(r.date_remise)}"`,
        `"${r.profiles?.nom || ""}"`,
        `"${r.profiles?.identifiant || ""}"`,
        r.montant_attendu,
        r.montant_remis,
        r.ecart,
        `"${r.statut === "validee" ? "Validée" : r.statut === "ecart" ? "Écart constaté" : "À confirmer"}"`,
        `"${(r.motif || "").replace(/"/g, '""')}"`,
        `"${(r.commentaire_admin || "").replace(/"/g, '""')}"`,
      ]);
    } else {
      const isCaisse = activeTab === "caisse";
      filename = `IKA-MARA_${isCaisse ? "Grand_Livre_Caisse" : "Releve_Banque"}_${new Date().toISOString().slice(0, 10)}.csv`;
      entetes = ["Date", "Libellé", "Type", "Entrée (F CFA)", "Sortie (F CFA)", "Solde Cumulé (F CFA)", "Motif Saisie"];
      const list = isCaisse ? mouvementsCaisse : mouvementsBanque;
      lignes = list.map((m) => [
        `"${formatDate(m.date_mouvement)}"`,
        `"${m.libelle.replace(/"/g, '""')}"`,
        `"${m.type === "entree" ? "Entrée" : "Sortie"}"`,
        m.type === "entree" ? m.montant : 0,
        m.type === "sortie" ? m.montant : 0,
        m.solde_cumule,
        `"${(m.motif || "").replace(/"/g, '""')}"`,
      ]);
    }

    const csvContent = "\uFEFF" + [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
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

      {/* En-tête de page */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-primary-100 px-2.5 py-0.5 text-xs font-bold text-primary-800">
              Trésorerie
            </span>
            <span className="text-xs text-gray-500">IKA-MARA</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-950 sm:text-3xl">
            Caisse & Remises de collecte
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Validation des remises agents, suivi des mouvements de caisse et transferts bancaires
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setTransferSens("caisse_vers_banque");
              setTransferMontant(0);
              setTransferLibelle("");
              setShowTransferModal(true);
            }}
            className="rounded-xl border border-primary-300 bg-primary-50 px-3.5 py-2 text-xs font-bold text-primary-800 hover:bg-primary-100"
          >
            🔄 Transfert Caisse ↔ Banque
          </button>
        </div>
      </div>

      {/* Cartes de trésorerie (Calculées par vues SQL) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Solde Caisse Espèces
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-primary-700 sm:text-2xl">
            {formatMontant(cartes.solde_caisse)}
          </p>
          <span className="text-xs text-gray-500">Espèces physiques en agence</span>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Solde Compte Bancaire
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-primary-900 sm:text-2xl">
            {formatMontant(cartes.solde_banque)}
          </p>
          <span className="text-xs text-gray-500">Avoirs en banque</span>
        </div>

        <div className="rounded-2xl border border-primary-200 bg-primary-50/60 p-4 shadow-xs">
          <span className="text-xs font-bold text-primary-800 uppercase tracking-wider">
            Trésorerie Globale
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-primary-950 sm:text-2xl">
            {formatMontant(cartes.total_tresorerie)}
          </p>
          <span className="text-xs text-primary-700">Caisse + Banque réunies</span>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Remises à valider
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-amber-600 sm:text-2xl">
            {cartes.remises_en_attente_count}
          </p>
          <span className="text-xs text-amber-700 font-semibold">
            {cartes.remises_ecarts_count} avec écart déclaré
          </span>
        </div>
      </div>

      {/* Barre des onglets */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-6" aria-label="Onglets Trésorerie">
          <button
            onClick={() => setActiveTab("remises")}
            className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "remises"
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Remises de collecte</span>
            {cartes.remises_en_attente_count > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-bold text-white">
                {cartes.remises_en_attente_count}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("caisse")}
            className={`border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "caisse"
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Mouvements de Caisse</span>
          </button>

          <button
            onClick={() => setActiveTab("banque")}
            className={`border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "banque"
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Mouvements de Banque</span>
          </button>
        </nav>
      </div>

      {/* Barre de filtrage et boutons d'action rapide */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600">Date début</label>
            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-hidden"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600">Date fin</label>
            <input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-hidden"
            />
          </div>

          {activeTab === "remises" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600">Agent</label>
                <select
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:border-primary-500 focus:outline-hidden"
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
                <label className="block text-xs font-semibold text-gray-600">Statut</label>
                <select
                  value={statutFilter}
                  onChange={(e) => setStatutFilter(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:border-primary-500 focus:outline-hidden"
                >
                  <option value="">Tous les statuts</option>
                  <option value="a_confirmer">À confirmer</option>
                  <option value="validee">Validée (Sans écart)</option>
                  <option value="ecart">Écart constaté</option>
                </select>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-600">Type de mouvement</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:border-primary-500 focus:outline-hidden"
              >
                <option value="">Tous</option>
                <option value="entree">Entrées (+)</option>
                <option value="sortie">Sorties (−)</option>
              </select>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700 active:scale-95 disabled:opacity-50"
            >
              {loading ? "Chargement…" : "Appliquer"}
            </button>
            <button
              onClick={() => {
                setDateDebut("");
                setDateFin("");
                setAgentFilter("");
                setStatutFilter("");
                setTypeFilter("");
                setTimeout(() => fetchData(), 50);
              }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Réinitialiser
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === "caisse" && (
              <button
                onClick={() => {
                  setShowManualModal("caisse");
                  setManualType("entree");
                  setManualMontant(0);
                  setManualLibelle("");
                  setManualMotif("");
                }}
                className="rounded-xl bg-primary-600 px-3 py-2 text-xs font-bold text-white hover:bg-primary-700 shadow-xs"
              >
                + Mouvement caisse manuel
              </button>
            )}

            {activeTab === "banque" && (
              <button
                onClick={() => {
                  setShowManualModal("banque");
                  setManualType("entree");
                  setManualMontant(0);
                  setManualLibelle("");
                  setManualMotif("");
                }}
                className="rounded-xl bg-primary-600 px-3 py-2 text-xs font-bold text-white hover:bg-primary-700 shadow-xs"
              >
                + Opération bancaire
              </button>
            )}

            <button
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary-300 bg-primary-50 px-3 py-2 text-xs font-bold text-primary-800 hover:bg-primary-100"
            >
              <span>📥 Exporter Excel (.csv)</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ONGLET 1 : REMISES DE COLLECTE                                            */}
      {/* ========================================================================= */}
      {activeTab === "remises" && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-bold text-gray-950">
              Journal des remises de collecte ({remises.length})
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                  <th className="py-3 px-4">Date journée</th>
                  <th className="py-3 px-4">Agent collecteur</th>
                  <th className="py-3 px-4 text-right">Collecte attendue</th>
                  <th className="py-3 px-4 text-right">Montant remis</th>
                  <th className="py-3 px-4 text-right">Écart</th>
                  <th className="py-3 px-4 text-center">Statut</th>
                  <th className="py-3 px-4">Motif / Commentaire</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {remises.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-500">
                      Aucune remise enregistrée pour ces critères
                    </td>
                  </tr>
                ) : (
                  remises.map((r) => {
                    const hasEcart = r.ecart !== 0;
                    const isPending = r.statut === "a_confirmer";

                    return (
                      <tr key={r.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 whitespace-nowrap font-semibold text-gray-900">
                          {formatDate(r.date_remise)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-gray-900">{r.profiles?.nom}</span>
                          <span className="block font-mono text-xs text-gray-500">
                            {r.profiles?.identifiant}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-gray-700 whitespace-nowrap">
                          {formatMontant(r.montant_attendu)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-primary-800 whitespace-nowrap">
                          {formatMontant(r.montant_remis)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-bold whitespace-nowrap ${
                            hasEcart
                              ? r.ecart < 0
                                ? "text-rose-600"
                                : "text-amber-600"
                              : "text-emerald-700"
                          }`}
                        >
                          {r.ecart > 0 ? `+${formatMontant(r.ecart)}` : formatMontant(r.ecart)}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {r.statut === "validee" && (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                              Validée
                            </span>
                          )}
                          {r.statut === "ecart" && (
                            <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800">
                              Écart acté
                            </span>
                          )}
                          {r.statut === "a_confirmer" && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                              À confirmer
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 max-w-xs text-gray-600 truncate">
                          {r.motif && <span className="block text-xs text-gray-800">{r.motif}</span>}
                          {r.commentaire_admin && (
                            <span className="block text-xs text-rose-700 italic">
                              Admin : {r.commentaire_admin}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {isPending && (
                            <button
                              onClick={() => {
                                setRemiseToConfirm(r);
                                setCommentaireAdmin("");
                              }}
                              className="rounded-xl bg-primary-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-primary-700 active:scale-95"
                            >
                              Confirmer…
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
      )}

      {/* ========================================================================= */}
      {/* ONGLET 2 : MOUVEMENTS DE CAISSE (GRAND LIVRE AVEC SOLDE CUMULÉ)          */}
      {/* ========================================================================= */}
      {activeTab === "caisse" && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
          <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-950">
              Grand Livre de Caisse ({mouvementsCaisse.length})
            </h2>
            <span className="font-mono text-xs font-bold text-primary-800">
              Solde actuel : {formatMontant(cartes.solde_caisse)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Libellé de l'opération</th>
                  <th className="py-3 px-4 text-right">Entrée (+)</th>
                  <th className="py-3 px-4 text-right">Sortie (−)</th>
                  <th className="py-3 px-4 text-right">Solde cumulé</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mouvementsCaisse.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      Aucun mouvement de caisse trouvé
                    </td>
                  </tr>
                ) : (
                  mouvementsCaisse.map((m) => {
                    const isEntree = m.type === "entree";
                    const isAnnulation = Boolean(m.annule_ref);

                    return (
                      <tr key={m.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 whitespace-nowrap text-gray-700">
                          {formatDate(m.date_mouvement)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-900">
                          {m.libelle}
                          {m.motif && (
                            <span className="block text-xs text-gray-500 font-normal">
                              Motif : {m.motif}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                          {isEntree ? formatMontant(m.montant) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                          {!isEntree ? formatMontant(m.montant) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-gray-950 text-sm whitespace-nowrap">
                          {formatMontant(m.solde_cumule)}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {!isAnnulation && (
                            <button
                              onClick={() => {
                                setMouvementToCancel({ item: m, module: "caisse" });
                                setCancelMotif("");
                              }}
                              className="rounded-lg border border-rose-200 bg-white px-2 py-0.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
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
      )}

      {/* ========================================================================= */}
      {/* ONGLET 3 : MOUVEMENTS DE BANQUE (AVEC SOLDE CUMULÉ)                      */}
      {/* ========================================================================= */}
      {activeTab === "banque" && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
          <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-950">
              Relevé de Compte Bancaire ({mouvementsBanque.length})
            </h2>
            <span className="font-mono text-xs font-bold text-primary-900">
              Solde banque : {formatMontant(cartes.solde_banque)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Libellé</th>
                  <th className="py-3 px-4 text-right">Dépôt (+)</th>
                  <th className="py-3 px-4 text-right">Retrait (−)</th>
                  <th className="py-3 px-4 text-right">Solde cumulé</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mouvementsBanque.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      Aucune opération bancaire trouvée
                    </td>
                  </tr>
                ) : (
                  mouvementsBanque.map((m) => {
                    const isEntree = m.type === "entree";
                    const isAnnulation = Boolean(m.annule_ref);

                    return (
                      <tr key={m.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 whitespace-nowrap text-gray-700">
                          {formatDate(m.date_mouvement)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-900">
                          {m.libelle}
                          {m.motif && (
                            <span className="block text-xs text-gray-500 font-normal">
                              Motif : {m.motif}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                          {isEntree ? formatMontant(m.montant) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-rose-700 whitespace-nowrap">
                          {!isEntree ? formatMontant(m.montant) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-gray-950 text-sm whitespace-nowrap">
                          {formatMontant(m.solde_cumule)}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {!isAnnulation && (
                            <button
                              onClick={() => {
                                setMouvementToCancel({ item: m, module: "banque" });
                                setCancelMotif("");
                              }}
                              className="rounded-lg border border-rose-200 bg-white px-2 py-0.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
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
      )}

      {/* ========================================================================= */}
      {/* MODAL : CONFIRMATION D'UNE REMISE DE COLLECTE                            */}
      {/* ========================================================================= */}
      {remiseToConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-950">
              Confirmer la remise de collecte
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Cette action clôture la journée de l'agent et enregistre une entrée de caisse correspondant aux espèces remises.
            </p>

            <div className="mt-4 rounded-xl bg-gray-50 p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Agent :</span>
                <span className="font-bold text-gray-900">
                  {remiseToConfirm.profiles?.nom} ({remiseToConfirm.profiles?.identifiant})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Collecte attendue :</span>
                <span className="font-mono font-bold text-gray-800">
                  {formatMontant(remiseToConfirm.montant_attendu)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Montant remis (espèces) :</span>
                <span className="font-mono font-bold text-primary-800">
                  {formatMontant(remiseToConfirm.montant_remis)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1.5">
                <span className="text-gray-500">Écart constaté :</span>
                <span
                  className={`font-mono font-bold ${
                    remiseToConfirm.ecart === 0
                      ? "text-emerald-700"
                      : "text-rose-700"
                  }`}
                >
                  {formatMontant(remiseToConfirm.ecart)}
                </span>
              </div>
            </div>

            {remiseToConfirm.motif && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                <strong>Motif de l'agent :</strong> {remiseToConfirm.motif}
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-bold text-gray-700">
                Commentaire de l'administrateur (optionnel ou requis si écart)
              </label>
              <textarea
                rows={2}
                value={commentaireAdmin}
                onChange={(e) => setCommentaireAdmin(e.target.value)}
                placeholder="Ex : Écart vérifié en caisse, régularisation prévue demain..."
                className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-primary-500 focus:outline-hidden"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemiseToConfirm(null)}
                disabled={confirmLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmRemise}
                disabled={confirmLoading}
                className="rounded-xl bg-primary-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-700 active:scale-95 disabled:opacity-40"
              >
                {confirmLoading ? "Confirmation…" : "Confirmer la remise"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : SAISIE MANUELLE CAISSE / BANQUE                                  */}
      {/* ========================================================================= */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-950">
              {showManualModal === "caisse" ? "Mouvement de caisse manuel" : "Opération bancaire manuelle"}
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Chaque opération manuelle doit obligatoirement comporter un motif justificatif pour l'audit.
            </p>

            <form onSubmit={handleManualMouvement} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700">Sens du mouvement</label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setManualType("entree")}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold ${
                      manualType === "entree"
                        ? "bg-emerald-600 text-white"
                        : "border border-gray-300 bg-white text-gray-700"
                    }`}
                  >
                    Entrée d'argent (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualType("sortie")}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold ${
                      manualType === "sortie"
                        ? "bg-rose-600 text-white"
                        : "border border-gray-300 bg-white text-gray-700"
                    }`}
                  >
                    Sortie d'argent (−)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Montant (F CFA) *</label>
                <MontantInput
                  required
                  placeholder="Ex : 10 000"
                  value={manualMontant}
                  onChange={setManualMontant}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 font-mono text-sm font-bold focus:border-primary-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Libellé de l'opération *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex : Approvisionnement fournitures, régularisation..."
                  value={manualLibelle}
                  onChange={(e) => setManualLibelle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-primary-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Motif justificatif *</label>
                <textarea
                  rows={2}
                  required
                  value={manualMotif}
                  onChange={(e) => setManualMotif(e.target.value)}
                  placeholder="Ex : Justificatif facture N°..."
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-primary-500 focus:outline-hidden"
                />
              </div>

              <div className="mt-6 flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(null)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={manualLoading || manualMontant <= 0 || !manualLibelle.trim() || !manualMotif.trim()}
                  className="rounded-xl bg-primary-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-700 disabled:opacity-40"
                >
                  {manualLoading ? "Enregistrement…" : "Enregistrer le mouvement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : TRANSFERT CAISSE <-> BANQUE                                      */}
      {/* ========================================================================= */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-950">
              Transfert Caisse ↔ Banque
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Cette transaction atomique crée simultanément une sortie sur la source et une entrée sur la destination.
            </p>

            <form onSubmit={handleTransfert} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700">Sens du transfert</label>
                <div className="mt-1 space-y-2">
                  <label
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer text-xs ${
                      transferSens === "caisse_vers_banque"
                        ? "border-primary-600 bg-primary-50/50"
                        : "border-gray-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="sens"
                      checked={transferSens === "caisse_vers_banque"}
                      onChange={() => setTransferSens("caisse_vers_banque")}
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    <div>
                      <span className="font-bold text-gray-900 block">Dépôt en banque (Caisse → Banque)</span>
                      <span className="text-xs text-gray-500">
                        Espèces sorties de la caisse pour versement sur le compte bancaire
                      </span>
                    </div>
                  </label>

                  <label
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer text-xs ${
                      transferSens === "banque_vers_caisse"
                        ? "border-primary-600 bg-primary-50/50"
                        : "border-gray-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="sens"
                      checked={transferSens === "banque_vers_caisse"}
                      onChange={() => setTransferSens("banque_vers_caisse")}
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    <div>
                      <span className="font-bold text-gray-900 block">Approvisionnement caisse (Banque → Caisse)</span>
                      <span className="text-xs text-gray-500">
                        Retrait bancaire pour alimenter la caisse physique
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Montant (F CFA) *</label>
                <MontantInput
                  required
                  placeholder="Ex : 50 000"
                  value={transferMontant}
                  onChange={setTransferMontant}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 font-mono text-sm font-bold focus:border-primary-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Libellé / Référence bordereau</label>
                <input
                  type="text"
                  placeholder="Ex : Bordereau versement BDM N° 45871"
                  value={transferLibelle}
                  onChange={(e) => setTransferLibelle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500 focus:outline-hidden"
                />
              </div>

              <div className="mt-6 flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={transferLoading || transferMontant <= 0}
                  className="rounded-xl bg-primary-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-700 disabled:opacity-40"
                >
                  {transferLoading ? "Transfert…" : "Confirmer le transfert"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : ANNULATION PAR ÉCRITURE INVERSE                                  */}
      {/* ========================================================================= */}
      {mouvementToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-700">
              Annuler ce mouvement par écriture inverse
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Conformément à la règle d'immuabilité d'IKA-MARA, le mouvement ne sera pas supprimé. Une écriture inverse compensatoire sera créée.
            </p>

            <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs">
              <p>
                <strong>Libellé :</strong> {mouvementToCancel.item.libelle}
              </p>
              <p>
                <strong>Montant :</strong> {formatMontant(mouvementToCancel.item.montant)} (
                {mouvementToCancel.item.type === "entree" ? "Entrée" : "Sortie"})
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold text-gray-700">
                Motif d'annulation obligatoire *
              </label>
              <textarea
                rows={3}
                required
                value={cancelMotif}
                onChange={(e) => setCancelMotif(e.target.value)}
                placeholder="Ex : Erreur de saisie de l'administrateur..."
                className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-rose-500 focus:outline-hidden"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMouvementToCancel(null)}
                disabled={cancelLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleAnnulerMouvement}
                disabled={cancelLoading || !cancelMotif.trim()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 disabled:opacity-40"
              >
                {cancelLoading ? "Contre-passation…" : "Confirmer l'annulation inverse"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
