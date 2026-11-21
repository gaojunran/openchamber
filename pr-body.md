## What and why

Part of #6536. This is the Android half of #6537, split out at the maintainer's request; iOS is not in this PR.

Android had no share target at all: a message, a link or a photo opened in another app could only reach OpenChamber by copy and paste. Now the app is offered in the system share sheet for any type. A share opens a new session draft, attaches the files locally and leaves them unsent, and types a shared link or paragraph into the composer. Nothing is sent until Send is pressed, and no file is copied to a server for a draft that has no session yet.

The defects raised in review of #6537 are fixed here:

- **Stream validation.** `SharedIntentReader` compares what the stream delivers with the size its provider declared, refuses a copy that ends early, and refuses a stream that never answers: a blocked read is closed after 15 s, and the whole share is bounded at 30 s so one stalled provider cannot hold every later share.
- **Images stay local until Send.** Shared files go through the composer's own `addAttachedFile`, which keeps them as inline attachments on the draft instead of writing a temp file on a server.
- **Refused files are named.** Native refusals (too many, too large, batch over 32 MB, unsupported, unreadable, timed out) and files the composer's own policy refuses are reported together in one "Some files were skipped" toast, with each file's name and reason.
- **No wrong-draft filing.** The hand-off waits until the chat column shows no session, so a share started from an existing session cannot be filed under the session it left.

Deliberately not here: iOS and the share extension, and the video type in the iOS share menu.

## Affected surfaces

| Runtime | What you ran and saw |
|---|---|
| Web | The draft hand-off is shared UI; type-checked and unit-tested here, and exercised in Capacitor mobile below. |
| Desktop (Electron) | Does not run here |
| VS Code | Does not run here |
| Hosted mobile | Does not run here |
| Capacitor mobile | Android 14 (API 34) emulator: the app is listed in the system share sheet for text and for every type I asked for; sharing a link opens a new draft with the link in the composer and nothing sent; sharing a photo attaches it to the draft, unsent; sharing a 12 MB file produces one "Some files were skipped" toast naming it. |

## Validation

| Check | Result |
|---|---|
| `bun run check:changed` | passed on the final HEAD (type-check, lint, dead code, anti-slop ratchet, file size) |
| `bun run type-check:ui` | ✓ No type errors in 4,484 files |
| `bun test packages/ui/src/lib/nativeSharedFiles.test.ts packages/ui/src/sync/input-store.test.ts` | 54 pass, 0 fail |
| `./gradlew :app:testDebugUnitTest` (CI, Java 21) | 14 tests, 0 failures |
| `./gradlew :app:connectedDebugAndroidTest` on an API 34 emulator (CI) | 15 tests, 0 failures — including the truncated-stream and stalled-stream cases and the package-manager check that the app is offered for `SEND`/`SEND_MULTIPLE` |

**Live run:** Capacitor mobile, Android 14 (API 34) emulator on the CI runner, with a real OpenChamber server on the host. The app was launched, connected to that server through the "Connect by address" sheet, and then three real shares were sent with `adb shell am start -a android.intent.action.SEND -n com.openchamber.app/.MainActivity`: a link, an image (`file://` URI in the app's private files) and a 12 MB file. The draft showed the link in the composer, the image as an unsent attachment, and one refusal toast naming `too-large.bin` as too large. Evidence below.

## Visual evidence

TODO: attach the emulator screenshots (share sheet entry, draft with the shared link, draft with the attached image, refusal toast).

## Known problems

None.
