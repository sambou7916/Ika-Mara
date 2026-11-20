"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMontant, badgeVolet, libelleVolet } from "@/lib/utils/format";
import MontantInput, { EntierInput } from "@/components/ui/MontantInput";

interface AgentSummary {
  id: string;
  nom: string;
  identifiant: string;
}

interface SouscriptionSummary {
  id: string;
  volet: "mara" | "pari" | "djourou";
  montant_jour: number;
  parts_commission: number;
  statut: "active" | "suspendue" | "cloturee";
}

interface MembreItem {
  id: string;
  numero: string;
  nom: string;
  prenom: string;
  profession: string | null;
  telephone: string | null;
  quartier: string | null;
  statut: "actif" | "inactif";
  agent_id: string;
  photo_url: string | null;
  cree_le: string;
  profiles?: {
    id: string;
    nom: string;
    identifiant: string;
  };
  souscriptions?: SouscriptionSummary[];
}

export default function AdminMembresPage() {
  const router = useRouter();

  // Données de la liste
  const [membres, setMembres] = useState<MembreItem[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [prochainNumero, setProchainNumero] = useState<string>("0001");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  // Pagination et filtres
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [voletFilter, setVoletFilter] = useState("");
  const [statutFilter, setStatutFilter] = useState("");

  // Sélection multiple pour réaffectation en masse
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showReaffectModal, setShowReaffectModal] = useState(false);
  const [targetAgentId, setTargetAgentId] = useState("");
  const [isReaffecting, setIsReaffecting] = useState(false);

  // Modal Création / Édition
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingMembre, setEditingMembre] = useState<MembreItem | null>(null);
  const [formNumero, setFormNumero] = useState("");
  const [formNom, setFormNom] = useState("");
  const [formPrenom, setFormPrenom] = useState("");
  const [formProfession, setFormProfession] = useState("");
  const [formTelephone, setFormTelephone] = useState("");
  const [formQuartier, setFormQuartier] = useState("");
  const [formAgentId, setFormAgentId] = useState("");
  const [formPhotoUrl, setFormPhotoUrl] = useState("");
  const [formStatut, setFormStatut] = useState<"actif" | "inactif">("actif");

  // Souscriptions dans le formulaire
  const [subMara, setSubMara] = useState({ actif: true, montant: 1000, parts: 1 });
  const [subPari, setSubPari] = useState({ actif: false, montant: 500, parts: 1 });
  const [subDjourou, setSubDjourou] = useState({ actif: false, montant: 2000, parts: 1 });
  const [isSaving, setIsSaving] = useState(false);

  const fetchMembres = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "15",
        search: search.trim(),
        agent_id: agentFilter,
        volet: voletFilter,
        statut: statutFilter,
      });

      const res = await fetch(`/api/admin/membres?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur lors de la récupération des membres");

      const json = await res.json();
      if (json.success) {
        setMembres(json.membres || []);
        setTotalPages(json.total_pages || 1);
        setTotalCount(json.total || 0);
        setAgents(json.agents || []);
        setProchainNumero(json.prochain_numero || "0001");
      } else {
        throw new Error(json.error || "Erreur inconnue");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembres();
  }, [page, agentFilter, voletFilter, statutFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchMembres();
  };

  // Sélection globale
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(membres.map((m) => m.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Réaffectation en masse
  const handleReaffectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAgentId || selectedIds.length === 0) return;

    setIsReaffecting(true);
    try {
      const res = await fetch("/api/admin/membres/reaffecter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membre_ids: selectedIds,
          target_agent_id: targetAgentId,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setNotification({ type: "ok", msg: json.message });
        setShowReaffectModal(false);
        setSelectedIds([]);
        fetchMembres();
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

  // Ouverture du formulaire de création
  const handleOpenCreate = () => {
    setEditingMembre(null);
    setFormNumero(prochainNumero);
    setFormNom("");
    setFormPrenom("");
    setFormProfession("");
    setFormTelephone("");
    setFormQuartier("");
    setFormAgentId(agents.length > 0 ? agents[0].id : "");
    setFormPhotoUrl("");
    setFormStatut("actif");
    setSubMara({ actif: true, montant: 1000, parts: 1 });
    setSubPari({ actif: false, montant: 500, parts: 1 });
    setSubDjourou({ actif: false, montant: 2000, parts: 1 });
    setShowEditModal(true);
  };

  // Ouverture du formulaire d'édition
  const handleOpenEdit = (m: MembreItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingMembre(m);
    setFormNumero(m.numero);
    setFormNom(m.nom);
    setFormPrenom(m.prenom);
    setFormProfession(m.profession || "");
    setFormTelephone(m.telephone || "");
    setFormQuartier(m.quartier || "");
    setFormAgentId(m.agent_id);
    setFormPhotoUrl(m.photo_url || "");
    setFormStatut(m.statut);

    // Initialiser souscriptions existantes
    const maraSub = m.souscriptions?.find((s) => s.volet === "mara");
    setSubMara({
      actif: maraSub?.statut === "active",
      montant: maraSub?.montant_jour || 1000,
      parts: maraSub?.parts_commission || 1,
    });

    const pariSub = m.souscriptions?.find((s) => s.volet === "pari");
    setSubPari({
      actif: pariSub?.statut === "active",
      montant: pariSub?.montant_jour || 500,
      parts: pariSub?.parts_commission || 1,
    });

    const djourouSub = m.souscriptions?.find((s) => s.volet === "djourou");
    setSubDjourou({
      actif: djourouSub?.statut === "active",
      montant: djourouSub?.montant_jour || 2000,
      parts: djourouSub?.parts_commission || 1,
    });

    setShowEditModal(true);
  };

  // Enregistrement Membre + Souscriptions
  const handleSaveMembre = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload = {
        id: editingMembre ? editingMembre.id : undefined,
        numero: formNumero,
        nom: formNom,
        prenom: formPrenom,
        profession: formProfession,
        telephone: formTelephone,
        quartier: formQuartier,
        agent_id: formAgentId,
        photo_url: formPhotoUrl,
        statut: formStatut,
        souscriptions: [
          { volet: "mara", ...subMara, montant_jour: subMara.montant, parts_commission: subMara.parts },
          { volet: "pari", ...subPari, montant_jour: subPari.montant, parts_commission: subPari.parts },
          { volet: "djourou", ...subDjourou, montant_jour: subDjourou.montant, parts_commission: subDjourou.parts },
        ],
      };

      const res = await fetch("/api/admin/membres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success) {
        setNotification({ type: "ok", msg: json.message });
        setShowEditModal(false);
        fetchMembres();
      } else {
        setNotification({ type: "err", msg: json.error });
      }
    } catch {
      setNotification({ type: "err", msg: "Erreur lors de l'enregistrement" });
    } finally {
      setIsSaving(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Désactiver / Supprimer
  const handleDeleteOrDeactivate = async (id: string, nom: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Souhaitez-vous retirer ou désactiver le membre « ${nom} » ?`)) return;

    try {
      const res = await fetch(`/api/admin/membres/${id}`, { method: "DELETE" });
      const json = await res.json();

      if (json.success) {
        setNotification({
          type: json.deactivated ? "err" : "ok",
          msg: json.message,
        });
        fetchMembres();
      } else {
        setNotification({ type: "err", msg: json.error });
      }
    } catch {
      setNotification({ type: "err", msg: "Erreur lors de l'opération" });
    } finally {
      setTimeout(() => setNotification(null), 6000);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">
            Gestion des Membres
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Répertoire central des {totalCount} membres cotisants IKA-MARA
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button
              onClick={() => setShowReaffectModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white shadow hover:bg-amber-700 active:scale-98 transition"
            >
              <span>🔄</span>
              <span>Réaffecter ({selectedIds.length})</span>
            </button>
          )}

          <button
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-700 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-primary-800 active:scale-98 transition"
          >
            <span>➕</span>
            <span>Nouveau membre</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          className={`rounded-2xl border p-4 text-xs font-semibold ${
            notification.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {notification.msg}
        </div>
      )}

      {/* Barre de recherche et filtres */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par numéro (0042), nom, prénom, téléphone, quartier…"
            className="flex-1 rounded-xl border border-gray-300 px-3.5 py-2 text-xs focus:border-primary-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white hover:bg-gray-800"
          >
            Rechercher
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100 text-xs">
          <span className="font-semibold text-gray-500">Filtrer par :</span>

          {/* Filtre Agent */}
          <select
            value={agentFilter}
            onChange={(e) => {
              setAgentFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-primary-500"
          >
            <option value="">Tous les agents</option>
            {agents.map((ag) => (
              <option key={ag.id} value={ag.id}>
                {ag.nom} ({ag.identifiant})
              </option>
            ))}
          </select>

          {/* Filtre Volet */}
          <select
            value={voletFilter}
            onChange={(e) => {
              setVoletFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-primary-500"
          >
            <option value="">Tous les volets</option>
            <option value="mara">Ika-Mara (Épargne)</option>
            <option value="pari">Ika-Pari (Tontine)</option>
            <option value="djourou">Ika-Djourou (Crédit)</option>
          </select>

          {/* Filtre Statut */}
          <select
            value={statutFilter}
            onChange={(e) => {
              setStatutFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 focus:border-primary-500"
          >
            <option value="">Tous les statuts</option>
            <option value="actif">Actif</option>
            <option value="inactif">Inactif</option>
          </select>

          {(search || agentFilter || voletFilter || statutFilter) && (
            <button
              onClick={() => {
                setSearch("");
                setAgentFilter("");
                setVoletFilter("");
                setStatutFilter("");
                setPage(1);
              }}
              className="text-xs text-primary-700 font-semibold hover:underline ml-auto"
            >
              Réinitialiser filtres
            </button>
          )}
        </div>
      </div>

      {/* Tableau des membres */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      membres.length > 0 &&
                      selectedIds.length === membres.length
                    }
                    onChange={handleSelectAll}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </th>
                <th className="px-4 py-3.5">Numéro</th>
                <th className="px-4 py-3.5">Membre</th>
                <th className="px-4 py-3.5">Quartier & Tél</th>
                <th className="px-4 py-3.5">Agent référent</th>
                <th className="px-4 py-3.5">Volets souscrits</th>
                <th className="px-4 py-3.5 text-center">Statut</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-400">
                    Chargement des membres…
                  </td>
                </tr>
              ) : membres.length > 0 ? (
                membres.map((m) => {
                  const activeSubs = (m.souscriptions || []).filter(
                    (s) => s.statut === "active"
                  );
                  const isChecked = selectedIds.includes(m.id);

                  return (
                    <tr
                      key={m.id}
                      onClick={() => router.push(`/admin/membres/${m.id}`)}
                      className={`cursor-pointer transition hover:bg-primary-50/40 ${
                        isChecked ? "bg-amber-50/40" : ""
                      }`}
                    >
                      {/* Checkbox sélection */}
                      <td
                        className="px-4 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(m.id)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                      </td>

                      {/* Numéro */}
                      <td className="px-4 py-3 font-mono font-bold text-gray-950">
                        {m.numero}
                      </td>

                      {/* Membre */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold text-gray-700">
                            {m.prenom.charAt(0)}
                            {m.nom.charAt(0)}
                          </span>
                          <div>
                            <p className="font-bold text-gray-900">
                              {m.prenom} {m.nom}
                            </p>
                            <p className="text-xs text-gray-400">
                              {m.profession || "Profession non renseignée"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Quartier & Tél */}
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{m.quartier || "—"}</p>
                        <p className="text-xs font-mono text-gray-500">
                          {m.telephone || "Sans téléphone"}
                        </p>
                      </td>

                      {/* Agent */}
                      <td className="px-4 py-3">
                        <span className="font-bold text-gray-800">
                          {m.profiles?.nom || "Non assigné"}
                        </span>
                        {m.profiles?.identifiant && (
                          <span className="block text-xs font-mono text-gray-400">
                            {m.profiles.identifiant}
                          </span>
                        )}
                      </td>

                      {/* Volets */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {activeSubs.length > 0 ? (
                            activeSubs.map((s) => (
                              <span
                                key={s.id}
                                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                  s.volet === "mara"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : s.volet === "pari"
                                    ? "bg-primary-100 text-primary-800"
                                    : "bg-purple-100 text-purple-800"
                                }`}
                                title={`${libelleVolet(s.volet)}: ${formatMontant(s.montant_jour)}/j (${s.parts_commission} part)`}
                              >
                                {s.volet.toUpperCase()} {formatMontant(s.montant_jour)}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-gray-400 italic">
                              Aucun volet actif
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Statut */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
                            m.statut === "actif"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {m.statut === "actif" ? "Actif" : "Inactif"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={(e) => handleOpenEdit(m, e)}
                            className="rounded-lg border border-gray-200 p-1.5 text-xs text-gray-700 hover:bg-gray-100"
                            title="Modifier"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={(e) =>
                              handleDeleteOrDeactivate(
                                m.id,
                                `${m.prenom} ${m.nom}`,
                                e
                              )
                            }
                            className="rounded-lg border border-red-200 p-1.5 text-xs text-red-600 hover:bg-red-50"
                            title="Désactiver / Supprimer"
                          >
                            🚫
                          </button>
                          <Link
                            href={`/admin/membres/${m.id}`}
                            className="rounded-lg border border-primary-200 px-2 py-1 text-xs font-bold text-primary-700 hover:bg-primary-50"
                          >
                            Fiche ›
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-400">
                    Aucun membre correspondant à votre recherche.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
          <p>
            Affichage de {membres.length} sur {totalCount} membres
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
            >
              Précédent
            </button>
            <span className="px-2 font-bold text-gray-800">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
            >
              Suivant
            </button>
          </div>
        </div>
      </div>

      {/* Modal Réaffectation en masse */}
      {showReaffectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-gray-900">
              Réaffectation en masse
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Transférer la gestion de <strong>{selectedIds.length} membres</strong> vers un nouvel agent référent.
              Cette action sera enregistrée dans le journal d'audit.
            </p>

            <form onSubmit={handleReaffectSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Choisir l'agent cible
                </label>
                <select
                  value={targetAgentId}
                  onChange={(e) => setTargetAgentId(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-gray-300 p-2.5 text-xs font-medium focus:border-primary-500"
                >
                  <option value="">Sélectionner un agent…</option>
                  {agents.map((ag) => (
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
                  {isReaffecting ? "Transfert en cours…" : "Confirmer le transfert"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Création / Édition de Membre */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-2xl my-8 rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-900">
              {editingMembre ? `Modifier le membre ${formNumero}` : "Nouveau Membre"}
            </h3>
            <p className="text-xs text-gray-500">
              Informations d'adhésion et configuration des volets de collecte
            </p>

            <form onSubmit={handleSaveMembre} className="mt-5 space-y-5">
              {/* Section Identité */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  1. Identité & Coordonnées
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      Numéro d'adhérent (4 chiffres)
                    </label>
                    <input
                      type="text"
                      maxLength={4}
                      value={formNumero}
                      onChange={(e) => setFormNumero(e.target.value)}
                      required
                      placeholder="0042"
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs font-mono font-bold focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      Prénom
                    </label>
                    <input
                      type="text"
                      value={formPrenom}
                      onChange={(e) => setFormPrenom(e.target.value)}
                      required
                      placeholder="Fatoumata"
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      Nom de famille
                    </label>
                    <input
                      type="text"
                      value={formNom}
                      onChange={(e) => setFormNom(e.target.value)}
                      required
                      placeholder="Coulibaly"
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      Profession
                    </label>
                    <input
                      type="text"
                      value={formProfession}
                      onChange={(e) => setFormProfession(e.target.value)}
                      placeholder="Commerçante"
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      Téléphone
                    </label>
                    <input
                      type="tel"
                      value={formTelephone}
                      onChange={(e) => setFormTelephone(e.target.value)}
                      placeholder="+223 70 00 00 00"
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      Quartier / Marché
                    </label>
                    <input
                      type="text"
                      value={formQuartier}
                      onChange={(e) => setFormQuartier(e.target.value)}
                      placeholder="Médina Coura"
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      Agent référent de collecte (Obligatoire)
                    </label>
                    <select
                      value={formAgentId}
                      onChange={(e) => setFormAgentId(e.target.value)}
                      required
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500"
                    >
                      <option value="">Sélectionner un agent…</option>
                      {agents.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.nom} ({ag.identifiant})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700">
                      Statut du membre
                    </label>
                    <select
                      value={formStatut}
                      onChange={(e) => setFormStatut(e.target.value as "actif" | "inactif")}
                      className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500"
                    >
                      <option value="actif">Actif (autorisé à cotiser)</option>
                      <option value="inactif">Inactif (bloqué)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700">
                    Lien Photo (facultative)
                  </label>
                  <input
                    type="url"
                    value={formPhotoUrl}
                    onChange={(e) => setFormPhotoUrl(e.target.value)}
                    placeholder="https://..."
                    className="mt-1 w-full rounded-xl border border-gray-300 p-2 text-xs focus:border-primary-500"
                  />
                </div>
              </div>

              {/* Section Souscriptions */}
              <div className="space-y-3 border-t border-gray-100 pt-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  2. Configuration des Volets & Souscriptions
                </h4>
                <p className="text-xs text-gray-500">
                  Chaque modification de cotisation ou de commission sera automatiquement archivée dans l'historique des souscriptions.
                </p>

                {/* Volet 1 : Ika-Mara */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-bold text-emerald-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={subMara.actif}
                        onChange={(e) => setSubMara({ ...subMara, actif: e.target.checked })}
                        className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>💰 Volet Ika-Mara (Épargne journalière)</span>
                    </label>
                    <span className="text-xs font-semibold text-emerald-800">
                      {subMara.actif ? "Activé" : "Désactivé"}
                    </span>
                  </div>

                  {subMara.actif && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="block text-xs font-bold text-gray-600">
                          Montant journalier (F CFA)
                        </label>
                        <MontantInput
                          value={subMara.montant}
                          onChange={(v) => setSubMara({ ...subMara, montant: v })}
                          className="mt-0.5 w-full rounded-lg border border-gray-300 p-1.5 text-xs font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600">
                          Parts commission mensuelle
                        </label>
                        <EntierInput
                          value={subMara.parts}
                          onChange={(v) => setSubMara({ ...subMara, parts: v })}
                          className="mt-0.5 w-full rounded-lg border border-gray-300 p-1.5 text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Volet 2 : Ika-Pari */}
                <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-bold text-primary-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={subPari.actif}
                        onChange={(e) => setSubPari({ ...subPari, actif: e.target.checked })}
                        className="rounded border-primary-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span>🔄 Volet Ika-Pari (Tontine)</span>
                    </label>
                    <span className="text-xs font-semibold text-primary-800">
                      {subPari.actif ? "Activé" : "Désactivé"}
                    </span>
                  </div>

                  {subPari.actif && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="block text-xs font-bold text-gray-600">
                          Montant part journalière (F CFA)
                        </label>
                        <MontantInput
                          value={subPari.montant}
                          onChange={(v) => setSubPari({ ...subPari, montant: v })}
                          className="mt-0.5 w-full rounded-lg border border-gray-300 p-1.5 text-xs font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600">
                          Parts commission
                        </label>
                        <EntierInput
                          value={subPari.parts}
                          onChange={(v) => setSubPari({ ...subPari, parts: v })}
                          className="mt-0.5 w-full rounded-lg border border-gray-300 p-1.5 text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Volet 3 : Ika-Djourou */}
                <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-bold text-purple-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={subDjourou.actif}
                        onChange={(e) => setSubDjourou({ ...subDjourou, actif: e.target.checked })}
                        className="rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                      />
                      <span>📋 Volet Ika-Djourou (Crédit)</span>
                    </label>
                    <span className="text-xs font-semibold text-purple-800">
                      {subDjourou.actif ? "Activé" : "Désactivé"}
                    </span>
                  </div>

                  {subDjourou.actif && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="block text-xs font-bold text-gray-600">
                          Remboursement quotidien cible (F CFA)
                        </label>
                        <MontantInput
                          value={subDjourou.montant}
                          onChange={(v) => setSubDjourou({ ...subDjourou, montant: v })}
                          className="mt-0.5 w-full rounded-lg border border-gray-300 p-1.5 text-xs font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600">
                          Parts commission
                        </label>
                        <EntierInput
                          value={subDjourou.parts}
                          onChange={(v) => setSubDjourou({ ...subDjourou, parts: v })}
                          className="mt-0.5 w-full rounded-lg border border-gray-300 p-1.5 text-xs font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Boutons formulaire */}
              <div className="flex gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 rounded-xl bg-primary-700 py-2.5 text-xs font-bold text-white shadow hover:bg-primary-800 disabled:opacity-50"
                >
                  {isSaving ? "Enregistrement…" : "Enregistrer le membre"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
