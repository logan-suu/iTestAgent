import AppKit
import Foundation

// Observation only. This does not establish launch ownership or target readiness.
// Unknown values remain nil rather than being reported as measured false values.
struct MemoryAppObservationChecks: Codable {
    var instanceCount: Int
    var pidMatches: Bool?
    var bundleMatches: Bool?
    var active: Bool?
    var terminated: Bool?
}

enum MemoryAppObservationReason: String, Codable {
    case eligible = "observation_eligible"
    case invalidInput = "observation_invalid_input"
    case wrongThread = "observation_wrong_thread"
    case absent = "observation_instance_absent"
    case ambiguous = "observation_instances_ambiguous"
    case pidMismatch = "observation_pid_mismatch"
    case bundleMismatch = "observation_bundle_mismatch"
    case inactive = "observation_not_active"
    case terminated = "observation_terminated"
    case incomplete = "observation_incomplete"
}

struct MemoryAppObservationDiagnostic: Encodable {
    let reason: MemoryAppObservationReason
    let checks: MemoryAppObservationChecks?
    // This intentionally cannot encode an observed PID, path, title or raw UI text.
    let targetVerified = false
    var allowsControlRead: Bool { reason == .eligible }
}

func diagnoseMemoryAppObservation(_ checks: MemoryAppObservationChecks) -> MemoryAppObservationDiagnostic {
    let reason: MemoryAppObservationReason
    if checks.instanceCount < 0 { reason = .incomplete }
    else if checks.instanceCount == 0 { reason = .absent }
    else if checks.instanceCount != 1 { reason = .ambiguous }
    else if checks.pidMatches == nil || checks.bundleMatches == nil ||
            checks.active == nil || checks.terminated == nil { reason = .incomplete }
    else if checks.pidMatches != true { reason = .pidMismatch }
    else if checks.bundleMatches != true { reason = .bundleMismatch }
    else if checks.terminated == true { reason = .terminated }
    else if checks.active != true { reason = .inactive }
    else { reason = .eligible }
    return MemoryAppObservationDiagnostic(reason: reason, checks: checks)
}

// Reads public AppKit process metadata once, without activating, launching or
// adopting the application. The caller must recheck context before each AX read.
func observeMemoryXcodeApplication(expectedPID: Int32) -> (
    application: NSRunningApplication?, diagnostic: MemoryAppObservationDiagnostic
) {
    guard Thread.isMainThread else {
        return (nil, MemoryAppObservationDiagnostic(reason: .wrongThread, checks: nil))
    }
    guard expectedPID > 0 else {
        return (nil, MemoryAppObservationDiagnostic(reason: .invalidInput, checks: nil))
    }
    let instances = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dt.Xcode")
    var checks = MemoryAppObservationChecks(instanceCount: instances.count)
    var selected: NSRunningApplication?
    if instances.count == 1, let app = instances.first {
        selected = app
        checks.pidMatches = app.processIdentifier == expectedPID
        checks.bundleMatches = app.bundleURL?.resolvingSymlinksInPath().path == "/Applications/Xcode.app"
        checks.active = app.isActive
        checks.terminated = app.isTerminated
    }
    let diagnostic = diagnoseMemoryAppObservation(checks)
    return (diagnostic.allowsControlRead ? selected : nil, diagnostic)
}
