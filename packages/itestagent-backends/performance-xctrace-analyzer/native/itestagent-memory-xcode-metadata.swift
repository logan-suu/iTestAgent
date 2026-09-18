import AppKit
import CoreServices
import Foundation
import Darwin

enum MemoryMetadataError: Error { case unavailable, invalid, changed }

// One-shot launch observation only, never Apple Events readiness or target proof.
final class MemoryMetadataLaunchReadiness {
    enum State { case waiting, ready, unavailable }
    private(set) var state = State.waiting
    private let deadline: Double
    private let now: () -> Double
    init(deadline: Double, now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime }) {
        self.deadline = deadline; self.now = now
    }
    func observe(ownerCurrent: Bool, finishedLaunching: Bool, cancelled: Bool) -> State {
        guard state == .waiting else { return state }
        guard ownerCurrent, !cancelled, deadline.isFinite, now() < deadline else {
            state = .unavailable; return state
        }
        if finishedLaunching { state = .ready }
        return state
    }
}

enum MemoryMetadataFailure: String {
    case context, send, reply, shape, validation, changed
    case itemType, textUnavailable, textEmpty, textLimit, textControl, pathFormat, booleanEncoding
}
enum MemorySelectionReason: String {
    case checking, platformMissing, platformMac, platformSimulator, platformOther
    case platformQualifiedIOS, platformDisplayIOS
    case genericDestination, deviceMissing, deviceMismatch, selected
}
final class MemoryMetadataDiagnostics {
    private(set) var selectionReason: MemorySelectionReason?
    func selection(_ reason: MemorySelectionReason) {
        if failure == nil { selectionReason = reason }
    }
    private(set) var query: MemoryXcodeMetadataQuery?
    private(set) var failure: MemoryMetadataFailure?
    private(set) var descriptorType: UInt32?
    private(set) var itemCount: Int?
    private(set) var osStatus: Int?
    private(set) var finishedLaunching: Bool?
    private(set) var elapsedMs: Int?
    private(set) var itemDescriptorType: UInt32?
    private(set) var itemTypeClass: String?
    func begin(_ query: MemoryXcodeMetadataQuery) {
        guard failure == nil else { return }
        self.query = query; descriptorType = nil; itemCount = nil; finishedLaunching = nil; elapsedMs = nil; itemDescriptorType = nil; itemTypeClass = nil
    }
    func launch(_ finished: Bool) { if failure == nil { finishedLaunching = finished } }
    func elapsed(_ seconds: Double) {
        guard failure == nil, seconds.isFinite else { return }
        elapsedMs = Int(min(10000, max(0, seconds * 1000)))
    }
    func shape(_ value: NSAppleEventDescriptor) {
        guard failure == nil else { return }
        descriptorType = value.descriptorType
        itemCount = min(33, max(0, value.numberOfItems))
    }
    func fail(_ reason: MemoryMetadataFailure, status: Int? = nil) {
        guard failure == nil else { return }
        failure = reason
        if let status, (-100000...100000).contains(status) { osStatus = status }
    }
    func item(_ value: NSAppleEventDescriptor) {
        guard failure == nil else { return }
        itemDescriptorType = value.descriptorType
        itemTypeClass = nil
        if value.descriptorType == typeType {
            itemTypeClass = value.data.count != 4 ? "malformed" :
                value.typeCodeValue == 0x6d736e67 ? "missingValue" : "otherType"
        }
    }
    var fields: [String: Any] {
        var result: [String: Any] = ["stage": query?.rawValue ?? "context", "failure": failure?.rawValue ?? "none"]
        if let selectionReason { result["selectionReason"] = selectionReason.rawValue }
        if let descriptorType { result["descriptorType"] = descriptorType }
        if let itemCount { result["itemCount"] = itemCount }
        if let osStatus { result["osStatus"] = osStatus }
        if let finishedLaunching { result["finishedLaunching"] = finishedLaunching }
        if let elapsedMs { result["elapsedMs"] = elapsedMs }
        if let itemDescriptorType { result["itemDescriptorType"] = itemDescriptorType }
        if let itemTypeClass { result["itemTypeClass"] = itemTypeClass }
        return result
    }
}

// These are the only requests exposed to the transport. No caller-controlled
// event, property, script, document specifier or application address is accepted.
enum MemoryXcodeMetadataQuery: String, CaseIterable {
    case documentPaths, documentModified, documentFiles, workspacePaths, workspaceLoaded
    case schemeIDs, deviceIDs, platforms, genericDevices, firstWorkspacePlatforms

    fileprivate var workspace: Bool {
        self != .documentPaths && self != .documentModified && self != .documentFiles
    }
    fileprivate var properties: [OSType] {
        switch self {
        case .documentPaths, .workspacePaths: return [0x70707468] // ppth
        case .documentModified: return [0x696d6f64] // imod
        case .documentFiles: return [0x66696c65] // file
        case .workspaceLoaded: return [0x6c6f6164] // load
        case .schemeIDs: return [0x6172756e, 0x49442020] // arun, ID
        case .deviceIDs: return [0x61727564, 0x72646576, 0x64766964] // arud, rdev, dvid
        case .platforms, .firstWorkspacePlatforms: return [0x61727564, 0x706c6174] // arud, plat
        case .genericDevices: return [0x61727564, 0x72646576, 0x676e7263] // arud, rdev, gnrc
        }
    }
    func event(pid: pid_t) throws -> NSAppleEventDescriptor {
        guard pid > 0 else { throw MemoryMetadataError.invalid }
        func object(want: OSType, form: OSType, selection: NSAppleEventDescriptor,
                    container: NSAppleEventDescriptor) throws -> NSAppleEventDescriptor {
            let record = NSAppleEventDescriptor.record()
            record.setDescriptor(NSAppleEventDescriptor(typeCode: want), forKeyword: 0x77616e74)
            record.setDescriptor(NSAppleEventDescriptor(enumCode: form), forKeyword: 0x666f726d)
            record.setDescriptor(selection, forKeyword: 0x73656c64)
            record.setDescriptor(container, forKeyword: 0x66726f6d)
            guard let result = record.coerce(toDescriptorType: 0x6f626a20) else { throw MemoryMetadataError.invalid }
            return result
        }
        // AECreateDesc consumes a native OSType value, not its big-endian text
        // spelling. Let the public API construct the typed absolute ordinal.
        var ordinal = OSType(kAEAll)
        var rawOrdinal = AEDesc()
        guard AECreateDesc(typeAbsoluteOrdinal, &ordinal, MemoryLayout<OSType>.size, &rawOrdinal) == noErr else {
            throw MemoryMetadataError.invalid
        }
        let all = NSAppleEventDescriptor(aeDescNoCopy: &rawOrdinal)
        var specifier = try object(want: workspace ? 0x776b7364 : 0x646f6375,
            form: 0x696e6478, selection: self == .firstWorkspacePlatforms ? NSAppleEventDescriptor(int32: 1) : all,
            container: NSAppleEventDescriptor.null())
        for property in properties {
            specifier = try object(want: 0x70726f70, form: 0x70726f70,
                selection: NSAppleEventDescriptor(typeCode: property), container: specifier)
        }
        let event = NSAppleEventDescriptor(eventClass: 0x636f7265, eventID: 0x67657464,
            targetDescriptor: NSAppleEventDescriptor(processIdentifier: pid), returnID: -1, transactionID: 0)
        event.setParam(specifier, forKeyword: 0x2d2d2d2d)
        return event
    }
}

protocol MemoryXcodeMetadataTransport {
    func read(_ query: MemoryXcodeMetadataQuery, deadline: Double) throws -> NSAppleEventDescriptor
}

// Explicit diagnostic startup allowance. Consumption is irreversible, including
// failed sends; steady-state callers retain the two-second cap by default.
final class MemoryMetadataSendBudget {
    private var initialAvailable: Bool
    init(initialRead: Bool = false) { initialAvailable = initialRead }
    func take(_ query: MemoryXcodeMetadataQuery, remaining: Double) throws -> Double {
        let initial = initialAvailable
        initialAvailable = false
        guard remaining.isFinite, remaining > 0 else { throw MemoryMetadataError.unavailable }
        guard !initial || query == .documentPaths else { throw MemoryMetadataError.invalid }
        return min(initial ? 8 : 2, remaining)
    }
}

struct PublicMemoryXcodeMetadataTransport: MemoryXcodeMetadataTransport {
    let owner: MemoryOwnedAppHandle<NSRunningApplication>
    let cancelled: () -> Bool
    var diagnostics: MemoryMetadataDiagnostics = MemoryMetadataDiagnostics()
    var sendBudget = MemoryMetadataSendBudget()

    func read(_ query: MemoryXcodeMetadataQuery, deadline: Double) throws -> NSAppleEventDescriptor {
        precondition(Thread.isMainThread)
        func check() throws {
            guard !cancelled(), deadline.isFinite, ProcessInfo.processInfo.systemUptime < deadline,
                  owner.canObserve(), !owner.application.isTerminated, owner.application.isFinishedLaunching else {
                diagnostics.fail(.context); throw MemoryMetadataError.unavailable
            }
        }
        diagnostics.begin(query)
        diagnostics.launch(owner.application.isFinishedLaunching)
        try check()
        // Do not invoke the potentially unbounded permission-determination API
        // on main. The timed send itself is explicitly forbidden to prompt.
        let event = try query.event(pid: owner.application.processIdentifier)
        let options = NSAppleEventDescriptor.SendOptions(rawValue:
            UInt(kAEWaitReply | kAENeverInteract | kAEDontRecord | kAEDoNotPromptForUserConsent))
        let reply: NSAppleEventDescriptor
        let started = ProcessInfo.processInfo.systemUptime
        do {
            let timeout = try sendBudget.take(query, remaining: deadline - started)
            reply = try event.sendEvent(options: options,
                timeout: timeout)
        } catch {
            diagnostics.elapsed(ProcessInfo.processInfo.systemUptime - started)
            let value = error as NSError
            diagnostics.fail(.send, status: value.domain == NSOSStatusErrorDomain ? value.code : nil)
            throw MemoryMetadataError.unavailable
        }
        diagnostics.elapsed(ProcessInfo.processInfo.systemUptime - started)
        try check()
        guard let raw = reply.aeDesc, AEGetDescDataSize(raw) <= 65536 else {
            diagnostics.fail(.reply); throw MemoryMetadataError.invalid
        }
        if let error = reply.paramDescriptor(forKeyword: 0x6572726e) {
            guard error.descriptorType == 0x6c6f6e67, error.int32Value == 0 else {
                diagnostics.fail(.reply, status: error.descriptorType == 0x6c6f6e67 ? Int(error.int32Value) : nil)
                throw MemoryMetadataError.unavailable
            }
        }
        guard let value = reply.paramDescriptor(forKeyword: 0x2d2d2d2d) else {
            diagnostics.fail(.reply); throw MemoryMetadataError.invalid
        }
        return value
    }
}

struct MemoryXcodeMetadataSnapshot: Equatable {
    let documentPaths: [String]
    let documentModified: [Bool]
    let workspacePaths: [String]
    let workspaceLoaded: [Bool]
    let schemeIDs: [String]
    let deviceIDs: [String]
    let platforms: [String]
    let genericDevices: [Bool]
    // Absence at the observation instant, not an owner/cleanup proof.
    var noOpenDocumentsObserved: Bool { documentPaths.isEmpty && workspacePaths.isEmpty }
    // Location diagnostics only: containment does not establish ownership or
    // authorize closure. Resolve symlinks and compare complete path components.
    func documentLocationSummary(project: URL) -> [String: Any] {
        guard project.isFileURL, documentPaths.count <= 32,
              documentPaths.count == documentModified.count, workspacePaths.count <= 32 else {
            return ["valid": false]
        }
        var resolutionErrors = ["missing": 0, "notDirectory": 0, "permission": 0,
                                "symlinkLoop": 0, "tooLong": 0, "other": 0]
        func components(_ url: URL, diagnose: Bool = false) -> [String]? {
            guard let resolved = realpath(url.path, nil) else {
                let code = errno
                if diagnose { resolutionErrors[memoryPathResolutionFailure(code), default: 0] += 1 }
                return nil
            }
            defer { free(resolved) }
            return String(cString: resolved).split(separator: "/").map(String.init)
        }
        guard let expected = components(project), let root = components(project.deletingLastPathComponent()) else {
            return ["valid": false]
        }
        var exact = 0, projectDescendants = 0, rootDescendants = 0, outside = 0, unresolved = 0
        for path in documentPaths {
            guard let actual = components(URL(fileURLWithPath: path), diagnose: true) else { unresolved += 1; continue }
            if actual == expected { exact += 1 }
            else if actual.count > expected.count && actual.starts(with: expected) { projectDescendants += 1 }
            else if actual.count > root.count && actual.starts(with: root) { rootDescendants += 1 }
            else { outside += 1 }
        }
        return ["valid": true, "documentCount": documentPaths.count, "workspaceCount": workspacePaths.count,
                "modifiedCount": documentModified.filter { $0 }.count,
                "expectedProjectCount": exact, "projectDescendantCount": projectDescendants,
                "temporaryRootDescendantCount": rootDescendants, "outsideCount": outside,
                "unresolvedCount": unresolved, "resolutionErrors": resolutionErrors]
    }
    // Diagnostic read eligibility only. Extra unmodified documents never grant
    // ownership, target verification, or permission to close the application.
    func permitsTargetDiagnostic(matchesDocument: (String) -> Bool) -> Bool {
        !documentPaths.isEmpty && documentPaths.count <= 32 &&
        documentModified.count == documentPaths.count && !documentModified.contains(true) &&
        Set(documentPaths).count == documentPaths.count && workspacePaths.count == 1 &&
        documentPaths.contains(workspacePaths[0]) && workspaceLoaded == [true] &&
        matchesDocument(workspacePaths[0])
    }
    func documentMatchChecks(matchesDocument: (String) -> Bool) -> [String: Bool] {
        ["singleDocument": documentPaths.count == 1,
         "workspaceMatchesDocuments": workspacePaths == documentPaths,
         "unmodified": documentModified == [false],
         "loaded": workspaceLoaded == [true],
         "directoryMatches": documentPaths.count == 1 && matchesDocument(documentPaths[0])]
    }
    func isSingleUnmodifiedDocument(matchesDocument: (String) -> Bool) -> Bool {
        documentMatchChecks(matchesDocument: matchesDocument).values.allSatisfy { $0 }
    }
    // Observed selection only, never proof of the running debugger/AUT identity.
    func isSingleUnmodifiedWorkspace(platform: String, matchesDocument: (String) -> Bool) -> Bool {
        documentPaths.count == 1 && workspacePaths == documentPaths && documentModified == [false] &&
        workspaceLoaded == [true] && schemeIDs.count == 1 && !schemeIDs[0].isEmpty &&
        deviceIDs.count == 1 && !deviceIDs[0].isEmpty && platforms == [platform] &&
        genericDevices == [false] && matchesDocument(documentPaths[0])
    }
}

enum MemoryWorkspaceLoadingObservation { case waiting, loaded }
func memoryWorkspaceLoadingObservation(_ value: NSAppleEventDescriptor) throws -> MemoryWorkspaceLoadingObservation {
    guard let raw = value.aeDesc, AEGetDescDataSize(raw) <= 65536,
          value.descriptorType == typeAEList, value.numberOfItems <= 1 else { throw MemoryMetadataError.invalid }
    if value.numberOfItems == 0 { return .waiting }
    guard let item = value.atIndex(1), item.descriptorType == typeBoolean,
          item.data.count == 1, [UInt8(0), 1].contains(item.data[0]) else { throw MemoryMetadataError.invalid }
    return item.booleanValue ? .loaded : .waiting
}

final class MemoryXcodeMetadataReader<T: MemoryXcodeMetadataTransport> {
    private let transport: T
    private let validContext: () -> Bool
    private let now: () -> Double
    private var poisoned = false
    private let diagnostics: MemoryMetadataDiagnostics
    init(transport: T, validContext: @escaping () -> Bool,
         now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime },
         diagnostics: MemoryMetadataDiagnostics = MemoryMetadataDiagnostics()) {
        self.transport = transport; self.validContext = validContext; self.now = now
        self.diagnostics = diagnostics
    }
    func snapshot(deadline: Double, documentsOnly: Bool = false,
                  targetEligibility: ((MemoryXcodeMetadataSnapshot) -> Bool)? = nil) throws -> MemoryXcodeMetadataSnapshot {
        precondition(Thread.isMainThread)
        func check() throws {
            guard !poisoned, deadline.isFinite, now() < deadline, validContext() else {
                diagnostics.fail(.context); throw MemoryMetadataError.unavailable
            }
        }
        func values(_ query: MemoryXcodeMetadataQuery) throws -> [NSAppleEventDescriptor] {
            diagnostics.begin(query)
            try check()
            let value = try transport.read(query, deadline: deadline)
            try check()
            diagnostics.shape(value)
            guard let raw = value.aeDesc, AEGetDescDataSize(raw) <= 65536,
                  value.descriptorType == 0x6c697374, value.numberOfItems <= 32 else {
                diagnostics.fail(.shape); throw MemoryMetadataError.invalid
            }
            return try (0..<value.numberOfItems).map { index in
                guard let item = value.atIndex(index + 1) else { throw MemoryMetadataError.invalid }
                return item
            }
        }
        func strings(_ query: MemoryXcodeMetadataQuery, path: Bool = false) throws -> [String] {
            try values(query).map { item in
                diagnostics.item(item)
                func reject(_ reason: MemoryMetadataFailure) throws -> Never {
                    diagnostics.fail(reason); throw MemoryMetadataError.invalid
                }
                guard [OSType(0x75747874), 0x75746638, 0x54455854].contains(item.descriptorType) else { try reject(.itemType) }
                guard let text = item.stringValue else { try reject(.textUnavailable) }
                guard !text.isEmpty else { try reject(.textEmpty) }
                guard text.utf8.count <= (path ? 4096 : 256) else { try reject(.textLimit) }
                guard text.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { try reject(.textControl) }
                guard !path || text.hasPrefix("/") else { try reject(.pathFormat) }
                return text
            }
        }
        func bools(_ query: MemoryXcodeMetadataQuery) throws -> [Bool] {
            try values(query).map { item in
                diagnostics.item(item)
                guard item.descriptorType == 0x626f6f6c, item.data.count == 1,
                      item.data.first == 0 || item.data.first == 1 else {
                    diagnostics.fail(.booleanEncoding); throw MemoryMetadataError.invalid
                }
                return item.booleanValue
            }
        }
        func read() throws -> MemoryXcodeMetadataSnapshot {
            let paths = try strings(.documentPaths, path: true)
            let modified = try bools(.documentModified)
            let workspaces = try strings(.workspacePaths, path: true)
            let loaded = try bools(.workspaceLoaded)
            guard paths.count == modified.count, workspaces.count == loaded.count,
                  Set(paths).count == paths.count, Set(workspaces).count == workspaces.count,
                  workspaces.allSatisfy({ paths.contains($0) }) else { throw MemoryMetadataError.invalid }
            // Xcode's public dictionary forbids messaging workspace objects
            // before loading finishes. Do not query scheme/destination yet.
            guard loaded.allSatisfy({ $0 }) else { throw MemoryMetadataError.unavailable }
            // With no workspace, do not ask properties of missing scheme/device objects.
            let readTarget = !documentsOnly && !workspaces.isEmpty
            if readTarget, let targetEligibility {
                let documents = MemoryXcodeMetadataSnapshot(documentPaths: paths, documentModified: modified,
                    workspacePaths: workspaces, workspaceLoaded: loaded, schemeIDs: [], deviceIDs: [],
                    platforms: [], genericDevices: [])
                guard targetEligibility(documents) else { throw MemoryMetadataError.unavailable }
            }
            let schemes = readTarget ? try strings(.schemeIDs) : []
            let devices = readTarget ? try strings(.deviceIDs) : []
            let platforms = readTarget ? try strings(.platforms) : []
            let generic = readTarget ? try bools(.genericDevices) : []
            guard [schemes.count, devices.count, platforms.count, generic.count].allSatisfy({ $0 == (readTarget ? workspaces.count : 0) }) else {
                throw MemoryMetadataError.invalid
            }
            return MemoryXcodeMetadataSnapshot(documentPaths: paths, documentModified: modified,
                workspacePaths: workspaces, workspaceLoaded: loaded, schemeIDs: schemes,
                deviceIDs: devices, platforms: platforms, genericDevices: generic)
        }
        do {
            try check()
            let first = try read(); let second = try read()
            try check()
            guard first == second else { diagnostics.fail(.changed); throw MemoryMetadataError.changed }
            return second
        } catch { diagnostics.fail(.validation); poisoned = true; throw error }
    }
}

// Shape-only inspection: never coerce, resolve aliases, dereference object
// specifiers, or expose payloads. Equal counts do not prove per-document pairing.
func memoryDocumentFileSummary(_ value: NSAppleEventDescriptor, expectedCount: Int) throws -> [String: Any] {
    guard (0...32).contains(expectedCount), let raw = value.aeDesc,
          AEGetDescDataSize(raw) <= 65536, value.descriptorType == typeAEList,
          value.numberOfItems == expectedCount else { throw MemoryMetadataError.invalid }
    var missing = 0, represented = 0, unknown = 0
    for index in 0..<value.numberOfItems {
        guard let item = value.atIndex(index + 1) else { throw MemoryMetadataError.invalid }
        if item.descriptorType == typeType && item.data.count == 4 && item.typeCodeValue == 0x6d736e67 {
            missing += 1
        } else if [OSType(typeFileURL), OSType(typeAlias)].contains(item.descriptorType) && !item.data.isEmpty {
            represented += 1
        } else { unknown += 1 }
    }
    return ["documentCount": expectedCount, "missingCount": missing,
            "fileRepresentationCount": represented, "unknownCount": unknown,
            "associationVerified": false]
}

// Fixed local diagnostic labels only; failures never imply path containment.
func memoryPathResolutionFailure(_ code: Int32) -> String {
    switch code {
    case ENOENT: return "missing"
    case ENOTDIR: return "notDirectory"
    case EACCES, EPERM: return "permission"
    case ELOOP: return "symlinkLoop"
    case ENAMETOOLONG: return "tooLong"
    default: return "other"
    }
}

// Diagnostic-only, explicitly disclosed one-action Quit grant. Production must
// obtain its grant from PermissionEngine; observing metadata never grants it.
final class MemoryMetadataQuitGrant<Application> {
    private let owner: MemoryOwnedAppHandle<Application>
    private let documents: MemoryXcodeMetadataSnapshot
    private let deadline: Double
    private let now: () -> Double
    private var consumed = false
    init?(owner: MemoryOwnedAppHandle<Application>, documents: MemoryXcodeMetadataSnapshot,
          deadline: Double, now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime },
          matchesDocument: (String) -> Bool) {
        guard deadline.isFinite, now() < deadline, owner.isCurrent(),
              documents.permitsTargetDiagnostic(matchesDocument: matchesDocument) else { return nil }
        self.owner = owner; self.documents = documents; self.deadline = deadline; self.now = now
    }
    func consume(owner actual: MemoryOwnedAppHandle<Application>, documents fresh: MemoryXcodeMetadataSnapshot,
                 matchesDocument: (String) -> Bool) -> Bool {
        guard !consumed else { return false }
        consumed = true
        return actual === owner && owner.canObserve() && now() < deadline && fresh == documents &&
            fresh.permitsTargetDiagnostic(matchesDocument: matchesDocument)
    }
}

// Explicit physical selection only; this is not a debugger/process identity.
struct MemoryPhysicalDestination {
    private let expectedID: String
    init?(expectedID: String) {
        guard !expectedID.isEmpty, expectedID.utf8.count <= 256,
              expectedID.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "-" }) else { return nil }
        self.expectedID = expectedID
    }
    func matches(_ snapshot: MemoryXcodeMetadataSnapshot) -> Bool {
        snapshot.platforms == ["iphoneos"] && snapshot.genericDevices == [false] &&
        snapshot.deviceIDs == [expectedID] && snapshot.schemeIDs.count == 1 && !snapshot.schemeIDs[0].isEmpty
    }
    func matchesID(_ value: String) -> Bool { value == expectedID }
}

enum MemoryDestinationSelection { case waiting, selected }
// Caller revalidates the complete document context before each bounded sample.
// Only expected missing values are waiting; malformed replies fail immediately.
func memoryDestinationSelection<T: MemoryXcodeMetadataTransport>(transport: T, target: MemoryPhysicalDestination,
    deadline: Double, validContext: () -> Bool, now: () -> Double = { ProcessInfo.processInfo.systemUptime },
    diagnostics: MemoryMetadataDiagnostics = MemoryMetadataDiagnostics()) throws -> MemoryDestinationSelection {
    diagnostics.selection(.checking)
    func single(_ query: MemoryXcodeMetadataQuery) throws -> NSAppleEventDescriptor {
        diagnostics.begin(query)
        guard deadline.isFinite, now() < deadline, validContext() else {
            diagnostics.fail(.context); throw MemoryMetadataError.unavailable
        }
        let value: NSAppleEventDescriptor
        do { value = try transport.read(query, deadline: deadline) }
        catch { diagnostics.fail(.send); throw error }
        diagnostics.shape(value)
        guard now() < deadline, validContext() else {
            diagnostics.fail(.context); throw MemoryMetadataError.unavailable
        }
        guard let raw = value.aeDesc, AEGetDescDataSize(raw) <= 65536,
              value.descriptorType == typeAEList, value.numberOfItems == 1,
              let item = value.atIndex(1) else {
            diagnostics.fail(.shape); throw MemoryMetadataError.invalid
        }
        diagnostics.item(item)
        return item
    }
    func text(_ value: NSAppleEventDescriptor) throws -> String? {
        if value.descriptorType == typeType && value.data.count == 4 && value.typeCodeValue == 0x6d736e67 { return nil }
        guard [OSType(0x75747874), 0x75746638, 0x54455854].contains(value.descriptorType),
              let result = value.stringValue, !result.isEmpty, result.utf8.count <= 256,
              result.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            diagnostics.fail(.validation); throw MemoryMetadataError.invalid
        }
        return result
    }
    guard let platform = try text(single(.platforms)) else {
        diagnostics.selection(.platformMissing); return .waiting
    }
    guard platform == "iphoneos" else {
        switch platform {
        case "macosx": diagnostics.selection(.platformMac)
        case "iphonesimulator": diagnostics.selection(.platformSimulator)
        case "com.apple.platform.iphoneos": diagnostics.selection(.platformQualifiedIOS)
        case "iOS": diagnostics.selection(.platformDisplayIOS)
        default: diagnostics.selection(.platformOther)
        }
        return .waiting
    }
    let generic = try single(.genericDevices)
    guard generic.descriptorType == typeBoolean, generic.data.count == 1,
          generic.data.first == 0 || generic.data.first == 1 else {
        diagnostics.fail(.booleanEncoding); throw MemoryMetadataError.invalid
    }
    guard !generic.booleanValue else { diagnostics.selection(.genericDestination); return .waiting }
    guard let identifier = try text(single(.deviceIDs)) else { diagnostics.selection(.deviceMissing); return .waiting }
    guard target.matchesID(identifier) else { diagnostics.selection(.deviceMismatch); return .waiting }
    diagnostics.selection(.selected)
    return .selected
}

// Diagnostic only: fixed scalar-vs-collection comparison, never target proof.
// The caller must bracket this with the same single-workspace document snapshot.
func memoryPlatformComparison<T: MemoryXcodeMetadataTransport>(transport: T, deadline: Double,
    validContext: () -> Bool, now: () -> Double = { ProcessInfo.processInfo.systemUptime }) throws -> [String: String] {
    func check() throws {
        guard validContext(), deadline.isFinite, now() < deadline else { throw MemoryMetadataError.unavailable }
    }
    func classify(_ query: MemoryXcodeMetadataQuery) throws -> String {
        try check()
        let reply = try transport.read(query, deadline: deadline)
        try check()
        guard reply.data.count <= 65536 else { throw MemoryMetadataError.invalid }
        let value: NSAppleEventDescriptor
        if query == .platforms {
            guard reply.descriptorType == typeAEList, reply.numberOfItems == 1,
                  let item = reply.atIndex(1) else { throw MemoryMetadataError.invalid }
            value = item
        } else { value = reply }
        if value.descriptorType == typeType && value.data.count == 4 && value.typeCodeValue == 0x6d736e67 { return "missing" }
        guard [OSType(typeUnicodeText), OSType(typeUTF8Text), OSType(typeChar)].contains(value.descriptorType),
              let text = value.stringValue, !text.isEmpty, text.utf8.count <= 256,
              !text.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            throw MemoryMetadataError.invalid
        }
        switch text {
        case "iphoneos": return "iphoneos"
        case "macosx": return "macosx"
        case "iphonesimulator": return "iphonesimulator"
        default: return "other"
        }
    }
    let before = try classify(.platforms)
    let single = try classify(.firstWorkspacePlatforms)
    let after = try classify(.platforms)
    return ["collectionBefore": before, "singleWorkspace": single, "collectionAfter": after,
            "classificationStable": before == after ? "yes" : "no"]
}
