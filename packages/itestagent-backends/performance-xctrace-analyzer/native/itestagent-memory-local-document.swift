import Foundation
import Darwin

enum MemoryLocalDocumentFailure: Error { case invalidURL, unavailable }

// Keep the original directory open so replacement cannot be accepted merely
// because it occupies the same path. No document contents are read.
final class MemoryLocalDocumentBinding {
    private let descriptor: Int32
    private let canonicalPath: String
    private let device: dev_t
    private let inode: ino_t

    private static func localPath(_ raw: String) throws -> String {
        guard raw.utf8.count <= 8192,
              let components = URLComponents(string: raw), components.scheme == "file",
              components.host == nil || components.host == "",
              components.user == nil, components.password == nil, components.port == nil,
              components.query == nil, components.fragment == nil,
              components.percentEncodedPath.hasPrefix("/"),
              let url = components.url, url.isFileURL else { throw MemoryLocalDocumentFailure.invalidURL }
        let path = url.path
        guard path.hasPrefix("/"), !path.utf8.contains(0), path.utf8.count <= 8192 else {
            throw MemoryLocalDocumentFailure.invalidURL
        }
        return path
    }
    private static func openDirectory(_ raw: String) throws -> (String, Int32, stat) {
        let path = try localPath(raw)
        guard let resolved = realpath(path, nil) else { throw MemoryLocalDocumentFailure.unavailable }
        let canonical = String(cString: resolved)
        free(resolved)
        let fd = open(canonical, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw MemoryLocalDocumentFailure.unavailable }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else {
            close(fd); throw MemoryLocalDocumentFailure.unavailable
        }
        return (canonical, fd, info)
    }
    init(expectedURL: URL) throws {
        let (path, fd, info) = try Self.openDirectory(expectedURL.absoluteString)
        canonicalPath = path
        descriptor = fd
        device = info.st_dev
        inode = info.st_ino
    }
    deinit { close(descriptor) }

    func matches(_ actualURL: String) -> Bool {
        guard let (path, fd, info) = try? Self.openDirectory(actualURL) else { return false }
        defer { close(fd) }
        // Exact canonical path AND retained directory identity; no basename or
        // prefix matching. The descriptor is retained until this binding is released.
        return path == canonicalPath && info.st_dev == device && info.st_ino == inode
    }
}
