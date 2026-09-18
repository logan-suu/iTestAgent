import CryptoKit
import Darwin
import Foundation

enum MemoryIdentityScriptFailure: String, Error {
    case invalidRequest = "invalid_request"
    case resourceUnavailable = "identity_resource_unavailable"
    case resourceChanged = "identity_resource_changed"
    case contextChanged = "context_changed"
    case cancelled
    case deadlineExceeded = "deadline_exceeded"
}

private struct MemoryScriptFingerprint: Equatable {
    let device: dev_t
    let inode: ino_t
    let size: off_t
    let modifiedSeconds: Int
    let modifiedNanos: Int
    let changedSeconds: Int
    let changedNanos: Int

    init(_ value: stat) {
        device = value.st_dev
        inode = value.st_ino
        size = value.st_size
        modifiedSeconds = value.st_mtimespec.tv_sec
        modifiedNanos = value.st_mtimespec.tv_nsec
        changedSeconds = value.st_ctimespec.tv_sec
        changedNanos = value.st_ctimespec.tv_nsec
    }
}

// A fixed resource query, not a submission, target-binding or readiness result.
// The caller must retain this value and revalidate the source before accepting a response.
struct PreparedMemoryIdentityQuery {
    static let sourceSHA256 = "79db65f1e0287380150d12bb5a931e826b210ced13de0c2623c61f8cf837a3c7"
    let requestID: String
    let command: String
    private let resource: URL
    private let fingerprint: MemoryScriptFingerprint

    private static func readVerified(_ url: URL) throws -> MemoryScriptFingerprint {
        guard url.isFileURL, url.path.utf8.count <= 4096,
              !url.path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
              url.resolvingSymlinksInPath().path == url.standardizedFileURL.path else {
            throw MemoryIdentityScriptFailure.resourceUnavailable
        }
        // Nonblocking open also prevents a substituted FIFO from stalling before fstat.
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { throw MemoryIdentityScriptFailure.resourceUnavailable }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var before = stat()
        guard fstat(descriptor, &before) == 0,
              (before.st_mode & S_IFMT) == S_IFREG, before.st_nlink == 1,
              before.st_size > 0, before.st_size <= 16384 else {
            throw MemoryIdentityScriptFailure.resourceUnavailable
        }
        let bytes: Data
        do { bytes = try handle.read(upToCount: 16385) ?? Data() }
        catch { throw MemoryIdentityScriptFailure.resourceUnavailable }
        var after = stat()
        guard fstat(descriptor, &after) == 0,
              MemoryScriptFingerprint(before) == MemoryScriptFingerprint(after),
              bytes.count == Int(before.st_size),
              SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == sourceSHA256 else {
            throw MemoryIdentityScriptFailure.resourceChanged
        }
        return MemoryScriptFingerprint(after)
    }

    static func prepare(
        in bundle: Bundle = .main,
        requestID: String,
        deadline: TimeInterval,
        now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
        cancelled: () -> Bool,
        contextIsCurrent: () -> Bool
    ) throws -> PreparedMemoryIdentityQuery {
        func check() throws {
            if cancelled() { throw MemoryIdentityScriptFailure.cancelled }
            guard deadline.isFinite, now() < deadline else {
                throw MemoryIdentityScriptFailure.deadlineExceeded
            }
            guard contextIsCurrent() else { throw MemoryIdentityScriptFailure.contextChanged }
            if cancelled() { throw MemoryIdentityScriptFailure.cancelled }
            guard now() < deadline else { throw MemoryIdentityScriptFailure.deadlineExceeded }
        }
        try check()
        guard let uuid = UUID(uuidString: requestID), uuid.uuidString.lowercased() == requestID else {
            throw MemoryIdentityScriptFailure.invalidRequest
        }
        // No caller-provided filename, script, module name or resource fallback.
        let base = bundle.bundleURL.resolvingSymlinksInPath().standardizedFileURL
        let resources = base.appendingPathComponent("Contents/Resources", isDirectory: true)
        guard bundle.resourceURL?.resolvingSymlinksInPath().path == resources.path else {
            throw MemoryIdentityScriptFailure.resourceUnavailable
        }
        let resource = resources.appendingPathComponent("itestagent_memory_identity.py")
        let fingerprint = try readVerified(resource)
        try check()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        let path = String(decoding: try encoder.encode(resource.path), as: UTF8.self)
        let request = String(decoding: try encoder.encode(requestID), as: UTF8.self)
        let command = "script __import__('runpy').run_path(\(path))['emit'](lldb.debugger, \(request))"
        // This budget is a transport bound, not an experimentally proven Xcode limit.
        guard command.utf8.count <= 1024 else { throw MemoryIdentityScriptFailure.resourceUnavailable }
        let query = PreparedMemoryIdentityQuery(requestID: requestID, command: command,
                                               resource: resource, fingerprint: fingerprint)
        try query.validateSource()
        try check()
        return query
    }

    func validateSource() throws {
        guard try Self.readVerified(resource) == fingerprint else {
            throw MemoryIdentityScriptFailure.resourceChanged
        }
    }
}
