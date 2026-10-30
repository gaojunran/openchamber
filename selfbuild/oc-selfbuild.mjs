#!/usr/bin/env node
/**
 * Build a macOS app from upstream main plus your own open pull requests.
 *
 * There is no list to maintain. Each run asks GitHub which PRs you have open,
 * drops the ones whose commits are already contained in another PR of the set
 * (a stacked PR), and merges the rest in ascending number order. A markdown
 * conflict where both sides only insert at the same anchor keeps both sides;
 * anything else skips that PR and reports it.
 *
 *   node selfbuild/oc-selfbuild.mjs                 # build
 *   node selfbuild/oc-selfbuild.mjs --dry-run       # merge only, no packaging
 *   node selfbuild/oc-selfbuild.mjs --prs 5863,5514 # explicit set instead
 *   node selfbuild/oc-selfbuild.mjs --author you    # whose open PRs to take
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
        prs: null,
        author: null,
        out: null,
        repo: null,
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
        else if (arg === '--prs') options.prs = next();
        else if (arg === '--author') options.author = next();
        else if (arg === '--out') options.out = next();
        else if (arg === '--repo') options.repo = next();
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

function gh(argv) {
    const result = spawnSync('gh', argv, { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`gh ${argv.join(' ')} failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
    }
    return result.stdout;
}

const repoRoot = git(SCRIPT_DIR, 'rev-parse', '--show-toplevel');

const upstreamRemote = (() => {
    const remotes = git(repoRoot, 'remote').split('\n');
    if (remotes.includes('upstream')) return 'upstream';
    if (/openchamber\/openchamber(\.git)?$/.test(git(repoRoot, 'remote', 'get-url', 'origin'))) return 'origin';
    throw new Error(
        'no remote points at openchamber/openchamber; add it as "upstream" '
        + '(git remote add upstream https://github.com/openchamber/openchamber.git)',
    );
})();

const upstreamSlug = (() => {
    if (args.repo) return args.repo;
    const url = git(repoRoot, 'remote', 'get-url', upstreamRemote);
    const match = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    if (!match) throw new Error(`cannot read a GitHub slug out of ${url}`);
    return `${match[1]}/${match[2]}`;
})();

const workdir = process.env.OC_SELFBUILD_WORKTREE
    ?? path.join(IS_MAC ? path.join(os.homedir(), 'Library', 'Caches') : (process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache')), 'oc-selfbuild', 'work');

const outDir = args.out ?? path.join(IS_MAC ? path.join(os.homedir(), 'Downloads') : os.tmpdir(), 'oc-selfbuild');
const logFile = path.join(IS_MAC ? path.join(os.homedir(), 'Library', 'Logs') : outDir, 'oc-selfbuild.log');

const author = args.author ?? process.env.SELFBUILD_AUTHOR ?? gh(['api', 'user', '--jq', '.login']).trim();

/** Optional opt-out list: PR numbers, one per line. Absent file means take all. */
function readSkipList() {
    const file = path.join(SCRIPT_DIR, 'skip.txt');
    if (!fs.existsSync(file)) return new Set();
    return new Set(
        fs.readFileSync(file, 'utf8')
            .split('\n')
            .map((line) => line.replace(/#.*/, '').trim())
            .filter(Boolean)
            .map((entry) => {
                if (!/^\d+$/.test(entry)) throw new Error(`bad PR number "${entry}" in skip.txt`);
                return Number(entry);
            }),
    );
}

function listOpenPrs() {
    const json = gh([
        'pr', 'list',
        '--repo', upstreamSlug,
        '--author', author,
        '--state', 'open',
        '--limit', '100',
        '--json', 'number,title,isDraft,headRefOid',
    ]);
    return JSON.parse(json).sort((left, right) => left.number - right.number);
}

function fetchPrHead(number) {
    const ref = `refs/selfbuild/pr-${number}`;
    git(repoRoot, 'fetch', '--quiet', '--force', upstreamRemote, `pull/${number}/head:${ref}`);
    return git(repoRoot, 'rev-parse', ref);
}

/**
 * A stacked PR's commits are already inside another PR of the set, possibly as
 * rebased copies with different hashes — `git cherry` compares patch ids, so a
 * rebased stack is recognised where a plain ancestry test is not. Merging both
 * would duplicate the patch and, worse, produce a recursive-merge conflict.
 */
function dropStacked(entries) {
    const kept = [];
    for (const entry of entries) {
        const coveredBy = entries.find((other) => {
            if (other === entry || other.number < entry.number) return false;
            const result = spawnSync('git', ['cherry', other.ref, entry.ref], { cwd: repoRoot, encoding: 'utf8' });
            if (result.status !== 0) return false;
            const lines = result.stdout.trim().split('\n').filter(Boolean);
            return lines.every((line) => line.startsWith('-'));
        });
        if (coveredBy) log(`#${entry.number} dropped: its commits are already in #${coveredBy.number}`);
        else kept.push(entry);
    }
    return kept;
}

/**
 * Both sides of an additive markdown conflict insert at the same anchor, so
 * keeping both is the merge a human would make. Requires diff3 markers: a hunk
 * whose base section is empty is purely additive; anything else is a real edit
 * collision and the caller skips the PR instead of guessing.
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
        const base = [];
        const theirs = [];
        let section = 'ours';
        for (index += 1; index < lines.length; index += 1) {
            const line = lines[index];
            if (line.startsWith('|||||||')) section = 'base';
            else if (line.startsWith('=======')) section = 'theirs';
            else if (line.startsWith('>>>>>>>')) break;
            else if (section === 'ours') ours.push(line);
            else if (section === 'base') base.push(line);
            else theirs.push(line);
        }
        if (base.join('\n').trim() !== '') return false;
        if (ours.join('\n').trim() === '' || theirs.join('\n').trim() === '') return false;
        if (ours.join('\n').trim() === theirs.join('\n').trim()) output.push(...ours);
        else output.push(...ours, '', ...theirs);
    }
    fs.writeFileSync(file, output.join('\n'));
    return true;
}

/**
 * Two edits the disposable worktree gets, so the app knows it is a selfbuild and
 * never offers an upstream update that would replace it (and the PRs in it):
 * the updater bails out when `self-build.json` sits in Resources, and the
 * afterPack hook (which already verifies the bundle) writes that file.
 */
function patchSelfBuildBundle() {
    const state = { guard: false, hook: false };
    const mainFile = path.join(workdir, 'packages/electron/main.mjs');
    const afterPackFile = path.join(workdir, 'packages/electron/scripts/after-pack.cjs');

    const mainSource = fs.readFileSync(mainFile, 'utf8');
    const mainAnchor = 'const setupAutoUpdater = () => {\n  if (!app.isPackaged) {\n    return;\n  }\n';
    if (mainSource.includes('self-build.json')) {
        log('updater guard: already present');
    } else if (!mainSource.includes(mainAnchor)) {
        log('updater guard: anchor moved upstream, skipped (the app may offer updates)');
    } else {
        fs.writeFileSync(mainFile, mainSource.replace(mainAnchor, `${mainAnchor}  if (fs.existsSync(path.join(process.resourcesPath, 'self-build.json'))) {\n    return;\n  }\n`));
        state.guard = true;
        log('updater guard: installed');
    }

    const hook = fs.readFileSync(afterPackFile, 'utf8');
    const hookAnchor = '  verifyPackagedAppContents(resourcesPath);\n';
    if (hook.includes('self-build.json')) {
        log('self-build.json hook: already present');
    } else if (!hook.includes(hookAnchor)) {
        log('self-build.json hook: anchor moved upstream, skipped');
    } else {
        fs.writeFileSync(afterPackFile, hook.replace(hookAnchor, `${hookAnchor}\n  const reportPath = path.join(__dirname, '..', '..', '..', 'selfbuild-report.json');\n  if (fs.existsSync(reportPath)) {\n    fs.copyFileSync(reportPath, path.join(resourcesPath, 'self-build.json'));\n  }\n`));
        log('self-build.json hook: installed');
        state.hook = true;
    }

    return state;
}

function ensureWorktree(baseRef) {
    const isWorktree = spawnSync('git', ['-C', workdir, 'rev-parse', '--git-dir'], { stdio: 'ignore' }).status === 0;
    if (isWorktree) {
        git(workdir, 'reset', '--hard', '--quiet', baseRef);
        git(workdir, 'clean', '-fdq');
    } else {
        if (fs.existsSync(workdir)) throw new Error(`${workdir} exists but is not a git worktree; move it away`);
        fs.mkdirSync(path.dirname(workdir), { recursive: true });
        git(repoRoot, 'worktree', 'add', '--detach', '--quiet', workdir, baseRef);
    }
}

function preflight() {
    if (args.noPackage || args.dryRun) return;
    if (spawnSync('xcode-select', ['-p'], { encoding: 'utf8' }).status !== 0) {
        throw new Error('missing Xcode command line tools (xcode-select -p failed); node-pty cannot be rebuilt without them');
    }
}

function resolvePrSet() {
    if (args.prs) {
        const numbers = args.prs.split(',').map((entry) => entry.trim()).filter(Boolean).map(Number);
        if (numbers.some((number) => !Number.isInteger(number) || number <= 0)) {
            throw new Error(`bad --prs value: ${args.prs}`);
        }
        log(`explicit set: ${numbers.map((number) => `#${number}`).join(' ')}`);
        return numbers.map((number) => ({ number, title: '', draft: false }));
    }

    const skip = readSkipList();
    const open = listOpenPrs().filter((entry) => {
        if (skip.has(entry.number)) {
            log(`#${entry.number} skipped: listed in skip.txt`);
            return false;
        }
        return true;
    });
    log(`#${author} has ${open.length} open PR(s) on ${upstreamSlug}`);
    return open.map((entry) => ({ number: entry.number, title: entry.title, draft: entry.isDraft }));
}

function main() {
    if (!args.noPackage && !args.dryRun && !IS_MAC) {
        throw new Error('a DMG needs macOS; pass --dry-run or --no-package to check the merge set elsewhere');
    }

    preflight();
    const prs = resolvePrSet();

    log(`fetching ${upstreamRemote}/main`);
    git(repoRoot, 'fetch', '--quiet', upstreamRemote, 'main');
    const baseRef = `${upstreamRemote}/main`;
    const baseSha = git(repoRoot, 'rev-parse', '--short', baseRef);
    const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/electron/package.json'), 'utf8')).version;

    const entries = prs.map((pr) => {
        const sha = fetchPrHead(pr.number);
        return { ...pr, sha, short: sha.slice(0, 10), ref: `refs/selfbuild/pr-${pr.number}` };
    });
    const ordered = dropStacked(entries)
        .sort((left, right) => left.number - right.number);

    if (ordered.length === 0) {
        log('nothing to merge; upstream alone is the app');
    }

    ensureWorktree(baseRef);
    log(`worktree ${workdir} at ${baseSha}`);
    const patched = patchSelfBuildBundle();
    const merged = [];
    const skipped = [];
    for (const entry of ordered) {
        const ref = entry.ref;
        const result = spawnSync('git', ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-edit', '--quiet', ref], {
            cwd: workdir,
            encoding: 'utf8',
        });
        if (result.status === 0) {
            merged.push({ ...entry, unionDocs: [] });
            log(`#${entry.number} merged (${entry.short}) ${entry.draft ? '[draft] ' : ''}${entry.title}`);
            continue;
        }
        if (result.status === null) throw new Error(`git merge #${entry.number} could not start`);

        const conflicted = git(workdir, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
        const docsOnly = conflicted.length > 0 && conflicted.every((file) => file.endsWith('.md'));
        if (docsOnly && conflicted.every((file) => unionMarkdown(path.join(workdir, file)))) {
            git(workdir, 'add', '-A');
            git(workdir, 'commit', '--no-edit', '--quiet');
            merged.push({ ...entry, unionDocs: conflicted });
            log(`#${entry.number} merged with both sides kept in ${conflicted.join(', ')}`);
            continue;
        }

        spawnSync('git', ['merge', '--abort'], { cwd: workdir, stdio: 'ignore' });
        skipped.push({ pr: entry.number, reason: 'merge conflict', files: conflicted, title: entry.title });
        log(`#${entry.number} skipped: conflict in ${conflicted.join(', ') || '(unknown)'}`);
    }

    const headSha = git(workdir, 'rev-parse', '--short', 'HEAD');
    const signature = ordered.map((entry) => `${entry.number}:${entry.short}`).join(',');
    const report = {
        builtAt: new Date().toISOString(),
        author,
        base: { ref: baseRef, sha: baseSha },
        version,
        commit: headSha,
        signature,
        open: prs.map((pr) => pr.number),
        dropped: entries.filter((entry) => !ordered.includes(entry)).map((entry) => ({ pr: entry.number, title: entry.title })),
        merged: merged.map((entry) => ({ pr: entry.number, title: entry.title, draft: entry.draft, sha: entry.short, unionDocs: entry.unionDocs })),
        skipped: skipped.map((entry) => ({ pr: entry.pr, title: entry.title, reason: entry.reason, files: entry.files })),
    };
    fs.writeFileSync(path.join(workdir, 'selfbuild-report.json'), `${JSON.stringify(report, null, 2)}\n`);

    if (args.dryRun) {
        printSummary(report, null);
        return;
    }

    log('installing dependencies and type-checking');
    run('bun', ['install', '--frozen-lockfile'], workdir);
    if (!args.noCheck) run('bun', ['run', 'type-check:ui'], workdir);

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

    const installed = args.noInstall ? null : installApp(artifact, report);

    verifySelfBuildMarkers(patched, distDir);

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

/** Fails the build if a patch was applied but did not reach the packaged app. */
function verifySelfBuildMarkers(patched, distDir) {
    const appDir = (fs.existsSync(distDir) ? fs.readdirSync(distDir) : [])
        .filter((name) => name.startsWith('mac'))
        .map((name) => path.join(distDir, name, 'OpenChamber.app', 'Contents', 'Resources'))
        .find((candidate) => fs.existsSync(candidate));
    if (!appDir) throw new Error(`no packaged .app under ${distDir}`);

    const reportInside = fs.existsSync(path.join(appDir, 'self-build.json'));
    if (patched.hook && !reportInside) throw new Error('self-build.json did not reach the packaged app');
    log(`self-build.json in bundle: ${reportInside ? 'yes' : 'no'}`);

    const bundleMain = path.join(workdir, 'packages/electron/dist-bundle/main.mjs');
    if (!fs.existsSync(bundleMain)) return;
    const guarded = fs.readFileSync(bundleMain, 'utf8').includes('self-build.json');
    if (patched.guard && !guarded) throw new Error('updater guard did not reach dist-bundle/main.mjs');
    log(`updater guard in bundle: ${guarded ? 'yes' : 'no'}`);
}

function printSummary(report, summary) {
    console.log('\n=== selfbuild ===');
    console.log(`base   ${report.base.ref} ${report.base.sha}`);
    console.log(`commit ${report.commit}  (${report.merged.map((entry) => `#${entry.pr}`).join(' ') || 'no PRs'})`);
    if (report.dropped.length > 0) {
        console.log(`stacked, already contained: ${report.dropped.map((entry) => `#${entry.pr}`).join(' ')}`);
    }
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
    console.log(`work   ${workdir}`);
}

try {
    main();
} catch (error) {
    console.error(`[selfbuild] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
