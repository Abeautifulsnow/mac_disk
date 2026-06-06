# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

(To be filled by the team)

## Scenario: Tauri Scan Event Contract

### 1. Scope / Trigger

- Trigger: Any change to Rust `ScanEvent`, Rust `FileInfo`, or frontend `ScanEvent` / `FileInfo` TypeScript definitions.
- This is a cross-layer contract: Rust serializes events with serde, Tauri emits them, and React consumes them through `listen<ScanEvent>("scan-event", ...)`.

### 2. Signatures

- Backend event enum: `src-tauri/src/commands.rs::ScanEvent`
- Frontend event union: `src/types.ts::ScanEvent`
- File payload model: `src-tauri/src/commands.rs::FileInfo` ↔ `src/types.ts::FileInfo`

### 3. Contracts

- `FileInfo.path`: string absolute path.
- `FileInfo.sizeLogical`: number of logical bytes, serialized from Rust `size_logical`.
- `FileInfo.sizeDisk`: number of disk-usage bytes, serialized from Rust `size_disk`.
- `ScanEvent.completed.filesFound`: matched file count before display truncation.
- `ScanEvent.completed.directoriesFound`: matched directory count before display truncation.
- `ScanEvent.completed.resultCount`: number of `results` items returned to the frontend for display.
- `ScanEvent.completed.totalSizeLogical`: total logical bytes scanned for the root.
- `ScanEvent.completed.totalSizeDisk`: total disk-usage bytes scanned for the root.

### 4. Validation & Error Matrix

- Rust field rename missing -> frontend receives a differently named field -> TypeScript contract is stale and UI totals become `undefined` or fallback-derived.
- Frontend type missing a backend field -> TypeScript cannot guard UI usage and future code may infer wrong semantics.
- UI treats `filesFound + directoriesFound` as displayed count -> misleading when backend applies `limit` or adds ancestor directories.

### 5. Good/Base/Bad Cases

- Good: Header shows total scanned bytes from `totalSizeLogical` / `totalSizeDisk`, and separately shows `resultCount` displayed items.
- Base: If older payloads omit totals, UI may fall back to deriving totals from `results`, but new code should prefer explicit backend fields.
- Bad: Naming the same disk-size value `diskUsage` in docs while code uses `sizeDisk`.

### 6. Tests Required

- Rust scanner tests should assert size aggregation, min-size filtering, and ancestor inclusion.
- Frontend typecheck (`pnpm build`) must pass after any event contract change.
- Rust tests (`cargo test`) must pass after backend event/model changes.

### 7. Wrong vs Correct

#### Wrong

```typescript
const displayed = payload.filesFound + payload.directoriesFound;
const disk = file.diskUsage;
```

#### Correct

```typescript
const displayed = payload.resultCount;
const disk = file.sizeDisk;
```

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

(To be filled by the team)

---

## Validation

<!-- Runtime validation patterns (Zod, Yup, io-ts, etc.) -->

(To be filled by the team)

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

(To be filled by the team)

---

## Forbidden Patterns

<!-- any, type assertions, etc. -->

(To be filled by the team)
