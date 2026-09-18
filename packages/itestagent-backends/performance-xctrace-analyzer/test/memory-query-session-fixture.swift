import ApplicationServices
import Foundation

final class SubmissionFixture: MemoryConsoleSubmissionAdapter {
    var input = "(lldb) "
    var caret = 7
    var selectedLength = 0
    var writable = true
    var advertised = [kAXConfirmAction]
    var writes = 0
    var confirms = 0
    var failInsert = false
    var failConfirm = false
    var alterInsert = false
    var afterWrite: () -> Void = {}
    var afterConfirm: () -> Void = {}
    func setTimeout(_ seconds: Float) throws { precondition(seconds > 0 && seconds <= 0.5) }
    func characterCount() throws -> Int { input.utf16.count }
    func text(in range: CFRange) throws -> String {
        precondition(range.length <= 1031)
        return (input as NSString).substring(with: NSRange(location: range.location, length: range.length))
    }
    func selection() throws -> CFRange { CFRange(location: caret, length: selectedLength) }
    func selectedTextIsSettable() throws -> Bool { writable }
    func actions() throws -> [String] { advertised }
    func insertSelectedText(_ command: String) throws {
        writes += 1
        input += alterInsert ? "wrong" : command
        caret = input.utf16.count
        afterWrite()
        if failInsert { throw MemoryConsoleSubmissionFailure.insertionFailed }
    }
    func confirm() throws {
        confirms += 1
        afterConfirm()
        if failConfirm { throw MemoryConsoleSubmissionFailure.confirmationFailed }
    }
}

final class ExchangeOutput: MemoryConsoleResponseReader {
    var value = "history\n"
    func setTimeout(_ seconds: Float) throws {}
    func characterCount() throws -> Int { value.utf16.count }
    func text(in range: CFRange) throws -> String {
        (value as NSString).substring(with: NSRange(location: range.location, length: range.length))
    }
}


final class ReturnTransportFixture: MemoryConsoleReturnTransport {
    var ax = true; var events = true; var owner = true
    var downs = 0; var ups = 0
    var failDown = false; var failUp = false
    var afterDown: () -> Void = {}; var afterUp: () -> Void = {}
    func permissionsAvailable() -> Bool { ax && events }
    func originalInstanceIsCurrent() -> Bool { owner }
    func postReturnDown() throws {
        downs += 1; afterDown()
        if failDown { throw MemoryConsoleReturnFailure.eventUnavailable }
    }
    func postReturnUp() throws {
        ups += 1; afterUp()
        if failUp { throw MemoryConsoleReturnFailure.eventUnavailable }
    }
}
final class QueryOwnerFixture: MemoryOwnedAppEnvironment {
    var alive = true
    func hasExistingInstance() -> Bool { false }
    func launch(_ completion: @escaping (Int?, Bool) -> Void) { completion(1, false) }
    func isExpected(_ app: Int) -> Bool { true }
    func isTerminated(_ app: Int) -> Bool { !alive }
    func instancePresence(_ app: Int) -> MemoryOwnedAppPresence { .owned }
    func mayTerminate(_ app: Int) -> Bool { true }
    func terminate(_ app: Int) -> Bool { alive = false; return true }
}
@main struct QueryTests {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let resources = root.appendingPathComponent("Submit.app/Contents/Resources")
        let fm = FileManager.default
        try fm.createDirectory(at: resources, withIntermediateDirectories: true)
        let info = ["CFBundleIdentifier": "dev.itestagent.submit-fixture", "CFBundlePackageType": "APPL",
                    "CFBundleExecutable": "fixture"]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: root.appendingPathComponent("Submit.app/Contents/Info.plist"))
        let file = resources.appendingPathComponent("itestagent_memory_identity.py")
        try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])).write(to: file)
        let query = try PreparedMemoryIdentityQuery.prepare(in: Bundle(url: root.appendingPathComponent("Submit.app"))!,
            requestID: "b4044ac9-c18b-42cb-a8bd-3093c5045404", deadline: 10,
            now: { 1 }, cancelled: { false }, contextIsCurrent: { true })


        var successfulEnvelope = ""
        for mode in 0..<9 {
            let env = QueryOwnerFixture()
            let ownerSession = MemoryOwnedAppSession(environment: env, deadline: 10, now: { 1 })
            precondition(ownerSession.ownedHandle(sessionID: UUID()) == nil)
            ownerSession.start()
            let id = UUID()
            let owner = ownerSession.ownedHandle(sessionID: id)!
            precondition(owner === ownerSession.ownedHandle(sessionID: id))
            precondition(ownerSession.ownedHandle(sessionID: UUID()) == nil)
            let grant = MemoryQueryGrant(owner: owner, query: query, deadline: 10, now: { 1 }, decision: { _ in mode != 1 })
            let input = SubmissionFixture(); input.advertised = []
            let output = ExchangeOutput(); let transport = ReturnTransportFixture()
            var cancel = mode == 2
            var clock: TimeInterval = mode == 3 ? 10 : 1
            let session = MemoryQuerySession(owner: owner, query: query, grant: grant, deadline: 10,
                now: { clock }, cancelled: { cancel })
            if mode == 4 { ownerSession.close() }
            if mode == 5 { input.afterWrite = { cancel = true } }
            if mode == 6 { transport.afterDown = { cancel = true } }
            let payload: [String: Any] = ["protocolVersion": 1, "requestId": query.requestID, "status": "observed",
                "debuggerId": 0, "processInstance": 1, "pid": 123, "moduleUUID": String(repeating: "a", count: 32),
                "triple": "arm64-apple-ios", "platform": "fixture", "executable": "/fixture/app"]
            let response = "ITESTAGENT_MEMORY_IDENTITY " + String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self) + "\n"
            var factories = 0
            func make() throws -> any MemoryQueryExchange {
                factories += 1
                return try MemoryConsoleReturnExchange(adapter: input, output: output, transport: transport,
                    query: query, deadline: 10, now: { clock }, cancelled: { cancel },
                    contextIsCurrent: { owner.isCurrent() })
            }
            session.start(makeExchange: make)
            session.start(makeExchange: make)
            if mode == 7 { clock = 10 }
            if mode == 8 { ownerSession.close() }
            if mode == 0 { output.value += response }
            session.tick()
            precondition(session.state == .terminal)
            if mode == 0 { precondition(session.candidate?.line == String(response.dropLast())) }
            else { precondition(session.candidate == nil) }
            precondition(factories == ((1...4).contains(mode) ? 0 : 1))
            precondition(input.writes == ((1...4).contains(mode) ? 0 : 1))
            precondition(transport.downs == ((1...5).contains(mode) ? 0 : 1))
            precondition(transport.ups == transport.downs)
            let line = try session.resultLine()
            if mode == 0 { successfulEnvelope = line }
            let replay = MemoryQuerySession(owner: owner, query: query, grant: grant, deadline: 10,
                                           now: { 1 }, cancelled: { false })
            replay.start(makeExchange: { fatalError("Consumed grant reused") })
            precondition(replay.state == .terminal && replay.candidate == nil)
            ownerSession.close(); precondition(!owner.isCurrent())
        }
        // Identical PID-like fixture values cannot substitute another owned object.
        let first = MemoryOwnedAppSession(environment: QueryOwnerFixture(), deadline: 10, now: { 1 })
        let second = MemoryOwnedAppSession(environment: QueryOwnerFixture(), deadline: 10, now: { 1 })
        first.start(); second.start()
        let id = UUID(); let a = first.ownedHandle(sessionID: id)!; let b = second.ownedHandle(sessionID: id)!
        let grant = MemoryQueryGrant(owner: a, query: query, deadline: 10, now: { 1 }, decision: { _ in true })
        let wrong = MemoryQuerySession(owner: b, query: query, grant: grant, deadline: 10,
                                      now: { 1 }, cancelled: { false })
        wrong.start(makeExchange: { fatalError("Wrong owner accepted") })
        let retry = MemoryQuerySession(owner: a, query: query, grant: grant, deadline: 10,
                                      now: { 1 }, cancelled: { false })
        retry.start(makeExchange: { fatalError("Wrong owner failure did not consume grant") })
        let different = try PreparedMemoryIdentityQuery.prepare(in: Bundle(url: root.appendingPathComponent("Submit.app"))!,
            requestID: "b4044ac9-c18b-42cb-a8bd-3093c5045405", deadline: 10,
            now: { 1 }, cancelled: { false }, contextIsCurrent: { true })
        let bound = MemoryQueryGrant(owner: a, query: query, deadline: 10, now: { 1 }, decision: { _ in true })
        let mismatch = MemoryQuerySession(owner: a, query: different, grant: bound, deadline: 10,
                                         now: { 1 }, cancelled: { false })
        mismatch.start(makeExchange: { fatalError("Request/command mismatch accepted") })
        precondition(mismatch.reason == "query_failed")
        var time: TimeInterval = 1
        let expiring = MemoryQueryGrant(owner: a, query: query, deadline: 5, now: { time }, decision: { _ in true })
        time = 6
        let expired = MemoryQuerySession(owner: a, query: query, grant: expiring, deadline: 10,
                                        now: { time }, cancelled: { false })
        expired.start(makeExchange: { fatalError("Expired grant accepted") })
        precondition(expired.reason == "query_failed")
        var ownerTime: TimeInterval = 1
        let shortOwner = MemoryOwnedAppSession(environment: QueryOwnerFixture(), deadline: 2, now: { ownerTime })
        shortOwner.start()
        let shortHandle = shortOwner.ownedHandle(sessionID: UUID())!
        ownerTime = 3
        precondition(!shortHandle.isCurrent())
        precondition(shortOwner.ownedHandle(sessionID: shortHandle.sessionID) == nil)
        // Framed authorization is matched to this local prepared command and owner.
        for mode in ["allow", "deny", "wrong-request", "replay", "cancel", "closed-owner"] {
            let environment = QueryOwnerFixture()
            let session = MemoryOwnedAppSession(environment: environment,
                deadline: ProcessInfo.processInfo.systemUptime + 10)
            session.start()
            let handle = session.ownedHandle(sessionID: UUID())!
            let local = MemoryQueryBinding(owner: handle, query: query)
            let cancel = MemoryIPCCancellation()
            let ipc = MemoryIPCQueryGrant(owner: handle, query: query,
                deadline: ProcessInfo.processInfo.systemUptime + 10, cancellation: cancel)
            let hello: [String: Any] = ["protocolVersion": 3, "sequence": 1, "kind": "hello",
                "sessionId": local.sessionID.uuidString.lowercased(), "requestId": local.requestID,
                "strategy": local.strategy, "commandSHA256": local.commandSHA256,
                "challenge": String(repeating: "b", count: 64)]
            let preparedFrames = try ipc.preparedFrames(hello: hello)
            precondition(preparedFrames.count == 2)
            var decision = hello; decision["kind"] = "decision"; decision["sequence"] = 4
            decision["effect"] = mode == "deny" ? "deny" : "allow"
            if mode == "wrong-request" { decision["requestId"] = UUID().uuidString.lowercased() }
            if mode == "cancel" { cancel.cancel() }
            if mode == "closed-owner" { session.close() }
            var allowed = false
            do { _ = try ipc.consume(decision: decision); allowed = true } catch {}
            precondition(allowed == ["allow", "replay"].contains(mode))
            do { _ = try ipc.consume(decision: decision); preconditionFailure("IPC grant replay") } catch {}
        }
        let summary: [String: Any] = ["ownerBound": true, "grantConsumed": true,
            "realExchangeSyntheticTransport": true, "envelope": successfulEnvelope]
        print(String(decoding: try JSONSerialization.data(withJSONObject: summary), as: UTF8.self))
    }
}
