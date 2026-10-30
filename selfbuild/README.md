# selfbuild — 用你自己的 PR 编一个每天能用的 macOS app

把上游 `main` 和你**当前所有 open PR** 合成一版 DMG，装上 `/Applications`，日常用它跑，好让你自己提的改动在真实使用里暴露问题。

没有需要维护的清单：每次运行都去 GitHub 问"我现在开了哪些 PR"。产物**未签名、未公证**，只在你自己的机器上用。

## 一次性准备（Mac）

```sh
git clone git@github.com:gaojunran/openchamber.git ~/code/openchamber
cd ~/code/openchamber
git remote add upstream https://github.com/openchamber/openchamber.git   # 若还没有
git fetch upstream fork && git checkout -b selfbuild fork/selfbuild
bun install
```

需要：`bun 1.4.3`、`node >= 24.14`、Xcode Command Line Tools（`xcode-select --install`）、`gh`（已 `gh auth login`，用来列 PR）。

## 每次构建

```sh
node ~/code/openchamber/selfbuild/oc-selfbuild.mjs   # 任意 cwd 都行
```

它会：

1. `gh` 列出你（`--author`，默认取 `gh api user`）在上游的所有 open PR，按编号升序；
2. **自动去掉堆叠 PR**：如果某个 PR 的提交已经（按 patch-id）包含在另一个 PR 里（例如分支是在另一个 PR 上堆的、或 rebase 过），只保留最新的那个 —— `git cherry` 判定，不用人管；
3. `git fetch upstream main`，在临时 worktree（默认 `~/Library/Caches/oc-selfbuild/work`）里按序 merge，**你的 checkout 不动**；
4. 冲突时：如果冲突文件全是 markdown、且两侧都是"同一锚点各自新增"（diff3 的 base 段为空），保留双方；否则跳过该 PR 并报告，其余继续；
5. `bun install --frozen-lockfile` + `bun run type-check:ui` 作为打包前门禁；
6. `CSC_IDENTITY_AUTO_DISCOVERY=false bun run package -- --publish=never`，未签名 DMG；
7. 复制到 `~/Downloads/oc-selfbuild/OpenChamber-<version>-self-<sha>.dmg`，挂载替换 `/Applications/OpenChamber.app`，并把清单写进 `Contents/Resources/self-build.json`。

想看手头这个 app 含哪些 PR：`cat /Applications/OpenChamber.app/Contents/Resources/self-build.json`。

## 选项

| 参数 | 作用 |
|---|---|
| `--dry-run` | 只合并，不安装依赖、不打包（非 macOS 也能跑，用来检查 PR 集自洽） |
| `--no-package` | 合并 + 类型检查 + `build:web-assets`，不打包 |
| `--no-install` | 不替换 `/Applications`，只出 DMG |
| `--no-check` | 跳过类型检查 |
| `--prs 5863,5514` | 临时用指定集合，忽略自动发现（A/B 用） |
| `--author <login>` | 换一个作者（默认你自己） |
| `--out DIR` | 产物目录，默认 `~/Downloads/oc-selfbuild` |

## 想临时摘掉某个 PR

在 `selfbuild/skip.txt` 里写 PR 号（一行一个，`#` 注释）。文件不存在就是全要。这是**可选项**，日常不用碰。

## CI（可选，已配好）

`.github/workflows/selfbuild-dmg.yml` 在 fork 上跑同一条链路：`ubuntu` 上先算"PR 集合 + 各自 head sha"的签名，已存在同名 artifact 就直接跳过；否则 `macos-15` 上合并打包，上传 `selfbuild-<signature>`。

触发：push 任意分支（你给 PR 分支推代码就重建）、每 30 分钟轮询（兜住"新开 PR 但没新 push"）、手动 dispatch。

注意两点：

- workflow 文件在 `selfbuild` 分支上，而 GitHub 只对**默认分支**上的 workflow 启用 `schedule` / `workflow_dispatch` —— 所以 fork 的默认分支被设成了 `selfbuild`（`main` 仍是上游镜像，供你本地同步用）；
- 从 CI 下回来的 dmg 带 quarantine，装上后跑一次 `xattr -cr /Applications/OpenChamber.app`。

## 版本号与上游更新

- 编出来的版本号就是**上游 `main` 里 `packages/electron/package.json` 的 version**（合并前先 `fetch upstream main`，所以永远是最新的那个）。
- 上游把版本号推到 `main` 后（发版时会同步改 `packages/electron/package.json`，与 release tag 一致），CI 的签名会变，30 分钟内自动重建一版**新版本 + 你的 PR**；本地重跑脚本也是一样。
- **应用内更新被主动关掉了**：官方 app 的更新指向 `openchamber/openchamber` 的 release（`updater-feed.mjs` 里写死的），而它是通过 macOS 的 Squirrel.Mac 原地替换的 —— 未签名构建装不上；就算装上了，换回来的是不含你 PR 的官方包。所以 selfbuild 会往 `Contents/Resources/self-build.json` 写一份清单，`setupAutoUpdater` 见到它就直接不启用更新。
- 想要上游新版本：重跑一次构建。

## 边界

- **未签名**：本机运行没问题；拷给别人会被 Gatekeeper 拦，这不是构建失败。
- **不含 iOS**：iOS 需要先解决签名（免费 Apple ID 要去掉 `aps-environment` 与 App Groups、换 bundle id）。
- **只编 arm64**（Apple Silicon）。
- 每次从零重建集成分支，上一版的坏改动不会残留；想 A/B 就用 `--prs` 或 `skip.txt`。
- `main` 始终是上游镜像；`selfbuild` 分支只放这三个文件（脚本、skip.txt、README）加一个 workflow，跟上上游用 `git checkout selfbuild && git pull --rebase`。

## 排错

- `afterPack` 报 `Resources/ripgrep/rg is missing`：说明绕过了 `bun run package`（`prepare:ripgrep` 没跑）。
- `node-pty` 重编失败：`xcode-select -p` 是否指向完整 CLT；`python3` 是否可用。
- 替换 `/Applications/OpenChamber.app` 失败：app 还在运行，退出后重跑（或 `--no-install`）。
- `gh pr list` 报鉴权错误：`gh auth status` / `gh auth login`。
