import AppKit
import ApplicationServices
import Foundation
import Darwin

// The caller reserves a private directory named for an unpredictable request ID.
let arguments = CommandLine.arguments
var resultDirectory: Int32 = -1
var requestID: String? = nil
var xcodeArgument: String? = arguments.count == 2 ? arguments[1] : nil
if arguments.count == 6, arguments[1] == "--request", arguments[3] == "--directory",
   let uuid = UUID(uuidString: arguments[2]), uuid.uuidString.lowercased() == arguments[2] {
    let path = arguments[4]
    let url = URL(fileURLWithPath: path)
    guard path.hasPrefix("/"), let canonical = realpath(path, nil) else { exit(2) }
    let matches = String(cString: canonical) == path
    free(canonical)
    guard matches,
          url.lastPathComponent == "memory-request-" + arguments[2] else { exit(2) }
    resultDirectory = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    var metadata = stat()
    guard resultDirectory >= 0, fstat(resultDirectory, &metadata) == 0,
          metadata.st_uid == getuid(), metadata.st_mode & 0o077 == 0 else { exit(2) }
    let application = NSApplication.shared
    application.setActivationPolicy(.prohibited)
    application.finishLaunching()
    requestID = arguments[2]
    xcodeArgument = arguments[5]
}

// Read-only host inspection. Never launch Xcode, request trust, or read window contents.
func emit(_ status: String, _ reason: String, _ version: String? = nil) {
    var result: [String: Any] = [
        "protocolVersion": 1, "status": status, "reason": reason,
        "targetVerified": false
    ]
    if let version = version { result["xcodeVersion"] = version }
    if let request = requestID { result["requestId"] = request }
    if let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
       let text = String(data: data, encoding: .utf8) {
        if resultDirectory >= 0 {
            let fd = openat(resultDirectory, "result.json", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            guard fd >= 0 else { exit(2) }
            let bytes = Array((text + "\n").utf8)
            let written = bytes.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
            let synced = fsync(fd)
            close(fd)
            close(resultDirectory)
            guard written == bytes.count, synced == 0 else { exit(2) }
        } else { print(text) }
    }
}

guard let xcodePath = xcodeArgument, xcodePath.hasPrefix("/") else {
    emit("blocked", "invalid_input")
    exit(0)
}
let url = URL(fileURLWithPath: xcodePath).resolvingSymlinksInPath().standardizedFileURL
guard let bundle = Bundle(url: url), bundle.bundleIdentifier == "com.apple.dt.Xcode",
      let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
      version.range(of: "^[0-9]{1,3}(\\.[0-9]{1,3}){1,2}$", options: .regularExpression) != nil else {
    emit("blocked", "xcode_invalid")
    exit(0)
}
guard AXIsProcessTrusted() else {
    emit("blocked", "accessibility_unavailable", version)
    exit(0)
}
let applications = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dt.Xcode")
if applications.isEmpty {
    emit("eligible", "xcode_not_running", version)
    exit(0)
}
guard applications.count == 1, let app = applications.first,
      app.bundleURL?.resolvingSymlinksInPath().standardizedFileURL == url else {
    emit("blocked", "xcode_instance_conflict", version)
    exit(0)
}
let element = AXUIElementCreateApplication(app.processIdentifier)
guard AXUIElementSetMessagingTimeout(element, 2) == .success else {
    emit("blocked", "accessibility_query_failed", version)
    exit(0)
}
// Query only the window count, not titles, values, screenshots, or device evidence.
var count: CFIndex = 0
guard AXUIElementGetAttributeValueCount(element, kAXWindowsAttribute as CFString, &count) == .success else {
    emit("blocked", "accessibility_query_failed", version)
    exit(0)
}
// Even a windowless running instance may own work. It cannot be adopted by this helper.
emit("blocked", "xcode_instance_conflict", version)
