/**
 * v11 INBOX-04 AI 自动回复真实回发 —— 评论回复引擎纯函数测试。
 */
import { describe, expect, it } from "vitest";
import { createInboxMessage, type InboxMessage } from "../src/inbox/types.js";
import {
  decideAutoReply,
  planAutoReplies,
  sendAutoReplies,
  applyAutoReplyResult,
  DEFAULT_AUTO_REPLY_POLICY,
  type CommentReplyAdapter,
} from "../src/inbox/reply.js";

const NOW = () => "2026-08-08T00:00:00.000Z";

function msg(overrides: Partial<Parameters<typeof createInboxMessage>[0]> = {}): InboxMessage {
  return createInboxMessage(
    {
      platformId: "wechat",
      remoteId: "w1",
      author: "用户A",
      text: "这个多少钱?",
      ...overrides,
    },
    NOW,
  );
}

/** 记录调用次数的假适配器。 */
function makeAdapter(): { adapter: CommentReplyAdapter; calls: Array<{ remoteId: string; text: string }> } {
  const calls: Array<{ remoteId: string; text: string }> = [];
  const adapter: CommentReplyAdapter = {
    platformId: "wechat",
    async reply(req) {
      calls.push({ remoteId: req.message.remoteId, text: req.text });
      return { ok: true, remoteReplyId: `reply-${calls.length}` };
    },
  };
  return { adapter, calls };
}

describe("inbox/reply — INBOX-04 自动回复决策", () => {
  it("高意向(问价)→ 自动回复 + 引导私信文案", () => {
    const m = msg({ text: "这个多少钱?想了解下" });
    const d = decideAutoReply(m);
    expect(d.shouldReply).toBe(true);
    expect(d.text).toBeTruthy();
    expect(d.insight.highIntent).toBe(true);
  });

  it("高意向(求购)→ 自动回复", () => {
    const m = msg({ text: "怎么买?求链接" });
    const d = decideAutoReply(m);
    expect(d.shouldReply).toBe(true);
    expect(d.text).toContain("购买方式");
  });

  it("好评 → 默认自动回复(策略 replyPraise=true)", () => {
    const m = msg({ text: "太棒了,学到了!" });
    const d = decideAutoReply(m);
    expect(d.shouldReply).toBe(true);
    expect(d.insight.intent).toBe("praise");
  });

  it("好评但 replyPraise=false → 不自动回复", () => {
    const m = msg({ text: "太棒了,学到了!" });
    const d = decideAutoReply(m, { replyPraise: false });
    expect(d.shouldReply).toBe(false);
  });

  it("负面/紧急 → 绝不自动回复,转人工", () => {
    const m = msg({ text: "垃圾,我要退款!你们是骗子!" });
    const d = decideAutoReply(m);
    expect(d.shouldReply).toBe(false);
    expect(d.reason).toContain("人工");
  });

  it("已回复/已归档 → 跳过(幂等)", () => {
    const replied = msg({ handling: "auto-replied", status: "replied" });
    expect(decideAutoReply(replied).shouldReply).toBe(false);
    const closed = msg({ status: "closed" });
    expect(decideAutoReply(closed).shouldReply).toBe(false);
  });

  it("出站消息 → 跳过", () => {
    const outbound = msg({ direction: "outbound" });
    expect(decideAutoReply(outbound).shouldReply).toBe(false);
  });

  it("planAutoReplies 按 limit 截断", () => {
    const messages = [
      msg({ remoteId: "w1", text: "多少钱?" }),
      msg({ remoteId: "w2", text: "怎么买?" }),
      msg({ remoteId: "w3", text: "求链接" }),
    ];
    const planned = planAutoReplies(messages, { limit: 2 });
    expect(planned.length).toBe(2);
  });
});

describe("inbox/reply — INBOX-04 批量回发执行", () => {
  it("sendAutoReplies 对候选逐条调用适配器真实回发", async () => {
    const { adapter, calls } = makeAdapter();
    const messages = [
      msg({ remoteId: "w1", text: "多少钱?" }),
      msg({ remoteId: "w2", text: "太棒了,学到了!" }),
    ];
    const summary = await sendAutoReplies(messages, adapter);
    expect(summary.ok).toBe(true);
    expect(summary.planned).toBe(2);
    expect(summary.sent).toBe(2);
    expect(calls.length).toBe(2);
    expect(calls[0]?.remoteId).toBe("w1");
    expect(calls[0]?.text).toBeTruthy();
  });

  it("单条失败不阻断整批,失败明细上报", async () => {
    let count = 0;
    const adapter: CommentReplyAdapter = {
      platformId: "wechat",
      async reply() {
        count++;
        if (count === 1) return { ok: false, error: "公众号已回复过该评论" };
        return { ok: true, remoteReplyId: "r2" };
      },
    };
    const messages = [
      msg({ remoteId: "w1", text: "多少钱?" }),
      msg({ remoteId: "w2", text: "怎么买?" }),
    ];
    const summary = await sendAutoReplies(messages, adapter);
    expect(summary.ok).toBe(false);
    expect(summary.sent).toBe(1);
    expect(summary.failed.length).toBe(1);
    expect(summary.failed[0]?.messageId).toBe(messages[0]?.id);
  });

  it("applyAutoReplyResult 落地本地状态(handling=auto-replied)", () => {
    const m = msg();
    const next = applyAutoReplyResult(m, "感谢关注!已私信您~");
    expect(next.handling).toBe("auto-replied");
    expect(next.status).toBe("replied");
    expect(next.reply).toBe("感谢关注!已私信您~");
  });

  it("DEFAULT_AUTO_REPLY_POLICY 保守默认(不自动回复负评)", () => {
    expect(DEFAULT_AUTO_REPLY_POLICY.highIntentOnly).toBe(true);
    expect(DEFAULT_AUTO_REPLY_POLICY.skipNegative).toBe(true);
    expect(DEFAULT_AUTO_REPLY_POLICY.skipHandled).toBe(true);
    expect(DEFAULT_AUTO_REPLY_POLICY.limit).toBe(20);
  });
});
