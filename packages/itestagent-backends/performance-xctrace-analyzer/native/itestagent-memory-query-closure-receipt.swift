import Foundation
import Darwin

// Only the launch owner constructs this terminal. Never decoded from helper bytes.
// The retained object is an instance association, not a physical PID generation.
final class MemoryLauncherClosure<Owner: AnyObject> {
    private let original: Owner
    private let frame: [String: Any]
    private var used = false
    init(original: Owner, launchInstanceId: String, manifestSHA256: String, closed: [String: Any]) throws {
        try MemoryIPCDecoder.validate(closed, version: 4)
        guard closed["kind"] as? String == "closed", closed["sequence"] as? Int == 4,
              UUID(uuidString: launchInstanceId) != nil, manifestSHA256.utf8.count == 64,
              manifestSHA256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
        else { throw MemoryIPCError.invalid }
        self.original = original
        var value = closed
        value["kind"] = "launcher_closure"; value["sequence"] = 5
        value["scope"] = "no_target_resources"; value["helper"] = "exited"
        value["manifestSHA256"] = manifestSHA256; value["launchInstanceId"] = launchInstanceId
        frame = value
    }
    func write(original: Owner, exited: () -> Bool, manifestMatches: () -> Bool,
               cancellation: MemoryIPCCancellation, deadline: Double, output: Int32 = STDOUT_FILENO) throws {
        guard !used else { throw MemoryIPCError.invalid }; used = true
        guard original === self.original, exited(), manifestMatches(), !cancellation.cancelled,
              ProcessInfo.processInfo.systemUptime < deadline else { throw MemoryIPCError.invalid }
        var bytes = try JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys])
        guard bytes.count <= 16384 else { throw MemoryIPCError.invalid }; bytes.append(10)
        try memoryIPCWrite(bytes, fd: output, cancellation: cancellation, deadline: deadline)
    }
}
