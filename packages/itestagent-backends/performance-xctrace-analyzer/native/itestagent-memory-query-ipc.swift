import Foundation
import Darwin

// This channel contains authorization material. Errors never include input bytes.
enum MemoryIPCError: Error { case invalid, disconnected, cancelled, expired, peer, endpoint }

final class MemoryIPCDecoder {
    private let version: Int
    init(version: Int = 3) { self.version = version }
    private var buffer = Data()
    private var failed = false
    var pendingBytes: Int { buffer.count }
    func push(_ data: Data) throws -> [[String: Any]] {
        guard !failed else { throw MemoryIPCError.invalid }
        do {
            guard buffer.count + data.count <= 32768 else { throw MemoryIPCError.invalid }
            buffer.append(data)
            var frames = [[String: Any]]()
            while let newline = buffer.firstIndex(of: 10) {
                let length = buffer.distance(from: buffer.startIndex, to: newline)
                guard length > 0, length <= 16384 else { throw MemoryIPCError.invalid }
                let line = Data(buffer.prefix(length))
                guard String(data: line, encoding: .utf8) != nil,
                      let frame = try JSONSerialization.jsonObject(with: line) as? [String: Any]
                else { throw MemoryIPCError.invalid }
                try Self.validate(frame, version: version)
                frames.append(frame)
                buffer.removeFirst(length + 1)
            }
            guard buffer.count <= 16384 else { throw MemoryIPCError.invalid }
            return frames
        } catch { failed = true; buffer.removeAll(); throw MemoryIPCError.invalid }
    }
    func end() throws {
        let valid = !failed && buffer.isEmpty
        failed = true; buffer.removeAll()
        guard valid else { throw MemoryIPCError.invalid }
    }
    static func validate(_ frame: [String: Any], version expectedVersion: Int = 3) throws {
        let base: Set<String> = ["protocolVersion", "sequence", "sessionId", "requestId", "strategy", "commandSHA256", "challenge", "kind"]
        guard let kind = frame["kind"] as? String else { throw MemoryIPCError.invalid }
        let extra: Set<String> = kind == "decision" ? ["effect"] : kind == "result" ? ["result"] : []
        guard Set(frame.keys) == base.union(extra),
              ["hello", "hello_ack", "prepared", "decision", "result", "closing", "closed"].contains(kind),
              let version = frame["protocolVersion"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == Double(expectedVersion), [3, 4].contains(expectedVersion),
              let sequence = frame["sequence"] as? NSNumber, CFGetTypeID(sequence) != CFBooleanGetTypeID(),
              sequence.doubleValue >= 1, sequence.doubleValue <= 9007199254740991,
              sequence.doubleValue.rounded() == sequence.doubleValue,
              let session = frame["sessionId"] as? String, UUID(uuidString: session) != nil,
              let request = frame["requestId"] as? String, UUID(uuidString: request) != nil,
              frame["strategy"] as? String == "pidReturn"
        else { throw MemoryIPCError.invalid }
        for key in ["commandSHA256", "challenge"] {
            guard let value = frame[key] as? String, value.utf8.count == 64,
                  value.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
            else { throw MemoryIPCError.invalid }
        }
        if kind == "decision" {
            guard let effect = frame["effect"] as? String, ["allow", "deny"].contains(effect) else { throw MemoryIPCError.invalid }
        }
        if kind == "result" {
            guard let result = frame["result"] as? String, result.utf8.count <= 12288 else { throw MemoryIPCError.invalid }
        }
    }
    static func encode(_ frame: [String: Any], version: Int = 3) throws -> Data {
        try validate(frame, version: version)
        var data = try JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys, .withoutEscapingSlashes])
        guard data.count <= 16384 else { throw MemoryIPCError.invalid }
        data.append(10); return data
    }
}

// A single reader drives both directions. No MemoryParentLifetime stdin reader is attached.
final class MemoryIPCOrder {
    private let version: Int
    private var binding: [String: String]?
    private var sequence = 0
    private(set) var state = "new"
    private var allowed = false
    private(set) var grantAttempted = false
    private let deadline: Double
    private var phaseDeadline: Double
    init(deadline: Double, version: Int = 3) {
        self.version = version
        self.deadline = deadline
        phaseDeadline = min(deadline, ProcessInfo.processInfo.systemUptime + 5)
    }
    func check() throws {
        guard state != "failed", ProcessInfo.processInfo.systemUptime < phaseDeadline else {
            state = "failed"; throw MemoryIPCError.expired
        }
    }
    func accept(_ frame: [String: Any], parent: Bool) throws {
        do {
            try check(); try MemoryIPCDecoder.validate(frame, version: version)
            if version == 4, ["prepared", "decision", "result"].contains(frame["kind"] as? String ?? "") { throw MemoryIPCError.invalid }
            let keys = ["sessionId", "requestId", "strategy", "commandSHA256", "challenge"]
            let current = Dictionary(uniqueKeysWithValues: keys.map { ($0, frame[$0] as! String) })
            guard (frame["sequence"] as? NSNumber)?.intValue == sequence + 1 else { throw MemoryIPCError.invalid }
            if let binding { guard current == binding else { throw MemoryIPCError.invalid } }
            let kind = frame["kind"] as! String
            switch (state, kind, parent) {
            case ("new", "hello", true): binding = current; state = "hello"
            case ("hello", "hello_ack", false): state = "ack"
            case ("ack", "prepared", false):
                state = "prepared"; phaseDeadline = min(deadline, ProcessInfo.processInfo.systemUptime + 120)
            case ("prepared", "decision", true):
                allowed = frame["effect"] as? String == "allow"
                grantAttempted = allowed; state = "decided"; phaseDeadline = deadline
            case ("decided", "result", false):
                guard allowed else { throw MemoryIPCError.invalid }; state = "result"
            case (_, "closing", false) where ["ack", "prepared", "decided", "result"].contains(state): state = "closing"
            case ("closing", "closed", false): state = "closed"
            default: throw MemoryIPCError.invalid
            }
            sequence += 1
        } catch { state = "failed"; throw error }
    }
}

final class MemoryIPCCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return value }
    func cancel() { lock.lock(); value = true; lock.unlock() }
}

func memoryIPCPeer(_ fd: Int32, expectedPID: pid_t, expectedUID: uid_t = getuid()) throws {
    var uid: uid_t = 0; var gid: gid_t = 0
    var pid: pid_t = 0; var size = socklen_t(MemoryLayout<pid_t>.size)
    guard getpeereid(fd, &uid, &gid) == 0, uid == expectedUID,
          getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) == 0,
          size == MemoryLayout<pid_t>.size, pid == expectedPID, expectedPID > 0
    else { throw MemoryIPCError.peer }
}

private func memoryIPCAddress(_ path: String) throws -> sockaddr_un {
    var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8) + [0]
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw MemoryIPCError.endpoint }
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    withUnsafeMutableBytes(of: &address.sun_path) { destination in destination.copyBytes(from: bytes) }
    return address
}

// Retains inode identities. A replacement is never removed or treated as ours.
final class MemoryPrivateSocket {
    let directory: String
    let path: String
    let descriptor: Int32
    private var cleaned = false
    private var directoryStat = stat()
    private var endpointStat = stat()
    init() throws {
        var template = Array("/private/tmp/itestagent-query-XXXXXX".utf8CString)
        guard let created = mkdtemp(&template) else { throw MemoryIPCError.endpoint }
        directory = String(cString: created); path = directory + "/channel"
        descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw MemoryIPCError.endpoint }
        do {
            guard chmod(directory, 0o700) == 0, lstat(directory, &directoryStat) == 0 else { throw MemoryIPCError.endpoint }
            var address = try memoryIPCAddress(path)
            let bound = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
            guard bound == 0, chmod(path, 0o600) == 0, lstat(path, &endpointStat) == 0,
                  listen(descriptor, 1) == 0, fcntl(descriptor, F_SETFL, O_NONBLOCK) == 0 else { throw MemoryIPCError.endpoint }
            try validate()
        } catch { Darwin.close(descriptor); throw error }
    }
    func validate() throws {
        var dir = stat(); var endpoint = stat()
        guard lstat(directory, &dir) == 0, lstat(path, &endpoint) == 0,
              dir.st_dev == directoryStat.st_dev, dir.st_ino == directoryStat.st_ino,
              endpoint.st_dev == endpointStat.st_dev, endpoint.st_ino == endpointStat.st_ino,
              dir.st_uid == getuid(), endpoint.st_uid == getuid(),
              dir.st_mode & S_IFMT == S_IFDIR, dir.st_mode & 0o777 == 0o700,
              endpoint.st_mode & S_IFMT == S_IFSOCK, endpoint.st_mode & 0o777 == 0o600
        else { throw MemoryIPCError.endpoint }
    }
    func acceptPeer(pid: pid_t) throws -> Int32 {
        try validate()
        let peer = Darwin.accept(descriptor, nil, nil)
        guard peer >= 0 else { throw MemoryIPCError.peer }
        do { try validate(); try memoryIPCPeer(peer, expectedPID: pid); return peer }
        catch { Darwin.close(peer); throw error }
    }
    func cleanup() {
        guard !cleaned else { return }; cleaned = true
        Darwin.close(descriptor)
        if (try? validate()) != nil { unlink(path); rmdir(directory) }
    }
    deinit { cleanup() }
}

func memoryIPCConnect(path: String, launcherPID: pid_t) throws -> Int32 {
    var dir = stat(); var endpoint = stat()
    let directory = (path as NSString).deletingLastPathComponent
    guard lstat(directory, &dir) == 0, dir.st_mode & S_IFMT == S_IFDIR, dir.st_mode & 0o777 == 0o700,
          dir.st_uid == getuid(), lstat(path, &endpoint) == 0, endpoint.st_uid == getuid(),
          endpoint.st_mode & S_IFMT == S_IFSOCK, endpoint.st_mode & 0o777 == 0o600
    else { throw MemoryIPCError.endpoint }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw MemoryIPCError.endpoint }
    do {
        var address = try memoryIPCAddress(path)
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard result == 0 else { throw MemoryIPCError.endpoint }
        try memoryIPCPeer(fd, expectedPID: launcherPID)
        return fd
    } catch { Darwin.close(fd); throw error }
}

func memoryIPCRead(_ fd: Int32) throws -> Data? {
    var bytes = [UInt8](repeating: 0, count: 16384)
    let count = Darwin.read(fd, &bytes, bytes.count)
    guard count >= 0 else { throw MemoryIPCError.disconnected }
    return count == 0 ? nil : Data(bytes.prefix(count))
}

func memoryIPCWrite(_ data: Data, fd: Int32, cancellation: MemoryIPCCancellation, deadline: Double, controlFD: Int32? = nil) throws {
    // Nonblocking writes prevent a non-reading peer from hiding cancellation/deadline.
    let flags = fcntl(fd, F_GETFL)
    guard flags >= 0, fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0 else { throw MemoryIPCError.disconnected }
    defer { _ = fcntl(fd, F_SETFL, flags) }
    var offset = 0
    while offset < data.count {
        guard !cancellation.cancelled else { throw MemoryIPCError.cancelled }
        guard ProcessInfo.processInfo.systemUptime < deadline else { throw MemoryIPCError.expired }
        let count = data.withUnsafeBytes { Darwin.write(fd, $0.baseAddress!.advanced(by: offset), data.count - offset) }
        if count > 0 { offset += count; continue }
        guard count == -1, errno == EAGAIN || errno == EINTR else { throw MemoryIPCError.disconnected }
        if let controlFD {
            var control = pollfd(fd: controlFD, events: Int16(POLLIN), revents: 0)
            if poll(&control, 1, 0) > 0 {
                cancellation.cancel(); throw MemoryIPCError.cancelled
            }
        }
        var pending = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        _ = poll(&pending, 1, 20)
    }
}
