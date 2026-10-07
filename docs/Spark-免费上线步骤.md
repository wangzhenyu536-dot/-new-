# EVERTRACE 免费版上线步骤

更新：2026-10-07。目标项目：**wisdom-a9e09**。本指南只发布 Firebase Spark 的静态 Hosting、Firestore 规则和索引；账户使用已有 Authentication。生产包已在本机准备，以下云端操作尚未执行。

## 1. 在 Firebase 确认三项设置

打开 [Firebase 控制台](https://console.firebase.google.com/project/wisdom-a9e09/overview)。

1. 确认项目方案显示 **Spark**。保持免费，不绑定账单。
2. 在 **Authentication → Sign-in method** 启用 **Email/Password**。不用开启邮箱链接登录或手机短信。在 **Settings → Authorized domains** 确认 `wisdom-a9e09.web.app` 和 `wisdom-a9e09.firebaseapp.com`。
3. 确认已经创建 **Cloud Firestore** 的 **Standard edition**、`(default)` 数据库。Realtime Database 是另一种数据库，不能代替它。已有 Firestore 时使用现有数据库，不重新创建或更改区域。

如果云端已经保存旧版技能包、分类或账户档案，先停止发布并告知 agent；这些集合与免费版不能直接混用，需要单独评估。下面步骤以尚无旧版业务资料的云项目为前提，不导入本地演示账号或样例。

不用再次选择测试模式，也不用自己粘贴开放规则；第 3 步会发布已测试的正式访问规则。[官方邮箱密码设置](https://firebase.google.com/docs/auth/web/password-auth)。

## 2. 登录发布工具

在电脑终端复制：

```bash
cd /Users/programmer_mu/SelfProject/BrainWave/-new-
./node_modules/.bin/firebase login
```

浏览器出现 Google 登录页面时，用拥有 `wisdom-a9e09` 项目权限的账户完成登录。已登录时沿用即可。

## 3. 发布免费版

复制：

```bash
npm run cloud:spark:deploy -- wisdom-a9e09
```

等待出现部署成功和 Hosting URL。脚本会先重新构建、检查免费版依赖，再仅发布 Firestore 规则、索引及静态网页；不发布 Functions 或 Storage。不要使用保留给旧版的 `cloud:deploy` 指令。

部署后打开 **https://wisdom-a9e09.web.app**。资料列表和详情页面直接打开或刷新也应正常；静态 Hosting 已设置页面路由重写。[官方 Hosting 路由说明](https://firebase.google.com/docs/hosting/full-config)。

如果终端询问是否删除原有索引，而且项目确实曾有旧业务，不确认删除，先停止并告知 agent。到 **Firestore → Indexes** 等待本次索引全部变为 Enabled 后再验收组合筛选和管理查询。构建成功只表示文件准备成功，不能代替部署成功。

## 4. 建立自己的账号

在上线网页选择 **Create account**，用自己的真实邮箱注册。成功后应进入资料列表。

本地的 `member@spark.evertrace.test`／`admin@spark.evertrace.test` 是演示账号，不能用于云端登录；新网站使用自己的账号。本地账号和资料继续保存在本机。

## 5. 仅第一次设置管理员

首次建站通过控制台设置首管理员。仅在 **没有管理员且没有 `system/roles` 记录** 时执行；如果已有这两项，保留原值，通过现有管理员的 Members 页面管理角色。

1. 在 **Firestore → Data → users** 找到第 4 步注册的邮箱。该档案应仅有 `uid`、`email`、`displayName`、`role` 四个字段。核对邮箱与 Authentication 的账户 UID；不要选本地演示 UID。
2. 先创建集合 `system`、文档 ID `roles`，填写下表。空字符串表示选择 string 类型后让值为空，不输入两个引号。

| 字段 | 类型 | 值 |
| --- | --- | --- |
| adminCount | number | 1 |
| revision | number | 0 |
| changedUid | string | 空字符串 |
| fromRole | string | member |
| toRole | string | member |
| operationId | string | 空字符串 |

3. 保存这份记录后，回到刚才选中的 `users` 档案，将 **role** 从 `member` 改为 `admin`。只改该字段，不增加时间或其他字段。
4. 回到网页刷新，进入 **Community members** 和 **Manage categories**。以后的角色调整都在网页中操作，最后一位管理员受保护。

这两步是首次建站的控制台初始化，需要项目管理者执行。agent 没有替你写入云端角色；若记录已存在或数值不同，不按此表覆盖它们。

## 6. 上线验收

先用自己网络的电脑和手机打开网站，再执行：

1. 注册、退出、再次登录，无黑屏；首页显示姓名。找回密码能收到真实邮件，检查垃圾邮件目录。
2. 用一份真实设备 Excel（`timestamp_ms`、`value`）和正文／TXT 保存，再用第二个成员查看。可添加原图片，每件不超过 512 KiB，每包总附件不超过 3 MiB，最多 12 件。
3. 下载 Excel／图片／TXT 原件和 ZIP；核对原文件内容、波形和单位说明。value 保持设备原始数值，没有物理单位换算。
4. 创建者编辑、删除自己的技能包；其他成员不能编辑／删除。管理员检查分类迁移、成员角色与最后管理员保护。
5. 切换中文和英文、刷新资料详情，确认桌面与手机均能正常使用。

真实设备容量、云端邮件、索引、网络及权限尚需这一步验证。本地合成样例和被拦截的云请求测试不代表这些事项已通过。

## 免费边界和恢复办法

原 Excel／图片／TXT 保存在 Firestore 中，都会占用数据库存储和下载流量；不是额外获得无限附件空间。

截至 2026-10-07，官方列出的免费额度：

| 项目 | 额度 |
| --- | --- |
| Firestore 存储 | 1 GiB，包含文档和索引占用 |
| Firestore 读取／写入／删除 | 每天 50,000／20,000／20,000 次 |
| Firestore 下载流量 | 每月 10 GiB |
| Hosting 网页存储 | 10 GB |
| Hosting 网页流量 | 每月 10 GB |
| Auth 找回密码邮件 | 每天 150 封 |

来源：[Firestore 额度](https://firebase.google.com/docs/firestore/quotas)、[Hosting 额度](https://firebase.google.com/docs/hosting/usage-quotas-pricing)、[Auth 邮件额度](https://firebase.google.com/docs/auth/limits)。控制台规则读取、订阅、事务重试等也可能增加读取次数；3 MiB/包不意味着恰好能保存 341 包，还需给正文、清单、索引和操作记录留空间。

查看 **Firestore → Usage**、**Hosting → Usage**。Spark 下额度耗尽可能暂停相应功能；不要为恢复而自动开 Blaze。Firestore 每日额度在太平洋时间午夜附近重置；月度流量需等待新的计费周期。存储已满时先保留自己的 ZIP／原件，再规划减量；不要随意在控制台删除子记录，以免损坏资料一致性。页面提示失败时保留表单内容，恢复后重试；未完成的删除／迁移从 Pending operations 继续。

这里只使用普通邮箱密码账户，不启用付费短信、Cloud Functions、Cloud Storage、App Hosting 或托管数据库备份。用户需自行保留原文件或导出的 ZIP；业务 ZIP 不包含完整账号、角色和数据库灾难恢复快照。网络能否访问 Google/Firebase 与 Spark／Blaze 无关，升级不会解决网络阻断；暂时无法连接时不要重复点击保存。
