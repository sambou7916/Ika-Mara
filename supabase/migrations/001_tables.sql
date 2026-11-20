-- =============================================================================
-- IKA-MARA — Migration 001 : Création des tables
-- =============================================================================
-- Règle fondamentale : aucune suppression ni modification d'opération financière.
-- Correction = opération « annulation » liée via annule_ref + audit_log.
-- Montants en F CFA, toujours entiers (integer), jamais de décimales.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- TYPES ÉNUMÉRÉS
-- =============================================================================

CREATE TYPE role_type        AS ENUM ('admin', 'agent');
CREATE TYPE statut_profil    AS ENUM ('actif', 'suspendu');
CREATE TYPE statut_membre    AS ENUM ('actif', 'inactif');
CREATE TYPE volet_type       AS ENUM ('mara', 'pari', 'djourou');
CREATE TYPE statut_souscription AS ENUM ('active', 'suspendue', 'cloturee');
CREATE TYPE operation_type   AS ENUM (
  'depot', 'retrait', 'remboursement', 'commission',
  'decaissement', 'annulation', 'demande_retrait', 'demande_credit'
);
CREATE TYPE statut_operation AS ENUM ('validee', 'en_attente', 'annulee', 'rejetee');
CREATE TYPE statut_credit    AS ENUM ('en_cours', 'rembourse', 'en_defaut');
CREATE TYPE mouvement_type   AS ENUM ('entree', 'sortie');

-- =============================================================================
-- TABLE : profiles
-- =============================================================================

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        role_type     NOT NULL DEFAULT 'agent',
  nom         TEXT          NOT NULL,
  telephone   TEXT,
  identifiant TEXT          UNIQUE NOT NULL,
  statut      statut_profil NOT NULL DEFAULT 'actif',
  device_id   TEXT,
  cree_le     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  modifie_le  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- =============================================================================
-- TABLE : membres
-- =============================================================================

CREATE TABLE membres (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero      CHAR(4)       UNIQUE NOT NULL,
  nom         TEXT          NOT NULL,
  prenom      TEXT          NOT NULL,
  profession  TEXT,
  telephone   TEXT,
  quartier    TEXT,
  agent_id    UUID          NOT NULL REFERENCES profiles(id),
  statut      statut_membre NOT NULL DEFAULT 'actif',
  cree_le     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  modifie_le  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_membres_agent ON membres(agent_id);
CREATE INDEX idx_membres_numero ON membres(numero);

-- =============================================================================
-- TABLE : souscriptions
-- =============================================================================

CREATE TABLE souscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membre_id         UUID              NOT NULL REFERENCES membres(id),
  volet             volet_type        NOT NULL,
  montant_jour      INTEGER           NOT NULL CHECK (montant_jour > 0),
  parts_commission  INTEGER           NOT NULL DEFAULT 1 CHECK (parts_commission >= 0),
  date_debut        DATE              NOT NULL DEFAULT CURRENT_DATE,
  statut            statut_souscription NOT NULL DEFAULT 'active',
  cree_le           TIMESTAMPTZ       NOT NULL DEFAULT now(),
  modifie_le        TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE(membre_id, volet)
);

CREATE INDEX idx_souscriptions_membre ON souscriptions(membre_id);

-- =============================================================================
-- TABLE : historique_souscriptions
-- =============================================================================

CREATE TABLE historique_souscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  souscription_id UUID        NOT NULL REFERENCES souscriptions(id),
  champ_modifie   TEXT        NOT NULL,
  ancienne_valeur TEXT,
  nouvelle_valeur TEXT,
  modifie_par     UUID        REFERENCES profiles(id),
  modifie_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- TABLE : operations
-- =============================================================================
-- id = UUID généré par le client (client_id) pour l'idempotence hors ligne.
-- RÈGLE : jamais de UPDATE ni DELETE sur cette table.

CREATE TABLE operations (
  id              UUID            PRIMARY KEY,  -- fourni par le client
  type            operation_type  NOT NULL,
  volet           volet_type      NOT NULL,
  membre_id       UUID            NOT NULL REFERENCES membres(id),
  agent_id        UUID            NOT NULL REFERENCES profiles(id),
  montant         INTEGER         NOT NULL CHECK (montant > 0),
  jours_couverts  INTEGER         DEFAULT 1 CHECK (jours_couverts > 0),
  date_operation  DATE            NOT NULL DEFAULT CURRENT_DATE,
  cree_le         TIMESTAMPTZ     NOT NULL DEFAULT now(),
  annule_ref      UUID            REFERENCES operations(id),
  statut          statut_operation NOT NULL DEFAULT 'validee',
  motif           TEXT,
  CONSTRAINT chk_annulation CHECK (
    (type = 'annulation' AND annule_ref IS NOT NULL AND motif IS NOT NULL)
    OR (type != 'annulation')
  )
);

CREATE INDEX idx_operations_membre   ON operations(membre_id);
CREATE INDEX idx_operations_agent    ON operations(agent_id);
CREATE INDEX idx_operations_date     ON operations(date_operation);
CREATE INDEX idx_operations_volet    ON operations(volet);
CREATE INDEX idx_operations_type     ON operations(type);

-- Empêcher toute modification ou suppression d'opérations financières
CREATE OR REPLACE FUNCTION fn_prevent_operation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Les opérations financières ne peuvent être ni modifiées ni supprimées. Créez une opération d''annulation.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_operation_update
  BEFORE UPDATE ON operations
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_operation_mutation();

CREATE TRIGGER trg_prevent_operation_delete
  BEFORE DELETE ON operations
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_operation_mutation();

-- =============================================================================
-- TABLE : cycles_pari (tontine)
-- =============================================================================

CREATE TABLE cycles_pari (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         TEXT        NOT NULL,
  montant_pot INTEGER     NOT NULL CHECK (montant_pot > 0),
  periodicite TEXT        NOT NULL DEFAULT 'mensuel',
  date_debut  DATE        NOT NULL,
  date_fin    DATE,
  statut      TEXT        NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'termine', 'annule')),
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- TABLE : participants_pari
-- =============================================================================

CREATE TABLE participants_pari (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id  UUID NOT NULL REFERENCES cycles_pari(id),
  membre_id UUID NOT NULL REFERENCES membres(id),
  ordre     INTEGER NOT NULL,
  cree_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, membre_id),
  UNIQUE(cycle_id, ordre)
);

-- =============================================================================
-- TABLE : tours_pari
-- =============================================================================

CREATE TABLE tours_pari (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        UUID    NOT NULL REFERENCES cycles_pari(id),
  numero_tour     INTEGER NOT NULL,
  beneficiaire_id UUID    NOT NULL REFERENCES membres(id),
  montant_verse   INTEGER NOT NULL CHECK (montant_verse > 0),
  date_tour       DATE    NOT NULL,
  statut          TEXT    NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'verse', 'annule')),
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cycle_id, numero_tour)
);

-- =============================================================================
-- TABLE : credits (Ika-Djourou)
-- =============================================================================

CREATE TABLE credits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membre_id         UUID          NOT NULL REFERENCES membres(id),
  montant_accorde   INTEGER       NOT NULL CHECK (montant_accorde > 0),
  montant_rembourse INTEGER       NOT NULL DEFAULT 0 CHECK (montant_rembourse >= 0),
  taux_interet      INTEGER       NOT NULL DEFAULT 0,
  date_octroi       DATE          NOT NULL DEFAULT CURRENT_DATE,
  date_echeance     DATE          NOT NULL,
  statut            statut_credit NOT NULL DEFAULT 'en_cours',
  agent_id          UUID          NOT NULL REFERENCES profiles(id),
  cree_le           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  modifie_le        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_credits_membre ON credits(membre_id);

-- =============================================================================
-- TABLE : echeances
-- =============================================================================

CREATE TABLE echeances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id     UUID    NOT NULL REFERENCES credits(id),
  numero        INTEGER NOT NULL,
  montant_du    INTEGER NOT NULL CHECK (montant_du > 0),
  montant_paye  INTEGER NOT NULL DEFAULT 0 CHECK (montant_paye >= 0),
  date_echeance DATE    NOT NULL,
  statut        TEXT    NOT NULL DEFAULT 'a_payer' CHECK (statut IN ('a_payer', 'paye', 'en_retard')),
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(credit_id, numero)
);

-- =============================================================================
-- TABLE : remises_collecte
-- =============================================================================

CREATE TABLE remises_collecte (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID        NOT NULL REFERENCES profiles(id),
  montant       INTEGER     NOT NULL CHECK (montant > 0),
  date_remise   DATE        NOT NULL DEFAULT CURRENT_DATE,
  commentaire   TEXT,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_remises_agent ON remises_collecte(agent_id);

-- =============================================================================
-- TABLE : caisse_mouvements
-- =============================================================================

CREATE TABLE caisse_mouvements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           mouvement_type NOT NULL,
  montant        INTEGER        NOT NULL CHECK (montant > 0),
  libelle        TEXT           NOT NULL,
  reference_id   UUID,
  reference_type TEXT,
  date_mouvement DATE           NOT NULL DEFAULT CURRENT_DATE,
  cree_le        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- =============================================================================
-- TABLE : banque_mouvements
-- =============================================================================

CREATE TABLE banque_mouvements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type           mouvement_type NOT NULL,
  montant        INTEGER        NOT NULL CHECK (montant > 0),
  libelle        TEXT           NOT NULL,
  reference_id   UUID,
  reference_type TEXT,
  date_mouvement DATE           NOT NULL DEFAULT CURRENT_DATE,
  cree_le        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- =============================================================================
-- TABLE : parametres
-- =============================================================================

CREATE TABLE parametres (
  cle        TEXT PRIMARY KEY,
  valeur     JSONB NOT NULL,
  modifie_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO parametres (cle, valeur) VALUES
  ('nom_structure', '"IKA-MARA"'::jsonb),
  ('commission_default_parts', '1'::jsonb),
  ('devise', '"F CFA"'::jsonb),
  ('intervalle_sync_secondes', '60'::jsonb);

-- =============================================================================
-- TABLE : audit_log
-- =============================================================================

CREATE TABLE audit_log (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qui     UUID        REFERENCES profiles(id),
  quoi    TEXT        NOT NULL,
  avant   JSONB,
  apres   JSONB,
  quand   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip      TEXT,
  details TEXT
);

CREATE INDEX idx_audit_qui   ON audit_log(qui);
CREATE INDEX idx_audit_quand ON audit_log(quand);

-- =============================================================================
-- Trigger updated_at automatique
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_update_modifie_le()
RETURNS TRIGGER AS $$
BEGIN
  NEW.modifie_le = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_modifie_le
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION fn_update_modifie_le();

CREATE TRIGGER trg_membres_modifie_le
  BEFORE UPDATE ON membres FOR EACH ROW EXECUTE FUNCTION fn_update_modifie_le();

CREATE TRIGGER trg_souscriptions_modifie_le
  BEFORE UPDATE ON souscriptions FOR EACH ROW EXECUTE FUNCTION fn_update_modifie_le();

CREATE TRIGGER trg_credits_modifie_le
  BEFORE UPDATE ON credits FOR EACH ROW EXECUTE FUNCTION fn_update_modifie_le();
