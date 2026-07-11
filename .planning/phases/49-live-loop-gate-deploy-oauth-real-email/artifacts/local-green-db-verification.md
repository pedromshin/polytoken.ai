# LIVE-01 local green-path DB-verification evidence

Captured: 2026-07-11T02:08:24.885Z

## Inbox
Query: `SELECT id FROM threads WHERE id = $1 AND importer_id = $2`
Result: [{"id":"aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa"}]

## Email detail
Query: `SELECT e.id FROM emails e JOIN importers i ON i.id = e.importer_id WHERE e.id = $1 AND i.user_id = $2`
Result: [{"id":"bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb"}]

## Chat (conversation)
Conversation id: d586bee0-e8c3-42ba-9923-d76e71eab7f9
Query: `SELECT cre.id FROM chat_run_events cre JOIN chat_runs cr ON cr.id = cre.run_id WHERE cr.conversation_id = $1 AND cre.type = 'tool_call'`
Result: hasToolCall=true
Query: `SELECT cm.id FROM chat_messages cm WHERE cm.conversation_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(cm.parts) elem WHERE elem->>'type' = 'genui_spec')`
Result: hasGenuiSpec=true

## Knowledge (has_table_privilege)
Query: `SELECT has_table_privilege('service_role', 'public.knowledge_nodes', 'SELECT') AS has_priv`
Result: [{"has_priv":true}]

