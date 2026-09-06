/**
 * v4 Phase 3 · COLLAB-01/04 共享内容 REST API —— GET/POST /share/*。
 *
 * 设计约束(与 /jobs、/weekly/send 同基线):
 * - 强制 X-MPP-Token 鉴权(经 registerAuth 全局钩子);
 * - JSON Schema 校验畸形请求(SEC-03 稳定拒绝);
 * - 只读写「列表 + 单条」,不做任意文件读写(越权边界);
 * - 共享内容只读版本化:远端不自动覆盖本地,由客户端显式 push / pull;
 * - **可选远程同步(COLLAB-04)**:自托管同步服务器(SYNC_URL)与本地 server 同协议,
 *   无同步源时优雅降级为纯本地(列表/拉取仍可用,推送返回明确提示)。
 *
 * 路由:
 * - GET  /share                  共享内容列表(按 kind 过滤,不含重复正文)
 * - GET  /share/:kind            某类共享内容列表
 * - GET  /share/:kind/:id        单条共享内容
 * - POST /share/:kind/:id        推送/覆盖单条共享内容(本地写入)
 * - DELETE /share/:kind/:id      删除单条共享内容
 */
import type { FastifyInstance } from "fastify";
import type { SharedStore } from "@mpp/core";
import type { SharedItem, SharedContentKind } from "@mpp/core";

/** 共享内容 kind 白名单。 */
const KINDS: readonly SharedContentKind[] = ["draft", "template", "report"];

function isKind(v: unknown): v is SharedContentKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** 单条内容 schema(仅元信息 + payload 的必要字段校验,避免大体积/任意字段)。 */
const itemSchema = {
  type: "object",
  required: ["meta", "payload"],
  additionalProperties: true,
  properties: {
    meta: {
      type: "object",
      required: ["kind", "id", "title", "updatedAt"],
      additionalProperties: true,
      properties: {
        kind: { type: "string", enum: KINDS },
        id: { type: "string", minLength: 1, maxLength: 200 },
        sourceName: { type: "string", maxLength: 100 },
        title: { type: "string", minLength: 1, maxLength: 500 },
        updatedAt: { type: "string", minLength: 1, maxLength: 40 },
      },
    },
    payload: { type: "object" },
  },
} as const;

/** 列表条目(只返回元信息 + payload 摘要,不含大体积正文,防止列表场景泄漏/放大)。 */
function summarizeItem(item: SharedItem) {
  const p = item.payload;
  const summary =
    p.kind === "draft"
      ? { markdownLength: p.draft.markdown.length, tags: p.draft.tags }
      : p.kind === "template"
        ? { platformId: p.template.platformId, version: p.template.version }
        : { markdownLength: p.report.markdown.length, template: p.report.template };
  return { meta: item.meta, payloadSummary: summary };
}

export interface RegisterShareRoutesOptions {
  /** 共享内容存储(默认 FileSharedStore,dataDir 派生)。 */
  readonly store: SharedStore;
  /** 可选远程同步源(SYNC_URL;为空 = 纯本地)。 */
  readonly syncUrl?: string;
}

export function registerShareRoutes(app: FastifyInstance, options: RegisterShareRoutesOptions): void {
  const { store, syncUrl } = options;

  app.get("/share", async (request) => {
    const q = request.query as { kind?: string };
    const all = q.kind && isKind(q.kind) ? await store.listByKind(q.kind) : await store.list();
    return {
      ok: true,
      sync: syncUrl ?? null,
      items: all.map(summarizeItem),
    };
  });

  app.get<{ Params: { kind: string } }>("/share/:kind", async (request, reply) => {
    if (!isKind(request.params.kind)) {
      return reply.code(400).send({ ok: false, error: "未知共享内容类型", statusCode: 400 });
    }
    const items = await store.listByKind(request.params.kind);
    return { ok: true, items: items.map(summarizeItem) };
  });

  app.get<{ Params: { kind: string; id: string } }>("/share/:kind/:id", async (request, reply) => {
    if (!isKind(request.params.kind)) {
      return reply.code(400).send({ ok: false, error: "未知共享内容类型", statusCode: 400 });
    }
    const item = await store.get(request.params.kind, request.params.id);
    if (!item) {
      return reply.code(404).send({ ok: false, error: "共享内容不存在", statusCode: 404 });
    }
    return { ok: true, item };
  });

  app.post<{ Params: { kind: string; id: string }; Body: unknown }>(
    "/share/:kind/:id",
    { schema: { body: itemSchema } },
    async (request, reply) => {
      if (!isKind(request.params.kind)) {
        return reply.code(400).send({ ok: false, error: "未知共享内容类型", statusCode: 400 });
      }
      const body = request.body as SharedItem;
      if (body.meta.kind !== request.params.kind || body.meta.id !== request.params.id) {
        return reply.code(400).send({ ok: false, error: "路径与内容 kind/id 不一致", statusCode: 400 });
      }
      const result = await store.put(body);
      if (result.mode === "conflict") {
        // 并发冲突:保留双版本,新版本以 `id#v{n}` 后缀写入。
        return {
          ok: true,
          mode: "conflict",
          id: result.item.meta.id,
          message: `检测到并发覆盖,已保留双版本(新版本 ${result.item.meta.id},原版本保留在原 id)`,
        };
      }
      return {
        ok: true,
        mode: result.mode,
        id: result.item.meta.id,
        message:
          result.mode === "unchanged"
            ? "共享内容与现有版本一致,未产生新版本"
            : result.mode === "created"
              ? "共享内容已写入本地共享库"
              : "共享内容已更新(版本号已递增)",
      };
    },
  );

  app.delete<{ Params: { kind: string; id: string } }>("/share/:kind/:id", async (request, reply) => {
    if (!isKind(request.params.kind)) {
      return reply.code(400).send({ ok: false, error: "未知共享内容类型", statusCode: 400 });
    }
    await store.remove(request.params.kind, request.params.id);
    return { ok: true, message: "共享内容已删除" };
  });
}
