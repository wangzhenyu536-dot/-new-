# EVERTRACE／拾光 V1

第一版目标为团队技能包管理系统：文本、图片、单通道脑电 Excel，分类、波形和下载。需求见 [开发文档](docs/V1-开发文档.md)，迭代见 [开发计划](docs/迭代开发计划.md)，工作方式见 [agent.md](agent.md)。

## 当前交付

R0 已完成自动验证，待用户验收。新版首页延续原视觉，提供创建、浏览和账户的独立预览路由。注册登录、实际上传、保存和查看资料尚未实现，将按迭代计划加入。当前不是完整 V1。

## 本地运行

```sh
npm ci
npm run dev
```

新版地址为 http://127.0.0.1:5173。仓库固定项目内 Node 22，`npm run` 自动使用它；不改系统 Node。

本地模拟项目为 `demo-evertrace`，仅连接模拟器，不需云账号或计费账户。本轮资料规则全部拒绝，后续逐轮增加真实授权。

## 自动验证（由 agent 执行）

首次准备 Java 和测试浏览器：

```sh
npm run setup:java
npx playwright install chromium
```

Java 从 Eclipse Adoptium 官方接口获取 Java 21 JRE，并校验 SHA-256，解压到已忽略的 `.runtime/`。无需全局安装。已有 Java 21 时也可用 `JAVA_HOME`。

```sh
npm run verify
```

统一验证执行类型检查、静态检查、Firebase 规则测试、浏览器测试和构建。首次浏览器测试自动保存原首页基线。

- `npm run test:rules`：隔离模拟器自动启动、运行、退出。
- `npm run emulators`：启动本地 Auth、Firestore、Storage。
- `npm run test:e2e`：运行页面流程，必要时自动启动开发服务。
- `npm run build`：产物在 `apps/web/dist`。
- 生成报告、截图和旧代码快照在 `outputs/R0` 与 `playwright-report`，均忽略，不提交。

## 目录

- `apps/web`：新版 React + TypeScript + Vite 页面。
- `packages/shared`：前后端共享数据合同；实际业务操作随迭代加入。
- `firebase`：权限规则及索引。
- `tests/e2e`、`tests/rules`：先行编写的自动化测试。
- `scripts`：项目 Java 与模拟器、截图基线。
- `docs`：需求、计划、每轮验收记录。
- `frontend` 与 Python 原型：历史参考，保留；旧运行方式见 `docs/旧版README.md`。
- `data`：历史资料，本轮未改动、导入或删除。

`.gitignore` 与 `.ignore` 同时排除 `.runtime`、缓存、依赖、构建、截图和报告。已有 Git 跟踪的历史 data 保持原状。

## 后续

下一轮 R1 接入真实注册登录与路由守卫。真实 Excel 格式、单位与容量参数仍需实际样例验证；云环境及部署尚未配置。
