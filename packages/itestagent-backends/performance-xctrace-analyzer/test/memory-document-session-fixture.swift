import Foundation

final class DocumentOwner {}
final class DocumentEnvironment: MemoryDocumentEnvironment {
    var owner = DocumentOwner()
    var state = MemoryDocumentOwnerState.current
    var visible = [1]
    var path: String
    var fail = false
    var reads = 0
    var duringRead: (() -> Void)?
    init(path: String) { self.path = path }
    func ownerState(_ original: DocumentOwner) -> MemoryDocumentOwnerState { original === owner ? state : .unknown }
    func windows(deadline: Double) throws -> [Int] {
        if fail { throw MemoryDocumentSessionError.unavailable }
        duringRead?(); return visible
    }
    func document(_ window: Int, deadline: Double) throws -> String { reads += 1; return path }
}

@main struct DocumentFixture {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let manager = FileManager.default
        var count = 0
        for mode in ["stable", "missing", "destroyed", "foreign-event", "replacement-window", "extra-window", "read-error", "owner-conflict", "owner-exit", "cancel", "deadline", "replacement-directory", "renamed-directory", "read-cancel", "read-destroy", "wrong-document", "late-event", "mid-read-window", "owner-unknown", "init-ambiguous", "init-read-failed"] {
            let url = root.appendingPathComponent(mode + ".xcodeproj", isDirectory: true)
            try manager.createDirectory(at: url, withIntermediateDirectories: true)
            let env = DocumentEnvironment(path: url.absoluteString)
            if mode.hasPrefix("init-") {
                if mode == "init-ambiguous" { env.visible = [1, 2] } else { env.fail = true }
                do {
                    _ = try MemoryDocumentSession(environment: env, documentURL: url, deadline: 10, now: { 0 }, cancelled: { false })
                    preconditionFailure("Unverified initial context accepted")
                } catch {}
                count += 1; continue
            }
            var cancelled = false; var now = 0.0
            let session = try MemoryDocumentSession(environment: env, documentURL: url, deadline: 10, now: { now }, cancelled: { cancelled })
            precondition(session.observe() == .observedOpen)
            let original = env.owner
            switch mode {
            case "stable": precondition(session.observe() == .observedOpen)
            case "missing":
                env.visible = []; precondition(session.observe() == .windowUnavailable)
                env.visible = [1]; precondition(session.observe() == .windowUnavailable)
            case "destroyed":
                let reads = env.reads
                session.windowDestroyed(owner: original, window: 1)
                session.windowDestroyed(owner: original, window: 1)
                precondition(session.observe() == .windowUnavailable && env.reads == reads)
            case "foreign-event":
                session.windowDestroyed(owner: DocumentOwner(), window: 1)
                session.windowDestroyed(owner: original, window: 2)
                precondition(session.observe() == .observedOpen)
            case "owner-exit":
                env.state = .exited; env.fail = true
                precondition(session.observe() == .ownerExited)
                env.state = .current; precondition(session.observe() == .unknown)
            case "late-event":
                env.state = .exited; precondition(session.observe() == .ownerExited)
                session.windowDestroyed(owner: original, window: 1)
                precondition(session.observe() == .ownerExited)
            default:
                if mode == "replacement-window" { env.visible = [2] }
                if mode == "extra-window" { env.visible = [1, 2] }
                if mode == "owner-unknown" { env.state = .unknown }
                if mode == "mid-read-window" {
                    var calls = 0
                    env.duringRead = { calls += 1; if calls == 2 { env.visible = [2] } }
                }
                if mode == "read-error" { env.fail = true }
                if mode == "owner-conflict" { env.owner = DocumentOwner() }
                if mode == "cancel" { cancelled = true }
                if mode == "deadline" { now = 10 }
                if mode == "wrong-document" { env.path = root.absoluteString }
                if mode == "replacement-directory" || mode == "renamed-directory" {
                    try manager.moveItem(at: url, to: root.appendingPathComponent(mode + "-moved"))
                    if mode == "replacement-directory" { try manager.createDirectory(at: url, withIntermediateDirectories: true) }
                }
                if mode == "read-cancel" { env.duringRead = { cancelled = true } }
                if mode == "read-destroy" { env.duringRead = { session.windowDestroyed(owner: original, window: 1) } }
                let result = session.observe()
                precondition(result == (mode == "read-destroy" ? .windowUnavailable : .unknown))
                env.state = .exited
                precondition(session.observe() == (mode == "read-destroy" ? .ownerExited : .unknown))
            }
            count += 1
        }
        print("{\"scenarios\":\(count),\"noGUI\":true}")
    }
}
