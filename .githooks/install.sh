#!/bin/sh
# Octave-Full-Wasm — 安装 git hooks（core.hooksPath=.githooks）
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later

# 安装本仓 hooks：git config core.hooksPath .githooks
set -e
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
echo "hooks 已挂载：$(git config core.hooksPath)"
