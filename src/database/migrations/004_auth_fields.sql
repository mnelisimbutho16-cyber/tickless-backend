-- Add auth fields for email/password registration and shop metadata
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_salt TEXT,
  ADD COLUMN IF NOT EXISTS store_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_shops_email ON shops(email);