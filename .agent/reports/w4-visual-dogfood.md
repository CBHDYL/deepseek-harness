# W4 VISUAL VERIFICATION DOGFOOD（真实截图 → 真实 vision 模型）

run_time: 2026-09-05
vision route: deepseek-v4-flash-vision-exp（~/.dsh/settings.yaml 已配；今天 4 次真实调用）
render: headless Chromium（与 browser 工具同 resolver）→ 5 张真实截图（fixtures ×4 + DSH GUI 首页）
path: fixture HTML → Chromium 渲染 → screenshot → describe_image（结构化视觉评审契约）

## TP / FP / FN / UNCERTAIN

| 样本 | 真实状态（确定性证据） | vision verdict | 分类 |
|---|---|---|---|
| overlap-desktop（badge 越出卡片角） | 缺陷（CSS: top:-10px right:-10px 越界） | FAIL（badge 覆盖卡片边框） | **TRUE POSITIVE** |
| clean-desktop（badge 在卡内 top:12 right:12） | 无缺陷（CSS 确定性：相对定位卡内） | FAIL（声称 badge 在卡边界外） | **FALSE POSITIVE** |
| misalign-desktop / misalign-mobile | 高度不等（top 对齐，视觉失衡疑似缺陷） | 输出被冗长推理截断 | UNCERTAIN（未取得结论） |
| gui-home（http://127.0.0.1:3080 真实 GUI） | 无已知缺陷 | PASS，none | 诚实无发现 |

## 关键观察

1. **真实视觉输入**：vision 模型收到的都是 Chromium 对真实 HTML/真实 GUI 的渲染截图，不是文本冒充。
2. **有用增量 = 1 个 TP**（overlap 类 DOM/text gate 查不出的视觉缺陷）。
3. **FP 纪律生效**：clean 控制上模型声称「badge 越界」——确定性 CSS 证据（top:12px/right:12px 在 relative 卡内）与视觉断言冲突时，**确定性证据优先**（W4-C 原则的实证案例）。
4. **结构化输出不稳定的真实局限**：vision 路由倾向输出推理轨迹，严格格式 prompt 下仍可能截断结论——结构化视觉 findings 的 schema 约束需要 reviewer-schema 机制（multi-model policy 的 REVIEW_SCHEMA 式约束在 describe_image 自由文本通道不适用）。这是 W4 的诚实 limitation，不是伪 PASS。
5. **响应式**：mobile viewport（375×667）渲染截图已捕获；视觉评审未跑完（输出截断），记录为 limitation。

## 边界

- 截图只来自自有受限渲染（fixtures + 本机 GUI），无任意本地图片注入、无 filesystem authority 扩张。
- 无 VisualRouter / VisualJudge / VisualEvidenceStore——vision 输出是 findings，权威不变。
- 无视觉模型覆盖确定性证据的路径。
