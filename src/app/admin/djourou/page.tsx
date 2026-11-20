"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { formatMontant, formatDate, formatDateTime } from "@/lib/utils/format";
import MontantInput, { EntierInput } from "@/components/ui/MontantInput";

type TabType = "demandes" | "en_cours" | "en_retard";

interface TableauBord {
  encours_total: number;
  rembourse_du_mois: number;
  retards_montant: number;
  nb_credits_retard: number;
  taux_impayes: number;
  nb_demandes_en_attente: number;
}

interface DemandeCreditItem {
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
    profession: string | null;
    cree_le: string;
  };
  profiles?: {
    id: string;
    nom: string;
    identifiant: string;
  };
  historique: {
    solde_epargne: number;
    depots_30j: number;
    depots_90j: number;
    credits_rembourses: number;
    credits_en_cours: number;
    anciennete_jours: number;
  };
}

interface CreditActifItem {
  id: string;
  montant_accorde: number;
  montant_rembourse: number;
  taux_interet: number;
  date_octroi: string;
  date_echeance: string;
  statut: string;
  periodicite: "quotidien" | "hebdomadaire" | "mensuel";
  duree_mois: number;
  total_interets: number;
  total_du: number;
  frais_dossier: number;
  reste_du: number;
  progression: number;
  membres?: {
    id: string;
    numero: string;
    nom: string;
    prenom: string;
    telephone: string | null;
    quartier: string | null;
  };
  profiles?: {
    nom: string;
    identifiant: string;
  };
}

interface EcheanceItem {
  id: string;
  numero: number;
  montant_du: number;
  montant_paye: number;
  date_echeance: string;
  statut: string;
  montant_capital: number;
  montant_interets: number;
}

interface CreditRetardItem {
  credit_id: string;
  montant_retard: number;
  max_jours_retard: number;
  penalite_calculee: number;
  penalite_taux_pct: number;
  credit?: {
    montant_accorde: number;
    montant_rembourse: number;
    total_du: number;
    date_octroi: string;
    membres?: {
      id: string;
      numero: string;
      nom: string;
      prenom: string;
      telephone: string | null;
      quartier: string | null;
    };
    profiles?: {
      nom: string;
      identifiant: string;
    };
  };
  echeances: Array<{
    numero: number;
    date_echeance: string;
    montant_du: number;
    montant_paye: number;
    manquant: number;
    jours_retard: number;
  }>;
}

export default function AdminDjourouPage() {
  const [activeTab, setActiveTab] = useState<TabType>("demandes");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Tableau de bord
  const [tableauBord, setTableauBord] = useState<TableauBord>({
    encours_total: 0,
    rembourse_du_mois: 0,
    retards_montant: 0,
    nb_credits_retard: 0,
    taux_impayes: 0,
    nb_demandes_en_attente: 0,
  });

  // Onglet 1 : Demandes
  const [demandes, setDemandes] = useState<DemandeCreditItem[]>([]);
  const [selectedDemande, setSelectedDemande] = useState<DemandeCreditItem | null>(null);
  const [formMontant, setFormMontant] = useState<number>(0);
  const [formTaux, setFormTaux] = useState<number>(5); // 5%
  const [formFraisDossier, setFormFraisDossier] = useState<number>(2500);
  const [formPeriodicite, setFormPeriodicite] = useState<"quotidien" | "hebdomadaire" | "mensuel">("mensuel");
  const [formDureeMois, setFormDureeMois] = useState<number>(3);
  const [refusModalDemande, setRefusModalDemande] = useState<DemandeCreditItem | null>(null);
  const [refusMotif, setRefusMotif] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Onglet 2 : En cours
  const [creditsEnCours, setCreditsEnCours] = useState<CreditActifItem[]>([]);
  const [searchCredit, setSearchCredit] = useState("");
  const [selectedCreditForEcheancier, setSelectedCreditForEcheancier] = useState<CreditActifItem | null>(null);
  const [echeancesList, setEcheancesList] = useState<EcheanceItem[]>([]);
  const [echeancierLoading, setEcheancierLoading] = useState(false);

  // Modal Remboursement
  const [creditToRepay, setCreditToRepay] = useState<CreditActifItem | null>(null);
  const [repayMontant, setRepayMontant] = useState<number>(0);
  const [repayAnticipe, setRepayAnticipe] = useState<boolean>(false);
  const [repayMotif, setRepayMotif] = useState<string>("");
  const [repayLoading, setRepayLoading] = useState(false);

  // Onglet 3 : En retard
  const [creditsEnRetard, setCreditsEnRetard] = useState<CreditRetardItem[]>([]);

  // Chargement des données selon l'onglet
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set("tab", activeTab);
      if (searchCredit) p.set("search", searchCredit);

      const res = await fetch(`/api/admin/djourou?${p.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Erreur de chargement");

      if (json.tableau_bord) setTableauBord(json.tableau_bord);

      if (activeTab === "demandes") {
        setDemandes(json.demandes || []);
        if (json.demandes?.length > 0 && !selectedDemande) {
          selectDemande(json.demandes[0]);
        }
      } else if (activeTab === "en_cours") {
        setCreditsEnCours(json.credits || []);
      } else if (activeTab === "en_retard") {
        setCreditsEnRetard(json.retards || []);
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
  }, [activeTab]);

  // Sélection d'une demande pour le panneau de décision
  const selectDemande = (d: DemandeCreditItem) => {
    setSelectedDemande(d);
    setFormMontant(d.montant);
    setFormTaux(5);
    setFormFraisDossier(Math.round((d.montant * 1) / 100)); // 1% frais de dossier
    setFormPeriodicite("mensuel");
    setFormDureeMois(3);
  };

  // Chargement de l'échéancier d'un crédit spécifique
  const loadEcheancier = async (c: CreditActifItem) => {
    setSelectedCreditForEcheancier(c);
    setEcheancierLoading(true);
    try {
      const res = await fetch(`/api/admin/djourou?tab=en_cours&credit_id=${c.id}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setEcheancesList(json.echeances || []);
      }
    } catch (err) {
      console.error("Erreur chargement échéancier :", err);
    } finally {
      setEcheancierLoading(false);
    }
  };

  // Validation d'une demande de crédit
  const handleValiderCredit = async () => {
    if (!selectedDemande) return;
    if (formMontant <= 0 || formDureeMois <= 0) {
      alert("Le montant et la durée doivent être supérieurs à zéro.");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/djourou", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "valider_credit",
          demande_id: selectedDemande.id,
          montant_accorde: Number(formMontant),
          taux_interet: Number(formTaux),
          frais_dossier: Number(formFraisDossier),
          periodicite: formPeriodicite,
          duree_mois: Number(formDureeMois),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec de validation");

      setNotification({ type: "ok", msg: json.message });
      setSelectedDemande(null);
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur de validation");
    } finally {
      setActionLoading(false);
      setTimeout(() => setNotification(null), 6000);
    }
  };

  // Refus d'une demande de crédit
  const handleRefuserCredit = async () => {
    if (!refusModalDemande) return;
    if (!refusMotif.trim()) {
      alert("Le motif de refus est obligatoire.");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/djourou", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refuser_credit",
          demande_id: refusModalDemande.id,
          motif: refusMotif.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec du refus");

      setNotification({ type: "ok", msg: json.message });
      setRefusModalDemande(null);
      setRefusMotif("");
      if (selectedDemande?.id === refusModalDemande.id) setSelectedDemande(null);
      fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur lors du refus");
    } finally {
      setActionLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Enregistrement d'un remboursement
  const handleRembourser = async () => {
    if (!creditToRepay) return;
    if (repayMontant <= 0) {
      alert("Veuillez saisir un montant valide.");
      return;
    }

    setRepayLoading(true);
    try {
      const res = await fetch("/api/admin/djourou", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rembourser",
          credit_id: creditToRepay.id,
          montant: Number(repayMontant),
          motif: repayMotif.trim() || undefined,
          est_anticipe: repayAnticipe,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec de l'enregistrement");

      setNotification({
        type: "ok",
        msg: `Remboursement de ${formatMontant(repayMontant)} imputé. Solde restant : ${formatMontant(
          json.solde_restant
        )}.`,
      });
      setCreditToRepay(null);
      setRepayMontant(0);
      setRepayMotif("");
      setRepayAnticipe(false);
      fetchData();
      if (selectedCreditForEcheancier?.id === creditToRepay.id) {
        loadEcheancier(selectedCreditForEcheancier);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur de remboursement");
    } finally {
      setRepayLoading(false);
      setTimeout(() => setNotification(null), 6000);
    }
  };

  // Calcul prévisionnel pour le formulaire d'octroi
  const interetsPrevisionnels = Math.round(
    (formMontant * formTaux * formDureeMois) / (100 * 12)
  );
  const totalDuPrevisionnel = formMontant + interetsPrevisionnels;
  const mensualitePrevisionnelle =
    formDureeMois > 0 ? Math.round(totalDuPrevisionnel / formDureeMois) : totalDuPrevisionnel;

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

      {/* En-tête */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-primary-100 px-2.5 py-0.5 text-xs font-bold text-primary-800">
            Volet Crédit
          </span>
          <span className="text-xs text-gray-500">IKA-DJOUROU</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">
          Gestion Ika-Djourou
        </h1>
        <p className="text-xs text-gray-500 sm:text-sm">
          Octroi de crédit, échéanciers automatiques, imputation des remboursements et suivi des retards
        </p>
      </div>

      {/* ========================================================================= */}
      {/* TABLEAU DE BORD CRÉDIT (EN-TÊTE)                                          */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Encours Total Crédit
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-primary-900 sm:text-2xl">
            {formatMontant(tableauBord.encours_total)}
          </p>
          <span className="text-xs text-gray-500">Capital & intérêts dus</span>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Remboursé ce mois
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 sm:text-2xl">
            {formatMontant(tableauBord.rembourse_du_mois)}
          </p>
          <span className="text-xs text-gray-500">Encaissements du mois</span>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            Crédits en retard
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-rose-600 sm:text-2xl">
            {formatMontant(tableauBord.retards_montant)}
          </p>
          <span className="text-xs text-rose-600 font-semibold">
            {tableauBord.nb_credits_retard} crédit(s) en souffrance
          </span>
        </div>

        <div className="rounded-2xl border border-primary-200 bg-primary-50/50 p-4 shadow-xs">
          <span className="text-xs font-bold text-primary-800 uppercase tracking-wider">
            Taux d'impayés
          </span>
          <p className="mt-1 font-mono text-xl font-bold text-primary-950 sm:text-2xl">
            {tableauBord.taux_impayes} %
          </p>
          <span className="text-xs text-primary-700">Retards / Encours global</span>
        </div>
      </div>

      {/* Barre des 3 onglets */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-6" aria-label="Onglets Ika-Djourou">
          <button
            onClick={() => setActiveTab("demandes")}
            className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "demandes"
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Demandes à valider</span>
            {tableauBord.nb_demandes_en_attente > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-bold text-white">
                {tableauBord.nb_demandes_en_attente}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("en_cours")}
            className={`border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "en_cours"
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Crédits en cours</span>
          </button>

          <button
            onClick={() => setActiveTab("en_retard")}
            className={`flex items-center gap-2 border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "en_retard"
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Crédits en retard</span>
            {tableauBord.nb_credits_retard > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-bold text-white">
                {tableauBord.nb_credits_retard}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* ========================================================================= */}
      {/* ONGLET 1 : DEMANDES DE CRÉDIT & PANNEAU DE DÉCISION                       */}
      {/* ========================================================================= */}
      {activeTab === "demandes" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Liste des demandes */}
          <div className="space-y-3 lg:col-span-5">
            <h2 className="text-sm font-bold text-gray-900">
              Demandes soumises ({demandes.length})
            </h2>

            {demandes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-xs text-gray-500">
                ✨ Aucune demande de crédit en attente.
              </div>
            ) : (
              <div className="space-y-3">
                {demandes.map((d) => {
                  const isSelected = selectedDemande?.id === d.id;
                  return (
                    <div
                      key={d.id}
                      onClick={() => selectDemande(d)}
                      className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                        isSelected
                          ? "border-primary-600 bg-primary-50/40 shadow-md ring-2 ring-primary-600/20"
                          : "border-gray-200 bg-white hover:border-primary-300 hover:shadow-xs"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="font-mono text-xs font-bold text-primary-700">
                            N° {d.membres?.numero}
                          </span>
                          <h3 className="font-bold text-gray-950">
                            {d.membres?.prenom} {d.membres?.nom}
                          </h3>
                          <span className="text-xs text-gray-500">
                            {d.membres?.profession || "Profession non renseignée"} · {d.membres?.quartier}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-gray-400 block">Demandé</span>
                          <span className="font-mono text-base font-bold text-primary-900">
                            {formatMontant(d.montant)}
                          </span>
                        </div>
                      </div>

                      {d.motif && (
                        <p className="mt-2 text-xs text-gray-600 line-clamp-2 bg-gray-50 p-2 rounded-lg">
                          {d.motif}
                        </p>
                      )}

                      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2 text-xs text-gray-500">
                        <span>Agent : <strong>{d.profiles?.nom}</strong></span>
                        <span>{formatDate(d.date_operation)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Panneau de décision & Historique */}
          <div className="lg:col-span-7">
            {selectedDemande ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-primary-700 uppercase">
                      Panneau d'analyse & décision
                    </span>
                    <button
                      onClick={() => {
                        setRefusModalDemande(selectedDemande);
                        setRefusMotif("");
                      }}
                      className="rounded-xl border border-rose-300 bg-white px-3 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50"
                    >
                      Refuser…
                    </button>
                  </div>
                  <h3 className="text-xl font-bold text-gray-950 mt-1">
                    Adhérent N° {selectedDemande.membres?.numero} · {selectedDemande.membres?.prenom}{" "}
                    {selectedDemande.membres?.nom}
                  </h3>
                  <p className="text-xs text-gray-500">
                    Tél : {selectedDemande.membres?.telephone || "—"} · Quartier : {selectedDemande.membres?.quartier || "—"}
                  </p>
                </div>

                {/* Historique du membre (épargne, régularité, crédits passés) */}
                <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                    Historique & Fiabilité de l'adhérent
                  </h4>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                    <div>
                      <span className="text-gray-500 block">Épargne Mara</span>
                      <strong className="font-mono text-emerald-700 font-bold">
                        {formatMontant(selectedDemande.historique.solde_epargne)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Dépôts 30 j</span>
                      <strong className="text-gray-900 font-bold">
                        {selectedDemande.historique.depots_30j} fois
                      </strong>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Dépôts 90 j</span>
                      <strong className="text-gray-900 font-bold">
                        {selectedDemande.historique.depots_90j} fois
                      </strong>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Crédits soldés</span>
                      <strong className="text-primary-700 font-bold">
                        {selectedDemande.historique.credits_rembourses} remboursé(s)
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Formulaire d'octroi de crédit */}
                <div className="space-y-4 border-t border-gray-100 pt-4">
                  <h4 className="text-xs font-bold text-gray-900 uppercase">
                    Conditions d'octroi du crédit
                  </h4>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700">
                        Montant accordé (F CFA) *
                      </label>
                      <MontantInput
                        value={formMontant}
                        onChange={(v) => setFormMontant(v)}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 font-mono text-sm font-bold focus:border-primary-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700">
                        Taux d'intérêt annuel (%) *
                      </label>
                      <EntierInput suffixe="%"
                        value={formTaux}
                        onChange={(v) => setFormTaux(v)}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 font-mono text-sm font-bold focus:border-primary-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700">
                        Frais de dossier (F CFA)
                      </label>
                      <MontantInput
                        value={formFraisDossier}
                        onChange={(v) => setFormFraisDossier(v)}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 font-mono text-sm font-bold focus:border-primary-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700">Périodicité</label>
                      <select
                        value={formPeriodicite}
                        onChange={(e) => setFormPeriodicite(e.target.value as any)}
                        className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs bg-white font-semibold focus:border-primary-500 focus:outline-hidden"
                      >
                        <option value="mensuel">Mensuelle (1x / mois)</option>
                        <option value="hebdomadaire">Hebdomadaire (1x / semaine)</option>
                        <option value="quotidien">Quotidienne (chaque jour)</option>
                      </select>
                    </div>
                  </div>

                  {/* Choix de la durée */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Durée du crédit
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[3, 6, 12].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setFormDureeMois(m)}
                          className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                            formDureeMois === m
                              ? "bg-primary-600 text-white shadow-xs"
                              : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          {m} mois
                        </button>
                      ))}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">ou libre :</span>
                        <EntierInput
                          max={36}
                          value={formDureeMois}
                          onChange={(v) => setFormDureeMois(v)}
                          className="w-16 rounded-xl border border-gray-300 p-1.5 text-xs text-center font-bold"
                        />
                        <span className="text-xs text-gray-500">mois</span>
                      </div>
                    </div>
                  </div>

                  {/* Résumé de simulation de l'échéancier */}
                  <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Capital prêté :</span>
                      <strong className="font-mono text-gray-900">{formatMontant(formMontant)}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Intérêts totaux calculés :</span>
                      <strong className="font-mono text-primary-900">{formatMontant(interetsPrevisionnels)}</strong>
                    </div>
                    <div className="flex justify-between border-t border-primary-200/60 pt-2 text-sm">
                      <span className="font-bold text-primary-950">Total à rembourser :</span>
                      <strong className="font-mono font-bold text-primary-950">
                        {formatMontant(totalDuPrevisionnel)}
                      </strong>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Échéance estimée :</span>
                      <span className="font-mono font-bold text-gray-800">
                        ~ {formatMontant(mensualitePrevisionnelle)} / mois
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleValiderCredit}
                      disabled={actionLoading || formMontant <= 0}
                      className="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 active:scale-95 disabled:opacity-40"
                    >
                      {actionLoading ? "Création en cours…" : "✅ Valider le crédit & décaisser"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center text-xs text-gray-500">
                Sélectionnez une demande dans la liste pour afficher l'historique et le panneau de décision.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 2 : CRÉDITS EN COURS & ÉCHÉANCIERS                                 */}
      {/* ========================================================================= */}
      {activeTab === "en_cours" && (
        <div className="space-y-6">
          {/* Recherche */}
          <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
            <input
              type="text"
              placeholder="Recherche membre par nom, numéro ou quartier…"
              value={searchCredit}
              onChange={(e) => setSearchCredit(e.target.value)}
              className="w-full max-w-md rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-primary-500 focus:outline-hidden"
            />
            <button
              onClick={fetchData}
              className="rounded-xl bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:bg-primary-700"
            >
              Rechercher
            </button>
          </div>

          {/* Tableau des crédits actifs */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-950">
                Portefeuille de crédits actifs ({creditsEnCours.length})
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                    <th className="py-3 px-4">Adhérent</th>
                    <th className="py-3 px-4">Date octroi</th>
                    <th className="py-3 px-4 text-right">Montant accordé</th>
                    <th className="py-3 px-4 text-right">Total dû</th>
                    <th className="py-3 px-4 text-right">Remboursé</th>
                    <th className="py-3 px-4 text-right">Reste dû</th>
                    <th className="py-3 px-4 text-center">Progression</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {creditsEnCours.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-500">
                        Aucun crédit actif trouvé
                      </td>
                    </tr>
                  ) : (
                    creditsEnCours.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50/60">
                        <td className="py-3 px-4">
                          <Link
                            href={`/admin/membres/${c.membres?.id}`}
                            className="font-bold text-gray-900 hover:text-primary-700 hover:underline"
                          >
                            {c.membres?.prenom} {c.membres?.nom}
                          </Link>
                          <span className="block font-mono text-xs text-gray-500">
                            N° {c.membres?.numero} · {c.membres?.telephone || "Sans tél"}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-gray-600">
                          {formatDate(c.date_octroi)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-gray-900 font-bold whitespace-nowrap">
                          {formatMontant(c.montant_accorde)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-gray-700 whitespace-nowrap">
                          {formatMontant(c.total_du)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-700 font-bold whitespace-nowrap">
                          {formatMontant(c.montant_rembourse)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm font-bold text-primary-900 whitespace-nowrap">
                          {formatMontant(c.reste_du)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex flex-col items-center gap-1 w-20">
                            <span className="font-mono text-xs font-bold text-gray-600">
                              {c.progression} %
                            </span>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                              <div
                                className="h-full bg-emerald-600 transition-all"
                                style={{ width: `${c.progression}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => loadEcheancier(c)}
                              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Échéancier
                            </button>
                            <button
                              onClick={() => {
                                setCreditToRepay(c);
                                setRepayMontant(0);
                                setRepayAnticipe(false);
                              }}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                              Rembourser
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Échéancier détaillé si sélectionné */}
          {selectedCreditForEcheancier && (
            <div className="rounded-2xl border border-primary-200 bg-white p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-gray-950">
                    Échéancier détaillé · Membre N° {selectedCreditForEcheancier.membres?.numero} (
                    {selectedCreditForEcheancier.membres?.prenom} {selectedCreditForEcheancier.membres?.nom})
                  </h3>
                  <p className="text-xs text-gray-500">
                    Durée : {selectedCreditForEcheancier.duree_mois} mois · Taux :{" "}
                    {selectedCreditForEcheancier.taux_interet} % · Périodicité :{" "}
                    {selectedCreditForEcheancier.periodicite}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedCreditForEcheancier(null)}
                  className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-500 hover:bg-gray-50"
                >
                  Fermer
                </button>
              </div>

              {echeancierLoading ? (
                <div className="p-8 text-center text-xs text-gray-500">Chargement de l'échéancier…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                        <th className="py-2 px-3 text-center">N°</th>
                        <th className="py-2 px-3">Date d'échéance</th>
                        <th className="py-2 px-3 text-right">Capital</th>
                        <th className="py-2 px-3 text-right">Intérêts</th>
                        <th className="py-2 px-3 text-right">Total dû</th>
                        <th className="py-2 px-3 text-right">Payé</th>
                        <th className="py-2 px-3 text-center">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {echeancesList.map((ech) => {
                        const isPaye = ech.statut === "paye";
                        return (
                          <tr key={ech.id} className="hover:bg-gray-50/50">
                            <td className="py-2 px-3 text-center font-mono font-bold text-gray-800">
                              #{ech.numero}
                            </td>
                            <td className="py-2 px-3 text-gray-700 whitespace-nowrap">
                              {formatDate(ech.date_echeance)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-gray-600">
                              {formatMontant(ech.montant_capital)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-primary-800">
                              {formatMontant(ech.montant_interets)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-gray-900">
                              {formatMontant(ech.montant_du)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700">
                              {formatMontant(ech.montant_paye)}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {isPaye ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                                  Payé
                                </span>
                              ) : ech.montant_paye > 0 ? (
                                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-bold text-primary-800">
                                  Partiel
                                </span>
                              ) : (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                                  À payer
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 3 : CRÉDITS EN RETARD & PÉNALITÉS                                  */}
      {/* ========================================================================= */}
      {activeTab === "en_retard" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 text-xs text-rose-900">
            <strong>Règle de gestion :</strong> Les pénalités sont calculées à hauteur de{" "}
            <strong>2 % par mois de retard</strong> sur les échéances échues non régularisées.
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-950">
                Crédits en souffrance ({creditsEnRetard.length})
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                    <th className="py-3 px-4">Adhérent</th>
                    <th className="py-3 px-4 text-right">Montant en retard</th>
                    <th className="py-3 px-4 text-center">Jours de retard</th>
                    <th className="py-3 px-4 text-right">Pénalité calculée</th>
                    <th className="py-3 px-4 text-center">Échéances échues</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {creditsEnRetard.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-emerald-700 font-bold">
                        🎉 Aucun crédit en retard ! Tous les remboursements sont à jour.
                      </td>
                    </tr>
                  ) : (
                    creditsEnRetard.map((r) => (
                      <tr key={r.credit_id} className="hover:bg-rose-50/30">
                        <td className="py-3 px-4">
                          <Link
                            href={`/admin/membres/${r.credit?.membres?.id}`}
                            className="font-bold text-gray-900 hover:underline"
                          >
                            {r.credit?.membres?.prenom} {r.credit?.membres?.nom}
                          </Link>
                          <span className="block font-mono text-xs text-gray-500">
                            N° {r.credit?.membres?.numero} · Tél : {r.credit?.membres?.telephone || "—"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm font-bold text-rose-700 whitespace-nowrap">
                          {formatMontant(r.montant_retard)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-flex rounded-md bg-rose-100 px-2 py-0.5 font-mono text-xs font-bold text-rose-800">
                            {r.max_jours_retard} j
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-rose-900 whitespace-nowrap">
                          +{formatMontant(r.penalite_calculee)}
                        </td>
                        <td className="py-3 px-4 text-center text-gray-600">
                          {r.echeances.length} éch. échue(s)
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Link
                            href={`/admin/membres/${r.credit?.membres?.id}`}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Fiche membre →
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
      {/* MODAL : ENREGISTREMENT D'UN REMBOURSEMENT (IMPUTATION SÉQUENTIELLE)       */}
      {/* ========================================================================= */}
      {creditToRepay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-950">
              Enregistrer un remboursement de crédit
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Le montant sera automatiquement imputé sur les échéances les plus anciennes.
            </p>

            <div className="mt-4 rounded-xl bg-gray-50 p-3 text-xs space-y-1">
              <p>
                <strong>Adhérent :</strong> N° {creditToRepay.membres?.numero} ·{" "}
                {creditToRepay.membres?.prenom} {creditToRepay.membres?.nom}
              </p>
              <p>
                <strong>Reste dû total :</strong>{" "}
                <span className="font-mono font-bold text-primary-900">
                  {formatMontant(creditToRepay.reste_du)}
                </span>
              </p>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Montant remboursé (F CFA) *
                </label>
                <MontantInput
                  value={repayMontant}
                  onChange={(v) => setRepayMontant(v)}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 font-mono text-base font-bold focus:border-primary-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700">
                  Motif ou commentaire
                </label>
                <input
                  type="text"
                  placeholder="Ex : Remboursement mensuel ou versement exceptionnel"
                  value={repayMotif}
                  onChange={(e) => setRepayMotif(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500 focus:outline-hidden"
                />
              </div>

              <label className="flex items-center gap-2 pt-1 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={repayAnticipe}
                  onChange={(e) => setRepayAnticipe(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span>Remboursement anticipé (déduction des intérêts non échus)</span>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreditToRepay(null)}
                disabled={repayLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleRembourser}
                disabled={repayLoading || repayMontant <= 0}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 disabled:opacity-40"
              >
                {repayLoading ? "Enregistrement…" : "Confirmer le versement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : REFUS MOTIVÉ D'UNE DEMANDE DE CRÉDIT                              */}
      {/* ========================================================================= */}
      {refusModalDemande && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-700">
              Refuser la demande de crédit
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Veuillez indiquer le motif du refus. Cette justification sera enregistrée et consultable par l'adhérent et l'agent.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-bold text-gray-700">
                Motif obligatoire du refus *
              </label>
              <textarea
                rows={3}
                required
                value={refusMotif}
                onChange={(e) => setRefusMotif(e.target.value)}
                placeholder="Ex : Capacité de remboursement insuffisante, historique de retards..."
                className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-rose-500 focus:outline-hidden"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRefusModalDemande(null);
                  setRefusMotif("");
                }}
                disabled={actionLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleRefuserCredit}
                disabled={actionLoading || !refusMotif.trim()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 disabled:opacity-40"
              >
                {actionLoading ? "Enregistrement…" : "Enregistrer le refus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
