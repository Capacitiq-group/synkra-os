import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        background: "var(--charcoal-dark)",
        padding: "120px 0 0 120px",
      }}
    >
      <form onSubmit={handleSubmit} style={{ width: 320 }}>
        <div className="brand" style={{ fontSize: 20, marginBottom: 24 }}>
          SYNKRA <span className="brand__accent">OS</span>
        </div>
        <div className="field-row">
          <label>Email</label>
          <input
            className="field-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field-row">
          <label>Password</label>
          <input
            className="field-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className="error-state" style={{ padding: "8px 0" }}>{error}</div>}
        <button className="btn btn--primary" type="submit" disabled={submitting} style={{ width: "100%", marginTop: 8 }}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 16 }}>
          Employee accounts are provisioned by a Super Administrator. There is
          no public signup.
        </p>
      </form>
    </div>
  );
}
