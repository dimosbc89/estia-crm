#!/usr/bin/env python3
"""Print the SQL that adds (or resets) a CRM login. Run the output against the D1 database:
   python3 scripts/add-user.py you@example.com "Your Name" > /tmp/user.sql
   npx wrangler d1 execute estia-crm --remote --file /tmp/user.sql
The password is generated and printed to stderr; it is never stored in plain text."""
import hashlib, secrets, sys
email = sys.argv[1].strip().lower()
name = sys.argv[2] if len(sys.argv) > 2 else ''
password = sys.argv[3] if len(sys.argv) > 3 else secrets.token_urlsafe(12)
salt = secrets.token_bytes(16)
h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000).hex()
q = lambda s: "'" + s.replace("'", "''") + "'"
print(f"INSERT INTO users (email, name, salt, pass_hash) VALUES ({q(email)}, {q(name)}, '{salt.hex()}', '{h}') "
      f"ON CONFLICT(email) DO UPDATE SET salt = excluded.salt, pass_hash = excluded.pass_hash;")
print(f"DELETE FROM sessions WHERE email = {q(email)};")
print(f"Password for {email}: {password}", file=sys.stderr)
