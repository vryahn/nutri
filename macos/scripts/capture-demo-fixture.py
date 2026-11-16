"""Capture synthetic public-demo data for native view tests; never use a personal session."""
import datetime
import json
import pathlib
import sys
import urllib.parse
import urllib.request

from write_info import read_values


def main():
    if len(sys.argv) != 3:
        sys.exit("Usage: capture-demo-fixture.py <config-env-file> <output-json>")
    values = read_values(sys.argv[1], {"VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"})
    endpoint = values["VITE_SUPABASE_URL"].rstrip("/")
    public_key = values["VITE_SUPABASE_ANON_KEY"]
    if not endpoint.startswith("https://") or not public_key.startswith("sb_publishable_"):
        sys.exit("HTTPS and publishable configuration required")
    token = None

    def request(method, path, body=None):
        headers = {"apikey": public_key, "Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if path.startswith("rest/"):
            headers.update({"Accept-Profile": "nutri", "Content-Profile": "nutri"})
        req = urllib.request.Request(endpoint + "/" + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    auth = request("POST", "auth/v1/signup", {})
    token = auth["access_token"]
    try:
        if auth["user"].get("is_anonymous") is not True:
            raise RuntimeError("Refusing non-anonymous fixture account")
        request("POST", "rest/v1/rpc/seed_demo", {"lang": "en", "demo_day": datetime.date.today().isoformat()})
        tables = {}
        for name in ["foods", "recipes", "recipe_items", "meal_labels", "entries", "targets", "body_metrics", "prefs"]:
            tables[name] = request("GET", "rest/v1/" + name + "?select=*&limit=10000")
        prefs = tables["prefs"][0]["data"] if tables["prefs"] else {}
        # Match the English public-demo browser preference for visual checks.
        prefs.update({"lang": "en", "units": "us"})
        output = pathlib.Path(sys.argv[2])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({"owner": auth["user"]["id"], "anonymous": True, "prefs": prefs, "tables": tables}))
        print("Synthetic demo fixture captured:", ", ".join(f"{name}={len(rows)}" for name, rows in tables.items()))
    finally:
        request("POST", "auth/v1/logout?scope=local", {})
        print("Fixture session revoked")


if __name__ == "__main__":
    main()
