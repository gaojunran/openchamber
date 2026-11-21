package com.openchamber.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Turns a share intent into the payload SharedFiles.takePending hands to the page. */
final class SharedIntentReader {

    private static final int CHUNK_BYTES = 64 * 1024;
    /** A provider that stops serving bytes must not hold the reader until the process dies. */
    static final long DEFAULT_READ_TIMEOUT_MS = 15_000;
    /** The whole share, so eight stalled files cannot add up to two minutes. */
    static final long DEFAULT_SHARE_DEADLINE_MS = 30_000;
    /** Consecutive zero-byte reads before the stream is treated as stalled. */
    private static final int MAX_EMPTY_READS = 8;

    private SharedIntentReader() {}

    /**
     * Reads one share, or returns null when the intent carries none. It performs file I/O,
     * so the caller must run it off the main thread.
     */
    static SharedPayloadStore.SharedPayload read(Intent intent, ContentResolver resolver) {
        return read(intent, resolver, DEFAULT_READ_TIMEOUT_MS, DEFAULT_SHARE_DEADLINE_MS);
    }

    /**
     * The same read with an explicit per-file timeout and whole-share deadline, so a test can
     * drive a stalled provider without waiting the production time out.
     */
    static SharedPayloadStore.SharedPayload read(
        Intent intent,
        ContentResolver resolver,
        long readTimeoutMs,
        long deadlineMs
    ) {
        if (intent == null) {
            return null;
        }
        String action = intent.getAction();
        boolean multiple = Intent.ACTION_SEND_MULTIPLE.equals(action);
        if (!multiple && !Intent.ACTION_SEND.equals(action)) {
            return null;
        }

        String text = readText(intent);
        List<Uri> streams = readStreams(intent, multiple);
        if (text == null && streams.isEmpty()) {
            return null;
        }

        List<SharedPayloadStore.FilePayload> files = new ArrayList<>();
        List<SharedPayloadStore.Rejection> rejected = new ArrayList<>();
        long batchBytes = 0;
        long deadline = System.nanoTime() + deadlineMs * 1_000_000L;

        for (int index = 0; index < streams.size(); index++) {
            Uri uri = streams.get(index);
            if (uri == null) {
                continue;
            }
            Metadata metadata = readMetadata(resolver, uri);

            // Android accepts any shared type; the web layer's attachment rules filter.
            String refusal = SharedPayloadStore.rejectionReason(index, metadata.size, batchBytes, true, true);
            if (refusal != null) {
                rejected.add(new SharedPayloadStore.Rejection(metadata.name, refusal));
                continue;
            }

            long remainingMs = (deadline - System.nanoTime()) / 1_000_000L;
            if (remainingMs <= 0) {
                // The share took too long already; name the rest instead of reading on.
                rejected.add(new SharedPayloadStore.Rejection(metadata.name, SharedPayloadStore.REASON_TIMED_OUT));
                continue;
            }

            ReadResult result = readBytes(resolver, uri, metadata.size, Math.min(readTimeoutMs, remainingMs));
            if (result.reason != null) {
                rejected.add(new SharedPayloadStore.Rejection(metadata.name, result.reason));
                continue;
            }
            // A provider may under-report SIZE, so the batch is checked against what was read.
            refusal = SharedPayloadStore.rejectionReason(index, result.data.length, batchBytes, true, true);
            if (refusal != null) {
                rejected.add(new SharedPayloadStore.Rejection(metadata.name, refusal));
                continue;
            }

            String mimeType = readMimeType(resolver, uri);
            files.add(new SharedPayloadStore.FilePayload(
                metadata.name,
                mimeType,
                Base64.encodeToString(result.data, Base64.NO_WRAP)
            ));
            batchBytes += result.data.length;
        }

        return new SharedPayloadStore.SharedPayload(text, files, rejected);
    }

    private static String readText(Intent intent) {
        CharSequence raw = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (raw == null) {
            return null;
        }
        String text = raw.toString().trim();
        return text.isEmpty() ? null : text;
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> readStreams(Intent intent, boolean multiple) {
        if (multiple) {
            ArrayList<Uri> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            return streams == null ? Collections.<Uri>emptyList() : new ArrayList<>(streams);
        }
        Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return stream == null ? Collections.<Uri>emptyList() : Collections.singletonList(stream);
    }

    private static Metadata readMetadata(ContentResolver resolver, Uri uri) {
        String name = null;
        long size = -1;
        String[] columns = { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        try (Cursor cursor = resolver.query(uri, columns, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) {
                    name = cursor.getString(nameColumn);
                }
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) {
                    size = cursor.getLong(sizeColumn);
                }
            }
        } catch (RuntimeException ignored) {
            // A provider may refuse the query; the URI and its stream can still work.
        }
        if (name == null || name.trim().isEmpty()) {
            name = uri.getLastPathSegment();
        }
        if (name == null || name.isEmpty()) {
            name = "file";
        }
        return new Metadata(name, size);
    }

    private static String readMimeType(ContentResolver resolver, Uri uri) {
        String type;
        try {
            type = resolver.getType(uri);
        } catch (RuntimeException ignored) {
            type = null;
        }
        return type == null || type.isEmpty() ? "application/octet-stream" : type;
    }

    /**
     * Reads the stream with the provider's declared size as the expected length: a stream that
     * ends early is a truncated file and is refused by name instead of being attached.
     */
    private static ReadResult readBytes(
        ContentResolver resolver,
        Uri uri,
        long declaredSize,
        long timeoutMs
    ) {
        InputStream stream = null;
        Thread watchdog = null;
        try {
            stream = resolver.openInputStream(uri);
            if (stream == null) {
                return ReadResult.failure(SharedPayloadStore.REASON_UNREADABLE);
            }

            // A blocked read() cannot be interrupted, so the only way out is closing the stream
            // from another thread; the read then throws and the file is reported.
            final Closeable guarded = stream;
            watchdog = new Thread(() -> {
                try {
                    Thread.sleep(timeoutMs);
                } catch (InterruptedException interrupted) {
                    return;
                }
                closeQuietly(guarded);
            }, "share-read-timeout");
            watchdog.setDaemon(true);
            watchdog.start();

            int initialSize = declaredSize > 0 && declaredSize <= SharedPayloadStore.MAX_FILE_BYTES
                ? (int) declaredSize
                : CHUNK_BYTES;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream(initialSize);
            byte[] chunk = new byte[CHUNK_BYTES];
            long total = 0;
            int emptyReads = 0;
            int read;
            while ((read = stream.read(chunk)) != -1) {
                if (read == 0) {
                    // Some providers return 0 instead of blocking; do not spin forever on it.
                    if (++emptyReads >= MAX_EMPTY_READS) {
                        return ReadResult.failure(
                            watchdogFired(watchdog) ? SharedPayloadStore.REASON_TIMED_OUT : SharedPayloadStore.REASON_UNREADABLE
                        );
                    }
                    continue;
                }
                emptyReads = 0;
                total += read;
                // Stop before a too-large file is held in memory in full.
                if (total > SharedPayloadStore.MAX_FILE_BYTES) {
                    return ReadResult.failure(SharedPayloadStore.REASON_TOO_LARGE);
                }
                buffer.write(chunk, 0, read);
            }
            if (total == 0) {
                // An empty share cannot be attached, and the page's payload schema refuses an
                // empty file, so name it instead of sending something it would drop whole.
                return ReadResult.failure(SharedPayloadStore.REASON_UNREADABLE);
            }
            if (declaredSize > 0 && total != declaredSize) {
                // The provider promised a size the stream did not deliver, so the copy is
                // truncated and must not be attached as if it were the whole file.
                return ReadResult.failure(SharedPayloadStore.REASON_UNREADABLE);
            }
            return new ReadResult(buffer.toByteArray(), null);
        } catch (IOException | RuntimeException error) {
            return ReadResult.failure(
                watchdogFired(watchdog) ? SharedPayloadStore.REASON_TIMED_OUT : SharedPayloadStore.REASON_UNREADABLE
            );
        } finally {
            if (watchdog != null) {
                watchdog.interrupt();
            }
            closeQuietly(stream);
        }
    }

    /** True only after the watchdog closed the stream; a null watchdog never fired. */
    private static boolean watchdogFired(Thread watchdog) {
        return watchdog != null && !watchdog.isAlive();
    }

    private static void closeQuietly(Closeable stream) {
        if (stream == null) {
            return;
        }
        try {
            stream.close();
        } catch (IOException ignored) {
            // Closing is the recovery path; a failure here changes nothing.
        }
    }

    private static final class Metadata {
        final String name;
        final long size;

        Metadata(String name, long size) {
            this.name = name;
            this.size = size;
        }
    }

    private static final class ReadResult {
        final byte[] data;
        final String reason;

        ReadResult(byte[] data, String reason) {
            this.data = data;
            this.reason = reason;
        }

        static ReadResult failure(String reason) {
            return new ReadResult(null, reason);
        }
    }
}
