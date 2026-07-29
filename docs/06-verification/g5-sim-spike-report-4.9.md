# G5-SIM Spike Report — Phase 4 Evidence / Performance / Reporting

**Task**: 4.9 (Phase 4 integration test — evidence/performance/report pipeline verification)
**Date**: 2026-07-29
**Simulator**: iPhone 16 Pro (iOS 18.2, CoreSimulator runtime `com.apple.CoreSimulator.SimRuntime.iOS-18-2`)
**UDID**: `F3BF1718-247D-4CB2-AAAF-F7738514B14D`
**Test App**: Safari (`com.apple.mobilesafari`) — system app, no signing required
**Environment**:
- macOS (arm64), Xcode 26.5
- Bun 1.3.14
- Argent MCP (simulator control layer)
- Headless boot (`headless=true`)

---

## 1. G5-SIM Verification Targets

| # | Target | Capability | Method | Result |
|---|---|---|---|---|
| V1 | Simulator boot + app launch | Evidence collection precondition | `argent boot-device` + `argent launch-app` | ✅ PASS |
| V2 | Screenshot capture (real Simulator) | EvidenceCollector: ArtifactRef (type=screenshot, mimeType=image/png) | `argent screenshot` → PNG file saved to tmpdir | ✅ PASS |
| V3 | UI tree capture (real Simulator) | EvidenceCollector: UiTreeSnapshot (format=xml, raw XML string) | `argent describe` → AX tree with 18 elements | ✅ PASS |
| V4 | ArtifactRef format validation | G2 schema: id, type, path, mimeType, redactionStatus | Screenshot saved as PNG; ArtifactRef schema round-trips | ✅ PASS |
| V5 | Simulator targetKind in baseline | BaselineStore domain isolation (ADR-011 §6) | `phase4-performance-baseline.test.ts` 17 tests | ✅ PASS |
| V6 | Evidence → Report pipeline | EvidenceCollector → FailureExplainer → ReportSynthesizer | `phase4-evidence-to-report.test.ts` 9 tests | ✅ PASS |
| V7 | Schema round-trips | G2: TraceSummary, BaselineRecord, BaselineDelta, FailureExplanation, RunResult, ArtifactIndex | `phase4-schema-contracts.test.ts` 18 tests | ✅ PASS |

---

## 2. Evidence Collected

### V2: Screenshot

- **Method**: `argent screenshot` → PNG file
- **Path**: `/var/folders/.../simserver-riP515/media/239547000-1785337030260.png`
- **App**: Safari showing "Example Domain" (https://example.com)
- **Format**: PNG, valid image file
- **ArtifactRef mapping**:
  ```json
  {
    "id": "screenshot_<timestamp>",
    "type": "screenshot",
    "path": "<tmpdir>/.../<id>.png",
    "mimeType": "image/png",
    "redactionStatus": "safe"
  }
  ```

### V3: UI Tree (20 elements)

```
ROOT  AXGroup (0.000, 0.000, 1.000, 1.000)
  AXAdjustable "Example Domain"  (0.000, 0.071, 1.000, 0.776)
  AXStaticText "Example Domain"  (0.199, 0.201, 0.465, 0.033)
  AXStaticText "This domain is for use in documentation examples..."  (0.199, 0.253, 0.600, 0.093)
  AXLink "Learn more"  (0.199, 0.363, 0.206, 0.024)
  AXTextField "锁定"  (0.354, 0.870, 0.031, 0.023)
  AXGroup "地址" value="‎example.com, 安全"  (0.354, 0.870, 0.293, 0.023)
  AXButton "刷新"  (0.854, 0.870, 0.043, 0.023)
  AXButton "返回"  (0.000, 0.911, 0.149, 0.050)
  AXButton "前进"  (0.213, 0.911, 0.149, 0.050)
  AXButton "共享"  (0.425, 0.911, 0.149, 0.050)
  AXButton "显示书签"  (0.637, 0.911, 0.152, 0.050)
  AXButton "标签页"  (0.851, 0.911, 0.149, 0.050)
  // + scrollbar and toolbar groups
```

- **Format**: AX accessibility tree (XML-compatible)
- **Locale**: Chinese (zh-CN) — labels in Chinese
- **Element count**: 18 interactive + 2 scrollbar groups = 20 total

---

## 3. Integration Test Coverage

### Phase 4 Integration Tests (53 tests, 4 files)

| File | Link | Tests | Coverage |
|---|---|---|---|
| `phase4-evidence-to-report.test.ts` | EvidenceCollector → FailureExplainer → ReportSynthesizer | 9 | P0: Core pipeline |
| `phase4-performance-baseline.test.ts` | BaselineManager → BaselineStore → BaselineDelta + ADR-011 | 17 | P0: Baseline + domain isolation |
| `phase4-xcresult-pipeline.test.ts` | createXcresultParser → JUnit XML → TestCaseResult | 9 | P1: xcresult parsing |
| `phase4-schema-contracts.test.ts` | Schema round-trips (6 schemas) | 18 | P2: Schema validation |

### Monorepo Full Regression

- **2227 tests** / **0 fail** / 5677 expect() calls
- 116 test files across all packages + integration directories
- Typecheck: 0 errors
- Lint: 0 violations (328 files)

---

## 4. NOT Verified (Simulator Limitations)

| Capability | Reason | Plan |
|---|---|---|
| xcresult parsing with real .xcresult | Requires Xcode project + `xcodebuild test` run on simulator | Phase 5: run with real iOS project |
| Performance metrics (launch/memory/hitches/FPS) | Argent MCP does not expose performance APIs | Phase 5: use xctrace directly |
| xctrace export (.trace → XML) | Requires `xcrun xctrace record` with app process | Phase 5: run with real app |
| G5 physical device verification | No iPhone connected in current session | Needs physical device (Phase 3 G5-verified iPhone 14 Plus available) |

---

## 5. ADR-011 Simulator Domain Isolation

Verified through `phase4-performance-baseline.test.ts`:

- ✅ Physical and simulator baselines stored in separate subdirectories (`baselines/physical/` vs `baselines/simulator/`)
- ✅ Cross-domain comparisons rejected at schema level (TargetKind field mismatch)
- ✅ Simulator baseline records include: `hostFingerprint`, `xcodeVersion`, `runtimeIdentifier`
- ✅ `comparisonScope: "simulator_only"` and `representativeOfPhysicalDevice: false` set on simulator records
- ✅ Baseline key format includes targetKind: `<project>|<targetKind>|<deviceModel>|<iOS>|<scenario>`

---

## 6. Report Synthesis (S9)

Generated from test fixtures, verified against G2 schemas:

### summary.md
- ✅ Structured markdown with sections: Overview, Results, Evidence, Performance, Failures
- ✅ Simulator reports include environment metadata (Xcode version, runtime, host fingerprint)
- ✅ FPS marked `approximate` per R5

### result.json
- ✅ Valid JSON with schemaVersion field
- ✅ run status, Profile reference, device info, execution method, metrics, baselineDelta
- ✅ Artifact references point to valid artifact IDs

### artifact-index.json
- ✅ Array of {id, type, path, relatedStep} entries
- ✅ Each artifact ID resolvable via ArtifactStore.get()

---

## 7. Risks & Warnings

| ID | Severity | Description |
|---|---|---|
| W-1 | 🟡 | xcresult parsing NOT verified with real .xcresult — only JUnit XML fixtures tested |
| W-2 | 🟡 | Performance metrics (launch/memory/hitches/FPS) NOT measured on real simulator — only schema/contract tested |
| W-3 | 🟡 | FPS `approximate` flag NOT validated against real FPS measurements |
| W-4 | 🟡 | Evidence collection end-to-end uses MockDeviceBackend in tests — AppiumDeviceBackend G5-SIM was done in Phase 3 (task 3.10) but not re-verified end-to-end with Phase 4 evidence pipeline |
| W-5 | 🟢 | G5 physical verification pending — iPhone 14 Plus used in Phase 3 not available in current session |

---

## 8. G5-SIM Gate Decision

**PASS with caveats.** All 7 verification targets that can be tested with Argent MCP + unit/integration tests pass. The 3 targets requiring Xcode project test runs (xcresult, xctrace, performance metrics) are deferred to Phase 5 with explicit documentation.

Per ADR-011 §8 and R5, all unverified capabilities are explicitly marked:
- FPS → `approximate: true`
- xctrace summary → experimental (raw .trace preserved)
- Performance metrics on simulator → `representativeOfPhysicalDevice: false`

### Evidence Artifacts
- Screenshot: `/var/folders/.../simserver-riP515/media/239547000-1785337030260.png`
- UI tree: 20-element AX tree from Safari on iPhone 16 Pro Simulator (iOS 18.2)
- Test results: 2227/0 pass (monorepo), 53/0 pass (Phase 4 integration)
