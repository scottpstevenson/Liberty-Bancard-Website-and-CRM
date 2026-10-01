import os from "node:os";
import path from "node:path";

export interface CertificationHttpContract {
  host: "0.0.0.0" | "127.0.0.1";
  reusePort: boolean;
  privateCertification: boolean;
  nonce: string | null;
}

interface CertificationEnvironment {
  [key: string]: string | undefined;
  NODE_ENV?: string;
  VG_PROVIDER_DENY_MODE?: string;
  DATABASE_URL?: string;
  TEST_DATABASE_URL?: string;
  CERTIFICATION_HTTP_HOST?: string;
  CERTIFICATION_HTTP_NONCE?: string;
}

interface ObservedListener {
  address: string;
  port: number;
  reusePort: boolean;
}

let observedListener: ObservedListener | null = null;

/**
 * A certification server is private only when it is tied to the same
 * provider-denied test database the disposable launcher created on its owned
 * local PostgreSQL socket. This parser deliberately rejects network databases,
 * credentials, extra connection parameters, and lookalike database names.
 */
export function isVerifiedPrivateDisposablePostgresUrl(env: CertificationEnvironment): boolean {
  if (
    env.NODE_ENV !== "test" ||
    env.VG_PROVIDER_DENY_MODE !== "1" ||
    !env.DATABASE_URL ||
    env.DATABASE_URL !== env.TEST_DATABASE_URL
  ) {
    return false;
  }

  try {
    const parsed = new URL(env.DATABASE_URL);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const socketPath = parsed.searchParams.get("host") ?? "";
    const portValues = parsed.searchParams.getAll("port");
    const hostValues = parsed.searchParams.getAll("host");
    const queryKeys = [...new Set([...parsed.searchParams.keys()])];
    const resolvedSocketPath = path.resolve(socketPath);
    const privateRoot = path.resolve(os.tmpdir()) + path.sep;
    const socketParent = path.basename(path.dirname(resolvedSocketPath));
    const socketPort = Number(portValues[0]);

    return (
      parsed.protocol === "postgresql:" &&
      parsed.hostname === "localhost" &&
      Boolean(parsed.username) &&
      !parsed.password &&
      !parsed.hash &&
      parsed.pathname === `/${databaseName}` &&
      /^test_sfp2060_[a-z0-9_]+$/.test(databaseName) &&
      hostValues.length === 1 &&
      portValues.length === 1 &&
      queryKeys.length === 2 &&
      queryKeys.every((key) => key === "host" || key === "port") &&
      resolvedSocketPath.startsWith(privateRoot) &&
      socketParent.startsWith("local-rehearsal-") &&
      Number.isInteger(socketPort) &&
      socketPort > 0 &&
      socketPort <= 65535
    );
  } catch {
    return false;
  }
}

/**
 * Keep ordinary development and production listener behavior unchanged. The
 * private loopback posture is enabled only by an exact host+nonce pair on a
 * strictly verified local disposable database.
 */
export function resolveCertificationHttpContract(env: CertificationEnvironment): CertificationHttpContract {
  const requestedHost = env.CERTIFICATION_HTTP_HOST;
  const nonce = env.CERTIFICATION_HTTP_NONCE;
  if (requestedHost === undefined && nonce === undefined) {
    return { host: "0.0.0.0", reusePort: true, privateCertification: false, nonce: null };
  }

  if (
    requestedHost === "127.0.0.1" &&
    typeof nonce === "string" &&
    /^[a-f0-9]{64}$/.test(nonce) &&
    isVerifiedPrivateDisposablePostgresUrl(env)
  ) {
    return { host: "127.0.0.1", reusePort: false, privateCertification: true, nonce };
  }

  throw new Error(
    "CERTIFICATION_HTTP_PRIVATE_POSTURE_REJECTED: loopback binding requires NODE_ENV=test, provider denial, a matching private disposable PostgreSQL socket URL, and a per-process nonce.",
  );
}

/** Capture the OS-reported address after listen() has completed successfully. */
export function recordCertificationHttpListener(
  address: string,
  port: number,
  reusePort: boolean,
): void {
  observedListener = { address, port, reusePort };
}

/**
 * These fields are intentionally absent from all normal health responses.
 * They are available only to the child that passed the strict private posture
 * check, and include the actual OS-bound address recorded after listen().
 */
export function certificationHttpReadinessFields(
  env: CertificationEnvironment,
): Record<string, string | number | boolean | null> {
  const contract = resolveCertificationHttpContract(env);
  if (!contract.privateCertification) return {};

  return {
    certificationHttpNonce: contract.nonce,
    certificationHttpListenerAddress: observedListener?.address ?? null,
    certificationHttpListenerPort: observedListener?.port ?? null,
    certificationHttpReusePort: observedListener?.reusePort ?? null,
  };
}