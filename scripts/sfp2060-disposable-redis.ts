import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import Redis from "ioredis";

export async function launchSfp2060DisposableRedis(env: NodeJS.ProcessEnv): Promise<{
  url: string;
  prefix: string;
  stop: () => Promise<void>;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "test-sfp2060-redis-"));
  await chmod(directory, 0o700);
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return server.close(() => reject(new Error("NO_REDIS_PORT")));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
  const child = spawn("redis-server", [
    "--bind", "127.0.0.1", "--port", String(port), "--save", "",
    "--appendonly", "no", "--dir", directory,
  ], {
    // The Nix Redis binary may not include the shell's configured UTF-8 locale.
    // Redis needs neither application variables nor any inherited credentials.
    env: {
      PATH: env.PATH,
      HOME: env.HOME,
      TMPDIR: env.TMPDIR,
      LANG: "C",
      LC_ALL: "C",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  let launchError: Error | undefined;
  child.once("error", error => { launchError = error; });
  const client = new Redis({
    host: "127.0.0.1", port, lazyConnect: true,
    maxRetriesPerRequest: 0, connectTimeout: 1000, retryStrategy: () => null,
  });
  client.on("error", () => { /* Connect errors are bounded and reported below. */ });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    client.disconnect();
    try {
      if (child.exitCode === null && child.signalCode === null && !launchError) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
          child.once("exit", () => { clearTimeout(timer); resolve(); });
          child.kill("SIGTERM");
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error("PRIVATE_REDIS_EXITED");
      try {
        await client.connect();
        if (await client.ping() === "PONG") {
          return {
            url: `redis://127.0.0.1:${port}`,
            prefix: `ci_sfp2060_${randomBytes(16).toString("hex")}_`,
            stop,
          };
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw new Error("PRIVATE_REDIS_NOT_READY");
  } catch (error) {
    await stop();
    throw error;
  }
}