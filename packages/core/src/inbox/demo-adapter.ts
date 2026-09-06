/**
 * INBOX-03 真实平台消息同步演示适配器 —— 规则版、离线可用。
 *
 * 在未配置真实平台凭据/服务时,为「接入真实平台消息同步」提供一条可跑通的闭环:
 * - 每个平台注册一个演示适配器,按「已拉取游标」增量生成一批与真实平台风格一致的
 *   评论 / 私信 / @提及 / 通知;
 * - 纯确定性(同游标结果一致),不产生真实网络请求,供单测 / demo / UI 演示复用;
 * - 真实平台接入后,用真实适配器替换同名注册即可,UI/存储逻辑零改动。
 */
import type { InboxSyncAdapter, InboxSyncRequest, RemoteInboxItem } from "./sync.js";
import { registerInboxSyncAdapter, isInboxSyncAdapterRegistered } from "./sync.js";

/** 演示评论素材(与各平台用户画像一致的昵称 / 内容模板)。 */
interface DemoSource {
  readonly platformId: string;
  readonly authors: readonly string[];
  readonly texts: readonly string[];
  readonly kinds: readonly ("comment" | "direct-message" | "mention" | "notification")[];
}

const DEMO_SOURCES: readonly DemoSource[] = [
  {
    platformId: "wechat",
    authors: ["小满同学", "阿哲", "Lynn", "远方来信", "晨光"],
    texts: [
      "这个方案很实用,已收藏!",
      "请问这个多少钱?想了解下",
      "怎么买?求链接",
      "内容写得不错,继续加油",
      "有点贵,再考虑一下",
      "链接打不开了,能补一下吗",
    ],
    kinds: ["comment", "direct-message", "mention", "notification"],
  },
  {
    platformId: "xiaohongshu",
    authors: ["爱吃草莓的猫", "一颗糖", "Momo酱", "今天也要加油", "白桃乌龙"],
    texts: [
      "绝绝子!按头安利!!",
      "这个博主我关注好久了",
      "多少钱呀?想入",
      "求链接求链接",
      "已收藏,收藏了再看",
      "内容一般般,标题有点夸张",
    ],
    kinds: ["comment", "direct-message", "mention"],
  },
  {
    platformId: "zhihu",
    authors: ["知乎用户1234", "老程序员", "理性思考者", "匿名用户", "科技爱好者"],
    texts: [
      "分析得很透彻,学习了",
      "请问作者是做什么行业的?",
      "这个数据来源可靠吗?",
      "和我的经验完全一致",
      "建议补充一些反面案例",
    ],
    kinds: ["comment", "direct-message", "notification"],
  },
  {
    platformId: "bilibili",
    authors: ["弹幕之王", "三年二班", "中二少年", "追番人", "一键三连"],
    texts: [
      "三连了,太强了",
      "讲的太好了,收藏",
      "可以出个续集吗?",
      "这个视频对我帮助很大",
      "前面说错了,应该是...",
    ],
    kinds: ["comment", "mention"],
  },
  {
    platformId: "juejin",
    authors: ["掘友小码", "架构师老王", "前端打工人", "后端小白", "开源爱好者"],
    texts: [
      "好文,已点赞收藏",
      "代码可以贴一下吗?",
      "这个方案在生产环境验证过吗?",
      "谢谢分享,学到了",
      "有个问题想请教一下",
    ],
    kinds: ["comment", "direct-message"],
  },
  {
    platformId: "weibo",
    authors: ["微博小透明", "热搜常客", "深夜码字人", "职场打工人", "吃瓜群众"],
    texts: [
      "前排围观,转发支持!",
      "请问博主这个怎么买?",
      "分析得在理,已转发",
      "有点水,标题党了",
      "求链接求链接",
    ],
    kinds: ["comment", "mention", "notification"],
  },
  {
    platformId: "douyin",
    authors: ["抖音小助手", "爆款制造机", "短视频玩家", "生活记录者", "点赞狂魔"],
    texts: [
      "这个视频太有用了,收藏!",
      "怎么下载这个工具?",
      "讲得真好,三连了",
      "内容不错,可以出续集吗",
      "多少钱呀?想买",
    ],
    kinds: ["comment", "direct-message"],
  },
  {
    platformId: "kuaishou",
    authors: ["老铁666", "东北话十级", "农村生活家", "记录美好生活", "铁子"],
    texts: [
      "老铁讲得实在,支持!",
      "这个咋弄的,求教程",
      "顶一个,太接地气了",
      "有点假,不真实",
      "怎么联系你买?",
    ],
    kinds: ["comment", "mention"],
  },
  {
    platformId: "shipinhao",
    authors: ["视频号小编", "微信朋友", "同事小李", "家人", "老朋友"],
    texts: [
      "看到你发的视频了,不错!",
      "这个怎么转发到朋友圈?",
      "点赞了,继续加油",
      "内容有点长,建议精简",
      "求购买渠道,私信你了",
    ],
    kinds: ["comment", "direct-message", "notification"],
  },
  {
    platformId: "toutiao",
    authors: ["头条号读者", "资讯达人", "吃瓜群众甲", "理性评论员", "关注者"],
    texts: [
      "写得不错,收藏了",
      "请问数据来源是哪?",
      "学到了,转发给同事",
      "标题有点夸张了",
      "这个工具多少钱?",
    ],
    kinds: ["comment", "direct-message"],
  },
];

/** 为每个演示平台生成一条增量批次(基于游标序号,确定性)。 */
function makeDemoItems(source: DemoSource, cursor: string | undefined, limit: number): { items: RemoteInboxItem[]; nextCursor: string } {
  // 游标格式:demo:<已拉取序号>。首次为空 → 从 0 开始。
  const start = cursor?.startsWith("demo:") ? Number(cursor.slice("demo:".length)) || 0 : 0;
  const count = Math.min(limit, 5);
  const items: RemoteInboxItem[] = [];
  for (let i = 0; i < count; i++) {
    const seq = start + i;
    const author = source.authors[seq % source.authors.length]!;
    const text = source.texts[(seq * 3 + i) % source.texts.length]!;
    const kind = source.kinds[(seq + i) % source.kinds.length]!;
    // 时间随序号推进(每批约 1-3 小时),保证增量顺序。
    const receivedAt = new Date(Date.now() - (count - i) * 2 * 60 * 60 * 1000).toISOString();
    items.push({
      remoteId: `demo-${source.platformId}-${seq}`,
      kind,
      author,
      authorId: `demo-${source.platformId}-user-${seq}`,
      text,
      receivedAt,
    });
  }
  return { items, nextCursor: `demo:${start + count}` };
}

/** 演示同步适配器(按平台注册)。 */
export class DemoInboxSyncAdapter implements InboxSyncAdapter {
  readonly platformId: string;

  constructor(platformId: string) {
    this.platformId = platformId;
  }

  async fetch(req: InboxSyncRequest): Promise<{ ok: boolean; items: readonly RemoteInboxItem[]; cursor?: string; error?: string }> {
    const source = DEMO_SOURCES.find((s) => s.platformId === this.platformId);
    if (!source) {
      return { ok: false, items: [], error: `演示适配器不支持平台 ${this.platformId}` };
    }
    const { items, nextCursor } = makeDemoItems(source, req.cursor, req.limit ?? 100);
    return { ok: true, items, cursor: nextCursor };
  }
}

/** 注册全部演示适配器(幂等,防止重复注册)。 */
export function registerDemoInboxSyncAdapters(): void {
  for (const source of DEMO_SOURCES) {
    if (!isInboxSyncAdapterRegistered(source.platformId)) {
      registerInboxSyncAdapter(new DemoInboxSyncAdapter(source.platformId));
    }
  }
}
