// Drives a connected OpenChamber Android app through the WebView's DevTools protocol and a
// real share intent, then keeps screenshots as evidence. Verification-only: it is not built
// into the app and lives on the throwaway verify branch.
//
// Usage: node scripts/verify-android-share.mjs --server-url http://10.0.2.2:4123 --evidence /tmp/evidence

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : args[index + 1];
};

const serverUrl = arg('server-url', 'http://10.0.2.2:4123');
const evidenceDir = arg('evidence', '/tmp/evidence');
const fixturesDir = arg('fixtures', 'evidence');
const packageName = arg('package', 'com.openchamber.app');
const port = Number(arg('port', '9222'));

mkdirSync(evidenceDir, { recursive: true });

const log = (...parts) => console.log('[verify]', ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sh = (command, commandArgs) => execFileSync(command, commandArgs, { encoding: 'utf8' }).trim();

let shotIndex = 0;
const screenshot = (label) => {
    shotIndex += 1;
    const path = join(evidenceDir, `${String(shotIndex).padStart(2, '0')}-${label}.png`);
    writeFileSync(path, execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 32 * 1024 * 1024 }));
    log('screenshot', path);
};

const dumpPage = () => {
    const text = sh('adb', ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml']);
    return sh('adb', ['shell', 'cat', '/sdcard/ui.xml']);
};

const shareText = (text) => {
    sh('adb', [
        'shell', 'am', 'start', '-a', 'android.intent.action.SEND', '-t', 'text/plain',
        '--es', 'android.intent.extra.TEXT', text,
        '-n', `${packageName}/.MainActivity`,
    ]);
};

const shareFile = (devicePath, mimeType) => {
    sh('adb', [
        'shell', 'am', 'start', '-a', 'android.intent.action.SEND', '-t', mimeType,
        '--eu', 'android.intent.extra.STREAM', `file://${devicePath}`,
        '-n', `${packageName}/.MainActivity`,
    ]);
};

const pushPrivateFile = (localPath, devicePath) => {
    sh('adb', ['push', localPath, devicePath]);
    sh('adb', ['shell', 'chmod', '644', devicePath]);
};

const findDevtoolsSocket = async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const unix = sh('adb', ['shell', 'cat', '/proc/net/unix']);
        const match = unix.match(/webview_devtools_remote_\d+/);
        if (match) return match[0];
        await sleep(1000);
    }
    throw new Error('the WebView never exposed a DevTools socket');
};

const openDevtools = async () => {
    const socket = await findDevtoolsSocket();
    sh('adb', ['forward', `tcp:${port}`, `localabstract:${socket}`]);
    log('forwarded', socket, 'to', port);
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json`);
            const targets = await response.json();
            const page = targets.find((target) => target.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch {
            // The socket is forwarded before the page exists.
        }
        await sleep(1000);
    }
    throw new Error('DevTools never listed a page');
};

const rpcFor = (socket) => {
    const pending = new Map();
    let id = 0;
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
    });
    return (method, params) => new Promise((resolve, reject) => {
        id += 1;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
};

const main = async () => {
    const debuggerUrl = await openDevtools();
    const socket = new WebSocket(debuggerUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    const send = rpcFor(socket);

    const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(result.exceptionDetails)}`);
        return result.result?.value;
    };

    const until = async (expression, description, timeoutMs = 90_000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            if (await evaluate(expression)) return;
            await sleep(1000);
        }
        const visible = await evaluate('document.body ? document.body.innerText.slice(0, 2000) : "(no body)"');
        writeFileSync(join(evidenceDir, 'timed-out-page.txt'), String(visible));
        throw new Error(`timed out waiting for ${description}; page showed: ${String(visible).slice(0, 400)}`);
    };

    log('page', await evaluate('location.href'));
    await until('document.readyState === "complete"', 'the page to load');
    await sleep(2000);
    screenshot('connect-screen');

    const clickedManual = await evaluate(`
        (() => {
            const button = [...document.querySelectorAll('button')].find((candidate) => /connect by address/i.test(candidate.textContent || ''));
            if (!button) return false;
            button.click();
            return true;
        })()
    `);
    log('connect-by-address clicked', clickedManual);
    await until('!!document.querySelector(\'input[type="url"]\')', 'the server address field');

    const filled = await evaluate(`
        (() => {
            const field = document.querySelector('input[type="url"]');
            if (!field) return false;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(field, ${JSON.stringify(serverUrl)});
            field.dispatchEvent(new Event('input', { bubbles: true }));
            return field.value;
        })()
    `);
    log('address field holds', filled);

    const connected = await evaluate(`
        (() => {
            const button = [...document.querySelectorAll('button[type="submit"]')].find((candidate) => !candidate.disabled);
            if (!button) return false;
            button.click();
            return true;
        })()
    `);
    log('connect clicked', connected);
    await until('!document.querySelector(\'input[type="url"]\')', 'the connect form to close', 180_000);
    await sleep(8000);
    screenshot('connected');
    writeFileSync(join(evidenceDir, 'ui-connected.xml'), dumpPage());

    const expanded = await evaluate(`
        (() => {
            const prompt = document.querySelector('[data-composer-morph-prompt]');
            if (!prompt) return false;
            prompt.click();
            return true;
        })()
    `);
    log('composer pill clicked', expanded);
    await until('!!document.querySelector(\'[contenteditable="true"]\')', 'the expanded composer');
    await sleep(1200);
    screenshot('composer-expanded');

    shareText('https://openchamber.dev/docs/shared-from-another-app');
    await until(
        '/shared-from-another-app/.test(document.body.innerText)',
        'the shared link in the draft composer',
    );
    await sleep(1500);
    screenshot('draft-text');
    const composerText = await evaluate('document.body.innerText');
    log('composer holds the shared link', /shared-from-another-app/.test(composerText));
    writeFileSync(join(evidenceDir, 'after-text-share.txt'), composerText);

    pushPrivateFile(join(fixturesDir, 'share-e2e.png'), `/data/data/${packageName}/files/share-e2e.png`);
    shareFile(`/data/data/${packageName}/files/share-e2e.png`, 'image/png');
    await until(
        `(() => [...document.querySelectorAll('*')].some((el) => {
            if (el.closest('[data-sonner-toast]')) return false;
            if (!(el.textContent || '').includes('share-e2e.png')) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
        }))()`,
        'the shared image visible in the draft',
    );
    await sleep(1200);
    screenshot('draft-image');
    writeFileSync(join(evidenceDir, 'after-image-share.txt'), await evaluate('document.body.innerText'));

    pushPrivateFile(join(fixturesDir, 'too-large.bin'), `/data/data/${packageName}/files/too-large.bin`);
    shareFile(`/data/data/${packageName}/files/too-large.bin`, 'application/octet-stream');
    await until('/Some files were skipped/i.test(document.body.innerText)', 'the skipped-file toast');
    await sleep(800);
    screenshot('draft-refusal');
    writeFileSync(join(evidenceDir, 'after-refusal-share.txt'), await evaluate('document.body.innerText'));
    log('refusal toast shown');

    const logs = sh('adb', ['logcat', '-d', '-s', 'SharedIntent:*', 'Capacitor/Console:*']);
    writeFileSync(join(evidenceDir, 'logcat.txt'), logs);
    writeFileSync(join(evidenceDir, 'ui.xml'), dumpPage());
    log('done');
    socket.close();
};

main().catch((error) => {
    console.error('[verify] failed:', error);
    try {
        screenshot('failure');
        writeFileSync(join(evidenceDir, 'failure-ui.xml'), dumpPage());
        writeFileSync(join(evidenceDir, 'failure-logcat.txt'), sh('adb', ['logcat', '-d', '-t', '400']));
    } catch {
        // Evidence collection is best effort once the run already failed.
    }
    process.exit(1);
});
