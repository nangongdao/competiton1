import { pathToFileURL } from "node:url";
import { buildRunnerApp } from "./server.js";
import { loadRunnerConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadRunnerConfig();
  const app = await buildRunnerApp({ config });
  await app.listen({ port: config.port, host: "127.0.0.1" });
  // 启动时打印配对提示(仅 stdout,不进结构化日志):用户把该 token 填入扩展设置。
  if (config.authEnabled) {
    // eslint-disable-next-line no-console
    console.log(`[mpp-runner] automation runner listening at http://127.0.0.1:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(
      `[mpp-runner] 鉴权已启用:请把下面这行 token 填入扩展设置 Runner 访问令牌:`,
    );
    // eslint-disable-next-line no-console
    console.log(`[mpp-runner] X-MPP-Token: ${config.token}`);
  } else {
    app.log.info(`automation runner listening at http://127.0.0.1:${config.port}(鉴权关闭)`);
  }
}

// 仅在作为主入口执行时启动 runner;被测试/其它模块 import 时不产生副作用。
const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
