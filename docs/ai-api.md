# AI 接口

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
