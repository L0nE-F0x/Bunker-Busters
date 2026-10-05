#!/usr/bin/env bash
# Cut a release: bump the version everywhere, verify the build, commit, tag, push.
# Pushing the tag triggers .github/workflows/release.yml, which builds Linux + Windows and
# publishes the GitHub Release (the website's download buttons pick it up automatically).
#
#   scripts/release.sh patch          # 0.1.0 -> 0.1.1
#   scripts/release.sh minor          # 0.1.0 -> 0.2.0
#   scripts/release.sh 0.3.0          # explicit
#   scripts/release.sh patch --dry-run   # bump + verify locally, then restore files (no commit/tag/push)
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-}"
DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1
[ -n "$BUMP" ] || { echo "usage: scripts/release.sh <patch|minor|major|X.Y.Z> [--dry-run]"; exit 1; }

# ---- preflight -------------------------------------------------------------------------------
branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { echo "Release from main (currently on $branch)."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Working tree not clean — commit or stash first."; git status --short; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not in sync with origin/main — pull/push first."; exit 1; }

current="$(node -p "require('./package.json').version")"
IFS=. read -r MA MI PA <<<"$current"
case "$BUMP" in
  patch) next="$MA.$MI.$((PA + 1))" ;;
  minor) next="$MA.$((MI + 1)).0" ;;
  major) next="$((MA + 1)).0.0" ;;
  [0-9]*.[0-9]*.[0-9]*) next="$BUMP" ;;
  *) echo "Bad version/bump: $BUMP"; exit 1 ;;
esac
tag="v$next"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && { echo "Tag $tag already exists."; exit 1; }
git ls-remote --exit-code --tags origin "$tag" >/dev/null 2>&1 && { echo "Tag $tag already exists on origin."; exit 1; }
echo "Releasing $current -> $next ($tag)"

# ---- bump: package.json(+lock), tauri.conf.json, Cargo.toml, Cargo.lock ----------------------
npm version "$next" --no-git-tag-version >/dev/null
node -e '
  const fs = require("fs"); const f = "src-tauri/tauri.conf.json";
  const j = JSON.parse(fs.readFileSync(f, "utf8")); j.version = process.argv[1];
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");' "$next"
sed -i -E "0,/^version = \"[^\"]+\"/s//version = \"$next\"/" src-tauri/Cargo.toml
python3 - "$next" <<'PY'
import re, sys
p = "src-tauri/Cargo.lock"
s = open(p).read()
s = re.sub(r'(name = "bunker-busters"\nversion = ")[^"]+(")', r'\g<1>' + sys.argv[1] + r'\2', s, count=1)
open(p, "w").write(s)
PY

# ---- verify ----------------------------------------------------------------------------------
echo "Verifying web build…"
npm run build >/dev/null
echo "Verifying desktop shell compiles…"
cargo check -q --manifest-path src-tauri/Cargo.toml

if [ "$DRY" = 1 ]; then
  git diff --stat
  git checkout -- package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
  echo "Dry run OK — files restored, nothing committed."
  exit 0
fi

# ---- commit, tag, push ------------------------------------------------------------------------
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -q -m "Release $tag"
git tag -a "$tag" -m "Bunker Busters $tag"
git push -q origin main
git push -q origin "$tag"
echo
echo "Pushed $tag. CI is building Linux + Windows and will publish the release."
echo "  Watch:   gh run watch \$(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status"
echo "  Release: https://github.com/L0nE-F0x/Bunker-Busters/releases/tag/$tag"
echo "  Update your own install afterwards:  npm run desktop:install"
