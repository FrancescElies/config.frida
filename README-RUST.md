
# Rust Tracing and Command Cheat Sheet

Frida has no special `--include-rust-func` switch. Rust code is native code from Frida's perspective.

C functions are often easy to locate because they use simple exported names. Rust functions may be:

- Rust-mangled
- Non-exported
- Stripped
- Inlined
- Monomorphized into multiple instances
- Removed by optimization or linker garbage collection

The main approaches are:

- `-s`: Match debug symbols
- `-i`: Match exported or otherwise discoverable symbols
- `-a`: Trace a function by module-relative address

Check the options supported by the installed version:

```nu
frida-trace --help
```

## Trace Rust Functions

### 1. Trace Using Debug Symbols with `-s`

This is usually the best option when debug information is available:

```nu
frida-trace -f ./target/debug/myapp -s '*my_crate::some_module::some_function*'
```

Attach to an existing process:

```nu
let pid = pidof myapp | get 0
frida-trace -p $pid -s '*my_crate::some_module::some_function*'
```

For release builds, retain debug information:

```toml
[profile.release]
debug = true
strip = false
```

Build and trace:

```nu
cargo build --release
frida-trace -f ./target/release/myapp -s '*my_crate::*'
```

Debug information does not guarantee that every function remains separately traceable. Optimized functions may be inlined, merged, or removed.

For a reliable test target:

```rust
#[inline(never)]
fn target_function() {
    // ...
}
```

### 2. Trace Exported or Discoverable Symbols with `-i`

Search for demangled Rust symbols:

```nu
nm -anC ./target/debug/myapp | rg 'my_crate|function_name'
```

Search for raw Rust-mangled names:

```nu
nm -an ./target/debug/myapp | rg '_RNv|_ZN'
```

Trace using a mangled-name fragment:

```nu
frida-trace -f ./target/debug/myapp -i '*_RNv*function_name*'
```

Use a module-qualified pattern when several modules contain similar names:

```nu
frida-trace -f ./target/debug/myapp -i 'myapp!*function_name*'
```

The module name must match the name reported by Frida. If a module-qualified pattern does not match, inspect the loaded modules with a Frida script or check Frida's output.

### 3. Trace a Non-Exported Function by Offset with `-a`

If the function has no usable name, find its address using a debugger, disassembler, symbol table, or map file.

For a symbol that is still present:

```nu
nm -anC ./target/debug/myapp | rg 'my_crate::some_module::some_function'
```

Trace by module-relative offset:

```nu
frida-trace -f ./target/debug/myapp -a 'myapp!0x123456'
```

For a shared library:

```nu
let pid = pidof myapp | get 0
frida-trace -p $pid -a 'libmycrate.so!0x4793c'
```

The value after `!` is a module-relative offset, not necessarily an absolute process address.

If a debugger provides a runtime address:

```text
module offset = target runtime address - module runtime base
```

For position-independent executables and shared libraries, make sure the address is converted to the correct relative virtual address. Do not blindly subtract the runtime base from an arbitrary static address unless both addresses use compatible bases.

### 4. Expose a Stable Trace Target in Rust

For Rust 2021 or earlier:

```rust
#[no_mangle]
pub extern "C" fn trace_me() {
    // ...
}
```

For Rust 2024:

```rust
#[unsafe(no_mangle)]
pub extern "C" fn trace_me() {
    // ...
}
```

For a test target, also prevent inlining:

```rust
#[unsafe(no_mangle)]
#[inline(never)]
pub extern "C" fn trace_me() {
    // ...
}
```

Verify that the symbol exists:

```nu
nm -an ./target/debug/myapp | rg 'trace_me'
```

Trace it:

```nu
frida-trace -f ./target/debug/myapp -i 'trace_me'
```

A `pub extern "C"` function is not automatically exported from every type of binary or platform. For shared libraries, verify the library's export visibility and linker configuration.

## Rust-Specific Gotchas

### Inlining Can Remove the Separate Function

For testing:

```rust
#[inline(never)]
fn target_function() {
    // ...
}
```

An optimized function may be unavailable as a distinct trace target if it is removed, folded, or eliminated by the linker.

### Generic Functions Have Multiple Monomorphizations

A generic function can produce multiple machine-code instances:

```rust
fn parse<T>(value: T) {
    // ...
}
```

Search broadly:

```nu
nm -anC ./target/release/myapp | rg 'parse'
```

Different instantiations may have different mangled names. You may need to trace several symbols or trace a lower-level non-generic function instead.

### Stripped Binaries May Have No Usable Names

If symbols have been stripped, use an address or offset:

```nu
frida-trace -p PID -a 'myapp!0xOFFSET'
```

If the function was inlined, there may not be a standalone address to trace.

### Rust Symbols Are Mangled

Use a demangling tool when needed:

```nu
rustfilt
```

For example:

```nu
nm -an ./target/debug/myapp | rustfilt | rg 'my_crate::'
```

`nm -anC` may already demangle some Rust symbols, but `rustfilt` is useful for raw Rust v0 and legacy mangled names.

### Symbol-Table Presence Does Not Guarantee Runtime Traceability

A name may appear in a binary while the function:

- Has been optimized into another function
- Is an alias or thunk
- Is never reached
- Has an address that differs from the expected code location
- Has been removed or changed by a later build step

Confirm that the generated handler is installed and that the function is actually executed.

## Installing and Checking Frida

Install or upgrade the command-line tools:

```nu
python -m pip install -U frida-tools
```

Check versions:

```nu
frida --version
frida-trace --version
```

The Python bindings and `frida-tools` should generally be compatible. If using a remote device, also ensure that the device-side `frida-server` version is compatible with the client.

## Devices

List available devices:

```nu
frida-ls-devices
```

List USB devices and processes:

```nu
frida-ps -U
```

Connect to a remote Frida server:

```nu
frida-ps -H 127.0.0.1:27042
```

## List Processes

List local processes:

```nu
frida-ps
```

List USB-device processes:

```nu
frida-ps -U
```

List Android applications:

```nu
frida-ps -Uai
```

Search Android packages:

```nu
frida-ps -Uai | rg 'chrome'
```

## Attach an Interactive REPL

Attach by process name:

```nu
frida -n myapp
```

Attach by PID:

```nu
frida -p 1234
```

Attach to an Android application by name:

```nu
frida -U -n com.example.app
```

Spawn an Android application:

```nu
frida -U -f com.example.app
```

Spawn and load a script:

```nu
frida -U -f com.example.app -l agent.js
```

## Trace Exported Native Functions

Trace common libc functions:

```nu
frida-trace -p PID -i 'open' -i 'read' -i 'write'
```

Use a wildcard:

```nu
frida-trace -p PID -i '*open*'
```

Restrict a match to a module:

```nu
frida-trace -p PID -i 'libc.so!*open*'
```

Decorate output with the module name:

```nu
frida-trace -p PID --decorate -i '*open*'
```

Library names differ by operating system. Examples include `libc.so`, `libSystem.B.dylib`, and Windows DLL names.

## Trace a Module

Include functions from a module:

```nu
frida-trace -p PID -I 'libssl.so'
```

Exclude noisy functions:

```nu
frida-trace -p PID -I 'libssl.so' -x '*free*' -x '*malloc*'
```

Exclude a module from a broader trace:

```nu
frida-trace -p PID -i '*open*' -X 'libc.so'
```

Include and exclude behavior can vary by Frida Tools version and matcher type. Do not rely on include/exclude ordering. Verify behavior with:

```nu
frida-trace --help
```

## Trace Imports

Trace imported functions:

```nu
frida-trace -p PID -T '*'
```

Restrict imported-function tracing to a module when supported by the installed version:

```nu
frida-trace -p PID -T 'libfoo.so'
```

The precise meaning and accepted pattern syntax for `-T` and `-t` can vary between Frida Tools versions. Check:

```nu
frida-trace --help
```

## Trace an Unexported Function by Offset

```nu
frida-trace -p PID -a 'libfoo.so!0x1234'
```

Example for an internal Rust function:

```nu
frida-trace -p PID -a 'myapp!0x8f240'
```

For a spawned process:

```nu
frida-trace -f ./target/debug/myapp -a 'myapp!0x8f240'
```

The module must be loaded when Frida resolves the address. For a library loaded later, attach after it has loaded or use a custom script that waits for the module.

## Trace Debug Symbols

Trace a Rust function using debug-symbol matching:

```nu
frida-trace -p PID -s '*my_crate::module::function*'
```

Trace a broad set of symbols:

```nu
frida-trace -p PID -s '*my_crate::*'
```

Broad patterns can generate many handlers and substantial output.

## Android Java Tracing

Trace Java methods containing `certificate`:

```nu
frida-trace -U -f com.example.app -j '*!*certificate*/isu'
```

Trace all methods in a class:

```nu
frida-trace -U -f com.example.app -j 'com.example.Foo!*'
```

Trace JNI-style native exports:

```nu
frida-trace -U -f com.example.app -i 'Java_*'
```

Java matching syntax is version-sensitive. If a pattern does not match, check:

```nu
frida-trace --help
```

Then confirm the class and method names from the running application.

## Objective-C Tracing

Trace one Objective-C method:

```nu
frida-trace -U -f com.example.iosapp -m '-[ClassName methodName:]'
```

Trace methods on a class:

```nu
frida-trace -U -f com.example.iosapp -m '*[NSURLSession *]'
```

Very broad Objective-C patterns can generate many handlers.

## Swift Tracing

Trace Swift functions by name pattern:

```nu
frida-trace -U -f com.example.iosapp -y '*ModuleName*functionName*'
```

Swift symbols may be mangled, optimized, or stripped. When necessary, inspect symbols with platform tools and use an address-based trace.

## Save Generated Handlers

Create a directory for generated handlers:

```nu
mkdir handlers
```

Generate handlers in that directory:

```nu
cd handlers
frida-trace -p PID -i '*open*'
```

Alternatively:

```nu
mkdir handlers; cd handlers; frida-trace -p PID -i '*open*'
```

Frida generates JavaScript handler files that can be edited and reused.

A reproducible approach is to run `frida-trace` from a project directory and keep the generated handlers under version control.

## Load Initialization Code

Some Frida Tools versions support an initialization script option:

```nu
frida-trace -p PID -i '*open*' -S init.js
```

Because the exact meaning of `-S` is version-sensitive, verify it locally:

```nu
frida-trace --help
```

If unsupported, use a custom Frida script with `frida` and load the shared initialization logic there.

## Pass JSON Parameters

Where supported by the installed version:

```nu
frida-trace -p PID -i '*open*' -P '{"verbose":true}'
```

Check the local option name and accepted format:

```nu
frida-trace --help
```

## Write Output to a File

Write trace output directly to a file:

```nu
frida-trace -p PID -i '*open*' -o trace.log
```

Write to the terminal and a file:

```nu
frida-trace -p PID -i '*open*' | save trace.log
```

To append instead of overwrite:

```nu
frida-trace -p PID -i '*open*' | save --append trace.log
```

## Discover Potential Targets

Search for potentially interesting functions:

```nu
frida-discover -p PID
```

USB device:

```nu
frida-discover -U -f com.example.app
```

Discovery results are suggestions. They do not guarantee that every function is separately traceable.

## Terminate a Process

Terminate by PID:

```nu
frida-kill -p PID
```

Check Android-specific syntax:

```nu
frida-kill --help
```

If necessary, find the process ID first:

```nu
frida-ps -U | rg 'com.example.app'
```

Store the PID in Nushell:

```nu
let pid = frida-ps -U | lines | where $it =~ 'com.example.app' | first | split row ' ' | where $it != '' | first
```

Then terminate it:

```nu
frida-kill -U -p $pid
```

## Minimal Rust Workflow

Build the application:

```nu
cargo build
```

Search for the target using demangled names:

```nu
nm -anC target/debug/myapp | rg 'my_crate::thing_i_care_about'
```

Try debug-symbol tracing:

```nu
frida-trace -f ./target/debug/myapp -s '*my_crate::thing_i_care_about*'
```

If `-s` does not find it, inspect raw symbols:

```nu
nm -an target/debug/myapp | rg '_RNv|_ZN'
```

Then try an exported or discoverable symbol:

```nu
frida-trace -f ./target/debug/myapp -i '*mangled_piece_here*'
```

If the function has no usable name, obtain its module-relative offset from a debugger or disassembler:

```nu
frida-trace -f ./target/debug/myapp -a 'myapp!0xOFFSET'
```

For the most reliable test, mark the target function as exported and non-inlined:

```rust
#[unsafe(no_mangle)]
#[inline(never)]
pub extern "C" fn trace_me() {
}
```

Verify and trace it:

```nu
nm -an target/debug/myapp | rg 'trace_me'
```

```nu
frida-trace -f ./target/debug/myapp -i 'trace_me'
```


## Practical Troubleshooting Order

1. Build a debug version with symbols.
2. Add `#[inline(never)]` to the target function.
3. Search for the function with `nm -anC`.
4. Try `frida-trace -s`.
5. Try `frida-trace -i` with a mangled-name fragment.
6. If the function is unnamed or stripped, calculate its module-relative offset and use `-a`.
7. If no standalone function exists, trace a caller, callee, exported wrapper, or lower-level operation instead.

## Quick Reference

```nu
cargo build
nm -anC target/debug/myapp | rg 'my_crate::function_name'
frida-trace -f ./target/debug/myapp -s '*my_crate::function_name*'
frida-trace -f ./target/debug/myapp -i '*mangled_name_fragment*'
frida-trace -f ./target/debug/myapp -a 'myapp!0xOFFSET'
frida-trace -p PID -i '*open*'
frida-trace -p PID -I 'libssl.so'
frida-trace -U -f com.example.app -l agent.js
frida-ps -Uai
frida-ls-devices
frida-trace --help
```
````_
