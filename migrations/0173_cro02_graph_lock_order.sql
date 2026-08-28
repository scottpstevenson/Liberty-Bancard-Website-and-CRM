-- CRO-02 graph writers acquire one service-owned advisory protocol before
-- revision and domain rows. Triggers only maintain revisions; acquiring a new
-- advisory lock after a domain row is held can invert the resolver order.
CREATE OR REPLACE FUNCTION cro02_bump_graph_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE edge text; lt text; li integer; rt text; ri integer;
BEGIN
  IF TG_TABLE_NAME='contact_business_link_decisions' THEN
    edge:='contact_business'; lt:='contact'; li:=NEW.contact_id; rt:='business'; ri:=NEW.business_id;
  ELSIF TG_TABLE_NAME='legacy_company_mapping_decisions' THEN
    edge:='legacy_company_business'; lt:='company'; li:=NEW.company_id; rt:='business'; ri:=NEW.business_id;
  ELSIF TG_TABLE_NAME='commercial_relationship_reviews' THEN
    edge:='relationship'; lt:='contact'; li:=NEW.contact_id; rt:='business'; ri:=NEW.business_id;
  ELSIF TG_TABLE_NAME='contact_identity_observations' THEN
    edge:='identity'; lt:='contact'; li:=NEW.contact_id; rt:='contact'; ri:=NEW.contact_id;
  ELSIF TG_TABLE_NAME='contact_merge_redirects' THEN
    edge:='contact_redirect'; lt:='contact'; li:=NEW.deprecated_contact_id; rt:='contact'; ri:=NEW.survivor_contact_id;
  ELSE
    RAISE EXCEPTION 'CRO02_UNKNOWN_MEMBERSHIP_WRITER';
  END IF;
  IF ri IS NULL THEN rt:=lt; ri:=li; END IF;
  INSERT INTO commercial_membership_revisions
    (edge_type,left_subject_type,left_subject_id,right_subject_type,right_subject_id,revision,authority_version,updated_at)
  VALUES(edge,lt,li,rt,ri,1,1,now())
  ON CONFLICT(edge_type,left_subject_type,left_subject_id,right_subject_type,right_subject_id)
  DO UPDATE SET revision=commercial_membership_revisions.revision+1,updated_at=now();
  INSERT INTO commercial_subject_revisions(subject_type,subject_id,revision,authority_version,updated_at)
    VALUES(lt,li,1,1,now())
    ON CONFLICT(subject_type,subject_id) DO UPDATE
      SET revision=commercial_subject_revisions.revision+1,updated_at=now();
  IF lt<>rt OR li<>ri THEN
    INSERT INTO commercial_subject_revisions(subject_type,subject_id,revision,authority_version,updated_at)
      VALUES(rt,ri,1,1,now())
      ON CONFLICT(subject_type,subject_id) DO UPDATE
        SET revision=commercial_subject_revisions.revision+1,updated_at=now();
  END IF;
  RETURN NEW;
END $$;