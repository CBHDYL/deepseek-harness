#!/usr/bin/env bash
# DSH web 部署替换脚本 v2（正确路径）
#
# v1 的教训：核心运行时（agent-loop/tools/llm/bundle）不在 profile，而在
# 全局安装 /Users/bohongchen/.nvm/.../node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai。
# v1 替换了 profile .pnpm 的附属包（不影响核心，反而造成版本混合污染）。
#
# v2.2 做四件事（v2.1 + 补齐阶段1-6/第二波遗漏包）：
#   1. 恢复 profile 到备份（撤掉 v1 的污染）
#   2. 备份全局 dsh 安装
#   3. 替换全局：源码 build:lib 产物覆盖改过的包 lib/（含 boot/app-boot——
#      $merge/$unset 补丁支持的 app-boot 侧）+ 复制新增包（guard×3 + web-fetch-http
#      SSRF 防护——全局发布包不含此包，需整体复制 package.json + lib）+
#      覆盖 dsh-base/cordis.patch.yml（启用新 guard + vetoAt）
#   4. 重启 dsh web + 冒烟 + 失败回滚
# 2026-08-29 部署验证（DSH-AH-PLAN-EVALUATION.md）补漏：app-boot 与 web-fetch-http
#   此前不在映射里，运行时 index.js 与源码不一致/整包缺失。
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

echo "== 3/6 替换全局包 lib/（源码目录→全局包名 精确映射）=="
replaced=0
while read -r srcdir pkg; do
  [ -z "$srcdir" ] && continue
  if [ -d "$SRC/packages/$srcdir/lib" ] && [ -d "$G/$pkg" ]; then
    cp -R "$SRC/packages/$srcdir/lib/." "$G/$pkg/lib/"
    replaced=$((replaced+1))
  fi
done <<'MAP'
core/agent-loop dsh-agent-loop
core/agent dsh-agent
core/session dsh-session
core/system-prompt dsh-system-prompt
core/tools dsh-tools
core/scope dsh-scope
llm/llm dsh-llm
sandbox/sandbox dsh-sandbox
shell/tool-bash dsh-tool-bash
fs/tool-fs dsh-tool-fs
guard/repeat-tool-reminder dsh-repeat-tool-reminder
jobs/jobs-local dsh-jobs-local
mcp/mcp-client dsh-mcp-client
host/apiproxy dsh-host-apiproxy
goal/goal dsh-goal
session/session-projection-cache dsh-session-projection-cache
sandbox/sandbox-policy dsh-sandbox-policy
boot/app-boot dsh-app-boot
MAP
echo "  替换 $replaced 个包 lib"
cp "$SRC/vendor/include/lib/index.js" "$G/cordis-plugin-include/lib/index.js" || true
echo "  vendor include 已替换"

echo "== 4/6 复制新增包（guard×3 + web-fetch-http SSRF）+ 覆盖 base patch =="
# (srcDir pkgName) 对：全局不存在或需整体替换的包，整体复制 package.json + lib
while read -r srcdir pkg; do
  [ -z "$srcdir" ] && continue
  if [ -d "$SRC/packages/$srcdir/lib" ]; then
    rm -rf "$G/$pkg"
    mkdir -p "$G/$pkg"
    cp "$SRC/packages/$srcdir/package.json" "$G/$pkg/"
    cp -R "$SRC/packages/$srcdir/lib" "$G/$pkg/lib"
    echo "  新增/整体替换包 $pkg"
  else
    echo "  ⚠️ $srcdir 无 lib，跳过 $pkg" >&2
  fi
done <<'NEWPKG'
guard/escalation-hider dsh-escalation-hider
guard/output-repetition-guard dsh-output-repetition-guard
guard/action-policy-guard dsh-action-policy-guard
web/web-fetch-http dsh-web-fetch-http
extensions/tool-service dsh-tool-service
extensions/tool-browser dsh-tool-browser
NEWPKG
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
