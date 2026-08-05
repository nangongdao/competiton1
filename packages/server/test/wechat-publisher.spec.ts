import { afterEach, describe, expect, it, vi } from "vitest";
import { WechatPublisher } from "../src/wechat/rehost.js";
import type { WechatPublishPayload } from "../src/wechat/rehost.js";

/** 最小有效发布 payload(带封面 URL 才能过 draft/add 的封面校验)。 */
const PAYLOAD = {
  title: "标题",
  content: "<p>正文</p>",
  coverImageUrl: "https://cdn.example.com/cover.png",
  publish: false,
};

/** 构造 mock fetch:按 URL 关键词返回微信 API 响应。 */
function stubWechatApi(calls: { count: () => number }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      calls.count();
      const url = String(input);
      const body: Record<string, unknown> = { errcode: 0, errmsg: "ok" };
      if (url.includes("/cgi-bin/stable_token")) body.access_token = "TOKEN";
      if (url.includes("/draft/add")) body.media_id = "MEDIA_1";
      if (url.includes("/material/add_material")) body.media_id = "THUMB_1";
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

describe("WechatPublisher — 幂等发布", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("相同内容重复发布只调一次微信 API", async () => {
    let apiCalls = 0;
    stubWechatApi({ count: () => apiCalls++ });

    const pub = new WechatPublisher("appid", "secret");
    const first = await pub.publish(PAYLOAD);
    expect(first.ok).toBe(true);
    expect(first.remoteId).toBe("MEDIA_1");

    const callsAfterFirst = apiCalls;
    const second = await pub.publish(PAYLOAD);
    expect(second.ok).toBe(true);
    // 第二次命中幂等缓存,不新增任何网络调用(避免重复草稿)。
    expect(apiCalls).toBe(callsAfterFirst);
  });

  it("内容不同的两次发布各自调用微信 API", async () => {
    let apiCalls = 0;
    stubWechatApi({ count: () => apiCalls++ });

    const pub = new WechatPublisher("appid", "secret");
    const first = await pub.publish(PAYLOAD);
    expect(first.ok).toBe(true);

    const secondPayload = { ...PAYLOAD, content: "<p>改过的正文</p>" };
    const second = await pub.publish(secondPayload);
    expect(second.ok).toBe(true);
    // 内容变化 → 幂等键不同 → 需要再次提交。
    expect(apiCalls).toBeGreaterThan(0);
    expect(second.remoteId).toBe("MEDIA_1");
  });

  it("确定失败也缓存(避免反复打微信 API)", async () => {
    let apiCalls = 0;
    stubWechatApi({ count: () => apiCalls++ });
    // 无封面 → publishOnce 在 token 获取后直接返回失败。
    const pub = new WechatPublisher("appid", "secret");
    const badPayload = { ...PAYLOAD, coverImageUrl: undefined };
    const first = await pub.publish(badPayload);
    expect(first.ok).toBe(false);

    const callsAfterFirst = apiCalls;
    const second = await pub.publish(badPayload);
    expect(second.ok).toBe(false);
    // 幂等命中:同一缓存对象,且不新增网络调用。
    expect(second).toBe(first);
    expect(apiCalls).toBe(callsAfterFirst);
  });
});

describe("WechatPublisher — 正文图并发重托管(UPGRADE §1/§2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("多张正文图并发上传,同源 URL 只上传一次", async () => {
    // 统计正文图下载的最大在途数(串行实现恒为 1)。
    let activeImgs = 0;
    let maxActiveImgs = 0;
    let uploadimgCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const body: Record<string, unknown> = { errcode: 0, errmsg: "ok" };

        if (url.includes("stable_token")) body.access_token = "TOKEN";
        if (url.includes("draft/add")) body.media_id = "MEDIA_1";
        if (url.includes("add_material")) body.media_id = "THUMB_1";
        if (url.includes("media/uploadimg")) {
          uploadimgCalls++;
          body.url = `https://mmbiz.qpic.cn/upload/${uploadimgCalls}`;
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.startsWith("https://img.example.com/")) {
          // 模拟正文图下载(可并发)。
          activeImgs++;
          maxActiveImgs = Math.max(maxActiveImgs, activeImgs);
          await new Promise((r) => setTimeout(r, 20));
          activeImgs--;
          return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), { status: 200 });
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const pub = new WechatPublisher("appid", "secret");
    const payload: WechatPublishPayload = {
      title: "标题",
      content:
        '<p><img src="https://img.example.com/1.png"><img src="https://img.example.com/2.png"><img src="https://img.example.com/1.png"></p>',
      coverImageUrl: "https://cdn.example.com/cover.png",
      bodyImageUrls: ["https://img.example.com/1.png", "https://img.example.com/1.png", "https://img.example.com/2.png"],
      publish: false,
    };
    const out = await pub.publish(payload);
    expect(out.ok).toBe(true);
    // 同源去重:1.png + 2.png 只各自上传一次。
    expect(uploadimgCalls).toBe(2);
    // 并发:两张图下载存在同时在途(串行实现 maxActiveImgs 恒为 1)。
    expect(maxActiveImgs).toBeGreaterThan(1);
  });
});
