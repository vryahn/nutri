#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
source_app="${script_dir:h}/.build/app-release/Nutri.app"
destination="${1:-/Applications/Nutri.app}"
identifier=com.vryahn.nutri.native
actual_identifier() { /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist"; }
codesign --verify --deep --strict "$source_app"
[[ "$(actual_identifier "$source_app")" == "$identifier" ]]
if [[ -e "$destination" || -L "$destination" ]]; then
    [[ ! -L "$destination" && "$(actual_identifier "$destination" 2>/dev/null)" == "$identifier" ]] ||
        { print -u2 "Ya existe otra aplicación en $destination."; exit 1; }
fi
stage="$(mktemp -d "${destination:h}/.nutri-install.XXXXXXXX")"
cleanup() {
    if [[ -d "$stage/previous.app" && ! -e "$destination" ]]; then mv "$stage/previous.app" "$destination"; fi
    rm -r "$stage"
}
trap cleanup EXIT
ditto "$source_app" "$stage/Nutri.app"
codesign --verify --deep --strict "$stage/Nutri.app"
if [[ -d "$destination" ]]; then mv "$destination" "$stage/previous.app"; fi
mv "$stage/Nutri.app" "$destination"
codesign --verify --deep --strict "$destination"
print "$destination"
