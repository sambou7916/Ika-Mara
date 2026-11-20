"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { formatMontant, formatDate, formatDateTime } from "@/lib/utils/format";
import MontantInput, { EntierInput } from "@/components/ui/MontantInput";

interface CycleItem {
  id: string;
  nom: string;
  montant_pot: number;
  periodicite: string;
  date_debut: string;
  date_fin: string | null;
  statut: "actif" | "termine" | "annule";
  part_journaliere: number;
  duree_tour_jours: number;
  nombre_participants: number;
  tour_courant: number;
  methode_ordre: "manuel" | "tirage_au_sort";
  parts_commission: number;
  tours_total: number;
  tours_verses: number;
  progression_pourcentage: number;
}

interface ParticipantItem {
  id: string;
  cycle_id: string;
  membre_id: string;
  ordre: number;
  statut: "actif" | "suspendu";
  motif_suspension: string | null;
  date_suspension: string | null;
  penalite_appliquee: number;
  membres?: {
    id: string;
    numero: string;
    nom: string;
    prenom: string;
    telephone: string | null;
    quartier: string | null;
  };
}

interface TourItem {
  id: string;
  cycle_id: string;
  numero_tour: number;
  beneficiaire_id: string;
  montant_verse: number;
  date_tour: string;
  date_debut: string;
  date_fin: string;
  montant_cagnotte: number;
  montant_commission: number;
  montant_net: number;
  statut: "en_attente" | "verse" | "annule";
  date_decaissement: string | null;
  membres?: {
    id: string;
    numero: string;
    nom: string;
    prenom: string;
    telephone: string | null;
  };
}

interface TourCourantDetail extends TourItem {
  cagnotte_collectee: number;
  cagnotte_cible: number;
  cagnotte_suffisante: boolean;
  montant_manquant: number;
  commission_tour: number;
  montant_net: number;
  participants_retard: Array<{
    membre_id: string;
    numero: string;
    nom: string;
    prenom: string;
    telephone: string | null;
    quartier: string | null;
    cotise: number;
    attendu: number;
    manquant: number;
    jours_retard: number;
  }>;
}

interface MembreEligible {
  id: string;
  numero: string;
  nom: string;
  prenom: string;
  telephone: string | null;
  quartier: string | null;
  profiles?: {
    nom: string;
    identifiant: string;
  };
}

interface DecaissementItem {
  id: string;
  cycle_id: string;
  numero_tour: number;
  date_decaissement: string;
  date_tour: string;
  montant_cagnotte: number;
  montant_commission: number;
  montant_net: number;
  cycles_pari?: { nom: string };
  membres?: {
    id: string;
    numero: string;
    nom: string;
    prenom: string;
    telephone: string | null;
    quartier: string | null;
  };
}

export default function AdminPariPage() {
  const [activeTab, setActiveTab] = useState<"cycles" | "decaissements">("cycles");
  const [cycles, setCycles] = useState<CycleItem[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);

  // Données du cycle sélectionné
  const [selectedCycle, setSelectedCycle] = useState<CycleItem | null>(null);
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [tours, setTours] = useState<TourItem[]>([]);
  const [tourCourant, setTourCourant] = useState<TourCourantDetail | null>(null);

  // Modal Nouveau Cycle
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [membresEligibles, setMembresEligibles] = useState<MembreEligible[]>([]);
  const [cycleNom, setCycleNom] = useState("");
  const [cycleDateDebut, setCycleDateDebut] = useState(() => new Date().toISOString().slice(0, 10));
  const [cyclePartJournaliere, setCyclePartJournaliere] = useState<number>(1000);
  const [cycleDureeTour, setCycleDureeTour] = useState<number>(30);
  const [cyclePartsCommission, setCyclePartsCommission] = useState<number>(1);
  const [selectedMembres, setSelectedMembres] = useState<string[]>([]);
  const [membreSearch, setMembreSearch] = useState("");

  // Modal Tirage au sort
  const [tirageLoading, setTirageLoading] = useState(false);

  // Modal Suspension
  const [participantToSuspend, setParticipantToSuspend] = useState<ParticipantItem | null>(null);
  const [suspensionMotif, setSuspensionMotif] = useState("");
  const [suspensionLoading, setSuspensionLoading] = useState(false);

  // Modal Décaissement
  const [showDecaissementModal, setShowDecaissementModal] = useState(false);
  const [decaissementLoading, setDecaissementLoading] = useState(false);

  // Décaissements globaux (onglet 2)
  const [decaissements, setDecaissements] = useState<DecaissementItem[]>([]);
  const [decaissementPeriode, setDecaissementPeriode] = useState<"" | "jour" | "mois" | "annee">("");
  const [decaissementSearch, setDecaissementSearch] = useState("");
  const [totauxDecaissements, setTotauxDecaissements] = useState({
    total_decaisse: 0,
    total_commissions: 0,
    nombre: 0,
  });

  // États génériques
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Chargement de la liste des cycles
  const fetchCycles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pari?action=liste_cycles", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Erreur de chargement");
      setCycles(json.cycles || []);

      // Sélectionner automatiquement le premier cycle s'il n'y en a pas d'actif
      if (json.cycles?.length > 0 && !selectedCycleId) {
        setSelectedCycleId(json.cycles[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  // Chargement des détails d'un cycle
  const fetchDetailCycle = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/pari?action=detail_cycle&cycle_id=${id}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setSelectedCycle(json.cycle);
      setParticipants(json.participants || []);
      setTours(json.tours || []);
      setTourCourant(json.tour_courant || null);
    } catch (err: unknown) {
      console.error("Erreur chargement détail cycle :", err);
    }
  };

  // Chargement des décaissements pour l'onglet historique
  const fetchDecaissements = async () => {
    try {
      const p = new URLSearchParams();
      p.set("action", "decaissements");
      if (decaissementPeriode) p.set("periode", decaissementPeriode);
      if (decaissementSearch) p.set("search", decaissementSearch);

      const res = await fetch(`/api/admin/pari?${p.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setDecaissements(json.decaissements || []);
        if (json.totaux) setTotauxDecaissements(json.totaux);
      }
    } catch (err: unknown) {
      console.error("Erreur chargement décaissements :", err);
    }
  };

  // Chargement des membres éligibles pour le formulaire de création
  const fetchMembresEligibles = async () => {
    try {
      const res = await fetch("/api/admin/pari?action=membres_eligibles", { cache: "no-store" });
      const json = await res.json();
      if (json.success) setMembresEligibles(json.membres || []);
    } catch (err) {
      console.error("Erreur chargement membres éligibles :", err);
    }
  };

  useEffect(() => {
    startTransition(() => {
      fetchCycles();
    });
  }, []);

  useEffect(() => {
    if (selectedCycleId) {
      fetchDetailCycle(selectedCycleId);
    }
  }, [selectedCycleId]);

  useEffect(() => {
    if (activeTab === "decaissements") {
      fetchDecaissements();
    }
  }, [activeTab, decaissementPeriode]);

  // Création d'un cycle
  const handleCreateCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cycleNom.trim()) return alert("Le nom du cycle est obligatoire.");
    if (selectedMembres.length < 2) return alert("Sélectionnez au moins 2 participants.");
    if (cyclePartJournaliere <= 0) return alert("Saisissez la part journalière (montant supérieur à 0).");
    if (cycleDureeTour <= 0) return alert("Saisissez la durée d'un tour (au moins 1 jour).");

    setLoading(true);
    try {
      const res = await fetch("/api/admin/pari", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "creer_cycle",
          nom: cycleNom.trim(),
          date_debut: cycleDateDebut,
          part_journaliere: Number(cyclePartJournaliere),
          duree_tour_jours: Number(cycleDureeTour),
          parts_commission: Number(cyclePartsCommission),
          membre_ids: selectedMembres,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec de création");

      setNotification({ type: "ok", msg: json.message });
      setShowCreateModal(false);
      setSelectedMembres([]);
      setCycleNom("");
      fetchCycles();
      if (json.cycle_id) setSelectedCycleId(json.cycle_id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur de création");
    } finally {
      setLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Tirage au sort de l'ordre de passage
  const handleTirageAuSort = async () => {
    if (!selectedCycleId) return;
    if (!confirm("Voulez-vous procéder au tirage au sort ? L'ordre de passage sera figé et consigné dans le journal d'audit.")) {
      return;
    }

    setTirageLoading(true);
    try {
      const res = await fetch("/api/admin/pari", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tirer_au_sort",
          cycle_id: selectedCycleId,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec du tirage");

      setNotification({ type: "ok", msg: json.message });
      fetchDetailCycle(selectedCycleId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur du tirage");
    } finally {
      setTirageLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Réordonner manuellement (monter/descendre)
  const handleMoveParticipant = async (index: number, direction: "up" | "down") => {
    if (!selectedCycleId || participants.length < 2) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= participants.length) return;

    // Vérifier si un des deux tours est déjà versé
    const tour1 = tours.find((t) => t.numero_tour === participants[index].ordre);
    const tour2 = tours.find((t) => t.numero_tour === participants[targetIndex].ordre);
    if (tour1?.statut === "verse" || tour2?.statut === "verse") {
      alert("Impossible de modifier l'ordre d'un tour déjà versé.");
      return;
    }

    const newParticipants = [...participants];
    const temp = newParticipants[index];
    newParticipants[index] = newParticipants[targetIndex];
    newParticipants[targetIndex] = temp;

    // Réassigner les ordres de 1 à N
    const nouveauxOrdres = newParticipants.map((p, idx) => ({
      membre_id: p.membre_id,
      ordre: idx + 1,
    }));

    try {
      const res = await fetch("/api/admin/pari", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reordonner",
          cycle_id: selectedCycleId,
          ordres: nouveauxOrdres,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      fetchDetailCycle(selectedCycleId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur de réordonnancement");
    }
  };

  // Suspension d'un participant en défaut
  const handleSuspendParticipant = async () => {
    if (!participantToSuspend || !selectedCycleId) return;
    if (!suspensionMotif.trim()) {
      alert("Le motif de suspension est obligatoire.");
      return;
    }

    setSuspensionLoading(true);
    try {
      const res = await fetch("/api/admin/pari", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suspendre_participant",
          cycle_id: selectedCycleId,
          membre_id: participantToSuspend.membre_id,
          motif: suspensionMotif.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec de suspension");

      setNotification({ type: "ok", msg: json.message });
      setParticipantToSuspend(null);
      setSuspensionMotif("");
      fetchDetailCycle(selectedCycleId);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur de suspension");
    } finally {
      setSuspensionLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Décaissement du tour courant
  const handleDecaisserTour = async () => {
    if (!tourCourant) return;

    setDecaissementLoading(true);
    try {
      const res = await fetch("/api/admin/pari", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "decaisser_tour",
          tour_id: tourCourant.id,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec du décaissement");

      setNotification({
        type: "ok",
        msg: `Tour n° ${json.numero_tour} décaissé avec succès ! Bénéficiaire N° ${json.beneficiaire_numero} (${formatMontant(json.montant_net)} net).`,
      });
      setShowDecaissementModal(false);
      if (selectedCycleId) fetchDetailCycle(selectedCycleId);
      fetchCycles();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur lors du décaissement");
    } finally {
      setDecaissementLoading(false);
      setTimeout(() => setNotification(null), 7000);
    }
  };

  // Export Excel des décaissements
  const handleExportDecaissementsExcel = () => {
    if (decaissements.length === 0) return;

    const entetes = [
      "Date Décaissement",
      "Cycle",
      "Tour N°",
      "N° Adhérent",
      "Bénéficiaire",
      "Téléphone",
      "Cagnotte Brute (F CFA)",
      "Commission (F CFA)",
      "Net Décaissé (F CFA)",
    ];

    const lignes = decaissements.map((d) => [
      `"${formatDate(d.date_decaissement)}"`,
      `"${d.cycles_pari?.nom || ""}"`,
      d.numero_tour,
      `"${d.membres?.numero || ""}"`,
      `"${(d.membres?.prenom || "") + " " + (d.membres?.nom || "")}"`,
      `"${d.membres?.telephone || ""}"`,
      d.montant_cagnotte,
      d.montant_commission,
      d.montant_net,
    ]);

    const csvContent =
      "\uFEFF" +
      [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IKA-MARA_Decaissements_Pari_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Calcul du pot prévisionnel dans le modal
  const potPrevisionnel =
    selectedMembres.length * cyclePartJournaliere * cycleDureeTour;

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

      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-purple-800">
              Volet Tontine
            </span>
            <span className="text-xs text-gray-500">IKA-PARI</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-950 sm:text-3xl">
            Gestion Ika-Pari
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Cycles de tontine rotative, tirage au sort, suivi de la cagnotte et décaissements sécurisés
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchMembresEligibles();
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-purple-700 active:scale-95"
          >
            <span>+</span> Nouveau cycle
          </button>
        </div>
      </div>

      {/* Barre des onglets */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab("cycles")}
            className={`border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "cycles"
                ? "border-purple-600 text-purple-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Cycles en cours & Tours</span>
          </button>
          <button
            onClick={() => setActiveTab("decaissements")}
            className={`border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "decaissements"
                ? "border-purple-600 text-purple-700"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Historique des décaissements</span>
          </button>
        </nav>
      </div>

      {/* ========================================================================= */}
      {/* ONGLET 1 : CYCLES & TOURS DE TONTINE                                     */}
      {/* ========================================================================= */}
      {activeTab === "cycles" && (
        <div className="space-y-6">
          {/* Sélecteur horizontal de cycles */}
          {cycles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
              <span className="text-3xl">🤝</span>
              <p className="mt-2 text-sm font-bold text-gray-900">
                Aucun cycle de tontine existant
              </p>
              <p className="text-xs text-gray-500">
                Créez votre premier cycle Ika-Pari en cliquant sur « Nouveau cycle ».
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {cycles.map((c) => {
                const isSelected = c.id === selectedCycleId;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCycleId(c.id)}
                    className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                      isSelected
                        ? "border-purple-600 bg-purple-50/50 shadow-md ring-2 ring-purple-600/20"
                        : "border-gray-200 bg-white hover:border-purple-300 hover:shadow-xs"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-xs font-bold text-purple-700">
                        Tour {c.tour_courant} / {c.nombre_participants}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          c.statut === "actif"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {c.statut === "actif" ? "Actif" : "Terminé"}
                      </span>
                    </div>

                    <h3 className="mt-1 font-bold text-gray-950 truncate">{c.nom}</h3>
                    <p className="font-mono text-base font-bold text-purple-900 mt-1">
                      {formatMontant(c.montant_pot)}
                      <span className="text-xs font-normal text-gray-500"> / tour</span>
                    </p>

                    {/* Barre de progression */}
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Progression</span>
                        <span>{c.progression_pourcentage} %</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full bg-purple-600 transition-all"
                          style={{ width: `${c.progression_pourcentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* DÉTAIL DU CYCLE SÉLECTIONNÉ */}
          {selectedCycle && (
            <div className="space-y-6">
              {/* Carte principale : Tour courant & Cagnotte */}
              <div className="rounded-2xl border border-purple-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-purple-100 px-2.5 py-1 text-xs font-bold text-purple-800">
                        Tour n° {tourCourant?.numero_tour || selectedCycle.tour_courant} en cours
                      </span>
                      <span className="text-xs text-gray-500">
                        Du {formatDate(tourCourant?.date_debut || selectedCycle.date_debut)} au{" "}
                        {formatDate(tourCourant?.date_fin || selectedCycle.date_debut)}
                      </span>
                    </div>
                    <h2 className="mt-2 text-2xl font-bold text-gray-950">
                      Bénéficiaire désigné :{" "}
                      <span className="text-purple-700 underline decoration-purple-300">
                        N° {tourCourant?.membres?.numero || "—"} ·{" "}
                        {tourCourant?.membres?.prenom} {tourCourant?.membres?.nom}
                      </span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Tél : {tourCourant?.membres?.telephone || "—"} · Part journalière :{" "}
                      <strong>{formatMontant(selectedCycle.part_journaliere)}</strong>
                    </p>
                  </div>

                  {/* Bouton de décaissement du tour */}
                  <div className="flex flex-col items-end gap-2">
                    {tourCourant?.statut === "en_attente" ? (
                      <div>
                        <button
                          onClick={() => setShowDecaissementModal(true)}
                          disabled={!tourCourant.cagnotte_suffisante}
                          className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-md hover:bg-emerald-700 active:scale-95 disabled:opacity-40"
                        >
                          💰 Décaisser le tour courant
                        </button>
                      </div>
                    ) : (
                      <span className="rounded-xl bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700">
                        ✅ Tour déjà décaissé
                      </span>
                    )}

                    {!tourCourant?.cagnotte_suffisante && tourCourant?.statut === "en_attente" && (
                      <div className="rounded-lg bg-rose-50 px-3 py-1.5 text-right text-xs font-semibold text-rose-700">
                        ⚠️ Cagnotte insuffisante : manque {formatMontant(tourCourant.montant_manquant)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Métriques du tour courant */}
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-gray-100 pt-5">
                  <div className="rounded-xl bg-gray-50 p-3">
                    <span className="text-xs font-semibold text-gray-500">Cagnotte collectée</span>
                    <p
                      className={`font-mono text-xl font-bold ${
                        tourCourant?.cagnotte_suffisante ? "text-emerald-700" : "text-amber-600"
                      }`}
                    >
                      {formatMontant(tourCourant?.cagnotte_collectee || 0)}
                    </p>
                    <span className="text-xs text-gray-400">
                      Sur {formatMontant(tourCourant?.cagnotte_cible || selectedCycle.montant_pot)} requis
                    </span>
                  </div>

                  <div className="rounded-xl bg-gray-50 p-3">
                    <span className="text-xs font-semibold text-gray-500">Commission du tour</span>
                    <p className="font-mono text-xl font-bold text-purple-900">
                      {formatMontant(tourCourant?.commission_tour || 0)}
                    </p>
                    <span className="text-xs text-gray-400">
                      {selectedCycle.parts_commission} part(s) × {formatMontant(selectedCycle.part_journaliere)}
                    </span>
                  </div>

                  <div className="rounded-xl bg-emerald-50/60 p-3">
                    <span className="text-xs font-semibold text-emerald-800">Net au bénéficiaire</span>
                    <p className="font-mono text-xl font-bold text-emerald-900">
                      {formatMontant(tourCourant?.montant_net || 0)}
                    </p>
                    <span className="text-xs text-emerald-700">Cagnotte − Commission</span>
                  </div>

                  <div className="rounded-xl bg-gray-50 p-3">
                    <span className="text-xs font-semibold text-gray-500">Participants en retard</span>
                    <p
                      className={`font-mono text-xl font-bold ${
                        (tourCourant?.participants_retard.length || 0) > 0
                          ? "text-rose-600"
                          : "text-emerald-700"
                      }`}
                    >
                      {tourCourant?.participants_retard.length || 0}
                    </p>
                    <span className="text-xs text-gray-400">Cotisations incomplètes</span>
                  </div>
                </div>

                {/* Section : Alertes participants en retard */}
                {tourCourant && tourCourant.participants_retard.length > 0 && (
                  <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                    <h3 className="text-xs font-bold text-rose-900 uppercase tracking-wide">
                      Participants en retard pour ce tour ({tourCourant.participants_retard.length})
                    </h3>
                    <div className="mt-2 divide-y divide-rose-100">
                      {tourCourant.participants_retard.map((pr) => (
                        <div
                          key={pr.membre_id}
                          className="flex flex-wrap items-center justify-between py-2 text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold text-gray-900">N° {pr.numero}</span> ·{" "}
                            <span className="font-bold text-gray-800">
                              {pr.prenom} {pr.nom}
                            </span>{" "}
                            <span className="text-gray-500">({pr.telephone || "Sans tél"})</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="text-rose-700 font-mono font-bold">
                              Manque : {formatMontant(pr.manquant)} ({pr.jours_retard} j de retard)
                            </span>
                            <button
                              onClick={() => {
                                const part = participants.find((p) => p.membre_id === pr.membre_id);
                                if (part) setParticipantToSuspend(part);
                              }}
                              className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50"
                            >
                              Suspendre…
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Tableau de l'ordre de passage & tours */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-xs overflow-hidden">
                <div className="flex flex-wrap items-center justify-between border-b border-gray-100 p-4 sm:p-5">
                  <div>
                    <h3 className="text-base font-bold text-gray-950">
                      Ordre de passage & Tours ({tours.length})
                    </h3>
                    <p className="text-xs text-gray-500">
                      Méthode actuelle :{" "}
                      <strong className="text-purple-700">
                        {selectedCycle.methode_ordre === "tirage_au_sort"
                          ? "Tirage au sort figé"
                          : "Manuel"}
                      </strong>
                    </p>
                  </div>

                  {selectedCycle.statut === "actif" && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleTirageAuSort}
                        disabled={tirageLoading || tours.some((t) => t.statut === "verse")}
                        className="rounded-xl border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-800 hover:bg-purple-100 disabled:opacity-40"
                        title={
                          tours.some((t) => t.statut === "verse")
                            ? "Impossible après premier versement"
                            : "Mélanger aléatoirement l'ordre"
                        }
                      >
                        {tirageLoading ? "Tirage…" : "🎲 Tirage au sort"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                        <th className="py-3 px-4 text-center">Tour</th>
                        <th className="py-3 px-4">Adhérent bénéficiaire</th>
                        <th className="py-3 px-4">Période du tour</th>
                        <th className="py-3 px-4 text-right">Pot Brut</th>
                        <th className="py-3 px-4 text-right">Net à payer</th>
                        <th className="py-3 px-4 text-center">Statut</th>
                        <th className="py-3 px-4 text-center">Ordre</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tours.map((t, idx) => {
                        const isCurrent = t.numero_tour === selectedCycle.tour_courant;
                        const isVerse = t.statut === "verse";

                        return (
                          <tr
                            key={t.id}
                            className={`hover:bg-gray-50/60 ${
                              isCurrent ? "bg-purple-50/30 font-semibold" : ""
                            }`}
                          >
                            <td className="py-3 px-4 text-center font-mono font-bold text-gray-900">
                              #{t.numero_tour}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-mono font-bold text-purple-700">
                                N° {t.membres?.numero}
                              </span>{" "}
                              ·{" "}
                              <Link
                                href={`/admin/membres/${t.beneficiaire_id}`}
                                className="font-bold text-gray-900 hover:underline"
                              >
                                {t.membres?.prenom} {t.membres?.nom}
                              </Link>
                              <span className="block text-xs text-gray-400">
                                {t.membres?.telephone || "Sans tél"}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                              {formatDate(t.date_debut)} → {formatDate(t.date_fin)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-gray-700">
                              {formatMontant(t.montant_cagnotte)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-800">
                              {formatMontant(
                                t.montant_net ||
                                  t.montant_cagnotte -
                                    (selectedCycle.parts_commission || 1) *
                                      selectedCycle.part_journaliere
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {isVerse ? (
                                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                                  Versé le {formatDate(t.date_decaissement || t.date_tour)}
                                </span>
                              ) : isCurrent ? (
                                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                                  En cours
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                                  À venir
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {!isVerse && (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    onClick={() => handleMoveParticipant(idx, "up")}
                                    disabled={idx === 0 || tours[idx - 1]?.statut === "verse"}
                                    className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                                    title="Monter"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    onClick={() => handleMoveParticipant(idx, "down")}
                                    disabled={idx === tours.length - 1}
                                    className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-30"
                                    title="Descendre"
                                  >
                                    ↓
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 2 : HISTORIQUE DES DÉCAISSEMENTS                                   */}
      {/* ========================================================================= */}
      {activeTab === "decaissements" && (
        <div className="space-y-6">
          {/* Cartes récapitulatives */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-bold text-gray-400 uppercase">Total Net Décaissé</span>
              <p className="mt-1 font-mono text-2xl font-bold text-emerald-700">
                {formatMontant(totauxDecaissements.total_decaisse)}
              </p>
              <span className="text-xs text-gray-500">Versé aux bénéficiaires</span>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-bold text-gray-400 uppercase">Commissions Retenues</span>
              <p className="mt-1 font-mono text-2xl font-bold text-purple-900">
                {formatMontant(totauxDecaissements.total_commissions)}
              </p>
              <span className="text-xs text-gray-500">Revenus de la structure</span>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
              <span className="text-xs font-bold text-gray-400 uppercase">Tours Versés</span>
              <p className="mt-1 font-mono text-2xl font-bold text-gray-900">
                {totauxDecaissements.nombre}
              </p>
              <span className="text-xs text-gray-500">Paiements enregistrés</span>
            </div>
          </div>

          {/* Filtres de recherche */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setDecaissementPeriode("")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                  decaissementPeriode === ""
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Tous
              </button>
              <button
                onClick={() => setDecaissementPeriode("jour")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                  decaissementPeriode === "jour"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Aujourd'hui
              </button>
              <button
                onClick={() => setDecaissementPeriode("mois")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                  decaissementPeriode === "mois"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Ce mois
              </button>
              <button
                onClick={() => setDecaissementPeriode("annee")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                  decaissementPeriode === "annee"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Cette année
              </button>

              <input
                type="text"
                placeholder="Recherche par membre ou cycle…"
                value={decaissementSearch}
                onChange={(e) => setDecaissementSearch(e.target.value)}
                className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs focus:border-purple-500 focus:outline-hidden"
              />
              <button
                onClick={fetchDecaissements}
                className="rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-black"
              >
                Filtrer
              </button>
            </div>

            <button
              onClick={handleExportDecaissementsExcel}
              disabled={decaissements.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-300 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-800 hover:bg-purple-100 disabled:opacity-40"
            >
              <span>📥 Exporter Excel (.csv)</span>
            </button>
          </div>

          {/* Tableau des décaissements */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                    <th className="py-3 px-4">Date décaissement</th>
                    <th className="py-3 px-4">Cycle</th>
                    <th className="py-3 px-4 text-center">Tour</th>
                    <th className="py-3 px-4">Bénéficiaire</th>
                    <th className="py-3 px-4 text-right">Cagnotte Brute</th>
                    <th className="py-3 px-4 text-right">Commission</th>
                    <th className="py-3 px-4 text-right">Net Versé</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {decaissements.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-500">
                        Aucun décaissement enregistré
                      </td>
                    </tr>
                  ) : (
                    decaissements.map((d) => (
                      <tr key={d.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 whitespace-nowrap font-medium text-gray-900">
                          {formatDate(d.date_decaissement)}
                        </td>
                        <td className="py-3 px-4 font-bold text-gray-900">
                          {d.cycles_pari?.nom}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-purple-700">
                          #{d.numero_tour}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono font-bold text-gray-900">
                            N° {d.membres?.numero}
                          </span>{" "}
                          · {d.membres?.prenom} {d.membres?.nom}
                          <span className="block text-xs text-gray-400">
                            {d.membres?.telephone}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-gray-600">
                          {formatMontant(d.montant_cagnotte)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-purple-800">
                          {formatMontant(d.montant_commission)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-emerald-800 text-sm">
                          {formatMontant(d.montant_net)}
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
      {/* MODAL : CRÉATION D'UN NOUVEAU CYCLE                                       */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-950">
              Créer un nouveau cycle de tontine Ika-Pari
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Renseignez les paramètres et sélectionnez les adhérents participants.
            </p>

            <form onSubmit={handleCreateCycle} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-gray-700">Nom du cycle *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex : Tontine Femmes Marché Médine"
                    value={cycleNom}
                    onChange={(e) => setCycleNom(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-purple-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700">Date de début *</label>
                  <input
                    type="date"
                    required
                    value={cycleDateDebut}
                    onChange={(e) => setCycleDateDebut(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-purple-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700">
                    Part journalière par participant (F CFA) *
                  </label>
                  <MontantInput
                    required
                    value={cyclePartJournaliere}
                    onChange={(v) => setCyclePartJournaliere(v)}
                    className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-purple-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700">
                    Durée d'un tour (en jours) *
                  </label>
                  <EntierInput suffixe="jours"
                    required
                    value={cycleDureeTour}
                    onChange={(v) => setCycleDureeTour(v)}
                    className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-purple-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700">
                    Parts de commission par tour (défaut : 1)
                  </label>
                  <EntierInput
                    required
                    value={cyclePartsCommission}
                    onChange={(v) => setCyclePartsCommission(v)}
                    className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-purple-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Sélection des membres */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-700">
                    Participants sélectionnés ({selectedMembres.length})
                  </label>
                  <input
                    type="text"
                    placeholder="Filtrer les membres…"
                    value={membreSearch}
                    onChange={(e) => setMembreSearch(e.target.value)}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                  />
                </div>

                <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100 p-1">
                  {membresEligibles
                    .filter((m) =>
                      `${m.numero} ${m.nom} ${m.prenom} ${m.quartier}`
                        .toLowerCase()
                        .includes(membreSearch.toLowerCase())
                    )
                    .map((m) => {
                      const isChecked = selectedMembres.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer text-xs ${
                            isChecked ? "bg-purple-50" : "hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedMembres([...selectedMembres, m.id]);
                                } else {
                                  setSelectedMembres(selectedMembres.filter((id) => id !== m.id));
                                }
                              }}
                              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="font-mono font-bold text-gray-900">N° {m.numero}</span>
                            <span className="font-semibold text-gray-800">
                              {m.prenom} {m.nom}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500">{m.quartier || "—"}</span>
                        </label>
                      );
                    })}
                </div>
              </div>

              {/* Prévisualisation calculée */}
              <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 text-xs">
                <div className="flex justify-between py-1">
                  <span className="text-gray-600">Nombre de participants :</span>
                  <span className="font-bold text-gray-900">{selectedMembres.length}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-600">Cagnotte brute par tour :</span>
                  <span className="font-mono font-bold text-purple-900">
                    {formatMontant(potPrevisionnel)}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-600">Durée totale du cycle :</span>
                  <span className="font-bold text-gray-900">
                    {selectedMembres.length * cycleDureeTour} jours ({selectedMembres.length} tours)
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={loading || selectedMembres.length < 2}
                  className="rounded-xl bg-purple-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-purple-700 disabled:opacity-50"
                >
                  {loading ? "Création…" : "Enregistrer le cycle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : CONFIRMATION DÉCAISSEMENT ATOMIQUE                               */}
      {/* ========================================================================= */}
      {showDecaissementModal && tourCourant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-950">
              Décaissement du tour n° {tourCourant.numero_tour}
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Cette action enregistrera l'opération de décaissement net, prélèvera la commission et générera une sortie de caisse physique.
            </p>

            {/* Fiche bénéficiaire en grand */}
            <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50/70 p-4 text-center">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-700">
                Bénéficiaire du tour
              </span>
              <p className="font-mono text-3xl font-bold text-gray-950 mt-1">
                N° {tourCourant.membres?.numero}
              </p>
              <p className="text-base font-bold text-gray-800">
                {tourCourant.membres?.prenom} {tourCourant.membres?.nom}
              </p>
              <p className="text-xs text-gray-500">Tél : {tourCourant.membres?.telephone || "—"}</p>
            </div>

            {/* Détails financiers */}
            <div className="mt-4 space-y-2 rounded-xl bg-gray-50 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Cagnotte brute collectée :</span>
                <span className="font-mono font-bold text-gray-900">
                  {formatMontant(tourCourant.montant_cagnotte)}
                </span>
              </div>
              <div className="flex justify-between text-purple-800">
                <span>Commission déduite :</span>
                <span className="font-mono font-bold">
                  − {formatMontant(tourCourant.commission_tour)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2 text-sm">
                <span className="font-bold text-emerald-900">Net à décaisser :</span>
                <span className="font-mono font-bold text-emerald-700">
                  {formatMontant(tourCourant.montant_net)}
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDecaissementModal(false)}
                disabled={decaissementLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDecaisserTour}
                disabled={decaissementLoading}
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
              >
                {decaissementLoading ? "Décaissement…" : "Confirmer le paiement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL : SUSPENSION PARTICIPANT EN DÉFAUT                                 */}
      {/* ========================================================================= */}
      {participantToSuspend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-rose-700">
              Suspendre le participant pour défaut de cotisation
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              Conformément aux paramètres de gestion, une pénalité financière sera consignée pour ce défaut. Le motif est obligatoire.
            </p>

            <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs">
              <p>
                <strong>Adhérent :</strong> N° {participantToSuspend.membres?.numero} ·{" "}
                {participantToSuspend.membres?.prenom} {participantToSuspend.membres?.nom}
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold text-gray-700">
                Motif de la suspension (obligatoire) *
              </label>
              <textarea
                rows={3}
                required
                value={suspensionMotif}
                onChange={(e) => setSuspensionMotif(e.target.value)}
                placeholder="Ex : Retard supérieur à 10 jours sans justification..."
                className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-rose-500 focus:outline-hidden"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setParticipantToSuspend(null);
                  setSuspensionMotif("");
                }}
                disabled={suspensionLoading}
                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSuspendParticipant}
                disabled={suspensionLoading || !suspensionMotif.trim()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 disabled:opacity-50"
              >
                {suspensionLoading ? "Traitement…" : "Confirmer la suspension"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
