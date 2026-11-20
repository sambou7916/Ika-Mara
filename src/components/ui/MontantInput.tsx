"use client";

import { cn } from "@/components/ui/utils";

/** Affiche un entier avec des espaces comme séparateurs de milliers : 1500000 → « 1 500 000 ». */
function grouperMilliers(valeur: number): string {
  return String(valeur).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

type ProprietesEntier = {
  value: number;
  onChange: (valeur: number) => void;
  /** Texte affiché à droite du champ (« F », « % », « jours »…). null = aucun. */
  suffixe?: string | null;
  /** Séparateur de milliers pendant la saisie. */
  grouper?: boolean;
  /** Valeur maximale : une saisie plus grande est ramenée à ce plafond. */
  max?: number;
  /** Classes du conteneur (ex. « flex-1 » dans une ligne flex). */
  conteneurClassName?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "max" | "min" | "step"
>;

/**
 * Champ de saisie d'un entier positif.
 * - Vide quand la valeur vaut 0 : on peut l'effacer librement (pas de « 0 » qui revient).
 * - N'accepte que des chiffres : pas de décimales, pas de signe.
 */
export function EntierInput({
  value,
  onChange,
  suffixe = null,
  grouper = false,
  max,
  conteneurClassName,
  className,
  placeholder = "0",
  ...props
}: ProprietesEntier) {
  const affiche = value > 0 ? (grouper ? grouperMilliers(value) : String(value)) : "";

  return (
    <div className={cn("relative", conteneurClassName)}>
      <input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={affiche}
        onChange={(e) => {
          const chiffres = e.target.value.replace(/\D/g, "").slice(0, 12);
          let n = chiffres ? parseInt(chiffres, 10) : 0;
          if (max !== undefined && n > max) n = max;
          onChange(n);
        }}
        className={cn("tabular-nums", suffixe && "pr-12", className)}
      />
      {suffixe && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
          {suffixe}
        </span>
      )}
    </div>
  );
}

/**
 * Champ de saisie d'un montant en F CFA (entier positif).
 * Affiche « 1 000 » pendant la saisie, avec le suffixe « F ».
 */
export default function MontantInput({
  placeholder = "0",
  ...props
}: Omit<ProprietesEntier, "suffixe" | "grouper">) {
  return <EntierInput {...props} placeholder={placeholder} suffixe="F" grouper />;
}
