"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { formatMontant, formatDateTime, libelleVolet } from "@/lib/utils/format";

/**
 * Reçu : /agent/recu?id=<uuid>
 * Page statique (identifiant lu dans l'adresse côté navigateur) : elle est
 * gardée sur le téléphone et s'ouvre hors connexion pour n'importe quel reçu.
 */
export default function RecuPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        </div>
      }
    >
      <RecuContenu />
    </Suspense>
  );
}

function RecuContenu() {
  const id = useSearchParams().get("id") ?? "";

  // Charger l'opération, le membre, le statut d'outbox et calculer le numéro de reçu local
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const op = await db.operations.get(id);
    if (!op) return null;

    const membre = await db.membres.get(op.membre_id);
    const outboxEntry = await db.outbox.where("clientId").equals(id).first();
    const solde = await db.soldes
      .where("[membre_id+volet]")
      .equals([op.membre_id, op.volet])
      .first();

    // Récupérer l'identifiant agent pour le préfixe du numéro de reçu
    const currentId =
      typeof window !== "undefined"
        ? localStorage.getItem("ika_current_agent")
        : null;
    const agent = currentId
      ? await db.agentAuth.get(currentId.toUpperCase())
      : null;

    // Calculer le compteur local pour ce reçu (rang de l'opération parmi celles de l'agent)
    const agentOps = await db.operations
      .where("agent_id")
      .equals(op.agent_id)
      .sortBy("cree_le");

    const index = agentOps.findIndex((o) => o.id === op.id);
    const sequence = index >= 0 ? index + 1 : 1;
    const prefixe = agent?.identifiant || "AGT";
    const numeroRecu = `${prefixe}-${String(sequence).padStart(4, "0")}`;

    return {
      operation: op,
      membre,
      agentNom: agent?.nom || "Agent de terrain",
      agentIdentifiant: prefixe,
      numeroRecu,
      isPending: !!outboxEntry,
      outboxStatus: outboxEntry?.status || "synced",
      soldeActuel: solde?.solde ?? op.montant,
    };
  }, [id]);

  // Préparer le texte formatté pour le partage WhatsApp
  const shareText = useMemo(() => {
    if (!data || !data.membre) return "";
    const { operation, membre, numeroRecu, soldeActuel, agentIdentifiant } = data;

    const dateFormatted = new Date(operation.cree_le).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return `🧾 *REÇU DE COTISATION IKA-MARA*
---------------------------------------
*N° Reçu* : ${numeroRecu}
*Date* : ${dateFormatted}
*Adhérent* : ${membre.prenom} ${membre.nom} (N° ${membre.numero})
*Quartier* : ${membre.quartier || "Bamako"}
*Volet* : ${libelleVolet(operation.volet)}
*Montant versé* : ${formatMontant(operation.montant)} ${
      operation.jours_couverts > 1 ? `(${operation.jours_couverts} jours)` : ""
    }
*Solde estimé après versement* : ${formatMontant(soldeActuel)}
*Agent collecteur* : ${agentIdentifiant}
---------------------------------------
_Plateforme de collecte IKA-MARA Mali_
_Merci pour votre ponctualité !_`;
  }, [data]);

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
        <p className="font-bold text-sm">Reçu introuvable</p>
        <p className="mt-1 text-gray-600">
          Cette opération n&apos;existe pas ou a été purgée.
        </p>
        <Link
          href="/agent"
          className="mt-4 inline-block rounded-xl bg-primary-700 px-4 py-2 font-bold text-white shadow-sm"
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    );
  }

  const { operation, membre, numeroRecu, isPending, soldeActuel, agentNom } =
    data;

  // Partager via WhatsApp ou Web Share API
  async function handleShareWhatsApp() {
    if (!shareText) return;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `Reçu IKA-MARA - ${numeroRecu}`,
          text: shareText,
        });
        return;
      } catch {
        // Fallback vers WhatsApp si partage système annulé ou non supporté
      }
    }

    // Fallback direct WhatsApp (wa.me)
    let url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    if (membre?.telephone) {
      const cleanTel = membre.telephone.replace(/\D/g, "");
      if (cleanTel.length >= 8) {
        url = `https://wa.me/${cleanTel}?text=${encodeURIComponent(shareText)}`;
      }
    }

    if (typeof window !== "undefined") {
      window.open(url, "_blank");
    }
  }

  // Impression ticket de caisse 58 mm
  function handlePrint() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  return (
    <div className="space-y-4">
      {/* Styles d'impression thermique 58 mm */}
      <style jsx global>{`
        @media print {
          /* Masquer tout sauf le ticket */
          body * {
            visibility: hidden;
          }
          #ticket-recu-58mm,
          #ticket-recu-58mm * {
            visibility: visible;
          }
          #ticket-recu-58mm {
            position: absolute;
            left: 0;
            top: 0;
            width: 58mm !important;
            max-width: 58mm !important;
            margin: 0 !important;
            padding: 3mm !important;
            font-size: 10px !important;
            line-height: 1.25 !important;
            color: #000 !important;
            background: #fff !important;
            box-shadow: none !important;
            border: none !important;
          }
          nav,
          header,
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Barre d'action supérieure */}
      <div className="flex items-center justify-between pt-1 no-print">
        <div className="flex items-center gap-2">
          <Link
            href="/agent"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 text-gray-700 shadow-sm active:scale-95"
          >
            ✕
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Reçu de dépôt</h1>
        </div>

        {/* Bouton Partager WhatsApp */}
        <button
          onClick={() => void handleShareWhatsApp()}
          className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition-all"
        >
          <span>💬</span>
          <span>Partager WhatsApp</span>
        </button>
      </div>

      {/* TICKET DE CAISSE (Adapté écran mobile et thermique 58 mm) */}
      <div
        id="ticket-recu-58mm"
        className="rounded-3xl border border-gray-200 bg-white p-5 shadow-xl relative overflow-hidden"
      >
        {/* En-tête ticket */}
        <div className="text-center pb-3 border-b border-dashed border-gray-300">
          <h2 className="text-base font-bold tracking-wider text-gray-950 uppercase">
            IKA-MARA MALI
          </h2>
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest">
            Collecte · Épargne · Tontine · Crédit
          </p>

          <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs font-mono font-bold text-gray-800">
            <span>REÇU N°</span>
            <span>{numeroRecu}</span>
          </div>

          <p className="mt-1 text-xs text-gray-600">
            {formatDateTime(operation.cree_le)}
          </p>
        </div>

        {/* Montant principal */}
        <div className="my-4 text-center py-2 bg-slate-50/80 rounded-2xl border border-slate-100">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Montant Encaissé
          </p>
          <p className="mt-0.5 font-mono text-3xl font-bold text-primary-950">
            {formatMontant(operation.montant)}
          </p>

          {operation.jours_couverts > 1 && (
            <p className="mt-1 text-xs font-bold text-primary-700">
              Cotisation pour {operation.jours_couverts} jours
            </p>
          )}
        </div>

        {/* Détails du membre et de la souscription */}
        <div className="space-y-2 text-xs border-b border-dashed border-gray-300 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Numéro Adhérent :</span>
            <span className="font-mono font-bold text-gray-900">
              {membre?.numero}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-gray-500">Membre :</span>
            <span className="font-bold text-gray-900 text-right">
              {membre?.prenom} {membre?.nom}
            </span>
          </div>

          {membre?.quartier && (
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Quartier :</span>
              <span className="font-medium text-gray-800">
                {membre.quartier}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-gray-500">Volet :</span>
            <span className="font-bold capitalize text-primary-900">
              {libelleVolet(operation.volet)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-gray-500">Agent collecteur :</span>
            <span className="font-medium text-gray-800">{agentNom}</span>
          </div>
        </div>

        {/* Mention du solde du volet après dépôt */}
        <div className="py-3 border-b border-dashed border-gray-300 bg-emerald-50/50 -mx-5 px-5 my-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-emerald-950">
              Solde {operation.volet} après versement :
            </span>
            <span className="font-mono text-sm font-bold text-emerald-700">
              {formatMontant(soldeActuel)}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 text-right">
            (Solde calculé localement sur cet appareil)
          </p>
        </div>

        {/* Statut de synchronisation en direct */}
        <div className="pt-3 pb-1 text-center">
          {isPending ? (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span>En attente de synchronisation (hors ligne)</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 border border-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>Synchronisé avec le serveur central</span>
            </div>
          )}
        </div>

        {/* Message réglementaire d'annulation */}
        <div className="mt-3 rounded-xl bg-gray-50 p-2.5 text-xs text-gray-500 text-center leading-tight">
          🔒 <strong className="text-gray-700">Sécurité financière :</strong>{" "}
          Pour corriger une opération, contactez l&apos;administrateur. Aucune
          suppression directe (annulation par écriture inverse).
        </div>
      </div>

      {/* Boutons d'action rapides */}
      <div className="space-y-2 pt-1 no-print">
        {/* Bouton Imprimer (feuille de style 58 mm) */}
        <button
          type="button"
          onClick={handlePrint}
          className="w-full flex items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white py-3 px-4 font-bold text-gray-800 shadow-sm active:scale-95 hover:bg-gray-50 text-sm"
        >
          <span>🖨️</span>
          <span>Imprimer ticket (58 mm)</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          {/* Nouveau dépôt (revient à /agent/depot formulaire vierge) */}
          <Link
            href="/agent/depot"
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-primary-700 py-3.5 px-4 font-bold text-white shadow-md active:scale-95 hover:bg-primary-800 text-sm"
          >
            <span>➕</span>
            <span>Nouveau dépôt</span>
          </Link>

          {/* Retour Accueil */}
          <Link
            href="/agent"
            className="flex items-center justify-center rounded-2xl border border-gray-300 bg-white py-3.5 px-4 font-bold text-gray-700 shadow-sm active:scale-95 hover:bg-gray-50 text-sm"
          >
            Accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
