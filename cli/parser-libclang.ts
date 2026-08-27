#!/usr/bin/env node

/**
 * C/C++ Header Parser using libclang
 * Parse function declarations and struct function pointers
 * 
 * Installation:
 * npm install libclang
 */

import * as libclang from 'libclang';
import * as fs from 'fs';
import * as path from 'path';

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
// Constants
// ============================================================================

const BITS_PER_BYTE = 8;
const BYTES_PER_FIELD_OFFSET = 8;
const DEFAULT_INCLUDE_PATH = '-I/usr/include';

// LibClang cursor kinds
const CXCursorKind = {
  FunctionDecl: 21,
  StructDecl: 7,
  FieldDecl: 6,
  TypeRef: 43,
  ParmDecl: 10
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
 * Parse a C/C++ header file and extract function declarations and structs with function pointers.
 * @param filePath Path to the header file to parse
 * @returns Parsed functions and structs
 * @throws Error if parsing fails
 */
function parseHeader(filePath: string): ParsedHeader {
  const index = libclang.createIndex(true, true);

  try {
    const translationUnit = libclang.parseTranslationUnit(
      index,
      filePath,
      [DEFAULT_INCLUDE_PATH],
      []
    );

    if (!translationUnit) {
      throw new Error(`Failed to parse header: ${filePath}`);
    }

    const functions: ParsedFunction[] = [];
    const structs: ParsedStruct[] = [];

    visitCursor(translationUnit.cursor, (cursor) => {
      switch (cursor.kind) {
        case CXCursorKind.FunctionDecl:
          functions.push(parseFunction(cursor));
          break;

        case CXCursorKind.StructDecl: {
          const parsedStruct = parseStruct(cursor);
          if (parsedStruct !== null && parsedStruct.functionPointers.length > 0) {
            structs.push(parsedStruct);
          }
          break;
        }
      }
    });

    translationUnit.dispose();
    return { functions, structs };
  } finally {
    index.dispose();
  }
}

/**
 * Parse a function declaration and extract its signature.
 * @param cursor LibClang cursor pointing to a function declaration
 * @returns Parsed function with name, return type, and parameters
 */
function parseFunction(cursor: libclang.Cursor): ParsedFunction {
  const name = cursor.spelling;
  const returnType = parseType(cursor.resultType);
  const parameters: Parameter[] = [];

  visitCursor(cursor, (child) => {
    if (child.kind === CXCursorKind.ParmDecl) {
      const paramName = child.spelling || `arg${parameters.length + 1}`;
      const paramType = parseType(child.type);
      parameters.push({ name: paramName, type: paramType });
    }
  });

  return { name, returnType, parameters };
}

/**
 * Parse a struct declaration and extract function pointer fields.
 * @param cursor LibClang cursor pointing to a struct declaration
 * @returns Parsed struct, or null if the struct has no name
 */
function parseStruct(cursor: libclang.Cursor): ParsedStruct | null {
  const structName = cursor.spelling;

  if (!structName) {
    return null;
  }

  const functionPointers: FunctionPointerField[] = [];
  let currentFunctionPointer: FunctionPointerField | null = null;

  visitCursor(cursor, (child) => {
    switch (child.kind) {
      case CXCursorKind.FieldDecl:
        if (isFunctionPointer(child.type)) {
          const offsetInBits = child.offsetOfField;
          const offsetInBytes = offsetInBits / BITS_PER_BYTE / BYTES_PER_FIELD_OFFSET;

          currentFunctionPointer = {
            offset: offsetInBytes,
            name: child.spelling,
            returnType: 'void',
            parameters: []
          };

          functionPointers.push(currentFunctionPointer);
        }
        break;

      case CXCursorKind.TypeRef:
        if (currentFunctionPointer !== null) {
          currentFunctionPointer.returnType = parseType(child.type);
        }
        break;

      case CXCursorKind.ParmDecl:
        if (currentFunctionPointer !== null) {
          const paramName = child.spelling || `arg${currentFunctionPointer.parameters.length + 1}`;
          const paramType = parseType(child.type);
          currentFunctionPointer.parameters.push({ name: paramName, type: paramType });
        }
        break;
    }
  });

  return { name: structName, functionPointers };
}

// ============================================================================
// Type Parsing Utilities
// ============================================================================

/**
 * Determine if a type is a function pointer.
 * @param type LibClang type object
 * @returns True if the type represents a function pointer
 */
function isFunctionPointer(type: libclang.Type): boolean {
  if (type.kind !== libclang.TypeKind.Pointer) {
    return false;
  }

  const pointeeType = type.pointeeType;
  return pointeeType.kind === libclang.TypeKind.FunctionProto ||
         pointeeType.kind === libclang.TypeKind.FunctionNoProto;
}

/**
 * Parse a type and return its representation.
 * Handles pointer chains and resolves typedefs.
 * @param type LibClang type object
 * @returns Type representation as a string or pointer chain array
 */
function parseType(type: libclang.Type): TypePath {
  const typeName = type.spelling;

  // Handle pointer chains
  if (type.kind === libclang.TypeKind.Pointer) {
    const pointerChain: Array<[string, string[]]> = [
      ['Pointer', parseQualifiers(type)]
    ];

    let currentType = type;
    do {
      currentType = currentType.pointeeType;
      pointerChain.push([currentType.spelling, parseQualifiers(currentType)]);
    } while (currentType.kind === libclang.TypeKind.Pointer);

    return pointerChain;
  }

  // Resolve typedefs to their canonical type
  if (type.kind === libclang.TypeKind.Typedef) {
    return parseType(type.canonicalType);
  }

  // Return basic type name
  return typeName;
}

/**
 * Extract type qualifiers from a type.
 * @param type LibClang type object
 * @returns Array of qualifier strings
 */
function parseQualifiers(type: libclang.Type): string[] {
  const qualifiers: string[] = [];

  if (type.isConstQualified) {
    qualifiers.push('const');
  }

  if (type.isVolatileQualified) {
    qualifiers.push('volatile');
  }

  if (type.isRestrictQualified) {
    qualifiers.push('restrict');
  }

  return qualifiers;
}

/**
 * Visit all direct children of a cursor.
 * @param cursor The parent cursor
 * @param callback Function to call for each child
 */
function visitCursor(
  cursor: libclang.Cursor,
  callback: (child: libclang.Cursor) => void
): void {
  const children = cursor.getChildren();
  for (const child of children) {
    callback(child);
  }
}
