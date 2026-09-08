# Physical memory diagnostic control

This isolated app is a diagnostic fixture, not application code injected into user projects.
Its bundle identifier is `com.itestagent.spike.MemoryProbe`; it must not replace another app.

- Default launch stays idle so production recording can start before the workload.
- `Run Leak Workload`: intentionally discard 20 allocations of 262144 bytes (5 MiB total).
- `Run Released Workload`: allocate and free the same 20 blocks.
- Four batches run 0, 5, 10 and 15 seconds after the selected button is tapped. Both buttons then remain disabled for this process; there is no repeating timer.
- `MemoryProbeViewController` supplies a real source-backed candidate and accessibility identifiers for the title, workload buttons and completion status.
- `Library/Caches/workload.json` records completed batches, successful allocations and releases.
- Allocation receipts prove workload execution, not leak-tool success. Compare them with actual Leaks diagnostics.

Generate the project using the existing XcodeGen tool. Supply a user-approved existing Team in the temporary local project or at build time; no personal signing configuration belongs in this fixture. Building, signing and installing require explicit authorization. Prefer a fresh temporary project/DerivedData directory and retain raw trace/XML only inside the private run artifacts boundary.

Physical evidence and remaining product acceptance are recorded in `docs/06-verification/performance-capture-wiring-6.12.md`, section 10. Empty Leaks exports remain unconfirmed, not proof that every leak scan succeeded or that all retain cycles are absent.
