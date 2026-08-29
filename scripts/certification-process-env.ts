/**
 * Explicit environment boundary for disposable certification processes.
 *
 * Do not broaden this list to "all non-secret variables": an explicit list is
 * what prevents a newly-added provider credential from reaching a child process.
 */
const CERTIFICATION_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "CI",
  "GITHUB_ACTIONS",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_ATTEMPT",
  "NODE_ENV",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "REDIS_URL",
  "TEST_REDIS_PREFIX",
  "REDIS_KEY_PREFIX",
  "REDIS_PREFIX",
  "BASE_URL",
  "PORT",
  "HOST",
  "ALLOWED_ORIGINS",
  "SESSION_SECRET",
  "CREDENTIAL_ENCRYPTION_KEY",
  "MERCHANT_DATA_ENCRYPTION_KEY",
  "ADMIN_SEED_EMAIL",
  "ADMIN_SEED_PASSWORD",
  "ADMIN_SEED_FORCE_UPDATE",
  "TEST_USER_EMAIL",
  "TEST_USER_PASSWORD",
  "GHL_TRANSPORT_FAILFAST",
  "SUNBIZ_ENRICHMENT_ENABLED",
  "SERPER_GATEWAY_ENABLED",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "VG_PROVIDER_DENY_MODE",
  "INTEGRATION_TESTS_OPT_IN",
  "TEST_APPROVED_DB_NAME",
  "RELEASE_SHA",
  "CI_SUITE_TIMEOUT_MS",
] as const;

const CERTIFICATION_DECLARED_OVERRIDE_ALLOWLIST = new Set([
  "AUTH_ACTION_DB_TEST_OPT_IN",
  "CERTIFICATION_RUN_ID",
  "CERTIFICATION_SUITE_ID",
  "CERTIFICATION_RECEIPT_PATH",
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_CACHE",
  "TEST_REDIS_PREFIX",
  "NODE_OPTIONS",
  "CERTIFICATION_ALLOWED_NETWORK_ORIGINS",
  "CERTIFICATION_ALLOW_LOOPBACK",
]);

export function buildCertificationEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  declaredOverrides: NodeJS.ProcessEnv = {},
  profile: "stateful" | "stateless" = "stateful",
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of CERTIFICATION_ENV_ALLOWLIST) {
    if (
      profile === "stateless" &&
      /^(?:DATABASE_URL|TEST_DATABASE_URL|REDIS_URL|TEST_REDIS_PREFIX|SESSION_SECRET|CREDENTIAL_ENCRYPTION_KEY|MERCHANT_DATA_ENCRYPTION_KEY|ADMIN_|TEST_USER_)/.test(key)
    ) {
      continue;
    }
    if (source[key] !== undefined) environment[key] = source[key];
  }
  for (const [key, value] of Object.entries(declaredOverrides)) {
    if (!CERTIFICATION_DECLARED_OVERRIDE_ALLOWLIST.has(key)) {
      throw new Error(`Undeclared certification child environment override: ${key}`);
    }
    if (value !== undefined) environment[key] = value;
  }

  // These are invariants, not caller-controlled values.
  environment.NODE_ENV = "test";
  environment.VG_PROVIDER_DENY_MODE = "1";
  environment.GHL_TRANSPORT_FAILFAST = "true";
  environment.SUNBIZ_ENRICHMENT_ENABLED = "false";
  environment.SERPER_GATEWAY_ENABLED = "false";
  return environment;
}

export function replaceWithCertificationEnvironment(): NodeJS.ProcessEnv {
  const declaredOverrides: NodeJS.ProcessEnv = {};
  for (const key of CERTIFICATION_DECLARED_OVERRIDE_ALLOWLIST) {
    if (process.env[key] !== undefined) declaredOverrides[key] = process.env[key];
  }
  const environment = buildCertificationEnvironment(process.env, declaredOverrides);
  process.env = environment;
  return environment;
}