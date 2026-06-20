-- Free contact enrichment: RDAP, JSON-LD, contact page scraper
ALTER TABLE sdr_merchant_contacts
  ADD COLUMN IF NOT EXISTS email_confidence integer DEFAULT 0;

ALTER TABLE sdr_merchants
  ADD COLUMN IF NOT EXISTS owner_enrichment_status text DEFAULT 'pending';
