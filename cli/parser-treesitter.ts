#!/usr/bin/env node

/**
 * C/C++ Header Parser using tree-sitter
 * Modern, incremental parser for C/C++ - actively maintained and fast
 * 
 * Installation:
 * npm install tree-sitter tree-sitter-cpp
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
import C from 'tree-sitter-cpp';

// ============================================================================
// Type Definitions
// ============================================================================

/** Represents a type - either a basic type name or a chain of pointers with qualifiers */
type TypePath = Array<[string, string[]]> | string;

/** Parameter in a function or function pointer */
interface Parameter {
  name: string;
  type: TypePath;
}

/** Parsed function signature */
interface ParsedFunction {
  name: string;
  returnType: TypePath;
  parameters: Parameter[];
}

/** Function pointer field within a struct */
interface FunctionPointerField {
  offset: number;
  name: string;
  returnType: TypePath;
  parameters: Parameter[];
}

/** Struct containing function pointer fields */
interface ParsedStruct {
  name: string;
  functionPointers: FunctionPointerField[];
}

/** Complete parsed header file */
interface ParsedHeader {
  functions: ParsedFunction[];
  structs: ParsedStruct[];
}

// ============================================================================
// Tree-sitter Node Types
// ============================================================================

const NODE_TYPES = {
  FunctionDeclaration: 'function_declaration',
  StructSpecifier: 'struct_specifier',
  FieldDeclaration: 'field_declaration',
  ParameterDeclaration: 'parameter_declaration',
  PointerDeclarator: 'pointer_declarator',
  TypeQualifier: 'type_qualifier',
  PrimitiveType: 'primitive_type'
} as const;

// ============================================================================
// Main Entry Point
// ============================================================================

function main(): void {
  if (process.argv.length !== 3) {
    console.error(`Usage: ${path.basename(process.argv[1])} /path/to/header.h`);
    process.exit(1);
  }

  const headerPath = process.argv[2];

  // Validate file exists
  if (!fs.existsSync(headerPath)) {
    console.error(`Error: File not found: ${headerPath}`);
    process.exit(1);
  }

  try {
    const data = parseHeader(headerPath);
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

main();

// ============================================================================
// Core Parsing Functions
// ============================================================================

/**
 * Parse a C/C++ header file using tree-sitter.
 * @param filePath Path to the header file to parse
 * @returns Parsed functions and structs
 * @throws Error if parsing fails
 */
function parseHeader(filePath: string): ParsedHeader {
  const sourceCode = fs.readFileSync(filePath, 'utf-8');

  const parser = new Parser();
  parser.setLanguage(C);

  const tree = parser.parse(sourceCode);
  const functions: ParsedFunction[] = [];
  const structs: ParsedStruct[] = [];

  visitNode(tree.rootNode, (node) => {
    switch (node.type) {
      case NODE_TYPES.FunctionDeclaration:
        functions.push(parseFunction(node, sourceCode));
        break;

      case NODE_TYPES.StructSpecifier: {
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

/**
 * Parse a function declaration node.
 * @param node Tree-sitter node for function declaration
 * @param sourceCode The source code text
 * @returns Parsed function signature
 */
function parseFunction(node: Parser.SyntaxNode, sourceCode: string): ParsedFunction {
  // Extract function name (usually in the declarator child)
  let name = '';
  let returnType: TypePath = 'void';
  const parameters: Parameter[] = [];

  for (const child of node.children) {
    if (child.type === 'declaration_specifiers') {
      returnType = extractType(child, sourceCode);
    } else if (child.type === 'declarator' || child.type === 'pointer_declarator') {
      name = extractDeclaratorName(child, sourceCode);
    } else if (child.type === 'parameter_list') {
      const params = extractParameters(child, sourceCode);
      parameters.push(...params);
    }
  }

  return { name, returnType, parameters };
}

/**
 * Parse a struct declaration node.
 * @param node Tree-sitter node for struct specifier
 * @param sourceCode The source code text
 * @returns Parsed struct, or null if no name
 */
function parseStruct(node: Parser.SyntaxNode, sourceCode: string): ParsedStruct | null {
  // Extract struct name
  const nameNode = node.childForFieldName('name');
  const structName = nameNode ? sourceCode.substring(nameNode.startIndex, nameNode.endIndex) : '';

  if (!structName) {
    return null;
  }

  const functionPointers: FunctionPointerField[] = [];
  const bodyNode = node.childForFieldName('body');

  if (bodyNode) {
    for (const child of bodyNode.children) {
      if (child.type === NODE_TYPES.FieldDeclaration) {
        const fieldName = extractDeclaratorName(child, sourceCode);
        
        if (isFunctionPointerField(child, sourceCode)) {
          const returnType = extractType(child, sourceCode);
          const parameters = extractFieldParameters(child, sourceCode);

          functionPointers.push({
            offset: 0, // Tree-sitter doesn't provide byte offsets easily
            name: fieldName,
            returnType,
            parameters
          });
        }
      }
    }
  }

  return { name: structName, functionPointers };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a field declaration is a function pointer.
 * @param node Field declaration node
 * @param sourceCode The source code text
 * @returns True if it's a function pointer
 */
function isFunctionPointerField(node: Parser.SyntaxNode, sourceCode: string): boolean {
  const text = sourceCode.substring(node.startIndex, node.endIndex);
  return text.includes('(*') || text.includes('(*)');
}

/**
 * Extract type from a node.
 * @param node The node containing type information
 * @param sourceCode The source code text
 * @returns Parsed type
 */
function extractType(node: Parser.SyntaxNode, sourceCode: string): TypePath {
  const typeText = sourceCode.substring(node.startIndex, node.endIndex);
  
  // Check for pointer chains
  const pointerMatch = typeText.match(/\*+/g);
  if (pointerMatch) {
    const pointerChain: Array<[string, string[]]> = [];
    const parts = typeText.split(/\*+/);
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i].trim();
      const qualifiers = extractQualifiers(part);
      pointerChain.push(['Pointer', qualifiers]);
    }
    
    const baseType = parts[parts.length - 1].trim();
    pointerChain.push([baseType || 'void', extractQualifiers(baseType)]);
    
    return pointerChain;
  }

  // Return basic type
  return typeText.trim();
}

/**
 * Extract qualifiers from type string.
 * @param typeStr The type string
 * @returns Array of qualifiers
 */
function extractQualifiers(typeStr: string): string[] {
  const qualifiers: string[] = [];
  
  if (typeStr.includes('const')) {
    qualifiers.push('const');
  }
  if (typeStr.includes('volatile')) {
    qualifiers.push('volatile');
  }
  if (typeStr.includes('restrict')) {
    qualifiers.push('restrict');
  }

  return qualifiers;
}

/**
 * Extract declarator name from a node.
 * @param node Declarator node
 * @param sourceCode The source code text
 * @returns The declarator name
 */
function extractDeclaratorName(node: Parser.SyntaxNode, sourceCode: string): string {
  // Look for direct_declarator or identifier child
  for (const child of node.children) {
    if (child.type === 'direct_declarator' || child.type === 'identifier') {
      const text = sourceCode.substring(child.startIndex, child.endIndex);
      // Remove function/array qualifiers
      return text.replace(/[\(\[\*].*/, '').trim();
    }
  }

  return '';
}

/**
 * Extract parameters from parameter list.
 * @param paramListNode Parameter list node
 * @param sourceCode The source code text
 * @returns Array of parameters
 */
function extractParameters(paramListNode: Parser.SyntaxNode, sourceCode: string): Parameter[] {
  const parameters: Parameter[] = [];
  let paramIndex = 0;

  for (const child of paramListNode.children) {
    if (child.type === NODE_TYPES.ParameterDeclaration) {
      const paramName = extractDeclaratorName(child, sourceCode) || `arg${paramIndex + 1}`;
      const paramType = extractType(child, sourceCode);
      parameters.push({ name: paramName, type: paramType });
      paramIndex++;
    }
  }

  return parameters;
}

/**
 * Extract parameters from a field declaration (function pointer).
 * @param fieldNode Field declaration node
 * @param sourceCode The source code text
 * @returns Array of parameters
 */
function extractFieldParameters(fieldNode: Parser.SyntaxNode, sourceCode: string): Parameter[] {
  const parameters: Parameter[] = [];
  let paramIndex = 0;

  for (const child of fieldNode.children) {
    if (child.type === 'parameter_list') {
      for (const paramChild of child.children) {
        if (paramChild.type === NODE_TYPES.ParameterDeclaration) {
          const paramName = extractDeclaratorName(paramChild, sourceCode) || `arg${paramIndex + 1}`;
          const paramType = extractType(paramChild, sourceCode);
          parameters.push({ name: paramName, type: paramType });
          paramIndex++;
        }
      }
    }
  }

  return parameters;
}

/**
 * Visit all nodes in the tree.
 * @param node Starting node
 * @param callback Function to call for each node
 */
function visitNode(node: Parser.SyntaxNode, callback: (node: Parser.SyntaxNode) => void): void {
  callback(node);

  for (const child of node.children) {
    visitNode(child, callback);
  }
}
