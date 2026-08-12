-- 0130_equipment_device_fields.sql
-- Add device type and serial number to equipment shipments (#1404)
ALTER TABLE equipment_shipments
  ADD COLUMN IF NOT EXISTS device_type text,
  ADD COLUMN IF NOT EXISTS serial_number text;
