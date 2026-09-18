import Foundation
import Darwin

// The only reader of parent stdin, started before any launch attempt. Queues are
// bounded; loss is visible even if the AppKit main queue or launch callback stalls.
final class MemoryQueryControl: @unchecked Sendable {
    private let lock = NSLock()
    private let decoder: MemoryIPCDecoder
    private var frames = [[String: Any]]()
    private var bytes = 0
    private var stopped = false
    private var partial = 0
    let cancellation: MemoryIPCCancellation
    private let fd: Int32
    private let deadline: Double
    init(input: Int32, deadline: Double, cancellation: MemoryIPCCancellation, version: Int = 3) throws {
        decoder = MemoryIPCDecoder(version: version)
        self.cancellation = cancellation; self.deadline = deadline
        fd = dup(input)
        var info = stat()
        guard fd >= 0 else { throw MemoryIPCError.invalid }
        guard fstat(fd, &info) == 0, [S_IFIFO, S_IFSOCK].contains(info.st_mode & S_IFMT), deadline.isFinite else {
            Darwin.close(fd); throw MemoryIPCError.invalid
        }
        // Observe an already closed pipe before the caller can initiate a launch.
        _ = readReady(wait: 0)
        DispatchQueue(label: "itestagent.query.control").async { [self] in
            while !cancellation.cancelled {
                lock.lock(); let done = stopped; lock.unlock()
                if done { break }
                if ProcessInfo.processInfo.systemUptime >= deadline { cancellation.cancel(); break }
                if !readReady(wait: 20) { break }
            }
            Darwin.close(fd)
        }
    }
    private func readReady(wait: Int32) -> Bool {
        var pending = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let ready = poll(&pending, 1, wait)
        if ready == 0 { return true }
        if ready < 0 { if errno == EINTR { return true }; cancellation.cancel(); return false }
        do {
            guard let chunk = try memoryIPCRead(fd) else { cancellation.cancel(); return false }
            let parsed = try decoder.push(chunk)
            lock.lock(); defer { lock.unlock() }
            bytes += chunk.count; partial = decoder.pendingBytes
            guard bytes <= 32768, frames.count + parsed.count <= 4 else { throw MemoryIPCError.invalid }
            frames.append(contentsOf: parsed); return true
        } catch { cancellation.cancel(); return false }
    }
    func take() throws -> [[String: Any]] {
        guard !cancellation.cancelled else { throw MemoryIPCError.cancelled }
        lock.lock(); defer { lock.unlock() }
        let result = frames; frames.removeAll(); bytes = partial; return result
    }
    var pendingBytes: Int { lock.lock(); defer { lock.unlock() }; return bytes }
    func stop() { lock.lock(); stopped = true; lock.unlock() }
}
