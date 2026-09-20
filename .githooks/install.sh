#!/bin/sh
# 安装本仓 hooks：git config core.hooksPath .githooks
set -e
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
echo "hooks 已挂载：$(git config core.hooksPath)"
