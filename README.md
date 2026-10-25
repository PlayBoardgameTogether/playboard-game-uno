# PlayBoard · UNO

独立游戏源码、测试和安装 ZIP 发布项目。平台主仓库：[PlayBoardgameTogether/PlayBoardgameTogether](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether)。

## 本地构建

使用 Node.js 22 和 pnpm@11.15.1。项目包含独立锁文件，使用冻结安装：

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
pnpm build
pnpm verify
```

安装 ZIP 在 `dist/game-packages/`；验证后的发布附件、`SHA256SUMS` 与 `release.json` 在 `dist/release/`。ZIP 不提交 Git。

## 独立发布

普通推送、PR 和手动触发只测试和打包。按下面的标签格式推送会在检查通过后创建 GitHub Release：

- `uno-vMAJOR.MINOR.PATCH` 对应 `online.uno`。
- `uno-no-mercy-vMAJOR.MINOR.PATCH` 对应 `online.uno-no-mercy`。

标签必须与包内 manifest 的精确版本一致；版本来源为规则代码，根 package.json 的 0.0.0 仅为私有工具包占位号。同一游戏版本不得修改规则、桌面或美术后重新发布；已存在的 Release 不覆盖。UNO 的各玩法分别打标签、分别发布。

管理员下载 Release 附件中的游戏 ZIP，核对 SHA256SUMS，再在平台游戏管理中检查和审核安装。GitHub 自动提供的 Source code.zip 不能直接安装。发布不会自动修改生产数据库或已开始的对局。

## 来源与兼容性

初始游戏和规则测试来自平台提交 `a7e36d32e2febeb5bd7013752f099d01d0502316`，路径及原始摘要记录在 SOURCE.json。`apps/api/src` 和 `packages/game-sdk/src` 仅包含测试所需的固定兼容性快照，不启动平台 API，也不依赖主仓库工作区。可在明确的平台版本升级时更新该快照；生产安装仍以平台自身审核为准。

玩法、素材和历史说明见 [游戏说明](game-packages/uno/README.md)。其中平台集成/E2E 命令需在平台主仓库运行；本仓库的独立验证命令以上文为准。
