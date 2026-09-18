import AppKit
import CoreServices
import Foundation
import Darwin

// Bounded diagnostic App, not the production capture provider. Optional project
// mode requires separately reviewed launch permission. No build/debug/AUT action
// is issued and document/device metadata never enters the receipt.
@main struct MemoryMetadataProbeApp {
    static func main() {
        var args = CommandLine.arguments
        let allowDocumentQuit = args.last == "--allow-unmodified-documents-quit"
        if allowDocumentQuit { args.removeLast() }
        let physicalRequested = args.last == "--physical-destination"
        if physicalRequested { args.removeLast() }
        guard [4, 6].contains(args.count), ["--observe", "--authorize"].contains(args[1]), args[2] == "--receipt",
              args[3].hasPrefix("/private/tmp/"), !args[3].contains("/../") else { exit(2) }
        var physicalTarget: MemoryPhysicalDestination?
        let identifier = ProcessInfo.processInfo.environment["ITESTAGENT_METADATA_EXPECTED_DEVICE_ID"]
        guard physicalRequested == (identifier != nil) else { exit(2) }
        if let identifier {
            guard args.count == 6, let target = MemoryPhysicalDestination(expectedID: identifier) else { exit(2) }
            physicalTarget = target
        }
        var project: URL?
        if args.count == 6 {
            guard args[4] == "--project", args[5].hasPrefix("/private/tmp/itestagent-metadata-project-"),
                  args[5].hasSuffix(".xcodeproj"), !args[5].contains("/../") else { exit(2) }
            project = URL(fileURLWithPath: args[5])
        }
        let output = open(args[3], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard output >= 0 else { exit(2) }
        let file = FileHandle(fileDescriptor: output, closeOnDealloc: true)
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        guard let operation = try? MetadataProbeOperation(app: app, receipt: file, authorize: args[1] == "--authorize", project: project, allowDocumentQuit: allowDocumentQuit, physicalTarget: physicalTarget) else { exit(2) }
        operation.start()
        withExtendedLifetime(operation) { app.run() }
    }
}

private struct TracedMetadataTransport: MemoryXcodeMetadataTransport {
    let base: PublicMemoryXcodeMetadataTransport
    let trace: (MemoryXcodeMetadataQuery, String) -> Void
    func read(_ query: MemoryXcodeMetadataQuery, deadline: Double) throws -> NSAppleEventDescriptor {
        base.diagnostics.begin(query)
        trace(query, "started")
        do {
            let value = try base.read(query, deadline: deadline)
            trace(query, "returned")
            return value
        } catch {
            trace(query, "failed")
            throw error
        }
    }
}

private final class MetadataProbeOperation {
    let app: NSApplication
    let receipt: FileHandle
    let authorize: Bool
    private let startedAt = ProcessInfo.processInfo.systemUptime
    private lazy var deadline = startedAt + 60
    private var sequence = 0
    private var projectOpenRequested = false
    private var projectOpenConfirmed = false
    private var driver: MemoryOwnedAppRunLoopDriver<PublicMemoryOwnedAppEnvironment>?
    private let project: URL?
    private let projectBinding: MemoryLocalDocumentBinding?
    private let physicalTarget: MemoryPhysicalDestination?
    private var selectionSamples = 0
    private var destinationObserved = false
    private let selectionDiagnostics = MemoryMetadataDiagnostics()
    private let comparisonDiagnostics = MemoryMetadataDiagnostics()
    private var platformComparison = [String: String]()
    private let allowDocumentQuit: Bool
    private var quitGrant: MemoryMetadataQuitGrant<NSRunningApplication>?
    private var documentLifetime: MemoryDocumentProcessLifetime<NSRunningApplication>?
    private var observedProject = false
    private var observedDocument = false
    private var diagnosticDocuments: MemoryXcodeMetadataSnapshot?
    private var documentFileSummary = [String: Any]()
    private let fileDiagnostics = MemoryMetadataDiagnostics()
    private var handle: MemoryOwnedAppHandle<NSRunningApplication>?
    private var reader: MemoryXcodeMetadataReader<TracedMetadataTransport>?
    private var documentReader: MemoryXcodeMetadataReader<TracedMetadataTransport>?
    private var observedEmpty = false
    private var terminal = false
    private var startedOwner = false
    private var permissionAttempted = false
    private let diagnostics = MemoryMetadataDiagnostics()
    private let documentDiagnostics = MemoryMetadataDiagnostics()
    private var documentMatchChecks = [String: Bool]()
    private var documentLocationSummary = [String: Any]()
    private let sendBudget = MemoryMetadataSendBudget(initialRead: true)
    private var readinessTimer: Timer?
    private var launchReadiness: MemoryMetadataLaunchReadiness?

    init(app: NSApplication, receipt: FileHandle, authorize: Bool, project: URL?, allowDocumentQuit: Bool, physicalTarget: MemoryPhysicalDestination?) throws {
        self.physicalTarget = physicalTarget
        self.allowDocumentQuit = allowDocumentQuit
        self.app = app; self.receipt = receipt; self.authorize = authorize
        self.project = project
        projectBinding = try project.map { try MemoryLocalDocumentBinding(expectedURL: $0) }
    }
    private func record(_ status: String, cleanup: Bool = false, query: MemoryXcodeMetadataQuery? = nil) {
        sequence += 1
        let value: [String: Any] = ["protocolVersion": 2, "status": status, "sequence": sequence,
            "elapsedMs": Int(min(65000, max(0, (ProcessInfo.processInfo.systemUptime - startedAt) * 1000))),
            "query": query?.rawValue ?? "none",
            "xcodePID": handle?.application.processIdentifier ?? 0,
            "xcodeStarted": startedOwner, "permissionAttempted": permissionAttempted,
            "emptyDocumentsObserved": observedEmpty, "cleanupVerified": cleanup,
            "targetVerified": false, "projectOpened": projectOpenConfirmed, "projectOpenRequested": projectOpenRequested,
            "workspaceMetadataObserved": observedProject, "debuggerCreated": false, "autCreated": false,
            "documentMetadataObserved": observedDocument,
            "metadataDiagnostic": diagnostics.fields]
        var complete = value
        complete["destinationSelectionObserved"] = destinationObserved
        complete["physicalDestinationRequested"] = physicalTarget != nil
        complete["destinationSelectionSamples"] = selectionSamples
        complete["selectionDiagnostic"] = selectionDiagnostics.fields
        complete["platformComparison"] = platformComparison
        complete["comparisonDiagnostic"] = comparisonDiagnostics.fields
        complete["documentClosureSource"] = documentLifetime?.closureSource ?? "unknown"
        complete["allUnmodifiedDocumentsQuitAuthorized"] = allowDocumentQuit
        complete["documentDiagnostic"] = documentDiagnostics.fields
        complete["documentFileDiagnostic"] = fileDiagnostics.fields
        complete["documentFileSummary"] = documentFileSummary
        complete["documentReadEligible"] = diagnosticDocuments != nil
        complete["documentMatchChecks"] = documentMatchChecks
        complete["documentLocationSummary"] = documentLocationSummary
        guard let data = try? JSONSerialization.data(withJSONObject: complete, options: [.sortedKeys]) else { return }
        try? receipt.write(contentsOf: data + Data([10]))
    }
    private func snapshotMatchesProject(deadline: Double) -> Bool {
        guard let projectBinding, let reader, let snapshot = try? reader.snapshot(deadline: deadline, targetEligibility: { snapshot in
                  snapshot == self.diagnosticDocuments && snapshot.permitsTargetDiagnostic {
                      projectBinding.matches(URL(fileURLWithPath: $0).absoluteString)
                  }
              }) else { return false }
        if let physicalTarget {
            destinationObserved = physicalTarget.matches(snapshot)
            return false // Destination selection alone is not complete target identity.
        }
        return snapshot.isSingleUnmodifiedWorkspace(platform: "macosx") {
            projectBinding.matches(URL(fileURLWithPath: $0).absoluteString)
        }
    }
    private func snapshotMatchesDocument(deadline: Double) -> Bool {
        documentMatchChecks = [:]
        documentLocationSummary = [:]
        diagnosticDocuments = nil
        guard let projectBinding, let documentReader,
              let snapshot = try? documentReader.snapshot(deadline: deadline, documentsOnly: true) else { return false }
        if snapshot.permitsTargetDiagnostic(matchesDocument: {
            projectBinding.matches(URL(fileURLWithPath: $0).absoluteString)
        }) { diagnosticDocuments = snapshot }
        if let project { documentLocationSummary = snapshot.documentLocationSummary(project: project) }
        documentMatchChecks = snapshot.documentMatchChecks {
            projectBinding.matches(URL(fileURLWithPath: $0).absoluteString)
        }
        return documentMatchChecks.values.allSatisfy { $0 }
    }
    private func snapshotIsEmpty(deadline: Double) -> Bool {
        guard let handle, handle.canObserve(), let reader,
              let snapshot = try? reader.snapshot(deadline: deadline) else { return false }
        return snapshot.noOpenDocumentsObserved
    }
    func start() {
        let environment = PublicMemoryOwnedAppEnvironment(
            bundleURL: URL(fileURLWithPath: "/Applications/Xcode.app"), bundleIdentifier: "com.apple.dt.Xcode",
            safeToTerminate: { [weak self] original in
                guard let self, let handle = self.handle,
                      handle.application.isEqual(original) else { return false }
                if self.projectOpenRequested {
                    if let grant = self.quitGrant, let binding = self.projectBinding {
                        _ = self.snapshotMatchesDocument(deadline: ProcessInfo.processInfo.systemUptime + 4)
                        guard let fresh = self.diagnosticDocuments else { return false }
                        return grant.consume(owner: handle, documents: fresh) {
                            binding.matches(URL(fileURLWithPath: $0).absoluteString)
                        }
                    }
                    return self.observedDocument && self.snapshotMatchesDocument(deadline: ProcessInfo.processInfo.systemUptime + 4)
                }
                guard self.observedEmpty else { return false }
                return self.snapshotIsEmpty(deadline: ProcessInfo.processInfo.systemUptime + 4)
            })
        let session = MemoryOwnedAppSession(environment: environment, deadline: deadline, cleanupTimeout: 5)
        let driver = MemoryOwnedAppRunLoopDriver(session: session)
        self.driver = driver
        driver.start(onAcquired: { [weak self] _ in
            guard let self else { return }
            self.startedOwner = true
            guard let handle = session.ownedHandle(sessionID: UUID()) else { self.stop("owner_unavailable"); return }
            self.handle = handle
            self.reader = MemoryXcodeMetadataReader(
                transport: self.transport(handle),
                validContext: { handle.canObserve() }, diagnostics: self.diagnostics)
            self.documentReader = MemoryXcodeMetadataReader(transport: self.transport(handle, diagnostics: self.documentDiagnostics), validContext: { handle.canObserve() }, diagnostics: self.documentDiagnostics)
            self.waitForLaunch()
        }, onClosed: { [weak self] reason, verified in
            guard let self, !self.terminal else { return }; self.terminal = true
            self.readinessTimer?.invalidate(); self.readinessTimer = nil
            self.record(verified ? (self.documentLifetime?.closureSource != nil ? "observed_owner_documents_closed_target_unverified" : self.observedProject ? "observed_project_closed" : self.observedDocument ? "observed_document_closed_target_unverified" : self.observedEmpty && !self.projectOpenRequested ? "observed_empty_closed" : "not_observed_closed") : "cleanup_unverified", cleanup: verified)
            if verified { self.app.terminate(nil) }
            // Unknown ownership is not force-cleaned. Keep the observer App alive
            // for explicit user intervention; its receipt never claims success.
        })
    }
    private func stop(_ status: String) {
        guard !terminal else { return }
        readinessTimer?.invalidate(); readinessTimer = nil
        record(status); driver?.close()
    }
    private func waitForLaunch() {
        let gate = MemoryMetadataLaunchReadiness(deadline: deadline)
        launchReadiness = gate
        record("waiting_for_xcode_launch")
        func tick() {
            guard !self.terminal, let handle = self.handle else { return }
            switch gate.observe(ownerCurrent: handle.isCurrent(),
                                finishedLaunching: handle.application.isFinishedLaunching, cancelled: false) {
            case .waiting: return
            case .unavailable: self.stop("launch_not_ready")
            case .ready:
                self.readinessTimer?.invalidate(); self.readinessTimer = nil
                if self.authorize { self.requestPermission() } else { self.beginExperiment() }
            }
        }
        let timer = Timer(timeInterval: 0.025, repeats: true) { _ in tick() }
        readinessTimer = timer; RunLoop.main.add(timer, forMode: .common)
    }
    private func transport(_ handle: MemoryOwnedAppHandle<NSRunningApplication>, diagnostics selected: MemoryMetadataDiagnostics? = nil) -> TracedMetadataTransport {
        TracedMetadataTransport(base: PublicMemoryXcodeMetadataTransport(owner: handle, cancelled: { false }, diagnostics: selected ?? diagnostics, sendBudget: sendBudget),
            trace: { [weak self] query, outcome in self?.record("query_" + outcome, query: query) })
    }
    private func beginExperiment() {
        guard !terminal, let handle, handle.isCurrent() else { return }
        record("empty_baseline_started")
        observedEmpty = snapshotIsEmpty(deadline: min(deadline, ProcessInfo.processInfo.systemUptime + 12))
        guard observedEmpty else { stop("empty_baseline_unavailable"); return }
        record("empty_baseline_observed")
        guard let project else { stop("observed_empty"); return }
        guard !projectOpenRequested, let projectBinding, projectBinding.matches(project.absoluteString),
              handle.isCurrent() else { stop("project_binding_unavailable"); return }
        projectOpenRequested = true
        record("project_open_requested")
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false; configuration.addsToRecentItems = false
        configuration.promptsUserIfNeeded = false; configuration.createsNewApplicationInstance = false
        configuration.allowsRunningApplicationSubstitution = false
        NSWorkspace.shared.open([project], withApplicationAt: URL(fileURLWithPath: "/Applications/Xcode.app"),
                                configuration: configuration) { [weak self] opened, error in
            DispatchQueue.main.async {
                guard let self, !self.terminal, let current = self.handle, current === handle,
                      current.isCurrent() else { return }
                guard error == nil, let opened, opened.isEqual(handle.application) else {
                    self.stop("project_open_owner_unverified"); return
                }
                self.projectOpenConfirmed = true
                self.record("project_open_callback")
                self.prepareObservation()
            }
        }
    }
    private func prepareObservation() {
        guard project != nil else { observe(); return }
        record("waiting_for_workspace_load")
        let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let self, !self.terminal, let handle = self.handle, handle.isCurrent() else { return }
            do {
                let transport = self.transport(handle)
                let value = try transport.read(.workspaceLoaded, deadline: min(self.deadline, ProcessInfo.processInfo.systemUptime + 2))
                if try memoryWorkspaceLoadingObservation(value) == .waiting { return }
                self.readinessTimer?.invalidate(); self.readinessTimer = nil
                self.observe()
            } catch { self.stop("workspace_readiness_unavailable") }
        }
        readinessTimer = timer; RunLoop.main.add(timer, forMode: .common)
    }
    private func observe() {
        guard !terminal, let handle, handle.isCurrent(), ProcessInfo.processInfo.systemUptime < deadline else { return }
        if project != nil {
            observedDocument = snapshotMatchesDocument(deadline: min(deadline, ProcessInfo.processInfo.systemUptime + 8))
            guard let documents = diagnosticDocuments else { stop("document_metadata_unavailable"); return }
            documentLifetime = MemoryDocumentProcessLifetime(owner: handle)
            if allowDocumentQuit, let binding = projectBinding {
                quitGrant = MemoryMetadataQuitGrant(owner: handle, documents: documents, deadline: deadline) {
                    binding.matches(URL(fileURLWithPath: $0).absoluteString)
                }
            }
            record("document_read_eligible")
            do {
                let value = try transport(handle, diagnostics: fileDiagnostics).read(.documentFiles,
                    deadline: min(deadline, ProcessInfo.processInfo.systemUptime + 2))
                fileDiagnostics.shape(value)
                documentFileSummary = try memoryDocumentFileSummary(value, expectedCount: documents.documentPaths.count)
            } catch { fileDiagnostics.fail(.validation) }
            record("document_file_diagnostic_finished")
            // The target reader rechecks the exact document-only snapshot before
            // each target pass; a file failure cannot authorize unsafe reads.

            if physicalTarget != nil { waitForDestination(documents: documents); return }
            finishTargetObservation()
            return
        }
        observedEmpty = snapshotIsEmpty(deadline: min(deadline, ProcessInfo.processInfo.systemUptime + 8))
        stop(observedEmpty ? "observed_empty" : "metadata_unavailable_or_documents_open")
    }
    private func finishTargetObservation() {
        observedProject = snapshotMatchesProject(deadline: min(deadline, ProcessInfo.processInfo.systemUptime + 8))
        stop(destinationObserved ? "physical_destination_observed" : observedProject ? "observed_project" : "metadata_unavailable_or_project_mismatch")
    }
    private func waitForDestination(documents: MemoryXcodeMetadataSnapshot) {
        record("waiting_for_physical_destination")
        let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self, !self.terminal, let handle = self.handle, let target = self.physicalTarget else { return }
            guard handle.isCurrent(), ProcessInfo.processInfo.systemUptime < self.deadline - 10,
                  self.selectionSamples < 40 else { self.stop("destination_selection_unavailable"); return }
            self.selectionSamples += 1
            _ = self.snapshotMatchesDocument(deadline: min(self.deadline - 10, ProcessInfo.processInfo.systemUptime + 4))
            guard self.diagnosticDocuments == documents else { self.stop("destination_documents_changed"); return }
            do {
                let selected = try memoryDestinationSelection(transport: self.transport(handle, diagnostics: self.selectionDiagnostics),
                    target: target, deadline: min(self.deadline - 10, ProcessInfo.processInfo.systemUptime + 6),
                    validContext: { handle.isCurrent() }, diagnostics: self.selectionDiagnostics)
                self.record("destination_selection_sample")
                if selected == .waiting {
                    if self.selectionSamples == 40 && self.selectionDiagnostics.selectionReason == .platformMissing {
                        self.readinessTimer?.invalidate(); self.readinessTimer = nil
                        let comparison = try memoryPlatformComparison(
                            transport: self.transport(handle, diagnostics: self.comparisonDiagnostics),
                            deadline: min(self.deadline - 5, ProcessInfo.processInfo.systemUptime + 6),
                            validContext: { handle.isCurrent() })
                        _ = self.snapshotMatchesDocument(deadline: min(self.deadline - 5, ProcessInfo.processInfo.systemUptime + 4))
                        guard handle.isCurrent(), self.diagnosticDocuments == documents else {
                            self.stop("comparison_documents_changed"); return
                        }
                        self.platformComparison = comparison
                        self.record("platform_comparison_observed")
                        self.stop("destination_selection_unavailable")
                    }
                    return
                }
                self.readinessTimer?.invalidate(); self.readinessTimer = nil
                self.finishTargetObservation()
            } catch {
                self.selectionDiagnostics.fail(.validation)
                self.stop("destination_selection_unavailable")
            }
        }
        readinessTimer = timer; RunLoop.main.add(timer, forMode: .common)
    }
    private func requestPermission() {
        guard let handle, handle.isCurrent(), !permissionAttempted else { stop("owner_unavailable"); return }
        permissionAttempted = true
        record("permission_pending")
        let pid = handle.application.processIdentifier
        // Only this explicit diagnostic mode may request consent; the production
        // fixed-read adapter always uses no-prompt timed sends.
        DispatchQueue.global().async {
            let address = NSAppleEventDescriptor(processIdentifier: pid)
            let status = address.aeDesc.map { AEDeterminePermissionToAutomateTarget($0, 0x636f7265, 0x67657464, true) }
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.terminal, let handle = self.handle,
                      handle.isCurrent(), ProcessInfo.processInfo.systemUptime < self.deadline else { return }
                if status == noErr { self.beginExperiment() }
                else { self.stop("permission_unavailable") }
            }
        }
    }
}
