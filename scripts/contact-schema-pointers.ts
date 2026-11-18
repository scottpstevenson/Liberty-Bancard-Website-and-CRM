import ts from "typescript";

/** Inspect each pgTable's own column AST; formatting cannot merge adjacent tables. */
export function schemaContactPointers(source: string): string[] {
  const file = ts.createSourceFile("schema.ts", source, ts.ScriptTarget.Latest, true);
  const pointers = new Set<string>();
  const factories = new Set(["integer", "smallint", "bigint", "uuid", "text", "varchar"]);
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "pgTable") {
      const [name, columns] = node.arguments;
      if (name && ts.isStringLiteral(name) && columns && ts.isObjectLiteralExpression(columns)) {
        for (const property of columns.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          let column: string | undefined;
          let referencesContact = false;
          function inspect(part: ts.Node): void {
            if (ts.isCallExpression(part)) {
              if (ts.isIdentifier(part.expression) && factories.has(part.expression.text)
                && part.arguments[0] && ts.isStringLiteral(part.arguments[0])) column = part.arguments[0].text;
              if (ts.isPropertyAccessExpression(part.expression) && part.expression.name.text === "references") {
                const reference = part.arguments[0];
                if (reference && ts.isArrowFunction(reference) && ts.isPropertyAccessExpression(reference.body)
                  && ts.isIdentifier(reference.body.expression) && reference.body.expression.text === "contacts"
                  && reference.body.name.text === "id") referencesContact = true;
              }
            }
            ts.forEachChild(part, inspect);
          }
          inspect(property.initializer);
          if (column && referencesContact) pointers.add(`${name.text}.${column}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...pointers].sort();
}
