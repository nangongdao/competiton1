# 多平台内容发布工具

> 一份 Markdown，自动适配 **微信公众号 / 知乎 / B站专栏 / 小红书** 的格式与风格，一键发布（默认模拟）。

创作者把同一篇内容同步到多个平台时，逐个适配格式极其耗时：公众号过滤 `class`/外链、知乎公式要转图片、B站图片防盗链、小红书只认纯文本+话题标签且必须配图。本工具用**规范化中间表示（IR）+ 能力声明式适配器**，让你写一次内容，自动产出四个平台的合规产物，并保留**零改核心扩展更多平台**的架构。

---

## 快速上手

```bash
npm install

# 零密钥闭环演示:样例 MD → 四平台产物落盘 dist/demo/(含本地图上传图床演示)
npm run demo

# 交互式 Web 工具(主演示路径,无需扩展/密钥)
npm run dev          # 打开 http://localhost:5176

# 全量单测(229) + 类型检查 + 代码风格
npm test
npm run typecheck
npm run lint
npm run test:coverage   # core 覆盖率门槛 ≥80%

# 打包 MV3 浏览器扩展 → dist-ext/(Chrome 加载已解压扩展)
npm run build:ext

# 可选服务端(图片图床 / 公众号真实发布时需要,默认不启)
npm run server       # 需先在 packages/server 配置 .env

# 可选 Playwright runner(知乎/B站/小红书网页端真实分发)
npm run runner       # http://127.0.0.1:8790，仅使用本机浏览器登录态
```

`npm run demo` 后查看 `dist/demo/`：`wechat.html`（内联样式、无 class/外链图）、`zhihu.html`（公式图片+保留外链）、`bilibili.html`（受限 HTML+分区）、`xiaohongshu.txt`（纯文本+#话题#+违禁词替换）、各平台 `*-cover.svg` 封面、`report.json`（校验与回执详情）。

---

## 架构总览

monorepo（npm workspaces），三包 + 演示脚本：

| 包 | 职责 | 依赖环境 |
|---|---|---|
| **packages/core** | 纯 TS、零 DOM。IR 类型、MD→IR 解析、能力驱动变换库、适配器注册表+四平台适配器、HTML 净化、配置外置、图片重托管、校验器、两阶段 Publisher、同步引擎、OpenAI 兼容 LLM | 无（可被 app/server 共用） |
| **packages/app** | 一套 React UI **双构建**：`dev` 即完整 Web 工具，`build:ext` 即 MV3 扩展。通过 `PlatformBridge` 隔离 `chrome.*`，含草稿持久化 / 图片上传 / AI 增强面板 | 浏览器 |
| **packages/server** | 可选 Fastify 服务端，默认不启。持公众号密钥、跑 token 缓存、图片图床（local/s3/wechat）、限流 + 结构化日志 | Node 20+ |
| **packages/runner** | 可选 Playwright 本机自动化 runner。复用用户本机浏览器登录态，打开真实创作者中心，填写内容并可在显式开启后点击发布 | Node 20+ / Chromium |

### 核心数据流

```
Markdown
  → IR Document (AST + 元数据 + 资产表)        ← 核心永不持有平台 HTML
  → 每平台:
      preprocess(能力驱动降级管线)  IR → IR     ← 纯函数变换,按缺失能力选择
      serialize(平台原生格式)       IR → 产物    ← 公众号内联HTML/知乎富文本/B站受限HTML/小红书纯文本
      validate(按 capabilities)                ← 长度/必须图/违禁词
      Publisher.stage() → 暂存产物
      Publisher.confirm() → 回执
```

### 关键设计：能力声明式适配器

每个平台只**声明它缺什么能力**，变换管线据此自动降级，核心**绝无 `switch(platform)`**：

| 平台 | contentModel | 外链 | 表格 | 公式 | 必须封面 | 字数计数 | 违禁词过滤 |
|---|---|---|---|---|---|---|---|
| 微信公众号 | `inline-html` | ❌→脚注 | ✅ | ❌ | 否 | 普通 | 否 |
| 知乎 | `rich-clipboard` | ✅ | ✅ | 图片(equation) | 否 | 普通 | 否 |
| B站专栏 | `restricted-html` | ✅ | ❌→图片 | 图片 | 否 | 普通 | 否 |
| 小红书 | `plaintext` | ❌→脚注 | ❌→图片 | ❌ | ✅ | **字素簇** | ✅ |

> 小红书标题≤20/正文≤1000 用 `Intl.Segmenter` 按**字素簇**计数（emoji、组合字符算一个），而非 `string.length`。

---

## 扩展新平台（零改核心）

加一个平台只需 **实现一个 adapter + 注册一行**，变换库/校验器/同步引擎/UI 全部零改动：

```typescript
// packages/core/src/adapters/myplatform/index.ts
import { BaseAdapter } from "../base-adapter.js";
import type { Capabilities, Document, PlatformOverride } from "../../ir/types.js";
import type { SerializedPayload } from "../types.js";

const CAPABILITIES: Capabilities = {
  contentModel: "markdown",        // 该平台原生支持 Markdown
  supportsExternalLinks: true,
  supportsTables: true,
  supportsMath: "none",
  supportsCodeBlocks: "native",
  requiresCover: false,
  requiresImageRehost: false,
  countByGrapheme: false,
  bannedWordFilter: false,
  taxonomy: "free-tags",           // "free-tags" | "entity-topics" | "category+tags"
  limits: { titleMax: 50, bodyMax: 20000, tagsMax: 5 },
  publishers: ["mock"],
};

export class MyPlatformAdapter extends BaseAdapter {
  readonly id = "myplatform";
  readonly name = "我的平台";
  readonly capabilities = CAPABILITIES;

  serialize(doc: Document, override?: PlatformOverride): SerializedPayload {
    // preprocess(降级管线)已由 BaseAdapter 按 capabilities 自动跑过
    // 这里只需把降级后的 IR 序列化成平台原生格式
    return { /* content, mime, title, tags, imageAssetIds, ... */ };
  }
}
```

```typescript
// packages/core/src/adapters/registry.ts —— 只加这一行
registerAdapter(new MyPlatformAdapter());
```

`preprocess` 由 `BaseAdapter` 根据 `capabilities` 自动选择并运行降级变换（外链→脚注、表格→图片、公式→图片、违禁词替换、扁平化纯文本…）。你声明缺什么能力，管线就补什么降级。

---

## 智能改写：规则式为主，LLM 增强可选（OpenAI 兼容）

- **规则式（默认，零密钥即可全功能）**：能力驱动的纯函数变换库完成所有格式/风格适配。
- **LLM 增强（可选）**：`OpenAiCompatLlm` 实现 `LlmAdapter`，走标准 `/v1/chat/completions` 协议，**一份实现通吃** OpenAI / DeepSeek / Kimi / Qwen / Ollama / vLLM。在 Web 设置面板填 `baseUrl + apiKey + model` 即启用「优化标题 / 生成摘要 / 口语化（小红书）」；每步失败自动回退原值，**无 key 时退化为 NoopLlm，任何功能不受影响**。
- **安全**：`apiKey` 仅存浏览器本地（localStorage / chrome.storage），**绝不写入任何提交文件**。

## 图片资产全链路（本地图 → 真实图床）

正文里的本地图 / 外链图在发布时自动**重托管**到图床，产物 `<img>` 指向图床 URL，杜绝防盗链失效：

- Web 端「+ 插入本地图片」选图 → 以 dataURL 进正文 → 发布时经 `bridge.uploadAsset` 转发 server `/upload`。
- server 图床**可插拔三实现**（按 `.env` 的 `IMAGE_HOST` 选择）：
  - `local` — 落盘 + `@fastify/static` 暴露 `/uploads/*`（零配置兜底，部署公网即真图床）。
  - `s3` — `@aws-sdk/client-s3`，接 Cloudflare R2 / 阿里云 OSS / MinIO，填 endpoint/bucket/key 即用。
  - `wechat` — 微信 `media/uploadimg`（正文图返 CDN URL）+ `add_material`（封面返 mediaId）。
- 变换生成的占位图（表格图 / 公式图）标记为 `generated`，**不会被误上传**。

## 草稿与发布历史持久化

- 编辑内容**自动存草稿**（防抖），刷新页面不丢失；可多草稿切换 / 删除。
- 每次发布追加**历史记录**（时间 + 各平台成败 + 回执）。
- 存储按环境选实现：**Web = IndexedDB**（草稿含图片 dataURL，超 localStorage 5MB 上限）、**扩展 = chrome.storage.local**。UI 只依赖统一 `DraftStore` 接口。

---

## 一键发布与辅助发布

- **默认全平台模拟发布**：`stage→confirm` 两阶段产出暂存产物+回执，安全可演示。
- **公众号保留真实官方 API**：仅公众号有面向开发者的发布 API，链路为 `stable_token → 图片重托管 → draft/add`。
- **扩展辅助发布**：content script 默认**写富文本到剪贴板**（`ClipboardItem` 同时给 `text/html`+`text/plain`），并额外尝试 **best-effort 注入**目标平台编辑器，失败自动降级回复制粘贴，**绝不自动点击「发布」**。
- **Playwright 真实网页分发**：启动 `npm run runner` 后，可在设置面板把知乎/B站/小红书切到「自动填写并保存草稿」或「全自动点击发布」。runner 打开本机 Chromium 持久化 profile，复用用户登录态填写标题、正文、标签，并在 `full-auto` 模式点击最终发布按钮。

> 知乎/B站/小红书对普通开发者**无发布 API**。Playwright runner 是用户本机可控自动化：不保存账号密码，不绕过验证码/短信/人机/风险验证；遇到这些阻断会返回 `needs-user-action`，需要用户手动处理后重试。全自动点击发布有误发和平台风控风险，必须在设置里显式开启。

启用 Playwright runner：

```bash
npm run runner
```

然后在 Web 工具「设置 → Playwright 真实分发」中确认 runner 地址为 `http://127.0.0.1:8790`，分别为知乎/B站/小红书选择：

- `模拟发布`：默认安全回执。
- `辅助复制/注入`：保留扩展辅助链路。
- `自动填写并保存草稿`：打开创作者中心并填充内容，不点击最终发布。
- `全自动点击发布`：填充后点击目标平台发布按钮；遇到登录或验证阻断立即停止。

---

## 安全边界（公众号真实发布）

- **`AppSecret` 只存在于 `packages/server/.env`**（被 `.gitignore` 排除），扩展/Web 永远拿不到，也绝不写入任何提交文件。
- 扩展/Web 用 core 只**构造 payload**，POST 给 localhost server；server 持密钥跑 `stable_token`（7200s，提前 5 分钟刷新）→ 图片重托管 → 草稿 API。
- `access_token` 只在 server 内存，绝不返回前端。
- **现实障碍**：公众号 API 调用 IP 必须在后台白名单，本机动态 IP 常加不进 → 默认走模拟；`/health` 会返回出口 IP 供白名单参考，真实发布失败时返回清晰的 `errcode` 解释（如 40164 白名单、40007 永久素材）。

启用真实发布：

```bash
cd packages/server
cp .env.example .env      # 填入 WECHAT_APPID / WECHAT_SECRET
cd ../.. && npm run server # http://127.0.0.1:8787，仅 localhost
curl http://127.0.0.1:8787/health   # 查看出口 IP 与配置状态
```

---

## 性能与能力进阶

好架构配得上好性能 —— 在"零密钥闭环"之上补齐性能与产品思维：

### 图片重托管并发化 + 同源去重

- **平台内并发上传**：`rehost-engine.ts` 以受控并发执行单平台内的图片上传（`mapWithConcurrency`，结果按输入顺序稳定回填），图片多的长文从"逐张串行"提速约 `min(图数, 并发)` 倍。平台层与资产层双并发：4 平台 × 12 图、300ms/图 的慢图床下，发布从 ~7.2s 降到 ~1.8s（`perf.spec.ts` 守护，串行基线 14.4s）。
- **按平台限流策略**（`assets/rate-policy.ts`）：公众号素材接口限流最严用并发 3，知乎/小红书 6、B站 4；`AdaptiveConcurrency` 提供 AIMD 自适应并发（遇 429 减半、连续成功 10 次 +1），可注入 `RehostContext.concurrency`。
- **同源去重**：同一文档内同 source（URL/dataURL/本地路径）只上传一次，结果共享给所有同源资产；`computeContentHash` 提供内容寻址原语（SHA-256 前缀，WebCrypto 不可用时退化 FNV-1a），供去重/缓存键复用。
- **server 公众号正文图同样并发**：`wechat/rehost.ts` 正文图重托管按并发 3 + 同源去重执行。

### 增量适配与预览防抖

- **`pipeline/incremental.ts`**：`IncrementalAdapter` 三层缓存 —— 源 Markdown 哈希未变复用解析出的 IR；平台 config/override 未变复用该平台序列化产物；仅单平台配置变化只重算该平台。core 零 DOM，天然可放进 Web Worker。
- **前端防抖**（`store.ts`）：预览适配 250ms 防抖 + 过期结果守卫，连续输入只算一次，慢请求不会乱序覆盖新结果。

### 排版质量评分（答辩亮点）

`quality/typography.ts` 为每个平台产物打 **0-100 分**并给出可执行建议，四维加权：

| 维度 | 含义 | 公众号 | 知乎 | B站 | 小红书 |
|---|---|---|---|---|---|
| 段落节奏 | 单段字数 vs 平台理想值 | ≤60 字 | ≤140 | ≤100 | ≤40 |
| 图文平衡 | 配图数 vs 按字数期望 | 每 400 字 1 图 | 900 | 700 | 150 |
| 标题结构 | 跳级/空标题/无小标题扣分 | — | — | — | — |
| 可读性 | 超长无分隔文本块 | — | — | — | — |

UI 头部显示「排版 82/100」，校验页列出「排版建议」（如"第 3 段偏长，拆成 2-3 段更利移动端阅读"）；`report.json` 含各平台 `quality` 明细。这是从"工具"到"助手"的产品思维体现。

---

## 内容安全与纵深防御

不受信内容（LLM 增强产物、第三方 Markdown 内嵌 HTML）可能被 prompt injection 操纵产出恶意 HTML。全部 HTML 序列化产物都经过 **统一净化出口 + 多层纵深防御**：

### HTML 净化（`packages/core/src/adapters/shared/sanitize-html.ts`）

- 基于 **sanitize-html（htmlparser2 真实解析）**，不用正则——正则无法解析 HTML 语法树，协议变形（`java\tscript:`）、实体编码（`&#58;`/`&colon;`）、属性边界错位等一整类绕过无法穷举。
- **白名单模型**：只保留排版标签；属性白名单 + `style` 值白名单正则。
- **协议收严**：`allowedSchemes` 只放行 `http/https/mailto`；`img` 单独放行 `data:image`（内联刚需）且再次收严到标准位图格式，排除 `data:text/html`、SVG（可携带脚本）。
- **回归用例**：曾实证绕过的 9 条载荷（`data:` 伪协议、Tab/换行分隔、数字/命名实体、style 内变形、大小写混合）固化为 `sanitize.spec.ts` 回归测试。

### content script 加固（`packages/app/src/content/`）

content script 运行在**用户已登录的平台页面上下文**，是最敏感的位置，三层防护叠加：

1. **发送方校验**（`assisted-handoff.ts`）：`sender.id !== chrome.runtime.id` 的消息一律拒绝。
2. **注入前二次净化**：即便发送方是扩展自身，注入前仍再过一遍 `sanitizeHtml`。
3. **不用 `innerHTML`**（`injectors.ts`）：改经 `DOMParser` 解析 + 逐节点导入，并剥离所有 `on*` 事件属性——`<img onerror>`/`<svg onload>` 这类事件处理器载荷无法进入平台 DOM。
4. **选择器白名单**（`selectors.ts`）：远程覆盖只接受常规 CSS 选择器字符且长度受限，防止恶意覆盖把注入目标指向任意元素（如 `body`）。

### SSRF 防护（`packages/core/src/assets/url-guard.ts`）

服务端/图床会主动拉取 Markdown 中的图片 URL 重托管，若不防护可被构造 `http://169.254.169.254/...` 探测内网。`isSafeImageUrl` 阻断：内网 IPv4 段（10/172.16/192.168/回环/链路本地/CGNAT/组播）、`localhost`、IPv6 内网（`::1`/`fc00::`/`fe80::`），并对 `rehost-engine` 的每个外链图在执行前校验。

### 扩展权限收窄（`packages/app/manifest.config.ts`）

`host_permissions` 只声明实际使用的平台域名 + 本机 `127.0.0.1:8787`（server）与 `:8790`（runner）具体端口，不用 `localhost`（可被 hosts 劫持）。

### 发布可靠性

- **重托管失败明细**（`ARCH-01`）：单图失败不阻断整篇，但通过 `PlatformResult.rehostFailures` 逐条上报（assetId/sourceUrl/reason），在扩展 UI 与 `report.json` 中展示——用户发布前就知道"3 张图没传成功，公众号侧可能显示异常"。
- **发布幂等**（`ARCH-02`）：`contentHashOfPayload` 对正文+标题+摘要+意图算稳定 FNV-1a 哈希，`buildIdempotencyKey` 生成 `platform:意图:哈希` 键；公众号发布在 server 端按幂等键缓存首次结果，网络抖动重试不会产生重复草稿/重复发布。

### CI 强制

`.github/workflows/ci.yml` 在 typecheck/lint/coverage 之外，增加**生产依赖漏洞扫描**（`npm audit --omit=dev --audit-level=high`）与**构建产物验证**（`build:core` + `build:ext`），任何一步失败即阻断合并。

## 测试与验证

| 验证 | 命令 | 覆盖 |
|---|---|---|
| 单测（229 个） | `npm test` | MD→IR 解析、各变换纯函数、字素簇计数、校验规则、四适配器序列化、HTML 净化、SSRF URL 防护、幂等键、配置覆盖、图片重托管（并发/同源去重/失败明细）、图床辅助函数、限流策略与自适应并发、排版评分、增量适配缓存、LLM 增强（注入 mock fetch）、公众号 API 构造、TokenCache 并发锁、选择器覆盖、上传路由、公众号发布幂等与并发重托管 |
| 覆盖率门槛 | `npm run test:coverage` | core 行/分支/函数/语句 ≥80%（CI 强制） |
| 类型检查 | `npm run typecheck` | core/app/server 三包 strict |
| 代码风格 | `npm run lint` | ESLint flat config + typescript-eslint + react-hooks |
| 零密钥闭环 | `npm run demo` | 四平台产物落盘 + 本地图上传图床 + 校验 + 排版评分 + 回执 |
| 交互工具 | `npm run dev` | 浏览器实时预览/校验/模拟发布/Canvas 封面/草稿持久化/AI 增强/排版分 |
| MV3 扩展 | `npm run build:ext` | MV3 产物 dist-ext，Chrome 加载已解压扩展 |
| 性能回归 | `npm run test:coverage`（含 `perf.spec.ts`） | 4 平台 × 12 图、300ms/图 慢图床下发布 < 2s（并发化守护） |

> UI/扩展为前端，类型检查与单测保证**代码正确性**；**功能正确性**（编辑器注入、真实发布、真实对象存储联调）需在浏览器实际操作或配置外部凭据验证，依赖真实平台登录态的部分无法自动化。草稿持久化、发布历史已用 Playwright 跨刷新验证。

## 工程化

- **CI**：`.github/workflows/ci.yml`，Node 20/24 矩阵跑 `npm ci → typecheck → lint → test:coverage`。
- **pre-commit**：`simple-git-hooks` + `lint-staged`，提交前对暂存区 `.ts/.tsx` 跑 `eslint --fix`。
- **覆盖率门槛**：`vitest.config.ts` 设 core ≥80%（含分支），低于门槛 CI 失败。
- **行尾统一**：`.gitattributes` 强制 LF，避免跨平台抖动。

---

## 目录结构

```
packages/core/src/
├── ir/          # IR 契约:Document/Block/Inline/Asset/Capabilities
├── parse/       # markdown-it → IR
├── transforms/  # 能力驱动降级变换库(纯函数 IR→IR)+ 管线 + 注册表
├── pipeline/    # 增量适配引擎(IncrementalAdapter:源哈希/平台 config 缓存)
├── quality/     # 排版质量评分(段落节奏/图文平衡/标题结构/可读性)
├── adapters/    # 适配器注册表 + 四平台 + shared/sanitize-html(净化护栏)
├── config/      # 平台配置外置(违禁词/limits/主题 可覆盖)
├── assets/      # 资产表 + ImageHost 契约 + 重托管引擎(并发/同源去重)+ 限流策略 + SSRF 防护 + 内容哈希
├── validate/    # 按 capabilities + 注入配置校验
├── publish/     # 两阶段 Publisher(Mock + 公众号官方 API)+ 幂等键(idempotency)
├── llm/         # LlmAdapter 接口 + OpenAiCompatLlm + 字段级 enhance
└── sync/        # 有界并发同步引擎(接 rehost / LLM 异步阶段,均可选退化)

packages/app/src/
├── bridge/      # PlatformBridge 抽象(mock/chrome)+ uploadAsset 图片转发
├── components/  # 输入 + 四平台预览(DOMPurify 加固)+ 校验提示 + 回执
├── render/      # Canvas 封面渲染
├── storage/     # DraftStore:草稿/历史持久化(IndexedDB / chrome.storage)
├── state/       # zustand store(草稿/历史/LLM/图床接线)
├── content/     # content script:辅助发布 + 选择器外置(selectors.ts,可远程覆盖)
└── background/  # MV3 service worker

packages/server/src/
├── routes/      # /health(出口IP) /wechat/publish /upload(图片图床)
├── imagehost/   # 图床三实现(local / s3 / wechat)+ 工厂
├── wechat/      # token 缓存(并发刷新锁)/ 原生 fetch / 图片重托管 + 草稿
└── config.ts    # 读 env、校验凭据、图床配置
```
