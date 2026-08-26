// This file will be hot reloaded
import { Toolkit as T } from "./toolkit.js";

Object.assign(globalThis as any, {
  A: T.Analysis,
  C: T.Crypto,
  D: T.Debugging,
  H: T.Hooking,
  N: T.Network,
  P: T.Probe,
  Help: T.Help,
});

console.log(`
╔══════════════════════════════════════════════╗
║   Frida toolkit loaded – Help() for usage    ║
╚══════════════════════════════════════════════╝
`);
