"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pinToPassword } from "@/lib/utils/pin";
import {
  getLocalAuth,
  saveLocalAuth,
  recordFailedAttempt,
  resetFailedAttempts,
  loadPortfolio,
  purgeAgentData,
  clearLocalData,
} from "@/lib/db/dexie";
import { hashPin, verifyPin } from "@/lib/utils/crypto";
import { ENTETE_APPAREIL, getAppareilId } from "@/lib/utils/appareil";
import {
  identifiantToEmail,
  validateIdentifiant,
  validatePin,
} from "@/lib/utils/pin";
import Icon from "@/components/ui/Icon";
import { LoginShell, PillField, PillButton, PinOublie } from "@/components/auth/LoginShell";

function AgentConnexionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [identifiant, setIdentifiant] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [hasLocalData, setHasLocalData] = useState<boolean>(false);

  // Détecter l'état réseau
  useEffect(() => {
    setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Détecter si un motif de suspension a été passé dans l'URL
  useEffect(() => {
    const motif = searchParams.get("motif");
    if (motif === "suspendu") {
      setError(
        "Votre compte a été suspendu par l'administrateur. Les données locales ont été effacées pour des raisons de sécurité."
      );
    } else if (motif === "revoque") {
      setError(
        "Cet appareil a été révoqué par l'administrateur. Reconnectez-vous avec internet (avec le nouveau code PIN si l'administrateur vous en a donné un). Vos opérations en attente seront envoyées ensuite."
      );
    }
  }, [searchParams]);

  // Vérifier en temps réel si l'identifiant saisi possède un profil local
  useEffect(() => {
    let active = true;
    async function checkLocal() {
      if (identifiant.trim().length >= 3) {
        const local = await getLocalAuth(identifiant);
        if (active) {
          setHasLocalData(!!local);
        }
      } else {
        if (active) {
          setHasLocalData(false);
        }
      }
    }
    checkLocal();
    return () => {
      active = false;
    };
  }, [identifiant]);

  /**
   * Vérifie le PIN auprès du serveur (cas d'un PIN réinitialisé par l'admin).
   * Succès : met à jour le hash local, débloque le compte, recharge le
   * portefeuille et redirige → true. Échec : ne fait rien → false
   * (l'appelant compte alors l'échec localement).
   */
  async function verifierAupresDuServeur(normId: string): Promise<boolean> {
    try {
      setInfo("Vérification du code PIN auprès du serveur…");
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: identifiantToEmail(normId),
        password: pinToPassword(pin),
      });
      if (authError || !authData.user) return false;

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, role, nom, telephone, statut")
        .eq("id", authData.user.id)
        .single();

      if (!profile || profile.role !== "agent") {
        await supabase.auth.signOut();
        return false;
      }
      if (profile.statut === "suspendu") {
        await purgeAgentData();
        await supabase.auth.signOut();
        setError("Votre compte est suspendu. Veuillez contacter votre administrateur.");
        return true; // traité : ne pas compter d'échec
      }

      // Nouveau code PIN accepté : remplacer l'empreinte locale
      const { hash: pinHash, salt: pinSalt } = await hashPin(pin);
      await saveLocalAuth({
        identifiant: normId,
        agentId: profile.id,
        nom: profile.nom,
        telephone: profile.telephone,
        statut: profile.statut,
        pinHash,
        pinSalt,
        failedAttempts: 0,
        isBlocked: false,
        blockedAt: null,
        lastLoginAt: Date.now(),
      });

      // Portefeuille à jour (l'appareil a pu être révoqué lors de la réinitialisation)
      const token = authData.session?.access_token;
      const syncResponse = await fetch("/api/sync?enregistrer_appareil=1", {
        headers: { Authorization: `Bearer ${token}`, [ENTETE_APPAREIL]: getAppareilId() },
      });
      if (syncResponse.ok) {
        const syncData = await syncResponse.json();
        if (syncData.data) await loadPortfolio(syncData.data);
      }

      localStorage.setItem("ika_current_agent", normId);
      setInfo("Nouveau code PIN enregistré sur cet appareil. Redirection…");
      router.push("/agent");
      return true;
    } catch {
      return false;
    } finally {
      setInfo(null);
    }
  }

  async function handleConnexion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const normId = identifiant.trim().toUpperCase();

    // 1. Validations de format
    const idVal = validateIdentifiant(normId);
    if (!idVal.valid) {
      setError(idVal.error || "Identifiant invalide");
      return;
    }

    const pinVal = validatePin(pin);
    if (!pinVal.valid) {
      setError(pinVal.error || "Le code PIN doit comporter 6 chiffres");
      return;
    }

    setLoading(true);

    try {
      // 2. Vérifier si un compte existe déjà dans la base Dexie locale
      const localAuth = await getLocalAuth(normId);

      // =======================================================================
      // CAS 1 : PREMIÈRE CONNEXION (Aucune donnée locale)
      // =======================================================================
      if (!localAuth) {
        if (!navigator.onLine) {
          setError(
            "Connexion Internet requise pour votre première connexion sur cet appareil."
          );
          setLoading(false);
          return;
        }

        setInfo("Vérification auprès du serveur…");
        const supabase = createClient();
        const email = identifiantToEmail(normId);

        // Connexion Supabase
        const { data: authData, error: authError } =
          await supabase.auth.signInWithPassword({
            email,
            password: pinToPassword(pin),
          });

        if (authError || !authData.user) {
          if (authError?.message?.includes("Invalid login")) {
            setError("Identifiant ou code PIN incorrect");
          } else {
            setError(authError?.message || "Erreur de connexion au serveur");
          }
          setLoading(false);
          return;
        }

        // Vérifier le rôle et le statut
        const { data: profile, error: profError } = await supabase
          .from("profiles")
          .select("id, role, nom, telephone, statut")
          .eq("id", authData.user.id)
          .single();

        if (profError || !profile) {
          await supabase.auth.signOut();
          setError("Impossible de charger le profil agent.");
          setLoading(false);
          return;
        }

        if (profile.statut === "suspendu") {
          await supabase.auth.signOut();
          setError("Votre compte est suspendu. Veuillez contacter votre administrateur.");
          setLoading(false);
          return;
        }

        if (profile.role !== "agent") {
          await supabase.auth.signOut();
          setError("Accès réservé aux agents de collecte.");
          setLoading(false);
          return;
        }

        // Télécharger le portefeuille agent
        setInfo("Téléchargement de votre portefeuille (membres, souscriptions)…");
        const token = authData.session?.access_token;
        // Connexion en ligne avec PIN : cet appareil devient l'appareil lié
        const syncResponse = await fetch("/api/sync?enregistrer_appareil=1", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            [ENTETE_APPAREIL]: getAppareilId(),
          },
        });

        if (!syncResponse.ok) {
          const corps = (await syncResponse.json().catch(() => null)) as
            | { code?: string; error?: string }
            | null;
          // Seule une vraie suspension efface l'appareil (règle : l'outbox n'est
          // jamais vidée pour un autre motif).
          if (corps?.code === "AGENT_SUSPENDU") {
            await purgeAgentData();
            await supabase.auth.signOut();
            setError("Votre compte est suspendu. Veuillez contacter votre administrateur.");
            setLoading(false);
            return;
          }
          await supabase.auth.signOut();
          setError(
            `Téléchargement du portefeuille impossible (code ${syncResponse.status}${
              corps?.code ? ` · ${corps.code}` : ""
            }). ${corps?.error ?? "Réessayez dans un instant."}`
          );
          setLoading(false);
          return;
        }

        const syncData = await syncResponse.json();
        if (syncData.data) {
          await loadPortfolio(syncData.data);
        }

        // Calculer et stocker le hash PBKDF2 localement
        const { hash: pinHash, salt: pinSalt } = await hashPin(pin);

        await saveLocalAuth({
          identifiant: normId,
          agentId: profile.id,
          nom: profile.nom,
          telephone: profile.telephone,
          statut: profile.statut,
          pinHash,
          pinSalt,
          failedAttempts: 0,
          isBlocked: false,
          blockedAt: null,
          lastLoginAt: Date.now(),
        });

        // Enregistrer la session courante
        if (typeof window !== "undefined") {
          localStorage.setItem("ika_current_agent", normId);
        }

        setInfo("Connexion réussie. Redirection…");
        router.push("/agent");
        return;
      }

      // =======================================================================
      // CAS 2 : CONNEXIONS SUIVANTES (Vérification locale PBKDF2 sans réseau)
      // =======================================================================

      // A. Compte bloqué localement : seul le serveur peut débloquer
      //    (PIN réinitialisé par l'administrateur), et seulement en ligne.
      if (localAuth.isBlocked || (localAuth.failedAttempts || 0) >= 5) {
        if (navigator.onLine && (await verifierAupresDuServeur(normId))) return;
        setError(
          navigator.onLine
            ? "Compte bloqué après 5 tentatives infructueuses. Demandez à votre administrateur de réinitialiser votre code PIN."
            : "Compte bloqué après 5 tentatives infructueuses. Connectez-vous à internet avec le nouveau code PIN donné par votre administrateur."
        );
        setLoading(false);
        return;
      }

      // B. Vérifier le PIN avec le hash PBKDF2 local
      const isPinValid = await verifyPin(pin, localAuth.pinHash, localAuth.pinSalt);

      // PIN différent du code local : il a peut-être été réinitialisé par
      // l'administrateur. En ligne, le serveur fait foi.
      if (!isPinValid && navigator.onLine && (await verifierAupresDuServeur(normId))) {
        return;
      }

      if (!isPinValid) {
        const { isBlocked, attempts } = await recordFailedAttempt(normId);

        if (isBlocked) {
          setError(
            "Compte bloqué après 5 tentatives infructueuses. Contactez votre administrateur."
          );
        } else {
          const remaining = 5 - attempts;
          setError(
            `Code PIN incorrect. Il vous reste ${remaining} tentative${
              remaining > 1 ? "s" : ""
            } avant blocage.`
          );
        }
        setLoading(false);
        return;
      }

      // C. PIN correct -> Réinitialiser les tentatives échouées
      await resetFailedAttempts(normId);

      // Sauvegarder l'agent actif localement
      if (typeof window !== "undefined") {
        localStorage.setItem("ika_current_agent", normId);
      }

      // D. Rafraîchissement en arrière-plan si réseau disponible
      if (navigator.onLine) {
        void (async () => {
          try {
            const supabase = createClient();
            const email = identifiantToEmail(normId);
            const { data: bgAuth } = await supabase.auth.signInWithPassword({
              email,
              password: pinToPassword(pin),
            });

            if (bgAuth?.user) {
              // Vérifier si l'agent est suspendu
              const { data: prof } = await supabase
                .from("profiles")
                .select("statut")
                .eq("id", bgAuth.user.id)
                .single();

              if (prof?.statut === "suspendu") {
                console.warn("[Auth] Agent suspendu détecté lors de la vérification.");
                await purgeAgentData();
                await supabase.auth.signOut();
                if (typeof window !== "undefined") {
                  window.location.href = "/agent/connexion?motif=suspendu";
                }
              }
            }
          } catch (bgError) {
            console.warn("[Auth] Rafraîchissement réseau non bloquant :", bgError);
          }
        })();
      }

      // Redirection immédiate vers l'accueil agent
      router.push("/agent");
    } catch (err) {
      console.error("[Connexion] Erreur :", err);
      const brut = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      let message = "Une erreur inattendue est survenue.";
      if (/Failed to fetch|NetworkError|Load failed/i.test(brut)) {
        message = "Connexion internet interrompue. Vérifiez le réseau puis réessayez.";
      } else if (/QuotaExceeded/i.test(brut)) {
        message = "Mémoire du téléphone pleine : libérez de l'espace puis réessayez.";
      } else if (/IDB|IndexedDB|Dexie|DataError|InvalidState|UnknownError/i.test(brut)) {
        message =
          "Le stockage local du navigateur est indisponible. Utilisez Chrome ou Safari (pas une navigation privée, ni le navigateur intégré de WhatsApp/Facebook).";
      }
      setError(`${message} (détail : ${brut.slice(0, 160)})`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <LoginShell
      badge="Espace agent de terrain"
      titre="Bon retour parmi nous"
      sousTitre={
        <>
          Saisissez votre identifiant et votre
          <br />
          code PIN à 6 chiffres pour continuer
        </>
      }
      enHaut={
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur ${
            isOnline
              ? "border-green-200 bg-green-50/80 text-green-700"
              : "border-amber-200 bg-amber-50/80 text-amber-700"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-green-500" : "bg-amber-500"}`} />
          {isOnline ? "En ligne" : "Hors connexion"}
        </span>
      }
      pied={<span className="text-xs text-primary-200/50">Système sécurisé IKA-MARA · Bamako, Mali</span>}
    >
      {error && (
        <div role="alert" className="mb-4 flex gap-2.5 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-800">
          <Icon name="alert" className="mt-0.5 h-4 w-4 text-red-600" />
          <p className="flex-1 leading-relaxed">{error}</p>
        </div>
      )}

      {info && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
          <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
          <p className="flex-1 leading-relaxed">{info}</p>
        </div>
      )}

      <form onSubmit={handleConnexion} className="space-y-4">
        <PillField
          id="identifiant"
          label="Identifiant agent"
          icon="user"
          autoCapitalize="characters"
          autoComplete="username"
          spellCheck={false}
          value={identifiant}
          onChange={(e) => setIdentifiant(e.target.value.toUpperCase())}
          placeholder="Identifiant (ex. AGT001)"
          disabled={loading}
          className="uppercase placeholder:normal-case"
        />

        <PillField
          id="pin"
          label="Code PIN"
          icon="lock"
          secret
          compteur={`${pin.length}/6`}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          minLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="Code PIN"
          disabled={loading}
          autoComplete="current-password"
          className="tracking-[0.3em] placeholder:tracking-normal"
        />

        {/* Équivalent du « Se souvenir de moi » : appareil déjà enregistré */}
        <div className="flex items-center gap-2 px-1 text-xs text-primary-100/70">
          <span
            className={`flex h-4 w-4 items-center justify-center rounded border ${
              hasLocalData ? "border-accent-400 bg-accent-400 text-primary-950" : "border-white/30 bg-white/10"
            }`}
          >
            {hasLocalData && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
          </span>
          {hasLocalData
            ? "Appareil mémorisé : connexion hors ligne possible"
            : "Première connexion : Internet requis"}
        </div>

        <PinOublie
          etapes={[
            "Contactez votre administrateur : il vous attribue un nouveau code PIN depuis votre fiche agent.",
            "Activez internet sur ce téléphone (obligatoire pour enregistrer le nouveau code).",
            "Saisissez votre identifiant et le nouveau code PIN, puis touchez « Se connecter ».",
          ]}
        />

        <div className="pt-2">
          <PillButton
            type="submit"
            loading={loading}
            disabled={loading || !identifiant.trim() || pin.length !== 6}
          >
            Se connecter
          </PillButton>
        </div>
      </form>
    </LoginShell>
  );
}

export default function AgentConnexionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-primary-950">
          <p className="text-sm font-semibold text-primary-200">Chargement…</p>
        </div>
      }
    >
      <AgentConnexionContent />
    </Suspense>
  );
}
