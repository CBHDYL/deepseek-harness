#!/usr/bin/env bash
# DSH web 部署替换脚本：把 dsh-core-stopgap 分支的修复产物部署到运行中的
# web profile（~/.dsh/profiles/web），失败自动回滚。
#
# 为什么需要你手动执行：替换后要重启 `dsh web`，而当前 agent 会话就运行在
# 这个 GUI 里——重启会中断会话本身。请在你的终端里执行：
#   bash /Users/bohongchen/Projects/deepseek-harness/scripts/deploy-dsh-web.sh
#
# 边界（诚实声明）：
# - profile 当前 bundle 版本 0.1.0-rc.8 旧于源码基线 0.1.1-rc.2，本脚本做
#   文件级替换（不改版本号、不动 pnpm 链接结构），是保守的灰度路径；
# - 第三方 bundle（dshmarket、@linxin666/dsh-web-all 等）未验证与 0.1.1-rc.2
#   产物兼容，若有异常请回滚并报告。
set -euo pipefail

SRC=/Users/bohongchen/Projects/deepseek-harness
PROFILE=~/.dsh/profiles/web
BACKUP="$PROFILE.backup-$(date +%Y%m%d-%H%M%S)"
WEB_URL=http://127.0.0.1:3080

echo "== 1/5 备份 profile =="
cp -R "$PROFILE" "$BACKUP"
echo "backup -> $BACKUP"

echo "== 2/5 替换 dsh-base / dsh-web-app 构建产物 =="
# pnpm 布局：真实文件在 .pnpm/<name>@<version>/node_modules/<name> 里。
# 用本地构建的 lib/ 覆盖（build:lib 已产出；web frontend dist 由 build:web 产出）。
replaced=0
for pkg in dsh-base dsh-web-app; do
  for dir in "$PROFILE"/node_modules/.pnpm/@deepseek-ai+${pkg}@*/node_modules/@deepseek-ai/$pkg; do
    if [ -d "$dir" ]; then
      # 复制源码构建产物（lib + dist 若存在），保留原 package.json（版本号不动）
      for sub in lib dist; do
        if [ -d "$SRC/packages/bundle/$pkg/$sub" ]; then
          cp -R "$SRC/packages/bundle/$pkg/$sub/." "$dir/$sub/"
          echo "  replaced $pkg/$sub -> $dir"
          replaced=$((replaced+1))
        fi
      done
    fi
  done
done
# dsh-base 的 bundle 依赖包产物（guard 等新包）也需要就位：复制全部 @deepseek-ai
# 源码包的新 lib 到 profile 对应包（仅当 profile 已安装该包）。
for srcpkg in "$SRC"/packages/*/*/lib; do
  pkgdir=$(dirname "$srcpkg")
  name=$(node -e "console.log(require('$pkgdir/package.json').name)" 2>/dev/null || true)
  if [ -n "$name" ]; then
    short=${name#@deepseek-ai/}
    for dir in "$PROFILE"/node_modules/.pnpm/@deepseek-ai+${short}@*/node_modules/@deepseek-ai/$short; do
      if [ -d "$dir" ]; then
        cp -R "$srcpkg/." "$dir/lib/"
        replaced=$((replaced+1))
      fi
    done
  fi
done
if [ "$replaced" -eq 0 ]; then
  echo "!! 未替换任何包——检查 profile 结构（pnpm 布局变更？）" >&2
  exit 1
fi
echo "replaced $replaced 包目录"

echo "== 3/5 重启 dsh web =="
pkill -f "dsh web" || true
sleep 2
nohup dsh web >/tmp/dsh-web-deploy.log 2>&1 &
echo "restarted, waiting for $WEB_URL ..."
for i in $(seq 1 30); do
  if curl -sf "$WEB_URL" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "== 4/5 冒烟 =="
if curl -sf "$WEB_URL" >/dev/null 2>&1; then
  echo "  GUI 可达 ✓"
else
  echo "  GUI 未恢复——回滚" >&2
  pkill -f "dsh web" || true
  sleep 2
  rm -rf "$PROFILE"
  cp -R "$BACKUP" "$PROFILE"
  nohup dsh web >/tmp/dsh-web-deploy.log 2>&1 &
  echo "已回滚到 $BACKUP" >&2
  exit 1
fi
echo "== 5/5 完成。备份在 $BACKUP（确认无误后可删除）=="
