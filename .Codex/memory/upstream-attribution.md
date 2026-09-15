# 上游署名与赞助展示

- 用户要求移除关于页和 README 中上游作者的赞助内容，作者标注为“上游原作者”。
- 关于页移除赞助卡片、支付宝/微信付款二维码引用及 Coffee 图标引用；保留原作者姓名、头像和上游仓库链接。
- 根目录中英文 README 的作者栏改为上游原作者，仓库链接标注为上游项目。四份 README 均未检出赞助段落；应用子目录 README 无作者栏，无需额外修改。
- 保留许可证及原作者署名。
- 更新来源使用当前 Git origin 对应的 `LingYzh/Kiro-account-manager`：关于页手动检查的 GitHub API 和 electron-builder 的 GitHub 发布/自动更新配置保持一致；下载及发布页链接来自该仓库的 Release 响应。原作者卡片中的上游链接仍用于署名。
- 验证：`npm run build`（含主进程和渲染进程类型检查）及 `git diff --check` 通过；未执行在线更新下载或安装。
