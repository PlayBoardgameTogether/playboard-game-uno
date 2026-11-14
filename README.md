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

## 公开胜者试点（候选）

休闲版 **1.2.1 → 1.3.0** 声明 `publicResult: "winners-scores-v1"`，由受限 QuickJS 的同步 `getPublicResult(outcome)` 只返回权威胜者；支持并列，不合成分数。内容规则仍为 1.1.0，资源与桌面不变；毫不留情保持 1.0.1，不启用该能力。

需要平台 **1.3.0 的 D16 兼容能力**。平台候选尚未部署，不能先发布依赖它的游戏标签；旧平台会拒绝新 ZIP。先验证平台部署和降级门槛，再审核发布新游戏。旧 1.2.0/1.2.1 对局继续锁定原包，不回填历史结果。

独立验证所需的平台快照固定到 [D16 提交 688dd6f](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/commit/688dd6f452f12506f39a3d8905e82e5208bbe79e)，来源摘要与唯一导入路径适配见 [快照记录](tests/fixtures/public-result-platform.json)；SOURCE.json 保留初始导出事实。新休闲版 `release.json.compatibilitySource` 指向该快照，毫不留情单独发布仍使用原快照。版本化旧解析器仅用于验证旧平台拒绝新声明，不能作为另一条生产运行时维护来源。完整交付见 [D17 记录](docs/d17-public-results-2026-11-14.md)。

## 手机行动回归

`pnpm test:ui` 检查 1440×900、1280×800、390×844、320×740，手机启用触摸仿真。两种玩法均覆盖 24 张手牌末端选色、相同快照保留草稿/焦点、取消和失败重试；毫不留情另检查累计罚牌、换手、轮盘与抓漏喊。固定 View 与真实平台联机结果分别记录，见 [D11 验收](docs/d11-mobile-validation-2026-11-12.md)。

## 许可证

Copyright (C) 2026 TheTopBoardgameAssociation

除另有声明的文件外，本项目采用 [GNU GPL v3.0](LICENSE)（`GPL-3.0-only`）开源协议，允许按协议使用、修改和分发。本软件不提供任何担保，具体条款见 LICENSE。

已有单独许可声明的素材、第三方代码和依赖继续遵循各自的许可与署名要求；例如标明 CC0-1.0 的资源仍按原许可分发。

## 像素风游戏头像

本轮使用完整方形游戏头像，头像与详情背景分开接入；运行资源、原图及来源 SHA、背景草稿边界和实际检查见 [交付记录](design/pixel-catalog-art/DELIVERY.md)。图稿在本仓库维护，推送不代表已发布或安装。
