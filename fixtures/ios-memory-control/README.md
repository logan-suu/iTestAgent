# Physical memory diagnostic control

This isolated app is a diagnostic fixture, not application code injected into user projects.
Its bundle identifier is `com.itestagent.spike.MemoryProbe`; it must not replace another app.

- Default launch stays idle so production recording can start before the workload.
- `Run Leak Workload`: intentionally discard 20 allocations of 262144 bytes (5 MiB total).
- `Run Released Workload`: allocate and free the same 20 blocks.
- Four batches run 0, 5, 10 and 15 seconds after each explicit tap. Both buttons are disabled during a round. The selected mode becomes available again after completion, up to ten rounds in the same process; switching mode requires a fresh process. There is no automatic replay or repeating timer.
- The UI shows completed rounds. Each round resets its allocation/batch counters; the positive workload can leave up to 50 MiB unreachable after ten rounds. Concurrent taps cannot overlap workloads.
- `MemoryProbeViewController` supplies a real source-backed candidate and accessibility identifiers for the title, workload buttons and completion status.
- `Library/Caches/workload.json` (`itestagent.memory-control.v2`) records the current round batches, successful allocations/releases, running state and completed round count. These are workload receipts, never performance metric substitutes.
- Allocation receipts prove workload execution, not leak-tool success. Compare them with actual Leaks diagnostics.

Generate the project using the existing XcodeGen tool. Supply a user-approved existing Team in the temporary local project or at build time; no personal signing configuration belongs in this fixture. Building, signing and installing require explicit authorization. Prefer a fresh temporary project/DerivedData directory and retain raw trace/XML only inside the private run artifacts boundary.

Physical evidence and remaining product acceptance are recorded in `docs/06-verification/performance-capture-wiring-6.12.md`, section 10. Empty Leaks exports remain unconfirmed, not proof that every leak scan succeeded or that all retain cycles are absent.
