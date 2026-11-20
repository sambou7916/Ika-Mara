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
