import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { buildCertificationEnvironment } from "./certification-process-env";

export interface CertificationChildOptions {
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
  profile?: "stateful" | "stateless";
  cwd?: string;
}

export function spawnCertificationTsx(
  scriptPath: string,
  args: string[] = [],
  options: CertificationChildOptions = {},
): ChildProcess {
  const environment = buildCertificationEnvironment(
    process.env,
    options.env,
    options.profile ?? "stateful",
  );
  return spawn(
    process.execPath,
    [
      path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      scriptPath,
      ...args,
    ],
    {
      cwd: options.cwd ?? process.cwd(),
      env: environment,
      stdio: options.stdio ?? "inherit",
      detached: process.platform !== "win32",
    },
  );
}

export function waitForCertificationChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `Certification child failed (exit=${code ?? "null"}, signal=${signal ?? "none"}).`,
          ),
        );
      }
    });
  });
}

function signalOwnedProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
}

function ownedProcessTreeExists(child: ChildProcess): boolean {
  if (!child.pid) return false;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

export async function terminateCertificationChild(
  child: ChildProcess,
  options: { graceMs?: number } = {},
): Promise<void> {
  const graceMs = options.graceMs ?? 5_000;
  signalOwnedProcessTree(child, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (ownedProcessTreeExists(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (ownedProcessTreeExists(child)) {
    signalOwnedProcessTree(child, "SIGKILL");
    const killDeadline = Date.now() + 1_000;
    while (ownedProcessTreeExists(child) && Date.now() < killDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (ownedProcessTreeExists(child)) {
    throw new Error("Owned certification process group remained alive after SIGKILL.");
  }
}