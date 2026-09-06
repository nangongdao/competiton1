/**
 * PlatformExecutor 阶段钩子类型 —— 供故障注入模块复用。
 */
import type { PlatformExecutor } from "./service.js";

/** 阶段钩子名(PlatformExecutor 的方法名)。 */
export type PlatformExecutorHookName = "prepare" | "upload" | "submit" | "verify";

export type PlatformExecutorHooks = Pick<PlatformExecutor, PlatformExecutorHookName>;

export type { PlatformExecutor };
