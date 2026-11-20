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
