# EVERTRACE／拾光 V1

团队技能包管理系统：文本、图片、单通道脑电 Excel，分类、波形和下载。需求见 [开发文档](docs/V1-开发文档.md)，迭代见 [开发计划](docs/迭代开发计划.md)，开发约定见 [agent.md](agent.md)。

## 当前交付

R0、R1 已验收。R2 分类与 Excel 预检自动验证通过，待用户验收。首页沿用原视觉，默认英文并记忆手动语言选择。已实现 Firebase 邮箱账户、可信成员档案、角色路由，以及共享分类创建、文本／Excel 本地检查和基础波形预览。保存／列表／详情在 R3，成员管理在 R8；当前不是完整 V1。

## 本地运行

在项目根目录打开两个终端。服务或页面已经运行时无需重复启动，避免端口冲突。

终端一：启动本地账户、数据库、文件与函数服务。

```sh
cd /Users/programmer_mu/SelfProject/BrainWave/-new-
npm ci
npm run emulators
```

终端二：启动网页。

```sh
cd /Users/programmer_mu/SelfProject/BrainWave/-new-
npm run dev
```

在浏览器打开 http://127.0.0.1:5173 。URL 不是终端命令；macOS 也可执行 `open http://127.0.0.1:5173`。

项目使用已锁定的 Node 22，`npm run` 自动使用项目内运行环境。本地模拟项目为 `demo-evertrace`，不需要云账户和计费账户。正常按 Ctrl+C 关闭模拟器时导出至被忽略的 `.runtime/emulator-data`，下次自动导入；强制结束进程不会保证保存。不要将运行环境、模拟器资料或演示账号报告提交到 Git。

第一次准备 Java 和测试浏览器（环境准备与测试由 agent 执行）：

```sh
npm run setup:java
npx playwright install chromium
```

Java 21 JRE 来自 Eclipse Adoptium 官方接口，校验 SHA-256 后解压至 `.runtime/`；也可使用已有 Java 21 的 `JAVA_HOME`。`.gitignore` 和 `.ignore` 同时排除运行环境、缓存、依赖、构建与报告。

## 本地账户验收

可自行注册邮箱密码账户。也可使用 agent 已准备的合成账户：

| 身份 | 邮箱 | 密码 |
| --- | --- | --- |
| 普通成员 | member@evertrace.test | EvertraceDemo2026! |
| 管理员 | admin@evertrace.test | EvertraceDemo2026! |

这些账号仅在本地模拟器中有效。需要重新准备演示账户时，在服务已启动后运行 `npm exec -- node scripts/seed-preview.mjs`，它只操作上述合成账户，不重置现有密码。已存在首位管理员时不能用它将另一个账号提升为管理员。

首位管理员由后台选择，先在网页注册该邮箱，再执行：

```sh
npm run admin:init -- registered-email
```

此命令硬性限定本地 `demo-evertrace`，不会连接生产。并发初始化只允许一位首任管理员，重复初始化同一管理员幂等；后续角色调整及最后管理员保护在 R8。

密码找回实际调用 Firebase Authentication。模拟器只记录重置链接，不发送真实邮件；真实投递留待云联调。重置码、新密码可用及旧密码失效已自动测试。

## 自动验证

```sh
npm run verify
```

统一入口执行类型检查、静态检查、真实模拟器集成／规则测试、浏览器测试和前后端构建。自动测试使用独立项目 `demo-evertrace-test`、独立端口和浏览器，不清理默认预览资料。

- `npm run test:rules`／`npm run test:integration`：账户集成与 Firestore／Storage 规则，加共享校验和配置测试，共 42 项。
- `npm run test:e2e`：账户、分类、材料预检与首页／语言回归，共 26 项，测试网页端口 5174。
- `npm run build`：网页产物 `apps/web/dist`，函数产物 `functions/lib`。
- `outputs/R1`、`outputs/R2`：先行失败、通过报告和截图；`playwright-report`：浏览器报告。均被忽略。
- 本轮验收说明及证据见 [R2 进度](docs/R2-进度.md)。打开 `/packs/new`，填标题与正文、选择／新建分类，用页面下载的合成 Excel 检查波形及行列错误；本轮不上传文件，保存在 R3 开放。

## 目录与边界

`apps/web` 为新版 React + TypeScript + Vite 页面，`functions` 为可信服务端 callable，`firebase` 为规则与索引，`tests` 为真实自动测试，`scripts` 为本地环境与管理员工具。

`frontend` 与 Python 原型保留参考；旧运行方式见 `docs/旧版README.md`。历史 `data` 未修改、导入或删除。未完成的技能包访问继续拒绝；分类由成员读取、可信 callable 创建，客户端直接写入拒绝。Firestore 用户只能读取自己的档案，不能直接写角色；资料写入将随业务功能由服务端开放。

真实 Excel 模板、单位与容量尚需实际样例验证。云项目、计费、正式邮件和生产部署尚未配置。
