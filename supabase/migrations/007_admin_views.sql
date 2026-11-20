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
