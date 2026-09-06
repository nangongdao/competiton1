/**
 * ACCOUNT-04 账号管理抽屉组件测试。
 *
 * 覆盖:
 * - 渲染平台分组 + 账号列表;
 * - 新建账号表单(名称 / profileDir / 密钥输入);
 * - 新建保存调用 store saveAccount;
 * - 删除账号调用 deleteAccount;
 * - 平台级账号选择(设为当前平台账号);
 * - 全 Lucide 图标(无表情符号)检查。
 */
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "./helpers/render.js";
import { AccountManagerDrawer } from "../src/components/AccountManagerDrawer.js";
import { useStore } from "../src/state/store.js";
import type {
  AssistedHandoffRequest,
  AssistedHandoffResult,
  AutomationPublishRequest,
  AutomationPublishResult,
  ClipboardPayload,
  PlatformBridge,
  UploadAssetRequest,
  UploadAssetResult,
  WechatPublishRequest,
  WechatPublishResult,
} from "../src/bridge/types.js";

class MemoryBridge implements PlatformBridge {
  readonly env = "web" as const;
  readonly store = new Map<string, string>();
  async writeClipboard(_p: ClipboardPayload): Promise<boolean> { return true; }
  async assistedHandoff(_r: AssistedHandoffRequest): Promise<AssistedHandoffResult> {
    return { ok: true, method: "clipboard", message: "ok" };
  }
  async publishWechat(_r: WechatPublishRequest): Promise<WechatPublishResult> {
    return { ok: true, message: "ok" };
  }
  async publishAutomation(_r: AutomationPublishRequest): Promise<AutomationPublishResult> {
    return { ok: false, status: "failed", message: "n/a" };
  }
  async uploadAsset(_r: UploadAssetRequest): Promise<UploadAssetResult> {
    return { ok: false, message: "n/a" };
  }
  async getSetting(key: string): Promise<string | undefined> { return this.store.get(key); }
  async setSetting(key: string, value: string): Promise<void> { this.store.set(key, value); }
}

let bridge: MemoryBridge;

beforeEach(() => {
  bridge = new MemoryBridge();
  useStore.getState().setBridge(bridge);
  useStore.setState({ accounts: [], activeAccountId: null, accountForPlatform: {} });
});

function renderDrawer(open = true) {
  return render(<AccountManagerDrawer open={open} onOpenChange={() => undefined} />);
}

describe("AccountManagerDrawer · ACCOUNT-04", () => {
  it("渲染标题与账号总数", () => {
    renderDrawer();
    expect(screen.getByText("账号管理")).toBeTruthy();
    expect(screen.getByText(/账号 0 个/)).toBeTruthy();
  });

  it("新建公众号账号并保存", async () => {
    renderDrawer();
    // 打开新建表单(公众号平台)。
    const newWechat = screen.getAllByLabelText("新建 wechat 账号");
    fireEvent.click(newWechat[0]);
    await waitFor(() => {
      expect(screen.getByText("新建账号")).toBeTruthy();
    });
    const nameInput = screen.getByLabelText("账号名称");
    fireEvent.change(nameInput, { target: { value: "主号" } });
    const profileInput = screen.getByLabelText("server profile 引用(公众号凭据)");
    fireEvent.change(profileInput, { target: { value: "profile-main" } });
    fireEvent.click(screen.getByRole("button", { name: /创建/ }));

    await waitFor(() => {
      expect(useStore.getState().accounts.length).toBe(1);
    });
    expect(useStore.getState().accounts[0].name).toBe("主号");
    expect(useStore.getState().accounts[0].serverProfileId).toBe("profile-main");
  });

  it("新建会话平台账号可填浏览器 profile 目录", async () => {
    renderDrawer();
    const newZhihu = screen.getAllByLabelText("新建 zhihu 账号");
    fireEvent.click(newZhihu[0]);
    await waitFor(() => {
      expect(screen.getByText("新建账号")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("账号名称"), { target: { value: "知乎号" } });
    fireEvent.change(screen.getByLabelText("浏览器登录 profile 目录"), { target: { value: "zhihu-main" } });
    fireEvent.click(screen.getByRole("button", { name: /创建/ }));
    await waitFor(() => {
      expect(useStore.getState().accounts[0]?.profileDir).toBe("zhihu-main");
    });
  });

  it("列表展示账号 + 密钥安全分级徽标(无表情符号)", async () => {
    await useStore.getState().saveAccount({ platformId: "zhihu", name: "知乎A", profileDir: "zh-a" });
    await useStore.getState().saveAccount({ platformId: "wechat", name: "公众号B", serverProfileId: "p-b" });
    renderDrawer();
    expect(screen.getByText("知乎A")).toBeTruthy();
    expect(screen.getByText("公众号B")).toBeTruthy();
    expect(screen.getAllByText(/密钥仅会话/).length).toBeGreaterThanOrEqual(1);    // 禁止表情符号:抽查常见 emoji 范围字符。
    const body = document.body.textContent ?? "";
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(body)).toBe(false);
  });

  it("平台级账号选择(设为本平台)", async () => {
    await useStore.getState().saveAccount({ platformId: "zhihu", name: "知乎A", profileDir: "zh-a" });
    renderDrawer();
    const btn = screen.getAllByLabelText("设为 zhihu 平台账号");
    fireEvent.click(btn[0]);
    await waitFor(() => {
      expect(useStore.getState().accountForPlatform["zhihu"]).toBeTruthy();
    });
    expect(screen.getByText("本平台")).toBeTruthy();
  });

  it("删除账号", async () => {
    const created = await useStore.getState().saveAccount({ platformId: "zhihu", name: "待删" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDrawer();
    fireEvent.click(screen.getByLabelText("删除 待删"));
    await waitFor(() => {
      expect(useStore.getState().accounts.length).toBe(0);
    });
    vi.restoreAllMocks();
    void created;
  });
});
