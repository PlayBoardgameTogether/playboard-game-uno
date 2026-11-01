# 像素风目录美术交付记录

2026-11-01。延续 PlayBoard 既有像素画风，复用此前通过 Codex 内置 imagegen 生成的图稿，完成导出与接入。各游戏目录包含方形 icon-source.png、宽幅 background-source.png 与完整的 *-prompt.txt；运行图片及资源版本见 game-packages/uno/art/catalog.json。UNO 两玩法在各自目录独立构图。

图标为 256×256，宽幅图通常为 960×540；波多黎各为满足原有包体积限制采用 896×504。最近邻缩放与有限色板仅用于运行资源导出，原稿保留。使用提示词要求方形主体清楚、暖色像素轮廓、宽幅场景右侧为主景并留出标题空间；实际完整提示词随源图保存。图稿不包含商业封面扫描或网络库存图片。

## 本轮验证

- pnpm test：23/23 通过，无跳过。
- pnpm build 与 pnpm verify：通过；真实平台解析器与受限 QuickJS 校验、精确版本 ZIP、release.json、SHA256SUMS 已在本地生成。未覆盖旧版本。
- 官方目录 scripts/game-repositories/catalog.json 已核对，仓库、游戏 ID、archive 和玩法与 release.config.json 一致；登记已核对，无需改动。
- 未创建正式 Release 或标签，未安装到生产或验证订阅同步。PR 推送与本地包均不代表上架。

尚未验证生产安装、真实联机与物理手机。具体游戏规则未改动；版本提升只用于新美术安装包身份。平台与游戏仓库分别交付，兼容现有 SDK 0.1.0 与平台 1.1.x。
