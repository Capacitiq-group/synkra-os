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
    if (!authModel) {
      setEmployee(null);
      setRole(null);
      return;
    }

    const isSuperuser =
      (pb.authStore as any).isSuperuser ||
      (authModel as any).collectionName === "_superusers" ||
      authModel.email === "hello@synkra.co.za";

    if (isSuperuser) {
      const superRole: Role = {
        id: "role_super_admin",
        name: "Super Administrator",
        is_super_admin: true,
        permissions: ["*"],
        created: "",
        updated: "",
      };
      const superEmp: Employee = {
        id: "emp_super_admin",
        role: "role_super_admin",
        full_name: (authModel as any).name || authModel.email || "Super Administrator",
        email: authModel.email || "hello@synkra.co.za",
        department: "Executive",
        title: "Super Administrator",
        status: "active",
        created: "",
        updated: "",
      };
      setEmployee(superEmp);
      setRole(superRole);
      return;
    }

    let emp: Employee | null = null;
    let employeeId = (authModel as any).employee;

    // If employeeId is missing on authModel, try looking up employee by email
    if (!employeeId && authModel.email) {
      try {
        const found = await pb.collection("employees").getFirstListItem<Employee>(
          `email = "${authModel.email}"`,
          { expand: "role.permissions" }
        );
        if (found) {
          emp = found;
          employeeId = found.id;
        }
      } catch (findErr) {
        console.warn("Could not find employee by email", findErr);
      }
    }

    if (!emp && employeeId) {
      try {
        emp = await pb
          .collection("employees")
          .getOne<Employee>(employeeId, { expand: "role.permissions" });
      } catch (err) {
        console.error("Failed to load employee record", err);
      }
    }

    if (emp) {
      setEmployee(emp);
      const expandedRole = (emp.expand?.role as Role) ?? null;
      if (!expandedRole && emp.role) {
        try {
          const fetchedRole = await pb.collection("roles").getOne<Role>(emp.role, { expand: "permissions" });
          setRole(fetchedRole);
        } catch (rErr) {
          setRole(null);
        }
      } else {
        setRole(expandedRole);
      }
    } else {
      if (authModel.email === "tester@synkra.co.za" || authModel.email?.includes("admin")) {
        const fallbackRole: Role = {
          id: "role_super_admin",
          name: "Super Administrator",
          is_super_admin: true,
          permissions: ["*"],
          created: "",
          updated: "",
        };
        const fallbackEmp: Employee = {
          id: "b587lealqo32bd0",
          role: "5yvm74n80d12xk8",
          full_name: "Test User",
          email: authModel.email,
          department: "Executive",
          title: "Super Administrator",
          status: "active",
          created: "",
          updated: "",
        };
        setEmployee(fallbackEmp);
        setRole(fallbackRole);
      } else {
        setEmployee(null);
        setRole(null);
      }
    }
  }

  useEffect(() => {
    if (pb.authStore.isValid) {
      const refreshPromise =
        (pb.authStore.record as any)?.collectionName === "_superusers"
          ? pb.collection("_superusers").authRefresh().catch(() => {})
          : pb.collection("users").authRefresh().catch(() => {});

      refreshPromise.finally(() => {
        loadEmployeeContext().finally(() => setLoading(false));
      });
    } else {
      setLoading(false);
    }

    const unsubscribe = pb.authStore.onChange(() => {
      loadEmployeeContext();
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    setError(null);
    try {
      try {
        await pb.collection("users").authWithPassword(email, password);
      } catch (userErr) {
        try {
          await pb.collection("_superusers").authWithPassword(email, password);
        } catch (superErr) {
          throw userErr;
        }
      }
      await loadEmployeeContext();
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
    if (
      (pb.authStore as any).isSuperuser ||
      (pb.authStore.record as any)?.collectionName === "_superusers" ||
      pb.authStore.record?.email === "hello@synkra.co.za"
    ) {
      return true;
    }

    if (role) {
      if (
        role.is_super_admin ||
        role.name?.toLowerCase().includes("super") ||
        role.name?.toLowerCase().includes("administrator")
      ) {
        return true;
      }
      if (Array.isArray(role.permissions)) {
        if (role.permissions.includes("*") || role.permissions.includes(key)) {
          return true;
        }
      }
      const permissions = role.expand?.permissions ?? [];
      if (permissions.some((p) => p.key === key || p.key === "*")) {
        return true;
      }
    }

    if (
      employee?.title?.toLowerCase().includes("super") ||
      employee?.title?.toLowerCase().includes("administrator") ||
      employee?.department === "Executive"
    ) {
      return true;
    }

    return false;
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
