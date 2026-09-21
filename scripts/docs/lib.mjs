import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DOCS_DIR = 'docs';
export const MARKER_GENERATOR = 'scripts/docs/generate.mjs';
export const MANIFEST_SCHEMA_VERSION = 'pi-background-tasks.docs-manifest.v2';
export const ATTESTATIONS_PATH = 'docs/attestations.json';
export const ATTESTATIONS_SCHEMA_VERSION = 'pi-background-tasks.docs-attestations.v1';
export const ATTESTATION_RECEIPT_SCHEMA_VERSION = 'pi-background-tasks.docs-attestation.v1';

const require = createRequire(import.meta.url);
const FRONTMATTER_FENCE = '---';
const FRONTMATTER_KEYS = [
  'doc_id',
  'audience',
  'mode',
  'review_policy',
  'stability',
  'covers_surfaces',
  'covers_sources',
];
const ALLOWED_AUDIENCE = ['user', 'agent', 'maintainer'];
const ALLOWED_MODE = ['generated', 'authored', 'mixed'];
const ALLOWED_REVIEW = ['contract', 'behavioral'];
const ALLOWED_STABILITY = ['stable', 'evolving', 'frozen'];
const PUBLIC_KINDS = ['command', 'tool', 'shortcut', 'renderer', 'eventbus', 'workflow'];
const DOCS_FEATURE_VALUES = ['process', 'delegate', 'fusion', 'attested', 'attribution'];
const DOCS_DEFAULT_FEATURES = ['process', 'delegate', 'fusion', 'attested', 'attribution'];
const DOCS_DOCK_SHORTCUT_VALUES = ['shift+down', 'ctrl+alt+b', 'off'];
const DOCS_DEFAULT_DOCK_SHORTCUT = 'shift+down';
const ALWAYS_AVAILABLE = 'always';
const ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL = 'pi-anthropic-attribution:claim:v1';
const ANTHROPIC_ATTRIBUTION_CLAIM_SCHEMA = 'pi-anthropic-attribution.claim.v1';
const EXCLUDED_PARENT_TOOL_NAMES = new Set(['delegate_read_artifact', 'fusion_web_fetch']);
const ROOT_MARKDOWN_RELS = [
  'README.md',
  'BACKGROUND-TASKS-INSTRUCTIONS.md',
  'TESTING.md',
  'TEST_PLAN.md',
  'PUBLISHING.md',
];
const GENERATED_DOC_OVERRIDES = new Map([
  [
    'docs/INDEX.md',
    {
      doc_id: 'INDEX',
      audience: 'user',
      mode: 'generated',
      review_policy: 'contract',
      stability: 'stable',
      covers_surfaces: [],
      covers_sources: [],
    },
  ],
  [
    'docs/read-before-edit.md',
    {
      doc_id: 'read-before-edit',
      audience: 'agent',
      mode: 'generated',
      review_policy: 'contract',
      stability: 'stable',
      covers_surfaces: [],
      covers_sources: [],
    },
  ],
]);

export class DocsGateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocsGateError';
  }
}

export function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function sha256Buffer(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function toPosix(path) {
  return path.split(sep).join('/');
}

export function packagePath(root, rel) {
  return resolve(root, rel);
}

function readJson(root, rel) {
  try {
    return JSON.parse(readFileSync(packagePath(root, rel), 'utf8'));
  } catch (error) {
    throw new DocsGateError(`${rel} is not readable JSON: ${error.message}`);
  }
}

function loadTypeScript() {
  try {
    return require('typescript');
  } catch (error) {
    throw new DocsGateError(`typescript is required for docs AST extraction: ${error.message}`);
  }
}

function lineOf(sourceFile, node, ts) {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName}:${String(pos.line + 1)}`;
}

function lineForText(root, rel, needle) {
  const lines = readFileSync(packagePath(root, rel), 'utf8').split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  return index >= 0 ? `${rel}:${String(index + 1)}` : `${rel}:1`;
}

function lineForLiteral(ts, root, rel, literal) {
  const info = moduleInfo(ts, root, rel, new Map());
  let found;
  const visit = (node) => {
    if (found) return;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && (node.text === literal || node.text.includes(literal))) {
      found = lineOf(info.sf, node, ts);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      if (node.head.text.includes(literal) || node.templateSpans.some((span) => span.literal.text.includes(literal))) {
        found = lineOf(info.sf, node, ts);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(info.sf);
  return found ?? `${rel}:1`;
}

function walkFiles(root, relDir, predicate = () => true) {
  const abs = packagePath(root, relDir);
  if (!existsSync(abs)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.pi') continue;
        walk(full);
      } else if (predicate(full)) {
        out.push(toPosix(relative(root, full)));
      }
    }
  };
  walk(abs);
  return out.sort();
}

function markdownDocs(root) {
  return walkFiles(root, DOCS_DIR, (f) => f.endsWith('.md'));
}

function resolveTsModule(root, fromRel, specifier) {
  if (!specifier.startsWith('.')) return null;
  const fromDir = dirname(packagePath(root, fromRel));
  const raw = resolve(fromDir, specifier);
  const candidates = [];
  if (raw.endsWith('.js')) candidates.push(`${raw.slice(0, -3)}.ts`);
  if (raw.endsWith('.mjs')) candidates.push(`${raw.slice(0, -4)}.ts`);
  candidates.push(raw, `${raw}.ts`, join(raw, 'index.ts'));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return toPosix(relative(root, candidate));
  }
  throw new DocsGateError(`${fromRel} imports ${specifier}, but no TypeScript source candidate exists`);
}

function parseTs(ts, root, rel) {
  const text = readFileSync(packagePath(root, rel), 'utf8');
  return { text, sf: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
}

function moduleInfo(ts, root, rel, cache) {
  if (cache.has(rel)) return cache.get(rel);
  const { text, sf } = parseTs(ts, root, rel);
  const imports = new Map();
  const externalImports = new Map();
  const exportedFunctions = new Map();
  const localFunctions = new Map();
  const defaultFunction = { node: null };
  const constDecls = new Map();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      const target = resolveTsModule(root, rel, specifier);
      if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
        for (const spec of stmt.importClause.namedBindings.elements) {
          const local = spec.name.text;
          const exported = spec.propertyName?.text ?? spec.name.text;
          if (target !== null) imports.set(local, { rel: target, exported });
          else externalImports.set(local, { specifier, exported });
        }
      }
      if (stmt.importClause?.name) {
        if (target !== null) imports.set(stmt.importClause.name.text, { rel: target, exported: 'default' });
        else externalImports.set(stmt.importClause.name.text, { specifier, exported: 'default' });
      }
    }
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const target = resolveTsModule(root, rel, stmt.moduleSpecifier.text);
      if (target === null) continue;
      if (stmt.exportClause === undefined) imports.set('default', { rel: target, exported: 'default' });
      else if (ts.isNamedExports(stmt.exportClause)) {
        for (const spec of stmt.exportClause.elements) imports.set(spec.name.text, { rel: target, exported: spec.propertyName?.text ?? spec.name.text });
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      localFunctions.set(stmt.name.text, stmt);
      const isExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (isExport) exportedFunctions.set(stmt.name.text, stmt);
      if (isDefault) defaultFunction.node = stmt;
    }
    if (ts.isVariableStatement(stmt)) {
      const isExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) constDecls.set(decl.name.text, { expr: decl.initializer, exported: isExport });
      }
    }
  }
  const unwrapDynamicImport = (initializer) => {
    let current = initializer;
    while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression?.(current)) current = current.expression;
    if (!ts.isCallExpression(current) || current.expression.kind !== ts.SyntaxKind.ImportKeyword || current.arguments.length !== 1 || !ts.isStringLiteral(current.arguments[0])) return undefined;
    return current.arguments[0].text;
  };
  const scanDynamicImports = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const specifier = unwrapDynamicImport(node.initializer);
      if (specifier !== undefined) {
        const target = resolveTsModule(root, rel, specifier);
        if (target === null) throw new DocsGateError(`${lineOf(sf, node, ts)} registration-bearing dynamic import must target package source`);
        for (const element of node.name.elements) {
          if (element.dotDotDotToken || !ts.isIdentifier(element.name)) throw new DocsGateError(`${lineOf(sf, element, ts)} dynamic registration import must use explicit identifier bindings`);
          const exported = element.propertyName
            ? ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)
              ? element.propertyName.text
              : undefined
            : element.name.text;
          if (exported === undefined) throw new DocsGateError(`${lineOf(sf, element, ts)} dynamic registration import has an unsupported property name`);
          const existing = imports.get(element.name.text);
          if (existing !== undefined && (existing.rel !== target || existing.exported !== exported)) throw new DocsGateError(`${lineOf(sf, element, ts)} dynamic registration import shadows ${element.name.text}`);
          imports.set(element.name.text, { rel: target, exported });
        }
      }
    }
    ts.forEachChild(node, scanDynamicImports);
  };
  scanDynamicImports(sf);

  const info = { rel, text, sf, imports, externalImports, exportedFunctions, localFunctions, defaultFunction, constDecls };
  cache.set(rel, info);
  return info;
}

function stripAsConst(ts, expr) {
  let current = expr;
  while (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression?.(current)) current = current.expression;
  return current;
}

function externalValue(specifier, exported) {
  if (specifier === '@earendil-works/pi-coding-agent') {
    if (exported === 'DEFAULT_MAX_BYTES') return 50 * 1024;
    if (exported === 'formatSize') {
      return (bytes) => {
        if (bytes < 1024) return `${String(bytes)}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
      };
    }
  }
  throw new DocsGateError(`unsupported external docs extraction import ${specifier}:${exported}`);
}

function literalValue(ts, root, rel, expr, cache, stack = []) {
  const info = moduleInfo(ts, root, rel, cache);
  const e = stripAsConst(ts, expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) return e.operator === ts.SyntaxKind.MinusToken ? -Number(e.operand.text) : Number(e.operand.text);
  if (ts.isBinaryExpression(e)) {
    const left = literalValue(ts, root, rel, e.left, cache, stack);
    const right = literalValue(ts, root, rel, e.right, cache, stack);
    if (typeof left === 'number' && typeof right === 'number') {
      if (e.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
      if (e.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
      if (e.operatorToken.kind === ts.SyntaxKind.MinusToken) return left - right;
      if (e.operatorToken.kind === ts.SyntaxKind.SlashToken) return left / right;
    }
    if (typeof left === 'string' && typeof right === 'string' && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
  }
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text;
    for (const span of e.templateSpans) out += String(literalValue(ts, root, rel, span.expression, cache, stack)) + span.literal.text;
    return out;
  }
  if (ts.isArrayLiteralExpression(e)) return e.elements.map((x) => literalValue(ts, root, rel, x, cache, stack));
  if (ts.isObjectLiteralExpression(e)) {
    const obj = {};
    for (const prop of e.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const spread = literalValue(ts, root, rel, prop.expression, cache, stack);
        if (!spread || typeof spread !== 'object' || Array.isArray(spread)) throw new DocsGateError(`${lineOf(info.sf, prop, ts)} unsupported non-object spread in docs extraction`);
        Object.assign(obj, spread);
        continue;
      }
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) throw new DocsGateError(`${lineOf(info.sf, prop, ts)} unsupported object literal property in docs extraction`);
      if (ts.isShorthandPropertyAssignment(prop)) {
        obj[prop.name.text] = resolveIdentifierValue(ts, root, rel, prop.name.text, cache, stack);
      } else {
        const key = propertyNameText(ts, root, rel, prop.name, cache);
        obj[key] = literalValue(ts, root, rel, prop.initializer, cache, stack);
      }
    }
    return obj;
  }
  if (ts.isCallExpression(e)) {
    if (ts.isPropertyAccessExpression(e.expression) && e.expression.expression.getText(info.sf) === 'Object' && e.expression.name.text === 'freeze') {
      if (e.arguments.length !== 1) throw new DocsGateError(`${lineOf(info.sf, e, ts)} Object.freeze with ${String(e.arguments.length)} arguments is unsupported`);
      return literalValue(ts, root, rel, e.arguments[0], cache, stack);
    }
    if (ts.isIdentifier(e.expression) && e.expression.text === 'freezeProfile') {
      if (e.arguments.length !== 1) throw new DocsGateError(`${lineOf(info.sf, e, ts)} freezeProfile with ${String(e.arguments.length)} arguments is unsupported`);
      return literalValue(ts, root, rel, e.arguments[0], cache, stack);
    }
    if (ts.isPropertyAccessExpression(e.expression) && e.expression.expression.getText(info.sf) === 'Math') {
      const args = e.arguments.map((arg) => literalValue(ts, root, rel, arg, cache, stack));
      if (!args.every((x) => typeof x === 'number')) throw new DocsGateError(`${lineOf(info.sf, e, ts)} Math.${e.expression.name.text} docs extraction requires numeric args`);
      if (e.expression.name.text === 'min') return Math.min(...args);
      if (e.expression.name.text === 'max') return Math.max(...args);
    }
    if (ts.isIdentifier(e.expression) && e.expression.text === 'String' && e.arguments.length === 1) return String(literalValue(ts, root, rel, e.arguments[0], cache, stack));
    if (ts.isIdentifier(e.expression) && e.expression.text === 'Number' && e.arguments.length === 1) return Number(literalValue(ts, root, rel, e.arguments[0], cache, stack));
    if (ts.isIdentifier(e.expression) && e.expression.text === 'formatSize' && e.arguments.length === 1) {
      const formatter = externalValue('@earendil-works/pi-coding-agent', 'formatSize');
      return formatter(literalValue(ts, root, rel, e.arguments[0], cache, stack));
    }
  }
  if (ts.isIdentifier(e)) return resolveIdentifierValue(ts, root, rel, e.text, cache, stack);
  throw new DocsGateError(`${lineOf(info.sf, e, ts)} unsupported expression for docs extraction: ${e.getText(info.sf).slice(0, 160)}`);
}

function resolveIdentifierValue(ts, root, rel, name, cache, stack = []) {
  const key = `${rel}:${name}`;
  if (stack.includes(key)) throw new DocsGateError(`cyclic constant resolution for ${key}`);
  const info = moduleInfo(ts, root, rel, cache);
  const local = info.constDecls.get(name);
  if (local) return literalValue(ts, root, rel, local.expr, cache, [...stack, key]);
  const imported = info.imports.get(name);
  if (imported) return resolveIdentifierValue(ts, root, imported.rel, imported.exported, cache, [...stack, key]);
  const external = info.externalImports.get(name);
  if (external) return externalValue(external.specifier, external.exported);
  throw new DocsGateError(`${rel} references unsupported or non-literal identifier ${name}`);
}

function frozenObjectLiteral(ts, info, expression, context) {
  const value = stripAsConst(ts, expression);
  if (
    !ts.isCallExpression(value) ||
    value.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(value.expression) ||
    value.expression.expression.getText(info.sf) !== 'Object' ||
    value.expression.name.text !== 'freeze'
  ) {
    throw new DocsGateError(`${context} must return an Object.freeze(...) value`);
  }
  const object = stripAsConst(ts, value.arguments[0]);
  if (!ts.isObjectLiteralExpression(object)) {
    throw new DocsGateError(`${context} Object.freeze argument must be an object literal`);
  }
  return object;
}

function topLevelConstInitializers(ts, fn) {
  const declarations = new Map();
  for (const statement of fn.body?.statements ?? []) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        declarations.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return declarations;
}

function soleDirectReturn(ts, info, fn, context) {
  const returns = [];
  const scan = (node) => {
    if (node !== fn && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, scan);
  };
  scan(fn.body);
  const returned = returns[0];
  if (
    returns.length !== 1 ||
    returned?.expression === undefined ||
    returned.parent !== fn.body ||
    fn.body.statements.at(-1) !== returned
  ) {
    throw new DocsGateError(
      `${lineOf(info.sf, fn, ts)} ${context} must have exactly one reachable direct immutable return as its final statement`,
    );
  }
  return returned;
}

function assertImmutableVariantParser(ts, root, rel, cache) {
  const info = moduleInfo(ts, root, rel, cache);
  const parser = findExportedFunction(
    ts,
    root,
    rel,
    'parseBackgroundTasksConfig',
    cache,
  );
  if (parser.rel !== rel || !parser.node.body) {
    throw new DocsGateError(`${rel} variant parser must be a local function with a block body`);
  }
  const parserReturn = soleDirectReturn(ts, info, parser.node, 'variant parser');
  const returnedConfig = frozenObjectLiteral(
    ts,
    info,
    parserReturn.expression,
    `${rel} parseBackgroundTasksConfig`,
  );
  const returnedKeys = [];
  for (const property of returnedConfig.properties) {
    if (!ts.isShorthandPropertyAssignment(property)) {
      throw new DocsGateError(
        `${lineOf(info.sf, property, ts)} variant parser return fields must be immutable shorthand bindings`,
      );
    }
    returnedKeys.push(property.name.text);
  }
  if (JSON.stringify(returnedKeys) !== JSON.stringify(['features', 'dockShortcut'])) {
    throw new DocsGateError(
      `${rel} variant parser must freeze exactly the features and dockShortcut bindings`,
    );
  }

  const parserBindings = topLevelConstInitializers(ts, parser.node);
  const featuresInitializer = stripAsConst(ts, parserBindings.get('features'));
  if (
    !featuresInitializer ||
    !ts.isCallExpression(featuresInitializer) ||
    !ts.isIdentifier(stripAsConst(ts, featuresInitializer.expression))
  ) {
    throw new DocsGateError(`${rel} variant parser features binding must call a local parser`);
  }
  const featuresParserName = stripAsConst(ts, featuresInitializer.expression).text;
  const featuresParser = info.localFunctions.get(featuresParserName);
  if (!featuresParser?.body || !parserBindings.has('dockShortcut')) {
    throw new DocsGateError(`${rel} variant parser must bind local feature and dock parsers`);
  }
  const featureReturn = soleDirectReturn(ts, info, featuresParser, 'feature parser');
  const returnedFeatures = frozenObjectLiteral(
    ts,
    info,
    featureReturn.expression,
    `${rel} ${featuresParserName}`,
  );
  const featureProperties = new Map();
  for (const property of returnedFeatures.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
      throw new DocsGateError(
        `${lineOf(info.sf, property, ts)} feature parser fields must be explicit assignments`,
      );
    }
    featureProperties.set(property.name.text, stripAsConst(ts, property.initializer));
  }
  if (
    JSON.stringify([...featureProperties.keys()]) !== JSON.stringify(DOCS_FEATURE_VALUES) ||
    featureProperties.get('process')?.kind !== ts.SyntaxKind.TrueKeyword
  ) {
    throw new DocsGateError(`${rel} feature parser must freeze the exact finite feature record`);
  }
  let selectedBinding;
  for (const feature of DOCS_FEATURE_VALUES.slice(1)) {
    const initializer = featureProperties.get(feature);
    if (
      !initializer ||
      !ts.isCallExpression(initializer) ||
      initializer.arguments.length !== 1 ||
      !ts.isPropertyAccessExpression(initializer.expression) ||
      initializer.expression.name.text !== 'has' ||
      !ts.isIdentifier(stripAsConst(ts, initializer.expression.expression)) ||
      !ts.isStringLiteral(initializer.arguments[0]) ||
      initializer.arguments[0].text !== feature
    ) {
      throw new DocsGateError(`${rel} feature parser field ${feature} is not structurally validated`);
    }
    const binding = stripAsConst(ts, initializer.expression.expression).text;
    selectedBinding ??= binding;
    if (binding !== selectedBinding) {
      throw new DocsGateError(`${rel} feature parser fields must read one validated selection set`);
    }
  }
}

function variantContractFromModule(ts, root, rel, cache) {
  assertImmutableVariantParser(ts, root, rel, cache);
  const read = (name) => resolveIdentifierValue(ts, root, rel, name, cache);
  const featureValues = read('PI_BG_FEATURE_VALUES');
  const defaultFeatures = read('PI_BG_DEFAULT_FEATURES');
  const dockShortcutValues = read('PI_BG_DOCK_SHORTCUT_VALUES');
  const defaultDockShortcut = read('PI_BG_DEFAULT_DOCK_SHORTCUT');
  const assertExact = (label, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new DocsGateError(
        `${rel} runtime/docs variant enum drift for ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    }
  };
  assertExact('PI_BG_FEATURE_VALUES', featureValues, DOCS_FEATURE_VALUES);
  assertExact('PI_BG_DEFAULT_FEATURES', defaultFeatures, DOCS_DEFAULT_FEATURES);
  assertExact('PI_BG_DOCK_SHORTCUT_VALUES', dockShortcutValues, DOCS_DOCK_SHORTCUT_VALUES);
  assertExact('PI_BG_DEFAULT_DOCK_SHORTCUT', defaultDockShortcut, DOCS_DEFAULT_DOCK_SHORTCUT);
  return {
    feature_values: [...featureValues],
    default_features: [...defaultFeatures],
    dock_shortcut_values: [...dockShortcutValues],
    default_dock_shortcut: defaultDockShortcut,
    source: rel,
  };
}

function isDefaultAvailability(availability, variants) {
  if (availability === ALWAYS_AVAILABLE) return true;
  if (availability.startsWith('feature:')) {
    return variants.default_features.includes(availability.slice('feature:'.length));
  }
  if (availability === 'any(feature:delegate,feature:fusion)') {
    return (
      variants.default_features.includes('delegate') ||
      variants.default_features.includes('fusion')
    );
  }
  if (availability.startsWith('dock:')) {
    return variants.default_dock_shortcut === availability.slice('dock:'.length);
  }
  throw new DocsGateError(`unsupported normalized availability expression ${availability}`);
}

function resolveIdentifierExpr(ts, root, rel, name, cache, stack = []) {
  const key = `${rel}:${name}`;
  if (stack.includes(key)) throw new DocsGateError(`cyclic schema resolution for ${key}`);
  const info = moduleInfo(ts, root, rel, cache);
  const local = info.constDecls.get(name);
  if (local) return { rel, expr: local.expr, stack: [...stack, key] };
  const imported = info.imports.get(name);
  if (imported) return resolveIdentifierExpr(ts, root, imported.rel, imported.exported, cache, [...stack, key]);
  throw new DocsGateError(`${rel} references unsupported schema identifier ${name}`);
}

function propertyNameText(ts, root, rel, name, cache) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return String(literalValue(ts, root, rel, name.expression, cache));
  throw new DocsGateError(`${rel} has unsupported property name in docs extraction`);
}

function firstArgString(ts, root, rel, call, cache) {
  const first = call.arguments[0];
  if (!first) throw new DocsGateError(`${rel} registration call has no first argument`);
  return String(literalValue(ts, root, rel, first, cache));
}

function objectProperties(ts, root, rel, objectExpr, cache) {
  const e = stripAsConst(ts, objectExpr);
  if (!ts.isObjectLiteralExpression(e)) throw new DocsGateError(`${rel} registration wrapper expects an object literal`);
  const props = new Map();
  for (const prop of e.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    props.set(propertyNameText(ts, root, rel, prop.name, cache), prop.initializer);
  }
  return props;
}

function assertPublicPropertiesAreExplicit(
  ts,
  root,
  rel,
  objectExpr,
  cache,
  publicKeys,
  context,
) {
  const e = stripAsConst(ts, objectExpr);
  if (!ts.isObjectLiteralExpression(e)) {
    throw new DocsGateError(`${context} must be an object literal`);
  }
  for (const prop of e.properties) {
    if (ts.isSpreadAssignment(prop)) {
      throw new DocsGateError(`${context} must not use object spread for public registration fields`);
    }
    if (ts.isPropertyAssignment(prop)) continue;
    if (prop.name !== undefined) {
      const key = propertyNameText(ts, root, rel, prop.name, cache);
      if (publicKeys.has(key)) {
        throw new DocsGateError(`${context} public field ${key} must be an explicit property assignment`);
      }
    }
  }
}

function objectNameString(ts, root, rel, objectExpr, cache) {
  const props = objectProperties(ts, root, rel, objectExpr, cache);
  const expr = props.get('name');
  if (!expr) throw new DocsGateError(`${rel} registration object is missing literal name`);
  return String(literalValue(ts, root, rel, expr, cache));
}

function literalProp(ts, root, rel, props, key, cache) {
  const expr = props.get(key);
  if (!expr) return undefined;
  return literalValue(ts, root, rel, expr, cache);
}

function schemaOptions(ts, root, rel, expr, cache) {
  if (!expr) return {};
  const raw = literalValue(ts, root, rel, expr, cache);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DocsGateError(`${rel} TypeBox options must be an object literal`);
  return sortDeep(raw);
}

function schemaFromExpr(ts, root, rel, expr, cache, stack = []) {
  const info = moduleInfo(ts, root, rel, cache);
  const e = stripAsConst(ts, expr);
  if (ts.isIdentifier(e)) {
    const resolved = resolveIdentifierExpr(ts, root, rel, e.text, cache, stack);
    return schemaFromExpr(ts, root, resolved.rel, resolved.expr, cache, resolved.stack);
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.expression.getText(info.sf) === 'Type') {
    const method = e.expression.name.text;
    if (method === 'Optional') {
      if (e.arguments.length !== 1) throw new DocsGateError(`${lineOf(info.sf, e, ts)} Type.Optional requires one argument`);
      const inner = schemaFromExpr(ts, root, rel, e.arguments[0], cache, stack);
      return { optional: true, schema: inner.schema };
    }
    if (method === 'String' || method === 'Number' || method === 'Boolean') {
      if (e.arguments.length > 1) throw new DocsGateError(`${lineOf(info.sf, e, ts)} Type.${method} has unsupported arity`);
      const schema = { type: method.toLowerCase() };
      Object.assign(schema, schemaOptions(ts, root, rel, e.arguments[0], cache));
      return { optional: false, schema: sortDeep(schema) };
    }
    if (method === 'Array') {
      if (e.arguments.length < 1 || e.arguments.length > 2) throw new DocsGateError(`${lineOf(info.sf, e, ts)} Type.Array has unsupported arity`);
      const item = schemaFromExpr(ts, root, rel, e.arguments[0], cache, stack);
      if (item.optional) throw new DocsGateError(`${lineOf(info.sf, e, ts)} Type.Array item must not be Type.Optional`);
      const schema = { type: 'array', items: item.schema };
      Object.assign(schema, schemaOptions(ts, root, rel, e.arguments[1], cache));
      return { optional: false, schema: sortDeep(schema) };
    }
    if (method === 'Object') {
      if (e.arguments.length < 1 || e.arguments.length > 2) throw new DocsGateError(`${lineOf(info.sf, e, ts)} Type.Object has unsupported arity`);
      const shape = stripAsConst(ts, e.arguments[0]);
      if (!ts.isObjectLiteralExpression(shape)) throw new DocsGateError(`${lineOf(info.sf, e, ts)} Type.Object shape must be object literal`);
      const properties = {};
      const required = [];
      for (const prop of shape.properties) {
        if (!ts.isPropertyAssignment(prop)) throw new DocsGateError(`${lineOf(info.sf, prop, ts)} Type.Object property must be assignment`);
        const key = propertyNameText(ts, root, rel, prop.name, cache);
        const child = schemaFromExpr(ts, root, rel, prop.initializer, cache, stack);
        properties[key] = child.schema;
        if (!child.optional) required.push(key);
      }
      const schema = { type: 'object', properties: sortDeep(properties), required: required.sort() };
      Object.assign(schema, schemaOptions(ts, root, rel, e.arguments[1], cache));
      return { optional: false, schema: sortDeep(schema) };
    }
  }
  throw new DocsGateError(`${lineOf(info.sf, e, ts)} unsupported TypeBox schema expression: ${e.getText(info.sf).slice(0, 160)}`);
}

function findExportedFunction(ts, root, rel, exported, cache) {
  const info = moduleInfo(ts, root, rel, cache);
  if (exported === 'default') {
    if (info.defaultFunction.node) return { rel, node: info.defaultFunction.node };
    const reexport = info.imports.get('default');
    if (reexport) return findExportedFunction(ts, root, reexport.rel, reexport.exported, cache);
  }
  const fn = info.exportedFunctions.get(exported);
  if (fn) return { rel, node: fn };
  const reexport = info.imports.get(exported);
  if (reexport) return findExportedFunction(ts, root, reexport.rel, reexport.exported, cache);
  throw new DocsGateError(`${rel} does not export function ${exported}`);
}

function addSurface(regs, kind, name, source, details = {}) {
  if (kind === 'tool' && EXCLUDED_PARENT_TOOL_NAMES.has(name)) return;
  regs.push({ kind, name, source, id: `${kind}:${name}`, ...details });
}

function toolDetailsFromObject(ts, root, rel, objectExpr, cache, source) {
  assertPublicPropertiesAreExplicit(
    ts,
    root,
    rel,
    objectExpr,
    cache,
    new Set(['name', 'label', 'description', 'promptSnippet', 'promptGuidelines', 'parameters']),
    `${source} tool registration`,
  );
  const props = objectProperties(ts, root, rel, objectExpr, cache);
  const nameValue = literalProp(ts, root, rel, props, 'name', cache);
  if (typeof nameValue !== 'string' || nameValue.length === 0) {
    throw new DocsGateError(`${rel} tool registration is missing literal string name`);
  }
  const requireOptionalString = (key) => {
    const value = literalProp(ts, root, rel, props, key, cache);
    if (value !== undefined && typeof value !== 'string') {
      throw new DocsGateError(`${source} tool ${nameValue} ${key} must resolve to a string`);
    }
    return value;
  };
  const label = requireOptionalString('label');
  const description = requireOptionalString('description');
  const promptSnippet = requireOptionalString('promptSnippet');
  const promptGuidelines = literalProp(ts, root, rel, props, 'promptGuidelines', cache);
  if (
    promptGuidelines !== undefined &&
    (!Array.isArray(promptGuidelines) || promptGuidelines.some((entry) => typeof entry !== 'string'))
  ) {
    throw new DocsGateError(
      `${source} tool ${nameValue} promptGuidelines must resolve to an array of strings`,
    );
  }
  const paramsExpr = props.get('parameters');
  if (!paramsExpr) throw new DocsGateError(`${source} tool ${nameValue} is missing parameters`);
  const normalized = schemaFromExpr(ts, root, rel, paramsExpr, cache);
  if (normalized.optional) throw new DocsGateError(`${source} tool ${nameValue} root schema must not be optional`);
  return {
    kind: 'tool',
    name: nameValue,
    source,
    id: `tool:${nameValue}`,
    label,
    description,
    promptSnippet,
    promptGuidelines: promptGuidelines ?? [],
    schema: normalized.schema,
  };
}

function commandDetails(ts, root, rel, name, call, cache) {
  const source = lineOf(moduleInfo(ts, root, rel, cache).sf, call, ts);
  let description;
  const second = call.arguments[1];
  if (second) {
    assertPublicPropertiesAreExplicit(
      ts,
      root,
      rel,
      second,
      cache,
      new Set(['description']),
      `${source} ${name} registration options`,
    );
    const props = objectProperties(ts, root, rel, second, cache);
    const value = literalProp(ts, root, rel, props, 'description', cache);
    if (value !== undefined && typeof value !== 'string') {
      throw new DocsGateError(`${source} ${name} description must resolve to a string`);
    }
    description = value;
  }
  return { description, source };
}

const PUBLIC_REGISTRATION_METHODS = new Set([
  'registerCommand',
  'registerShortcut',
  'registerMessageRenderer',
  'registerTool',
]);
const NON_PUBLIC_REGISTRATION_METHODS = new Set(['registerProvider']);

function collectRegistrationsInFunction(
  ts,
  root,
  rel,
  fn,
  piParamName,
  cache,
  regs,
  visitedFns,
  inheritedAvailability = ALWAYS_AVAILABLE,
  inheritedConfigBindings = new Map(),
) {
  const info = moduleInfo(ts, root, rel, cache);
  const localWrapperNames = new Set();
  const wrapperPublicKeys = [
    'name',
    'label',
    'description',
    'promptSnippet',
    'promptGuidelines',
    'parameters',
  ];

  const unwrapExpression = (node) => {
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
  };
  const isPiHostExpression = (node) => {
    if (!node) return false;
    const unwrapped = unwrapExpression(node);
    return ts.isIdentifier(unwrapped) && unwrapped.text === piParamName;
  };
  const calleeIdentifier = (node) => {
    const unwrapped = unwrapExpression(node);
    return ts.isIdentifier(unwrapped) ? unwrapped : undefined;
  };
  const directRegistrationAccess = (node) => {
    const unwrapped = unwrapExpression(node);
    if (!ts.isPropertyAccessExpression(unwrapped)) return undefined;
    if (!isPiHostExpression(unwrapped.expression)) return undefined;
    return unwrapped;
  };
  const bindingNames = (name, out = new Set()) => {
    if (ts.isIdentifier(name)) {
      out.add(name.text);
      return out;
    }
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) bindingNames(element.name, out);
      }
    }
    return out;
  };
  const destructuredRegistrationBinding = (name) => {
    if (ts.isIdentifier(name)) return name.text.startsWith('register') ? name.text : undefined;
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (!ts.isBindingElement(element)) continue;
        const property = element.propertyName;
        if (
          property &&
          (ts.isIdentifier(property) || ts.isStringLiteral(property)) &&
          property.text.startsWith('register')
        ) {
          return property.text;
        }
        if (property && ts.isComputedPropertyName(property)) {
          let computed;
          try {
            computed = literalValue(ts, root, rel, property.expression, cache);
          } catch {
            computed = undefined;
          }
          if (typeof computed === 'string' && computed.startsWith('register')) return computed;
        }
        const nested = destructuredRegistrationBinding(element.name);
        if (nested !== undefined) return nested;
      }
    }
    return undefined;
  };
  const isLiteralDynamicRegistrationBinding = (element) => {
    if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) return false;
    const pattern = element.parent;
    if (!ts.isObjectBindingPattern(pattern)) return false;
    const declaration = pattern.parent;
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return false;
    let initializer = declaration.initializer;
    while (ts.isAwaitExpression(initializer) || ts.isParenthesizedExpression(initializer) || ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression;
    if (!ts.isCallExpression(initializer) || initializer.expression.kind !== ts.SyntaxKind.ImportKeyword || initializer.arguments.length !== 1 || !ts.isStringLiteral(initializer.arguments[0])) return false;
    const target = resolveTsModule(root, rel, initializer.arguments[0].text);
    const imported = info.imports.get(element.name.text);
    return target !== null && imported?.rel === target;
  };
  const localBindingNames = new Set();
  for (const parameter of fn.parameters ?? []) bindingNames(parameter.name, localBindingNames);
  const collectLocalBindings = (node) => {
    if (node !== fn.body && ts.isFunctionLike(node)) {
      if (ts.isFunctionDeclaration(node) && node.name) localBindingNames.add(node.name.text);
      return;
    }
    if (ts.isVariableDeclaration(node)) bindingNames(node.name, localBindingNames);
    if (ts.isClassDeclaration(node) && node.name) localBindingNames.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      bindingNames(node.variableDeclaration.name, localBindingNames);
    }
    ts.forEachChild(node, collectLocalBindings);
  };
  if (fn.body) collectLocalBindings(fn.body);

  const configBindings = new Map(inheritedConfigBindings);
  for (const name of inheritedConfigBindings.keys()) {
    if (localBindingNames.has(name)) {
      throw new DocsGateError(
        `${lineOf(info.sf, fn, ts)} registration-owning nested scope shadows inherited finite config authority ${name}`,
      );
    }
  }
  if (fn.body && ts.isBlock(fn.body)) {
    for (const statement of fn.body.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const initializer = unwrapExpression(declaration.initializer);
        if (!ts.isCallExpression(initializer) || initializer.arguments.length !== 0) continue;
        const callee = calleeIdentifier(initializer.expression);
        if (!callee) continue;
        const imported = info.imports.get(callee.text);
        if (!imported || imported.exported !== 'parseBackgroundTasksConfig') continue;
        if (
          localBindingNames.has(callee.text) ||
          info.constDecls.has(callee.text) ||
          info.localFunctions.has(callee.text)
        ) {
          throw new DocsGateError(
            `${lineOf(info.sf, initializer, ts)} config parser call must resolve to the unshadowed imported parseBackgroundTasksConfig binding`,
          );
        }
        configBindings.set(
          declaration.name.text,
          variantContractFromModule(ts, root, imported.rel, cache),
        );
      }
    }
  }
  const featureAvailabilityAtom = (condition) => {
    const expression = unwrapExpression(condition);
    if (!ts.isPropertyAccessExpression(expression)) return undefined;
    const feature = expression.name.text;
    const featuresAccess = unwrapExpression(expression.expression);
    if (
      !ts.isPropertyAccessExpression(featuresAccess) ||
      featuresAccess.name.text !== 'features'
    ) {
      return undefined;
    }
    const binding = unwrapExpression(featuresAccess.expression);
    if (!ts.isIdentifier(binding) || !configBindings.has(binding.text)) return undefined;
    if (!['delegate', 'fusion', 'attested', 'attribution'].includes(feature)) {
      throw new DocsGateError(
        `${lineOf(info.sf, condition, ts)} unsupported feature availability condition ${feature}`,
      );
    }
    return `feature:${feature}`;
  };
  const dockAvailabilityAtom = (condition) => {
    const expression = unwrapExpression(condition);
    if (
      !ts.isBinaryExpression(expression) ||
      expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      return undefined;
    }
    const left = unwrapExpression(expression.left);
    const right = unwrapExpression(expression.right);
    if (!ts.isPropertyAccessExpression(left) || left.name.text !== 'dockShortcut') {
      return undefined;
    }
    const binding = unwrapExpression(left.expression);
    if (!ts.isIdentifier(binding) || !configBindings.has(binding.text)) return undefined;
    if (!ts.isStringLiteral(right) && !ts.isNoSubstitutionTemplateLiteral(right)) {
      throw new DocsGateError(
        `${lineOf(info.sf, condition, ts)} dock availability must compare with one literal shortcut`,
      );
    }
    if (!['shift+down', 'ctrl+alt+b'].includes(right.text)) {
      throw new DocsGateError(
        `${lineOf(info.sf, condition, ts)} dock availability ${right.text} cannot register a shortcut; off registers nothing`,
      );
    }
    return `dock:${right.text}`;
  };
  const finiteAvailability = (condition) => {
    const feature = featureAvailabilityAtom(condition);
    if (feature !== undefined) return feature;
    const dock = dockAvailabilityAtom(condition);
    if (dock !== undefined) return dock;
    const expression = unwrapExpression(condition);
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      const left = featureAvailabilityAtom(expression.left);
      const right = featureAvailabilityAtom(expression.right);
      if (
        left !== undefined &&
        right !== undefined &&
        new Set([left, right]).size === 2 &&
        [left, right].every((value) =>
          ['feature:delegate', 'feature:fusion'].includes(value),
        )
      ) {
        return 'any(feature:delegate,feature:fusion)';
      }
      throw new DocsGateError(
        `${lineOf(info.sf, condition, ts)} unsupported derived availability expression`,
      );
    }
    throw new DocsGateError(
      `${lineOf(info.sf, condition, ts)} unrecognized finite variant condition`,
    );
  };
  const isAllowedConfigBindingUse = (node) => {
    if (
      ts.isVariableDeclaration(node.parent) &&
      node.parent.name === node &&
      configBindings.has(node.text)
    ) {
      return true;
    }
    const directAccess = node.parent;
    if (
      ts.isPropertyAccessExpression(directAccess) &&
      directAccess.expression === node &&
      directAccess.name.text === 'dockShortcut' &&
      ts.isCallExpression(directAccess.parent) &&
      directAccess.parent.arguments.length === 1 &&
      directAccess.parent.arguments[0] === directAccess
    ) {
      const callee = calleeIdentifier(directAccess.parent.expression);
      const imported = callee && info.imports.get(callee.text);
      const parserImport = [...info.imports.values()].find(
        (candidate) => candidate.exported === 'parseBackgroundTasksConfig',
      );
      if (
        imported?.exported === 'dockShortcutFooterHint' &&
        parserImport?.rel === imported.rel
      ) {
        return true;
      }
    }
    let current = node;
    while (current.parent && current.parent !== fn) {
      const parent = current.parent;
      if (ts.isIfStatement(parent) && parent.expression === current) {
        if (
          !ts.isBlock(fn.body) ||
          parent.parent !== fn.body ||
          !ts.isBlock(parent.thenStatement) ||
          parent.elseStatement !== undefined
        ) {
          return false;
        }
        finiteAvailability(parent.expression);
        return true;
      }
      if (
        ts.isPropertyAccessExpression(parent) ||
        ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        ts.isTypeAssertionExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isSatisfiesExpression(parent) ||
        ts.isBinaryExpression(parent)
      ) {
        current = parent;
        continue;
      }
      return false;
    }
    return false;
  };
  const isDirectCallTarget = (node) => {
    let current = node;
    while (
      current.parent &&
      (ts.isParenthesizedExpression(current.parent) ||
        ts.isAsExpression(current.parent) ||
        ts.isTypeAssertionExpression(current.parent) ||
        ts.isNonNullExpression(current.parent) ||
        ts.isSatisfiesExpression(current.parent))
    ) {
      current = current.parent;
    }
    return ts.isCallExpression(current.parent) && current.parent.expression === current;
  };
  const isLocalWrapperReference = (node) => {
    const identifier = calleeIdentifier(node);
    return identifier !== undefined && localWrapperNames.has(identifier.text);
  };
  const isAssignmentExpression = (node) =>
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  const registrationAvailability = (call, body, context, allowVariant = true) => {
    if (!body || !ts.isBlock(body) || !ts.isExpressionStatement(call.parent)) {
      throw new DocsGateError(
        `${lineOf(info.sf, call, ts)} ${context} must be an immediate top-level statement`,
      );
    }
    if (call.parent.parent === body) return inheritedAvailability;
    const block = call.parent.parent;
    const branch = block.parent;
    if (
      allowVariant &&
      ts.isBlock(block) &&
      ts.isIfStatement(branch) &&
      branch.thenStatement === block &&
      branch.elseStatement === undefined &&
      branch.parent === body
    ) {
      if (inheritedAvailability !== ALWAYS_AVAILABLE) {
        throw new DocsGateError(
          `${lineOf(info.sf, call, ts)} nested availability expressions are unsupported`,
        );
      }
      if (configBindings.size === 0) {
        throw new DocsGateError(
          `${lineOf(info.sf, call, ts)} ${context} must be an immediate top-level statement`,
        );
      }
      return finiteAvailability(branch.expression);
    }
    throw new DocsGateError(
      `${lineOf(info.sf, call, ts)} ${context} must be an immediate top-level statement`,
    );
  };
  const expressionContainsLocalWrapper = (rootNode) => {
    let found = false;
    const scan = (node) => {
      if (found) return;
      if (ts.isIdentifier(node) && localWrapperNames.has(node.text)) {
        found = true;
        return;
      }
      ts.forEachChild(node, scan);
    };
    scan(rootNode);
    return found;
  };
  const expressionContainsConfigAuthority = (rootNode) => {
    let found = false;
    const scan = (node) => {
      if (found) return;
      if (ts.isIdentifier(node) && configBindings.has(node.text)) {
        found = true;
        return;
      }
      ts.forEachChild(node, scan);
    };
    scan(rootNode);
    return found;
  };
  const isTypeOnlyIdentifier = (node) => {
    let current = node.parent;
    while (current && current !== fn) {
      if (ts.isTypeNode(current)) return true;
      current = current.parent;
    }
    return false;
  };
  const isAllowedPiIdentifierUse = (node) => {
    if (isTypeOnlyIdentifier(node)) return true;
    let current = node;
    while (
      current.parent &&
      (ts.isParenthesizedExpression(current.parent) ||
        ts.isAsExpression(current.parent) ||
        ts.isTypeAssertionExpression(current.parent) ||
        ts.isNonNullExpression(current.parent) ||
        ts.isSatisfiesExpression(current.parent))
    ) {
      current = current.parent;
    }
    const parent = current.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      return parent.name.text === 'events' || isDirectCallTarget(parent);
    }
    if (ts.isCallExpression(parent) && parent.arguments[0] === current) {
      const callee = calleeIdentifier(parent.expression);
      return callee !== undefined && info.imports.has(callee.text);
    }
    return false;
  };
  const isAllowedLocalWrapperIdentifierUse = (node) => {
    if (isTypeOnlyIdentifier(node)) return true;
    if (
      (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
      (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
      (ts.isMethodDeclaration(node.parent) && node.parent.name === node) ||
      (ts.isPropertyDeclaration(node.parent) && node.parent.name === node)
    ) {
      return true;
    }
    let current = node;
    while (
      current.parent &&
      (ts.isParenthesizedExpression(current.parent) ||
        ts.isAsExpression(current.parent) ||
        ts.isTypeAssertionExpression(current.parent) ||
        ts.isNonNullExpression(current.parent) ||
        ts.isSatisfiesExpression(current.parent))
    ) {
      current = current.parent;
    }
    return ts.isCallExpression(current.parent) && current.parent.expression === current;
  };
  const expressionContainsUnsafePiUse = (rootNode) => {
    let unsafe = false;
    const scan = (node) => {
      if (unsafe) return;
      if (ts.isIdentifier(node) && node.text === piParamName) {
        let current = node;
        while (
          current.parent &&
          (ts.isParenthesizedExpression(current.parent) ||
            ts.isAsExpression(current.parent) ||
            ts.isTypeAssertionExpression(current.parent) ||
            ts.isNonNullExpression(current.parent) ||
            ts.isSatisfiesExpression(current.parent))
        ) {
          current = current.parent;
        }
        const access = current.parent;
        if (
          ts.isPropertyAccessExpression(access) &&
          access.expression === current &&
          !access.name.text.startsWith('register') &&
          (isDirectCallTarget(access) || access.name.text === 'events')
        ) {
          return;
        }
        unsafe = true;
        return;
      }
      ts.forEachChild(node, scan);
    };
    scan(rootNode);
    return unsafe;
  };

  const computedRegistrationMethod = (node) => {
    if (!ts.isElementAccessExpression(node) || !node.argumentExpression) return undefined;
    try {
      const value = literalValue(ts, root, rel, node.argumentExpression, cache);
      return typeof value === 'string' && value.startsWith('register') ? value : undefined;
    } catch {
      return undefined;
    }
  };

  for (const parameter of fn.parameters ?? []) {
    if (!ts.isIdentifier(parameter.name)) {
      const registrationBinding = destructuredRegistrationBinding(parameter.name);
      if (registrationBinding !== undefined) {
        throw new DocsGateError(
          `${lineOf(info.sf, parameter, ts)} destructured registration binding ${registrationBinding} is unsupported`,
        );
      }
    }
    if (!parameter.initializer) continue;
    let hasRegistrationAccess = false;
    let hasInitializerControlFlow = false;
    const scanInitializer = (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        (node.name.text.startsWith('register') || node.name.text === 'events')
      ) {
        hasRegistrationAccess = true;
      }
      if (computedRegistrationMethod(node) !== undefined) hasRegistrationAccess = true;
      if (
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isFunctionLike(node) ||
        ts.isReturnStatement(node) ||
        ts.isThrowStatement(node) ||
        ts.isConditionalExpression(node) ||
        ts.isAwaitExpression(node) ||
        ts.isYieldExpression(node)
      ) {
        hasInitializerControlFlow = true;
      }
      ts.forEachChild(node, scanInitializer);
    };
    scanInitializer(parameter.initializer);
    if (hasInitializerControlFlow) {
      throw new DocsGateError(
        `${lineOf(info.sf, parameter, ts)} registration-owning parameter initializer contains unsupported throw or control flow`,
      );
    }
    if (
      (ts.isIdentifier(parameter.name) && parameter.name.text === piParamName) ||
      expressionContainsUnsafePiUse(parameter.initializer) ||
      hasRegistrationAccess
    ) {
      throw new DocsGateError(
        `${lineOf(info.sf, parameter, ts)} registration-owning parameter initializer must not alias or derive the Pi registration host`,
      );
    }
  }

  const validateToolWrapper = (node) => {
    if (!node.name || !node.body || node.parameters.length !== 1) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} supported tool wrapper must be a named function declaration with one parameter`,
      );
    }
    const parameter = node.parameters[0].name;
    if (!ts.isIdentifier(parameter)) {
      throw new DocsGateError(`${lineOf(info.sf, node, ts)} tool wrapper parameter must be an identifier`);
    }
    const calls = [];
    const scan = (child) => {
      if (
        (ts.isVariableDeclaration(child) ||
          ts.isParameter(child) ||
          ts.isPropertyDeclaration(child) ||
          ts.isBindingElement(child)) &&
        child.initializer &&
        (expressionContainsUnsafePiUse(child.initializer) ||
          expressionContainsLocalWrapper(child.initializer))
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, child, ts)} wrapper must not alias or derive a Pi host or registration wrapper`,
        );
      }
      if (
        isAssignmentExpression(child) &&
        (expressionContainsUnsafePiUse(child.right) || expressionContainsLocalWrapper(child.right))
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, child, ts)} wrapper must not assign a Pi host or registration wrapper alias`,
        );
      }
      if (
        ts.isElementAccessExpression(child) &&
        isPiHostExpression(child.expression)
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, child, ts)} element access on the Pi registration host is unsupported`,
        );
      }
      if (ts.isPropertyAccessExpression(child) && isPiHostExpression(child.expression)) {
        const method = child.name.text;
        if (method.startsWith('register')) {
          if (!isDirectCallTarget(child)) {
            throw new DocsGateError(
              `${lineOf(info.sf, child, ts)} registration API ${method} must be called directly and must not be aliased or bound`,
            );
          }
          if (!PUBLIC_REGISTRATION_METHODS.has(method)) {
            throw new DocsGateError(
              `${lineOf(info.sf, child, ts)} unsupported public registration API ${method}`,
            );
          }
        }
      }
      if (
        ts.isReturnStatement(child) &&
        child.expression &&
        (expressionContainsUnsafePiUse(child.expression) ||
          expressionContainsLocalWrapper(child.expression))
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, child, ts)} wrapper must not return a Pi host or registration wrapper`,
        );
      }
      if (ts.isCallExpression(child)) {
        const access = directRegistrationAccess(child.expression);
        if (access) {
          calls.push({ call: child, method: access.name.text });
        } else if (
          expressionContainsLocalWrapper(child.expression) ||
          expressionContainsUnsafePiUse(child.expression) ||
          child.arguments.some(
            (argument) =>
              expressionContainsUnsafePiUse(argument) || expressionContainsLocalWrapper(argument),
          )
        ) {
          throw new DocsGateError(
            `${lineOf(info.sf, child, ts)} wrapper must not invoke another registration helper`,
          );
        }
      }
      ts.forEachChild(child, scan);
    };
    scan(node.body);
    if (calls.length !== 1 || calls[0].method !== 'registerTool') {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} tool wrapper must contain exactly one direct registerTool call and no secondary registrations`,
      );
    }
    const registration = calls[0].call;
    registrationAvailability(
      registration,
      node.body,
      'tool wrapper registerTool call',
      false,
    );
    const options = registration.arguments[0];
    if (!options) {
      throw new DocsGateError(`${lineOf(info.sf, registration, ts)} registerTool has no options object`);
    }
    assertPublicPropertiesAreExplicit(
      ts,
      root,
      rel,
      options,
      cache,
      new Set(wrapperPublicKeys),
      `${lineOf(info.sf, registration, ts)} tool wrapper registration`,
    );
    const props = objectProperties(ts, root, rel, options, cache);
    for (const key of wrapperPublicKeys) {
      const value = props.get(key);
      const unwrapped = value && unwrapExpression(value);
      if (
        !unwrapped ||
        !ts.isPropertyAccessExpression(unwrapped) ||
        !ts.isIdentifier(unwrapExpression(unwrapped.expression)) ||
        unwrapExpression(unwrapped.expression).text !== parameter.text ||
        unwrapped.name.text !== key
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, registration, ts)} tool wrapper public field ${key} must map directly from ${parameter.text}.${key}`,
        );
      }
    }
  };

  const wrapperCandidates = [];
  const findWrapperCandidates = (node) => {
    if (node !== fn && ts.isFunctionDeclaration(node) && node.body) {
      let hasDirectToolRegistration = false;
      const scan = (child) => {
        if (ts.isCallExpression(child)) {
          const access = directRegistrationAccess(child.expression);
          if (access?.name.text === 'registerTool') hasDirectToolRegistration = true;
        }
        ts.forEachChild(child, scan);
      };
      scan(node.body);
      if (hasDirectToolRegistration) wrapperCandidates.push(node);
    }
    ts.forEachChild(node, findWrapperCandidates);
  };
  findWrapperCandidates(fn.body ?? fn);
  for (const wrapper of wrapperCandidates) {
    if (wrapper.parent !== fn.body) {
      throw new DocsGateError(
        `${lineOf(info.sf, wrapper, ts)} tool wrapper definition must be top-level in its registration function`,
      );
    }
    if (!wrapper.name) {
      throw new DocsGateError(`${lineOf(info.sf, wrapper, ts)} tool wrapper must be named`);
    }
    if (localWrapperNames.has(wrapper.name.text)) {
      throw new DocsGateError(`${lineOf(info.sf, wrapper, ts)} duplicate tool wrapper ${wrapper.name.text}`);
    }
    localWrapperNames.add(wrapper.name.text);
  }
  for (const wrapper of wrapperCandidates) validateToolWrapper(wrapper);

  const containsUnsupportedNestedRegistration = (rootNode) => {
    let found =
      expressionContainsUnsafePiUse(rootNode) ||
      expressionContainsLocalWrapper(rootNode) ||
      expressionContainsConfigAuthority(rootNode);
    const scan = (node) => {
      if (found) return;
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        (expressionContainsUnsafePiUse(node.initializer) ||
          expressionContainsLocalWrapper(node.initializer))
      ) {
        found = true;
        return;
      }
      if (
        isAssignmentExpression(node) &&
        (expressionContainsUnsafePiUse(node.right) || expressionContainsLocalWrapper(node.right))
      ) {
        found = true;
        return;
      }
      if (
        ts.isBindingElement(node) &&
        destructuredRegistrationBinding(node.parent) !== undefined
      ) {
        found = true;
        return;
      }
      if (
        ts.isElementAccessExpression(node) &&
        (isPiHostExpression(node.expression) ||
          computedRegistrationMethod(node) !== undefined ||
          isDirectCallTarget(node))
      ) {
        found = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text.startsWith('register')
      ) {
        found = true;
        return;
      }
      if (ts.isCallExpression(node)) {
        if (
          expressionContainsLocalWrapper(node.expression) ||
          node.arguments.some(
            (argument) =>
              expressionContainsUnsafePiUse(argument) || expressionContainsLocalWrapper(argument),
          )
        ) {
          found = true;
          return;
        }
      }
      ts.forEachChild(node, scan);
    };
    scan(rootNode);
    return found;
  };

  const allowedClaimGuardReturns = new Set();
  if (fn.body && ts.isBlock(fn.body)) {
    const constInitializers = topLevelConstInitializers(ts, fn);
    const directPiEventCall = (node, method) => {
      const call = unwrapExpression(node);
      if (!ts.isCallExpression(call)) return undefined;
      const access = unwrapExpression(call.expression);
      if (!ts.isPropertyAccessExpression(access) || access.name.text !== method) return undefined;
      const eventsAccess = unwrapExpression(access.expression);
      if (
        !ts.isPropertyAccessExpression(eventsAccess) ||
        eventsAccess.name.text !== 'events' ||
        !isPiHostExpression(eventsAccess.expression)
      ) {
        return undefined;
      }
      return call;
    };
    const claimChannelValue = (expression, location) => {
      let value;
      try {
        value = literalValue(ts, root, rel, expression, cache);
      } catch {
        value = undefined;
      }
      if (value !== ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL) {
        throw new DocsGateError(
          `${lineOf(info.sf, location, ts)} duplicate-owner claim guard must emit exact channel ${ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL}`,
        );
      }
    };

    for (const [statementIndex, statement] of fn.body.statements.entries()) {
      if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) continue;
      const condition = unwrapExpression(statement.expression);
      if (
        !ts.isBinaryExpression(condition) ||
        condition.operatorToken.kind !== ts.SyntaxKind.GreaterThanToken ||
        !ts.isNumericLiteral(unwrapExpression(condition.right)) ||
        Number(unwrapExpression(condition.right).text) !== 0
      ) {
        continue;
      }
      const lengthAccess = unwrapExpression(condition.left);
      if (
        !ts.isPropertyAccessExpression(lengthAccess) ||
        lengthAccess.name.text !== 'length' ||
        !ts.isIdentifier(unwrapExpression(lengthAccess.expression))
      ) {
        continue;
      }
      const acknowledgements = unwrapExpression(lengthAccess.expression).text;
      const acknowledgementInitializer = constInitializers.get(acknowledgements);
      const acknowledgementArray =
        acknowledgementInitializer && unwrapExpression(acknowledgementInitializer);
      if (
        !acknowledgementArray ||
        !ts.isArrayLiteralExpression(acknowledgementArray) ||
        acknowledgementArray.elements.length !== 0
      ) {
        continue;
      }

      const guardedReturn = ts.isReturnStatement(statement.thenStatement)
        ? statement.thenStatement
        : ts.isBlock(statement.thenStatement) && statement.thenStatement.statements.length === 1 &&
            ts.isReturnStatement(statement.thenStatement.statements[0])
          ? statement.thenStatement.statements[0]
          : undefined;
      if (!guardedReturn || guardedReturn.expression !== undefined) continue;

      const candidate = fn.body.statements[statementIndex - 1];
      if (!candidate || !ts.isExpressionStatement(candidate)) continue;
      const emit = directPiEventCall(candidate.expression, 'emit');
      if (!emit || emit.arguments.length !== 2) continue;
      claimChannelValue(emit.arguments[0], emit);

      for (const preceding of fn.body.statements.slice(0, statementIndex - 1)) {
        if (!ts.isExpressionStatement(preceding)) continue;
        const listener = directPiEventCall(preceding.expression, 'on');
        if (!listener || listener.arguments.length < 1) continue;
        let listenerChannel;
        try {
          listenerChannel = literalValue(ts, root, rel, listener.arguments[0], cache);
        } catch {
          listenerChannel = undefined;
        }
        if (listenerChannel === ANTHROPIC_ATTRIBUTION_CLAIM_CHANNEL) {
          throw new DocsGateError(
            `${lineOf(info.sf, listener, ts)} duplicate-owner claim guard must not install a local claim listener before its probe`,
          );
        }
      }

      const probeArgument = unwrapExpression(emit.arguments[1]);
      if (!ts.isIdentifier(probeArgument)) {
        throw new DocsGateError(
          `${lineOf(info.sf, emit, ts)} duplicate-owner claim guard must emit one validated probe binding`,
        );
      }
      const probeInitializer = constInitializers.get(probeArgument.text);
      const probeObject = probeInitializer && unwrapExpression(probeInitializer);
      if (!probeObject || !ts.isObjectLiteralExpression(probeObject)) {
        throw new DocsGateError(
          `${lineOf(info.sf, emit, ts)} duplicate-owner claim guard probe must be a top-level const object`,
        );
      }
      const probeProperties = new Map();
      for (const property of probeObject.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
        ) {
          throw new DocsGateError(
            `${lineOf(info.sf, property, ts)} duplicate-owner claim guard probe must use exact explicit fields`,
          );
        }
        probeProperties.set(property.name.text, property);
      }
      if (
        probeProperties.size !== 2 ||
        !probeProperties.has('schema_version') ||
        !probeProperties.has('acknowledge')
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, probeObject, ts)} duplicate-owner claim guard probe must contain exactly schema_version and acknowledge`,
        );
      }
      const schemaProperty = probeProperties.get('schema_version');
      let schemaValue;
      try {
        schemaValue = literalValue(ts, root, rel, schemaProperty.initializer, cache);
      } catch {
        schemaValue = undefined;
      }
      if (schemaValue !== ANTHROPIC_ATTRIBUTION_CLAIM_SCHEMA) {
        throw new DocsGateError(
          `${lineOf(info.sf, schemaProperty, ts)} duplicate-owner claim guard must use exact schema ${ANTHROPIC_ATTRIBUTION_CLAIM_SCHEMA}`,
        );
      }

      const acknowledgeProperty = probeProperties.get('acknowledge');
      const callback = unwrapExpression(acknowledgeProperty.initializer);
      if (
        (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
        callback.parameters.length !== 0
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, acknowledgeProperty, ts)} duplicate-owner claim guard acknowledge field must be a zero-argument callback`,
        );
      }
      const callbackStatement = ts.isBlock(callback.body)
        ? callback.body.statements.length === 1
          ? callback.body.statements[0]
          : undefined
        : undefined;
      const appendExpression = callbackStatement && ts.isExpressionStatement(callbackStatement)
        ? unwrapExpression(callbackStatement.expression)
        : !ts.isBlock(callback.body)
          ? unwrapExpression(callback.body)
          : undefined;
      if (
        !appendExpression ||
        !ts.isCallExpression(appendExpression) ||
        appendExpression.arguments.length !== 1 ||
        appendExpression.arguments[0].kind !== ts.SyntaxKind.TrueKeyword ||
        !ts.isPropertyAccessExpression(unwrapExpression(appendExpression.expression)) ||
        unwrapExpression(appendExpression.expression).name.text !== 'push' ||
        !ts.isIdentifier(
          unwrapExpression(unwrapExpression(appendExpression.expression).expression),
        ) ||
        unwrapExpression(unwrapExpression(appendExpression.expression).expression).text !==
          acknowledgements
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, acknowledgeProperty, ts)} duplicate-owner claim guard acknowledge callback must append true to its acknowledgement array`,
        );
      }
      let acknowledgementUses = 0;
      let probeUses = 0;
      const countGuardBindings = (node) => {
        if (ts.isIdentifier(node) && node.text === acknowledgements) acknowledgementUses += 1;
        if (ts.isIdentifier(node) && node.text === probeArgument.text) probeUses += 1;
        ts.forEachChild(node, countGuardBindings);
      };
      countGuardBindings(fn.body);
      if (acknowledgementUses === 3 && probeUses === 2) {
        allowedClaimGuardReturns.add(guardedReturn);
      }
    }
  }

  const sessionStartRegistrationCallback = (node) => {
    const call = node.parent;
    if (!ts.isCallExpression(call) || call.arguments[1] !== node) return undefined;
    const access = directRegistrationAccess(call.expression);
    if (access?.name.text !== 'on') return undefined;
    const eventName = call.arguments[0] && unwrapExpression(call.arguments[0]);
    if (
      !eventName ||
      (!ts.isStringLiteral(eventName) && !ts.isNoSubstitutionTemplateLiteral(eventName)) ||
      eventName.text !== 'session_start'
    ) {
      return undefined;
    }
    let ownsRegistrations = false;
    const scan = (child) => {
      if (ownsRegistrations) return;
      if (child !== node && ts.isFunctionLike(child)) return;
      if (
        ts.isPropertyAccessExpression(child) &&
        child.name.text.startsWith('register')
      ) {
        ownsRegistrations = true;
        return;
      }
      if (ts.isCallExpression(child)) {
        const callee = calleeIdentifier(child.expression);
        if (
          callee &&
          info.imports.has(callee.text) &&
          isPiHostExpression(child.arguments[0])
        ) {
          ownsRegistrations = true;
          return;
        }
      }
      ts.forEachChild(child, scan);
    };
    scan(node.body);
    if (!ownsRegistrations) return undefined;
    if (!ts.isBlock(node.body)) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} registration-owning session_start callback must have a block body`,
      );
    }
    return registrationAvailability(call, fn.body, 'registration-owning session_start callback');
  };

  function visit(node) {
    if (node !== fn && ts.isFunctionLike(node)) {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        localWrapperNames.has(node.name.text)
      ) {
        return;
      }
      const callbackAvailability = sessionStartRegistrationCallback(node);
      if (callbackAvailability !== undefined) {
        collectRegistrationsInFunction(
          ts,
          root,
          rel,
          node,
          piParamName,
          cache,
          regs,
          visitedFns,
          callbackAvailability,
          configBindings,
        );
        return;
      }
      if (containsUnsupportedNestedRegistration(node)) {
        throw new DocsGateError(
          `${lineOf(info.sf, node, ts)} unsupported nested registration helper or invocation`,
        );
      }
      return;
    }
    if (
      ts.isReturnStatement(node) &&
      !allowedClaimGuardReturns.has(node)
    ) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} registration-owning scope contains unsupported early return control flow`,
      );
    }
    if (ts.isThrowStatement(node)) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} registration-owning scope contains unsupported throw control flow`,
      );
    }
    if (
      ts.isIdentifier(node) &&
      configBindings.has(node.text) &&
      !isAllowedConfigBindingUse(node)
    ) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} finite config binding ${node.text} escapes its validated availability condition`,
      );
    }
    if (
      ts.isIdentifier(node) &&
      node.text === piParamName &&
      !isAllowedPiIdentifierUse(node)
    ) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} Pi registration host escapes the supported direct-use grammar`,
      );
    }
    if (
      ts.isIdentifier(node) &&
      localWrapperNames.has(node.text) &&
      !isAllowedLocalWrapperIdentifierUse(node)
    ) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} registration wrapper escapes the supported direct-call grammar`,
      );
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (expressionContainsUnsafePiUse(node.initializer) ||
        expressionContainsLocalWrapper(node.initializer))
    ) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} aliasing the Pi registration host or registration wrapper is unsupported`,
      );
    }
    if (
      isAssignmentExpression(node) &&
      (expressionContainsUnsafePiUse(node.right) || expressionContainsLocalWrapper(node.right))
    ) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} assigning a Pi registration host or registration wrapper alias is unsupported`,
      );
    }
    if (ts.isBindingElement(node)) {
      const registrationBinding = destructuredRegistrationBinding(node.parent);
      if (registrationBinding !== undefined && !isLiteralDynamicRegistrationBinding(node)) {
        throw new DocsGateError(
          `${lineOf(info.sf, node, ts)} destructured registration binding ${registrationBinding} is unsupported`,
        );
      }
    }
    if (ts.isElementAccessExpression(node) && isPiHostExpression(node.expression)) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} element access on the Pi registration host is unsupported`,
      );
    }
    const computedMethod = computedRegistrationMethod(node);
    if (
      ts.isElementAccessExpression(node) &&
      !isPiHostExpression(node.expression) &&
      isDirectCallTarget(node)
    ) {
      if (computedMethod !== undefined) {
        throw new DocsGateError(
          `${lineOf(info.sf, node, ts)} computed registration method ${computedMethod} uses an unsupported registration host`,
        );
      }
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} computed invocation on an unknown host is unsupported in a registration-owning scope`,
      );
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text.startsWith('register') &&
      !isPiHostExpression(node.expression)
    ) {
      throw new DocsGateError(
        `${lineOf(info.sf, node, ts)} registration method ${node.name.text} uses an unsupported registration host binding`,
      );
    }
    if (ts.isPropertyAccessExpression(node) && isPiHostExpression(node.expression)) {
      const method = node.name.text;
      if (method.startsWith('register')) {
        if (!PUBLIC_REGISTRATION_METHODS.has(method) && !NON_PUBLIC_REGISTRATION_METHODS.has(method)) {
          throw new DocsGateError(
            `${lineOf(info.sf, node, ts)} unsupported registration API ${method}`,
          );
        }
        if (!isDirectCallTarget(node)) {
          throw new DocsGateError(
            `${lineOf(info.sf, node, ts)} registration API ${method} must be called directly and must not be aliased or bound`,
          );
        }
      }
    }
    if (ts.isCallExpression(node)) {
      if (node.arguments.some((argument) => expressionContainsLocalWrapper(argument))) {
        throw new DocsGateError(
          `${lineOf(info.sf, node, ts)} registration wrappers must not be passed as arguments`,
        );
      }
      const registration = directRegistrationAccess(node.expression);
      if (registration) {
        const availability = registrationAvailability(
          node,
          fn.body,
          'public registration call',
        );
        const method = registration.name.text;
        if (method === 'registerCommand') {
          const name = firstArgString(ts, root, rel, node, cache);
          addSurface(regs, 'command', name, lineOf(info.sf, node, ts), {
            ...commandDetails(ts, root, rel, name, node, cache),
            availability,
          });
        } else if (method === 'registerShortcut') {
          const name = firstArgString(ts, root, rel, node, cache);
          const details = commandDetails(ts, root, rel, name, node, cache);
          addSurface(regs, 'shortcut', name, lineOf(info.sf, node, ts), {
            description: details.description,
            availability,
          });
        } else if (method === 'registerMessageRenderer') {
          addSurface(
            regs,
            'renderer',
            firstArgString(ts, root, rel, node, cache),
            lineOf(info.sf, node, ts),
            { availability },
          );
        } else if (method === 'registerTool') {
          const first = node.arguments[0];
          if (!first) throw new DocsGateError(`${lineOf(info.sf, node, ts)} registerTool has no options object`);
          const details = toolDetailsFromObject(ts, root, rel, first, cache, lineOf(info.sf, node, ts));
          addSurface(regs, 'tool', details.name, details.source, { ...details, availability });
        }
      } else {
        const callee = calleeIdentifier(node.expression);
        if (callee && localWrapperNames.has(callee.text)) {
          const availability = registrationAvailability(
            node,
            fn.body,
            'local registration-wrapper call',
          );
          const first = node.arguments[0];
          if (!first) throw new DocsGateError(`${lineOf(info.sf, node, ts)} local registration wrapper has no options object`);
          const details = toolDetailsFromObject(ts, root, rel, first, cache, lineOf(info.sf, node, ts));
          addSurface(regs, 'tool', details.name, details.source, { ...details, availability });
        } else if (expressionContainsLocalWrapper(node.expression)) {
          throw new DocsGateError(
            `${lineOf(info.sf, node, ts)} unsupported derived registration-wrapper invocation`,
          );
        } else if (expressionContainsUnsafePiUse(node.expression)) {
          throw new DocsGateError(
            `${lineOf(info.sf, node, ts)} unsupported derived Pi registration invocation`,
          );
        } else if (callee) {
          const imported = info.imports.get(callee.text);
          const first = node.arguments[0];
          if (imported && isPiHostExpression(first)) {
            const availability = registrationAvailability(
              node,
              fn.body,
              'imported registration-helper call',
            );
            const next = findExportedFunction(ts, root, imported.rel, imported.exported, cache);
            const nextKey = `${next.rel}:${imported.exported}`;
            if (visitedFns.has(nextKey)) {
              throw new DocsGateError(
                `${lineOf(info.sf, node, ts)} imported registration function ${nextKey} is invoked more than once`,
              );
            }
            visitedFns.add(nextKey);
            const nextParameter = next.node.parameters[0]?.name;
            if (!nextParameter || !ts.isIdentifier(nextParameter)) {
              throw new DocsGateError(
                `${next.rel} exported registration function must have an identifier Pi parameter`,
              );
            }
            collectRegistrationsInFunction(
              ts,
              root,
              next.rel,
              next.node,
              nextParameter.text,
              cache,
              regs,
              visitedFns,
              availability,
            );
          } else if (node.arguments.some((argument) => expressionContainsUnsafePiUse(argument))) {
            throw new DocsGateError(
              `${lineOf(info.sf, node, ts)} unsupported helper invocation receives the Pi registration host`,
            );
          }
        } else if (node.arguments.some((argument) => expressionContainsUnsafePiUse(argument))) {
          throw new DocsGateError(
            `${lineOf(info.sf, node, ts)} unsupported non-identifier helper invocation receives the Pi registration host`,
          );
        }
      }
    }
    if (ts.isNewExpression(node)) {
      const args = node.arguments ?? [];
      if (
        expressionContainsLocalWrapper(node.expression) ||
        expressionContainsUnsafePiUse(node.expression) ||
        args.some(
          (argument) =>
            expressionContainsUnsafePiUse(argument) || expressionContainsLocalWrapper(argument),
        )
      ) {
        throw new DocsGateError(
          `${lineOf(info.sf, node, ts)} constructors must not receive or derive Pi registration hosts or wrappers`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(fn.body ?? fn);
}

function uniqueRegistrations(regs) {
  const out = [];
  const seen = new Map();
  for (const reg of regs) {
    const key = `${reg.kind}:${reg.name}`;
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new DocsGateError(
        `duplicate public registration ${key}: ${String(previous)} and ${String(reg.source)}`,
      );
    }
    seen.set(key, reg.source);
    out.push({ ...reg, id: key });
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

function extractEntrypoint(root, pkg, ts, cache) {
  const entries = pkg.pi?.extensions;
  if (!Array.isArray(entries) || entries.length === 0 || entries.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) throw new DocsGateError('package.json pi.extensions must contain at least one non-blank extension entrypoint');
  const regs = [];
  for (const declaredEntry of entries) {
    const entry = declaredEntry.replace(/^\.\//u, '');
    const compiledSource = entry.startsWith('dist/') && entry.endsWith('.js')
      ? `${entry.slice('dist/'.length, -'.js'.length)}.ts`
      : undefined;
    const entryRel = compiledSource ?? (entry.endsWith('.ts') ? entry : `${entry}.ts`);
    if (!existsSync(packagePath(root, entryRel))) throw new DocsGateError(`package.json Pi extension ${entry} has no authoritative TypeScript source ${entryRel}`);
    const target = findExportedFunction(ts, root, entryRel, 'default', cache);
    moduleInfo(ts, root, target.rel, cache);
    const piParameter = target.node.parameters[0]?.name;
    if (!piParameter || !ts.isIdentifier(piParameter)) {
      throw new DocsGateError(`${target.rel} default export must have an identifier Pi parameter`);
    }
    collectRegistrationsInFunction(ts, root, target.rel, target.node, piParameter.text, cache, regs, new Set([`${target.rel}:default`]));
  }
  return uniqueRegistrations(regs);
}

function collectStringLiterals(ts, root, rel, sink) {
  const info = moduleInfo(ts, root, rel, new Map());
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) sink(node.text, rel, lineOf(info.sf, node, ts));
    ts.forEachChild(node, visit);
  };
  visit(info.sf);
}

function collectEnvReferences(ts, root, rel, sink) {
  const info = moduleInfo(ts, root, rel, new Map());
  const envAliases = new Set(['process.env']);
  const envReaderHelpers = new Set();
  const envLookupHelpers = new Map();
  const envReaderHelperRanges = [];

  const keyFromExpr = (expr) => {
    if (!expr) throw new DocsGateError(`${rel}: missing env key expression`);
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
    if (ts.isIdentifier(expr)) return String(resolveIdentifierValue(ts, root, rel, expr.text, new Map()));
    throw new DocsGateError(`${lineOf(info.sf, expr, ts)} unsupported dynamic environment key; docs gate requires literal or literal constant`);
  };

  const isEnvObject = (expr) => envAliases.has(expr.getText(info.sf));

  const prepass = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (node.initializer.getText(info.sf) === 'process.env') envAliases.add(node.name.text);
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      if (node.parameters.length === 1 && ts.isIdentifier(node.parameters[0].name)) {
        const param = node.parameters[0].name.text;
        let readsParam = false;
        const scanBody = (child) => {
          if (ts.isElementAccessExpression(child) && child.expression.getText(info.sf) === 'process.env' && child.argumentExpression?.getText(info.sf) === param) readsParam = true;
          ts.forEachChild(child, scanBody);
        };
        if (node.body) scanBody(node.body);
        if (readsParam) {
          envReaderHelpers.add(node.name.text);
          envReaderHelperRanges.push({ pos: node.pos, end: node.end });
        }
      }
      if (node.parameters.length >= 2 && node.parameters.every((p) => ts.isIdentifier(p.name))) {
        const params = node.parameters.map((p) => p.name.text);
        if (!params.includes('env')) {
          ts.forEachChild(node, prepass);
          return;
        }
        let keyIndex = -1;
        const scanBody = (child) => {
          if (ts.isElementAccessExpression(child) && ts.isIdentifier(child.expression) && params.includes(child.expression.text) && ts.isIdentifier(child.argumentExpression)) {
            const idx = params.indexOf(child.argumentExpression.text);
            if (idx >= 0) keyIndex = idx;
          }
          ts.forEachChild(child, scanBody);
        };
        if (node.body) scanBody(node.body);
        if (keyIndex >= 0) {
          envLookupHelpers.set(node.name.text, keyIndex);
          envReaderHelperRanges.push({ pos: node.pos, end: node.end });
        }
      }
    }
    ts.forEachChild(node, prepass);
  };
  prepass(info.sf);

  const inEnvReaderHelper = (node) => envReaderHelperRanges.some((range) => node.pos >= range.pos && node.end <= range.end);

  const visit = (node) => {
    if (ts.isElementAccessExpression(node) && isEnvObject(node.expression)) {
      let key;
      try {
        key = keyFromExpr(node.argumentExpression);
      } catch (error) {
        if (inEnvReaderHelper(node)) key = undefined;
        else throw error;
      }
      if (key !== undefined) {
        const parent = node.parent;
        const access = ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ? 'write' : 'read';
        sink(key, access, rel, lineOf(info.sf, node, ts));
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(info.sf) === 'process.env') sink(node.name.text, 'read', rel, lineOf(info.sf, node, ts));
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && envReaderHelpers.has(node.expression.text)) {
      sink(keyFromExpr(node.arguments[0]), 'read', rel, lineOf(info.sf, node, ts));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && envLookupHelpers.has(node.expression.text)) {
      sink(keyFromExpr(node.arguments[envLookupHelpers.get(node.expression.text)]), 'read', rel, lineOf(info.sf, node, ts));
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && /^(?:env|out)$/u.test(node.expression.text)) {
      let key;
      try {
        key = keyFromExpr(node.argumentExpression);
      } catch (error) {
        if (inEnvReaderHelper(node)) key = undefined;
        else throw error;
      }
      if (key !== undefined && /^(?:[A-Z][A-Za-z0-9_]*|Path|path|ComSpec)$/u.test(key)) {
        const parent = node.parent;
        const access = ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ? 'write' : 'read';
        sink(key, access, rel, lineOf(info.sf, node, ts));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(info.sf);

  for (const [name, decl] of info.constDecls) {
    if (!/_REMOVED_ENV_KEYS$/u.test(name)) continue;
    try {
      const values = literalValue(ts, root, rel, decl.expr, new Map());
      if (Array.isArray(values)) for (const key of values) sink(String(key), 'remove', rel, `${rel}:${lineOf(info.sf, decl.expr, ts).split(':').pop()}`);
    } catch (error) {
      throw new DocsGateError(`${rel}: could not extract ${name}: ${error.message}`);
    }
  }
}

function exportedConstants(ts, root, rel, cache) {
  const info = moduleInfo(ts, root, rel, cache);
  const out = [];
  for (const [name, decl] of info.constDecls) {
    if (!decl.exported) continue;
    if (!/^(?:[A-Z][A-Z0-9_]*|FUSION_|DELEGATE_|BG_|TOKEN_BUDGET_|TASK_|MAX_|DEFAULT_)/u.test(name)) continue;
    try {
      const value = literalValue(ts, root, rel, decl.expr, cache);
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value) || (value && typeof value === 'object')) {
        out.push({ name, value, source: `${rel}:${lineOf(info.sf, decl.expr, ts).split(':').pop()}` });
      }
    } catch {
      if (/(MAX|DEFAULT|LIMIT|TIMEOUT|BYTES|TOKENS|SCHEMA|STATUS|VALUES|TOOLS|CAPABILITIES|CHANNEL|NAME|POLICY|_ID|RESERVED|WINDOW|GRACE|WAIT)/u.test(name)) {
        out.push({ name, value: { expression: decl.expr.getText(info.sf) }, source: `${rel}:${lineOf(info.sf, decl.expr, ts).split(':').pop()}` });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function extractEventBus(ts, root, cache) {
  const rel = 'src/core/extension-api.ts';
  const constants = new Map(exportedConstants(ts, root, rel, cache).map((x) => [x.name, x]));
  const required = ['BG_REQUEST_CHANNEL', 'BG_RESPONSE_CHANNEL', 'BG_TERMINAL_CHANNEL', 'BG_REQUEST_SCHEMA', 'BG_RESPONSE_SCHEMA', 'BG_TERMINAL_SCHEMA', 'BG_EXTENSION_CAPABILITIES'];
  for (const key of required) if (!constants.has(key)) throw new DocsGateError(`EventBus extraction missing ${key}`);
  const info = moduleInfo(ts, root, rel, cache);
  const ops = [];
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'BackgroundTaskExtensionOperation' && ts.isUnionTypeNode(node.type)) {
      for (const type of node.type.types) {
        if (!ts.isLiteralTypeNode(type) || !ts.isStringLiteral(type.literal)) throw new DocsGateError('BackgroundTaskExtensionOperation contains a non-string member');
        ops.push(type.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(info.sf);
  if (ops.length === 0) throw new DocsGateError('BackgroundTaskExtensionOperation union was not extracted');
  return {
    id: 'background-task-v1',
    source: rel,
    channels: {
      request: constants.get('BG_REQUEST_CHANNEL').value,
      response: constants.get('BG_RESPONSE_CHANNEL').value,
      terminal: constants.get('BG_TERMINAL_CHANNEL').value,
    },
    schemas: {
      request: constants.get('BG_REQUEST_SCHEMA').value,
      response: constants.get('BG_RESPONSE_SCHEMA').value,
      terminal: constants.get('BG_TERMINAL_SCHEMA').value,
    },
    operations: ops.sort(),
    capabilities: constants.get('BG_EXTENSION_CAPABILITIES').value,
  };
}

function extractFusionWorkflows(ts, root, cache) {
  const rel = 'src/core/fusion/workflows.ts';
  const names = ['FUSION_REASON_WORKFLOW', 'FUSION_INVESTIGATE_WORKFLOW', 'FUSION_RESEARCH_WORKFLOW', 'FUSION_VALIDATE_WORKFLOW'];
  const keys = ['id', 'publicName', 'toolName', 'runIdPrefix', 'contextKind', 'candidateCapability', 'candidateTools', 'evaluatorCapability', 'evaluatorTools', 'mergeCapability', 'mergeTools', 'label'];
  const workflows = [];
  const info = moduleInfo(ts, root, rel, cache);
  for (const name of names) {
    const decl = info.constDecls.get(name);
    if (!decl) throw new DocsGateError(`missing ${name}`);
    const init = stripAsConst(ts, decl.expr);
    if (!ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'freezeProfile' || init.arguments.length !== 1) throw new DocsGateError(`${name} must be freezeProfile({...}) for docs extraction`);
    const obj = stripAsConst(ts, init.arguments[0]);
    if (!ts.isObjectLiteralExpression(obj)) throw new DocsGateError(`${name} workflow profile must be an object literal`);
    const profile = {};
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) throw new DocsGateError(`${name} contains unsupported workflow property syntax`);
      const key = propertyNameText(ts, root, rel, prop.name, cache);
      if (!keys.includes(key)) continue;
      profile[key] = literalValue(ts, root, rel, prop.initializer, cache);
    }
    for (const key of keys) if (!Object.prototype.hasOwnProperty.call(profile, key)) throw new DocsGateError(`${name} missing workflow key ${key}`);
    profile.source = `${rel}:${lineOf(info.sf, decl.expr, ts).split(':').pop()}`;
    workflows.push(profile);
  }
  return workflows.sort((a, b) => a.id.localeCompare(b.id));
}

function extractStatusVocabularies(ts, root, cache) {
  const candidates = [
    ['TASK_STATUS_VALUES', 'src/core/common.ts'],
    ['TERMINAL_TASK_STATUS_VALUES', 'src/core/common.ts'],
    ['DELEGATE_MANIFEST_STATES', 'src/core/delegate/artifacts.ts'],
    ['FUSION_STAGE_VALUES', 'src/core/fusion/types.ts'],
    ['FUSION_CAPABILITY_VALUES', 'src/core/fusion/types.ts'],
    ['FUSION_STATE_VALUES', 'src/core/fusion/types.ts'],
    ['FUSION_TERMINAL_STATE_VALUES', 'src/core/fusion/types.ts'],
    ['FUSION_BUDGET_STAGE_VALUES', 'src/core/fusion/types.ts'],
  ];
  const out = {};
  for (const [name, rel] of candidates) out[name] = resolveIdentifierValue(ts, root, rel, name, cache);
  return sortDeep(out);
}

function dedupeByName(items) {
  const map = new Map();
  for (const item of items) if (!map.has(item.name)) map.set(item.name, item);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function runtimeArtifacts(ts, root) {
  const source = (rel, literal) => lineForLiteral(ts, root, rel, literal);
  const sourceText = (rel, needle) => lineForText(root, rel, needle);
  const items = [
    { kind: 'directory', value: '.pi/tasks/<session-id>-<pid>/', source: sourceText('src/core/registry.ts', "join(ctx.cwd, '.pi', 'tasks'") },
    { kind: 'task-file', value: '.pi/tasks/<session-id>-<pid>/<task-id>.output', source: sourceText('src/core/registry.ts', 'const outputAbsPath = join(dir.abs') },
    { kind: 'task-file', value: '.pi/tasks/<session-id>-<pid>/<task-id>.json', source: sourceText('src/core/registry.ts', 'const metadataAbsPath = join(dir.abs') },
    { kind: 'task-file', value: '.pi/tasks/<session-id>-<pid>/<task-id>.pi-events.jsonl', source: sourceText('src/core/attested-pi-run.ts', 'eventsAbsPath: join') },
    { kind: 'task-file', value: '.pi/tasks/<session-id>-<pid>/<task-id>.stderr', source: sourceText('src/core/attested-pi-run.ts', 'stderrAbsPath: join') },
    { kind: 'task-file', value: '.pi/tasks/<session-id>-<pid>/<task-id>.pi-telemetry-wrapper.cjs', source: sourceText('src/core/attested-pi-run.ts', 'wrapperAbsPath: join') },
    { kind: 'task-file', value: '.pi/tasks/<session-id>-<pid>/<task-id>.attestation.json', source: sourceText('src/core/attested-pi-run.ts', 'attestationAbsPath: join') },
    { kind: 'directory', value: '.pi/delegate/<session-id>-<pid>/<task-id>/', source: source('src/core/delegate/artifacts.ts', '.pi') },
    { kind: 'delegate-artifact', value: 'seed.json', source: source('src/core/delegate/artifacts.ts', 'seed.json') },
    { kind: 'delegate-artifact', value: 'child-prompt.txt', source: source('src/core/delegate/artifacts.ts', 'child-prompt.txt') },
    { kind: 'delegate-artifact', value: 'context-omission-ledger.json', source: source('src/core/delegate/artifacts.ts', 'context-omission-ledger.json') },
    { kind: 'delegate-artifact', value: 'budget-plan.json', source: source('src/core/delegate/artifacts.ts', 'budget-plan.json') },
    { kind: 'delegate-artifact', value: 'manifest.json', source: source('src/core/delegate/artifacts.ts', 'manifest.json') },
    { kind: 'delegate-artifact', value: 'result.json', source: source('src/core/delegate/result-package.ts', 'result.json') },
    { kind: 'delegate-artifact', value: 'outcome.json', source: source('src/core/delegate/artifacts.ts', 'outcome.json') },
    { kind: 'delegate-artifact', value: 'error.json', source: source('src/core/delegate/artifacts.ts', 'error.json') },
    { kind: 'delegate-artifact', value: 'spill/<receipt-named-file>', source: source('src/core/delegate/artifacts.ts', 'spill') },
    { kind: 'directory', value: '.pi/fusion/<session-id>-<pid>/<run-id>/', source: source('src/core/fusion/artifacts.ts', '.pi') },
    { kind: 'fusion-artifact', value: 'canonical-input.json', source: source('src/core/fusion/artifacts.ts', 'canonical-input.json') },
    { kind: 'fusion-artifact', value: 'context-omission-ledger.json', source: source('src/core/fusion/artifacts.ts', 'context-omission-ledger.json') },
    { kind: 'fusion-artifact', value: 'source-policy.private.json', source: source('src/core/fusion/artifacts.ts', 'source-policy.private.json') },
    { kind: 'fusion-artifact', value: 'budget-plan.json', source: source('src/core/fusion/artifacts.ts', 'budget-plan.json') },
    { kind: 'fusion-artifact', value: 'blind-candidates.json', source: source('src/core/fusion/artifacts.ts', 'blind-candidates.json') },
    { kind: 'fusion-artifact', value: 'evaluation.json', source: source('src/core/fusion/artifacts.ts', 'evaluation.json') },
    { kind: 'fusion-artifact', value: 'merged.md', source: source('src/core/fusion/artifacts.ts', 'merged.md') },
    { kind: 'fusion-artifact', value: 'result.json', source: source('src/core/fusion/artifacts.ts', 'result.json') },
    { kind: 'fusion-artifact', value: 'error.json', source: source('src/core/fusion/artifacts.ts', 'error.json') },
    { kind: 'fusion-artifact', value: '<attempt-prefix> = candidate-<slot>.attempt-<n> | evaluation.attempt-<n> | merge.attempt-<n>', source: sourceText('src/core/fusion/artifacts.ts', 'function attemptPrefix') },
    { kind: 'fusion-artifact', value: '<attempt-prefix>.prompt.txt', source: source('src/core/fusion/artifacts.ts', '.prompt.txt') },
    { kind: 'fusion-artifact', value: '<attempt-prefix>.events.jsonl', source: source('src/core/fusion/artifacts.ts', '.events.jsonl') },
    { kind: 'fusion-artifact', value: '<attempt-prefix>.stderr.txt', source: source('src/core/fusion/artifacts.ts', '.stderr.txt') },
    { kind: 'fusion-artifact', value: 'candidate-<slot>.attempt-<n>.response.md | candidate-<slot>.attempt-<n>.response.partial.md', source: sourceText('src/core/fusion/artifacts.ts', 'function responseName') },
    { kind: 'fusion-artifact', value: 'evaluation.attempt-<n>.response.txt | evaluation.attempt-<n>.response.partial.txt', source: sourceText('src/core/fusion/artifacts.ts', 'function responseName') },
    { kind: 'fusion-artifact', value: 'merge.attempt-<n>.response.md | merge.attempt-<n>.response.partial.md', source: sourceText('src/core/fusion/artifacts.ts', 'function responseName') },
    { kind: 'fusion-artifact', value: 'candidate-<slot>.attempt-<n>.tool-calls.jsonl', source: source('src/core/fusion/artifacts.ts', '.tool-calls.jsonl') },
    { kind: 'fusion-artifact', value: 'candidate-<slot>.attempt-<n>.tool-calls.jsonl.seal.json', source: source('src/core/fusion/child-protocol.ts', '.seal.json') },
    { kind: 'fusion-artifact', value: '<attempt-prefix>.calibration-violation.json', source: source('src/core/fusion/artifacts.ts', '.calibration-violation.json') },
    { kind: 'config', value: 'fusion-models.json', source: source('src/core/fusion/config.ts', 'fusion-models.json') },
  ];
  return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
}

export function buildCodeFacts(options = {}) {
  const root = resolve(options.packageRoot ?? PACKAGE_ROOT);
  const pkg = readJson(root, 'package.json');
  const lock = readJson(root, 'package-lock.json');
  const ts = loadTypeScript();
  const cache = new Map();
  const tsSources = [...walkFiles(root, 'src', (f) => f.endsWith('.ts')), ...walkFiles(root, 'extensions', (f) => f.endsWith('.ts'))].sort();
  const governedSources = [...walkFiles(root, 'src', () => true), ...walkFiles(root, 'extensions', () => true)].sort();
  const configurationVariants = variantContractFromModule(
    ts,
    root,
    'src/core/config.ts',
    cache,
  );
  const registrations = extractEntrypoint(root, pkg, ts, cache).map((registration) => ({
    ...registration,
    availability: registration.availability ?? ALWAYS_AVAILABLE,
    default_available: isDefaultAvailability(
      registration.availability ?? ALWAYS_AVAILABLE,
      configurationVariants,
    ),
  }));
  const eventBus = extractEventBus(ts, root, cache);
  const workflows = extractFusionWorkflows(ts, root, cache);
  const synthetic = [
    { kind: 'eventbus', name: eventBus.id, id: `eventbus:${eventBus.id}`, source: eventBus.source, channels: eventBus.channels, operations: eventBus.operations, availability: ALWAYS_AVAILABLE, default_available: true },
    ...workflows.map((workflow) => ({ kind: 'workflow', name: workflow.id, id: `workflow:${workflow.id}`, source: workflow.source, toolName: workflow.toolName, contextKind: workflow.contextKind, availability: 'feature:fusion', default_available: isDefaultAvailability('feature:fusion', configurationVariants) })),
  ];
  const allSurfaces = uniqueRegistrations([...registrations, ...synthetic]);
  const byKind = Object.fromEntries(PUBLIC_KINDS.map((kind) => [kind, allSurfaces.filter((r) => r.kind === kind).map((r) => sortDeep(r))]));

  const schemaIds = new Map();
  const envVars = new Map();
  for (const rel of tsSources) {
    collectStringLiterals(ts, root, rel, (text, file, source) => {
      if (/^pi-background-tasks[.A-Za-z0-9_-]*\.v\d+$/u.test(text) || text === 'phase2.pi_task_attestation.v1') schemaIds.set(text, { id: text, source });
    });
    collectEnvReferences(ts, root, rel, (name, access, file, source) => {
      const key = String(name);
      const existing = envVars.get(key) ?? { name: key, access: [], sources: [] };
      if (!existing.access.includes(access)) existing.access.push(access);
      existing.sources.push(source);
      existing.access.sort();
      existing.sources = [...new Set(existing.sources)].sort();
      envVars.set(key, existing);
    });
  }

  const constants = dedupeByName(tsSources.flatMap((rel) => exportedConstants(ts, root, rel, cache))).filter((item) => /(MAX|DEFAULT|LIMIT|TIMEOUT|BYTES|TOKENS|SCHEMA|STATUS|VALUES|TOOLS|CAPABILITIES|CHANNEL|NAME|POLICY|_ID|RESERVED|WINDOW|GRACE|WAIT)/u.test(item.name));

  const packageFacts = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    engines: pkg.engines ?? {},
    entrypoints: [...(pkg.pi?.extensions ?? [])],
    image: pkg.pi?.image ?? null,
    type: pkg.type,
    files: [...(pkg.files ?? [])].sort(),
  };
  return sortDeep({
    package: packageFacts,
    lock: { name: lock.name, version: lock.version, rootVersion: lock.packages?.['']?.version ?? null },
    configuration_variants: configurationVariants,
    public_surfaces: byKind,
    public_surface_ids: allSurfaces.map((r) => r.id).sort(),
    default_public_surface_ids: allSurfaces.filter((r) => r.default_available).map((r) => r.id).sort(),
    tool_contracts: registrations.filter((r) => r.kind === 'tool').map((r) => sortDeep(r)).sort((a, b) => a.name.localeCompare(b.name)),
    command_contracts: registrations.filter((r) => r.kind === 'command').map((r) => sortDeep(r)).sort((a, b) => a.name.localeCompare(b.name)),
    shortcut_contracts: registrations.filter((r) => r.kind === 'shortcut').map((r) => sortDeep(r)).sort((a, b) => a.name.localeCompare(b.name)),
    renderer_contracts: registrations.filter((r) => r.kind === 'renderer').map((r) => sortDeep(r)).sort((a, b) => a.name.localeCompare(b.name)),
    event_bus: eventBus,
    fusion_workflows: workflows,
    status_vocabularies: extractStatusVocabularies(ts, root, cache),
    schema_ids: [...schemaIds.values()].sort((a, b) => a.id.localeCompare(b.id)),
    runtime_paths_and_artifacts: runtimeArtifacts(ts, root),
    environment_variables: [...envVars.values()].sort((a, b) => a.name.localeCompare(b.name)),
    exported_limits_and_defaults: constants,
    governed_sources: governedSources,
  });
}

function parseScalar(raw, location) {
  const value = raw.trim();
  if (value === '[]') return [];
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new DocsGateError(`${location}: unterminated quoted scalar`);
    return value.slice(1, -1).replace(/''/gu, "'");
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) throw new DocsGateError(`${location}: unterminated double-quoted scalar`);
    return JSON.parse(value);
  }
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new DocsGateError(`${location}: unterminated inline list`);
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    const parts = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i];
      if (quote) {
        current += ch;
        if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
        current += ch;
      } else if (ch === ',') {
        parts.push(current.trim());
        current = '';
      } else current += ch;
    }
    if (quote) throw new DocsGateError(`${location}: unterminated quoted list item`);
    if (current.trim()) parts.push(current.trim());
    return parts.map((part) => parseScalar(part, location));
  }
  if (!value) throw new DocsGateError(`${location}: empty scalar`);
  return value;
}

export function splitFrontmatter(text, location) {
  if (!text.startsWith(`${FRONTMATTER_FENCE}\n`)) throw new DocsGateError(`${location}: missing frontmatter`);
  const end = text.indexOf(`\n${FRONTMATTER_FENCE}\n`, FRONTMATTER_FENCE.length);
  if (end === -1) throw new DocsGateError(`${location}: frontmatter is not closed`);
  return { frontmatterText: text.slice(FRONTMATTER_FENCE.length + 1, end), body: text.slice(end + 5) };
}

export function parseFrontmatter(text, location) {
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (/^\s/u.test(line)) throw new DocsGateError(`${location}: frontmatter line ${String(i + 1)} uses unsupported indentation`);
    const m = /^([a-z_]+):\s*(.*)$/u.exec(line);
    if (!m) throw new DocsGateError(`${location}: malformed frontmatter line ${String(i + 1)}`);
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(out, key)) throw new DocsGateError(`${location}: duplicate frontmatter key ${key}`);
    if (m[2].trim() === '') {
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const item = /^\s+-\s*(.*)$/u.exec(lines[j]);
        if (!item) break;
        items.push(parseScalar(item[1], location));
        j += 1;
      }
      if (items.length === 0) throw new DocsGateError(`${location}: empty block scalar for ${key}`);
      out[key] = items;
      i = j - 1;
    } else out[key] = parseScalar(m[2], location);
  }
  return out;
}

export function serializeFrontmatter(fm) {
  const lines = ['---'];
  for (const key of FRONTMATTER_KEYS) {
    const value = fm[key];
    if (Array.isArray(value)) lines.push(`${key}: [${[...value].sort().map((x) => quoteScalar(x)).join(', ')}]`);
    else lines.push(`${key}: ${quoteScalar(value)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function quoteScalar(value) {
  if (typeof value !== 'string') throw new DocsGateError(`frontmatter scalar must be string, got ${typeof value}`);
  if (/^[A-Za-z0-9_./:-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, "''")}'`;
}

function canonicalFrontmatter(fm) {
  return {
    doc_id: fm.doc_id,
    audience: fm.audience,
    mode: fm.mode,
    review_policy: fm.review_policy,
    stability: fm.stability,
    covers_surfaces: [...(fm.covers_surfaces ?? [])].sort(),
    covers_sources: [...(fm.covers_sources ?? [])].sort(),
  };
}

export function loadDocsModel(options = {}) {
  const root = resolve(options.packageRoot ?? PACKAGE_ROOT);
  const files = markdownDocs(root);
  const docs = [];
  for (const rel of files) {
    const text = readFileSync(packagePath(root, rel), 'utf8');
    const { frontmatterText, body } = splitFrontmatter(text, rel);
    let fm = parseFrontmatter(frontmatterText, rel);
    if (GENERATED_DOC_OVERRIDES.has(rel)) fm = { ...fm, ...GENERATED_DOC_OVERRIDES.get(rel) };
    const keys = Object.keys(fm).sort();
    const allowed = new Set(FRONTMATTER_KEYS);
    for (const key of keys) if (!allowed.has(key)) throw new DocsGateError(`${rel}: unknown frontmatter key ${key}`);
    for (const key of FRONTMATTER_KEYS) if (!Object.prototype.hasOwnProperty.call(fm, key)) throw new DocsGateError(`${rel}: missing frontmatter key ${key}`);
    fm = canonicalFrontmatter(fm);
    const expected = rel.slice('docs/'.length).replace(/\.md$/u, '');
    if (fm.doc_id !== expected) throw new DocsGateError(`${rel}: doc_id must equal ${expected}`);
    if (!ALLOWED_AUDIENCE.includes(fm.audience)) throw new DocsGateError(`${rel}: invalid audience ${fm.audience}`);
    if (!ALLOWED_MODE.includes(fm.mode)) throw new DocsGateError(`${rel}: invalid mode ${fm.mode}`);
    if (!ALLOWED_REVIEW.includes(fm.review_policy)) throw new DocsGateError(`${rel}: invalid review_policy ${fm.review_policy}`);
    if (!ALLOWED_STABILITY.includes(fm.stability)) throw new DocsGateError(`${rel}: invalid stability ${fm.stability}`);
    for (const key of ['covers_surfaces', 'covers_sources']) {
      if (!Array.isArray(fm[key]) || fm[key].some((x) => typeof x !== 'string' || x.length === 0)) throw new DocsGateError(`${rel}: ${key} must be an array of non-empty strings`);
      if (new Set(fm[key]).size !== fm[key].length) throw new DocsGateError(`${rel}: ${key} contains duplicates`);
      if (fm[key].some((x) => /[*?{}]/u.test(x))) throw new DocsGateError(`${rel}: ${key} must not contain globs`);
    }
    if (fm.covers_sources.some((s) => s.startsWith('packages/') || s.startsWith('/') || s.startsWith('../'))) throw new DocsGateError(`${rel}: covers_sources must be package-relative`);
    docs.push({ rel, doc_id: fm.doc_id, frontmatter: fm, body, text });
  }
  const ids = new Set();
  for (const doc of docs) {
    if (ids.has(doc.doc_id)) throw new DocsGateError(`duplicate doc_id ${doc.doc_id}`);
    ids.add(doc.doc_id);
  }
  return { docs: docs.sort((a, b) => a.doc_id.localeCompare(b.doc_id)) };
}

function docsModelFromTexts(texts) {
  const docs = [];
  for (const [rel, text] of Object.entries(texts)) {
    if (!rel.startsWith('docs/') || !rel.endsWith('.md')) continue;
    const { frontmatterText, body } = splitFrontmatter(text, rel);
    const fm = canonicalFrontmatter(parseFrontmatter(frontmatterText, rel));
    docs.push({ rel, doc_id: fm.doc_id, frontmatter: fm, body, text });
  }
  return { docs: docs.sort((a, b) => a.doc_id.localeCompare(b.doc_id)) };
}

function generatedRegionMatches(text) {
  const begin = /<!-- pi-docs:begin name="([A-Za-z0-9_.-]+)" generator="([^"]+)" -->/gu;
  const end = /<!-- pi-docs:end name="([A-Za-z0-9_.-]+)" -->/gu;
  const tokens = [];
  for (const match of text.matchAll(begin)) tokens.push({ type: 'begin', name: match[1], generator: match[2], index: match.index });
  for (const match of text.matchAll(end)) tokens.push({ type: 'end', name: match[1], index: match.index });
  tokens.sort((a, b) => a.index - b.index);
  const regions = [];
  const stack = [];
  const names = new Set();
  for (const token of tokens) {
    if (token.type === 'begin') {
      if (stack.length > 0) throw new DocsGateError('generated regions must not be nested');
      if (names.has(token.name)) throw new DocsGateError(`duplicate generated region ${token.name}`);
      if (token.generator !== MARKER_GENERATOR) throw new DocsGateError(`unknown region generator ${token.generator}`);
      names.add(token.name);
      stack.push(token);
    } else {
      const open = stack.pop();
      if (!open) throw new DocsGateError(`generated region ${token.name} has no begin marker`);
      if (open.name !== token.name) throw new DocsGateError(`generated region closes ${token.name} but opened ${open.name}`);
      regions.push({ name: open.name, generator: open.generator });
    }
  }
  if (stack.length > 0) throw new DocsGateError(`generated region ${stack[0].name} is not closed`);
  return regions;
}

export function extractGeneratedRegions(docsModel) {
  const regions = [];
  for (const doc of docsModel.docs) {
    try {
      for (const region of generatedRegionMatches(doc.text)) regions.push({ doc_id: doc.doc_id, rel: doc.rel, ...region });
    } catch (error) {
      throw new DocsGateError(`${doc.rel}: ${error.message}`);
    }
  }
  const owners = new Set();
  for (const region of regions) {
    if (owners.has(region.name)) throw new DocsGateError(`generated region ${region.name} is owned by more than one file`);
    owners.add(region.name);
  }
  return regions.sort((a, b) => a.name.localeCompare(b.name));
}

function extractGeneratedRegionsFromTextMap(texts) {
  const regions = [];
  for (const [rel, text] of Object.entries(texts)) {
    if (!(rel.endsWith('.md') || rel === 'README.md')) continue;
    try {
      const docId = rel.startsWith('docs/') && rel.endsWith('.md') ? rel.slice('docs/'.length).replace(/\.md$/u, '') : null;
      for (const region of generatedRegionMatches(text)) regions.push({ rel, doc_id: docId, ...region });
    } catch (error) {
      throw new DocsGateError(`${rel}: ${error.message}`);
    }
  }
  const owners = new Set();
  for (const region of regions) {
    if (owners.has(region.name)) throw new DocsGateError(`generated region ${region.name} is owned by more than one file`);
    owners.add(region.name);
  }
  return regions.sort((a, b) => a.name.localeCompare(b.name));
}

export function assertCoverage(codeFacts, docsModel) {
  const knownSurfaces = new Set(codeFacts.public_surface_ids);
  const surfaceOwners = new Map();
  const sourceOwners = new Map();
  for (const doc of docsModel.docs) {
    if (
      doc.frontmatter.covers_sources.length > 0 &&
      doc.frontmatter.review_policy !== 'behavioral'
    ) {
      throw new DocsGateError(
        `${doc.rel}: production source owners must use review_policy behavioral`,
      );
    }
    for (const surface of doc.frontmatter.covers_surfaces) {
      if (!knownSurfaces.has(surface)) throw new DocsGateError(`${doc.rel}: unknown public surface ${surface}`);
      if (surfaceOwners.has(surface)) throw new DocsGateError(`${surface} has duplicate primary docs ${surfaceOwners.get(surface)} and ${doc.doc_id}`);
      surfaceOwners.set(surface, doc.doc_id);
    }
    for (const source of doc.frontmatter.covers_sources) {
      if (!codeFacts.governed_sources.includes(source)) throw new DocsGateError(`${doc.rel}: unknown governed source ${source}`);
      if (sourceOwners.has(source)) throw new DocsGateError(`${source} has duplicate primary docs ${sourceOwners.get(source)} and ${doc.doc_id}`);
      sourceOwners.set(source, doc.doc_id);
    }
  }
  for (const surface of codeFacts.public_surface_ids) if (!surfaceOwners.has(surface)) throw new DocsGateError(`${surface} has no primary doc`);
  for (const source of codeFacts.governed_sources) if (!sourceOwners.has(source)) throw new DocsGateError(`${source} has no primary doc`);
  return { surface_to_docs: sortedOwnerRecord(surfaceOwners), source_to_docs: sortedOwnerRecord(sourceOwners) };
}

function sortedOwnerRecord(map) {
  const out = {};
  for (const key of [...map.keys()].sort()) out[key] = [map.get(key)];
  return out;
}

function slugForHeading(text) {
  return text.trim().toLowerCase().replace(/<[^>]*>/gu, '').replace(/[`*_]/gu, '').replace(/[^a-z0-9\s-]/gu, '').replace(/\s+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
}

function markdownEntries(root, docsModel) {
  const entries = new Map(docsModel.docs.map((d) => [d.rel, { rel: d.rel, body: d.body, text: d.text }]));
  for (const rel of ROOT_MARKDOWN_RELS) {
    const abs = packagePath(root, rel);
    if (existsSync(abs)) entries.set(rel, { rel, body: readFileSync(abs, 'utf8'), text: readFileSync(abs, 'utf8') });
  }
  return entries;
}

function markdownWithoutCode(text) {
  let fence = null;
  const lines = text.split('\n').map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return '';
    }
    if (marker) {
      fence = marker;
      return '';
    }
    return line;
  });
  return lines.join('\n').replace(/`+[^`\n]*`+/gu, '');
}

function normalizeReferenceLabel(label) {
  return label.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function markdownTargets(body, rel) {
  const scan = markdownWithoutCode(body);
  const definitions = new Map();
  const definitionPattern = /^ {0,3}\[([^\]^][^\]]*)\]:\s*(?:<([^>\n]+)>|(\S+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n)]*\)))?\s*$/gmu;
  for (const match of scan.matchAll(definitionPattern)) {
    const label = normalizeReferenceLabel(match[1]);
    if (definitions.has(label)) throw new DocsGateError(`${rel}: duplicate Markdown reference [${match[1]}]`);
    definitions.set(label, match[2] ?? match[3]);
  }

  const targets = [];
  const inlinePattern = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n)]*\)))?\s*\)/gu;
  for (const match of scan.matchAll(inlinePattern)) targets.push(match[1] ?? match[2]);

  const htmlPattern = /<(?:a|img)\s+[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/giu;
  for (const match of scan.matchAll(htmlPattern)) targets.push(match[1]);

  const explicitReferencePattern = /!?\[([^\]\n]+)\]\[([^\]\n]*)\]/gu;
  for (const match of scan.matchAll(explicitReferencePattern)) {
    const label = normalizeReferenceLabel(match[2] || match[1]);
    const target = definitions.get(label);
    if (target === undefined) throw new DocsGateError(`${rel}: undefined Markdown reference [${match[2] || match[1]}]`);
    targets.push(target);
  }

  const withoutDefinitions = scan.replace(definitionPattern, '');
  const shortcutReferencePattern = /!?\[([^\]\n]+)\](?![([])/gu;
  for (const match of withoutDefinitions.matchAll(shortcutReferencePattern)) {
    const target = definitions.get(normalizeReferenceLabel(match[1]));
    if (target !== undefined) targets.push(target);
  }

  const autolinkPattern = /<((?:https?:\/\/|mailto:)[^<>\s]+)>/giu;
  for (const match of scan.matchAll(autolinkPattern)) targets.push(match[1]);
  return [...new Set(targets)];
}

export function verifyLinksAndReachability(root, docsModel) {
  const entries = markdownEntries(root, docsModel);
  const links = new Map();
  const anchors = new Map();
  for (const entry of entries.values()) {
    const set = new Set();
    for (const line of entry.body.split('\n')) {
      const m = /^(#{1,6})\s+(.+)$/u.exec(line);
      if (m) set.add(slugForHeading(m[2]));
      for (const id of line.matchAll(/<a\s+[^>]*id=["']([^"']+)["'][^>]*>/giu)) set.add(id[1]);
    }
    anchors.set(entry.rel, set);
  }
  for (const entry of entries.values()) {
    const found = [];
    for (const raw of markdownTargets(entry.body, entry.rel)) {
      if (!raw || /^(?:https?:|mailto:)/u.test(raw)) continue;
      if (raw.startsWith('#')) {
        if (!anchors.get(entry.rel).has(raw.slice(1))) throw new DocsGateError(`${entry.rel}: broken anchor ${raw}`);
        continue;
      }
      const hashIndex = raw.indexOf('#');
      const targetPath = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
      const hash = hashIndex >= 0 ? raw.slice(hashIndex + 1) : undefined;
      if (targetPath.startsWith('/')) throw new DocsGateError(`${entry.rel}: absolute package link ${raw}`);
      const norm = toPosix(posix.normalize(posix.join(posix.dirname(entry.rel), targetPath)));
      if (norm.startsWith('../') || norm === '..') throw new DocsGateError(`${entry.rel}: link escapes package ${raw}`);
      if (/^\.\.\/EXTENSION/u.test(raw) || /\/EXTENSION_[^/]*\.md$/u.test(norm)) throw new DocsGateError(`${entry.rel}: standalone package must not link to monorepo EXTENSION files`);
      const abs = packagePath(root, norm);
      if (!existsSync(abs)) throw new DocsGateError(`${entry.rel}: broken link ${raw}`);
      if (hash && norm.endsWith('.md') && !anchors.get(norm)?.has(hash)) throw new DocsGateError(`${entry.rel}: broken anchor ${raw}`);
      if (norm.startsWith('docs/') && norm.endsWith('.md')) found.push(norm);
    }
    links.set(entry.rel, found);
  }
  const reachable = new Set(['docs/INDEX.md']);
  const queue = ['docs/INDEX.md'];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of links.get(current) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  }
  for (const doc of docsModel.docs) if (!reachable.has(doc.rel)) throw new DocsGateError(`${doc.rel} is not reachable from docs/INDEX.md`);
}

function readAttestations(root) {
  const path = packagePath(root, ATTESTATIONS_PATH);
  if (!existsSync(path)) return { schema_version: ATTESTATIONS_SCHEMA_VERSION, receipts: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(parsed)) return { schema_version: ATTESTATIONS_SCHEMA_VERSION, receipts: parsed };
  if (!parsed || typeof parsed !== 'object' || parsed.schema_version !== ATTESTATIONS_SCHEMA_VERSION || !Array.isArray(parsed.receipts)) throw new DocsGateError(`${ATTESTATIONS_PATH} must contain {schema_version, receipts[]}`);
  return parsed;
}

function stripGeneratedRegionsFromBody(body) {
  const stripped = body.replace(/\n?<!-- pi-docs:begin name="[A-Za-z0-9_.-]+" generator="scripts\/docs\/generate\.mjs" -->[\s\S]*?<!-- pi-docs:end name="[A-Za-z0-9_.-]+" -->\n?/gu, '\n');
  return `${stripped.trim()}\n`;
}

function attestedAuthoredText(doc) {
  return stripGeneratedRegionsFromBody(doc.body);
}

function expectedSourceHashes(root, doc) {
  return Object.fromEntries(doc.frontmatter.covers_sources.map((s) => [s, sha256(readFileSync(packagePath(root, s), 'utf8'))]).sort((a, b) => a[0].localeCompare(b[0])));
}

export function verifyAttestations(root, docsModel, receiptsDoc = readAttestations(root), options = {}) {
  const strict = options.strict !== false;
  const receipts = Array.isArray(receiptsDoc) ? receiptsDoc : receiptsDoc.receipts;
  const requiredDocIds = new Set(
    docsModel.docs
      .filter(
        (doc) =>
          doc.frontmatter.review_policy === 'behavioral' &&
          doc.frontmatter.covers_sources.length > 0,
      )
      .map((doc) => doc.doc_id),
  );
  const byDoc = new Map();
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object' || typeof receipt.doc_id !== 'string') {
      throw new DocsGateError(`${ATTESTATIONS_PATH}: every receipt must have a string doc_id`);
    }
    if (byDoc.has(receipt.doc_id)) {
      throw new DocsGateError(`${ATTESTATIONS_PATH}: duplicate receipt for ${receipt.doc_id}`);
    }
    if (!requiredDocIds.has(receipt.doc_id)) {
      throw new DocsGateError(`${ATTESTATIONS_PATH}: orphan receipt for ${receipt.doc_id}`);
    }
    byDoc.set(receipt.doc_id, receipt);
  }
  const out = [];
  for (const doc of docsModel.docs) {
    if (doc.frontmatter.review_policy !== 'behavioral' || doc.frontmatter.covers_sources.length === 0) continue;
    const expectedBodyHash = sha256(attestedAuthoredText(doc));
    const expectedSources = expectedSourceHashes(root, doc);
    const receipt = byDoc.get(doc.doc_id);
    const base = { doc_id: doc.doc_id, rel: doc.rel, required: true, authored_body_sha256: expectedBodyHash, covers_sources: Object.keys(expectedSources).sort() };
    if (!receipt) {
      if (strict) throw new DocsGateError(`${doc.rel}: missing behavioral PASS attestation receipt; run npm run docs:attest/record -- ${doc.doc_id} --reviewer <identity> --verdict PASS --notes <review-notes>`);
      out.push({ ...base, state: 'missing' });
      continue;
    }
    const requiredStrings = ['schema_version', 'doc_id', 'verdict', 'reviewer', 'notes', 'authored_body_sha256'];
    for (const key of requiredStrings) if (typeof receipt[key] !== 'string' || receipt[key].trim().length === 0) throw new DocsGateError(`${ATTESTATIONS_PATH}: receipt ${doc.doc_id} missing ${key}`);
    if (receipt.schema_version !== ATTESTATION_RECEIPT_SCHEMA_VERSION) throw new DocsGateError(`${ATTESTATIONS_PATH}: receipt ${doc.doc_id} schema_version mismatch`);
    if (receipt.verdict !== 'PASS') throw new DocsGateError(`${doc.rel}: attestation verdict is not PASS`);
    if (receipt.authored_body_sha256 !== expectedBodyHash) {
      if (strict) throw new DocsGateError(`${doc.rel}: stale attestation authored prose hash`);
      out.push({ ...base, state: 'stale-authored-prose', reviewer: receipt.reviewer });
      continue;
    }
    if (JSON.stringify(sortDeep(receipt.source_sha256 ?? {})) !== JSON.stringify(sortDeep(expectedSources))) {
      if (strict) throw new DocsGateError(`${doc.rel}: stale attestation source hashes`);
      out.push({ ...base, state: 'stale-sources', reviewer: receipt.reviewer });
      continue;
    }
    if (JSON.stringify([...(receipt.covers_sources ?? [])].sort()) !== JSON.stringify(Object.keys(expectedSources).sort())) {
      if (strict) throw new DocsGateError(`${doc.rel}: stale attestation source set`);
      out.push({ ...base, state: 'stale-source-set', reviewer: receipt.reviewer });
      continue;
    }
    out.push({ ...base, state: 'pass', reviewer: receipt.reviewer, notes: receipt.notes });
  }
  return out.sort((a, b) => a.doc_id.localeCompare(b.doc_id));
}

export async function recordAttestation(docId, options = {}) {
  const root = resolve(options.packageRoot ?? PACKAGE_ROOT);
  const reviewer = options.reviewer;
  const verdict = options.verdict ?? 'PASS';
  const notes = options.notes;
  if (typeof reviewer !== 'string' || reviewer.trim().length === 0) throw new DocsGateError('docs:attest/record requires --reviewer <identity-after-semantic-review>');
  if (verdict !== 'PASS') throw new DocsGateError('docs:attest/record only records explicit PASS receipts after review');
  if (typeof notes !== 'string' || notes.trim().length < 12) throw new DocsGateError('docs:attest/record requires --notes <specific review notes>');
  const model = loadDocsModel({ packageRoot: root });
  const doc = model.docs.find((d) => d.doc_id === docId);
  if (!doc) throw new DocsGateError(`unknown doc_id ${docId}`);
  if (doc.frontmatter.review_policy !== 'behavioral' || doc.frontmatter.covers_sources.length === 0) throw new DocsGateError(`${docId} is not a behavioral source-owning doc`);
  const sourceSha = expectedSourceHashes(root, doc);
  const receipt = sortDeep({
    schema_version: ATTESTATION_RECEIPT_SCHEMA_VERSION,
    doc_id: docId,
    verdict: 'PASS',
    reviewer: reviewer.trim(),
    notes: notes.trim(),
    authored_body_sha256: sha256(attestedAuthoredText(doc)),
    covers_sources: Object.keys(sourceSha).sort(),
    source_sha256: sourceSha,
  });
  const current = readAttestations(root);
  const receipts = current.receipts.filter((r) => r.doc_id !== docId);
  receipts.push(receipt);
  receipts.sort((a, b) => a.doc_id.localeCompare(b.doc_id));
  await writeFile(packagePath(root, ATTESTATIONS_PATH), `${JSON.stringify({ schema_version: ATTESTATIONS_SCHEMA_VERSION, receipts }, null, 2)}\n`);
  return receipt;
}

export function verifyPackageFacts(root, codeFacts, docsModel) {
  if (codeFacts.package.version !== codeFacts.lock.version || codeFacts.package.version !== codeFacts.lock.rootVersion) throw new DocsGateError(`package.json version ${codeFacts.package.version} does not match package-lock versions ${codeFacts.lock.version}/${codeFacts.lock.rootVersion}`);
  const pkg = readJson(root, 'package.json');
  for (const mandatory of ['BACKGROUND-TASKS-INSTRUCTIONS.md', 'THIRD_PARTY_NOTICES.md', 'logo.png']) {
    if (!existsSync(packagePath(root, mandatory))) {
      throw new DocsGateError(`mandatory package adoption file is missing: ${mandatory}`);
    }
    if (!Array.isArray(pkg.files) || !pkg.files.includes(mandatory)) {
      throw new DocsGateError(`package.json files must include mandatory ${mandatory}`);
    }
  }
  const image = pkg.pi?.image;
  if (!image || !/^https:\/\/raw\.githubusercontent\.com\/ismailsaleekh\/pi-background-tasks\/main\/logo\.png$/u.test(image)) throw new DocsGateError('package pi.image must be the GitHub raw main logo.png URL');
  const texts = markdownEntries(root, docsModel);
  for (const entry of texts.values()) {
    const obsolete = new RegExp(`pi-background-tasks@(?:v)?(?!${codeFacts.package.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)\\d+\\.\\d+\\.\\d+`, 'u');
    if (obsolete.test(entry.body)) throw new DocsGateError(`${entry.rel}: obsolete pinned pi-background-tasks install version`);
    if (/git:github\.com\/ismailsaleekh\/pi-background-tasks@v1\./u.test(entry.body)) throw new DocsGateError(`${entry.rel}: advertises a nonexistent v1 git tag`);
    if (/GENERATED:PI_BACKGROUND_TASKS_/u.test(entry.body) || /GENERATED_SCHEMA_PLACEHOLDER|GENERATED_SYNOPSIS_PLACEHOLDER/u.test(entry.body)) throw new DocsGateError(`${entry.rel}: contains legacy generated placeholder comments`);
  }
}

export function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

export function manifestObject(root, codeFacts, docsModel, coverage, regions, attestations) {
  const docs = {};
  for (const doc of docsModel.docs) docs[doc.doc_id] = {
    rel: doc.rel,
    audience: doc.frontmatter.audience,
    mode: doc.frontmatter.mode,
    review_policy: doc.frontmatter.review_policy,
    stability: doc.frontmatter.stability,
    covers_surfaces: [...doc.frontmatter.covers_surfaces].sort(),
    covers_sources: [...doc.frontmatter.covers_sources].sort(),
  };
  return sortDeep({
    schema_version: MANIFEST_SCHEMA_VERSION,
    generator: MARKER_GENERATOR,
    package: codeFacts.package,
    docs,
    configuration_variants: codeFacts.configuration_variants,
    public_surface_ids: codeFacts.public_surface_ids,
    default_public_surface_ids: codeFacts.default_public_surface_ids,
    public_surfaces: codeFacts.public_surfaces,
    surface_to_docs: coverage.surface_to_docs,
    source_to_docs: coverage.source_to_docs,
    generated_regions: regions,
    attestation_state: attestations,
  });
}

function mdCell(value) {
  return String(value).replace(/\|/gu, '\\|').replace(/\n/gu, '<br>');
}

function mdTable(headers, rows) {
  return [`| ${headers.map(mdCell).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`)].join('\n');
}

function list(items) {
  return items.length === 0 ? '- none' : items.map((x) => `- ${x}`).join('\n');
}

function codeBlockJson(value) {
  return `\n\`\`\`json\n${JSON.stringify(sortDeep(value), null, 2)}\n\`\`\`\n`;
}

function generatedRegion(name, body) {
  return `<!-- pi-docs:begin name="${name}" generator="${MARKER_GENERATOR}" -->\n${body.trim()}\n<!-- pi-docs:end name="${name}" -->\n`;
}

function replaceOrInsertRegion(body, name, regionBody, insertAfterHeading = true) {
  const region = generatedRegion(name, regionBody);
  const re = new RegExp(`<!-- pi-docs:begin name="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" generator="${MARKER_GENERATOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" -->[\\s\\S]*?<!-- pi-docs:end name="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" -->\\n?`, 'u');
  if (re.test(body)) return body.replace(re, region);
  if (!insertAfterHeading) return `${body.trimEnd()}\n\n${region}`;
  const heading = /^(# .+\n)(?:\n)?/u.exec(body);
  if (heading) return `${body.slice(0, heading[0].length)}${region}\n${body.slice(heading[0].length).replace(/^\n/u, '')}`;
  return `${region}\n${body}`;
}

function defaultAvailabilityLabel(item) {
  return item.default_available ? 'yes' : 'no';
}

function surfaceRows(codeFacts) {
  const rows = [];
  for (const kind of PUBLIC_KINDS) {
    for (const item of codeFacts.public_surfaces[kind] ?? []) {
      rows.push([
        kind,
        `\`${item.name}\``,
        `\`${item.id}\``,
        `\`${item.availability}\``,
        defaultAvailabilityLabel(item),
        `\`${item.source}\``,
      ]);
    }
  }
  return rows;
}

function buildReadmePackageFacts(codeFacts) {
  return mdTable(
    ['Fact', 'Value'],
    [
      ['Package', `\`${codeFacts.package.name}\``],
      ['Version', `\`${codeFacts.package.version}\``],
      ['Node engine', `\`${codeFacts.package.engines.node ?? 'unspecified'}\``],
      ['Pi entrypoints', codeFacts.package.entrypoints.map((entrypoint) => `\`${entrypoint}\``).join(', ')],
      ['Package image', codeFacts.package.image ? `[logo.png](${codeFacts.package.image})` : 'not declared'],
    ],
  );
}

function buildReadmeSurfaceSummary(codeFacts) {
  const counts = PUBLIC_KINDS.map((kind) => {
    const surfaces = codeFacts.public_surfaces[kind] ?? [];
    return [
      kind,
      String(surfaces.length),
      String(surfaces.filter((surface) => surface.default_available).length),
    ];
  });
  const commandNames = codeFacts.public_surfaces.command.map((x) => `\`/${x.name}\``).join(', ');
  const toolNames = codeFacts.public_surfaces.tool.map((x) => `\`${x.name}\``).join(', ');
  const variants = PUBLIC_KINDS.flatMap((kind) =>
    (codeFacts.public_surfaces[kind] ?? [])
      .filter((surface) => surface.availability !== ALWAYS_AVAILABLE)
      .map((surface) => [
        `\`${surface.id}\``,
        `\`${surface.availability}\``,
        defaultAvailabilityLabel(surface),
      ]),
  );
  return `${mdTable(['Surface kind', 'Configured variants', 'Available by default'], counts)}\n\nPublic commands: ${commandNames}.\n\nPublic tools: ${toolNames}.\n\n### Configuration-dependent surfaces\n\n${mdTable(['Surface', 'Availability', 'Default'], variants)}\n\nFull owner map and generated contracts live in [docs/INDEX.md](docs/INDEX.md).`;
}

function buildIndexBody(codeFacts, docsModel, coverage) {
  const byAudience = new Map();
  for (const doc of docsModel.docs) {
    if (!byAudience.has(doc.frontmatter.audience)) byAudience.set(doc.frontmatter.audience, []);
    byAudience.get(doc.frontmatter.audience).push(doc);
  }
  const audienceSections = [...byAudience.keys()].sort().map((audience) => {
    const rows = byAudience.get(audience).sort((a, b) => a.doc_id.localeCompare(b.doc_id)).map((doc) => [`[${doc.doc_id}](./${posix.relative('docs', doc.rel)})`, doc.frontmatter.mode, doc.frontmatter.review_policy, doc.frontmatter.stability]);
    return `### ${audience}\n\n${mdTable(['Doc', 'Mode', 'Review', 'Stability'], rows)}`;
  }).join('\n\n');
  const categories = new Map();
  for (const doc of docsModel.docs) {
    const category = doc.doc_id.includes('/') ? doc.doc_id.split('/')[0] : 'root';
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(doc);
  }
  const categorySections = [...categories.keys()].sort().map((category) => `- **${category}**: ${categories.get(category).sort((a, b) => a.doc_id.localeCompare(b.doc_id)).map((doc) => `[${doc.doc_id}](./${posix.relative('docs', doc.rel)})`).join(', ')}`).join('\n');
  const ownerRows = Object.entries(coverage.surface_to_docs).map(([surface, docs]) => [`\`${surface}\``, `[${docs[0]}](./${docIdToHref(docs[0])})`]);
  return `# Documentation index\n\nGenerated navigation for every package-local documentation page. This index intentionally owns no public surface and no production source; ownership is explicit in each primary doc's frontmatter.\n\n## Start here\n\n- [Getting started](./getting-started.md)\n- [Choose a workflow](./choose-a-workflow.md)\n- [Read before editing production sources](./read-before-edit.md)\n- [Runtime contracts](./reference/runtime-contracts.md)\n\n## Docs by audience\n\n${audienceSections}\n\n## Docs by category\n\n${categorySections}\n\n## Public surface owners\n\n${mdTable(['Surface', 'Primary doc'], ownerRows)}\n\n## Public surface inventory\n\n${mdTable(['Kind', 'Name', 'ID', 'Availability', 'Default', 'Provenance'], surfaceRows(codeFacts))}\n`;
}

function docIdToHref(docId) {
  return `${docId}.md`;
}

function buildReadBeforeEditBody(codeFacts, coverage) {
  const rows = codeFacts.governed_sources.map((s) => [`\`${s}\``, `[${coverage.source_to_docs[s][0]}](./${docIdToHref(coverage.source_to_docs[s][0])})`]);
  const surfaces = PUBLIC_KINDS.flatMap((kind) => codeFacts.public_surfaces[kind] ?? []).map(
    (surface) => [
      `\`${surface.id}\``,
      `\`${surface.availability}\``,
      defaultAvailabilityLabel(surface),
    ],
  );
  return `# Read before editing production sources\n\nEvery production file under \`src/**\` and \`extensions/**\` has exactly one primary behavioral documentation owner. This file is generated from authored ownership frontmatter and owns no production source itself.\n\n## Source ownership\n\n${mdTable(['Source', 'Primary behavioral owner'], rows)}\n\n## Public surfaces\n\n${mdTable(['Surface', 'Availability', 'Default'], surfaces)}\n`;
}

function buildFreshnessRegion(codeFacts, docsModel, attestations) {
  const missing = attestations.filter((x) => x.state !== 'pass').length;
  return `- Canonical package version: \`${codeFacts.package.version}\`\n- Governed markdown docs: ${String(docsModel.docs.length)}\n- Public surfaces extracted: ${String(codeFacts.public_surface_ids.length)}\n- Public surfaces available by default: ${String(codeFacts.default_public_surface_ids.length)}\n- Finite feature values: ${codeFacts.configuration_variants.feature_values.map((value) => `\`${value}\``).join(', ')}\n- Finite dock shortcut values: ${codeFacts.configuration_variants.dock_shortcut_values.map((value) => `\`${value}\``).join(', ')}\n- Governed production sources: ${String(codeFacts.governed_sources.length)}\n- Tool contracts extracted: ${String(codeFacts.tool_contracts.length)}\n- Schema IDs extracted: ${String(codeFacts.schema_ids.length)}\n- Environment variable references extracted: ${String(codeFacts.environment_variables.length)}\n- Behavioral attestation receipts not passing: ${String(missing)}\n- Receipt store: \`${ATTESTATIONS_PATH}\`\n\n\`npm run docs:verify\` is read-only: it renders generated files twice in memory and compares them with committed bytes. \`npm run docs:generate\` is the only docs writer.`;
}

function schemaType(schema) {
  if (schema.type === 'array') return `${schemaType(schema.items)}[]`;
  if (schema.type === 'object') return 'object';
  return schema.type ?? 'unknown';
}

function constraints(schema) {
  const parts = [];
  if (schema.enum) parts.push(`enum ${schema.enum.map((x) => `\`${x}\``).join(' | ')}`);
  if (schema.minLength !== undefined) parts.push(`minLength ${String(schema.minLength)}`);
  if (schema.minItems !== undefined) parts.push(`minItems ${String(schema.minItems)}`);
  if (schema.additionalProperties !== undefined) parts.push(`additionalProperties: ${String(schema.additionalProperties)}`);
  return parts.join('; ');
}

function propertyRows(schema, prefix = '') {
  if (schema.type !== 'object') return [];
  const required = new Set(schema.required ?? []);
  const rows = [];
  for (const [name, child] of Object.entries(schema.properties ?? {}).sort((a, b) => a[0].localeCompare(b[0]))) {
    const path = prefix ? `${prefix}.${name}` : name;
    rows.push([`\`${path}\``, required.has(name) ? 'yes' : 'no', `\`${schemaType(child)}\``, child.description ?? '', constraints(child) || '']);
    if (child.type === 'object') rows.push(...propertyRows(child, path));
    if (child.type === 'array' && child.items?.type === 'object') rows.push(...propertyRows(child.items, `${path}[]`));
  }
  return rows;
}

function buildToolContractRegion(tool) {
  return `${tool.label ? `- Label: **${tool.label}**\n` : ''}- Source: \`${tool.source}\`\n- Availability: \`${tool.availability}\`\n- Available by default: **${defaultAvailabilityLabel(tool)}**\n- Description: ${tool.description ?? 'none'}\n- Root schema: \`${tool.schema.type}\`${tool.schema.additionalProperties !== undefined ? `; additionalProperties: \`${String(tool.schema.additionalProperties)}\`` : ''}\n\n${mdTable(['Field', 'Required', 'Type', 'Description', 'Constraints'], propertyRows(tool.schema))}\n\n<details>\n<summary>Normalized TypeBox contract</summary>\n\n${codeBlockJson(tool.schema)}\n</details>`;
}

function buildCommandContractRegion(commands) {
  return mdTable(
    ['Command', 'Availability', 'Default', 'Description', 'Provenance'],
    commands.map((cmd) => [
      `\`/${cmd.name}\``,
      `\`${cmd.availability}\``,
      defaultAvailabilityLabel(cmd),
      cmd.description ?? '',
      `\`${cmd.source}\``,
    ]),
  );
}

function buildShortcutRegion(codeFacts) {
  return mdTable(
    ['Shortcut', 'Availability', 'Default', 'Description', 'Provenance'],
    codeFacts.shortcut_contracts.map((shortcut) => [
      `\`${shortcut.name}\``,
      `\`${shortcut.availability}\``,
      defaultAvailabilityLabel(shortcut),
      shortcut.description ?? '',
      `\`${shortcut.source}\``,
    ]),
  );
}

function buildEventBusRegion(codeFacts) {
  const surface = codeFacts.public_surfaces.eventbus.find(
    (item) => item.id === 'eventbus:background-task-v1',
  );
  return `Availability: \`${surface?.availability ?? ALWAYS_AVAILABLE}\`; available by default: **${surface?.default_available ? 'yes' : 'no'}**.\n\n${mdTable(['Channel purpose', 'Channel', 'Schema'], [
    ['Request', `\`${codeFacts.event_bus.channels.request}\``, `\`${codeFacts.event_bus.schemas.request}\``],
    ['Response', `\`${codeFacts.event_bus.channels.response}\``, `\`${codeFacts.event_bus.schemas.response}\``],
    ['Terminal', `\`${codeFacts.event_bus.channels.terminal}\``, `\`${codeFacts.event_bus.schemas.terminal}\``],
  ])}\n\nOperations: ${codeFacts.event_bus.operations.map((op) => `\`${op}\``).join(', ')}.\n\n${codeBlockJson(codeFacts.event_bus.capabilities)}`;
}

function buildFusionWorkflowRegion(codeFacts) {
  return mdTable(
    ['Workflow', 'Availability', 'Default', 'Tool', 'Context', 'Candidate capability', 'Candidate tools', 'Evaluator/merger tools', 'Provenance'],
    codeFacts.fusion_workflows.map((workflow) => {
      const surface = codeFacts.public_surfaces.workflow.find(
        (item) => item.id === `workflow:${workflow.id}`,
      );
      return [
        `\`${workflow.id}\``,
        `\`${surface?.availability ?? 'feature:fusion'}\``,
        surface?.default_available ? 'yes' : 'no',
        `\`${workflow.toolName}\``,
        `\`${workflow.contextKind}\``,
        `\`${workflow.candidateCapability}\``,
        workflow.candidateTools.length
          ? workflow.candidateTools.map((x) => `\`${x}\``).join(', ')
          : 'none',
        'none',
        `\`${workflow.source}\``,
      ];
    }),
  );
}

function buildRuntimeRegion(codeFacts) {
  const envRows = codeFacts.environment_variables.map((e) => [`\`${e.name}\``, e.access.join(', '), e.sources.map((s) => `\`${s}\``).join('<br>')]);
  const pathRows = codeFacts.runtime_paths_and_artifacts.map((p) => [p.kind, `\`${p.value}\``, `\`${p.source}\``]);
  const schemaRows = codeFacts.schema_ids.map((s) => [`\`${s.id}\``, `\`${s.source}\``]);
  return `### Configuration variants\n\n${codeBlockJson(codeFacts.configuration_variants)}\n### Environment variable references\n\n${mdTable(['Name', 'Access', 'Provenance'], envRows)}\n\n### Runtime paths and artifacts\n\n${mdTable(['Kind', 'Path/artifact', 'Provenance'], pathRows)}\n\n### Schema identifiers\n\n${mdTable(['Schema', 'Provenance'], schemaRows)}\n\n### Status vocabularies\n\n${codeBlockJson(codeFacts.status_vocabularies)}`;
}

function applyGeneratedRegionsToDoc(doc, codeFacts, coverage, docsModel, attestations) {
  const override = GENERATED_DOC_OVERRIDES.get(doc.rel);
  const fm = override ? override : doc.frontmatter;
  let body = doc.body;
  if (doc.rel === 'docs/INDEX.md') body = buildIndexBody(codeFacts, docsModel, coverage);
  else if (doc.rel === 'docs/read-before-edit.md') body = buildReadBeforeEditBody(codeFacts, coverage);
  else {
    if (doc.rel === 'docs/subsystems/docs-freshness-gate.md') body = replaceOrInsertRegion(body, 'docs-freshness-gate', buildFreshnessRegion(codeFacts, docsModel, attestations), false);
    if (doc.rel.startsWith('docs/tools/')) {
      const name = basename(doc.rel, '.md');
      const tool = codeFacts.tool_contracts.find((t) => t.name === name);
      if (tool) body = body.replace(/<!-- GENERATED_SCHEMA_PLACEHOLDER:[^>]*-->\n?/gu, '').replace(/## Schema\n\n/gu, '## Schema\n\n');
      if (tool) body = replaceOrInsertRegion(body, `tool-contract-${name}`, buildToolContractRegion(tool));
    }
    if (doc.rel.startsWith('docs/commands/')) {
      const byDoc = {
        'docs/commands/bg.md': ['bg'],
        'docs/commands/bg-clear.md': ['bg-clear'],
        'docs/commands/bg-update.md': ['bg-update'],
        'docs/commands/claude-cache.md': ['claude-cache'],
        'docs/commands/fusion.md': ['fusion'],
        'docs/commands/fusion-models.md': ['fusion-models'],
        'docs/commands/jobs.md': ['jobs'],
        'docs/commands/kill.md': ['kill'],
        'docs/commands/logs.md': ['logs'],
        'docs/commands/task-manager.md': ['tasks', 'bg-tasks'],
      };
      const names = byDoc[doc.rel] ?? [];
      const commands = names.map((n) => codeFacts.command_contracts.find((c) => c.name === n)).filter(Boolean);
      if (commands.length > 0) body = body.replace(/<!-- GENERATED_SYNOPSIS_PLACEHOLDER:[^>]*-->\n?/gu, '');
      if (commands.length > 0) body = replaceOrInsertRegion(body, `command-contract-${names.join('-')}`, buildCommandContractRegion(commands));
    }
    if (doc.rel === 'docs/reference/shortcuts-and-dock.md') body = replaceOrInsertRegion(body, 'shortcut-contracts', buildShortcutRegion(codeFacts));
    if (doc.rel === 'docs/api/eventbus-v1.md') body = replaceOrInsertRegion(body, 'eventbus-contract', buildEventBusRegion(codeFacts));
    if (doc.rel === 'docs/subsystems/fusion.md') body = replaceOrInsertRegion(body, 'fusion-workflows', buildFusionWorkflowRegion(codeFacts));
    if (doc.rel === 'docs/reference/runtime-contracts.md') body = replaceOrInsertRegion(body, 'runtime-contracts', buildRuntimeRegion(codeFacts));
  }
  return `${serializeFrontmatter(canonicalFrontmatter(fm))}${body.trimEnd()}\n`;
}

function applyReadmeRegions(text, codeFacts) {
  let out = text.replace(/<!-- GENERATED:PI_BACKGROUND_TASKS_PACKAGE_FACTS:START -->[\s\S]*?<!-- GENERATED:PI_BACKGROUND_TASKS_PACKAGE_FACTS:END -->\n?/gu, '')
    .replace(/<!-- GENERATED:PI_BACKGROUND_TASKS_SURFACES:START -->[\s\S]*?<!-- GENERATED:PI_BACKGROUND_TASKS_SURFACES:END -->\n?/gu, '');
  const insertAfterLogo = /(<\/p>\n\n)/u;
  if (!/pi-docs:begin name="readme-package-facts"/u.test(out)) out = out.replace(insertAfterLogo, `$1${generatedRegion('readme-package-facts', buildReadmePackageFacts(codeFacts))}\n`);
  else out = replaceOrInsertRegion(out, 'readme-package-facts', buildReadmePackageFacts(codeFacts));
  if (!/pi-docs:begin name="readme-public-surfaces"/u.test(out)) out = out.replace(/(<!-- pi-docs:end name="readme-package-facts" -->\n)/u, `$1\n${generatedRegion('readme-public-surfaces', buildReadmeSurfaceSummary(codeFacts))}\n`);
  else out = replaceOrInsertRegion(out, 'readme-public-surfaces', buildReadmeSurfaceSummary(codeFacts));
  return `${out.trimEnd()}\n`;
}

export function generateDocTexts(codeFacts, existingModel = { docs: [] }, coverage = undefined, attestations = []) {
  const docsModel = existingModel;
  const cov = coverage ?? { surface_to_docs: {}, source_to_docs: Object.fromEntries(codeFacts.governed_sources.map((s) => [s, ['<unassigned>']])) };
  const texts = {};
  for (const doc of docsModel.docs) texts[doc.rel] = applyGeneratedRegionsToDoc(doc, codeFacts, cov, docsModel, attestations);
  return texts;
}

function renderAll(root, codeFacts, docsModel, coverage, attestations) {
  const texts = generateDocTexts(codeFacts, docsModel, coverage, attestations);
  if (existsSync(packagePath(root, 'README.md'))) texts['README.md'] = applyReadmeRegions(readFileSync(packagePath(root, 'README.md'), 'utf8'), codeFacts);
  const expectedDocsModel = docsModelFromTexts(texts);
  const regions = extractGeneratedRegionsFromTextMap(texts);
  const manifest = manifestObject(root, codeFacts, expectedDocsModel, coverage, regions, attestations);
  texts['docs/manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  return { texts, manifest, regions, docsModel: expectedDocsModel };
}

export async function generate(options = {}) {
  const root = resolve(options.packageRoot ?? PACKAGE_ROOT);
  const codeFacts = buildCodeFacts({ packageRoot: root });
  const model = loadDocsModel({ packageRoot: root });
  const coverage = assertCoverage(codeFacts, model);
  const attestations = verifyAttestations(root, model, readAttestations(root), { strict: false });
  const rendered = renderAll(root, codeFacts, model, coverage, attestations);
  for (const [rel, text] of Object.entries(rendered.texts)) {
    await mkdir(dirname(packagePath(root, rel)), { recursive: true });
    await writeFile(packagePath(root, rel), text);
  }
  const finalModel = loadDocsModel({ packageRoot: root });
  verifyLinksAndReachability(root, finalModel);
  verifyPackageFacts(root, codeFacts, finalModel);
  return { codeFacts, model: finalModel, manifest: rendered.manifest, texts: rendered.texts };
}

export async function verify(options = {}) {
  const root = resolve(options.packageRoot ?? PACKAGE_ROOT);
  const codeFacts = buildCodeFacts({ packageRoot: root });
  const firstModel = loadDocsModel({ packageRoot: root });
  const coverage = assertCoverage(codeFacts, firstModel);
  verifyLinksAndReachability(root, firstModel);
  const attestations = verifyAttestations(root, firstModel, readAttestations(root), {
    strict: options.requireAttestations === true,
  });
  verifyPackageFacts(root, codeFacts, firstModel);
  const first = renderAll(root, codeFacts, firstModel, coverage, attestations);
  const secondModel = docsModelFromTexts(first.texts);
  const secondCoverage = assertCoverage(codeFacts, secondModel);
  const second = renderAll(root, codeFacts, secondModel, secondCoverage, attestations);
  if (JSON.stringify(first.texts) !== JSON.stringify(second.texts)) throw new DocsGateError('docs generation is nondeterministic between first and second in-memory render');
  for (const [rel, expected] of Object.entries(first.texts)) {
    const actual = readFileSync(packagePath(root, rel), 'utf8');
    if (actual !== expected) throw new DocsGateError(`${rel} is stale; run npm run docs:generate`);
  }
  return { codeFacts, model: firstModel };
}

function markdownRelativeTargets(root, docsModel) {
  const entries = markdownEntries(root, docsModel);
  const targets = new Set();
  for (const entry of entries.values()) {
    for (const raw of markdownTargets(entry.body, entry.rel)) {
      if (!raw || /^(?:https?:|mailto:|#)/u.test(raw)) continue;
      const hashIndex = raw.indexOf('#');
      const targetPath = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
      const norm = toPosix(posix.normalize(posix.join(posix.dirname(entry.rel), targetPath)));
      if (!norm.startsWith('../') && norm !== '..') targets.add(norm);
    }
  }
  return [...targets].sort();
}

function assertPngLogo(root) {
  const bytes = readFileSync(packagePath(root, 'logo.png'));
  const sig = bytes.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new DocsGateError('logo.png is not a PNG with a valid signature');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (width !== 512 || height !== 512 || bitDepth !== 8 || colorType !== 6) throw new DocsGateError(`logo.png must be 512x512 8-bit RGBA; got ${width}x${height} bitDepth=${bitDepth} colorType=${colorType}`);
}

function assertSvgSafe(root, rel) {
  const text = readFileSync(packagePath(root, rel), 'utf8');
  if (!/<svg\b[^>]*viewBox="[^"]+"/u.test(text)) throw new DocsGateError(`${rel} missing svg viewBox`);
  if (!/<title\b/u.test(text) || !/<desc\b/u.test(text)) throw new DocsGateError(`${rel} must include title and desc`);
  if (/<script\b|\son[a-z]+\s*=|(?:href|xlink:href|src)=["']https?:\/\/|@import|<foreignObject\b/iu.test(text)) throw new DocsGateError(`${rel} contains script/event/remote resource/foreignObject`);
  if (/font-family\s*:\s*url|<font-face|@font-face/iu.test(text)) throw new DocsGateError(`${rel} contains remote/custom font declarations`);
}

export function checkPayloadFiles(files, root = PACKAGE_ROOT) {
  const fileSet = new Set(files);
  const requiredRoots = ['dist/extensions/anthropic-attribution.js', 'dist/extensions/background-tasks.js', 'dist/extensions/anthropic-attribution-child.js', 'dist/extensions/delegate-child.js', 'dist/extensions/fusion-child.js', 'dist/package.json', 'extensions/anthropic-attribution.ts', 'extensions/background-tasks.ts', 'extensions/delegate-child.ts', 'extensions/fusion-child.ts', 'README.md', 'TESTING.md', 'TEST_PLAN.md', 'PUBLISHING.md', 'BACKGROUND-TASKS-INSTRUCTIONS.md', 'THIRD_PARTY_NOTICES.md', 'logo.png', 'LICENSE', 'package.json'];
  for (const f of requiredRoots) if (!fileSet.has(f)) throw new DocsGateError(`packed payload missing ${f}`);
  for (const f of walkFiles(root, 'dist', () => true)) if (!fileSet.has(f)) throw new DocsGateError(`packed payload missing ${f}`);
  for (const f of walkFiles(root, 'src', () => true)) if (!fileSet.has(f)) throw new DocsGateError(`packed payload missing ${f}`);
  for (const f of walkFiles(root, 'extensions', () => true)) if (!fileSet.has(f)) throw new DocsGateError(`packed payload missing ${f}`);
  const docsModel = loadDocsModel({ packageRoot: root });
  for (const doc of docsModel.docs) if (!fileSet.has(doc.rel)) throw new DocsGateError(`packed payload missing ${doc.rel}`);
  if (!fileSet.has('docs/manifest.json')) throw new DocsGateError('packed payload missing docs/manifest.json');
  if (!fileSet.has(ATTESTATIONS_PATH)) throw new DocsGateError(`packed payload missing ${ATTESTATIONS_PATH}`);
  for (const target of markdownRelativeTargets(root, docsModel)) if (!fileSet.has(target) && statSync(packagePath(root, target)).isFile()) throw new DocsGateError(`packed payload missing linked target ${target}`);
  for (const forbidden of files) if (/^(?:tests|scripts|\.pi|node_modules|reports|private)\//u.test(forbidden) || forbidden.endsWith('.tgz') || /(?:BRIEF|REPORT|FIX_SPEC)\.md$/u.test(forbidden)) throw new DocsGateError(`packed payload includes forbidden ${forbidden}`);
  assertPngLogo(root);
  for (const rel of walkFiles(root, 'docs/assets', (x) => x.endsWith('.svg'))) {
    if (!fileSet.has(rel)) throw new DocsGateError(`packed payload missing ${rel}`);
    assertSvgSafe(root, rel);
  }
}

export function resolveNpmCli(
  execPath = process.execPath,
  env = process.env,
  exists = existsSync,
) {
  const nodeDir = dirname(execPath);
  const candidates = [
    env['npm_execpath'],
    resolve(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  throw new DocsGateError(
    `cannot resolve npm-cli.js near ${execPath}; checked ${candidates.join(', ')}`,
  );
}

export function parseNpmPackFiles(stdout) {
  let entries;
  try {
    entries = JSON.parse(stdout);
  } catch (error) {
    throw new DocsGateError(
      `npm pack did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(entries) || entries.length !== 1 || !Array.isArray(entries[0]?.files)) {
    throw new DocsGateError('npm pack JSON must contain exactly one package entry with files[]');
  }
  const files = entries[0].files.map((file, index) => {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string') {
      throw new DocsGateError(`npm pack files[${String(index)}].path must be a string`);
    }
    return file.path;
  });
  return files.sort();
}

export function runPayloadCheck(root = PACKAGE_ROOT) {
  const npmCli = resolveNpmCli();
  const result = spawnSync(
    process.execPath,
    [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PI_OFFLINE: '1',
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
      },
    },
  );
  if (result.status !== 0) {
    throw new DocsGateError(`npm pack --dry-run failed:\n${result.stderr || result.stdout}`);
  }
  const files = parseNpmPackFiles(result.stdout);
  checkPayloadFiles(files, root);
  return files;
}

export function assertRegistrationFixture(fixture) {
  const files = typeof fixture === 'string' ? { 'fixture.ts': fixture } : fixture.files;
  const entry = typeof fixture === 'string' ? 'fixture.ts' : (fixture.entry ?? 'fixture.ts');
  if (!files || typeof files !== 'object' || typeof files[entry] !== 'string') {
    throw new DocsGateError('registration fixture must provide an entry TypeScript source');
  }
  const root = mkdtempSync(join(tmpdir(), 'pi-docs-registration-fixture-'));
  try {
    for (const [rel, source] of Object.entries(files)) {
      const target = packagePath(root, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    const ts = loadTypeScript();
    const cache = new Map();
    const target = findExportedFunction(ts, root, entry, 'default', cache);
    moduleInfo(ts, root, target.rel, cache);
    const piParameter = target.node.parameters[0]?.name;
    if (!piParameter || !ts.isIdentifier(piParameter)) {
      throw new DocsGateError(`${target.rel} default export must have an identifier Pi parameter`);
    }
    const regs = [];
    collectRegistrationsInFunction(
      ts,
      root,
      target.rel,
      target.node,
      piParameter.text,
      cache,
      regs,
      new Set([`${target.rel}:default`]),
    );
    return uniqueRegistrations(regs).map((registration) => registration.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function checkReleaseVersion(root = PACKAGE_ROOT, refName = process.env.GITHUB_REF_NAME, refType = process.env.GITHUB_REF_TYPE) {
  const pkg = readJson(root, 'package.json');
  const expected = `v${pkg.version}`;
  if (!refName || refType !== 'tag') throw new DocsGateError(`release check requires an explicit tag ref ${expected}; set GITHUB_REF_TYPE=tag and GITHUB_REF_NAME=${expected}`);
  if (refName !== expected) throw new DocsGateError(`release tag must be ${expected}; received ${refName}`);
  return expected;
}
