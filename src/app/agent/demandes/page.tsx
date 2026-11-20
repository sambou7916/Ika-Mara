"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import { addToOutbox } from "@/lib/db/outbox";
import { onOutboxChange } from "@/lib/sync/engine";
import { formatMontant, parseMontant } from "@/lib/utils/format";
import type { Operation, VoletType } from "@/lib/types";

type OngletDemande = "retrait" | "credit";

function DemandesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Onglet sélectionné : Retrait ou Crédit
  const [onglet, setOnglet] = useState<OngletDemande>("retrait");

  // Champs communs
  const [numero, setNumero] = useState<string>("");
  const [montant, setMontant] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Champs spécifiques Retrait
  const [motifRetrait, setMotifRetrait] = useState<string>("");

  // Champs spécifiques Crédit
  const [dureeMoisPuce, setDureeMoisPuce] = useState<number | "autre">(3);
  const [dureeAutre, setDureeAutre] = useState<string>("");
  const [objetCredit, setObjetCredit] = useState<string>("");
  const [cautionNom, setCautionNom] = useState<string>("");
  const [cautionTelephone, setCautionTelephone] = useState<string>("");

  // Pré-remplissage via URL (ex: ?membre=0042 ou ?type=credit)
  useEffect(() => {
    const paramMembre = searchParams.get("membre") || searchParams.get("numero");
    if (paramMembre && paramMembre.length === 4) {
      setNumero(paramMembre);
    }

    const paramType = searchParams.get("type");
    if (paramType === "credit") {
      setOnglet("credit");
    } else if (paramType === "retrait") {
      setOnglet("retrait");
    }
  }, [searchParams]);

  // Recherche du membre dans Dexie dès que 4 chiffres sont saisis
  const membre = useLiveQuery(async () => {
    if (numero.trim().length !== 4) return null;
    return (await db.membres.where("numero").equals(numero.trim()).first()) ?? null;
  }, [numero]);

  // Souscriptions du membre
  const souscriptions = useLiveQuery(async () => {
    if (!membre) return [];
    return db.souscriptions.where("membre_id").equals(membre.id).toArray();
  }, [membre]);

  // Calcul du solde local d'épargne Ika-Mara disponible (Serveur + Outbox non synchronisée)
  const soldeMaraDisponible = useLiveQuery(async () => {
    if (!membre) return 0;

    const soldeServeur = (await db.soldes.where("[membre_id+volet]").equals([membre.id, "mara"]).first())?.solde ?? 0;

    // Opérations en attente pour le membre
    const outbox = await db.outbox.toArray();
    const pendingIds = new Set(outbox.map((e) => e.clientId));
    const ops = await db.operations.where("membre_id").equals(membre.id).toArray();

    let deltaLocal = 0;
    for (const op of ops) {
      if (pendingIds.has(op.id) && op.volet === "mara") {
        if (op.type === "depot") deltaLocal += op.montant;
        else if (op.type === "retrait" || op.type === "demande_retrait") deltaLocal -= op.montant;
      }
    }

    return Math.max(0, soldeServeur + deltaLocal);
  }, [membre]);

  // Vérifier si le membre a déjà un crédit ouvert ou une demande de crédit en attente
  const verifCreditExistant = useLiveQuery(async () => {
    if (!membre) return { aUnCreditActif: false, aUneDemandeEnAttente: false };

    // 1. Vérifier si les crédits multiples sont interdits dans les paramètres
    const paramMultiples = await db.parametres.get("interdire_credits_multiples");
    const interdireMultiples = paramMultiples ? paramMultiples.valeur !== false : true;

    if (!interdireMultiples) {
      return { aUnCreditActif: false, aUneDemandeEnAttente: false };
    }

    // 2. Vérifier solde crédit restant dû
    const soldeDjourou = (await db.soldes.where("[membre_id+volet]").equals([membre.id, "djourou"]).first())?.solde ?? 0;
    const aUnCreditActif = soldeDjourou > 0;

    // 3. Vérifier demande de crédit en attente
    const ops = await db.operations.where("membre_id").equals(membre.id).toArray();
    const aUneDemandeEnAttente = ops.some(
      (op) => op.type === "demande_credit" && op.statut === "en_attente"
    );

    return {
      aUnCreditActif,
      aUneDemandeEnAttente,
    };
  }, [membre]);

  // Durée finale en mois pour le crédit
  const dureeMoisFinale = useMemo(() => {
    if (dureeMoisPuce === "autre") {
      const parsed = parseInt(dureeAutre, 10);
      return isNaN(parsed) || parsed <= 0 ? 1 : parsed;
    }
    return dureeMoisPuce;
  }, [dureeMoisPuce, dureeAutre]);

  // Soumission du formulaire
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);

    if (!membre) {
      setErreur("Veuillez saisir un numéro d'adhérent valide (4 chiffres)");
      return;
    }

    if (membre.statut !== "actif") {
      setErreur("Ce membre est inactif. Aucune demande ne peut être soumise.");
      return;
    }

    if (!montant || montant <= 0) {
      setErreur("Le montant demandé doit être supérieur à zéro");
      return;
    }

    // =========================================================================
    // VALIDATIONS ONGLET RETRAIT
    // =========================================================================
    if (onglet === "retrait") {
      const hasSouscriptionMara = souscriptions?.some(
        (s) => s.volet === "mara" && s.statut === "active"
      );
      if (!hasSouscriptionMara) {
        setErreur("Cet adhérent n'a pas de souscription active au volet Épargne (Ika-Mara).");
        return;
      }

      const dispo = soldeMaraDisponible ?? 0;
      if (montant > dispo) {
        setErreur(
          `Le montant demandé (${formatMontant(
            montant
          )}) dépasse le solde d'épargne disponible (${formatMontant(dispo)}).`
        );
        return;
      }
    }

    // =========================================================================
    // VALIDATIONS ONGLET CRÉDIT
    // =========================================================================
    if (onglet === "credit") {
      if (verifCreditExistant?.aUnCreditActif) {
        setErreur(
          "Cet adhérent a déjà un crédit en cours de remboursement. Les crédits multiples sont interdits."
        );
        return;
      }

      if (verifCreditExistant?.aUneDemandeEnAttente) {
        setErreur(
          "Une demande de crédit est déjà en attente de décision pour cet adhérent."
        );
        return;
      }

      if (!objetCredit.trim()) {
        setErreur("L'objet ou motif du crédit est obligatoire.");
        return;
      }

      if (!cautionNom.trim() || !cautionTelephone.trim()) {
        setErreur("Les coordonnées complètes de la caution (Nom et Téléphone) sont obligatoires.");
        return;
      }
    }

    setLoading(true);

    try {
      const currentId =
        typeof window !== "undefined"
          ? localStorage.getItem("ika_current_agent")
          : null;
      const agent = currentId
        ? await db.agentAuth.get(currentId.toUpperCase())
        : null;
      const agentId = agent?.agentId || "00000000-0000-0000-0000-000000000000";

      const operationId = crypto.randomUUID();

      let motifComplet = "";
      let typeOp: "demande_retrait" | "demande_credit";
      let voletOp: VoletType;

      if (onglet === "retrait") {
        typeOp = "demande_retrait";
        voletOp = "mara";
        motifComplet = motifRetrait.trim()
          ? `Demande retrait : ${motifRetrait.trim()}`
          : "Demande de retrait épargne";
      } else {
        typeOp = "demande_credit";
        voletOp = "djourou";
        motifComplet = `Crédit ${dureeMoisFinale} mois : ${objetCredit.trim()} | Caution : ${cautionNom.trim()} (${cautionTelephone.trim()})`;
      }

      // Construction de l'opération
      // RÈGLE : Le crédit n'est JAMAIS accordé côté agent : le statut reste "en_attente" jusqu'à décision admin
      const nouvelleDemande: Operation = {
        id: operationId,
        type: typeOp,
        volet: voletOp,
        membre_id: membre.id,
        agent_id: agentId,
        montant: Math.round(montant),
        jours_couverts: 1,
        date_operation: new Date().toISOString().split("T")[0],
        cree_le: new Date().toISOString(),
        annule_ref: null,
        statut: "en_attente", // En attente de validation par l'administrateur
        motif: motifComplet,
      };

      // Écriture locale immédiate dans Dexie & Outbox
      await addToOutbox(
        "operations",
        nouvelleDemande as unknown as Record<string, unknown>,
        operationId
      );

      // Déclencher la synchronisation en tâche de fond si le réseau est disponible
      void onOutboxChange();

      // Redirection vers la fiche membre avec message de confirmation
      router.push(
        `/agent/membres/${membre.numero}?toast=demande_enregistree&type=${typeOp}&montant=${montant}`
      );
    } catch (err) {
      console.error("[Demandes] Erreur :", err);
      setErreur(
        err instanceof Error ? err.message : "Erreur lors de l'enregistrement de la demande"
      );
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Link
            href={numero ? `/agent/membres/${numero}` : "/agent"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-gray-200 text-gray-700 shadow-sm active:scale-95"
          >
            ‹
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Demandes de fonds</h1>
        </div>

        <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
          Hors-ligne garanti
        </span>
      </div>

      {/* Sélecteur des deux onglets : Retrait vs Crédit */}
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-gray-200/80 p-1">
        <button
          type="button"
          onClick={() => {
            setOnglet("retrait");
            setErreur(null);
          }}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all ${
            onglet === "retrait"
              ? "bg-white text-emerald-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <span>💸</span>
          <span>Retrait (Ika-Mara)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setOnglet("credit");
            setErreur(null);
          }}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all ${
            onglet === "credit"
              ? "bg-white text-red-900 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <span>📋</span>
          <span>Crédit (Ika-Djourou)</span>
        </button>
      </div>

      {/* Message d'erreur */}
      {erreur && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs font-medium text-red-800">
          ⚠️ {erreur}
        </div>
      )}

      {/* Formulaire */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 1. Sélection de l'adhérent */}
        <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm space-y-2">
          <label
            htmlFor="numero"
            className="block text-xs font-bold uppercase tracking-wider text-gray-600"
          >
            Numéro d&apos;adhérent (4 chiffres)
          </label>

          <input
            id="numero"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={numero}
            onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))}
            placeholder="0042"
            autoFocus={!numero}
            className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-4 py-3 text-center font-mono text-2xl font-bold text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          />

          {/* Fiche récapitulative du membre trouvé */}
          {numero.length === 4 && (
            <div className="pt-2 border-t border-gray-100">
              {membre ? (
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-gray-900">
                      {membre.prenom} {membre.nom}
                    </p>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
                        membre.statut === "actif"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {membre.statut === "actif" ? "Actif" : "Inactif"}
                    </span>
                  </div>

                  <p className="text-gray-500 text-xs">
                    {membre.profession || "Profession non précisée"} ·{" "}
                    {membre.quartier || "Quartier non précisé"}
                  </p>

                  {/* Solde d'épargne disponible si onglet retrait */}
                  {onglet === "retrait" && (
                    <div className="mt-2 rounded-xl bg-emerald-50 p-2.5 flex items-center justify-between text-emerald-950 font-medium">
                      <span>Épargne disponible (Ika-Mara) :</span>
                      <span className="font-mono font-bold text-emerald-700 text-sm">
                        {formatMontant(soldeMaraDisponible ?? 0)}
                      </span>
                    </div>
                  )}

                  {/* Avertissement si crédit déjà en cours si onglet crédit */}
                  {onglet === "credit" &&
                    (verifCreditExistant?.aUnCreditActif ||
                      verifCreditExistant?.aUneDemandeEnAttente) && (
                      <div className="mt-2 rounded-xl bg-amber-50 p-2.5 text-amber-900 border border-amber-200">
                        ⚠️{" "}
                        {verifCreditExistant.aUnCreditActif
                          ? "Cet adhérent a déjà un crédit ouvert. Les crédits multiples sont interdits."
                          : "Une demande de crédit est déjà en cours d'étude."}
                      </div>
                    )}
                </div>
              ) : (
                <p className="text-xs text-red-600 text-center py-1">
                  Adhérent introuvable avec le numéro « {numero} »
                </p>
              )}
            </div>
          )}
        </div>

        {/* 2. Champs spécifiques selon l'onglet */}
        {membre && membre.statut === "actif" && (
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
            {/* Montant demandé */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="montant"
                  className="block text-xs font-bold uppercase tracking-wider text-gray-600"
                >
                  Montant demandé (F CFA)
                </label>
                {onglet === "retrait" && soldeMaraDisponible !== undefined && (
                  <button
                    type="button"
                    onClick={() => setMontant(soldeMaraDisponible)}
                    className="text-xs font-bold text-emerald-700 hover:underline"
                  >
                    Retirer la totalité ({formatMontant(soldeMaraDisponible)})
                  </button>
                )}
              </div>

              <div className="relative">
                <input
                  id="montant"
                  type="text"
                  inputMode="numeric"
                  value={montant ? montant.toLocaleString("fr-FR") : ""}
                  onChange={(e) => setMontant(parseMontant(e.target.value))}
                  placeholder="10 000"
                  className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-4 py-3.5 text-right font-mono text-2xl font-bold text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                />
                <span className="absolute left-4 top-4 text-sm font-bold text-gray-400">
                  F CFA
                </span>
              </div>
            </div>

            {/* SPÉCIFIQUE ONGLET RETRAIT : Motif facultatif */}
            {onglet === "retrait" && (
              <div>
                <label
                  htmlFor="motifRetrait"
                  className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1"
                >
                  Motif du retrait (facultatif)
                </label>
                <input
                  id="motifRetrait"
                  type="text"
                  value={motifRetrait}
                  onChange={(e) => setMotifRetrait(e.target.value)}
                  placeholder="Ex : Urgence familiale, achat fournitures…"
                  className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-3.5 py-3 text-xs font-medium text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none"
                />
              </div>
            )}

            {/* SPÉCIFIQUE ONGLET CRÉDIT : Durée, Objet, Garantie/Caution */}
            {onglet === "credit" && (
              <>
                {/* Durée en puces : 3 mois, 6 mois, 12 mois + Autre */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1.5">
                    Durée de remboursement
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[3, 6, 12].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDureeMoisPuce(m)}
                        className={`rounded-xl py-2.5 text-xs font-bold border transition-all ${
                          dureeMoisPuce === m
                            ? "bg-red-50 border-red-600 text-red-900 ring-2 ring-red-500/20"
                            : "border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                        }`}
                      >
                        {m} mois
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => setDureeMoisPuce("autre")}
                      className={`rounded-xl py-2.5 text-xs font-bold border transition-all ${
                        dureeMoisPuce === "autre"
                          ? "bg-red-50 border-red-600 text-red-900 ring-2 ring-red-500/20"
                          : "border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                      }`}
                    >
                      Autre
                    </button>
                  </div>

                  {dureeMoisPuce === "autre" && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="36"
                        value={dureeAutre}
                        onChange={(e) => setDureeAutre(e.target.value)}
                        placeholder="Ex : 9"
                        className="w-24 rounded-xl border border-gray-300 px-3 py-2 text-center text-sm font-bold"
                      />
                      <span className="text-xs text-gray-600 font-medium">
                        mois
                      </span>
                    </div>
                  )}
                </div>

                {/* Objet du crédit */}
                <div>
                  <label
                    htmlFor="objetCredit"
                    className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-1"
                  >
                    Objet du crédit (obligatoire)
                  </label>
                  <input
                    id="objetCredit"
                    type="text"
                    value={objetCredit}
                    onChange={(e) => setObjetCredit(e.target.value)}
                    placeholder="Ex : Achat stock marchandises, semences, petit équipement…"
                    className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-3.5 py-3 text-xs font-medium text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none"
                  />
                </div>

                {/* Garantie / Caution : Nom + Téléphone */}
                <div className="border-t border-gray-100 pt-3 space-y-3">
                  <span className="block text-xs font-bold uppercase tracking-wider text-gray-600">
                    Garantie / Caution
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor="cautionNom"
                        className="block text-xs text-gray-500 mb-0.5"
                      >
                        Nom complet de la caution
                      </label>
                      <input
                        id="cautionNom"
                        type="text"
                        value={cautionNom}
                        onChange={(e) => setCautionNom(e.target.value)}
                        placeholder="Nom et prénom"
                        className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-3 py-2.5 text-xs font-medium text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="cautionTelephone"
                        className="block text-xs text-gray-500 mb-0.5"
                      >
                        Téléphone de la caution
                      </label>
                      <input
                        id="cautionTelephone"
                        type="tel"
                        value={cautionTelephone}
                        onChange={(e) => setCautionTelephone(e.target.value)}
                        placeholder="+223 70 00 00 00"
                        className="w-full rounded-xl border border-gray-300 bg-gray-50/50 px-3 py-2.5 text-xs font-medium text-gray-900 focus:border-primary-600 focus:bg-white focus:outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Règle d'octroi : pas d'accord par l'agent */}
                <div className="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900 leading-tight border border-amber-200">
                  🔒 <strong className="font-bold">Décision réservée à l&apos;administrateur :</strong>{" "}
                  Le crédit n&apos;est jamais accordé par l&apos;agent. La demande reste soumise avec le statut « En attente » jusqu&apos;à validation par la direction.
                </div>
              </>
            )}

            {/* Bouton de soumission */}
            <button
              type="submit"
              disabled={
                loading ||
                !montant ||
                montant <= 0 ||
                (onglet === "credit" &&
                  (verifCreditExistant?.aUnCreditActif ||
                    verifCreditExistant?.aUneDemandeEnAttente ||
                    !objetCredit.trim() ||
                    !cautionNom.trim() ||
                    !cautionTelephone.trim()))
              }
              className={`w-full flex items-center justify-center gap-2 rounded-2xl py-4 px-4 font-bold text-white shadow-md active:scale-95 transition-all text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                onglet === "retrait"
                  ? "bg-emerald-700 hover:bg-emerald-800 shadow-emerald-700/20"
                  : "bg-red-700 hover:bg-red-800 shadow-red-700/20"
              }`}
            >
              {loading ? (
                <span>Enregistrement de la demande…</span>
              ) : (
                <span>
                  Soumettre la demande de{" "}
                  {onglet === "retrait" ? "retrait" : "crédit"} ·{" "}
                  {formatMontant(montant)}
                </span>
              )}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

export default function DemandesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center p-6 text-gray-500">
          <p className="text-sm font-semibold">Chargement des demandes…</p>
        </div>
      }
    >
      <DemandesContent />
    </Suspense>
  );
}
