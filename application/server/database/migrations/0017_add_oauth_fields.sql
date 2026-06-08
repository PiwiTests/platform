ALTER TABLE users ADD COLUMN avatar_url text;
ALTER TABLE users ADD COLUMN oauth_provider text;
ALTER TABLE users ADD COLUMN oauth_provider_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_provider_id);
