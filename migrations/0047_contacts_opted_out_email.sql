ALTER TABLE contacts ADD COLUMN IF NOT EXISTS "opted_out_email" boolean DEFAULT false;
