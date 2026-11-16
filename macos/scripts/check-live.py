"""Run designated-account read-only smoke without passing secrets as arguments."""
import os
import pathlib
import subprocess
import sys

from write_info import read_values


def main():
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--write-fixtures"):
        sys.exit("Usage: check-live.py <private-env-file> [--write-fixtures]")
    run_writes = len(sys.argv) == 3
    keys = {"VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_DEV_EMAIL", "VITE_DEV_PASSWORD"}
    # write_info.py is also used by build-app.sh; loading only named variables keeps
    # all provider keys and unrelated secrets out of the test process.
    credentials = read_values(sys.argv[1], keys)
    if set(credentials) != keys or not all(credentials.values()):
        sys.exit("Designated test-account environment missing.")
    package = pathlib.Path(__file__).resolve().parent.parent
    build = ["swift", "build", "--package-path", str(package), "--product", "NutriChecks", "--build-system", "native"]
    developer_dir = pathlib.Path(subprocess.check_output(["xcode-select", "-p"], text=True).strip())
    compatible_sdk = developer_dir / "SDKs" / "MacOSX26.sdk"
    if developer_dir.name == "CommandLineTools" and compatible_sdk.is_dir():
        build += ["--sdk", str(compatible_sdk)]
    subprocess.run(build, check=True)
    directory = subprocess.check_output([*build, "--show-bin-path"], text=True).strip()
    env = {**os.environ, **credentials}
    if run_writes:
        env["NUTRI_WRITE_FIXTURE_ACCOUNT"] = "1"
    mode = "--live-write-checks" if run_writes else "--live"
    check = subprocess.run([str(pathlib.Path(directory) / "NutriChecks"), mode], env=env)
    sys.exit(check.returncode)


if __name__ == "__main__":
    main()
