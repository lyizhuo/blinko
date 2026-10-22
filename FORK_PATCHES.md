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
