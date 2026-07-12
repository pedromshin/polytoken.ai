# LIVE-01 local green-path DB-verification evidence

Captured: 2026-07-12T18:04:13.890Z

## Inbox
Query: `SELECT id FROM threads WHERE id = $1 AND importer_id = $2`
Result: [{"id":"aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"}]

## Email detail
Query: `SELECT e.id FROM emails e JOIN importers i ON i.id = e.importer_id WHERE e.id = $1 AND i.user_id = $2`
Result: [{"id":"bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb"}]

## Chat (conversation)
Conversation id: f5f9d8bb-0460-488f-a928-b7a5343d3e8a
Query: `SELECT cre.id FROM chat_run_events cre JOIN chat_runs cr ON cr.id = cre.run_id WHERE cr.conversation_id = $1 AND cre.type = 'tool_call'`
Result: hasToolCall=true
Query: `SELECT cm.id FROM chat_messages cm WHERE cm.conversation_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(cm.parts) elem WHERE elem->>'type' = 'genui_spec')`
Result: hasGenuiSpec=true

## Knowledge (has_table_privilege)
Query: `SELECT has_table_privilege('service_role', 'public.knowledge_nodes', 'SELECT') AS has_priv`
Result: [{"has_priv":true}]

