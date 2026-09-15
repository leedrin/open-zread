# Zread 原生集成契约（v0.2.13）

> 验证日期：2026-09-15
>
> 环境：Windows amd64、npm channel、Zread `0.2.13`、Go `1.26.0`
>
> 对应需求：GitHub Issue #2 / Hub T01

## 结论

Open Zread Hub 可以在 Windows 上发现并调用本机 Zread，读取当前 Wiki，触发完整生成，并把编辑后的 Markdown 直接写回 Zread 当前版本中的原文件。Hub 必须保留 `wiki.json` 中不认识的字段，不能制造 Sync、Overlay 或增量更新能力。

Zread `0.2.13` 没有提供 Wiki 增量更新命令。根命令中的 `update` 只用于更新 Zread CLI 本身。因此首版契约将“增量 Wiki 更新”明确标记为不可用。

## 可执行文件与认证

开发环境的 PATH 自动发现首先得到 npm wrapper：

```text
C:\Users\Administrator\AppData\Roaming\npm\zread.cmd
```

npm 包中的实际 Windows 二进制为：

```text
C:\Users\Administrator\AppData\Roaming\npm\node_modules\zread_cli\node_modules\@zread\cli-win32-x64\zread.exe
```

Windows 调用和取消必须针对实际 `zread.exe`。验证脚本会在该已验证的 npm 安装布局中优先解析真实二进制，避免只终止 `.cmd` 后遗留生成子进程；Hub 产品运行时也只调用外部原生 exe，不把 npm wrapper 当作 Provider 进程。

版本探测必须使用 `zread version --stdio`，不是 `zread --version`。机器可读结果包含版本、channel、Go 版本、操作系统与架构。

认证入口是 `zread login`：

- `--stdio`：机器可读模式；
- `--custom`：跳过 Provider 菜单，直接配置自定义 API key；
- `--model <name>`：认证后选择模型。

本次未改动现有登录配置。真实生成成功证明当前凭据可用；认证失败由契约测试使用真实错误文本分类，失败时不得报告生成成功。

## 已验证命令与能力

| 能力 | 命令或格式 | 状态 |
| --- | --- | --- |
| 版本探测 | `zread version --stdio` | 可用 |
| 登录 | `zread login`、`--custom`、`--stdio` | 可用 |
| 完整生成 | `zread generate --stdio --yes` | 可用 |
| 草稿处理 | `zread generate --draft <resume|clear|cancel>` | CLI 已公开 |
| 跳过失败页 | `zread generate --skip-failed` | CLI 已公开 |
| 结构化进度 | `zread generate --stdio --yes` 的逐行 JSON VM 快照 | 可用 |
| CLI 自更新 | `zread update --stdio` | 可用，仅更新 CLI |
| Wiki 增量更新 | 无 | 不可用 |
| Sync / Overlay | 无 | 不可用，不得模拟 |

## 原生 Wiki 数据布局

```text
<project>/.zread/wiki/
├── current
└── versions/
    └── <version-id>/
        ├── wiki.json
        └── <page-file>.md
```

`current` 保存相对于 `.zread/wiki` 的版本路径，例如 `versions/2026-05-10-124151`。页面文件在版本目录中按 `wiki.json.pages[].file` 平铺存放；`section` 和 `group` 是目录元数据，不代表文件系统子目录。

适配器读取时会实际读取每个 Markdown 正文，并保留完整 catalog 和每页的原生记录。catalog 引用的任一页面缺失或不可读时，整个版本不得标记为可读。写回通过 slug 定位 `pages[].file`，只修改目标 Markdown 原文件，不重写 `wiki.json`，也不维护第二份 Overlay。

## stdio 进度契约

Zread `0.2.13` 在 `--stdio` 模式下逐行输出 JSON VM 快照。真实取消探针验证了以下字段：

- `vm.state`：整体状态，例如 `running`；
- `vm.catalog.status`、`agent_status`、`tool_name`：目录生成阶段与当前工具；
- `vm.catalog.usage`：token 使用统计；
- `vm.pages.tasks[]`：每页的 id、slug、state、agent status、重试与 usage；
- `vm.pages.done`、`total`、`waiting_retry`：页面总体进度；
- `waiting_for[]`：CLI 当前可接受的控制动作。

适配器将每行解析为记录，并归一化为整体、catalog、页面计数、等待重试和等待动作字段；连续重复快照会被折叠。当前探针在进程结束后返回快照数组，实时流式回调由后续任务接入。

## 真实生成与退出行为

在一次性最小 TypeScript 项目上执行完整生成：

- 22:44:17 完成目录规划，生成 8 个页面任务；
- 22:50:00 全部 8 个页面完成；
- 生成目录为 `versions/2026-09-15-224417`；
- `current` 在完整产物可读后指向该版本；
- `wiki.json` 和 8 个 Markdown 文件均可由适配器读取；
- 对其中一页做等字节原生写回后，页面哈希不变且 `wiki.json` 字节不变。

取消探针在独立临时项目上运行完整生成，并在 1 秒后终止：

```json
{
  "status": "cancelled",
  "exitCode": 143,
  "outputValidated": false,
  "versionChanged": false
}
```

状态分类契约如下：

- 退出码为 0，且 `current` 指向新的、`wiki.json` 与所有页面正文均可解析的版本，才是 `succeeded`；
- 非零退出且输出含 auth/login/credential/unauthorized，归类为 `authentication_failed`；
- 主动终止归类为 `cancelled`，Windows 实测退出码为 143；
- 其他非零退出归类为 `failed`；
- 退出码为 0 但没有可读 `current` 产物，归类为 `incomplete_output`；
- 退出码为 0 但既有 `current` 未改变，归类为 `unchanged_output`，不得复用旧产物冒充成功；
- 只有 `succeeded` 才允许 `outputValidated: true`。

切换版本的契约测试保留旧版本目录，仅更新 `current` 指针，并对旧 catalog 与页面执行切换前后字节比较，证明旧版本内容不被覆盖。

## 可复现验证

只读检测本机 CLI 和测试 Wiki：

```powershell
bun run validate:zread-contract --project packages/wiki-provider-zread/src/__tests__/fixtures/zread-project
```

验证某个原生页面可等字节写回：

```powershell
bun run validate:zread-contract --project <project> --probe-write <page-slug>
```

触发真实生成，或在指定时间后验证取消：

```powershell
bun run validate:zread-contract --project <project> --probe-generation
bun run validate:zread-contract --project <project> --probe-generation --cancel-after-ms 1000
```

生成探针会调用外部服务并可能产生费用或配额消耗，不能在普通自动化测试中默认执行。

## 首版实现边界

`@open-zread/wiki-provider-zread` 当前提供：

- CLI 版本与已公开能力探测；
- `current`、`wiki.json` 与原生 Markdown 页读取；
- 目标 Markdown 原文件直接写回；
- 无损写权限探针；
- 生成、认证失败、一般失败、取消与不完整产物的状态分类。

没有被 CLI 输出或真实文件格式验证的能力一律不可用。更完整的路径安全、原子保存、备份和冲突处理由后续 Hub 安全写入任务实现。

## Open Zread 交付边界

面向用户的 Windows 版本只交付并运行 `open-zread.exe`。用户不需要安装 npm、Bun 或 Node，也不通过全局 npm 的 `open-zread`、`.cmd` 或 `.ps1` shim 启动。仓库中的 workspace package 均为构建期私有源码模块，会被打入 Windows exe，不作为面向用户的 npm 包发布。
