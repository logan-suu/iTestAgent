import AppKit
import CoreServices
import Foundation

final class MetadataFixtureTransport: MemoryXcodeMetadataTransport {
    var mode = "normal"
    var calls = 0
    var context = true
    var queries = [MemoryXcodeMetadataQuery]()
    func read(_ query: MemoryXcodeMetadataQuery, deadline: Double) throws -> NSAppleEventDescriptor {
        calls += 1
        queries.append(query)
        if mode == "error" { throw MemoryMetadataError.unavailable }
        if mode == "cancel" { context = false }
        if mode == "scalar" { return NSAppleEventDescriptor(string: "unexpected") }
        let list = NSAppleEventDescriptor.list()
        if mode == "empty" { return list }
        let paths = ["/fixture/Project.xcodeproj"]
        var strings: [String]?
        var flags: [Bool]?
        switch query {
        case .documentPaths, .workspacePaths: strings = paths
        case .documentModified: flags = [false]
        case .documentFiles: preconditionFailure("file shape uses dedicated descriptors")
        case .workspaceLoaded: flags = [true]
        case .schemeIDs: strings = ["scheme-id"]
        case .deviceIDs: strings = ["fixture-device"]
        case .platforms: strings = ["iphoneos"]
        case .firstWorkspacePlatforms: return NSAppleEventDescriptor(string: "iphoneos")
        case .genericDevices: flags = [false]
        }
        if query == .documentPaths && mode.hasPrefix("extra-") { strings = paths + ["/unknown"] }
        if query == .documentModified && mode.hasPrefix("extra-") { flags = [false, mode == "extra-modified"] }
        if query == .documentPaths {
            if mode == "duplicate" { strings = paths + paths }
            if mode == "oversize" { strings = Array(repeating: paths[0], count: 33) }
            if mode == "relative" { strings = ["relative/path"] }
            if mode == "control" { strings = ["/bad\npath"] }
            if mode == "long" { strings = ["/" + String(repeating: "a", count: 4096)] }
        }
        if query == .documentModified && mode == "mismatch" { flags = [] }
        if query == .workspaceLoaded && mode == "not-loaded" { flags = [false] }
        if query == .workspacePaths && mode == "foreign" { strings = ["/foreign.xcodeproj"] }
        if query == .schemeIDs && mode == "drift" && calls > 8 { strings = ["changed"] }
        if query == .platforms {
            let variants = ["mac": "macosx", "simulator": "iphonesimulator", "qualified": "com.apple.platform.iphoneos", "display": "iOS", "other-platform": "private-unexpected-value"]
            if let variant = variants[mode] { strings = [variant] }
            if mode == "missing-platform" { list.insert(NSAppleEventDescriptor(typeCode: 0x6d736e67), at: 1); return list }
        }
        if query == .genericDevices && mode == "generic" { flags = [true] }
        if query == .deviceIDs {
            if mode == "missing-value" { list.insert(NSAppleEventDescriptor(typeCode: 0x6d736e67), at: 1); return list }
            if mode == "wrong-device" { strings = ["other-device"] }
            if mode == "empty-device" { strings = [""] }
            if mode == "typed-device" || mode == "extra-device" { list.insert(NSAppleEventDescriptor(int32: 1), at: 1); return list }
            if mode == "nested-device" {
                let nested = NSAppleEventDescriptor.list()
                nested.insert(NSAppleEventDescriptor(string: "fixture-device"), at: 1)
                list.insert(nested, at: 1); return list
            }
        }
        if mode == "bad-bool", flags != nil {
            list.insert(NSAppleEventDescriptor(int32: 0), at: 1); return list
        }
        for text in strings ?? [] { list.insert(NSAppleEventDescriptor(string: text), at: list.numberOfItems + 1) }
        for flag in flags ?? [] { list.insert(NSAppleEventDescriptor(boolean: flag), at: list.numberOfItems + 1) }
        return list
    }
}

final class PlatformComparisonFixture: MemoryXcodeMetadataTransport {
    var replies: [NSAppleEventDescriptor]
    var calls = 0
    init(_ replies: [NSAppleEventDescriptor]) { self.replies = replies }
    func read(_ query: MemoryXcodeMetadataQuery, deadline: Double) throws -> NSAppleEventDescriptor {
        calls += 1
        guard !replies.isEmpty else { throw MemoryMetadataError.unavailable }
        return replies.removeFirst()
    }
}

final class MetadataOwnerFixture: MemoryOwnedAppEnvironment {
    var exited = false
    var conflict = false
    var absent = false
    var acceptsQuit = true
    var safe = true
    var quitCount = 0
    func hasExistingInstance() -> Bool { false }
    func launch(_ completion: @escaping (Int?, Bool) -> Void) { completion(1, false) }
    func isExpected(_ app: Int) -> Bool { true }
    func isTerminated(_ app: Int) -> Bool { exited }
    func instancePresence(_ app: Int) -> MemoryOwnedAppPresence { conflict ? .conflict : absent ? .absent : .owned }
    func mayTerminate(_ app: Int) -> Bool { safe }
    func terminate(_ app: Int) -> Bool { quitCount += 1; return acceptsQuit }
}

@main struct MetadataFixture {
    static func main() throws {
        var scenarios = 0
        for query in MemoryXcodeMetadataQuery.allCases {
            let event = try query.event(pid: 123)
            precondition(event.eventClass == 0x636f7265 && event.eventID == 0x67657464)
            let target = event.attributeDescriptor(forKeyword: 0x61646472)!
            precondition(target.descriptorType == 0x6b706964)
            var specifier = event.paramDescriptor(forKeyword: 0x2d2d2d2d)!
            var depth = 0
            while specifier.descriptorType == 0x6f626a20 {
                depth += 1
                let form = specifier.forKeyword(0x666f726d)!.enumCodeValue
                if form == 0x696e6478 && query == .firstWorkspacePlatforms {
                    let index = specifier.forKeyword(0x73656c64)!
                    precondition(index.descriptorType == typeSInt32 && index.int32Value == 1)
                } else if form == 0x696e6478 {
                    let all = specifier.forKeyword(0x73656c64)!
                    var ordinal = OSType(kAEAll)
                    var raw = AEDesc()
                    precondition(AECreateDesc(typeAbsoluteOrdinal, &ordinal, MemoryLayout<OSType>.size, &raw) == noErr)
                    let canonical = NSAppleEventDescriptor(aeDescNoCopy: &raw)
                    precondition(all.descriptorType == typeAbsoluteOrdinal && all.data == canonical.data,
                                 "all-elements ordinal must match the public AE encoding")
                } else { precondition(form == 0x70726f70) }
                specifier = specifier.forKeyword(0x66726f6d)!
            }
            precondition(depth >= 2 && depth <= 4 && specifier.descriptorType == 0x6e756c6c)
            scenarios += 1
        }
        for mode in ["normal", "empty", "error", "cancel", "scalar", "duplicate", "oversize",
                     "relative", "control", "long", "mismatch", "foreign", "bad-bool", "drift", "deadline", "not-loaded",
                     "empty-device", "typed-device", "nested-device"] {
            let transport = MetadataFixtureTransport(); transport.mode = mode
            let diagnostics = MemoryMetadataDiagnostics()
            let reader = MemoryXcodeMetadataReader(transport: transport, validContext: { transport.context }, now: { 1 }, diagnostics: diagnostics)
            var passed = false
            do {
                let snapshot = try reader.snapshot(deadline: mode == "deadline" ? 1 : 2)
                precondition(snapshot.noOpenDocumentsObserved == (mode == "empty"))
                passed = true
            } catch {}
            precondition(passed == (mode == "normal" || mode == "empty"), mode)
            if mode == "not-loaded" { precondition(transport.calls == 4, "do not query unloaded workspace targets") }
            if mode == "empty-device" { precondition(diagnostics.failure == .textEmpty && diagnostics.query == .deviceIDs) }
            if mode == "typed-device" { precondition(diagnostics.failure == .itemType && diagnostics.itemDescriptorType == typeSInt32) }
            if mode == "nested-device" { precondition(diagnostics.failure == .itemType && diagnostics.itemDescriptorType == typeAEList) }
            if mode == "relative" { precondition(diagnostics.failure == .pathFormat) }
            if mode == "control" { precondition(diagnostics.failure == .textControl) }
            if mode == "long" { precondition(diagnostics.failure == .textLimit) }
            if mode == "bad-bool" { precondition(diagnostics.failure == .booleanEncoding) }
            if !passed {
                precondition(diagnostics.failure != nil)
                let first = diagnostics.fields as NSDictionary
                let calls = transport.calls
                transport.mode = "normal"; transport.context = true
                diagnostics.item(NSAppleEventDescriptor(boolean: true))
                do { _ = try reader.snapshot(deadline: 2); preconditionFailure("poisoned reader recovered") } catch {}
                precondition(transport.calls == calls)
                precondition(first == diagnostics.fields as NSDictionary)
            }
            let safe = String(decoding: try JSONSerialization.data(withJSONObject: diagnostics.fields), as: UTF8.self)
            precondition(!safe.contains("fixture") && !safe.contains("/"))
            scenarios += 1
        }
        let frozen = MemoryMetadataDiagnostics()
        frozen.begin(.deviceIDs); frozen.fail(.send, status: -1743)
        frozen.begin(.schemeIDs); frozen.fail(.reply, status: 2)
        precondition(frozen.query == .deviceIDs && frozen.failure == .send && frozen.osStatus == -1743)
        let bounded = MemoryMetadataDiagnostics(); bounded.fail(.send, status: 100001)
        precondition(bounded.osStatus == nil)
        var clock = 1.0
        let launch = MemoryMetadataLaunchReadiness(deadline: 3, now: { clock })
        precondition(launch.observe(ownerCurrent: true, finishedLaunching: false, cancelled: false) == .waiting)
        clock = 2
        precondition(launch.observe(ownerCurrent: true, finishedLaunching: true, cancelled: false) == .ready)
        for mode in ["expired", "owner", "cancelled", "nonfinite"] {
            let gate = MemoryMetadataLaunchReadiness(deadline: mode == "nonfinite" ? .nan : 3, now: { clock })
            clock = mode == "expired" ? 3 : 2
            precondition(gate.observe(ownerCurrent: mode != "owner", finishedLaunching: true,
                                      cancelled: mode == "cancelled") == .unavailable)
            clock = 1
            precondition(gate.observe(ownerCurrent: true, finishedLaunching: true, cancelled: false) == .unavailable)
            scenarios += 1
        }
        scenarios += 1
        let timing = MemoryMetadataDiagnostics()
        timing.begin(.documentPaths); timing.launch(true); timing.elapsed(0.501)
        precondition(timing.finishedLaunching == true && timing.elapsedMs == 501)
        timing.elapsed(.infinity); precondition(timing.elapsedMs == 501)
        timing.elapsed(-1); precondition(timing.elapsedMs == 0)
        timing.elapsed(Double.greatestFiniteMagnitude); precondition(timing.elapsedMs == 10000)
        timing.fail(.send, status: -1712)
        timing.launch(false); timing.elapsed(1); timing.begin(.deviceIDs)
        precondition(timing.finishedLaunching == true && timing.elapsedMs == 10000 && timing.query == .documentPaths)
        scenarios += 1
        for mode in ["valid", "modified", "unloaded", "foreign", "missing-scheme", "missing-device", "platform", "generic", "extra"] {
            let snapshot = MemoryXcodeMetadataSnapshot(documentPaths: ["/fixture/Project.xcodeproj"],
                documentModified: [mode == "modified"],
                workspacePaths: mode == "extra" ? [] : ["/fixture/Project.xcodeproj"],
                workspaceLoaded: [mode != "unloaded"], schemeIDs: mode == "missing-scheme" ? [] : ["scheme"],
                deviceIDs: mode == "missing-device" ? [] : ["device"],
                platforms: [mode == "platform" ? "iphoneos" : "macosx"], genericDevices: [mode == "generic"])
            precondition(snapshot.isSingleUnmodifiedWorkspace(platform: "macosx", matchesDocument: { _ in mode != "foreign" }) == (mode == "valid"))
            precondition(snapshot.isSingleUnmodifiedDocument(matchesDocument: { _ in mode != "foreign" }) ==
                         (!["modified", "unloaded", "foreign", "extra"].contains(mode)))
            let checks = snapshot.documentMatchChecks(matchesDocument: { _ in mode != "foreign" })
            precondition(checks == ["singleDocument": true, "workspaceMatchesDocuments": mode != "extra",
                                   "unmodified": mode != "modified", "loaded": mode != "unloaded",
                                   "directoryMatches": mode != "foreign"])
            scenarios += 1
        }
        for mode in ["empty", "loading", "loaded", "multiple", "wrong-type"] {
            let list = NSAppleEventDescriptor.list()
            if mode != "empty" { list.insert(mode == "wrong-type" ? NSAppleEventDescriptor(int32: 1) : NSAppleEventDescriptor(boolean: mode != "loading"), at: 1) }
            if mode == "multiple" { list.insert(NSAppleEventDescriptor(boolean: true), at: 2) }
            var result: MemoryWorkspaceLoadingObservation?
            do { result = try memoryWorkspaceLoadingObservation(list) } catch {}
            if mode == "multiple" || mode == "wrong-type" { precondition(result == nil) }
            else { precondition(result == (mode == "loaded" ? .loaded : .waiting)) }
            scenarios += 1
        }
        func expectBudget(_ actual: Double, _ expected: Double) { precondition(actual == expected) }
        let startup = MemoryMetadataSendBudget(initialRead: true)
        expectBudget(try startup.take(.documentPaths, remaining: 20), 8)
        expectBudget(try startup.take(.documentPaths, remaining: 20), 2)
        let boundedStartup = MemoryMetadataSendBudget(initialRead: true)
        expectBudget(try boundedStartup.take(.documentPaths, remaining: 0.5), 0.5)
        let defaultBudget = MemoryMetadataSendBudget()
        expectBudget(try defaultBudget.take(.documentPaths, remaining: 20), 2)
        for remaining in [0.0, -1, Double.nan, Double.infinity] {
            let budget = MemoryMetadataSendBudget(initialRead: true)
            do { _ = try budget.take(.documentPaths, remaining: remaining); preconditionFailure("invalid budget") } catch {}
            expectBudget(try budget.take(.documentPaths, remaining: 20), 2)
        }
        let wrongFirst = MemoryMetadataSendBudget(initialRead: true)
        do { _ = try wrongFirst.take(.deviceIDs, remaining: 20); preconditionFailure("unexpected initial query") } catch {}
        expectBudget(try wrongFirst.take(.documentPaths, remaining: 20), 2)
        scenarios += 1
        for mode in ["normal", "empty-device", "typed-device", "nested-device"] {
            let transport = MetadataFixtureTransport(); transport.mode = mode
            let documents = MemoryXcodeMetadataReader(transport: transport, validContext: { true }, now: { 1 })
            let snapshot = try documents.snapshot(deadline: 2, documentsOnly: true)
            precondition(snapshot.isSingleUnmodifiedDocument(matchesDocument: { $0 == "/fixture/Project.xcodeproj" }))
            precondition(!snapshot.isSingleUnmodifiedWorkspace(platform: "iphoneos", matchesDocument: { _ in true }))
            precondition(transport.queries == [.documentPaths, .documentModified, .workspacePaths, .workspaceLoaded,
                                               .documentPaths, .documentModified, .workspacePaths, .workspaceLoaded])
            let target = MemoryXcodeMetadataReader(transport: transport, validContext: { true }, now: { 1 })
            var complete = false
            do { _ = try target.snapshot(deadline: 2); complete = true } catch {}
            precondition(complete == (mode == "normal"))
            let fresh = try documents.snapshot(deadline: 2, documentsOnly: true)
            precondition(fresh == snapshot)
            scenarios += 1
        }
        for mode in ["eligible", "modified", "workspace", "binding", "missing", "unloaded"] {
            let snapshot = MemoryXcodeMetadataSnapshot(documentPaths: ["/fixture/Project.xcodeproj", "/unknown"],
                documentModified: mode == "missing" ? [] : [false, mode == "modified"],
                workspacePaths: mode == "workspace" ? ["/fixture/Project.xcodeproj", "/unknown"] : ["/fixture/Project.xcodeproj"],
                workspaceLoaded: [mode != "unloaded"], schemeIDs: [], deviceIDs: [], platforms: [], genericDevices: [])
            precondition(snapshot.permitsTargetDiagnostic(matchesDocument: { _ in mode != "binding" }) == (mode == "eligible"))
            precondition(!snapshot.isSingleUnmodifiedDocument(matchesDocument: { _ in true }))
            scenarios += 1
        }
        for mode in ["mixed", "wrong-count", "scalar", "oversized"] {
            let list = NSAppleEventDescriptor.list()
            list.insert(NSAppleEventDescriptor(typeCode: 0x6d736e67), at: 1)
            list.insert(NSAppleEventDescriptor(descriptorType: typeFileURL, data: Data("file:///private/secret".utf8))!, at: 2)
            list.insert(NSAppleEventDescriptor(descriptorType: typeAlias, data: Data([1]))!, at: 3)
            list.insert(NSAppleEventDescriptor(string: "private-payload"), at: 4)
            if mode == "oversized" { list.insert(NSAppleEventDescriptor(string: String(repeating: "x", count: 70000)), at: 5) }
            var summary: [String: Any]?
            do { summary = try memoryDocumentFileSummary(mode == "scalar" ? NSAppleEventDescriptor(string: "bad") : list,
                                                        expectedCount: mode == "wrong-count" ? 3 : mode == "oversized" ? 5 : 4) } catch {}
            precondition((summary != nil) == (mode == "mixed"))
            if let summary {
                precondition(summary["missingCount"] as? Int == 1 && summary["fileRepresentationCount"] as? Int == 2 && summary["unknownCount"] as? Int == 1)
                let json = String(decoding: try JSONSerialization.data(withJSONObject: summary), as: UTF8.self)
                precondition(!json.contains("private") && !json.contains("secret"))
            }
            scenarios += 1
        }
        for mode in ["extra-normal", "extra-modified", "extra-device", "extra-changed"] {
            let transport = MetadataFixtureTransport(); transport.mode = mode
            let diagnostics = MemoryMetadataDiagnostics()
            let reader = MemoryXcodeMetadataReader(transport: transport, validContext: { true }, now: { 1 }, diagnostics: diagnostics)
            var passes = 0
            var succeeded = false
            do {
                let snapshot = try reader.snapshot(deadline: 2, targetEligibility: { documents in
                    passes += 1
                    return !(mode == "extra-changed" && passes == 2) && documents.permitsTargetDiagnostic { $0 == "/fixture/Project.xcodeproj" }
                })
                succeeded = true
                precondition(!snapshot.isSingleUnmodifiedDocument(matchesDocument: { _ in true }))
            } catch {}
            precondition(succeeded == (mode == "extra-normal"))
            if mode == "extra-modified" { precondition(transport.calls == 4) }
            if mode == "extra-device" { precondition(diagnostics.query == .deviceIDs && diagnostics.failure == .itemType) }
            if mode == "extra-changed" { precondition(transport.calls == 12) }
            scenarios += 1
        }
        let deniedTransport = MetadataFixtureTransport()
        let deniedReader = MemoryXcodeMetadataReader(transport: deniedTransport, validContext: { true }, now: { 1 })
        do { _ = try deniedReader.snapshot(deadline: 2, targetEligibility: { _ in false }); preconditionFailure("unsafe target read") } catch {}
        precondition(deniedTransport.queries == [.documentPaths, .documentModified, .workspacePaths, .workspaceLoaded])
        scenarios += 1
        let directory = URL(fileURLWithPath: "/private/tmp/itestagent-metadata-summary-" + UUID().uuidString)
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: directory) }
        let root = directory.appendingPathComponent("owned")
        let project = root.appendingPathComponent("Fixture.xcodeproj")
        let sibling = directory.appendingPathComponent("owned-other")
        try fileManager.createDirectory(at: project, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: sibling, withIntermediateDirectories: true)
        try fileManager.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: sibling)
        for url in [project.appendingPathComponent("project.pbxproj"), root.appendingPathComponent("main.swift"),
                    sibling.appendingPathComponent("main.swift")] { try Data().write(to: url) }
        let paths = [project.path, project.appendingPathComponent("project.pbxproj").path,
                     root.appendingPathComponent("main.swift").path, sibling.appendingPathComponent("main.swift").path,
                     root.appendingPathComponent("escape").path, root.appendingPathComponent("missing").path]
        let summarySnapshot = MemoryXcodeMetadataSnapshot(documentPaths: paths, documentModified: [false, false, true, false, false, false],
            workspacePaths: [project.path], workspaceLoaded: [true], schemeIDs: [], deviceIDs: [], platforms: [], genericDevices: [])
        let summary = summarySnapshot.documentLocationSummary(project: project)
        precondition(summary as NSDictionary == ["valid": true, "documentCount": 6, "workspaceCount": 1,
            "modifiedCount": 1, "expectedProjectCount": 1, "projectDescendantCount": 1,
            "temporaryRootDescendantCount": 1, "outsideCount": 2, "unresolvedCount": 1,
            "resolutionErrors": ["missing": 1, "notDirectory": 0, "permission": 0, "symlinkLoop": 0, "tooLong": 0, "other": 0]] as NSDictionary, String(describing: summary))
        let encoded = String(decoding: try JSONSerialization.data(withJSONObject: summary), as: UTF8.self)
        precondition(!encoded.contains(directory.path) && !encoded.contains("Fixture") && !encoded.contains("main.swift"))
        precondition(!summarySnapshot.isSingleUnmodifiedDocument(matchesDocument: { _ in true }))
        scenarios += 1
        for (value, expected) in [
            (NSAppleEventDescriptor(typeCode: 0x6d736e67), "missingValue"),
            (NSAppleEventDescriptor(typeCode: 0x54455854), "otherType"),
            (NSAppleEventDescriptor(descriptorType: typeType, data: Data([1]))!, "malformed")
        ] {
            let diagnostic = MemoryMetadataDiagnostics()
            diagnostic.begin(.deviceIDs); diagnostic.item(value)
            precondition(diagnostic.itemTypeClass == expected)
            diagnostic.fail(.itemType)
            diagnostic.item(NSAppleEventDescriptor(string: "sensitive"))
            diagnostic.begin(.documentFiles)
            precondition(diagnostic.itemTypeClass == expected && diagnostic.query == .deviceIDs)
            scenarios += 1
        }
        let resetting = MemoryMetadataDiagnostics()
        resetting.item(NSAppleEventDescriptor(typeCode: 0x6d736e67))
        resetting.begin(.schemeIDs)
        precondition(resetting.itemTypeClass == nil)
        resetting.item(NSAppleEventDescriptor(typeCode: 0x6d736e67))
        resetting.item(NSAppleEventDescriptor(string: "private"))
        precondition(resetting.itemTypeClass == nil)
        scenarios += 1
        for (code, expected) in [(ENOENT, "missing"), (ENOTDIR, "notDirectory"),
                                 (EACCES, "permission"), (EPERM, "permission"),
                                 (ELOOP, "symlinkLoop"), (ENAMETOOLONG, "tooLong"), (EIO, "other")] {
            precondition(memoryPathResolutionFailure(code) == expected)
        }
        precondition((summary["resolutionErrors"] as? [String: Int])?["missing"] == 1)
        scenarios += 1
        for mode in ["exit", "cancel", "alive", "absent", "conflict", "observed-conflict", "late", "refused", "changed", "wrong-owner", "binding"] {
            var now = 1.0
            let environment = MetadataOwnerFixture()
            let session = MemoryOwnedAppSession(environment: environment, deadline: 10, cleanupTimeout: 1, now: { now })
            session.start()
            let owner = session.ownedHandle(sessionID: UUID())!
            let documents = MemoryXcodeMetadataSnapshot(documentPaths: ["/project", "/missing"], documentModified: [false, false],
                workspacePaths: ["/project"], workspaceLoaded: [true], schemeIDs: [], deviceIDs: [], platforms: [], genericDevices: [])
            let lifetime = MemoryDocumentProcessLifetime(owner: owner)!
            precondition(lifetime.sessionID == owner.sessionID && lifetime.closureSource == nil)
            let grant = MemoryMetadataQuitGrant(owner: owner, documents: documents, deadline: 10, now: { now }, matchesDocument: { _ in true })!
            let otherEnvironment = MetadataOwnerFixture()
            let otherSession = MemoryOwnedAppSession(environment: otherEnvironment, deadline: 10, now: { now })
            otherSession.start()
            let other = otherSession.ownedHandle(sessionID: UUID())!
            session.close(mode == "cancel" ? .cancelled : .completed)
            let fresh = mode == "changed" ? MemoryXcodeMetadataSnapshot(documentPaths: documents.documentPaths,
                documentModified: [false, true], workspacePaths: documents.workspacePaths, workspaceLoaded: [true],
                schemeIDs: [], deviceIDs: [], platforms: [], genericDevices: []) : documents
            let allowed = grant.consume(owner: mode == "wrong-owner" ? other : owner, documents: fresh, matchesDocument: { _ in mode != "binding" })
            precondition(allowed == (!["changed", "wrong-owner", "binding"].contains(mode)))
            precondition(!grant.consume(owner: owner, documents: documents, matchesDocument: { _ in true }))
            if mode == "refused" { environment.acceptsQuit = false }
            environment.safe = allowed
            session.tick()
            precondition(lifetime.closureSource == nil, "Quit acceptance is not exit")
            if mode == "observed-conflict" {
                environment.conflict = true; precondition(!owner.canObserve()); environment.conflict = false
            }
            environment.exited = !["alive", "absent"].contains(mode)
            environment.absent = mode == "absent"
            environment.conflict = mode == "conflict"
            if mode == "late" { now = 3 }
            session.tick()
            let proven = !["alive", "absent", "conflict", "observed-conflict", "late", "refused", "changed", "wrong-owner", "binding"].contains(mode)
            precondition((lifetime.closureSource == "owner_process_exited") == proven, mode)
            precondition(environment.quitCount == (allowed ? 1 : 0))
            if !proven {
                now = 4; session.tick(); environment.exited = true; environment.conflict = false; session.tick()
                precondition(lifetime.closureSource == nil, "Late exit cannot repair an unknown terminal result")
            }
            scenarios += 1
        }
        let physical = MemoryPhysicalDestination(expectedID: "fixture-device")!
        for invalid in ["", "device\n", " device", String(repeating: "a", count: 257)] {
            precondition(MemoryPhysicalDestination(expectedID: invalid) == nil)
        }
        for mode in ["normal", "mac", "generic", "missing-value", "wrong-device", "scalar", "typed-device", "cancel", "expired"] {
            let transport = MetadataFixtureTransport(); transport.mode = mode
            var observation: MemoryDestinationSelection?
            do {
                observation = try memoryDestinationSelection(transport: transport, target: physical,
                    deadline: mode == "expired" ? 1 : 2, validContext: { transport.context }, now: { 1 })
            } catch {}
            if ["scalar", "typed-device", "cancel", "expired"].contains(mode) { precondition(observation == nil) }
            else { precondition(observation == (mode == "normal" ? .selected : .waiting)) }
            if mode == "mac" { precondition(transport.queries == [.platforms]) }
            if mode == "generic" { precondition(transport.queries == [.platforms, .genericDevices]) }
            if mode == "expired" { precondition(transport.calls == 0) }
            scenarios += 1
        }
        for mode in ["normal", "wrong-device", "mac", "generic"] {
            let transport = MetadataFixtureTransport(); transport.mode = mode
            let reader = MemoryXcodeMetadataReader(transport: transport, validContext: { true }, now: { 1 })
            let snapshot = try reader.snapshot(deadline: 2)
            precondition(physical.matches(snapshot) == (mode == "normal"))
            scenarios += 1
        }
        for (mode, reason) in [("normal", "selected"), ("mac", "platformMac"), ("simulator", "platformSimulator"),
                               ("qualified", "platformQualifiedIOS"), ("display", "platformDisplayIOS"),
                               ("other-platform", "platformOther"), ("missing-platform", "platformMissing"),
                               ("generic", "genericDestination"), ("missing-value", "deviceMissing"), ("wrong-device", "deviceMismatch")] {
            let transport = MetadataFixtureTransport(); transport.mode = mode
            let diagnostics = MemoryMetadataDiagnostics()
            _ = try memoryDestinationSelection(transport: transport, target: physical, deadline: 2,
                validContext: { true }, now: { 1 }, diagnostics: diagnostics)
            precondition(diagnostics.selectionReason?.rawValue == reason)
            precondition(diagnostics.descriptorType == typeAEList && diagnostics.itemCount == 1 && diagnostics.itemDescriptorType != nil)
            let encoded = String(decoding: try JSONSerialization.data(withJSONObject: diagnostics.fields), as: UTF8.self)
            precondition(!encoded.contains("private-unexpected-value") && !encoded.contains("fixture-device"))
            diagnostics.fail(.validation); diagnostics.selection(.checking)
            precondition(diagnostics.selectionReason?.rawValue == reason)
            scenarios += 1
        }
        for mode in ["normal", "missing-platform", "other-platform", "scalar", "error", "cancel"] {
            let transport = MetadataFixtureTransport(); transport.mode = mode
            var output: [String: String]?
            do { output = try memoryPlatformComparison(transport: transport, deadline: 2,
                validContext: { transport.context }, now: { 1 }) } catch {}
            if ["scalar", "error", "cancel"].contains(mode) { precondition(output == nil) }
            else {
                precondition(output?["singleWorkspace"] == "iphoneos")
                precondition(output?["classificationStable"] == "yes")
                precondition(output?["collectionBefore"] == (mode == "normal" ? "iphoneos" : mode == "missing-platform" ? "missing" : "other"))
                precondition(transport.queries == [.platforms, .firstWorkspacePlatforms, .platforms])
            }
            scenarios += 1
        }
        let missing = NSAppleEventDescriptor(typeCode: 0x6d736e67)
        func platformList(_ value: NSAppleEventDescriptor) -> NSAppleEventDescriptor {
            let list = NSAppleEventDescriptor.list(); list.insert(value, at: 1); return list
        }
        let missingList = platformList(missing)
        for scalar in [missing, NSAppleEventDescriptor(string: "iphoneos"),
                       NSAppleEventDescriptor(string: "macosx"), NSAppleEventDescriptor(string: "iphonesimulator"),
                       NSAppleEventDescriptor(string: "private-platform-name")] {
            let transport = PlatformComparisonFixture([missingList, scalar, missingList])
            let result = try memoryPlatformComparison(transport: transport, deadline: 2, validContext: { true }, now: { 1 })
            precondition(result["collectionBefore"] == "missing" && result["classificationStable"] == "yes")
            precondition(!result.values.contains("private-platform-name"))
            scenarios += 1
        }
        for scalar in [NSAppleEventDescriptor.list(), NSAppleEventDescriptor(int32: 1),
                       NSAppleEventDescriptor(string: ""), NSAppleEventDescriptor(string: "bad\nvalue"),
                       NSAppleEventDescriptor(string: String(repeating: "a", count: 257)),
                       NSAppleEventDescriptor(typeCode: 0x61626364)] {
            let transport = PlatformComparisonFixture([missingList, scalar, missingList])
            var rejected = false
            do { _ = try memoryPlatformComparison(transport: transport, deadline: 2, validContext: { true }, now: { 1 }) }
            catch { rejected = true }
            precondition(rejected && transport.calls == 2)
            scenarios += 1
        }
        let drift = PlatformComparisonFixture([missingList, missing, platformList(NSAppleEventDescriptor(string: "iphoneos"))])
        let driftResult = try memoryPlatformComparison(transport: drift, deadline: 2, validContext: { true }, now: { 1 })
        precondition(driftResult["classificationStable"] == "no")
        scenarios += 1
        for expired in [false, true] {
            let transport = PlatformComparisonFixture([missingList, missing, missingList])
            var rejected = false
            do { _ = try memoryPlatformComparison(transport: transport, deadline: expired ? 1 : 2,
                validContext: { transport.calls == 0 }, now: { 1 }) } catch { rejected = true }
            precondition(rejected && transport.calls == (expired ? 0 : 1))
            scenarios += 1
        }
        print("{\"scenarios\":\(scenarios),\"noAppleEventsSent\":true}")
    }
}
