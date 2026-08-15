SELECT jsonb_build_object(
  'crmPipelines', COALESCE((SELECT jsonb_agg(jsonb_build_array(id, name_normalized, description, status, created_by_id, version, created_at, updated_at) ORDER BY id) FROM crm_pipelines), '[]'::jsonb),
  'crmPipelineStages', COALESCE((SELECT jsonb_agg(jsonb_build_array(id, pipeline_id, name_normalized, position, outcome, created_at, updated_at) ORDER BY id) FROM crm_pipeline_stages), '[]'::jsonb),
  'crmLeads', COALESCE((SELECT jsonb_agg(jsonb_build_array(id, customer_id, pipeline_id, current_stage_id, source, source_reference, title, status, owner_id, version, qualified_at, won_at, lost_at, archived_at, created_at, updated_at) ORDER BY id) FROM crm_leads), '[]'::jsonb),
  'crmLeadStageHistory', COALESCE((SELECT jsonb_agg(jsonb_build_array(id, lead_id, pipeline_id, version, idempotency_key, from_stage_id, to_stage_id, from_status, to_status, actor_id, reason_code, sanitized_metadata, created_at) ORDER BY id) FROM crm_lead_stage_history), '[]'::jsonb),
  'crmTasks', COALESCE((SELECT jsonb_agg(jsonb_build_array(id, customer_id, lead_id, customer_service_case_id, source, source_reference, type, status, priority, title, sanitized_description, assigned_to_id, due_at, completed_at, cancelled_at, version, created_at, updated_at) ORDER BY id) FROM crm_tasks), '[]'::jsonb),
  'crmNotes', COALESCE((SELECT jsonb_agg(jsonb_build_array(id, customer_id, lead_id, customer_service_case_id, source, source_reference, body, content_hash, author_id, created_at) ORDER BY id) FROM crm_notes), '[]'::jsonb)
)::text;
