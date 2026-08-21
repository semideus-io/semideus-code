#!/bin/sh
# Semideus Code installer — https://github.com/semideus-io/semideus-code
#
#   curl -fsSL https://raw.githubusercontent.com/semideus-io/semideus-code/main/install.sh | sh
#
# Env overrides:
#   DAIMON_VERSION      version to install, e.g. "0.1.0" (default: latest release)
#   DAIMON_INSTALL_DIR  where the binary lands (default: ~/.local/bin)
#   DAIMON_BINARY_URL   base URL to fetch from instead of GitHub Releases
#                       (mirrors / air-gapped installs / tests)
set -eu

REPO="semideus-io/semideus-code"
INSTALL_DIR="${DAIMON_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${DAIMON_VERSION:-latest}"

fail() {
  echo "install.sh: $1" >&2
  exit 1
}

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  MINGW* | MSYS* | CYGWIN*)
    fail "on Windows, install with: npm install -g @semideus/code (windows-x64 is experimental)"
    ;;
  *) fail "unsupported OS '$os' — supported: linux-x64, darwin-arm64, darwin-x64" ;;
esac
case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported architecture '$arch' — supported: x64, arm64" ;;
esac
artifact="daimon-$os-$arch"
[ "$os-$arch" = "linux-arm64" ] && fail "linux-arm64 is not built yet — supported: linux-x64, darwin-arm64, darwin-x64"

if [ -n "${DAIMON_BINARY_URL:-}" ]; then
  base="$DAIMON_BINARY_URL"
elif [ "$VERSION" = "latest" ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  base="https://github.com/$REPO/releases/download/v${VERSION#v}"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "downloading $artifact ($VERSION) …"
curl -fsSL "$base/$artifact" -o "$tmp/$artifact" || fail "download failed: $base/$artifact"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "download failed: $base/SHA256SUMS"

expected=$(awk -v a="$artifact" '$2 == a { print $1 }' "$tmp/SHA256SUMS")
[ -n "$expected" ] || fail "no checksum for $artifact in SHA256SUMS"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$artifact" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "$tmp/$artifact" | awk '{ print $1 }')
fi
[ "$actual" = "$expected" ] || fail "checksum mismatch for $artifact — refusing to install (expected $expected, got $actual)"

mkdir -p "$INSTALL_DIR"
install -m 755 "$tmp/$artifact" "$INSTALL_DIR/daimon"
echo "installed $("$INSTALL_DIR/daimon" --version) → $INSTALL_DIR/daimon"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "note: $INSTALL_DIR is not on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
