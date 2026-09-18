import ApplicationServices
import Foundation

final class CapabilityFixture: MemoryAXCapabilityReader {
    var roleValue = kAXTextAreaRole
    var writable = true
    var actionValues: [String] = []
    var reads = 0
    var failAt = 0
    var afterRead: () -> Void = {}
    var timeouts: [Float] = []

    func setTimeout(_ seconds: Float) throws { timeouts.append(seconds) }
    func didRead() throws {
        reads += 1
        afterRead()
        if reads == failAt { throw MemoryAXCapabilityFailure.queryFailed }
    }
    func role() throws -> String { try didRead(); return roleValue }
    func valueIsSettable() throws -> Bool { try didRead(); return writable }
    func actions() throws -> [String] { try didRead(); return actionValues }
}

@main
struct CapabilityTests {
    static func main() throws {
        func inspect(_ fixture: CapabilityFixture) -> MemoryAXCapabilityResult {
            inspectMemoryAXCapabilities(reader: fixture, deadline: 10, now: { 1 },
                                        cancelled: { false }, contextIsCurrent: { true })
        }
        let empty = CapabilityFixture()
        let emptyResult = inspect(empty)
        precondition(emptyResult.capabilities?.valueSettable == true)
        precondition(emptyResult.capabilities?.confirmAdvertised == false)
        precondition(emptyResult.capabilities?.submissionVerified == false)
        precondition(empty.timeouts.count == 3 && empty.timeouts.allSatisfy { $0 > 0 && $0 <= 0.5 })

        let advertised = CapabilityFixture()
        advertised.actionValues = [kAXConfirmAction, kAXPressAction, "private-fixture-marker"]
        let advertisedResult = inspect(advertised)
        precondition(advertisedResult.capabilities?.confirmAdvertised == true)
        precondition(advertisedResult.capabilities?.pressAdvertised == true)
        precondition(advertisedResult.capabilities?.otherActionCount == 1)
        precondition(advertisedResult.capabilities?.submissionVerified == false)
        let encoded = String(data: try JSONEncoder().encode(advertisedResult), encoding: .utf8)!
        precondition(!encoded.contains("private-fixture-marker"))

        for failure in 1...3 {
            let failed = CapabilityFixture(); failed.failAt = failure
            let result = inspect(failed)
            precondition(result.failure == .queryFailed && result.capabilities == nil)
            precondition(failed.reads == failure)
        }
        let oversized = CapabilityFixture(); oversized.actionValues = (0...64).map { "action-\($0)" }
        precondition(inspect(oversized).failure == .invalidMetadata)
        let duplicate = CapabilityFixture(); duplicate.actionValues = [kAXConfirmAction, kAXConfirmAction]
        precondition(inspect(duplicate).failure == .invalidMetadata)
        let longName = CapabilityFixture(); longName.actionValues = [String(repeating: "a", count: 129)]
        precondition(inspect(longName).failure == .invalidMetadata)
        let notText = CapabilityFixture(); notText.roleValue = kAXButtonRole; notText.writable = false
        precondition(inspect(notText).capabilities?.textArea == false)
        precondition(inspect(notText).capabilities?.valueSettable == false)

        for after in [0, 1, 3] {
            let cancelled = CapabilityFixture()
            let result = inspectMemoryAXCapabilities(reader: cancelled, deadline: 10, now: { 1 },
                cancelled: { cancelled.reads >= after }, contextIsCurrent: { true })
            precondition(result.failure == .cancelled && result.capabilities == nil)
            precondition(cancelled.reads == after)
            let drift = CapabilityFixture()
            let driftResult = inspectMemoryAXCapabilities(reader: drift, deadline: 10, now: { 1 },
                cancelled: { false }, contextIsCurrent: { drift.reads < after })
            precondition(driftResult.failure == .contextChanged && driftResult.capabilities == nil)
            precondition(drift.reads == after)
        }
        let late = CapabilityFixture()
        var clock: TimeInterval = 1
        late.afterRead = { clock = 11 }
        let lateResult = inspectMemoryAXCapabilities(reader: late, deadline: 10, now: { clock },
            cancelled: { false }, contextIsCurrent: { true })
        precondition(lateResult.failure == .deadlineExceeded && late.reads == 1)
        let expired = CapabilityFixture()
        let expiredResult = inspectMemoryAXCapabilities(reader: expired, deadline: 1, now: { 1 },
            cancelled: { false }, contextIsCurrent: { true })
        precondition(expiredResult.failure == .deadlineExceeded && expired.reads == 0)

        // A nonexistent process exercises the linked public adapter without accessing an app.
        let invalid = PublicMemoryAXCapabilityReader(element: AXUIElementCreateApplication(-1))
        let invalidResult = inspectMemoryAXCapabilities(reader: invalid,
            deadline: ProcessInfo.processInfo.systemUptime + 2,
            cancelled: { false }, contextIsCurrent: { true })
        precondition(invalidResult.failure == .queryFailed && invalidResult.capabilities == nil)
        print("{\"metadataOnly\":true,\"failClosed\":true,\"cancelAndDrift\":true,\"deadline\":true,\"invalidNativeElementBlocked\":true}")
    }
}
