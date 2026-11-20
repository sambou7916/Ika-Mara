-- ===== 001_tables.sql =====
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

-- ===== 002_views.sql =====
-- =============================================================================
-- IKA-MARA — Migration 002 : Vues
-- =============================================================================

-- =============================================================================
-- VUE : soldes_membres
-- =============================================================================
-- Solde d'épargne = dépôts − commissions − retraits (par membre et volet).

CREATE OR REPLACE VIEW soldes_membres AS
SELECT
  m.id                AS membre_id,
  m.numero,
  m.nom,
  m.prenom,
  m.agent_id,
  o.volet,
  COALESCE(SUM(
    CASE
      WHEN o.type IN ('depot')                                    THEN  o.montant
      WHEN o.type IN ('retrait', 'commission', 'decaissement')    THEN -o.montant
      WHEN o.type = 'annulation' THEN
        CASE
          WHEN ref_op.type IN ('depot')                                 THEN -o.montant
          WHEN ref_op.type IN ('retrait', 'commission', 'decaissement') THEN  o.montant
          ELSE 0
        END
      ELSE 0
    END
  ), 0) AS solde
FROM membres m
LEFT JOIN operations o ON o.membre_id = m.id AND o.statut = 'validee'
LEFT JOIN operations ref_op ON o.annule_ref = ref_op.id
GROUP BY m.id, m.numero, m.nom, m.prenom, m.agent_id, o.volet;

-- =============================================================================
-- VUE : arrieres_membres
-- =============================================================================

CREATE OR REPLACE VIEW arrieres_membres AS
SELECT
  c.membre_id,
  m.numero,
  m.nom,
  m.prenom,
  m.agent_id,
  c.id AS credit_id,
  c.montant_accorde,
  c.montant_rembourse,
  (c.montant_accorde - c.montant_rembourse) AS reste_a_payer,
  c.date_echeance,
  CASE WHEN c.date_echeance < CURRENT_DATE AND c.statut = 'en_cours'
       THEN true ELSE false END AS en_retard
FROM credits c
JOIN membres m ON m.id = c.membre_id
WHERE c.statut = 'en_cours';

-- =============================================================================
-- VUE : collecte_du_jour_par_agent
-- =============================================================================

CREATE OR REPLACE VIEW collecte_du_jour_par_agent AS
SELECT
  p.id          AS agent_id,
  p.nom         AS agent_nom,
  o.date_operation,
  COUNT(*)      AS nombre_operations,
  COALESCE(SUM(CASE WHEN o.type = 'depot'      THEN o.montant ELSE 0 END), 0) AS total_depots,
  COALESCE(SUM(CASE WHEN o.type = 'retrait'    THEN o.montant ELSE 0 END), 0) AS total_retraits,
  COALESCE(SUM(CASE WHEN o.type = 'commission' THEN o.montant ELSE 0 END), 0) AS total_commissions
FROM profiles p
LEFT JOIN operations o ON o.agent_id = p.id
  AND o.date_operation = CURRENT_DATE
  AND o.statut = 'validee'
WHERE p.role = 'agent'
GROUP BY p.id, p.nom, o.date_operation;

-- =============================================================================
-- VUE : solde_caisse
-- =============================================================================

CREATE OR REPLACE VIEW solde_caisse AS
SELECT
  COALESCE(SUM(CASE WHEN type = 'entree' THEN montant ELSE 0 END), 0) AS total_entrees,
  COALESCE(SUM(CASE WHEN type = 'sortie' THEN montant ELSE 0 END), 0) AS total_sorties,
  COALESCE(SUM(CASE WHEN type = 'entree' THEN montant ELSE -montant END), 0) AS solde
FROM caisse_mouvements;

-- ===== 003_functions.sql =====
-- =============================================================================
-- IKA-MARA — Migration 003 : Fonctions
-- =============================================================================

-- =============================================================================
-- FONCTION : cloturer_mois(p_annee, p_mois)
-- =============================================================================
-- Prélève la commission mensuelle pour chaque souscription active.
-- Commission = parts_commission × montant_jour.
-- IDEMPOTENTE : si la commission a déjà été prélevée ce mois-ci, ne fait rien.

CREATE OR REPLACE FUNCTION cloturer_mois(p_annee INTEGER, p_mois INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date_debut DATE;
  v_date_fin   DATE;
  v_count      INTEGER := 0;
  v_souscription RECORD;
  v_commission INTEGER;
  v_existe     BOOLEAN;
BEGIN
  v_date_debut := make_date(p_annee, p_mois, 1);
  v_date_fin   := (v_date_debut + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  FOR v_souscription IN
    SELECT
      s.id AS souscription_id,
      s.membre_id,
      s.volet,
      s.montant_jour,
      s.parts_commission,
      m.agent_id
    FROM souscriptions s
    JOIN membres m ON m.id = s.membre_id
    WHERE s.statut = 'active'
      AND s.date_debut <= v_date_fin
  LOOP
    v_commission := v_souscription.parts_commission * v_souscription.montant_jour;

    SELECT EXISTS(
      SELECT 1 FROM operations
      WHERE type = 'commission'
        AND volet = v_souscription.volet
        AND membre_id = v_souscription.membre_id
        AND date_operation BETWEEN v_date_debut AND v_date_fin
        AND statut = 'validee'
    ) INTO v_existe;

    IF NOT v_existe AND v_commission > 0 THEN
      INSERT INTO operations (
        id, type, volet, membre_id, agent_id, montant,
        jours_couverts, date_operation, statut, motif
      ) VALUES (
        gen_random_uuid(),
        'commission',
        v_souscription.volet,
        v_souscription.membre_id,
        v_souscription.agent_id,
        v_commission,
        1,
        v_date_fin,
        'validee',
        format('Commission %s/%s — %s part(s) × %s F',
          p_mois, p_annee,
          v_souscription.parts_commission,
          v_souscription.montant_jour)
      );

      v_count := v_count + 1;

      INSERT INTO audit_log (qui, quoi, apres, details)
      VALUES (
        NULL,
        'commission_mensuelle',
        jsonb_build_object(
          'membre_id', v_souscription.membre_id,
          'volet', v_souscription.volet::text,
          'montant', v_commission,
          'mois', format('%s/%s', p_mois, p_annee)
        ),
        format('Clôture commission %s/%s pour membre %s, volet %s',
          p_mois, p_annee, v_souscription.membre_id, v_souscription.volet)
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- =============================================================================
-- FONCTION : generer_numero_membre()
-- =============================================================================

CREATE OR REPLACE FUNCTION generer_numero_membre()
RETURNS CHAR(4)
LANGUAGE plpgsql
AS $$
DECLARE
  v_max INTEGER;
  v_next CHAR(4);
BEGIN
  SELECT COALESCE(MAX(numero::INTEGER), 0) + 1 INTO v_max FROM membres;
  v_next := LPAD(v_max::TEXT, 4, '0');
  RETURN v_next;
END;
$$;

-- =============================================================================
-- FONCTION : annuler_operation(p_operation_id, p_agent_id, p_motif)
-- =============================================================================

CREATE OR REPLACE FUNCTION annuler_operation(
  p_operation_id UUID,
  p_agent_id UUID,
  p_motif TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_op RECORD;
  v_annulation_id UUID;
BEGIN
  SELECT * INTO v_op FROM operations WHERE id = p_operation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opération % introuvable', p_operation_id;
  END IF;

  IF v_op.type = 'annulation' THEN
    RAISE EXCEPTION 'Impossible d''annuler une annulation';
  END IF;

  IF v_op.statut = 'annulee' THEN
    RAISE EXCEPTION 'Cette opération est déjà annulée';
  END IF;

  v_annulation_id := gen_random_uuid();
  INSERT INTO operations (
    id, type, volet, membre_id, agent_id, montant,
    jours_couverts, date_operation, annule_ref, statut, motif
  ) VALUES (
    v_annulation_id,
    'annulation',
    v_op.volet,
    v_op.membre_id,
    p_agent_id,
    v_op.montant,
    v_op.jours_couverts,
    CURRENT_DATE,
    p_operation_id,
    'validee',
    p_motif
  );

  INSERT INTO audit_log (qui, quoi, avant, apres, details)
  VALUES (
    p_agent_id,
    'annulation_operation',
    to_jsonb(v_op),
    jsonb_build_object('annulation_id', v_annulation_id, 'motif', p_motif),
    format('Annulation de l''opération %s : %s', p_operation_id, p_motif)
  );

  RETURN v_annulation_id;
END;
$$;

-- ===== 004_rls.sql =====
-- =============================================================================
-- IKA-MARA — Migration 004 : Politiques RLS (Row Level Security)
-- =============================================================================
-- Principe : un agent ne voit que SES membres et SES opérations.
-- Un admin voit tout.
-- =============================================================================

-- Activer RLS sur toutes les tables
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE membres               ENABLE ROW LEVEL SECURITY;
ALTER TABLE souscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE historique_souscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycles_pari           ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants_pari     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tours_pari            ENABLE ROW LEVEL SECURITY;
ALTER TABLE credits               ENABLE ROW LEVEL SECURITY;
ALTER TABLE echeances             ENABLE ROW LEVEL SECURITY;
ALTER TABLE remises_collecte      ENABLE ROW LEVEL SECURITY;
ALTER TABLE caisse_mouvements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE banque_mouvements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametres            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Fonction helper : rôle de l'utilisateur courant
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_role()
RETURNS role_type
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND statut = 'actif');
$$;

-- =============================================================================
-- PROFILES
-- =============================================================================

CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (
    is_active() AND (id = auth.uid() OR is_admin())
  );

CREATE POLICY profiles_insert ON profiles
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (is_admin());

-- =============================================================================
-- MEMBRES
-- =============================================================================

CREATE POLICY membres_select ON membres
  FOR SELECT USING (
    is_active() AND (agent_id = auth.uid() OR is_admin())
  );

CREATE POLICY membres_insert ON membres
  FOR INSERT WITH CHECK (
    is_active() AND (agent_id = auth.uid() OR is_admin())
  );

CREATE POLICY membres_update ON membres
  FOR UPDATE USING (
    is_active() AND (agent_id = auth.uid() OR is_admin())
  );

-- =============================================================================
-- SOUSCRIPTIONS
-- =============================================================================

CREATE POLICY souscriptions_select ON souscriptions
  FOR SELECT USING (
    is_active() AND (
      is_admin()
      OR EXISTS(SELECT 1 FROM membres WHERE membres.id = souscriptions.membre_id AND membres.agent_id = auth.uid())
    )
  );

CREATE POLICY souscriptions_insert ON souscriptions
  FOR INSERT WITH CHECK (
    is_active() AND (
      is_admin()
      OR EXISTS(SELECT 1 FROM membres WHERE membres.id = souscriptions.membre_id AND membres.agent_id = auth.uid())
    )
  );

CREATE POLICY souscriptions_update ON souscriptions
  FOR UPDATE USING (
    is_active() AND (
      is_admin()
      OR EXISTS(SELECT 1 FROM membres WHERE membres.id = souscriptions.membre_id AND membres.agent_id = auth.uid())
    )
  );

-- =============================================================================
-- HISTORIQUE_SOUSCRIPTIONS
-- =============================================================================

CREATE POLICY hist_souscriptions_select ON historique_souscriptions
  FOR SELECT USING (
    is_active() AND (
      is_admin()
      OR EXISTS(
        SELECT 1 FROM souscriptions s
        JOIN membres m ON m.id = s.membre_id
        WHERE s.id = historique_souscriptions.souscription_id
          AND m.agent_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- OPERATIONS
-- =============================================================================

CREATE POLICY operations_select ON operations
  FOR SELECT USING (
    is_active() AND (agent_id = auth.uid() OR is_admin())
  );

CREATE POLICY operations_insert ON operations
  FOR INSERT WITH CHECK (
    is_active() AND (agent_id = auth.uid() OR is_admin())
  );

-- Pas de UPDATE ni DELETE (triggers empêchent)

-- =============================================================================
-- CYCLES_PARI / PARTICIPANTS_PARI / TOURS_PARI
-- =============================================================================

CREATE POLICY cycles_pari_select ON cycles_pari
  FOR SELECT USING (is_active());

CREATE POLICY cycles_pari_manage ON cycles_pari
  FOR ALL USING (is_admin());

CREATE POLICY participants_pari_select ON participants_pari
  FOR SELECT USING (
    is_active() AND (
      is_admin()
      OR EXISTS(SELECT 1 FROM membres WHERE membres.id = participants_pari.membre_id AND membres.agent_id = auth.uid())
    )
  );

CREATE POLICY tours_pari_select ON tours_pari
  FOR SELECT USING (is_active());

CREATE POLICY tours_pari_manage ON tours_pari
  FOR ALL USING (is_admin());

-- =============================================================================
-- CREDITS / ECHEANCES
-- =============================================================================

CREATE POLICY credits_select ON credits
  FOR SELECT USING (
    is_active() AND (agent_id = auth.uid() OR is_admin())
  );

CREATE POLICY credits_insert ON credits
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY credits_update ON credits
  FOR UPDATE USING (is_admin());

CREATE POLICY echeances_select ON echeances
  FOR SELECT USING (
    is_active() AND (
      is_admin()
      OR EXISTS(
        SELECT 1 FROM credits c
        WHERE c.id = echeances.credit_id AND c.agent_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- REMISES_COLLECTE
-- =============================================================================

CREATE POLICY remises_select ON remises_collecte
  FOR SELECT USING (
    is_active() AND (agent_id = auth.uid() OR is_admin())
  );

CREATE POLICY remises_insert ON remises_collecte
  FOR INSERT WITH CHECK (
    is_active() AND (agent_id = auth.uid() OR is_admin())
  );

-- =============================================================================
-- CAISSE / BANQUE
-- =============================================================================

CREATE POLICY caisse_select ON caisse_mouvements
  FOR SELECT USING (is_admin());

CREATE POLICY caisse_manage ON caisse_mouvements
  FOR ALL USING (is_admin());

CREATE POLICY banque_select ON banque_mouvements
  FOR SELECT USING (is_admin());

CREATE POLICY banque_manage ON banque_mouvements
  FOR ALL USING (is_admin());

-- =============================================================================
-- PARAMETRES
-- =============================================================================

CREATE POLICY parametres_select ON parametres
  FOR SELECT USING (is_active());

CREATE POLICY parametres_manage ON parametres
  FOR ALL USING (is_admin());

-- =============================================================================
-- AUDIT_LOG
-- =============================================================================

CREATE POLICY audit_select ON audit_log
  FOR SELECT USING (is_admin());

CREATE POLICY audit_insert ON audit_log
  FOR INSERT WITH CHECK (is_active());

-- ===== 006_sync.sql =====
-- =============================================================================
-- IKA-MARA — Migration 006 : Synchronisation hors ligne
-- =============================================================================
-- 1. Colonnes de remise de collecte (attendu / remis / écart / statut)
-- 2. Décisions de l'administrateur sur les demandes (retrait, crédit)
-- 3. Journal serveur des erreurs de synchro (visible par l'administrateur)
-- 4. Fonctions d'insertion idempotentes : INSERT … ON CONFLICT (id) DO NOTHING
--    (id = client_id généré sur le téléphone)
-- =============================================================================

-- =============================================================================
-- 1. REMISES DE COLLECTE : champs saisis par l'agent + confirmation admin
-- =============================================================================

ALTER TABLE remises_collecte
  ADD COLUMN IF NOT EXISTS montant_attendu INTEGER NOT NULL DEFAULT 0 CHECK (montant_attendu >= 0),
  ADD COLUMN IF NOT EXISTS montant_remis   INTEGER NOT NULL DEFAULT 0 CHECK (montant_remis >= 0),
  ADD COLUMN IF NOT EXISTS ecart           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motif           TEXT,
  ADD COLUMN IF NOT EXISTS statut          TEXT    NOT NULL DEFAULT 'a_confirmer'
    CHECK (statut IN ('a_confirmer', 'validee', 'rejetee')),
  ADD COLUMN IF NOT EXISTS confirme_par    UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS confirme_le     TIMESTAMPTZ;

-- Une journée sans collecte donne une remise de 0 F
ALTER TABLE remises_collecte DROP CONSTRAINT IF EXISTS remises_collecte_montant_check;
ALTER TABLE remises_collecte ADD CONSTRAINT remises_collecte_montant_check CHECK (montant >= 0);

-- Un écart non nul exige un motif
ALTER TABLE remises_collecte DROP CONSTRAINT IF EXISTS chk_remise_motif_ecart;
ALTER TABLE remises_collecte ADD CONSTRAINT chk_remise_motif_ecart
  CHECK (ecart = 0 OR (motif IS NOT NULL AND length(trim(motif)) > 0));

-- Une seule remise active (non rejetée) par agent et par jour
CREATE UNIQUE INDEX IF NOT EXISTS uq_remise_agent_jour
  ON remises_collecte(agent_id, date_remise)
  WHERE statut <> 'rejetee';

-- =============================================================================
-- 2. DÉCISIONS DE L'ADMINISTRATEUR SUR LES DEMANDES
-- =============================================================================
-- Les opérations étant immuables, la décision est un enregistrement séparé
-- lié à la demande (operations.id).

CREATE TABLE IF NOT EXISTS decisions_demandes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id      UUID        NOT NULL UNIQUE REFERENCES operations(id),
  agent_id        UUID        NOT NULL REFERENCES profiles(id),
  decision        TEXT        NOT NULL CHECK (decision IN ('acceptee', 'rejetee')),
  montant_accorde INTEGER     CHECK (montant_accorde IS NULL OR montant_accorde > 0),
  motif           TEXT,
  decide_par      UUID        NOT NULL REFERENCES profiles(id),
  decide_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_decision_rejet_motif CHECK (
    decision = 'acceptee' OR (motif IS NOT NULL AND length(trim(motif)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decisions_demandes(agent_id);

-- Renseigne agent_id depuis la demande et vérifie le type
CREATE OR REPLACE FUNCTION fn_decision_demande_avant_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_type  operation_type;
  v_agent UUID;
BEGIN
  SELECT type, agent_id INTO v_type, v_agent FROM operations WHERE id = NEW.demande_id;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;
  IF v_type NOT IN ('demande_retrait', 'demande_credit') THEN
    RAISE EXCEPTION 'Seules les demandes de retrait ou de crédit peuvent recevoir une décision';
  END IF;
  NEW.agent_id := v_agent;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decision_demande_avant_insert ON decisions_demandes;
CREATE TRIGGER trg_decision_demande_avant_insert
  BEFORE INSERT ON decisions_demandes
  FOR EACH ROW EXECUTE FUNCTION fn_decision_demande_avant_insert();

-- =============================================================================
-- 3. JOURNAL DES ERREURS DE SYNCHRONISATION
-- =============================================================================
-- Toute entrée refusée par le serveur y est consignée : l'administrateur voit
-- les mêmes erreurs que l'agent. Marquée « résolue » quand l'entrée finit par
-- être acceptée. Jamais supprimée automatiquement.

CREATE TABLE IF NOT EXISTS sync_erreurs (
  client_id    UUID PRIMARY KEY,
  agent_id     UUID        NOT NULL REFERENCES profiles(id),
  table_cible  TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  code         TEXT        NOT NULL,
  message      TEXT,
  tentatives   INTEGER     NOT NULL DEFAULT 1,
  premiere_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  derniere_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolu       BOOLEAN     NOT NULL DEFAULT false,
  resolu_le    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_erreurs_agent  ON sync_erreurs(agent_id);
CREATE INDEX IF NOT EXISTS idx_sync_erreurs_resolu ON sync_erreurs(resolu);

-- =============================================================================
-- 4. FONCTIONS DE SYNCHRONISATION (appelées par /api/sync, clé service)
-- =============================================================================

-- --- Opérations ---------------------------------------------------------------
-- Retourne 'insere' ou 'doublon'. Lève une exception dont le MESSAGE est un
-- code métier (MEMBRE_INACTIF, MONTANT_INVALIDE, …) en cas de refus.

CREATE OR REPLACE FUNCTION sync_operation(
  p_agent_id  UUID,
  p_client_id UUID,
  p_payload   JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_type    operation_type;
  v_volet   volet_type;
  v_montant NUMERIC;
  v_jours   INTEGER;
  v_membre  membres%ROWTYPE;
  v_id      UUID;
BEGIN
  -- Renvoi d'une opération déjà reçue : ignoré (idempotence)
  IF EXISTS (SELECT 1 FROM operations WHERE id = p_client_id) THEN
    RETURN 'doublon';
  END IF;

  -- Type autorisé pour un agent
  BEGIN
    v_type  := (p_payload->>'type')::operation_type;
    v_volet := (p_payload->>'volet')::volet_type;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING MESSAGE = 'DONNEES_INVALIDES';
  END;

  IF v_type NOT IN ('depot', 'remboursement', 'demande_retrait', 'demande_credit') THEN
    RAISE EXCEPTION USING MESSAGE = 'TYPE_NON_AUTORISE';
  END IF;

  -- Montant entier strictement positif (F CFA)
  IF jsonb_typeof(p_payload->'montant') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING MESSAGE = 'MONTANT_INVALIDE';
  END IF;
  v_montant := (p_payload->>'montant')::NUMERIC;
  IF v_montant <= 0 OR v_montant <> trunc(v_montant) OR v_montant > 2147483647 THEN
    RAISE EXCEPTION USING MESSAGE = 'MONTANT_INVALIDE';
  END IF;

  v_jours := COALESCE(NULLIF(p_payload->>'jours_couverts', '')::INTEGER, 1);
  IF v_jours <= 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'DONNEES_INVALIDES';
  END IF;

  -- Membre : existe, appartient à l'agent, actif
  SELECT * INTO v_membre FROM membres WHERE id = (p_payload->>'membre_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'MEMBRE_INTROUVABLE';
  END IF;
  IF v_membre.agent_id <> p_agent_id THEN
    RAISE EXCEPTION USING MESSAGE = 'MEMBRE_HORS_PORTEFEUILLE';
  END IF;
  IF v_membre.statut <> 'actif' THEN
    RAISE EXCEPTION USING MESSAGE = 'MEMBRE_INACTIF';
  END IF;

  -- Dépôt : souscription active sur le volet
  IF v_type = 'depot' AND NOT EXISTS (
    SELECT 1 FROM souscriptions
    WHERE membre_id = v_membre.id AND volet = v_volet AND statut = 'active'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'SOUSCRIPTION_INACTIVE';
  END IF;

  INSERT INTO operations (
    id, type, volet, membre_id, agent_id, montant, jours_couverts,
    date_operation, cree_le, statut, motif
  ) VALUES (
    p_client_id,
    v_type,
    v_volet,
    v_membre.id,
    p_agent_id,                                   -- jamais l'agent_id du client
    v_montant::INTEGER,
    v_jours,
    COALESCE(NULLIF(p_payload->>'date_operation', '')::DATE, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'cree_le', '')::TIMESTAMPTZ, now()),
    CASE WHEN v_type IN ('demande_retrait', 'demande_credit')
         THEN 'en_attente'::statut_operation
         ELSE 'validee'::statut_operation END,
    NULLIF(p_payload->>'motif', '')
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN 'doublon'; -- envoi concurrent du même client_id
  END IF;

  UPDATE sync_erreurs SET resolu = true, resolu_le = now()
  WHERE client_id = p_client_id AND resolu = false;

  RETURN 'insere';
END;
$$;

-- --- Remises de collecte ------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_remise(
  p_agent_id  UUID,
  p_client_id UUID,
  p_payload   JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_attendu NUMERIC;
  v_remis   NUMERIC;
  v_date    DATE;
  v_motif   TEXT;
  v_id      UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM remises_collecte WHERE id = p_client_id) THEN
    RETURN 'doublon';
  END IF;

  IF jsonb_typeof(p_payload->'montant_attendu') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload->'montant_remis') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING MESSAGE = 'MONTANT_INVALIDE';
  END IF;

  v_attendu := (p_payload->>'montant_attendu')::NUMERIC;
  v_remis   := (p_payload->>'montant_remis')::NUMERIC;
  IF v_attendu < 0 OR v_remis < 0
     OR v_attendu <> trunc(v_attendu) OR v_remis <> trunc(v_remis) THEN
    RAISE EXCEPTION USING MESSAGE = 'MONTANT_INVALIDE';
  END IF;

  v_motif := NULLIF(trim(COALESCE(p_payload->>'motif', '')), '');
  IF v_remis <> v_attendu AND v_motif IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'DONNEES_INVALIDES';
  END IF;

  v_date := COALESCE(NULLIF(p_payload->>'date_remise', '')::DATE, CURRENT_DATE);

  IF EXISTS (
    SELECT 1 FROM remises_collecte
    WHERE agent_id = p_agent_id AND date_remise = v_date AND statut <> 'rejetee'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'REMISE_DEJA_FAITE';
  END IF;

  INSERT INTO remises_collecte (
    id, agent_id, montant, date_remise, commentaire, cree_le,
    montant_attendu, montant_remis, ecart, motif, statut
  ) VALUES (
    p_client_id,
    p_agent_id,
    v_remis::INTEGER,
    v_date,
    NULLIF(p_payload->>'commentaire', ''),
    COALESCE(NULLIF(p_payload->>'cree_le', '')::TIMESTAMPTZ, now()),
    v_attendu::INTEGER,
    v_remis::INTEGER,
    (v_remis - v_attendu)::INTEGER,
    v_motif,
    'a_confirmer'                                 -- toujours confirmée par l'admin
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN 'doublon';
  END IF;

  UPDATE sync_erreurs SET resolu = true, resolu_le = now()
  WHERE client_id = p_client_id AND resolu = false;

  RETURN 'insere';
END;
$$;

-- --- Journalisation d'un refus ------------------------------------------------

CREATE OR REPLACE FUNCTION sync_journaliser_erreur(
  p_agent_id  UUID,
  p_client_id UUID,
  p_table     TEXT,
  p_payload   JSONB,
  p_code      TEXT,
  p_message   TEXT
)
RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO sync_erreurs (client_id, agent_id, table_cible, payload, code, message)
  VALUES (p_client_id, p_agent_id, p_table, p_payload, p_code, p_message)
  ON CONFLICT (client_id) DO UPDATE SET
    tentatives  = sync_erreurs.tentatives + 1,
    code        = EXCLUDED.code,
    message     = EXCLUDED.message,
    payload     = EXCLUDED.payload,
    derniere_le = now(),
    resolu      = false,
    resolu_le   = NULL;
$$;

-- Fonctions réservées au serveur (clé service) : jamais appelables par un client
REVOKE ALL ON FUNCTION sync_operation(UUID, UUID, JSONB)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_remise(UUID, UUID, JSONB)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_journaliser_erreur(UUID, UUID, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_operation(UUID, UUID, JSONB)                          TO service_role;
GRANT EXECUTE ON FUNCTION sync_remise(UUID, UUID, JSONB)                             TO service_role;
GRANT EXECUTE ON FUNCTION sync_journaliser_erreur(UUID, UUID, TEXT, JSONB, TEXT, TEXT) TO service_role;

-- =============================================================================
-- 5. RLS
-- =============================================================================

ALTER TABLE decisions_demandes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_erreurs       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decisions_select ON decisions_demandes;
CREATE POLICY decisions_select ON decisions_demandes
  FOR SELECT USING (is_active() AND (agent_id = auth.uid() OR is_admin()));

DROP POLICY IF EXISTS decisions_insert ON decisions_demandes;
CREATE POLICY decisions_insert ON decisions_demandes
  FOR INSERT WITH CHECK (is_admin() AND decide_par = auth.uid());

DROP POLICY IF EXISTS sync_erreurs_select ON sync_erreurs;
CREATE POLICY sync_erreurs_select ON sync_erreurs
  FOR SELECT USING (is_active() AND (agent_id = auth.uid() OR is_admin()));

DROP POLICY IF EXISTS sync_erreurs_update ON sync_erreurs;
CREATE POLICY sync_erreurs_update ON sync_erreurs
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- Remises : seul l'administrateur confirme ou rejette
DROP POLICY IF EXISTS remises_update ON remises_collecte;
CREATE POLICY remises_update ON remises_collecte
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- ===== 007_admin_views.sql =====
-- =============================================================================
-- IKA-MARA — Migration 007 : Vues et Fonctions pour le Tableau de Bord Admin
-- =============================================================================
-- Agrégations et statistiques de performance des agents pour le tableau de bord
-- =============================================================================

-- Paramètre par défaut pour le seuil d'alerte des retards (en jours)
INSERT INTO parametres (cle, valeur)
VALUES ('seuil_alerte_retard_jours', '3'::jsonb)
ON CONFLICT (cle) DO NOTHING;

-- Vue pour l'encours global des crédits en cours
CREATE OR REPLACE VIEW encours_credit_global AS
SELECT
  COUNT(*) AS nombre_credits_actifs,
  COALESCE(SUM(montant_accorde), 0) AS total_accorde,
  COALESCE(SUM(montant_rembourse), 0) AS total_rembourse,
  COALESCE(SUM(montant_accorde - montant_rembourse), 0) AS total_restant_du
FROM credits
WHERE statut = 'en_cours';

-- Vue pour les alertes de gestion
CREATE OR REPLACE VIEW alertes_admin AS
SELECT
  -- 1. Écarts de remises ou remises en attente de validation
  (SELECT COUNT(*) FROM remises_collecte WHERE statut = 'a_confirmer' OR ecart <> 0) AS ecarts_remises_count,
  -- 2. Demandes de fonds en attente de validation (retraits ou crédits)
  (SELECT COUNT(*) FROM operations WHERE type IN ('demande_retrait', 'demande_credit') AND statut = 'en_attente') AS demandes_en_attente_count,
  -- 3. Crédits en retard de paiement
  (SELECT COUNT(DISTINCT credit_id) FROM echeances WHERE statut = 'en_retard' OR (statut = 'a_payer' AND date_echeance < CURRENT_DATE)) AS credits_en_retard_count;

-- ===== 008_membres_admin.sql =====
-- =============================================================================
-- IKA-MARA — Migration 008 : Gestion Administrateur des Membres
-- =============================================================================

-- Ajout de la colonne photo_url facultative
ALTER TABLE membres ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Trigger empêchant la suppression physique d'un membre avec opérations financières
CREATE OR REPLACE FUNCTION fn_prevent_membre_delete_avec_operations()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM operations WHERE membre_id = OLD.id) THEN
    RAISE EXCEPTION 'Impossible de supprimer un membre ayant des opérations financières enregistrées. Désactivez-le à la place.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_membre_delete ON membres;
CREATE TRIGGER trg_prevent_membre_delete
  BEFORE DELETE ON membres
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_membre_delete_avec_operations();

-- Fonction de réaffectation en masse d'agents
CREATE OR REPLACE FUNCTION reaffecter_membres_agent(
  p_admin_id UUID,
  p_membre_ids UUID[],
  p_nouveau_agent_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER := 0;
  v_membre_id UUID;
  v_ancien_agent_id UUID;
  v_nom_agent TEXT;
BEGIN
  -- Vérifier l'existence du nouvel agent
  SELECT nom INTO v_nom_agent FROM profiles WHERE id = p_nouveau_agent_id AND role = 'agent';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent cible introuvable ou non actif';
  END IF;

  FOREACH v_membre_id IN ARRAY p_membre_ids LOOP
    SELECT agent_id INTO v_ancien_agent_id FROM membres WHERE id = v_membre_id;
    
    IF FOUND AND v_ancien_agent_id <> p_nouveau_agent_id THEN
      UPDATE membres
      SET agent_id = p_nouveau_agent_id, modifie_le = now()
      WHERE id = v_membre_id;

      INSERT INTO audit_log (qui, quoi, avant, apres, details)
      VALUES (
        p_admin_id,
        'reaffectation_agent',
        jsonb_build_object('membre_id', v_membre_id, 'ancien_agent_id', v_ancien_agent_id),
        jsonb_build_object('membre_id', v_membre_id, 'nouveau_agent_id', p_nouveau_agent_id),
        format('Réaffectation du membre %s vers l''agent %s', v_membre_id, v_nom_agent)
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ===== 009_agents_admin.sql =====
-- =============================================================================
-- IKA-MARA — Migration 009 : Gestion Administrateur des Agents
-- =============================================================================

-- Ajout de la valeur 'nouveau' pour les nouveaux agents en attente de 1ère connexion
ALTER TYPE statut_profil ADD VALUE IF NOT EXISTS 'nouveau';

-- Horodatage de la dernière synchronisation de l'agent
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS derniere_synchro_le TIMESTAMPTZ;

-- Met à jour la dernière synchronisation lors de l'enregistrement d'une opération
CREATE OR REPLACE FUNCTION fn_update_agent_derniere_synchro()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET derniere_synchro_le = now(), modifie_le = now()
  WHERE id = NEW.agent_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_agent_synchro_op ON operations;
CREATE TRIGGER trg_update_agent_synchro_op
  AFTER INSERT ON operations
  FOR EACH ROW EXECUTE FUNCTION fn_update_agent_derniere_synchro();

-- ===== 010_mara_admin.sql =====
-- =============================================================================
-- IKA-MARA — Migration 010 : Gestion Ika-Mara (Épargne & Retraits)
-- =============================================================================

-- Paramètres par défaut pour l'épargne Ika-Mara
INSERT INTO parametres (cle, valeur) VALUES
  ('delai_min_retrait_jours', '30'::jsonb),
  ('frais_retrait_pourcent', '0'::jsonb),
  ('frais_retrait_fixe', '0'::jsonb)
ON CONFLICT (cle) DO NOTHING;

-- Fonction atomique de validation d'une demande de retrait d'épargne
CREATE OR REPLACE FUNCTION valider_demande_retrait(
  p_demande_id UUID,
  p_admin_id UUID,
  p_motif TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_demande RECORD;
  v_membre RECORD;
  v_solde_disponible INTEGER;
  v_retrait_id UUID;
  v_frais_retrait INTEGER := 0;
  v_taux_frais INTEGER := 0;
  v_delai_min INTEGER := 30;
  v_anciennete_jours INTEGER;
BEGIN
  -- 1. Récupérer la demande
  SELECT * INTO v_demande FROM operations WHERE id = p_demande_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande de retrait introuvable';
  END IF;

  IF v_demande.type <> 'demande_retrait' THEN
    RAISE EXCEPTION 'Cette opération n''est pas une demande de retrait';
  END IF;

  -- Vérifier si déjà traitée dans decisions_demandes
  IF EXISTS (SELECT 1 FROM decisions_demandes WHERE demande_id = p_demande_id) THEN
    RAISE EXCEPTION 'Cette demande a déjà fait l''objet d''une décision';
  END IF;

  -- 2. Récupérer le membre et vérifier l'ancienneté
  SELECT * INTO v_membre FROM membres WHERE id = v_demande.membre_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membre introuvable';
  END IF;

  -- Vérifier le délai minimal d'ancienneté
  SELECT COALESCE((valeur #>> '{}')::INTEGER, 30) INTO v_delai_min
  FROM parametres WHERE cle = 'delai_min_retrait_jours';

  v_anciennete_jours := CURRENT_DATE - v_membre.cree_le::DATE;
  IF v_delai_min > 0 AND v_anciennete_jours < v_delai_min THEN
    RAISE EXCEPTION 'Délai minimal d''ancienneté non atteint (% jours requis, % jours actuels)',
      v_delai_min, v_anciennete_jours;
  END IF;

  -- 3. Vérifier le solde disponible côté serveur (vue soldes_membres)
  SELECT COALESCE(solde, 0) INTO v_solde_disponible
  FROM soldes_membres
  WHERE membre_id = v_demande.membre_id AND volet = 'mara';

  IF v_solde_disponible IS NULL OR v_solde_disponible < v_demande.montant THEN
    RAISE EXCEPTION 'Solde insuffisant : solde disponible = % F, montant demandé = % F',
      COALESCE(v_solde_disponible, 0), v_demande.montant;
  END IF;

  -- 4. Créer l'opération de retrait validée (dépense pour l'épargne)
  v_retrait_id := gen_random_uuid();
  INSERT INTO operations (
    id, type, volet, membre_id, agent_id, montant, jours_couverts,
    date_operation, statut, motif
  ) VALUES (
    v_retrait_id,
    'retrait',
    'mara',
    v_demande.membre_id,
    v_demande.agent_id,
    v_demande.montant,
    1,
    CURRENT_DATE,
    'validee',
    COALESCE(p_motif, format('Retrait d''épargne validé suite à demande %s', p_demande_id))
  );

  -- 5. Créer le mouvement de caisse sortant
  INSERT INTO caisse_mouvements (
    type, montant, libelle, reference_id, reference_type, date_mouvement
  ) VALUES (
    'sortie',
    v_demande.montant,
    format('Retrait épargne Ika-Mara - membre %s (%s %s)', v_membre.numero, v_membre.prenom, v_membre.nom),
    v_retrait_id,
    'retrait',
    CURRENT_DATE
  );

  -- 6. Enregistrer la décision
  INSERT INTO decisions_demandes (
    demande_id, agent_id, decision, montant_accorde, motif, decide_par
  ) VALUES (
    p_demande_id,
    v_demande.agent_id,
    'acceptee',
    v_demande.montant,
    p_motif,
    p_admin_id
  );

  -- 7. Audit log
  INSERT INTO audit_log (qui, quoi, avant, apres, details)
  VALUES (
    p_admin_id,
    'validation_demande_retrait',
    to_jsonb(v_demande),
    jsonb_build_object('retrait_id', v_retrait_id, 'montant', v_demande.montant),
    format('Validation du retrait de %s F pour le membre %s (%s)',
      v_demande.montant, v_membre.numero, v_membre.nom)
  );

  RETURN v_retrait_id;
END;
$$;

-- Fonction de refus d'une demande de retrait
CREATE OR REPLACE FUNCTION rejeter_demande_retrait(
  p_demande_id UUID,
  p_admin_id UUID,
  p_motif TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_demande RECORD;
  v_membre RECORD;
BEGIN
  IF p_motif IS NULL OR length(trim(p_motif)) = 0 THEN
    RAISE EXCEPTION 'Le motif de refus est obligatoire';
  END IF;

  SELECT * INTO v_demande FROM operations WHERE id = p_demande_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;

  IF EXISTS (SELECT 1 FROM decisions_demandes WHERE demande_id = p_demande_id) THEN
    RAISE EXCEPTION 'Cette demande a déjà fait l''objet d''une décision';
  END IF;

  SELECT * INTO v_membre FROM membres WHERE id = v_demande.membre_id;

  INSERT INTO decisions_demandes (
    demande_id, agent_id, decision, motif, decide_par
  ) VALUES (
    p_demande_id,
    v_demande.agent_id,
    'rejetee',
    trim(p_motif),
    p_admin_id
  );

  INSERT INTO audit_log (qui, quoi, avant, apres, details)
  VALUES (
    p_admin_id,
    'rejet_demande_retrait',
    to_jsonb(v_demande),
    jsonb_build_object('decision', 'rejetee', 'motif', trim(p_motif)),
    format('Rejet de la demande de retrait %s pour le membre %s : %s',
      p_demande_id, COALESCE(v_membre.numero, '—'), trim(p_motif))
  );
END;
$$;

-- ===== 011_pari_admin.sql =====
-- =============================================================================
-- IKA-MARA — Migration 011 : Administration Ika-Pari (Tontines rotatives)
-- =============================================================================
-- Gère les cycles de tontine, l'ordre de passage (tirage au sort / manuel),
-- les tours, la détection des retards de cotisation, la suspension pour défaut
-- avec application de pénalité, et le décaissement atomique sécurisé avec
-- retenue de commission et sortie de caisse.
-- =============================================================================

-- 1. EXTENSIONS DE TABLES EXISTANTES
-- Cycles Pari
ALTER TABLE cycles_pari ADD COLUMN IF NOT EXISTS part_journaliere INTEGER NOT NULL DEFAULT 1000 CHECK (part_journaliere > 0);
ALTER TABLE cycles_pari ADD COLUMN IF NOT EXISTS duree_tour_jours INTEGER NOT NULL DEFAULT 30 CHECK (duree_tour_jours > 0);
ALTER TABLE cycles_pari ADD COLUMN IF NOT EXISTS nombre_participants INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cycles_pari ADD COLUMN IF NOT EXISTS tour_courant INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cycles_pari ADD COLUMN IF NOT EXISTS methode_ordre TEXT NOT NULL DEFAULT 'manuel' CHECK (methode_ordre IN ('manuel', 'tirage_au_sort'));
ALTER TABLE cycles_pari ADD COLUMN IF NOT EXISTS parts_commission INTEGER NOT NULL DEFAULT 1;

-- Participants Pari
ALTER TABLE participants_pari ADD COLUMN IF NOT EXISTS statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu'));
ALTER TABLE participants_pari ADD COLUMN IF NOT EXISTS motif_suspension TEXT;
ALTER TABLE participants_pari ADD COLUMN IF NOT EXISTS date_suspension TIMESTAMPTZ;
ALTER TABLE participants_pari ADD COLUMN IF NOT EXISTS penalite_appliquee INTEGER NOT NULL DEFAULT 0;

-- Tours Pari
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS date_debut DATE;
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS date_fin DATE;
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS montant_cagnotte INTEGER;
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS montant_commission INTEGER DEFAULT 0;
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS montant_net INTEGER;
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS date_decaissement TIMESTAMPTZ;
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS decaisse_par UUID REFERENCES profiles(id);
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS operation_decaissement_id UUID REFERENCES operations(id);
ALTER TABLE tours_pari ADD COLUMN IF NOT EXISTS caisse_mouvement_id UUID REFERENCES caisse_mouvements(id);

-- 2. PARAMÈTRES PAR DÉFAUT
INSERT INTO parametres (cle, valeur) VALUES
  ('penalite_defaut_pari_pourcent', '10'::jsonb),
  ('parts_commission_pari', '1'::jsonb)
ON CONFLICT (cle) DO NOTHING;

-- =============================================================================
-- FONCTION : creer_cycle_pari
-- =============================================================================
CREATE OR REPLACE FUNCTION creer_cycle_pari(
  p_nom TEXT,
  p_date_debut DATE,
  p_part_journaliere INTEGER,
  p_duree_tour_jours INTEGER,
  p_parts_commission INTEGER,
  p_membre_ids UUID[],
  p_admin_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cycle_id UUID;
  v_nb_participants INTEGER;
  v_montant_pot INTEGER;
  v_i INTEGER;
  v_date_tour_debut DATE;
  v_date_tour_fin DATE;
BEGIN
  v_nb_participants := array_length(p_membre_ids, 1);
  IF v_nb_participants IS NULL OR v_nb_participants < 2 THEN
    RAISE EXCEPTION 'Un cycle de tontine doit comporter au moins 2 participants.';
  END IF;

  IF p_part_journaliere <= 0 THEN
    RAISE EXCEPTION 'La part journalière doit être supérieure à zéro.';
  END IF;

  IF p_duree_tour_jours <= 0 THEN
    RAISE EXCEPTION 'La durée d''un tour doit être supérieure à zéro.';
  END IF;

  -- Montant de la cagnotte par tour = part_journaliere * duree_tour_jours * nb_participants
  v_montant_pot := p_part_journaliere * p_duree_tour_jours * v_nb_participants;

  -- 1. Création du cycle
  INSERT INTO cycles_pari (
    nom, montant_pot, periodicite, date_debut, statut,
    part_journaliere, duree_tour_jours, nombre_participants,
    tour_courant, methode_ordre, parts_commission
  ) VALUES (
    p_nom, v_montant_pot, 'tour_' || p_duree_tour_jours || 'j', p_date_debut, 'actif',
    p_part_journaliere, p_duree_tour_jours, v_nb_participants,
    1, 'manuel', COALESCE(p_parts_commission, 1)
  ) RETURNING id INTO v_cycle_id;

  -- 2. Création des participants et des tours ordonnés
  FOR v_i IN 1..v_nb_participants LOOP
    -- Enregistrement du participant
    INSERT INTO participants_pari (
      cycle_id, membre_id, ordre, statut
    ) VALUES (
      v_cycle_id, p_membre_ids[v_i], v_i, 'actif'
    );

    -- Dates du tour
    v_date_tour_debut := p_date_debut + ((v_i - 1) * p_duree_tour_jours);
    v_date_tour_fin := v_date_tour_debut + p_duree_tour_jours - 1;

    -- Enregistrement du tour
    INSERT INTO tours_pari (
      cycle_id, numero_tour, beneficiaire_id, montant_verse,
      date_tour, date_debut, date_fin, montant_cagnotte, statut
    ) VALUES (
      v_cycle_id, v_i, p_membre_ids[v_i], v_montant_pot,
      v_date_tour_fin, v_date_tour_debut, v_date_tour_fin, v_montant_pot, 'en_attente'
    );
  END LOOP;

  -- 3. Traçabilité dans audit_log
  INSERT INTO audit_log (qui, quoi, apres, details)
  VALUES (
    p_admin_id,
    'creation_cycle_pari',
    jsonb_build_object(
      'cycle_id', v_cycle_id,
      'nom', p_nom,
      'nb_participants', v_nb_participants,
      'part_journaliere', p_part_journaliere,
      'duree_tour_jours', p_duree_tour_jours,
      'montant_pot', v_montant_pot
    ),
    format('Création du cycle de tontine « %s » avec %s participants (Pot : %s F)', p_nom, v_nb_participants, v_montant_pot)
  );

  RETURN v_cycle_id;
END;
$$;

-- =============================================================================
-- FONCTION : tirer_au_sort_ordre_pari
-- =============================================================================
CREATE OR REPLACE FUNCTION tirer_au_sort_ordre_pari(
  p_cycle_id UUID,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cycle RECORD;
  v_a_des_tours_verses BOOLEAN;
  v_shuffled RECORD;
  v_nouvel_ordre INTEGER := 1;
  v_resultats JSONB := '[]'::jsonb;
  v_date_tour_debut DATE;
  v_date_tour_fin DATE;
BEGIN
  SELECT * INTO v_cycle FROM cycles_pari WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle de tontine introuvable.';
  END IF;

  IF v_cycle.statut != 'actif' THEN
    RAISE EXCEPTION 'Le tirage au sort n''est possible que sur un cycle actif.';
  END IF;

  -- Vérifier qu'aucun tour n'a déjà été versé
  SELECT EXISTS(
    SELECT 1 FROM tours_pari WHERE cycle_id = p_cycle_id AND statut = 'verse'
  ) INTO v_a_des_tours_verses;

  IF v_a_des_tours_verses THEN
    RAISE EXCEPTION 'Impossible de relancer le tirage : des tours ont déjà été décaissés pour ce cycle.';
  END IF;

  -- Supprimer temporairement les contraintes ou mettre à jour dans une table temporaire
  CREATE TEMP TABLE tmp_tirage (
    membre_id UUID,
    nouvel_ordre INTEGER
  ) ON COMMIT DROP;

  INSERT INTO tmp_tirage (membre_id, nouvel_ordre)
  SELECT membre_id, ROW_NUMBER() OVER (ORDER BY gen_random_uuid())
  FROM participants_pari
  WHERE cycle_id = p_cycle_id;

  -- Mettre à jour participants_pari
  UPDATE participants_pari p
  SET ordre = t.nouvel_ordre
  FROM tmp_tirage t
  WHERE p.cycle_id = p_cycle_id AND p.membre_id = t.membre_id;

  -- Mettre à jour tours_pari (réassigner le bénéficiaire selon le nouvel ordre)
  UPDATE tours_pari tp
  SET beneficiaire_id = t.membre_id
  FROM tmp_tirage t
  WHERE tp.cycle_id = p_cycle_id AND tp.numero_tour = t.nouvel_ordre;

  -- Mettre à jour l'indicateur sur le cycle
  UPDATE cycles_pari
  SET methode_ordre = 'tirage_au_sort'
  WHERE id = p_cycle_id;

  -- Récupérer la liste des résultats ordonnés
  SELECT jsonb_agg(
    jsonb_build_object(
      'ordre', t.nouvel_ordre,
      'membre_id', m.id,
      'numero', m.numero,
      'nom', m.nom,
      'prenom', m.prenom
    ) ORDER BY t.nouvel_ordre
  ) INTO v_resultats
  FROM tmp_tirage t
  JOIN membres m ON m.id = t.membre_id;

  -- Journaliser le tirage figé dans audit_log
  INSERT INTO audit_log (qui, quoi, apres, details)
  VALUES (
    p_admin_id,
    'tirage_au_sort_pari',
    jsonb_build_object(
      'cycle_id', p_cycle_id,
      'ordre_resultats', v_resultats
    ),
    format('Tirage au sort effectué pour le cycle « %s »', v_cycle.nom)
  );

  RETURN v_resultats;
END;
$$;

-- =============================================================================
-- FONCTION : reordonner_participants_pari
-- =============================================================================
CREATE OR REPLACE FUNCTION reordonner_participants_pari(
  p_cycle_id UUID,
  p_ordres JSONB,
  p_admin_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cycle RECORD;
  v_elem RECORD;
BEGIN
  SELECT * INTO v_cycle FROM cycles_pari WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle introuvable.';
  END IF;

  FOR v_elem IN
    SELECT (value->>'membre_id')::UUID AS membre_id, (value->>'ordre')::INTEGER AS ordre
    FROM jsonb_array_elements(p_ordres)
  LOOP
    -- Vérifier si le tour associé a déjà été versé
    IF EXISTS(
      SELECT 1 FROM tours_pari
      WHERE cycle_id = p_cycle_id AND numero_tour = v_elem.ordre AND statut = 'verse'
    ) THEN
      RAISE EXCEPTION 'Le tour n° % a déjà été versé et ne peut plus être réordonné.', v_elem.ordre;
    END IF;

    UPDATE participants_pari
    SET ordre = v_elem.ordre
    WHERE cycle_id = p_cycle_id AND membre_id = v_elem.membre_id;

    UPDATE tours_pari
    SET beneficiaire_id = v_elem.membre_id
    WHERE cycle_id = p_cycle_id AND numero_tour = v_elem.ordre AND statut != 'verse';
  END LOOP;

  UPDATE cycles_pari
  SET methode_ordre = 'manuel'
  WHERE id = p_cycle_id;

  INSERT INTO audit_log (qui, quoi, apres, details)
  VALUES (
    p_admin_id,
    'reordonnancement_manuel_pari',
    jsonb_build_object('cycle_id', p_cycle_id, 'ordres', p_ordres),
    format('Réordonnancement manuel des participants du cycle « %s »', v_cycle.nom)
  );

  RETURN TRUE;
END;
$$;

-- =============================================================================
-- FONCTION : suspendre_participant_pari
-- =============================================================================
CREATE OR REPLACE FUNCTION suspendre_participant_pari(
  p_cycle_id UUID,
  p_membre_id UUID,
  p_motif TEXT,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cycle RECORD;
  v_part RECORD;
  v_penalite_pct INTEGER := 10;
  v_montant_penalite INTEGER;
  v_param_row RECORD;
BEGIN
  IF p_motif IS NULL OR trim(p_motif) = '' THEN
    RAISE EXCEPTION 'Le motif de suspension est obligatoire.';
  END IF;

  SELECT * INTO v_cycle FROM cycles_pari WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle introuvable.';
  END IF;

  SELECT * INTO v_part FROM participants_pari
  WHERE cycle_id = p_cycle_id AND membre_id = p_membre_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant introuvable dans ce cycle.';
  END IF;

  -- Récupérer la pénalité configurée
  SELECT valeur INTO v_param_row FROM parametres WHERE cle = 'penalite_defaut_pari_pourcent';
  IF FOUND AND v_param_row.valeur IS NOT NULL THEN
    v_penalite_pct := (v_param_row.valeur #>> '{}')::INTEGER;
  END IF;

  -- Calcul de la pénalité : % sur la part due du tour
  v_montant_penalite := (v_cycle.part_journaliere * v_cycle.duree_tour_jours * v_penalite_pct) / 100;

  UPDATE participants_pari
  SET
    statut = 'suspendu',
    motif_suspension = trim(p_motif),
    date_suspension = now(),
    penalite_appliquee = v_montant_penalite
  WHERE cycle_id = p_cycle_id AND membre_id = p_membre_id;

  INSERT INTO audit_log (qui, quoi, apres, details)
  VALUES (
    p_admin_id,
    'suspension_participant_pari',
    jsonb_build_object(
      'cycle_id', p_cycle_id,
      'membre_id', p_membre_id,
      'motif', trim(p_motif),
      'penalite', v_montant_penalite
    ),
    format('Suspension de l''adhérent dans le cycle « %s » (Pénalité : %s F). Motif : %s',
      v_cycle.nom, v_montant_penalite, trim(p_motif))
  );

  RETURN jsonb_build_object(
    'success', true,
    'penalite_appliquee', v_montant_penalite,
    'message', format('Participant suspendu avec une pénalité de %s F.', v_montant_penalite)
  );
END;
$$;

-- =============================================================================
-- FONCTION : decaisser_tour_pari (Transaction atomique sécurisée)
-- =============================================================================
CREATE OR REPLACE FUNCTION decaisser_tour_pari(
  p_tour_id UUID,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tour RECORD;
  v_cycle RECORD;
  v_beneficiaire RECORD;
  v_cagnotte_collectee INTEGER := 0;
  v_montant_commission INTEGER := 0;
  v_montant_net INTEGER := 0;
  v_op_decaissement_id UUID;
  v_op_commission_id UUID;
  v_mouv_caisse_id UUID;
  v_tours_restants INTEGER;
BEGIN
  -- 1. Récupération du tour et verrouillage
  SELECT * INTO v_tour FROM tours_pari WHERE id = p_tour_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tour introuvable.';
  END IF;

  IF v_tour.statut != 'en_attente' THEN
    RAISE EXCEPTION 'Ce tour a déjà été décaissé ou est annulé.';
  END IF;

  -- 2. Récupération du cycle
  SELECT * INTO v_cycle FROM cycles_pari WHERE id = v_tour.cycle_id FOR UPDATE;

  -- 3. Récupération du bénéficiaire
  SELECT id, numero, nom, prenom, agent_id INTO v_beneficiaire
  FROM membres WHERE id = v_tour.beneficiaire_id;

  -- 4. Calcul de la cagnotte collectée pour ce tour
  -- Somme des cotisations des participants du cycle sur le volet pari
  SELECT COALESCE(SUM(o.montant), 0) INTO v_cagnotte_collectee
  FROM operations o
  JOIN participants_pari pp ON pp.membre_id = o.membre_id AND pp.cycle_id = v_tour.cycle_id
  WHERE o.volet = 'pari'
    AND o.type = 'depot'
    AND o.statut = 'validee'
    AND o.date_operation BETWEEN v_tour.date_debut AND v_tour.date_fin;

  -- Vérifier si la cagnotte du tour est suffisante
  IF v_cagnotte_collectee < v_tour.montant_cagnotte THEN
    RAISE EXCEPTION 'Cagnotte insuffisante : % F collectés sur % F requis (manque % F).',
      v_cagnotte_collectee, v_tour.montant_cagnotte, (v_tour.montant_cagnotte - v_cagnotte_collectee);
  END IF;

  -- 5. Calcul de la commission du tour (parts × montant part journalière)
  v_montant_commission := COALESCE(v_cycle.parts_commission, 1) * v_cycle.part_journaliere;
  v_montant_net := v_tour.montant_cagnotte - v_montant_commission;

  IF v_montant_net <= 0 THEN
    RAISE EXCEPTION 'Le montant net à décaisser doit être supérieur à zéro.';
  END IF;

  -- 6. Création de l'opération financière de décaissement (net)
  v_op_decaissement_id := gen_random_uuid();
  INSERT INTO operations (
    id, type, volet, membre_id, agent_id, montant,
    jours_couverts, date_operation, statut, motif
  ) VALUES (
    v_op_decaissement_id,
    'decaissement',
    'pari',
    v_beneficiaire.id,
    COALESCE(v_beneficiaire.agent_id, p_admin_id),
    v_montant_net,
    v_cycle.duree_tour_jours,
    CURRENT_DATE,
    'validee',
    format('Décaissement tontine « %s » — Tour n° %s (Net après déduction commission)', v_cycle.nom, v_tour.numero_tour)
  );

  -- 7. Création de l'opération de commission si > 0
  IF v_montant_commission > 0 THEN
    v_op_commission_id := gen_random_uuid();
    INSERT INTO operations (
      id, type, volet, membre_id, agent_id, montant,
      jours_couverts, date_operation, statut, motif
    ) VALUES (
      v_op_commission_id,
      'commission',
      'pari',
      v_beneficiaire.id,
      COALESCE(v_beneficiaire.agent_id, p_admin_id),
      v_montant_commission,
      1,
      CURRENT_DATE,
      'validee',
      format('Commission de gestion tontine « %s » — Tour n° %s (%s part(s))', v_cycle.nom, v_tour.numero_tour, v_cycle.parts_commission)
    );
  END IF;

  -- 8. Création du mouvement de caisse sortant (décaissement physique)
  v_mouv_caisse_id := gen_random_uuid();
  INSERT INTO caisse_mouvements (
    id, type, montant, libelle, reference_id, reference_type, date_mouvement
  ) VALUES (
    v_mouv_caisse_id,
    'sortie',
    v_montant_net,
    format('Décaissement tontine « %s » (Tour %s) — Bénéficiaire : N° %s %s %s',
      v_cycle.nom, v_tour.numero_tour, v_beneficiaire.numero, v_beneficiaire.prenom, v_beneficiaire.nom),
    v_op_decaissement_id,
    'decaissement_pari',
    CURRENT_DATE
  );

  -- 9. Mise à jour du tour
  UPDATE tours_pari
  SET
    statut = 'verse',
    montant_commission = v_montant_commission,
    montant_net = v_montant_net,
    date_decaissement = now(),
    decaisse_par = p_admin_id,
    operation_decaissement_id = v_op_decaissement_id,
    caisse_mouvement_id = v_mouv_caisse_id
  WHERE id = p_tour_id;

  -- 10. Mise à jour de l'état du cycle (passage au tour suivant ou clôture)
  SELECT COUNT(*) INTO v_tours_restants
  FROM tours_pari
  WHERE cycle_id = v_cycle.id AND statut = 'en_attente';

  IF v_tours_restants = 0 THEN
    UPDATE cycles_pari
    SET
      statut = 'termine',
      date_fin = CURRENT_DATE,
      tour_courant = v_cycle.nombre_participants
    WHERE id = v_cycle.id;
  ELSE
    UPDATE cycles_pari
    SET tour_courant = v_tour.numero_tour + 1
    WHERE id = v_cycle.id;
  END IF;

  -- 11. Journalisation dans audit_log
  INSERT INTO audit_log (qui, quoi, apres, details)
  VALUES (
    p_admin_id,
    'decaissement_tour_pari',
    jsonb_build_object(
      'tour_id', p_tour_id,
      'cycle_id', v_cycle.id,
      'numero_tour', v_tour.numero_tour,
      'beneficiaire_id', v_beneficiaire.id,
      'beneficiaire_numero', v_beneficiaire.numero,
      'montant_brut', v_tour.montant_cagnotte,
      'montant_commission', v_montant_commission,
      'montant_net', v_montant_net
    ),
    format('Décaissement tour n° %s du cycle « %s » pour l''adhérent n° %s (%s F net)',
      v_tour.numero_tour, v_cycle.nom, v_beneficiaire.numero, v_montant_net)
  );

  RETURN jsonb_build_object(
    'success', true,
    'tour_id', p_tour_id,
    'numero_tour', v_tour.numero_tour,
    'beneficiaire_numero', v_beneficiaire.numero,
    'beneficiaire_nom', v_beneficiaire.prenom || ' ' || v_beneficiaire.nom,
    'montant_brut', v_tour.montant_cagnotte,
    'montant_commission', v_montant_commission,
    'montant_net', v_montant_net,
    'message', format('Décaissement réussi de %s F au profit du membre n° %s.', v_montant_net, v_beneficiaire.numero)
  );
END;
$$;

-- ===== 012_djourou_admin.sql =====
-- =============================================================================
-- IKA-MARA — Migration 012 : Administration Ika-Djourou (Crédits & Échéanciers)
-- =============================================================================
-- Gestion des demandes de crédit, validation avec échéancier automatique,
-- calcul des intérêts (durée 3, 6, 12 mois ou libre), décaissement de caisse,
-- imputation séquentielle des remboursements (partiel et anticipé),
-- et détection des retards avec calcul des pénalités.
-- =============================================================================

-- 1. EXTENSIONS DE TABLES EXISTANTES
ALTER TABLE credits ADD COLUMN IF NOT EXISTS demande_id UUID REFERENCES operations(id);
ALTER TABLE credits ADD COLUMN IF NOT EXISTS frais_dossier INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS periodicite TEXT NOT NULL DEFAULT 'mensuel' CHECK (periodicite IN ('quotidien', 'hebdomadaire', 'mensuel'));
ALTER TABLE credits ADD COLUMN IF NOT EXISTS duree_mois INTEGER NOT NULL DEFAULT 3 CHECK (duree_mois > 0);
ALTER TABLE credits ADD COLUMN IF NOT EXISTS total_interets INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS total_du INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN IF NOT EXISTS date_cloture TIMESTAMPTZ;

ALTER TABLE echeances ADD COLUMN IF NOT EXISTS montant_capital INTEGER NOT NULL DEFAULT 0;
ALTER TABLE echeances ADD COLUMN IF NOT EXISTS montant_interets INTEGER NOT NULL DEFAULT 0;
ALTER TABLE echeances ADD COLUMN IF NOT EXISTS date_paiement TIMESTAMPTZ;

-- 2. PARAMÈTRES PAR DÉFAUT POUR LE CRÉDIT
INSERT INTO parametres (cle, valeur) VALUES
  ('penalite_retard_credit_pourcent', '2'::jsonb),
  ('frais_dossier_credit_pourcent', '1'::jsonb),
  ('taux_interet_defaut_djourou', '5'::jsonb)
ON CONFLICT (cle) DO NOTHING;

-- =============================================================================
-- FONCTION : calculer_interets_credit
-- =============================================================================
-- Formule standard microfinance : (Capital × Taux Annuel × Durée Mois) / (100 × 12)
-- Toujours un entier arrondi en F CFA.
CREATE OR REPLACE FUNCTION calculer_interets_credit(
  p_montant INTEGER,
  p_taux_annuel INTEGER,
  p_duree_mois INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_montant <= 0 OR p_taux_annuel < 0 OR p_duree_mois <= 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND((p_montant::NUMERIC * p_taux_annuel::NUMERIC * p_duree_mois::NUMERIC) / (100.0 * 12.0))::INTEGER;
END;
$$;

-- =============================================================================
-- FONCTION : valider_demande_credit (Transaction atomique)
-- =============================================================================
CREATE OR REPLACE FUNCTION valider_demande_credit(
  p_demande_id UUID,
  p_admin_id UUID,
  p_montant_accorde INTEGER,
  p_taux_interet INTEGER,
  p_frais_dossier INTEGER,
  p_periodicite TEXT,
  p_duree_mois INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_demande RECORD;
  v_membre RECORD;
  v_credit_id UUID;
  v_total_interets INTEGER;
  v_total_du INTEGER;
  v_date_octroi DATE := CURRENT_DATE;
  v_date_echeance_finale DATE;
  v_nb_echeances INTEGER;
  v_capital_par_echeance INTEGER;
  v_interet_par_echeance INTEGER;
  v_cumul_capital INTEGER := 0;
  v_cumul_interet INTEGER := 0;
  v_date_ech DATE;
  v_i INTEGER;
  v_capital_ech INTEGER;
  v_interet_ech INTEGER;
  v_montant_du_ech INTEGER;
  v_net_a_decaisser INTEGER;
  v_mouv_caisse_id UUID;
BEGIN
  -- 1. Vérification de la demande
  SELECT * INTO v_demande FROM operations WHERE id = p_demande_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande de crédit introuvable.';
  END IF;

  IF v_demande.type <> 'demande_credit' THEN
    RAISE EXCEPTION 'Cette opération n''est pas une demande de crédit.';
  END IF;

  IF EXISTS (SELECT 1 FROM decisions_demandes WHERE demande_id = p_demande_id) THEN
    RAISE EXCEPTION 'Cette demande a déjà fait l''objet d''une décision.';
  END IF;

  SELECT id, numero, nom, prenom, agent_id INTO v_membre FROM membres WHERE id = v_demande.membre_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membre demandeur introuvable.';
  END IF;

  -- 2. Validation des paramètres financiers
  IF p_montant_accorde <= 0 THEN
    RAISE EXCEPTION 'Le montant accordé doit être supérieur à zéro.';
  END IF;

  IF p_duree_mois <= 0 THEN
    RAISE EXCEPTION 'La durée doit être supérieure à zéro.';
  END IF;

  -- Calcul des intérêts et du total dû
  v_total_interets := calculer_interets_credit(p_montant_accorde, p_taux_interet, p_duree_mois);
  v_total_du := p_montant_accorde + v_total_interets;

  -- Calcul du nombre d'échéances et de l'intervalle
  IF p_periodicite = 'quotidien' THEN
    v_nb_echeances := p_duree_mois * 30;
    v_date_echeance_finale := v_date_octroi + (p_duree_mois * 30);
  ELSIF p_periodicite = 'hebdomadaire' THEN
    v_nb_echeances := p_duree_mois * 4;
    v_date_echeance_finale := v_date_octroi + (p_duree_mois * 28);
  ELSE -- mensuel par défaut
    v_nb_echeances := p_duree_mois;
    v_date_echeance_finale := (v_date_octroi + (p_duree_mois || ' months')::INTERVAL)::DATE;
  END IF;

  IF v_nb_echeances <= 0 THEN
    v_nb_echeances := 1;
  END IF;

  -- 3. Création du crédit
  v_credit_id := gen_random_uuid();
  INSERT INTO credits (
    id, membre_id, montant_accorde, montant_rembourse,
    taux_interet, date_octroi, date_echeance, statut,
    agent_id, demande_id, frais_dossier, periodicite,
    duree_mois, total_interets, total_du
  ) VALUES (
    v_credit_id, v_membre.id, p_montant_accorde, 0,
    p_taux_interet, v_date_octroi, v_date_echeance_finale, 'en_cours',
    COALESCE(v_membre.agent_id, v_demande.agent_id), p_demande_id, COALESCE(p_frais_dossier, 0),
    p_periodicite, p_duree_mois, v_total_interets, v_total_du
  );

  -- 4. Génération détaillée de l'échéancier
  v_capital_par_echeance := FLOOR(p_montant_accorde::NUMERIC / v_nb_echeances::NUMERIC);
  v_interet_par_echeance := FLOOR(v_total_interets::NUMERIC / v_nb_echeances::NUMERIC);

  FOR v_i IN 1..v_nb_echeances LOOP
    -- Calcul de la date de l'échéance
    IF p_periodicite = 'quotidien' THEN
      v_date_ech := v_date_octroi + v_i;
    ELSIF p_periodicite = 'hebdomadaire' THEN
      v_date_ech := v_date_octroi + (v_i * 7);
    ELSE
      v_date_ech := (v_date_octroi + (v_i || ' months')::INTERVAL)::DATE;
    END IF;

    -- Ajustement sur la dernière échéance pour compenser les arrondis
    IF v_i = v_nb_echeances THEN
      v_capital_ech := p_montant_accorde - v_cumul_capital;
      v_interet_ech := v_total_interets - v_cumul_interet;
    ELSE
      v_capital_ech := v_capital_par_echeance;
      v_interet_ech := v_interet_par_echeance;
      v_cumul_capital := v_cumul_capital + v_capital_par_echeance;
      v_cumul_interet := v_cumul_interet + v_interet_par_echeance;
    END IF;

    v_montant_du_ech := v_capital_ech + v_interet_ech;

    INSERT INTO echeances (
      credit_id, numero, montant_du, montant_paye,
      date_echeance, statut, montant_capital, montant_interets
    ) VALUES (
      v_credit_id, v_i, v_montant_du_ech, 0,
      v_date_ech, 'a_payer', v_capital_ech, v_interet_ech
    );
  END LOOP;

  -- 5. Décaissement de caisse sortant
  v_net_a_decaisser := p_montant_accorde - COALESCE(p_frais_dossier, 0);
  v_mouv_caisse_id := gen_random_uuid();

  INSERT INTO caisse_mouvements (
    id, type, montant, libelle, reference_id, reference_type, date_mouvement
  ) VALUES (
    v_mouv_caisse_id,
    'sortie',
    v_net_a_decaisser,
    format('Octroi crédit Ika-Djourou N° %s — Membre N° %s (%s %s) Net décaissé',
      v_credit_id, v_membre.numero, v_membre.prenom, v_membre.nom),
    v_credit_id,
    'credit_djourou',
    CURRENT_DATE
  );

  -- 6. Enregistrement de la décision
  INSERT INTO decisions_demandes (
    demande_id, agent_id, decision, montant_accorde,
    motif, decide_par
  ) VALUES (
    p_demande_id, v_demande.agent_id, 'acceptee', p_montant_accorde,
    format('Crédit accordé : %s F sur %s mois (%s). Intérêts : %s F. Frais : %s F.',
      p_montant_accorde, p_duree_mois, p_periodicite, v_total_interets, p_frais_dossier),
    p_admin_id
  );

  -- 7. Audit log
  INSERT INTO audit_log (qui, quoi, apres, details)
  VALUES (
    p_admin_id,
    'octroi_credit_djourou',
    jsonb_build_object(
      'credit_id', v_credit_id,
      'demande_id', p_demande_id,
      'membre_numero', v_membre.numero,
      'montant_accorde', p_montant_accorde,
      'total_interets', v_total_interets,
      'total_du', v_total_du,
      'duree_mois', p_duree_mois,
      'frais_dossier', p_frais_dossier
    ),
    format('Octroi du crédit Ika-Djourou de %s F au membre n° %s sur %s mois',
      p_montant_accorde, v_membre.numero, p_duree_mois)
  );

  RETURN v_credit_id;
END;
$$;

-- =============================================================================
-- FONCTION : rejeter_demande_credit
-- =============================================================================
CREATE OR REPLACE FUNCTION rejeter_demande_credit(
  p_demande_id UUID,
  p_admin_id UUID,
  p_motif TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_demande RECORD;
BEGIN
  IF p_motif IS NULL OR trim(p_motif) = '' THEN
    RAISE EXCEPTION 'Le motif du refus est obligatoire.';
  END IF;

  SELECT * INTO v_demande FROM operations WHERE id = p_demande_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable.';
  END IF;

  IF EXISTS (SELECT 1 FROM decisions_demandes WHERE demande_id = p_demande_id) THEN
    RAISE EXCEPTION 'Cette demande a déjà été traitée.';
  END IF;

  INSERT INTO decisions_demandes (
    demande_id, agent_id, decision, motif, decide_par
  ) VALUES (
    p_demande_id, v_demande.agent_id, 'rejetee', trim(p_motif), p_admin_id
  );

  INSERT INTO audit_log (qui, quoi, details)
  VALUES (
    p_admin_id,
    'rejet_demande_credit',
    format('Rejet de la demande de crédit %s. Motif : %s', p_demande_id, trim(p_motif))
  );

  RETURN TRUE;
END;
$$;

-- =============================================================================
-- FONCTION : imputer_remboursement_credit
-- =============================================================================
-- Imputation séquentielle d'un remboursement sur les échéances les plus anciennes.
-- Supporte le remboursement partiel, normal et anticipé.
CREATE OR REPLACE FUNCTION imputer_remboursement_credit(
  p_credit_id UUID,
  p_montant INTEGER,
  p_agent_id UUID,
  p_motif TEXT DEFAULT NULL,
  p_est_anticipe BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_credit RECORD;
  v_membre RECORD;
  v_reste_a_imputer INTEGER;
  v_ech RECORD;
  v_du_ech INTEGER;
  v_a_payer_ech INTEGER;
  v_nouveau_paye INTEGER;
  v_remise_interets INTEGER := 0;
  v_total_deja_rembourse INTEGER;
  v_op_remboursement_id UUID;
  v_mouv_caisse_id UUID;
  v_echeances_soldees INTEGER := 0;
BEGIN
  IF p_montant <= 0 THEN
    RAISE EXCEPTION 'Le montant du remboursement doit être supérieur à zéro.';
  END IF;

  SELECT * INTO v_credit FROM credits WHERE id = p_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Crédit introuvable.';
  END IF;

  IF v_credit.statut = 'rembourse' THEN
    RAISE EXCEPTION 'Ce crédit a déjà été intégralement remboursé.';
  END IF;

  SELECT id, numero, nom, prenom INTO v_membre FROM membres WHERE id = v_credit.membre_id;

  v_reste_a_imputer := p_montant;

  -- Remboursement anticipé intégral : remise des intérêts sur les échéances futures non échues
  IF p_est_anticipe THEN
    SELECT COALESCE(SUM(montant_interets), 0) INTO v_remise_interets
    FROM echeances
    WHERE credit_id = p_credit_id
      AND statut = 'a_payer'
      AND date_echeance > CURRENT_DATE;

    -- Si remise applicable
    IF v_remise_interets > 0 THEN
      UPDATE credits
      SET total_interets = total_interets - v_remise_interets,
          total_du = total_du - v_remise_interets
      WHERE id = p_credit_id;
    END IF;
  END IF;

  -- 1. Parcours ordonné des échéances non soldées
  FOR v_ech IN
    SELECT * FROM echeances
    WHERE credit_id = p_credit_id AND statut <> 'paye'
    ORDER BY numero ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_reste_a_imputer <= 0;

    v_du_ech := v_ech.montant_du - v_ech.montant_paye;

    IF v_reste_a_imputer >= v_du_ech THEN
      -- Échéance totalement soldée
      UPDATE echeances
      SET montant_paye = montant_du,
          statut = 'paye',
          date_paiement = now()
      WHERE id = v_ech.id;

      v_reste_a_imputer := v_reste_a_imputer - v_du_ech;
      v_echeances_soldees := v_echeances_soldees + 1;
    ELSE
      -- Échéance partiellement payée
      UPDATE echeances
      SET montant_paye = montant_paye + v_reste_a_imputer,
          date_paiement = now()
      WHERE id = v_ech.id;

      v_reste_a_imputer := 0;
    END IF;
  END LOOP;

  -- 2. Mise à jour du crédit
  v_total_deja_rembourse := v_credit.montant_rembourse + p_montant;

  UPDATE credits
  SET
    montant_rembourse = v_total_deja_rembourse,
    statut = CASE WHEN v_total_deja_rembourse >= total_du THEN 'rembourse' ELSE 'en_cours' END,
    date_cloture = CASE WHEN v_total_deja_rembourse >= total_du THEN now() ELSE NULL END
  WHERE id = p_credit_id;

  -- 3. Enregistrement financier de l'opération remboursement
  v_op_remboursement_id := gen_random_uuid();
  INSERT INTO operations (
    id, type, volet, membre_id, agent_id, montant,
    jours_couverts, date_operation, statut, motif
  ) VALUES (
    v_op_remboursement_id,
    'remboursement',
    'djourou',
    v_membre.id,
    p_agent_id,
    p_montant,
    1,
    CURRENT_DATE,
    'validee',
    COALESCE(p_motif, format('Remboursement crédit N° %s (%s échéance(s) soldée(s))', v_credit.id, v_echeances_soldees))
  );

  -- 4. Entrée de caisse
  v_mouv_caisse_id := gen_random_uuid();
  INSERT INTO caisse_mouvements (
    id, type, montant, libelle, reference_id, reference_type, date_mouvement
  ) VALUES (
    v_mouv_caisse_id,
    'entree',
    p_montant,
    format('Remboursement crédit Ika-Djourou — Membre N° %s (%s %s)',
      v_membre.numero, v_membre.prenom, v_membre.nom),
    v_op_remboursement_id,
    'remboursement_credit',
    CURRENT_DATE
  );

  -- 5. Audit log
  INSERT INTO audit_log (qui, quoi, details)
  VALUES (
    p_agent_id,
    'remboursement_credit_djourou',
    format('Remboursement de %s F sur le crédit %s (Membre N° %s). Reste dû : %s F',
      p_montant, p_credit_id, v_membre.numero, GREATEST(0, v_credit.total_du - v_total_deja_rembourse))
  );

  RETURN jsonb_build_object(
    'success', true,
    'credit_id', p_credit_id,
    'montant_rembourse', p_montant,
    'echeances_soldees', v_echeances_soldees,
    'solde_restant', GREATEST(0, v_credit.total_du - v_total_deja_rembourse),
    'est_cloture', v_total_deja_rembourse >= v_credit.total_du,
    'remise_interets', v_remise_interets
  );
END;
$$;

-- ===== 013_commissions_admin.sql =====
-- =============================================================================
-- IKA-MARA — Migration 013 : Administration des Commissions & Clôture Mensuelle
-- =============================================================================
-- 1. Table de suivi des clôtures mensuelles (clotures_mensuelles)
-- 2. Paramètres de calcul des commissions (mois incomplet, moment de prélèvement)
-- 3. Contrainte d'unicité stricte sur les commissions mensuelles
-- 4. Fonction idempotente cloturer_mois(annee, mois, admin_id)
-- =============================================================================

-- 1. TABLE : clotures_mensuelles
CREATE TABLE IF NOT EXISTS clotures_mensuelles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  annee               INTEGER NOT NULL CHECK (annee >= 2024),
  mois                INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
  nombre_commissions  INTEGER NOT NULL DEFAULT 0,
  montant_total       INTEGER NOT NULL DEFAULT 0 CHECK (montant_total >= 0),
  cloture_par         UUID REFERENCES profiles(id),
  cloture_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  details             JSONB,
  UNIQUE(annee, mois)
);

CREATE INDEX IF NOT EXISTS idx_clotures_annee_mois ON clotures_mensuelles(annee, mois);

-- RLS : accès réservé à l'administrateur (le serveur passe par la clé service)
ALTER TABLE clotures_mensuelles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clotures_select ON clotures_mensuelles;
CREATE POLICY clotures_select ON clotures_mensuelles
  FOR SELECT USING (is_admin());

-- 2. PARAMÈTRES PAR DÉFAUT
INSERT INTO parametres (cle, valeur) VALUES
  ('regle_mois_incomplet_commission', '"proportionnelle"'::jsonb),
  ('prelevement_commission_moment', '"cloture_mois"'::jsonb),
  ('commission_verifier_solde', 'true'::jsonb)
ON CONFLICT (cle) DO NOTHING;

-- 3. INDEX UNIQUE D'IDEMPOTENCE POUR LES COMMISSIONS MENSUELLES
-- Empêche formellement au niveau de la base qu'un membre soit prélevé deux fois
-- pour le même volet dans le même mois calendaire.
-- Fonction IMMUTABLE (obligatoire dans une expression d'index) : 1er jour du mois
CREATE OR REPLACE FUNCTION mois_operation(p_date DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT make_date(EXTRACT(YEAR FROM p_date)::INTEGER, EXTRACT(MONTH FROM p_date)::INTEGER, 1);
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_mensuelle_unique
  ON operations (membre_id, volet, mois_operation(date_operation))
  WHERE type = 'commission' AND statut = 'validee';

-- =============================================================================
-- 4. FONCTION RÉVISÉE : cloturer_mois(annee, mois, admin_id)
-- =============================================================================
-- Supprime l'ancienne version à 2 arguments (migration 003) : sinon un appel
-- cloturer_mois(annee, mois) serait ambigu avec la nouvelle signature.
DROP FUNCTION IF EXISTS cloturer_mois(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION cloturer_mois(
  p_annee INTEGER,
  p_mois INTEGER,
  p_admin_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date_debut DATE;
  v_date_fin   DATE;
  v_nb_jours_mois INTEGER;
  v_count      INTEGER := 0;
  v_total      INTEGER := 0;
  v_souscription RECORD;
  v_commission INTEGER;
  v_regle_incomplet TEXT := 'proportionnelle';
  v_verifier_solde BOOLEAN := TRUE;
  v_param_row RECORD;
  v_existe BOOLEAN;
  v_jours_actifs INTEGER;
  v_solde_disponible INTEGER;
  v_cloture_existante RECORD;
  v_op_id UUID;
BEGIN
  -- 1. Vérification si la clôture a déjà été exécutée pour ce mois
  SELECT * INTO v_cloture_existante
  FROM clotures_mensuelles
  WHERE annee = p_annee AND mois = p_mois;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'deja_cloture', true,
      'message', format('Le mois %s/%s a déjà été clôturé le %s.',
        p_mois, p_annee, to_char(v_cloture_existante.cloture_le, 'DD/MM/YYYY à HH24:MI')),
      'nombre_commissions', v_cloture_existante.nombre_commissions,
      'montant_total', v_cloture_existante.montant_total,
      'cloture_le', v_cloture_existante.cloture_le
    );
  END IF;

  -- 2. Calcul des dates du mois
  v_date_debut := make_date(p_annee, p_mois, 1);
  v_date_fin   := (v_date_debut + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  v_nb_jours_mois := EXTRACT(DAY FROM v_date_fin)::INTEGER;

  -- 3. Récupération des paramètres appliqués
  SELECT valeur INTO v_param_row FROM parametres WHERE cle = 'regle_mois_incomplet_commission';
  IF FOUND AND v_param_row.valeur IS NOT NULL THEN
    v_regle_incomplet := v_param_row.valeur #>> '{}';
  END IF;

  SELECT valeur INTO v_param_row FROM parametres WHERE cle = 'commission_verifier_solde';
  IF FOUND AND v_param_row.valeur IS NOT NULL THEN
    v_verifier_solde := (v_param_row.valeur #>> '{}')::BOOLEAN;
  END IF;

  -- 4. Parcours des souscriptions actives
  FOR v_souscription IN
    SELECT
      s.id AS souscription_id,
      s.membre_id,
      s.volet,
      s.montant_jour,
      s.parts_commission,
      s.date_debut,
      m.numero AS membre_numero,
      m.nom AS membre_nom,
      m.prenom AS membre_prenom,
      m.agent_id
    FROM souscriptions s
    JOIN membres m ON m.id = s.membre_id
    WHERE s.statut = 'active'
      AND s.date_debut <= v_date_fin
    ORDER BY m.numero ASC
  LOOP
    -- Vérifier si une commission existe déjà pour ce mois et ce volet
    SELECT EXISTS(
      SELECT 1 FROM operations
      WHERE type = 'commission'
        AND volet = v_souscription.volet
        AND membre_id = v_souscription.membre_id
        AND date_operation BETWEEN v_date_debut AND v_date_fin
        AND statut = 'validee'
    ) INTO v_existe;

    IF NOT v_existe THEN
      -- Calcul de la commission mensuelle de base
      v_commission := v_souscription.parts_commission * v_souscription.montant_jour;

      -- Gestion du mois incomplet si adhésion en cours de mois
      IF v_souscription.date_debut > v_date_debut AND v_regle_incomplet = 'proportionnelle' THEN
        v_jours_actifs := (v_date_fin - v_souscription.date_debut + 1);
        IF v_jours_actifs < v_nb_jours_mois AND v_nb_jours_mois > 0 THEN
          v_commission := ROUND((v_commission::NUMERIC * v_jours_actifs::NUMERIC) / v_nb_jours_mois::NUMERIC)::INTEGER;
        END IF;
      END IF;

      -- Vérification du solde si volet épargne (mara)
      IF v_verifier_solde AND v_souscription.volet = 'mara' THEN
        SELECT solde INTO v_solde_disponible
        FROM soldes_membres
        WHERE membre_id = v_souscription.membre_id AND volet = 'mara';

        -- Si le solde est nul ou insuffisant, on ajuste au solde si > 0, sinon 0 F
        IF v_solde_disponible IS NOT NULL AND v_solde_disponible < v_commission THEN
          v_commission := GREATEST(0, v_solde_disponible);
        END IF;
      END IF;

      -- Insertion de l'opération de commission si > 0
      IF v_commission > 0 THEN
        v_op_id := gen_random_uuid();
        INSERT INTO operations (
          id, type, volet, membre_id, agent_id, montant,
          jours_couverts, date_operation, statut, motif
        ) VALUES (
          v_op_id,
          'commission',
          v_souscription.volet,
          v_souscription.membre_id,
          COALESCE(v_souscription.agent_id, p_admin_id),
          v_commission,
          1,
          v_date_fin,
          'validee',
          format('Commission mensuelle %s/%s — %s part(s) × %s F (Volet %s)',
            lpad(p_mois::text, 2, '0'), p_annee,
            v_souscription.parts_commission,
            v_souscription.montant_jour,
            v_souscription.volet)
        );

        v_count := v_count + 1;
        v_total := v_total + v_commission;
      END IF;
    END IF;
  END LOOP;

  -- 5. Enregistrement de la clôture
  INSERT INTO clotures_mensuelles (
    annee, mois, nombre_commissions, montant_total, cloture_par, details
  ) VALUES (
    p_annee, p_mois, v_count, v_total, p_admin_id,
    jsonb_build_object(
      'date_execution', now(),
      'regle_incomplet', v_regle_incomplet,
      'verifier_solde', v_verifier_solde
    )
  );

  -- 6. Journalisation dans audit_log
  INSERT INTO audit_log (qui, quoi, apres, details)
  VALUES (
    p_admin_id,
    'cloture_mensuelle',
    jsonb_build_object(
      'annee', p_annee,
      'mois', p_mois,
      'nombre_commissions', v_count,
      'montant_total', v_total
    ),
    format('Clôture mensuelle %s/%s effectuée : %s commissions prélevées pour un total de %s F',
      lpad(p_mois::text, 2, '0'), p_annee, v_count, v_total)
  );

  RETURN jsonb_build_object(
    'success', true,
    'deja_cloture', false,
    'annee', p_annee,
    'mois', p_mois,
    'nombre_commissions', v_count,
    'montant_total', v_total,
    'message', format('Clôture du mois %s/%s réussie : %s commissions prélevées (%s F).',
      lpad(p_mois::text, 2, '0'), p_annee, v_count, v_total)
  );
END;
$$;

-- ===== 014_caisse_admin.sql =====
-- =============================================================================
-- IKA-MARA — Migration 014 : Caisse & Remises de collecte & Banque
-- =============================================================================
-- 1. Extensions remises_collecte (statut 'ecart', commentaire_admin, caisse_mouvement_id)
-- 2. Extensions caisse_mouvements et banque_mouvements (annule_ref, motif)
-- 3. Vue solde_banque et vue des mouvements avec solde cumulé
-- 4. Fonctions atomiques :
--    - confirmer_remise_collecte
--    - ajouter_mouvement_caisse (manuel)
--    - ajouter_mouvement_banque (manuel)
--    - transferer_caisse_banque (caisse <-> banque atomique)
--    - annuler_mouvement_caisse (mouvement inverse lié)
--    - annuler_mouvement_banque (mouvement inverse lié)
-- =============================================================================

-- 1. EXTENSIONS REMISES DE COLLECTE
ALTER TABLE remises_collecte DROP CONSTRAINT IF EXISTS remises_collecte_statut_check;
ALTER TABLE remises_collecte ADD CONSTRAINT remises_collecte_statut_check
  CHECK (statut IN ('a_confirmer', 'validee', 'rejetee', 'ecart'));

ALTER TABLE remises_collecte ADD COLUMN IF NOT EXISTS commentaire_admin TEXT;
ALTER TABLE remises_collecte ADD COLUMN IF NOT EXISTS caisse_mouvement_id UUID REFERENCES caisse_mouvements(id);

-- 2. EXTENSIONS CAISSE & BANQUE POUR IMMUABILITÉ (MOUVEMENTS INVERSES)
ALTER TABLE caisse_mouvements ADD COLUMN IF NOT EXISTS annule_ref UUID REFERENCES caisse_mouvements(id);
ALTER TABLE caisse_mouvements ADD COLUMN IF NOT EXISTS motif TEXT;

ALTER TABLE banque_mouvements ADD COLUMN IF NOT EXISTS annule_ref UUID REFERENCES banque_mouvements(id);
ALTER TABLE banque_mouvements ADD COLUMN IF NOT EXISTS motif TEXT;

-- 3. VUE : solde_banque
CREATE OR REPLACE VIEW solde_banque AS
SELECT
  COALESCE(SUM(CASE WHEN type = 'entree' THEN montant ELSE 0 END), 0) AS total_entrees,
  COALESCE(SUM(CASE WHEN type = 'sortie' THEN montant ELSE 0 END), 0) AS total_sorties,
  COALESCE(SUM(CASE WHEN type = 'entree' THEN montant ELSE -montant END), 0) AS solde
FROM banque_mouvements;

-- =============================================================================
-- 4. FONCTION : confirmer_remise_collecte
-- =============================================================================
CREATE OR REPLACE FUNCTION confirmer_remise_collecte(
  p_remise_id UUID,
  p_admin_id UUID,
  p_commentaire TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_remise RECORD;
  v_agent RECORD;
  v_statut_final TEXT;
  v_caisse_id UUID := NULL;
  v_libelle TEXT;
BEGIN
  SELECT * INTO v_remise FROM remises_collecte WHERE id = p_remise_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Remise de collecte introuvable.';
  END IF;

  IF v_remise.statut <> 'a_confirmer' THEN
    RAISE EXCEPTION 'Cette remise a déjà été traitée (statut : %).', v_remise.statut;
  END IF;

  SELECT id, nom, identifiant INTO v_agent FROM profiles WHERE id = v_remise.agent_id;

  -- Déterminer le statut final
  IF v_remise.ecart <> 0 THEN
    v_statut_final := 'ecart';
  ELSE
    v_statut_final := 'validee';
  END IF;

  -- Création du mouvement de caisse entrant si le montant remis est > 0
  IF v_remise.montant_remis > 0 THEN
    v_caisse_id := gen_random_uuid();
    v_libelle := format('Remise collecte — Agent %s (%s) du %s%s',
      v_agent.nom, v_agent.identifiant, to_char(v_remise.date_remise, 'DD/MM/YYYY'),
      CASE WHEN v_remise.ecart <> 0 THEN format(' [Écart : %s F]', v_remise.ecart) ELSE '' END
    );

    INSERT INTO caisse_mouvements (
      id, type, montant, libelle, reference_id, reference_type, date_mouvement
    ) VALUES (
      v_caisse_id,
      'entree',
      v_remise.montant_remis,
      v_libelle,
      p_remise_id,
      'remise_collecte',
      CURRENT_DATE
    );
  END IF;

  -- Mise à jour de la remise
  UPDATE remises_collecte
  SET
    statut = v_statut_final,
    confirme_par = p_admin_id,
    confirme_le = now(),
    commentaire_admin = p_commentaire,
    caisse_mouvement_id = v_caisse_id
  WHERE id = p_remise_id;

  -- Journalisation dans audit_log
  INSERT INTO audit_log (qui, quoi, apres, details)
  VALUES (
    p_admin_id,
    'confirmation_remise_collecte',
    jsonb_build_object(
      'remise_id', p_remise_id,
      'agent_id', v_remise.agent_id,
      'montant_attendu', v_remise.montant_attendu,
      'montant_remis', v_remise.montant_remis,
      'ecart', v_remise.ecart,
      'statut', v_statut_final,
      'caisse_mouvement_id', v_caisse_id
    ),
    format('Confirmation remise de collecte agent %s (Remis : %s F, Écart : %s F) -> Statut %s',
      v_agent.nom, v_remise.montant_remis, v_remise.ecart, v_statut_final)
  );

  RETURN jsonb_build_object(
    'success', true,
    'remise_id', p_remise_id,
    'statut', v_statut_final,
    'montant_remis', v_remise.montant_remis,
    'ecart', v_remise.ecart,
    'caisse_mouvement_id', v_caisse_id,
    'message', format('Remise confirmée (Statut : %s). Entrée de caisse enregistrée.', v_statut_final)
  );
END;
$$;

-- =============================================================================
-- 5. FONCTION : ajouter_mouvement_caisse (Manuel avec motif obligatoire)
-- =============================================================================
CREATE OR REPLACE FUNCTION ajouter_mouvement_caisse(
  p_type mouvement_type,
  p_montant INTEGER,
  p_libelle TEXT,
  p_motif TEXT,
  p_admin_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_solde INTEGER;
BEGIN
  IF p_montant <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être supérieur à zéro.';
  END IF;

  IF p_motif IS NULL OR trim(p_motif) = '' THEN
    RAISE EXCEPTION 'Le motif justificatif est obligatoire pour toute saisie manuelle.';
  END IF;

  -- En cas de sortie manuelle, vérifier que le solde de caisse est suffisant
  IF p_type = 'sortie' THEN
    SELECT solde INTO v_solde FROM solde_caisse;
    IF v_solde IS NULL OR v_solde < p_montant THEN
      RAISE EXCEPTION 'Solde de caisse insuffisant (% F disponibles pour une sortie de % F).',
        COALESCE(v_solde, 0), p_montant;
    END IF;
  END IF;

  INSERT INTO caisse_mouvements (
    id, type, montant, libelle, motif, reference_type, date_mouvement
  ) VALUES (
    v_id,
    p_type,
    p_montant,
    p_libelle,
    trim(p_motif),
    'saisie_manuelle',
    CURRENT_DATE
  );

  INSERT INTO audit_log (qui, quoi, details)
  VALUES (
    p_admin_id,
    'mouvement_caisse_manuel',
    format('Mouvement manuel de caisse [%s] de %s F. Libellé : %s. Motif : %s',
      p_type, p_montant, p_libelle, trim(p_motif))
  );

  RETURN v_id;
END;
$$;

-- =============================================================================
-- 6. FONCTION : ajouter_mouvement_banque (Manuel avec motif)
-- =============================================================================
CREATE OR REPLACE FUNCTION ajouter_mouvement_banque(
  p_type mouvement_type,
  p_montant INTEGER,
  p_libelle TEXT,
  p_motif TEXT,
  p_admin_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_solde INTEGER;
BEGIN
  IF p_montant <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être supérieur à zéro.';
  END IF;

  IF p_type = 'sortie' THEN
    SELECT solde INTO v_solde FROM solde_banque;
    IF v_solde IS NULL OR v_solde < p_montant THEN
      RAISE EXCEPTION 'Solde bancaire insuffisant (% F disponibles pour une sortie de % F).',
        COALESCE(v_solde, 0), p_montant;
    END IF;
  END IF;

  INSERT INTO banque_mouvements (
    id, type, montant, libelle, motif, reference_type, date_mouvement
  ) VALUES (
    v_id,
    p_type,
    p_montant,
    p_libelle,
    p_motif,
    'banque_manuel',
    CURRENT_DATE
  );

  INSERT INTO audit_log (qui, quoi, details)
  VALUES (
    p_admin_id,
    'mouvement_banque_manuel',
    format('Mouvement bancaire [%s] de %s F. Libellé : %s. Motif : %s',
      p_type, p_montant, p_libelle, COALESCE(p_motif, '—'))
  );

  RETURN v_id;
END;
$$;

-- =============================================================================
-- 7. FONCTION : transferer_caisse_banque (Transfert atomique)
-- =============================================================================
CREATE OR REPLACE FUNCTION transferer_caisse_banque(
  p_sens TEXT, -- 'caisse_vers_banque' | 'banque_vers_caisse'
  p_montant INTEGER,
  p_libelle TEXT,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caisse_id UUID := gen_random_uuid();
  v_banque_id UUID := gen_random_uuid();
  v_solde_caisse INTEGER;
  v_solde_banque INTEGER;
BEGIN
  IF p_montant <= 0 THEN
    RAISE EXCEPTION 'Le montant du transfert doit être supérieur à zéro.';
  END IF;

  IF p_sens = 'caisse_vers_banque' THEN
    -- Dépôt bancaire des espèces de la caisse
    SELECT solde INTO v_solde_caisse FROM solde_caisse;
    IF v_solde_caisse IS NULL OR v_solde_caisse < p_montant THEN
      RAISE EXCEPTION 'Solde de caisse insuffisant (% F disponibles pour verser % F en banque).',
        COALESCE(v_solde_caisse, 0), p_montant;
    END IF;

    -- Sortie caisse
    INSERT INTO caisse_mouvements (
      id, type, montant, libelle, reference_id, reference_type, date_mouvement
    ) VALUES (
      v_caisse_id, 'sortie', p_montant,
      COALESCE(p_libelle, 'Versement espèces en banque'),
      v_banque_id, 'transfert_banque', CURRENT_DATE
    );

    -- Entrée banque
    INSERT INTO banque_mouvements (
      id, type, montant, libelle, reference_id, reference_type, date_mouvement
    ) VALUES (
      v_banque_id, 'entree', p_montant,
      COALESCE(p_libelle, 'Dépôt espèces provenant de la caisse'),
      v_caisse_id, 'transfert_caisse', CURRENT_DATE
    );

  ELSIF p_sens = 'banque_vers_caisse' THEN
    -- Retrait bancaire pour approvisionnement de caisse
    SELECT solde INTO v_solde_banque FROM solde_banque;
    IF v_solde_banque IS NULL OR v_solde_banque < p_montant THEN
      RAISE EXCEPTION 'Solde bancaire insuffisant (% F disponibles pour approvisionner % F en caisse).',
        COALESCE(v_solde_banque, 0), p_montant;
    END IF;

    -- Sortie banque
    INSERT INTO banque_mouvements (
      id, type, montant, libelle, reference_id, reference_type, date_mouvement
    ) VALUES (
      v_banque_id, 'sortie', p_montant,
      COALESCE(p_libelle, 'Retrait bancaire pour approvisionnement caisse'),
      v_caisse_id, 'transfert_caisse', CURRENT_DATE
    );

    -- Entrée caisse
    INSERT INTO caisse_mouvements (
      id, type, montant, libelle, reference_id, reference_type, date_mouvement
    ) VALUES (
      v_caisse_id, 'entree', p_montant,
      COALESCE(p_libelle, 'Approvisionnement caisse par retrait bancaire'),
      v_banque_id, 'transfert_banque', CURRENT_DATE
    );
  ELSE
    RAISE EXCEPTION 'Sens de transfert inconnu (utiliser caisse_vers_banque ou banque_vers_caisse).';
  END IF;

  INSERT INTO audit_log (qui, quoi, details)
  VALUES (
    p_admin_id,
    'transfert_caisse_banque',
    format('Transfert [%s] de %s F. Caisse ID: %s, Banque ID: %s',
      p_sens, p_montant, v_caisse_id, v_banque_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'sens', p_sens,
    'montant', p_montant,
    'caisse_mouvement_id', v_caisse_id,
    'banque_mouvement_id', v_banque_id,
    'message', format('Transfert de %s F effectué avec succès.', p_montant)
  );
END;
$$;

-- =============================================================================
-- 8. FONCTION : annuler_mouvement_caisse (Mouvement inverse lié)
-- =============================================================================
CREATE OR REPLACE FUNCTION annuler_mouvement_caisse(
  p_mouvement_id UUID,
  p_motif TEXT,
  p_admin_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mouv RECORD;
  v_inverse_id UUID := gen_random_uuid();
  v_inverse_type mouvement_type;
BEGIN
  IF p_motif IS NULL OR trim(p_motif) = '' THEN
    RAISE EXCEPTION 'Le motif d''annulation est obligatoire.';
  END IF;

  SELECT * INTO v_mouv FROM caisse_mouvements WHERE id = p_mouvement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mouvement de caisse introuvable.';
  END IF;

  IF EXISTS (SELECT 1 FROM caisse_mouvements WHERE annule_ref = p_mouvement_id) THEN
    RAISE EXCEPTION 'Ce mouvement a déjà été annulé par contre-passation.';
  END IF;

  -- Déterminer le type inverse
  IF v_mouv.type = 'entree' THEN
    v_inverse_type := 'sortie';
  ELSE
    v_inverse_type := 'entree';
  END IF;

  INSERT INTO caisse_mouvements (
    id, type, montant, libelle, annule_ref, motif, reference_type, date_mouvement
  ) VALUES (
    v_inverse_id,
    v_inverse_type,
    v_mouv.montant,
    format('ANNULATION: %s', v_mouv.libelle),
    p_mouvement_id,
    trim(p_motif),
    'annulation_caisse',
    CURRENT_DATE
  );

  INSERT INTO audit_log (qui, quoi, details)
  VALUES (
    p_admin_id,
    'annulation_mouvement_caisse',
    format('Annulation mouvement caisse %s par mouvement inverse %s. Motif : %s',
      p_mouvement_id, v_inverse_id, trim(p_motif))
  );

  RETURN v_inverse_id;
END;
$$;

-- =============================================================================
-- 9. FONCTION : annuler_mouvement_banque (Mouvement inverse lié)
-- =============================================================================
CREATE OR REPLACE FUNCTION annuler_mouvement_banque(
  p_mouvement_id UUID,
  p_motif TEXT,
  p_admin_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mouv RECORD;
  v_inverse_id UUID := gen_random_uuid();
  v_inverse_type mouvement_type;
BEGIN
  IF p_motif IS NULL OR trim(p_motif) = '' THEN
    RAISE EXCEPTION 'Le motif d''annulation est obligatoire.';
  END IF;

  SELECT * INTO v_mouv FROM banque_mouvements WHERE id = p_mouvement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mouvement bancaire introuvable.';
  END IF;

  IF EXISTS (SELECT 1 FROM banque_mouvements WHERE annule_ref = p_mouvement_id) THEN
    RAISE EXCEPTION 'Ce mouvement bancaire a déjà été annulé.';
  END IF;

  IF v_mouv.type = 'entree' THEN
    v_inverse_type := 'sortie';
  ELSE
    v_inverse_type := 'entree';
  END IF;

  INSERT INTO banque_mouvements (
    id, type, montant, libelle, annule_ref, motif, reference_type, date_mouvement
  ) VALUES (
    v_inverse_id,
    v_inverse_type,
    v_mouv.montant,
    format('ANNULATION: %s', v_mouv.libelle),
    p_mouvement_id,
    trim(p_motif),
    'annulation_banque',
    CURRENT_DATE
  );

  INSERT INTO audit_log (qui, quoi, details)
  VALUES (
    p_admin_id,
    'annulation_mouvement_banque',
    format('Annulation mouvement banque %s par mouvement inverse %s. Motif : %s',
      p_mouvement_id, v_inverse_id, trim(p_motif))
  );

  RETURN v_inverse_id;
END;
$$;

-- ===== 015_parametres_admin.sql =====
-- =============================================================================
-- IKA-MARA — Migration 015 : Administration des Paramètres & Journal d'Audit
-- =============================================================================
-- 1. Extension de la table parametres (modifie_par, version, section, description)
-- 2. Initialisation des paramètres par section :
--    - Commission
--    - Crédit (Ika-Djourou)
--    - Retrait (Ika-Mara)
--    - Alertes
--    - Reçus & Structure
-- 3. Fonction atomique de mise à jour versionnée avec écriture dans audit_log
-- =============================================================================

-- 1. EXTENSION DE LA TABLE PARAMETRES
ALTER TABLE parametres ADD COLUMN IF NOT EXISTS modifie_par UUID REFERENCES profiles(id);
ALTER TABLE parametres ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE parametres ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'general';
ALTER TABLE parametres ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. INITIALISATION / ENRICHISSEMENT DES PARAMÈTRES PAR SECTION
INSERT INTO parametres (cle, valeur, section, description) VALUES
  -- Section Commission
  ('commission_default_parts', '1'::jsonb, 'commission', 'Nombre de parts de commission mensuelle par défaut'),
  ('prelevement_commission_moment', '"cloture_mois"'::jsonb, 'commission', 'Moment du prélèvement (cloture_mois ou premier_depot)'),
  ('regle_mois_incomplet_commission', '"proportionnelle"'::jsonb, 'commission', 'Règle en cas d''adhésion en cours de mois (proportionnelle ou entiere)'),
  ('commission_verifier_solde', 'true'::jsonb, 'commission', 'Vérifier la disponibilité du solde d''épargne avant prélèvement'),

  -- Section Crédit (Ika-Djourou)
  ('taux_interet_defaut_djourou', '5'::jsonb, 'credit', 'Taux d''intérêt annuel par défaut (%)'),
  ('frais_dossier_credit_pourcent', '1'::jsonb, 'credit', 'Frais de dossier de crédit (%)'),
  ('penalite_retard_credit_pourcent', '2'::jsonb, 'credit', 'Pénalité de retard sur crédit (% par mois d''impayé)'),
  ('durees_proposees_credit', '[3, 6, 12]'::jsonb, 'credit', 'Durées standards proposées en mois'),
  ('credit_ouvert_unique_par_membre', 'true'::jsonb, 'credit', 'Interdire l''octroi d''un nouveau crédit si un crédit est déjà en cours'),

  -- Section Retrait (Ika-Mara)
  ('delai_min_retrait_jours', '30'::jsonb, 'retrait', 'Délai minimal d''ancienneté pour autoriser un retrait d''épargne (jours)'),
  ('frais_retrait_pourcent', '0'::jsonb, 'retrait', 'Frais sur retrait d''épargne (%)'),
  ('frais_retrait_fixe', '0'::jsonb, 'retrait', 'Frais fixes sur retrait d''épargne (F CFA)'),

  -- Section Alertes & Surveillance
  ('seuil_retard_jours', '3'::jsonb, 'alertes', 'Nombre de jours d''impayé déclenchant une alerte'),
  ('seuil_ecart_remise_alerte', '0'::jsonb, 'alertes', 'Seuil d''écart sur remise déclenchant une alerte (F CFA)'),

  -- Section Reçus & Structure
  ('nom_structure', '"IKA-MARA"'::jsonb, 'recus', 'Nom officiel de la structure'),
  ('entete_recu', '"Collecte d''Épargne, Tontine et Microcrédit au Mali"'::jsonb, 'recus', 'En-tête imprimé sur les reçus'),
  ('pied_recu', '"Merci pour votre confiance. Conservez ce reçu."'::jsonb, 'recus', 'Pied de page imprimé sur les reçus'),
  ('devise', '"F CFA"'::jsonb, 'recus', 'Devise monétaire officielle'),
  ('intervalle_sync_secondes', '60'::jsonb, 'recus', 'Intervalle de synchronisation automatique (secondes)')
ON CONFLICT (cle) DO UPDATE SET
  section = EXCLUDED.section,
  description = EXCLUDED.description;

-- =============================================================================
-- 3. FONCTION : mettre_a_jour_parametre (Versionnée avec audit_log)
-- =============================================================================
CREATE OR REPLACE FUNCTION mettre_a_jour_parametre(
  p_cle TEXT,
  p_valeur JSONB,
  p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ancien RECORD;
  v_nouvelle_version INTEGER := 1;
BEGIN
  SELECT * INTO v_ancien FROM parametres WHERE cle = p_cle;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paramètre « % » introuvable.', p_cle;
  END IF;

  v_nouvelle_version := COALESCE(v_ancien.version, 1) + 1;

  UPDATE parametres
  SET
    valeur = p_valeur,
    modifie_par = p_admin_id,
    modifie_le = now(),
    version = v_nouvelle_version
  WHERE cle = p_cle;

  -- Journalisation détaillée dans audit_log
  INSERT INTO audit_log (qui, quoi, avant, apres, details)
  VALUES (
    p_admin_id,
    'modification_parametre',
    v_ancien.valeur,
    p_valeur,
    format('Modification du paramètre « %s » (v%s -> v%s). Description : %s',
      p_cle, v_ancien.version, v_nouvelle_version, v_ancien.description)
  );

  RETURN jsonb_build_object(
    'success', true,
    'cle', p_cle,
    'valeur', p_valeur,
    'version', v_nouvelle_version,
    'message', format('Paramètre « %s » mis à jour (version %s).', p_cle, v_nouvelle_version)
  );
END;
$$;
