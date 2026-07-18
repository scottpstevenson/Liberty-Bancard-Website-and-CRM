-- One-time data migration: write known bcrypt hash for Admin123! to the admin account.
-- This is a safe no-op if the email does not exist in this environment.
UPDATE users
SET password_hash = '$2b$12$K1QAXXl3whWrAafH7EG.DeXCu0WfaDX9LX2uKqWTNn7C5MniyHpcS'
WHERE email = 'scott@libertybancard.com';
