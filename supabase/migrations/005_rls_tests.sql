-- =============================================================================
-- IKA-MARA — Migration 005 : Tests RLS
-- =============================================================================
-- Ces tests prouvent qu'un agent ne voit PAS les membres/opérations d'un autre.
-- À exécuter dans un environnement de test Supabase.
-- =============================================================================

-- Nettoyage préalable (uniquement en environnement de test)
-- DELETE FROM operations; DELETE FROM souscriptions; DELETE FROM membres; DELETE FROM profiles;

-- =============================================================================
-- Scénario de test
-- =============================================================================
-- Hypothèse : deux agents (agent_a, agent_b) et un admin existent dans auth.users.
-- On simule via SET LOCAL role et auth.uid().

-- Fonction helper pour simuler un utilisateur
CREATE OR REPLACE FUNCTION test_set_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user_id)::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

DO $$
DECLARE
  v_admin_id  UUID := '00000000-0000-0000-0000-000000000001';
  v_agent_a   UUID := '00000000-0000-0000-0000-000000000002';
  v_agent_b   UUID := '00000000-0000-0000-0000-000000000003';
  v_membre_a1 UUID := gen_random_uuid();
  v_membre_b1 UUID := gen_random_uuid();
  v_op_a1     UUID := gen_random_uuid();
  v_op_b1     UUID := gen_random_uuid();
  v_count     INTEGER;
BEGIN
  -- =========================================================================
  -- Préparation des données (en tant que service role, sans RLS)
  -- =========================================================================

  -- Insérer les profils (normalement faits par un trigger on auth.users insert)
  INSERT INTO profiles (id, role, nom, identifiant, statut) VALUES
    (v_admin_id, 'admin', 'Admin Test', 'admin_test', 'actif'),
    (v_agent_a,  'agent', 'Agent A',    'agent_a',    'actif'),
    (v_agent_b,  'agent', 'Agent B',    'agent_b',    'actif')
  ON CONFLICT (id) DO NOTHING;

  -- Insérer des membres pour chaque agent
  INSERT INTO membres (id, numero, nom, prenom, agent_id) VALUES
    (v_membre_a1, '0001', 'Diarra',  'Amadou',  v_agent_a),
    (v_membre_b1, '0002', 'Coulibaly', 'Fatoumata', v_agent_b)
  ON CONFLICT (id) DO NOTHING;

  -- Insérer des souscriptions
  INSERT INTO souscriptions (membre_id, volet, montant_jour) VALUES
    (v_membre_a1, 'mara', 1000),
    (v_membre_b1, 'mara', 500)
  ON CONFLICT (membre_id, volet) DO NOTHING;

  -- Insérer des opérations
  INSERT INTO operations (id, type, volet, membre_id, agent_id, montant) VALUES
    (v_op_a1, 'depot', 'mara', v_membre_a1, v_agent_a, 1000),
    (v_op_b1, 'depot', 'mara', v_membre_b1, v_agent_b, 500)
  ON CONFLICT (id) DO NOTHING;

  -- =========================================================================
  -- TEST 1 : Agent A ne voit que ses propres membres
  -- =========================================================================
  PERFORM test_set_user(v_agent_a);

  SELECT COUNT(*) INTO v_count FROM membres;
  IF v_count != 1 THEN
    RAISE EXCEPTION 'TEST 1 ÉCHOUÉ : Agent A voit % membre(s) au lieu de 1', v_count;
  END IF;

  -- Vérifier que c'est bien le membre de A
  SELECT COUNT(*) INTO v_count FROM membres WHERE agent_id = v_agent_a;
  IF v_count != 1 THEN
    RAISE EXCEPTION 'TEST 1b ÉCHOUÉ : Agent A ne voit pas son propre membre';
  END IF;

  -- Vérifier que le membre de B est invisible
  SELECT COUNT(*) INTO v_count FROM membres WHERE agent_id = v_agent_b;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST 1c ÉCHOUÉ : Agent A voit les membres de Agent B !';
  END IF;

  RAISE NOTICE 'TEST 1 OK : Agent A ne voit que ses membres';

  -- =========================================================================
  -- TEST 2 : Agent A ne voit que ses propres opérations
  -- =========================================================================
  SELECT COUNT(*) INTO v_count FROM operations;
  IF v_count != 1 THEN
    RAISE EXCEPTION 'TEST 2 ÉCHOUÉ : Agent A voit % opération(s) au lieu de 1', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM operations WHERE agent_id = v_agent_b;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST 2b ÉCHOUÉ : Agent A voit les opérations de Agent B !';
  END IF;

  RAISE NOTICE 'TEST 2 OK : Agent A ne voit que ses opérations';

  -- =========================================================================
  -- TEST 3 : Agent B ne voit que ses propres membres
  -- =========================================================================
  PERFORM test_set_user(v_agent_b);

  SELECT COUNT(*) INTO v_count FROM membres;
  IF v_count != 1 THEN
    RAISE EXCEPTION 'TEST 3 ÉCHOUÉ : Agent B voit % membre(s) au lieu de 1', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM membres WHERE agent_id = v_agent_a;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST 3b ÉCHOUÉ : Agent B voit les membres de Agent A !';
  END IF;

  RAISE NOTICE 'TEST 3 OK : Agent B ne voit que ses membres';

  -- =========================================================================
  -- TEST 4 : Agent B ne voit que ses propres opérations
  -- =========================================================================
  SELECT COUNT(*) INTO v_count FROM operations WHERE agent_id = v_agent_a;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST 4 ÉCHOUÉ : Agent B voit les opérations de Agent A !';
  END IF;

  RAISE NOTICE 'TEST 4 OK : Agent B ne voit que ses opérations';

  -- =========================================================================
  -- TEST 5 : Agent A ne voit que les souscriptions de ses membres
  -- =========================================================================
  PERFORM test_set_user(v_agent_a);

  SELECT COUNT(*) INTO v_count FROM souscriptions;
  IF v_count != 1 THEN
    RAISE EXCEPTION 'TEST 5 ÉCHOUÉ : Agent A voit % souscription(s) au lieu de 1', v_count;
  END IF;

  RAISE NOTICE 'TEST 5 OK : Agent A ne voit que les souscriptions de ses membres';

  -- =========================================================================
  -- TEST 6 : L'admin voit tout
  -- =========================================================================
  PERFORM test_set_user(v_admin_id);

  SELECT COUNT(*) INTO v_count FROM membres;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST 6 ÉCHOUÉ : Admin ne voit que % membre(s)', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM operations;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST 6b ÉCHOUÉ : Admin ne voit que % opération(s)', v_count;
  END IF;

  RAISE NOTICE 'TEST 6 OK : Admin voit tous les membres et opérations';

  -- =========================================================================
  -- TEST 7 : Un agent suspendu ne voit rien
  -- =========================================================================
  -- Temporairement suspendre l'agent A
  UPDATE profiles SET statut = 'suspendu' WHERE id = v_agent_a;
  PERFORM test_set_user(v_agent_a);

  SELECT COUNT(*) INTO v_count FROM membres;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST 7 ÉCHOUÉ : Agent suspendu voit encore % membre(s)', v_count;
  END IF;

  RAISE NOTICE 'TEST 7 OK : Agent suspendu ne voit rien';

  -- Restaurer
  UPDATE profiles SET statut = 'actif' WHERE id = v_agent_a;

  -- =========================================================================
  -- TEST 8 : Caisse/Banque invisibles pour les agents
  -- =========================================================================
  PERFORM test_set_user(v_agent_a);

  SELECT COUNT(*) INTO v_count FROM caisse_mouvements;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST 8 ÉCHOUÉ : Agent voit la caisse';
  END IF;

  RAISE NOTICE 'TEST 8 OK : Caisse invisible pour les agents';

  -- =========================================================================
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TOUS LES TESTS RLS SONT PASSÉS ✓';
  RAISE NOTICE '========================================';
END;
$$;
