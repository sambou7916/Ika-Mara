-- =============================================================================
-- IKA-MARA — Migration 009 : Gestion Administrateur des Agents
-- =============================================================================

-- Ajout de la valeur 'nouveau' pour les nouveaux agents en attente de 1ère connexion
ALTER TYPE statut_profil ADD VALUE IF NOT EXISTS 'nouveau';

-- Horodatage de la dernière synchronisation de l'agent
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS derniere_synchro_le TIMESTAMPTZ;

-- Met à jour la dernière synchronisation lors de l'enregistrement d'une opération
CREATE OR REPLACE FUNCTION fn_update_agent_derniere_synchro()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET derniere_synchro_le = now(), modifie_le = now()
  WHERE id = NEW.agent_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_agent_synchro_op ON operations;
CREATE TRIGGER trg_update_agent_synchro_op
  AFTER INSERT ON operations
  FOR EACH ROW EXECUTE FUNCTION fn_update_agent_derniere_synchro();
