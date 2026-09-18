import Foundation

@main struct ObservationFixture {
    static func main() throws {
        let values: [Bool?] = [nil, false, true]
        var cases = 0
        for count in [-1, 0, 1, 2, Int.max] {
            for pid in values { for bundle in values { for active in values { for terminated in values {
                let checks = MemoryAppObservationChecks(instanceCount: count, pidMatches: pid,
                    bundleMatches: bundle, active: active, terminated: terminated)
                let diagnostic = diagnoseMemoryAppObservation(checks)
                // The original conjunction must not gain any new eligible state.
                let expected = count == 1 && pid == true && bundle == true && active == true && terminated == false
                precondition(diagnostic.allowsControlRead == expected)
                precondition(!diagnostic.targetVerified)
                let data = try JSONEncoder().encode(diagnostic)
                let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
                precondition(Set(object.keys) == Set(["reason", "checks", "targetVerified"]))
                let encodedChecks = object["checks"] as! [String: Any]
                precondition(Set(encodedChecks.keys).isSubset(of: Set(["instanceCount", "pidMatches", "bundleMatches", "active", "terminated"])))
                precondition((encodedChecks["active"] == nil) == (active == nil))
                cases += 1
            } } } }
        }
        let expectations: [(MemoryAppObservationChecks, MemoryAppObservationReason)] = [
            (.init(instanceCount: 0), .absent),
            (.init(instanceCount: 2), .ambiguous),
            (.init(instanceCount: -1), .incomplete),
            (.init(instanceCount: 1), .incomplete),
            (.init(instanceCount: 1, pidMatches: false, bundleMatches: true, active: true, terminated: false), .pidMismatch),
            (.init(instanceCount: 1, pidMatches: true, bundleMatches: false, active: true, terminated: false), .bundleMismatch),
            (.init(instanceCount: 1, pidMatches: true, bundleMatches: true, active: false, terminated: false), .inactive),
            (.init(instanceCount: 1, pidMatches: true, bundleMatches: true, active: false, terminated: true), .terminated)
        ]
        for (checks, reason) in expectations { precondition(diagnoseMemoryAppObservation(checks).reason == reason) }
        // Invalid input returns before any AppKit inventory or real Xcode access.
        let invalid = observeMemoryXcodeApplication(expectedPID: 0)
        precondition(invalid.application == nil && invalid.diagnostic.reason == .invalidInput)
        precondition(invalid.diagnostic.checks == nil)
        print("{\"equivalenceCases\":\(cases),\"distinctReasons\":true,\"metadataOnly\":true,\"invalidInputBlocked\":true}")
    }
}
