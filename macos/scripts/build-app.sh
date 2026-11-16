#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
repo_dir="${script_dir:h:h}"
mode="${1:-release}"
[[ "$mode" == release || "$mode" == debug ]] || { print -u2 "Usa release o debug."; exit 2; }
env_file="${NUTRI_ENV_FILE:-$repo_dir/.env}"
output_dir="$repo_dir/macos/.build/app-$mode"
mkdir -p "$output_dir"
stage="$(mktemp -d "$output_dir/.stage.XXXXXXXX")"
trap 'rm -r "$stage"' EXIT
app="$stage/Nutri.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

swift_options=(--package-path "$repo_dir/macos" --configuration "$mode" --product Nutri --build-system native)
developer_dir="$(xcode-select -p)"
# CLT 27 omits the SDK's new SwiftUI macro plugin. Its bundled macOS 26 SDK
# still exposes the SwiftUI property wrappers and supports the macOS 14 target.
if [[ "$developer_dir" == */CommandLineTools && -d "$developer_dir/SDKs/MacOSX26.sdk" ]]; then
    swift_options+=(--sdk "$developer_dir/SDKs/MacOSX26.sdk")
fi
swift build "${swift_options[@]}"
bin_dir="$(swift build "${swift_options[@]}" --show-bin-path)"
install -m 755 "$bin_dir/Nutri" "$app/Contents/MacOS/Nutri"
resource_bundle="$bin_dir/Nutri_NutriCore.bundle"
[[ -d "$resource_bundle" ]] || { print -u2 "Faltan los contratos de nutrientes."; exit 1; }
ditto "$resource_bundle" "$app/Contents/Resources/Nutri_NutriCore.bundle"
design_bundle="$bin_dir/Nutri_Nutri.bundle"
[[ -d "$design_bundle" ]] || { print -u2 "Faltan los recursos de diseño."; exit 1; }
ditto "$design_bundle" "$app/Contents/Resources/Nutri_Nutri.bundle"

iconset="$stage/Nutri.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$repo_dir/public/icon-512.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    twice=$((size * 2))
    sips -z "$twice" "$twice" "$repo_dir/public/icon-512.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/Nutri.icns"
python3 "$script_dir/write_info.py" "$env_file" "$app/Contents/Info.plist" "$mode"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
if [[ -d "$output_dir/Nutri.app" ]]; then
    mv "$output_dir/Nutri.app" "$stage/previous.app"
fi
mv "$app" "$output_dir/Nutri.app"
print "$output_dir/Nutri.app"
