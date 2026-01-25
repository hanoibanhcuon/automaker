# OPTIMIZATION_PLAN (Electron first, Web second)

Ngay tao: 2026-01-25
Trang thai: Plan chi tiet theo file (chua trien khai)

## 0) Muc tieu

- Giu nguyen hanh vi/tinh nang hien tai, khong thay doi UX.
- Tang toc do khoi dong, giam do tre realtime, giam CPU/RAM.
- Uu tien Electron truoc, sau do toi uu Web.

## 1) Nguyen tac an toan

- Thay doi theo dot nho, co do luong truoc/sau.
- Co feature flag hoac fallback neu co rui ro.
- Mieng dong (no regression): chay test smoke + e2e toi thieu.

## 2) Baseline va chi so (bat buoc truoc khi code)

- Electron startup time (tu launch -> UI ready)
- Thoi gian mo project (tu click -> board ready)
- Thoi gian load board (so card 1k/5k)
- Do tre streaming (p95 event latency)
- CPU/RAM server khi idle va khi load
- Bundle size va time-to-interactive

Output: bao cao baseline + muc tieu cai thien (vd: -30% startup, -40% load board)

## 3) Quy mo du lieu muc tieu

- Feature cards: 2,000 - 5,000 / project (scroll muot)
- Event history: 50,000 - 200,000 / project (list + pagination)
- Agent sessions: 10,000+ (metadata load nhanh)
- Assets: 1 - 5GB / project (lazy load)

## 4) P1 - Electron (uu tien)

### 4.1 Backend I/O + Cache (apps/server)

- [x] apps/server/src/services/feature-loader.ts
  - Cache getAll() theo project (in-memory + TTL)
  - Invalidate khi create/update/delete feature
  - Index nhe title/id de findByTitle/duplicate nhanh
- [x] apps/server/src/services/event-history-service.ts
  - Cache index, giam sort lai
  - Pagination truoc khi sort (neu co the)
  - Gioi han MAX_EVENTS_IN_INDEX co the config
- [x] apps/server/src/index.ts
  - [x] Giam log noise (request logging off by default in production)
  - [x] Them co che throttle for event emit (neu can)

### 4.2 Realtime streaming + Backpressure

- [x] apps/server/src/lib/events.ts
  - Them buffer/queue per client
  - Throttle/coalesce event trung lap
- [x] apps/server/src/index.ts
  - Queue per WebSocket client + limit buffered bytes
- [x] apps/server/src/services/event-hook-service.ts
  - Khong block main flow khi hook cham
  - Batch write event history

### 4.3 Electron main process

- [x] apps/ui/src/main.ts
  - [x] Lazy init cac module it dung
  - [x] Cac buoc kiem tra server readiness toi uu (backoff + timeout)
  - [x] Giam sync IO trong startup

### 4.4 UI render & state

- [x] apps/ui/src/routes/\_\_root.tsx
  - [x] Tach state selectors (shallow) de giam re-render
  - [x] Chia layout thanh subcomponents
- [x] apps/ui/src/routes/terminal.tsx
  - [x] Virtualization cho output/log
  - [x] Debounce update tu websocket
- [x] apps/ui/src/routes/board.tsx / components board
  - Virtualization list card
  - Memoize card component
- [x] apps/ui/src/routes/graph.tsx
  - Memoize layout, tinh toan o worker neu can

### 4.5 Assets & bundle (Electron)

- [x] apps/ui/src/main.ts + apps/ui/src/app.tsx
  - [x] Lazy load fonts
  - [x] Lazy load themes
  - [x] Code split cho view it dung (graph/ideation/settings)

### 4.6 Electron test gate

- [ ] Smoke: launch, open project, board, agent run
- [ ] E2E: board -> in progress -> waiting approval
- [ ] Performance check: startup/load board

## 5) P2 - Web (sau Electron)

### 5.1 Web runtime + bundle

- [x] apps/ui/vite.config.mts
  - [x] Split chunk theo route
  - [x] Remove unused deps
- [x] apps/ui/src/routes/\_\_root.tsx
  - Lazy route + suspense

### 5.2 API + payload

- [x] apps/server/src/routes/\*
  - [x] Pagination/fields select (features list)
  - [x] Reduce payload for list endpoints (features list)
- [x] apps/ui/nginx.conf
  - Enable gzip (reverse proxy)

### 5.3 Web streaming

- [x] apps/server/src/lib/events.ts
  - [x] Coalesce + throttle
  - [x] Limit payload size

### 5.4 Web test gate

- [ ] Load test 1k/5k cards
- [ ] Thoi gian load board + TTI
- [ ] Regression: setup/auth/terminal

## 6) Do luong truoc/sau (theo dot)

- Dot A: Baseline + cache + render
- Dot B: streaming + virtualization
- Dot C: web chunking + payload

## 7) Rollback

- Moi thay doi co flag hoac co option disable.
- Neu latency/bug tang -> revert dot gan nhat.

## 8) Deliverables

- Bao cao baseline + so sanh sau moi dot
- Danh sach thay doi theo file
- Test report
