# Xcode memory preflight helper

## Read-only Xcode metadata (ADR-048)

`itestagent-memory-xcode-metadata.swift` constructs only fixed public get-data
events for document paths/modified flags and workspace/scheme/destination metadata.
The adapter accepts an owned App handle, uses bounded no-prompt/never-interact
sends, and rejects malformed, incomplete, oversized or changing observations.
Empty documents are an observation, not a cleanup or physical identity proof.
Raw metadata remains in memory. The fixed production helper still has no resource
provider; this module is not implicitly activated by its no-target profile.

Absolute ordinals are constructed using `AECreateDesc` with a native `OSType`;
literal ASCII bytes do not encode the same descriptor on this host. Diagnostics
freeze the first failure and expose only fixed query/failure enums, descriptor
type, bounded item counts and OSStatus. They never expose reply/error text or
document/device identifiers. The first real empty-Xcode probe failed before this
encoding fix; the corrected candidate still requires its own live verification.

The handle's `canObserve` permits read-only cleanup observations while the original
owner is acquired or closing within its deadline. `isCurrent` remains required for
query commands and grants. Transport loss now observes asynchronous provider
cleanup for at most five seconds; unknown cleanup cannot authorize helper exit or
lease release. Late result callbacks cannot resurrect the failed transport.

`test/memory-metadata-probe-app.swift` is a separate diagnostic candidate. Its
explicit authorize mode requests Automation permission on a background thread;
normal reads never prompt. It opens no project or device, and requests normal
Xcode termination only after repeated empty document inventory checks. Uncertain
cleanup retains the probe for intervention. It is not production capture evidence.

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

## Fixed debugger identity query (B candidate)

`itestagent_memory_identity.py` reads only public LLDB process metadata. The
internal TypeScript command builder accepts a request UUID, never arbitrary
script input. The parser rejects stale/ambiguous responses and additional data.
Process instance IDs are scoped to the debugger; they are not OS birth times
or independent device/build verification. No Xcode AX transport is wired yet.

The opt-in `ITESTAGENT_NATIVE_IDENTITY_TEST=1` test compiles a temporary macOS
executable and launches two owned stopped processes under isolated LLDB with
user initialization disabled. It verifies stable identity within an instance,
changed identity after relaunch, refusal after exit, the actual top-level fixed
console commands and cleanup. It never starts Xcode App or a device session.
The fixed installed helper remains unchanged and does not expose this query.

## Read-only AX capability module (B candidate)

`itestagent-memory-ax-capabilities.swift` inspects a caller-selected current
AX element through public role, value-settable and action-name APIs. It reads no
console value, title or device evidence and exposes no mutation operation.
Results contain only fixed booleans/counts; an advertised Confirm/Press never
sets `submissionVerified`. Failed queries are distinct from a successful empty
action list. Metadata limits, a monotonic deadline, per-message timeout and
cancellation/context rechecks discard stale or incomplete observations.

The caller must provide actual owner/window/selection continuity validation.
This callback is not implemented by a PID check, and no production session uses
this module yet. It is compiled by the macOS native fixture, not included in the
fixed helper installer or App transport. The fixture covers failure and stale
context paths plus a public API call against a nonexistent process; it neither
requests trust nor accesses Xcode. This is not live Xcode AX compatibility proof.

## AX context candidate (B)

`itestagent-memory-ax-context.swift` resolves a focused text-area candidate in a
unique Debug Area of one exact project window. Its bounded public AX traversal
rejects extra windows, sheets, cycles, excessive depth/children, missing metadata,
wrong documents, cancellation and changing context. Capability reads re-resolve
the context before and after each read; results never prove console submission.
No titles, console values or persisted numeric node IDs are used.

The public reader requires the NSRunningApplication returned by a future owned
launch driver and compares instances using isEqual, not PID alone. Initial
absence, global lease and owned launch/teardown remain unimplemented integration
prerequisites. NSRunningApplication's changing properties require main run-loop
progress between observations; synchronous checks are not an intervention monitor.
The current native fixture covers conflict/budget/drift and capability binding;
it does not start Xcode or verify the candidate AX mapping on a live session.
This source remains outside the fixed helper packaging and transport.

## Owned App lifecycle (B)

`itestagent-memory-owned-app.swift` provides a single-launch lifecycle and a main
run-loop driver, using public NSWorkspace with new-instance/no-substitution
options. It rejects existing or changed instances, retains the callback's App,
waits for late callbacks during cancellation, and requests normal termination
at most once after a caller-supplied window/resource proof. No force termination
is available. Callback/exit uncertainty returns unverified cleanup; the enclosing
session must retain its global lease. A terminal late callback cannot restart work.

The run-loop driver retains itself until a terminal result and yields between
timer observations. `acquired` means only App ownership, not target/capture readiness.
App exit alone does not prove debugger/AUT cleanup. Actual Xcode close-proof,
project/debugging operations, parent EOF/SIGTERM, global lease and fixed helper
transport integration remain outstanding. Do not use the preflight launcher's
force-termination policy for a session that owns Xcode resources.

The `ITESTAGENT_NATIVE_LAUNCH_TEST=1` lifecycle fixture launches only disposable
prohibited-UI Apps with a 15-second lifetime. Real normal and cancelled launches,
conflict isolation, main-loop progress and absent processes are verified; injected
negative cases cover unknown windows, changed owners, refused exit and missing or
late callbacks. It never opens Xcode or grants Accessibility permission.

## Parent lifetime and App-only lease integration (B)

`itestagent-memory-parent-lifetime.swift` connects stdin EOF, unexpected input,
invalid streams, SIGTERM and SIGINT to driver cancellation on the main queue.
It accepts pipe/socket lifetime streams without data commands, checks early EOF,
uses an owned close-on-exec descriptor, and restores signal dispositions after
terminal cleanup. Keep one monitor per dedicated helper through its terminal event.
Premature monitor release cancels the driver; stopping the monitor proves no exit.

The internal TypeScript `runOwnedMemorySession` reserves the common Xcode lease,
validates a session-bound `owned_app_only` result and requires helper exit before
release. Failed transport, forced exit or unverified cleanup retains the lock.
This restricted runner must not create project/debugger/AUT resources. Full capture
needs additional cleanup proofs and a different full-session transport; the fixed
helper does not expose this mode yet. Native tests await the actual helper exit
and verify EOF/SIGTERM/SIGINT/early-EOF through App cleanup to lock release.

## Full capture cleanup gate

MemorySessionProtocol defaults to capture scope. A successful closed event requires
an internal complete cleanup result bound to its session and previously verified
full process identity: document closed and debugger/AUT/Xcode/helper exited.
Missing, unknown, stale or additional fields cannot set cleanupVerified or release
the lease. App-only transport explicitly selects owned_app_only and cannot enter
prepared/capturing/exported states. A boolean App-exit result is insufficient for
capture. Cancellation before independent target identity remains unverified.

These are completeness and binding checks, not independent observations. A future
full-session transport must derive every resource state from verified native cleanup
and await helper exit. No such live capture proof provider exists yet; do not fill
these fields from schema success, a disabled Stop button or an App exit alone.

## Selected process exit observation

The fixed `query_exit` observes eStateExited on the exact previously observed
SBProcess, rechecking debugger/instance/PID and state before returning. Missing
targets, live/restarted processes and errors remain unverifiable. It performs no
termination, detach, target expressions or memory reads. The TypeScript parser
binds a bounded response to both the request and prior metadata; the fixed command
accepts only validated identifiers, never arbitrary source.

Real isolated host LLDB tests correlate two exit observations with their prior
live identities and reject crossed generations, missing targets and live states.
A no-target top-level command validates the fixed command encoding as well.
Xcode owner continuity and physical target binding remain separate prerequisites.
This observation does not prove RPC/Xcode/helper exit or document closure and is
not automatically converted into a full capture cleanup proof.

## App inventory observation gaps

The owned App adapter distinguishes the matching instance, an empty inventory, and a conflicting instance. A launch callback can precede inventory registration. Launching or closing sessions may wait through an empty inventory only within their existing deadlines, without publishing readiness or taking an action. After a successful termination request, the driver only observes exit and conflicting instances. It never resends termination. Only the original application's `isTerminated` observation proves exit; absence and timeout retain unverified cleanup. An acquired instance disappearing before close still blocks. The native fixture covers these transitions and emits bounded fixed-state diagnostics only on failure. This does not prove Xcode document/debugger/AUT cleanup.

## Short console ACK probe

The internal TypeScript module provides a fixed `script print(...)` ACK command and strict request-bound parser. It does not access LLDB targets. An ACK is transport evidence only, never process identity, capture readiness, or cleanup proof. The real LLDB fixture exercises it before creating any target. A bounded CUA host probe has verified a short ACK and fixed-file identity query in Xcode. Independent native submission and response collection remain unverified; CUA and generic AppKit behavior cannot establish them.

## Experimental compact query encoding

`memoryCompactIdentityConsoleCommand` uses zlib/base64 to carry the exact shipped Python source. Tests verify byte equality and identical metadata from the original and compact commands in one real LLDB process. The original command remains available. A 1803-character compact query did not produce a verified response in the bounded Xcode host probe, despite a successful short ACK. This encoding is an experimental comparison candidate, not a proven Xcode fix or production default. No caller-supplied source or path is accepted.

## Native fixed script preparation

`itestagent-memory-identity-script.swift` prepares a request-bound command from the
fixed `Contents/Resources/itestagent_memory_identity.py` App resource. It pins the
shipped source digest, reads at most 16 KiB, rejects links and non-regular files,
and fingerprints the opened resource before and after reading. Nonblocking open
avoids a substituted FIFO stall. UUIDs are canonical lowercase; path quoting is
verified by executing the Swift-generated command in real, targetless LLDB.

Preparation checks cancellation, deadline and current ownership around reads.
Retain the prepared value and call `validateSource()` again before accepting any
response; byte-identical file replacement is rejected by inode/fingerprint checks.
The 1024-byte command budget is not a proven Xcode limit. The resource check is not
an isolation boundary against malicious same-user modifications; installation
integrity and actual owner/process checks remain necessary. Source changes require
reviewing and updating the compiled digest together; the fixture checks shipped bytes.

This internal component does not submit commands, collect responses, or assert
readiness. It is not linked into the installed preflight helper or its installer
yet. Native UI transport, source revalidation at response acceptance, full-session
ownership/cleanup and physical binding are still required. No new permissions or
helper installation are part of this unit.

## Native incremental response receiver

`itestagent-memory-console-response.swift` captures a pre-submission output boundary
and polls an already resolved output element using public character-count/range APIs.
It does not read the entire AXValue, locate/adopt Xcode windows, request trust, write
text or submit a command. The focused input candidate is not an output locator.
Each read rechecks ownership, cancellation and deadline; native messaging is bounded
to 0.5 seconds. Reads and retained text are limited to 16384 UTF-16 units and 32768
UTF-8 bytes; individual candidate lines are limited to 8192 bytes.

Historical output, prior partial lines, echoes and other request IDs are ignored.
Partial responses and growing snapshots wait within the original deadline. CRLF
is split using UTF-16 semantics. Duplicates, invalid response envelopes, truncation,
limits, cancellation or drift close the receiver without retry. Source fingerprints
are revalidated before returning a local-only candidate, and buffers are cleared.

The candidate is not an identity event: it must pass the existing strict TypeScript
parser and independent target/owner checks before publication. Tests exercise this
boundary with synthetic data, including split Unicode/CRLF output and invalid PID
or request binding. A nonexistent native AX process fails closed. Actual Xcode
output-element selection and character-range support remain unverified. This unit
is not installed or linked into the preflight helper and adds no keyboard events.

## Native console pair locator

`itestagent-memory-console-location.swift` reuses the owned workspace/debug-area
context resolver and requires a unique focused `debug console` input and distinct
`Console` output via public AXDescription metadata. These English labels are
explicit candidates, not proof of native Xcode compatibility. Unknown/localized
labels, duplicates and out-of-area outputs fail closed; sibling order, coordinates
and numeric AX IDs are not used. The output must support character count and an
actual bounded range call, including a zero-length call for empty output.

After probing, the locator rechecks context and pair identity. The receiver factory
binds the source query and output element and re-resolves that pair during polling.
Cancellation/deadline expiration inside a context check retain their specific error
rather than being reported as ordinary drift. The existing document URL comparison
remains strict; path-alias compatibility is not implied.

Tests cover structural and range failures, drift, cancellation and deadlines using
a native fixture. Actual Xcode metadata/range behavior, native submission semantics,
launch/lease integration and full helper wiring are still unverified. This module
does not submit commands, request trust, install a helper or establish readiness.

## Controlled public AX submission

`itestagent-memory-console-submit.swift` consumes one prepared fixed query attempt.
It requires the exact empty `(lldb) ` prompt, an empty selection at its end, settable
AXSelectedText, and an explicitly advertised AXConfirm action. AXValue writability,
AXPress and CUA Return observations do not satisfy this gate. It inserts only the
fixed command at the selection, rechecks input/selection/capabilities/source/context,
and requests AXConfirm once. It never moves focus, clears existing text, retries,
or falls back to keyboard events. Attempt flags are recorded before mutations.

The exchange captures the output boundary before insertion and connects the paired
input/output adapters to the receiver. Failed or completed exchanges cannot resume.
An AX success is not execution evidence, and a response candidate still needs the
strict semantic parser plus independent owner/target/build binding. Cancellation
after insertion stops further actions; it does not erase possibly modified input.

Native fixtures exercise the state machine and ambiguous failures without real UI
actions. Actual Xcode selected-text/confirm support and prompt representation remain
unverified; unsupported controls must block. The installed preflight helper and its
permissions are unchanged. Packaging and live native host verification remain pending.

## Read-only application observation diagnostics

`itestagent-memory-app-observation.swift` separates missing/ambiguous instances,
PID mismatch, bundle mismatch, inactive and terminated states. Incomplete metadata
blocks access; optional checks encode unknown values by omission, not false.
All check results are retained alongside the primary fixed reason, so simultaneous
failures are visible. Only the original all-valid conjunction permits control reads.

The public adapter samples AppKit metadata on the main thread without launching,
activating, adopting or terminating Xcode. An eligible observation does not establish
ownership, target identity, submission support or capture readiness. Subsequent AX
operations still require their existing context checks. Synthetic tests exhaustively
cover 405 combinations and the diagnostic output whitelist. The real failing
observation has not been reproduced with this new diagnostic module.

A separate temporary 0.1.1 probe candidate includes the module, compiles and passes
signature verification; it is not installed or executed. The already authorized
0.1.0 probe remains unchanged. A replacement and another bounded host observation
require their own explicit scope; persistent AX trust is not authorization to upgrade.

## Bounded AX failure diagnostics

`itestagent-memory-ax-diagnostics.swift` records a single terminal failure using
closed stage, operation and cause enums. It accepts no raw exception description,
attribute name, window text, path or console value. AX error codes are limited to
the public SDK error range; progress and elapsed time are clamped. Once failed,
later checks cannot resume or overwrite the original failure.

Synthetic fixtures cover all 289 stage/operation pairs, preservation after later
errors, unknown error-code suppression, missing/type/context/deadline categories,
and pathological clock/counter inputs. These are diagnostic-policy tests, not
proof of Xcode's live AX behavior or of cancellation in a full capture session.

A temporary 0.1.2 read-only probe instruments window/document/tree/pair/focus,
settable/actions, prompt/selection/count/range and final context checks. Direct AX
calls now preserve numeric errors instead of collapsing them into false capability
flags. Unknown capability reads block the observation. The candidate is compiled
and signed but not installed or executed. Live stage coverage remains pending.

## Local project document binding

`itestagent-memory-local-document.swift` compares exact canonical directory paths
and retained filesystem identity rather than Foundation URL representation equality.
A missing trailing directory slash or a local symlink alias may denote the same
project. Remote hosts (including explicit localhost), credentials, query/fragment,
embedded NUL, missing paths and non-directories are rejected. No project contents
are read. A retained directory descriptor prevents replacement from inheriting the
identity merely by occupying the same path.

The bounded context locator creates this binding for each resolution and retains
it through its final document recheck; it does not promise continuity between
separate locator calls. The standalone probe retains its binding for its whole
single observation. Launch ownership, confirmed build/device binding and repeated
session checks are still separate requirements. This is not isolation against an
adversarial same-user filesystem writer.

Native fixtures now use private existing project directories and exercise no-slash
AX documents against directory URLs. Dedicated cases cover encoded names, aliases,
foreign URLs, files, missing paths and replacement. A signed temporary 0.1.3 probe
contains the fix but has not been installed or tested against Xcode. The installed
0.1.2 remains unchanged; real document matching and AX capabilities remain pending.

### Observed host capability boundary (2026-09-17)

The authorized 0.1.3 read-only probe completed on Xcode 26.5 with the existing
macOS fixture. Local document matching, input writability, empty prompt/caret and
output range reads passed. The input did not advertise AXConfirm. Consequently,
the existing submission gate must reject this control before inserting a command.
No write, confirmation or keyboard action was tested. Do not silently substitute
AXPress or keyboard events; a new submission approach needs an explicit decision
and bounded authorization. The host, debugger and Xcode exited normally, verified
independently. This observation does not complete native capture or physical G5.

### Explicit Return experiment (ADR-045, offline stage)

`itestagent-memory-console-return.swift` adds an explicitly constructed pidReturn
exchange. It shares fixed-query input/source guards with the existing AXConfirm
strategy and captures the response boundary before insertion. Missing AXConfirm
never selects this strategy automatically. Synthetic transports exercise permission,
input, source and context failures, cancellation, at-most-once down/up attempts and
response rejection. The public CGEvent adapter is compiled but never instantiated
by these tests; no GUI or keyboard event is generated.

After an attempted down, at most one up is attempted against the retained original
instance, including on cancellation. A missing original instance prevents release;
a void post never proves delivery (`releaseDeliveryVerified` remains false).
Matching output remains an untrusted candidate for the strict TypeScript parser.
The explicit factory retains directory identity across the exchange, but its caller
must still supply a genuine owned launch under the global lease. Production session
token/authorization integration, real event validation, atomicity risk assessment and
physical capture remain outstanding. This stage does not install or re-sign helpers.

### Internal query session and parent-loss latch

`itestagent-memory-query-session.swift` binds the fixed query and command digest to
an acquired `MemoryOwnedAppHandle` and an expiring in-memory one-shot grant. Handles
are minted by the owner session, become invalid on close/expiry, and cannot be
constructed from a PID. Failed prerequisites consume the grant. The explicit
owned-Return entry point uses the existing exchange and the parent's cancellation
latch; it does not select Return as an automatic fallback.

`MemoryParentLifetime.isCancelled` is lock-protected and becomes visible from a
private monitoring queue even while the main thread is inside a synchronous call.
Cleanup callbacks remain main-thread-only and at most once. The EOF reader cancels
itself to avoid repeated scheduling. Real anonymous-pipe loss, unexpected input,
SIGTERM and SIGINT are tested in disposable command-line children without AppKit
applications or events. In-flight system calls and PID/focus races are not atomic.

`src/xcode-memory-query-session.ts` requests a one-shot `interact_sensitive_ui`
decision through an injected upper-layer provider, freezes the request binding,
and strictly parses the native envelope and identity candidate. It does not import
Engine, accept remembered allow, release a capture lease, or mark a target verified.
This is internal wiring: production PermissionEngine/TUI integration, authenticated
helper IPC grant delivery, document/debugger/AUT cleanup and physical binding remain
separate work. The installed signed fixtures contain earlier source snapshots and
were not rebuilt or replaced by this offline change.

### ADR-046 offline query IPC and resource closure

The internal v3 query channel is separate from the read-only preflight launcher.
`itestagent-memory-query-ipc.swift` supplies bounded framing, ordered binding and
private Unix sockets with public UID/PID checks. `itestagent-memory-query-launcher.swift`
relays the single stdio reader, monitors cancellation, and never force-terminates
an owner. `itestagent-memory-query-app-launch.swift` is compile-only: its injected
manifest verifier and retained original NSRunningApplication must be checked before
launch and grant forwarding. Its worker dispatches owner checks to the main queue.
No executable entry point or default production route invokes it.

`itestagent-memory-query-ipc-grant.swift` binds a framed decision to the local
PreparedMemoryIdentityQuery and original owner. The IPC Return entry point uses
its own thread-safe cancellation latch; do not attach MemoryParentLifetime to the
same stdin. Permission material remains in memory and framed pipes/sockets, never
arguments, environment, diagnostics or files. EOF while the upper layer awaits a
PermissionEngine decision cancels that pending ask; uncertain grant delivery is
recorded as attempted and is never retried.

The TypeScript launcher adapter waits for its own child. The v3 resource ledger
accepts owner-local observations, not cleanup JSON: creation attempts become pending,
unknown observations retain the lease, and proof objects are exact-instance and
single-use. A physical identity additionally requires expected target matching and
all six resources closed. An uncreated debugger/AUT is distinct from an unknown one.
The old v2 path cannot release a lease after its v3 ledger becomes active.

Offline validation uses actual temporary command-line children, pipes, sockets and
SIGINT/SIGTERM with fake App owners and query output. The full performance package
and engine bridge passed 307 tests with 8 existing App/LLDB opt-ins skipped; final
native changes passed 2 targeted tests (57 assertions). AppKit adapters compile with
warnings as errors but are not run. Installed helper binaries remain unchanged.
Real helper/TUI composition, complete manifest verification, physical generation,
and Xcode/document/debugger/AUT exit observation sources remain separate work.
Neither a closed query frame nor these fake observations establish G5 completion.

### Offline composition and unsigned candidate

`xcode-memory-query-candidate.ts` stages a separate query helper/launcher and a
pinned 25-file manifest. It compiles but never signs, installs or executes the
candidate. Resolution requires independently verified signatures, a matching
reviewed manifest, exact inventory and safe paths. Native launch rechecks the
manifest and public code signature rather than trusting a JSON validity flag.
The old installed helper/installer is unchanged.

`MemoryQueryControl` is the sole parent pipe reader and starts before App launch.
It latches EOF/error/deadline on a worker while launch callbacks or the main queue
are delayed. `MemoryHelperQuerySession` drives socket framing on a worker and the
owned query provider on main. The candidate has no production resource provider:
it closes as unsupported without preparing a query or touching Xcode. The optional
owned provider composes the existing grant/Return session but requires genuine
closure observers. A transport error never licenses abandonment of resources.

The TS coordinator requests permission only at prepared, then uses the shared
strict parser. Its ledger records process creation attempts and the real launcher
exit; helper/downstream observations remain unknown until an independently
verified source exists. TUI injection uses the session's existing permission queue,
response API and disposal, with exactly one resolved event and pending cleanup.
No new user command or default capture route is enabled.

Validation: performance package plus engine bridge 315 pass / 8 existing opt-in
skip; TUI regression 97 pass. Native candidate and no-GUI fixtures compile with
warnings as errors. Fake providers exercise allow/deny/unsupported/missing closure,
not physical process identity or G5. See the composition plan for the candidate
manifest digest, logs and the remaining resource-observation gaps.

The query launcher now waits for both the original helper's observed exit and the
bridge completion callback before choosing its exit code. The main timer cannot
misclassify a successful closure merely because the helper exits before that queued
callback. A 32-state offline matrix and explicit reversed observation order cover
this boundary; deadlines still report failure rather than inventing exit evidence.
A separately staged ad-hoc-signed candidate is described in the lifecycle plan.
Signing and manifest verification are preparation only; App runtime checks remain
separately scoped and have not yet run.


The separately authorized signed candidate lifecycle checks subsequently passed:
one real NSWorkspace normal handshake/unsupported closure with zero query grants,
then one pre-launch stdin EOF with exit 2 and empty stderr. Independent post-run
process checks found no query helper/launcher residue; installed helper hashes were
unchanged. Both runtime allowances are consumed. These checks do not establish
physical identity, Xcode/debugger/AUT cleanup, capture readiness, or G5. The EOF
check does not independently measure transient helper creation or cancellation of
an already active App. See the lifecycle plan for precise evidence and limits.

### Experimental v4 no-target closure receipt

`stageMemoryNoTargetCandidate` compiles the reviewed no-provider entry with
`MEMORY_QUERY_CLOSURE_V4`; it does not sign, install, or execute it. The candidate
resolver pins the complete manifest, signatures, and reviewed source snapshot in
`xcode-memory-query-profile.ts`. Updating that snapshot requires source review.
The v3 resolver/entry remains separate and never negotiates v4.

The launcher annotates forwarded helper frames with its original launch instance
and manifest binding. After helper socket EOF and original-owner exit, it emits
one launcher-only closure receipt. Helper-role decoders reject that receipt.
`prepareMemoryNoTargetQuery` requires the resolver's one-use capability and verifies
the complete channel, EOF, and actual launcher exit before consuming the lease
proof. It releases only a normal session with no physical identity or downstream
creation history; cancellation and unknown closure retain the lease.

The v4 native App adapters are compile-tested only. The offline closure fixture
uses owned command-line processes and Unix sockets, without AppKit applications,
Xcode, devices, AX, or input events. This does not establish physical capture
readiness or production TUI support. See ADR-047 and its verification plan.

### Retained LLDB process observation

`itestagent_memory_owned_observation.py` is a separate, read-only source module.
Its owner session retains the original debugger, target and process wrappers for
one registration (at most 120 seconds and 128 request IDs). It never reselects a
target or discovers a process by PID. Invalid observations poison the registration;
release drops references without detaching, killing or deleting debugger targets.
The TypeScript wrapper validates correlation and state but cannot mint physical
identity, a process generation, or resource-closure proof. The shipped v4 candidate
does not load this module and its pinned source profile is unchanged.

The optional native test uses one isolated CLI LLDB and two self-exiting host
fixtures. It requires an explicit `ITESTAGENT_OWNED_OBSERVATION_TEST=1` and a fresh
`ITESTAGENT_OWNED_OBSERVATION_RESERVATION` path under `/private/tmp/`. A reservation
is exclusive and cannot be reused. Default tests never launch this debugger.

### Document session continuity observation

`itestagent-memory-document-session.swift` retains one directory binding, original
window reference and acquired Xcode owner for the entire observation session.
It reports `observed_open`, `window_unavailable`, `owner_exited` or `unknown`;
none is a cleanup capability. A missing or destroyed window never proves that an
NSDocument closed. The original owner's exit does not prove debugger/AUT exit.

The public read-only adapter checks complete bounded AX window snapshots, modal
state and document URLs. Its destruction watch runs on the main run loop and
invalidates further AX reads after the original element is destroyed. Retain the
watch with the session and release it on main. It never opens/closes documents,
launches/exits applications or sends input. The adapter is compile-tested only;
the fixture uses fake owners/windows with real temporary directory replacements.
The module remains outside the signed v4 candidate and production provider.

### Metadata launch timing diagnostics

The metadata transport requires the original Xcode owner to have finished
launching before sending a fixed query. The diagnostic App waits within its
existing 60-second owner deadline; this is not proof of Apple Events readiness.
Each send is capped at two seconds and the caller's absolute deadline. Initial
snapshot observation has an eight-second budget; cleanup rechecks have four
seconds within the owner's five-second cleanup limit. No query is retried.
First-failure diagnostics include only launch completion and bounded elapsed
milliseconds in addition to the existing fixed fields. Version 0.1.1 timed out
on its first documentPaths send; version 0.1.2 passed one empty-document host observation and owned shutdown.
Nonempty workspace metadata and production capture remain unverified.

The reader rejects unloaded workspaces before querying scheme or destination
properties, as required by Xcode's public dictionary. Diagnostic probe 0.1.3
adds an explicitly reviewed temporary-project mode via NSWorkspace open URLs.
It waits for a single loaded workspace within the existing deadline, validates
one unmodified directory-bound macOS workspace, and rechecks before normal
owner termination. It never builds or runs the project. One live attempt timed out on workspaceLoaded before a nonempty snapshot was
obtained. Authorized normal-Quit recovery completed; this mode remains
unverified and does not prove debugger/AUT identity or document-only closure.

Diagnostic candidate 0.1.4 separates startup from document loading: it first
checks an empty baseline, then opens the reviewed temporary project in the
same acquired Xcode instance and verifies the returned application identity.
Receipt v2 records monotonic sequence/timing and fixed per-query start/return/
failure events without metadata values. Transport return does not imply parsed
snapshot success. Budgets remain unchanged; failed queries are not retried.
After an open request, the earlier empty observation cannot authorize cleanup.
The staged 0.1.4 run passed the empty baseline and nonempty document/scheme
reads, then rejected the deviceIDs item after a successful 17ms transport
return. It did not obtain a complete nonempty snapshot. Authorized normal-Quit
recovery left no residue. Item diagnostics now distinguish fixed rejection
reasons and numeric item descriptor type without revealing values or relaxing
validation; these added diagnostics have only offline evidence.

Candidate 0.1.6 explicitly grants one initial documentPaths read up to eight
seconds, clipped to the absolute deadline. Consumption is irreversible; all
subsequent reads and default transports remain capped at two seconds. The
diagnostic initial snapshot has twelve seconds within the original sixty-second
owner lifetime. This is an unverified startup hypothesis, not a retry.
An independent documents-only reader can recheck the original unmodified
project before normal owner shutdown even when target parsing fails. Its
snapshot cannot satisfy complete target validation. The diagnostic terminal
status distinguishes document closure with an unverified target; production
debugger/AUT closure and capture readiness are unchanged.

The live 0.1.6 attempt reached the project document observation but did not pass
it or reach target reads. Recovery used authorized normal Quit. Independent
document-reader diagnostics were missing from the receipt; they are now
included alongside five boolean match checks, without document values. This
adds observability only and does not relax any matching or cleanup condition.

The 0.1.7 run parsed the independent document snapshot successfully but found
more than one document for the loaded workspace. Single-document matching
therefore failed. The `unmodified` check compares against `[false]`; a false
result here does not imply an actually modified document. Additional document
ownership remains unknown. Cleanup paused and then completed via separately
authorized normal Quit; the strict production gates remain unchanged.

Candidate 0.1.8 adds bounded document-location counts and an exact modified
count. It resolves existing paths with realpath, compares full components, and
reports unresolved entries separately. No path values enter the receipt. These
counts are diagnostic only, not ownership or cleanup capabilities; all gates
remain unchanged. The candidate is not live-validated.

The 0.1.8 run observed two unmodified documents: one matched the reviewed
project and one could not be resolved with realpath. No resolved outside path
was observed, but the unresolved entry has unknown ownership and semantics.
Strict matching remained blocked. Authorized normal-Quit recovery completed
without residue; no target metadata or production capture was validated.

Metadata probe 0.1.9 adds bounded, shape-only document.file diagnostics without alias resolution or payload logging. Diagnostic target reads permit extra unmodified documents only after matching document observations and workspace binding on each pass. Strict close/identity checks remain unchanged. The 69-scenario offline fixture passes; the candidate has not been installed or run.

The 0.1.10 candidate adds fixed missing-value/type-shape and path-resolution failure classifications. It exposes no raw type payload or path, and does not relax ownership or closure checks. All 74 offline scenarios pass; the candidate is not installed or live-verified.

ADR-049 adds an owner-local document lifetime source: only observed termination of the retained original application, within its deadline and without an observed identity conflict, yields `owner_process_exited`. A successful Quit request or missing process inventory is insufficient. The diagnostic App requires an explicit `--allow-unmodified-documents-quit` grant for extra unmodified documents; fresh metadata and directory binding are checked before its one-time consumption. This flag is not a production PermissionEngine integration. Debugger/AUT/helper closure remains independent, and the production helper still has no provider. No new candidate has been installed or live-verified.

Probe 0.1.12 supports `--physical-destination` with the matching in-memory `ITESTAGENT_METADATA_EXPECTED_DEVICE_ID` environment value; either alone is rejected. It samples bounded read-only selection metadata, rechecks documents, and confirms selection via full snapshots. `destinationSelectionObserved` never implies debugger/AUT identity. The 98-scenario fixture passes; no live physical verification is claimed.

Probe 0.1.13 records fixed selection-branch classifications and parsed descriptor shapes after each sample. Alternate platform representations remain diagnostic-only and are not accepted aliases. The 108 offline scenarios pass; the candidate is not installed or live-verified.

### Fixed platform comparison diagnostic

The metadata probe can compare the existing collection platform query with a fixed workspace-index-1 variant after 40 missing-platform observations. Matching, unmodified, single-workspace document snapshots bracket the bounded comparison. Only fixed platform classifications are recorded; classification stability does not imply atomicity or equality of unknown strings. This diagnostic never establishes target identity or changes production snapshot matching. Version 0.1.14 is a reviewed candidate, not live verification evidence.
