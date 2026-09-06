/**
 * INBOX-04 公众号评论回发 —— 纯逻辑 + 路由测试。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WechatCommentReplier, parseCommentReplyTarget } from "../src/wechat/reply.js";
import { buildServerApp } from "../src/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";

/** 已配置公众号凭据的测试配置。 */
function authedConfig(): ServerConfig {
  return {
    ...loadConfig({}),
    token: "test-token",
    authEnabled: true,
    wechat: { appId: "appid", secret: "secret", configured: true },
    localStore: { maxTotalBytes: 1024 * 1024, maxFileBytes: 1024, retentionMs: 0, cleanupEnabled: false },
  };
}

/** stub 微信 API:stable_token / freepublish/batchget / comment/reply。 */
function stubWechatApi(opts: { replyErrcode?: number; replyErrmsg?: string } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body: Record<string, unknown> = { errcode: 0, errmsg: "ok" };
      if (url.includes("/cgi-bin/stable_token")) body.access_token = "TOKEN";
      if (url.includes("/freepublish/batchget")) {
        body.item = [{ article_detail: { msg_data_id: "MSG_1", media_id: "M_1" } }];
      }
      if (url.includes("/comment/reply")) {
        if (opts.replyErrcode) {
          body.errcode = opts.replyErrcode;
          body.errmsg = opts.replyErrmsg ?? "reply failed";
        }
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

describe("WechatCommentReplier — INBOX-04 公众号评论回发", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parseCommentReplyTarget 解析 remoteId", () => {
    expect(parseCommentReplyTarget("wechat-comment-123")).toEqual({ userCommentId: 123 });
    expect(parseCommentReplyTarget("MSG_1:wechat-comment-456")).toEqual({ msgDataId: "MSG_1", userCommentId: 456 });
    expect(parseCommentReplyTarget("garbage")).toEqual({});
  });

  it("回发成功:comment/reply 返回 ok + remoteReplyId", async () => {
    stubWechatApi();
    const replier = new WechatCommentReplier({ appId: "appid", secret: "secret" });
    const out = await replier.reply({ remoteId: "wechat-comment-100", text: "感谢关注!已私信您~" });
    expect(out.ok).toBe(true);
    expect(out.remoteReplyId).toBe("wechat-reply-100");
  });

  it("公众号幂等错误(已回复过)→ 视为已回发,不重复发", async () => {
    stubWechatApi({ replyErrcode: 45009, replyErrmsg: "该评论已回复" });
    const replier = new WechatCommentReplier({ appId: "appid", secret: "secret" });
    const out = await replier.reply({ remoteId: "wechat-comment-100", text: "hi" });
    expect(out.ok).toBe(true);
  });

  it("其它错误如实上报失败", async () => {
    stubWechatApi({ replyErrcode: -1, replyErrmsg: "系统繁忙" });
    const replier = new WechatCommentReplier({ appId: "appid", secret: "secret" });
    const out = await replier.reply({ remoteId: "wechat-comment-100", text: "hi" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("-1");
  });

  it("无法解析 user_comment_id → 失败", async () => {
    stubWechatApi();
    const replier = new WechatCommentReplier({ appId: "appid", secret: "secret" });
    const out = await replier.reply({ remoteId: "bad", text: "hi" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("解析");
  });
});

describe("server /inbox/reply 路由 — INBOX-04 公众号评论回发", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未配置凭据 → 返回明确错误", async () => {
    const config = { ...loadConfig({}), token: "t", authEnabled: false, wechat: { appId: "", secret: "", configured: false } };
    const app = await buildServerApp({ config });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/reply",
      payload: { platformId: "wechat", remoteId: "wechat-comment-1", text: "hi" },
    });
    const json = res.json() as { ok: boolean; error: string };
    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toContain("未配置");
  });

  it("已配置 → 真实回发成功", async () => {
    stubWechatApi();
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/reply",
      headers: { "X-MPP-Token": "test-token" },
      payload: { platformId: "wechat", remoteId: "wechat-comment-7", text: "感谢关注!" },
    });
    const json = res.json() as { ok: boolean; remoteReplyId?: string };
    expect(res.statusCode).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.remoteReplyId).toBe("wechat-reply-7");
  });

  it("非 wechat 平台 → 400 明确提示走 runner", async () => {
    stubWechatApi();
    const app = await buildServerApp({ config: authedConfig() });
    const res = await app.inject({
      method: "POST",
      url: "/inbox/reply",
      headers: { "X-MPP-Token": "test-token" },
      payload: { platformId: "zhihu", remoteId: "x", text: "hi" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("runner");
  });
});
