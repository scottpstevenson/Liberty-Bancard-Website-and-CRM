---
name: Equipment shipments device fields
description: Migration 0130 adds device_type and serial_number to equipment_shipments; new CRUD endpoints in boarding.ts
---

# Equipment Shipments — Device Fields (#1404)

## What was built

**Migration 0130** (`migrations/0130_equipment_device_fields.sql`):
- `ALTER TABLE equipment_shipments ADD COLUMN IF NOT EXISTS device_type text, ADD COLUMN IF NOT EXISTS serial_number text`
- Applied via journal entry (when=1791300001001) and also ran directly via pg client on 2026-08-12

**Schema** (`shared/schema.ts`):
- `deviceType: text("device_type")` and `serialNumber: text("serial_number")` added to `equipmentShipments`
- Added `insertEquipmentShipmentSchema` and `InsertEquipmentShipment` type (previously missing)

**CRUD endpoints** (`server/routes/boarding.ts`):
- `POST /api/boarding/equipment` — create shipment with deviceType/serialNumber
- `PATCH /api/boarding/equipment/:id` — update any shipment fields
- `GET /api/boarding/equipment?contactId=X&dealId=Y` — list shipments

**Key note:** The `merchant_mids` table IS the master MID registry (mid, tids array, processorName, status, assignedAt — all present). The `/api/boarding/mid-registry` endpoint queries deals table (a denormalized view) — this is intentional for the registry view page. The two are separate use cases.

**Why:** `eq` and `and` must be imported from drizzle-orm in boarding.ts — only `sql` was imported before adding these endpoints.
