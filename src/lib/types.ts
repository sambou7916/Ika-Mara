// =============================================================================
// IKA-MARA — Types centraux
// =============================================================================
// Montants toujours en F CFA entiers (number entier, jamais de décimales).
// =============================================================================

// --- Énumérations ---

export type RoleType = "admin" | "agent";
export type StatutProfil = "actif" | "suspendu" | "nouveau";
export type StatutMembre = "actif" | "inactif";
export type VoletType = "mara" | "pari" | "djourou";
export type StatutSouscription = "active" | "suspendue" | "cloturee";
export type OperationType =
  | "depot"
  | "retrait"
  | "remboursement"
  | "commission"
  | "decaissement"
  | "annulation"
  | "demande_retrait"
  | "demande_credit";
export type StatutOperation = "validee" | "en_attente" | "annulee" | "rejetee";
export type StatutCredit = "en_cours" | "rembourse" | "en_defaut";
export type MouvementType = "entree" | "sortie";

// --- Entités ---

export interface Profile {
  id: string;
  role: RoleType;
  nom: string;
  telephone: string | null;
  identifiant: string;
  statut: StatutProfil;
  device_id: string | null;
  derniere_synchro_le?: string | null;
  cree_le: string;
  modifie_le: string;
}

export interface Membre {
  id: string;
  numero: string;
  nom: string;
  prenom: string;
  profession: string | null;
  telephone: string | null;
  quartier: string | null;
  agent_id: string;
  statut: StatutMembre;
  cree_le: string;
  modifie_le: string;
}

export interface Souscription {
  id: string;
  membre_id: string;
  volet: VoletType;
  montant_jour: number; // entier F CFA
  parts_commission: number;
  date_debut: string;
  statut: StatutSouscription;
  cree_le: string;
  modifie_le: string;
}

export interface Operation {
  id: string; // UUID généré côté client
  type: OperationType;
  volet: VoletType;
  membre_id: string;
  agent_id: string;
  montant: number; // entier F CFA
  jours_couverts: number;
  date_operation: string;
  cree_le: string;
  annule_ref: string | null;
  statut: StatutOperation;
  motif: string | null;
}

export interface Credit {
  id: string;
  membre_id: string;
  montant_accorde: number;
  montant_rembourse: number;
  taux_interet: number;
  date_octroi: string;
  date_echeance: string;
  statut: StatutCredit;
  agent_id: string;
  cree_le: string;
  modifie_le: string;
}

export interface Echeance {
  id: string;
  credit_id: string;
  numero: number;
  montant_du: number;
  montant_paye: number;
  date_echeance: string;
  statut: "a_payer" | "paye" | "en_retard";
  cree_le: string;
}

export interface RemiseCollecte {
  id: string; // UUID généré côté client (client_id)
  agent_id: string;
  date_remise: string;
  montant_attendu: number;
  montant_remis: number;
  montant: number; // Égal à montant_remis pour compatibilité SQL
  ecart: number; // montant_remis - montant_attendu
  motif: string | null;
  commentaire: string | null;
  statut: "a_confirmer" | "validee" | "rejetee";
  cree_le: string;
}

export interface Parametre {
  cle: string;
  valeur: unknown;
  modifie_le: string;
}

// --- Vues ---

export interface SoldeMembre {
  membre_id: string;
  numero: string;
  nom: string;
  prenom: string;
  agent_id: string;
  volet: VoletType | null;
  solde: number;
}

export interface CollecteJourAgent {
  agent_id: string;
  agent_nom: string;
  date_operation: string;
  nombre_operations: number;
  total_depots: number;
  total_retraits: number;
  total_commissions: number;
}

// --- Outbox (hors ligne) ---

export type OutboxStatus = "pending" | "syncing" | "error";

/**
 * Nature d'un échec de synchronisation :
 * - reseau      : coupure / délai dépassé → réessai automatique (backoff)
 * - transitoire : erreur serveur 5xx → réessai automatique (backoff)
 * - session     : session expirée (401) → réessai après reconnexion
 * - definitive  : refus métier (422) → reste en erreur, réessai manuel uniquement
 * - suspendu    : agent suspendu (403) → purge locale
 */
export type SyncErrorKind =
  | "reseau"
  | "transitoire"
  | "session"
  | "definitive"
  | "suspendu";

export interface OutboxEntry {
  /** Auto-incrémenté par Dexie */
  localId?: number;
  /** UUID v4 généré côté client = id de l'opération */
  clientId: string;
  /** Nom de la table cible */
  table: string;
  /** Données à insérer */
  payload: Record<string, unknown>;
  /** Statut de synchronisation */
  status: OutboxStatus;
  /** Nombre de tentatives */
  retries: number;
  /** Dernière erreur */
  lastError: string | null;
  /** Timestamp de création */
  createdAt: number;
  /** Timestamp de dernière tentative */
  lastAttempt: number | null;
  /** Nature du dernier échec (null si aucun) */
  errorKind?: SyncErrorKind | null;
  /** Code d'erreur renvoyé par le serveur (ex. MEMBRE_HORS_PORTEFEUILLE) */
  errorCode?: string | null;
}

// --- Décisions administrateur ---

export interface DecisionDemande {
  id: string;
  demande_id: string; // = operations.id de la demande_retrait / demande_credit
  decision: "acceptee" | "rejetee";
  montant_accorde: number | null;
  motif: string | null;
  decide_le: string;
}

// --- Sync ---

/** Réponse de POST /api/sync pour une entrée de l'outbox */
export type SyncPushResponse =
  | { success: true; statut: "insere" | "doublon"; clientId: string; serverTime: string }
  | { success: false; code: string; error: string };

/** Contenu de GET /api/sync (portefeuille complet de l'agent) */
export interface PortefeuilleAgent {
  membres: Membre[];
  souscriptions: Souscription[];
  operations: Operation[];
  soldes: SoldeMembre[];
  parametres: Parametre[];
  remises?: RemiseCollecte[];
  credits?: Credit[];
  decisions?: DecisionDemande[];
}

export interface SyncResponse {
  success: boolean;
  synced: number;
  errors: Array<{ clientId: string; error: string }>;
  serverTime: string;
}

export interface SyncState {
  isOnline: boolean;
  /** Nombre total d'entrées dans l'outbox (en attente + en erreur) */
  pendingCount: number;
  /** Nombre d'entrées en erreur */
  errorCount?: number;
  lastSyncAt: string | null;
  /** Dernier téléchargement du portefeuille */
  lastPullAt?: string | null;
  isSyncing: boolean;
  isPulling?: boolean;
  lastError: string | null;
  /** Timestamp (ms) de la prochaine tentative automatique après échec */
  nextRetryAt?: number | null;
}

// --- Authentification Locale Agent ---

export interface LocalAgentAuth {
  identifiant: string;
  agentId: string;
  nom: string;
  telephone: string | null;
  statut: StatutProfil;
  pinHash: string; // Hash PBKDF2 en hexadécimal
  pinSalt: string; // Sel aléatoire en hexadécimal
  failedAttempts: number; // 0 à 5
  isBlocked: boolean;
  blockedAt: number | null;
  lastLoginAt: number;
  /** Nouveau code PIN en attente de mise à jour sur Supabase lors de la prochaine synchro */
  pendingPinUpdate?: string | null;
}

