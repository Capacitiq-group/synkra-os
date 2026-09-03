import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { GlobalSearch } from "./GlobalSearch";
import { QuickActions } from "./QuickActions";

interface NavItem {
  to: string;
  label: string;
  permission?: string; // undefined = visible to any authenticated employee
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ to: "/dashboard", label: "Executive Dashboard" }],
  },
  {
    label: "Growth",
    items: [
      { to: "/acquisition", label: "Acquisition Engine", permission: "acquisition.view" },
      { to: "/leads", label: "Leads", permission: "leads.view" },
      { to: "/follow-ups", label: "Follow-ups", permission: "followups.view" },
    ],
  },
  {
    label: "Customer Operations",
    items: [
      { to: "/customers", label: "Customers", permission: "customers.view" },
      { to: "/support", label: "Support", permission: "support.view" },
      { to: "/billing", label: "Billing", permission: "billing.view" },
      { to: "/agency", label: "Agency Operations", permission: "agency.view" },
      { to: "/agency-platform", label: "Agency Platform", permission: "agency.view" },
      { to: "/email", label: "Email", permission: "email.view" },
    ],
  },
  {
    label: "Products",
    items: [
      { to: "/flow", label: "Flow", permission: "flow.view" },
      { to: "/chat", label: "Chat", permission: "chat.view" },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/ai-employees", label: "AI Employees", permission: "ai.view" },
      { to: "/infrastructure", label: "Infrastructure", permission: "infrastructure.view" },
      { to: "/incidents", label: "Incidents", permission: "incidents.view" },
      { to: "/deployments", label: "Deployments", permission: "deployments.view" },
      { to: "/utilities", label: "Utilities", permission: "utilities.view" },
    ],
  },
  {
    label: "Relationships",
    items: [{ to: "/partners", label: "Partners", permission: "partners.view" }],
  },
  {
    label: "Governance",
    items: [
      { to: "/audit-logs", label: "Audit Logs", permission: "audit.view" },
      { to: "/integrations", label: "Integrations", permission: "integrations.view" },
      { to: "/settings", label: "Settings" },
    ],
  },
];

export function AppShell() {
  const { employee, role, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shell">
      <div className="shell__topbar">
        <div className="brand">
          SYNKRA <span className="brand__accent">OS</span>
        </div>
        <GlobalSearch />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--text-secondary)" }}>
            {employee?.full_name ?? "—"} · {role?.name ?? "—"}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>⌘K for quick actions</span>
          <button
            className="btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Log out
          </button>
        </div>
      </div>
      <div className="shell__sidebar">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => !item.permission || hasPermission(item.permission));
          if (visibleItems.length === 0) return null;
          return (
            <div className="nav-group" key={group.label}>
              <div className="nav-group__label">{group.label}</div>
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
      <div className="shell__main">
        <Outlet />
      </div>
      <QuickActions />
    </div>
  );
}
