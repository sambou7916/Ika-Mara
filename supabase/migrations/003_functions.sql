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
