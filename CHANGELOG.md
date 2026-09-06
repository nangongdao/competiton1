# Changelog

本项目的所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.11.0-rc.1] - 2026-08

### Added
- **v11 内容策略智能引擎（目标 `0.11.0-rc.1`）**：
  - **REFRESH-TRACK-01 翻新效果追踪**：`core/strategy/refresh-track.ts`（`trackRefreshPerformance`：把效果记录按「翻新溯源标题 / 原版标题」配对，输出 提升/持平/下降/未配对 判定 + 分平台对照 + 累计提升估算，阈值可配置、缺数据安全回退、不依赖 LLM）+ 驾驶舱「翻新效果追踪」区块（翻新版本列表 + 原版对照 + 阅读/互动变化率）；
  - **ATTRIBUTE-01 效果归因分析**：`core/strategy/attribute.ts`（`attributePerformance`：按 平台 / 时段 / 标题风格 / 内容主题 四维度对比高表现 vs 低表现特征，输出差异倍数 + 可读归因，维度可配置、缺数据安全回退）+ 驾驶舱「效果归因」区块（维度对比 + 高/低表现特征）；
  - **STRATEGY-01 内容策略主线**：`core/strategy/strategy.ts`（`buildContentStrategy`：整合 平台 / 时段 / 优化 / 老化 / 矩阵 / 归因 洞察为「现状 → 归因 → 下一步行动」策略主线，LLM 增强 + 规则兜底 `ruleStrategySteps`，动作可溯源、脱敏）+ 驾驶舱「内容策略」区块；
  - **GOAL-STRATEGY-01 策略对齐目标**：`core/strategy/strategy.ts` `projectGoalAchievement`（结合目标进度 + 效果预测 + 发布节奏，输出 达成预测 / 缺口 / 达成策略「需加发 N 篇 · 优先平台 · 建议时段」，on-track / at-risk / off-track 判定）+ 驾驶舱目标达成预测卡。

### Changed
- `docs/ROADMAP_V11.md` 新增（v11 内容策略智能引擎：Phase 1-3 全量达成）。
- `packages/core/src/index.ts` 新增 `strategy` 模块导出；`packages/core/src/llm/types.ts` 新增 `strategy` 任务类型。
- `packages/app/src/components/DashboardDrawer.tsx`：新增「翻新效果追踪」「效果归因」「内容策略」三个区块。
- `packages/app/src/styles/ui.css`：新增 v11 样式（dash-opt-high）。

### Tests
- `packages/core/test/refresh-track.spec.ts` 12 例（配对 / 判定提升·持平·下降 / 跨平台回退 / 未配对 / 自定义阈值与后缀）。
- `packages/core/test/attribute.spec.ts` 7 例（四维度归因 / 维度不足回退）。
- `packages/core/test/strategy.spec.ts` 13 例（规则策略 / 目标预测 / LLM 增强与失败回退 / 上下文）。
- `packages/app/test/dashboard-drawer.component.spec.tsx` +4（v11 区块渲染 / 翻新追踪 / 归因 / 策略与目标）。

## [Unreleased]

### Added
- **v11 runner 端新平台发布自动化落地 + 更多定时回复策略(承接「继续runner 端对新平台的发布自动化落地、更多定时回复策略」)**：
  - **runner 端新平台发布自动化(12 平台全接入)**：`packages/runner/src/platforms/` 新增 **weibo / toutiao / douyin / kuaishou / shipinhao** 五个 `AutomationPlatformAdapter`(纯文本+话题 / Markdown 模型选择器与编辑器 URL,`assertValidSelectors` 契约校验),`automationPlatformIds` 扩展至 12 平台并注册进 `platforms/registry.ts`;`platform-api/connect.ts` 编辑器 URL 与账号解析选择器、`platform-api/routes.ts` 会话平台清单同步扩展;`selectors-contract` / `types` / `server` / `platform-api` / `platform-fixtures` 测试同步更新(12 平台注册断言 + fixture 覆盖新平台选择器契约)。
  - **更多定时回复策略(INBOX-06 增强)**：`core/inbox/reply.ts` —— `AutoReplyStrategy` 三档预设(conservative 保守 / balanced 均衡 / proactive 积极)+ `resolveAutoReplyPolicy`(预设默认 → 用户覆盖合并)、`ReplyTemplate` 自定义回复模板(问价/求购/好评/提问)、`replyQuestion` 一般提问开关、`dedupeByAuthor + dailyPerAuthorCap` 同作者去重与每作者回复上限、`recencyWindowMs` 时效窗口(只回复最近 N 分钟内评论);`ScheduledAction.kind="inbox-auto-reply"` 支持携带 `policy` 并随任务持久化,store `scheduleRunner` 到点把策略传入 `autoReplyInboxMessages`;`InboxDrawer` 的批量自动回复与 runner/server `/inbox/auto-reply` 路由均透传 policy 到 `sendAutoReplies` 决策引擎;`SchedulerDrawer` 新增「自动回复策略」配置区(预设下拉 + 一般提问/负面转人工/同作者去重开关 + 每作者上限/时效窗口 + 四条自定义模板),任务列表展示策略摘要;新增 21 个单测(`inbox-reply-strategy.spec.ts`)与 demo「9f」段。
- **v11 更多平台适配 + 拖动排序/自动回复定时任务/置顶跟进提醒(承接「继续拖动排序/更多平台适配、自动回复定时任务、评论置顶后自动跟进提醒」)**：
  - **更多平台适配(12 平台)**：新增 **微博(weibo)**、**头条号(toutiao)**、**抖音(douyin)**、**快手(kuaishou)**、**视频号(shipinhao)** 五个平台适配器,注册进 `adapters/registry.ts`(加平台零改核心)。微博/抖音/快手/视频号走「纯文本 + emoji + #话题#」模型(复用 `shared/plaintext-topics.ts` 统一序列化:标题/正文硬约束 + overflow 标记 + 图片收集),头条号走原生 Markdown(分类 + 标签 + 必须有封面);每条平台补充 `instructions.ts` 发布指引;`platform-meta.ts` / `AccountManagerDrawer` / `PlatformConnectDrawer` / `SettingsDrawer` 补齐品牌色与图标;`runner/comment/selectors.ts`、`inbox-sync` / `inbox-reply` / `connect` / `PlatformConnectDrawer` 路由清单与 `app/content/selectors.ts` 编辑器注入选择器同步扩展;`inbox/demo-adapter.ts` 演示同步适配器新增微博/抖音/快手/视频号/头条号素材。
  - **收件箱拖动排序(INBOX-05)**：`core/inbox/types.ts` 新增 `sortOrder` + `sortInboxByOrder`(置顶优先 → sortOrder → 时间倒序) + `reorderInboxMessages`(重排落盘新 sortOrder,未出现消息保留);`queryInbox`/`sortInboxByTime` 统一走新排序;store 新增 `reorderInboxMessages`;`InboxDrawer` 每条消息支持 HTML5 拖动重排(GripVertical 手柄 + dragging/drag-over 样式),按当前过滤视图的可见顺序落盘。
  - **自动回复定时任务(INBOX-06)**：`core/scheduler/types.ts` 新增 `ScheduledAction.kind = "inbox-auto-reply"`;store `scheduleRunner` 到点对目标平台批量 `autoReplyInboxMessages`(真实回发到平台,逐平台汇总);`SchedulerDrawer` 新增「收件箱 AI 自动回复(批量真实回发)」动作(无需草稿,复用目标平台多选)。
  - **评论置顶后自动跟进提醒(INBOX-07)**：`core/inbox/followup.ts` —— `buildPinnedFollowUpDigest`(对置顶超过阈值(默认 30 分钟)仍未回复的消息生成提醒摘要 + 通知标题/正文,已回复/已归档/已关闭/取消置顶不再提醒,阈值/上限可注入);`togglePinned` 置顶时记录 `pinnedAt`(取消时清除);store 新增 `pinnedFollowUpEnabled` / `pinnedFollowUpDigest` / `setPinnedFollowUpEnabled` / `runPinnedFollowUpReminder`(复用 NOTIFY,同日不重复提醒,点击直达收件箱);`main.tsx` 恢复开关 + `App.tsx` 心跳每分钟检查;`InboxDrawer` 新增「置顶跟进」开关与待跟进徽标。
  - **零密钥演示**：`scripts/demo-ai-enhance.mjs` 新增「9d 收件箱拖动排序(INBOX-05)」「9e 评论置顶后自动跟进提醒(INBOX-07)」演示段。

- **v11 AI 智能增强 + 互动聚合(目标 `0.11.0-rc.1`)**:
  - **Part 1 · 互动与私信聚合(INBOX-01/02,统一收件箱)**：`core/inbox/` —— `InboxMessage` 契约(平台 / 远端 id / 类型(评论·私信·@提及·通知) / 状态流转 / 情绪敏感度 / 意图标签 / 自动回复);`createInboxMessage` / `summarizeInbox` / `pruneInbox` / `batchUpdateInbox`;`queryInbox` 按平台/类型/状态/关键词/账号/内容/时间过滤 + 倒序 + 未读统计;`groupByThread` 按「平台+作者」会话聚合、`groupByContent` 按内容关联聚合;`buildInboxDigest` 待跟进摘要(高互动待回复 / 负面计数)。
  - **Part 1 · 账号矩阵分组管理(BRAND-01)**：`core/brand/` —— `AccountGroup` 分组契约(品牌/业务线、成员去重、颜色标记)、`createAccountGroup` / `addMember` / `removeMember` / `buildGroupSnapshot`(组内账号状态 + 粉丝/近期表现聚合)、`buildGroupMatrix`(全分组矩阵总览 + 最佳平台)。
  - **Part 2 · AI 内容一键裂变(FISSION-01/02/03)**：`core/fission/` —— `fissionLongContent` 长内容一键拆解(小红书种草文案带 emoji / 微博快讯带 #话题# / 抖音口播脚本),`fissionLongContentWithLlm` LLM 增强失败逐平台回退规则;`expandShortContent` 一句话→深度文骨架(标题/摘要/大纲/引言);`deriveTopicSuggestions` 热点选题结合账号定位;`generateRewriteVariants` 内容矩阵多版本同义改写 + `similarityOf` 文本相似度评估(矩阵防重)。
  - **Part 2 · AI 跨平台本土化(LOCALIZE-01/02)**：`core/localize/` —— `LOCALIZE_PROFILES` 六平台风格配置(小红书闺蜜语气 / 知乎专业客观 / 领英职场商务 / 微信 / 微博 / 抖音),`localizeContentRule` 规则版 + `localizeContent` LLM 增强;`suggestHashtags` 智能标签与话题(内容领域推断 + 话题池 + LLM 增强)。
  - **Part 2 · 视觉与多媒体 AI(MEDIA-01)**：`core/media-ai/` —— `suggestCovers` AI 封面生成(平台比例 3:4 / 2.35:1 / 1:1 等 + 标题/风格/notes + Midjourney/DALL-E prompt),`adaptVideoRule` 视频横竖屏转换建议(裁切策略/字幕/分段),`buildAnchorStoryboard` 数字人播报分镜脚本(LLM 失败回退规则)。
  - **Part 2 · AI 智能客服与评论营销(CRM-01)**：`core/crm/` —— `analyzeComment` 意图识别(问价/求购→高意向 + 自动回复引导私信 + CRM 标签),`digestNegativeComments` 负面舆论预警(negative/urgent + 建议动作)。
  - **Part 2 · 合规与安全审查(COMPLIANCE-01)**：`core/compliance/` —— `scanCompliance` 发布前扫描(极限词/敏感词/风险链接/版权声明/图片缺 alt),输出严重度 + 定位 + 替换建议;`scanComplianceText` 单文本扫描 + 可扩展词表。
  - **零密钥闭环演示**：`scripts/demo-ai-enhance.mjs`(npm run demo:ai)—— 十类功能全部规则版跑通。
- **v11 INBOX-03 真实平台消息同步 + 拖动排序(承接「接入真实平台消息同步、拖动排序等」)**：
  - **INBOX-03 真实平台消息同步引擎**：`core/inbox/sync.ts` —— `InboxSyncAdapter` 平台同步适配器契约 + 注册表(加平台零改核心)、`RemoteInboxItem` 远端消息归一化(规则版评论营销引擎自动打标意图/情绪/自动回复/敏感度)、`syncInboxFromPlatform` 增量拉取 + `platformId+remoteId` 幂等去重合并、`summarizeSyncResults` 多平台汇总;`core/inbox/demo-adapter.ts` `DemoInboxSyncAdapter` 规则版离线演示适配器(微信/小红书/知乎/B站/掘金五平台,按游标增量生成,`registerDemoInboxSyncAdapters` 幂等注册);`core/inbox/types.ts` 新增 `MemoryInboxStore` 内存实现。
  - **真实公众号评论同步(server)**：`server/src/wechat/inbox.ts` `WechatInboxFetcher`(stable_token + freepublish/batchget 列文章 + comment/listall 拉评论,按 user_comment_id 增量游标归一化)、`server/src/routes/inbox.ts` `POST /inbox/sync`(X-MPP-Token 鉴权、按 serverProfileId/accountId 多公众号路由);`core/publish/wechat-official-api.ts` 新增评论 API 请求构造(`comment/listall` / `comment/reply` / `comment/delete` / `comment/top` / `freepublish/batchget`)。
  - **拖动排序**：账号分组(`sortGroups` / `reorderGroups` + `AccountGroup.sortOrder`)、发布队列(`sortQueueEntries` / `reorderQueueEntries` + `PublishQueueEntry.sortOrder`)、收件箱置顶(`pinned` + `togglePinned`,置顶消息排序优先);IndexedDB/chrome.storage 双实现 list 均按 sortOrder 排序。
- **v11 深化：内容策略智能引擎闭环（策略动作一键采纳 + 翻新效果闭环追踪 + 目标达成提醒）**：
  - **STRATEGY-ADOPT-01 策略动作一键采纳到发布队列**：`core/strategy/strategy.ts` `StrategyStep` 新增 `adoptable`（带 platformId/hour 的步骤可采纳）+ `strategyStepToQueueAdoption`（策略步骤 → 排队输入）+ `strategyHourToScheduledAt`（建议时段 → 下次该小时 ISO）；store 新增 `adoptStrategyToQueue`（默认当前草稿 + 建议平台/时段直接排入发布队列）；驾驶舱「内容策略」步骤新增「采纳到发布队列」按钮；
  - **REFRESH-TRACK-CLOSED-01 翻新效果追踪接入老化翻新闭环**：`core/lifecycle/refresh-queue.ts` `RefreshQueuePlanItem` 新增 `refreshMark`（翻新入队自动打标：原版标题 → 翻新标题）；`core/strategy/refresh-track.ts` `trackRefreshPerformance` 新增 `refreshMarks` 显式标记优先配对（翻新后标题被编辑也能闭环配对，再回退标题后缀匹配）；store `refreshAndEnqueue` 翻新入队后写入 `refreshMarks`；驾驶舱翻新追踪读取打标记录；
  - **GOAL-NOTIFY-01 目标达成预测接入提醒**：`core/strategy/strategy.ts` `buildGoalReminderDigest`（at-risk / off-track 时 `shouldNotify`，通知正文带「需加发 N 篇 · 优先平台 · 建议时段」）；store 新增 `goalReminderEnabled` / `setGoalReminderEnabled` / `runGoalReminder`（复用 NOTIFY，同日不重复，通知 action=`strategy` 直达运营驾驶舱）；App 心跳每分钟检查 + 启动恢复开关；驾驶舱目标卡下方新增提醒开关 + 立即检查按钮。

### Changed
- `packages/core/src/strategy/strategy.ts`：新增 `adoptable` / `strategyStepToQueueAdoption` / `strategyHourToScheduledAt` / `buildGoalReminderDigest`。
- `packages/core/src/strategy/refresh-track.ts`：`trackRefreshPerformance` 支持 `refreshMarks` 显式标记优先配对。
- `packages/core/src/lifecycle/refresh-queue.ts`：`RefreshQueuePlanItem` 新增 `refreshMark`。
- `packages/app/src/state/store.ts`：新增 `adoptStrategyToQueue` / `goalReminderEnabled` / `runGoalReminder` / `refreshMarks`；`refreshAndEnqueue` 翻新入队自动打标。
- `packages/app/src/App.tsx`：心跳接入目标达成提醒；通知 action `strategy` 直达运营驾驶舱。
- `packages/app/src/main.tsx`：恢复目标达成提醒开关。
- `packages/app/src/components/DashboardDrawer.tsx`：策略步骤采纳按钮 + 目标达成提醒开关 + 翻新追踪读取打标。

### Tests
- `packages/core/test/strategy.spec.ts` +6（策略采纳 / 时段转 ISO / 目标提醒 on-track·at-risk·no-goal）。
- `packages/core/test/refresh-track.spec.ts` +2（显式标记配对 / 无标记回退）。
- `packages/core/test/lifecycle-refresh-queue.spec.ts` +1（refreshMark 打标）。
- `packages/app/test/store-v11-closed-loop.spec.ts` 新增 6（目标提醒 / 策略采纳 / 翻新打标）。
- `packages/app/test/dashboard-drawer.component.spec.tsx` +2（目标提醒开关 / 策略采纳按钮）。

- **v10 深化：发布队列/批次 × 效果预测 + 内容矩阵 + 待跟进提醒（续 v10 发布后运营闭环）**：
  - **FORECAST-QUEUE-01 UI 落地**：新增 `core/insight/queue-forecast.ts` `forecastForQueue`（把 `forecastPerformance` + `buildPublishDecision` 打包为排队场景的预测展示载荷：各平台预期阅读区间 / 置信度 / 推荐平台 / 最佳时段 / 决策建议，推荐平台与已选交集不越界）；发布队列 / 发布批次表单新增「效果预测」区块（`components/queue-forecast.tsx` `QueueForecastBlock`：一键生成 + 各平台区间展示 + 决策卡片 + 采纳推荐平台）；
  - **MATRIX-QUEUE 内容矩阵接入发布队列批量目标平台建议**：`core/insight/queue-forecast.ts` `matrixQueuePlatformSuggestions`（基于内容矩阵派生批量目标平台建议：补空窗 / 强化最佳 / 均衡组合 / 兜底，全部不越界）；发布队列 / 发布批次表单新增「平台建议」区块（`components/matrix-platform-suggestions.tsx`：一键生成 + 建议卡片 + 采纳填入表单平台选择）；
  - **FOLLOWUP-NOTIFY 待跟进清单接入通知/提醒**：`core/insight/queue-forecast.ts` `buildFollowUpReminderDigest`（把 `buildPostPublishLoop` 待跟进清单转成按严重度排序的提醒摘要 + 通知标题/正文）；store 新增 `followUpReminderEnabled` / `setFollowUpReminderEnabled` / `runFollowUpReminder`（复用 NOTIFY 能力，同日不重复提醒，点击通知直达效果回收）；App 心跳每分钟检查 + 启动恢复开关；驾驶舱「发布后运营」区块新增提醒开关 + 「提醒我」按钮 + 最近检查摘要。

- **v11 INBOX-04 AI 自动回复真实回发到平台（承接「runner 端网页自动化同步评论、AI 自动回复真实回发到平台等」）**：
  - **评论回复引擎（core）**：`core/inbox/reply.ts` —— `decideAutoReply`（**保守策略**：高意向问价/求购 + 好评自动回复，负面/紧急绝不自动回复转人工，已回复/已归档幂等跳过）、`planAutoReplies`（批量筛选 + limit 上限）、`sendAutoReplies`（逐条调用 `CommentReplyAdapter` 真实回发，单条失败不阻断整批 + 失败明细）、`applyAutoReplyResult`（本地落地 `handling=auto-replied` / `status=replied`，避免重复回发）；`CommentReplyAdapter` / `CommentReplyRequest` 契约（平台差异由 runner/server 注入）。
  - **runner 网页自动化评论同步 + 回发**：`packages/runner/src/comment/` —— `selectors.ts`（知乎/B站/小红书/掘金/博客园评论同步与回发选择器，版本化 + `assertValidCommentSyncSelectors` / `assertValidCommentReplySelectors` / `assertAllCommentSelectors` 契约校验，改版漂移可定位）；`automation.ts`（`fetchCommentsFromPage` 打开浏览器登录态评论聚合页爬取归一化 + 文本哈希兜底 remoteId + 评论营销自动打标；`makeRunnerCommentReplyAdapter` 把回复真实填进评论输入框并提交 + 成功证据核验，不确定时如实失败不谎报）；`routes.ts`（`POST /inbox/sync`、`/inbox/reply`、`/inbox/auto-reply`，X-MPP-Token 鉴权，wechat 明确提示走 server）。
  - **server 公众号评论回发**：`server/src/wechat/reply.ts` `WechatCommentReplier`（stable_token + `comment/reply` 真实回发，幂等错误视为已回发，`parseCommentReplyTarget` 解析 remoteId）；`server/src/routes/inbox.ts` 新增 `POST /inbox/reply`（单条真实回发）与 `POST /inbox/auto-reply`（批量自动回复），按 serverProfileId 多公众号路由。
  - **app 接线与 UI**：`bridge/inbox-reply.ts` 客户端（wechat→server、会话平台→runner）+ 三端 bridge 新增 `replyInbox` / `autoReplyInbox`；store 新增 `replyInboxMessage` / `autoReplyInboxMessages`（回发成功本地落地幂等；未配置本地服务时降级本地演示并提示）；`InboxDrawer` 新增批量「**AI 自动回复**」按钮与单条「**回发**」按钮（AI 建议文案一键真实回发到平台）。
  - **零密钥演示**：`scripts/demo-ai-enhance.mjs` 新增「9c AI 自动回复真实回发（INBOX-04）」演示段（规则版决策 + mock 回发适配器闭环）。

### Changed
- **v11 UI 落地**：新增 `InboxDrawer`（统一收件箱：过滤 / 会话聚合 / 未读统计 / 已读·回复·归档·关闭 / 批量操作 / 手工录入演示）、`BrandMatrixDrawer`（账号矩阵分组：按品牌/业务线建组、成员增删、组内表现聚合、全矩阵总览）、`AiStudioDrawer`（AI 智能增强工作台：一键裂变 / 本土化+Hashtag / 封面·横竖屏·数字人 / 评论营销 / 合规审查，LLM 失败自动回退规则）；工具栏与 Ctrl+K 命令面板新增三个入口；store 新增 `accountGroups` / `inboxMessages` 状态与 `loadAccountGroups` / `saveAccountGroup` / `deleteAccountGroup` / `setGroupMember` / `loadInbox` / `upsertInboxMessage` / `batchUpdateInboxMessages` / `removeInboxMessage` actions；新增 `storage/account-group-store.ts`（IndexedDB schema v12）与 `storage/inbox-store.ts`（IndexedDB schema v11），web=IndexedDB / 扩展=chrome.storage 双实现；`ui.css` 新增 v11 抽屉样式。
- **v11 INBOX-03 + 拖动排序 UI**：`InboxDrawer` 新增「同步平台消息」按钮(CloudDownload,真实接口优先 / 演示适配器兜底,增量去重 + 已同步平台数徽标)与「置顶/取消置顶」(置顶消息列表优先);`BrandMatrixDrawer` 分组支持拖动排序(GripVertical 手柄,onDragStart/Over/Drop 重排落盘 sortOrder);`PublishQueueDrawer` 排队中条目支持拖动排序(重排落盘 sortOrder,不影响 scheduledAt 执行语义);store 新增 `reorderAccountGroups` / `reorderPublishQueue` / `toggleInboxPinned` / `syncInboxFromPlatforms` / `inboxSyncCursors` / `setInboxSyncCursor` / `inboxSyncing` actions 与状态;`bridge/types.ts` + 三端 bridge(Mock/Chrome/Tauri)新增 `syncInbox` 接口(`bridge/inbox-sync.ts` 客户端,wechat→server、会话平台→runner);`main.tsx` 恢复同步游标;`ui.css` 新增同步/置顶/拖动排序样式。
- `packages/core/src/index.ts` 导出新增 `inbox` / `brand` / `fission` / `localize` / `media-ai` / `crm` / `compliance` 模块。
- `package.json` 新增 `demo:ai` 脚本。
- `packages/core/src/insight/index.ts` 导出新增 `queue-forecast.js`。
- `packages/app/src/components/PublishQueueDrawer.tsx` / `PublishBatchDrawer.tsx`：新增「效果预测」与「平台建议」区块。
- `packages/app/src/components/DashboardDrawer.tsx`：发布后运营区块新增待跟进提醒开关 / 手动提醒 / 最近检查摘要。
- `packages/app/src/state/store.ts`：新增待跟进提醒开关与 `runFollowUpReminder` action；`packages/app/src/main.tsx` 恢复开关；`packages/app/src/App.tsx` 心跳接入。
- `packages/app/src/styles/ui.css`：新增 v10 提醒开关样式。

### Tests
- `packages/core/test/adapters.spec.ts` 28 例(注册表 12 平台 + 微博/头条/短视频三平台序列化约束)。
- `packages/core/test/inbox.spec.ts` 15 例(新增 INBOX-05 拖动排序:sortInboxByOrder 置顶优先 → sortOrder → 时间倒序 / reorderInboxMessages 落盘)。
- `packages/core/test/inbox-followup.spec.ts` 5 例(INBOX-07 置顶跟进提醒:超阈值提醒/未超不提醒/已回复不提醒/取消置顶清除 pinnedAt/自定义阈值)。
- `packages/core/test/scheduler.spec.ts` 10 例(新增 inbox-auto-reply 动作可创建并执行)。
- `packages/app/test/store-pinned-followup.spec.ts` 4 例(INBOX-07 store:开关持久化 / 超时置顶发通知 / 未超时不提醒 / 同日不重复)。

- `packages/core/test/inbox-reply.spec.ts` 12 例（INBOX-04 自动回复决策：高意向/好评自动、负面/已回复跳过、limit 截断；批量回发执行：逐条调用适配器、单条失败不阻断、失败明细、本地落地幂等、保守默认策略）。
- `packages/runner/test/comment-automation.spec.ts` 5 例（选择器契约校验、`isCommentAutomationPlatform` 平台白名单、非法选择器拒绝、`normalizeScrapedItem` 归一化+打标）。
- `packages/runner/test/comment-routes.spec.ts` 6 例（`/inbox/sync`、`/inbox/reply`、`/inbox/auto-reply` 路由契约：wechat 走 server、未知平台 400、缺 text 400、空消息直返）。
- `packages/server/test/inbox-reply.spec.ts` 8 例（`parseCommentReplyTarget` 解析、comment/reply 成功、幂等错误视为已回发、其它错误上报、无法解析失败；路由：未配置凭据、已配置回发成功、非 wechat 400）。
- `packages/core/test/inbox.spec.ts` 11 例(消息模型/状态流转/批量操作/裁剪/汇总/过滤/会话分组/待跟进摘要)。
- `packages/core/test/inbox-sync.spec.ts` 8 例(远端归一化+规则打标/负面敏感度/增量去重合并/失败上报/多平台汇总/演示适配器闭环/置顶切换/置顶排序优先)。
- `packages/core/test/brand-groups-reorder.spec.ts` 3 例(sortGroups 缺省/拖动重排落盘 sortOrder/sortOrder 生效)。
- `packages/core/test/publish-queue-reorder.spec.ts` 3 例(sortQueueEntries 缺省/reorderQueueEntries/sortOrder 优先于时间)。
- `packages/core/test/fission.spec.ts` 18 例(一键拆解/扩写/选题/多版本改写/相似度/LLM 回退)。
- `packages/core/test/localize.spec.ts` 10 例(三平台风格/微博字数/标签话题/LLM 回退)。
- `packages/core/test/media-ai.spec.ts` 10 例(封面比例/视频重构/数字人分镜)。
- `packages/core/test/crm.spec.ts` 7 例(意图识别/情绪/负面预警)。
- `packages/core/test/compliance.spec.ts` 8 例(极限词/敏感词/风险链接/版权/整体判定/图片 alt)。
- `packages/core/test/brand-groups.spec.ts` 3 例(分组/快照/矩阵总览)。
- `packages/core/test/queue-forecast.spec.ts` 12 例（预测载荷 / 平台交集 / 决策 / 矩阵建议补空窗与强化最佳 / 提醒摘要严重度排序）。
- `packages/app/test/store-followup-reminder.spec.ts` 5 例（开关持久化 / 发通知 / 无跟进不提醒 / 同日不重复 / 心跳路径）。
- `packages/app/test/publish-queue-drawer.component.spec.tsx` +2、`publish-batch-drawer.component.spec.tsx` +2（效果预测与平台建议区块）、`dashboard-drawer.component.spec.tsx` +1（提醒开关与手动提醒）。

## [0.10.0-rc.1] - 2026-08

### Added
- **v10 发布后运营闭环（目标 `0.10.0-rc.1`）**：
  - **REFRESH-QUEUE-01 老化内容批量翻新入队**：`core/lifecycle/refresh-queue.ts`（`planRefreshQueue`：把老化条目转成「翻新草稿 + 排队输入」计划，跨平台聚合条目按标题回退查找草稿，含效果预测参考）+ store `refreshAndEnqueue`（批量生成翻新草稿并排入发布队列，账号锁定）+ 驾驶舱「内容生命周期」区块勾选 + 「批量翻新入队」；
  - **TAG-FILTER-01 标签维度驾驶舱筛选**：`core/dashboard/matrix.ts` `aggregateByTag`（按标签聚合篇数 / 总阅读 / 平均互动）+ 内容排行按关键词/平台筛选 + 「内容标签」区块标签聚合表现；
  - **OPT-QUEUE-01 最佳发布时间学习接入排期兜底**：`insight/queue-scheduler.ts` `ruleScheduleSuggestions` 优先复用 `bestTimeFromRecords` 学习时段（缺数据回退固定窗口）；
  - **MATRIX-01 内容矩阵数据看板**：`core/dashboard/matrix.ts` `buildContentMatrix`（跨平台内容覆盖 + 标签维度表现 + 健康度：均衡 / 偏科 / 空窗）+ 驾驶舱「内容矩阵」区块；
  - **LOOP-01 发布后运营视图**：`core/dashboard/matrix.ts` `buildPostPublishLoop`（评论/互动趋势 + 待跟进清单：高互动待回复 / 低互动待复盘 / 数据缺口引导）+ 驾驶舱「发布后运营」区块。

### Changed
- `docs/ROADMAP_V10.md` 新增（v10 发布后运营闭环：Phase 1-3 全量达成）。
- `packages/core/src/index.ts` 导出 `dashboard` 模块新增 matrix 派生 + `lifecycle` 模块新增 refresh-queue 导出。
- `packages/app/src/components/DashboardDrawer.tsx`：内容排行筛选、内容标签聚合表现、内容矩阵、发布后运营、老化内容批量翻新入队。
- `packages/app/src/state/store.ts`：新增 `refreshAndEnqueue` action。
- `packages/app/src/styles/ui.css`：新增 v10 样式（dash-health / dash-opt-check）。

### Tests
- `packages/core/test/dashboard-matrix.spec.ts` 13 例（标签聚合 / 内容矩阵健康度 / 发布后运营待跟进）。
- `packages/core/test/lifecycle-refresh-queue.spec.ts` 6 例（批量翻新入队计划 / 缺正文跳过 / 默认排期）。
- `packages/core/test/queue-scheduler.spec.ts` +1（OPT-QUEUE-01 学习时段优先）。
- `packages/app/test/dashboard-drawer.component.spec.tsx` +5（v10 区块 / 筛选 / 矩阵 / 运营 / 翻新勾选）。
- `packages/app/test/store-publish-queue.spec.ts` +2（refreshAndEnqueue 落地 / 空数据失败）。

## [0.9.0-rc.1] - 2026-08

### Added
- **v9 内容生命周期智能闭环（目标 `0.9.0-rc.1`）**：
  - **LC-01 内容老化检测与翻新建议**：`core/lifecycle/aging.ts`（`detectAgingContent`：按平台 / 发布时间 / 效果阈值检测低效内容，输出翻新 / 复用 / 下线建议 + `reuseWindow` 再发布窗口，阈值可配置、缺数据安全回退）+ 驾驶舱「内容生命周期」区块；
  - **LC-02 内容片段复用库**：`core/lifecycle/fragments.ts`（`extractFragmentsFromDocument` / `extractContentFragments`：从草稿按标题 / 段落 / 金句 / 列表抽取可复用片段 + 来源溯源 + `searchFragments` 确定性检索）+ 驾驶舱「内容片段复用」区块；
  - **LC-03 翻新草稿生成**：`core/lifecycle/refresh.ts`（`buildRefreshDraft`：基于原草稿 + 老化建议生成翻新草稿骨架，标题 / 翻新说明 / 平台覆盖层可配置，不动原文）；
  - **FORECAST-01 发布效果预测**：`core/forecast/forecast.ts`（`forecastPerformance`：从历史效果按平台聚合学习预期阅读区间 + 置信度 + 推荐平台组合 + 最佳时段）+ 驾驶舱「发布效果预测」区块；
  - **FORECAST-02 发布决策辅助**：`core/forecast/decision.ts`（`buildPublishDecision`：结合预测 + 目标进度给出立即发 / 改期发 / 优化后发 / 不发建议）；
  - **TAG-01 统一内容标签**：`core/tagging/tagging.ts`（`deriveRuleTags` / `deriveContentTags`：从标题 / 正文派生统一标签，规则 + LLM 提炼，去重 / 归一 / 上限保护）+ 驾驶舱「内容标签」区块；
  - **REPORT-AI-01 AI 报告解读**：`core/report/ai-insight.ts`（`summarizeReportWithLlm`：LLM 把复盘报告解读为亮点 / 问题 / 下一步行动三段式，规则兜底）+ 报告抽屉「AI 报告解读」区块。

### Changed
- `docs/ROADMAP_V9.md` 新增（v9 内容生命周期智能闭环：Phase 1-3 全量达成）。
- `packages/core/src/index.ts` 导出 `lifecycle` / `forecast` / `tagging` 模块 + report 模块新增 AI 解读导出。
- `packages/app/src/components/DashboardDrawer.tsx`：新增「内容生命周期」「内容片段复用」「发布效果预测」「内容标签」四个区块。
- `packages/app/src/components/ReportDrawer.tsx`：新增「AI 报告解读」区块。
- `packages/app/src/styles/ui.css`：新增生命周期 / 预测 / 标签 / AI 解读样式。

### Tests
- `packages/core/test/lifecycle.spec.ts` 15 例（老化检测 / 片段抽取 / 检索 / 翻新草稿 / 再发布时段）。
- `packages/core/test/forecast.spec.ts` 9 例（平台预测 / 区间不越界 / 置信度 / 决策）。
- `packages/core/test/tagging-report-ai.spec.ts` 19 例（规则标签 / 去重 / LLM 合并与回退 / 报告解读）。
- `packages/app/test/dashboard-drawer.component.spec.tsx` +5（生命周期 / 老化扫描 / 效果预测 / 标签）。
- `packages/app/test/report-drawer.component.spec.tsx` +1（AI 解读）。

## [0.8.0-beta.1] - 2026-08

### Added
- **v8 Phase 1/2 运营驾驶舱与发布执行增强（目标 `0.8.0-alpha.2`）**：
  - **DASH-01 效果趋势**：`core/dashboard/trend.ts`（`buildTrendSeries` 按日聚合阅读/互动序列）+ 驾驶舱「效果趋势」SVG 折线图；
  - **DASH-02 平台对比**：`core/dashboard/compare.ts`（`comparePlatforms` 平均阅读/互动率/综合得分排序 + `platformDisplayName`）+「平台对比」条形图；
  - **DASH-03 内容排行**：`core/dashboard/ranking.ts`（`rankContent` 按阅读+互动综合得分 Top N）+「内容排行」列表（可直接打开远端链接）；
  - **DASH-04 目标进度**：`core/dashboard/goals.ts`（`goalProgress` 月阅读/发布数目标进度，0/负值安全处理）+「目标进度」进度条（可设定目标）；
  - **EXEC-01 失败聚合与一键重试**：`core/dashboard/exec.ts`（`aggregateFailures` 按平台+原因分类聚合 + 可重试清单，unknown 禁止自动重试）+「发布健康」表；
  - **EXEC-02 发布结果摘要**：`core/dashboard/exec.ts` `summarizePublishResults`（成功/失败/取消/进行中/未知 + 成功率）+「发布概览」；
  - **DashboardDrawer 运营驾驶舱抽屉**：工具栏按钮 + Ctrl+K 命令面板入口，全部基于既有 `analytics`/`jobs` 纯函数派生，不新增埋点，纯 SVG 手绘图表无第三方依赖。
- **v8 Phase 3 内容优化建议与最佳发布时间学习（目标 `0.8.0-beta.1`）**：
  - **OPT-01 内容优化建议**：`core/dashboard/optimize.ts`（基于效果数据与内容特征派生的可执行优化建议，LLM 增强 + 规则兜底，可一键应用/撤销：截断标题 / 拆段 / 压缩空行等确定性文本变换）+ 驾驶舱「内容优化建议」区块；
  - **OPT-02 最佳发布时间学习**：`core/dashboard/optimize.ts` `bestTimeFromRecords`（从历史效果按小时聚合学习最佳发布时段 + 小时分布可视化，缺数据友好回退）+ 驾驶舱「最佳发布时间」区块。

### Changed
- `docs/ROADMAP_V8.md` 新增（Phase 1/2 达成）→ Phase 3 已达成（`0.8.0-beta.1`）。
- `packages/core/src/index.ts` 导出 `dashboard` 模块（含 `optimize.ts`）。
- `packages/app/src/App.tsx`：工具栏/命令面板接入运营驾驶舱抽屉（懒加载拆包）。
- `packages/app/src/components/Toolbar.tsx`：新增「运营驾驶舱」按钮。
- `packages/app/src/styles/ui.css`：驾驶舱样式（折线/条形/排行/目标进度/失败聚合表/优化建议/最佳时段分布）。

### Tests
- `packages/core/test/dashboard.spec.ts` 17 例（趋势聚合/平台对比/内容排行/目标进度）。
- `packages/core/test/dashboard-exec.spec.ts` 8 例（失败聚合/可重试清单/结果摘要）。
- `packages/core/test/dashboard-optimize.spec.ts` 18 例（最佳时段学习/规则建议/LLM 解析与合并/统一入口回退）。
- `packages/app/test/dashboard-drawer.component.spec.tsx` 10 例（各区块渲染/空态/失败聚合+重试/优化建议生成/应用/撤销/最佳时段）。

## [0.7.0-beta] - 2026-08

### Added
- **v7 Phase 4 创作效率飞跃（目标 `0.7.0-beta`）**：
  - **OUTLINE-01 文档大纲导航**：`core/outline/`（`extractOutline`/`collectHeadings`/`buildOutlineTree`/`activeNodeAtLine` 纯函数，跳过代码块）提取标题树 + `OutlinePanel`（编辑器内大纲面板，点击定位、当前章节高亮、空态提示，Ctrl/Cmd+Shift+O 切换）；
  - **SNIPPET-01 Markdown 片段库**：`core/snippets/`（`BUILTIN_SNIPPETS` 14 个内置片段 + `insertSnippet`/`searchSnippets`/`groupSnippetsByCategory` 纯函数）+ `SnippetPicker`（搜索/分类分组/一键插入，光标落在 `{cursor}` 占位，Ctrl/Cmd+Shift+P 切换）；
  - **AI-WRITE-01 整篇 AI 写作增强**：`core/doc-write/`（`runDocWrite`/`docWriteRequest`/`ruleDocWrite` 纯函数，整篇润色/扩写/续写/摘要，结构保守 + 规则兜底）+ `DocWriteBar`（编辑器底部四动作条，结果写回可撤销，LLM 未配置时展示规则兜底提示）；
  - **PREFLIGHT-05 自动修复扩展**：`core/preflight/fix.ts` 新增 `blank-lines`（压缩多余空行）/`trailing-space`（清除行尾空格）/`heading-space`（规整标题空格）确定性修复 + `AUTO_FIX_CAPABILITIES` 能力清单；
  - **FOCUS-01 专注写作模式**：编辑器「专注」按钮 + Ctrl/Cmd+Shift+F 切换，隐藏预览/元信息、编辑器居中窄栏沉浸写作。

### Changed
- `docs/ROADMAP_V7.md` 新增 Phase 4 章节。
- `packages/app/src/App.tsx`：编辑器快捷操作条（大纲/片段/AI 写作/专注）；整篇 AI 写作与片段插入接线；大纲光标行跟踪；快捷键。
- `packages/app/src/state/store.ts`：新增 `runDocWrite`/`docWriteBusy`/`docWriteResult`/`insertSnippet`。
- `packages/app/src/styles/ui.css`：编辑器快捷按钮 / 大纲面板 / 片段库 / AI 写作条 / 专注模式样式。

### Tests
- `packages/core/test/outline.spec.ts` 12 例（标题提取/树构造/当前章节）。
- `packages/core/test/snippets.spec.ts` 11 例（片段插入/搜索/分类）。
- `packages/core/test/doc-write.spec.ts` 13 例（整篇写作动作/规则兜底/LLM 防御）。
- `packages/core/test/preflight-fix.spec.ts` +5（空行/行尾/标题空格叠加修复）。
- `packages/app/test/outline-panel.component.spec.tsx` 4 例 + `snippet-picker.component.spec.tsx` 4 例 + `doc-write-bar.component.spec.tsx` 5 例 + `store-doc-write.spec.ts` 3 例。

- **v7 Phase 3 创作体验深化（目标 `0.7.0-beta.1`）**：
  - **EDIT-INPUT-01 编辑器智能输入辅助**：`app/components/editor-input.ts` 纯函数（`indentSelection`/`outdentSelection` Tab/Shift+Tab 缩进、`autoCloseDelimiter` 成对定界符自动补全与跳过闭合、`handleEnter` 列表/引用回车续行/空项退出/有序列表递增、`toggleBlockQuote`/`toggleBulletList`/`toggleOrderedList` 行首语法 toggle），textarea `onKeyDown` 接入；
  - **EDIT-FIND-03 查找面板匹配分布统计**：计数区由「N/M」扩展为「N/M · K 行」（匹配覆盖行数）；替换/全部替换后 toast 摘要反馈；
  - **PREFLIGHT-04 健康检查一键自动修复**：`core/preflight/fix.ts`（`autoFixPreflight`/`fixMissingImageAlt`/`altFromUrl` 纯函数）缺 alt 图片确定性推断描述填充；store `autoFixPreflightIssues` 修复后自动重新体检；`PreflightDrawer` 展示「自动修复」条；
  - **EDIT-QUICK-03 导出 HTML**：`CreatorQuickActions` 新增「导出 HTML」按钮（markdown-it 渲染 + 基础阅读样式完整 HTML 文档下载）。
- **v7 Phase 2 · 健康检查深化 + 查找增强 + 托盘快捷操作（目标 `0.7.0-alpha.2`）** —— 让发布更有底、查找更准、创作更顺手：
  - **PREFLIGHT-02 真实发布前强制体检**：「真实发布」点击 → 自动 `runPreflight` + 强制弹出 `PreflightDrawer`（`realMode`）→ 体检通过后「确认真实发布」才执行 `createPublishJob`；blocked 时真实发布禁用；
  - **PREFLIGHT-03 健康检查接入计划任务/发布队列/发布批次前置校验**：store 新增 `preflightGuard`（对目标草稿 + 目标平台执行 `runPreflight`，error 级问题拒绝），接入 `scheduleRunner` publish-job / `publishQueueExecutor` / `publishBatchItemExecutor`；
  - **EDIT-FIND-02 查找面板支持正则 / 高亮当前行**：`find-replace.ts` 新增 `useRegex` 匹配（`g/u` 标志 + 可选 `i`、零宽跳过、整词边界保留）+ `isValidRegex` + `lineOfIndex`；`FindReplaceBar` 新增「正则匹配」开关 + 正则错误提示；编辑器查找打开时高亮当前匹配行（`--find-line`）；
  - **EDIT-QUICK-02 创作快捷操作条扩展到桌面端托盘**：Rust 托盘新增「复制 Markdown / 导出 .md / 保存草稿 / 清空内容」四项 + `AppEventAction::Creator{Copy,Export,Save,Clear}`；前端 `DesktopEventAction` 扩展；store 新增 `copyMarkdown` / `exportMarkdown` / `clearMarkdown`。

### Tests
- `packages/app/test/find-replace.spec.ts` +10（正则匹配/大小写/整词/非法正则/零宽跳过/正则替换/行号）。
- `packages/app/test/find-replace-bar.component.spec.tsx` +2（正则开关计数/正则错误提示）。
- `packages/app/test/preflight-drawer.component.spec.tsx` +3（真实发布按钮/确认真实发布/blocked 禁用）。
- `packages/app/test/store-preflight.spec.ts` +3（托盘复制 Markdown / 空内容不复制 / 清空内容）。

### Changed
- `docs/ROADMAP_V7.md` 标注 Phase 2 达成（v7 Phase 2 全量）。
- `packages/app/src/App.tsx`：真实发布前强制体检；托盘创作快捷操作事件分发；查找打开时编辑器当前行高亮。
- `packages/app/src/state/store.ts`：新增 `preflightGuard` / `copyMarkdown` / `exportMarkdown` / `clearMarkdown`；计划任务/发布队列/发布批次执行器接入前置校验。
- `packages/desktop/src-tauri/src/lib.rs`：托盘新增创作快捷操作菜单项 + `AppEventAction` 扩展。
- `packages/app/src/bridge/types.ts` / `tauri-bridge.ts`：`DesktopEventAction` 扩展 `creator-*` 动作。
- `packages/app/src/styles/app.css` / `ui.css`：查找当前行高亮 / 正则错误提示样式。

## [0.7.0-alpha.1] - 2026-08

### Added
- **v7 创作工作流增强（Roadmap v7 Phase 1）** —— 把创作第一现场的编辑体验与发布前决策做深做透（写得更快、查得更准、发得更稳）：
  - **EDIT-FIND-01 编辑器查找/替换**：`app/components/find-replace.ts` 纯函数（`findMatches`/`nextMatch`/`replaceRange`/`replaceAll`，支持大小写敏感 / 整词匹配 / 循环跳转）+ `FindReplaceBar` 面板（Ctrl/Cmd+F 唤起、实时匹配计数、上一个/下一个、替换/全部替换，替换并入共享撤销栈，可一键撤销）；
  - **PREFLIGHT-01 发布前健康检查**：`core/preflight/preflight.ts`（`runPreflight`：标题缺失 / 正文空与过短 / 图片缺 alt 与 dataURL / 极限词扫描 / 各平台校验 error 汇总 → `PreflightReport` ready + issues + suggestions）+ `PreflightDrawer`（编辑器底部「发布前检查」按钮唤起：整体状态、平台汇总、问题清单、行动建议，blocked 时禁用发布）；
  - **SAVE-01 草稿切换自动保存加固**：store `editorDirty` 状态 + `flushDraft`（新建/切换草稿前强制保存，避免防抖窗口内丢内容）；`beforeunload` 未保存离开页面原生确认；
  - **EDIT-QUICK-01 创作快捷操作条**：`CreatorQuickActions`（复制 Markdown / 导出 .md / 立即保存 / 清空内容二次确认，全部 toast 反馈）。

### Tests
- `packages/core/test/preflight.spec.ts` 11 例（标题/正文/图片 alt 与 dataURL/极限词/平台校验 error/未知平台/建议排序）。
- `packages/app/test/find-replace.spec.ts` 16 例（findMatches/nextMatch/replaceRange/replaceAll 纯函数）。
- `packages/app/test/find-replace-bar.component.spec.tsx` 7 例（渲染/计数/跳转/替换/全部替换/关闭）。
- `packages/app/test/preflight-drawer.component.spec.tsx` 7 例（空态/ready/blocked/平台汇总/建议/重新检查）。
- `packages/app/test/store-preflight.spec.ts` 8 例（runPreflight / editorDirty / flushDraft）。
- `packages/app/test/creator-quick-actions.component.spec.tsx` 6 例（复制/导出/清空二次确认/保存）。

### Changed
- `docs/ROADMAP_V7.md` 新增（v7 路线图：创作工作流增强）。
- `README.md` 新增「创作工作流增强（Roadmap v7）」章节。
- `packages/app/src/App.tsx`：Ctrl/Cmd+F 唤起查找面板；编辑器底部「发布前检查」按钮；草稿切换前 flush；`beforeunload` 离开提示。
- `packages/app/src/state/store.ts`：新增 `editorDirty` / `flushDraft` / `runPreflight` / `preflightReport` / `preflightComputing`。
- `packages/core/src/index.ts`：导出 `runPreflight` / `preflightPlainText` / `preflightTitle` 及类型。
- `packages/app/src/styles/ui.css`：新增创作快捷操作条 / 查找替换面板 / 发布前检查抽屉样式。

## [0.6.0-rc.2] - 2026-08

### Added
- **v6 Phase 2 · 运营自动化（目标 `0.6.0-rc.2`）** —— 让发布运营者的「改期 / 批量操作 / 通知触达 / 一键入口」更顺手：
  - **BATCH-05 发布批次整体改期**：`PublishBatchService.rescheduleAll`（queued/failed/running 条目统一迁移到新时间，已终态保留；failed 随整体改期回到 queued 可重试）；store `reschedulePublishBatchAll`；`PublishBatchDrawer` 批次卡片新增「整体改期」按钮 + 底部改期条；
  - **CAL-05 日历周/月视图批量操作**：`ContentCalendar` 新增 月/周 视图切换（周视图周一~周日列 + 事件详情，跨月正确聚合）；`core/calendar` 新增 `weekDates` / `dayOfWeekIndex` / `addDaysIso` / `isInWeek` / `collectReschedulableInRange`（周/月窗口内可改期事件去重收集）；「批量操作」区勾选当前视图内队列/批次/任务事件 → 统一改期到目标日期（保留各自原时间），支持全选/清空；
  - **NOTIFY-02 通知点击跳转对应面板**：`PlatformBridge.showNotification?(title, body, action?)`；Web/扩展 `Notification.onclick` 派发 `mpp:notification-click` 事件 → App 打开对应面板（publish-queue / publish-batch / scheduler / calendar / performance / serverjobs / tasks）；桌面端透传 action（Linux 附加跳转提示）；
  - **TRAY-02 桌面端托盘「发布批次」一键入口**：Rust 托盘菜单新增「发布批次」项 + `AppEventAction::PublishBatch`；全局快捷键 `Ctrl/Cmd+Shift+B`；前端 `publish-batch` 事件分发与 `Ctrl/Cmd+Shift+B` 快捷键。
- **v6 Phase 1 · 内容日历全链路联动 + 桌面发布通知（目标 `0.6.0-rc.2`）** —— 把「发布队列 / 发布批次 / 计划任务」的时间维度统一收敛到内容日历，并让发布结果以系统通知主动触达：
  - **CAL-04 发布队列/批次入内容日历 + 拖拽改期**：`core/calendar` 新增 `queue`/`batch` 事件类型与 `CalendarInput.queue/batches` 聚合（待发布条目，终态自动隐藏）；新增 `shiftIsoToDate` 工具（ISO 迁移到目标日期，保留原时分）；`ContentCalendar` 接入 `publishQueue` / `publishBatches` —— 三类待发布事件（计划任务 cron / 队列条目 / 批次条目）均可**拖拽改期**（保留原时间只改日期）；点击事件可跳转**发布队列 / 发布批次**抽屉；新增 `dot-queue` / `dot-batch` 色点与图例；
  - **BATCH-04 批次单条改期**：`PublishBatchService.rescheduleItem`（仅 queued/running 可改期，已终态/运行中/非法时间明确拒绝）；store `reschedulePublishBatchItem`；`PublishBatchDrawer` 每条目（排队中/失败）新增「改期」按钮 + 底部改期条；
  - **NOTIFY-01 发布完成系统通知**：`PlatformBridge.showNotification?`（web=Notification API / 桌面=Tauri `show_notification` 命令：Linux `notify-send` / macOS `osascript` / Windows PowerShell）；store 队列/批次心跳到点执行后发送成功/失败系统通知（`notify()` helper 全 try/catch 静默降级，不阻塞业务）。

### Tests
- `packages/core/test/calendar.spec.ts` +5（v6 Phase 2 周视图工具 + `collectReschedulableInRange` 去重收集）。
- `packages/core/test/publish-batch.spec.ts` +2（`rescheduleAll` 整体改期：queued/failed/running 迁移 + 终态保留；非法时间拒绝）。
- `packages/app/test/content-calendar.component.spec.tsx` +2（周视图切换展示本周事件；批量操作勾选队列/批次事件统一改期到目标日）。
- `packages/app/test/publish-batch-drawer.component.spec.tsx` +1（批次「整体改期」按钮调用 `reschedulePublishBatchAll`）。
- `packages/app/test/desktop-event-link.spec.tsx` +2（托盘/快捷键 publish-batch 事件；Web 通知点击 `mpp:notification-click` 打开对应面板）。
- `packages/core/test/calendar.spec.ts` +6（队列/批次事件聚合、终态隐藏、批次默认时间回退、`shiftIsoToDate`）。
- `packages/core/test/publish-batch.spec.ts` +2（`rescheduleItem` 改期与拒绝场景）。
- `packages/app/test/content-calendar.component.spec.tsx` +3（队列/批次展示与跳转、队列条目拖拽改期、批次条目拖拽改期）。
- `packages/app/test/publish-batch-drawer.component.spec.tsx` +1（单条改期调用 `reschedulePublishBatchItem`）。

### Changed
- `docs/ROADMAP_V6.md` 标注 Phase 2 达成（v6 Phase 2 运营自动化全量）。
- `README.md` 内容日历 / 发布批次章节补充 v6 Phase 2 增强说明。
- `packages/desktop/src-tauri/src/lib.rs` 托盘菜单新增「发布批次」项 + `AppEventAction::PublishBatch` + `Ctrl/Cmd+Shift+B` 全局快捷键；`show_notification` 支持 action 参数。
- `packages/app/src/bridge/types.ts` / `tauri-bridge.ts` / `mock-bridge.ts` / `chrome-bridge.ts` `showNotification?` 新增 `action` 参数（Web 派发 `mpp:notification-click`）。
- `docs/ROADMAP_V6.md` 新增（v6 路线图：内容日历全链路联动 + 桌面发布通知）。
- `README.md` 新增「内容日历全链路联动 + 桌面发布通知」章节；内容日历 / 发布批次章节补充 v6 增强说明。
- `packages/desktop/src-tauri/src/lib.rs` 新增 `show_notification` 命令（跨平台系统通知）。
- `packages/app/src/bridge/types.ts` / `tauri-bridge.ts` / `mock-bridge.ts` 新增 `showNotification?` 桥方法。

## [0.6.0-rc.1] - 2026-08
- **桌面端托盘/快捷键一键「排入队列」+ AI 排期建议接入计划任务与发布批次（0.6.0 后续增强）**：
  - **托盘一键排入队列**：系统托盘菜单新增「发布队列」入口，全局快捷键新增 `Ctrl/Cmd+Shift+Q`（Rust `AppEventAction::PublishQueue` + 前端 `publish-queue` 事件分发）—— 单击即唤起主窗口并打开发布队列抽屉，配合既有「AI 自动排期」一键把当前草稿排入队列；
  - **AI 排期建议接入计划任务**：`SchedulerDrawer` 新增「AI 自动排期」—— 结合历史效果与当前内容建议执行时点与平台组合，采纳后把建议时间落地为 cron 时/分（计划任务无日期概念）、平台组合填入目标平台；
  - **AI 排期建议接入发布批次**：`PublishBatchDrawer` 新增「AI 自动排期」—— 结合历史效果与当前内容建议批次发布时间与平台组合，采纳后填入批次表单（所有勾选草稿统一按此时间排队）；
  - **共享排期组件**：新增 `packages/app/src/components/schedule-ai.tsx`（`ScheduleSuggestionsBlock` + 文本/时间工具），发布队列/发布批次/计划任务三个面板复用同一套建议展示与采纳交互。

### Tests
- `packages/app/test/scheduler-drawer.component.spec.tsx` +1（AI 排期建议生成与采纳）。
- `packages/app/test/publish-batch-drawer.component.spec.tsx` +1（AI 排期建议生成与采纳）。
- `packages/app/test/desktop-event-link.spec.tsx` +1（托盘/快捷键 publish-queue 事件打开发布队列抽屉）。

## [0.6.0-rc.1] - 2026-08

### Added
- **v5 Phase 4 · AI 发布工作台（目标 `0.6.0-rc.1`）** —— 让大模型与效果数据介入「发布队列」排期，并在批量 AI 完成后一键排队：
  - **AI-QUEUE-01 AI 自动排期建议**（`packages/core/src/insight/queue-scheduler.ts`）：`generateQueueSchedule` 结合 `analyzePerformance` 历史效果洞察（最佳平台 / 最佳时段 / 增长率）与当前内容，生成**建议发布时间（ISO）+ 平台组合 + 理由**；LLM 可用时走统一适配器（任务级参数 + 多模型回退 + 重试），不可用/失败回退 `ruleScheduleSuggestions` 规则建议（确定性、离线可用）；`nextAtForHour` 把小时建议落地为 ISO（越过最早时间）；建议平台只取传入集合交集（不落到未选平台）；上下文脱敏（不含 remoteUrl / remoteId / 密钥）；
  - **发布队列面板新增「AI 自动排期」**：`PublishQueueDrawer` 新增 AI 排期按钮 —— 生成后逐条展示建议（时间 / 平台组合 / 来源 LLM·规则），一键「采纳此建议」把时间与平台填入排队表单；全 Lucide 图标；
  - **AI-QUEUE-02 批量 AI 后一键排队**：core `buildQueueEntriesFromBatch`（把批量 AI 自动完成结果转为一组队列条目输入，只排**有改写的篇目**，时间/平台可统一指定或规则推导）；`BatchDrawer` AI 模式新增「一键把 AI 结果排入发布队列」；store 新增 `enqueuePublishBatch`（逐篇落库，锁定账号引用，当前编辑先保存再排队，无效时间/空内容明确报错不假装成功）。

### Tests
- `packages/core/test/queue-scheduler.spec.ts` 12 例（nextAtForHour / 规则排期（空数据与有效果数据）/ scheduleRequest 脱敏 / parseScheduleSuggestions 宽松解析 / LLM 可用与平台交集 / LLM 失败回退 / buildQueueEntriesFromBatch 过滤与默认）。
- `packages/app/test/store-publish-queue.spec.ts` +2（enqueuePublishBatch 批量排队与校验）。
- `packages/app/test/publish-queue-drawer.component.spec.tsx` +1（AI 自动排期按钮 → 规则建议 → 采纳按钮）。
- `packages/app/test/batch-drawer-ai.component.spec.tsx` +1（AI 结果一键排入发布队列调用 store action）。

### Changed
- `docs/ROADMAP_V5.md` 标注 Phase 4 达成（目标 `0.6.0-rc.1`）。
- `README.md` 新增「AI 发布工作台」章节。

### Added
- **v5 Phase 3 · 内容资产库（目标 `0.6.0-beta`）** —— 把散落在各处的封面 / 图床 URL / 平台产物 / 草稿快照统一索引与检索：
  - **ASSET-01 资产索引**（`packages/core/src/asset-library/`）：`AssetRecord` 契约（cover / rehost / artifact / snapshot 四类）+ `extractImageReferences`（dataURL 归一化为短哈希、外链保留 URL）+ `indexAssetFromDraft`（草稿 → 封面 + 图床）+ `indexAssetFromQueueEntry` / `indexAssetFromBatch`（待发布/已发布产物含回执 URL）+ `buildAssetLibraryIndex`（增量幂等合并 + 陈旧记录回收 + 损坏记录忽略）+ `searchAssetLibrary`（标题/平台/引用/类型加权评分，离线可用，平台中文别名命中）+ `assertAssetRecord`（损坏检测）+ `pruneAssetLibrary`（条数上限 + 终态来源 TTL）；dataURL 只存短哈希 + 字节数，不落完整二进制；索引不含密钥；
  - **ASSET-02 资产视图 UI**：工具栏「内容资产库」抽屉（`AssetLibraryDrawer`，懒加载独立 chunk）—— 按类型浏览（全部/封面/图床/产物/快照）+ 检索 + 复制引用 / 打开远端 URL / 删除（仅删本地索引）+ 手动录入 + 一键重建索引（从草稿/队列/批次）；
  - **资产库存储**：app `asset-library-store.ts`（web=IndexedDB **schema v10** / 扩展=chrome.storage 双实现；**全部存储统一升级 v9 → v10** 新增 `asset-library` objectStore，含 by-kind / by-draft 索引）；
  - **store 接线**：`loadAssetLibrary` / `rebuildAssetIndex` / `searchAssets` / `addAsset` / `removeAsset`；接入 `Ctrl/Cmd+K` 命令面板；工具栏新增「内容资产库」按钮；全 Lucide 图标、无表情符号。

### Tests
- `packages/core/test/asset-library.spec.ts` 13 例（extractImageReferences / dataUrlShortHash / indexAssetFromDraft / queue/batch 索引 / buildAssetLibraryIndex 幂等与更新 / 损坏检测 / searchAssetLibrary 加权与过滤 / pruneAssetLibrary 上限与 TTL）。
- `packages/app/test/store-asset-library.spec.ts` 5 例（load / rebuild 幂等 / search / add / remove）。
- `packages/app/test/asset-library-drawer.component.spec.tsx` 4 例（渲染 / 类型过滤 / 重建索引 / 手动录入校验）。

### Changed
- `docs/ROADMAP_V5.md` 标注 Phase 3 达成（目标 `0.6.0-beta`）。
- 全部 IndexedDB 存储 schema 统一升级 **v9 → v10**（新增 `asset-library` objectStore），消除多 store 版本不一致导致的 `VersionError`。
- `README.md` 新增「内容资产库」章节。

### Added
- **v5 Phase 2 · 发布批次与批量复盘（目标 `0.6.0-alpha.2`）** —— 把「手动逐篇发布」升级为一次排队多篇、到点逐篇发布、批量回收效果、自动生成批次复盘：
  - **BATCH-01 批次发布**（`packages/core/src/publish-batch/`）：`PublishBatch` 契约（条目独立平台/账号/时间，缺省继承批次）+ `PublishBatchService`（create / dueItems / runDue / triggerItem / retryFailed / cancel / remove / prune）；到点逐篇触发，**单篇失败不阻断其余**，未注入执行器如实标记失败；`aggregateBatchStatus` 状态聚合 + 去重窗口防重复触发；终态 TTL 30 天 + 条数上限 100；
  - **BATCH-02 批量效果回收**：`collectMetrics` 按批次内成功篇回执的 `remoteId`/`remoteUrl` 汇总写入效果回收库（同一平台+`remoteId` 去重，不重复录入；无可回收如实报告）；
  - **BATCH-03 批次复盘**：`buildBatchRetro` 纯函数 —— 成功率 / 成功失败跳过数 / 按平台表现 / 可回收 remoteId 数 / 确定性建议（脱敏，不依赖 LLM），全部条目终态后自动生成；
  - **批次存储**：app `publish-batch-store.ts`（web=IndexedDB **schema v9** / 扩展=chrome.storage 双实现；**全部存储统一升级 v8 → v9** 新增 `publish-batches` objectStore）；
  - **发布批次 UI**：工具栏「发布批次」抽屉（`PublishBatchDrawer`，懒加载独立 chunk）—— 勾选多篇草稿 + 平台 + 时间创建批次、条目明细（状态/任务/回执）、立即执行某篇 / 一键重试失败篇 / 取消 / 删除、批量回收效果、批次复盘展示；App 心跳（60s）逐篇执行；接入 `Ctrl/Cmd+K` 命令面板；全 Lucide 图标、无表情符号。

### Tests
- `packages/core/test/publish-batch.spec.ts` 18 例（create / runDue 单篇失败不阻断 / 未注入执行器 / triggerItem / retryFailed / cancel / remove / prune / collectMetrics 去重与无可回收 / buildBatchRetro 成功率与建议 / aggregateBatchStatus / schema 校验）。
- `packages/app/test/store-publish-batch.spec.ts` 5 例（创建批次 / 校验必填 / 立即执行并收集回执 / 批量回收效果 / 取消/重试/删除）。
- `packages/app/test/publish-batch-drawer.component.spec.tsx` 4 例（空态 / 未勾选草稿报错 / 创建批次调用 action / 批次列表与操作按钮）。

### Changed
- `docs/ROADMAP_V5.md` 标注 Phase 2 达成（目标 `0.6.0-alpha.2`）。
- 全部 IndexedDB 存储 schema 统一升级 **v8 → v9**（新增 `publish-batches` objectStore），消除多 store 版本不一致导致的 `VersionError`。
- `README.md` 新增「发布批次与批量复盘」章节。

### Added
- **v5 Phase 1 · 发布队列与定时发布（目标 `0.6.0-alpha.1`）** —— 把草稿排入「稍后发布」队列，到点自动触发真实发布：
  - **QUEUE-01 发布队列核心**（`packages/core/src/publish-queue/`）：`PublishQueueEntry` 契约（状态机 queued→running→succeeded/failed/cancelled）+ `PublishQueueService`（enqueue / dueEntries / runDue / trigger / reschedule / cancel / remove / prune）；到点执行如实记录成功/失败，未注入执行器如实标记失败，**不假装成功**；`dedupeWindowMs` 去重窗口 + 状态机守卫防重复触发；终态 TTL 30 天 + 条数上限 100（prune 优先保留排队/运行中）；
  - **QUEUE-02 排队时锁定账号引用**：`QueueAccountRef`（platformId + serverProfileId / profileDir）；`createPublishJobFromDraft` 支持 `accountRefs` 优先路由 —— 排队期间切换账号不影响到点发布（公众号按 server profile、会话平台按浏览器 profile 路由）；
  - **QUEUE-03 队列持久化**：app `publish-queue-store.ts`（web=IndexedDB **schema v8** / 扩展=chrome.storage 双实现；全部存储统一升级 v8 新增 `publish-queue` objectStore）；
  - **QUEUE-04 发布队列 UI**：工具栏「发布队列」抽屉（`PublishQueueDrawer`，懒加载独立 chunk 8.33 kB）—— 排入队列（草稿 / 平台 / 期望发布时间 / 真实发布开关）、列表（状态徽标 / 发布时间 / 账号锁定提示）、立即执行 / 改期 / 取消 / 删除；App 心跳（60s）检查到点条目并执行；接入 `Ctrl/Cmd+K` 命令面板；全 Lucide 图标、无表情符号。

### Tests
- `packages/core/test/publish-queue.spec.ts` 12 例（enqueue / dueEntries / runDue 成功与失败 / 未注入执行器 / trigger 重试 / reschedule / cancel / remove / prune / schema 校验 / 账号级路由 / 去重窗口）。
- `packages/app/test/store-publish-queue.spec.ts` 5 例（store 生命周期 / 心跳到点自动转发布任务 / 校验必填 / 账号锁定）。
- `packages/app/test/publish-queue-drawer.component.spec.tsx` 5 例（空态 / 表单校验 / 排入队列调用 action / 列表状态 / 取消条目按钮）。

### Changed
- 新增 `docs/ROADMAP_V5.md`（v5 路线图：发布队列 → 批次发布 → 内容资产库 → AI 发布工作台）。
- 全部 IndexedDB 存储 schema 统一升级 **v7 → v8**（新增 `publish-queue` objectStore），消除多 store 版本不一致导致的 `VersionError`。
- `README.md` 新增「发布队列与定时发布」章节。

## [0.5.0-beta] - 2026-08

### Added
- **v4 Phase 3 · 协作共享（COLLAB-01~04）** —— 把内容变成可共享的一等公民（多人协作 / 跨机器搬运）：
  - **COLLAB-01 共享草稿/模板/报告（server 侧）**：新增 `packages/core/src/collab/`（`SharedItem` 契约 / `MemorySharedStore` / `assertSharedItem` / `bumpSharedVersion`）+ server `GET/POST/DELETE /share/*` 路由（`registerShareRoutes`，强制 X-MPP-Token 鉴权，只读写列表 + 单条，不做任意文件读写）+ `FileSharedStore`（版本化 JSON + 原子写 + 损坏检测，落盘 `data/shared-items.json`）；
  - **COLLAB-02 共享包导入导出**：`buildShareBundle` / `serializeShareBundle` / `parseShareBundle` / `importShareBundle` —— 单一 `.json` 共享包（schema 版本 + **SHA-256 完整性摘要**，WebCrypto 不可用回退 FNV），导入时签名校验（篡改/损坏拒绝）、版本不匹配明确报错、已存在覆盖 / 新增追加 / 较旧跳过；
  - **COLLAB-03 共享 UI**：工具栏「**协作共享**」抽屉（`CollabDrawer`，懒加载独立 chunk）—— 按类型（草稿/模板/报告）浏览 server 共享内容、一键拉取并应用（草稿载入编辑区、报告复制/导出）、推送当前草稿/复盘报告、导出/导入共享包、删除；连接失败明确提示不假装成功；全 Lucide 图标；
  - **COLLAB-04 可选远程同步**：server 新增 `SYNC_URL` 环境变量（自托管同步服务器地址，与本地 server 同协议）；`/share` 列表返回 `sync` 声明；未配置时优雅降级为纯本地/局域网共享（UI 明确展示同步源状态）；
  - **桌面端联动**：托盘菜单新增「协作共享」，全局快捷键新增 `Ctrl/Cmd+Shift+S`（Rust `AppEventAction::Collab` + 前端 `collab` 事件分发）。

### Tests
- `packages/core/test/collab.spec.ts` 12 例（打包 / 摘要确定性 / 解析校验 / 导入合并 / 防篡改 / 内存库上限 / 条目规范化）。
- `packages/server/test/share.spec.ts` 7 例（鉴权 401 / 列表 / 单条 / 推送 / 删除 / 远程同步声明 / `FileSharedStore` 落盘重启恢复 + 损坏检测）。
- `packages/app/test/server-share.spec.ts` 7 例（共享 REST 客户端）、`collab-drawer.component.spec.tsx` 6 例（协作共享抽屉）、`desktop-event-link.spec.tsx` +1（collab 事件）、`toolbar.component.spec.tsx` +1（协作共享按钮）。

### Changed
- server `.env.example` 补充 `SYNC_URL`（协作共享远程同步源）配置说明。
- **v4 Phase 2 · 内容智能周报自动化（目标 `0.5.0-alpha.2`）** —— 在复盘报告之上，让周报可调度、可投递、可回溯：
  - **WEEKLY-01 周报任务核心**（`packages/core/src/weekly/`）：`WeeklyReportJob` 契约（模板 / 窗口天数 / 投递渠道 / LLM 开关 / 运行历史）+ `MemoryWeeklyStore`（版本化 + 保留最近记录）+ `buildWeeklyReport`（近 N 天窗口裁剪 + 模板 + LLM 总结段，失败回退规则总结）+ `ruleWeeklySummary` / `generateWeeklySummary`（LLM 可用则 LLM 生成 JSON 数组，失败回退 `analyzePerformance` 派生规则总结，数字事实以回收数据为准）；
  - **WEEKLY-02 周报调度接入**：计划任务新增 `weekly-report` 动作（`ScheduledAction` 扩展 + `weeklyReport` 关联配置），到点自动生成周报任务（含 LLM 总结，失败回退规则）并记录执行摘要；app `WeeklyReportService` 编排（窗口裁剪 → 总结 → 生成 → 逐渠道投递 → 记录历史）；app 侧 `weekly-store.ts`（IndexedDB **schema v6** / chrome.storage 双实现）；
  - **WEEKLY-03 周报投递渠道**：server `POST /weekly/send`（SMTP / 通用 Webhook，凭据**不落盘**只从 server 环境变量 `MAIL_*` / `WEEKLY_WEBHOOK_HOSTS` 读取；Webhook 目标白名单校验；无凭据时明确提示不假装成功）+ `packages/server/src/weekly/sender.ts`（Node `net` 直连 SMTP 无外部依赖）+ app `bridge/server-weekly.ts` 客户端；
  - **WEEKLY-04 周报 UI**：`ReportDrawer` 新增「周报自动化」tab —— 创建/编辑定时周报任务（模板 / 窗口天数 / 投递渠道 / LLM 开关）、手动立即生成、最近执行历史（记录数 / LLM / 投递结果）、投递按钮（复用 server 渠道）；`SchedulerDrawer` 动作新增「生成周报」选项（关联周报任务）。

### Tests
- `packages/core/test/weekly.spec.ts` 24 例（构建 / 窗口裁剪 / LLM 总结 / 解析 / 服务生命周期 / 生成编排 / 投递记录）。
- `packages/server/test/weekly.spec.ts` 15 例（`/weekly/send` 鉴权 / schema / 未配置提示 / SMTP 未配置 / Webhook 白名单 / 批量投递）。
- `packages/app/test/store-weekly.spec.ts` 9 例（store 创建/状态/生成/预览 + 计划任务 weekly-report 动作）、`server-weekly.spec.ts` 4 例（投递客户端）、`report-drawer-weekly.component.spec.tsx` 6 例（周报自动化 UI）。

### Changed
- app 侧全部 IndexedDB 存储统一升级到 **DB schema v6**（新增 `weekly-reports` objectStore），保证多 store 打开同一 DB 不冲突。

### Added
- **v4 Phase 1 · 多账号平台管理（目标 `0.5.0-alpha.1`）** —— 把工具从单账号升级为多账号矩阵运营：
  - **ACCOUNT-01 账号配置模型**（`packages/core/src/accounts/`）：`AccountProfile` 契约（平台/名称/凭据引用/密钥分级/启用态）+ `MemoryAccountStore` + `resolveActiveAccount`（平台级 > 全局 > 默认）+ `sanitizeProfileDir`（防路径穿越）;
  - **ACCOUNT-02 账号持久化与安全分级**：app `account-store.ts`（IndexedDB schema v5 / chrome.storage 双实现）；密钥默认**仅会话保存**（落盘前 `stripAccountSecrets` 剔除，对齐 SEC-04），显式开启「持久化保存密钥」才写入本地存储；
  - **ACCOUNT-03 账号级发布/连接/指标**：发布（`publishAll`/发布任务）按账号路由 —— 会话平台带 `profileDir`（runner 独立浏览器 profile），公众号带 `serverProfileId`（server 多公众号凭据）；一键连接 / 指标同步同样按账号路由；server 新增 `WechatAccountRegistry` + `MP_PROFILES` 多公众号配置（`/wechat/publish`、`/platform-api/connect`、`/metrics/sync` 均支持 `serverProfileId`，密钥只在 server 进程内，`/platform-api/status` 返回脱敏账号引用）；runner 会话连接/发布支持 `profileDir`;
  - **ACCOUNT-04 账号管理 UI**：工具栏「**账号管理**」抽屉（`AccountManagerDrawer`，懒加载独立 chunk）—— 按平台分组展示账号、新建/编辑/删除、切换全局当前账号 + 平台级账号选择、密钥脱敏输入（默认仅会话 + 持久化开关）、连接成功自动回写账号昵称；全 Lucide 图标无表情符号。

### Tests
- `packages/core/test/accounts.spec.ts` 19 例（模型/安全分级/选择解析/上限）。
- `packages/app/test/account-store.spec.ts` 6 例（IndexedDB 落盘 + 密钥剔除 + schema v5）、`store-accounts.spec.ts` 6 例（store 行为）、`account-manager-drawer.component.spec.tsx` 6 例（组件交互）。
- `packages/server/test/accounts-routing.spec.ts` 8 例（`MP_PROFILES` 解析 / 凭据路由 / `/wechat/publish` 多账号发布），`platform-api.spec.ts` +1（多账号引用脱敏）。

### Added
- **v4 Phase 3 · 协作共享增强 —— FileSharedStore 接入桌面端/扩展 + 版本化冲突合并（COLLAB-01 深化，目标 `0.5.0-beta`）**：
  - **FileSharedStore 下沉 core 复用**：`packages/core/src/collab/file-store.ts`（版本化 JSON + 原子写 + 损坏检测，导出子路径 `@mpp/core/collab/file-store`），server 侧 `packages/server/src/shared/store.ts` 改为 re-export，桌面端经 Tauri 桥（`shared_local_read` / `shared_local_write` 命令，`<app_data_dir>/shared-items.json`）复用同一文件实现；扩展走 `chrome.storage.local`，web/桌面走 IndexedDB（**schema v7** 新增 `shared-items` objectStore，全部存储统一升级）。
  - **版本化冲突合并（同 id 并发覆盖保留双版本）**：core 新增 `mergeSharedItem`（created / updated / conflict / unchanged 四种写入模式）+ `SharedItemPutResult` 契约；同 id 并发覆盖（不同来源 / 版本未递增）时**保留双版本** —— 新版本以 `原id#v{n}` 后缀写入、旧版本保留在原 id 下，列表按时间倒序两者都可见；顺序覆盖（同源且版本递增）正常替换并递增版本号；内容一致且版本/时间不更新 → unchanged（空操作不产生噪声版本）。`MemorySharedStore` / `FileSharedStore` / `IdbSharedStore` / `ChromeSharedStore` / `DesktopFileSharedStore` 全部接入；`importShareBundle` 同步适配。
  - **server /share 路由返回版本化结果**：POST 响应带 `mode`（created/updated/conflict/unchanged）与冲突后新 id，前端明确提示「已保留双版本」。
  - **协作共享抽屉接入本地共享库**：新增「本地共享库」区块（桌面端/扩展离线副本），可浏览/拉取本地内容、推送当前草稿到本地库；store 新增 `refreshLocalShared` / `localSharedPush` / `localSharedRemove`。

### Tests
- `packages/core/test/collab.spec.ts` +3（顺序覆盖 updated / 并发覆盖 conflict 保留双版本 / 内容一致 unchanged）。
- `packages/server/test/share.spec.ts` +2（并发覆盖 conflict / unchanged）。
- `packages/app/test/shared-store.spec.ts` 4 例（IdbSharedStore schema v7 / ChromeSharedStore / 版本化合并 / unchanged）。
- `packages/app/test/desktop-shared-store.spec.ts` 3 例（DesktopFileSharedStore 经 Tauri 桥读写 / 冲突保留双版本 / unchanged）。

## [0.4.0-beta] - 2026-08

### Added
- **v4 路线图（`docs/ROADMAP_V4.md`）** —— 规划多账号平台管理（ACCOUNT-01~04）/ 内容智能周报自动化（WEEKLY-01~04）/ 协作共享（COLLAB-01~04），目标 `0.5.0-beta`，供后续迭代按阶段落地。
- **桌面端托盘/快捷键与 v3 新功能联动** —— 系统托盘菜单扩展为 **v3 功能中心**（打开主窗口 / AI 自动完成 / 内容日历 / 发布复盘报告 / 命令面板）；全局快捷键扩展为三键位（`Ctrl/Cmd+Shift+A` AI 自动完成、`Ctrl/Cmd+Shift+C` 内容日历、`Ctrl/Cmd+Shift+R` 复盘报告）；Rust 侧统一改为 `desktop://app-event` 事件通道（载荷为动作字符串），前端 `TauriBridge.onDesktopEvent` 订阅分发到对应抽屉，并兼容旧 `desktop://ai-agent` 事件。
- **v3 · AI 选区操作（EDIT-AI-01/02，ROADMAP_V3 Phase 1）** —— 新增 `packages/core/src/editor-ai/`：`runSelectionAi` / `selectionAiRequest` / `isBlockishOutput`，7 种选区操作（风格改写 / 润色 / 扩写 / 续写 / 摘要 / 中译英 / 英译中），LLM 不可用 / 输出块级 / 空 / 与原文一致时防御性回退原文，绝不破坏 Markdown 选区；任务级 `temperature/maxTokens/systemPrompt` 透传（自动接入 AI 连接中心多配置回退 + 指数退避重试）。UI：`SelectionAiBar` 选中文本浮出操作栏，一键调用 LLM 替换选区并保留光标（懒加载独立 chunk）。
- **v3 · 全局命令面板（EDIT-AI-03）** —— `CommandPalette`：Ctrl/Cmd+K 唤起，搜索并打开全部功能抽屉 + 常用文档动作（新建 / 保存 / 导出草稿）；方向键选择 + Enter 执行、Esc 关闭；工具栏新增入口（懒加载独立 chunk）。
- **v3 · 内容日历（CAL-01/02，ROADMAP_V3 Phase 2）** —— 新增 `packages/core/src/calendar/`：`buildCalendar` 把草稿更新 / 计划任务（cron 计算当月触发日）/ 发布历史 / 效果记录聚合到月历；`ContentCalendar` 月历格子 + 四色事件点 + 点击当天查看详情 + 上月 / 下月 / 回到当月（懒加载独立 chunk，仅 5.0kB）。
- **v3 · 发布复盘报告（REP-01/02，ROADMAP_V3 Phase 2）** —— 新增 `packages/core/src/report/`：`buildPerformanceReport` 把效果回收 + 智能分析（最佳平台 / 增长率 / 最佳时段）+ 发布策略建议（可选 LLM 生成、失败自动回退规则）一键生成 Markdown 报告；`ReportDrawer` 支持复制 / 导出 .md；报告完全脱敏（不含 remoteUrl / 凭据）。
- **v3 · AI 选区操作增强（EDIT-AI-04）** —— 选区操作栏新增「**全部平台**」按钮：`runSelectionAiForPlatforms` 对多个已选平台分别独立风格改写（`mapBounded` 有界并发，默认 2），返回每平台结果 + 多平台风格差异提示（`platformStyleHint`）；AI 改写结果并入 **Markdown 工具栏共享撤销栈**（`editor-history.ts`），Ctrl/Cmd+Z 可一并回退。
- **v3 · 内容日历动作联动（CAL-03）** —— 日历事件点击可**打开对应详情**（草稿→加载并打开展示、任务→计划任务面板、效果→效果回收）；**计划任务支持拖拽改期**（HTML5 DnD，`shiftCronToDate` 保留原时间只改日期）；store 新增 `updateScheduledTask`。
- **v3 · 发布复盘报告模板（REP-03）** —— `ReportDrawer` 支持**四种报告模板**（综合复盘 / 周报·近 7 天 / 月报·近 30 天 / 平台专项，`filterRecordsByWindow` 按窗口裁剪）+ **三种导出格式**（Markdown / HTML / PDF·打印预览，`reportMarkdownToHtml` 输出内联 CSS 的打印友好 HTML）。
- **v3 · 命令面板进阶（CMD-02）** —— **最近使用排序**（执行过的命令下次优先展示 + 「最近」徽标，`command-history.ts` 持久化到 localStorage）；支持**自定义命令**（名称 / 别名 / 关键词，别名快速匹配，可增删）。

### Tests
- `packages/core/test/editor-ai.spec.ts` +10（runSelectionAiForPlatforms / mapBounded / platformStyleHint）、`calendar.spec.ts` +3（shiftCronToDate）、`report.spec.ts` +7（模板裁剪 / HTML 转换）。
- `packages/app/test/editor-history.spec.ts` 4 例、`command-history.spec.ts` 8 例、`command-palette.component.spec.tsx` 4 例、`content-calendar.component.spec.tsx` +3（事件联动 / 拖拽改期）、`report-drawer.component.spec.tsx` +3（模板选择 / 周报标题）。
- `packages/app/test/desktop-event-link.spec.tsx` 4 例（桌面端托盘/全局快捷键事件分发：ai-agent / calendar / report / command-palette 打开对应抽屉）。

## [0.3.0] - 2026-08

### Added
- **LLM 调用成本/响应观测（Roadmap v2 · AI-ROBUST-03，目标 `0.3.0-beta.1`）** —— 新增 `packages/core/src/llm/telemetry.ts`：
  - `LlmTelemetry` 观测器记录每次 LLM 调用（任务 / 模型 / 脱敏 host / 耗时 / 成功与否 / 错误类别与状态码 / 输入输出 token 估算 / 是否回退 / 命中适配器），记录上限（默认 200 条）自动裁剪；
  - `estimateTokens`（中文按字符、ASCII 按 4 字符/token 粗估）、`hostOfBaseUrl`（只保留协议 + host，剔除路径/凭据/查询串）、`classifyLlmError`（timeout / http / network / other）；
  - `summary()` 汇总（成功率 / 平均耗时 / p95 / 累计 token / 按任务类型）；全局共享 `llmTelemetry` 实例；
  - **接入链路**：`OpenAiCompatLlm` 默认接全局观测器（可注入独立实例）；`adapterFromConfig` / `fallbackFromConfigs` 透传观测器；
  - **UI「LLM 调用观测」抽屉**（`LlmTelemetryDrawer`，懒加载独立 chunk）：汇总卡片（总调用 / 成功率 / 平均耗时 / p95 / token 估算）+ 按任务类型统计 + 最近调用列表（成功/失败、耗时、回退徽标、脱敏错误信息）+ 刷新/清空；工具栏新增 `Activity` 入口；
  - **store 接线**：`buildLlmAdapter` 外层叠加观测同步装饰器，每次 LLM 调用后自动把观测快照同步到 store（观测面板实时展示）；观测记录仅存内存、不落盘、不含 key。

### Tests
- `packages/core/test/telemetry.spec.ts` 15 例（token 估算 / host 脱敏 / 错误分类 / 记录成功与失败 / 汇总统计 / 上限裁剪与 clear / recent 排序 / OpenAiCompatLlm 默认接全局观测器与注入独立实例）。
- `packages/app/test/llm-telemetry-drawer.component.spec.tsx` 3 例（空态 / 有记录展示汇总与列表 / 清空记录）。
- `packages/app/test/toolbar.component.spec.tsx` 新增 2 例（LLM 调用观测按钮与 aria-pressed）。

### Added
- **Phase D 内容智能（Roadmap v2 · AI-INSIGHT-01/02/03，目标 `0.3.0-rc.1`）**：
  - **AI 发布策略建议（AI-INSIGHT-01）** —— 新增 `packages/core/src/insight/publish-strategy.ts`：`generatePublishStrategy` 结合效果回收数据与当前内容，LLM 生成「选题 / 平台组合 / 发布时段」结构化建议（JSON 数组，`parseStrategySuggestions` 宽松解析）；LLM 不可用/失败自动回退到 `analyzePerformance` 派生的 `ruleStrategySuggestions` 规则建议；`buildStrategyContext` 上下文脱敏（不含 remoteUrl / remoteId）。「发布效果回收」抽屉新增「AI 发布策略建议」区（生成按钮 + LLM/规则建议展示）。
  - **AI 批量改写增强（AI-INSIGHT-02）** —— `batchAutoComplete` / `runAutoAgent` / `rewriteParagraphsWithLlm` 新增任务级参数 `temperature / maxTokens / systemPrompt` 透传；「批量与审批」→ AI 自动完成模式新增 **改写温度 / 最大 Token / 每篇改写段数** 控件，多模型回退 + 重试随当前生效配置自动生效。
  - **AI 草稿摘要索引与检索（AI-INSIGHT-03）** —— 新增 `packages/core/src/insight/draft-index.ts`：`buildDraftIndex` 为草稿生成「一句话摘要 + 关键词 + 主题标签」（LLM 可用时 LLM 生成、否则规则兜底），`searchDraftIndexes` 做本地确定性相关性检索（标题/关键词/摘要/主题加权评分 + 长度惩罚）。工具栏新增 **🔍 AI 草稿检索** 抽屉（`DraftSearchDrawer`，懒加载独立 chunk）：补建索引 / 自然语言检索 / 命中一键载入草稿；store 新增 `draftIndexes` 状态与 `setDraftIndexes`。

### Tests
- `packages/core/test/publish-strategy.spec.ts` 7 例（空数据规则兜底 / 效果数据派生 / 上下文脱敏 / LLM JSON 建议 / 失败回退 / 代码块解析 / 请求不泄漏敏感字段）。
- `packages/core/test/draft-index.spec.ts` 8 例（纯文本抽取 / 规则摘要关键词 / LLM 索引 / 失败回退 / JSON 解析 / 相关性排序 / 空查询安全）。
- `packages/core/test/batch-task-params.spec.ts` 2 例（任务级参数透传到段落改写请求 / 默认值保持）。
- `packages/app/test/draft-search-drawer.component.spec.tsx` 3 例（空态 / 补建索引 / 检索命中）。
- `packages/app/test/performance-drawer.component.spec.tsx` 新增 1 例（AI 发布策略建议生成与展示）。

### Added
- **AI 连接中心（Roadmap v2 Phase A/B）** —— 工具栏新增「AI 连接中心」抽屉（`AiConnectDrawer`，懒加载独立 chunk）：
  - **预设模板一键填充**（core `llm/presets.ts`）：DeepSeek / OpenAI / Kimi(Moonshot) / 通义千问 / 智谱 GLM / Ollama 本地 / vLLM 自托管 7 套预设，点击即创建配置并设为当前生效（apiKey 留空由用户填写，密钥绝不进预设）；
  - **多配置管理**（core `llm/config.ts` + store `mpp.llmConfigs`）：保存多套命名配置（`baseUrl/apiKey/model/temperature/maxTokens/systemPrompt/timeoutMs`），一键切换 / 编辑 / 删除；apiKey 遵循 SEC-04（默认仅会话保存，显式开启持久化才落盘，持久化配置剔除 apiKey）；
  - **连通性检测**（core `llm/connectivity.ts`）：`testLlmConnection` 先 GET /models 轻量探测、失败回退最小 chat completion，返回成功/失败原因/延迟/模型，错误脱敏；
  - **LLM 请求超时 + 指数退避重试**（`openai-compat-llm.ts` timeoutMs / `llm/retry.ts`）：瞬时错误（网络/5xx/429）自动重试并尊重 Retry-After；
  - **多模型回退**（`llm/fallback.ts`）：主配置失败自动切备用配置，AI 任务不中断；
  - **任务级 LLM 参数**（`LlmRequest` 增加 `temperature/maxTokens/systemPrompt`，逐任务覆盖）；
  - **全链路接线**：`AutoAgentDrawer` / `AssistantDrawer` / `BatchDrawer` / 计划任务 `ai-auto-complete` 统一经 `bridge/llm-adapter.ts` 构造「当前生效配置 + 备用配置回退 + 重试」适配器。

### Tests
- `packages/core/test/llm-connect.spec.ts` 30 例（presets / config / connectivity / retry / fallback / openai-compat 任务级参数与超时 / factory）。
- `packages/app/test/ai-connect-drawer.component.spec.tsx` 7 例（预设快速应用 / 保存 / 编辑 / 切换 / 删除 / 测试连接提示）。
- `packages/app/test/llm-config-store.spec.ts` 8 例（多配置增删改查 / 切换 / 预设 / SEC-04 key 策略）。
- `packages/app/test/toolbar.component.spec.tsx` 新增 2 例（AI 连接中心按钮）。
- **LLM 逐段风格改写（Agent「增强」步骤正文级改写）** —— 新增 `packages/core/src/agent/paragraph-rewrite.ts`（`findProseParagraphs`/`rewriteParagraphsWithLlm`）：LLM 可用时在「增强」步骤进一步对正文散文段落做逐段润色 —— **保持标题/列表/引用/代码/表格/图片等结构字节级不动**，只改写最长的几段纯文本散文（默认每篇 ≤3 段、单段 ≥60 字、单段入参 ≤800 字）；每段独立请求（有界并发 2）、输出含块级标记时拒绝应用、单段失败回退原文；改写从下往上回写保证行区间稳定。`runAutoAgent` 新增 `rewriteParagraphs`/`maxRewriteParagraphs` 选项，`AgentEnhanceStep`/`AutoAgentResult` 新增 `paragraphRewrites`（按平台分组），verify 复检基于改写后最新内容。LLM 新增 `paragraph-rewrite` 任务类型与 prompt 模板。UI `AutoAgentDrawer` 展示每段 改前→改后 对照（随修复一并应用、可撤销）。
- **批量 AI 自动完成（FLOW-02 扩展）** —— `packages/core/src/assistant/batch.ts` 新增 `batchAutoComplete`：多草稿（当前编辑 + 已保存草稿）一键批量跑 `runAutoAgent`，有界并发、逐篇失败隔离、返回每篇修复/改写/校验汇总；「批量与审批」抽屉新增 **AI 自动完成** 模式（模式切换 + 一键批量运行 + 一键写回：当前编辑直接生效、已保存草稿落库）。store 新增 `applyBatchAutoCompleteResults`。
- **桌面端「AI 自动完成」一键入口** —— Tauri 桌面端新增**系统托盘**（左键单击托盘图标或托盘菜单「AI 自动完成」唤起主窗口并打开面板）与**全局快捷键** `Ctrl/Cmd+Shift+A`（macOS Cmd / 其它 Ctrl，任意应用内/外触发）；前端 `Ctrl/Cmd+Shift+A` 快捷键三端统一生效；`TauriBridge.onAiAgent` 订阅 `desktop://ai-agent` 事件；依赖新增 `tauri-plugin-global-shortcut`、tauri `tray-icon` feature，capabilities 放行 `tray-icon:default` / `global-shortcut:allow-*`。
- **健壮性加固** —— store `loadDrafts/loadJobs/loadScheduledTasks/loadPerformance/loadVersions` 的存储单例获取移入 try/catch：IndexedDB 不可用的受限环境（jsdom/无痕/隐私模式）不再抛未捕获异常，App 级组件测试可稳定挂载。

### Tests
- `packages/core/test/paragraph-rewrite.spec.ts` 10 例（散文段识别 / 结构保持 / 无 LLM 回退 / 块级输出拒绝 / LLM 失败回退 / 原样输出不算改写 / runAutoAgent 集成 / rewriteParagraphs=false 关闭）。
- `packages/core/test/batch-auto-complete.spec.ts` 3 例（批量 AI 全流程 / LLM 候选与逐段改写 / 空列表安全）。
- `packages/app/test/batch-drawer-ai.component.spec.tsx` 3 例（模式切换 / 一键批量运行 / 应用改写结果）。
- `packages/app/test/app-shortcut.spec.tsx` 1 例（Ctrl+Shift+A 打开 AI 自动完成抽屉）。

### Added
- **AI 自动完成 Agent（大模型自动完成分析→修复→增强→复核）** —— 新增 `packages/core/src/agent/`（`runAutoAgent` 编排 + 契约类型）：一键让大模型自动完成 ① 结构分析（字数/段落/标题/图片/各平台平均排版分）② 自动修复可修复建议（拆段/插标题/截断标题，按轮次逐轮应用且内容未变化即停）③ 为各平台生成标题/摘要候选（LLM 优先、规则兜底）④ 复检校验汇总。每步失败独立回退、LLM 不可用时纯规则全流程可用；`autoApplyOverrides` 可自动应用候选到平台覆盖层。工具栏新增「AI 自动完成」抽屉（`AutoAgentDrawer`，懒加载独立 chunk 7.7kB）：一键运行、分步报告、修复一键应用/撤销、候选点选应用到平台覆盖层。
- **计划任务新增 `ai-auto-complete` 动作（FLOW-03 扩展）** —— 本机计划任务可选择「AI 自动完成」：到点自动读取草稿 → 运行 `runAutoAgent`（分析/修复/复核）→ 修复结果写回草稿 → 返回摘要（修复 N 处;全部平台通过校验）。`SchedulerDrawer` 动作下拉新增选项，任务列表正确标注动作类型。

### Tests
- `packages/core/test/agent.spec.ts` 13 例（纯规则全流程 / autoFix 默认应用 / 轮次保护 / 空内容容错 / verify 汇总 / LLM 路径 usedLlm 与候选 / LLM 失败回退规则 / 注入时钟 / 多平台并发候选 / 未注册平台安全跳过 / 空平台列表）。
- `packages/core/test/scheduler-ai-agent.spec.ts` 2 例（ai-auto-complete 契约兼容 / 修复写回后幂等收敛）。
- `packages/app/test/auto-agent-drawer.component.spec.tsx` 6 例（标题与开始按钮 / 未配置 LLM 提示 / 配置 LLM 展示模型 / 空内容按钮禁用 / 分步报告与候选 / 修复应用与撤销）。
- `packages/app/test/toolbar.component.spec.tsx` 新增 2 例（AI 自动完成按钮触发与 aria 属性）。
- **平台产物对比视图（源文 vs 产物降级差异）** —— 新增 `packages/core/src/compare/artifact-compare.ts`（`compareArtifact`/`diffLines`/`htmlToPlainText`/`markdownToPlainText`）；预览卡新增「对比」tab：把源 Markdown 与平台序列化产物抽纯文本做行级 diff，突出截断/精简/改写/补充（外链转脚注、表格/公式转图、话题标签等），自动生成人类可读说明。
- **编辑器偏好：字数目标 + 打字机模式** —— 统计条新增「目标字数」设置（回车/失焦生效，可清除）与实时进度；「打字机」开关启用当前行高亮（光标所在行背景渐变，CSS `--typewriter-line` 变量由 JS 跟随光标更新）；偏好经 bridge `mpp.wordGoal`/`mpp.typewriterMode` 持久化。

### Tests
- `packages/core/test/versions.spec.ts` 12 例（快照创建 / LCS diff 语义 / 版本库裁剪 / 回放）。
- `packages/core/test/artifact-compare.spec.ts` 11 例（纯文本抽取 / 行级 diff / 截断识别）。
- `packages/app/test/version-history.component.spec.tsx` 4 例（空态 / 时间线 / 对比 / 回滚）。
- `packages/app/test/store-version-history.spec.ts` 6 例（存储不可用降级 / 偏好持久化）。
- `packages/app/test/editor-ux.spec.tsx` 新增 3 例（字数目标设置/清除 / 打字机开关）。

### Added
- **编辑器体验增强（Markdown 快捷工具栏 / 文档统计 / 保存状态 / 快捷键 / Toast）** —— 编辑区新增格式工具条（加粗/斜体/删除线/标题/引用/列表/代码/链接/图片/撤销，基于选区最小侵入编辑，`markdown-edit.ts` 纯函数可单测）；实时文档统计（字数/段落/图片/阅读时长 + 各平台字数上限预警，接近 90% 或超限高亮）；自动保存状态指示器（已保存/保存中/未保存/失败）；全局快捷键 `Ctrl/Cmd+S` 保存、`Ctrl/Cmd+Enter` 一键发布；轻量 Toast 全局反馈（发布/导出/导入/保存结果，3.5s 自动消失可手动关闭）。
- **编辑器/背景性能优化** —— `CoverPreview` 封面 Canvas 生成加 300ms 防抖（输入不再每键全量重绘）；`AuroraCanvas` 粒子密度按视口面积 + 设备硬件并发度自适应（低端机减半，封顶 80）；`PlatformChips` 改为 `memo` 避免无关 state 变化触发重渲染。

### Tests
- `packages/app/test/markdown-edit.spec.ts` 11 例（包裹语法 / 行首语法 / 链接图片 / 撤销）。
- `packages/app/test/editor-ux.spec.tsx` 9 例（DocStats 统计与超限预警 / SaveStatus 状态 / ToastHost 弹层与关闭）。

### Added
- **真实账号 canary 实测（路线图 §6.1/§6.3 门禁 4）** —— 新增 `scripts/canary.mjs` + `npm run canary`（fixture 模式）/ `npm run canary:real`（真实账号模式）/ `npm run canary:check`（前置校验）；fixture 模式在本地 HTTP 页面上验证七平台四段式链路与成功证据判定，产出 `dist/canary/canary-report-*.json`；新增 `docs/CANARY.md`（canary 验收清单、SLO 对照、记录格式）。
- **升级/回滚演练（路线图 §6.3 门禁 4）** —— 新增 `scripts/upgrade-rollback-drill.mjs` + `npm run drill:upgrade-rollback`：备份 → 迁移 → 校验 → 回滚 → 恢复 全链路演练，演练数据写入 `dist/upgrade-drill/`，不触碰真实业务数据；`SUPPORT_MATRIX §6` 增补演练说明。
- **第七平台试点：博客园（SDK-04）** —— core 适配器（原生 Markdown，标题 ≤200 / 标签 ≤5 / 分类+标签）、runner `CnblogsAutomationAdapter`（`i.cnblogs.com/posts/edit`）、core `platform-api` 会话式 provider（cnblogsSessionProvider）、扩展 `host_permissions`/content script 覆盖 `i.cnblogs.com`、demo 产出 `cnblogs.md`；conformance kit 七平台全通过；浏览器 fixture 扩到 7 平台（42 例）。
- **发布效果智能分析（DATA-04）** —— 新增 `packages/core/src/analytics/insights.ts` `analyzePerformance`：按日阅读趋势（`buildDailyTrend`）、近期 vs 上一周期增长率（`computeGrowth`）、跨平台综合得分排序（`rankPlatforms`）、最佳发布时段（`bestPostingHour`）、最佳单篇（`bestPerformingPost`）；产出可执行行动建议与带严重度的洞察条目；UI「发布效果回收」抽屉新增智能分析区块（趋势柱状图 + 洞察 + 行动建议，全部 Lucide 图标）；`performanceInsights()` 接入 store。

### Added
- **runner 分步耗时观测（路线图 §6.2）** —— 新增 `packages/runner/src/diagnostics/step-timer.ts` `StepTimer`（支持注入时钟便于测试），接入 `defaultPublisher` 全流程：`open-session / goto-editor / prepare / confirm / submit / verify` 每步计时；发布回执与诊断工件均携带 `timing{totalMs,samples}`；内置步骤预算（如 goto-editor 15s、submit 10s），超预算步骤标记 `exceeded`，可驱动 timeout 调整而非盲目放大。
- **runner 本地 HTTP fixture（路线图 §6.2）** —— 新增 `packages/runner/test/fixture-server.ts`：平台编辑器 fixture 从 `page.setContent` 升级为真实 HTTP 服务（127.0.0.1 随机端口），真正发生导航、可注入 CSP 响应头、用内联脚本模拟异步渲染/页面生命周期；覆盖五平台导航+提交+核验、CSP 受限页不谎报 published（诚实返回 unknown）、no-draft/unknown 变体、异步渲染等待共 11 个新用例。

### Tests
- `packages/runner/test/step-timer.spec.ts` 6 例（分步记录 / 超预算标记 / 预算表判定慢步骤 / 文本输出 / 空汇总 / 步骤枚举）。
- `packages/runner/test/types.spec.ts` 新增 2 例（回执携带 timing 合法 / 畸形 timing 拒绝）。
- `packages/runner/test/platform-fixtures.spec.ts` 新增 §6.2 本地 HTTP fixture 11 例。全量 **601 passed / 79 文件**（较上一轮 +8）。

### Added
- **Awwwards 级沉浸式 UI（「折射光谱」视觉系统）** —— 深空画布 + 极光紫/青/粉/琥珀四重光谱渐变、玻璃拟态卡片 + 渐变描边、全局 SVG 噪点质感、Space Grotesk/Inter/JetBrains Mono 展示字体；新增 `AuroraCanvas`（Canvas 实时极光粒子星网，鼠标斥力扰动，尊重 `prefers-reduced-motion`）、`CursorGlow`（rAF 缓动全局辉光）、`IntroOverlay`（首屏光谱巨标题开场，支持点击 / 键盘 Esc/Enter/空格 / 减弱动效自动跳过）；全界面统一 Lucide 图标，无表情符号。
- **六平台品牌对齐** —— 平台预览卡 / 内容助手 / 模板 / 批处理 / 健康面板为掘金（Code2）、CSDN（Terminal）补齐 Lucide 图标与品牌色；界面文案统一为「多平台」；扩展 `host_permissions` / content script 覆盖 `juejin.cn` 与 `editor.csdn.net`（选择器外置支持字节跳动编辑器 / CodeMirror / CSDN 编辑器）。
- **桌面端字体修复** —— Tauri CSP 放行 `fonts.googleapis.com` 与 `fonts.gstatic.com`，修复 WebView 中展示字体静默回退。
- **计划任务新增「同步公众号官方指标」动作** —— `ScheduledAction` 新增 `metrics-sync` 类型：到点自动调 `syncPerformanceFromApi`（server 转发 datacube），无 remoteId 时明确提示；表单在指标同步动作下隐藏草稿/平台选择，无需关联草稿即可创建。

### Tests
- `packages/app/test/ui-immersive.spec.tsx` 9 例（六平台图标映射 / 未知回退 / 开场动画交互 / 键盘跳过 / reduced-motion 跳过 / 极光画布 / 光标辉光）。
- `packages/app/test/selectors.spec.ts` 增加掘金/CSDN 已接入断言。
- `packages/app/test/scheduler-drawer.component.spec.tsx` 新增指标同步动作用例（隐藏草稿选择 / 无草稿创建）。

- **平台 API 契约层（core `platform-api/`）** —— 统一「一键连接 / 一键解析 / 真实发布」的平台接口描述：`PlatformApiDescriptor`（凭据字段 / 端点清单 / 能力集）、`PlatformApiProvider`（`checkConnection` / `publish`）、`PlatformHttpClient`（网络注入）。注册表含六平台：公众号（官方 API，`stable_token → user/get`）、知乎/B站/小红书/掘金（会话式，runner 浏览器登录态）、CSDN（官方接口，Cookie）。
- **一键连接与一键解析** —— 公众号连接检查返回账号/粉丝数；会话平台打开浏览器登录态编辑器检测登录/风控并解析账号；CSDN 调官方 `/myself/info` 解析账号。每个平台暴露端点清单 `{method,urlTemplate,description}` 供 UI 展示；密钥类字段只在内存，绝不落盘/提交。
- **server / runner 平台连接路由** —— `POST /platform-api/connect`（强制 X-MPP-Token）：`wechat` 走 server（官方 API），`zhihu/bilibili/xiaohongshu/juejin/csdn` 走 runner（浏览器/官方接口）；server 新增 `/platform-api/status` 配置摘要。
- **app 平台一键连接抽屉** —— 工具栏新增「平台一键连接」（`PlatformConnectDrawer`，懒加载）：展示各平台能力/凭据/端点，一键连接并展示账号结果与连接地址/鉴权状态。
- **CSDN 第六平台（SDK-03）** —— core 适配器（原生 Markdown，标题 ≤200 / 标签 ≤5 / 分类+标签）、runner `CsdnAutomationAdapter`（编辑器 `editor.csdn.net/md/`）、`parseCsdnAccountInfo`、demo 产出 `csdn.md`；conformance kit 六平台全通过。

### Tests
- `packages/core/test/platform-api.spec.ts` 16 例（注册表 / 公众号一键连接 / 错误分类 / 真实发布 / 会话 provider / CSDN 解析 / 解析工具）。
- `packages/runner/test/platform-api.spec.ts` 7 例（connect 路由 / CSDN Cookie 解析 / 鉴权）。
- `packages/server/test/platform-api.spec.ts` 5 例（公众号连接 / 未配置凭据 / 不泄漏密钥 / 鉴权 / status）。
- `packages/app/test/platform-connect.spec.ts` 4 例（路由规则 / token / 错误）+ `platform-connect-drawer.component.spec.tsx` 6 例（平台列表 / 凭据字段 / 连接交互 / 结果展示）。
- core 适配器/runner 选择器契约/漂移 conformance 用例更新为六平台。

## [0.2.0-beta] - 2026-08

### Added
- **server 任务持久化与重启恢复（FileJobStore 接入 server）** —— `packages/server/src/jobs/`：`ServerJobService` 组合 `FileJobStore` + `PublishJobService` + `WechatJobExecutor`，公众号真实发布任务落盘 `data/jobs/publish-jobs.json`（原子写 + 版本化 + 损坏检测），进程重启后可从 checkpoint 续跑。
- **server 任务 REST API** —— `GET /jobs`（元信息列表，不含正文）、`POST /jobs`（创建并运行）、`POST /jobs/:id/resume|cancel|retry`；未配置公众号凭据时禁止创建但可查历史；/jobs/* 强制 capability token 鉴权。
- **core payload 随任务持久化** —— `PublishJobService` 在 `prepare` 后把平台产物写入 `PlatformJob.payload`，`submit/verify` 从任务读取；新增 `getPlatformPayload` / `updatePlatformPayload`；重启后即使执行器闭包丢失也能重建发布上下文。
- **服务器任务面板（app）** —— 工具栏新增「服务器任务」入口（`ServerJobsPanel`，懒加载）：列出 server 持久化任务、恢复/取消/重试；`PlatformBridge` 新增 `listServerJobs` / `resumeServerJob` / `cancelServerJob` / `retryServerJob`（web/扩展/桌面共用 `bridge/server-jobs.ts`）。

### Tests
- `packages/server/test/jobs.spec.ts`：7 例（创建落盘/列表摘要/鉴权 401/未配置禁止创建/schema 拒绝/重启恢复/取消）；`job-restart-recovery.spec.ts` 新增 2 例（payload 持久化恢复、updatePlatformPayload 预写）；`server-jobs-panel.component.spec.tsx` 5 例；`server-jobs.spec.ts` 6 例。

## [0.2.0-beta] - 2026-08

### Added
- **Phase 2 退出条件补齐：故障注入套件** —— `packages/core/src/jobs/fault-injection.ts` `FaultInjectionExecutor`：在可信 `PlatformExecutor` 上叠加可编程故障 —— 上传第 N 张失败（`upload-fail-at`）、平台超时（`stage-timeout`）、提交后断网（`submit-then-network-drop`）、尝试次数门槛（`attempts`）、一次性/永久注入（`repeat`）；`fault-injection.spec.ts` 6 例。
- **Phase 2 退出条件补齐：进程重启恢复** —— `packages/core/src/jobs/file-store.ts` `FileJobStore`：版本化 JSON + 原子写（tmp + rename）+ 损坏检测（`CorruptJobStoreError`/`fallbackOnCorrupt`）+ 保留策略（终态 TTL + 条数上限）；重建 service + 执行器后从 checkpoint 续跑，不重复已成功资产/平台；`job-restart-recovery.spec.ts` 5 例（submit 后崩溃重启续跑 / 已成功 checkpoint / 损坏恢复 / 原子写往返 / 保留清理）。
- **夜间门禁（路线图 §6.3 门禁顺序 3）** —— `scripts/nightly-gate.mjs` + `.github/workflows/nightly.yml`（每天 UTC 02:17 跑 main，支持手动触发）：性能重复样本 3 次（preview 预算 + bundle 门禁）、安全回归（server SSRF/鉴权/净化）、故障注入 + 进程重启恢复；Node 20。
- **发布就绪（RELEASE-01）**：版本统一升级 `0.2.0-beta`（根/各 workspace/tauri/Cargo/manifest）；新增 `scripts/release-gate.mjs` 发布门禁（版本一致性 + CHANGELOG 条目 + canary 清单 + 安装包 SHA256SUMS），`npm run release:gate` / `npm run release:sums`。
- **SDK-02 第五平台试点：掘金**（`packages/core/src/adapters/juejin/`）—— 原生 Markdown 适配器（标题 ≤64 / 标签 ≤3 / 公式·代码·表格原生保留），`text/markdown` MIME 全链路接入（校验/预览/批处理/复制注入）；runner 新增 `JuejinAutomationAdapter`（编辑器 `juejin.cn/editor/drafts/new`，网页 draft/full-auto）；demo 产出 `juejin.md`。
- **桌面端计划任务定时器**：`useEffect` 接线 `setInterval` 心跳（默认 60s），定时执行 `runDue` 到期任务并刷新面板状态；只在应用可见/前台时 tick，避免后台空转。

### Changed
- **Phase 4 收尾（Beta 产品化）**
  - TEST-03：app 组件与交互测试 —— TaskPanel / SettingsDrawer / DraftsDrawer / PlatformPreview / Toolbar / ServiceStatusPanel，jsdom 下 42 例（交互、错误态、a11y：aria-pressed / haspopup / roving tabindex）。
  - TEST-04：浏览器实测不 skip —— runner fixture 15 例 + Web App 冒烟 E2E 6 例在真实 Chromium 下执行；CI 增加 `scripts/check-browser-fixture.mjs` 前置检查（Chromium 缺失/用例数 <7 即失败）。
  - DATA-01：数据导入导出（草稿 / 发布历史 / 关键设置，带 schema 版本）；UX-01：服务依赖状态面板；PLAT-01：选择器版本化契约。
  - REPO-03：研究资料移入 `docs/research/`。
  - RELEASE-01：`docs/SUPPORT_MATRIX.md` 支持矩阵（运行环境 / 构建产物 / 平台能力 / canary 账号 / 升级回滚 / 安装包哈希）。
- **桌面端整合（Tauri 2 + xterm.js）**：桌面端获得与 Web 一致的完整核心能力；内置 xterm 终端可启动本地 server / runner；浏览器启动优化（`TAURI_ENV_*` 检测关闭自动弹浏览器）。
- **性能优化**：主 JS 拆包（xterm / tauri API 独立 chunk 且懒加载），主入口 ~44 kB（gzip ~15 kB），全部 chunk < 500 kB；manualChunks 包边界精确匹配修复 chunk 循环警告。

### Fixed
- vite `manualChunks` 两个 chunk 循环隐患：`"react"` 子串误匹配 `react-remove-scroll`（导致 React 初始化失败）、`"/core/"` 子串误匹配 `@floating-ui/core`（导致 vendor↔mpp-core 循环）。

### Added
- **Phase 5 第二轮：本机计划任务（FLOW-03）与效果回收（DATA-02/03）**
  - `scheduler/`：`ScheduledTask` 契约 + cron 子集表达式（`dailyAt`/`weeklyAt`/`hourly`/自定义 `{minute,hour,dayOfWeek}` + `isValidCron`/`matchesCron`）；`ScheduledTaskService`（create/update/pause/resume/remove、`dueTasks`/`runDue`/`trigger`、防重复触发窗口、每次执行记录 succeeded/failed/skipped、运行记录裁剪）。
  - `analytics/`：`PerformanceRecord` 契约 + 版本化存储；CSV 解析/导入（坏行跳过收集错误、按 `remoteId` 去重更新）、手工录入、按平台汇总；`MetricsProvider` 接口 + 注册表、`MockMetricsProvider`、`WechatOfficialApiMetricsProvider`（server 转发）、`syncMetricsFromProviders` 并发受控同步。
  - app 存储：`schedule-store.ts` / `performance-store.ts`（IndexedDB / chrome.storage 双实现，schema v3 迁移）。
  - UI：工具栏新增「本机计划任务」「发布效果回收」两个懒加载抽屉；计划任务面板（创建/立即执行/暂停/恢复/删除/运行记录），效果回收面板（CSV 导入/手工录入/汇总/官方 API 同步）。
  - TEST：core 新增 `scheduler.spec.ts`（9 例）与 `analytics.spec.ts`（11 例）。全量 **479 passed / 1 skipped**，覆盖率保持门槛以上。

### Added
- **Phase 5 内容助手与平台生态（AI-01/02/03 · FLOW-01/02/04 · PLAT-02 · SDK-01）**
  - `assistant/suggestions.ts`：结构化质量建议（排版/校验 → 定位段落/标题 + 原文摘录 + 一键修复动作 + 撤销）；`factCheckDocument` 事实/引用检查（只标记缺证据内容，不伪造引用）。
  - `assistant/variants.ts`：标题/摘要多方案对比 —— LLM 多候选（JSON/逐行解析）+ 规则回退 + 原文保底，候选标注来源/模型/提示版本，用户选择后应用（不自动覆盖）。
  - `assistant/templates.ts`：版本化平台模板（影响面 touches 派生，升级不破坏旧草稿引用，内存模板库 + 合并应用）。
  - `assistant/batch.ts`：多草稿批量校验/生成产物（默认不真实发布）+ 发布前审批清单（full-auto 逐平台确认内容摘要，未确认/校验未通过不可 proceed）。
  - `assistant/drift.ts`：能力漂移探测（limits/flags/编辑器版本，只告警不自动改规则）+ Adapter conformance kit（能力声明/方法/serialize 契约自检）。
  - UI：工具栏新增「内容助手 / 平台模板 / 批量与审批 / 平台健康」四个抽屉（React.lazy 懒加载拆包），全部接入 @mpp/core 新模块。
  - TEST：新增 `assistant.spec` / `assistant-batch.spec` / `assistant-edge.spec` / `assistant-edge2.spec` / `variants.spec`（含 LLM 路径与规则回退）。
  - 覆盖率：assistant 模块行 89% / 分支 76.56%，全局行 92.64% / 分支 84.63%。

### Added
- **Phase 4 收尾（Beta 产品化）**
  - TEST-03：app 组件与交互测试 —— TaskPanel / SettingsDrawer / DraftsDrawer / PlatformPreview / Toolbar / ServiceStatusPanel，jsdom 下 42 例（交互、错误态、a11y：aria-pressed / haspopup / roving tabindex）。
  - TEST-04：浏览器实测不 skip —— runner fixture 15 例 + Web App 冒烟 E2E 6 例在真实 Chromium 下执行；CI 增加 `scripts/check-browser-fixture.mjs` 前置检查（Chromium 缺失/用例数 <7 即失败）。
  - RELEASE-01：`docs/SUPPORT_MATRIX.md` —— 运行环境 / 构建产物 / 平台能力 / canary 账号 / 升级回滚 / 安装包哈希与发布门禁清单。
  - REPO-03：研究资料移入 `docs/research/`（论文文稿、PDF 截图、历史规划），根目录不再混入无关文件。
- **构建修复**
  - 修复 vite `manualChunks` 两个 chunk 循环隐患：`"react"` 子串误匹配 `react-remove-scroll` 等 radix 依赖（导致 React 初始化失败）、`"/core/"` 子串误匹配 `@floating-ui/core`（导致 vendor↔mpp-core 循环警告）。
- **桌面端整合（Tauri 2 + xterm.js）**
  - UX-01：服务依赖状态面板 —— 设置抽屉内展示 server / runner 在线状态、配置摘要与可执行提示（健康检查经 `/health`，不暴露敏感信息）。
  - DATA-01：数据导入导出 —— 草稿 / 发布历史 / 关键设置可导出为带 schema 版本的 JSON 文件，并支持无损导入合并（版本不兼容给出明确提示）。
  - PLAT-01：选择器版本化与契约 —— 各平台自动化适配器声明 `YYYY-MM` 选择器版本，加载期校验五类字段完整性与首选契约选择器，平台改版便于定位漂移。
  - TEST：新增 `service-status.spec.ts`（9 例）、`data-transfer.spec.ts`（5 例）、`selectors-contract.spec.ts`（9 例）。
- **桌面端整合（Tauri 2 + xterm.js）**
  - 将 Phase 1–3（安全 / 幂等 / 可恢复任务 / 可信回执 / 性能原语）合入桌面端分支，桌面端获得与 Web 一致的完整核心能力。
  - 桌面端与 Web/扩展共存：`TAURI_ENV_*` 检测关闭浏览器自动弹出，内置 xterm.js 终端可启动本地 server / runner。
- **性能优化**
  - 主 JS 拆包：xterm / tauri API 独立 chunk 且懒加载，主入口 ~44 kB（gzip ~15 kB），全部 chunk < 500 kB。

## [0.2.0-alpha.2] - 2026-08

### Added
- JOB-01：`PublishJob` 状态机契约与守卫（合法/非法迁移、`unknown` 禁止自动重试）。
- JOB-02：版本化本地任务存储（IndexedDB / chrome.storage），schema v2 迁移、终态 TTL 30 天 + 最多 100 条。
- JOB-03：任务编排、checkpoint、按平台重试与取消（AbortSignal 贯穿）。
- RUN-01/RUN-02：runner `prepare → confirm → submit → verify` 四段式；`full-auto` 二次确认绑定内容摘要；`submitted/unknown` 状态语义。
- OBS-01：诊断工件（脱敏 request/receipt + 截图 + DOM）与自动清理。
- UI-01：发布任务面板（阶段/耗时/重试/取消/人工处理/诊断入口）。

## [0.2.0-alpha.1] - 2026-08

### Added
- SEC-01：server/runner capability token 鉴权、常量时间比较、日志脱敏。
- SEC-02：`SecureImageFetcher` —— 实际连接 DNS 逐跳校验（防 DNS rebinding）、重定向重校验、超时、流式字节上限、图片 MIME 白名单（拒绝 SVG）。
- SEC-03：路由 JSON Schema、body limit、统一错误 envelope。
- SEC-04：LLM key 默认仅会话保存，持久化需显式选择并提供一键清除。
- SEC-05：本地图床配额 / 保留 / 安全清理。
- REL-01/02：单例 `WechatPublisher` + 幂等缓存 + 并发 in-flight 合并 + SHA-256 摘要。
- REL-03：`publishAll` try/finally 错误复位。
- TEST-01：路由层集成套件。

## [0.2.0-beta.1] - 2026-08

### Added
- PERF-01：`PreviewPipeline` 分层缓存（parse/preprocess/serialize/validate/quality）。
- PERF-02：预览 Web Worker + 序号过滤 + 250ms 防抖，主线程长任务 <50ms。
- PERF-03：`AdaptiveConcurrency` 接入上传（429 / Retry-After / 抖动退避）。
- PERF-04：内容哈希上传缓存（LRU + TTL + 容量上限）。
- PERF-05：Web 拆包（动态导入 + manualChunks），主 JS 从 1.12 MB → 555 KB。
- TEST-02：预览 / bundle / 图片发布的性能预算门禁。

## [0.1.0] - 2026-08

### Added
- 多平台内容发布工具：一份 Markdown 自动适配公众号 / 知乎 / B站 / 小红书。
- IR 中间表示、能力声明式适配器、四平台序列化、校验与排版评分。
- 图片重托管（受控并发、同源去重）、LLM 增强、草稿/历史持久化。
- Web / MV3 扩展双构建；Playwright 自动化 runner（实验性）。
