# 多平台内容发布工具升级与后续开发路线图

> 规划基线：2026-08-03 当前工作树  
> 规划周期：约 10-12 周（按 2 名开发者估算；单人执行约乘 1.6-1.8）  
> 产品边界：继续采用 local-first；真实发布默认关闭；不绕过验证码、风控或平台限制

## 1. 执行结论

项目已经具备可信的核心架构和可演示闭环：平台无关 IR、能力声明式适配器、四平台序列化、Web/MV3 双构建、公众号 API、Playwright runner、图片重托管、LLM 增强和草稿持久化均已有实现。当前更准确的成熟度是“内部 alpha 后段”，而不是可稳定对外发布的产品。

下一阶段不应优先增加平台或继续堆生成式功能。最先要解决的是三类真实发布风险：

1. `server` / `runner` 是具有发布副作用的本机特权服务，但目前没有请求令牌。
2. 公众号服务端直接拉取客户端提供的图片 URL，缺少 DNS、重定向、超时、大小和 MIME 等服务端强制校验。
3. 公众号幂等缓存因 Publisher 每请求重建而不能跨请求生效；runner 也把“点击按钮”误报成“已经发布”。

建议以 `0.2.0-beta` 为近期目标：先建立安全、幂等、可恢复、可观测的发布任务，再接入已有的增量/并发性能原语。稳定后再进入内容助手、批处理和效果回收。

## 2. 规划目标与非目标

### 2.1 10-12 周目标

- 发布副作用只能由已授权客户端触发，外部图片拉取不能访问内网或无限消耗资源。
- 同一发布意图的重复请求不会造成重复草稿或重复发布。
- 每个平台发布过程可观察、可取消、可按失败阶段重试，并能在应用重启后恢复。
- runner 只在有平台侧成功证据时返回 `published`；不确定状态必须显式返回 `submitted` 或 `unknown`。
- CI 必须实际执行浏览器测试，并为 app/server/runner 建立有意义的门禁。
- 预览和图片上传兑现已有缓存、Worker、自适应并发能力，形成量化性能基线。
- 产出可安装、可回滚、带版本说明的 `0.2.0-beta`。

### 2.2 暂不进入本周期

- 云端账号系统、团队协作、多租户和 SaaS 计费。
- 绕过验证码、短信、扫码登录、反自动化检测或平台风控。
- 在真实发布可靠性完成前扩展更多平台。
- 无人工确认的默认全自动发布。
- 未经用户明确同意的内容、凭据或行为数据上传。

## 3. 当前基线

| 维度 | 当前证据 | 判断 |
|---|---|---|
| 核心架构 | `packages/core`：IR、能力适配器、变换、校验、Publisher、同步引擎 | 稳定基础，继续沿用 |
| 产品闭环 | `npm run demo` 可生成四平台产物；Web 与 MV3 均能构建 | 演示可用 |
| 测试 | `npm run test:coverage`：32 文件、229/229；core 行 93.84%、分支 82.56% | core 扎实，外围不足 |
| 静态质量 | typecheck、Lint、生产依赖 audit 均通过 | 基线良好 |
| 性能 | 4 平台 x 12 图性能用例通过；Web 主 JS 665.94 kB | 图片并发已有收益，前端需拆包 |
| 安全 | XSS 净化、content script、字面量 URL 防护已落地 | 浏览器侧明显改善，服务端边界仍不完整 |
| 真实发布 | 公众号 API 与 runner 均有接线 | 实验性，回执和恢复不可信 |
| 交付 | CI 有 Node 20/24、覆盖率、audit、core/扩展构建 | 缺 Web 构建、必跑浏览器 E2E 和 release |
| 仓库状态 | 22 个已修改文件及多组未跟踪实现/资料 | 需先收敛为可审查基线 |

### 3.1 已完成，不应重复规划

- `sanitize-html` 白名单净化及绕过回归测试。
- content script 发送方校验、二次净化、无 `innerHTML` 注入和选择器限制。
- 图片重托管受控并发、同源去重、失败明细。
- 静态平台限流策略、AIMD 控制器、内容哈希、增量适配、排版质量评分的核心实现与单测。
- 草稿/历史持久化、LLM 可选增强、Web/扩展 Bridge。
- CI 的 typecheck、Lint、core coverage、生产依赖 audit 和扩展构建。

### 3.2 已有原语但尚未闭环

| 原语 | 当前状态 | 要完成的接线 |
|---|---|---|
| `IncrementalAdapter` | 仅导出和单测使用 | 升级为完整预览管线缓存并接入 app/Worker |
| `AdaptiveConcurrency` | 未接收真实 429/成功事件 | 接入上传调度器、`Retry-After` 和抖动退避 |
| `computeContentHash` | 未用于 app 上传缓存 | 替换完整 dataURL 键，加入容量/过期策略 |
| 幂等键 | Publisher 实例内缓存 | Publisher 生命周期、并发合并、持久化与路由集成 |
| runner diagnostics | 只创建路径并测试脱敏 | 写入请求/回执/截图/DOM/trace，配置保留周期 |
| runner fixture | 本地有 Chromium 时运行 | CI 安装浏览器并禁止静默 skip |
| coverage | 只对 core 设门槛 | 建立 app/server/runner 的分层门禁 |

## 4. 目标架构

### 4.1 特权请求边界

```text
Web / MV3 App
  -> 本次启动的 capability token
  -> server: upload / WeChat API
  -> runner: prepare / confirm / session

server 拉取远程图片
  -> SecureImageFetcher
  -> URL 语法校验
  -> DNS 解析并拒绝全部私网/保留地址
  -> 每次重定向重新校验
  -> 超时 + 最大字节数 + image MIME 白名单
```

- `server` 和 `runner` 启动时生成或读取高熵 token；只保存于本机设置，日志必须脱敏。
- CORS 作为浏览器兼容策略，不再被视为鉴权。
- `/health` 仅返回非敏感摘要；路径、凭据状态等细节放入已鉴权诊断接口。
- core 的 URL guard 作为早期用户反馈；server 的 `SecureImageFetcher` 才是权威安全边界。

### 4.2 发布任务模型

```text
queued -> adapting -> validating -> uploading -> staging
       -> awaiting-confirmation -> submitting -> verifying
       -> succeeded | needs-user-action | failed | unknown | cancelled
```

- 一次用户操作产生一个 `PublishJob`，每个平台拥有独立 `PlatformJob`。
- 任务记录内容摘要、幂等键、阶段、尝试次数、已上传资产、回执和可脱敏诊断引用。
- 失败重试从最后可安全恢复的阶段继续；已成功平台和已上传资产不能重复执行。
- `published` 必须有平台成功提示、远端 ID/URL 或可验证页面状态；仅点击按钮只能标记 `submitted`。
- `unknown` 表示请求可能已生效但没有可信回执，禁止自动重试，必须先由用户核对。

### 4.3 模块边界调整

- `server/src/index.ts` 拆为可测试的 `buildServerApp()` 与纯启动入口。
- `WechatPublisher` 在应用生命周期内复用，通过 `IdempotencyStore` 注入，而不是路由内新建。
- app 的 `publishAll()` 降为任务编排入口；具体状态、恢复、取消由 `PublishJobService` 管理。
- runner 平台 adapter 增加 `prepare`、`submit`、`verify` 契约，选择器与成功判定分开版本化。
- 预览使用独立 `PreviewPipeline`，不复用带发布语义的完整同步入口。

## 5. 分阶段实施计划

## Phase 0：收敛当前基线（第 1-2 个工作日）

目标：在不丢失当前未提交工作的前提下，得到可审查、可回退、可复现的升级基线。

| ID | 任务 | 工期 | 依赖 | 交付物 |
|---|---|---:|---|---|
| REPO-01 | 将当前产品源码、测试、文档和无关论文资料分类；产品变更放独立分支并拆成原子提交 | 1d | 无 | 干净工作树、提交清单 |
| REPO-02 | 记录当前 229 测试、覆盖率、bundle 和性能基线 | 0.5d | REPO-01 | `docs/baseline-2026-08.md` |
| CI-01 | 增加根脚本 `build:web`、`build:server`、`build:runner`、`verify`，统一开发者与 CI 命令 | 0.5d | REPO-01 | 一条完整门禁命令 |
| DOC-01 | 在旧升级文档顶部标注“已实现/已替代/仍待完成”，链接本路线图 | 0.5d | REPO-01 | 单一事实入口 |

退出条件：

- `git status` 不再混合产品代码与研究资料；任何移动或归档均经过人工确认，不直接删除用户文件。
- `npm ci && npm run verify` 能从干净检出完成。
- 旧计划不再把已实现任务描述为未来任务。

## Phase 1：真实发布安全与正确性（第 1-2 周，目标 `0.2.0-alpha.1`）

### 任务清单

| ID | 优先级 | 任务 | 工期 | 依赖 | 核心验收 |
|---|---|---|---:|---|---|
| SEC-01 | P0 | server/runner capability token、精确 origin allowlist、日志脱敏 | 2d | CI-01 | 无 token 为 401；错误 token 为 403；合法客户端通过 |
| SEC-02 | P0 | `SecureImageFetcher`：DNS/IPv4/IPv6、重定向、超时、大小、MIME 校验 | 3d | 无 | 私网域名、DNS rebinding 模拟、跳转私网、超大响应全部拒绝 |
| SEC-03 | P0 | `/wechat/publish`、`/upload` 与 runner 路由 JSON Schema、body limit、统一错误 envelope | 1.5d | SEC-01 | 畸形请求均为稳定 4xx，不进入副作用代码 |
| SEC-05 | P0 | 本地图床 MIME/扩展名校验、总容量配额、保留时间和安全清理 | 1.5d | SEC-01, SEC-03 | 达到配额后稳定拒绝；清理不越过 uploads 根目录 |
| REL-01 | P0 | `buildServerApp()` + 单例 `WechatPublisher` + `IdempotencyStore` 注入 | 1.5d | 无 | 两次相同请求只调用一次平台 API |
| REL-02 | P0 | 合并并发相同请求；成功长 TTL，瞬时失败不做 24h 缓存 | 1.5d | REL-01 | 并发 20 次仍只产生一次副作用 |
| REL-03 | P0 | app 发布入口使用 `try/catch/finally`，错误分平台呈现并确保 busy 状态复位 | 1d | 无 | 任一 bridge 抛错后 UI 可继续重试 |
| SEC-04 | P1 | LLM key 默认仅会话保存，持久化改为用户显式选择并提供一键清除 | 1d | SEC-01 | 默认刷新/退出后不保留敏感 key |
| TEST-01 | P0 | 安全、路由、幂等和并发集成测试；覆盖 Publisher 生命周期 | 2d | SEC-02, REL-02 | 测试先能复现当前缺陷，修复后稳定通过 |

### 实现约束

- token 使用常量时间比较；不得出现在 URL、错误、日志或诊断工件中。
- server fetch 禁止自动跟随未经校验的重定向；每一跳重新解析 DNS。校验必须发生在实际连接的 DNS lookup 上，不能“先解析校验、再让普通 fetch 重新解析”。
- 只允许明确的位图 MIME；SVG 默认拒绝；读取流时实时执行字节上限，不能先完整 `arrayBuffer()` 再判断。
- server 在提交微信 API 前再次净化正文 HTML，不能把客户端净化视为信任边界。
- FNV 可保留作缓存键，但真实发布幂等摘要使用 SHA-256；客户端提供的 key 不能被直接信任。
- 幂等条目至少区分平台、账号/配置标识、内容摘要和 `draft/publish` 意图。

### 退出条件

- 所有副作用路由均有鉴权、schema、限流和请求大小限制。
- SSRF 套件覆盖字面量 IP、域名解析、IPv4/IPv6、重定向、超时、超大文件、伪造 MIME。
- 本地图床有总配额、保留周期和路径边界测试，异常上传不能持续占满磁盘。
- 顺序重复和并发重复请求均只触发一次微信 API；进程内结果可复用。
- `publishAll()` 的任何异常都不会留下永久 loading 状态。

## Phase 2：可恢复任务与可信回执（第 3-4 周，目标 `0.2.0-alpha.2`）

| ID | 优先级 | 任务 | 工期 | 依赖 | 核心验收 |
|---|---|---|---:|---|---|
| JOB-01 | P0 | 定义 `PublishJob/PlatformJob/Stage/Attempt` 契约和状态迁移守卫 | 2d | Phase 1 | 非法状态跳转被拒绝并记录 |
| JOB-02 | P0 | 版本化本地任务存储、原子写入、恢复与保留策略 | 3d | JOB-01 | 强制终止后重启可恢复未完成任务 |
| JOB-03 | P0 | 上传/暂存/提交 checkpoint；按平台重试与取消 | 3d | JOB-02 | 已上传图片与成功平台不重复执行 |
| RUN-01 | P0 | runner `prepare -> confirm -> submit -> verify`；full-auto 二次确认绑定内容摘要 | 3d | SEC-01, JOB-01 | 篡改确认内容被拒绝；点击后先返回 `submitted` |
| RUN-02 | P0 | draft/save/publish 成功证据；引入 `unknown` 状态 | 2d | RUN-01 | 找不到保存按钮不能返回 `drafted` |
| OBS-01 | P1 | 接入 request/receipt、截图、DOM、trace；脱敏和自动清理 | 2d | RUN-01 | 失败回执可定位到工件，敏感字段不落盘 |
| UI-01 | P1 | 发布任务面板：阶段、耗时、重试、取消、人工处理、诊断入口 | 3d | JOB-03, OBS-01 | 用户能对单个平台操作，不必全部重发 |

### 状态与重试规则

- `failed`：平台明确拒绝或安全地确认未提交，可按策略重试。
- `unknown`：网络在提交后中断或页面状态不明，禁止自动重试。
- `needs-user-action`：登录、验证码、风控或必填项，需要用户完成后继续原任务。
- 只有幂等阶段才能自动重试；提交阶段必须依赖平台幂等或先验证远端状态。
- 默认指数退避加随机抖动，尊重 `Retry-After`；取消通过 `AbortSignal` 贯穿 fetch、上传和 runner。

### 退出条件

- 故障注入覆盖上传第 N 张失败、平台超时、提交后断网、进程重启和用户取消。
- 任一场景都不会重复已成功的平台或资产。
- runner 的 `published` 状态具有可审查成功证据；否则返回 `submitted/unknown`。
- 诊断工件有容量和时间上限，默认不含正文以外的页面敏感信息。

## Phase 3：性能原语接线与质量门禁（第 5-6 周，目标 `0.2.0-beta.1`）

| ID | 优先级 | 任务 | 工期 | 依赖 | 核心验收 |
|---|---|---|---:|---|---|
| PERF-01 | P1 | 将 `IncrementalAdapter` 演进为完整 `PreviewPipeline`，缓存 parse/preprocess/serialize/validate/quality | 3d | Phase 2 契约稳定 | 单平台配置变化不重跑其他平台 |
| PERF-02 | P1 | Preview Web Worker、请求序号、取消与 250ms 防抖 | 2d | PERF-01 | 输入主线程长任务 <50ms |
| PERF-03 | P1 | `AdaptiveConcurrency` 接入上传；429、`Retry-After`、抖动退避 | 3d | JOB-03 | 限流时自动降并发，恢复后缓慢升高 |
| PERF-04 | P1 | 内容哈希上传缓存、LRU/TTL、容量统计 | 2d | PERF-03 | dataURL 不作为长生命周期 Map key；缓存有上限 |
| PERF-05 | P1 | app 动态导入/手工分块，延迟加载设置、LLM 和非活动预览 | 2d | 无 | 消除 >500 kB 单 chunk 警告 |
| TEST-02 | P0 | 建立 preview、bundle、图片发布的 p50/p95 性能预算 | 2d | PERF-01..05 | CI 越界失败并输出趋势数据 |

### 性能预算

| 指标 | 当前基线 | Beta 目标 | 测量方式 |
|---|---:|---:|---|
| 4 平台 x 12 图，300ms/图 | 测试约 1.36s | p95 <2s | core 性能回归 |
| 预览缓存命中 | 尚未接入 app | p95 <50ms | Worker benchmark |
| 输入到预览稳定结果 | 250ms 防抖 + 全量计算 | p95 <350ms | 浏览器性能用例 |
| 主线程最长任务 | 未记录 | <50ms | Playwright trace |
| Web 主 JS | 665.94 kB / gzip 240.14 kB | 单 chunk <500 kB；首屏 gzip <180 kB | bundle size gate |
| 上传缓存 | 无容量上限 | 可配置，默认 <=100MB | 缓存统计测试 |

退出条件：性能指标在 Node 20/24 和 Chromium CI 中连续 10 次无明显抖动；功能测试不因缓存命中而跳过校验或质量评分。

## Phase 4：Beta 产品化与交付（第 7-8 周，目标 `0.2.0-beta`）

| ID | 优先级 | 任务 | 工期 | 依赖 | 核心验收 |
|---|---|---|---:|---|---|
| UX-01 | P1 | 服务依赖状态：server、runner、浏览器、公众号配置、图床连通性 | 2d | SEC-01 | 每项给出可执行状态和错误，不暴露秘密 |
| DATA-01 | P1 | 草稿/历史/设置 schema version 与迁移；JSON/Markdown 导入导出 | 3d | JOB-02 | 从当前 v1 数据无损升级，可回滚备份 |
| TEST-03 | P0 | app 组件与交互测试：草稿、设置、错误、任务面板、键盘与可访问性 | 3d | UI-01 | 核心工作流有组件级回归 |
| TEST-04 | P0 | CI 安装 Chromium；fixture 测试不得 skip；独立浏览器 job 避免全量并行抖动 | 2d | 无 | CI 明确显示实际执行 7+ 浏览器用例 |
| PLAT-01 | P1 | 选择器/成功判定版本化、fixture 契约和人工 canary 清单 | 3d | RUN-02 | 平台改版可快速定位并回退到 assist |
| RELEASE-01 | P1 | CHANGELOG、SECURITY、支持矩阵、升级/回滚、构建校验和安装包哈希 | 2d | 全部 | 可复现 `0.2.0-beta` 产物 |
| REPO-03 | P1 | 将研究资料移出产品根目录或归档到明确目录 | 0.5d | 人工确认 | 发布包不包含无关资料 |

### Beta 发布门禁

```bash
npm ci
npm run typecheck
npm run lint
npm run test:coverage
npm run test:e2e
npm run build:web
npm run build:core
npm run build:server
npm run build:runner
npm run build:ext
npm run demo
npm audit --omit=dev --audit-level=high
git diff --check
```

- core 保持行/语句 >=90%、分支 >=80%、函数 >=85%。
- beta 前 app 目标行 >=60%、server/runner >=70%；更重要的是副作用、安全和恢复主流程 100% 有集成用例。
- Node 20/24 均跑类型、单测和构建；Chromium E2E 可固定在 Node 20，减少重复成本。
- Web 构建加入 CI；扩展产物校验 manifest 权限、版本和禁止秘密文件。
- 使用专用测试账号分别完成一次公众号草稿、知乎/B站/小红书 draft canary；full-auto 只做受控验证。

## Phase 5：后续产品开发（第 9-12 周及以后）

这一阶段只在 `0.2.0-beta` 的安全、重复发布率和恢复指标达标后启动。

### 5.1 内容助手（优先）

| ID | 功能 | 工期 | 说明 | 验收指标 |
|---|---|---:|---|---|
| AI-01 | 质量建议定位与一键修复 | 3d | 建议关联到具体段落/标题，修复前后可比较和撤销 | 建议接受率、撤销率可记录于本地 |
| AI-02 | 每平台标题/摘要 3 方案对比 | 3d | 展示来源、模型、提示版本；不自动覆盖 | 100% 需用户选择后应用 |
| AI-03 | 事实/引用检查入口 | 4d | 只标记缺证据内容，不伪造引用；证据与生成文本分层 | 无来源内容不得显示为“已核验” |
| FLOW-01 | 平台模板与可复用配置 | 3d | 模板版本化，明确哪些字段影响缓存/幂等 | 模板升级不破坏旧草稿 |

### 5.2 批处理与计划任务

| ID | 功能 | 前置条件 | 约束 |
|---|---|---|---|
| FLOW-02 | 多草稿批量校验/生成产物 | JOB-03 | 默认不批量真实发布 |
| FLOW-03 | 本机计划任务 | 任务持久化、鉴权、回执可信 | 明确提示机器与登录态必须在线 |
| FLOW-04 | 发布前审批清单 | RUN-01 | full-auto 必须逐任务确认内容摘要 |

### 5.3 效果回收与平台生态

| ID | 功能 | 决策原则 |
|---|---|---|
| DATA-02 | 发布效果手工录入/CSV 导入 | 先支持可解释、低权限来源，不抓取受限数据 |
| DATA-03 | 官方 API 可用平台的指标同步 | 每个平台单独评估 API、权限和 ToS |
| PLAT-02 | 平台能力漂移探测 | 静态限制与 canary 观测分离，漂移只告警不自动改规则 |
| SDK-01 | Adapter conformance kit | 新平台必须通过 IR、降级、净化、校验、fixture 和回执契约 |
| SDK-02 | 第五平台试点 | 只有 conformance kit 与现有四平台 SLO 达标后立项 |

## 6. CI 与测试演进

### 6.1 测试分层

| 层级 | 主要范围 | 必须覆盖 |
|---|---|---|
| Unit | core 纯函数、状态迁移、hash、策略 | 边界值、性质、不可变性 |
| Contract | Bridge、server/runner 请求响应 | schema、鉴权、错误 envelope、版本兼容 |
| Integration | 发布器、幂等、任务存储、SecureImageFetcher | 副作用次数、并发、故障恢复、安全拒绝 |
| Component | React store/components | loading/error/retry/cancel、草稿迁移、键盘操作 |
| Browser fixture | runner/content script | 编辑器事件、保存/发布证据、blocker、fallback |
| Real canary | 专用测试账号 | 选择器漂移、登录/风控、实际草稿回执 |

### 6.2 解决当前 runner 抖动

- 浏览器 fixture 单独作为 CI job，不与全部 Vitest 项目竞争 CPU。
- 每个用例显式关闭 page/context；禁止依赖全局残留页面。
- CI 显式安装固定版本 Chromium；若浏览器缺失应失败，不得 `skipIf` 后变绿。
- 记录每个步骤耗时，定位启动、选择器还是事件等待问题；只有证据表明正常耗时确实超过 5 秒时才调整 timeout。
- 平台 adapter 测试使用本地 HTTP fixture，而不只用 `page.setContent`，覆盖导航、CSP 和页面生命周期。

### 6.3 门禁顺序

1. PR 快速门禁：格式、Lint、typecheck、unit/contract、bundle budget。
2. PR 浏览器门禁：Web E2E、扩展/runner fixture。
3. main 夜间门禁：性能重复样本、安全 payload、故障注入。
4. 发布门禁：真实账号 canary、安装包冒烟、升级/回滚演练。

## 7. 产品与工程指标

### 7.1 必须监控的 SLO

| 领域 | 指标 | Beta 目标 |
|---|---|---:|
| 安全 | 未授权副作用请求成功数 | 0 |
| 正确性 | 相同幂等键造成的重复发布数 | 0 |
| 恢复 | 可安全恢复的失败任务恢复成功率 | >=95% |
| 回执 | 标记 `published` 但无成功证据的比例 | 0 |
| 自动化 | 排除 `needs-user-action` 后 draft 成功率 | >=95%（canary） |
| 稳定性 | main 分支无重跑通过率 | >=98% |
| 性能 | 预览结果 p95 | <350ms |
| 性能 | 4 平台 x 12 图模拟发布 p95 | <2s |
| 交付 | 可复现构建成功率 | 100% |

### 7.2 产品指标（默认仅本地）

- 单篇从导入到生成四平台可用草稿的中位耗时。
- 用户接受的排版建议比例及撤销比例。
- 每平台人工修正次数、assist fallback 次数和 `needs-user-action` 原因分布。
- 草稿恢复、单平台重试和导入导出的使用次数。
- 任何遥测外发必须另做隐私设计和显式 opt-in；本周期默认只在本地展示。

## 8. 风险登记与应对

| 风险 | 概率 | 影响 | 预防/降级 |
|---|---|---|---|
| 平台 DOM/规则频繁变化 | 高 | 高 | 版本化选择器、canary、诊断工件、自动退化 assist |
| 自动化触及平台 ToS/风控 | 中高 | 高 | 默认 mock/draft、限速、二次确认、不绕过验证 |
| 本机服务被其他页面/扩展调用 | 中 | 高 | capability token、精确 origin、最小权限、审计 |
| SSRF/DNS rebinding/超大响应 | 中 | 高 | server 权威解析、逐跳校验、流式上限和超时 |
| 提交后断网造成状态不明 | 中 | 高 | `unknown`、远端核验、禁止盲重试 |
| JSON 本地状态损坏 | 中 | 中高 | 版本、原子写、备份、迁移测试、损坏恢复 |
| LLM 产生错误或虚假引用 | 高 | 中高 | 来源分层、人工接受、校验、默认不自动发布 |
| 过早云端化拖慢交付 | 中 | 中 | 本周期坚持 local-first，多租户另立 ADR/项目 |
| 当前大批 WIP 难审查 | 高 | 中高 | Phase 0 原子提交、基线文档、逐项验证 |

## 9. 执行顺序与并行建议

两名开发者可以按以下方式并行，但合并顺序不能打乱：

| 周次 | 开发者 A | 开发者 B | 合并门槛 |
|---|---|---|---|
| 第 1 周 | server/runner token、schema | SecureImageFetcher 与安全测试 | 未授权/SSRF 用例先红后绿 |
| 第 2 周 | Publisher 生命周期与幂等 | app 错误恢复、CI 集成 | 重复副作用计数为 1 |
| 第 3 周 | Job 状态机与存储 | runner prepare/confirm/verify | 状态契约冻结 |
| 第 4 周 | checkpoint/retry/cancel | 诊断工件与任务 UI | 故障注入通过 |
| 第 5 周 | PreviewPipeline/Worker | AIMD/retry/hash cache | 功能等价测试通过 |
| 第 6 周 | bundle/性能预算 | 浏览器 CI 稳定化 | 连续样本达标 |
| 第 7 周 | 数据迁移/导入导出 | 组件/E2E/a11y | 旧数据迁移通过 |
| 第 8 周 | canary/release | 文档/安装/回滚 | Beta 发布清单签字 |

关键依赖链：

```text
REPO-01 -> CI-01
SEC-01 -> RUN-01
SEC-02 -> TEST-01
REL-01 -> REL-02 -> JOB-02
JOB-01 -> JOB-02 -> JOB-03 -> UI-01
RUN-01 -> RUN-02 -> PLAT-01
JOB-03 -> PERF-03 -> PERF-04
PERF-01 -> PERF-02 -> TEST-02
Phase 1-4 全部门禁 -> 0.2.0-beta -> Phase 5
```

## 10. 首个迭代的具体安排

### 第 1-2 天

- 完成 REPO-01/02，保存当前 WIP，建立可重复 baseline。
- 为当前缺陷先添加测试：跨路由重复请求、并发重复请求、server fetch 私网 URL、runner 找不到保存按钮。
- 设计 capability token 的请求头、启动/配对体验和错误契约。

### 第 3-5 天

- 拆出 `buildServerApp()`，让所有 server 路由可以通过 `inject()` 集成测试。
- 实现 server/runner 鉴权与 schema，更新 app Bridge 请求头。
- 实现 `SecureImageFetcher` 并替换公众号正文图和封面直接 fetch。

### 第 6-8 天

- 将 `WechatPublisher` 提升到应用生命周期；实现 in-flight 合并与成功缓存。
- 修正失败缓存策略和 SHA-256 幂等摘要。
- 用 20 个并发重复请求验证只产生一次平台调用。

### 第 9-10 天

- 为 app 发布流程加入 `try/finally`、结构化错误和可重试状态。
- 建立独立 Chromium CI job，修复页面未关闭和资源竞争问题。
- 运行 Phase 1 全部退出条件，发布 `0.2.0-alpha.1`。

## 11. 每个任务的完成定义

一个任务只有同时满足以下条件才算完成：

- 行为契约已写清，失败和边界状态不是靠注释推断。
- 新增或修复行为有能在修复前失败的测试。
- 副作用代码有请求 ID、任务 ID、平台 ID 和阶段信息，但不记录 token/key/cookie。
- 失败可操作：用户知道是否安全重试、需要人工处理还是状态未知。
- 涉及持久化时包含 schema 版本、迁移和损坏恢复测试。
- 涉及网络时包含超时、取消、大小、重试和错误分类。
- 涉及真实发布时保持默认关闭并需要明确确认。
- README、支持矩阵、CHANGELOG 或 ADR 已同步。
- `npm run verify`、浏览器门禁和对应手工 canary 均通过。

## 12. 规划复审节点

- Phase 1 后：复审威胁模型和真实副作用边界。
- Phase 2 后：复审任务状态机、幂等和 `unknown` 处理，不带着含糊状态进入 UI 优化。
- Phase 3 后：用测量数据决定是否继续 Worker/缓存优化，避免无指标优化。
- Beta 前：复审平台 ToS、权限、凭据、数据迁移和回滚。
- Phase 5 每个新方向立项前：用 Beta 的失败原因与用户行为数据重新排序，不默认全部实施。

---

本路线图取代“继续按旧文档逐项实现”的做法。`UPGRADE_PLAN.md` 和 `PERFORMANCE_UPGRADE.md` 保留为 2026-08-01 的问题背景与设计记录；后续执行状态、优先级和验收以本文为准。
