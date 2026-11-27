# Windows 构建与发布

开发时可运行 `npm ci`、`npm start` 和 `npm test`。`npm run build:win` 生成本地测试用的便携 EXE，`npm run package:win` 生成包含完整运行目录的测试 ZIP。两种产物都写入 `release`。浏览器中的 Vite 预览使用示例作业。

发布 GitHub Release 前，先配置受 Windows 信任的代码签名凭据，再运行 `npm run package:win:signed`。命令会强制签名，并通过 Windows 验证便携启动器、内部程序和 DLL 的 Authenticode 签名与时间戳。验证通过后，从 `release/signed` 取出便携 EXE 发布。签名凭据保存在构建环境中。

SmartScreen 根据下载文件和发布者的信誉决定是否提示。通过 GitHub 分发的签名新版本仍可能在首次下载时触发提示。Store 安装的 MSIX 由 Microsoft 在上架流程中签名，可避免 SmartScreen 下载警告。 [Microsoft 的分发说明](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
