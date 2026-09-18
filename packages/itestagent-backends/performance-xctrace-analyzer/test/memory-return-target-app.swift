import AppKit
import Foundation

// Isolated recipient fixture. Never interprets text, runs commands or records keys.
final class ReturnFixtureView: NSView {
    var downs = 0
    var ups = 0
    var unexpected = false
    var repeated = false
    var resultURL: URL!
    var requestID = ""
    override var acceptsFirstResponder: Bool { true }
    func record() {
        let payload: [String: Any] = ["requestId": requestID, "downs": downs, "ups": ups,
            "unexpected": unexpected, "repeated": repeated,
            "focused": window?.firstResponder === self, "active": NSApp.isActive]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) {
            try? data.write(to: resultURL, options: .atomic)
        }
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 0x24 && event.modifierFlags.intersection(.deviceIndependentFlagsMask).isEmpty {
            downs = min(downs + 1, 100)
        } else { unexpected = true }
        repeated = repeated || event.isARepeat
        record()
    }
    override func keyUp(with event: NSEvent) {
        if event.keyCode == 0x24 && event.modifierFlags.intersection(.deviceIndependentFlagsMask).isEmpty {
            ups = min(ups + 1, 100)
        } else { unexpected = true }
        record()
    }
}

@main struct ReturnTargetMain {
    static func main() {
        let env = ProcessInfo.processInfo.environment
        guard let request = env["ITESTAGENT_RETURN_REQUEST"], UUID(uuidString: request)?.uuidString.lowercased() == request,
              let directory = env["ITESTAGENT_RETURN_DIRECTORY"], directory.hasPrefix("/private/tmp/itestagent-return-run-") else { exit(2) }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let window = NSWindow(contentRect: NSRect(x: 150, y: 150, width: 480, height: 180),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "iTestAgent Return Transport Fixture"
        let view = ReturnFixtureView(frame: window.contentView!.bounds)
        view.resultURL = URL(fileURLWithPath: directory).appendingPathComponent("target.json")
        view.requestID = request
        window.contentView = view
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(view)
        // A bounded owned fixture cannot remain running indefinitely if its controller exits.
        Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in app.terminate(nil) }
        let heartbeat = Timer(timeInterval: 0.1, repeats: true) { _ in view.record() }
        RunLoop.main.add(heartbeat, forMode: .common)
        withExtendedLifetime(window) { app.run() }
    }
}
