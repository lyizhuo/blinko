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

## HEIF / HEIC 预览实现说明

- 解码器：服务端 `server/lib/heif.ts` 使用 [`libheif-js`](https://www.npmjs.com/package/libheif-js)（libheif 的 WASM 构建，LGPL-3.0）解码 HEVC，再交给 `sharp` 输出 JPEG。`sharp` 自带的预编译 libvips 只有 AVIF 解码能力，直接喂 `.heic` 会报 `Input buffer contains unsupported image format`。
- 懒转换 + 磁盘缓存：首次访问时解码，结果写入 `.blinko/cache/heif/<sha256>.jpg`；缓存键为「绝对路径 + 大小 + mtime」，文件被替换自动失效。最多保留 512 个文件，超出按 mtime 淘汰；`rm -rf .blinko/cache/heif` 可整体清理。
- `?thumbnail=true` 复用同一份预览再缩到 500px，单个文件最多只解码一次；`?download=true` 仍然返回原始 HEIC 字节，不修改用户文件。
- 覆盖范围：附件网格、灯箱大图、Markdown 内嵌图片（`<img src="/api/file/xxx.heic">` 直接拿到 JPEG）、资源管理器、S3 对象存储、AI 识图（`AiModelFactory.readImage`）。
- 性能：单张 12MP 照片首次解码约 0.5–2s（视图片内容），32MP 约 6s；解码在单进程内串行排队，内存上限按 40MP 图片设置。一屏十几张 HEIC 时会依次出现加载动画，命中缓存后无感。
- 依赖与构建：`libheif-js@^1.23.5` 写入 `server/package.json`；esbuild 将其列为 external（`server/esbuild.config.ts`）；Docker 运行时层已补装该包（`dockerfile`）。使用 WASM 构建（`libheif-js/wasm-bundle`），比纯 JS 构建快约 5 倍。

## 数据修复记录

- 2026-10-22：线上 `sortOrder` 被拖拽污染（87 条 active + 1 条回收站，值 1..29 重复三批）。已通过 `POST /api/v1/note/update-order` 全部重置为 `0`，时间线恢复。该操作不是代码补丁。
- 注意：Prisma `updateMany` 会刷新 `updatedAt`；本次重置后这 88 条的 `updatedAt` 变为 `2026-10-22T13:02:46Z`。当前按 `createdAt` 排序，无影响。

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
cd server && bun test __tests__/unit
```

5. 部署后复核：时间线首屏、拖拽/时间排序、时间范围筛选。
