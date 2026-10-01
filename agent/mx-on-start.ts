import { MX } from "./mx.js";
import { log } from "./logger.js";

log("# loaded:  on-start");

export function myTraceObjectNotify() {
  log("called: myTraceObjectNotify");
  MX.traceObjectNotify({
    classFilter: (cls) => {
      let ignore = new Set<string>([
        "atomarray", "button", "comment", "dsp_gen_singleton", "fpic", "gate", "incdec", "inlet",
        "jsmaxobj", "linklist", "message", "newobj", "number", "outlet", "panel", "string", "toggle",
        "ubutton", "umenu", "v8_dispatch_event", "tab",
      ]);
      const ignore_prefixes = [
        "dictionary", "pict", "xmltree", "text", "live", "hashtab", "json", "jdata",
      ];
      const ignore_containing = [
        "slider", "midi", // 'patcher'
      ];
      return (
        cls.startsWith("") &&
        !ignore.has(cls) &&
        !ignore_prefixes.some((prefix) => cls.startsWith(prefix)) &&
        !ignore_containing.some((it) => cls.includes(it))
      );
    },
    symFilter: (s) => {
      let ignore = new Set<string>([
        "attr_modified", "button_activated", "connectionschanged", "loadbang_internal",
        "loadbang_internal", "loadbang_loadbang", "loadbang_start", "update_attributes",
      ]);
      return s.startsWith("") && !ignore.has(s);
    },
    varnameFilter: (s) => {
      let ignore = new Set<string>([
        // "(null)",
      ]);
      return s.startsWith("") && !ignore.has(s);
    },
  });
}

export function run() {
  myTraceObjectNotify();
}

Object.assign(globalThis as any, {
  MX: MX,
});
