#!/usr/bin/env bash
# DSH web 部署替换脚本 v2（正确路径）
#
# v1 的教训：核心运行时（agent-loop/tools/llm/bundle）不在 profile，而在
# 全局安装 /Users/bohongchen/.nvm/.../node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai。
# v1 替换了 profile .pnpm 的附属包（不影响核心，反而造成版本混合污染）。
#
# v2 做三件事：
#   1. 恢复 profile 到备份（撤掉 v1 的污染）
#   2. 备份全局 dsh 安装
#   3. 替换全局：源码 build:lib 产物覆盖改过的包 lib/ + 复制新增 guard 包 +
#      覆盖 dsh-base/cordis.patch.yml（启用新 guard + vetoAt）
#   4. 重启 dsh web + 冒烟 + 失败回滚
#
# 仍需你在宿主外执行（重启会中断当前会话）：
#   bash /Users/bohongchen/Projects/deepseek-harness/scripts/deploy-dsh-web.sh
set -euo pipefail

SRC=/Users/bohongchen/Projects/deepseek-harness
NVM_D=/Users/bohongchen/.nvm/versions/node/v22.23.2/lib/node_modules
G="$NVM_D/@deepseek-ai/dsh/node_modules/@deepseek-ai"
PROFILE=~/.dsh/profiles/web
BACKUP_PROFILE=$(ls -d ~/.dsh/profiles/web.backup-* 2>/dev/null | tail -1 || true)
BACKUP_G="$G.dsh-deploy-backup"
WEB_URL=http://127.0.0.1:3080

echo "== 1/6 恢复 profile 到 v1 备份（撤掉污染）=="
if [ -n "$BACKUP_PROFILE" ] && [ -d "$BACKUP_PROFILE" ]; then
  rm -rf "$PROFILE"
  cp -R "$BACKUP_PROFILE" "$PROFILE"
  echo "  profile 已恢复自 $BACKUP_PROFILE"
else
  echo "  未找到 v1 备份（跳过；profile 保持现状）"
fi

echo "== 2/6 备份全局 dsh 安装 =="
rm -rf "$BACKUP_G"
cp -R "$G" "$BACKUP_G"
echo "  全局备份 -> $BACKUP_G"

echo "== 3/6 替换全局包 lib/（源码 build:lib 产物）=="
replaced=0
for pkg in \
  dsh-agent-loop dsh-agent dsh-session dsh-system-prompt dsh-tools dsh-scope \
  dsh-llm dsh-repeat-tool-reminder dsh-jobs-local dsh-mcp-client \
  dsh-web-fetch-http dsh-host-apiproxy dsh-goal dsh-hooks-codex \
  dsh-session-projection-cache dsh-sandbox-policy; do
  srclib=$(find "$SRC/packages" -maxdepth 3 -type d -path "*/$pkg/lib" 2>/dev/null | head -1)
  if [ -n "$srclib" ] && [ -d "$G/$pkg" ]; then
    cp -R "$srclib/." "$G/$pkg/lib/"
    replaced=$((replaced+1))
  fi
done
echo "  替换 $replaced 个包 lib"

echo "== 4/6 复制新增 guard 包 + 覆盖 base patch =="
for pkg in dsh-escalation-hider dsh-output-repetition-guard dsh-action-policy-guard; do
  srcdir=$(find "$SRC/packages/guard" -maxdepth 1 -type d -name "$pkg" | head -1)
  if [ -n "$srcdir" ] && [ -d "$srcdir/lib" ]; then
    rm -rf "$G/$pkg"
    mkdir -p "$G/$pkg"
    cp "$srcdir/package.json" "$G/$pkg/"
    cp -R "$srcdir/lib" "$G/$pkg/lib"
    echo "  新增包 $pkg"
  fi
done
cp "$SRC/packages/bundle/base/cordis.patch.yml" "$G/dsh-base/cordis.patch.yml"
echo "  base patch 已覆盖（启用 escalation-hider/output-repetition-guard/action-policy-guard + vetoAt:6）"

echo "== 5/6 重启 dsh web =="
pkill -f "dsh web" || true
sleep 2
nohup dsh web >/tmp/dsh-web-deploy.log 2>&1 &
echo "  restarted, waiting for $WEB_URL ..."
ok=0
for i in $(seq 1 30); do
  if curl -sf "$WEB_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

echo "== 6/6 冒烟 =="
if [ "$ok" -eq 1 ]; then
  echo "  GUI 可达 ✓"
  echo "完成。全局备份在 $BACKUP_G（确认无误后可删除）"
else
  echo "  GUI 未恢复——回滚" >&2
  pkill -f "dsh web" || true
  sleep 2
  rm -rf "$G"
  cp -R "$BACKUP_G" "$G"
  nohup dsh web >/tmp/dsh-web-deploy.log 2>&1 &
  echo "  已回滚全局安装" >&2
  exit 1
fi
