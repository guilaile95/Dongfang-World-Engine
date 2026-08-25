import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { PlayHost } from "./host.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function startPlayServer(host: PlayHost, port: number, staticDir: string | null): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    void handle(host, req, res, staticDir);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function handle(
  host: PlayHost,
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string | null,
): Promise<void> {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      json(res, 200, host.bootstrap());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      json(res, 200, host.state());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/world") {
      const body = JSON.parse(await readBody(req)) as { worldId?: string; mode?: string };
      if (!body.worldId || (body.mode !== "resume" && body.mode !== "new")) {
        json(res, 400, { error: "invalid world request" });
        return;
      }
      try {
        const state = host.open(body.worldId, body.mode);
        json(res, 200, {
          state,
          messages: host.messages(),
          currentWorldId: host.currentWorldId(),
          worlds: host.worldsList(),
          playerProfile: host.getPlayerProfile(body.worldId),
        });
      } catch (error) {
        const message = error instanceof Error && error.message.startsWith("BACKUP_FAILED")
          ? "备份旧存档失败，未进行新开，原存档已保留。"
          : "无法切换世界";
        json(res, 500, { error: message });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/profile") {
      const worldId = url.searchParams.get("worldId") ?? "";
      if (!worldId) {
        json(res, 400, { error: "worldId required" });
        return;
      }
      json(res, 200, { playerProfile: host.getPlayerProfile(worldId) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/profile") {
      const body = JSON.parse(await readBody(req)) as Partial<import("../persist/store.js").PlayerProfile>;
      if (!body.worldId) {
        json(res, 400, { error: "worldId required" });
        return;
      }
      try {
        host.setPlayerProfile({
          worldId: body.worldId,
          name: body.name ?? "",
          age: body.age ?? "",
          gender: body.gender ?? "",
          background: body.background ?? "",
          startingLocation: body.startingLocation ?? "",
          personality: body.personality ?? "",
        });
        json(res, 200, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "error";
        json(res, 500, { error: message });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/opening") {
      const body = JSON.parse(await readBody(req)) as { profile?: Partial<import("../persist/store.js").PlayerProfile> };
      if (!body.profile || !body.profile.worldId) {
        json(res, 400, { error: "profile with worldId required" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      });
      const profile: import("../persist/store.js").PlayerProfile = {
        worldId: body.profile.worldId,
        name: body.profile.name ?? "",
        age: body.profile.age ?? "",
        gender: body.profile.gender ?? "",
        background: body.profile.background ?? "",
        startingLocation: body.profile.startingLocation ?? "",
        personality: body.profile.personality ?? "",
      };
      try {
        const result = await host.startLife(profile, (chunk) => {
          res.write(`${JSON.stringify({ type: "chunk", text: chunk })}\n`);
        });
        res.write(`${JSON.stringify({ type: "done", text: result.message.text, parsed: true, state: result.state })}\n`);
        res.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : "无法开启第一幕";
        res.write(`${JSON.stringify({ type: "done", text: message, parsed: false, state: null })}\n`);
        res.end();
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/turn") {
      const body = JSON.parse(await readBody(req)) as { text?: string; turnId?: string };
      const text = body.text?.trim() ?? "";
      const turnId = body.turnId?.trim() ?? "";
      if (!text || !turnId) {
        json(res, 400, { error: "text and turnId required" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      });
      const result = await host.playTurn(text, turnId, (chunk) => {
        res.write(`${JSON.stringify({ type: "chunk", text: chunk })}\n`);
      });
      res.write(`${JSON.stringify({ type: "done", text: result.text, parsed: result.parsed, state: result.state })}\n`);
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/turn/cancel") {
      const body = JSON.parse(await readBody(req)) as { turnId?: string };
      const turnId = body.turnId?.trim() ?? "";
      if (!turnId) {
        json(res, 400, { error: "turnId required" });
        return;
      }
      const cancelled = host.cancelTurn(turnId);
      json(res, cancelled ? 202 : 404, { cancelled });
      return;
    }
    if (staticDir && req.method === "GET") {
      serveStatic(res, staticDir, url.pathname);
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    process.stderr.write(`${message}\n`);
    if (res.headersSent) {
      res.end();
      return;
    }
    json(res, 500, { error: "request failed" });
  }
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body)}\n`);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function serveStatic(res: ServerResponse, root: string, pathname: string): void {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = resolve(root, relative);
  if (!file.startsWith(resolve(root))) {
    json(res, 403, { error: "forbidden" });
    return;
  }
  const target = existsSync(file) && statSync(file).isFile() ? file : join(root, "index.html");
  if (!existsSync(target)) {
    json(res, 404, { error: "not found" });
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
}

export function main(): void {
  const config = loadConfig();
  const stub = process.env.DWE_PLAY_STUB === "1";
  const host = new PlayHost(config, stub);
  const port = Number.parseInt(process.env.DWE_HTTP_PORT?.trim() || "8787", 10);
  const staticDir = existsSync(resolve("web/dist/index.html")) ? resolve("web/dist") : null;
  startPlayServer(host, port, staticDir);
  process.stderr.write(`play http://127.0.0.1:${port}${stub ? " stub" : ""}\n`);
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry && (entry.endsWith("/http/server.ts") || entry.endsWith("/http/server.js") || entry.endsWith("/server.js"))) {
  main();
}
