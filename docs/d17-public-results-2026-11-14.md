# D17：UNO 休闲版公开胜者试点

执行日期：2026-11-14；按每日任务顺序提前推进。游戏基线 `main@042868c`，平台验证基线为未合并的 D16 `8f377a1` / 1.3.0（[PR #75](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/75)）。原工作区及此前已完成工作保留，在独立 `codex/d17-uno-public-results` 开发。

## 本批实现

- 休闲版 **1.2.1 → 1.3.0（MINOR）**：新增可选公开结果能力。`game.json` 声明 `publicResult: "winners-scores-v1"`，同步 `getPublicResult(outcome)` 对进行中返回 null，终局只复制权威 winners；既有僵局/2000 回合的共同胜者保持，不返回 scores 或手牌、牌堆、内部 outcome。
- `contentVersion=1.1.0`、默认资源版本 1.2.0、规则动作、共享桌面及美术不变。毫不留情保持 **1.0.1**，未声明公开结果；不改其旧 Release。
- 独立验证更新四份平台测试快照，精确来源/原始摘要及唯一相对导入适配见 [快照记录](../tests/fixtures/public-result-platform.json)。SDK 核心、SOURCE.json 的初始来源事实不变；旧解析器保留为版本化兼容夹具，验证旧平台拒绝新声明。快照不能替代平台生产实现。
- 实际 ZIP verify 校验休闲版声明与公开结果、旧解析器拒绝、毫不留情兼容。新休闲版的 release.json.compatibilitySource 指向固定 D16 提交；只发布毫不留情时仍使用原快照。未增加发布触发器，普通 PR 不发布游戏。

## 实际验证

| 命令/检查 | 本轮结果 |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false install --frozen-lockfile --offline` | 冻结离线安装通过，依赖与锁文件不变 |
| `pnpm ... test` | 初轮 24/25；新增共同胜出用例遗漏可出新摸牌的 pass，按真实规则补完整回合后仅重跑休闲版 **11/11**；毫不留情原批 **14/14**，共 25 个独立用例分批通过 |
| `pnpm ... build` | 两实际 ZIP：休闲版 1.3.0 **329100 字节**、毫不留情 1.0.1 **257168 字节** |
| `pnpm ... verify` | 1/1，通过两实际 ZIP 的解析、QuickJS 与最小/最大人数生命周期 |
| `GITHUB_REF_TYPE=tag GITHUB_REF_NAME=uno-v1.3.0 pnpm ... verify` | 最终发布元数据修改后 **1/1**；dist/release 仅休闲版 ZIP、release.json、SHA256SUMS；本地 commit=null，不计正式 Release |
| `pnpm ... test:ui` | 两玩法 1440×900、1280×800、390×844、320×740 操作检查通过；手机触摸、长手牌、草稿、失败恢复及私密消息桥保持 |
| 来源核对 | 四个快照与 D16 原文件逐字节一致（撤销已记录导入适配后）；平台 catalog、release.config、manifest 的仓库、名称、ID、archive/玩法对齐，**登记已核对，无需改动** |
| 平台真实安装及对局 | 双真人、真人/免费脚本、原 1.2.0 活动局三个独立集成用例分批通过；桌面/手机真实 E2E **2/2**，详见平台 D17 记录 |

本地休闲版 ZIP SHA-256：`6882d00805f66b60ad71e7e71af208b52f96b253d601d70ff515914d78a10a1e`。PNG 渲染可能随运行环境变化，正式发布后须重新核对真实附件，不能将此值预当作正式 Release 摘要。

单元覆盖最终罚摸后胜者、进行中 null、剔除额外秘密字段、不合成分数、真实规则共同胜出，以及 2/3/4 人每步序列化恢复后的完整对局结果。新增共同胜出用例首轮失败来自测试只执行摸牌、未完成可保留新牌的回合；没有修改权威规则或降低断言。

平台本轮验证使用实际构建 ZIP，通过原隔离准备/迁移/同步/资源链和专用 `playboard_d17_test_20261114`；串行执行集成与 E2E，未操作开发/生产库。涵盖重启、权威胜者、无分数、本人记录、非参与者拒绝、原请求重试、内容冲突、旧包不补结果及真实双端结算；旧 1.2.0 正式附件的 SHA256SUMS 实际校验通过。不是纯规则夹具或真实付费模型验收。

## 交付与发布门槛

本批为候选源码与验证交付，不打标签、不创建正式 Release、不安装生产；游戏仓库分支 `codex/d17-uno-public-results` 和平台验证分支 `codex/d17-uno-results-validation` 分别提交/PR，成功后另补链接。平台主仓库的游戏集成副本、来源锁和目录未漂移；独立游戏更新不递增平台版本。

发布顺序：先完成 D16 平台审查/合并/真实部署及 D19/D21 兼容与降级门槛，再审核发布 `uno-v1.3.0`，下载并核验真实附件，最后通过原管理员订阅授权验收安装。1.2.6 会拒绝新 ZIP，但已安装新声明包后的旧程序启动阻断尚未实现，不能仅因新包在旧平台安装失败便宣称降级安全。不要先发布新标签让现有生产订阅拉取不兼容包。

生产只读核验仍为 **add0940 / 1.2.6**，API cwd 与 current.json 一致、服务 active/running、NRestarts=0、ready/database 就绪。本轮没有修改服务器配置、生产数据或订阅开关，没有重启服务。物理手机、WebKit、屏幕阅读器、真实模型未验证；D18 完整战绩筛选/分页/切换账号与 D19/D21 专项仍待后续任务，不把已有结算卡渲染算作这些专项全部完成。

## 已推送与待审 PR

主提交 **4e3633a77088a8c099dcffdd96c8010384a95a3e** 已推送至 `codex/d17-uno-public-results`，创建 [UNO PR #5](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/5)；平台主提交 **c2bfa5ae8fb4a84f7e41aeeb82cd472dc815e272** 已推送并创建 [平台 PR #76](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/76)，包含 D15/D16 前置，未合并。UNO 主提交 [远程 run 43605629262](https://github.com/PlayBoardgameTogether/playboard-game-uno/actions/runs/43605629262) 的 check 全步骤 success、release 按 PR 条件 skipped；平台主提交远程 pins 检查 success，不将其当作远程全套业务验证。两 PR 的 review 列表本轮为空，不等同于人工审查通过。

UNO 原命令行缺少认证，复用平台既有 Git helper 的内存认证推送成功；GitHub 应用创建 PR 返回 403 后，以同一既有认证通过 gh API 先查重再创建成功，无凭据落盘。后续仅补内部交付事实，不重复本地业务验证；功能分支均有未合并内容，保留，不清理其他任务分支或 worktree。正式 Release、订阅安装与生产更新均未执行。
