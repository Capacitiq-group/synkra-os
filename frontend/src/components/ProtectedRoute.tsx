import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function ProtectedRoute({
  children,
  permission,
}: {
  children: JSX.Element;
  permission?: string;
}) {
  const { isAuthenticated, loading, hasPermission } = useAuth();

  if (loading) return <div className="loading-state">Loading…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(permission)) {
    return (
      <div className="error-state">
        You do not have the "{permission}" permission required to view this page.
      </div>
    );
  }
  return children;
}
