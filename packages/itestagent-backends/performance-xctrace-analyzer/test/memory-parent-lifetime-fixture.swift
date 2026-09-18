import Foundation
import Darwin

@main struct ParentLifetimeTests {
    static func main() {
        alarm(5)
        var callbacks = 0
        var onMain = true
        let lifetime = MemoryParentLifetime { callbacks += 1; onMain = onMain && Thread.isMainThread }
        print("ready"); fflush(stdout)
        // Deliberately prevent main-queue delivery while the real parent closes or signals.
        Thread.sleep(forTimeInterval: 0.5)
        let visibleBeforeMainDrain = lifetime.isCancelled
        let callbacksBeforeMainDrain = callbacks
        let limit = Date(timeIntervalSinceNow: 1)
        while callbacks == 0 && Date() < limit { RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.01)) }
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
        lifetime.stop(); lifetime.stop()
        let result: [String: Any] = ["visibleBeforeMainDrain": visibleBeforeMainDrain,
            "callbacksBeforeMainDrain": callbacksBeforeMainDrain,
            "callbacks": callbacks, "onMain": onMain, "cancelledAfterStop": lifetime.isCancelled]
        print(String(decoding: try! JSONSerialization.data(withJSONObject: result), as: UTF8.self))
    }
}
