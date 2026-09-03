import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { pb } from "../lib/pocketbase";
import type { Employee, Role } from "../types/models";

interface AuthContextValue {
  isAuthenticated: boolean;
  employee: Employee | null;
  role: Role | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  // UI-only convenience. The frontend uses this to decide what to render;
  // it is never a substitute for the server-side permission checks in
  // pocketbase/pb_hooks. A user could open devtools and see a hidden
  // button's handler, but the API call behind it would still 403.
  hasPermission: (key: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadEmployeeContext() {
    const authModel = pb.authStore.record;
    if (!authModel || !authModel.employee) {
      setEmployee(null);
      setRole(null);
      return;
    }
    try {
      const emp = await pb
        .collection("employees")
        .getOne<Employee>(authModel.employee, { expand: "role.permissions" });
      setEmployee(emp);
      setRole((emp.expand?.role as Role) ?? null);
    } catch (err) {
      console.error("Failed to load employee/role context", err);
      setEmployee(null);
      setRole(null);
    }
  }

  useEffect(() => {
    loadEmployeeContext().finally(() => setLoading(false));
    const unsubscribe = pb.authStore.onChange(() => {
      loadEmployeeContext();
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    setError(null);
    try {
      await pb.collection("users").authWithPassword(email, password);
      await loadEmployeeContext();
      if (!pb.authStore.record?.employee) {
        pb.authStore.clear();
        throw new Error("This login is not linked to an active employee record.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed.";
      setError(message);
      throw err;
    }
  }

  function logout() {
    pb.authStore.clear();
    setEmployee(null);
    setRole(null);
  }

  function hasPermission(key: string): boolean {
    if (!role) return false;
    if (role.is_super_admin) return true;
    const permissions = role.expand?.permissions ?? [];
    return permissions.some((p) => p.key === key);
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: pb.authStore.isValid,
        employee,
        role,
        loading,
        error,
        login,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
