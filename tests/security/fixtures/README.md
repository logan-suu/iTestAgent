# tests/security/fixtures — B00 RED-phase fixtures

Static fixtures used by the B00 security test suite. Dynamic fixtures (temp git
repos, symlinks, FIFOs, device nodes) are created and cleaned up by the tests
themselves under the OS temp directory; only stable, repo-local data lives here.

| File | Purpose | Used by |
|---|---|---|
| `receipt-g7-false.json` | Pre-commit gate receipt whose `g7` is `false` (pre-Bun secret scan did not pass). A valid verifier must reject it. | `precommit-receipt.test.ts` |
| `receipt-valid-shape.json` | Gate receipt with a valid shape (`g7: true`) but a staged tree that cannot match any real index. Exercises the tree-mismatch rejection path without a matching git repo. | `precommit-receipt.test.ts` |

All receipt fixtures follow the GATE_RECEIPT schema from the promotion guide
§12.3 step 6: `{ "batchId", "stagedTreeHash", "g7" }`.
