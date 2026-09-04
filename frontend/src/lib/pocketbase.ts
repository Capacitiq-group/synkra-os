import PocketBase from "pocketbase";

// In dev, Vite proxies /api to the local PocketBase instance (see
// vite.config.ts). In production, the frontend is served by nginx from the
// same origin as PocketBase (see Dockerfile + nginx.conf), so a relative
// base URL works in both environments without a build-time env var.
export const pb = new PocketBase(
  import.meta.env.VITE_POCKETBASE_URL || "/"
);

// PocketBase persists the auth token in localStorage under this key by
// default via its AuthStore — nothing further to wire up here.

// The dashboard (and several list pages) fire multiple reads against the same
// collection in parallel. PocketBase's SDK auto-cancels same-key requests,
// which surfaced as "The request was autocancelled" errors on load, so we opt
// out of auto-cancellation globally and let every request complete.
pb.autoCancellation(false);
