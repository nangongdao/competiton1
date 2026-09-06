#!/usr/bin/env node
/**
 * AI 智能增强(Part2)零密钥闭环演示:
 * 一键裂变 / 跨平台本土化 / 视觉与多媒体 AI / 评论营销 / 合规审查 / 收件箱聚合 / 账号分组矩阵。
 *
 * 全部为规则版(确定性、离线可用),无需任何 API Key。
 * 运行:node scripts/demo-ai-enhance.mjs
 */
import {
  fissionLongContent,
  expandShortContent,
  generateRewriteVariants,
  localizeContentRule,
  suggestHashtagsRule,
  suggestCoversRule,
  adaptVideoRule,
  buildAnchorStoryboardRule,
  analyzeCommentRule,
  digestNegativeComments,
  scanCompliance,
  createInboxMessage,
  queryInbox,
  groupByThread,
  summarizeInbox,
  createAccountGroup,
  buildGroupSnapshot,
  registerDemoInboxSyncAdapters,
  syncInboxFromPlatform,
  getInboxSyncAdapter,
  MemoryInboxStore,
  planAutoReplies,
  sendAutoReplies,
  applyAutoReplyResult,
  sortInboxByOrder,
  reorderInboxMessages,
  togglePinned,
  buildPinnedFollowUpDigest,
  resolveAutoReplyPolicy,
  AUTO_REPLY_STRATEGIES,
} from "@mpp/core";

const SAMPLE_TITLE = "如何用 AI 提升内容团队 10 倍产出效率";
const SAMPLE_MD = `# 如何用 AI 提升内容团队 10 倍产出效率

## 为什么内容团队需要 AI
传统内容生产链路长、重复劳动多。AI 可以把「选题 → 写作 → 分发 → 复盘」整条链路提速。

## 三个核心方法
第一,用 AI 做选题与大纲,让创意快速落地;
第二,用 AI 做多平台改写,一份素材拆成多版本;
第三,用 AI 做发布后复盘,数据驱动持续优化。

## 踩过的坑
不要盲目追求「最好」的工具,先跑通流程再优化细节。数据能证明一切。

## 总结
AI 不是替代人,而是放大人的效率。关键在于把流程标准化。`;

function divider(title) {
  console.log(`\n${"=".repeat(64)}\n# ${title}\n${"=".repeat(64)}`);
}

divider("1. 一键裂变:长内容 → 小红书/微博/抖音");
const fission = fissionLongContent(SAMPLE_TITLE, SAMPLE_MD, undefined, { useLlm: false });
for (const p of fission.pieces) {
  console.log(`\n[${p.label}] (${p.usedLlm ? "LLM" : "规则"})`);
  console.log(p.text.slice(0, 120) + (p.text.length > 120 ? "…" : ""));
  console.log(`  标签: ${p.tags.join(", ")}`);
}

divider("2. 短内容长文扩写");
const expanded = expandShortContent("AI 正在改变内容创作的方式", { genre: "blog" });
console.log(`标题: ${expanded.title}`);
console.log(`摘要: ${expanded.summary}`);
console.log(`大纲:\n${expanded.outline}`);
console.log(`引言: ${expanded.intro.slice(0, 80)}…`);

divider("3. 内容矩阵多版本改写(防重)");
const variants = await generateRewriteVariants(SAMPLE_MD, undefined, { count: 3, useLlm: false });
for (const v of variants.variants) {
  console.log(`\n[版本${v.index}] 相似度=${v.similarityToSource}`);
  console.log(v.text.slice(0, 100) + "…");
}

divider("4. 跨平台本土化");
for (const target of ["xiaohongshu", "zhihu", "linkedin"]) {
  const r = localizeContentRule(SAMPLE_TITLE, SAMPLE_MD, target, { useLlm: false });
  console.log(`\n[${r.label}] (${r.usedLlm ? "LLM" : "规则"})`);
  console.log(r.text.slice(0, 100) + "…");
  console.log(`  风格说明: ${r.styleNotes.join("; ")}`);
}

divider("5. AI 智能标签与话题");
const tags = suggestHashtagsRule(SAMPLE_TITLE, SAMPLE_MD);
console.log(tags.map((t) => `${t.tag}(${t.heat})`).join(" "));

divider("6. 视觉与多媒体 AI(封面/视频/数字人)");
for (const c of suggestCoversRule(SAMPLE_TITLE, SAMPLE_MD, ["xiaohongshu", "wechat", "video"])) {
  console.log(`[${c.platformId} ${c.ratio}] ${c.headline} — ${c.style}`);
}
const video = adaptVideoRule("landscape", 300, "douyin");
console.log(`\n横屏→竖屏:${video.resolution},拆 ${video.splitCount} 段,字幕:${video.subtitlePosition}`);
console.log(`  裁切策略:${video.cropStrategy}`);
const anchor = buildAnchorStoryboardRule(SAMPLE_TITLE, SAMPLE_MD);
console.log(`\n数字人播报(${anchor.durationSeconds}s):`);
console.log(anchor.script.slice(0, 120) + "…");

divider("7. AI 智能客服与评论营销");
const comments = [
  "这个工具多少钱?",
  "怎么买?求链接",
  "太棒了,学到了!",
  "垃圾,根本没用",
  "我要退款!你们是骗子!",
];
for (const c of comments) {
  const insight = analyzeCommentRule(c);
  console.log(
    `「${c}」 → 意图=${insight.intent} 情绪=${insight.sentiment} 高意向=${insight.highIntent} 动作=${insight.suggestedAction}${insight.autoReply ? `\n    自动回复: ${insight.autoReply}` : ""}`,
  );
}
const digest = digestNegativeComments(comments);
console.log(`\n负面预警: ${digest.total} 条 → ${digest.alerts.map((a) => a.action).join(" / ")}`);

divider("8. 合规与安全审查");
const report = scanCompliance(SAMPLE_TITLE, SAMPLE_MD);
console.log(`结论: ${report.verdict} (blocked=${report.blocked}, 共 ${report.issues.length} 条)`);
for (const i of report.issues.slice(0, 5)) {
  console.log(`  [${i.severity}] ${i.kind}: ${i.match} — ${i.message}${i.suggestion ? ` → ${i.suggestion}` : ""}`);
}

divider("9. 统一收件箱(互动与私信聚合)");
const msgs = [
  createInboxMessage({ platformId: "xiaohongshu", remoteId: "x1", author: "小红用户", text: "这个多少钱?", kind: "comment" }),
  createInboxMessage({ platformId: "wechat", remoteId: "w1", author: "微信用户", text: "求购买链接", kind: "direct-message" }),
  createInboxMessage({ platformId: "zhihu", remoteId: "z1", author: "知乎用户", text: "写得不错,学到了", kind: "comment" }),
  createInboxMessage({ platformId: "bilibili", remoteId: "b1", author: "B站用户", text: "垃圾,骗人的", kind: "comment" }),
];
const q = queryInbox(msgs, { pendingOnly: true });
console.log(`待回复 ${q.total} 条,未读 ${q.unread} 条`);
const threads = groupByThread(msgs);
for (const t of threads) {
  console.log(`  [${t.platformId}] ${t.author} ×${t.messageCount}${t.unreadCount ? ` (未读${t.unreadCount})` : ""}`);
}
const stats = summarizeInbox(msgs);
console.log(`\n汇总: 总${stats.total} 未读${stats.unread} 待回复${stats.pendingReply} 负面${stats.negative}`);

divider("9b. 真实平台消息同步(INBOX-03,演示适配器闭环)");
registerDemoInboxSyncAdapters();
const syncStore = new MemoryInboxStore();
for (const pid of ["wechat", "xiaohongshu", "zhihu"]) {
  const r = await syncInboxFromPlatform(syncStore, getInboxSyncAdapter(pid), { platformId: pid });
  console.log(`  [${pid}] ${r.ok ? `新增 ${r.added} 条,游标 ${r.cursor}` : `失败: ${r.error}`}`);
}
console.log(`  同步后收件箱共 ${(await syncStore.list()).length} 条(增量去重,可重复同步不重复入库)`);

divider("9c. AI 自动回复真实回发(INBOX-04,规则版回发适配器闭环)");
// 模拟平台回发适配器(真实环境由 runner/server 注入)。
const mockReplyAdapter = {
  platformId: "demo",
  async reply(req) {
    console.log(`  ↳ 已回发[${req.platformId}] -> ${req.message.author}: ${req.text}`);
    return { ok: true, remoteReplyId: `reply-${req.message.id}` };
  },
};
const autoMessages = [
  createInboxMessage({ platformId: "xiaohongshu", remoteId: "x9", author: "问价用户", text: "这个多少钱?", kind: "comment" }),
  createInboxMessage({ platformId: "wechat", remoteId: "w9", author: "求购用户", text: "怎么买?求链接", kind: "direct-message" }),
  createInboxMessage({ platformId: "zhihu", remoteId: "z9", author: "好评用户", text: "太棒了,学到了!", kind: "comment" }),
  createInboxMessage({ platformId: "bilibili", remoteId: "b9", author: "负面用户", text: "垃圾,我要退款!", kind: "comment" }),
];
const decisions = planAutoReplies(autoMessages);
for (const d of decisions) {
  console.log(`  「${d.message.text}」→ 应回复=${d.shouldReply}${d.text ? ` 文案:${d.text}` : ""}${d.reason ? ` (${d.reason})` : ""}`);
}
console.log(`
  策略:计划回复 ${decisions.length} 条(高意向/好评自动,负面转人工)`);
const summary = await sendAutoReplies(autoMessages, mockReplyAdapter);
console.log(`  回发结果: 计划 ${summary.planned} 条,已回发 ${summary.sent} 条,失败 ${summary.failed.length} 条`);
const landed = autoMessages.map((m) => applyAutoReplyResult(m, m.text.includes("多少钱") ? "谢谢关注!价格信息已私信给您~" : "感谢支持!"));
console.log(`  本地落地: 已回发消息 handling=${landed[0].handling} status=${landed[0].status}(幂等,不再重复回发)`);

divider("9d. 收件箱拖动排序(INBOX-05)");
const dragStore = new MemoryInboxStore();
for (const pid of ["wechat", "xiaohongshu", "zhihu"]) {
  await syncInboxFromPlatform(dragStore, getInboxSyncAdapter(pid), { platformId: pid });
}
let dragMsgs = await dragStore.list();
console.log(`  排序前(时间倒序): ${dragMsgs.map((m) => m.author).slice(0, 4).join(" / ")}`);
const ordered = [...dragMsgs].slice().reverse(); // 演示反转为「时间正序」
const reordered = reorderInboxMessages(dragMsgs, ordered.map((m) => m.id));
for (const m of reordered) await dragStore.put(m);
dragMsgs = sortInboxByOrder(await dragStore.list());
console.log(`  拖动重排后: ${dragMsgs.map((m) => m.author).slice(0, 4).join(" / ")} (sortOrder 已落盘)`);

divider("9f. 更多定时回复策略(INBOX-06:预设/模板/去重/时效窗口)");
console.log("  策略预设:");
for (const [k, v] of Object.entries(AUTO_REPLY_STRATEGIES)) {
  const p = resolveAutoReplyPolicy({ strategy: k });
  console.log(`    ${v.label}(${k}): ${v.note} | replyQuestion=${p.replyQuestion} skipNegative=${p.skipNegative}`);
}
const strategyMessages = [
  createInboxMessage({ platformId: "zhihu", remoteId: "s1", author: "提问用户", text: "这个功能是怎么实现的?", kind: "comment" }),
  createInboxMessage({ platformId: "zhihu", remoteId: "s2", author: "提问用户", text: "怎么开始使用?", kind: "comment" }),
  createInboxMessage({ platformId: "weibo", remoteId: "s3", author: "问价用户", text: "这个多少钱?", kind: "comment" }),
  createInboxMessage({ platformId: "weibo", remoteId: "s4", author: "老评论", text: "多少钱?(12h前)", kind: "comment", receivedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() }),
];
const balanced = planAutoReplies(strategyMessages, { strategy: "balanced", dedupeByAuthor: true, dailyPerAuthorCap: 1, recencyWindowMs: 2 * 60 * 60 * 1000 });
console.log(`  均衡策略 + 同作者去重 + 2h时效: 计划回复 ${balanced.length} 条`);
for (const d of balanced) {
  console.log(`    「${d.message.text}」(${d.message.author}) → ${d.shouldReply ? `回复:${d.text}` : d.reason}`);
}
const templated = planAutoReplies(
  [createInboxMessage({ platformId: "wechat", remoteId: "t1", author: "用户", text: "多少钱?", kind: "comment" })],
  { template: { priceInquiry: "价格已私信您,欢迎进一步沟通(自定义模板)~" } },
);
console.log(`  自定义模板: ${templated[0].text}`);

divider("9e. 评论置顶后自动跟进提醒(INBOX-07)");
const followMsgs = dragMsgs.slice(0, 2).map((m) => togglePinned(m, () => new Date(Date.now() - 45 * 60 * 1000).toISOString()));
const pinDigest = buildPinnedFollowUpDigest(followMsgs, { graceMs: 30 * 60 * 1000 });
console.log(`  置顶 ${pinDigest.pinnedTotal} 条,超阈值未回复 ${pinDigest.items.filter((i) => i.overdue).length} 条`);
console.log(`  提醒标题: ${pinDigest.notifyTitle}`);
console.log(`  提醒正文: ${pinDigest.notifyBody}`);
console.log(`  摘要: ${pinDigest.summary}`);

divider("10. 账号矩阵分组管理");
const grp = createAccountGroup({ name: "品牌 A 内容矩阵", memberIds: ["acct-1", "acct-2"] });
const snapshot = buildGroupSnapshot(
  grp,
  [
    { id: "acct-1", platformId: "xiaohongshu", name: "小红书主号", status: "enabled", secrets: {}, persistSecrets: false, createdAt: "", updatedAt: "" },
    { id: "acct-2", platformId: "wechat", name: "公众号主号", status: "enabled", secrets: {}, persistSecrets: false, createdAt: "", updatedAt: "" },
  ],
  [
    { id: "p1", platformId: "xiaohongshu", title: "爆款", publishedAt: "", collectedAt: "", metrics: { views: 1000, likes: 120 }, source: "manual" },
    { id: "p2", platformId: "wechat", title: "深度", publishedAt: "", collectedAt: "", metrics: { views: 500, likes: 30 }, source: "manual" },
  ],
);
console.log(`分组「${snapshot.group.name}」: 成员 ${snapshot.memberCount}(启用 ${snapshot.enabledCount})`);
console.log(`  总阅读 ${snapshot.performance.totalViews}, 总点赞 ${snapshot.performance.totalLikes}, 最佳平台 ${snapshot.performance.bestPlatform}`);

console.log("\n✅ AI 智能增强零密钥闭环演示完成(全部为规则版,离线可用)。");
