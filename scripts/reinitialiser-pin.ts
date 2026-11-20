// =============================================================================
// IKA-MARA — Réinitialisation d'un code PIN (secours, ex. admin qui a oublié le sien)
// =============================================================================
// À lancer sur le poste qui héberge l'application (nécessite la clé service
// Supabase de .env.local : personne d'autre ne peut l'utiliser).
//
// Usage : npm run reinitialiser-pin -- <IDENTIFIANT> <NOUVEAU_PIN>
// Exemple : npm run reinitialiser-pin -- ADMIN01 654321
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { pinToPassword, validatePin } from "../src/lib/utils/pin";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fichier absent : on se fie aux variables déjà définies
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const [identifiantBrut, nouveauPin] = process.argv.slice(2);

  if (!identifiantBrut || !nouveauPin) {
    console.error("Usage : npm run reinitialiser-pin -- <IDENTIFIANT> <NOUVEAU_PIN>");
    console.error("Exemple : npm run reinitialiser-pin -- ADMIN01 654321");
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Configuration manquante : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (.env.local).");
    process.exit(1);
  }

  const verif = validatePin(nouveauPin);
  if (!verif.valid) {
    console.error(`Code PIN refusé : ${verif.error}.`);
    process.exit(1);
  }

  const identifiant = identifiantBrut.trim().toUpperCase();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as never },
  });

  const { data: profil, error: erreurProfil } = await supabase
    .from("profiles")
    .select("id, identifiant, nom, role, statut")
    .eq("identifiant", identifiant)
    .maybeSingle();

  if (erreurProfil) throw erreurProfil;
  if (!profil) {
    console.error(`Aucun compte avec l'identifiant ${identifiant}.`);
    process.exit(1);
  }

  const { error: erreurMdp } = await supabase.auth.admin.updateUserById(profil.id, {
    password: pinToPassword(nouveauPin),
  });
  if (erreurMdp) throw erreurMdp;

  // Agent : révoquer l'appareil (comme la réinitialisation depuis l'admin)
  if (profil.role === "agent") {
    await supabase
      .from("profiles")
      .update({ device_id: "revoque", modifie_le: new Date().toISOString() })
      .eq("id", profil.id);
  }

  // Traçabilité : réalisé par le titulaire du compte, depuis le poste serveur
  await supabase.from("audit_log").insert({
    qui: profil.id,
    quoi: "reinitialisation_pin_secours",
    details: `Code PIN réinitialisé en ligne de commande (poste serveur) pour ${profil.identifiant} (${profil.nom}).`,
  });

  console.log(`Code PIN réinitialisé pour ${profil.identifiant} (${profil.nom}, ${profil.role}).`);
  if (profil.statut === "suspendu") {
    console.log("Attention : ce compte est SUSPENDU, la connexion restera refusée.");
  }
}

main().catch((err) => {
  console.error("Échec de la réinitialisation :", err instanceof Error ? err.message : err);
  process.exit(1);
});
