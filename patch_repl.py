from pathlib import Path

from frida_tools import repl

path = Path(repl.__file__)
src = path.read_text(encoding="utf-8")

old = "return sorted(filter(self._is_valid_name, set(names)))"
new = (
    "return sorted(filter(self._is_valid_name, set(names)), "
    "key=lambda n: (n.startswith('_'), n.startswith('__'), n.lower()))"
)

if new in src:
    print(f"already patched: {path}")
elif old in src:
    path.write_text(src.replace(old, new), encoding="utf-8")
    print(f"patched: {path}")
else:
    raise SystemExit(f"target line not found in {path} — frida-tools version changed?")
