/**
 * TEST-03 组件测试公共工具。
 * - cleanup:渲染后清理 DOM,避免用例间残留。
 * - makeJob / makePlatformJob:构造 TaskPanel 所需的 PublishJob 数据(无需触网)。
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import type { PublishJob, PlatformJob } from "@mpp/core";

export { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

export function makePlatformJob(overrides: Partial<PlatformJob> = {}): PlatformJob {
  const now = new Date().toISOString();
  return {
    platformId: "wechat",
    stage: "queued",
    attemptCount: 1,
    attempts: [],
    uploadedAssets: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeJob(overrides: Partial<PublishJob> = {}): PublishJob {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    contentDigest: "digest-abc",
    stage: "queued",
    platformJobs: [makePlatformJob({ platformId: "wechat" })],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
