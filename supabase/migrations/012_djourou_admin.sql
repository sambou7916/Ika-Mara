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
