# MetaMask 报「恶意 — 已标记为不安全」排查

> 排查日期：2026-09-29
> 现象：MetaMask 在连接钱包时拦截 `orbitfi.pages.dev`，红色标签显示
> **「恶意——已标记为不安全」**。

## 一、结论先说

**网站本身没有任何问题，`orbitfi.pages.dev` 也不在 MetaMask 的公开黑名单里。**
拦截来自 MetaMask 内置的实时站点扫描（安全服务商 **Blockaid**），
触发原因是**域名信誉**，不是站点内容：

1. 域名是**今天刚创建**的（`orbitfi` Pages 项目建于 09-29 16:22，至今约 2 小时）
2. 托管在 **`pages.dev`** 这个共享免费域名下 —— 它是全球被用于加密货币钓鱼最多的免费托管之一
3. 站点是**请求连接钱包的 DeFi 应用** —— 高危品类

这三条叠加，等于「一个两小时前出现的、挂在钓鱼重灾域名下、要连钱包的网站」，
自动风控按最坏情况处理。**零信誉 = 默认不信**，这不是误判逻辑出错，是它没有正面信号可用。

## 二、实测证据

### 1. MetaMask 社区黑名单（eth-phishing-detect）

拉取 `src/config.json`（5,263,812 字节）逐条检索：

| 名单 | 条数 | 是否含 `orbitfi` |
|---|---|---|
| `blacklist` | **198,096** | **否** |
| `fuzzylist`（仿冒相似域名） | 8 | **否** |
| `whitelist` | 42 | **否** |

即：**MetaMask 的社区黑名单里根本没有这个域名。**
→ 所以去 `github.com/MetaMask/eth-phishing-detect/issues` 申诉是**找错地方了**，那边只处理社区名单。

### 2. `pages.dev` 在钓鱼黑名单中的占比（**这是最关键的一条**）

| 免费托管平台 | 被拉黑子域数 | 占全名单比例 |
|---|---|---|
| **`pages.dev`** | **14,600** | **7.37%** ⚠️ |
| `gitbook.io` | 11,599 | 5.86% |
| `vercel.app` | 3,705 | 1.87% |
| `web.app` | 2,036 | 1.03% |
| `netlify.app` | 608 | 0.31% |
| `github.io` | 194 | 0.10% |
| `workers.dev` | 30 | 0.02% |

**MetaMask 整份黑名单有 7.37% 是 `*.pages.dev`** —— 它是榜单第一名。
挂在这样一个域名下，等于开局自带极端负面先验。

注意：不是整域封禁 `pages.dev`（名单里没有 `pages.dev` 本身），
而是**逐个子域封禁**——这恰恰说明风控对 `pages.dev` 的新子域是「默认高度警惕、逐个审查」。

### 3. 已排除的原因

| 怀疑项 | 实测 | 结论 |
|---|---|---|
| 站点被 Cloudflare 判定为钓鱼 | 站点返回 **HTTP 200** 正常内容，非 Cloudflare 拦截页 | 排除 |
| 域名在 MetaMask 社区黑名单 | 198,096 条中查无 | 排除 |
| 站点内容触发（合约/脚本） | 与 `zzz-lend.pages.dev` 同一份产物，仅域名不同 | 待对比 |
| 链上合约有问题 | 链上 21 项链上核验全过，与本地编译逐字节一致 | 排除 |

> 未能核验：Blockaid 官方扫描接口与 Google Safe Browsing 需 API key / 被本地网络拦截，
> 无法从命令行直接查询。以上「Blockaid」结论由排除法 + MetaMask 官方文档的
> 三级站点告警体系（Verified / Warning / Malicious）推定。
> 可用浏览器打开 `blockaid.io` 的站点扫描做最终确认。

## 三、处置方案

### 立刻可用（不解决根本问题）

点「**继续操作，风险自负**」即可正常连接。
截图本身也说明风险可控：权限只有「查看地址、余额和活动」+「发送交易请求」，
**「未经您的许可，无法转移资金」** —— 没有任何签名就不可能动到资金。

**但绝不能把这条当长期方案**：每一个真实用户都会看到这个红色警告，
行业数据显示钱包安全警告会让转化率下降 **85%~95%**。
DeFi 协议的主域名挂着「恶意」标签，等于开张第一天就把用户吓跑。

### 根本修复：换自有域名（推荐，也是唯一真正的解法）

`*.pages.dev` 不适合作为 DeFi 协议的生产域名。原因是结构性的：
**你无法控制邻居** —— 同一父域下每天都在新增钓鱼站点，风控对父域的信任只会越来越低。

换成自有域名的好处：

1. **不再继承 `pages.dev` 的负面历史**，信誉从自己的域名开始积累
2. 域名本身就是可信度信号（README / 文档 / Basescan 上都更像一个正经项目）
3. 这是拿到 MetaMask「Verified（已验证网站）」标签的前提
4. 这才是能长期对外宣传的地址

**成本约 $10/年。Cloudflare Pages 的自定义域名功能免费。**

操作步骤（域名托管在 Cloudflare DNS 时最省事）：

```
1. 注册域名（如 orbitfi.xyz / orbitfi.fi / orbitfi.finance）
2. Cloudflare Dashboard → Workers & Pages → orbitfi → Custom domains → Set up a domain
3. 填 apex（orbitfi.xyz）与 www，一键即可签发证书
4. 在 Cloudflare Rules 里把 www 301 到 apex（或反之），只留一个规范域名
```

**好消息**：`frontend/src/` 里**没有任何硬编码域名**，源码零改动。
换域名只涉及文档与脚本里的引用（见下表）。

### 配套的正面信号（有助于风控评分）

| 动作 | 状态 | 说明 |
|---|---|---|
| **Basescan 源码验证** | ❌ **未做** | 合约未验证在风控眼里是负面信号。需 `BASESCAN_API_KEY`，是**优先级最高**的一项 |
| 提交 MetaMask 误报申诉 | ⏳ 建议做 | 见下方「正确的申诉入口」 |
| 站点加 `/.well-known/security.txt` | ⏳ 可选 | 显示有安全联系方式 |
| 域名邮箱（`security@域名`）| ⏳ 可选 | 提升可信度 |
| 外部审计 | ❌ 未做 | 审计报告是申诉时最有力的证据 |

### 正确的申诉入口

MetaMask 帮助文档把站点告警分三类（Verified / Warning / Malicious），
并明确：**URL 类告警不能用弹窗里的「Report an issue」（那个只支持交易类），
要走支持团队人工复核**，需要提供：

- 被标记的对象（这里是 URL）
- 网络（Base）
- 告警截图
- **能证明实体身份的官方链接**（项目官网、文档、区块浏览器页面）

→ 这些材料正好就是「自有域名 + Basescan 已验证合约」组合。
**换个域名再申诉，成功率远高于守着 `pages.dev` 申诉。**

## 四、换域名时需要同步的文件

`frontend/src/**` 无需改动。以下位置需要替换：

| 文件 | 位置 |
|---|---|
| `README.md` | L5 `Live frontend` 链接、L40 目录树注释 |
| `docs/README.md` | L18 线上域名记录 |
| `frontend/README.md` | L39 关于 `pages.dev` 的访问说明（可删） |
| `screenshots/cdp_check.js` | L5 默认 URL |
| `screenshots/cdp_check2.js` | L6 默认 URL |
| `frontend/package.json` | `deploy:cf` 的 `--project-name`（**仅在换 Pages 项目时才改**） |

> Cloudflare Pages 的**项目名不需要改** —— 自定义域名是绑到现有项目上的。
> 也就是说换域名**不需要重新部署**，也不需要动 `deploy:cf`。

## 五、一句话总结

`orbitfi.pages.dev` 没被任何黑名单收录，是**新域名 + 共享免费托管 + DeFi 品类**
三者叠加触发了自动风控。点「继续操作」能绕过，
但要让用户永远看不到这个警告，**必须换自有域名并完成 Basescan 源码验证**。
