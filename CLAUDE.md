# CLAUDE.md — IKA-MARA

## Projet

**IKA-MARA** — Application de gestion de collecte d'argent pour le Mali.
Trois volets :
- **Ika-Mara** : Épargne journalière
- **Ika-Pari** : Tontine (cotisations rotatives)
- **Ika-Djourou** : Crédit

Des **agents de terrain** encaissent des cotisations journalières auprès des membres.
La structure prélève une **commission mensuelle** (par défaut : 1 part × montant_jour).

---

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Framework | Next.js 14 (App Router) |
| Langage | TypeScript strict |
| Styles | Tailwind CSS |
| Backend | Supabase (Postgres + Auth + RLS) |
| Hors ligne | Dexie (IndexedDB) + dexie-react-hooks |
| PWA | Serwist (@serwist/next) |
| Déploiement | Vercel |
| Tests | Vitest + fake-indexeddb |

---

## Règles fondamentales

### 1. Aucune suppression financière
> **JAMAIS** de `DELETE` ni d'`UPDATE` sur la table `operations`.
> Correction = nouvelle opération de type `annulation` liée via `annule_ref` + `motif` obligatoire + entrée dans `audit_log`.

### 2. Outbox obligatoire
> Toute écriture (dépôt, demande, remise) passe par l'outbox locale.
> Écriture locale immédiate + UUID client → synchro serveur avec `INSERT ON CONFLICT (id) DO NOTHING`.
> Une opération en erreur **n'est JAMAIS supprimée** de l'outbox.

### 3. Montants entiers en F CFA
> Tous les montants sont des `INTEGER` (jamais de flottants ni de décimales).
> Format d'affichage : `1 000 F` (espace comme séparateur de milliers, « F » en suffixe).

### 4. Interface en français
> Tous les textes, labels, messages d'erreur et tooltips sont en français.
> Noms de champs SQL en français (pas de mélange anglais/français).

### 5. Le serveur fait foi
> Les soldes sont calculés côté serveur (vue `soldes_membres`).
> Les dépôts s'**additionnent**, ils ne s'**écrasent** pas.

### 6. Sécurité
> Clé service Supabase **uniquement** côté serveur (`SUPABASE_SERVICE_ROLE_KEY`).
> RLS activée sur **toutes** les tables.
> Un agent ne voit que **ses** membres et **ses** opérations (`agent_id = auth.uid()`).
> Possibilité de suspendre un agent et révoquer son appareil.

---

## Structure du projet

```
d:\Ika-MARA\
├── public/
│   ├── manifest.json          # Manifeste PWA
│   └── icons/                 # Icônes PWA
├── scripts/
│   └── seed.ts                # Données de démonstration
├── supabase/
│   └── migrations/
│       ├── 001_tables.sql     # Tables + types + triggers
│       ├── 002_views.sql      # Vues (soldes, collecte, caisse)
│       ├── 003_functions.sql  # cloturer_mois, annuler_operation, etc.
│       ├── 004_rls.sql        # Politiques RLS
│       ├── 005_rls_tests.sql  # Tests SQL de sécurité RLS
│       ├── 006_sync.sql       # Idempotence sync & outbox
│       ├── 007_admin_views.sql# Vues agrégées dashboard admin
│       ├── 008_membres_admin.sql # Sécurité DELETE & réaffectation membres
│       ├── 009_agents_admin.sql # Audit agents, performance, PIN
│       ├── 010_mara_admin.sql # Validation/rejet atomique des retraits d'épargne
│       ├── 011_pari_admin.sql # Cycles tontines, tirage au sort, retards, décaissements
│       ├── 012_djourou_admin.sql # Crédits, échéanciers, intérêts, imputation remboursements
│       ├── 013_commissions_admin.sql # Commissions mensuelles, clôture idempotente, mois incomplets
│       ├── 014_caisse_admin.sql # Caisse, remises de collecte, banque, transferts atomiques
│       └── 015_parametres_admin.sql # Paramètres par sections, versioning, audit log, sauvegarde
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Layout racine (HTML, meta, PWA)
│   │   ├── page.tsx           # Redirect → /agent
│   │   ├── (auth)/
│   │   │   ├── layout.tsx     # Layout auth (centré, gradient)
│   │   │   └── login/
│   │   │       └── page.tsx   # Connexion admin
│   │   ├── agent/
│   │   │   ├── layout.tsx     # Layout mobile-first + SyncBadge
│   │   │   ├── connexion/
│   │   │   │   └── page.tsx   # Écran connexion agent (offline-first, PBKDF2)
│   │   │   └── page.tsx       # Dashboard agent (placeholder)
│   │   ├── admin/
│   │   │   ├── layout.tsx     # Layout responsive + sidebar
│   │   │   └── page.tsx       # Dashboard admin (placeholder)
│   │   └── api/
│   │       └── sync/
│   │           └── route.ts   # POST: sync outbox, GET: portefeuille
│   ├── components/
│   │   ├── SyncBadge.tsx      # Indicateur En ligne / Hors ligne
│   │   └── ui/
│   │       └── utils.ts       # cn() helper Tailwind
│   ├── lib/
│   │   ├── types.ts           # Types TypeScript centraux
│   │   ├── supabase/
│   │   │   ├── client.ts      # Client navigateur
│   │   │   ├── server.ts      # Client serveur + service role
│   │   │   └── middleware.ts  # Gestion session middleware
│   │   ├── db/
│   │   │   ├── dexie.ts       # Schéma Dexie (IndexedDB + table agentAuth)
│   │   │   └── outbox.ts      # File d'attente hors ligne
│   │   ├── sync/
│   │   │   └── engine.ts      # Moteur de synchronisation
│   │   └── utils/
│   │       ├── crypto.ts      # PBKDF2 Web Crypto API (hash et vérification PIN)
│   │       ├── format.ts      # Formatage F CFA, dates, labels
│   │       └── pin.ts         # Dérivation email technique + validation
│   ├── middleware.ts          # Middleware Next.js (auth + redirect)
│   ├── sw.ts                  # Service Worker (Serwist)
│   └── __tests__/
│       ├── setup.ts           # Setup tests (fake-indexeddb)
│       ├── auth-local.test.ts # Tests auth locale (PBKDF2, 5 essais, blocage, purge)
│       ├── dashboard-agent.test.ts # Tests métriques en temps réel
│       ├── depot.test.ts      # Tests nouveau dépôt et outbox
│       ├── recu.test.ts       # Tests reçu de versement (numérotation, WhatsApp, 58mm)
│       ├── membres.test.ts    # Tests recherche insensible aux accents et tri des membres
│       ├── fiche-membre.test.ts # Tests calcul solde local (serveur + outbox) et mouvements
│       ├── demandes.test.ts   # Tests demandes de retrait et crédit (caution, anti-crédits multiples)
│       ├── journal.test.ts    # Tests journal du jour, non visités et remise de collecte
│       ├── outbox.test.ts     # Tests outbox (double envoi, coupure, reprise)
│       └── sync.test.ts       # Tests sync (idempotence, backoff, montants)
├── CLAUDE.md                  # Ce fichier
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
└── .env.local.example
```

---

## Commission

Commission mensuelle d'un membre :
```
commission = parts_commission × montant_jour
```
- Défaut : 1 part par mois
- Exemple : 1 000 F/jour → 1 000 F de commission par mois
- Prélevée par la fonction SQL `cloturer_mois(annee, mois)` — **idempotente**

---

## Authentification agent (`/agent/connexion`)

- **Identifiant** : ex. `AGT001` (majuscules)
- **PIN** : exactement 6 chiffres (`inputMode="numeric"`)
- **Première connexion** (aucune donnée locale) :
  - Exige internet obligatoirement.
  - Authentification Supabase avec email technique `identifiant@ika-mara.local` + PIN.
  - Téléchargement du portefeuille (`GET /api/sync`) dans Dexie.
  - Calcul et stockage du sel et hash PBKDF2 (100 000 itérations SHA-256) dans la table `agentAuth` de Dexie.
- **Connexions suivantes** :
  - Fonctionne 100% hors-ligne.
  - Vérification du PIN contre le hash PBKDF2 local.
  - Rafraîchissement en arrière-plan sans bloquer la navigation si le réseau est disponible.
- **Blocage 5 essais** :
  - Compteur d'échecs incrémenté à chaque tentative erronée.
  - Verrouillage automatique dès 5 échecs consécutifs.
- **Sécurité et suspension** :
  - Dès qu'une vérification ou synchronisation détecte `statut = 'suspendu'`, toutes les données locales de l'appareil sont purgées (`purgeAgentData()`) et l'agent est déconnecté.

---

## Synchronisation hors ligne

1. Au premier login → télécharger le portefeuille dans Dexie (`GET /api/sync`)
2. Toute écriture → locale immédiate + outbox (UUID client)
3. Synchro → `POST /api/sync` avec `INSERT ON CONFLICT DO NOTHING`
4. Reprise : événement `online`, intervalle 60s, bouton manuel
5. Backoff exponentiel en cas d'erreur (1s → 5min max)
6. Entrée en erreur **jamais supprimée**

---

## Routes prévues (à construire)

### Agent (`/agent/*`) — mobile-first
| Route | Description |
|-------|-------------|
| `/agent/connexion` | Connexion agent (identifiant + PIN, offline-first PBKDF2) |
| `/agent` | Accueil agent : métriques Dexie en direct (collecté, membres servis, outbox, 3 volets) |
| `/agent/depot` | Nouveau dépôt / encaissement rapide (recherche 4 chiffres, arriérés, anti-doublon) |
| `/agent/recu/[id]` | Reçu de versement avec détails, solde estimé et partage |
| `/agent/membres` | Annuaire et recherche instantanée des membres (sans accents, tri par retard) |
| `/agent/membres/[numero]` | Fiche membre détaillée (soldes serveur + outbox, arriérés, 10 mouvements) |
| `/agent/demandes` | Demandes de fonds (retrait épargne ou crédit) hors-ligne |
| `/agent/membres/nouveau` | Inscription d'un nouveau membre |
| `/agent/journal` | Journal des opérations de l'agent |
| `/agent/synchro` | État détaillé de synchronisation, gestion de l'outbox |
| `/agent/plus` | Menu Plus (liens demandes, synchro, mon compte, aide, déconnexion) |
| `/agent/compte` | Mon compte (changement de code PIN avec ancien PIN) |
| `/agent/aide` | Aide et guide pratique de collecte (page statique) |

### Admin (`/admin/*`) — responsive
| Route | Description |
|-------|-------------|
| `/admin` | Tableau de bord global (cartes, alertes, tableau agents, sélecteur période, export Excel) |
| `/admin/membres` | Gestion des membres (recherche, filtres, réaffectation en masse, création/édition) |
| `/admin/membres/[id]` | Fiche détaillée membre (soldes, souscriptions, historique, annulation par écriture inverse) |
| `/admin/agents` | Gestion des agents (création sécurisée serveur, statut nouveau/actif/suspendu, collecte mois) |
| `/admin/agents/[id]` | Fiche agent (portefeuille, performance, révocation appareil, réinitialisation PIN) |
| `/admin/mara` | Volet Ika-Mara (épargne journalière : dépôts, validation atomique des retraits, soldes, export Excel) |
| `/admin/pari` | Volet Ika-Pari (cycles et tours de tontine, tirage au sort, suivi retards, décaissements atomiques, export) |
| `/admin/djourou` | Volet Ika-Djourou (demandes, validation, échéanciers, remboursements partiels/anticipés, retards, pénalités) |
| `/admin/commissions` | Suivi et clôture des commissions mensuelles (cartes, détail membre/volet, idempotence, export) |
| `/admin/caisse` | Caisse & remises de collecte (contrôle des écarts, solde cumulé, banque, transferts, export) |
| `/admin/parametres` | Paramètres généraux de la structure (sections commission, crédit, retrait, alertes, reçus, sauvegarde/export) |
| `/admin/audit` | Journal d'audit et historique (traçabilité complète filtrable par utilisateur et date) |

### API (`/api/*`)
| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/sync` | POST | Synchronisation outbox → serveur |
| `/api/sync` | GET | Téléchargement portefeuille agent |
| `/api/admin/dashboard` | GET | Métriques agrégées du tableau de bord admin |
| `/api/admin/membres` | GET, POST | Gestion des membres |
| `/api/admin/membres/reaffecter` | POST | Réaffectation d'adhérents en masse |
| `/api/admin/agents` | GET, POST | Gestion et création sécurisée des agents |
| `/api/admin/agents/[id]` | GET, PATCH | Détails, suspension, réinitialisation PIN |
| `/api/admin/mara` | GET, POST | Volet Mara (dépôts, validation/refus retraits atomiques, soldes) |
| `/api/admin/pari` | GET, POST | Volet Pari (création cycle, tirage au sort, suspension, décaissement) |
| `/api/admin/djourou` | GET, POST | Volet Djourou (demandes, validation crédit, imputation remboursements) |
| `/api/admin/commissions` | GET, POST | Commissions mensuelles & clôture idempotente |
| `/api/admin/caisse` | GET, POST | Caisse, remises (confirmation/écarts), banque, transferts |
| `/api/admin/parametres` | GET, POST | Paramètres par sections, journal d'audit, export de sauvegarde |
| `/api/cloture` | POST | Clôture mensuelle (admin) |
| `/api/annulation` | POST | Annulation d'opération (admin) |

---

## Données de démonstration

Exécuter : `npx tsx scripts/seed.ts`

| Rôle | Identifiant | PIN |
|------|-------------|-----|
| Admin | ADMIN01 | 123456 |
| Agent 1 | AGT001 | 111111 |
| Agent 2 | AGT002 | 222222 |

20 membres créés (10 par agent), avec souscriptions et dépôts.

---

## Commandes

```bash
npm run dev          # Serveur de développement
npm run build        # Build de production
npm run test         # Tests unitaires (Vitest)
npm run test:watch   # Tests en mode watch
npm run seed         # Données de démonstration
npm run lint         # Lint ESLint
```
