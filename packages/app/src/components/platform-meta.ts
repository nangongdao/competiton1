import { MessageCircle, BookOpen, Play, Heart, Send, Code2, Terminal, Feather, Newspaper, Megaphone, Clapperboard, Video, Tv, type LucideIcon } from "lucide-react";

/** 平台品牌元数据:颜色 token 名与 Lucide 图标,供 chip 与预览卡片复用。 */
export const PLATFORM_COLORS: Record<string, string> = {
  wechat: "var(--brand-wechat)",
  zhihu: "var(--brand-zhihu)",
  bilibili: "var(--brand-bilibili)",
  xiaohongshu: "var(--brand-xiaohongshu)",
  juejin: "var(--brand-juejin)",
  cnblogs: "var(--brand-cnblogs, #005a9c)",
  csdn: "var(--brand-csdn, #fc5531)",
  weibo: "var(--brand-weibo, #e6162d)",
  toutiao: "var(--brand-toutiao, #fe2c55)",
  douyin: "var(--brand-douyin, #161823)",
  kuaishou: "var(--brand-kuaishou, #ff4906)",
  shipinhao: "var(--brand-shipinhao, #fa9d3b)",
};

/** 平台标识图标(Lucide 名称)。 */
export const PLATFORM_ICONS: Record<string, string> = {
  wechat: "message-circle",
  zhihu: "book-open",
  bilibili: "play",
  xiaohongshu: "heart",
  juejin: "code-2",
  cnblogs: "feather",
  csdn: "terminal",
  weibo: "megaphone",
  toutiao: "newspaper",
  douyin: "clapperboard",
  kuaishou: "video",
  shipinhao: "tv",
};

export function platformColor(id: string): string {
  return PLATFORM_COLORS[id] ?? "var(--accent)";
}

/** 平台图标:返回图标组件(从 Lucide 动态取用),未知平台回退 Send。 */
export function platformIcon(id: string): LucideIcon {
  switch (PLATFORM_ICONS[id]) {
    case "message-circle":
      return MessageCircle;
    case "book-open":
      return BookOpen;
    case "play":
      return Play;
    case "heart":
      return Heart;
    case "code-2":
      return Code2;
    case "terminal":
      return Terminal;
    case "feather":
      return Feather;
    case "megaphone":
      return Megaphone;
    case "newspaper":
      return Newspaper;
    case "clapperboard":
      return Clapperboard;
    case "video":
      return Video;
    case "tv":
      return Tv;
    default:
      return Send;
  }
}
