ALTER TABLE "contacts" ADD CONSTRAINT "contacts_parent_contact_id_fk"
  FOREIGN KEY ("parent_contact_id") REFERENCES "contacts"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
