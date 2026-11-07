import UIKit
import UniformTypeIdentifiers

/// Receives a file from the system share sheet, stages it in the App Group inbox and
/// brings the app forward. The page then attaches it to a new session draft; the app
/// itself never opens a draft from here.
final class ShareViewController: UIViewController {
    private static let maxFiles = 8

    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()
        let label = UILabel()
        label.text = "Adding to OpenChamber…"
        label.font = .preferredFont(forTextStyle: .subheadline)
        label.textColor = .secondaryLabel
        let stack = UIStackView(arrangedSubviews: [spinner, label])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        Task { await receive() }
    }

    private func receive() async {
        do {
            let directory = try ShareInbox.resetDirectory()
            let records = await stage(from: extensionContext, in: directory)
            guard !records.isEmpty else { throw ShareInboxError.noFiles }
            try ShareInbox.write(records, in: directory)
            openApp()
            extensionContext?.completeRequest(returningItems: nil)
        } catch {
            presentFailure(error)
        }
    }

    private func stage(from context: NSExtensionContext?, in directory: URL) async -> [ShareInbox.Record] {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        guard !providers.isEmpty else { return [] }

        var records: [ShareInbox.Record] = []
        for provider in providers.prefix(Self.maxFiles) {
            records.append(await stage(provider, in: directory))
        }
        for provider in providers.dropFirst(Self.maxFiles) {
            records.append(ShareInbox.Record(
                id: "",
                name: provider.suggestedName ?? "file",
                mimeType: "application/octet-stream",
                size: 0,
                rejected: "too-many"
            ))
        }
        return records
    }

    private func stage(_ provider: NSItemProvider, in directory: URL) async -> ShareInbox.Record {
        // Read before the callback: capturing the provider inside it is a Sendable warning,
        // and the name never changes.
        let fallbackName = provider.suggestedName ?? "file"
        guard let type = Self.fileType(of: provider) else {
            return ShareInbox.Record(
                id: "",
                name: fallbackName,
                mimeType: "application/octet-stream",
                size: 0,
                rejected: "unsupported-type"
            )
        }

        return await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                // `url` is a temporary file the system deletes after this callback returns,
                // so the copy has to happen here, not after the continuation resumes.
                guard let url else {
                    continuation.resume(returning: ShareInbox.Record(
                        id: "",
                        name: fallbackName,
                        mimeType: type.preferredMIMEType ?? "application/octet-stream",
                        size: 0,
                        rejected: "unreadable"
                    ))
                    return
                }

                let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                let name = url.lastPathComponent.isEmpty ? fallbackName : url.lastPathComponent
                let mimeType = type.preferredMIMEType ?? "application/octet-stream"
                guard size > 0 else {
                    continuation.resume(returning: ShareInbox.Record(
                        id: "", name: name, mimeType: mimeType, size: 0, rejected: "unreadable"
                    ))
                    return
                }
                guard size <= ShareInbox.maxFileBytes else {
                    continuation.resume(returning: ShareInbox.Record(
                        id: "", name: name, mimeType: mimeType, size: size, rejected: "too-large"
                    ))
                    return
                }

                let id = UUID().uuidString
                do {
                    try FileManager.default.copyItem(at: url, to: directory.appendingPathComponent(id))
                } catch {
                    continuation.resume(returning: ShareInbox.Record(
                        id: "", name: name, mimeType: mimeType, size: size, rejected: "unreadable"
                    ))
                    return
                }
                continuation.resume(returning: ShareInbox.Record(
                    id: id, name: name, mimeType: mimeType, size: size, rejected: nil
                ))
            }
        }
    }

    /// A declared identifier with a MIME type first: `public.data` alone would lose the
    /// extension on the way to the composer.
    private static func fileType(of provider: NSItemProvider) -> UTType? {
        let types = provider.registeredTypeIdentifiers.compactMap { UTType($0) }
        return types.first { $0.conforms(to: .data) && $0.preferredMIMEType != nil }
            ?? types.first { $0.conforms(to: .data) }
    }

    /// The share sheet cannot open the containing app through `UIApplication.shared` (it is
    /// unavailable in extensions), and `extensionContext.open` only works for some extension
    /// points. Both are attempted; neither waits, because a share extension that hangs here
    /// would be killed with the file already staged. If both fail the inbox stays put and the
    /// app takes it the next time it becomes active.
    private func openApp() {
        extensionContext?.open(ShareInbox.openURL, completionHandler: nil)

        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(ShareInbox.openURL, options: [:], completionHandler: nil)
                return
            }
            responder = current.next
        }
    }

    private func presentFailure(_ error: Error) {
        let message: String
        switch error as? ShareInboxError {
        case .noFiles:
            message = "No file could be shared with OpenChamber."
        default:
            message = "OpenChamber couldn't receive this file."
        }
        let alert = UIAlertController(title: "OpenChamber", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
        present(alert, animated: true)
    }
}
