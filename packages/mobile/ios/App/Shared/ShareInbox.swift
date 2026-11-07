import Foundation

/// The hand-off between the share extension and the app: a shared file is copied into the
/// App Group container, and the app reads and deletes it once the page asks for it. Both
/// targets compile this file, so the layout has one definition.
enum ShareInbox {
    struct Record: Codable {
        /// File name inside the inbox directory; empty for a file that was refused.
        let id: String
        let name: String
        let mimeType: String
        let size: Int
        /// Set when the file was not staged: the page reports the name instead of attaching it.
        let rejected: String?
    }

    static let appGroup = "group.com.openchamber.app"
    static let directoryName = "SharedInbox"
    static let manifestName = "manifest.json"
    /// Opening this brings the app forward after a share. It carries no content: the page
    /// still has to take the files from the inbox, so a link cannot attach anything itself.
    static let openURL = URL(string: "openchamber://shared-file")!
    /// The most the bridge hands the page at once. A larger file is refused by name rather
    /// than failing halfway through the copy.
    static let maxFileBytes = 24 * 1024 * 1024
    /// The page holds every accepted file as base64 at the same time, so a batch is capped
    /// as well; the files past it are refused by name.
    static let maxBatchBytes = 32 * 1024 * 1024

    static func directory() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(directoryName, isDirectory: true)
    }

    /// Replaces whatever the last share left, so the newest share is the one that arrives.
    static func resetDirectory() throws -> URL {
        guard let directory = directory() else { throw ShareInboxError.noAppGroup }
        let manager = FileManager.default
        try? manager.removeItem(at: directory)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    static func write(_ records: [Record], in directory: URL) throws {
        let data = try JSONEncoder().encode(records)
        try data.write(to: directory.appendingPathComponent(manifestName), options: .atomic)
    }

    static func hasPending() -> Bool {
        guard let directory = directory() else { return false }
        return FileManager.default.fileExists(atPath: directory.appendingPathComponent(manifestName).path)
    }

    /// Files the page can attach, plus the ones that were refused when they were shared.
    /// The inbox is emptied either way: a share is delivered once.
    static func take() -> (files: [[String: Any]], rejected: [[String: String]]) {
        guard let inbox = directory() else { return ([], []) }
        // Claim the share by renaming the directory. The subscribe-time take and the
        // foreground announcement can race; the loser then finds no inbox instead of
        // delivering the same files twice.
        let claimed = inbox.deletingLastPathComponent()
            .appendingPathComponent("\(directoryName)-\(UUID().uuidString)", isDirectory: true)
        guard (try? FileManager.default.moveItem(at: inbox, to: claimed)) != nil else {
            return ([], [])
        }
        defer { try? FileManager.default.removeItem(at: claimed) }

        guard let manifest = try? Data(contentsOf: claimed.appendingPathComponent(manifestName)),
              let records = try? JSONDecoder().decode([Record].self, from: manifest) else {
            return ([], [])
        }

        var files: [[String: Any]] = []
        var rejected: [[String: String]] = []
        var batchBytes = 0
        for record in records {
            if let reason = record.rejected {
                rejected.append(["name": record.name, "reason": reason])
                continue
            }
            guard record.size <= maxFileBytes,
                  batchBytes + record.size <= maxBatchBytes,
                  let data = try? Data(contentsOf: claimed.appendingPathComponent(record.id)) else {
                rejected.append(["name": record.name, "reason": "too-large"])
                continue
            }
            batchBytes += record.size
            files.append([
                "name": record.name,
                "mimeType": record.mimeType,
                "data": data.base64EncodedString(),
            ])
        }
        return (files, rejected)
    }
}

enum ShareInboxError: Error {
    case noAppGroup
    case noFiles
}
