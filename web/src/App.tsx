import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  loadBootstrap,
  playTurn,
  saveProfile,
  startLife,
  switchWorld,
  type ChatMessage,
  type PlayerProfile,
  type PlayerState,
  type WorldChoice,
} from "./api";

/* ─── Types ──────────────────────────────────────────────────────────────── */

type Screen =
  | { kind: "world-select" }
  | { kind: "new-life-onboard"; world: WorldChoice }
  | { kind: "char-card"; world: WorldChoice; profile: PlayerProfile }
  | { kind: "chat" };

/* ─── App ─────────────────────────────────────────────────────────────────── */

export function App() {
  const [worlds, setWorlds] = useState<WorldChoice[]>([]);
  const [currentWorldId, setCurrentWorldId] = useState<string | null>(null);
  const [state, setState] = useState<PlayerState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [eraOpen, setEraOpen] = useState(false);
  const [worldsOpen, setWorldsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState<WorldChoice | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "world-select" });
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);

  const pin = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);

  /* Bootstrap */
  useEffect(() => {
    void loadBootstrap()
      .then((boot) => {
        setWorlds(boot.worlds);
        setCurrentWorldId(boot.currentWorldId);
        setState(boot.state);
        setPlayerProfile(boot.playerProfile);
        if (boot.messages.length > 0 && boot.currentWorldId) {
          setMessages(boot.messages);
          setScreen({ kind: "chat" });
        } else if (boot.currentWorldId) {
          // Has a world but no messages — show world select so player can enter properly
          setScreen({ kind: "world-select" });
        } else {
          setScreen({ kind: "world-select" });
        }
      })
      .catch(() => setError("打不开本地世界。"));
  }, []);

  /* Auto-scroll */
  useEffect(() => {
    const node = scroller.current;
    if (node && pin.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, busy]);

  function onScroll(): void {
    const node = scroller.current;
    if (!node) return;
    pin.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  /* ─── Send ─────────────────────────────────────────────────────────────── */

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || sending.current || busy) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setDraft("");
    const turnId = crypto.randomUUID();
    setMessages((rows) => [...rows, { role: "player", text, parsed: true }, { role: "world", text: "", parsed: true }]);
    pin.current = true;
    try {
      const result = await playTurn(text, turnId, (chunk) => {
        setMessages((rows) => {
          const next = [...rows];
          const last = next[next.length - 1];
          if (last && last.role === "world") {
            next[next.length - 1] = { ...last, text: last.text + chunk };
          }
          return next;
        });
      });
      setState(result.state);
      setMessages((rows) => {
        const next = [...rows];
        const last = next[next.length - 1];
        if (last && (last.role === "world" || last.role === "notice")) {
          next[next.length - 1] = {
            role: result.parsed ? "world" : "notice",
            text: result.text || last.text,
            parsed: result.parsed,
          };
        }
        return next;
      });
    } catch {
      setError("这一句没有送出，请再试一次。");
      setMessages((rows) => {
        const next = [...rows];
        const last = next[next.length - 1];
        if (last && last.role === "world" && last.text.length === 0) {
          next[next.length - 1] = { role: "notice", text: "这一句没有送出，请再试一次。", parsed: false };
        }
        return next;
      });
    } finally {
      sending.current = false;
      setBusy(false);
      setTimeout(() => composerRef.current?.focus(), 0);
    }
  }

  /* ─── World switching ───────────────────────────────────────────────────── */

  function onNewWorldClick(world: WorldChoice): void {
    setWorldsOpen(false);
    if (world.hasSave) {
      setConfirmReset(world);
    } else {
      void startNewLife(world);
    }
  }

  async function startNewLife(world: WorldChoice): Promise<void> {
    setConfirmReset(null);
    setWorldsOpen(false);
    setBusy(true);
    try {
      const result = await switchWorld(world.id, "new");
      setCurrentWorldId(result.currentWorldId);
      setState(result.state);
      setMessages([]);
      if (result.worlds) setWorlds(result.worlds);
      setPlayerProfile(result.playerProfile);
      setError(null);
      setScreen({ kind: "new-life-onboard", world });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法切换世界。";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function changeWorld(id: string, mode: "resume" | "new"): Promise<void> {
    setWorldsOpen(false);
    setConfirmReset(null);
    setBusy(true);
    try {
      const world = worlds.find((w) => w.id === id);
      const result = await switchWorld(id, mode);
      setCurrentWorldId(result.currentWorldId);
      setState(result.state);
      setMessages(result.messages);
      if (result.worlds) setWorlds(result.worlds);
      setPlayerProfile(result.playerProfile);
      setError(null);
      pin.current = true;
      if (mode === "new" && world) {
        setScreen({ kind: "new-life-onboard", world });
      } else {
        setScreen({ kind: "chat" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法切换世界。";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  /* ─── New Life Onboarding ───────────────────────────────────────────────── */

  async function onProfileReady(world: WorldChoice, profile: PlayerProfile): Promise<void> {
    setBusy(true);
    try {
      await saveProfile(profile);
      setPlayerProfile(profile);
      setScreen({ kind: "char-card", world, profile });
    } catch {
      setError("保存人物信息失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function onEnterWorld(profile: PlayerProfile): Promise<void> {
    setBusy(true);
    setScreen({ kind: "chat" });
    setMessages([{ role: "world", text: "", parsed: true }]);
    pin.current = true;
    try {
      const result = await startLife(profile, (chunk) => {
        setMessages((rows) => {
          const next = [...rows];
          const last = next[next.length - 1];
          if (last && last.role === "world") {
            next[next.length - 1] = { ...last, text: last.text + chunk };
          }
          return next;
        });
      });
      setState(result.state);
      setMessages((rows) => {
        const next = [...rows];
        const last = next[next.length - 1];
        if (last) {
          next[next.length - 1] = {
            role: result.parsed ? "world" : "notice",
            text: result.text || last.text,
            parsed: result.parsed,
          };
        }
        return next;
      });
    } catch {
      setMessages([{ role: "notice", text: "世界还没有准备好，请稍后重试。", parsed: false }]);
    } finally {
      setBusy(false);
      setTimeout(() => composerRef.current?.focus(), 100);
    }
  }

  /* ─── Renders ───────────────────────────────────────────────────────────── */

  if (screen.kind === "world-select") {
    return (
      <WorldSelectScreen
        worlds={worlds}
        currentWorldId={currentWorldId}
        busy={busy}
        error={error}
        onResume={(id) => void changeWorld(id, "resume")}
        onNew={onNewWorldClick}
        confirmReset={confirmReset}
        onConfirmReset={(world) => void startNewLife(world)}
        onCancelReset={() => setConfirmReset(null)}
      />
    );
  }

  if (screen.kind === "new-life-onboard") {
    return (
      <OnboardScreen
        world={screen.world}
        busy={busy}
        onProfile={(profile) => void onProfileReady(screen.world, profile)}
        onBack={() => setScreen({ kind: "world-select" })}
      />
    );
  }

  if (screen.kind === "char-card") {
    return (
      <CharCardScreen
        profile={screen.profile}
        world={screen.world}
        busy={busy}
        onEnter={(p) => void onEnterWorld(p)}
        onBack={() => setScreen({ kind: "new-life-onboard", world: screen.world })}
      />
    );
  }

  /* Chat screen */
  return (
    <div className="shell">
      <header className="top">
        <div className="who">
          <span className="world-name">
            {state?.era ? `${state.era} · ${state.locationName || "普通城市"}` : (state?.worldTitle ?? "东方狂想")}
          </span>
          {playerProfile?.name && (
            <>
              <span className="dot">·</span>
              <span className="char-name">{playerProfile.name}</span>
            </>
          )}
          {state?.timeLabel && (
            <span className="time-badge">{state.timeLabel}</span>
          )}
        </div>
        <div className="actions">
          <button type="button" className="icon-btn" title="时期前情" onClick={() => setEraOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/>
            </svg>
          </button>
          <button type="button" className="icon-btn" title="当前状态" onClick={() => setDrawerOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" /><path d="M6 20v-1a6 6 0 0 1 12 0v1" />
            </svg>
          </button>
          <button type="button" className="icon-btn" title="世界" onClick={() => setWorldsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20A14.5 14.5 0 0 0 12 2" /><path d="M2 12h20" />
            </svg>
          </button>
        </div>
      </header>

      <div className="thread" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 && !busy && (
          <p className="empty">像平常聊天一样说话。世界会自己记着。</p>
        )}
        {messages.map((row, index) => (
          <article key={`${index}-${row.role}`} className={`msg ${row.role}`}>
            {row.role !== "player" && (
              <div className="msg-label">{row.role === "notice" ? "提示" : ""}</div>
            )}
            <div className="body">
              {row.role === "world" ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // Disable raw HTML
                    html: () => null,
                    a: ({ children }) => <span>{children}</span>,
                  }}
                >
                  {row.text || (busy && index === messages.length - 1 ? "▍" : "")}
                </ReactMarkdown>
              ) : (
                <span>{row.text}</span>
              )}
            </div>
          </article>
        ))}
      </div>

      <footer className="composer">
        {state?.currentSituation && (
          <div className="situation-hint">
            <span className="situation-tag">💡 眼下</span>
            <span className="situation-text">{state.currentSituation}</span>
          </div>
        )}
        {state?.suggestions && state.suggestions.length > 0 && !busy && (
          <div className="suggestions-grid">
            {state.suggestions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`suggestion-btn ${opt.type}`}
                onClick={() => {
                  setDraft(opt.label);
                  setTimeout(() => composerRef.current?.focus(), 0);
                }}
              >
                <span className="opt-key">{opt.key}.</span>
                <span className="opt-label">{opt.label}</span>
              </button>
            ))}
          </div>
        )}
        {error && <div className="error-line">{error}</div>}
        {busy && !error && <div className="typing-dot"><span /><span /><span /></div>}
        <div className="row">
          <textarea
            ref={composerRef}
            value={draft}
            placeholder="想做什么，直接说。也可以点击上方选项填入。"
            disabled={busy}
            onChange={(e) => {
              setDraft(e.target.value);
              // Auto-grow
              const ta = e.target;
              ta.style.height = "auto";
              ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
            }}
            onCompositionStart={() => { isComposing.current = true; }}
            onCompositionEnd={() => { isComposing.current = false; }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isComposing.current) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="send"
            disabled={busy || !draft.trim()}
            onClick={() => void send()}
          >
            发送
          </button>
        </div>
      </footer>

      {/* Era / Premise Drawer */}
      {eraOpen && (
        <div className="overlay" onClick={() => setEraOpen(false)}>
          <aside className="drawer era-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>{state?.worldTitle ?? "世界背景"}</h2>
              <span className="save-status-pill">✓ 已自动保存</span>
            </div>
            <div className="drawer-rows">
              {state?.era && (
                <div className="drawer-row">
                  <span>时期</span>
                  <strong>{state.era}</strong>
                </div>
              )}
              {state?.timeLabel && (
                <div className="drawer-row">
                  <span>时间</span>
                  {state.timeLabel}
                </div>
              )}
              {state?.locationName && (
                <div className="drawer-row">
                  <span>当前地点</span>
                  {state.locationName}
                </div>
              )}
              {state?.publicPremise && (
                <div className="drawer-section">
                  <span className="section-title">公开背景与大事</span>
                  <p className="premise-body">{state.publicPremise}</p>
                </div>
              )}
              {playerProfile?.background && (
                <div className="drawer-section">
                  <span className="section-title">你的身世</span>
                  <p className="premise-body">{playerProfile.background}</p>
                </div>
              )}
            </div>
            <button type="button" className="close-btn" onClick={() => setEraOpen(false)}>关闭</button>
          </aside>
        </div>
      )}

      {/* State Drawer */}
      {drawerOpen && state && (
        <div className="overlay" onClick={() => setDrawerOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <h2>现在</h2>
            <div className="drawer-rows">
              {playerProfile?.name && <div className="drawer-row"><span>你</span>{playerProfile.name}</div>}
              <div className="drawer-row"><span>时间</span>{state.time}</div>
              <div className="drawer-row"><span>地点</span>{state.locationName}</div>
              {state.carried.length > 0 && (
                <div className="drawer-row"><span>携带</span>{state.carried.join("、")}</div>
              )}
              {state.nearby.length > 0 && (
                <div className="drawer-row"><span>在场</span>{state.nearby.join("、")}</div>
              )}
            </div>
            <button type="button" className="close-btn" onClick={() => setDrawerOpen(false)}>关闭</button>
          </aside>
        </div>
      )}

      {/* World Sheet */}
      {worldsOpen && (
        <div className="overlay" onClick={() => setWorldsOpen(false)}>
          <aside className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>切换世界</h2>
            {worlds.map((world) => (
              <div key={world.id} className="world-row">
                <div className="world-info">
                  <strong>{world.title}</strong>
                  {world.id === currentWorldId && <em className="current-badge">当前</em>}
                  {world.description && <p className="world-desc">{world.description}</p>}
                </div>
                <div className="world-btns">
                  {world.hasSave && (
                    <button type="button" className="text-btn" onClick={() => void changeWorld(world.id, "resume")}>
                      继续
                    </button>
                  )}
                  <button type="button" className="text-btn" onClick={() => onNewWorldClick(world)}>
                    新人生
                  </button>
                </div>
              </div>
            ))}
          </aside>
        </div>
      )}

      {/* Safe-new-save confirm */}
      {confirmReset && (
        <div className="overlay center-overlay" onClick={() => setConfirmReset(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>开始新人生 —「{confirmReset.title}」</h3>
            <p className="dialog-body">
              这个世界已经有存档。<br />
              新开会从头开始，现有存档将先保留为备份。
            </p>
            <div className="dialog-actions">
              <button type="button" className="text-btn" onClick={() => setConfirmReset(null)}>
                取消
              </button>
              <button type="button" className="btn-danger" onClick={() => void startNewLife(confirmReset)}>
                保留旧档并新开
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── World Select Screen ───────────────────────────────────────────────── */

function WorldSelectScreen({
  worlds,
  currentWorldId,
  busy,
  error,
  onResume,
  onNew,
  confirmReset,
  onConfirmReset,
  onCancelReset,
}: {
  worlds: WorldChoice[];
  currentWorldId: string | null;
  busy: boolean;
  error: string | null;
  onResume: (id: string) => void;
  onNew: (world: WorldChoice) => void;
  confirmReset: WorldChoice | null;
  onConfirmReset: (world: WorldChoice) => void;
  onCancelReset: () => void;
}) {
  return (
    <div className="select-shell">
      <header className="select-header">
        <h1 className="brand">东方狂想</h1>
        <p className="brand-sub">World Engine</p>
      </header>

      <main className="select-worlds">
        {worlds.length === 0 && (
          <p className="empty-hint">{error ?? "正在加载世界…"}</p>
        )}
        {worlds.map((world) => (
          <div key={world.id} className={`world-card${world.id === currentWorldId ? " active-card" : ""}`}>
            <div className="world-card-text">
              <h2>{world.title}</h2>
              {world.description && <p>{world.description}</p>}
              {world.id === currentWorldId && <span className="ongoing-tag">旅程进行中</span>}
            </div>
            <div className="world-card-actions">
              {world.hasSave && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => onResume(world.id)}
                >
                  继续旅程
                </button>
              )}
              <button
                type="button"
                className={world.hasSave ? "btn-secondary" : "btn-primary"}
                disabled={busy}
                onClick={() => onNew(world)}
              >
                开始新人生
              </button>
            </div>
          </div>
        ))}
      </main>

      {error && <p className="select-error">{error}</p>}

      {confirmReset && (
        <div className="overlay center-overlay" onClick={onCancelReset}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>开始新人生 —「{confirmReset.title}」</h3>
            <p className="dialog-body">
              这个世界已经有存档。<br />
              新开会从头开始，现有存档将先保留为备份。
            </p>
            <div className="dialog-actions">
              <button type="button" className="text-btn" onClick={onCancelReset}>取消</button>
              <button type="button" className="btn-danger" onClick={() => onConfirmReset(confirmReset)}>
                保留旧档并新开
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Onboard Screen ────────────────────────────────────────────────────── */

const LONGZU_LOCATIONS = [
  "普通城市", "教学楼", "宿舍", "家", "食堂", "便利店", "普通大学校园",
];

const RIVERSIDE_LOCATIONS = [
  "堂屋", "厨房",
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function generateRandomProfile(worldId: string): PlayerProfile {
  const surnames = ["林", "陈", "王", "张", "李", "刘", "赵", "吴", "孙", "黄"];
  const givenMale = ["念安", "若晨", "子恒", "青桐", "明朗", "晓阳", "承翰", "宇轩"];
  const givenFemale = ["念安", "若霜", "子衿", "晨曦", "思远", "语桐", "静秋", "清妍"];
  const gender = Math.random() > 0.5 ? "男" : "女";
  const given = gender === "男" ? randomChoice(givenMale) : randomChoice(givenFemale);
  const name = randomChoice(surnames) + given;
  const age = String(Math.floor(Math.random() * 6) + 18);
  const backgrounds = [
    "父亲在工厂工作，母亲经营一家小店。家庭普通，没有特别的故事。",
    "独生子女，父母都是公务员。从小成绩不错，但也说不上有什么特别的抱负。",
    "从外省来的大学新生，第一次离家这么远，有点不适应。",
    "本地人，高中毕业后没继续读书，在城里找了份普通工作。",
    "家里开了间小饭馆，从小帮忙，养成了早起的习惯。",
  ];
  const personalities = [
    "不太主动，但朋友说起来也算好相处。",
    "喜欢独处，不讨厌人，但也不需要太多陪伴。",
    "有点多愁善感，但不会轻易表现出来。",
    "务实，不喜欢无谓的麻烦，但关键时候不会退缩。",
    "平时话不多，记性好，心里比较敏感。",
  ];
  const locations = worldId === "longzu" ? LONGZU_LOCATIONS : RIVERSIDE_LOCATIONS;
  return {
    worldId,
    name,
    age,
    gender,
    background: randomChoice(backgrounds),
    startingLocation: randomChoice(locations),
    personality: randomChoice(personalities),
  };
}

function OnboardScreen({
  world,
  busy,
  onProfile,
  onBack,
}: {
  world: WorldChoice;
  busy: boolean;
  onProfile: (profile: PlayerProfile) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "custom">("choose");
  const [form, setForm] = useState<PlayerProfile>(() => generateRandomProfile(world.id));
  const [generated, setGenerated] = useState<PlayerProfile | null>(null);

  function handleRandom() {
    const p = generateRandomProfile(world.id);
    setGenerated(p);
    onProfile(p);
  }

  function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    onProfile(form);
  }

  function field(key: keyof PlayerProfile, label: string, placeholder: string, tag: "input" | "textarea" = "input") {
    const value = String(form[key]);
    const common = {
      id: key,
      value,
      placeholder,
      disabled: busy,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
    return (
      <div className="form-row" key={key}>
        <label htmlFor={key}>{label}</label>
        {tag === "textarea" ? (
          <textarea {...common} rows={2} />
        ) : (
          <input {...common} type="text" />
        )}
      </div>
    );
  }

  const locations = world.id === "longzu" ? LONGZU_LOCATIONS : RIVERSIDE_LOCATIONS;

  return (
    <div className="onboard-shell">
      <div className="onboard-card">
        <button type="button" className="back-btn" onClick={onBack}>← 返回</button>
        <div className="onboard-world-label">{world.title}</div>
        <h1 className="onboard-title">这一次，你是谁？</h1>
        <p className="onboard-sub">{world.description}</p>

        {mode === "choose" && (
          <div className="onboard-choices">
            <button
              type="button"
              className="choice-btn primary"
              disabled={busy}
              onClick={handleRandom}
            >
              <span className="choice-icon">🎲</span>
              <span className="choice-label">随机开局</span>
              <span className="choice-sub">生成一个世界里的普通人，直接进入第一幕</span>
            </button>
            <button
              type="button"
              className="choice-btn"
              disabled={busy}
              onClick={() => setMode("custom")}
            >
              <span className="choice-icon">✏️</span>
              <span className="choice-label">简单自定义</span>
              <span className="choice-sub">填写几个简单选项，空着的自动生成</span>
            </button>
          </div>
        )}

        {mode === "custom" && (
          <form className="custom-form" onSubmit={handleCustomSubmit}>
            {field("name", "名字", "留空则随机生成")}
            {field("age", "年龄", "18–25")}
            <div className="form-row">
              <label htmlFor="gender">性别</label>
              <select
                id="gender"
                value={form.gender}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
              >
                <option value="">随机</option>
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </div>
            <div className="form-row">
              <label htmlFor="startingLocation">起始地点</label>
              <select
                id="startingLocation"
                value={form.startingLocation}
                disabled={busy}
                onChange={(e) => setForm((f) => ({ ...f, startingLocation: e.target.value }))}
              >
                {locations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
            {field("background", "背景（可选）", "家庭、经历、目前状况……", "textarea")}
            {field("personality", "性格倾向（可选）", "一句话描述", "input")}
            <div className="form-actions">
              <button type="button" className="text-btn" onClick={() => setMode("choose")}>← 返回</button>
              <button type="submit" className="btn-primary" disabled={busy}>进入世界</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ─── Character Card Screen ─────────────────────────────────────────────── */

function CharCardScreen({
  profile,
  world,
  busy,
  onEnter,
  onBack,
}: {
  profile: PlayerProfile;
  world: WorldChoice;
  busy: boolean;
  onEnter: (profile: PlayerProfile) => void;
  onBack: () => void;
}) {
  return (
    <div className="charcard-shell">
      <div className="charcard">
        <div className="charcard-world">{world.title}</div>
        <div className="charcard-name">{profile.name || "无名"}</div>
        <div className="charcard-meta">
          {[profile.age && `${profile.age}岁`, profile.gender, profile.startingLocation]
            .filter(Boolean).join(" · ")}
        </div>
        <div className="charcard-divider" />
        {profile.background && <p className="charcard-bg">{profile.background}</p>}
        {profile.personality && <p className="charcard-personality">{profile.personality}</p>}
        <div className="charcard-divider" />
        <p className="charcard-hint">你没有发现自己有什么超自然能力。<br />今天仍然只是普通的一天。</p>
        <div className="charcard-actions">
          <button type="button" className="text-btn" onClick={onBack} disabled={busy}>← 修改</button>
          <button type="button" className="btn-enter" onClick={() => onEnter(profile)} disabled={busy}>
            {busy ? "进入中…" : "进入第一幕 →"}
          </button>
        </div>
      </div>
    </div>
  );
}
