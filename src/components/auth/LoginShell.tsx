"use client";

import { useState } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import { cn } from "@/components/ui/utils";

/**
 * Habillage commun des écrans de connexion (admin et agent) :
 * fond dégradé doré, logo centré, titre d'accueil et pied de page.
 */
export function LoginShell({
  titre,
  sousTitre,
  badge,
  enHaut,
  pied,
  children,
}: {
  titre: string;
  sousTitre: React.ReactNode;
  badge?: string;
  enHaut?: React.ReactNode;
  pied?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-primary-950 px-5 py-6 text-white">
      {/* Halos verts + reflet doré */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(31,124,81,0.55),transparent_60%),radial-gradient(ellipse_at_90%_100%,rgba(246,166,35,0.12),transparent_55%)]"
      />

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col">
        {enHaut && <div className="flex min-h-[28px] items-center justify-end">{enHaut}</div>}

        <div className="flex flex-1 flex-col justify-center py-6">
          {/* Logo */}
          <div className="flex flex-col items-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white font-display text-xl font-extrabold text-primary-800 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)]">
              IM
            </span>
            {badge && (
              <span className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-accent-400">
                {badge}
              </span>
            )}
            <span className="mt-1 font-display text-4xl font-extrabold tracking-tight text-white">
              IKA-MARA
            </span>
          </div>

          <h1 className="mt-4 text-center font-display text-xl font-medium leading-snug text-white">
            {titre}
          </h1>
          <p className="mx-auto mt-2 max-w-[17rem] text-center text-sm leading-relaxed text-primary-100/70">
            {sousTitre}
          </p>

          <div className="mt-8">{children}</div>
        </div>

        {pied && <div className="pt-4 text-center text-sm text-primary-100/70">{pied}</div>}
      </div>
    </div>
  );
}

/** Champ « pilule » avec icône à gauche et, en option, bouton afficher/masquer. */
export function PillField({
  id,
  label,
  icon,
  secret = false,
  compteur,
  className,
  ...inputProps
}: {
  id: string;
  label: string;
  icon: IconName;
  secret?: boolean;
  compteur?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id">) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <label htmlFor={id} className="text-xs font-medium text-primary-100/80">
          {label}
        </label>
        {compteur && <span className="text-xs tabular-nums text-primary-200/60">{compteur}</span>}
      </div>
      <div className="relative">
        <Icon
          name={icon}
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary-800"
        />
        <input
          id={id}
          {...inputProps}
          type={secret ? (visible ? "text" : "password") : inputProps.type ?? "text"}
          className={cn(
            "block h-12 w-full rounded-full border border-transparent bg-white pl-12 text-[15px] text-slate-900 transition placeholder:text-slate-400 focus:border-accent-400 focus:outline-none focus:ring-4 focus:ring-accent-400/30 disabled:opacity-60",
            secret ? "pr-12" : "pr-4",
            className
          )}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Masquer le code PIN" : "Afficher le code PIN"}
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name={visible ? "eye" : "eyeOff"} className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Bouton principal jaune arrondi. */
export function PillButton({
  loading,
  loadingLabel = "Connexion en cours…",
  children,
  className,
  ...props
}: {
  loading?: boolean;
  loadingLabel?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-400 text-[15px] font-bold text-primary-950 shadow-cta transition hover:bg-accent-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-accent-400/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-accent-400/40 disabled:text-primary-950/60 disabled:shadow-none",
        className
      )}
    >
      {loading ? (
        <>
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-950 border-t-transparent" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * Lien « Code PIN oublié ? » qui déplie la marche à suivre.
 * Pas de réinitialisation par e-mail/SMS : les comptes utilisent un
 * identifiant + PIN, et c'est un administrateur qui attribue un nouveau PIN.
 */
export function PinOublie({ etapes }: { etapes: React.ReactNode[] }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <div>
      <div className="flex justify-end px-1">
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          aria-expanded={ouvert}
          className="text-xs font-semibold text-accent-400 transition hover:text-accent-300 hover:underline"
        >
          Code PIN oublié ?
        </button>
      </div>

      {ouvert && (
        <div className="mt-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-primary-50">
          <p className="font-semibold text-white">Récupérer l&apos;accès</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-primary-100/90">
            {etapes.map((etape, i) => (
              <li key={i}>{etape}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-primary-200/70">
            Pour votre sécurité, aucun code PIN n&apos;est envoyé par SMS ni par e-mail.
          </p>
        </div>
      )}
    </div>
  );
}

/** Séparateur « OU » / texte centré entre deux lignes. */
export function LoginDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-primary-200/60">
      <span className="h-px flex-1 bg-white/15" />
      {children}
      <span className="h-px flex-1 bg-white/15" />
    </div>
  );
}
