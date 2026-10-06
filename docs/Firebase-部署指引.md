# Firebase 部署指引

**2026-10-06 已选定仅 Firebase Spark 免费版，不启用 Blaze。新范围见 [Spark 需求对齐](Spark-需求对齐.md)，S0 隔离规则原型已通过，产品文件流程和真实云端仍待后续验证；六轮顺序见 [Spark 开发计划](Spark-开发计划.md)，Spark 部署步骤在 S5 交付。下文全部是旧 Functions／Storage 方案的历史参考：不要照做升级、Storage 初始化或 cloud:deploy；它们不适用于当前选型。**

更新：2026-10-05。用户已提供项目 wisdom-a9e09 的 Web 配置，本机正式构建通过。Blaze、Authentication、Firestore、Storage 是否启用及其实际区域尚待确认；agent 未开通计费或执行云部署。本指引用于创建项目后的试用部署；真实设备文件、云端流程与容量核验完成后才算正式上线验收。

## 先在网页完成这五步

1. 打开 [Firebase 控制台](https://console.firebase.google.com/)，登录 Google 账户，点击“创建项目”。项目名称可填 EVERTRACE；记下项目 ID。Google Analytics 可先关闭。
2. 项目左下角选择“升级”，按页面提示连接结算账户并选择 Blaze。Storage 当前需要此方案；按实际用量计费，不能保证永久免费。在 Google Cloud 结算中为此项目设置预算提醒；提醒不会自动停止收费。[官方计费要求](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
3. 左侧“构建 → Authentication → 开始使用 → 登录方式”，开启“电子邮件／密码”，保存。[官方说明](https://firebase.google.com/docs/auth/web/password-auth)
4. “构建 → Firestore Database → 创建数据库”：选择 Standard 版、默认数据库 `(default)`、生产模式，位置建议 `us-central1`。随后“构建 → Storage → 开始使用”，选择生产模式、`us-central1`，记下完整 bucket 名称。如果准备使用其他区域，先告诉 agent，以便同步配置；数据库位置创建后不能直接更换。[Firestore 初始化](https://firebase.google.com/docs/firestore/quickstart)
5. 回到项目概览，点击 `</>` 添加 Web 应用，名称可填 EVERTRACE Web。复制页面给出的 `firebaseConfig`，连同项目 ID、数据库位置、Storage bucket 发到当前聊天。这里需要 Web 应用配置；不需要账户密码、服务账号私钥。Agent 会填写本机配置，并给出替换好项目 ID 的命令。

## 配置准备好后在本机终端执行

下面已填写项目 wisdom-a9e09；服务启用情况确认后再执行部署。构建准备已在本机完成，尚未部署成功。

```sh
cd /Users/programmer_mu/SelfProject/BrainWave/-new-
npx firebase login
npm run cloud:prepare -- wisdom-a9e09
```

首次登录会打开浏览器，选择拥有这个 Firebase 项目的 Google 账户。prepare 只构建，不部署；缺少配置、项目不匹配、前后端区域不一致或终端带有模拟器变量时会停止。云配置保存在 `.env.cloud.local`；本地预览继续使用原来的 `.env` 和 demo 项目。

准备结果包含正式网页 `apps/web/dist-cloud`、服务端 `functions/lib`、`functions/.env.wisdom-a9e09`、下载域名配置 `outputs/release/storage-cors.json` 和配置摘要 `outputs/release/manifest.json`。生成文件均已忽略，不提交运行环境或凭证。

确定要把这一版上传到已开通服务的项目后：

```sh
npm run cloud:deploy -- wisdom-a9e09
```

部署脚本会重新检查项目并构建，然后把同一套 Functions、Firestore 规则及索引、Storage 规则、网页部署到明确指定的项目。无需重新初始化工程或改写业务代码；请使用工程提供的部署入口。[Firebase Hosting 部署](https://firebase.google.com/docs/hosting/quickstart)

## 开启原件、PNG、ZIP 下载

浏览器直接读取 Storage 原件需要额外设置下载域名。[Firebase 下载要求](https://firebase.google.com/docs/storage/web/download-files)

在 [Google Cloud 控制台](https://console.cloud.google.com/) 顶部选择同一个项目，点击右上角 Cloud Shell 终端图标。通过终端的“上传文件”菜单上传本机 `outputs/release/storage-cors.json`。然后执行 agent 根据真实 bucket 填好的这一行：

```sh
gcloud storage buckets update gs://wisdom-a9e09.firebasestorage.app --cors-file=storage-cors.json
```

文件默认只允许本项目的两个 HTTPS 网站地址；自定义域名需要补到 `.env.cloud.local` 的 EVERTRACE_SITE_ORIGINS，再重新 prepare 并应用该文件。这一步不会开放文件读权限，登录和业务权限仍由规则控制。[Google Cloud 配置方式](https://cloud.google.com/storage/docs/configuring-cors)

## 首位管理员

先打开部署后的网址，用自己的邮箱正常注册一次，等页面进入资料列表。管理员身份需要可信服务端初始化，不能在网页自行选择。

本机已安装 Google Cloud CLI 时，先执行 `gcloud auth application-default login`，在打开的页面选择同一个项目所有者账户。随后：

```sh
npm run cloud:admin -- wisdom-a9e09 YOUR_REGISTERED_EMAIL
```

该脚本使用本机授权凭证和既有管理员初始化事务：只能在没有管理员时初始化第一名，已有管理员应从“Community members”管理后续角色。无需下载或发送服务账号私钥。未安装 Google Cloud CLI 时告知 agent，再安排适合本机的安装／授权步骤；不要手工在数据库中修改角色。其他成员均通过网站注册，模拟器账号不会自动成为线上账号。

## 上线前的效果验收

- 在两个真实账户间完成注册、登录、找回密码、正文或 TXT＋Excel 保存、资料查看和筛选。
- 用真实设备 Excel 核对两列表头 timestamp_ms／value，时间为毫秒，value 为无物理单位的设备原始数值；不换算或假定采样率。
- 核对单文件、PNG、ZIP 内容和完整时间范围；桌面和手机、中英文均检查。
- 核对创建者编辑／删除、其他成员权限、管理员分类和角色管理、最后管理员保护。
- 等待 Firestore 索引构建完成；若出现缺少索引错误，应检查已部署索引状态。
- 检查真实文件与容量表现后，才把“暂定上限”替换为正式限制。当前本机合成数据测试不能代替云端容量和邮件投递验证。

费用主要来自 Firestore 读写、Storage 文件容量与下载、Functions 调用及构建／镜像。文件删除遵守社区已确认的不可恢复流程；云供应商软删除／备份设置可能另有保留周期与费用，需要云项目建好后核对。维护清理已具有管理员 callable 和幂等清理逻辑；云端日常运维及计费效果仍需实际联调。


## wisdom-a9e09 配置准备记录（2026-10-05）

用户提供的 Web 配置已写入独立、已忽略的 .env.cloud.local；没有再次在业务代码 initializeApp，也没有启用 Realtime Database。databaseURL 不用于本项目；Firestore Standard 的默认数据库仍是业务数据库前提。Functions 暂按工程默认 us-central1 准备，前后端保持一致，实际服务区域仍需确认。

7 项部署配置及真实云模式构建测试通过；npm run cloud:prepare -- wisdom-a9e09 通过。服务端环境文件可解析且区域／bucket 一致，CORS 文件可解析并只允许明确网站域名，本地原 .env 状态和 .firebaserc 保持不变。证据：outputs/release/config-tests.json、prepare.log、prepare-check.json、manifest.json。测试没有证明真实云登录、上传或权限已经成功，云资源部署状态保持未部署。

## 当前约束：用户不启用 Blaze（2026-10-05）

用户确认配置选择测试模式，其余已操作，但明确不使用 Blaze。本记录以这一最新要求为准：不关联计费、不升级方案、不执行现有完整云部署命令。Cloud Functions 和 Cloud Storage 官方均要求 Blaze，Spark 无法承载现有完整账户档案／上传保存／附件与权限流程；保留准备好的配置及本地预览，不通过公开写权限或客户端提权绕过后端。

Firestore 的测试／生产模式是初始权限规则选择，不是防火墙或网络线路选择。生产初始化默认拒绝客户端访问，部署本项目规则后按登录与成员权限放行；测试模式初始权限宽松，不能作为正式社区权限规则。切换规则模式不能解决 Firebase 地址的网络连通问题。用户报告的云服务操作尚未由 agent 实际核验，Storage 可用性不能由 Web bucket 配置推定。

当前完整云上线需先调整部署方案或由用户改变计费选择；不把 Spark 下仅网页托管称为完整系统上线。若用户选择更换 Functions 与附件存储平台，先评估现有事务、验证和权限逻辑的复用，再按测试先行实施，不未经选择重写后端。

依据：[Functions 部署要求](https://firebase.google.com/docs/functions/get-started)、[Storage 计费要求](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)、[Firestore 初始规则模式](https://firebase.google.com/docs/firestore/quickstart)。
