"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMontant, formatDateTime, formatDate } from "@/lib/utils/format";

export default function AdminAgentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { id } = params;

  const [agent, setAgent] = useState<any>(null);
  const [portefeuille, setPortefeuille] = useState<any[]>([]);
  const [autresAgents, setAutresAgents] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [remisesRecentes, setRemisesRecentes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  // Sélection multiple pour réaffectation
  const [selectedMembres, setSelectedMembres] = useState<string[]>([]);
  const [showReaffectModal, setShowReaffectModal] = useState(false);
  const [targetAgentId, setTargetAgentId] = useState("");
  const [isReaffecting, setIsReaffecting] = useState(false);

  // Modale Réinitialisation de PIN
  const [showResetPinModal, setShowResetPinModal] = useState(false);
  const [nouveauPin, setNouveauPin] = useState("");
  const [isResettingPin, setIsResettingPin] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/agents/${id}`);
      if (!res.ok) throw new Error("Impossible de charger la fiche de l'agent");

      const json = await res.json();
      if (json.success) {
        setAgent(json.agent);
        setPortefeuille(json.portefeuille || []);
        setAutresAgents(json.autres_agents || []);
        setPerformance(json.performance);
        setRemisesRecentes(json.remises_recentes || []);
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

  // Déclencher une action administrative
  const handleAction = async (action: string, extraData: any = {}) => {
    try {
      const res = await fetch(`/api/admin/agents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extraData }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification({ type: "ok", msg: json.message });
        fetchDetail();
      } else {
        setNotification({ type: "err", msg: json.error });
      }
    } catch {
      setNotification({ type: "err", msg: "Erreur lors de l'exécution de l'action" });
    } finally {
      setTimeout(() => setNotification(null), 6000);
    }
  };

  // Réaffectation des membres sélectionnés
  const handleReaffectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAgentId || selectedMembres.length === 0) return;

    setIsReaffecting(true);
    try {
      const res = await fetch("/api/admin/membres/reaffecter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membre_ids: selectedMembres,
          target_agent_id: targetAgentId,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification({ type: "ok", msg: json.message });
        setShowReaffectModal(false);
        setSelectedMembres([]);
        fetchDetail();
      } else {
        setNotification({ type: "err", msg: json.error });
      }
    } catch {
      setNotification({ type: "err", msg: "Erreur lors de la réaffectation" });
    } finally {
      setIsReaffecting(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Réinitialisation du code PIN
  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsResettingPin(true);
    await handleAction("reinitialiser_pin", { nouveau_pin: nouveauPin });
    setIsResettingPin(false);
    setShowResetPinModal(false);
    setNouveauPin("");
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedMembres(portefeuille.map((m) => m.id));
    } else {
      setSelectedMembres([]);
    }
  };

  const handleToggleSelect = (mId: string) => {
    setSelectedMembres((prev) =>
      prev.includes(mId) ? prev.filter((item) => item !== mId) : [...prev, mId]
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Navigation haute */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/agents"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 active:scale-95"
            aria-label="Retour à la liste"
          >
            ‹
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-950 sm:text-2xl">
              Fiche Agent · {agent ? agent.nom : "Chargement…"}
            </h1>
            <p className="text-xs text-gray-500 font-mono">
              Identifiant : <span className="font-bold text-primary-700">{agent?.identifiant}</span>
            </p>
          </div>
        </div>

        {agent && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              agent.statut === "actif"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : agent.statut === "nouveau"
                ? "bg-primary-50 text-primary-700 border border-primary-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {agent.statut === "actif"
              ? "Agent Actif"
              : agent.statut === "nouveau"
              ? "Nouveau (En attente)"
              : "Compte Suspendu"}
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

      {loading && !agent ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-xs text-gray-400">
          Chargement de la fiche agent…
        </div>
      ) : agent ? (
        <>
          {/* Bloc 1 : Identité & Appareil & Actions Administratives */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 text-xl font-bold text-primary-800">
                  {agent.nom.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{agent.nom}</h2>
                  <p className="text-xs text-gray-500 font-mono">
                    ID : {agent.identifiant} · Tél : {agent.telephone || "Sans téléphone"}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    Créé le {formatDate(agent.cree_le)}
                  </p>
                </div>
              </div>

              {/* Détails Appareil et Synchro */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-xs">
                <div>
                  <span className="text-xs text-gray-400">Appareil lié (Device ID)</span>
                  <p className="font-mono text-gray-800 truncate" title={agent.device_id || "Aucun appareil lié"}>
                    {agent.device_id === "revoque" ? (
                      <span className="font-sans font-semibold text-amber-700">
                        Révoqué — reconnexion en ligne exigée
                      </span>
                    ) : agent.device_id ? (
                      `Appareil ${agent.device_id.slice(0, 8)}…`
                    ) : (
                      "Aucun appareil enregistré"
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Dernière synchronisation</span>
                  <p className="font-medium text-gray-800">
                    {agent.derniere_synchro_le ? formatDateTime(agent.derniere_synchro_le) : "Jamais synchronisé"}
                  </p>
                </div>
              </div>
            </div>

            {/* Carte Actions Sécurité */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Actions de sécurité
              </h3>

              {/* Suspendre / Réactiver */}
              <button
                onClick={() => handleAction(agent.statut === "suspendu" ? "reactiver" : "suspendre")}
                className={`w-full py-2 px-3 rounded-xl text-xs font-bold border transition ${
                  agent.statut === "suspendu"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    : "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
                }`}
              >
                {agent.statut === "suspendu" ? "✓ Réactiver l'agent" : "🚫 Suspendre l'agent"}
              </button>

              {/* Révoquer Appareil */}
              <button
                onClick={() => {
                  if (confirm("Révoquer l'appareil de cet agent ? Il devra se reconnecter et retélécharger son portefeuille.")) {
                    handleAction("revoquer_appareil");
                  }
                }}
                className="w-full py-2 px-3 rounded-xl text-xs font-bold border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 transition"
              >
                📱 Révoquer l'appareil
              </button>

              {/* Réinitialiser PIN */}
              <button
                onClick={() => setShowResetPinModal(true)}
                className="w-full py-2 px-3 rounded-xl text-xs font-bold border border-primary-300 bg-primary-50 text-primary-900 hover:bg-primary-100 transition"
              >
                🔑 Réinitialiser le code PIN
              </button>
            </div>
          </div>

          {/* Bloc 2 : Performance du Mois */}
          {performance && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Performance du Mois en cours
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Collecte */}
                <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                    Collecte totale (Mois)
                  </span>
                  <p className="mt-2 text-2xl font-bold text-gray-900 font-mono">
                    {formatMontant(performance.collecte_mois)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Dépôts encaissés ce mois
                  </p>
                </div>

                {/* 2. Régularité */}
                <div className="rounded-2xl border border-primary-100 bg-white p-4 shadow-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary-800">
                    Taux de régularité
                  </span>
                  <p className="mt-2 text-2xl font-bold text-gray-900 font-mono">
                    {performance.regularite_pourcent}%
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {performance.membres_servis_mois} sur {performance.total_membres} membres servis
                  </p>
                </div>

                {/* 3. Remises en caisse */}
                <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-violet-800">
                    Total remis en caisse
                  </span>
                  <p className="mt-2 text-2xl font-bold text-gray-900 font-mono">
                    {formatMontant(performance.total_remises_mois)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Versements physiques enregistrés
                  </p>
                </div>

                {/* 4. Écarts de remise */}
                <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                    Contrôle des écarts
                  </span>
                  <p className={`mt-2 text-2xl font-bold font-mono ${performance.total_ecarts_mois < 0 ? "text-red-600" : "text-gray-950"}`}>
                    {performance.total_ecarts_mois === 0
                      ? "0 F (Conforme)"
                      : formatMontant(performance.total_ecarts_mois)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {performance.remises_litigieuses_count} remise(s) avec écart
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Bloc 3 : Portefeuille des membres affectés */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                  Portefeuille de l'agent ({portefeuille.length} membres)
                </h3>
                <p className="text-xs text-gray-500">
                  Sélectionnez des membres pour les réaffecter à un autre agent
                </p>
              </div>

              {selectedMembres.length > 0 && (
                <button
                  onClick={() => setShowReaffectModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-amber-700"
                >
                  <span>🔄</span>
                  <span>Réaffecter ({selectedMembres.length})</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-gray-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2.5 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={
                          portefeuille.length > 0 &&
                          selectedMembres.length === portefeuille.length
                        }
                        onChange={handleSelectAll}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </th>
                    <th className="px-3 py-2.5">Numéro</th>
                    <th className="px-3 py-2.5">Nom du membre</th>
                    <th className="px-3 py-2.5">Téléphone</th>
                    <th className="px-3 py-2.5">Quartier</th>
                    <th className="px-3 py-2.5 text-center">Statut</th>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium">
                  {portefeuille.length > 0 ? (
                    portefeuille.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition">
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={selectedMembres.includes(m.id)}
                            onChange={() => handleToggleSelect(m.id)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono font-bold">{m.numero}</td>
                        <td className="px-3 py-2.5 font-bold text-gray-900">
                          {m.prenom} {m.nom}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-gray-600">{m.telephone || "—"}</td>
                        <td className="px-3 py-2.5 text-gray-600">{m.quartier || "—"}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                              m.statut === "actif"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {m.statut}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link
                            href={`/admin/membres/${m.id}`}
                            className="text-xs font-bold text-primary-700 hover:underline"
                          >
                            Détail ›
                          </Link>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-gray-400">
                        Aucun membre rattaché à cet agent.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {/* Modal Réaffectation des membres */}
      {showReaffectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900">
              Transférer des membres du portefeuille
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Choisir un autre agent vers lequel transférer les <strong>{selectedMembres.length} membres</strong> sélectionnés.
            </p>

            <form onSubmit={handleReaffectSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Agent destinataire
                </label>
                <select
                  value={targetAgentId}
                  onChange={(e) => setTargetAgentId(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs font-medium focus:border-primary-500"
                >
                  <option value="">Sélectionner un agent…</option>
                  {autresAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.nom} ({ag.identifiant})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReaffectModal(false)}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isReaffecting || !targetAgentId}
                  className="flex-1 rounded-xl bg-amber-600 py-2.5 text-xs font-bold text-white shadow hover:bg-amber-700 disabled:opacity-50"
                >
                  {isReaffecting ? "Transfert…" : "Confirmer le transfert"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Réinitialisation Code PIN */}
      {showResetPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900">
              Réinitialiser le code PIN
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Définir un nouveau PIN provisoire pour <strong>{agent?.nom} ({agent?.identifiant})</strong>.
              L'appareil actuel sera révoqué pour forcer la nouvelle authentification.
            </p>

            <form onSubmit={handleResetPinSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Nouveau code PIN provisoire (6 chiffres)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={nouveauPin}
                  onChange={(e) => setNouveauPin(e.target.value)}
                  required
                  placeholder="••••••"
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-center text-lg font-mono tracking-widest focus:border-primary-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowResetPinModal(false)}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isResettingPin || !/^\d{6}$/.test(nouveauPin)}
                  className="flex-1 rounded-xl bg-primary-600 py-2.5 text-xs font-bold text-white shadow hover:bg-primary-700 disabled:opacity-50"
                >
                  {isResettingPin ? "Mise à jour…" : "Valider le nouveau PIN"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
