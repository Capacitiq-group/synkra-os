import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";
import type { Customer } from "../../types/models";

export function CustomersListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(searchTerm: string) {
    setLoading(true);
    setError(null);
    try {
      let filter = "";
      if (searchTerm.trim()) {
        const q = searchTerm.trim().replace(/"/g, '\\"');
        filter = [
          `name ~ "${q}"`,
          `email ~ "${q}"`,
          `phone ~ "${q}"`,
          `customer_code ~ "${q}"`,
        ].join(" || ");
        // Subscription ID search: resolve subscription -> customer first.
        try {
          const sub = await pb
            .collection("subscriptions")
            .getFirstListItem(`subscription_code = "${q}"`);
          if (sub) filter += ` || id = "${sub.customer}"`;
        } catch {
          // no matching subscription — fine, ignore
        }
      }
      const result = await pb.collection("customers").getList<Customer>(1, 50, {
        filter,
        sort: "-created",
        expand: "organisation,assigned_staff",
      });
      setRows(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => load(query), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const columns: Column<Customer>[] = [
    { header: "Code", render: (c) => c.customer_code, width: "110px" },
    { header: "Name", render: (c) => c.name },
    { header: "Company", render: (c) => c.expand?.organisation?.name ?? "—" },
    { header: "Email", render: (c) => c.email },
    { header: "Type", render: (c) => c.customer_type.replace(/_/g, " ") },
    { header: "Status", render: (c) => <StatusBadge status={c.account_status} /> },
    { header: "Assigned", render: (c) => c.expand?.assigned_staff?.full_name ?? "Unassigned" },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Customers</h1>
        <span className="page-header__meta">{rows.length} shown</span>
      </div>
      <div style={{ marginBottom: 14 }}>
        <input
          className="search-input"
          style={{ width: 360 }}
          placeholder="Search name, email, phone, company, customer ID, subscription ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={loading}
        error={error}
        emptyMessage="No customers match this search."
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        onRetry={() => load(query)}
      />
    </div>
  );
}
