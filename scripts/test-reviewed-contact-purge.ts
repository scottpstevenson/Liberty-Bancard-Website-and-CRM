#!/usr/bin/env npx tsx

import fs from "node:fs";
import assert from "node:assert/strict";
import {
  isReviewedSyntheticEmail,
  REVIEWED_TEST_CONTACT_GHL_BINDINGS,
  REVIEWED_TEST_CONTACT_IDS,
  REVIEWED_TEST_CONTACT_PURGE_CONFIRMATION,
  reviewedGhlBindingsMatch,
} from "../server/services/reviewed-test-contact-purge";
import { pool } from "../server/db";

async function run() {
  assert.equal(REVIEWED_TEST_CONTACT_IDS.length, 79, "manifest must contain 79 IDs");
  assert.equal(
    new Set(REVIEWED_TEST_CONTACT_IDS).size,
    REVIEWED_TEST_CONTACT_IDS.length,
    "manifest IDs must be unique",
  );
  assert.equal(
    REVIEWED_TEST_CONTACT_GHL_BINDINGS.size,
    18,
    "manifest must bind the exact 18 reviewed GHL contacts",
  );
  const exactBindings = REVIEWED_TEST_CONTACT_IDS.map((id) => ({
    id,
    ghl_contact_id: REVIEWED_TEST_CONTACT_GHL_BINDINGS.get(id) ?? null,
  }));
  assert.equal(reviewedGhlBindingsMatch(exactBindings), true);
  const whitespaceDrift = exactBindings.map((row, index) =>
    index === exactBindings.findIndex((candidate) => candidate.ghl_contact_id)
      ? { ...row, ghl_contact_id: ` ${row.ghl_contact_id}` }
      : row,
  );
  assert.equal(
    reviewedGhlBindingsMatch(whitespaceDrift),
    false,
    "whitespace-altered GHL bindings must fail closed",
  );
  const relinkDrift = exactBindings.map((row, index) =>
    index === exactBindings.findIndex((candidate) => candidate.ghl_contact_id)
      ? { ...row, ghl_contact_id: "different-ghl-contact" }
      : row,
  );
  assert.equal(
    reviewedGhlBindingsMatch(relinkDrift),
    false,
    "relinked GHL bindings must fail closed",
  );
  assert.equal(
    REVIEWED_TEST_CONTACT_PURGE_CONFIRMATION,
    "PURGE REVIEWED SYNTHETIC CONTACTS V1",
  );

  assert.equal(isReviewedSyntheticEmail("qa@libertybancard.test"), true);
  assert.equal(isReviewedSyntheticEmail("QA@Test.Internal"), true);
  assert.equal(isReviewedSyntheticEmail("person@example.com"), false);
  assert.equal(isReviewedSyntheticEmail("fake555@example.com"), false);

  const contactsUi = fs.readFileSync(
    "client/src/pages/dashboard/Contacts.tsx",
    "utf8",
  );
  assert.match(contactsUi, /apiRequest\("DELETE", "\/api\/contacts\/bulk-delete"/);
  assert.match(contactsUi, /This is reversible from Show Archived/);
  assert.doesNotMatch(
    contactsUi,
    /api\/admin\/contact-purges\/synthetic-reviewed-v1/,
    "permanent purge endpoint must never be exposed in Contacts UI",
  );

  const contactsRoute = fs.readFileSync("server/routes/contacts.ts", "utf8");
  assert.match(
    contactsRoute,
    /app\.post\(\s*"\/api\/admin\/contact-purges\/synthetic-reviewed-v1",\s*requireRole\("admin"\)/s,
  );
  assert.match(contactsRoute, /action: "contacts_bulk_archived"/);

  const crmOperationsRoute = fs.readFileSync(
    "server/routes/crm-operations.ts",
    "utf8",
  );
  assert.match(
    crmOperationsRoute,
    /app\.post\("\/api\/contacts\/:id\/archive", requireRole\("admin", "manager"\)/,
  );
  const archiveRouteBlock = crmOperationsRoute.slice(
    crmOperationsRoute.indexOf('app.post("/api/contacts/:id/archive"'),
    crmOperationsRoute.indexOf('app.post("/api/contacts/:id/restore"'),
  );
  assert.doesNotMatch(
    archiveRouteBlock,
    /propagateContactDeleteToGhl/,
    "normal soft archive must never delete the provider contact",
  );

  console.log("Reviewed contact purge and reversible UI delete contracts pass.");
}

run()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });