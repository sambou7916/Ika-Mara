"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { identifiantToEmail, pinToPassword, validatePin, validateIdentifiant } from "@/lib/utils/pin";
import Icon from "@/components/ui/Icon";
import { LoginShell, PillField, PillButton, PinOublie } from "@/components/auth/LoginShell";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifiant, setIdentifiant] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) {
      setError(decodeURIComponent(err));
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    const idValid = validateIdentifiant(identifiant);
    if (!idValid.valid) {
      setError(idValid.error!);
      return;
    }

    const pinValid = validatePin(pin);
    if (!pinValid.valid) {
      setError(pinValid.error!);
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const email = identifiantToEmail(identifiant);

      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password: pinToPassword(pin),
      });

      if (authError) {
        if (authError.message.includes("Invalid login")) {
          setError("Identifiant ou code PIN incorrect.");
        } else {
          setError(authError.message);
        }
        return;
      }

      // Pas de lecture du profil ici : le middleware vérifie déjà le rôle et
      // la suspension sur /admin (un agent y est renvoyé vers /agent, un compte
      // suspendu vers /login avec un message). On économise un aller-retour réseau.
      // Seule une redirection vers l'espace admin est honorée : « / » renverrait
      // vers l'espace agent.
      const redirect = searchParams.get("redirect");
      router.push(redirect && redirect.startsWith("/admin") ? redirect : "/admin");
    } catch {
      setError("Connexion impossible. Vérifiez votre connexion internet puis réessayez.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <LoginShell
      badge="Espace administration"
      titre="Bon retour parmi nous"
      sousTitre={
        <>
          Saisissez votre identifiant et votre
          <br />
          code PIN à 6 chiffres pour continuer
        </>
      }
      pied={
        <>
          Vous êtes agent de terrain ?{" "}
          <Link href="/agent/connexion" className="font-semibold text-accent-400 hover:text-accent-300 hover:underline">
            Espace agent
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-800">
            <Icon name="alert" className="mt-0.5 h-4 w-4 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        <PillField
          id="identifiant"
          label="Identifiant"
          icon="user"
          value={identifiant}
          onChange={(e) => setIdentifiant(e.target.value.toUpperCase())}
          placeholder="Identifiant (ex. ADMIN01)"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          className="uppercase placeholder:normal-case"
          disabled={loading}
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
          autoComplete="current-password"
          className="tracking-[0.3em] placeholder:tracking-normal"
          disabled={loading}
        />

        <PinOublie
          etapes={[
            "Demandez à la personne qui gère le serveur IKA-MARA de réinitialiser votre code PIN.",
            <>
              Sur le poste serveur, elle lance :{" "}
              <code className="rounded bg-black/30 px-1.5 py-0.5 text-[12px] text-accent-300">
                npm run reinitialiser-pin -- {identifiant || "ADMIN01"} NOUVEAU_PIN
              </code>
            </>,
            "Connectez-vous avec ce nouveau code PIN, puis changez-le si besoin.",
          ]}
        />

        <div className="pt-2">
          <PillButton
            type="submit"
            loading={loading}
            disabled={loading || !identifiant || pin.length !== 6}
          >
            Se connecter
          </PillButton>
        </div>
      </form>
    </LoginShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-primary-950">
          <p className="text-sm font-medium text-primary-200">Chargement…</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
