"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { formatMontant, formatDate, formatDateTime } from "@/lib/utils/format";
import MontantInput, { EntierInput } from "@/components/ui/MontantInput";

interface ParamItem {
  cle: string;
  valeur: any;
  section: string;
  description: string;
  version: number;
  modifie_le: string;
  profiles?: {
    nom: string;
    identifiant: string;
  };
}

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

interface UtilisateurOption {
  id: string;
  nom: string;
  identifiant: string;
  role: string;
}

export default function AdminParametresPage() {
  const [activeTab, setActiveTab] = useState<"parametres" | "audit">("parametres");
  const [loading, setLoading] = useState(true);
  const [savingCle, setSavingCle] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Paramètres
  const [parametres, setParametres] = useState<ParamItem[]>([]);
  const [formValues, setFormValues] = useState<Record<string, any>>({});

  // Journal d'audit
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [auditDateDebut, setAuditDateDebut] = useState<string>("");
  const [auditDateFin, setAuditDateFin] = useState<string>("");
  const [auditLoading, setAuditLoading] = useState<boolean>(false);

  // Export / Sauvegarde
  const [exportLoading, setExportLoading] = useState<boolean>(false);

  // Chargement des paramètres
  const fetchParametres = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/parametres?action=liste", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setParametres(json.parametres || []);

      // Initialiser l'état du formulaire
      const initial: Record<string, any> = {};
      (json.parametres || []).forEach((p: ParamItem) => {
        initial[p.cle] = p.valeur;
      });
      setFormValues(initial);
    } catch (err: unknown) {
      console.error("Erreur chargement paramètres :", err);
    } finally {
      setLoading(false);
    }
  };

  // Chargement du journal d'audit
  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("action", "audit");
      if (selectedUser) p.set("utilisateur_id", selectedUser);
      if (auditDateDebut) p.set("date_debut", auditDateDebut);
      if (auditDateFin) p.set("date_fin", auditDateFin);

      const res = await fetch(`/api/admin/parametres?${p.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setAuditLogs(json.logs || []);
        if (json.utilisateurs) setUtilisateurs(json.utilisateurs);
      }
    } catch (err) {
      console.error("Erreur chargement audit :", err);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    startTransition(() => {
      fetchParametres();
    });
  }, []);

  useEffect(() => {
    if (activeTab === "audit") {
      fetchAuditLogs();
    }
  }, [activeTab, selectedUser, auditDateDebut, auditDateFin]);

  // Enregistrement d'un paramètre individuel
  const handleSaveParam = async (cle: string) => {
    setSavingCle(cle);
    try {
      const val = formValues[cle];
      const res = await fetch("/api/admin/parametres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "modifier_parametre",
          cle,
          valeur: val,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec d'enregistrement");

      setNotification({ type: "ok", msg: json.message || `Paramètre « ${cle} » mis à jour.` });
      fetchParametres();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingCle(null);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Sauvegarde / Export complet de la base
  const handleExportComplet = async () => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/admin/parametres?action=export_complet", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Échec de l'export");

      const donnees = json.donnees;

      // 1. Export CSV des membres
      const membresCsv =
        "\uFEFF" +
        [
          ["Numéro", "Nom", "Prénom", "Téléphone", "Quartier", "Profession", "Statut"].join(";"),
          ...donnees.membres.map((m: any) =>
            [
              `"${m.numero}"`,
              `"${m.nom}"`,
              `"${m.prenom}"`,
              `"${m.telephone || ""}"`,
              `"${m.quartier || ""}"`,
              `"${m.profession || ""}"`,
              `"${m.statut}"`,
            ].join(";")
          ),
        ].join("\r\n");

      // 2. Export CSV des opérations
      const opsCsv =
        "\uFEFF" +
        [
          ["ID", "Date", "Volet", "Type", "Montant (F CFA)", "Jours", "Statut", "Motif"].join(";"),
          ...donnees.operations.map((o: any) =>
            [
              `"${o.id}"`,
              `"${o.date_operation}"`,
              `"${o.volet}"`,
              `"${o.type}"`,
              o.montant,
              o.jours_couverts,
              `"${o.statut}"`,
              `"${(o.motif || "").replace(/"/g, '""')}"`,
            ].join(";")
          ),
        ].join("\r\n");

      // 3. Télécharger le fichier JSON complet pour sauvegarde de secours
      const backupJson = JSON.stringify(donnees, null, 2);
      const blob = new Blob([backupJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IKA-MARA_Sauvegarde_Complete_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setNotification({
        type: "ok",
        msg: "Sauvegarde complète générée avec succès (JSON & données de référence).",
      });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erreur d'export");
    } finally {
      setExportLoading(false);
      setTimeout(() => setNotification(null), 5000);
    }
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

      {/* En-tête */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-gray-200 px-2.5 py-0.5 text-xs font-bold text-gray-800">
              Configuration
            </span>
            <span className="text-xs text-gray-500">IKA-MARA</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-950 sm:text-3xl">
            Paramètres & Journal d'Audit
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Règles de gestion de la structure, versioning des paramètres et traçabilité des opérations
          </p>
        </div>

        <button
          onClick={handleExportComplet}
          disabled={exportLoading}
          className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-black active:scale-95 disabled:opacity-50"
        >
          <span>💾</span>
          {exportLoading ? "Sauvegarde en cours…" : "Sauvegarde / Export complet"}
        </button>
      </div>

      {/* Navigation des onglets */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab("parametres")}
            className={`border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "parametres"
                ? "border-gray-950 text-gray-950"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Paramètres du système</span>
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`border-b-2 py-3 px-1 text-sm font-bold transition-colors ${
              activeTab === "audit"
                ? "border-gray-950 text-gray-950"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            <span>Journal d'audit</span>
          </button>
        </nav>
      </div>

      {/* ========================================================================= */}
      {/* ONGLET 1 : FORMULAIRE DES PARAMÈTRES PAR SECTIONS                         */}
      {/* ========================================================================= */}
      {activeTab === "parametres" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 text-xs text-primary-900">
            ℹ️ <strong>Règle de gestion :</strong> Toute modification est versionnée et consignée dans le journal d'audit. Elle ne s'applique qu'aux opérations futures (les écritures antérieures demeurent strictement immuables).
          </div>

          {/* 1. SECTION COMMISSION */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="text-base font-bold text-gray-950">1. Règles de Commission</h2>
              <p className="text-xs text-gray-500">
                Paramètres de facturation de la rémunération de la structure
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Parts de commission par défaut (parts/mois)
                </label>
                <div className="mt-1 flex gap-2">
                  <EntierInput conteneurClassName="flex-1"
                    max={10}
                    value={formValues.commission_default_parts ?? 1}
                    onChange={(v) =>
                      setFormValues({ ...formValues, commission_default_parts: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("commission_default_parts")}
                    disabled={savingCle === "commission_default_parts"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Moment du prélèvement de la commission
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={formValues.prelevement_commission_moment ?? "cloture_mois"}
                    onChange={(e) =>
                      setFormValues({ ...formValues, prelevement_commission_moment: e.target.value })
                    }
                    className="w-full rounded-xl border border-gray-300 bg-white p-2 text-xs font-bold"
                  >
                    <option value="cloture_mois">À la clôture mensuelle (recommandé)</option>
                    <option value="premier_depot">Dès le premier dépôt du mois</option>
                  </select>
                  <button
                    onClick={() => handleSaveParam("prelevement_commission_moment")}
                    disabled={savingCle === "prelevement_commission_moment"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Règle en cas de mois incomplet (adhésion en cours de mois)
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={formValues.regle_mois_incomplet_commission ?? "proportionnelle"}
                    onChange={(e) =>
                      setFormValues({ ...formValues, regle_mois_incomplet_commission: e.target.value })
                    }
                    className="w-full rounded-xl border border-gray-300 bg-white p-2 text-xs font-bold"
                  >
                    <option value="proportionnelle">Proportionnelle (Prorata temporis en jours)</option>
                    <option value="entiere">Entière (Mois complet dû)</option>
                  </select>
                  <button
                    onClick={() => handleSaveParam("regle_mois_incomplet_commission")}
                    disabled={savingCle === "regle_mois_incomplet_commission"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Vérifier la disponibilité du solde d'épargne
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={formValues.commission_verifier_solde ? "true" : "false"}
                    onChange={(e) =>
                      setFormValues({ ...formValues, commission_verifier_solde: e.target.value === "true" })
                    }
                    className="w-full rounded-xl border border-gray-300 bg-white p-2 text-xs font-bold"
                  >
                    <option value="true">Oui (Plafonner au solde disponible)</option>
                    <option value="false">Non (Autoriser le solde négatif)</option>
                  </select>
                  <button
                    onClick={() => handleSaveParam("commission_verifier_solde")}
                    disabled={savingCle === "commission_verifier_solde"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. SECTION CRÉDIT (IKA-DJOUROU) */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="text-base font-bold text-gray-950">2. Paramètres de Crédit (Ika-Djourou)</h2>
              <p className="text-xs text-gray-500">
                Taux d'intérêt, frais de dossier, pénalités et règles d'octroi
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-gray-700">Taux d'intérêt annuel par défaut (%)</label>
                <div className="mt-1 flex gap-2">
                  <EntierInput suffixe="%" conteneurClassName="flex-1"
                    max={50}
                    value={formValues.taux_interet_defaut_djourou ?? 5}
                    onChange={(v) =>
                      setFormValues({ ...formValues, taux_interet_defaut_djourou: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("taux_interet_defaut_djourou")}
                    disabled={savingCle === "taux_interet_defaut_djourou"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Frais de dossier de crédit (%)</label>
                <div className="mt-1 flex gap-2">
                  <EntierInput suffixe="%" conteneurClassName="flex-1"
                    max={20}
                    value={formValues.frais_dossier_credit_pourcent ?? 1}
                    onChange={(v) =>
                      setFormValues({ ...formValues, frais_dossier_credit_pourcent: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("frais_dossier_credit_pourcent")}
                    disabled={savingCle === "frais_dossier_credit_pourcent"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Pénalité de retard (% par mois d'impayé)
                </label>
                <div className="mt-1 flex gap-2">
                  <EntierInput suffixe="%" conteneurClassName="flex-1"
                    max={20}
                    value={formValues.penalite_retard_credit_pourcent ?? 2}
                    onChange={(v) =>
                      setFormValues({ ...formValues, penalite_retard_credit_pourcent: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("penalite_retard_credit_pourcent")}
                    disabled={savingCle === "penalite_retard_credit_pourcent"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Crédit ouvert unique par membre
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    value={formValues.credit_ouvert_unique_par_membre ? "true" : "false"}
                    onChange={(e) =>
                      setFormValues({ ...formValues, credit_ouvert_unique_par_membre: e.target.value === "true" })
                    }
                    className="w-full rounded-xl border border-gray-300 bg-white p-2 text-xs font-bold"
                  >
                    <option value="true">Actif (Interdire le cumul de crédits)</option>
                    <option value="false">Inactif (Autoriser plusieurs crédits simultanés)</option>
                  </select>
                  <button
                    onClick={() => handleSaveParam("credit_ouvert_unique_par_membre")}
                    disabled={savingCle === "credit_ouvert_unique_par_membre"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 3. SECTION RETRAIT (IKA-MARA) */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="text-base font-bold text-gray-950">3. Règles de Retrait (Ika-Mara)</h2>
              <p className="text-xs text-gray-500">
                Conditions d'ancienneté et frais appliqués sur les retraits d'épargne
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Délai minimal d'ancienneté (jours)
                </label>
                <div className="mt-1 flex gap-2">
                  <EntierInput suffixe="jours" conteneurClassName="flex-1"
                    value={formValues.delai_min_retrait_jours ?? 30}
                    onChange={(v) =>
                      setFormValues({ ...formValues, delai_min_retrait_jours: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("delai_min_retrait_jours")}
                    disabled={savingCle === "delai_min_retrait_jours"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Frais de retrait (%)</label>
                <div className="mt-1 flex gap-2">
                  <EntierInput suffixe="%" conteneurClassName="flex-1"
                    max={10}
                    value={formValues.frais_retrait_pourcent ?? 0}
                    onChange={(v) =>
                      setFormValues({ ...formValues, frais_retrait_pourcent: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("frais_retrait_pourcent")}
                    disabled={savingCle === "frais_retrait_pourcent"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Frais de retrait fixes (F CFA)</label>
                <div className="mt-1 flex gap-2">
                  <MontantInput conteneurClassName="flex-1"
                    value={formValues.frais_retrait_fixe ?? 0}
                    onChange={(v) =>
                      setFormValues({ ...formValues, frais_retrait_fixe: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("frais_retrait_fixe")}
                    disabled={savingCle === "frais_retrait_fixe"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 4. SECTION ALERTES */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="text-base font-bold text-gray-950">4. Seuils d'Alerte</h2>
              <p className="text-xs text-gray-500">
                Déclenchement des alertes sur le tableau de bord administrateur
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Seuil de retard membre avant alerte (jours)
                </label>
                <div className="mt-1 flex gap-2">
                  <EntierInput suffixe="jours" conteneurClassName="flex-1"
                    value={formValues.seuil_retard_jours ?? 3}
                    onChange={(v) =>
                      setFormValues({ ...formValues, seuil_retard_jours: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("seuil_retard_jours")}
                    disabled={savingCle === "seuil_retard_jours"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">
                  Seuil d'écart sur remise collecteur (F CFA)
                </label>
                <div className="mt-1 flex gap-2">
                  <MontantInput conteneurClassName="flex-1"
                    value={formValues.seuil_ecart_remise_alerte ?? 0}
                    onChange={(v) =>
                      setFormValues({ ...formValues, seuil_ecart_remise_alerte: v })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("seuil_ecart_remise_alerte")}
                    disabled={savingCle === "seuil_ecart_remise_alerte"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 5. SECTION REÇUS & STRUCTURE */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="text-base font-bold text-gray-950">5. En-tête des Reçus & Identité</h2>
              <p className="text-xs text-gray-500">
                Informations imprimées et partagées lors de la délivrance des reçus
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-gray-700">Nom de la structure</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={formValues.nom_structure ?? "IKA-MARA"}
                    onChange={(e) =>
                      setFormValues({ ...formValues, nom_structure: e.target.value })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("nom_structure")}
                    disabled={savingCle === "nom_structure"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700">Devise monétaire</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={formValues.devise ?? "F CFA"}
                    onChange={(e) =>
                      setFormValues({ ...formValues, devise: e.target.value })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("devise")}
                    disabled={savingCle === "devise"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700">En-tête des reçus</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={formValues.entete_recu ?? ""}
                    onChange={(e) =>
                      setFormValues({ ...formValues, entete_recu: e.target.value })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("entete_recu")}
                    disabled={savingCle === "entete_recu"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700">Pied de page des reçus</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={formValues.pied_recu ?? ""}
                    onChange={(e) =>
                      setFormValues({ ...formValues, pied_recu: e.target.value })
                    }
                    className="w-full rounded-xl border border-gray-300 p-2 text-xs font-bold"
                  />
                  <button
                    onClick={() => handleSaveParam("pied_recu")}
                    disabled={savingCle === "pied_recu"}
                    className="rounded-xl bg-gray-900 px-4 text-xs font-bold text-white hover:bg-black"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 2 : JOURNAL D'AUDIT FILTRABLE                                     */}
      {/* ========================================================================= */}
      {activeTab === "audit" && (
        <div className="space-y-6">
          {/* Barre de filtrage du journal d'audit */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600">Utilisateur</label>
                <select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="mt-1 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold focus:border-gray-900 focus:outline-hidden"
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
                  value={auditDateDebut}
                  onChange={(e) => setAuditDateDebut(e.target.value)}
                  className="mt-1 rounded-xl border border-gray-300 px-3 py-1.5 text-xs focus:border-gray-900 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600">Date fin</label>
                <input
                  type="date"
                  value={auditDateFin}
                  onChange={(e) => setAuditDateFin(e.target.value)}
                  className="mt-1 rounded-xl border border-gray-300 px-3 py-1.5 text-xs focus:border-gray-900 focus:outline-hidden"
                />
              </div>
            </div>

            <button
              onClick={() => {
                setSelectedUser("");
                setAuditDateDebut("");
                setAuditDateFin("");
              }}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Réinitialiser
            </button>
          </div>

          {/* Tableau du journal d'audit */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-bold text-gray-950">
                Journal des événements & modifications ({auditLogs.length})
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
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-gray-500">
                        {auditLoading ? "Chargement des logs…" : "Aucun événement consigné pour cette sélection"}
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 whitespace-nowrap text-gray-600 font-mono">
                          {formatDateTime(log.quand)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-gray-900">
                            {log.profiles?.nom || "Système / Admin"}
                          </span>
                          {log.profiles?.identifiant && (
                            <span className="block font-mono text-xs text-gray-500">
                              {log.profiles.identifiant} ({log.profiles.role})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-bold text-gray-800">
                            {log.quoi}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-700">
                          {log.details || "—"}
                          {log.apres && (
                            <pre className="mt-1 max-h-20 max-w-md overflow-x-auto rounded bg-gray-50 p-1 text-xs text-gray-600 font-mono">
                              {JSON.stringify(log.apres)}
                            </pre>
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
    </div>
  );
}
