import Foundation
import Darwin

// One lifetime owner per dedicated helper process. The parent writes no commands:
// EOF, unexpected bytes, a broken descriptor or a termination signal all cancel.
final class MemoryParentLifetime: @unchecked Sendable {
    private static var installed = false
    private var reader: DispatchSourceRead?
    private var term: DispatchSourceSignal?
    private var interrupt: DispatchSourceSignal?
    private var previousTerm: sig_t? = SIG_DFL
    private var previousInterrupt: sig_t? = SIG_DFL
    private var ownsSignals = false
    private let lock = NSLock()
    private let monitorQueue = DispatchQueue(label: "com.itestagent.memory.parent-lifetime")
    private var notified = false
    private var stopped = false
    private let onLoss: () -> Void

    init(onLoss: @escaping () -> Void) {
        precondition(Thread.isMainThread)
        self.onLoss = onLoss
        guard !Self.installed else { notify(); return }
        let fd = fcntl(STDIN_FILENO, F_DUPFD_CLOEXEC, 3)
        var metadata = stat()
        guard fd >= 0 else { notify(); return }
        guard fstat(fd, &metadata) == 0,
              [S_IFIFO, S_IFSOCK].contains(metadata.st_mode & S_IFMT) else {
            close(fd); notify(); return
        }
        Self.installed = true
        ownsSignals = true
        previousTerm = signal(SIGTERM, SIG_IGN)
        previousInterrupt = signal(SIGINT, SIG_IGN)
        let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: monitorQueue)
        let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: monitorQueue)
        term.setEventHandler { [weak self] in self?.notify() }
        interrupt.setEventHandler { [weak self] in self?.notify() }
        self.term = term; self.interrupt = interrupt
        term.resume(); interrupt.resume()
        let reader = DispatchSource.makeReadSource(fileDescriptor: fd, queue: monitorQueue)
        reader.setEventHandler { [weak self, weak reader] in
            // Readability includes EOF. No data is accepted by this lifetime-only pipe.
            reader?.cancel()
            self?.notify()
        }
        reader.setCancelHandler { close(fd) }
        self.reader = reader
        reader.resume()
        // An already closed parent must cancel before the caller invokes start().
        var descriptor = pollfd(fd: fd, events: Int16(POLLIN | POLLHUP), revents: 0)
        let ready = poll(&descriptor, 1, 0)
        if ready != 0 { notify() }
    }

    // Safe to read before/after synchronous AX calls, without waiting for main.
    var isCancelled: Bool {
        lock.lock(); defer { lock.unlock() }
        return notified
    }

    private func deliverLoss() {
        precondition(Thread.isMainThread)
        lock.lock(); let deliver = !stopped; lock.unlock()
        if deliver { onLoss() }
    }

    private func notify() {
        lock.lock()
        guard !notified, !stopped else { lock.unlock(); return }
        notified = true
        lock.unlock()
        if Thread.isMainThread { deliverLoss() }
        else { DispatchQueue.main.async { [weak self] in self?.deliverLoss() } }
    }

    // Call only after the driver has delivered its terminal result. Cancelling the
    // monitor is not evidence that the owned application or session has exited.
    func stop() {
        precondition(Thread.isMainThread)
        lock.lock()
        guard !stopped else { lock.unlock(); return }
        stopped = true
        lock.unlock()
        reader?.cancel(); reader = nil
        term?.cancel(); term = nil
        interrupt?.cancel(); interrupt = nil
        if ownsSignals {
            signal(SIGTERM, previousTerm)
            signal(SIGINT, previousInterrupt)
            Self.installed = false
            ownsSignals = false
        }
    }
    deinit {
        // Premature loss of the monitor must cancel, not abandon the session.
        precondition(Thread.isMainThread)
        if !stopped { notify() }
        stop()
    }
}
