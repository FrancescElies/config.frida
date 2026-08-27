/**
 * Simplified parser module for use with tracer
 * Uses tree-sitter for fast, dependency-free parsing
 */

import * as fs from "fs";
import Parser from "tree-sitter";
import C from "tree-sitter-cpp";

// ============================================================================
// Type Definitions (exported)
// ============================================================================

export type TypePath = Array<[string, string[]]> | string;

export interface Parameter {
  name: string;
  type: TypePath;
}

export interface ParsedFunction {
  name: string;
  returnType: TypePath;
  parameters: Parameter[];
}

export interface ParsedStruct {
  name: string;
  functionPointers: Array<{
    offset: number;
    name: string;
    returnType: TypePath;
    parameters: Parameter[];
  }>;
}

export interface ParsedHeader {
  functions: ParsedFunction[];
  structs: ParsedStruct[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a C/C++ header file using tree-sitter
 * @param filePath Path to the header file
 * @returns Parsed functions and structs
 */
export function parseHeader(filePath: string): ParsedHeader {
  const sourceCode = fs.readFileSync(filePath, "utf-8");

  const parser = new Parser();
  parser.setLanguage(C);

  const tree = parser.parse(sourceCode);
  const functions: ParsedFunction[] = [];
  const structs: ParsedStruct[] = [];

  visitNode(tree.rootNode, (node) => {
    switch (node.type) {
      case "function_declaration":
        functions.push(parseFunction(node, sourceCode));
        break;

      case "struct_specifier": {
        const parsedStruct = parseStruct(node, sourceCode);
        if (parsedStruct !== null && parsedStruct.functionPointers.length > 0) {
          structs.push(parsedStruct);
        }
        break;
      }
    }
  });

  tree.delete();
  return { functions, structs };
}

// ============================================================================
// Internal Parsing Functions
// ============================================================================

function parseFunction(
  node: Parser.SyntaxNode,
  sourceCode: string,
): ParsedFunction {
  let name = "";
  let returnType: TypePath = "void";
  const parameters: Parameter[] = [];

  for (const child of node.children) {
    if (child.type === "declaration_specifiers") {
      returnType = extractType(child, sourceCode);
    } else if (
      child.type === "declarator" ||
      child.type === "pointer_declarator"
    ) {
      name = extractDeclaratorName(child, sourceCode);
    } else if (child.type === "parameter_list") {
      const params = extractParameters(child, sourceCode);
      parameters.push(...params);
    }
  }

  return { name, returnType, parameters };
}

function parseStruct(
  node: Parser.SyntaxNode,
  sourceCode: string,
): ParsedStruct | null {
  const nameNode = node.childForFieldName("name");
  const structName = nameNode
    ? sourceCode.substring(nameNode.startIndex, nameNode.endIndex)
    : "";

  if (!structName) {
    return null;
  }

  const functionPointers: ParsedStruct["functionPointers"] = [];
  const bodyNode = node.childForFieldName("body");

  if (bodyNode) {
    for (const child of bodyNode.children) {
      if (child.type === "field_declaration") {
        const fieldName = extractDeclaratorName(child, sourceCode);

        if (isFunctionPointerField(child, sourceCode)) {
          const returnType = extractType(child, sourceCode);
          const parameters = extractFieldParameters(child, sourceCode);

          functionPointers.push({
            offset: 0,
            name: fieldName,
            returnType,
            parameters,
          });
        }
      }
    }
  }

  return { name: structName, functionPointers };
}

function isFunctionPointerField(
  node: Parser.SyntaxNode,
  sourceCode: string,
): boolean {
  const text = sourceCode.substring(node.startIndex, node.endIndex);
  return text.includes("(*") || text.includes("(*)");
}

function extractType(node: Parser.SyntaxNode, sourceCode: string): TypePath {
  const typeText = sourceCode.substring(node.startIndex, node.endIndex);

  const pointerMatch = typeText.match(/\*+/g);
  if (pointerMatch) {
    const pointerChain: Array<[string, string[]]> = [];
    const parts = typeText.split(/\*+/);

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i].trim();
      const qualifiers = extractQualifiers(part);
      pointerChain.push(["Pointer", qualifiers]);
    }

    const baseType = parts[parts.length - 1].trim();
    pointerChain.push([baseType || "void", extractQualifiers(baseType)]);

    return pointerChain;
  }

  return typeText.trim();
}

function extractQualifiers(typeStr: string): string[] {
  const qualifiers: string[] = [];

  if (typeStr.includes("const")) {
    qualifiers.push("const");
  }
  if (typeStr.includes("volatile")) {
    qualifiers.push("volatile");
  }
  if (typeStr.includes("restrict")) {
    qualifiers.push("restrict");
  }

  return qualifiers;
}

function extractDeclaratorName(
  node: Parser.SyntaxNode,
  sourceCode: string,
): string {
  for (const child of node.children) {
    if (child.type === "direct_declarator" || child.type === "identifier") {
      const text = sourceCode.substring(child.startIndex, child.endIndex);
      return text.replace(/[\(\[\*].*/, "").trim();
    }
  }

  return "";
}

function extractParameters(
  paramListNode: Parser.SyntaxNode,
  sourceCode: string,
): Parameter[] {
  const parameters: Parameter[] = [];
  let paramIndex = 0;

  for (const child of paramListNode.children) {
    if (child.type === "parameter_declaration") {
      const paramName =
        extractDeclaratorName(child, sourceCode) || `arg${paramIndex + 1}`;
      const paramType = extractType(child, sourceCode);
      parameters.push({ name: paramName, type: paramType });
      paramIndex++;
    }
  }

  return parameters;
}

function extractFieldParameters(
  fieldNode: Parser.SyntaxNode,
  sourceCode: string,
): Parameter[] {
  const parameters: Parameter[] = [];
  let paramIndex = 0;

  for (const child of fieldNode.children) {
    if (child.type === "parameter_list") {
      for (const paramChild of child.children) {
        if (paramChild.type === "parameter_declaration") {
          const paramName =
            extractDeclaratorName(paramChild, sourceCode) ||
            `arg${paramIndex + 1}`;
          const paramType = extractType(paramChild, sourceCode);
          parameters.push({ name: paramName, type: paramType });
          paramIndex++;
        }
      }
    }
  }

  return parameters;
}

function visitNode(
  node: Parser.SyntaxNode,
  callback: (node: Parser.SyntaxNode) => void,
): void {
  callback(node);

  for (const child of node.children) {
    visitNode(child, callback);
  }
}
