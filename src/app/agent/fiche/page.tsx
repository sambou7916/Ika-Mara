"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { formatMontant, formatDateTime, libelleVolet } from "@/lib/utils/format";
import type { Operation, VoletType } from "@/lib/types";

function FicheMembreContent({ numero }: { numero: string }) {
  const searchParams = useSearchParams();
  const toast = searchParams.get("toast");
  const toastType = searchParams.get("type");
  const toastMontant = searchParams.get("montant");

  // Charger et calculer les données du membre en direct depuis Dexie
  const data = useLiveQuery(async () => {
    // 1. Récupérer le membre par son numéro unique (4 chiffres)
    const membre = await db.membres.where("numero").equals(numero).first();
    if (!membre) return null;

    // 2. Récupérer les souscriptions, soldes serveur et opérations locales
    const [souscriptions, soldesServeur, allOperations, outboxEntries] =
      await Promise.all([
        db.souscriptions.where("membre_id").equals(membre.id).toArray(),
        db.soldes.where("membre_id").equals(membre.id).toArray(),
        db.operations
          .where("membre_id")
          .equals(membre.id)
          .reverse()
          .sortBy("cree_le"),
        db.outbox.toArray(),
      ]);

    // Ensemble des ID des opérations encore présentes dans l'outbox (non synchronisées)
    const pendingOpIds = new Set(
      outboxEntries
        .filter((e) => e.table === "operations")
        .map((e) => e.clientId)
    );

    // 3. Calcul des soldes par volet = Solde serveur + opérations locales non synchronisées
    // Pour chaque volet :
    // - Ika-Mara (Épargne nette) : dépôts − retraits − commissions
    // - Ika-Pari (Tontine cotisée) : dépôts de tontine cumulés
    // - Ika-Djourou (Crédit restant dû) : dette restante à rembourser

    const soldesParVolet: Record<
      VoletType,
      {
        soldeFinal: number;
        soldeServeur: number;
        deltaLocal: number;
        hasPending: boolean;
        souscrit: boolean;
        montantJour: number;
      }
    > = {
      mara: { soldeFinal: 0, soldeServeur: 0, deltaLocal: 0, hasPending: false, souscrit: false, montantJour: 0 },
      pari: { soldeFinal: 0, soldeServeur: 0, deltaLocal: 0, hasPending: false, souscrit: false, montantJour: 0 },
      djourou: { soldeFinal: 0, soldeServeur: 0, deltaLocal: 0, hasPending: false, souscrit: false, montantJour: 0 },
    };

    // Remplir les informations de souscription
    for (const sub of souscriptions) {
      if (soldesParVolet[sub.volet]) {
        soldesParVolet[sub.volet].souscrit = sub.statut === "active";
        soldesParVolet[sub.volet].montantJour = sub.montant_jour;
      }
    }

    // Récupérer les soldes du dernier téléchargement serveur
    for (const s of soldesServeur) {
      if (s.volet && soldesParVolet[s.volet]) {
        soldesParVolet[s.volet].soldeServeur = Number(s.solde) || 0;
      }
    }

    // Calculer l'impact des opérations locales NON synchronisées
    const opsNonSync = allOperations.filter((op) => pendingOpIds.has(op.id));

    for (const op of opsNonSync) {
      const v = op.volet;
      if (!soldesParVolet[v]) continue;

      soldesParVolet[v].hasPending = true;

      if (v === "mara") {
        if (op.type === "depot") soldesParVolet[v].deltaLocal += op.montant;
        else if (op.type === "retrait" || op.type === "commission")
          soldesParVolet[v].deltaLocal -= op.montant;
      } else if (v === "pari") {
        if (op.type === "depot") soldesParVolet[v].deltaLocal += op.montant;
      } else if (v === "djourou") {
        // Pour le crédit, un remboursement local diminue la dette restante
        if (op.type === "remboursement" || op.type === "depot") {
          soldesParVolet[v].deltaLocal -= op.montant;
        }
      }
    }

    // Calcul final pour chaque volet
    soldesParVolet.mara.soldeFinal =
      soldesParVolet.mara.soldeServeur + soldesParVolet.mara.deltaLocal;
    soldesParVolet.pari.soldeFinal =
      soldesParVolet.pari.soldeServeur + soldesParVolet.pari.deltaLocal;
    // Crédit restant dû (ne peut être inférieur à 0)
    soldesParVolet.djourou.soldeFinal = Math.max(
      0,
      soldesParVolet.djourou.soldeServeur + soldesParVolet.djourou.deltaLocal
    );

    // 4. Calcul des arriérés détaillés par volet
    const now = new Date();
    const debutMois = new Date(now.getFullYear(), now.getMonth(), 1);

    const arrieresParVolet: Array<{
      volet: VoletType;
      libelle: string;
      joursRetard: number;
      montantDu: number;
      isAJour: boolean;
      montantJour: number;
    }> = [];

    let totalJoursRetardMax = 0;
    let totalMontantDu = 0;

    for (const sub of souscriptions.filter((s) => s.statut === "active")) {
      const dateDebut = new Date(sub.date_debut);
      const refDate = dateDebut > debutMois ? dateDebut : debutMois;
      const msDiff = now.getTime() - refDate.getTime();
      const joursDus = Math.max(
        1,
        Math.floor(msDiff / (1000 * 60 * 60 * 24)) + 1
      );

      const opsVolet = allOperations.filter(
        (op) =>
          op.volet === sub.volet &&
          (op.type === "depot" || op.type === "remboursement") &&
          op.statut === "validee" &&
          new Date(op.date_operation) >= refDate
      );

      const joursPayes = opsVolet.reduce(
        (sum, op) => sum + (op.jours_couverts || 1),
        0
      );

      const retard = Math.max(0, joursDus - joursPayes);
      const montantDu = retard * sub.montant_jour;

      if (retard > totalJoursRetardMax) totalJoursRetardMax = retard;
      totalMontantDu += montantDu;

      arrieresParVolet.push({
        volet: sub.volet,
        libelle: libelleVolet(sub.volet),
        joursRetard: retard,
        montantDu,
        isAJour: retard === 0,
        montantJour: sub.montant_jour,
      });
    }

    // 5. Les 10 derniers mouvements avec leur statut de synchronisation
    const dixDerniersMouvements = allOperations.slice(0, 10).map((op) => ({
      ...op,
      isPending: pendingOpIds.has(op.id),
    }));

    return {
      membre,
      souscriptions,
      soldesParVolet,
      arrieresParVolet,
      dixDerniersMouvements,
      totalJoursRetardMax,
      totalMontantDu,
      isGlobalementAJour: totalJoursRetardMax === 0,
    };
  }, [numero]);

  if (data === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-xs text-red-700">
        <p className="font-bold text-sm">Adhérent introuvable</p>
        <p className="mt-1 text-gray-600">
          Aucun membre ne correspond au numéro « {numero} ».
        </p>
        <Link
          href="/agent/membres"
          className="mt-4 inline-block rounded-xl bg-primary-700 px-4 py-2 font-bold text-white shadow-sm"
        >
          Retour à la liste
        </Link>
      </div>
    );
  }

  const {
    membre,
    soldesParVolet,
    arrieresParVolet,
    dixDerniersMouvements,
    totalJoursRetardMax,
    totalMontantDu,
    isGlobalementAJour,
  } = data;

  return (
    <div className="space-y-4">
      {/* 1. Barre de navigation supérieure */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Link
            href="/agent/membres"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 text-gray-700 shadow-sm active:scale-95"
          >
            ‹
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Fiche Adhérent</h1>
        </div>

        <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
          Mode hors ligne
        </span>
      </div>

      {/* Toast de confirmation de demande */}
      {toast === "demande_enregistree" && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-900 shadow-sm animate-scaleIn">
          <div className="flex items-center gap-2">
            <span className="text-base">✅</span>
            <div className="flex-1">
              <p className="font-bold text-emerald-950">
                Demande de {toastType === "demande_retrait" ? "retrait" : "crédit"} enregistrée !
              </p>
              <p className="text-xs text-emerald-800 font-normal mt-0.5">
                Montant : {formatMontant(Number(toastMontant) || 0)} · En attente de validation par l&apos;administrateur.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. Boutons d'action rapides : Nouveau dépôt et Demande */}
      <div className="grid grid-cols-2 gap-2.5">
        <Link
          href={`/agent/depot?membre=${membre.numero}`}
          className="flex items-center justify-center gap-2 rounded-2xl bg-primary-700 py-3.5 px-4 font-bold text-white shadow-md shadow-primary-700/20 active:scale-95 hover:bg-primary-800 transition-all text-sm"
        >
          <span>➕</span>
          <span>Nouveau dépôt</span>
        </Link>

        <Link
          href={`/agent/demandes?membre=${membre.numero}`}
          className="flex items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white py-3.5 px-4 font-bold text-gray-800 shadow-sm active:scale-95 hover:bg-gray-50 transition-all text-sm"
        >
          <span>📝</span>
          <span>Demande</span>
        </Link>
      </div>

      {/* 3. Bloc Identité (Lecture seule) */}
      <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="inline-flex items-center gap-1 rounded-md bg-primary-100 px-2.5 py-0.5 text-xs font-mono font-bold text-primary-900 mb-1">
              <span>N°</span>
              <span>{membre.numero}</span>
            </div>

            <h2 className="text-xl font-bold text-gray-950 tracking-tight">
              {membre.prenom} {membre.nom}
            </h2>

            <p className="text-xs text-gray-500 font-medium mt-0.5">
              {membre.profession || "Profession non renseignée"} · Quartier :{" "}
              <strong className="text-gray-700">
                {membre.quartier || "Non précisé"}
              </strong>
            </p>
          </div>

          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
              membre.statut === "actif"
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {membre.statut === "actif" ? "Actif" : "Inactif"}
          </span>
        </div>

        {membre.telephone && (
          <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
            <span className="text-gray-500">Numéro de téléphone :</span>
            <a
              href={`tel:${membre.telephone}`}
              className="flex items-center gap-1 font-mono font-bold text-primary-700 hover:underline"
            >
              <span>📞</span>
              <span>{membre.telephone}</span>
            </a>
          </div>
        )}

        {/* Note de lecture seule */}
        <p className="text-xs text-gray-400 border-t border-gray-100 pt-2 text-center">
          🔒 Fiche en lecture seule. La modification de l&apos;identité ou de la
          cotisation est réservée à l&apos;administrateur.
        </p>
      </div>

      {/* 4. Bloc Soldes par volet (Calculé localement : Serveur + Opérations locales non synchronisées) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Soldes par volet
          </h3>
          <span className="text-xs text-gray-400">
            Serveur + local non synchronisé
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {/* Ika-Mara : Épargne nette */}
          <div className="rounded-2xl border border-green-200 bg-white p-3 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-green-800 uppercase">
                  Épargne nette
                </span>
                <span className="h-2 w-2 rounded-full bg-mara" />
              </div>
              <p className="text-xs text-gray-400">Ika-Mara</p>
            </div>

            <div className="mt-2">
              <p className="font-mono text-base font-bold text-green-700 tracking-tight">
                {formatMontant(soldesParVolet.mara.soldeFinal)}
              </p>
              {soldesParVolet.mara.hasPending && (
                <span className="inline-block mt-0.5 text-xs font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                  ⏳ non synchronisé
                </span>
              )}
            </div>
          </div>

          {/* Ika-Pari : Tontine cotisée */}
          <div className="rounded-2xl border border-amber-200 bg-white p-3 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-800 uppercase">
                  Tontine cotisée
                </span>
                <span className="h-2 w-2 rounded-full bg-pari" />
              </div>
              <p className="text-xs text-gray-400">Ika-Pari</p>
            </div>

            <div className="mt-2">
              <p className="font-mono text-base font-bold text-amber-700 tracking-tight">
                {formatMontant(soldesParVolet.pari.soldeFinal)}
              </p>
              {soldesParVolet.pari.hasPending && (
                <span className="inline-block mt-0.5 text-xs font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                  ⏳ non synchronisé
                </span>
              )}
            </div>
          </div>

          {/* Ika-Djourou : Crédit restant dû */}
          <div className="rounded-2xl border border-red-200 bg-white p-3 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-red-800 uppercase">
                  Crédit restant
                </span>
                <span className="h-2 w-2 rounded-full bg-djourou" />
              </div>
              <p className="text-xs text-gray-400">Ika-Djourou</p>
            </div>

            <div className="mt-2">
              <p className="font-mono text-base font-bold text-red-700 tracking-tight">
                {formatMontant(soldesParVolet.djourou.soldeFinal)}
              </p>
              {soldesParVolet.djourou.hasPending && (
                <span className="inline-block mt-0.5 text-xs font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                  ⏳ non synchronisé
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 5. Bloc Arriérés par volet */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
          État des arriérés
        </h3>

        {arrieresParVolet.length > 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm divide-y divide-gray-100 text-xs">
            {arrieresParVolet.map((arr) => (
              <div
                key={arr.volet}
                className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
              >
                <div>
                  <span className="font-bold text-gray-900">{arr.libelle}</span>
                  <p className="text-xs text-gray-400">
                    Cotisation : {formatMontant(arr.montantJour)}/jour
                  </p>
                </div>

                <div className="text-right">
                  {arr.isAJour ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200">
                      ✓ À jour
                    </span>
                  ) : (
                    <div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900 border border-amber-300">
                        {arr.joursRetard} j de retard
                      </span>
                      <p className="font-mono text-xs font-bold text-amber-800 mt-0.5">
                        {formatMontant(arr.montantDu)} dû
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-center text-xs text-gray-400">
            Aucune souscription active enregistrée.
          </div>
        )}
      </div>

      {/* 6. Bloc 10 derniers mouvements avec badge de synchronisation */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
            10 derniers mouvements
          </h3>
          <span className="text-xs text-gray-400">Dépôts & retraits</span>
        </div>

        {dixDerniersMouvements.length > 0 ? (
          <div className="divide-y divide-gray-100 rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden text-xs">
            {dixDerniersMouvements.map((op) => (
              <Link
                key={op.id}
                href={`/agent/recu?id=${op.id}`}
                className="flex items-center justify-between p-3.5 hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold capitalize text-gray-900">
                      {op.type} · {op.volet}
                    </span>

                    {/* Badge En attente vs Synchronisé */}
                    {op.isPending ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.2 text-xs font-bold text-amber-800 border border-amber-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                        En attente
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.2 text-xs font-bold text-emerald-800 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Synchronisé
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-500">
                    {op.date_operation}{" "}
                    {op.jours_couverts > 1 ? `(${op.jours_couverts} jours)` : ""}
                  </p>
                </div>

                <div className="text-right">
                  <p
                    className={`font-mono text-sm font-bold ${
                      op.type === "retrait" ? "text-red-600" : "text-gray-900"
                    }`}
                  >
                    {op.type === "retrait" ? "−" : "+"}
                    {formatMontant(op.montant)}
                  </p>
                  <span className="text-xs text-primary-600 font-semibold">
                    Reçu ›
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
            Aucun mouvement enregistré pour ce membre.
          </div>
        )}
      </div>
    </div>
  );
}

/** Numéro lu dans l'adresse côté navigateur (page statique, disponible hors ligne). */
function FicheDepuisAdresse() {
  const numero = useSearchParams().get("numero") ?? "";
  return <FicheMembreContent numero={numero} />;
}

/**
 * Fiche membre : /agent/fiche?numero=<numéro>
 * Page statique : gardée sur le téléphone, elle s'ouvre hors connexion
 * pour n'importe quel membre.
 */
export default function FicheMembrePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center p-6 text-gray-500">
          <p className="text-sm font-semibold">Chargement de la fiche…</p>
        </div>
      }
    >
      <FicheDepuisAdresse />
    </Suspense>
  );
}
