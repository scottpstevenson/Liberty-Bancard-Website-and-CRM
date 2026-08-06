-- Add partner_commission column to merchant_residuals for tracking partner org commissions
ALTER TABLE merchant_residuals ADD COLUMN IF NOT EXISTS partner_commission TEXT NOT NULL DEFAULT '0';
