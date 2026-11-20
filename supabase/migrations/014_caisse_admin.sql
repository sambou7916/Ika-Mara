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
