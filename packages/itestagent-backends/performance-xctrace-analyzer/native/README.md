# Xcode memory preflight helper

This experimental helper performs read-only host inspection. It never launches
Xcode, requests Accessibility trust, opens projects, reads window contents,
attaches a debugger, or operates a device. It is not a capture backend.

Build with the selected Xcode toolchain (output and module cache outside source):

```sh
xcrun swiftc -module-cache-path /tmp/itestagent-swift-cache \
  packages/itestagent-backends/performance-xctrace-analyzer/native/itestagent-xcode-memory-helper.swift \
  -o /tmp/itestagent-xcode-memory-helper
```

Pass an explicit Xcode application bundle path as the sole argument. The internal
TypeScript adapter supplies the five-second transport deadline, validates exactly
one bounded JSON response, and returns stable reasons without raw diagnostics.
The helper sets a two-second Accessibility messaging timeout. Invoke it through
that adapter when checking a running Xcode instance.

`eligible` means only that the inspected host has Accessibility trust, a valid
Xcode bundle, and no running Xcode instance. It does not verify an OS/Xcode support
matrix, a device, a build, or capture readiness. Any existing Xcode instance is a
conflict, even without windows. Missing trust returns `accessibility_unavailable`
without prompting. Raw target identifiers are not passed to the helper.

The temporary build is for development verification only. Stable installation,
helper identity/signing, permission onboarding, capture operations and packaging
remain separate work. Do not request user trust for an ephemeral binary as a
substitute for that work.

## Fixed development installation

The internal `installMemoryHelper` API accepts an explicit absolute installation
root and Xcode bundle path. The approved local location is
`~/.itestagent/helpers/xcode-memory`, containing `iTestAgentMemoryHelper.app` and
`install.json`. It selects both compiler and macOS SDK from that Xcode, creates
an ad-hoc signed bundle, verifies it, reserves a new destination exclusively, and
writes the completion manifest last. Existing different or incomplete content
blocks installation. A failed publication can leave a partial destination;
subsequent calls reject it instead of overwriting or deleting it.

`resolveInstalledMemoryHelper` rechecks source/plist hashes, the complete bundle
file inventory and code signature. `preflightInstalledMemoryHelper` uses that
resolver before invoking the read-only helper. Matching installations are reused
without compiling or signing again. Integrity checks detect accidental changes;
ad-hoc signing does not establish a trusted distribution publisher or defend
against a malicious process running as the same user.

This fixed development identity still does not promise permission continuity
across rebuilt versions. Accessibility authorization is separate from installation.

## App launch transport (candidate 0.2.0)

`stageMemoryHelperCandidate` builds only into a new caller-selected review root;
existing roots are rejected. Manifest schema 2 additionally binds launcher source
and executable hashes. The old fixed installation is intentionally incompatible
with the new source resolver until a reviewed upgrade; it is never overwritten.

`preflightMemoryApp` verifies the candidate, reserves a per-installation lease,
and creates a private, unpredictable request directory. The native launcher uses
public NSWorkspace to launch a new exact App instance. Result-file mode binds the
helper response to that request and uses exclusive, no-follow file creation.
The original stdout invocation remains supported for diagnostics.

The parent keeps a stdin lifetime pipe open. EOF, SIGTERM or a deadline asks the
launcher to stop only its returned NSRunningApplication and verify termination.
A process that already exited before the launch callback is recorded explicitly;
its invalidated PID is not reused. Failure to establish cleanup retains the lease
and request directory, blocks automatic retry and never accepts a result.
SIGKILL of the launcher or an OS crash still requires recovery inspection.

The transport does not infer readiness from launch success, a file's existence,
or launcher exit alone. No Xcode operations, capture, device actions, or permission
prompts are implemented. An App launch is used because direct child invocation
was not trusted in the verified environment; this is not a universal TCC guarantee.

Opt-in host tests compile only a disposable no-AX fixture and staged candidate:

```sh
ITESTAGENT_NATIVE_LAUNCH_TEST=1 bun test packages/itestagent-backends/performance-xctrace-analyzer/test
```

They exercise normal exit, cancellation after a written result, timeout,
existing-instance isolation, lifetime-pipe disconnection and result-file protection.
