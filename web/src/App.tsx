import { useEffect, useRef, useState } from "react";
import { loadBootstrap, playTurn, switchWorld, type ChatMessage, type PlayerState, type WorldChoice } from "./api";

export function App() {
  const [worlds, setWorlds] = useState<WorldChoice[]>([]);
  const [currentWorldId, setCurrentWorldId] = useState<string | null>(null);
  const [state, setState] = useState<PlayerState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmReset, setConfirmReset] = useState<WorldChoice | null>(null);
  const pin = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);
  const sending = useRef(false);

  useEffect(() => {
    void loadBootstrap()
      .then((boot) => {
        setWorlds(boot.worlds);
        setCurrentWorldId(boot.currentWorldId);
        setState(boot.state);
        setMessages(boot.messages);
      })
      .catch(() => setError("打不开本地世界。"));
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (node && pin.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, busy]);

  function onScroll(): void {
    const node = scroller.current;
    if (!node) {
      return;
    }
    pin.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || sending.current || busy) {
      return;
    }
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
    }
  }

  function onNewWorldClick(world: WorldChoice): void {
    if (world.hasSave) {
      setConfirmReset(world);
    } else {
      void changeWorld(world.id, "new");
    }
  }

  async function changeWorld(id: string, mode: "resume" | "new"): Promise<void> {
    setSettings(false);
    setConfirmReset(null);
    setBusy(true);
    try {
      const result = await switchWorld(id, mode);
      setCurrentWorldId(result.currentWorldId);
      setState(result.state);
      setMessages(result.messages);
      if (result.worlds) {
        setWorlds(result.worlds);
      }
      setError(null);
      pin.current = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法切换世界。";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="who">
          <span className="world">{state?.worldTitle ?? "东方狂想"}</span>
          <span className="dot">·</span>
          <span>{state?.characterName ?? ""}</span>
        </div>
        <div className="actions">
          <button type="button" className="text-btn" onClick={() => setDrawer(true)}>
            状态
          </button>
          <button type="button" className="text-btn" onClick={() => setSettings(true)}>
            世界
          </button>
        </div>
      </header>

      <div className="thread" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 && (
          <p className="empty">像平常聊天一样说话。世界会自己记着。</p>
        )}
        {messages.map((row, index) => (
          <article key={`${index}-${row.role}`} className={`msg ${row.role}`}>
            <div className="label">{row.role === "player" ? "你" : row.role === "notice" ? "提示" : "世界"}</div>
            <div className="body">{row.text}</div>
          </article>
        ))}
      </div>

      <footer className="composer">
        <div className="status-line">{busy ? "正在书写…" : error ?? ""}</div>
        <div className="row">
          <textarea
            value={draft}
            placeholder="想做什么，直接说。"
            rows={3}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button type="button" className="send" disabled={busy || !draft.trim()} onClick={() => void send()}>
            发送
          </button>
        </div>
      </footer>

      {drawer && state && (
        <div className="overlay" onClick={() => setDrawer(false)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            <h2>现在</h2>
            <p><span>世界</span>{state.worldName}</p>
            <p><span>时间</span>{state.time}</p>
            <p><span>地点</span>{state.locationName}</p>
            <p><span>携带</span>{state.carried.length > 0 ? state.carried.join("、") : "无"}</p>
            <button type="button" className="text-btn" onClick={() => setDrawer(false)}>
              关闭
            </button>
          </aside>
        </div>
      )}

      {settings && (
        <div className="overlay" onClick={() => setSettings(false)}>
          <aside className="sheet" onClick={(event) => event.stopPropagation()}>
            <h2>世界</h2>
            {worlds.map((world) => (
              <div key={world.id} className="world-row">
                <div>
                  <strong>{world.title}</strong>
                  {world.id === currentWorldId ? <em>当前</em> : null}
                </div>
                <div>
                  <button type="button" className="text-btn" onClick={() => void changeWorld(world.id, "resume")}>
                    继续
                  </button>
                  <button type="button" className="text-btn" onClick={() => onNewWorldClick(world)}>
                    新开
                  </button>
                </div>
              </div>
            ))}
            <p className="hint">每个世界只有一个玩家身份。换人目前还做不到。</p>
          </aside>
        </div>
      )}

      {confirmReset && (
        <div className="overlay" onClick={() => setConfirmReset(null)}>
          <div className="dialog" onClick={(event) => event.stopPropagation()}>
            <h3>重新开始「{confirmReset.title}」</h3>
            <p className="dialog-body">
              这个世界已经有存档。
              <br />
              新开会从头开始，现有存档将先保留为备份。
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="text-btn"
                onClick={() => setConfirmReset(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => void changeWorld(confirmReset.id, "new")}
              >
                保留旧档并新开
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
