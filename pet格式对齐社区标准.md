# Pet 格式对齐 Codex 社区标准

## 背景

我们的 pet.json 格式要求 `sprite`（尺寸/网格）和 `animations`（行映射/帧率）必须写在文件中，社区标准（Codex / Open Design）则把 `1536×1872` / `8×9` / 动画行映射全硬编码在代码里，pet.json 只存元数据。需要改造我们的代码，让社区格式的 pet.json 拖进来就能直接用。

## 核心策略

- 社区 pet.json 缺少 `sprite` / `animations` 时，自动填充默认值
- 已有的完整格式 pet.json 行为不变（无回归）
- 默认常量放在 `types.ts`（纯类型/常量文件，不带 fs/path 等 Node 依赖，浏览器端也能安全导入）

## 默认常量

```typescript
DEFAULT_SPRITE = { url: 'spritesheet.webp', width: 192, height: 208, columns: 8, rows: 9 }
DEFAULT_ANIMATIONS = {
  idle:         { row: 0, frames: 8, fps: 4 },
  waving:       { row: 1, frames: 8, fps: 6 },
  review:       { row: 2, frames: 8, fps: 6 },
  runningRight: { row: 3, frames: 8, fps: 8 },
  jumping:      { row: 4, frames: 8, fps: 8 },
  grab:         { row: 5, frames: 8, fps: 6 },
  failed:       { row: 6, frames: 8, fps: 6 },
  grabbing:     { row: 7, frames: 8, fps: 6 },
  runningLeft:  { row: 8, frames: 8, fps: 8 },
}
```

## 改动清单（7 个源文件）

### 1. `src/shared/pet/types.ts`
- `PetManifest` 增加 `id?: string`
- `sprite` 改为可选 `sprite?: PetSprite`
- `animations` 改为可选 `animations?: Record<string, PetAnimation>`
- 导出 `DEFAULT_SPRITE`、`DEFAULT_ANIMATIONS` 常量

### 2. `src/shared/pet/PetLoader.ts`
- `validateManifest()`: 不再对 `sprite`/`animations` 强制校验，接受 `id` 作为 `name` 的 fallback
- `loadPet()`: sprite/animations 缺失时用默认值填充，`spritesheetPath`（社区字段）作为 `sprite.url` 备选
- `listInstalledPets()`: name 解析改用 `displayName || id || name`

### 3. `src/shared/pet/SpriteRenderer.ts`
- 导入 `DEFAULT_SPRITE`
- 所有 `this.manifest.sprite.*` 改为通过 helper `getSprite()` 获取（带默认回退）
- 所有 `this.manifest.animations[...]` 改为通过 helper `getAnimations()` 获取

### 4. `electron/pet-renderer.js`
- 内联 `DEFAULT_SPRITE` / `DEFAULT_ANIMATIONS` 常量（vanilla JS 无法 import TS）
- `loadPet()`: manifest 缺失 sprite/animations 时自动填充默认值
- spritesheet 路径：`sprite.url || spritesheetPath || 'spritesheet.webp'`
- 所有 sprite 读取改为通过 `getSprite()` helper
- 所有 animations 读取改为通过 `getAnimations()` helper

### 5. `electron/main.mjs`
- `pet:list-installed`: `name` 解析改用 `displayName || id || name`
- `pet:import-local`: `petName` 解析改用 `id || name || path.basename()`

### 6. `electron/main.cjs`
- 同上，与 main.mjs 保持一致

### 7. `server/src/routes/pets.ts`
- `name` 解析改用 `displayName || id || name`

## 实施顺序

1. types.ts → 2. PetLoader.ts → 3. SpriteRenderer.ts → 4. pet-renderer.js → 5. main.mjs → 6. main.cjs → 7. pets.ts

## 验证

1. 复制 Open Design 9 个宠物到 `~/.aichat/pets/`
2. `npx tsc --noEmit` 类型检查通过
3. 浏览器打开 `<http://localhost:4000>`，设置页 → 桌宠设置 → 能看到 9 个宠物
4. 激活任一宠物，确认动画渲染正常
5. 确认已有完整格式 pet.json 不受影响
