// =============================================================================
// IKA-MARA — Script de données de démonstration
// =============================================================================
// Crée : 1 admin, 2 agents, 20 membres (10 par agent),
// avec souscriptions et quelques opérations.
//
// Usage : npx tsx scripts/seed.ts
// Nécessite SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY en variables d'environnement.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Charger .env.local (tsx ne le fait pas automatiquement)
try {
  process.loadEnvFile(".env.local");
} catch {
  // Fichier absent : on se fie aux variables déjà définies
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "❌ Variables d'environnement manquantes : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  // Node < 22 n'a pas de WebSocket natif
  realtime: { transport: ws as never },
});

// --- Données ---

const ADMIN = {
  identifiant: "ADMIN01",
  pin: "123456",
  nom: "Keïta Modibo",
  telephone: "+22370000001",
};

const AGENTS = [
  {
    identifiant: "AGT001",
    pin: "111111",
    nom: "Traoré Boubacar",
    telephone: "+22370000002",
  },
  {
    identifiant: "AGT002",
    pin: "222222",
    nom: "Diallo Aminata",
    telephone: "+22370000003",
  },
];

const PRENOMS_H = [
  "Amadou", "Moussa", "Ibrahim", "Seydou", "Oumar",
  "Mamadou", "Bakary", "Drissa", "Adama", "Modibo",
];
const PRENOMS_F = [
  "Fatoumata", "Aïssata", "Mariam", "Oumou", "Kadiatou",
  "Aminata", "Djénéba", "Rokia", "Awa", "Salimata",
];
const NOMS = [
  "Diarra", "Coulibaly", "Traoré", "Keïta", "Konaté",
  "Sangaré", "Cissé", "Sissoko", "Dembélé", "Touré",
];
const PROFESSIONS = [
  "Commerçant", "Tailleur", "Boutiquier", "Enseignant", "Mécanicien",
  "Coiffeuse", "Vendeuse", "Chauffeur", "Maçon", "Agriculteur",
];
const QUARTIERS = [
  "Badalabougou", "Hamdallaye", "Lafiabougou", "Kalaban-Coura",
  "Magnambougou", "Banconi", "Djélibougou", "Sogoniko",
  "Niamakoro", "Faladiè",
];

// --- Fonctions ---

async function createUser(
  identifiant: string,
  pin: string,
  role: "admin" | "agent",
  nom: string,
  telephone: string
): Promise<string> {
  const email = `${identifiant.toLowerCase()}@ika-mara.local`;

  // Créer l'utilisateur dans auth
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password: `IKA-${pin}`, // = pinToPassword(pin) (Supabase : 6 caractères min.)
      email_confirm: true,
    });

  if (authError) {
    // Si l'utilisateur existe déjà, récupérer son ID
    if (authError.message.includes("already been registered")) {
      const { data: users } = await supabase.auth.admin.listUsers();
      const existing = users.users.find((u) => u.email === email);
      if (existing) {
        console.log(`  ↳ Utilisateur ${identifiant} existe déjà`);
        return existing.id;
      }
    }
    throw authError;
  }

  const userId = authData.user.id;

  // Créer le profil
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    role,
    nom,
    telephone,
    identifiant,
    statut: "actif",
  });

  if (profileError) throw profileError;

  return userId;
}

async function createMembre(
  index: number,
  agentId: string,
  prenomPool: string[]
): Promise<string> {
  const numero = String(index + 1).padStart(4, "0");
  const nom = NOMS[index % NOMS.length];
  const prenom = prenomPool[index % prenomPool.length];
  const profession = PROFESSIONS[index % PROFESSIONS.length];
  const quartier = QUARTIERS[index % QUARTIERS.length];
  const telephone = `+2237${String(1000 + index).padStart(7, "0")}`;

  const { data, error } = await supabase
    .from("membres")
    .upsert(
      {
        numero,
        nom,
        prenom,
        profession,
        telephone,
        quartier,
        agent_id: agentId,
        statut: "actif",
      },
      { onConflict: "numero" }
    )
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function createSouscription(
  membreId: string,
  volet: "mara" | "pari" | "djourou",
  montantJour: number
): Promise<void> {
  const { error } = await supabase.from("souscriptions").upsert(
    {
      membre_id: membreId,
      volet,
      montant_jour: montantJour,
      parts_commission: 1,
      date_debut: "2026-01-01",
      statut: "active",
    },
    { onConflict: "membre_id,volet" }
  );

  if (error) throw error;
}

async function createOperation(
  membreId: string,
  agentId: string,
  volet: "mara" | "pari" | "djourou",
  montant: number,
  joursCouverts: number
): Promise<void> {
  const { error } = await supabase.from("operations").insert({
    id: crypto.randomUUID(),
    type: "depot",
    volet,
    membre_id: membreId,
    agent_id: agentId,
    montant,
    jours_couverts: joursCouverts,
    date_operation: new Date().toISOString().split("T")[0],
    statut: "validee",
  });

  if (error) throw error;
}

// --- Main ---

async function seed() {
  console.log("🌱 IKA-MARA — Données de démonstration\n");

  // 1. Créer l'admin
  console.log("👑 Création de l'administrateur…");
  await createUser(ADMIN.identifiant, ADMIN.pin, "admin", ADMIN.nom, ADMIN.telephone);
  console.log(`  ✅ ${ADMIN.nom} (${ADMIN.identifiant} / PIN: ${ADMIN.pin})\n`);

  // 2. Créer les agents
  const agentIds: string[] = [];
  console.log("👤 Création des agents…");
  for (const agent of AGENTS) {
    const id = await createUser(
      agent.identifiant,
      agent.pin,
      "agent",
      agent.nom,
      agent.telephone
    );
    agentIds.push(id);
    console.log(`  ✅ ${agent.nom} (${agent.identifiant} / PIN: ${agent.pin})`);
  }
  console.log();

  // 3. Créer 20 membres (10 par agent)
  console.log("👥 Création de 20 membres…");
  const membreIds: Array<{ id: string; agentId: string }> = [];

  for (let i = 0; i < 20; i++) {
    const agentIndex = Math.floor(i / 10);
    const agentId = agentIds[agentIndex];
    const prenomPool = i % 2 === 0 ? PRENOMS_H : PRENOMS_F;

    const membreId = await createMembre(i, agentId, prenomPool);
    membreIds.push({ id: membreId, agentId });
    console.log(`  ✅ Membre ${String(i + 1).padStart(4, "0")} → Agent ${agentIndex + 1}`);
  }
  console.log();

  // 4. Créer des souscriptions (tous en épargne, certains en tontine)
  console.log("📋 Création des souscriptions…");
  const montants = [500, 1000, 1000, 2000, 500, 1000, 1500, 1000, 500, 2000];

  for (let i = 0; i < membreIds.length; i++) {
    const montant = montants[i % montants.length];
    await createSouscription(membreIds[i].id, "mara", montant);

    // 1 membre sur 3 a aussi une souscription tontine
    if (i % 3 === 0) {
      await createSouscription(membreIds[i].id, "pari", montant);
    }
  }
  console.log(`  ✅ ${membreIds.length} souscriptions épargne créées`);
  console.log(`  ✅ ${Math.ceil(membreIds.length / 3)} souscriptions tontine créées\n`);

  // 5. Créer quelques opérations de dépôt
  console.log("💰 Création de dépôts de démonstration…");
  // Idempotence : ne pas recréer les dépôts si le seed a déjà tourné
  const { count: depotsExistants, error: countError } = await supabase
    .from("operations")
    .select("id", { count: "exact", head: true })
    .eq("type", "depot")
    .in("membre_id", membreIds.slice(0, 10).map((m) => m.id));
  if (countError) throw countError;
  if ((depotsExistants ?? 0) > 0) {
    console.log("  ↳ Dépôts de démonstration déjà présents, étape ignorée\n");
  }
  let opCount = 0;
  for (let i = 0; i < 10 && (depotsExistants ?? 0) === 0; i++) {
    const membre = membreIds[i];
    const montant = montants[i % montants.length];
    // 3 jours de dépôts
    await createOperation(membre.id, membre.agentId, "mara", montant * 3, 3);
    opCount++;
  }
  if (opCount > 0) console.log(`  ✅ ${opCount} opérations de dépôt créées\n`);

  // Résumé
  console.log("═══════════════════════════════════════");
  console.log("✅ DONNÉES DE DÉMONSTRATION CRÉÉES");
  console.log("═══════════════════════════════════════");
  console.log();
  console.log("Connexions :");
  console.log(`  Admin  : ${ADMIN.identifiant} / PIN: ${ADMIN.pin}`);
  for (const agent of AGENTS) {
    console.log(`  Agent  : ${agent.identifiant} / PIN: ${agent.pin}`);
  }
  console.log();
}

seed().catch((err) => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});
