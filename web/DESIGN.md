# Step 18 Chat-first shell

Quiet reading surface. The engine stays behind the chat.

## Layout (desktop 1440)

```
┌─────────────────────────────────────────────────────────┐
│  临河客栈 · 旅人                         状态    世界   │  48px
├─────────────────────────────────────────────────────────┤
│                                                         │
│   你                                                    │
│   同学，今天天气还行。                                    │
│                                                         │
│   世界                                                  │
│   同学看了你一眼……（长文，舒适行高）                      │
│                                                         │
│                                                         │  flex
│                                                         │
├─────────────────────────────────────────────────────────┤
│  正在书写…                                              │  28px when busy
│  ┌─────────────────────────────────────┐  ┌────┐       │
│  │ 多行输入                             │  │发送│       │  ~120px
│  └─────────────────────────────────────┘  └────┘       │
└─────────────────────────────────────────────────────────┘
```

Header is the only chrome. No sidebar by default.
State is a narrow right drawer: 世界 / 时间 / 地点 / 携带.
World switch is a small settings sheet: 继续 / 新开. No store, no editor.

## Type and color

Warm dark paper, not a console.

- page `#12110f`
- panel `#1a1815`
- line `#2a2722`
- text `#ece8e1`
- mute `#9c958a`
- story text `#e8e0d4`
- accent only on send / current world name `#c4a574`

Story uses a serif stack. Chrome uses system sans.
Density is low: 12–16px gaps, 11px header labels, 18px/1.7 story.

No glass, no HUD bars, no neon, no game inventory grid.

## Interaction

- Enter sends. Shift+Enter newline.
- Send disables while a turn is in flight.
- Streaming appends to the latest world message.
- If the user scrolls up, do not yank back to bottom.
- Fail-closed is a world notice with the exact engine sentence. No JSON.
- One `turnId` per send. Retry of the same id must not replay Authority.

## Mobile (~390)

Header labels shorten. Drawer becomes a full-width sheet from the bottom.
Composer stays pinned. Story still dominates.

## Out of this shell

Role switch: not shown. The world has one player identity.
Quick suggestions: deferred. The composer stays a free text box.
