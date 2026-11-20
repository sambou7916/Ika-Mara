"use client";

import Link from "next/link";

/**
 * /agent/aide — Page d'aide et documentation statique de l'application agent.
 */
export default function AgentAidePage() {
  return (
    <div className="space-y-5 pb-8">
      {/* En-tête */}
      <div className="flex items-center gap-2 pt-1">
        <Link
          href="/agent/plus"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm active:scale-95"
          aria-label="Retour au menu Plus"
        >
          ‹
        </Link>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Aide & Guide Agent</h1>
          <p className="text-xs text-gray-500">Guide pratique de collecte sur le terrain</p>
        </div>
      </div>

      {/* Règle fondamentale : Pas de suppression */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div className="space-y-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900">
              Règle d'or : Aucune suppression financière
            </h2>
            <p className="text-xs leading-relaxed text-amber-800">
              Une fois un versement validé, il ne peut <strong>jamais être modifié ni supprimé</strong> par
              l'agent. En cas d'erreur sur un montant ou un membre, contactez l'administrateur
              qui passera une <strong>écriture d'annulation</strong> avec motif.
            </p>
          </div>
        </div>
      </div>

      {/* Les trois volets */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-gray-900">1. Les trois volets IKA-MARA</h2>
        <div className="space-y-3 text-xs text-gray-600">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="font-bold text-mara">💰 Ika-Mara (Épargne journalière)</p>
            <p className="mt-1">
              Dépôts quotidiens libres ou fixés par la souscription. Le membre peut demander un
              retrait à tout moment, dans la limite de son solde net disponible.
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <p className="font-bold text-pari">🔄 Ika-Pari (Tontine à parts fixes)</p>
            <p className="mt-1">
              Cotisations régulières pour des cycles tontiniers prédéterminés. Chaque membre cotise
              sa part quotidienne pour alimenter la cagnotte du cycle.
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <p className="font-bold text-djourou">📋 Ika-Djourou (Crédit & Remboursements)</p>
            <p className="mt-1">
              Remboursement des échéances de crédit accordé par la direction. Le montant collecté
              diminue la dette restante du membre.
            </p>
          </div>
        </div>
      </section>

      {/* Mode Hors-ligne */}
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-gray-900">2. Fonctionnement Hors-Ligne</h2>
        <p className="text-xs leading-relaxed text-gray-600">
          L'application IKA-MARA fonctionne <strong>sans connexion internet</strong>. Lorsque vous encaissez un
          dépôt en zone blanche :
        </p>
        <ul className="list-disc space-y-1 pl-4 text-xs text-gray-600">
          <li>L'opération est immédiatement enregistrée dans la mémoire de votre téléphone (file d'attente Outbox).</li>
          <li>Le reçu peut être généré et imprimé ou partagé immédiatement.</li>
          <li>Le solde local du membre est recalculé instantanément.</li>
          <li>Dès que vous retrouvez le réseau, les opérations sont transmises automatiquement au serveur.</li>
          <li><strong>Aucune opération en attente n'est perdue</strong>, même si vous éteignez votre téléphone.</li>
        </ul>
      </section>

      {/* Guide des démarches */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-gray-900">3. Démarches de terrain</h2>

        <div className="space-y-2 text-xs text-gray-600">
          <div>
            <h3 className="font-bold text-gray-800">Encaissement d'un dépôt (/agent/depot)</h3>
            <p>
              Saisissez les 4 chiffres du numéro d'adhérent. Le système affiche le nom, les arriérés
              et propose le montant habituel. Vous pouvez couvrir plusieurs jours en une seule saisie.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-2">
            <h3 className="font-bold text-gray-800">Demandes de retrait ou crédit (/agent/demandes)</h3>
            <p>
              Toute demande saisie par l'agent a le statut « En attente ». L'agent ne valide jamais
              lui-même un retrait ou un crédit : la validation finale est faite par l'administrateur.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-2">
            <h3 className="font-bold text-gray-800">Remise de collecte (/agent/journal)</h3>
            <p>
              En fin de journée, vérifiez le total attendu et remettez les espèces au caissier ou
              administrateur. Si le montant remis diffère de l'attendu, un motif est obligatoire.
            </p>
          </div>
        </div>
      </section>

      {/* Assistance & Contacts */}
      <section className="rounded-2xl border border-primary-200 bg-primary-50/50 p-4 shadow-sm">
        <h2 className="text-sm font-bold text-primary-900">Besoin d'assistance ?</h2>
        <p className="mt-1 text-xs text-primary-800">
          Pour toute anomalie de solde, compte bloqué ou demande d'annulation d'opération :
        </p>
        <div className="mt-3 space-y-1.5 text-xs text-gray-700">
          <p>
            📞 <strong>Permanence Siège :</strong> +223 70 00 00 00
          </p>
          <p>
            🏢 <strong>Direction des Opérations :</strong> Bamako, Mali
          </p>
          <p>
            ⏰ <strong>Horaires support :</strong> Du Lundi au Samedi de 07h30 à 18h30
          </p>
        </div>
      </section>

      {/* Version */}
      <div className="pt-2 text-center text-xs text-gray-400">
        <p>IKA-MARA Mobile Agent — Version 1.0.0 (PWA)</p>
      </div>
    </div>
  );
}
