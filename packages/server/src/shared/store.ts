/**
 * v4 Phase 3 · COLLAB-01 共享内容服务器存储 —— 版本化 JSON 落盘。
 *
 * 实现已下沉到 core(`@mpp/core/collab/file-store`),供 server 与桌面端 bridge 复用:
 * - 版本化 JSON + 原子写(tmp + rename,崩溃不产生半写文件);
 * - 损坏检测:JSON 解析失败 / 记录不符 schema → 明确报错,不静默清空;
 * - 保留策略:每类共享内容上限(SHARED_ITEMS_PER_KIND_MAX),超出裁剪最旧;
 * - 目录可配置(经 config.dataDir 派生),进程重启后从磁盘完整重建共享库;
 * - **版本化冲突合并**:同 id 并发覆盖时保留双版本(见 core `mergeSharedItem`)。
 */
export { FileSharedStore, SharedStoreFileError } from "@mpp/core/collab/file-store";
