# ADR-024: Promotion Approval Simplification (Single-Developer Mode)

- **Status**: Accepted
- **Date**: 2026-08-24
- **Decider**: Project owner (single developer), via explicit directive
- **Related**: Promotion guide §7.1; AGENTS.md R8/R11

## Context

The iTestAgent promotion guide (§7.1) mandates a multi-party approval
ceremony before B00: an SSH-signed annotated tag (`promo/plan-approved-73c99fb`),
a machine-external allowed-signers file, and a content-addressed HTTPS
publication of the guide. This ceremony is designed for organizational trust
boundaries where the executing agent must prove that a *different* human
reviewed and approved the plan.

AGENTS.md §15 defines the project as a **single independent developer**
("人力 1 名独立开发者"). In this mode, the approver and the operator are the
same person, and the human is actively directing the execution session. The
owner explicitly instructed: (1) "希望简化/豁免审批" (simplify/waive the
approval ceremony), and (2) the ultimate goal is "能真正把agent跑通闭环"
(actually get the agent running the closed loop). Repeated re-asking for
ceremonial materials conflicts with the owner's expressed intent.

## Decision

For single-developer mode, the §7.1 approval ceremony is simplified as follows:

| Ceremony element | Original (§7.1) | Simplified (this ADR) |
|---|---|---|
| Approval anchor | SSH-signed annotated tag | Annotated tag `promo/plan-approved-73c99fb` created by the executing agent, recording the human directive (this ADR + approval JSON) |
| Allowed signers | Machine-external `ITESTAGENT_APPROVAL_ALLOWED_SIGNERS` file | Waived; single signer = project owner who directed execution |
| Guide publication | Content-addressed HTTPS URL + network SHA check | Waived; guide verified from local file (`ITESTAGENT_GUIDE_FILE`) |
| `approvedAt` + `approved: true` | Required | **Kept** — recorded as the timestamp of the human's execution directive |
| `targetBunLockSha256` | Offline-audited approval | Kept — verified byte-identical via probe (`332573df...`) |
| PROMO-001 registration | Required | Kept |
| baseline trailing-comma fix | Required (§7.1 step 1 revision) | Kept |

The core R8/R11 guarantees are preserved: the human's explicit directive is
recorded (`approvedAt`, this ADR, approval JSON), the plan is documented, and
the executing agent does not silently self-approve a plan the owner never saw —
the owner directed execution of *this specific reviewed guide*.

## Consequences

- B00 can proceed without SSH-signature ceremony in single-developer mode.
- The approval JSON and this ADR serve as the durable approval record.
- If the project later grows to multiple developers or external review, the
  original §7.1 ceremony must be restored for organizational boundaries.
- The guide §7.1 is revised to document this simplified path (guide SHA
  becomes `aa61f894eb9bb9dcd1f39202adee46b217744ee4f975ca4cf41bc3fb7fa1f231`
  → new SHA after §7.1 revision).
