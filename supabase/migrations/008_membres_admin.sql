-- =============================================================================
-- IKA-MARA — Migration 008 : Gestion Administrateur des Membres
-- =============================================================================

-- Ajout de la colonne photo_url facultative
ALTER TABLE membres ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Trigger empêchant la suppression physique d'un membre avec opérations financières
CREATE OR REPLACE FUNCTION fn_prevent_membre_delete_avec_operations()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM operations WHERE membre_id = OLD.id) THEN
    RAISE EXCEPTION 'Impossible de supprimer un membre ayant des opérations financières enregistrées. Désactivez-le à la place.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_membre_delete ON membres;
CREATE TRIGGER trg_prevent_membre_delete
  BEFORE DELETE ON membres
  FOR EACH ROW EXECUTE FUNCTION fn_prevent_membre_delete_avec_operations();

-- Fonction de réaffectation en masse d'agents
CREATE OR REPLACE FUNCTION reaffecter_membres_agent(
  p_admin_id UUID,
  p_membre_ids UUID[],
  p_nouveau_agent_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER := 0;
  v_membre_id UUID;
  v_ancien_agent_id UUID;
  v_nom_agent TEXT;
BEGIN
  -- Vérifier l'existence du nouvel agent
  SELECT nom INTO v_nom_agent FROM profiles WHERE id = p_nouveau_agent_id AND role = 'agent';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent cible introuvable ou non actif';
  END IF;

  FOREACH v_membre_id IN ARRAY p_membre_ids LOOP
    SELECT agent_id INTO v_ancien_agent_id FROM membres WHERE id = v_membre_id;
    
    IF FOUND AND v_ancien_agent_id <> p_nouveau_agent_id THEN
      UPDATE membres
      SET agent_id = p_nouveau_agent_id, modifie_le = now()
      WHERE id = v_membre_id;

      INSERT INTO audit_log (qui, quoi, avant, apres, details)
      VALUES (
        p_admin_id,
        'reaffectation_agent',
        jsonb_build_object('membre_id', v_membre_id, 'ancien_agent_id', v_ancien_agent_id),
        jsonb_build_object('membre_id', v_membre_id, 'nouveau_agent_id', p_nouveau_agent_id),
        format('Réaffectation du membre %s vers l''agent %s', v_membre_id, v_nom_agent)
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
