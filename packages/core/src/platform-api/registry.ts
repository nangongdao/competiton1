/**
 * 平台 API 提供者注册表 —— 加平台零改核心。
 *
 * 与适配器注册表同模式:核心只通过 `getPlatformApi` / `listPlatformApis` 访问,
 * 绝无 switch(platform)。新平台 = 实现 provider + register 一次。
 */
import type { PlatformApiProvider } from "./types.js";

const REGISTRY = new Map<string, PlatformApiProvider>();

export function registerPlatformApi(provider: PlatformApiProvider): void {
  REGISTRY.set(provider.descriptor.platformId, provider);
}

export function getPlatformApi(platformId: string): PlatformApiProvider | undefined {
  return REGISTRY.get(platformId);
}

export function listPlatformApis(): readonly PlatformApiProvider[] {
  return [...REGISTRY.values()];
}

export function listPlatformApiIds(): readonly string[] {
  return [...REGISTRY.keys()];
}
