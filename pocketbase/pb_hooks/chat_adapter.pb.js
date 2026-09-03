/// <reference path="../pb_data/types.d.ts" />

// CHAT INTEGRATION ADAPTER
//
// Unlike Flow, the Chat backend has not been identified at all in this
// environment — no repository, no API docs, no database type was
// available to inspect. Per the brief: do not guess its schema, do not
// fabricate conversations. What follows is the connection boundary and
// the response shape the rest of the app is written against, so that
// connecting a real Chat backend later is a matter of filling in
// normalizeChatConversation() and a chatRequest() wrapper (mirroring
// flow_adapter.pb.js), not restructuring the UI or the permission model.
//
// Configure via CHAT_API_BASE + CHAT_API_KEY once a Chat backend exists.
// Until then, every route below returns "not_configured" honestly.

function chatConfigured() {
  return !!$os.getenv("CHAT_API_BASE");
}

routerAdd("GET", "/api/chat/status", (e) => {
  requirePermission(e, "chat.view");
  const row = tryFindFirst(e.app, "integration_status", "integration_key = 'chat'", {});
  return e.json(200, row || { integration_key: "chat", status: "not_configured" });
});

routerAdd("GET", "/api/chat/conversations", (e) => {
  requirePermission(e, "chat.view");
  if (!chatConfigured()) {
    recordIntegrationStatus(e.app, "chat", "not_configured");
    // 200 with an empty, explicitly-labeled result rather than a hard
    // error — the Chat module should render as "not connected", not crash.
    return e.json(200, { items: [], connection_status: "not_configured" });
  }
  // No real Chat backend exists to call yet. When one does: mirror the
  // pattern in flow_adapter.pb.js — a chatRequest() wrapper, a
  // normalizeChatConversation() mapping function isolating Chat's actual
  // field names, and recordIntegrationStatus() on every attempt.
  recordIntegrationStatus(e.app, "chat", "unavailable", "CHAT_API_BASE is set but no adapter implementation exists yet for this backend type.");
  return e.json(200, { items: [], connection_status: "unavailable" });
});
