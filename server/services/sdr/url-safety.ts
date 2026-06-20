import { promises as dns } from "dns";

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "metadata.google.internal", "169.254.169.254",
]);

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

const PRIVATE_IPV6 = [
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^::$/,
];

function isPrivateAddress(addr: string): boolean {
  return (
    PRIVATE_IPV4.some(r => r.test(addr)) ||
    PRIVATE_IPV6.some(r => r.test(addr))
  );
}

export async function isSafeFetchTarget(rawUrl: string): Promise<boolean> {
  try {
    const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);

    if (!["http:", "https:"].includes(url.protocol)) return false;

    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

    if (BLOCKED_HOSTNAMES.has(hostname)) return false;

    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      if (isPrivateAddress(hostname)) return false;
      return true;
    }

    const addrs4 = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addrs6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const all = [...addrs4, ...addrs6];

    if (all.length === 0) return false;

    if (all.some(isPrivateAddress)) return false;

    return true;
  } catch {
    return false;
  }
}
