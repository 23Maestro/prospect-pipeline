-- Open New Opportunity queue items are current pipeline state, not call activity.
-- Keep the rows for audit/debugging, but remove the misleading not_operator_task
-- reason from rows that were created only because an open current-pipeline task
-- had no completion clock.

update call_activity_events
set
  payload_json =
    jsonb_set(
      jsonb_set(
        payload_json - 'materialization_status' - 'owner_status',
        '{owner_context}',
        coalesce(payload_json->'owner_context', '{}'::jsonb)
          - 'materialization_status'
          - 'materialization_reason'
          - 'owner_status',
        true
      ),
      '{materialization_proof}',
      coalesce(payload_json->'materialization_proof', '{}'::jsonb)
        - 'materialization_status'
        - 'status'
        - 'reason',
      true
    )
    || jsonb_build_object(
      'materialization_reason', 'open_new_opportunity_queue_item_not_call_activity',
      'queue_item_status', 'open_queue_item',
      'counts_as_dial', false,
      'counts_as_contact', false,
      'counts_as_meeting_set', false,
      'counts_as_post_meeting_outcome', false,
      'suppressed_from_call_activity_reporting', true,
      'repair_reason', 'open New Opportunity current-pipeline task is not a completed dial fact'
    ),
  updated_at = now()
where payload_json->>'source' = 'scout_tasks_current_pipeline'
  and payload_json->>'materialization_reason' = 'missing_completion_date_for_call_activity'
  and nullif(payload_json->>'completion_at', '') is null;
