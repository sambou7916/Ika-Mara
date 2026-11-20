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
