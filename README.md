# 作业时钟

Windows 桌面组件。它将学习通待交作业按预计截止日分组，并显示剩余时间。超过 72 小时按天显示，进入 72 小时后细化到小时，不足一小时则显示分钟。过期作业列在最后。列表会每五分钟同步一次，组件也有手动刷新按钮。

双击 Windows 便携版 EXE 即可打开。桌面组件启动后不占用任务栏。打开作业时，可以从任务栏切换到学习通窗口。首次使用点「登录学习通」，在应用打开的学习通官方页面登录，然后回到组件刷新。点击某项作业可以在同一个登录窗口中打开详情。拖住组件顶部可以移动，拖动角落的小手柄可以调整大小。靠近屏幕角落松手会自动吸附。设置里可以直接选角、切换小／默认／大尺寸或关闭自动吸附。大小和位置会在下次启动时恢复。图钉可开启或取消置顶。通过右上角齿轮打开设置，也可以从设置里关闭组件。

默认「融入桌面」，使用透明背景和无边框时间线。剩余 72 小时内用暖金色强调日期和倒计时，不足 24 小时切换为珊瑚色。普通日期和作业数量用淡蓝色，已同步用浅绿色。备选主题是「奶油杏」和「雾绿」。设置可调底色浓度和 0–16 px 的背景模糊。打开模糊、移动组件或手动刷新时更新背景。

设置和登录会话独立保存在当前 Windows 用户目录。登录由学习通页面处理。截止时间根据学习通返回的剩余时间估算，以学习通原页面为准。

## AI 接口

打开「组件设置 → AI 接口」，开启后点「复制调用配置」。复制的 JSON 包含本机地址 `baseUrl`（默认 `http://127.0.0.1:47831`）、各接口地址 `endpoints` 和密钥 `token`。`url` 仍是原来的待办写入地址。所有请求使用 `Authorization: Bearer <token>`。程序隐藏到托盘后仍可调用。关闭接口会撤销密钥，下次开启会生成新密钥。

| 方法 | 路径 | 用途和返回字段 |
| --- | --- | --- |
| `POST` | `/v1/todos` | 新增待办，返回 `todo` |
| `POST` | `/v1/countdowns` | 新增并显示桌面倒计时，返回 `countdown` |
| `GET` | `/v1/data` | 一次读取下列全部数据 |
| `GET` | `/v1/todos` | `todos.items` 包含待办、所属日期和完成状态 |
| `GET` | `/v1/countdowns` | `countdowns` 包含目标时间、颜色、主题、显示形式和显示状态 |
| `GET` | `/v1/homework` | `homework` 包含当前缓存的作业、同步时间和预计截止时间 |
| `GET` | `/v1/schedules` | `schedules` 包含自定义日程 |
| `GET` | `/v1/timetable` | `timetable` 包含已保存的课表和上课时间。未导入时为 `null` |

两个写入接口都接受 UTF-8 JSON，`title` 必填，最长 100 字符。新增待办的 `date` 可填 `YYYY-MM-DD`，省略时使用北京时间的今天。新增倒计时须提供 `at`，例如 `2026-12-10T18:00:00+08:00`。可选 `color` 使用 `#RRGGBB`，可选 `theme` 使用 `desktop`、`liquid`、`frost`、`paper` 或 `midnight`，可选 `ink` 使用 `light` 或 `dark`。默认蓝色、融入桌面和浅字。

倒计时还可选 `layout`，支持 `standard`（横条，默认）、`tiles`（方形分格）、`dial`（圆形表盘）和 `days`（竖向天数卡）。桌面窗口尺寸随显示形式变化。

写入成功返回 `201`。重试时沿用同一 `Idempotency-Key`，同一条已保存的记录返回 `200`，同一标识对应不同内容返回 `409`。查询返回 `200`，日期字段使用北京时间的日历日期。包含时分的时间统一返回 UTC ISO 8601 字符串，可结合响应中的 `timeZone` 转为北京时间。

复制配置后，可在 PowerShell 中新增倒计时并查询数据。

```powershell
$clockApi = Get-Clipboard -Raw | ConvertFrom-Json
$clockKey = [guid]::NewGuid().ToString()
$clockHeaders = @{ Authorization = "Bearer $($clockApi.token)" }
$clockBody = @{ title = '实验答辩'; at = '2026-12-10T18:00:00+08:00' } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri $clockApi.endpoints.countdowns `
  -Headers ($clockHeaders + @{ 'Idempotency-Key' = $clockKey }) `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($clockBody))
Invoke-RestMethod -Uri $clockApi.endpoints.data -Headers $clockHeaders
```

## Windows 构建与发布

开发时可运行 `npm ci`、`npm start` 和 `npm test`。`npm run build:win` 生成本地测试用的便携 EXE，`npm run package:win` 生成包含完整运行目录的测试 ZIP。两种产物都写入 `release`。浏览器中的 Vite 预览使用示例作业。

发布 GitHub Release 前，先配置受 Windows 信任的代码签名凭据，再运行 `npm run package:win:signed`。命令会强制签名，并通过 Windows 验证便携启动器、内部程序和 DLL 的 Authenticode 签名与时间戳。验证通过后，从 `release/signed` 取出便携 EXE 发布。签名凭据保存在构建环境中。

SmartScreen 根据下载文件和发布者的信誉决定是否提示。通过 GitHub 分发的签名新版本仍可能在首次下载时触发提示。Store 安装的 MSIX 由 Microsoft 在上架流程中签名，可避免 SmartScreen 下载警告。 [Microsoft 的分发说明](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
