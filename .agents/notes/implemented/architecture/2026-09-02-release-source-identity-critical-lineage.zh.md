# Agent Note：发布源身份与关键依赖血统（R1/R2）

Status: implemented

[English](2026-09-02-release-source-identity-critical-lineage.md) | 中文

## 问题

已安装的 `dsh` 既无法证明自己来自哪份源码，也无法证明其授权敏感包与核心包属于同一血统。

- 包版本是唯一身份：同一版本、不同提交的两个构建，安装后无法区分。全局安装的 `0.1.2-alpha.3` 与一个携带已封板修复语义的 fork HEAD 报出同一个版本号，实际运行的却不是后者。
- 发布安装路径使问题叠加：核心包用 caret 范围声明其族内成员，单独安装已打包的核心 tarball 会让 npm 从 registry 拉取成员。一次部署产生了杂交体——带戳的候选核心旁是无戳的上游 `0.1.2-alpha.5` 成员——仅靠版本身份无法发现。
- `dsh-base` 在 patch 层组合了 `action-policy-guard` 却未声明依赖，该包从未被安装；也没有任何门禁检查 base patch 引用的 86 个插件是否都有 manifest 声明。

## 决策

### 发布打包刻录打包提交

`scripts/release/source-revision.ts` 在 `pnpm pack` 前把 `dsh.sourceRevision`（完整 40 位 commit）写入每个成员 manifest，随后恢复签入字节。戳来自正在打包的 checkout，绝不来自运行时环境。

### 运行时只报告自身产物声明的身份

`apps/cli/src/identity.ts` 读取运行中的 `bin.js` 旁边那份已安装 manifest——不是附近任何 checkout——`dsh --version` 渲染为 `0.1.2-alpha.5 (source 70dca4e50)`。同版本、不同打包提交 → 报告不同。

### 关键依赖血统检查器

`scripts/release/critical-resolution.ts` 从已安装核心入口解析七个授权敏感包，判定每份副本的归属域：

- `core-runtime`：嵌套在核心包内（全局安装），或与核心并列提升在同一 `node_modules` 层（打包安装 consumer）。核心副本必须携带核心的版本与其精确 `sourceRevision`；缺戳为 `UNKNOWN`，同版本不同戳为 `MISMATCH`——两者都判负。
- `plugin-private`：嵌套在其它包自己的 `node_modules` 下。作为 `ALLOWED_COMPATIBILITY` 接受，不要求血统；核心的解析链不会进入这些目录，它们无法供给授权能力。
- `unknown` / 不可解析：判负。

检查器只回答出处问题；它从不检查或重新裁决这些包内部的安全语义。

## 后果

- `scripts/release/verify-packed-install.ts` 把整族 tarball 装进一次性 consumer 后运行检查器，registry 混装或错误血统的产物在发布时即失败。
- `scripts/release/verify-critical-resolution.ts` 是对任意已安装运行时的只读命令：`--install <package root>`。未来 `dsh assess` 应消费它，而不是重写一套依赖检查。
- 解析探测在纯 Node 子进程中进行，发布进程自身的加载器（tsx、workspace tsconfig paths）无法替安装作答。
- 2026-09-02 把打包候选 tarball 装进全局时产生了上文杂交体（npm 把 caret 成员解析到上游 `0.1.2-alpha.5`）；检查器检出全部七个关键包为 MISMATCH/UNKNOWN，安装从预装备份回滚。
- 同一轮发现 `verify-packed-install` 空过：npm 把整族提升到 consumer 根目录，初版域规则把提升成员判为 plugin-private，跳过了血统比对。上面的域规则修正了分类；提升布局的 spec 用例将其钉住。
- `dsh-base` 现已声明 `action-policy-guard` 为依赖，静默缺失闭合。
- 遗留：`verify-packed-install` 执行 `npm install --omit=optional`，在 macOS 上会跳过 koffi 的预编译平台包、回退源码构建而需要 CMake（环境前置条件，非门禁缺陷）。全局 npm 前缀下的三个备份（`dsh.pre-r1r2-backup`、`dsh.pre-align-backup`、`dsh.rollback-0.1.1-rc.2`）在仓库之外；清理由 owner 决定。

## 备选方案

- 用 npm 自身 pack 机制刻 `gitHead`：否决——发布打包按成员逐个执行 `pnpm pack`，戳必须是全族共享的同一 revision，而打包步骤已知该值。
- 版本号身份 + 独立 drift 扫描器：否决——保留了让杂交部署得以发生的版本串歧义。
- 针对空过的 pack 门禁：把整个 consumer 目录当作核心血统被否决（兄弟插件的私有副本会被误判为核心）；从打包作业撤掉门禁被否决（失去发布时拦截）。选择扩展域规则。
