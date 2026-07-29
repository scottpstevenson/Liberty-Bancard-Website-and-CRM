-- Backfill outboundChannels into trigger_config for all existing sequences.
-- Cold/SDR sequences default to ["email"] so cold_no_consent contacts can
-- enroll; SMS steps are then skipped per-step via the consent skip logic
-- (sequence_step_skipped_sms_no_consent) until PEWC consent is collected.
UPDATE follow_up_sequences
SET trigger_config = COALESCE(trigger_config, '{}'::jsonb) || '{"outboundChannels":["email"]}'::jsonb
WHERE trigger_config IS NULL
   OR trigger_config->>'outboundChannels' IS NULL;
