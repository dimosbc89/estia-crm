-- Estia CRM database (Cloudflare D1). Already applied to the production database.
CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip, at);
CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, content_type TEXT NOT NULL, size INTEGER NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
