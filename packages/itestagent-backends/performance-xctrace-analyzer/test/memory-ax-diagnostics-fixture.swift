import Foundation

@main struct DiagnosticsFixture {
    static func main() throws {
        var cases = 0
        for stage in MemoryAXProbeStage.allCases {
            for operation in MemoryAXProbeOperation.allCases {
                var clock: TimeInterval = 5
                let log = MemoryAXProbeDiagnostics(now: { clock })
                try log.mark(stage, operation)
                log.progress(nodes: 42, depth: 3)
                clock = 5.25
                do { try log.ax(-25204); preconditionFailure("Must throw") }
                catch let failure as MemoryAXProbeFailure {
                    precondition(failure.stage == stage && failure.operation == operation)
                    precondition(failure.cause == .axError && failure.axCode == -25204)
                    precondition(failure.nodesVisited == 42 && failure.depth == 3)
                    precondition(failure.elapsedMilliseconds == 250)
                    let before = try JSONEncoder().encode(failure)
                    // A later catch or attempted operation cannot overwrite the cause.
                    log.progress(nodes: Int.max, depth: Int.max)
                    do { try log.mark(.complete); preconditionFailure("Must remain closed") } catch {}
                    do { try log.ax(0); preconditionFailure("Must remain closed") } catch {}
                    let after = try JSONEncoder().encode(log.fail(.unexpected))
                    let a = try JSONSerialization.jsonObject(with: before) as! NSDictionary
                    let b = try JSONSerialization.jsonObject(with: after) as! NSDictionary
                    precondition(a == b)
                    precondition(Set(a.allKeys as! [String]) == Set(["stage", "operation", "cause", "axCode", "nodesVisited", "depth", "elapsedMilliseconds"]))
                }
                cases += 1
            }
        }
        for code: Int32 in [-25214, -25200, -25215, 1, Int32.min, Int32.max] {
            let log = MemoryAXProbeDiagnostics()
            let failure = log.fail(.axError, axCode: code)
            precondition((failure.axCode != nil) == (-25214 ... -25200).contains(code))
        }
        for time in [Double.infinity, Double.nan, -100, Double.greatestFiniteMagnitude] {
            var clock: TimeInterval = 0
            let log = MemoryAXProbeDiagnostics(now: { clock })
            log.progress(nodes: Int.max, depth: Int.max)
            clock = time
            let failure = log.fail(.limit)
            precondition(failure.nodesVisited == 513 && failure.depth == 17)
            precondition((0...60000).contains(failure.elapsedMilliseconds))
        }
        for cause in [MemoryAXProbeCause.deadline, .cancelled, .contextChanged, .invalidType, .missingValue, .ambiguous, .cycle, .mismatch] {
            let log = MemoryAXProbeDiagnostics()
            try log.mark(.tree, .context)
            do { try log.require(false, cause); preconditionFailure("Must throw") }
            catch let error as MemoryAXProbeFailure { precondition(error.cause == cause && error.axCode == nil) }
        }
        print("{\"stageOperationCases\":\(cases),\"firstFailurePreserved\":true,\"boundedMetadata\":true,\"errorsFailClosed\":true}")
    }
}
