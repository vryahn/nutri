"""Generate the iPhone Info.plist without copying private environment values."""
import hashlib
import os
from pathlib import Path
import plistlib
import re
import sys
from tempfile import NamedTemporaryFile

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "macos/scripts"))
from write_info import read_values


def native_contract():
    # Keep this byte-for-byte compatible with scripts/native-contract.mjs.
    # CI checks equality so Xcode builds can use the bundled Python without Node.
    files = [
        Path("macos/Sources/NutriCore/Resources/Contracts.json"),
        Path("api/ai.js"),
        *sorted((ROOT / "supabase/migrations").glob("*.sql")),
    ]
    digest = hashlib.sha256()
    for path in files:
        relative = path.relative_to(ROOT) if path.is_absolute() else path
        digest.update(relative.as_posix().encode() + b"\0")
        digest.update((ROOT / path).read_bytes() + b"\0")
    return digest.hexdigest()[:16]


def public_configuration():
    if os.environ.get("NUTRI_IOS_UI_TESTING") == "YES":
        if (os.environ.get("PLATFORM_NAME"), os.environ.get("CONFIGURATION")) != ("iphonesimulator", "Debug"):
            sys.exit("NUTRI_IOS_UI_TESTING solo se permite en Debug para el simulador.")
        return "https://nutri-ui-test.invalid", "sb_publishable_ios_ui_test"

    url_key = "VITE_SUPABASE_URL"
    publishable_key = "VITE_SUPABASE_ANON_KEY"
    env_path = os.environ.get("NUTRI_ENV_FILE") or ROOT / ".env"
    try:
        values = read_values(env_path, {url_key, publishable_key})
    except (OSError, UnicodeError):
        sys.exit("Nutri requiere un .env local legible con la URL y la llave publishable de Supabase.")
    url = values.get(url_key, "")
    key = values.get(publishable_key, "")
    if not re.fullmatch(r"https://[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/?", url):
        sys.exit("Nutri requiere una URL HTTPS de Supabase sin ruta, credenciales ni parámetros.")
    if not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key):
        sys.exit("Nutri requiere una llave publishable de Supabase.")
    return url.rstrip("/"), key


def write_info(output):
    url, key = public_configuration()
    service = url if url.endswith(".invalid") else "https://nutri.vryahn.com"
    info = {
        "CFBundleDisplayName": "Nutri",
        "ITSAppUsesNonExemptEncryption": False,
        "NSCameraUsageDescription": "Take photos of nutrition labels, log your progress, or update your profile picture.",
        "NutriSupabaseURL": url,
        "NutriSupabasePublishableKey": key,
        "NutriAIURL": service + "/api/ai",
        "NutriContract": native_contract(),
        "NutriContractURL": service + "/native-contract.json",
    }
    data = plistlib.dumps(info)
    if output.is_file() and output.read_bytes() == data:
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=output.parent, delete=False) as staged:
        staged.write(data)
    Path(staged.name).replace(output)


if __name__ == "__main__":
    if sys.argv[1:] == ["--contract"]:
        print(native_contract())
    elif len(sys.argv) == 2:
        write_info(Path(sys.argv[1]))
    else:
        sys.exit("Usa write_info.py --contract o write_info.py RUTA_DEL_PLIST.")
