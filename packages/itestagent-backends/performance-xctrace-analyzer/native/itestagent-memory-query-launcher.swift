import Foundation
import Darwin

// Reusable launcher transport. The launch owner supplies its original instance PID
// and current-instance predicate, never an inventory-discovered replacement PID.
final class MemoryQueryLauncher {
    let version: Int
    private(set) var closedFrame: [String: Any]?
    let endpoint: MemoryPrivateSocket
    let cancellation = MemoryIPCCancellation()
    private var used = false
    private(set) var control: MemoryQueryControl?
    func prepareControl(input: Int32 = STDIN_FILENO, deadline: Double) throws {
        guard control == nil else { throw MemoryIPCError.invalid }
        control = try MemoryQueryControl(input: input, deadline: deadline, cancellation: cancellation, version: version)
    }
    init(version: Int = 3) throws { self.version = version; endpoint = try MemoryPrivateSocket() }

    // Call on a worker queue for AppKit owners; their main run loop must keep running.
    // Completion proves protocol closure only. The caller must observe helper exit.
    func bridge(peerPID: pid_t, ownerCurrent: () -> Bool, deadline: Double,
                input: Int32 = STDIN_FILENO, output: Int32 = STDOUT_FILENO,
                launchInstanceId: String? = nil, manifestSHA256: String? = nil) throws {
        guard !used else { throw MemoryIPCError.invalid }; used = true
        if version == 4 {
            guard let launchInstanceId, UUID(uuidString: launchInstanceId) != nil,
                  let manifestSHA256, manifestSHA256.utf8.count == 64 else { throw MemoryIPCError.invalid }
        }
        let order = MemoryIPCOrder(deadline: deadline, version: version)
        if control == nil { try prepareControl(input: input, deadline: deadline) }
        guard let control else { throw MemoryIPCError.invalid }
        defer { if version == 3 { control.stop() } }
        let peerDecoder = MemoryIPCDecoder(version: version)
        var peer: Int32 = -1
        var savedHello: Data?
        var lastClosed: [String: Any]?
        defer { if version == 3 || closedFrame == nil { cancellation.cancel() }; if peer >= 0 { shutdown(peer, SHUT_RDWR); Darwin.close(peer) } }
        guard ownerCurrent() else { throw MemoryIPCError.peer }
        while true {
            try order.check(); try endpoint.validate()
            guard !cancellation.cancelled else { throw MemoryIPCError.cancelled }
            // Once closed, only EOF is accepted; exit is independently observed later.
            let frames = try control.take()
            do {
                for frame in frames {
                    try order.accept(frame, parent: true)
                    let data = try MemoryIPCDecoder.encode(frame, version: version)
                    if peer < 0 {
                        guard frame["kind"] as? String == "hello", savedHello == nil else { throw MemoryIPCError.invalid }
                        savedHello = data
                    } else {
                        guard ownerCurrent() else { throw MemoryIPCError.peer }
                        try memoryIPCWrite(data, fd: peer, cancellation: cancellation, deadline: deadline)
                    }
                }
            }
            var pending = pollfd(fd: peer < 0 ? endpoint.descriptor : peer, events: Int16(POLLIN), revents: 0)
            let count = poll(&pending, 1, 20)
            if count < 0 { if errno == EINTR { continue }; throw MemoryIPCError.disconnected }
            if pending.revents != 0 {
                if peer < 0 {
                    peer = try endpoint.acceptPeer(pid: peerPID)
                    guard ownerCurrent() else { throw MemoryIPCError.peer }
                    if let savedHello {
                        try memoryIPCWrite(savedHello, fd: peer, cancellation: cancellation, deadline: deadline)
                    }
                } else {
                    guard let bytes = try memoryIPCRead(peer) else {
                        try peerDecoder.end()
                        guard order.state == "closed", control.pendingBytes == 0 else { throw MemoryIPCError.disconnected }
                        closedFrame = lastClosed
                        return
                    }
                    for frame in try peerDecoder.push(bytes) {
                        try order.accept(frame, parent: false)
                        if frame["kind"] as? String == "closed" { lastClosed = frame }
                        var data = try MemoryIPCDecoder.encode(frame, version: version)
                        if version == 4 {
                            // Helper-role decoder rejects these fields. Only the
                            // launcher adds the retained original instance binding.
                            var forwarded = frame
                            forwarded["launchInstanceId"] = launchInstanceId
                            forwarded["manifestSHA256"] = manifestSHA256
                            data = try JSONSerialization.data(withJSONObject: forwarded, options: [.sortedKeys])
                            data.append(10)
                        }
                        try memoryIPCWrite(data, fd: output, cancellation: cancellation, deadline: deadline)
                    }
                }
            }
        }
    }
}

// Dispatch sources only set a lock-protected latch. They never force-terminate owners.
final class MemoryIPCSignals {
    private var sources = [DispatchSourceSignal]()
    private var previous = [Int32: sig_t]()
    init(_ cancellation: MemoryIPCCancellation) {
        for number in [SIGTERM, SIGINT] {
            previous[number] = signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: DispatchQueue(label: "itestagent.query.signal.\(number)"))
            source.setEventHandler { cancellation.cancel() }; source.resume(); sources.append(source)
        }
        previous[SIGPIPE] = signal(SIGPIPE, SIG_IGN)
    }
    deinit {
        for source in sources { source.cancel() }
        for (number, handler) in previous { signal(number, handler) }
    }
}

// Process exit and protocol completion are independent observations. A timer must
// not race a queued bridge callback and turn a valid closure into a false failure.
func memoryQueryLauncherExitCode(callbackReceived: Bool, bridgeFinished: Bool,
                                protocolClosed: Bool, helperExited: Bool,
                                creationAttempted: Bool) -> Int32? {
    guard callbackReceived, bridgeFinished, helperExited || !creationAttempted else { return nil }
    return protocolClosed && helperExited ? 0 : 2
}
