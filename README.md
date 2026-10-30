# 甘肃奶龙大学.com

一个轻量的 Cloudflare Workers 趣味导航站。使用原生 HTML/CSS 和少量 JavaScript，支持响应式布局、系统深色模式、入场与轨道动画、点击校徽随机播放音频，以及页脚访问统计。同一份源码通过构建变量生成不同站点，每个 Worker 部署一套静态页面。

## 本地开发

需要 Node.js 22 或更新版本，以及 `package.json` 指定的 pnpm 版本；CI 使用 Node.js 22。

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

打开 http://127.0.0.1:8787。Wrangler 自动构建页面，并在修改 `public/`、`scripts/` 或 `src/` 后重新构建。

需要自定义时，将 `.env.example` 复制为 `.env`，只保留要修改的字段。终端环境变量优先于 `.env`；修改后重启开发服务。`.env`、`.dev.vars` 和生成的 `dist/` 均不提交 Git。

## 站点配置

### 构建变量

以下变量仅在构建时读取，每项独立回退，未设置或留空时使用默认值。**放在 Worker 运行时变量或 `wrangler.jsonc` 的 `vars` 中不会替换静态页面。** 修改后需要重新构建、部署。

| 变量               | 用途                                         | 默认值                                 |
| ------------------ | -------------------------------------------- | -------------------------------------- |
| `SITE_NAME`        | 浏览器标题、页面标题、描述及校徽替代文字     | `甘肃奶龙大学`                         |
| `STICKER_TXT`      | 首页贴纸文本                                 | `奶龙出没`                             |
| `GO_BTN_TXT`       | 主按钮文本                                   | `GO`                                   |
| `GO_BTN_TGT`       | 主按钮跳转地址                               | `https://www.lut.edu.cn/`              |
| `GROUP_NAME`       | 加群文案中的名称，显示为「加入{名称}奶群」   | `兰理`                                 |
| `GROUP_LINK`       | 加群链接                                     | `https://qm.qq.com/q/AjLVv044nu`       |
| `UMAMI_SCRIPT_URL` | Umami 采集脚本地址                           | `https://umami.amoe.cc/script.js`      |
| `UMAMI_SITE_ID`    | Umami 采集网站 ID                            | `ee3cbb93-6ca4-4164-8a6c-4bb22b80675d` |
| `LOGO_URL`         | 校徽 PNG 的下载地址，同时用于 Apple 触屏图标 | 内置 `public/logo.png`                 |
| `FAVICON_URL`      | 浏览器图标下载地址，支持 PNG 或 ICO          | 内置 `public/favicon.ico`              |

文本进行 HTML 转义。URL 必须能解析为不含用户名、密码的 HTTP(S) 地址；页面链接和采集脚本地址规范化为绝对地址。文本、链接、采集脚本地址和网站 ID 都是公开页面内容，不能用于存放秘密。

`GROUP_NAME` 或 `GROUP_LINK` 任意一个设为 `-` 时，移除加群入口及协议中的对应名称，不留下分隔线；留空仍使用默认值。

页脚仓库地址、政策中的维护者和反馈渠道、字体及音频来源仍固定在 `public/` 源码中，不会随 `SITE_NAME` 改变。由其他维护者部署时，请一并核对这些内容和政策中的服务说明。

### 自定义图片

构建时下载 `LOGO_URL`、`FAVICON_URL`，保存到 `dist/` 并替换默认资源。首页和两份政策页都引用本站图片，HTML 不引用图片源地址。两个变量独立回退，单独更换校徽不会改变浏览器图标。校徽建议使用圈外透明的正方形 PNG，构建不裁切或转换图片。

每张图片不超过 5 MiB，下载限时 15 秒；PNG 不超过 4,194,304 像素，并限制解压数据大小。ICO 逐帧校验，支持 PNG 和未压缩 DIB（1/4/8/24/32 位），单帧宽高不超过 256，总像素不超过 4,194,304。地址无效、下载失败、图片损坏或超限会使构建失败，指出对应变量；下载和校验失败不会清空已有 `dist/`。

### 统计 Secret

`UMAMI_SHARE_URL` 是唯一的运行时配置，没有默认值，供 Worker 查询页脚汇总统计。未设置时，页面和 Umami 采集仍正常工作，页脚显示加载失败及重试入口。

在 Umami 中为该站点创建网站分享链接，开启「流量 → 概览」权限。本地将以下配置放进 `.dev.vars`：

```env
UMAMI_SHARE_URL=https://umami.amoe.cc/share/分享码
```

生产环境使用同名 Worker Secret。真实分享链接不能放进 `.env.example`、`wrangler.jsonc`、构建变量、前端资源或 Git。分享链接与查询 token 只供 Worker 使用，浏览器只请求本站 `/api/traffic`；采集脚本地址和网站 ID 本身仍是公开信息。

## 检查与部署

```sh
pnpm test
pnpm run check
```

`pnpm run check` 执行 Wrangler dry-run，自动构建页面并验证 Worker 打包，不上传或部署。

### 本地部署

确认 `.env` 对应目标站点后执行 `pnpm exec wrangler login`，再执行 `pnpm run deploy`。默认目标为 `gansunailongdaxue-com`。部署其他 Worker 时显式指定名称：

```sh
pnpm exec wrangler deploy --name gansunaiwadaxue-com
pnpm exec wrangler secret put UMAMI_SHARE_URL --name gansunaiwadaxue-com
```

### Cloudflare Git 自动部署

每个站点创建独立 Worker，连接同一仓库，分别设置变量和域名。示例：

| 域名               | Worker 名称示例         | `SITE_NAME`    | `GO_BTN_TXT`   | `GO_BTN_TGT`               |
| ------------------ | ----------------------- | -------------- | -------------- | -------------------------- |
| `甘肃奶龙大学.com` | `gansunailongdaxue-com` | `甘肃奶龙大学` | `GO`           | `https://www.lut.edu.cn/`  |
| `甘肃奶蛙大学.com` | `gansunaiwadaxue-com`   | `甘肃奶蛙大学` | `前往红柳易办` | `https://home.lut.edu.cn/` |

1. 在 Worker 的「Settings → Build」中连接仓库，生产分支设为 `master`，项目根目录使用仓库根目录。**构建命令留空**：部署时 Wrangler 会按 `wrangler.jsonc` 的 `build.command` 执行 `pnpm run build`，无需在两个阶段重复构建和下载图片。
2. 在「Build variables and secrets」中设置构建变量。奶龙站可省略；奶蛙站设置上表的三个变量，可另设 `STICKER_TXT=奶蛙出没`。其余变量按需添加。
3. 部署命令使用 `pnpm exec wrangler deploy --name <实际 Worker 名称>`，例如 `pnpm exec wrangler deploy --name gansunaiwadaxue-com`。Worker 名称与域名只决定部署目标，不会自动修改页面内容。
4. 如需页脚统计，在「Settings → Variables and Secrets」中添加类型为 Secret 的 `UMAMI_SHARE_URL`。更换采集 ID 或统计服务时，确保分享链接对应同一 Umami 网站。
5. 部署后，在独立的「Domains（域名）」标签页添加自定义域名。域名所在 DNS 区域需在当前 Cloudflare 账号中且已激活。

本地预览奶蛙站时，`.env` 可填写：

```env
SITE_NAME=甘肃奶蛙大学
STICKER_TXT=奶蛙出没
GO_BTN_TXT=前往红柳易办
GO_BTN_TGT=https://home.lut.edu.cn/
```

### 版本与配置排查

构建把当前提交前 7 位 hash 写入页脚。优先使用 `WORKERS_CI_COMMIT_SHA`，否则执行 `git rev-parse HEAD`。需要 Git 检出目录，或由构建平台提供 40 位完整提交 SHA；无效时明确报错。

如果页面仍显示默认内容，先核对部署版本、变量名称和配置位置：构建变量与运行时变量互不替代，修改后必须重新部署。`WORKERS_CI_COMMIT_SHA` 通常由 Cloudflare 自动提供，不要手动填写短 hash 或分支名。

## 页面行为

入场与循环动画由 CSS 执行，系统启用“减少动态效果”时关闭动画，页面隐藏时暂停循环动画。鼠标进入方向影响按钮和校徽的位移、倾斜；键盘聚焦使用右上方向。主按钮保持新窗口打开，不增加跳转遮罩。禁用 JavaScript 后，导航链接仍可使用，统计和音频交互不可用。

首页载入完成后，在空闲时段后台读取音频索引并预加载片段；点击校徽随机播放已准备好的片段，音量为 36%。索引固定为 `https://cdn.amoe.cc/web-static/private/tomyjan-website/nailong/audio/index.json`，加载失败时不显示提示。页脚分隔线和统计分隔点按实际换行位置显示，行首和行尾不会出现孤立分隔符。

## 页脚访问统计

Worker 代理 Umami 汇总查询，无需额外服务器或数据库。今日从 UTC+8 零点起算，总计查询全部历史，当前在线采用 Umami 活跃访客接口的结果。浏览器仅在首页载入或点击刷新时查询，不自动轮询。

内存与 Cloudflare Cache API 缓存按分享配置隔离，快照最多保留 30 秒、跨日失效，边缘缓存按数据中心复用。两级缓存均未命中时，一次汇总最多查询 Umami 四次；同一实例内的并发查询合并，失败退避最多 5 秒。浏览器响应不缓存，手动刷新可能命中仍有效的服务端缓存。载入或失败时隐藏旧数字，显示加载或重试入口，成功后显示数字和刷新入口。

## 用户协议与隐私提示

页脚提供 `/terms/` 用户协议和 `/privacy/` 隐私政策。两页随构建替换站名、按钮和链接，使用本站图片、MiSans 字体及系统深色模式，不加载统计或音频脚本。

底部 Cookies 与本地存储提示仅用于告知，不作为统计授权开关。点击「我知道了」在当前域名的 `localStorage` 中记录提示版本，后续访问不再显示。清除站点数据或更新 `public/index.html` 中的 `data-version` 后会再次提醒；存储被禁用时仍能关闭本次提示。

更改数据处理方式或外部服务时，同步更新隐私政策、生效日期及提示版本。统计库与 Cloudflare 日志的保留期限由部署维护者按实际服务配置管理。

## 项目结构与自动检查

- `public/`：页面模板、样式、交互脚本和默认图片。
- `scripts/`：读取构建变量、校验图片并生成 `dist/`。
- `src/`：静态资源转发与 `/api/traffic` 统计代理。
- `tests/`：构建、图片校验、前端交互和统计代理测试。
- `wrangler.jsonc`：Worker 名称、构建命令、静态资源绑定及可观察性配置。
- `.github/`：`Check Code` 在 `master` 推送、目标为 `master` 的 PR 和手动触发时，使用 Node.js 22、项目指定的 pnpm 版本执行冻结安装、测试和打包预检；Dependabot 每周检查 npm 依赖与 GitHub Actions 更新。

开发依赖为 Wrangler 及图片校验使用的 `pngjs`、`decode-ico`，版本由 `package.json` 和 `pnpm-lock.yaml` 锁定，图片解码器不进入 Worker 包。源代码采用 [MPL-2.0](LICENSE) 许可证；图片、字体和音频等素材的权利归各自权利人所有。
