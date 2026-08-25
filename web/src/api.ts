export interface PlayerState {
  worldTitle: string;
  worldName: string;
  characterName: string;
  time: string;
  locationName: string;
  carried: string[];
  nearby: string[];
}

export interface ChatMessage {
  role: "player" | "world" | "notice";
  text: string;
  parsed: boolean;
}

export interface WorldChoice {
  id: string;
  title: string;
  hasSave: boolean;
}

export interface Bootstrap {
  worlds: WorldChoice[];
  currentWorldId: string | null;
  state: PlayerState | null;
  messages: ChatMessage[];
  roleSwitch: "blocked";
}

export async function loadBootstrap(): Promise<Bootstrap> {
  const res = await fetch("/api/bootstrap");
  if (!res.ok) {
    throw new Error("无法打开世界");
  }
  return res.json() as Promise<Bootstrap>;
}

export async function switchWorld(worldId: string, mode: "resume" | "new"): Promise<{
  state: PlayerState;
  messages: ChatMessage[];
  currentWorldId: string;
  worlds?: WorldChoice[];
}> {
  const res = await fetch("/api/world", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worldId, mode }),
  });
  if (!res.ok) {
    let errorMsg = "无法切换世界";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) {
        errorMsg = body.error;
      }
    } catch {
      // fallback to default
    }
    throw new Error(errorMsg);
  }
  return res.json() as Promise<{
    state: PlayerState;
    messages: ChatMessage[];
    currentWorldId: string;
    worlds?: WorldChoice[];
  }>;
}

export async function playTurn(
  text: string,
  turnId: string,
  onChunk: (chunk: string) => void,
): Promise<{ text: string; parsed: boolean; state: PlayerState }> {
  const res = await fetch("/api/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, turnId }),
  });
  if (!res.ok || !res.body) {
    throw new Error("这一句没有送出，请再试一次。");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalText = "";
  let parsed = true;
  let state: PlayerState | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const event = JSON.parse(line) as {
        type: string;
        text?: string;
        parsed?: boolean;
        state?: PlayerState;
      };
      if (event.type === "chunk" && event.text) {
        onChunk(event.text);
      }
      if (event.type === "done") {
        finalText = event.text ?? finalText;
        parsed = event.parsed !== false;
        state = event.state ?? state;
      }
    }
  }
  if (!state) {
    throw new Error("这一句没有送出，请再试一次。");
  }
  return { text: finalText, parsed, state };
}
