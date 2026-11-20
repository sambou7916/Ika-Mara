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
