#!/usr/bin/env python3
"""Re-verify the live figures quoted in SYNKRA-ARCHITECTURE.md.

Reads the shared PocketBase instance and prints one line per application
collection with its current record count, plus the identity-model facts the
document asserts (which auth collections exist and whether admin_users is
still empty).

Requires, in the environment (never pass these on the command line):
    PB_URL, PB_ADMIN_EMAIL, PB_PASSWORD

Standard library only - no dependencies to install.
"""

import json
import os
import sys
import urllib.request


def api(base, path, token=None, data=None):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={
            "Content-Type": "application/json",
            **({"Authorization": token} if token else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main():
    missing = [k for k in ("PB_URL", "PB_ADMIN_EMAIL", "PB_PASSWORD") if not os.environ.get(k)]
    if missing:
        sys.exit("Missing environment variable(s): " + ", ".join(missing))

    base = os.environ["PB_URL"].rstrip("/")
    if base.endswith("/_"):
        base = base[:-2]

    token = api(
        base,
        "/api/collections/_superusers/auth-with-password",
        data={
            "identity": os.environ["PB_ADMIN_EMAIL"],
            "password": os.environ["PB_PASSWORD"],
        },
    )["token"]

    collections = api(base, "/api/collections?perPage=500", token=token)["items"]
    app_collections = sorted(
        (c for c in collections if not c["name"].startswith("_")),
        key=lambda c: c["name"],
    )

    print(f"instance: {base}")
    print(f"application collections: {len(app_collections)}\n")

    counts = {}
    for c in app_collections:
        try:
            counts[c["name"]] = api(
                base, f"/api/collections/{c['name']}/records?perPage=1", token=token
            )["totalItems"]
        except Exception as exc:  # noqa: BLE001 - report, don't abort the sweep
            counts[c["name"]] = f"error: {exc}"
        print(f"| `{c['name']}` | {c['type']} | {counts[c['name']]} |")

    auth = [c["name"] for c in app_collections if c["type"] == "auth"]
    print("\nauth collections:", ", ".join(auth))
    for legacy in ("admin_users",):
        if legacy in counts:
            state = "still empty (legacy, as documented)" if counts[legacy] == 0 else "HAS RECORDS - doc is stale"
            print(f"{legacy}: {counts[legacy]} -> {state}")


if __name__ == "__main__":
    main()
