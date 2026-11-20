"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMontant, formatDateTime } from "@/lib/utils/format";

interface AgentItem {
  id: string;
  nom: string;
  telephone: string | null;
  identifiant: string;
  statut: "nouveau" | "actif" | "suspendu";
  device_id: string | null;
  derniere_synchro_le: string | null;
  nombre_membres: number;
  collecte_mois: number;
}

export default function AdminAgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [prochainIdentifiant, setProchainIdentifiant] = useState<string>("AGT-001");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  // Formulaire de création d'agent
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formNom, setFormNom] = useState("");
  const [formTelephone, setFormTelephone] = useState("");
  const [formIdentifiant, setFormIdentifiant] = useState("");
  const [formPinProvisoire, setFormPinProvisoire] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const fetchAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/agents");
      if (!res.ok) throw new Error("Erreur lors de la récupération des agents");

      const json = await res.json();
      if (json.success) {
        setAgents(json.agents || []);
        setProchainIdentifiant(json.prochain_identifiant || "AGT-001");
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
    fetchAgents();
  }, []);

  const handleOpenCreate = () => {
    setFormNom("");
    setFormTelephone("");
    setFormIdentifiant(prochainIdentifiant);
    setFormPinProvisoire("123456"); // PIN provisoire suggéré par défaut
    setShowCreateModal(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom: formNom,
          telephone: formTelephone,
          identifiant: formIdentifiant,
          pin_provisoire: formPinProvisoire,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification({ type: "ok", msg: json.message });
        setShowCreateModal(false);
        fetchAgents();
      } else {
        setNotification({ type: "err", msg: json.error });
      }
    } catch {
      setNotification({ type: "err", msg: "Erreur lors de la création de l'agent" });
    } finally {
      setIsCreating(false);
      setTimeout(() => setNotification(null), 6000);
    }
  };

  // Bascule rapide suspendre / réactiver
  const handleToggleStatus = async (agent: AgentItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const action = agent.statut === "suspendu" ? "reactiver" : "suspendre";
    const confirmMsg =
      action === "suspendre"
        ? `Êtes-vous sûr de vouloir suspendre ${agent.nom} (${agent.identifiant}) ? Ses données locales seront purgées dès sa prochaine synchronisation.`
        : `Réactiver les accès de l'agent ${agent.nom} (${agent.identifiant}) ?`;

    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/admin/agents/${agent.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification({ type: "ok", msg: json.message });
        fetchAgents();
      } else {
        setNotification({ type: "err", msg: json.error });
      }
    } catch {
      setNotification({ type: "err", msg: "Erreur lors de la modification du statut" });
    } finally {
      setTimeout(() => setNotification(null), 5000);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">
            Gestion des Agents de Collecte
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            {agents.length} agents déployés sur le terrain au Mali
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-700 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-primary-800 active:scale-98 transition"
        >
          <span>➕</span>
          <span>Créer un agent</span>
        </button>
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

      {/* Tableau des agents */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3.5">Agent</th>
                <th className="px-4 py-3.5">Téléphone</th>
                <th className="px-4 py-3.5 text-center">Portefeuille</th>
                <th className="px-4 py-3.5 text-right">Collecté (Mois)</th>
                <th className="px-4 py-3.5 text-center">Statut</th>
                <th className="px-4 py-3.5">Dernière synchro</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">
                    Chargement des agents…
                  </td>
                </tr>
              ) : agents.length > 0 ? (
                agents.map((ag) => (
                  <tr
                    key={ag.id}
                    onClick={() => router.push(`/admin/agents/${ag.id}`)}
                    className="cursor-pointer transition hover:bg-primary-50/40"
                  >
                    {/* Nom + ID */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-100 text-xs font-bold text-primary-800">
                          {ag.nom.substring(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <p className="font-bold text-gray-900">{ag.nom}</p>
                          <p className="text-xs font-mono text-primary-700">
                            {ag.identifiant}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Téléphone */}
                    <td className="px-4 py-3.5 font-mono text-gray-700">
                      {ag.telephone || "—"}
                    </td>

                    {/* Nombre de membres */}
                    <td className="px-4 py-3.5 text-center font-bold text-gray-900 font-mono">
                      {ag.nombre_membres} membre(s)
                    </td>

                    {/* Collecté du mois */}
                    <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-700">
                      {formatMontant(ag.collecte_mois)}
                    </td>

                    {/* Statut */}
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          ag.statut === "actif"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : ag.statut === "nouveau"
                            ? "bg-primary-50 text-primary-700 border border-primary-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {ag.statut === "actif"
                          ? "Actif"
                          : ag.statut === "nouveau"
                          ? "Nouveau (Attente)"
                          : "Suspendu"}
                      </span>
                    </td>

                    {/* Dernière synchro */}
                    <td className="px-4 py-3.5 text-gray-500 text-xs">
                      {ag.derniere_synchro_le
                        ? formatDateTime(ag.derniere_synchro_le)
                        : "Aucune synchro"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right">
                      <div
                        className="flex items-center justify-end gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={(e) => handleToggleStatus(ag, e)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-bold border transition ${
                            ag.statut === "suspendu"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                          }`}
                        >
                          {ag.statut === "suspendu" ? "Réactiver" : "Suspendre"}
                        </button>

                        <Link
                          href={`/admin/agents/${ag.id}`}
                          className="rounded-lg border border-primary-200 bg-white px-2.5 py-1 text-xs font-bold text-primary-700 hover:bg-primary-50"
                        >
                          Fiche ›
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">
                    Aucun agent enregistré pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Création Agent */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900">
              Créer un nouvel agent de collecte
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Le compte Supabase et son profil d'authentification seront créés de manière sécurisée côté serveur.
            </p>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Nom et prénom de l'agent
                </label>
                <input
                  type="text"
                  value={formNom}
                  onChange={(e) => setFormNom(e.target.value)}
                  required
                  placeholder="Ex. : Ousmane Traoré"
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-primary-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Numéro de téléphone
                </label>
                <input
                  type="tel"
                  value={formTelephone}
                  onChange={(e) => setFormTelephone(e.target.value)}
                  placeholder="+223 70 00 00 00"
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs focus:border-primary-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Identifiant technique (Format AGT-00X)
                </label>
                <input
                  type="text"
                  value={formIdentifiant}
                  onChange={(e) => setFormIdentifiant(e.target.value)}
                  required
                  placeholder="AGT-001"
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs font-mono font-bold uppercase focus:border-primary-500 focus:outline-none"
                />
                <span className="text-xs text-gray-400">
                  Email technique associé : {formIdentifiant.toLowerCase().replace(/[^a-z0-9]/g, "")}@ika-mara.local
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Code PIN provisoire (6 chiffres)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={formPinProvisoire}
                  onChange={(e) => setFormPinProvisoire(e.target.value)}
                  required
                  placeholder="123456"
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs font-mono text-center tracking-widest text-base focus:border-primary-500 focus:outline-none"
                />
                <span className="text-xs text-gray-400">
                  L'agent pourra le modifier lors de sa première utilisation.
                </span>
              </div>

              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex-1 rounded-xl bg-primary-700 py-2.5 text-xs font-bold text-white shadow hover:bg-primary-800 disabled:opacity-50"
                >
                  {isCreating ? "Création en cours…" : "Créer l'agent"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
