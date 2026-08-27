import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { buildCertificationEnvironment } from "./certification-process-env";

export function spawnCertificationTsx(
  scriptPath: string,
  args: string[] = [],
): ChildProcess {
  return spawn(
    process.execPath,
    [
      path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      scriptPath,
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: buildCertificationEnvironment(),
      stdio: "inherit",
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