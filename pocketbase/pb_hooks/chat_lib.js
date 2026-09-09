// pb_hooks/chat_lib.js
//
// Plain CommonJS module (NOT *.pb.js). See chat_adapter.pb.js's header for
// why this file is deliberately minimal — no real Chat backend has been
// identified yet, so there is nothing here to normalize or request.

function chatConfigured() {
  return !!$os.getenv("CHAT_API_BASE");
}

module.exports = { chatConfigured };
