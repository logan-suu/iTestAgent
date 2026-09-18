import Foundation

@main struct LocalDocumentFixture {
    static func main() throws {
        let manager = FileManager.default
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let project = root.appendingPathComponent("Space % # 项目.xcodeproj", isDirectory: true)
        try manager.createDirectory(at: project, withIntermediateDirectories: true)
        let binding = try MemoryLocalDocumentBinding(expectedURL: project)
        let plain = String(project.absoluteString.dropLast())
        precondition(binding.matches(plain) && binding.matches(plain + "/"))
        let alias = root.appendingPathComponent("alias.xcodeproj")
        try manager.createSymbolicLink(at: alias, withDestinationURL: project)
        precondition(binding.matches(alias.absoluteString))
        let equivalent = plain.replacingOccurrences(of: "file:///private/tmp/", with: "file:///tmp/")
        precondition(binding.matches(equivalent))
        let other = root.appendingPathComponent("other.xcodeproj", isDirectory: true)
        try manager.createDirectory(at: other, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("file.xcodeproj")
        try Data().write(to: file)
        let invalid = [
            "https://example.invalid/project", "relative.xcodeproj", "file:relative.xcodeproj",
            plain.replacingOccurrences(of: "file:///", with: "file://remote/"),
            plain.replacingOccurrences(of: "file:///", with: "file://localhost/"),
            plain.replacingOccurrences(of: "file:///", with: "file://user@/"),
            plain + "?query", plain + "#fragment", plain + "?", plain + "#", plain + "%00",
            plain + "-extra", other.absoluteString, file.absoluteString,
            String(repeating: "a", count: 8193)
        ]
        for raw in invalid { precondition(!binding.matches(raw), "Invalid URL accepted") }
        for raw in [plain + "?q", plain + "#f", file.absoluteString, plain + "-missing"] {
            do { _ = try MemoryLocalDocumentBinding(expectedURL: URL(string: raw)!); preconditionFailure("Invalid expected URL") }
            catch is MemoryLocalDocumentFailure {}
        }
        // Renaming/replacing the expected directory cannot inherit its identity.
        let moved = root.appendingPathComponent("moved.xcodeproj", isDirectory: true)
        try manager.moveItem(at: project, to: moved)
        precondition(!binding.matches(plain))
        try manager.createDirectory(at: project, withIntermediateDirectories: true)
        precondition(!binding.matches(plain))
        precondition(!binding.matches(moved.absoluteString))
        precondition(!binding.matches(alias.absoluteString))
        let replacement = try MemoryLocalDocumentBinding(expectedURL: project)
        precondition(replacement.matches(plain))
        print("{\"directoryRepresentations\":true,\"aliases\":true,\"unsafeURLsRejected\":true,\"replacementRejected\":true}")
    }
}
