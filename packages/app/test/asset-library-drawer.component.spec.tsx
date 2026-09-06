// @vitest-environment jsdom
/**
 * AssetLibraryDrawer 组件测试 —— 内容资产库面板交互(ROADMAP_V5 Phase 3)。
 * core 索引/检索逻辑已在 `asset-library.spec.ts` 覆盖,此处验证组件行为。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, userEvent } from "./helpers/render.js";
import { AssetLibraryDrawer } from "../src/components/AssetLibraryDrawer.js";
import { useStore, type AssetHitPublic } from "../src/state/store.js";
import type { AssetLibraryKind, AssetRecord } from "@mpp/core";

function makeRecord(kind: AssetLibraryKind, id: string, title: string, reference: string): AssetRecord {
  const now = new Date().toISOString();
  return {
    id,
    kind,
    title,
    reference,
    refKind: reference.startsWith("http") ? "url" : "text",
    source: { from: "manual" },
    createdAt: now,
    updatedAt: now,
  };
}

function resetStore() {
  const records: AssetRecord[] = [
    makeRecord("cover", "a1", "AI 写作指南", "AI 写作指南"),
    makeRecord("rehost", "a2", "AI 配图", "https://img.example.com/ai.png"),
    makeRecord("artifact", "a3", "周报", "https://zhuanlan.zhihu.com/p/1"),
  ];
  useStore.setState({
    assetLibrary: records,
    assetLibraryReady: true,
    lastAssetIndex: null,
    loadAssetLibrary: vi.fn(async () => undefined),
    rebuildAssetIndex: vi.fn(async () => ({ ok: true })),
    searchAssets: vi.fn((query: string, kind?: AssetLibraryKind) => {
      const filtered = kind ? records.filter((r) => r.kind === kind) : records;
      return filtered
        .filter((r) => !query || r.title.includes(query) || r.reference.includes(query))
        .map((record): AssetHitPublic => ({ record, score: 1 }));
    }),
    addAsset: vi.fn(async () => ({ ok: true })),
    removeAsset: vi.fn(async () => undefined),
  });
}

beforeEach(() => {
  resetStore();
});

describe("AssetLibraryDrawer 内容资产库面板", () => {
  it("渲染标题、重建索引按钮与资产列表", () => {
    render(<AssetLibraryDrawer open onOpenChange={() => undefined} />);
    expect(screen.getByText("内容资产库")).toBeTruthy();
    expect(screen.getByRole("button", { name: /重建索引/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /手动录入/ })).toBeTruthy();
    // 三条记录标题可见(封面标题在标题区与引用区各出现一次)。
    expect(screen.getAllByText(/AI 写作指南/).length).toBeGreaterThan(0);
    expect(screen.getByText(/AI 配图/)).toBeTruthy();
    expect(screen.getByText(/周报/)).toBeTruthy();
  });

  it("类型 tab 过滤列表", async () => {
    render(<AssetLibraryDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /图床/ }));
    await waitFor(() => {
      expect(screen.queryByText(/AI 配图/)).toBeTruthy();
      expect(screen.queryByText(/周报/)).toBeNull();
    });
  });

  it("重建索引触发 store action", async () => {
    render(<AssetLibraryDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /重建索引/ }));
    await waitFor(() => {
      expect(useStore.getState().rebuildAssetIndex).toHaveBeenCalled();
    });
  });

  it("手动录入表单可展开并校验必填", async () => {
    render(<AssetLibraryDrawer open onOpenChange={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: /手动录入/ }));
    // 展开后出现保存按钮。
    const save = screen.getByRole("button", { name: /保存资产/ });
    expect(save).toBeTruthy();
    // 未填写直接保存 → 错误提示,不调用 addAsset。
    await userEvent.click(save);
    expect(screen.getByText("请填写标题与引用")).toBeTruthy();
    expect(useStore.getState().addAsset).not.toHaveBeenCalled();
  });
});
