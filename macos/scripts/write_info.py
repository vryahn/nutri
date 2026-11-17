"""Generate bundle metadata with the same public Supabase config as the web."""
import pathlib
import plistlib
import re
import sys
from urllib.parse import urlsplit


def read_values(path, keys):
    values = {}
    for line in pathlib.Path(path).read_text().splitlines():
        name, separator, value = line.partition("=")
        key = name.strip().removeprefix("export ")
        if separator and key in keys:
            raw = value.strip()
            if len(raw) >= 2 and raw[0] in ("'", '"') and raw[-1] == raw[0]:
                raw = raw[1:-1]
            values[key] = raw
    return values


def main():
    env_file, info_file, mode = sys.argv[1:]
    url_key, key_name = "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"
    values = read_values(env_file, {url_key, key_name})
    key = values.get(key_name, "")
    url = urlsplit(values.get(url_key, ""))
    if (url.scheme != "https" or not url.hostname or url.username or url.password
            or url.path not in ("", "/") or url.query or url.fragment):
        sys.exit("Falta URL HTTPS de Supabase.")
    if not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key):
        sys.exit("Se requiere una llave publishable de Supabase.")
    meta = {
        "CFBundleDisplayName": "Nutri",
        "CFBundleName": "Nutri",
        "CFBundleExecutable": "Nutri",
        "CFBundleIdentifier": "com.vryahn.nutri.native" + (".debug" if mode == "debug" else ""),
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.1.4",
        "CFBundleVersion": "6",
        "CFBundleIconFile": "Nutri.icns",
        "LSApplicationCategoryType": "public.app-category.healthcare-fitness",
        "LSMinimumSystemVersion": "14.0",
        "NSHighResolutionCapable": True,
        "NutriSupabaseURL": url.geturl(),
        "NutriSupabasePublishableKey": key,
        "NutriAIURL": "https://nutri.vryahn.com/api/ai",
    }
    with open(info_file, "wb") as handle:
        plistlib.dump(meta, handle)


if __name__ == "__main__":
    main()
