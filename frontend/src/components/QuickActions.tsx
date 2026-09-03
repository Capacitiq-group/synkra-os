import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pb } from "../lib/pocketbase";
import { useAuth } from "../auth/AuthContext";

interface QuickAction {
  id: string;
  label: string;
  permission?: string;
  run: (navigate: ReturnType<typeof useNavigate>) => void;
}

const STATIC_ACTIONS: QuickAction[] = [
  { id: "customers", label: "Find customer", permission: "customers.view", run: (nav) => nav("/customers") },
  { id: "support", label: "Create support ticket", permission: "support.view", run: (nav) => nav("/support?create=1") },
  { id: "billing", label: "View payment", permission: "billing.view", run: (nav) => nav("/billing") },
  { id: "agency", label: "Open agency pipeline", permission: "agency.view", run: (nav) => nav("/agency") },
  { id: "servers", label: "View server", permission: "infrastructure.view", run: (nav) => nav("/infrastructure") },
  { id: "incidents", label: "View incident", permission: "incidents.view", run: (nav) => nav("/incidents") },
  { id: "deployments", label: "Open deployment", permission: "deployments.view", run: (nav) => nav("/deployments") },
  { id: "ai", label: "View AI employee", permission: "ai.view", run: (nav) => nav("/ai-employees") },
  { id: "partners", label: "View partners", permission: "partners.view", run: (nav) => nav("/partners") },
  { id: "audit", label: "View audit logs", permission: "audit.view", run: (nav) => nav("/audit-logs") },
];

interface SearchResult {
  type: string;
  id: string;
  label: string;
  sublabel?: string;
}

export function QuickActions() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setCustomerResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await pb.send<{ results: SearchResult[] }>("/api/search", { query: { q: query } });
        setCustomerResults(res.results ?? []);
      } catch {
        setCustomerResults([]);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, open]);

  if (!open) return null;

  const visibleActions = STATIC_ACTIONS.filter((a) => !a.permission || hasPermission(a.permission)).filter(
    (a) => !query.trim() || a.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)} style={{ paddingTop: 100 }}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <input
          className="search-input"
          style={{ width: "100%", marginBottom: 10 }}
          placeholder="Quick actions — search customers or jump to a module…"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          {customerResults.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="panel__title" style={{ margin: "0 0 4px 0" }}>Matches</div>
              {customerResults.map((r) => (
                <div
                  key={`${r.type}-${r.id}`}
                  className="nav-link"
                  style={{ cursor: "pointer", padding: "6px 4px" }}
                  onClick={() => {
                    if (r.type === "customer") navigate(`/customers/${r.id}`);
                    setOpen(false);
                  }}
                >
                  {r.label} <span style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>{r.type}</span>
                </div>
              ))}
            </div>
          )}
          <div className="panel__title" style={{ margin: "0 0 4px 0" }}>Actions</div>
          {visibleActions.length === 0 && (
            <div style={{ color: "var(--text-muted)", padding: "6px 4px" }}>No matching actions.</div>
          )}
          {visibleActions.map((action) => (
            <div
              key={action.id}
              className="nav-link"
              style={{ cursor: "pointer", padding: "6px 4px" }}
              onClick={() => {
                action.run(navigate);
                setOpen(false);
              }}
            >
              {action.label}
            </div>
          ))}
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 10 }}>
          Esc to close · ⌘K / Ctrl+K to reopen · actions are filtered to your permissions
        </div>
      </div>
    </div>
  );
}
