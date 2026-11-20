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
