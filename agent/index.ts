// This file will be hot reloaded
import { Toolkit as T } from "./toolkit.js";

Object.assign(globalThis as any, {
  U: T.Utilities,
  H: T.Hooking,
  A: T.Aanalysis,
  D: T.Debugging,
  B: T.Behavior,
  N: T.Network,
  E: T.Export,
  I: T.Introspection,
  S: T.Stealth,
  C: T.Crypto,
  Help: T.Help,
});

console.log(`
╔══════════════════════════════════════════════╗
║   Frida toolkit loaded – Help() for usage    ║
╚══════════════════════════════════════════════╝
`);
