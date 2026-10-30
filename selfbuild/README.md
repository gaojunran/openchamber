# selfbuild — 用你自己的 PR 编一个每天能用的 macOS app

把上游 `main` 和你自己的一批 open PR 合成一版 DMG，装上 `/Applications`，日常用它跑，好让你自己提的改动在真实使用里暴露问题。

不是发版流水线：产物**未签名、未公证**，只在你自己的机器上用。

## 一次性准备（Mac）

```sh
git clone git@github.com:gaojunran/openchamber.git ~/code/openchamber   # 或已有 clone
cd ~/code/openchamber
git remote add upstream https://github.com/openchamber/openchamber.git   # 若还没有
git fetch upstream fork && git checkout -b selfbuild fork/selfbuild
bun install
```

需要：`bun 1.4.3`、`node >= 24.14`、Xcode Command Line Tools（`xcode-select --install`，`rebuild:native` 要用 clang/python）。

## 每次构建

```sh
node ~/code/openchamber/selfbuild/oc-selfbuild.mjs   # 任意 cwd 都行
```

它会：

1. `git fetch upstream main`，在你的仓库里建一个临时 worktree（默认 `~/Library/Caches/oc-selfbuild/work`），**你的 checkout 不动**；
2. 按 `selfbuild/prs.txt` 的顺序 `git merge` 每个 PR（抓 `pull/<N>/head`）；有冲突就跳过并记录，剩下的继续；
3. 跑 `bun install --frozen-lockfile` + `bun run type-check:ui` 作为编译前的快速门禁；
4. `CSC_IDENTITY_AUTO_DISCOVERY=false bun run package -- --publish=never`（未签名 DMG）；
5. 把 DMG 复制到 `~/Downloads/oc-selfbuild/OpenChamber-<version>-self-<sha>.dmg`，挂载并替换 `/Applications/OpenChamber.app`；
6. 往 `Contents/Resources/self-build.json` 写一份清单（这版含哪些 PR、各自 sha、被跳过的和原因），日志追加到 `~/Library/Logs/oc-selfbuild.log`。

## 选项

| 参数 | 作用 |
|---|---|
| `--dry-run` | 只合并 + 类型检查，不打包 |
| `--no-package` | 合并 + 类型检查 + `build:web-assets`，不打包（非 macOS 上也可跑，用来检查 PR 集是否自洽） |
| `--prs 5863,5514` | 临时用另一组 PR，忽略 `prs.txt` |
| `--no-install` | 不替换 `/Applications`，只出 DMG |
| `--no-check` | 跳过类型检查（更快，但坏代码要到打包时才炸） |
| `--out DIR` | 产物目录，默认 `~/Downloads/oc-selfbuild` |
| `--keep` | 只在摘要里标注保留 worktree（worktree 本来就保留，下次重置） |

环境变量：`OC_SELFBUILD_WORKTREE` 覆盖临时 worktree 路径。

## 冲突策略

`prs.txt` 每行 `<PR 号>`，可选 `union-docs`。冲突时：

- 默认：**跳过这个 PR 并报告**，构建继续；
- 带 `union-docs`：如果冲突文件**全是 markdown**，两边内容都保留（这个仓库的文档冲突几乎都是"同一锚点后各加一段"），并提示你读一次那个文件；有非 md 冲突就仍然跳过。

这套策略来自实测：9 个 PR 叠在一起，只有 `#5863` 与 `#5514` 在 `composer/DOCUMENTATION.md` 上撞车，两边都留即可；`#5557` 已包含 `#5548`，所以 `#5548` 不单独列。

## 边界

- **未签名**：本机运行没问题（没有 quarantine 属性）；把 DMG 拷给别人会被 Gatekeeper 拦，这不是构建失败。
- **不含 iOS**：iOS 需要先解决签名（免费 Apple ID 要去掉 `aps-environment` 与 App Groups、换 bundle id），见后续计划。
- **默认只编 arm64**（Apple Silicon 本位）。Intel Mac 上加 `--config` 参数或改脚本传 `--x64`。
- 每次都是从零重建集成分支（`self/edge` 的等价物），所以上一版的坏改动不会残留；想 A/B 就把可疑 PR 从 `prs.txt` 里去掉再编一版。
- `main` 始终是上游镜像；`selfbuild` 分支只放这三个文件，和上游没有交集，更新脚本用 `git checkout selfbuild && git pull --rebase` 即可。

## 排错

- `afterPack` 报 `Resources/ripgrep/rg is missing`：说明绕过了 `bun run package`（`prepare:ripgrep` 没跑）。用本脚本，或手动补跑 `bun run prepare:ripgrep`。
- `node-pty` 重编失败：`xcode-select -p` 是否指向完整 CLT；`python3` 是否可用。
- 替换 `/Applications/OpenChamber.app` 失败：app 还在运行，退出后重跑（或加 `--no-install`）。
- 想知道手头这个 app 是哪版：`cat /Applications/OpenChamber.app/Contents/Resources/self-build.json`。
