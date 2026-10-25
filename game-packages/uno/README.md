# UNO 与扩展玩法

UNO 按独立规则扩展组织。当前提供：

| 扩展键 | 游戏与精确版本 | 人数 | 输出 ZIP |
| --- | --- | --- | --- |
| `casual` | `online.uno@1.2.0` · UNO · 休闲版 | 2–4 | `uno-1.2.0.zip` |
| `no-mercy` | `online.uno-no-mercy@1.0.0` · UNO · 毫不留情 | 2–6 | `uno-no-mercy-1.0.0.zip` |

## 打包与使用

```powershell
node scripts/package-uno.mjs           # 打包全部已登记扩展
node scripts/package-uno.mjs no-mercy  # 只打包毫不留情
node scripts/package-uno.mjs casual    # 只打包休闲版
```

文件生成于 `dist/game-packages/`。每个 ZIP 恰好包含 `game.json`、`server.js`、`client.html`；原创 SVG 在打包时由已安装 Chromium 渲染为内嵌 PNG 图标、封面和背景。不会执行包内 npm 脚本或在 Node 中载入规则。

管理员在「游戏管理 → 上传游戏 ZIP」分别检查、审核上架。玩家在大厅或建房的「游戏与版本」选择对应玩法；不用编辑 JSON。每局固定一个扩展及精确版本，不允许对局中切换；未安装的扩展不会自动出现在大厅。现有 `online.uno@1.0.0/1.1.0` 和旧局继续使用原规则，上传新版不覆盖旧版本。支持真人、脚本 AI 和已配置的模型 AI。

共享桌面提供可出牌标记、按颜色整理/恢复顺序、UNO 声明、桌面内联选色和键盘取消；毫不留情另显示累计罚牌、换手目标、轮盘选色、补喊/抓漏喊与淘汰状态。重复的同局面同步保留选色草稿和焦点，身份或局面变化清除旧草稿。整理顺序只存在于桌面，不改变权威手牌或规则随机数。

## 规则

休闲版沿用 108 张牌：同色/同符号、跳过、反转、+2、万能和受当前颜色限制的 +4。双人反转等同跳过，不叠罚牌，无 +4 质疑；主动摸一张后只能出新牌或保留；漏喊 UNO 自动罚摸两张。最后一张罚牌先处理罚摸再结算。牌堆耗尽重洗弃牌，僵局/2000 回合按最少手牌结算，可并列。

毫不留情使用独立的 168 张牌和完整状态机，详见 [游戏指南](../../docs/games/uno.md)。两者不是可以随意混合的牌组，尚未实现 Flip、Flex、Attack 或毫不留情额外卡/硬币扩充包。

## 添加下一个扩展

1. 在本目录增加扩展子目录，编写独立 `server.txt`、`game.json`、`art/icon.svg` 和 `art/cover.svg`。
2. 在 `editions.json` 登记 `directory/archive/client/art`。`client` 相对 UNO 根目录，可共用桌面，也可指向扩展自己的桌面。
3. 给扩展分配独立游戏 ID 和版本，保持 SDK、私密 View、公开事件、确定性 RNG、序列化恢复和 AI 候选契约。`game.json.rules` 只描述该扩展实际实现的规则。
4. 增加与该扩展机制对应的 QuickJS 规则/恢复测试，再验证真实上传、对局及双端界面。原平台 registry、rooms/matches、认证和传输不增加特定 UNO 分支。
5. 运行统一打包命令并通过管理员审核。规则或桌面更新提升该游戏版本；内容规则未变时不提升 `contentVersion`。同版本不可覆盖。

本轮休闲版游戏版本 `1.1.0 → 1.2.0` 是共享桌面交互增强，规则内容版本仍为 `1.1.0`。扩展拥有各自规则实现，共享打包、桌面和测试入口；不将未来所有 UNO 变体硬塞入一组开关。

## 验证入口

```powershell
pnpm test tests/unit/uno-package.test.ts tests/unit/uno-no-mercy.test.ts tests/unit/package-enhancements.test.ts tests/unit/game-packages.test.ts
node scripts/check-uno-package.mjs
pnpm typecheck
pnpm lint
pnpm test:integration
pnpm test:e2e tests/e2e/uno-package.spec.ts
pnpm build
```

集成和 E2E 必须串行使用独立 `TEST_DATABASE_URL`，按原脚本准备库、迁移、游戏与资源。E2E 前先打包；自动化模型是明确标记的 mock，不代表已连接真实供应商。固定 View 的桌面检查只证明渲染和消息桥行为，不替代真实平台联机验证。实际结果见 [开发进度](../../docs/progress.md)。
