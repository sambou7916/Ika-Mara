"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { formatMontant } from "@/lib/utils/format";
import type { Membre, Souscription, Operation } from "@/lib/types";

type FilterChip = "tous" | "impayes" | "mara" | "pari" | "djourou";

interface MembreItem {
  id: string;
  numero: string;
  nom: string;
  prenom: string;
  quartier: string | null;
  cotisationJourTotal: number;
  voletsActifs: string[];
  joursRetardMax: number;
  montantRetardTotal: number;
  isAJour: boolean;
}

/**
 * Normalise une chaîne de texte pour recherche insensible à la casse et aux accents.
 */
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default function ListeMembresPage() {
  const [recherche, setRecherche] = useState<string>("");
  const [filter, setFilter] = useState<FilterChip>("tous");
  const [visibleCount, setVisibleCount] = useState<number>(40);

  // Charger les données de Dexie avec useLiveQuery
  const membresData = useLiveQuery(async () => {
    // 1. Récupérer l'agent courant
    const currentId =
      typeof window !== "undefined"
        ? localStorage.getItem("ika_current_agent")
        : null;

    let agent = null;
    if (currentId) {
      agent = await db.agentAuth.get(currentId.toUpperCase());
    }

    // 2. Récupérer tous les membres du portefeuille de l'agent
    let membres = await db.membres.toArray();
    if (agent?.agentId) {
      membres = membres.filter((m) => m.agent_id === agent.agentId);
    }

    // 3. Charger souscriptions et opérations
    const [souscriptions, operations] = await Promise.all([
      db.souscriptions.toArray(),
      db.operations.toArray(),
    ]);

    const now = new Date();
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);

    // 4. Calculer les métriques pour chaque membre
    const items: MembreItem[] = membres.map((m) => {
      const subsMembre = souscriptions.filter(
        (s) => s.membre_id === m.id && s.statut === "active"
      );

      const cotisationJourTotal = subsMembre.reduce(
        (acc, s) => acc + s.montant_jour,
        0
      );
      const voletsActifs = subsMembre.map((s) => s.volet);

      // Calcul des arriérés sur l'ensemble des souscriptions actives
      let joursRetardMax = 0;
      let montantRetardTotal = 0;

      for (const sub of subsMembre) {
        const dateDebut = new Date(sub.date_debut);
        const refDate = dateDebut > debutMois ? dateDebut : debutMois;
        const msDiff = now.getTime() - refDate.getTime();
        const joursDus = Math.max(
          1,
          Math.floor(msDiff / (1000 * 60 * 60 * 24)) + 1
        );

        // Opérations de dépôt de ce membre pour ce volet depuis refDate
        const opsSub = operations.filter(
          (op) =>
            op.membre_id === m.id &&
            op.volet === sub.volet &&
            (op.type === "depot" || op.type === "remboursement") &&
            op.statut === "validee" &&
            new Date(op.date_operation) >= refDate
        );

        const joursPayes = opsSub.reduce(
          (sum, op) => sum + (op.jours_couverts || 1),
          0
        );

        const retardVolet = Math.max(0, joursDus - joursPayes);
        if (retardVolet > joursRetardMax) {
          joursRetardMax = retardVolet;
        }
        montantRetardTotal += retardVolet * sub.montant_jour;
      }

      return {
        id: m.id,
        numero: m.numero,
        nom: m.nom,
        prenom: m.prenom,
        quartier: m.quartier,
        cotisationJourTotal,
        voletsActifs,
        joursRetardMax,
        montantRetardTotal,
        isAJour: joursRetardMax === 0,
      };
    });

    return items;
  }, []);

  // Filtrage et Recherche instantanée
  const membresFiltres = useMemo(() => {
    if (!membresData) return [];

    let result = [...membresData];

    // 1. Filtrage par chip
    if (filter === "impayes") {
      result = result.filter((m) => !m.isAJour);
    } else if (filter === "mara") {
      result = result.filter((m) => m.voletsActifs.includes("mara"));
    } else if (filter === "pari") {
      result = result.filter((m) => m.voletsActifs.includes("pari"));
    } else if (filter === "djourou") {
      result = result.filter((m) => m.voletsActifs.includes("djourou"));
    }

    // 2. Recherche textuelle (numéro exact, préfixe de numéro, nom/prénom sans accents)
    const q = normalizeText(recherche);
    if (q.length > 0) {
      result = result.filter((m) => {
        const num = m.numero.toLowerCase();
        if (num.startsWith(q) || num === q) return true;

        const fullName = normalizeText(`${m.prenom} ${m.nom}`);
        const invName = normalizeText(`${m.nom} ${m.prenom}`);
        return fullName.includes(q) || invName.includes(q);
      });
    }

    // 3. Tri par défaut : retards d'abord (du plus grand au plus petit), puis numéro
    result.sort((a, b) => {
      if (b.joursRetardMax !== a.joursRetardMax) {
        return b.joursRetardMax - a.joursRetardMax;
      }
      return a.numero.localeCompare(b.numero);
    });

    return result;
  }, [membresData, recherche, filter]);

  // Liste fenêtrée pour affichage fluide (500+ membres sans lag)
  const membresAffiches = useMemo(() => {
    return membresFiltres.slice(0, visibleCount);
  }, [membresFiltres, visibleCount]);

  function loadMore() {
    setVisibleCount((prev) => prev + 40);
  }

  const countTotal = membresData?.length ?? 0;
  const countImpayes =
    membresData?.filter((m) => !m.isAJour).length ?? 0;

  return (
    <div className="space-y-3.5">
      {/* En-tête de page */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Membres
          </h1>
          <p className="text-xs text-gray-500 font-medium">
            {countTotal} membre{countTotal > 1 ? "s" : ""} dans votre portefeuille
            {countImpayes > 0 && (
              <span className="text-amber-700 ml-1 font-semibold">
                · {countImpayes} impayé{countImpayes > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>

        <Link
          href="/agent/depot"
          className="flex items-center gap-1.5 rounded-full bg-primary-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-primary-800 active:scale-95"
        >
          <span>➕</span>
          <span>Dépôt</span>
        </Link>
      </div>

      {/* Barre de recherche instantanée */}
      <div className="relative">
        <input
          type="text"
          value={recherche}
          onChange={(e) => {
            setRecherche(e.target.value);
            setVisibleCount(40);
          }}
          placeholder="Rechercher numéro (ex: 0042) ou nom…"
          className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-10 text-sm font-medium text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-100"
        />
        <span className="absolute left-3.5 top-3.5 text-gray-400 text-sm">
          🔍
        </span>
        {recherche.length > 0 && (
          <button
            onClick={() => setRecherche("")}
            className="absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-300"
          >
            ✕
          </button>
        )}
      </div>

      {/* Filtres Chips défilables horizontalement */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
        <Chip
          label={`Tous (${countTotal})`}
          active={filter === "tous"}
          onClick={() => setFilter("tous")}
        />
        <Chip
          label={`Impayés (${countImpayes})`}
          active={filter === "impayes"}
          alertBadge={countImpayes > 0}
          onClick={() => setFilter("impayes")}
        />
        <Chip
          label="Ika-Mara"
          active={filter === "mara"}
          color="mara"
          onClick={() => setFilter("mara")}
        />
        <Chip
          label="Ika-Pari"
          active={filter === "pari"}
          color="pari"
          onClick={() => setFilter("pari")}
        />
        <Chip
          label="Ika-Djourou"
          active={filter === "djourou"}
          color="djourou"
          onClick={() => setFilter("djourou")}
        />
      </div>

      {/* Liste des membres */}
      {membresAffiches.length > 0 ? (
        <div className="space-y-2">
          {membresAffiches.map((m) => (
            <Link
              key={m.id}
              href={`/agent/membres/${m.numero}`}
              className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm transition-all active:scale-[0.99] hover:border-primary-300 hover:bg-primary-50/20"
            >
              <div className="flex items-center gap-3 min-w-0">
                {/* Numéro adhérent mis en avant */}
                <div className="flex h-11 w-11 flex-shrink-0 flex-col items-center justify-center rounded-xl bg-primary-100/70 border border-primary-200 text-primary-900">
                  <span className="text-xs font-bold uppercase leading-none opacity-60">
                    N°
                  </span>
                  <span className="font-mono text-xs font-bold">
                    {m.numero}
                  </span>
                </div>

                {/* Nom, Prénom, Quartier */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900 leading-tight">
                    {m.prenom} {m.nom}
                  </p>
                  <p className="truncate text-xs text-gray-500 mt-0.5">
                    {m.quartier || "Quartier non renseigné"} ·{" "}
                    <span className="font-mono font-bold text-gray-700">
                      {formatMontant(m.cotisationJourTotal)}/j
                    </span>
                  </p>
                </div>
              </div>

              {/* État de cotisation (À jour vs N jours de retard) */}
              <div className="flex flex-col items-end flex-shrink-0 ml-2">
                {m.isAJour ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    À jour
                  </span>
                ) : (
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900 border border-amber-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      {m.joursRetardMax} j retard
                    </span>
                    <p className="font-mono text-xs font-bold text-amber-700 mt-0.5">
                      {formatMontant(m.montantRetardTotal)} dû
                    </p>
                  </div>
                )}
              </div>
            </Link>
          ))}

          {/* Bouton charger plus si > 40 membres */}
          {visibleCount < membresFiltres.length && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={loadMore}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-xs font-bold text-primary-800 shadow-sm hover:bg-gray-50 active:scale-95"
              >
                Afficher plus ({membresFiltres.length - visibleCount} restants)
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center text-xs text-gray-400">
          <span className="text-3xl block mb-2">🔍</span>
          <p className="font-bold text-gray-600">Aucun membre trouvé</p>
          <p className="mt-1 text-gray-400">
            {recherche.length > 0
              ? `Aucun résultat pour « ${recherche} »`
              : "Aucun membre ne correspond à ce filtre."}
          </p>
        </div>
      )}

      {/* Note d'administration */}
      <p className="text-center text-xs text-gray-400 pt-2 pb-1">
        🔒 L&apos;ajout et la suppression de membres sont réservés à l&apos;administrateur.
      </p>
    </div>
  );
}

function Chip({
  label,
  active,
  alertBadge = false,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  alertBadge?: boolean;
  color?: "mara" | "pari" | "djourou";
  onClick: () => void;
}) {
  let activeStyle = "bg-primary-700 text-white shadow-sm";
  if (color === "mara") {
    activeStyle = "bg-mara text-white shadow-sm";
  } else if (color === "pari") {
    activeStyle = "bg-pari text-white shadow-sm";
  } else if (color === "djourou") {
    activeStyle = "bg-djourou text-white shadow-sm";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition-all active:scale-95 border ${
        active
          ? `${activeStyle} border-transparent`
          : alertBadge
          ? "border-amber-200 bg-amber-50/80 text-amber-800 hover:bg-amber-100"
          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      }`}
    >
      {label}
    </button>
  );
}
