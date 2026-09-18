import Darwin
import Foundation

@main
struct IdentityScriptTests {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
        let source = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
        let fm = FileManager.default
        let app = root.appendingPathComponent("Quoted ' fixture.app")
        let resources = app.appendingPathComponent("Contents/Resources")
        try fm.createDirectory(at: resources, withIntermediateDirectories: true)
        let info: [String: Any] = ["CFBundleIdentifier": "dev.itestagent.script-fixture",
                                  "CFBundlePackageType": "APPL", "CFBundleExecutable": "fixture"]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: app.appendingPathComponent("Contents/Info.plist"))
        guard let bundle = Bundle(url: app) else { fatalError("Invalid fixture bundle") }
        let file = resources.appendingPathComponent("itestagent_memory_identity.py")
        try source.write(to: file)
        let request = "b4044ac9-c18b-42cb-a8bd-3093c5045404"
        func prepare(_ id: String = request, now: @escaping () -> TimeInterval = { 1 },
                     cancelled: @escaping () -> Bool = { false },
                     context: @escaping () -> Bool = { true }) throws -> PreparedMemoryIdentityQuery {
            try PreparedMemoryIdentityQuery.prepare(in: bundle, requestID: id, deadline: 10,
                                                    now: now, cancelled: cancelled, contextIsCurrent: context)
        }
        func rejects(_ expected: MemoryIdentityScriptFailure? = nil, _ work: () throws -> Void) {
            do { try work(); fatalError("Expected rejection") }
            catch let error as MemoryIdentityScriptFailure {
                if let expected { precondition(error == expected) }
            } catch { fatalError("Unexpected error type") }
        }
        let query = try prepare()
        try query.validateSource()
        precondition(query.requestID == request && query.command.utf8.count < 1024)
        rejects(.invalidRequest) { _ = try prepare("not-a-uuid") }
        rejects(.invalidRequest) { _ = try prepare(request.uppercased()) }
        rejects(.cancelled) { _ = try prepare(cancelled: { true }) }
        rejects(.deadlineExceeded) { _ = try prepare(now: { 10 }) }
        rejects(.contextChanged) { _ = try prepare(context: { false }) }
        var isCancelled = false
        rejects(.cancelled) {
            _ = try prepare(cancelled: { isCancelled }, context: { isCancelled = true; return true })
        }
        var clock: TimeInterval = 1
        rejects(.deadlineExceeded) {
            _ = try prepare(now: { clock }, context: { clock = 10; return true })
        }
        var checks = 0
        rejects(.contextChanged) {
            _ = try prepare(context: { checks += 1; return checks == 1 })
        }
        try Data("changed".utf8).write(to: file)
        rejects(.resourceChanged) { _ = try prepare() }
        rejects { try query.validateSource() }
        try fm.removeItem(at: file)
        rejects(.resourceUnavailable) { _ = try prepare() }
        let other = root.appendingPathComponent("other.py")
        try source.write(to: other)
        try fm.createSymbolicLink(at: file, withDestinationURL: other)
        rejects(.resourceUnavailable) { _ = try prepare() }
        try fm.removeItem(at: file)
        try fm.linkItem(at: other, to: file)
        rejects(.resourceUnavailable) { _ = try prepare() }
        try fm.removeItem(at: file)
        precondition(mkfifo(file.path, 0o600) == 0)
        rejects(.resourceUnavailable) { _ = try prepare() }
        try fm.removeItem(at: file)
        try fm.createDirectory(at: file, withIntermediateDirectories: false)
        rejects(.resourceUnavailable) { _ = try prepare() }
        try fm.removeItem(at: file)
        try Data().write(to: file)
        rejects(.resourceUnavailable) { _ = try prepare() }
        try Data(repeating: 32, count: 16385).write(to: file)
        rejects(.resourceUnavailable) { _ = try prepare() }
        try fm.removeItem(at: file)
        try source.write(to: file)
        let beforeReplacement = try prepare()
        let replacement = resources.appendingPathComponent("replacement")
        try source.write(to: replacement)
        try fm.removeItem(at: file)
        try fm.moveItem(at: replacement, to: file)
        rejects(.resourceChanged) { try beforeReplacement.validateSource() }
        let final = try prepare()
        let output: [String: Any] = ["fixedResource": true, "mutationBlocked": true,
                                     "cancelAndDrift": true, "deadline": true,
                                     "command": final.command, "requestID": request]
        print(String(decoding: try JSONSerialization.data(withJSONObject: output), as: UTF8.self))
    }
}
