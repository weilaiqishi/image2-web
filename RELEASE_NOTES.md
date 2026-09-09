# Image2 Studio v0.1.2

- 修复 macOS 应用资源签名缺失导致的“已损坏”问题，为完整应用添加 ad-hoc 签名。
- 统一安装包内部版本为 0.1.2，修复 v0.1.1 安装包仍显示 0.1.0 的问题。
- 发布前自动校验 DMG 完整性、应用签名与内部版本，阻止损坏的安装包发布。

## 下载与安装

- Apple Silicon Mac：下载 `aarch64.dmg`。
- Intel Mac：下载 `x64.dmg`。
- Windows 10/11 x64：下载 `x64-setup.exe` 或 `.msi`，任选其一。

macOS：打开 DMG，将应用拖入 Applications。此版本尚未进行 Apple Developer ID 签名和公证，首次启动若提示无法验证开发者，请在“系统设置 → 隐私与安全性”中选择“仍要打开”。ad-hoc 签名解决应用签名完整性问题，不代表 Apple 公证。

Windows：安装包尚未进行发行者签名。如遇 SmartScreen，确认下载来自本 Release 后，可选择“更多信息 → 仍要运行”。

`SHA256SUMS` 提供所有安装包的 SHA-256 校验值。
