import Foundation
import Darwin

@main struct ControlFixture {
    static func main() throws {
        alarm(5)
        let cancellation = MemoryIPCCancellation()
        let control = try MemoryQueryControl(input: STDIN_FILENO,
            deadline: ProcessInfo.processInfo.systemUptime + 2, cancellation: cancellation)
        defer { control.stop() }
        let launchAttempted = !cancellation.cancelled
        var callback = false; var grantSent = false
        DispatchQueue.main.async { callback = true; grantSent = !cancellation.cancelled }
        print("ready"); fflush(stdout)
        Thread.sleep(forTimeInterval: 0.3)
        let beforeMainDrain = cancellation.cancelled
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
        print(String(decoding: try JSONSerialization.data(withJSONObject: [
            "cancelledBeforeMainDrain": beforeMainDrain, "callback": callback,
            "grantSent": grantSent, "launchAttempted": launchAttempted]), as: UTF8.self))
    }
}
