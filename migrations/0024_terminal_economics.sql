ALTER TABLE equipment_orders
  ADD COLUMN IF NOT EXISTS liberty_cost numeric,
  ADD COLUMN IF NOT EXISTS estimated_monthly_gp numeric,
  ADD COLUMN IF NOT EXISTS payback_months numeric,
  ADD COLUMN IF NOT EXISTS approval_tier text,
  ADD COLUMN IF NOT EXISTS manager_approved boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamp,
  ADD COLUMN IF NOT EXISTS approved_by_user_id varchar;

CREATE TABLE IF NOT EXISTS "equipment_models" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "category" text DEFAULT 'Terminal',
  "description" text,
  "msrp" real DEFAULT 0 NOT NULL,
  "liberty_cost" real DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "terminal_approval_status" text DEFAULT 'not_required';
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "terminal_approval_task_id" integer;
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "terminal_cost_at_order" real;

INSERT INTO "equipment_models" ("name", "category", "description", "msrp", "liberty_cost", "is_active")
VALUES
  ('Clover Flex 3',       'Terminal',    'Portable handheld POS with 6" touchscreen, EMV/NFC, and built-in printer', 599.00, 349.00, true),
  ('Clover Mini 3',       'Terminal',    'Compact 8" countertop terminal with full Clover ecosystem', 799.00, 449.00, true),
  ('Clover Station Duo',  'POS System',  'Full POS station with merchant display + customer-facing screen', 1699.00, 999.00, true),
  ('Dejavoo QD4',         'Terminal',    'Standalone touchscreen terminal with EMV/NFC/MSR', 349.00, 199.00, true),
  ('PAX A920',            'Terminal',    'Android-based all-in-one terminal with built-in printer', 449.00, 279.00, true),
  ('SwipeSimple B250',    'Mobile Reader','Bluetooth card reader for mobile sales with SwipeSimple app', 99.00,  49.00,  true)
ON CONFLICT DO NOTHING;
