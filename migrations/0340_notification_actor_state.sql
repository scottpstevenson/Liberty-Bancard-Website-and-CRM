CREATE TABLE IF NOT EXISTS notification_actor_states (
  actor_id varchar NOT NULL REFERENCES users(id),
  notification_id integer NOT NULL REFERENCES notifications(id),
  read_at timestamp,
  dismissed_at timestamp,
  PRIMARY KEY(actor_id,notification_id)
);
