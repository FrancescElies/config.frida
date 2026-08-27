#!/usr/bin/env node

/**
 * Dynamic Function Tracer using Frida
 * Traces function calls based on parsed C/C++ headers
 *
 * Usage:
 * npx tsx tracer.ts <process_name_or_pid> <header_file>
 *
 * Example:
 * npx tsx tracer.ts safari ./WebKit.h
 */

import * as frida from "frida";
import * as fs from "fs";
import * as path from "path";
import { parseHeader, ParsedHeader, ParsedFunction } from "./parser-index.js";

// ============================================================================
// Type Definitions
// ============================================================================

interface TraceConfig {
  processIdentifier: string;
  headerPath: string;
  verbose: boolean;
  outputFile?: string;
}

interface TraceEntry {
  timestamp: number;
  type: "call" | "return" | "error";
  functionName: string;
  arguments?: Record<string, unknown>;
  returnValue?: unknown;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const TRACE_BUFFER: TraceEntry[] = [];
const MAX_BUFFER_SIZE = 10000;

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  if (process.argv.length < 4) {
    console.error(
      `Usage: ${path.basename(process.argv[1])} <process_name_or_pid> <header_file>`,
    );
    console.error("\nExamples:");
    console.error("  tsx tracer.ts safari ./WebKit.h");
    console.error("  tsx tracer.ts 1234 ./api.h");
    console.error('  tsx tracer.ts "Google Chrome" ./chrome.h');
    process.exit(1);
  }

  const config: TraceConfig = {
    processIdentifier: process.argv[2],
    headerPath: process.argv[3],
    verbose: process.argv.includes("--verbose"),
    outputFile: extractOption(process.argv, "--output"),
  };

  // Validate header file
  if (!fs.existsSync(config.headerPath)) {
    console.error(`Error: Header file not found: ${config.headerPath}`);
    process.exit(1);
  }

  try {
    await traceProcess(config);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

// ============================================================================
// Core Tracing Functions
// ============================================================================

/**
 * Start tracing a process based on parsed headers
 * @param config Trace configuration
 */
async function traceProcess(config: TraceConfig): Promise<void> {
  // Parse the header file
  console.log(`📖 Parsing header: ${config.headerPath}`);
  const headerData = parseHeader(config.headerPath);
  console.log(`   Found ${headerData.functions.length} functions`);

  if (headerData.functions.length === 0) {
    console.warn("⚠️  No functions found in header file");
    return;
  }

  // Get or attach to process
  console.log(`🔍 Finding process: ${config.processIdentifier}`);
  let device: frida.Device;
  let session: frida.Session;
  let process: frida.ProcessInfo | null = null;

  try {
    device = await frida.getLocalDevice();

    // Try to find process by name or PID
    const processes = await device.enumerateProcesses();
    const processId = parseInt(config.processIdentifier, 10);

    if (!isNaN(processId)) {
      // It's a PID
      process = processes.find((p) => p.pid === processId) || null;
    } else {
      // It's a process name (with partial matching)
      process =
        processes.find((p) =>
          p.name.toLowerCase().includes(config.processIdentifier.toLowerCase()),
        ) || null;
    }

    if (!process) {
      console.error(`Process not found: ${config.processIdentifier}`);
      console.error("\nAvailable processes:");
      processes.slice(0, 10).forEach((p) => {
        console.error(`  ${p.pid.toString().padEnd(6)} ${p.name}`);
      });
      process.exit(1);
    }

    console.log(`✅ Found process: ${process.name} (PID: ${process.pid})`);

    // Attach to process
    console.log(`📎 Attaching to process...`);
    session = await device.attach(process.pid);
    console.log(`✅ Attached successfully`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to attach: ${errorMsg}`);
    throw error;
  }

  try {
    // Create tracer script
    const script = await session.createScript(generateTracerScript(headerData));

    script.logHandler = handleLog;
    script.message.connect(handleMessage);

    await script.load();
    console.log(`🚀 Tracer started\n`);
    console.log("📊 Function Calls:");
    console.log("━".repeat(80));

    // Keep running until interrupted
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        console.log("\n\n📊 Trace Summary");
        console.log("━".repeat(80));
        printTraceSummary(TRACE_BUFFER);
        resolve();
      });
    });
  } finally {
    await session.detach();
    console.log("✅ Detached from process");

    if (config.outputFile) {
      saveTraceToFile(TRACE_BUFFER, config.outputFile);
    }
  }
}

// ============================================================================
// Frida Script Generation
// ============================================================================

/**
 * Generate a Frida script to trace the parsed functions
 * @param headerData Parsed header information
 * @returns Frida script code
 */
function generateTracerScript(headerData: ParsedHeader): string {
  const functionNames = headerData.functions
    .map((f) => `'${f.name}'`)
    .join(", ");

  return `
// Automatically generated Frida tracing script
const functionNames = [${functionNames}];
const tracedFunctions = {};

// Hook each function
functionNames.forEach(name => {
  try {
    const address = Module.findExportByName(null, name);
    if (!address) {
      console.log("[-] Function not found: " + name);
      return;
    }

    const func = new NativeFunction(address, 'pointer', []);
    
    Interceptor.attach(address, {
      onEnter: function(args) {
        send({
          type: 'call',
          function: name,
          threadId: this.threadId,
          timestamp: Date.now()
        });
      },
      onLeave: function(retval) {
        send({
          type: 'return',
          function: name,
          retval: retval.toString(),
          threadId: this.threadId,
          timestamp: Date.now()
        });
      }
    });

    console.log("[+] Hooked: " + name);
  } catch (e) {
    console.log("[-] Error hooking " + name + ": " + e.message);
  }
});
`;
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Handle messages from Frida script
 * @param message Message from script
 * @param data Associated data
 */
function handleMessage(message: frida.MessageType, data: Buffer | null): void {
  if (message.type === "send") {
    const payload = message.payload as Record<string, unknown>;

    const entry: TraceEntry = {
      timestamp: (payload.timestamp as number) || Date.now(),
      type: (payload.type as "call" | "return") || "call",
      functionName: (payload.function as string) || "unknown",
    };

    if (payload.type === "call") {
      console.log(
        `  → ${entry.functionName.padEnd(40)} [${new Date(entry.timestamp).toISOString()}]`,
      );
    } else if (payload.type === "return") {
      console.log(
        `  ← ${entry.functionName.padEnd(40)} (retval: ${payload.retval})`,
      );
    }

    TRACE_BUFFER.push(entry);

    if (TRACE_BUFFER.length > MAX_BUFFER_SIZE) {
      TRACE_BUFFER.shift(); // Keep buffer size manageable
    }
  }
}

/**
 * Handle log messages from Frida script
 * @param level Log level
 * @param message Log message
 */
function handleLog(level: frida.LogLevel, message: string): void {
  const levelStr =
    {
      0: "[D]",
      1: "[I]",
      2: "[W]",
      3: "[E]",
    }[level] || "[?]";

  console.log(`${levelStr} ${message}`);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Extract option value from arguments
 * @param args Command line arguments
 * @param option Option name (e.g., '--output')
 * @returns Option value or undefined
 */
function extractOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
}

/**
 * Print trace summary
 * @param traces Array of trace entries
 */
function printTraceSummary(traces: TraceEntry[]): void {
  const functionStats = new Map<string, { calls: number; returns: number }>();

  for (const trace of traces) {
    if (!functionStats.has(trace.functionName)) {
      functionStats.set(trace.functionName, { calls: 0, returns: 0 });
    }

    const stats = functionStats.get(trace.functionName)!;
    if (trace.type === "call") {
      stats.calls++;
    } else {
      stats.returns++;
    }
  }

  // Sort by call count
  const sorted = Array.from(functionStats.entries()).sort(
    (a, b) => b[1].calls - a[1].calls,
  );

  console.log("\nFunction Call Statistics:");
  console.log("━".repeat(60));
  console.log("Function Name".padEnd(40) + " Calls".padEnd(10) + "Returns");
  console.log("━".repeat(60));

  for (const [name, stats] of sorted) {
    console.log(
      name.padEnd(40) +
        stats.calls.toString().padEnd(10) +
        stats.returns.toString(),
    );
  }

  console.log("━".repeat(60));
  console.log(`Total traces captured: ${traces.length}`);
}

/**
 * Save trace to file
 * @param traces Array of trace entries
 * @param filepath Output file path
 */
function saveTraceToFile(traces: TraceEntry[], filepath: string): void {
  fs.writeFileSync(filepath, JSON.stringify(traces, null, 2));
  console.log(`\n💾 Trace saved to: ${filepath}`);
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
