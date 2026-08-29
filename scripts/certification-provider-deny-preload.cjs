const http = require("node:http");
const https = require("node:https");

if (process.env.NODE_ENV !== "test" || process.env.VG_PROVIDER_DENY_MODE !== "1") {
  throw new Error("Certification descendant deny preload requires test deny mode.");
}

const allowedOrigins = new Set(
  (process.env.CERTIFICATION_ALLOWED_NETWORK_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const permitted = (url) =>
  (process.env.CERTIFICATION_ALLOW_LOOPBACK === "1" &&
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) ||
  allowedOrigins.has(url.origin);
const deny = (url) => {
  throw new Error(`Certification descendant network denied: ${url.origin}`);
};
const parse = (input, protocol) => {
  if (typeof input === "string" || input instanceof URL) return new URL(input);
  const host = input.hostname || input.host || "localhost";
  const port = input.port ? `:${input.port}` : "";
  return new URL(`${input.protocol || protocol}//${host}${port}${input.path || "/"}`);
};

const originalFetch = globalThis.fetch;
if (originalFetch) {
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!permitted(url)) deny(url);
    if (
      init &&
      (Object.prototype.hasOwnProperty.call(init, "dispatcher") ||
        Object.prototype.hasOwnProperty.call(init, "agent"))
    ) {
      throw new Error("Certification descendant custom fetch transport denied.");
    }
    return originalFetch(input, init);
  };
}
for (const [module, protocol] of [[http, "http:"], [https, "https:"]]) {
  const originalRequest = module.request.bind(module);
  module.request = (...args) => {
    const options = args[0] instanceof URL || typeof args[0] === "string" ? args[1] || {} : args[0] || {};
    if (options.createConnection || options.lookup || options.socketPath) {
      throw new Error("Certification descendant custom network connection denied.");
    }
    const url = parse(args[0], protocol);
    if (!permitted(url)) deny(url);
    if (args[0] instanceof URL || typeof args[0] === "string") {
      args[1] = { ...options, agent: false };
    } else {
      args[0] = { ...options, agent: false };
    }
    return originalRequest(...args);
  };
  module.get = (...args) => {
    const request = module.request(...args);
    request.end();
    return request;
  };
}