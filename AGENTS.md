# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
## 作业时钟

- 这是独立的 Windows 桌面应用，Electron 入口在 electron/。浏览器预览只使用示例作业。
- 信息架构按「课程 → 日程 → 作业 → 待办」排序，追求极致纯净度。采用 A2 极简结构：顶部单行轻日期锚点（兼作窗口拖拽区，悬停时右侧浮现待办、新建日程、置顶、设置），紧接同字号微透明「下一节课」胶囊条（点击打开课表），主体沿用纵向时间线展示日程与作业（行内「加入待办」悬停浮现，已加入保留绿勾），底栏平时隐藏、悬停轻显同步状态与学习通入口，操作提示 1.8 秒后自动消退。
- 首次启动默认「融入桌面」（底色和模糊均为 0，无边框、无底板，清晰系统字体 + 干净字后柔影，支持浅字 / 深墨切换以适配深浅壁纸）。设置提供底色浓度（0–45%）和背景模糊（0–16 px）滑块；打开模糊、使用磨砂材质、移动或缩放组件、重新显示或手动刷新时更新桌面取样，平时复用同一帧。备选材质升级为暗墨云母、轻雾白霜和暖白皱笺（采用真实揉皱棉白纸纹理、暖白微调、空心日期圈、虚线分组与朱砂细框提示紧急倒计时）。
- Windows 本地构建使用 `npm run build:win` 生成 EXE。对外分发使用 `npm run package:win` 生成 ZIP。
- 液态玻璃使用透明窗口和固定边缘高光，中央直接透出桌面，沿用浅字／深墨设置。
- 经典磨砂参考早期 macOS 的半透明材质，保留取样的颜色变化，配合扩散、细颗粒和独立的底色及模糊设置。开启「跟随动态壁纸」后，需要取样的材质会在可见期间持续刷新桌面，隐藏和最小化时暂停。
- 液态玻璃和经典磨砂使用系统字体、实色文字和轻阴影，字形保持自然。液态玻璃仅在文字附近用局部渐隐背景提升可读性，经典磨砂独立记忆浅字／深墨，默认深墨。
- 双击 Windows 程序打开组件。学习通会话与后台同步在程序内运行。
- 同一 Windows 用户的正式版沿用 `%APPDATA%\Homework Clock` 和 `persist:homework-clock-chaoxing`，以便重启和换版时复用有效的学习通登录会话。预览与测试使用独立的目录。
- 支持拖动手柄缩放、尺寸预设、四角定位和自动吸附。贴角后从内侧缩放，启动时恢复上次尺寸和位置。
- 倒计时通过组件设置和系统托盘管理，每项开启独立桌面卡片，可自选名称、目标时间和强调色。位置和显示状态随重启恢复；显示器暂时缺席时保留原位置供重新连接后恢复。
- AI 接口沿用本机 HTTP 地址和密钥，可新增待办、倒计时，并读取待办、倒计时、作业缓存、日程和课表。读取只返回业务字段。
- 每张倒计时卡片单独选材质和配色，新建默认融入桌面，旧卡片沿用夜蓝。融入桌面与液态玻璃提供浅字、深墨且无需桌面取样；经典磨砂在打开或移动后更新背景静帧。
- 倒计时的显示形式与材质独立。横条、方形分格、圆形表盘和竖向天数卡分别使用不同的窗口尺寸，缺少显示形式的旧卡片恢复为横条。
- 课表默认显示北京时间当天尚未结束的课程。当日无剩余课程时，显示下一节的日期和时间。完整周课表按需打开，导入时优先根据兰大校历自动识别第一教学周。
- 首页的下一节课时间与有截止时间的普通作业倒计时使用主题强调色。进入 72 小时的倒计时使用暖黄，少于 24 小时使用红色。
- Windows 便携版的开机自启从「组件设置」控制。系统托盘可显示、隐藏或退出组件。
