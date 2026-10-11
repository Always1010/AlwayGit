#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'AlwayGit：找不到 Node.js，请先准备 Node.js；脚本不会自动安装。' >&2
  exit 1
fi
exec node "$script_dir/install.mjs" "$@"
