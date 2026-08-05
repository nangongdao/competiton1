# Notes: 项目升级改进与后续开发规划

## Repository Evidence

### 产品与架构
- 产品目标：一份 Markdown 自动适配并发布到微信公众号、知乎、B站专栏和小红书。
- npm workspaces monorepo，四个边界：`core`（IR/变换/适配/校验）、`app`（React Web + MV3）、`server`（公众号 API/图床）、`runner`（Playwright 网页自动化）。
- 核心架构优势：平台无关 IR、能力声明式适配器、两阶段 Publisher、Bridge 隔离浏览器环境、默认模拟发布。
- 当前版本仍为 `0.1.0` 且所有包 `private: true`，更接近竞赛演示/内部 alpha，尚无正式发布流程。

### 当前工作树
- 当前分支 `master`，HEAD `ac3f618`；远端 `origin/master` 位于 `630cbbc`，HEAD 同时对应远端 `feature/playwright-runner-demo-script`。
- 工作树包含 22 个已修改文件（约 +1055/-450）及多组未跟踪源码、测试、升级文档和无关论文资料。
- `UPGRADE_PLAN.md` 与 `PERFORMANCE_UPGRADE.md` 是 2026-08-01 的审计/设计；当前未提交实现已覆盖其中相当一部分，但尚未形成干净、可审查的变更序列。

### 已验证命令（2026-08-03）
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm audit --omit=dev --audit-level=high`：0 个漏洞。
- `npm run test:coverage`：32 文件、229 测试全部通过；core 行/语句 93.84%、分支 82.56%、函数 89.36%。
- 第一次并行运行 `npm test` 时 runner 的知乎 fixture 超过 Vitest 默认 5 秒，结果为 228/229；单文件复跑 7/7，通过耗时 2.54 秒；覆盖率全量复跑 229/229。说明存在负载相关抖动。
- `npm run build:core`、`npm run build:ext`：通过。
- `npm run build -w @mpp/app`：通过；主 JS 665.94 kB（gzip 240.14 kB），Vite 发出 >500 kB 拆包警告。
- `npm run demo`：通过；生成四平台产物和报告，小红书质量评分/警告正常输出。
- `git diff --check`：通过。

### 已经落地的 8 月升级项
- HTML 净化迁移至 `sanitize-html` 并有绕过回归测试。
- content script 做发送方校验、二次净化、避免 `innerHTML`、限制选择器覆盖。
- core URL 字面量防护、图片重托管受控并发、同源去重、失败明细。
- 平台静态限流策略、AIMD 控制器、内容哈希、增量适配、幂等键、排版评分均有源码与单测。
- CI 已加入 Node 20/24、typecheck、lint、coverage、生产依赖审计、core/扩展构建。
- UI 已有 250ms 防抖、过期结果守卫、重托管失败提示、质量评分、草稿/历史持久化。

### “有实现但未闭环”的能力
- `IncrementalAdapter` 仅由 core 导出和单测使用；app 预览仍调用 `markdownToIR + syncToPlatforms` 全量链路。
- `AdaptiveConcurrency` 仅由 core 导出和单测使用；上传链路未按 429/成功事件动态调节，`retryBaseMs/maxRetries` 未消费。
- `computeContentHash` 未接入 app 的 `uploadedAssets` 缓存；缓存仍以完整 source/dataURL 为内存键且无容量上限。
- runner 的 diagnostics 只定义并测试路径/脱敏；发布链路未写 request/receipt、截图、DOM 或 trace。
- CI 未安装 Playwright Chromium；fixture 使用 `skipIf(!hasChromium)`，远端 CI 可能静默跳过关键自动化测试。
- 覆盖率配置明确排除 app/server/runner，只能证明 core 门槛。

### 需要优先修复的可靠性/安全差距
- `registerWechatRoutes` 每个请求新建 `WechatPublisher`，导致实例内幂等缓存跨请求立即丢失；并发相同请求也未做 in-flight 合并。
- 公众号 server 直接 `fetch(payload.bodyImageUrls/coverImageUrl)`，没有复用 core URL guard，更没有 DNS 解析、重定向重校验、超时、响应大小和 MIME 限制；存在 SSRF/资源耗尽边界。
- core URL guard 只检查主机名字面量，域名解析到私网、DNS rebinding、重定向到私网仍未覆盖。
- server/runner 依赖回环监听和宽松的本地/CORS 来源模式，没有每次启动生成的请求令牌；runner 暴露可触发真实发布和浏览器会话的特权接口。
- 公众号请求体只用类型断言加 title/content 存在性检查；runner 有手写解析但无统一 JSON Schema/响应 envelope/主体大小策略。
- 本地图床限制单文件 10MB，但没有总容量、保留周期或清理策略，长期运行可能耗尽磁盘。
- runner draft 模式在找不到“保存草稿”按钮时仍返回 `drafted`；full-auto 点击发布后立即返回 `published`，未等待平台成功信号、远端 ID/URL 或失败提示。
- `publishAll` 缺少顶层 `try/finally`、取消和阶段状态；异常可能让 `publishing` 长期保持 true，失败后无法按平台/阶段恢复。
- 当前幂等逻辑计划缓存失败 24 小时；若真正持久化，会把瞬时网络失败也固定为长时间失败，应只长期缓存成功，瞬时失败短 TTL 或不缓存。

### 产品与交付差距
- 前端仅 3 个测试文件（选择器 + 两个 store 发布接线），没有组件、可访问性、草稿迁移或真实 UI E2E 门禁。
- runner fixture 是静态自建 DOM，不能证明真实平台选择器、富文本编辑器事件、标签/封面处理和发布成功判断。
- 没有发布队列、断点续传、单平台重试、取消、任务审计、导入导出/备份。
- 没有真实平台 canary 流程、选择器版本/健康状态、平台规则漂移检测。
- 没有正式 release workflow、CHANGELOG、SECURITY、迁移策略、版本兼容矩阵或可复现安装包校验。
- Web 构建未纳入 CI，且主 bundle 已触发拆包警告。
- 根目录混有与产品无关的论文资料与临时目录；发布前需迁移归档并保持仓库干净，但不能直接删除现有用户文件。

## Synthesized Findings

### 当前成熟度判断
- 架构与核心算法：可视为 alpha 后段，抽象清晰且 core 测试扎实。
- 演示闭环：可用，零密钥 demo 和 Web/扩展构建均成立。
- 真实发布可靠性：仍是实验性，回执真实性、幂等、恢复、真实平台漂移尚未闭环。
- 安全：旧审计的 XSS/权限问题大多已处理，但 localhost 特权服务和 server-side fetch 形成新的 P0 边界。
- 产品化：缺少发布队列、观测、E2E、版本发布与数据迁移，尚不宜对外宣称稳定版。

### 优先级原则
1. 先保护真实发布副作用：鉴权、服务端 URL 安全、真实幂等、可信回执。
2. 再让失败可恢复、状态可观察：任务状态机、重试/取消、诊断工件。
3. 再兑现已有性能原语：增量预览、Worker、AIMD/重试、内容寻址缓存、拆包。
4. 之后提升内容助手价值：质量建议定位、A/B 方案、模板、批量工作流。
5. 最后建立数据反馈与生态扩展：发布效果回收、能力漂移、插件化平台包。

### 规划假设
- 以 2 名开发者为基准估算；1 人执行时工期约乘 1.6-1.8。
- 默认继续保持 local-first，不在第一阶段引入云端账号、多租户或远程托管服务。
- 真实发布默认保持 mock/draft 安全姿态；full-auto 必须显式开启并有二次确认与审计。
