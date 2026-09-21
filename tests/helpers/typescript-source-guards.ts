import { URL as WhatwgURL } from 'node:url';
import ts from 'typescript';

export type TypeSafetyRule =
  | 'explicit top-type escape'
  | 'compiler suppression'
  | 'double assertion'
  | 'non-null assertion';

export interface TypeSafetyViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: TypeSafetyRule;
  readonly text: string;
}

export interface FileUrlPathnameViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface TypeSafetyScanOptions {
  readonly escapeHatches: boolean;
  readonly nonNullAssertions: boolean;
}

interface CompilerCommentDirective {
  readonly range: ts.TextRange;
}

interface CompilerCheckDirective extends ts.TextRange {
  readonly enabled: boolean;
}

interface SourceFileCompilerMetadata extends ts.SourceFile {
  readonly commentDirectives?: readonly CompilerCommentDirective[];
  readonly checkJsDirective?: CompilerCheckDirective;
}

function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function parseSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
}

function lineText(sourceFile: ts.SourceFile, position: number): string {
  const location = sourceFile.getLineAndCharacterOfPosition(position);
  const starts = sourceFile.getLineStarts();
  const start = starts[location.line] ?? 0;
  const end = sourceFile.getLineEndOfPosition(position);
  return sourceFile.text.slice(start, end).trim();
}

function compactNodeText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/gu, ' ').trim().slice(0, 180);
}

function violationAt(
  sourceFile: ts.SourceFile,
  file: string,
  rule: TypeSafetyRule,
  position: number,
  text = lineText(sourceFile, position),
): TypeSafetyViolation {
  return {
    file,
    line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
    rule,
    text,
  };
}

function isTypeAssertion(node: ts.Node): node is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

function unwrapTypeTransparentExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

export function findTypeSafetyViolations(
  file: string,
  source: string,
  options: TypeSafetyScanOptions,
): TypeSafetyViolation[] {
  const sourceFile = parseSource(file, source);
  const metadata = sourceFile as SourceFileCompilerMetadata;
  const violations: TypeSafetyViolation[] = [];

  if (options.escapeHatches) {
    for (const directive of metadata.commentDirectives ?? []) {
      violations.push(
        violationAt(sourceFile, file, 'compiler suppression', directive.range.pos),
      );
    }
    if (metadata.checkJsDirective?.enabled === false) {
      violations.push(
        violationAt(sourceFile, file, 'compiler suppression', metadata.checkJsDirective.pos),
      );
    }
  }

  const visit = (node: ts.Node): void => {
    if (options.escapeHatches && node.kind === ts.SyntaxKind.AnyKeyword) {
      violations.push(
        violationAt(
          sourceFile,
          file,
          'explicit top-type escape',
          node.getStart(sourceFile),
          compactNodeText(node, sourceFile),
        ),
      );
    }
    if (
      options.escapeHatches &&
      isTypeAssertion(node) &&
      isTypeAssertion(unwrapTypeTransparentExpression(node.expression))
    ) {
      violations.push(
        violationAt(
          sourceFile,
          file,
          'double assertion',
          node.getStart(sourceFile),
          compactNodeText(node, sourceFile),
        ),
      );
    }
    if (options.nonNullAssertions && ts.isNonNullExpression(node)) {
      violations.push(
        violationAt(
          sourceFile,
          file,
          'non-null assertion',
          node.getStart(sourceFile),
          compactNodeText(node, sourceFile),
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return violations.sort(
    (left, right) => left.line - right.line || left.rule.localeCompare(right.rule),
  );
}

interface BoundSource {
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
}

function bindSource(fileName: string, source: string): BoundSource {
  const parsed = parseSource(fileName, source);
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const host: ts.CompilerHost = {
    fileExists: (candidate) => candidate === fileName,
    getCanonicalFileName: (candidate) => candidate,
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => 'lib.d.ts',
    getNewLine: () => '\n',
    getSourceFile: (candidate) => (candidate === fileName ? parsed : undefined),
    readFile: (candidate) => (candidate === fileName ? source : undefined),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };
  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) throw new Error(`failed to bind ${fileName}`);
  return { checker: program.getTypeChecker(), sourceFile };
}

function unwrapForProvenance(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function moduleSpecifierFor(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isImportDeclaration(current)) current = current.parent;
  if (current === undefined || !ts.isStringLiteral(current.moduleSpecifier)) return undefined;
  return current.moduleSpecifier.text;
}

function importedName(declaration: ts.ImportSpecifier): string {
  return (declaration.propertyName ?? declaration.name).text;
}

function isNodeUrlModule(specifier: string | undefined): boolean {
  return specifier === 'node:url' || specifier === 'url';
}

// This finite domain deliberately records only provenance that the source guard can
// prove without executing JavaScript. Unknown values stay unknown rather than being
// guessed from an unrelated URL base.
const VALUE_UNKNOWN = 1 << 0;
const VALUE_STRING_FILE = 1 << 1;
const VALUE_STRING_NON_FILE_ABSOLUTE = 1 << 2;
const VALUE_STRING_RELATIVE = 1 << 3;
const VALUE_STATIC_PATHNAME = 1 << 4;
const VALUE_STATIC_IMPORT_META_URL = 1 << 5;
const VALUE_URL_FILE = 1 << 6;
const VALUE_URL_NON_FILE = 1 << 7;
const VALUE_URL_UNKNOWN = 1 << 8;
const VALUE_IMPORT_META = 1 << 9;
const VALUE_URL_CONSTRUCTOR = 1 << 10;
const VALUE_PATH_TO_FILE_URL = 1 << 11;
const VALUE_NULLISH = 1 << 12;
const VALUE_STATIC_URL_CONSTRUCTOR = 1 << 13;

type AbstractValue = number;
type FlowState = Map<ts.Symbol, AbstractValue>;

interface FileUrlAnalysis {
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
  readonly violations: Map<number, FileUrlPathnameViolation>;
}

type CompletionKind = 'normal' | 'break' | 'continue' | 'return' | 'throw';

interface FlowCompletion {
  readonly kind: CompletionKind;
  readonly label: string | undefined;
  readonly state: FlowState;
}

type FlowResult = readonly FlowCompletion[];

function isImportMeta(expression: ts.Expression): boolean {
  const current = unwrapForProvenance(expression);
  return (
    ts.isMetaProperty(current) &&
    current.keywordToken === ts.SyntaxKind.ImportKeyword &&
    current.name.text === 'meta'
  );
}

function parsedProtocol(text: string): string | undefined {
  try {
    return new WhatwgURL(text).protocol.toLowerCase();
  } catch {
    return undefined;
  }
}

function isParseableRelativeUrl(text: string): boolean {
  try {
    void new WhatwgURL(text, 'https://pi-source-guard.invalid/base');
    return true;
  } catch {
    return false;
  }
}

function valueForProtocol(protocol: string): AbstractValue {
  return protocol === 'file:' ? VALUE_STRING_FILE : VALUE_STRING_NON_FILE_ABSOLUTE;
}

function staticStringValue(text: string): AbstractValue {
  const protocol = parsedProtocol(text);
  let value =
    protocol !== undefined
      ? valueForProtocol(protocol)
      : isParseableRelativeUrl(text)
        ? VALUE_STRING_RELATIVE
        : VALUE_UNKNOWN;
  if (text === 'pathname') value |= VALUE_STATIC_PATHNAME;
  if (text === 'url') value |= VALUE_STATIC_IMPORT_META_URL;
  if (text === 'URL') value |= VALUE_STATIC_URL_CONSTRUCTOR;
  return value;
}

function templateValue(expression: ts.TemplateExpression): AbstractValue {
  // An arbitrary interpolation can introduce a scheme. Classify a template as
  // absolute only when its static head already makes WHATWG parsing absolute.
  // Exact ./ and ../ heads remain relative regardless of the interpolation;
  // every other dynamic head stays unknown.
  const head = expression.head.text;
  const protocol = parsedProtocol(`${head}pi-template.invalid`);
  if (protocol !== undefined) return valueForProtocol(protocol);
  return head.startsWith('./') || head.startsWith('../')
    ? VALUE_STRING_RELATIVE
    : VALUE_UNKNOWN;
}

function isImportedBinding(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  expectedName: string,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return (
    symbol?.declarations?.some(
      (declaration) =>
        ts.isImportSpecifier(declaration) &&
        importedName(declaration) === expectedName &&
        isNodeUrlModule(moduleSpecifierFor(declaration)),
    ) === true
  );
}

function isNodeUrlNamespace(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const current = unwrapForProvenance(expression);
  if (!ts.isIdentifier(current)) return false;
  const symbol = checker.getSymbolAtLocation(current);
  return (
    symbol?.declarations?.some(
      (declaration) =>
        ts.isNamespaceImport(declaration) && isNodeUrlModule(moduleSpecifierFor(declaration)),
    ) === true
  );
}

function isUnshadowedGlobalThis(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const current = unwrapForProvenance(expression);
  if (!ts.isIdentifier(current) || current.text !== 'globalThis') return false;
  const symbol = checker.getSymbolAtLocation(current);
  return symbol === undefined || (symbol.declarations?.length ?? 0) === 0;
}

function cloneState(state: FlowState): FlowState {
  return new Map(state);
}

function overwriteState(target: FlowState, source: FlowState): void {
  target.clear();
  for (const [symbol, value] of source) target.set(symbol, value);
}

function mergeStates(states: readonly FlowState[]): FlowState {
  if (states.length === 0) return new Map();
  const symbols = new Set<ts.Symbol>();
  for (const state of states) {
    for (const symbol of state.keys()) symbols.add(symbol);
  }
  const merged: FlowState = new Map();
  for (const symbol of symbols) {
    let value = 0;
    for (const state of states) value |= state.get(symbol) ?? VALUE_UNKNOWN;
    merged.set(symbol, value === 0 ? VALUE_UNKNOWN : value);
  }
  return merged;
}

function statesEqual(left: FlowState, right: FlowState): boolean {
  if (left.size !== right.size) return false;
  for (const [symbol, value] of left) {
    if (right.get(symbol) !== value) return false;
  }
  return true;
}

function identifierValue(
  identifier: ts.Identifier,
  state: FlowState,
  analysis: FileUrlAnalysis,
): AbstractValue {
  const symbol = analysis.checker.getSymbolAtLocation(identifier);
  const current = symbol === undefined ? undefined : state.get(symbol);
  if (current !== undefined) return current;
  if (isImportedBinding(identifier, analysis.checker, 'URL')) return VALUE_URL_CONSTRUCTOR;
  if (isImportedBinding(identifier, analysis.checker, 'pathToFileURL')) {
    return VALUE_PATH_TO_FILE_URL;
  }
  if (symbol === undefined && identifier.text === 'URL') return VALUE_URL_CONSTRUCTOR;
  if (symbol === undefined && identifier.text === 'pathToFileURL') {
    return VALUE_PATH_TO_FILE_URL;
  }
  return VALUE_UNKNOWN;
}

function keyValueHas(
  expression: ts.Expression | undefined,
  expected: number,
  state: FlowState,
  analysis: FileUrlAnalysis,
): boolean {
  return expression !== undefined && (expressionValue(expression, state, analysis) & expected) !== 0;
}

function baseUrlValue(value: AbstractValue): AbstractValue {
  let result = 0;
  if ((value & (VALUE_STRING_FILE | VALUE_URL_FILE)) !== 0) result |= VALUE_URL_FILE;
  if ((value & (VALUE_STRING_NON_FILE_ABSOLUTE | VALUE_URL_NON_FILE)) !== 0) {
    result |= VALUE_URL_NON_FILE;
  }
  if ((value & (VALUE_UNKNOWN | VALUE_STRING_RELATIVE | VALUE_URL_UNKNOWN)) !== 0) {
    result |= VALUE_URL_UNKNOWN;
  }
  return result === 0 ? VALUE_URL_UNKNOWN : result;
}

function newUrlValue(
  expression: ts.NewExpression,
  state: FlowState,
  analysis: FileUrlAnalysis,
  unknownFirstMayUseBase: boolean,
): AbstractValue {
  const first = expression.arguments?.[0];
  if (first === undefined) return VALUE_URL_UNKNOWN;
  const firstValue = expressionValue(first, state, analysis);
  let result = 0;

  // URL objects and statically absolute strings are already absolute, so WHATWG URL
  // ignores the base for those alternatives. An unknown string remains unknown but
  // may also be relative, so an explicit base contributes only possible provenance.
  if ((firstValue & VALUE_URL_FILE) !== 0) result |= VALUE_URL_FILE;
  if ((firstValue & VALUE_URL_NON_FILE) !== 0) result |= VALUE_URL_NON_FILE;
  if ((firstValue & VALUE_URL_UNKNOWN) !== 0) result |= VALUE_URL_UNKNOWN;
  if ((firstValue & VALUE_STRING_FILE) !== 0) result |= VALUE_URL_FILE;
  if ((firstValue & VALUE_STRING_NON_FILE_ABSOLUTE) !== 0) result |= VALUE_URL_NON_FILE;
  const base = expression.arguments?.[1];
  if ((firstValue & VALUE_STRING_RELATIVE) !== 0) {
    result |=
      base === undefined
        ? VALUE_URL_UNKNOWN
        : baseUrlValue(expressionValue(base, state, analysis));
  }
  if ((firstValue & VALUE_UNKNOWN) !== 0) {
    result |= VALUE_URL_UNKNOWN;
    if (unknownFirstMayUseBase && base !== undefined) {
      result |= baseUrlValue(expressionValue(base, state, analysis));
    }
  }
  return result === 0 ? VALUE_URL_UNKNOWN : result;
}

function expressionValue(
  expression: ts.Expression,
  state: FlowState,
  analysis: FileUrlAnalysis,
  unknownFirstMayUseBase = true,
): AbstractValue {
  const current = unwrapForProvenance(expression);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return staticStringValue(current.text);
  }
  if (ts.isTemplateExpression(current)) return templateValue(current);
  if (current.kind === ts.SyntaxKind.NullKeyword) return VALUE_NULLISH;
  if (isImportMeta(current)) return VALUE_IMPORT_META;
  if (ts.isIdentifier(current)) return identifierValue(current, state, analysis);
  if (ts.isPropertyAccessExpression(current)) {
    if (
      current.name.text === 'URL' &&
      (isNodeUrlNamespace(current.expression, analysis.checker) ||
        isUnshadowedGlobalThis(current.expression, analysis.checker))
    ) {
      return VALUE_URL_CONSTRUCTOR;
    }
    if (
      current.name.text === 'pathToFileURL' &&
      isNodeUrlNamespace(current.expression, analysis.checker)
    ) {
      return VALUE_PATH_TO_FILE_URL;
    }
    if (
      current.name.text === 'url' &&
      (expressionValue(current.expression, state, analysis) & VALUE_IMPORT_META) !== 0
    ) {
      return VALUE_STRING_FILE | VALUE_STATIC_IMPORT_META_URL;
    }
    return VALUE_UNKNOWN;
  }
  if (ts.isElementAccessExpression(current)) {
    if (
      keyValueHas(
        current.argumentExpression,
        VALUE_STATIC_IMPORT_META_URL,
        state,
        analysis,
      ) &&
      (expressionValue(current.expression, state, analysis) & VALUE_IMPORT_META) !== 0
    ) {
      return VALUE_STRING_FILE | VALUE_STATIC_IMPORT_META_URL;
    }
    if (
      (isNodeUrlNamespace(current.expression, analysis.checker) ||
        isUnshadowedGlobalThis(current.expression, analysis.checker)) &&
      keyValueHas(
        current.argumentExpression,
        VALUE_STATIC_URL_CONSTRUCTOR,
        state,
        analysis,
      )
    ) {
      return VALUE_URL_CONSTRUCTOR;
    }
    return VALUE_UNKNOWN;
  }
  if (ts.isNewExpression(current)) {
    return (expressionValue(current.expression, state, analysis) & VALUE_URL_CONSTRUCTOR) !== 0
      ? newUrlValue(current, state, analysis, unknownFirstMayUseBase)
      : VALUE_UNKNOWN;
  }
  if (ts.isCallExpression(current)) {
    return (expressionValue(current.expression, state, analysis) & VALUE_PATH_TO_FILE_URL) !== 0
      ? VALUE_URL_FILE
      : VALUE_UNKNOWN;
  }
  if (ts.isConditionalExpression(current)) {
    const condition = staticBoolean(current.condition);
    if (condition === true) return expressionValue(current.whenTrue, state, analysis);
    if (condition === false) return expressionValue(current.whenFalse, state, analysis);
    return (
      expressionValue(current.whenTrue, state, analysis) |
      expressionValue(current.whenFalse, state, analysis)
    );
  }
  if (ts.isBinaryExpression(current)) {
    if (current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return expressionValue(current.right, state, analysis);
    }
    if (current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const condition = staticBoolean(current.left);
      if (condition === false) return expressionValue(current.left, state, analysis);
      if (condition === true) return expressionValue(current.right, state, analysis);
      return (
        expressionValue(current.left, state, analysis) |
        expressionValue(current.right, state, analysis)
      );
    }
    if (current.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const condition = staticBoolean(current.left);
      if (condition === true) return expressionValue(current.left, state, analysis);
      if (condition === false) return expressionValue(current.right, state, analysis);
      return (
        expressionValue(current.left, state, analysis) |
        expressionValue(current.right, state, analysis)
      );
    }
    if (current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const nullish = staticNullish(current.left, state, analysis);
      if (nullish === true) return expressionValue(current.right, state, analysis);
      if (nullish === false) return expressionValue(current.left, state, analysis);
      return (
        expressionValue(current.left, state, analysis) |
        expressionValue(current.right, state, analysis)
      );
    }
    if (current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return expressionValue(current.right, state, analysis);
    }
  }
  return VALUE_UNKNOWN;
}

function staticBoolean(expression: ts.Expression): boolean | undefined {
  const current = unwrapForProvenance(expression);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const nested = staticBoolean(current.operand);
    return nested === undefined ? undefined : !nested;
  }
  return undefined;
}

function staticNullish(
  expression: ts.Expression,
  state: FlowState,
  analysis: FileUrlAnalysis,
): boolean | undefined {
  const value = expressionValue(expression, state, analysis);
  if ((value & VALUE_NULLISH) !== 0) {
    return value === VALUE_NULLISH ? true : undefined;
  }
  return (value & VALUE_UNKNOWN) !== 0 ? undefined : false;
}

function addViolation(node: ts.Node, analysis: FileUrlAnalysis): void {
  const position = node.getStart(analysis.sourceFile);
  if (analysis.violations.has(position)) return;
  analysis.violations.set(position, {
    file: analysis.sourceFile.fileName,
    line: analysis.sourceFile.getLineAndCharacterOfPosition(position).line + 1,
    text: compactNodeText(node, analysis.sourceFile),
  });
}

function propertyMayBePathname(
  name: ts.PropertyName,
  state: FlowState,
  analysis: FileUrlAnalysis,
): boolean {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text === 'pathname';
  return (
    ts.isComputedPropertyName(name) &&
    keyValueHas(name.expression, VALUE_STATIC_PATHNAME, state, analysis)
  );
}

function bindUnknown(
  name: ts.BindingName,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  if (ts.isIdentifier(name)) {
    const symbol = analysis.checker.getSymbolAtLocation(name);
    if (symbol !== undefined) state.set(symbol, VALUE_UNKNOWN);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) bindUnknown(element.name, state, analysis);
  }
}

function checkBindingPattern(
  pattern: ts.ObjectBindingPattern,
  value: AbstractValue,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  if ((value & VALUE_URL_FILE) === 0) return;
  for (const element of pattern.elements) {
    const name = element.propertyName ?? element.name;
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) continue;
    if (propertyMayBePathname(name, state, analysis)) addViolation(element, analysis);
  }
}

function invalidateAssignmentTarget(
  expression: ts.Expression,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  const current = unwrapForProvenance(expression);
  if (ts.isIdentifier(current)) {
    const symbol = analysis.checker.getSymbolAtLocation(current);
    if (symbol !== undefined) state.set(symbol, VALUE_UNKNOWN);
    return;
  }
  if (ts.isObjectLiteralExpression(current)) {
    for (const property of current.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        const symbol = analysis.checker.getSymbolAtLocation(property.name);
        if (symbol !== undefined) state.set(symbol, VALUE_UNKNOWN);
      } else if (ts.isPropertyAssignment(property)) {
        invalidateAssignmentTarget(property.initializer, state, analysis);
      } else if (ts.isSpreadAssignment(property)) {
        invalidateAssignmentTarget(property.expression, state, analysis);
      }
    }
    return;
  }
  if (ts.isArrayLiteralExpression(current)) {
    for (const element of current.elements) {
      if (!ts.isOmittedExpression(element) && !ts.isSpreadElement(element)) {
        invalidateAssignmentTarget(element, state, analysis);
      }
    }
  }
}

function checkObjectAssignmentPattern(
  left: ts.ObjectLiteralExpression,
  value: AbstractValue,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  if ((value & VALUE_URL_FILE) === 0) return;
  for (const property of left.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyMayBePathname(property.name, state, analysis)
    ) {
      addViolation(property, analysis);
    }
  }
}

function scanObjectAssignment(
  left: ts.ObjectLiteralExpression,
  right: ts.Expression,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  for (const property of left.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      ts.isComputedPropertyName(property.name)
    ) {
      scanExpression(property.name.expression, state, analysis);
    }
  }
  scanExpression(right, state, analysis);
  checkObjectAssignmentPattern(left, expressionValue(right, state, analysis), state, analysis);
  invalidateAssignmentTarget(left, state, analysis);
}

function assignValue(
  expression: ts.Expression,
  value: AbstractValue,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  const current = unwrapForProvenance(expression);
  if (ts.isIdentifier(current)) {
    const symbol = analysis.checker.getSymbolAtLocation(current);
    if (symbol !== undefined) state.set(symbol, value);
    return;
  }
  invalidateAssignmentTarget(current, state, analysis);
}

function scanFunction(
  node:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
  outerState: FlowState,
  analysis: FileUrlAnalysis,
): void {
  const state = cloneState(outerState);
  for (const parameter of node.parameters) {
    if (parameter.initializer !== undefined) {
      scanExpression(parameter.initializer, state, analysis);
    }
    bindUnknown(parameter.name, state, analysis);
  }
  const body = node.body;
  if (body === undefined) return;
  if (ts.isBlock(body)) scanStatementList(body.statements, state, analysis);
  else scanExpression(body, state, analysis);
}

function scanExpression(
  expression: ts.Expression,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    scanExpression(expression.expression, state, analysis);
    return;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    scanExpression(expression.expression, state, analysis);
    if (
      expression.name.text === 'pathname' &&
      (expressionValue(expression.expression, state, analysis) & VALUE_URL_FILE) !== 0
    ) {
      addViolation(expression, analysis);
    }
    return;
  }
  if (ts.isElementAccessExpression(expression)) {
    scanExpression(expression.expression, state, analysis);
    if (expression.argumentExpression !== undefined) {
      scanExpression(expression.argumentExpression, state, analysis);
    }
    if (
      keyValueHas(expression.argumentExpression, VALUE_STATIC_PATHNAME, state, analysis) &&
      (expressionValue(expression.expression, state, analysis) & VALUE_URL_FILE) !== 0
    ) {
      addViolation(expression, analysis);
    }
    return;
  }
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrapForProvenance(expression.left);
      if (ts.isObjectLiteralExpression(left)) {
        scanObjectAssignment(left, expression.right, state, analysis);
      } else {
        if (!ts.isIdentifier(left)) scanExpression(left, state, analysis);
        scanExpression(expression.right, state, analysis);
        assignValue(
          left,
          expressionValue(expression.right, state, analysis),
          state,
          analysis,
        );
      }
      return;
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      scanExpression(expression.left, state, analysis);
      const evaluateRight =
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ? staticBoolean(expression.left)
          : expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
            ? (() => {
                const truthy = staticBoolean(expression.left);
                return truthy === undefined ? undefined : !truthy;
              })()
            : staticNullish(expression.left, state, analysis);
      if (evaluateRight === true) {
        scanExpression(expression.right, state, analysis);
      } else if (evaluateRight === undefined) {
        const skipped = cloneState(state);
        const evaluated = cloneState(state);
        scanExpression(expression.right, evaluated, analysis);
        overwriteState(state, mergeStates([skipped, evaluated]));
      }
      return;
    }
    scanExpression(expression.left, state, analysis);
    scanExpression(expression.right, state, analysis);
    return;
  }
  if (ts.isConditionalExpression(expression)) {
    scanExpression(expression.condition, state, analysis);
    const condition = staticBoolean(expression.condition);
    if (condition === true) {
      scanExpression(expression.whenTrue, state, analysis);
    } else if (condition === false) {
      scanExpression(expression.whenFalse, state, analysis);
    } else {
      const whenTrue = cloneState(state);
      const whenFalse = cloneState(state);
      scanExpression(expression.whenTrue, whenTrue, analysis);
      scanExpression(expression.whenFalse, whenFalse, analysis);
      overwriteState(state, mergeStates([whenTrue, whenFalse]));
    }
    return;
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    scanExpression(expression.expression, state, analysis);
    for (const argument of expression.arguments ?? []) scanExpression(argument, state, analysis);
    return;
  }
  if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
    scanFunction(expression, state, analysis);
    return;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (const property of expression.properties) {
      if (ts.isPropertyAssignment(property)) {
        if (ts.isComputedPropertyName(property.name)) {
          scanExpression(property.name.expression, state, analysis);
        }
        scanExpression(property.initializer, state, analysis);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        if (property.objectAssignmentInitializer !== undefined) {
          scanExpression(property.objectAssignmentInitializer, state, analysis);
        }
      } else if (ts.isSpreadAssignment(property)) {
        scanExpression(property.expression, state, analysis);
      } else if (
        ts.isMethodDeclaration(property) ||
        ts.isGetAccessorDeclaration(property) ||
        ts.isSetAccessorDeclaration(property)
      ) {
        scanFunction(property, state, analysis);
      }
    }
    return;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (!ts.isOmittedExpression(element)) scanExpression(element, state, analysis);
    }
    return;
  }
  if (ts.isTemplateExpression(expression)) {
    for (const span of expression.templateSpans) scanExpression(span.expression, state, analysis);
    return;
  }
  if (ts.isTaggedTemplateExpression(expression)) {
    scanExpression(expression.tag, state, analysis);
    scanExpression(expression.template, state, analysis);
    return;
  }
  if (
    ts.isPrefixUnaryExpression(expression) ||
    ts.isPostfixUnaryExpression(expression) ||
    ts.isAwaitExpression(expression) ||
    ts.isYieldExpression(expression) ||
    ts.isSpreadElement(expression)
  ) {
    const operand =
      ts.isYieldExpression(expression) ||
      ts.isAwaitExpression(expression) ||
      ts.isSpreadElement(expression)
        ? expression.expression
        : expression.operand;
    if (operand !== undefined) scanExpression(operand, state, analysis);
    if (
      (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) &&
      (expression.operator === ts.SyntaxKind.PlusPlusToken ||
        expression.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      invalidateAssignmentTarget(expression.operand, state, analysis);
    }
    return;
  }
  ts.forEachChild(expression, (child) => {
    if (ts.isExpression(child)) scanExpression(child, state, analysis);
  });
}

function scanVariableDeclarationList(
  declarationList: ts.VariableDeclarationList,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  for (const declaration of declarationList.declarations) {
    if (declaration.initializer !== undefined) {
      scanExpression(declaration.initializer, state, analysis);
    }
    const value =
      declaration.initializer === undefined
        ? VALUE_UNKNOWN
        : expressionValue(declaration.initializer, state, analysis);
    if (ts.isIdentifier(declaration.name)) {
      const symbol = analysis.checker.getSymbolAtLocation(declaration.name);
      if (symbol !== undefined) state.set(symbol, value);
    } else {
      if (ts.isObjectBindingPattern(declaration.name)) {
        checkBindingPattern(declaration.name, value, state, analysis);
      }
      bindUnknown(declaration.name, state, analysis);
    }
  }
}

function completion(kind: CompletionKind, state: FlowState, label?: string): FlowCompletion {
  return { kind, label, state };
}

function normalCompletion(state: FlowState): FlowResult {
  return [completion('normal', state)];
}

function mergeFlow(completions: readonly FlowCompletion[]): FlowResult {
  const merged = new Map<string, FlowCompletion>();
  for (const current of completions) {
    const key = `${current.kind}\u0000${current.label ?? ''}`;
    const previous = merged.get(key);
    merged.set(
      key,
      previous === undefined
        ? current
        : completion(current.kind, mergeStates([previous.state, current.state]), current.label),
    );
  }
  return [...merged.values()];
}

function iterableElementValue(
  expression: ts.Expression,
  state: FlowState,
  analysis: FileUrlAnalysis,
  unknownFirstMayUseBase = true,
): AbstractValue {
  const current = unwrapForProvenance(expression);
  if (!ts.isArrayLiteralExpression(current)) return VALUE_UNKNOWN;
  let value = 0;
  for (const element of current.elements) {
    if (ts.isOmittedExpression(element)) continue;
    value |= ts.isSpreadElement(element)
      ? VALUE_UNKNOWN
      : expressionValue(element, state, analysis, unknownFirstMayUseBase);
  }
  return value === 0 ? VALUE_UNKNOWN : value;
}

function assignIterationTarget(
  initializer: ts.ForInitializer,
  value: AbstractValue,
  state: FlowState,
  analysis: FileUrlAnalysis,
): void {
  if (ts.isVariableDeclarationList(initializer)) {
    for (const declaration of initializer.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        const symbol = analysis.checker.getSymbolAtLocation(declaration.name);
        if (symbol !== undefined) state.set(symbol, value);
      } else {
        if (ts.isObjectBindingPattern(declaration.name)) {
          checkBindingPattern(declaration.name, value, state, analysis);
        }
        bindUnknown(declaration.name, state, analysis);
      }
    }
    return;
  }

  const target = unwrapForProvenance(initializer);
  if (ts.isObjectLiteralExpression(target)) {
    for (const property of target.properties) {
      if (
        (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
        ts.isComputedPropertyName(property.name)
      ) {
        scanExpression(property.name.expression, state, analysis);
      }
    }
    checkObjectAssignmentPattern(target, value, state, analysis);
  }
  assignValue(target, value, state, analysis);
}

function scanIntrinsicFileUrlHazards(analysis: FileUrlAnalysis): void {
  const emptyState: FlowState = new Map();
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'pathname' &&
      (expressionValue(node.expression, emptyState, analysis, false) & VALUE_URL_FILE) !== 0
    ) {
      addViolation(node, analysis);
    } else if (
      ts.isElementAccessExpression(node) &&
      keyValueHas(node.argumentExpression, VALUE_STATIC_PATHNAME, emptyState, analysis) &&
      (expressionValue(node.expression, emptyState, analysis, false) & VALUE_URL_FILE) !== 0
    ) {
      addViolation(node, analysis);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined
    ) {
      checkBindingPattern(
        node.name,
        expressionValue(node.initializer, emptyState, analysis, false),
        emptyState,
        analysis,
      );
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = unwrapForProvenance(node.left);
      if (ts.isObjectLiteralExpression(left)) {
        checkObjectAssignmentPattern(
          left,
          expressionValue(node.right, emptyState, analysis, false),
          emptyState,
          analysis,
        );
      }
    } else if (ts.isForOfStatement(node)) {
      const value = iterableElementValue(node.expression, emptyState, analysis, false);
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations) {
          if (ts.isObjectBindingPattern(declaration.name)) {
            checkBindingPattern(declaration.name, value, emptyState, analysis);
          }
        }
      } else {
        const target = unwrapForProvenance(node.initializer);
        if (ts.isObjectLiteralExpression(target)) {
          checkObjectAssignmentPattern(target, value, emptyState, analysis);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(analysis.sourceFile);
}

// The value lattice and completion set are finite. This additional cap prevents
// malformed/control-flow-heavy fixtures from making the package policy unbounded.
const LOOP_ANALYSIS_LIMIT = 8;

interface LoopScanOptions {
  readonly labels: readonly string[];
  readonly maySkip: boolean;
  readonly prepareIteration?: ((state: FlowState) => void) | undefined;
  readonly completeIteration: (state: FlowState) => boolean | undefined;
}

function scanLoop(
  body: ts.Statement,
  entryState: FlowState,
  analysis: FileUrlAnalysis,
  options: LoopScanOptions,
): FlowResult {
  const exits: FlowState[] = options.maySkip ? [cloneState(entryState)] : [];
  const escaped: FlowCompletion[] = [];
  let header = cloneState(entryState);

  for (let pass = 0; pass < LOOP_ANALYSIS_LIMIT; pass += 1) {
    const bodyEntry = cloneState(header);
    options.prepareIteration?.(bodyEntry);
    const result = scanStatement(body, bodyEntry, analysis);
    const backEdges: FlowState[] = [];

    for (const current of result) {
      if (
        current.kind === 'normal' ||
        (current.kind === 'continue' &&
          (current.label === undefined || options.labels.includes(current.label)))
      ) {
        backEdges.push(cloneState(current.state));
      } else if (current.kind === 'break' && current.label === undefined) {
        exits.push(current.state);
      } else {
        escaped.push(current);
      }
    }

    const repeating: FlowState[] = [];
    for (const backEdge of backEdges) {
      const repeats = options.completeIteration(backEdge);
      if (repeats !== true) exits.push(cloneState(backEdge));
      if (repeats !== false) repeating.push(backEdge);
    }
    if (repeating.length === 0) break;

    const nextHeader = mergeStates([header, ...repeating]);
    if (statesEqual(nextHeader, header)) break;
    header = nextHeader;
  }

  return mergeFlow([
    ...(exits.length === 0 ? [] : [completion('normal', mergeStates(exits))]),
    ...escaped,
  ]);
}

function scanClass(node: ts.ClassDeclaration, state: FlowState, analysis: FileUrlAnalysis): void {
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
      scanExpression(member.initializer, cloneState(state), analysis);
    } else if (
      ts.isMethodDeclaration(member) ||
      ts.isConstructorDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      scanFunction(member, state, analysis);
    } else if (ts.isClassStaticBlockDeclaration(member)) {
      scanStatementList(member.body.statements, cloneState(state), analysis);
    }
  }
}

function scanSwitchPath(
  clauses: readonly ts.CaseOrDefaultClause[],
  start: number,
  entryState: FlowState,
  analysis: FileUrlAnalysis,
): FlowResult {
  const statements = clauses.slice(start).flatMap((clause) => [...clause.statements]);
  return mergeFlow(
    scanStatementList(statements, cloneState(entryState), analysis).map((current) =>
      current.kind === 'break' && current.label === undefined
        ? completion('normal', current.state)
        : current,
    ),
  );
}

function applyFinally(
  incoming: FlowResult,
  block: ts.Block,
  analysis: FileUrlAnalysis,
): FlowResult {
  const result: FlowCompletion[] = [];
  for (const prior of incoming) {
    for (const finalCompletion of scanStatement(block, cloneState(prior.state), analysis)) {
      result.push(
        finalCompletion.kind === 'normal'
          ? completion(prior.kind, finalCompletion.state, prior.label)
          : finalCompletion,
      );
    }
  }
  return mergeFlow(result);
}

function scanStatement(
  statement: ts.Statement,
  state: FlowState,
  analysis: FileUrlAnalysis,
  labels: readonly string[] = [],
): FlowResult {
  if (ts.isBlock(statement)) return scanStatementList(statement.statements, state, analysis);
  if (ts.isVariableStatement(statement)) {
    scanVariableDeclarationList(statement.declarationList, state, analysis);
    return normalCompletion(state);
  }
  if (ts.isExpressionStatement(statement)) {
    scanExpression(statement.expression, state, analysis);
    return normalCompletion(state);
  }
  if (ts.isIfStatement(statement)) {
    scanExpression(statement.expression, state, analysis);
    const condition = staticBoolean(statement.expression);
    if (condition === true) return scanStatement(statement.thenStatement, state, analysis);
    if (condition === false) {
      return statement.elseStatement === undefined
        ? normalCompletion(state)
        : scanStatement(statement.elseStatement, state, analysis);
    }
    const whenTrue = scanStatement(statement.thenStatement, cloneState(state), analysis);
    const whenFalse =
      statement.elseStatement === undefined
        ? normalCompletion(cloneState(state))
        : scanStatement(statement.elseStatement, cloneState(state), analysis);
    return mergeFlow([...whenTrue, ...whenFalse]);
  }
  if (ts.isFunctionDeclaration(statement)) {
    scanFunction(statement, state, analysis);
    return normalCompletion(state);
  }
  if (ts.isClassDeclaration(statement)) {
    scanClass(statement, state, analysis);
    return normalCompletion(state);
  }
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
    if (statement.expression !== undefined) scanExpression(statement.expression, state, analysis);
    return [completion(ts.isReturnStatement(statement) ? 'return' : 'throw', state)];
  }
  if (ts.isForStatement(statement)) {
    if (statement.initializer !== undefined) {
      if (ts.isVariableDeclarationList(statement.initializer)) {
        scanVariableDeclarationList(statement.initializer, state, analysis);
      } else {
        scanExpression(statement.initializer, state, analysis);
      }
    }
    if (statement.condition !== undefined) scanExpression(statement.condition, state, analysis);
    const initialCondition =
      statement.condition === undefined ? true : staticBoolean(statement.condition);
    if (initialCondition === false) return normalCompletion(state);
    return scanLoop(statement.statement, state, analysis, {
      labels,
      maySkip: initialCondition !== true,
      completeIteration: (next) => {
        if (statement.incrementor !== undefined) {
          scanExpression(statement.incrementor, next, analysis);
        }
        if (statement.condition === undefined) return true;
        scanExpression(statement.condition, next, analysis);
        return staticBoolean(statement.condition);
      },
    });
  }
  if (ts.isWhileStatement(statement)) {
    scanExpression(statement.expression, state, analysis);
    const initialCondition = staticBoolean(statement.expression);
    if (initialCondition === false) return normalCompletion(state);
    return scanLoop(statement.statement, state, analysis, {
      labels,
      maySkip: initialCondition !== true,
      completeIteration: (next) => {
        scanExpression(statement.expression, next, analysis);
        return staticBoolean(statement.expression);
      },
    });
  }
  if (ts.isDoStatement(statement)) {
    return scanLoop(statement.statement, state, analysis, {
      labels,
      maySkip: false,
      completeIteration: (next) => {
        scanExpression(statement.expression, next, analysis);
        return staticBoolean(statement.expression);
      },
    });
  }
  if (ts.isForInStatement(statement) || ts.isForOfStatement(statement)) {
    scanExpression(statement.expression, state, analysis);
    const itemValue = ts.isForOfStatement(statement)
      ? iterableElementValue(statement.expression, state, analysis)
      : VALUE_UNKNOWN;
    return scanLoop(statement.statement, state, analysis, {
      labels,
      maySkip: true,
      prepareIteration: (next) => {
        assignIterationTarget(statement.initializer, itemValue, next, analysis);
      },
      completeIteration: () => undefined,
    });
  }
  if (ts.isSwitchStatement(statement)) {
    scanExpression(statement.expression, state, analysis);
    const clauses = statement.caseBlock.clauses;
    const alternatives = clauses.flatMap((_, index) =>
      scanSwitchPath(clauses, index, state, analysis),
    );
    if (!clauses.some((clause) => ts.isDefaultClause(clause))) {
      alternatives.push(completion('normal', cloneState(state)));
    }
    return mergeFlow(alternatives);
  }
  if (ts.isTryStatement(statement)) {
    const attempted = scanStatement(statement.tryBlock, cloneState(state), analysis);
    let combined: FlowResult;
    if (statement.catchClause === undefined) {
      combined = attempted;
    } else {
      const thrown = attempted.filter((current) => current.kind === 'throw');
      const uncaught = attempted.filter((current) => current.kind !== 'throw');
      if (thrown.length === 0) {
        combined = uncaught;
      } else {
        const caught = mergeStates(thrown.map((current) => current.state));
        const declaration = statement.catchClause.variableDeclaration;
        if (declaration !== undefined) bindUnknown(declaration.name, caught, analysis);
        combined = mergeFlow([
          ...uncaught,
          ...scanStatement(statement.catchClause.block, caught, analysis),
        ]);
      }
    }
    return statement.finallyBlock === undefined
      ? combined
      : applyFinally(combined, statement.finallyBlock, analysis);
  }
  if (ts.isLabeledStatement(statement)) {
    const label = statement.label.text;
    return mergeFlow(
      scanStatement(statement.statement, state, analysis, [...labels, label]).map((current) =>
        current.kind === 'break' && current.label === label
          ? completion('normal', current.state)
          : current,
      ),
    );
  }
  if (ts.isWithStatement(statement)) {
    scanExpression(statement.expression, state, analysis);
    return scanStatement(statement.statement, state, analysis);
  }
  if (ts.isExportAssignment(statement)) {
    scanExpression(statement.expression, state, analysis);
    return normalCompletion(state);
  }
  if (ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) {
    return [
      completion(
        ts.isBreakStatement(statement) ? 'break' : 'continue',
        state,
        statement.label?.text,
      ),
    ];
  }
  if (ts.isDebuggerStatement(statement) || ts.isEmptyStatement(statement)) {
    return normalCompletion(state);
  }
  ts.forEachChild(statement, (child) => {
    if (ts.isExpression(child)) scanExpression(child, state, analysis);
  });
  return normalCompletion(state);
}

function scanStatementList(
  statements: readonly ts.Statement[],
  initialState: FlowState,
  analysis: FileUrlAnalysis,
): FlowResult {
  let paths: FlowResult = normalCompletion(initialState);
  for (const statement of statements) {
    const next: FlowCompletion[] = [];
    for (const current of paths) {
      if (current.kind === 'normal') {
        next.push(...scanStatement(statement, current.state, analysis));
      } else {
        next.push(current);
      }
    }
    paths = mergeFlow(next);
  }
  return paths;
}

export function findFileUrlPathnameViolations(
  file: string,
  source: string,
): FileUrlPathnameViolation[] {
  const { checker, sourceFile } = bindSource(file, source);
  const analysis: FileUrlAnalysis = {
    checker,
    sourceFile,
    violations: new Map(),
  };
  scanIntrinsicFileUrlHazards(analysis);
  scanStatementList(sourceFile.statements, new Map(), analysis);
  return [...analysis.violations]
    .sort(([left], [right]) => left - right)
    .map(([, violation]) => violation);
}
