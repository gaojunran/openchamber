#!/usr/bin/env node
/**
 * Build a macOS app from upstream main plus a set of your own pull requests.
 *
 * Each run rebuilds the integration branch from scratch: fetch upstream main,
 * merge the PRs listed in `prs.txt` in order, then package an unsigned DMG that
 * runs locally. The point is a daily-driver build you can use for a day and
 * catch your own bugs in, not a release.
 *
 *   node selfbuild/oc-selfbuild.mjs                 # build
 *   node selfbuild/oc-selfbuild.mjs --dry-run       # merge only, list what would build
 *   node selfbuild/oc-selfbuild.mjs --prs 5863,5514 # ad-hoc set instead of prs.txt
 *
 * Nothing is written to your checkout: merges happen in a scratch worktree, and
 * only `git fetch` touches the repository itself.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const IS_MAC = process.platform === 'darwin';

const args = parseArgs(process.argv.slice(2));
const log = (...parts) => console.log('[selfbuild]', ...parts);

function parseArgs(argv) {
    const options = {
        dryRun: false,
        noPackage: false,
        noCheck: false,
        noInstall: false,
        keep: false,
        prs: null,
        out: null,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = () => {
            index += 1;
            if (index >= argv.length) throw new Error(`${arg} needs a value`);
            return argv[index];
        };
        if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--no-package') options.noPackage = true;
        else if (arg === '--no-check') options.noCheck = true;
        else if (arg === '--no-install') options.noInstall = true;
        else if (arg === '--keep') options.keep = true;
        else if (arg === '--prs') options.prs = next();
        else if (arg === '--out') options.out = next();
        else if (arg === '--help' || arg === '-h') {
            console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
            process.exit(0);
        } else throw new Error(`unknown argument ${arg}`);
    }
    return options;
}

function git(cwd, ...argv) {
    return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Runs a command with inherited output; throws with its exit code on failure. */
function run(command, argv, cwd, env = {}) {
    const result = spawnSync(command, argv, {
        cwd,
        env: { ...process.env, ...env },
        stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error(`${command} ${argv.join(' ')} failed (exit ${result.status})`);
}

const repoRoot = git(SCRIPT_DIR, 'rev-parse', '--show-toplevel');

const upstreamRemote = (() => {
    const remotes = git(repoRoot, 'remote').split('\n');
    if (remotes.includes('upstream')) return 'upstream';
    const originUrl = git(repoRoot, 'remote', 'get-url', 'origin');
    if (/openchamber\/openchamber(\.git)?$/.test(originUrl)) return 'origin';
    throw new Error(
        `no remote points at openchamber/openchamber (origin is ${originUrl}); `
        + 'add it as "upstream" or point origin at it',
    );
})();

const workdir = process.env.OC_SELFBUILD_WORKTREE
    ?? path.join(IS_MAC ? path.join(os.homedir(), 'Library', 'Caches') : (process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache')), 'oc-selfbuild', 'work');

const outDir = args.out ?? path.join(IS_MAC ? path.join(os.homedir(), 'Downloads') : os.tmpdir(), 'oc-selfbuild');
const logFile = path.join(IS_MAC ? path.join(os.homedir(), 'Library', 'Logs') : outDir, 'oc-selfbuild.log');

/** `5863` or `5863 union-docs`, one per line; `#` starts a comment. */
function readPrList() {
    if (args.prs) {
        return args.prs
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => parsePrEntry(entry));
    }
    const file = path.join(SCRIPT_DIR, 'prs.txt');
    if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
    return fs.readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*/, '').trim())
        .filter(Boolean)
        .map((entry) => parsePrEntry(entry));
}

function parsePrEntry(entry) {
    const [number, ...flags] = entry.split(/\s+/);
    if (!/^\d+$/.test(number)) throw new Error(`bad PR entry "${entry}"`);
    const unionDocs = flags.includes('union-docs');
    const unknown = flags.filter((flag) => flag !== 'union-docs');
    if (unknown.length > 0) throw new Error(`unknown flag(s) ${unknown.join(' ')} on PR #${number}`);
    return { number: Number(number), unionDocs };
}

/**
 * Both sides of a markdown conflict are additive in this repository (a PR
 * appends a paragraph after the same anchor), so keeping both is the merge a
 * human would make. Identical blocks collapse to one.
 */
function unionMarkdown(file) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const output = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].startsWith('<<<<<<<')) {
            output.push(lines[index]);
            continue;
        }
        const ours = [];
        const theirs = [];
        index += 1;
        while (index < lines.length && !lines[index].startsWith('=======')) ours.push(lines[index++]);
        index += 1;
        while (index < lines.length && !lines[index].startsWith('>>>>>>>')) theirs.push(lines[index++]);
        if (ours.join('\n').trim() === theirs.join('\n').trim()) output.push(...ours);
        else output.push(...ours, '', ...theirs);
    }
    fs.writeFileSync(file, output.join('\n'));
}

function ensureWorktree(baseRef) {
    const isWorktree = spawnSync('git', ['-C', workdir, 'rev-parse', '--git-dir'], { stdio: 'ignore' }).status === 0;
    if (isWorktree) {
        git(workdir, 'reset', '--hard', '--quiet', baseRef);
        git(workdir, 'clean', '-fdq');
    } else {
        if (fs.existsSync(workdir)) {
            throw new Error(`${workdir} exists but is not a git worktree; move it away and re-run`);
        }
        fs.mkdirSync(path.dirname(workdir), { recursive: true });
        git(repoRoot, 'worktree', 'add', '--detach', '--quiet', workdir, baseRef);
    }
}

function preflight() {
    if (args.noPackage || args.dryRun) return;
    const toolchain = spawnSync('xcode-select', ['-p'], { encoding: 'utf8' });
    if (toolchain.status !== 0) {
        throw new Error('missing Xcode command line tools (xcode-select -p failed); node-pty cannot be rebuilt without them');
    }
}

function main() {
    if (!args.noPackage && !args.dryRun && !IS_MAC) {
        throw new Error('a DMG needs macOS; pass --no-package to check the merge set from another OS');
    }

    const prs = readPrList();
    preflight();
    log(`repo ${repoRoot} · upstream ${upstreamRemote} · ${prs.length} PR(s)`);

    log(`fetching ${upstreamRemote}/main`);
    git(repoRoot, 'fetch', '--quiet', upstreamRemote, 'main');
    const baseRef = `${upstreamRemote}/main`;
    const baseSha = git(repoRoot, 'rev-parse', '--short', baseRef);
    const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/electron/package.json'), 'utf8')).version;

    ensureWorktree(baseRef);
    log(`worktree ${workdir} at ${baseSha}`);

    const merged = [];
    const skipped = [];

    for (const pr of prs) {
        const ref = `refs/selfbuild/pr-${pr.number}`;
        try {
            git(repoRoot, 'fetch', '--quiet', '--force', upstreamRemote, `pull/${pr.number}/head:${ref}`);
        } catch {
            skipped.push({ pr: pr.number, reason: 'fetch failed (wrong number, or the PR is gone)' });
            log(`#${pr.number} skipped: cannot fetch pull/${pr.number}/head`);
            continue;
        }
        const sha = git(repoRoot, 'rev-parse', '--short', ref);
        const subject = git(repoRoot, 'log', '-1', '--format=%s', ref);

        const result = spawnSync('git', ['merge', '--no-ff', '--no-edit', '--quiet', ref], {
            cwd: workdir,
            encoding: 'utf8',
        });
        if (result.status === 0) {
            merged.push({ pr: pr.number, sha, subject, unionDocs: [] });
            log(`#${pr.number} merged (${sha})`);
            continue;
        }

        const conflicted = git(workdir, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
        const docsOnly = conflicted.length > 0 && conflicted.every((file) => file.endsWith('.md'));
        if (pr.unionDocs && docsOnly) {
            for (const file of conflicted) unionMarkdown(path.join(workdir, file));
            git(workdir, 'add', '-A');
            git(workdir, 'commit', '--no-edit', '--quiet');
            merged.push({ pr: pr.number, sha, subject, unionDocs: conflicted });
            log(`#${pr.number} merged with both sides kept in: ${conflicted.join(', ')} (review this file)`);
            continue;
        }

        if (result.status === null) throw new Error(`git merge #${pr.number} could not start`);
        spawnSync('git', ['merge', '--abort'], { cwd: workdir, stdio: 'ignore' });
        skipped.push({ pr: pr.number, reason: 'merge conflict', files: conflicted });
        log(`#${pr.number} skipped: conflict in ${conflicted.join(', ') || '(unknown)'}`);
    }

    const headSha = git(workdir, 'rev-parse', '--short', 'HEAD');
    const report = {
        builtAt: new Date().toISOString(),
        base: { ref: baseRef, sha: baseSha },
        version,
        commit: headSha,
        merged,
        skipped,
    };
    fs.writeFileSync(path.join(workdir, 'selfbuild-report.json'), `${JSON.stringify(report, null, 2)}\n`);

    if (!args.noCheck) {
        log('installing dependencies and type-checking');
        run('bun', ['install', '--frozen-lockfile'], workdir);
        run('bun', ['run', 'type-check:ui'], workdir);
    } else {
        run('bun', ['install', '--frozen-lockfile'], workdir);
    }

    if (args.dryRun) {
        printSummary(report, null);
        return;
    }

    if (args.noPackage) {
        log('building web assets only (--no-package)');
        run('bun', ['run', 'build:web-assets'], path.join(workdir, 'packages/electron'));
        printSummary(report, null);
        return;
    }

    const distDir = path.join(workdir, 'packages/electron/dist');
    const before = new Set(fs.existsSync(distDir) ? fs.readdirSync(distDir) : []);

    log('packaging (unsigned; this takes a few minutes)');
    const startedAt = Date.now();
    run('bun', ['run', 'package', '--', '--publish=never'], path.join(workdir, 'packages/electron'), {
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    });
    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    const produced = (fs.existsSync(distDir) ? fs.readdirSync(distDir) : [])
        .filter((name) => name.endsWith('.dmg') && !before.has(name));
    if (produced.length === 0) throw new Error(`no new .dmg in ${distDir}`);

    fs.mkdirSync(outDir, { recursive: true });
    const artifact = path.join(outDir, `OpenChamber-${version}-self-${headSha}.dmg`);
    fs.copyFileSync(path.join(distDir, produced[0]), artifact);
    fs.writeFileSync(path.join(outDir, 'selfbuild-report.json'), `${JSON.stringify(report, null, 2)}\n`);

    let installed = null;
    if (!args.noInstall) installed = installApp(artifact, report);

    const summary = { artifact, seconds: elapsed, installed };
    fs.appendFileSync(logFile, `${JSON.stringify({ ...report, ...summary })}\n`);
    printSummary(report, summary);
}

/** Mounts the DMG and replaces /Applications/OpenChamber.app with it. */
function installApp(dmgPath, report) {
    const target = '/Applications/OpenChamber.app';
    const mounted = execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-plist', dmgPath], { encoding: 'utf8' });
    const volume = [...mounted.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].at(-1)?.[1];
    if (!volume) throw new Error('could not find the mounted volume');
    try {
        const app = fs.readdirSync(volume).find((name) => name.endsWith('.app'));
        if (!app) throw new Error(`no .app in ${volume}`);
        if (spawnSync('pgrep', ['-x', 'OpenChamber']).status === 0) {
            throw new Error('OpenChamber is running; quit it and re-run (the DMG is kept, --no-install skips this step)');
        }
        fs.rmSync(target, { recursive: true, force: true });
        run('ditto', [path.join(volume, app), target], '/');
        // The app self-identifies: which PRs this binary was built from.
        fs.writeFileSync(
            path.join(target, 'Contents/Resources/self-build.json'),
            `${JSON.stringify(report, null, 2)}\n`,
        );
        log(`installed ${target}`);
        return target;
    } finally {
        spawnSync('hdiutil', ['detach', volume, '-quiet']);
    }
}

function printSummary(report, summary) {
    console.log('\n=== selfbuild ===');
    console.log(`base   ${report.base.ref} ${report.base.sha}`);
    console.log(`commit ${report.commit}  (${
        report.merged.map((entry) => `#${entry.pr}`).join(' ') || 'no PRs'
    })`);
    if (report.skipped.length > 0) {
        console.log('skipped:');
        for (const entry of report.skipped) {
            console.log(`  #${entry.pr}  ${entry.reason}${entry.files?.length ? `: ${entry.files.join(', ')}` : ''}`);
        }
    }
    const unioned = report.merged.filter((entry) => entry.unionDocs.length > 0);
    if (unioned.length > 0) {
        console.log('auto-merged docs (both sides kept, read these once):');
        for (const entry of unioned) console.log(`  #${entry.pr}: ${entry.unionDocs.join(', ')}`);
    }
    if (summary) {
        console.log(`dmg    ${summary.artifact}  (${summary.seconds}s)`);
        if (summary.installed) console.log(`app    ${summary.installed}`);
        console.log(`log    ${logFile}`);
    }
    console.log(`work   ${workdir}${args.keep ? '' : '  (rebuilt next run)'}`);
}

try {
    main();
} catch (error) {
    console.error(`[selfbuild] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
