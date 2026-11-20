"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMontant } from "@/lib/utils/format";

type PeriodeType = "jour" | "mois" | "annee";

interface DashboardData {
  cartes: {
    collecte_du_jour: number;
    commissions_du_mois: number;
    encours_credit: number;
    solde_caisse: number;
  };
  tableau_agents: Array<{
    id: string;
    nom: string;
    identifiant: string;
    telephone: string | null;
    statut: string;
    membres_servis: number;
    collecte: number;
    remis: number;
    ecart: number;
  }>;
  alertes: {
    retards_membres_count: number;
    seuil_retard_jours: number;
    ecarts_remises_count: number;
    demandes_a_valider_count: number;
  };
  periode: PeriodeType;
  label_periode: string;
}

/**
 * Tableau de bord Administrateur (/admin)
 * - Cartes clés : Collecte du jour, Commissions du mois, Encours crédit, Solde caisse
 * - Sélecteur de période : Jour / Mois / Année
 * - Tableau par agent : Membres servis, collecté, remis, écart avec lien détail
 * - Alertes interactives : Retards > N jours, Écarts de remise, Retraits/crédits à valider
 * - Export Excel (CSV UTF-8 BOM avec séparateur point-virgule)
 */
export default function AdminDashboardPage() {
  const router = useRouter();
  const [periode, setPeriode] = useState<PeriodeType>("jour");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Chargement des données
  const fetchDashboard = async (p: PeriodeType) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/dashboard?periode=${p}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push("/login?error=Accès non autorisé");
          return;
        }
        throw new Error("Impossible de charger les données du tableau de bord");
      }
      const json = await res.json();
      if (json.success) {
        setData(json);
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
    startTransition(() => {
      fetchDashboard(periode);
    });
  }, [periode]);

  // Fonction d'exportation vers Excel (CSV avec UTF-8 BOM et séparateurs ;)
  const handleExportExcel = () => {
    if (!data || !data.tableau_agents) return;

    const entetes = [
      "Identifiant",
      "Nom Agent",
      "Téléphone",
      "Membres Servis",
      `Collecté (${data.label_periode})`,
      `Remis (${data.label_periode})`,
      "Écart de Collecte",
      "Statut Agent",
    ];

    const lignes = data.tableau_agents.map((ag) => [
      `"${ag.identifiant}"`,
      `"${ag.nom.replace(/"/g, '""')}"`,
      `"${ag.telephone || "—"}"`,
      ag.membres_servis,
      ag.collecte,
      ag.remis,
      ag.ecart,
      `"${ag.statut === "actif" ? "Actif" : "Suspendu"}"`,
    ]);

    const csvContent =
      "\uFEFF" + // UTF-8 BOM pour ouverture correcte dans Excel
      [entetes.join(";"), ...lignes.map((l) => l.join(";"))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IKA-MARA_Collecte_Agents_${periode}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* En-tête : Titre & Sélecteur de période */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">
            Tableau de bord
          </h1>
          <p className="mt-1 text-xs text-gray-500 sm:text-sm">
            Vue d'ensemble de l'activité, de la collecte terrain et de la caisse
          </p>
        </div>

        {/* Sélecteur de période */}
        <div className="flex items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm">
          <button
            onClick={() => setPeriode("jour")}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              periode === "jour"
                ? "bg-primary-700 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Jour
          </button>
          <button
            onClick={() => setPeriode("mois")}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              periode === "mois"
                ? "bg-primary-700 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Mois
          </button>
          <button
            onClick={() => setPeriode("annee")}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              periode === "annee"
                ? "bg-primary-700 text-white shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Année
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Cartes Métriques Clés — blocs de couleur pleine, sans icône.
          Vert = croissance (collecte), Bleu = confiance (commissions),
          Violet = sagesse (crédit, couleur Djourou), Jaune = optimisme (caisse). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BlocCouleur
          couleur="vert"
          titre="Collecte du jour"
          valeur={data ? formatMontant(data.cartes.collecte_du_jour) : "—"}
          sousTitre="Dépôts encaissés aujourd'hui"
        />
        <BlocCouleur
          couleur="bleu"
          titre="Commissions du mois"
          valeur={data ? formatMontant(data.cartes.commissions_du_mois) : "—"}
          sousTitre="Produit net des commissions"
        />
        <BlocCouleur
          couleur="violet"
          titre="Encours de crédit"
          valeur={data ? formatMontant(data.cartes.encours_credit) : "—"}
          sousTitre="Capital restant dû (Ika-Djourou)"
        />
        <BlocCouleur
          couleur="jaune"
          titre="Solde de caisse"
          valeur={data ? formatMontant(data.cartes.solde_caisse) : "—"}
          sousTitre="Disponibilités physiques au coffre"
        />
      </div>

      {/* Alertes de gestion — Rouge = urgence, Noir = contrôle, Gris = en attente */}
      <div className="space-y-3">
        <h2 className="eyebrow">Alertes de gestion</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <BlocCouleur
            href="/admin/djourou"
            couleur="rouge"
            titre={`Retards > ${data?.alertes.seuil_retard_jours ?? 3} jours`}
            valeur={String(data?.alertes.retards_membres_count ?? 0)}
            sousTitre="Échéances ou cotisations impayées"
          />
          <BlocCouleur
            href="/admin/caisse?filtre=ecarts"
            couleur="noir"
            titre="Écarts de remise"
            valeur={String(data?.alertes.ecarts_remises_count ?? 0)}
            sousTitre="Remises non confirmées ou avec écart"
          />
          <BlocCouleur
            href="/admin/djourou"
            couleur="gris"
            titre="Demandes à valider"
            valeur={String(data?.alertes.demandes_a_valider_count ?? 0)}
            sousTitre="Dossiers de retraits et de crédits soumis"
          />
        </div>
      </div>

      {/* Tableau de suivi par Agent */}
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              Collecte par Agent — {data?.label_periode || "Période"}
            </h2>
            <p className="text-xs text-gray-500">
              Détail des encaissements, remises en caisse et contrôle des écarts
            </p>
          </div>

          <button
            onClick={handleExportExcel}
            disabled={!data || data.tableau_agents.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50 active:scale-98 disabled:opacity-50"
          >
            <span>Exporter Excel</span>
          </button>
        </div>

        {/* Tableau Responsive */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3.5">Agent</th>
                  <th className="px-4 py-3.5 text-center">Membres servis</th>
                  <th className="px-4 py-3.5 text-right">Collecté</th>
                  <th className="px-4 py-3.5 text-right">Remis</th>
                  <th className="px-4 py-3.5 text-right">Écart</th>
                  <th className="px-4 py-3.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {loading && !data ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-400">
                      Chargement des statistiques…
                    </td>
                  </tr>
                ) : data && data.tableau_agents.length > 0 ? (
                  data.tableau_agents.map((agent) => (
                    <tr
                      key={agent.id}
                      onClick={() => router.push(`/admin/agents/${agent.id}`)}
                      className="cursor-pointer transition hover:bg-primary-50/40"
                    >
                      {/* Agent */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-100 text-xs font-bold text-primary-800">
                            {agent.nom.substring(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <p className="font-bold text-gray-900">{agent.nom}</p>
                            <p className="text-xs font-mono text-gray-400">
                              {agent.identifiant}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Membres servis */}
                      <td className="px-4 py-3.5 text-center font-bold text-gray-800">
                        {agent.membres_servis}
                      </td>

                      {/* Collecté */}
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-gray-900">
                        {formatMontant(agent.collecte)}
                      </td>

                      {/* Remis */}
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-700">
                        {formatMontant(agent.remis)}
                      </td>

                      {/* Écart */}
                      <td className="px-4 py-3.5 text-right font-mono">
                        {agent.ecart === 0 ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                            0 F (Juste)
                          </span>
                        ) : agent.ecart > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-bold text-primary-700">
                            +{formatMontant(agent.ecart)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
                            {formatMontant(agent.ecart)}
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 text-center">
                        <Link
                          href={`/admin/agents/${agent.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-primary-700 hover:bg-primary-50"
                        >
                          Détail ›
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-gray-400">
                      Aucun agent trouvé pour cette période.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Palette symbolique des blocs (inspirée du nuancier « bonnes couleurs ») :
 * Bleu sérénité, Vert nature, Rouge énergie, Jaune optimisme,
 * Noir élégance, Violet sagesse, Gris neutralité.
 * Le jaune porte un texte foncé : le blanc y serait illisible.
 */
const BLOC_COULEURS = {
  bleu: "bg-[#0f2a52] text-white",
  vert: "bg-[#1e7b6e] text-white",
  rouge: "bg-[#e04e2a] text-white",
  jaune: "bg-[#f6b93b] text-[#1f1a0e]",
  noir: "bg-[#121212] text-white",
  violet: "bg-[#6b4fa8] text-white",
  gris: "bg-[#6b7078] text-white",
} as const;

function BlocCouleur({
  couleur,
  titre,
  valeur,
  sousTitre,
  href,
}: {
  couleur: keyof typeof BLOC_COULEURS;
  titre: string;
  valeur: string;
  sousTitre: string;
  href?: string;
}) {
  const contenu = (
    <>
      <p className="text-sm font-semibold opacity-90">{titre}</p>
      <p className="mt-3 font-mono text-3xl font-bold leading-none tracking-tight">{valeur}</p>
      <p className="mt-3 text-sm opacity-80">{sousTitre}</p>
    </>
  );
  const classes = `block rounded-md p-5 ${BLOC_COULEURS[couleur]}`;

  return href ? (
    <Link href={href} className={`${classes} transition hover:brightness-110 active:scale-[0.99]`}>
      {contenu}
    </Link>
  ) : (
    <div className={classes}>{contenu}</div>
  );
}
