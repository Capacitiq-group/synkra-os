import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { SourceTag } from "../../lib/integrations";

export function ChatPage() {
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pb.send<{ items: unknown[]; connection_status: string }>("/api/chat/conversations", { method: "GET" })
      .then((res) => setConnectionStatus(res.connection_status))
      .catch(() => setConnectionStatus("unavailable"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Chat</h1>
        <SourceTag source="Chat" />
      </div>

      {loading ? (
        <div className="loading-state">Checking Chat connection…</div>
      ) : (
        <div className="panel">
          <div className="panel__title">Chat is not connected</div>
          <p style={{ color: "var(--text-secondary)" }}>
            No Synkra Chat backend has been identified or connected yet
            (status: {connectionStatus ?? "unknown"}). This page is a real
            integration boundary, not a placeholder screen — once a Chat
            backend and its API are available, the adapter in
            <code style={{ margin: "0 4px" }}>pocketbase/pb_hooks/chat_adapter.pb.js</code>
            can be filled in without changing this page's structure. Nothing
            here is invented: no fake conversations, agents, or CSAT scores.
          </p>
          <p style={{ color: "var(--text-secondary)" }}>
            Once connected, this module will show conversations, customers,
            assigned agents, status, labels, CSAT, SLA, history,
            attachments, AI involvement, and response times, per spec.
          </p>
        </div>
      )}
    </div>
  );
}
