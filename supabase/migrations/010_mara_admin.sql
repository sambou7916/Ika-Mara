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
