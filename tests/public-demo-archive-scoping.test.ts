import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Violation = {
  file: string;
  line: number;
  call: string;
};

describe("private workspace archive scoping", () => {
  it("requires every private readWorkspace call to carry an explicit archive scope", async () => {
    const privateRoot = path.join(process.cwd(), "app", "app");
    const files = await typescriptFiles(privateRoot);
    const violations = (
      await Promise.all(files.map((file) => findUnscopedWorkspaceReads(file)))
    ).flat();

    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("accepts direct generation-aware session scopes and resolved archive option objects", () => {
    const violations = findUnscopedWorkspaceReadsInSource(`
      const archiveOptions = { archiveId: session.archiveId };
      readWorkspace(workspaceOptionsForSession(session));
      readWorkspace(archiveOptions);
    `);

    expect(violations).toEqual([]);
  });

  it("rejects missing, empty, unresolved, and non-generation-aware scopes", () => {
    const violations = findUnscopedWorkspaceReadsInSource(`
      const emptyOptions = {};
      readWorkspace();
      readWorkspace({});
      readWorkspace({ archiveId: undefined });
      readWorkspace(emptyOptions);
      readWorkspace(unresolvedOptions);
      readWorkspace(workspaceOptionsForSession());
      readWorkspace(optionsForSession(session));
    `);

    expect(violations.map((violation) => violation.call)).toEqual([
      "readWorkspace()",
      "readWorkspace({})",
      "readWorkspace({ archiveId: undefined })",
      "readWorkspace(emptyOptions)",
      "readWorkspace(unresolvedOptions)",
      "readWorkspace(workspaceOptionsForSession())",
      "readWorkspace(optionsForSession(session))"
    ]);
  });
});

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(target);
    return /\.tsx?$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat().sort();
}

async function findUnscopedWorkspaceReads(file: string): Promise<Violation[]> {
  const sourceText = await readFile(file, "utf8");
  return findUnscopedWorkspaceReadsInSource(sourceText, file);
}

function findUnscopedWorkspaceReadsInSource(
  sourceText: string,
  file = "archive-scoping-contract.ts"
): Violation[] {
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const violations: Violation[] = [];
  const initializers = new Map<string, ts.Expression>();

  function collectInitializers(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      initializers.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectInitializers);
  }

  collectInitializers(sourceFile);

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "readWorkspace"
      && (
        node.arguments.length !== 1
        || !isExplicitArchiveScope(node.arguments[0], initializers)
      )
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        file: path.relative(process.cwd(), file),
        line: position.line + 1,
        call: node.getText(sourceFile)
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function isExplicitArchiveScope(
  expression: ts.Expression,
  initializers: ReadonlyMap<string, ts.Expression>,
  resolving = new Set<string>()
): boolean {
  if (ts.isIdentifier(expression)) {
    if (resolving.has(expression.text)) return false;
    const initializer = initializers.get(expression.text);
    if (!initializer) return false;
    const nextResolving = new Set(resolving).add(expression.text);
    return isExplicitArchiveScope(initializer, initializers, nextResolving);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return isExplicitArchiveScope(expression.expression, initializers, resolving);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      isExplicitArchiveScope(expression.whenTrue, initializers, resolving)
      && isExplicitArchiveScope(expression.whenFalse, initializers, resolving)
    );
  }
  if (
    ts.isCallExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "workspaceOptionsForSession"
  ) {
    return expression.arguments.length === 1 && !isNullishExpression(expression.arguments[0]);
  }
  if (!ts.isObjectLiteralExpression(expression)) return false;

  return expression.properties.some((property) =>
    ts.isPropertyAssignment(property)
    && (
      (ts.isIdentifier(property.name) && property.name.text === "archiveId")
      || (ts.isStringLiteral(property.name) && property.name.text === "archiveId")
    )
    && !isNullishExpression(property.initializer)
  );
}

function isNullishExpression(expression: ts.Expression): boolean {
  return expression.kind === ts.SyntaxKind.NullKeyword
    || (ts.isIdentifier(expression) && expression.text === "undefined");
}

function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return "All private workspace reads are explicitly archive-scoped.";
  return [
    "Private workspace reads must be explicitly archive-scoped:",
    ...violations.map((violation) =>
      `${violation.file}:${violation.line} ${violation.call}`
    )
  ].join("\n");
}
