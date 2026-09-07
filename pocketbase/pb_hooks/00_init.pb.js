/// <reference path="../pb_data/types.d.ts" />

// This file previously defined shared helpers (ApiError, requirePermission,
// runAudited, writeAuditLog, etc.) and attached them to globalThis for other
// pb_hooks files to use.
//
// That pattern does not work on this PocketBase version: routerAdd/cronAdd
// handlers are serialized and executed in their own isolated context, with
// no access to anything declared outside the handler itself — including
// globalThis assignments made here at file-load time. Confirmed against
// production logs (ReferenceError: requirePermission is not defined /
// ReferenceError: coolifyConfigured is not defined) and PocketBase's own
// docs: https://pocketbase.io/docs/js-overview/#handlers-scope
//
// All of that logic now lives in ./shared.js — a plain .js file (not
// *.pb.js, so it is not auto-loaded as a hook), pulled in with require()
// from INSIDE each handler body that needs it:
//
//   routerAdd("POST", "/api/whatever", (e) => {
//     const shared = require(`${__hooks}/shared.js`);
//     const employee = shared.requirePermission(e, "some.permission");
//     ...
//   });
//
// This file is kept only so PocketBase's *.pb.js load order (00_ prefix)
// still reserves this slot; it registers no hooks and does nothing.
