/* A small static development server plus in-memory online rooms. No build step, no dependencies.
 * Rooms are deliberately simple: the server owns the dice and the turn, so two devices stay in step.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createGame, applyRoll, rollDie } = require("../game-engine.js");

const root = path.resolve(__dirname, "..");
const portFlag = process.argv.indexOf("--port");
const port = Number(process.env.PORT || (portFlag >= 0 ? process.argv[portFlag + 1] : 5173));
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".png": "image/png",
};

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL = 45 * 60 * 1000;
const POLL_HOLD = 12000;
const RIDDLE_TTL = 5 * 60 * 1000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const rooms = new Map();
const riddles = new Map();

function makeCode() {
  let code;
  do { code = Array.from({ length: 5 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join(""); }
  while (rooms.has(code));
  return code;
}

function cleanName(value, fallback) {
  const name = String(value ?? "").replace(/[<>]/g, "").trim().slice(0, 24);
  return name || fallback;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 16384) { reject(new Error("That request was too large.")); request.destroy(); }
    });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("That request was not valid JSON.")); }
    });
    request.on("error", reject);
  });
}

function normalizeAnswer(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]/g, "");
}

async function generateHaikuRiddle() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error("Gemini riddles are not configured on this server. Set GEMINI_API_KEY, or take the classic snake slide.");
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  timeout.unref?.();
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Create one original, child-friendly English riddle about a simple everyday or nature object. The clue must be exactly three lines in a 5-7-5 syllable haiku pattern. Do not include a title or reveal the answer in the clue. Return only JSON with haiku (three newline-separated lines), answer (one short answer), and acceptedAnswers (an array of at most four common equivalent answers)." }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              haiku: { type: "STRING" },
              answer: { type: "STRING" },
              acceptedAnswers: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["haiku", "answer", "acceptedAnswers"],
          },
          temperature: 0.8,
          maxOutputTokens: 180,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(response.status === 429 ? "Gemini is busy right now. Try again in a moment, or take the classic slide." : "Gemini could not make a riddle right now. Try again, or take the classic slide.");
      error.status = 502;
      throw error;
    }
    const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
    let riddle;
    try { riddle = JSON.parse(text); }
    catch {
      const error = new Error("Gemini returned a riddle we could not read. Please try again or take the classic slide.");
      error.status = 502;
      throw error;
    }
    const haiku = typeof riddle.haiku === "string" ? riddle.haiku.trim() : "";
    const answer = typeof riddle.answer === "string" ? riddle.answer.trim().slice(0, 48) : "";
    const lines = haiku.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length !== 3 || !answer || !normalizeAnswer(answer)) {
      const error = new Error("Gemini returned an incomplete haiku. Please try again or take the classic slide.");
      error.status = 502;
      throw error;
    }
    const accepted = Array.isArray(riddle.acceptedAnswers) ? riddle.acceptedAnswers.slice(0, 4) : [];
    return { haiku: lines.join("\n"), answer, answers: [...new Set([answer, ...accepted].map(normalizeAnswer).filter(Boolean))] };
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Gemini took too long to answer. Please try again or take the classic slide.");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally { clearTimeout(timeout); }
}

async function handleRiddleApi(request, response, parts) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "That riddle action is not supported." });
  if (parts.length === 2) {
    const body = await readJson(request);
    let owner = { roomCode: null, player: null, pendingId: null };
    if (body.roomCode) {
      const roomCode = String(body.roomCode).toUpperCase().slice(0, 5);
      const player = body.player === 1 ? 1 : 0;
      const room = rooms.get(roomCode);
      if (!room || !room.pending || room.pending.id !== body.pendingId || room.pending.player !== player) {
        const error = new Error("That snake turn is no longer waiting for a riddle.");
        error.status = 409;
        throw error;
      }
      owner = { roomCode, player, pendingId: room.pending.id };
    }
    const generated = await generateHaikuRiddle();
    const now = Date.now();
    for (const [id, challenge] of riddles) if (challenge.expiresAt <= now) riddles.delete(id);
    const id = randomUUID();
    riddles.set(id, { ...generated, ...owner, expiresAt: now + RIDDLE_TTL, attempted: false, correct: false });
    while (riddles.size > 200) riddles.delete(riddles.keys().next().value);
    return sendJson(response, 201, { id, haiku: generated.haiku });
  }
  if (parts.length === 4 && parts[3] === "answer") {
    const id = parts[2];
    const challenge = riddles.get(id);
    if (!challenge || challenge.expiresAt <= Date.now()) {
      const error = new Error("That riddle has expired. Start a new one, or take the classic slide.");
      error.status = 410;
      throw error;
    }
    const body = await readJson(request);
    if (challenge.roomCode && (String(body.roomCode).toUpperCase() !== challenge.roomCode || (body.player === 1 ? 1 : 0) !== challenge.player || body.pendingId !== challenge.pendingId)) {
      const error = new Error("That riddle belongs to a different room turn.");
      error.status = 403;
      throw error;
    }
    if (challenge.attempted) {
      const error = new Error("You already tried this riddle.");
      error.status = 409;
      throw error;
    }
    challenge.attempted = true;
    challenge.correct = challenge.answers.includes(normalizeAnswer(body.answer));
    return sendJson(response, 200, { correct: challenge.correct, ...(!challenge.correct ? { answer: challenge.answer } : {}) });
  }
  return sendJson(response, 405, { error: "That riddle action is not supported." });
}

function snapshot(room, player) {
  return {
    code: room.code, version: room.version, boardIndex: room.boardIndex,
    player, seats: [...room.seats], names: [...room.names], state: room.state, last: room.last,
    pending: room.pending ? { ...room.pending } : null,
  };
}

function flush(room) {
  for (const waiter of room.waiters.splice(0)) {
    if (waiter.timer) clearTimeout(waiter.timer);
    if (!waiter.response.writableEnded) sendJson(waiter.response, 200, snapshot(room, waiter.player));
  }
}

function freshState(room) {
  room.state = createGame({ boardIndex: room.boardIndex, names: [...room.names] });
  room.last = null;
  room.pending = null;
}

function touch(room) {
  room.updatedAt = Date.now();
  room.version += 1;
}

async function handleApi(request, response, pathname, search) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[1] === "riddles") return handleRiddleApi(request, response, parts);
  const code = (parts[2] || "").toUpperCase();
  const action = parts[3] || "";
  const room = code ? rooms.get(code) : null;

  if (request.method === "POST" && parts.length === 2) {
    const body = await readJson(request);
    const boardIndex = Number.isInteger(body.boardIndex) ? Math.min(Math.max(body.boardIndex, 0), 19) : 0;
    const name = cleanName(body.name, "Player 1");
    const created = {
      code: makeCode(), boardIndex, seats: [true, false], names: [name, "Player 2"],
      version: 1, last: null, pending: null, waiters: [], state: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    freshState(created);
    rooms.set(created.code, created);
    return sendJson(response, 201, { ...snapshot(created, 0), player: 0 });
  }

  if (!room) return sendJson(response, 404, { error: "That room does not exist. Check the code and try again." });
  if (Date.now() - room.updatedAt > ROOM_TTL) { rooms.delete(room.code); return sendJson(response, 410, { error: "That room has expired." }); }

  if (request.method === "POST" && action === "join") {
    const body = await readJson(request);
    if (room.seats[1]) return sendJson(response, 409, { error: "That room already has two players." });
    room.seats[1] = true;
    room.names[1] = cleanName(body.name, "Player 2");
    room.state = createGame({ boardIndex: room.boardIndex, names: [...room.names] });
    room.last = null;
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, 1), player: 1 });
  }

  if (request.method === "POST" && action === "rejoin") {
    const body = await readJson(request);
    const player = body.player === 1 ? 1 : 0;
    room.seats[player] = true;
    if (body.name) room.names[player] = cleanName(body.name, room.names[player]);
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, player), player });
  }

  if (request.method === "POST" && action === "roll") {
    const body = await readJson(request);
    const player = body.player === 1 ? 1 : 0;
    if (!room.seats[0] || !room.seats[1]) return sendJson(response, 409, { error: "Waiting for a second player to join." });
    if (room.pending) return sendJson(response, 409, { error: "Resolve the pending snake riddle before rolling again." });
    if (room.state.winner !== null) return sendJson(response, 409, { error: "This game is already finished." });
    if (room.state.turn !== player) return sendJson(response, 409, { error: "It is not your turn yet." });
    const die = rollDie();
    const result = applyRoll(room.state, die);
    if (result.entry.type === "snake") {
      room.pending = { id: randomUUID(), player, die, from: result.entry.from, landed: result.entry.landed, to: result.entry.to };
      touch(room);
      flush(room);
      return sendJson(response, 200, { ...snapshot(room, player), player });
    }
    room.state = result.state;
    room.last = { die, player: result.entry.player, sequence: result.entry.sequence, type: result.entry.type, from: result.entry.from, landed: result.entry.landed, to: result.entry.to };
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, player), player });
  }

  if (request.method === "POST" && action === "resolve") {
    const body = await readJson(request);
    const player = body.player === 1 ? 1 : 0;
    const pending = room.pending;
    if (!pending || pending.player !== player) return sendJson(response, 409, { error: "That snake turn is no longer waiting for you." });
    let rescued = false;
    if (body.choice === "riddle") {
      const challenge = riddles.get(body.riddleId);
      if (!challenge || !challenge.attempted || !challenge.correct || challenge.roomCode !== room.code || challenge.player !== player || challenge.pendingId !== pending.id || challenge.expiresAt <= Date.now()) {
        return sendJson(response, 409, { error: "Solve the current haiku correctly before choosing rescue." });
      }
      rescued = true;
      riddles.delete(body.riddleId);
    } else if (body.choice !== "slide") {
      return sendJson(response, 400, { error: "Choose the classic slide or a solved riddle." });
    }
    const result = applyRoll(room.state, pending.die, { riddleRescued: rescued });
    room.state = result.state;
    room.last = { die: result.entry.die, player: result.entry.player, sequence: result.entry.sequence, type: result.entry.type, from: result.entry.from, landed: result.entry.landed, to: result.entry.to };
    room.pending = null;
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, player), player });
  }

  if (request.method === "POST" && action === "leave") {
    const body = await readJson(request);
    const player = body.player === 1 ? 1 : 0;
    room.seats[player] = false;
    room.names[player] = player === 0 ? "Player 1" : "Player 2";
    freshState(room);
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, player), player, left: true });
  }

  if (request.method === "GET" && !action) {
    const since = Number(new URL(`http://local${search}`).searchParams.get("since"));
    const player = new URL(`http://local${search}`).searchParams.get("player") === "1" ? 1 : 0;
    if (!Number.isFinite(since) || room.version > since) return sendJson(response, 200, snapshot(room, player));
    // Long poll: answer as soon as the other player moves, or quietly after the hold expires.
    const waiter = { response, player, timer: null };
    waiter.timer = setTimeout(() => {
      room.waiters = room.waiters.filter(entry => entry !== waiter);
      if (!response.writableEnded) sendJson(response, 200, { code: room.code, version: room.version, unchanged: true, seats: [...room.seats], names: [...room.names] });
    }, POLL_HOLD);
    room.waiters.push(waiter);
    request.on("close", () => {
      clearTimeout(waiter.timer);
      room.waiters = room.waiters.filter(entry => entry !== waiter);
    });
    return undefined;
  }

  return sendJson(response, 405, { error: "That action is not supported." });
}

const server = http.createServer((request, response) => {
  let parsed;
  try { parsed = new URL(request.url, "http://static.local"); }
  catch { response.writeHead(400); response.end("Bad request"); return; }

  if (parsed.pathname.startsWith("/api/")) {
    if (!["GET", "HEAD", "POST"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD, POST" }); response.end(); return;
    }
    handleApi(request, response, parsed.pathname, parsed.search)
      .catch(error => { if (!response.writableEnded) sendJson(response, error.status || 400, { error: error.message || "That request could not be handled." }); });
    return;
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); }
  catch { response.writeHead(400); response.end("Bad request"); return; }
  const segments = pathname.split("/");
  if (segments.some(segment => segment.startsWith(".") || ["node_modules", "tests", "scripts"].includes(segment))) {
    response.writeHead(404); response.end("Not found"); return;
  }
  const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(404); response.end("Not found"); return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404); response.end("Not found"); return; }
    const ext = path.extname(file);
    const isServiceWorker = path.basename(file) === "sw.js";
    response.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": isServiceWorker ? "no-cache" : "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).on("error", () => response.destroy()).pipe(response);
  });
});

const sweep = setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL;
  for (const [code, room] of rooms) if (room.updatedAt < cutoff && !room.waiters.length) rooms.delete(code);
}, 60000);
sweep.unref();

server.listen(port, "0.0.0.0", () => console.log(`Snakes & Ladders is ready at http://0.0.0.0:${server.address().port}`));
