/**
 * v11 INBOX-06 更多定时回复策略 —— 策略预设/模板/去重/时效窗口纯函数测试。
 */
import { describe, expect, it } from "vitest";
import { createInboxMessage, type InboxMessage } from "../src/inbox/types.js";
import {
  decideAutoReply,
  planAutoReplies,
  resolveAutoReplyPolicy,
  AUTO_REPLY_STRATEGIES,
} from "../src/inbox/reply.js";

const NOW = () => "2026-08-08T12:00:00.000Z";

function msg(
  overrides: Partial<Parameters<typeof createInboxMessage>[0]> = {},
  receivedAt = "2026-08-08T11:30:00.000Z",
): InboxMessage {
  return createInboxMessage(
    {
      platformId: "wechat",
      remoteId: `w-${Math.random().toString(36).slice(2, 8)}`,
      author: "用户A",
      text: "这个多少钱?",
      receivedAt,
      ...overrides,
    },
    NOW,
  );
}

describe("inbox/reply — INBOX-06 策略预设", () => {
  it("AUTO_REPLY_STRATEGIES 覆盖三档预设", () => {
    expect(Object.keys(AUTO_REPLY_STRATEGIES).sort()).toEqual([
      "balanced",
      "conservative",
      "proactive",
    ]);
  });

  it("默认策略为 conservative", () => {
    const p = resolveAutoReplyPolicy();
    expect(p.strategy).toBe("conservative");
    expect(p.highIntentOnly).toBe(true);
    expect(p.replyQuestion).toBe(false);
    expect(p.skipNegative).toBe(true);
  });

  it("balanced 预设自动回复一般提问且不限制高意向", () => {
    const p = resolveAutoReplyPolicy({ strategy: "balanced" });
    expect(p.replyQuestion).toBe(true);
    expect(p.highIntentOnly).toBe(false);
    expect(p.skipNegative).toBe(true);
  });

  it("proactive 预设尽量多回复(负面也尝试安抚)", () => {
    const p = resolveAutoReplyPolicy({ strategy: "proactive" });
    expect(p.replyQuestion).toBe(true);
    expect(p.skipNegative).toBe(false);
  });

  it("用户显式覆盖优先于预设", () => {
    const p = resolveAutoReplyPolicy({ strategy: "proactive", skipNegative: true });
    expect(p.strategy).toBe("proactive");
    expect(p.replyQuestion).toBe(true);
    expect(p.skipNegative).toBe(true);
  });
});

describe("inbox/reply — INBOX-06 回复模板", () => {
  it("自定义问价模板生效", () => {
    const m = msg({ text: "多少钱?" });
    const d = decideAutoReply(m, { template: { priceInquiry: "自定义报价文案:请私信~" } });
    expect(d.shouldReply).toBe(true);
    expect(d.text).toBe("自定义报价文案:请私信~");
  });

  it("自定义好评模板生效", () => {
    const m = msg({ text: "太棒了,学到了!", author: "用户B" });
    const d = decideAutoReply(m, { template: { praise: "谢谢认可!(自定义)" } });
    expect(d.shouldReply).toBe(true);
    expect(d.text).toBe("谢谢认可!(自定义)");
  });

  it("自定义提问模板在 balanced 下生效", () => {
    const m = msg({ text: "怎么才能用上这个工具?", author: "用户C" });
    const d = decideAutoReply(m, { strategy: "balanced", template: { question: "已私信解答,请查收~(自定义)" } });
    expect(d.shouldReply).toBe(true);
    expect(d.text).toBe("已私信解答,请查收~(自定义)");
  });

  it("未配模板时回退默认文案", () => {
    const m = msg({ text: "多少钱?" });
    const d = decideAutoReply(m);
    expect(d.shouldReply).toBe(true);
    expect(d.text).toContain("价格信息已私信");
  });
});

describe("inbox/reply — INBOX-06 一般提问回复", () => {
  it("conservative 默认不回复一般提问", () => {
    const m = msg({ text: "这个功能是怎么实现的?", author: "用户D" });
    const d = decideAutoReply(m);
    expect(d.shouldReply).toBe(false);
  });

  it("balanced 自动回复一般提问", () => {
    const m = msg({ text: "这个功能是怎么实现的?", author: "用户D" });
    const d = decideAutoReply(m, { strategy: "balanced" });
    expect(d.shouldReply).toBe(true);
    expect(d.insight.intent).toBe("question");
  });
});

describe("inbox/reply — INBOX-06 时效窗口", () => {
  it("recencyWindowMs 内到达 → 可回复", () => {
    const m = msg({}, "2026-08-08T11:50:00.000Z"); // 10 分钟前
    const d = decideAutoReply(m, { recencyWindowMs: 30 * 60 * 1000 }, undefined, NOW);
    expect(d.shouldReply).toBe(true);
  });

  it("超出时效窗口 → 跳过(不批量回复老评论)", () => {
    const m = msg({}, "2026-08-08T10:00:00.000Z"); // 2 小时前
    const d = decideAutoReply(m, { recencyWindowMs: 30 * 60 * 1000 }, undefined, NOW);
    expect(d.shouldReply).toBe(false);
    expect(d.reason).toContain("时效窗口");
  });

  it("recencyWindowMs=0(默认)不限制时效", () => {
    const m = msg({}, "2026-08-01T00:00:00.000Z");
    const d = decideAutoReply(m, {}, undefined, NOW);
    expect(d.shouldReply).toBe(true);
  });
});

describe("inbox/reply — INBOX-06 同作者去重与上限", () => {
  it("dedupeByAuthor 同作者只回复第一条", () => {
    const messages = [
      msg({ remoteId: "w1", author: "张三", text: "多少钱?" }),
      msg({ remoteId: "w2", author: "张三", text: "怎么买?" }),
      msg({ remoteId: "w3", author: "李四", text: "求链接" }),
    ];
    const planned = planAutoReplies(messages, { dedupeByAuthor: true });
    expect(planned.length).toBe(2);
    expect(planned.map((d) => d.message.author).sort()).toEqual(["张三", "李四"]);
  });

  it("dailyPerAuthorCap 限制每作者单批回复数", () => {
    const messages = [
      msg({ remoteId: "w1", author: "张三", text: "多少钱?" }),
      msg({ remoteId: "w2", author: "张三", text: "怎么买?" }),
      msg({ remoteId: "w3", author: "张三", text: "求链接" }),
    ];
    const planned = planAutoReplies(messages, { dailyPerAuthorCap: 1 });
    expect(planned.length).toBe(1);
    expect(planned[0]?.message.author).toBe("张三");
  });

  it("不开启去重时同作者可多条回复", () => {
    const messages = [
      msg({ remoteId: "w1", author: "张三", text: "多少钱?" }),
      msg({ remoteId: "w2", author: "张三", text: "怎么买?" }),
    ];
    const planned = planAutoReplies(messages);
    expect(planned.length).toBe(2);
  });
});

describe("inbox/reply — INBOX-06 默认策略保持向后兼容", () => {
  it("默认决策与 v11 一致(高意向/好评自动,负面/已回复跳过)", () => {
    expect(decideAutoReply(msg({ text: "多少钱?" })).shouldReply).toBe(true);
    expect(decideAutoReply(msg({ text: "太棒了!" })).shouldReply).toBe(true);
    expect(decideAutoReply(msg({ text: "垃圾!" })).shouldReply).toBe(false);
    expect(decideAutoReply(msg({ handling: "auto-replied", status: "replied" })).shouldReply).toBe(false);
    expect(decideAutoReply(msg({ direction: "outbound" })).shouldReply).toBe(false);
  });

  it("DEFAULT_AUTO_REPLY_POLICY 仍是保守默认", () => {
    const p = resolveAutoReplyPolicy();
    expect(p.highIntentOnly).toBe(true);
    expect(p.skipNegative).toBe(true);
    expect(p.skipHandled).toBe(true);
    expect(p.limit).toBe(20);
  });
});

describe("inbox/reply — INBOX-06 调度器任务策略透传", () => {
  it("create 任务可携带 inbox-auto-reply 策略并保留", async () => {
    const { ScheduledTaskService } = await import("../src/scheduler/service.js");
    const { MemoryScheduledTaskStore } = await import("../src/scheduler/store.js");
    const { dailyAt } = await import("../src/scheduler/types.js");
    const service = new ScheduledTaskService({
      store: new MemoryScheduledTaskStore(),
      now: NOW,
    });
    const task = await service.create({
      name: "定时自动回复",
      cron: dailyAt(10, 0),
      action: {
        kind: "inbox-auto-reply",
        policy: { strategy: "balanced", replyQuestion: true, template: { praise: "谢谢!(模板)" } },
      },
      platformIds: ["zhihu"],
      draftId: "",
    });
    expect(task.action.kind).toBe("inbox-auto-reply");
    if (task.action.kind === "inbox-auto-reply") {
      expect(task.action.policy?.strategy).toBe("balanced");
      expect(task.action.policy?.template?.praise).toBe("谢谢!(模板)");
    }
  });

  it("收件箱动作不带策略时保持向后兼容", async () => {
    const { ScheduledTaskService } = await import("../src/scheduler/service.js");
    const { MemoryScheduledTaskStore } = await import("../src/scheduler/store.js");
    const { dailyAt } = await import("../src/scheduler/types.js");
    const service = new ScheduledTaskService({
      store: new MemoryScheduledTaskStore(),
      now: NOW,
    });
    const task = await service.create({
      name: "兼容任务",
      cron: dailyAt(9, 0),
      action: { kind: "inbox-auto-reply" },
      platformIds: [],
      draftId: "",
    });
    expect(task.action.kind).toBe("inbox-auto-reply");
  });
});
