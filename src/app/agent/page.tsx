"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { formatMontant } from "@/lib/utils/format";

export default function AgentHomePage() {
  // Récupération et calculs en temps réel depuis Dexie
  const data = useLiveQuery(async () => {
    // 1. Obtenir la date du jour (format YYYY-MM-DD local)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    // 2. Récupérer l'agent courant mémorisé
    const currentId =
      typeof window !== "undefined"
        ? localStorage.getItem("ika_current_agent")
        : null;

    let agent = null;
    if (currentId) {
      agent = await db.agentAuth.get(currentId.toUpperCase());
    }

    // 3. Récupérer toutes les opérations locales de l'agent pour aujourd'hui
    let ops = await db.operations.toArray();

    // Filtrer par date du jour
    ops = ops.filter((op) => op.date_operation === todayStr);

    // Filtrer par agent si identifié
    if (agent?.agentId) {
      ops = ops.filter(
        (op) => !op.agent_id || op.agent_id === agent.agentId
      );
    }

    // Retenir les dépôts valides (cotisations perçues)
    const depots = ops.filter(
      (op) =>
        (op.type === "depot" || op.type === "remboursement") &&
        op.statut !== "annulee"
    );

    // Somme totale collectée
    const totalCollecte = depots.reduce(
      (sum, op) => sum + (Number(op.montant) || 0),
      0
    );

    // Nombre de membres distincts servis aujourd'hui
    const membresDistincts = new Set(depots.map((op) => op.membre_id));
    const membresServis = membresDistincts.size;

    // Répartition par volet
    const totalMara = depots
      .filter((op) => op.volet === "mara")
      .reduce((sum, op) => sum + (Number(op.montant) || 0), 0);

    const totalPari = depots
      .filter((op) => op.volet === "pari")
      .reduce((sum, op) => sum + (Number(op.montant) || 0), 0);

    const totalDjourou = depots
      .filter((op) => op.volet === "djourou")
      .reduce((sum, op) => sum + (Number(op.montant) || 0), 0);

    // 4. Nombre d'opérations en attente dans l'outbox
    const pendingOutbox = await db.outbox.count();

    // 5. Total de membres dans le portefeuille local
    const totalMembres = await db.membres.count();

    // 6. Les 4 dernières opérations du jour pour l'historique direct
    const dernieresOps = [...ops]
      .sort((a, b) => b.cree_le.localeCompare(a.cree_le))
      .slice(0, 4);

    return {
      agentNom: agent?.nom || "Agent de terrain",
      agentIdentifiant: agent?.identifiant || currentId || "AGT",
      totalCollecte,
      membresServis,
      totalMembres,
      pendingOutbox,
      totalOpsAujourdhui: depots.length,
      repartition: {
        mara: totalMara,
        pari: totalPari,
        djourou: totalDjourou,
      },
      dernieresOps,
    };
  }, []);

  const todayFormatted = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const total = data?.totalCollecte ?? 0;
  const membresServis = data?.membresServis ?? 0;
  const pendingCount = data?.pendingOutbox ?? 0;
  const repartition = data?.repartition ?? { mara: 0, pari: 0, djourou: 0 };

  return (
    <div className="space-y-4">
      {/* 1. Salutation et Date */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <p className="text-xs font-semibold capitalize text-primary-700">
            {todayFormatted}
          </p>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">
            Bonjour, {data?.agentNom ? data.agentNom.split(" ")[0] : "Agent"} 👋
          </h1>
        </div>
        <span className="inline-flex items-center rounded-full bg-primary-100 px-2.5 py-0.5 text-xs font-bold text-primary-800">
          {data?.agentIdentifiant || "AGT"}
        </span>
      </div>

      {/* 2. Boutons d'action rapide */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <Link
          href="/agent/depot"
          className="flex items-center justify-center gap-2 rounded-2xl bg-primary-700 py-3.5 px-4 font-bold text-white shadow-md shadow-primary-700/20 transition-transform active:scale-[0.98] hover:bg-primary-800"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-sm">
            ➕
          </span>
          <span className="text-sm">Nouveau dépôt</span>
        </Link>

        <Link
          href="/agent/membres"
          className="flex items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white py-3.5 px-4 font-bold text-gray-700 shadow-sm transition-transform active:scale-[0.98] hover:bg-gray-50 hover:text-gray-900"
        >
          <span className="text-base">🔍</span>
          <span className="text-sm">Rechercher membre</span>
        </Link>
      </div>

      {/* 3. Carte principale : Total collecté aujourd'hui */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-primary-950 p-5 text-white shadow-xl">
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary-200">
              Total collecté aujourd&apos;hui
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm">
              {data?.totalOpsAujourdhui ?? 0} opération{(data?.totalOpsAujourdhui ?? 0) > 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold tracking-tight text-white drop-shadow-sm sm:text-4xl">
              {formatMontant(total)}
            </span>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs">
            <div className="flex items-center gap-1.5 text-primary-200">
              <span>👥</span>
              <span>
                <strong className="text-white font-bold">{membresServis}</strong>{" "}
                membre{membresServis > 1 ? "s" : ""} servi{membresServis > 1 ? "s" : ""}
              </span>
            </div>

            <div className="text-primary-300">
              Portefeuille :{" "}
              <strong className="text-white">{data?.totalMembres ?? 0}</strong>
            </div>
          </div>
        </div>

        {/* Effet décoratif d'arrière-plan */}
        <div className="absolute -right-6 -bottom-6 h-32 w-32 rounded-full bg-primary-600/20 blur-2xl pointer-events-none" />
      </div>

      {/* 4. Carte d'état de synchronisation / Outbox */}
      <Link
        href="/agent/synchro"
        className={`flex items-center justify-between rounded-2xl p-4 transition-all shadow-sm active:scale-[0.99] border ${
          pendingCount > 0
            ? "border-amber-300 bg-amber-50 hover:bg-amber-100/70"
            : "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/60"
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${
              pendingCount > 0
                ? "bg-amber-200 text-amber-900"
                : "bg-emerald-200 text-emerald-900"
            }`}
          >
            {pendingCount > 0 ? "⏳" : "✓"}
          </div>
          <div>
            <p className="text-xs font-bold text-gray-900">
              {pendingCount > 0
                ? `${pendingCount} opération${pendingCount > 1 ? "s" : ""} en attente de synchro`
                : "Toutes les écritures sont synchronisées"}
            </p>
            <p className="text-xs text-gray-500">
              {pendingCount > 0
                ? "Toucher pour synchroniser maintenant"
                : "Serveur à jour avec vos encaissements"}
            </p>
          </div>
        </div>

        <span className="text-gray-400 text-lg">›</span>
      </Link>

      {/* 5. Répartition par volet (Ika-Mara, Ika-Pari, Ika-Djourou) */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
          Collecte du jour par volet
        </h2>

        <div className="grid grid-cols-3 gap-2">
          {/* Ika-Mara */}
          <div className="rounded-2xl border border-green-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-mara" />
              <span className="text-xs font-bold text-green-900 truncate">
                Ika-Mara
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">Épargne</p>
            <p className="mt-1 font-mono text-sm font-bold text-green-700 truncate">
              {formatMontant(repartition.mara)}
            </p>
          </div>

          {/* Ika-Pari */}
          <div className="rounded-2xl border border-amber-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-pari" />
              <span className="text-xs font-bold text-amber-900 truncate">
                Ika-Pari
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">Tontine</p>
            <p className="mt-1 font-mono text-sm font-bold text-amber-700 truncate">
              {formatMontant(repartition.pari)}
            </p>
          </div>

          {/* Ika-Djourou */}
          <div className="rounded-2xl border border-red-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-djourou" />
              <span className="text-xs font-bold text-red-900 truncate">
                Ika-Djourou
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">Crédit</p>
            <p className="mt-1 font-mono text-sm font-bold text-red-700 truncate">
              {formatMontant(repartition.djourou)}
            </p>
          </div>
        </div>
      </div>

      {/* 6. Aperçu des dernières écritures locales */}
      {data?.dernieresOps && data.dernieresOps.length > 0 && (
        <div className="pt-1 space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Derniers dépôts aujourd&apos;hui
            </h2>
            <Link
              href="/agent/journal"
              className="text-xs font-semibold text-primary-700 hover:underline"
            >
              Voir tout
            </Link>
          </div>

          <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {data.dernieresOps.map((op) => (
              <div
                key={op.id}
                className="flex items-center justify-between p-3 text-xs hover:bg-gray-50"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      op.volet === "mara"
                        ? "bg-mara"
                        : op.volet === "pari"
                        ? "bg-pari"
                        : "bg-djourou"
                    }`}
                  />
                  <div>
                    <span className="font-semibold text-gray-900 capitalize">
                      {op.volet}
                    </span>
                    <span className="text-gray-400 ml-1.5">
                      {op.jours_couverts > 1
                        ? `(${op.jours_couverts} j)`
                        : ""}
                    </span>
                  </div>
                </div>

                <div className="text-right font-mono font-bold text-gray-900">
                  +{formatMontant(op.montant)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
