# 甘肃奶龙大学.com

一个轻量的 Cloudflare Workers 入口页，同一份源码可为甘肃奶龙大学、甘肃奶蛙大学分别构建静态页面。响应式布局，跟随系统深色模式；页脚提供仓库、加群、[查找更多奶群和奶站](https://nai.amoe.cc) 链接和访问统计。

## 本地开发

需要 Node.js 22 或更新版本，以及 pnpm 11.23.0。

```sh
pnpm install
pnpm run dev
```

打开 http://127.0.0.1:8787。修改 HTML、CSS 或 Worker 后会自动重新加载。

默认使用甘肃奶龙大学的配置。需要自定义时，将 `.env.example` 复制为 `.env`，只保留要修改的字段。`.env` 不提交 Git；修改后重新启动 `pnpm run dev`。终端已设置的环境变量优先于 `.env`。

Wrangler 会自动执行 `pnpm run build`，将配置和当前提交的前 7 位 hash 写入 `dist/` 的静态 HTML。Cloudflare 构建优先读取 `WORKERS_CI_COMMIT_SHA`，本地使用 `git rev-parse HEAD`。页面请求直接返回构建产物；站名、按钮及链接在构建时确定。生成文件不提交 Git。

## 可选配置

以下是可选的**构建环境变量**，每项独立回退，未设置或留空均使用表中的默认值。文本、链接及下载的图片会成为公开页面内容，修改后需要重新构建、部署。

| 变量               | 用途                                           | 默认值                                 |
| ------------------ | ---------------------------------------------- | -------------------------------------- |
| `SITE_NAME`        | 浏览器标题、页面标题、描述及校徽替代文字       | `甘肃奶龙大学`                         |
| `STICKER_TXT`      | 首页贴纸文本                                   | `奶龙出没`                             |
| `LOGO_URL`         | 校徽 PNG 图片的下载地址，同时用于 Apple 触屏图标 | 内置 `public/logo.png`                |
| `FAVICON_URL`      | 浏览器图标的下载地址，支持 PNG 或 ICO           | 内置 `public/favicon.ico`             |
| `GO_BTN_TXT`       | 主按钮文本                                     | `GO`                                   |
| `GO_BTN_TGT`       | 主按钮跳转地址                                 | `https://www.lut.edu.cn/`              |
| `UMAMI_SCRIPT_URL` | Umami 采集脚本地址                             | `https://umami.amoe.cc/script.js`      |
| `UMAMI_SITE_ID`    | Umami 采集网站 ID                              | `ee3cbb93-6ca4-4164-8a6c-4bb22b80675d` |
| `GROUP_NAME`       | 加群文案中的名称，显示为「加入 `{名称}` 奶群」 | `兰理`                                 |
| `GROUP_LINK`       | 加群链接                                       | `https://qm.qq.com/q/AjLVv044nu`       |

URL 配置必须是完整的 HTTP(S) 地址。长按钮文案自动使用较小字号。

`GROUP_NAME` 或 `GROUP_LINK` 任意一项设为 `-` 时，构建会移除页脚的加群入口及协议中的对应名称，不留下分隔线。未配置或留空仍各自使用默认值；隐藏入口时不校验群链接。

如果构建提示「页脚提交版本无效」，报错会注明 SHA 的来源、去除首尾空白后的长度及排查位置，不输出原始值。`WORKERS_CI_COMMIT_SHA` 应由 Cloudflare 自动提供，通常不需要手动设置；若被覆盖，请检查「Settings → Build → Build variables and secrets」、构建命令和 `.env`。它必须是 40 位十六进制的完整提交 SHA，不能填写短 hash 或分支名。未设置时从 Git 读取；读取失败也会明确报错。

`LOGO_URL` 和 `FAVICON_URL` 只在构建时下载图片，保存到 `dist/` 并替换对应的默认资源；首页、用户协议和隐私政策均引用本站图片，HTML 不包含图片源地址。两个变量各自独立回退，单独更换校徽不会改变浏览器图标。建议校徽使用已裁切、圈外透明的正方形 PNG；图片不自动裁切或转换。每张图片最多 5 MiB，单次下载限时 15 秒；地址无效、下载失败或格式不符会使构建失败，并指出对应变量。

`UMAMI_SHARE_URL` 是另一个可选的**运行时 Secret**，仅供 Worker 查询页脚统计，没有默认值。未配置时仍正常展示页面和运行 Umami 采集脚本，页脚统计显示加载失败及重试入口。真实分享链接只能配置在本地 `.dev.vars` 或云端 Worker Secret 中，不能放进 `.env.example`、`wrangler.jsonc`、构建变量或 Git。

## 检查与部署

```sh
# 验证配置和打包，不上传
pnpm run check

# 验证构建配置和统计代理
pnpm test

# 登录 Cloudflare 并部署
pnpm exec wrangler login
pnpm run deploy
```

### GitHub 自动检查

`Check Code` 工作流在推送到 `master`、提交目标为 `master` 的 PR 或手动触发时，使用 Node.js 22 和 `package.json` 指定的 pnpm 版本执行冻结安装、测试及 `pnpm run check`。Wrangler 预检会自动构建静态页面并验证 Worker 打包，无需 Cloudflare 凭据，不上传或部署。

Dependabot 每周检查根目录的 npm 依赖（包括 `pnpm-lock.yaml`）和 GitHub Actions 更新，并创建更新 PR。

### 两个域名分别部署

创建两个独立的 Worker，均连接此仓库，分别设置构建变量及域名。一个 Worker 对应一套构建产物。

| 域名               | Worker 名称示例         | `SITE_NAME`    | `GO_BTN_TXT`   | `GO_BTN_TGT`               |
| ------------------ | ----------------------- | -------------- | -------------- | -------------------------- |
| `甘肃奶龙大学.com` | `gansunailongdaxue-com` | `甘肃奶龙大学` | `GO`           | `https://www.lut.edu.cn/`  |
| `甘肃奶蛙大学.com` | `gansunaiwadaxue-com`   | `甘肃奶蛙大学` | `前往红柳易办` | `https://home.lut.edu.cn/` |

1. 在每个 Worker 的「Settings → Build」中连接仓库，生产分支设为 `master`，构建命令设为 `pnpm run build`。
2. 在同一页的「Build variables and secrets」中设置上表的构建变量。奶龙站可全部省略；奶蛙站至少设置这三个字段。贴纸文案可另外设置 `STICKER_TXT=奶蛙出没`；自定义校徽和浏览器图标时分别添加 `LOGO_URL`、`FAVICON_URL`。Umami 及群链接需要不同配置时，再分别添加相应变量。
3. 设置部署命令。奶龙站使用 `pnpm exec wrangler deploy --name gansunailongdaxue-com`；奶蛙站使用 `pnpm exec wrangler deploy --name gansunaiwadaxue-com`。若自定 Worker 名称，将 `--name` 替换为控制台中的实际名称，覆盖仓库中默认的 Worker 名称。
4. 如需显示访问统计，在每个 Worker 的「Settings → Variables and Secrets」中添加类型为 Secret、名称为 `UMAMI_SHARE_URL` 的配置。它应属于该站点的 Umami 网站；更换采集 ID 或统计服务时同步更换分享链接。
5. 构建并部署后，进入各自的「Domains（域名）」标签页，添加对应域名。域名需位于当前 Cloudflare 账号管理且已激活的 DNS 区域中；Cloudflare 会自动创建 DNS 记录和证书。

本地构建奶蛙站时，在 `.env` 中填写：

```env
SITE_NAME=甘肃奶蛙大学
STICKER_TXT=奶蛙出没
GO_BTN_TXT=前往红柳易办
GO_BTN_TGT=https://home.lut.edu.cn/
```

然后运行 `pnpm run dev` 预览，或运行 `pnpm exec wrangler deploy --name gansunaiwadaxue-com` 部署。`pnpm run deploy` 默认部署奶龙 Worker；本地发布前应确认 `.env` 与目标 Worker 对应。给第二个 Worker 设置 Secret 时也需要指定名称：`pnpm exec wrangler secret put UMAMI_SHARE_URL --name gansunaiwadaxue-com`。

## 文件与配置

- `public/index.html`：页面模板、页脚链接及 Umami 脚本。
- `public/styles.css`：页面样式、深色模式和响应式布局。
- `public/motion.js`：指针牵引及进入方向对应的按钮、校徽动效。
- `public/audio.js`：页面载入后后台缓存音频，点击校徽随机播放，音量为 36%，不显示控件或提示。
- `public/traffic.js`：页脚统计加载与手动刷新。
- `public/notice.js`：底部 Cookies 与本地存储提示、已读版本记录。
- `public/footer.js`：按实际换行位置显示页脚链接及访问统计之间的分隔线。
- `public/terms/index.html`、`public/privacy/index.html`：用户协议和隐私政策静态模板。
- `public/legal.css`：政策页面的阅读排版。
- `public/logo.png`、`public/favicon.ico`：裁切后的透明校徽与站点图标。
- `src/index.js`：返回静态资源与 `/api/traffic` 统计接口。
- `src/traffic.js`：Umami 汇总查询、缓存与并发合并。
- `scripts/build.mjs`：读取构建环境变量，生成静态资源并注入提交版本。
- `scripts/build-images.mjs`：下载、校验可选图片，构建时替换默认资源。
- `scripts/site-config.mjs`：公开配置默认值、校验及 HTML 模板替换。
- `.env.example`：可选构建变量示例。
- `wrangler.jsonc`：Worker 名称及静态资源配置。
- `pnpm-lock.yaml`：锁定依赖版本。
- `pnpm-workspace.yaml`：允许 `esbuild` 和 `workerd` 执行安装脚本。

页面使用原生 HTML/CSS 和少量 JavaScript，构建脚本复制资源、替换配置，并按需下载自定义图片；唯一开发依赖是 Wrangler。默认图标从用户提供的原图裁切，保留圆圈内部图案，圈外透明。

页面采用流光背景与偏心轨道，入场约 2.4 秒，光点与星芒以 32～55 秒周期持续公转。系统开启“减少动态效果”时自动关闭动画。入场状态直接写入 HTML，从首次绘制开始显示动画，不等待交互脚本。页面隐藏时暂停循环动画。GO 按钮的位移、倾斜、流光及箭头动效跟随指针进入方向，校徽悬停也按进入方向移动与倾斜；键盘聚焦默认朝右上方。原生新窗口打开行为保持不变。入场及轨道动画由 CSS 执行，禁用 JavaScript 后所有链接仍可使用。

## 用户协议与隐私提示

首页页脚提供 `/terms/` 用户协议和 `/privacy/` 隐私政策入口。两页随构建配置替换站名、按钮和链接，沿用 MiSans 及系统深色模式。政策页不加载统计或音频脚本。

首页底部提示为告知性质，Umami 仍在页面载入时加载。点击「我知道了」会将当前提示版本写入 `localStorage` 的 `privacy-notice-version`，本浏览器、本站点后续访问不再显示。清除站点数据或修改 `public/index.html` 中提示的 `data-version` 后会重新显示；禁止本地存储时仍可关闭本次提示。

修改统计服务、外部资源或数据处理方式时，应同步核实和更新隐私政策、日期及提示版本。源码无法确定实际统计库与 Cloudflare 日志的保留期限，部署维护者需要按服务端实际配置管理这些数据。

## 页脚访问统计

Worker 直接代理 Umami 汇总查询，无需额外后端、数据库或付费绑定。在 Umami 中为此站点创建**网站分享链接**，最少勾选「流量 → 概览」。本地在不提交 Git 的 `.dev.vars` 中配置：

```env
UMAMI_SHARE_URL=https://umami.amoe.cc/share/分享码
```

生产环境在 Worker 的「Settings → Variables and Secrets」中配置同名 Secret。分享链接和运行时获取的 token 仅供 Worker 使用，不写入前端资源或 Git。代理根据 HTTPS 分享链接的域名及返回的网站 ID 查询数据，支持不同 Umami 实例及站点。`.dev.vars` 已被 Git 忽略，仅用于本地开发。加载中显示「访问统计加载中」，未配置或查询失败显示「访问统计加载失败，尝试刷新」，点击即可重试。成功后显示统计数字和刷新入口。

今日按 UTC+8 零点起算；总计为 Umami 全历史汇总；当前在线为最近五分钟的活跃访客。浏览器仅在载入和点击「刷新」时查询本站 `/api/traffic`，不自动轮询。Worker 合并并发请求，并使用内存及 Cloudflare Cache API 缓存汇总结果最多 30 秒、跨天失效；缓存按边缘数据中心复用，未命中时请求 Umami 四次。失败短暂退避 5 秒。载入或刷新期间隐藏数字，失败时显示重试入口。
