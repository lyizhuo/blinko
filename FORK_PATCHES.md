# Fork Patches

本文件记录本 fork 相对 `blinkospace/blinko` 的**代码补丁**，用于上游修复后快速识别、丢弃或 rebase。

原则：

- 每个补丁一个独立 commit，尽量只改必要文件。
- 优先采用上游已有 PR 的实现，不自行设计同类逻辑。
- 补丁消失条件明确后，直接删除对应 commit，不做兼容层。
- 数据修复（SQL/API）不写入代码，只记录在这里。

## 当前补丁

| # | 本地 commit | 上游引用 | 文件 | 原因 | 何时删除 |
|---|---|---|---|---|---|
| 1 | `fix(notes): adopt upstream #1240 timestamp-first ordering` | [PR #1240](https://github.com/blinkospace/blinko/pull/1240)（OPEN, MERGEABLE） | `server/routerTrpc/note.ts`、`app/src/hooks/useDragCard.tsx` | 时间优先排序，`sortOrder` 仅作 tie-breaker；前端保留 API 顺序。修复 [#1000](https://github.com/blinkospace/blinko/issues/1000) 的笔记被挤出时间线问题 | 上游合并 #1240 后删除本地 commit |
| 2 | `fix(notes): disable drag while sorting by create time` | [#1107](https://github.com/blinkospace/blinko/issues/1107)（OPEN） | `app/src/hooks/useDragCard.tsx` | 开启“按创建时间排序”时禁用拖拽，防止手机长按误触继续写入 `sortOrder` 并刷新整页 `updatedAt` | 上游提供正式拖拽开关后删除；仅一行条件 |
| 3 | `fix(notes): refresh current list after date filter` | 暂无上游 PR | `app/src/components/Common/PopoverFloat/filterPop.tsx` | 筛选后刷新当前 path 的列表（原先固定刷新 `noteList`），并用本地日边界修正 UTC 零点截断 | 上游修复筛选后删除本地 commit |
| 4 | `feat(media): preview HEIF/HEIC images` | [PR #1221](https://github.com/blinkospace/blinko/pull/1221)（OPEN，实现方式不同）、[#674](https://github.com/blinkospace/blinko/issues/674)（OPEN） | `server/lib/heif.ts`（新增）、`server/routerExpress/file/file.ts`、`server/routerExpress/file/s3file.ts`、`server/aiServer/aiModelFactory.ts`、`server/esbuild.config.ts`、`dockerfile`、`app/src/lib/helper.ts`、`app/src/components/BlinkoResource/ResourceItem.tsx`、`app/src/components/Common/UploadFile/index.tsx` | 上游无法预览 HEIF/HEIC：`sharp` 的预编译 libvips 只带 AVIF 解码器，浏览器也不支持 HEVC。本 fork 在**服务端**把 HEIC 懒转换为 JPEG 并缓存，原始文件保留、历史附件同样生效；#1221 则在上传时用浏览器转码并只上传 JPEG，会丢失原始 HEIC 且无法修复已上传的附件 | 上游合并正式方案后评估迁移 |
| 5 | `fix(app): make the mobile shell edge-to-edge and visually stable`、`fix(android): keep the editor above the software keyboard` | 暂无上游 PR（上游移动端仍是 `100vh` + 固定定位） | `app/src/components/Common/PhotoViewer/`（新增）、`app/src/lib/hooks.ts`、`app/src/components/Layout/*`、`app/src/store/module/Dialog*/Provider.tsx`、`app/src/components/Common/ScrollArea/index.tsx`、`app/index.html`、`app/src/styles/globals.css`、各全屏页面与 `MainActivity.kt` | `enableEdgeToEdge()` 让整个窗口绘制到状态栏/手势条之后，而原来的 `100vh` + `fixed` 布局会把灯箱、对话框、相机控件顶到系统栏下面；底部导航在滚动时反复重锚导致来回闪动，对话框关闭方向与打开方向相反 | 上游提供统一的移动端安全区适配后删除 |

## HEIF / HEIC 预览实现说明

- 解码器：服务端 `server/lib/heif.ts` 使用 [`libheif-js`](https://www.npmjs.com/package/libheif-js)（libheif 的 WASM 构建，LGPL-3.0）解码 HEVC，再交给 `sharp` 输出 JPEG。`sharp` 自带的预编译 libvips 只有 AVIF 解码能力，直接喂 `.heic` 会报 `Input buffer contains unsupported image format`。
- 懒转换 + 磁盘缓存：首次访问时解码，结果写入 `.blinko/cache/heif/<sha256>.jpg`；缓存键为「绝对路径 + 大小 + mtime」，文件被替换自动失效。最多保留 512 个文件，超出按 mtime 淘汰；`rm -rf .blinko/cache/heif` 可整体清理。
- `?thumbnail=true` 复用同一份预览再缩到 500px，单个文件最多只解码一次；`?download=true` 仍然返回原始 HEIC 字节，不修改用户文件。
- 覆盖范围：附件网格、灯箱大图、Markdown 内嵌图片（`<img src="/api/file/xxx.heic">` 直接拿到 JPEG）、资源管理器、S3 对象存储、AI 识图（`AiModelFactory.readImage`）。
- 性能：单张 12MP 照片首次解码约 0.5–2s（视图片内容），32MP 约 6s；解码在单进程内串行排队，内存上限按 40MP 图片设置。一屏十几张 HEIC 时会依次出现加载动画，命中缓存后无感。
- 依赖与构建：`libheif-js@^1.23.5` 写入 `server/package.json`；esbuild 将其列为 external（`server/esbuild.config.ts`）；Docker 运行时层已补装该包（`dockerfile`）。使用 WASM 构建（`libheif-js/wasm-bundle`），比纯 JS 构建快约 5 倍。

## 移动端 edge-to-edge 适配说明

- 平台基线：Android 15（API 35）起 `targetSdk >= 35` 会**强制** edge-to-edge；本项目仍是 `targetSdk 34`，由 `MainActivity` 主动调用 `enableEdgeToEdge()`。升 35 会连带前台服务类型、预测性返回等行为变更，需单独回归，本次未动。
- Insets 来源：自定义插件命令 `get_safe_area_insets`（`WindowInsetsCompat.Type.systemBars()`）回传，前端 `app/src/lib/safeArea.ts` 写入 `--safe-area-inset-*`；CSS 中统一用 `env(safe-area-inset-*)` 兜底，WebView 直接支持时无需桥接。
- 视口：`meta viewport` 已含 `viewport-fit=cover` 与 `interactive-widget=resizes-content`；全屏容器改用 `100dvh`，并使用 `--doc-height`（`window.innerHeight`）作为 JS 侧高度来源，避免 `100vh` 在浏览器工具栏收起时跳动。
- 键盘：`enableEdgeToEdge()` 之后 `adjustResize` 不再收缩视图，因此在 `android.R.id.content` 上按 IME insets 预留底部高度并 `CONSUMED`，防止 WebView 再次收缩造成双重顶起。
- 灯箱：`react-photo-view` 的 `toolbarRender` 只在 `bannerVisible` 为真时渲染（源码里 banner 内部才调用自定义工具栏），所以保留 banner、用 CSS 去掉它的背景/高度/默认按钮，再把安全区工具栏放进去。
- 动画：底部导航只保留一个 tween；滚动显隐改为单次垂直手势 + 150ms 冷却 + 忽略横向/弹层手势；对话框手机端向下退出；卡片展开去掉 FLIP 布局动画。
- 验证方式：Playwright 390×844、`deviceScaleFactor=3`、注入 `--safe-area-inset-top: 47px / bottom: 34px`，断言灯箱 portal 高度等于视口、关闭按钮 `y >= 47`、命中区域 44×44、计数器随滑动切换、控制台无错误。

## 数据修复记录

- 2026-10-22：线上 `sortOrder` 被拖拽污染（87 条 active + 1 条回收站，值 1..29 重复三批）。已通过 `POST /api/v1/note/update-order` 全部重置为 `0`，时间线恢复。该操作不是代码补丁。
- 注意：Prisma `updateMany` 会刷新 `updatedAt`；本次重置后这 88 条的 `updatedAt` 变为 `2026-10-22T13:02:46Z`。当前按 `createdAt` 排序，无影响。

## 合并记录

- 2026-11-05：`00944a7e` 合并 `upstream/main@a1c71e67`（1.8.9 安全修复版）。
  - 保留 fork 的 CI/部署面：上游 `app-release.yml`、`build-publish-release.yml`、`translator.yml` 继续删除；`fork-arm-build.yml`、`fork-android-build.yml`、`dockerfile`、`docker-compose.prod.yml`、`deploy/` 不动；上游新增的 `security-checks.yml` 原样保留（只在 PR/手动触发）。
  - 上游未解决、因而保留的补丁：#1（#1240 仍 OPEN）、#2、#3、#4（#1221 仍 OPEN）、#5。
  - #4 需按上游新权限模型重放：`file.ts`/`s3file.ts` 的 HEIF 分支位于 `canReadFile`/`validAttachmentShareToken` 校验之后，响应头继承 `uploadedFileHeaders`（`private, no-store`、sandbox CSP、nosniff），`?download=true` 仍返回原始 HEIC。
  - S3 侧跟随上游去掉二次 `decodeURIComponent`：`GetObjectCommand` 使用 `fullPath`（已在上方解码一次），HEIF 缓存键同步改为 `s3|<bucket>|<fullPath>`。
  - 上游 `server/__tests__/security/http-files.test.ts` 的 `pathConstant` mock 补 `ROOT_PATH`，否则 `heif.ts` 在该 mock 下加载失败。
  - `bun test` 单进程跑全部文件时，上游安全测试的 `mock.module` 会泄漏到后续用例（provider/HEIF 用例出现 “Export named ... not found”）。上游自带的 `test:security` 按文件拆进程规避；本地全量验证用 `bun test --isolate`。

## 合并上游时的检查清单

```bash
git fetch upstream
git log --oneline upstream/main..HEAD
```

1. 对照上表检查上游引用是否已合并。
2. 已合并的补丁直接删除对应 commit；`git rebase upstream/main` 时用 `drop`。
3. 若上游实现与本地不同，优先采用上游版本，再重放仍未合并的补丁。
4. 验证：

```bash
bun run build:web
cd app && bun run build:web          # turbo 可能命中缓存，改目录内直跑
cd server && bun test --isolate      # 必须 --isolate：安全测试的 mock.module 会跨文件泄漏
cd server && bun run test:security
```

5. 部署后复核：时间线首屏、拖拽/时间排序、时间范围筛选。
