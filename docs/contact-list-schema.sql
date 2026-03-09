-- Contact list & preferences schema for FairShare
-- Run this in Supabase SQL Editor.

-- 1. Extend profiles (phone, email, profile_image_url)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_image_url text;

-- 2. Extend contacts (created_at, selfie_url)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS selfie_url text;

-- 3. contact_shared: what each user has shared with each contact
CREATE TABLE IF NOT EXISTS contact_shared (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_phone text,
  shared_email text,
  PRIMARY KEY (user_id, contact_id)
);

ALTER TABLE contact_shared ENABLE ROW LEVEL SECURITY;

-- Sharer can do everything; recipient can only read (to see what was shared with them)
DROP POLICY IF EXISTS "Users manage own shared data" ON contact_shared;
DROP POLICY IF EXISTS "Users read shared with them" ON contact_shared;
CREATE POLICY "Users manage own shared data" ON contact_shared
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own shared data" ON contact_shared
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own shared data" ON contact_shared
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users read shared with them" ON contact_shared
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = contact_id);

-- 4. contact_shares: for Realtime "X shared Y with you" toasts
CREATE TABLE IF NOT EXISTS contact_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_type text NOT NULL CHECK (shared_type IN ('phone', 'email')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contact_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own shares" ON contact_shares;
CREATE POLICY "Users insert own shares" ON contact_shares
  FOR INSERT WITH CHECK (auth.uid() = from_user_id);

DROP POLICY IF EXISTS "Users read received shares" ON contact_shares;
CREATE POLICY "Users read received shares" ON contact_shares
  FOR SELECT USING (auth.uid() = to_user_id);

-- After running this: enable Realtime for contact_shares in Dashboard → Database → Replication.

-- 5. profiles: allow reading display_name (etc.) of your contacts so contact list shows names
--    Run this if contact names show as "Unknown" (RLS was blocking read of other users' profiles).
DROP POLICY IF EXISTS "Users can read profiles of contacts" ON profiles;
CREATE POLICY "Users can read profiles of contacts" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR id IN (SELECT contact_id FROM contacts WHERE contacts.user_id = auth.uid())
  );
-- If you already have a policy like "Users can read own profile" (SELECT where id = auth.uid()),
-- you may need to drop it and use this combined one, or add this as an additional SELECT policy
-- only if your RLS allows multiple policies for the same command (OR together).

-- =============================================================================
-- Reset contacts (for testing): run in SQL Editor to delete all contact data
-- =============================================================================
-- DELETE FROM contact_shares;
-- DELETE FROM contact_shared;
-- DELETE FROM contacts;
