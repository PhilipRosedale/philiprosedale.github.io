-- Web of Trust: Attestations schema for FairShare
-- Run this in Supabase SQL Editor.

-- 1. Attestations table
-- Stores individual attestation events. Users can attest multiple times.
-- No SELECT policy exists — individual rows are never readable via the REST API.
CREATE TABLE IF NOT EXISTS public.attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attestation_type text NOT NULL CHECK (attestation_type IN ('trust', 'love')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.attestations ENABLE ROW LEVEL SECURITY;

-- Only allow inserts where the caller is the attester and the target is a contact.
-- No SELECT, UPDATE, or DELETE policies — attestations are write-only from the client's perspective.
DROP POLICY IF EXISTS "Users can insert own attestations" ON public.attestations;
CREATE POLICY "Users can insert own attestations"
  ON public.attestations FOR INSERT
  WITH CHECK (
    auth.uid() = from_user_id
    AND from_user_id <> to_user_id
    AND EXISTS (
      SELECT 1 FROM public.contacts
      WHERE user_id = auth.uid() AND contact_id = to_user_id
    )
  );


-- 2. RPC: create_attestation
-- SECURITY DEFINER so it bypasses RLS for the insert.
-- Validates that the target is a contact of the caller.
CREATE OR REPLACE FUNCTION public.create_attestation(
  p_to_user_id uuid,
  p_attestation_type text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'You must be logged in';
  END IF;

  IF p_attestation_type NOT IN ('trust', 'love') THEN
    RAISE EXCEPTION 'Invalid attestation type';
  END IF;

  IF v_caller_id = p_to_user_id THEN
    RAISE EXCEPTION 'Cannot attest yourself';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.contacts
    WHERE user_id = v_caller_id AND contact_id = p_to_user_id
  ) THEN
    RAISE EXCEPTION 'You can only attest contacts you have met';
  END IF;

  INSERT INTO public.attestations (from_user_id, to_user_id, attestation_type)
  VALUES (v_caller_id, p_to_user_id, p_attestation_type);

  RETURN json_build_object('success', true);
END;
$$;


-- 3. RPC: get_my_attestation_counts
-- Returns the number of distinct people who have attested love/trust for the caller.
-- Only aggregate counts are returned — never individual attestation details.
CREATE OR REPLACE FUNCTION public.get_my_attestation_counts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_love_count int;
  v_trust_count int;
BEGIN
  SELECT COUNT(DISTINCT from_user_id) INTO v_love_count
  FROM public.attestations
  WHERE to_user_id = auth.uid() AND attestation_type = 'love';

  SELECT COUNT(DISTINCT from_user_id) INTO v_trust_count
  FROM public.attestations
  WHERE to_user_id = auth.uid() AND attestation_type = 'trust';

  RETURN json_build_object(
    'love_count', COALESCE(v_love_count, 0),
    'trust_count', COALESCE(v_trust_count, 0)
  );
END;
$$;
