"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/utils/format";

interface AuditLogItem {
  id: string;
  qui: string | null;
  quoi: string;
  avant: any;
  apres: any;
  details: string | null;
  quand: string;
  ip: string | null;
  profiles?: {
    id: string;
    nom: string;
    identifiant: string;
    role: string;
  };
}

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [utilisateurs, setUtilisateurs] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("action", "audit");
      if (selectedUser) p.set("utilisateur_id", selectedUser);
      if (dateDebut) p.set("date_debut", dateDebut);
      if (dateFin) p.set("date_fin", dateFin);

      const res = await fetch(`/api/admin/parametres?${p.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setLogs(json.logs || []);
        if (json.utilisateurs) setUtilisateurs(json.utilisateurs);
      }
    } catch (err) {
      console.error("Erreur chargement logs :", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedUser, dateDebut, dateFin]);

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-gray-200 px-2.5 py-0.5 text-xs font-bold text-gray-800">
            Sécurité & Conformité
          </span>
          <span className="text-xs text-gray-500">IKA-MARA</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">Journal d'Audit Global</h1>
        <p className="text-xs text-gray-500 sm:text-sm">
          Traçabilité complète des opérations, modifications de paramètres, réaffectations et annulations
        </p>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600">Utilisateur</label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="mt-1 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold"
            >
              <option value="">Tous les utilisateurs</option>
              {utilisateurs.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nom} ({u.identifiant}) · {u.role}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600">Date début</label>
            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              className="mt-1 rounded-xl border border-gray-300 px-3 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600">Date fin</label>
            <input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              className="mt-1 rounded-xl border border-gray-300 px-3 py-1.5 text-xs"
            />
          </div>
        </div>

        <Link
          href="/admin/parametres"
          className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
        >
          ⚙️ Paramètres du système →
        </Link>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-bold text-gray-950">
            Événements récents ({logs.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 font-semibold text-gray-600">
                <th className="py-3 px-4">Horodatage</th>
                <th className="py-3 px-4">Auteur</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">
                    {loading ? "Chargement…" : "Aucun événement consigné"}
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 whitespace-nowrap text-gray-600 font-mono">
                      {formatDateTime(l.quand)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-bold text-gray-900">{l.profiles?.nom || "Système"}</span>
                      {l.profiles?.identifiant && (
                        <span className="block font-mono text-xs text-gray-500">
                          {l.profiles.identifiant} ({l.profiles.role})
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-bold text-gray-800">
                        {l.quoi}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-700">
                      {l.details || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
