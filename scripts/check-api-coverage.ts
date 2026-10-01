#!/usr/bin/env tsx
/**
 * Task #169 — API surface coverage check.
 *
 * Statically scans client request calls and mounted server route registrations.
 * Every comparison uses the exact HTTP method and normalized route shape.
 * No HTTP listeners or provider transports are used.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface ApiEndpoint {
  method: string;
  path: string;
}

export interface ApiCoverageAnalysis {
  clientEndpoints: ApiEndpoint[];
  serverEndpoints: ApiEndpoint[];
  missingEndpoints: ApiEndpoint[];
}

interface ParsedSource {
  file: string;
  ast: ts.SourceFile;
}

interface SourceIndex {
  repoRoot: string;
  clientFiles: string[];
  serverFiles: string[];
  parsed: Map<string, ParsedSource>;
}

interface ResolvedFunction {
  file: string;
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
}

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const SERVER_ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all"]);

function sourceRepoRootFromUrl(scriptUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), "..");
}

function sourceFiles(repoRoot: string, relativeDirectory: string): string[] {
  const directory = path.resolve(repoRoot, relativeDirectory);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`API_COVERAGE_SOURCE_DIRECTORY_MISSING: ${directory}`);
  }

  let listing: string;
  try {
    listing = execFileSync("rg", ["--files", relativeDirectory], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`API_COVERAGE_SOURCE_DISCOVERY_FAILED: ${relativeDirectory}: ${detail}`);
  }

  const files = listing
    .split(/\r?\n/)
    .filter((file) => SOURCE_EXTENSIONS.test(file))
    .map((file) => path.resolve(repoRoot, file));
  if (files.length === 0) {
    throw new Error(`API_COVERAGE_SOURCE_DISCOVERY_EMPTY: ${relativeDirectory}`);
  }
  return files;
}

function createSourceIndex(repoRoot: string): SourceIndex {
  const root = path.resolve(repoRoot);
  const clientFiles = sourceFiles(root, "client/src");
  const serverFiles = sourceFiles(root, "server");
  const routeBootstrap = path.resolve(root, "server/routes.ts");
  if (!existsSync(routeBootstrap) || !statSync(routeBootstrap).isFile()) {
    throw new Error(`API_COVERAGE_ROUTE_BOOTSTRAP_MISSING: ${routeBootstrap}`);
  }
  return { repoRoot: root, clientFiles, serverFiles, parsed: new Map() };
}

function parseSource(index: SourceIndex, file: string): ParsedSource {
  const absolute = path.resolve(file);
  const cached = index.parsed.get(absolute);
  if (cached) return cached;
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`API_COVERAGE_SOURCE_FILE_MISSING: ${absolute}`);
  }
  const source = readFileSync(absolute, "utf8");
  const extension = path.extname(absolute).toLowerCase();
  const scriptKind =
    extension === ".tsx" ? ts.ScriptKind.TSX :
      extension === ".jsx" ? ts.ScriptKind.JSX :
        extension === ".js" || extension === ".mjs" || extension === ".cjs" ? ts.ScriptKind.JS :
          ts.ScriptKind.TS;
  const parsed = {
    file: absolute,
    ast: ts.createSourceFile(absolute, source, ts.ScriptTarget.Latest, true, scriptKind),
  };
  index.parsed.set(absolute, parsed);
  return parsed;
}

function walk(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  node.forEachChild((child) => walk(child, callback));
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function resolveModuleFile(index: SourceIndex, importer: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else if (specifier.startsWith("@shared/")) {
    base = path.resolve(index.repoRoot, "shared", specifier.slice("@shared/".length));
  } else if (specifier.startsWith("@/")) {
    base = path.resolve(index.repoRoot, "client/src", specifier.slice(2));
  } else {
    return undefined;
  }

  const candidates = path.extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.jsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
        path.join(base, "index.js"),
        path.join(base, "index.jsx"),
      ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function importBinding(
  source: ts.SourceFile,
  localName: string,
): { moduleSpecifier: string; importedName: string } | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name?.text === localName) {
      return { moduleSpecifier: statement.moduleSpecifier.text, importedName: "default" };
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      const specifier = clause.namedBindings.elements.find((element) => element.name.text === localName);
      if (specifier) {
        return {
          moduleSpecifier: statement.moduleSpecifier.text,
          importedName: specifier.propertyName?.text ?? specifier.name.text,
        };
      }
    }
  }
  return undefined;
}

function findVariableInitializer(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let result: ts.Expression | undefined;
  walk(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== name || !node.initializer) return;
    result = node.initializer;
  });
  return result;
}

function resolveExportedValue(
  index: SourceIndex,
  file: string,
  exportName: string,
  seen: Set<string>,
): unknown {
  const key = `${file}#${exportName}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const source = parseSource(index, file).ast;

  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName && declaration.initializer) {
          return resolveStaticValue(index, file, declaration.initializer, seen);
        }
      }
    }
    if (ts.isExportAssignment(statement) && exportName === "default") {
      return resolveStaticValue(index, file, statement.expression, seen);
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      const specifier = clause.elements.find((element) => element.name.text === exportName);
      if (!specifier) continue;
      const originalName = specifier.propertyName?.text ?? specifier.name.text;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const importedFile = resolveModuleFile(index, file, statement.moduleSpecifier.text);
        if (importedFile) return resolveExportedValue(index, importedFile, originalName, seen);
      } else {
        return resolveStaticValue(index, file, ts.factory.createIdentifier(originalName), seen);
      }
    } else if (!clause && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const exportedFile = resolveModuleFile(index, file, statement.moduleSpecifier.text);
      if (exportedFile) {
        const value = resolveExportedValue(index, exportedFile, exportName, seen);
        if (value !== undefined) return value;
      }
    }
  }
  return undefined;
}

function resolveStaticValue(
  index: SourceIndex,
  file: string,
  expression: ts.Expression,
  seen = new Set<string>(),
): unknown {
  const node = unwrap(expression);
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);

  if (ts.isIdentifier(node)) {
    const key = `${file}#local:${node.text}`;
    if (seen.has(key)) return undefined;
    const nested = new Set(seen).add(key);
    const source = parseSource(index, file).ast;
    const initializer = findVariableInitializer(source, node.text);
    if (initializer) return resolveStaticValue(index, file, initializer, nested);

    const binding = importBinding(source, node.text);
    if (binding) {
      const importedFile = resolveModuleFile(index, file, binding.moduleSpecifier);
      if (importedFile) return resolveExportedValue(index, importedFile, binding.importedName, nested);
    }
    return undefined;
  }

  if (ts.isPropertyAccessExpression(node)) {
    const base = resolveStaticValue(index, file, node.expression, seen);
    if (base && typeof base === "object" && node.name.text in (base as Record<string, unknown>)) {
      return (base as Record<string, unknown>)[node.name.text];
    }
    return undefined;
  }

  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    const base = resolveStaticValue(index, file, node.expression, seen);
    const property = resolveStaticValue(index, file, node.argumentExpression, seen);
    if (base && typeof base === "object" && typeof property === "string") {
      return (base as Record<string, unknown>)[property];
    }
    return undefined;
  }

  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = propertyNameText(property.name);
        if (name !== undefined) value[name] = resolveStaticValue(index, file, property.initializer, seen);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        value[property.name.text] = resolveStaticValue(index, file, property.name, seen);
      }
    }
    return value;
  }

  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const interpolation = resolveStaticValue(index, file, span.expression, seen);
      value += typeof interpolation === "string" || typeof interpolation === "number" ? String(interpolation) : ":param";
      value += span.literal.text;
    }
    return value;
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStaticValue(index, file, node.left, seen);
    const right = resolveStaticValue(index, file, node.right, seen);
    if ((typeof left === "string" || typeof left === "number") &&
        (typeof right === "string" || typeof right === "number")) {
      return `${left}${right}`;
    }
    return undefined;
  }

  if (ts.isCallExpression(node)) {
    const callee = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : "";
    if (["encodeURIComponent", "encodeURI", "String"].includes(callee)) return ":param";
    if (callee === "buildUrl" && node.arguments[0]) {
      return resolveStaticValue(index, file, node.arguments[0], seen);
    }
  }
  return undefined;
}

function normalizePath(value: string): string {
  const withoutQuery = value.trim().split(/[?#]/, 1)[0];
  const collapsed = withoutQuery.replace(/\/{2,}/g, "/");
  const normalizedParams = collapsed
    .replace(/\$\{[^}]*\}/g, ":param")
    .replace(/:[A-Za-z_$][\w$]*/g, ":param");
  const noTrailingSlash = normalizedParams.replace(/\/+$/, "");
  return noTrailingSlash || "/";
}

function normalizeMethod(value: unknown, fallback = "GET"): string {
  if (typeof value !== "string") return fallback;
  const method = value.trim().toUpperCase();
  return HTTP_METHODS.has(method) ? method : fallback;
}

function apiPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const pathValue = normalizePath(value);
  return pathValue.startsWith("/api/") ? pathValue : undefined;
}

function requestMethod(index: SourceIndex, file: string, options: ts.Expression | undefined): string {
  if (!options) return "GET";
  const resolvedOptions = resolveStaticValue(index, file, options);
  if (resolvedOptions && typeof resolvedOptions === "object") {
    return normalizeMethod((resolvedOptions as Record<string, unknown>).method);
  }
  if (!ts.isObjectLiteralExpression(unwrap(options))) return "GET";
  const object = unwrap(options) as ts.ObjectLiteralExpression;
  const methodProperty = object.properties.find((property) =>
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
    propertyNameText(property.name) === "method",
  );
  if (methodProperty && ts.isPropertyAssignment(methodProperty)) {
    return normalizeMethod(resolveStaticValue(index, file, methodProperty.initializer));
  }
  if (methodProperty && ts.isShorthandPropertyAssignment(methodProperty)) {
    return normalizeMethod(resolveStaticValue(index, file, methodProperty.name));
  }
  return "GET";
}

function clientEndpoints(index: SourceIndex): ApiEndpoint[] {
  const endpoints = new Map<string, ApiEndpoint>();
  for (const file of index.clientFiles) {
    const source = parseSource(index, file).ast;
    walk(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      let calleeName: string | undefined;
      if (ts.isIdentifier(node.expression)) calleeName = node.expression.text;
      else if (ts.isPropertyAccessExpression(node.expression)) calleeName = node.expression.name.text;
      if (!node.arguments.length) return;

      let method: string;
      let pathArgument: ts.Expression | undefined;
      if (calleeName === "apiRequest") {
        method = normalizeMethod(resolveStaticValue(index, file, node.arguments[0]));
        pathArgument = node.arguments[1];
      } else if (calleeName === "fetch") {
        method = requestMethod(index, file, node.arguments[1]);
        pathArgument = node.arguments[0];
      } else {
        return;
      }

      if (!pathArgument) return;
      const endpointPath = apiPath(resolveStaticValue(index, file, pathArgument));
      if (!endpointPath) return;
      const endpoint = { method, path: endpointPath };
      endpoints.set(endpointKey(endpoint), endpoint);
    });
  }
  return [...endpoints.values()].sort(compareEndpoints);
}

function endpointKey(endpoint: ApiEndpoint): string {
  return `${endpoint.method} ${endpoint.path}`;
}

function compareEndpoints(left: ApiEndpoint, right: ApiEndpoint): number {
  return endpointKey(left).localeCompare(endpointKey(right));
}

function isExported(node: ts.Node): boolean {
  return !!(node as ts.HasModifiers).modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function functionByName(source: ts.SourceFile, name: string, requireExport = false): ResolvedFunction | undefined {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name &&
        (!requireExport || isExported(statement))) {
      return { file: source.fileName, node: statement };
    }
    if (!ts.isVariableStatement(statement)) continue;
    if (requireExport && !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
      const initializer = unwrap(declaration.initializer);
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        return { file: source.fileName, node: initializer };
      }
    }
  }
  return undefined;
}

function resolveExportedFunction(
  index: SourceIndex,
  file: string,
  exportName: string,
  seen = new Set<string>(),
): ResolvedFunction | undefined {
  const key = `${file}#${exportName}`;
  if (seen.has(key)) return undefined;
  const nextSeen = new Set(seen).add(key);
  const source = parseSource(index, file).ast;
  const direct = functionByName(source, exportName, true);
  if (direct) return direct;

  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const exported = statement.exportClause.elements.find((element) => element.name.text === exportName);
      if (!exported) continue;
      const originalName = exported.propertyName?.text ?? exported.name.text;
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveModuleFile(index, file, statement.moduleSpecifier.text);
        if (target) {
          const found = resolveExportedFunction(index, target, originalName, nextSeen);
          if (found) return found;
        }
      } else {
        const local = functionByName(source, originalName);
        if (local) return local;
        const binding = importBinding(source, originalName);
        const target = binding && resolveModuleFile(index, file, binding.moduleSpecifier);
        if (binding && target) {
          const found = resolveExportedFunction(index, target, binding.importedName, nextSeen);
          if (found) return found;
        }
      }
    } else if (!statement.exportClause && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolveModuleFile(index, file, statement.moduleSpecifier.text);
      if (target) {
        const found = resolveExportedFunction(index, target, exportName, nextSeen);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function importedFunction(index: SourceIndex, file: string, localName: string): ResolvedFunction | undefined {
  const source = parseSource(index, file).ast;
  const local = functionByName(source, localName);
  if (local) return local;
  const binding = importBinding(source, localName);
  if (!binding) return undefined;
  const target = resolveModuleFile(index, file, binding.moduleSpecifier);
  if (!target) return undefined;
  return resolveExportedFunction(index, target, binding.importedName);
}

function callProperty(call: ts.CallExpression): { receiver: string; method: string } | undefined {
  const expression = unwrap(call.expression as ts.Expression);
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) return undefined;
  return { receiver: expression.expression.text, method: expression.name.text.toLowerCase() };
}

function callArguments(call: ts.CallExpression): ts.Expression[] {
  return call.arguments.filter((argument): argument is ts.Expression => !ts.isSpreadElement(argument));
}

function routerVariableNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  walk(node, (child) => {
    if (!ts.isVariableDeclaration(child) || !ts.isIdentifier(child.name) || !child.initializer) return;
    const initializer = unwrap(child.initializer);
    if (!ts.isCallExpression(initializer)) return;
    const expression = initializer.expression;
    const methodName = ts.isIdentifier(expression)
      ? expression.text
      : ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : "";
    if (methodName === "Router") names.add(child.name.text);
  });
  return names;
}

function composeRoutePath(prefix: string, childPath: string): string {
  const child = normalizePath(childPath);
  if (child.startsWith("/api/") || child === "/api") return child;
  if (!prefix) return child;
  return normalizePath(`${prefix.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`);
}

function resolvePathArgument(index: SourceIndex, file: string, expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;
  const value = resolveStaticValue(index, file, expression);
  return typeof value === "string" ? normalizePath(value) : undefined;
}

function serverEndpoints(index: SourceIndex): ApiEndpoint[] {
  const bootstrapFile = path.resolve(index.repoRoot, "server/routes.ts");
  const bootstrap = parseSource(index, bootstrapFile).ast;
  const rootRegistration = functionByName(bootstrap, "registerRoutes", true);
  if (!rootRegistration) {
    throw new Error("API_COVERAGE_ROUTE_BOOTSTRAP_INVALID: registerRoutes export is missing");
  }

  const endpoints = new Map<string, ApiEndpoint>();
  const visited = new Set<string>();

  const visitRegistration = (resolved: ResolvedFunction, inheritedPrefix: string): void => {
    const visitKey = `${resolved.file}#${resolved.node.pos}#${inheritedPrefix}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const source = parseSource(index, resolved.file).ast;
    const appNames = new Set(
      resolved.node.parameters
        .map((parameter) => parameter.name)
        .filter((name): name is ts.Identifier => ts.isIdentifier(name))
        .map((name) => name.text),
    );
    const routers = routerVariableNames(resolved.node.body ?? resolved.node);
    const routerPrefixes = new Map<string, Set<string>>();
    for (const router of routers) routerPrefixes.set(router, new Set());

    const calls: ts.CallExpression[] = [];
    walk(resolved.node.body ?? resolved.node, (node) => {
      if (ts.isCallExpression(node)) calls.push(node);
    });

    // Resolve mounted local routers first, including nested router mounts.
    for (let pass = 0; pass < Math.max(routers.size, 1); pass++) {
      let changed = false;
      for (const call of calls) {
        const access = callProperty(call);
        const args = callArguments(call);
        if (!access || access.method !== "use" || !args.length) continue;
        const receiverIsApp = appNames.has(access.receiver);
        const receiverPrefixes = receiverIsApp
          ? new Set([inheritedPrefix])
          : routerPrefixes.get(access.receiver);
        if (!receiverPrefixes) continue;

        const mountPath = args.length > 1 ? resolvePathArgument(index, resolved.file, args[0]) : "";
        const mountedRouter = args.length > 1 && ts.isIdentifier(unwrap(args[1]))
          ? unwrap(args[1]) as ts.Identifier
          : ts.isIdentifier(unwrap(args[0]))
            ? unwrap(args[0]) as ts.Identifier
            : undefined;
        if (!mountedRouter || !routerPrefixes.has(mountedRouter.text)) continue;
        for (const prefix of receiverPrefixes) {
          const nextPrefix = mountPath ? composeRoutePath(prefix, mountPath) : prefix;
          const prefixes = routerPrefixes.get(mountedRouter.text)!;
          if (!prefixes.has(nextPrefix)) {
            prefixes.add(nextPrefix);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    for (const call of calls) {
      const access = callProperty(call);
      const args = callArguments(call);
      if (access && SERVER_ROUTE_METHODS.has(access.method) && args.length) {
        const rawPath = resolvePathArgument(index, resolved.file, args[0]);
        if (!rawPath) continue;
        let prefixes: Set<string> | undefined;
        if (appNames.has(access.receiver)) prefixes = new Set([inheritedPrefix]);
        else prefixes = routerPrefixes.get(access.receiver);
        if (!prefixes) continue;

        for (const prefix of prefixes) {
          const registeredPath = composeRoutePath(prefix, rawPath);
          if (!registeredPath.startsWith("/api/")) continue;
          const method = access.method === "all" ? "ALL" : access.method.toUpperCase();
          const endpoint = { method, path: registeredPath };
          endpoints.set(endpointKey(endpoint), endpoint);
        }
      }

      // Follow only route-registration functions actually invoked by the
      // mounted registration module, resolving imports and barrel exports.
      // setupAuth is also an explicit route installer called by registerRoutes.
      const callee = unwrap(call.expression as ts.Expression);
      if (!ts.isIdentifier(callee) || (!/Routes$/.test(callee.text) && callee.text !== "setupAuth")) continue;
      const nested = importedFunction(index, resolved.file, callee.text);
      if (!nested) {
        throw new Error(
          `API_COVERAGE_ROUTE_MODULE_UNRESOLVED: ${callee.text} referenced from ${resolved.file}`,
        );
      }

      const firstArgument = args[0] ? unwrap(args[0]) : undefined;
      let prefixes: Set<string>;
      if (firstArgument && ts.isIdentifier(firstArgument) && appNames.has(firstArgument.text)) {
        prefixes = new Set([inheritedPrefix]);
      } else if (firstArgument && ts.isIdentifier(firstArgument) && routerPrefixes.has(firstArgument.text)) {
        prefixes = routerPrefixes.get(firstArgument.text)!;
      } else {
        prefixes = new Set([inheritedPrefix]);
      }
      for (const prefix of prefixes) visitRegistration(nested, prefix);
    }
  };

  visitRegistration(rootRegistration, "");
  if (endpoints.size === 0) {
    throw new Error("API_COVERAGE_SERVER_DISCOVERY_EMPTY: no mounted /api route handlers were discovered");
  }
  return [...endpoints.values()].sort(compareEndpoints);
}

export function endpointMatches(client: ApiEndpoint, server: ApiEndpoint): boolean {
  if (server.method !== "ALL" && client.method !== server.method) return false;
  const clientParts = normalizePath(client.path).split("/");
  const serverParts = normalizePath(server.path).split("/");
  if (clientParts.length !== serverParts.length) return false;
  return clientParts.every((segment, index) => {
    const registered = serverParts[index];
    return segment === registered || segment.startsWith(":") || registered.startsWith(":");
  });
}

export function analyzeApiCoverage(repoRoot: string): ApiCoverageAnalysis {
  const index = createSourceIndex(repoRoot);
  const clients = clientEndpoints(index);
  if (clients.length === 0) {
    throw new Error("API_COVERAGE_CLIENT_DISCOVERY_EMPTY: no client fetch/apiRequest calls to /api endpoints were discovered");
  }
  const servers = serverEndpoints(index);
  if (servers.length === 0) {
    throw new Error("API_COVERAGE_SERVER_DISCOVERY_EMPTY: no mounted /api route handlers were discovered");
  }
  const missing = clients.filter((client) => !servers.some((server) => endpointMatches(client, server)));
  return { clientEndpoints: clients, serverEndpoints: servers, missingEndpoints: missing };
}

// Historical client calls with no server handler. Keep exceptions exact to
// method + normalized route; a new method mismatch on one of these paths must
// not be silently accepted.
const KNOWN_MISMATCHES = new Set<string>([]);

function main(): void {
  const repoRoot = sourceRepoRootFromUrl(import.meta.url);
  const analysis = analyzeApiCoverage(repoRoot);
  const knownMissing = analysis.missingEndpoints.filter((endpoint) => KNOWN_MISMATCHES.has(endpointKey(endpoint)));
  const newMissing = analysis.missingEndpoints.filter((endpoint) => !KNOWN_MISMATCHES.has(endpointKey(endpoint)));

  console.log(
    `Scanned ${analysis.clientEndpoints.length} client API endpoints against ${analysis.serverEndpoints.length} server handlers.`,
  );
  if (knownMissing.length > 0) {
    console.warn(`! ${knownMissing.length} pre-existing unmatched method/path endpoint(s):`);
    for (const endpoint of knownMissing) console.warn(`  - ${endpointKey(endpoint)}`);
  }
  if (newMissing.length === 0) {
    console.log("✓ No NEW client method/path endpoints without a matching server handler.");
    return;
  }
  console.error(`✗ ${newMissing.length} NEW client method/path endpoints have no matching server handler:`);
  for (const endpoint of newMissing) console.error(`  - ${endpointKey(endpoint)}`);
  console.error("Either implement the server handler, remove the client call, or add the exact endpoint to KNOWN_MISMATCHES with justification.");
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}