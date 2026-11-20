"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMontant, formatDateTime, formatDate, libelleOperation, libelleVolet, badgeVolet } from "@/lib/utils/format";

interface OperationDetail {
  id: string;
  type: string;
  volet: string;
  montant: number;
  jours_couverts: number;
  date_operation: string;
  cree_le: string;
  statut: string;
  motif: string | null;
  annule_ref: string | null;
  profiles?: {
    nom: string;
    identifiant: string;
  };
}

interface SouscriptionDetail {
  id: string;
  volet: "mara" | "pari" | "djourou";
  montant_jour: number;
  parts_commission: number;
  date_debut: string;
  statut: string;
  cree_le: string;
  historique_souscriptions?: Array<{
    id: string;
    champ_modifie: string;
    ancienne_valeur: string | null;
    nouvelle_valeur: string | null;
    modifie_le: string;
  }>;
}

export default function AdminMembreDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { id } = params;

  const [membre, setMembre] = useState<any>(null);
  const [souscriptions, setSouscriptions] = useState<SouscriptionDetail[]>([]);
  const [soldes, setSoldes] = useState<any[]>([]);
  const [arrieres, setArrieres] = useState<any[]>([]);
  const [operations, setOperations] = useState<OperationDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Annulation d'opération
  const [operationToCancel, setOperationToCancel] = useState<OperationDetail | null>(null);
  const [cancelMotif, setCancelMotif] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/membres/${id}`);
      if (!res.ok) throw new Error("Impossible de charger la fiche du membre");

      const json = await res.json();
      if (json.success) {
        setMembre(json.membre);
        setSouscriptions(json.souscriptions || []);
        setSoldes(json.soldes || []);
        setArrieres(json.arrieres || []);
        setOperations(json.operations || []);
      } else {
        throw new Error(json.error || "Erreur de chargement");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  // Exécution de l'annulation par écriture inverse
  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operationToCancel) return;
    if (!cancelMotif.trim()) {
      setCancelError("Le motif d'annulation est obligatoire");
      return;
    }

    setIsCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch("/api/annulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: operationToCancel.id,
          motif: cancelMotif.trim(),
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification({ type: "ok", msg: json.message });
        setOperationToCancel(null);
        setCancelMotif("");
        fetchDetail();
      } else {
        setCancelError(json.error || "Échec de l'annulation");
      }
    } catch {
      setCancelError("Erreur lors de la requête d'annulation");
    } finally {
      setIsCancelling(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Trouver les soldes par volet
  const soldeMara = soldes.find((s) => s.volet === "mara")?.solde ?? 0;
  const soldePari = soldes.find((s) => s.volet === "pari")?.solde ?? 0;
  const soldeDjourou = soldes.find((s) => s.volet === "djourou")?.solde ?? 0;

  // Liste des IDs d'opérations qui ont déjà été annulées
  const annuleRefs = new Set(
    operations
      .filter((o) => o.type === "annulation" && o.annule_ref)
      .map((o) => o.annule_ref)
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Navigation haute */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/membres"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 active:scale-95"
            aria-label="Retour à la liste"
          >
            ‹
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-950 sm:text-2xl">
              Fiche Membre · {membre ? `${membre.prenom} ${membre.nom}` : "Chargement…"}
            </h1>
            <p className="text-xs text-gray-500">
              Adhérent n° <span className="font-mono font-bold text-gray-900">{membre?.numero}</span>
            </p>
          </div>
        </div>

        {membre && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              membre.statut === "actif"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-gray-100 text-gray-500 border border-gray-200"
            }`}
          >
            {membre.statut === "actif" ? "Membre Actif" : "Membre Inactif"}
          </span>
        )}
      </div>

      {notification && (
        <div
          className={`rounded-2xl border p-4 text-xs font-semibold ${
            notification.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notification.msg}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          ⚠️ {error}
        </div>
      )}

      {loading && !membre ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-xs text-gray-400">
          Chargement des détails du membre…
        </div>
      ) : membre ? (
        <>
          {/* Bloc 1 : Identité & Agent référent */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 text-xl font-bold text-primary-800">
                  {membre.prenom.charAt(0)}
                  {membre.nom.charAt(0)}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {membre.prenom} {membre.nom}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {membre.profession || "Profession non renseignée"} · {membre.quartier || "Quartier non renseigné"}
                  </p>
                  <p className="mt-1 text-xs font-mono font-semibold text-primary-700">
                    📞 {membre.telephone || "Aucun téléphone"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t border-gray-100 pt-3 text-xs">
                <div>
                  <span className="text-xs text-gray-400">Date d'inscription</span>
                  <p className="font-semibold text-gray-800">{formatDate(membre.cree_le)}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Statut du dossier</span>
                  <p className="font-semibold text-gray-800 capitalize">{membre.statut}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Nombre d'opérations</span>
                  <p className="font-semibold text-gray-800 font-mono">{operations.length}</p>
                </div>
              </div>
            </div>

            {/* Carte Agent Référent */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Agent Référent Terrain
              </span>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-sm font-bold text-gray-800">
                  👤
                </span>
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {membre.profiles?.nom || "Non assigné"}
                  </p>
                  <p className="text-xs font-mono text-primary-700">
                    ID : {membre.profiles?.identifiant || "—"}
                  </p>
                </div>
              </div>
              {membre.profiles?.telephone && (
                <p className="text-xs text-gray-500 pt-1 border-t border-gray-100">
                  Tél agent : <span className="font-mono">{membre.profiles.telephone}</span>
                </p>
              )}
            </div>
          </div>

          {/* Bloc 2 : Soldes par Volet */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Mara */}
            <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                💰 Ika-Mara (Épargne)
              </span>
              <p className="mt-2 text-2xl font-bold text-gray-900 font-mono">
                {formatMontant(soldeMara)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Solde net disponible pour retrait
              </p>
            </div>

            {/* Pari */}
            <div className="rounded-2xl border border-primary-100 bg-white p-4 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-primary-800">
                🔄 Ika-Pari (Tontine)
              </span>
              <p className="mt-2 text-2xl font-bold text-gray-900 font-mono">
                {formatMontant(soldePari)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Cumul cotisé sur les cycles
              </p>
            </div>

            {/* Djourou */}
            <div className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-800">
                📋 Ika-Djourou (Crédit)
              </span>
              <p className="mt-2 text-2xl font-bold text-gray-900 font-mono">
                {formatMontant(soldeDjourou)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Encours ou dette restante due
              </p>
            </div>
          </div>

          {/* Bloc 3 : Souscriptions actives & Historique */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
              Souscriptions & Tarification
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {souscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className={`rounded-xl border p-3.5 space-y-2 ${
                    sub.statut === "active"
                      ? "border-primary-200 bg-primary-50/20"
                      : "border-gray-200 bg-gray-50 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-gray-800">
                      Volet {sub.volet}
                    </span>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        sub.statut === "active"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {sub.statut}
                    </span>
                  </div>

                  <p className="text-base font-bold text-gray-900 font-mono">
                    {formatMontant(sub.montant_jour)} / jour
                  </p>
                  <p className="text-xs text-gray-500">
                    Commission : <strong>{sub.parts_commission} part(s)</strong> / mois
                  </p>

                  {/* Historique des modifications pour cette souscription */}
                  {sub.historique_souscriptions && sub.historique_souscriptions.length > 0 && (
                    <div className="mt-2 border-t border-gray-200/60 pt-2 space-y-1">
                      <span className="text-xs font-bold uppercase text-gray-400">
                        Historique tarifaire
                      </span>
                      {sub.historique_souscriptions.slice(0, 3).map((h) => (
                        <p key={h.id} className="text-xs text-gray-500 leading-tight">
                          • {formatDate(h.modifie_le)} : {h.nouvelle_valeur}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Bloc 4 : Historique des Mouvements & Annulation */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                  Journal des Mouvements Financiers
                </h3>
                <p className="text-xs text-gray-500">
                  Tous les dépôts, retraits, commissions et annulations enregistrés
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-gray-500">
                {operations.length} opération(s)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-gray-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3.5 py-3">Date</th>
                    <th className="px-3.5 py-3">Type</th>
                    <th className="px-3.5 py-3">Volet</th>
                    <th className="px-3.5 py-3 text-right">Montant</th>
                    <th className="px-3.5 py-3">Agent</th>
                    <th className="px-3.5 py-3">Détail / Motif</th>
                    <th className="px-3.5 py-3 text-center">Statut</th>
                    <th className="px-3.5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium">
                  {operations.length > 0 ? (
                    operations.map((op) => {
                      const isAnnulation = op.type === "annulation";
                      const isAlreadyAnnulee = annuleRefs.has(op.id);
                      const canBeCancelled = !isAnnulation && !isAlreadyAnnulee && op.statut === "validee";

                      return (
                        <tr
                          key={op.id}
                          className={`transition ${
                            isAnnulation
                              ? "bg-red-50/30 text-red-900"
                              : isAlreadyAnnulee
                              ? "bg-gray-50 text-gray-400 line-through"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          {/* Date */}
                          <td className="px-3.5 py-3 whitespace-nowrap font-mono text-gray-600">
                            {formatDateTime(op.cree_le)}
                          </td>

                          {/* Type */}
                          <td className="px-3.5 py-3 font-bold uppercase">
                            {libelleOperation(op.type)}
                          </td>

                          {/* Volet */}
                          <td className="px-3.5 py-3 uppercase">
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-800">
                              {op.volet}
                            </span>
                          </td>

                          {/* Montant */}
                          <td className="px-3.5 py-3 text-right font-mono font-bold">
                            {isAnnulation ? `-${formatMontant(op.montant)}` : formatMontant(op.montant)}
                          </td>

                          {/* Agent */}
                          <td className="px-3.5 py-3 text-gray-700">
                            {op.profiles?.nom || "—"}
                          </td>

                          {/* Motif */}
                          <td className="px-3.5 py-3 text-gray-500 max-w-xs truncate" title={op.motif || ""}>
                            {op.motif || "—"}
                          </td>

                          {/* Statut */}
                          <td className="px-3.5 py-3 text-center">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                isAnnulation
                                  ? "bg-red-100 text-red-800"
                                  : isAlreadyAnnulee
                                  ? "bg-gray-200 text-gray-600"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {isAlreadyAnnulee ? "Annulée" : op.statut}
                            </span>
                          </td>

                          {/* Action Annulation */}
                          <td className="px-3.5 py-3 text-right">
                            {canBeCancelled && (
                              <button
                                onClick={() => {
                                  setOperationToCancel(op);
                                  setCancelMotif("");
                                  setCancelError(null);
                                }}
                                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-100 transition"
                              >
                                Annuler
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-gray-400">
                        Aucun mouvement financier enregistré pour ce membre.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {/* Modal Annulation d'Opération par Écriture Inverse */}
      {operationToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900">
              Annulation d'une opération financière
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Conformément à la règle de non-suppression d'IKA-MARA, cette action
              va créer une <strong>écriture inverse d'annulation</strong> liée à l'opération d'origine.
            </p>

            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs space-y-1">
              <p>
                <strong>Opération :</strong> {libelleOperation(operationToCancel.type)} · Volet {operationToCancel.volet.toUpperCase()}
              </p>
              <p>
                <strong>Montant :</strong> {formatMontant(operationToCancel.montant)}
              </p>
              <p>
                <strong>Date initiale :</strong> {formatDate(operationToCancel.date_operation)}
              </p>
            </div>

            <form onSubmit={handleConfirmCancel} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Motif d'annulation (Obligatoire)
                </label>
                <textarea
                  value={cancelMotif}
                  onChange={(e) => setCancelMotif(e.target.value)}
                  required
                  placeholder="Ex. : Erreur de saisie de l'agent sur le montant, double versement saisi par mégarde…"
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-red-500 focus:outline-none"
                />
              </div>

              {cancelError && (
                <div className="rounded-xl bg-red-50 p-2.5 text-xs font-semibold text-red-700 border border-red-200">
                  ⚠️ {cancelError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOperationToCancel(null)}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                >
                  Fermer
                </button>
                <button
                  type="submit"
                  disabled={isCancelling || !cancelMotif.trim()}
                  className="flex-1 rounded-xl bg-red-600 py-2.5 text-xs font-bold text-white shadow hover:bg-red-700 disabled:opacity-50"
                >
                  {isCancelling ? "Annulation…" : "Valider l'annulation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
