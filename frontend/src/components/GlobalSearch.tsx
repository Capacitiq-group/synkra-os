import { useState } from "react";
import { pb } from "../lib/pocketbase";

interface SearchResult {
  type: string;
  id: string;
  label: string;
  sublabel?: string;
}

const TYPE_ROUTES: Record<string, string> = {
  customer: "/customers",
  ticket: "/support",
};

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function runSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await pb.send<{ results: SearchResult[] }>("/api/search", {
        query: { q: value },
      });
      setResults(res.results ?? []);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 420, margin: "0 16px" }}>
      <input
        className="search-input"
        style={{ width: "100%" }}
        placeholder="Search customers, tickets, invoices, subscriptions…"
        value={query}
        onChange={(e) => runSearch(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "var(--charcoal-medium)",
            border: "1px solid var(--border-color)",
            zIndex: 40,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {loading && <div style={{ padding: 10, color: "var(--text-secondary)" }}>Searching…</div>}
          {!loading && results.length === 0 && (
            <div style={{ padding: 10, color: "var(--text-secondary)" }}>No matches.</div>
          )}
          {results.map((r) => (
            <a
              key={`${r.type}-${r.id}`}
              href={TYPE_ROUTES[r.type] ? `${TYPE_ROUTES[r.type]}?focus=${r.id}` : "#"}
              style={{
                display: "block",
                padding: "8px 10px",
                borderBottom: "1px solid var(--border-color)",
                color: "var(--off-white)",
              }}
            >
              <div style={{ fontSize: 12 }}>{r.label}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>
                {r.type.replace(/_/g, " ")}
                {r.sublabel ? ` · ${r.sublabel}` : ""}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
