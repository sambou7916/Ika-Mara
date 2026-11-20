-- =============================================================================
-- IKA-MARA — Migration 006 : Synchronisation hors ligne
-- =============================================================================
-- 1. Colonnes de remise de collecte (attendu / remis / écart / statut)
-- 2. Décisions de l'administrateur sur les demandes (retrait, crédit)
-- 3. Journal serveur des erreurs de synchro (visible par l'administrateur)
-- 4. Fonctions d'insertion idempotentes : INSERT … ON CONFLICT (id) DO NOTHING
--    (id = client_id généré sur le téléphone)
-- =============================================================================

-- =============================================================================
-- 1. REMISES DE COLLECTE : champs saisis par l'agent + confirmation admin
-- =============================================================================

ALTER TABLE remises_collecte
  ADD COLUMN IF NOT EXISTS montant_attendu INTEGER NOT NULL DEFAULT 0 CHECK (montant_attendu >= 0),
  ADD COLUMN IF NOT EXISTS montant_remis   INTEGER NOT NULL DEFAULT 0 CHECK (montant_remis >= 0),
  ADD COLUMN IF NOT EXISTS ecart           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motif           TEXT,
  ADD COLUMN IF NOT EXISTS statut          TEXT    NOT NULL DEFAULT 'a_confirmer'
    CHECK (statut IN ('a_confirmer', 'validee', 'rejetee')),
  ADD COLUMN IF NOT EXISTS confirme_par    UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS confirme_le     TIMESTAMPTZ;

-- Une journée sans collecte donne une remise de 0 F
ALTER TABLE remises_collecte DROP CONSTRAINT IF EXISTS remises_collecte_montant_check;
ALTER TABLE remises_collecte ADD CONSTRAINT remises_collecte_montant_check CHECK (montant >= 0);

-- Un écart non nul exige un motif
ALTER TABLE remises_collecte DROP CONSTRAINT IF EXISTS chk_remise_motif_ecart;
ALTER TABLE remises_collecte ADD CONSTRAINT chk_remise_motif_ecart
  CHECK (ecart = 0 OR (motif IS NOT NULL AND length(trim(motif)) > 0));

-- Une seule remise active (non rejetée) par agent et par jour
CREATE UNIQUE INDEX IF NOT EXISTS uq_remise_agent_jour
  ON remises_collecte(agent_id, date_remise)
  WHERE statut <> 'rejetee';

-- =============================================================================
-- 2. DÉCISIONS DE L'ADMINISTRATEUR SUR LES DEMANDES
-- =============================================================================
-- Les opérations étant immuables, la décision est un enregistrement séparé
-- lié à la demande (operations.id).

CREATE TABLE IF NOT EXISTS decisions_demandes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demande_id      UUID        NOT NULL UNIQUE REFERENCES operations(id),
  agent_id        UUID        NOT NULL REFERENCES profiles(id),
  decision        TEXT        NOT NULL CHECK (decision IN ('acceptee', 'rejetee')),
  montant_accorde INTEGER     CHECK (montant_accorde IS NULL OR montant_accorde > 0),
  motif           TEXT,
  decide_par      UUID        NOT NULL REFERENCES profiles(id),
  decide_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_decision_rejet_motif CHECK (
    decision = 'acceptee' OR (motif IS NOT NULL AND length(trim(motif)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decisions_demandes(agent_id);

-- Renseigne agent_id depuis la demande et vérifie le type
CREATE OR REPLACE FUNCTION fn_decision_demande_avant_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_type  operation_type;
  v_agent UUID;
BEGIN
  SELECT type, agent_id INTO v_type, v_agent FROM operations WHERE id = NEW.demande_id;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;
  IF v_type NOT IN ('demande_retrait', 'demande_credit') THEN
    RAISE EXCEPTION 'Seules les demandes de retrait ou de crédit peuvent recevoir une décision';
  END IF;
  NEW.agent_id := v_agent;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decision_demande_avant_insert ON decisions_demandes;
CREATE TRIGGER trg_decision_demande_avant_insert
  BEFORE INSERT ON decisions_demandes
  FOR EACH ROW EXECUTE FUNCTION fn_decision_demande_avant_insert();

-- =============================================================================
-- 3. JOURNAL DES ERREURS DE SYNCHRONISATION
-- =============================================================================
-- Toute entrée refusée par le serveur y est consignée : l'administrateur voit
-- les mêmes erreurs que l'agent. Marquée « résolue » quand l'entrée finit par
-- être acceptée. Jamais supprimée automatiquement.

CREATE TABLE IF NOT EXISTS sync_erreurs (
  client_id    UUID PRIMARY KEY,
  agent_id     UUID        NOT NULL REFERENCES profiles(id),
  table_cible  TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  code         TEXT        NOT NULL,
  message      TEXT,
  tentatives   INTEGER     NOT NULL DEFAULT 1,
  premiere_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  derniere_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolu       BOOLEAN     NOT NULL DEFAULT false,
  resolu_le    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_erreurs_agent  ON sync_erreurs(agent_id);
CREATE INDEX IF NOT EXISTS idx_sync_erreurs_resolu ON sync_erreurs(resolu);

-- =============================================================================
-- 4. FONCTIONS DE SYNCHRONISATION (appelées par /api/sync, clé service)
-- =============================================================================

-- --- Opérations ---------------------------------------------------------------
-- Retourne 'insere' ou 'doublon'. Lève une exception dont le MESSAGE est un
-- code métier (MEMBRE_INACTIF, MONTANT_INVALIDE, …) en cas de refus.

CREATE OR REPLACE FUNCTION sync_operation(
  p_agent_id  UUID,
  p_client_id UUID,
  p_payload   JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_type    operation_type;
  v_volet   volet_type;
  v_montant NUMERIC;
  v_jours   INTEGER;
  v_membre  membres%ROWTYPE;
  v_id      UUID;
BEGIN
  -- Renvoi d'une opération déjà reçue : ignoré (idempotence)
  IF EXISTS (SELECT 1 FROM operations WHERE id = p_client_id) THEN
    RETURN 'doublon';
  END IF;

  -- Type autorisé pour un agent
  BEGIN
    v_type  := (p_payload->>'type')::operation_type;
    v_volet := (p_payload->>'volet')::volet_type;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING MESSAGE = 'DONNEES_INVALIDES';
  END;

  IF v_type NOT IN ('depot', 'remboursement', 'demande_retrait', 'demande_credit') THEN
    RAISE EXCEPTION USING MESSAGE = 'TYPE_NON_AUTORISE';
  END IF;

  -- Montant entier strictement positif (F CFA)
  IF jsonb_typeof(p_payload->'montant') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING MESSAGE = 'MONTANT_INVALIDE';
  END IF;
  v_montant := (p_payload->>'montant')::NUMERIC;
  IF v_montant <= 0 OR v_montant <> trunc(v_montant) OR v_montant > 2147483647 THEN
    RAISE EXCEPTION USING MESSAGE = 'MONTANT_INVALIDE';
  END IF;

  v_jours := COALESCE(NULLIF(p_payload->>'jours_couverts', '')::INTEGER, 1);
  IF v_jours <= 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'DONNEES_INVALIDES';
  END IF;

  -- Membre : existe, appartient à l'agent, actif
  SELECT * INTO v_membre FROM membres WHERE id = (p_payload->>'membre_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'MEMBRE_INTROUVABLE';
  END IF;
  IF v_membre.agent_id <> p_agent_id THEN
    RAISE EXCEPTION USING MESSAGE = 'MEMBRE_HORS_PORTEFEUILLE';
  END IF;
  IF v_membre.statut <> 'actif' THEN
    RAISE EXCEPTION USING MESSAGE = 'MEMBRE_INACTIF';
  END IF;

  -- Dépôt : souscription active sur le volet
  IF v_type = 'depot' AND NOT EXISTS (
    SELECT 1 FROM souscriptions
    WHERE membre_id = v_membre.id AND volet = v_volet AND statut = 'active'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'SOUSCRIPTION_INACTIVE';
  END IF;

  INSERT INTO operations (
    id, type, volet, membre_id, agent_id, montant, jours_couverts,
    date_operation, cree_le, statut, motif
  ) VALUES (
    p_client_id,
    v_type,
    v_volet,
    v_membre.id,
    p_agent_id,                                   -- jamais l'agent_id du client
    v_montant::INTEGER,
    v_jours,
    COALESCE(NULLIF(p_payload->>'date_operation', '')::DATE, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'cree_le', '')::TIMESTAMPTZ, now()),
    CASE WHEN v_type IN ('demande_retrait', 'demande_credit')
         THEN 'en_attente'::statut_operation
         ELSE 'validee'::statut_operation END,
    NULLIF(p_payload->>'motif', '')
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN 'doublon'; -- envoi concurrent du même client_id
  END IF;

  UPDATE sync_erreurs SET resolu = true, resolu_le = now()
  WHERE client_id = p_client_id AND resolu = false;

  RETURN 'insere';
END;
$$;

-- --- Remises de collecte ------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_remise(
  p_agent_id  UUID,
  p_client_id UUID,
  p_payload   JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_attendu NUMERIC;
  v_remis   NUMERIC;
  v_date    DATE;
  v_motif   TEXT;
  v_id      UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM remises_collecte WHERE id = p_client_id) THEN
    RETURN 'doublon';
  END IF;

  IF jsonb_typeof(p_payload->'montant_attendu') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_payload->'montant_remis') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING MESSAGE = 'MONTANT_INVALIDE';
  END IF;

  v_attendu := (p_payload->>'montant_attendu')::NUMERIC;
  v_remis   := (p_payload->>'montant_remis')::NUMERIC;
  IF v_attendu < 0 OR v_remis < 0
     OR v_attendu <> trunc(v_attendu) OR v_remis <> trunc(v_remis) THEN
    RAISE EXCEPTION USING MESSAGE = 'MONTANT_INVALIDE';
  END IF;

  v_motif := NULLIF(trim(COALESCE(p_payload->>'motif', '')), '');
  IF v_remis <> v_attendu AND v_motif IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'DONNEES_INVALIDES';
  END IF;

  v_date := COALESCE(NULLIF(p_payload->>'date_remise', '')::DATE, CURRENT_DATE);

  IF EXISTS (
    SELECT 1 FROM remises_collecte
    WHERE agent_id = p_agent_id AND date_remise = v_date AND statut <> 'rejetee'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'REMISE_DEJA_FAITE';
  END IF;

  INSERT INTO remises_collecte (
    id, agent_id, montant, date_remise, commentaire, cree_le,
    montant_attendu, montant_remis, ecart, motif, statut
  ) VALUES (
    p_client_id,
    p_agent_id,
    v_remis::INTEGER,
    v_date,
    NULLIF(p_payload->>'commentaire', ''),
    COALESCE(NULLIF(p_payload->>'cree_le', '')::TIMESTAMPTZ, now()),
    v_attendu::INTEGER,
    v_remis::INTEGER,
    (v_remis - v_attendu)::INTEGER,
    v_motif,
    'a_confirmer'                                 -- toujours confirmée par l'admin
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN 'doublon';
  END IF;

  UPDATE sync_erreurs SET resolu = true, resolu_le = now()
  WHERE client_id = p_client_id AND resolu = false;

  RETURN 'insere';
END;
$$;

-- --- Journalisation d'un refus ------------------------------------------------

CREATE OR REPLACE FUNCTION sync_journaliser_erreur(
  p_agent_id  UUID,
  p_client_id UUID,
  p_table     TEXT,
  p_payload   JSONB,
  p_code      TEXT,
  p_message   TEXT
)
RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO sync_erreurs (client_id, agent_id, table_cible, payload, code, message)
  VALUES (p_client_id, p_agent_id, p_table, p_payload, p_code, p_message)
  ON CONFLICT (client_id) DO UPDATE SET
    tentatives  = sync_erreurs.tentatives + 1,
    code        = EXCLUDED.code,
    message     = EXCLUDED.message,
    payload     = EXCLUDED.payload,
    derniere_le = now(),
    resolu      = false,
    resolu_le   = NULL;
$$;

-- Fonctions réservées au serveur (clé service) : jamais appelables par un client
REVOKE ALL ON FUNCTION sync_operation(UUID, UUID, JSONB)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_remise(UUID, UUID, JSONB)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_journaliser_erreur(UUID, UUID, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_operation(UUID, UUID, JSONB)                          TO service_role;
GRANT EXECUTE ON FUNCTION sync_remise(UUID, UUID, JSONB)                             TO service_role;
GRANT EXECUTE ON FUNCTION sync_journaliser_erreur(UUID, UUID, TEXT, JSONB, TEXT, TEXT) TO service_role;

-- =============================================================================
-- 5. RLS
-- =============================================================================

ALTER TABLE decisions_demandes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_erreurs       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decisions_select ON decisions_demandes;
CREATE POLICY decisions_select ON decisions_demandes
  FOR SELECT USING (is_active() AND (agent_id = auth.uid() OR is_admin()));

DROP POLICY IF EXISTS decisions_insert ON decisions_demandes;
CREATE POLICY decisions_insert ON decisions_demandes
  FOR INSERT WITH CHECK (is_admin() AND decide_par = auth.uid());

DROP POLICY IF EXISTS sync_erreurs_select ON sync_erreurs;
CREATE POLICY sync_erreurs_select ON sync_erreurs
  FOR SELECT USING (is_active() AND (agent_id = auth.uid() OR is_admin()));

DROP POLICY IF EXISTS sync_erreurs_update ON sync_erreurs;
CREATE POLICY sync_erreurs_update ON sync_erreurs
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- Remises : seul l'administrateur confirme ou rejette
DROP POLICY IF EXISTS remises_update ON remises_collecte;
CREATE POLICY remises_update ON remises_collecte
  FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
