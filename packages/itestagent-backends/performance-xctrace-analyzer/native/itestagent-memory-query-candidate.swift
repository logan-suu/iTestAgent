import Foundation
import CryptoKit
import Security
import Darwin

// The parent pins the reviewed manifest digest. The manifest itself cannot claim
// signature validity; public code-signing validation is performed independently.
struct MemoryQueryCandidate {
    let root: URL
    let expectedDigest: String
    var version: Int = 3
    private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func read(_ path: String, limit: Int) throws -> Data {
        var info = stat()
        guard lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == getuid(), info.st_nlink == 1, info.st_mode & 0o022 == 0,
              info.st_size >= 0, info.st_size <= limit else { throw MemoryIPCError.invalid }
        let fd = open(path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw MemoryIPCError.invalid }; defer { Darwin.close(fd) }
        var current = stat()
        guard fstat(fd, &current) == 0, current.st_ino == info.st_ino, current.st_dev == info.st_dev else { throw MemoryIPCError.invalid }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        let data = try handle.read(upToCount: limit + 1) ?? Data()
        guard data.count == info.st_size else { throw MemoryIPCError.invalid }; return data
    }
    func matches(requireSignature: Bool = true) -> Bool {
        do {
            guard root.isFileURL, root.standardizedFileURL == root.resolvingSymlinksInPath().standardizedFileURL else { return false }
            var info = stat()
            guard lstat(root.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
                  info.st_uid == getuid(), info.st_mode & 0o077 == 0 else { return false }
            let raw = try read(root.appendingPathComponent("candidate.json").path, limit: 65536)
            guard hash(raw) == expectedDigest,
                  let manifest = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
                  Set(manifest.keys) == Set(["schemaVersion", "protocolVersion", "purpose", "toolchain", "files"] + (version == 4 ? ["profile"] : [])),
                  manifest["schemaVersion"] as? Int == 1, manifest["protocolVersion"] as? Int == version,
                  version == 3 || (version == 4 && manifest["profile"] as? String == "no_target_resources"),
                  manifest["purpose"] as? String == "offline-query-candidate",
                  let files = manifest["files"] as? [String: String], files.count <= 256,
                  let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
            else { return false }
            var seen = Set<String>(); var total = 0; var nodes = 0
            for case let url as URL in enumerator {
                nodes += 1; guard nodes <= 256 else { return false }
                let relative = String(url.path.dropFirst(root.path.count + 1))
                guard relative.split(separator: "/").count <= 10,
                      lstat(url.path, &info) == 0, info.st_uid == getuid(), info.st_mode & 0o022 == 0 else { return false }
                if info.st_mode & S_IFMT == S_IFDIR { continue }
                if relative == "candidate.json" { continue }
                guard let digest = files[relative] else { return false }
                let data = try read(url.path, limit: 32 * 1024 * 1024)
                total += data.count; guard total <= 128 * 1024 * 1024, hash(data) == digest else { return false }
                seen.insert(relative)
            }
            guard seen == Set(files.keys), files["itestagent-memory-query-launcher"] != nil,
                  files["iTestAgentMemoryQueryHelper.app/Contents/MacOS/itestagent-memory-query-helper"] != nil else { return false }
            if requireSignature {
                for path in ["itestagent-memory-query-launcher", "iTestAgentMemoryQueryHelper.app"] {
                    var code: SecStaticCode?
                    guard SecStaticCodeCreateWithPath(root.appendingPathComponent(path) as CFURL, SecCSFlags(), &code) == errSecSuccess,
                          let code, SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess else { return false }
                }
            }
            return true
        } catch { return false }
    }
}
