/// <reference path="../pb_data/types.d.ts" />

routerUse((e) => {
  try {
    const audit = require(`${__hooks}/lib_audit.js`);
    for (const k in audit) {
      globalThis[k] = audit[k];
    }
  } catch (err) {
    console.log("routerUse lib_audit init error:", err);
  }
  return e.next();
});
