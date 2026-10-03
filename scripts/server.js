/* A small static development server plus in-memory online rooms. No build step, no dependencies.
 * Rooms are deliberately simple: the server owns the dice and the turn, so two devices stay in step.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createGame, applyRoll, rollDie, BOARDS } = require("../game-engine.js");

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
const accounts = new Map();
const sessions = new Map();
const queue = []; // Matchmaking queue: [{ code, player, createdAt }]
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 32 };
const ALLOWED_COLORS = ["blue", "red", "green", "yellow", "white", "black"];

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

const DEFAULT_COLORS = ["blue", "red", "green", "yellow", "white", "black"];

function validateUsername(username) {
  return typeof username === "string" && /^[a-zA-Z0-9_]{2,16}$/.test(username);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 4;
}

function hashPassword(password, salt) {
  const crypto = require("node:crypto");
  return crypto.scryptSync(password, salt, SCRYPT_PARAMS.dkLen, { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p });
}

function verifyPassword(password, saltHex, hashHex) {
  const crypto = require("node:crypto");
  const salt = Buffer.from(saltHex, "hex");
  const hash = Buffer.from(hashHex, "hex");
  const computed = hashPassword(password, salt);
  return crypto.timingSafeEqual(computed, hash);
}

function createToken() {
  return randomUUID();
}

function getUsernameFromToken(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.username;
}

function requireAuth(request) {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return getUsernameFromToken(auth.slice(7));
}

function getNextColor(room) {
  const used = new Set(room.colors.filter(Boolean));
  for (const color of DEFAULT_COLORS) if (!used.has(color)) return color;
  return DEFAULT_COLORS[0];
}

function assignColors(room) {
  while (room.colors.length < room.seats.length) {
    room.colors.push(getNextColor(room));
  }
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
    player, seats: [...room.seats], names: [...room.names], colors: [...room.colors],
    ready: [...room.ready], status: room.status, host: room.host, isPublic: room.isPublic,
    state: room.state, last: room.last,
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
  // Re-randomize board on every new game/rematch so both seats get a different board
  room.boardIndex = Math.floor(Math.random() * BOARDS.length);
  const seatedNames = room.names.filter((_, i) => room.seats[i]);
  const seatedColors = room.colors.filter((_, i) => room.seats[i]);
  room.state = createGame({ boardIndex: room.boardIndex, names: seatedNames, colors: seatedColors });
  room.status = "playing";
  room.last = null;
  room.pending = null;
  // Reset ready for all seated players
  for (let i = 0; i < room.ready.length; i++) {
    if (room.seats[i]) room.ready[i] = false;
  }
}

function touch(room) {
  room.updatedAt = Date.now();
  room.version += 1;
}

async function handleApi(request, response, pathname, search) {
  const parts = pathname.split("/").filter(Boolean);

  if (parts[1] === "auth") {
    if (request.method !== "POST") return sendJson(response, 405, { error: "That auth action is not supported." });
    if (parts[2] === "register") {
      const body = await readJson(request);
      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");
      if (!validateUsername(username)) return sendJson(response, 400, { error: "Username must be 2–16 characters (letters, numbers, underscore)." });
      if (!validatePassword(password)) return sendJson(response, 400, { error: "Password must be at least 4 characters." });
      if (accounts.has(username.toLowerCase())) return sendJson(response, 409, { error: "That username is already taken." });
      const crypto = require("node:crypto");
      const salt = crypto.randomBytes(16);
      const hash = hashPassword(password, salt);
      accounts.set(username.toLowerCase(), { salt: salt.toString("hex"), hash: hash.toString("hex") });
      const token = createToken();
      sessions.set(token, { username, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      return sendJson(response, 201, { token, username });
    }
    if (parts[2] === "login") {
      const body = await readJson(request);
      const username = String(body.username ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const account = accounts.get(username);
      if (!account || !verifyPassword(password, account.salt, account.hash)) {
        return sendJson(response, 401, { error: "Invalid username or password." });
      }
      const token = createToken();
      sessions.set(token, { username, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      return sendJson(response, 200, { token, username });
    }
    return sendJson(response, 405, { error: "That auth action is not supported." });
  }

  if (parts[1] === "queue") {
    if (request.method !== "POST") return sendJson(response, 405, { error: "That queue action is not supported." });
    const body = await readJson(request);
    const token = body.token;
    const username = getUsernameFromToken(token);
    if (!username) return sendJson(response, 401, { error: "Invalid or expired token." });

    if (parts[2] === "leave") {
      // Remove from queue
      const idx = queue.findIndex(e => e.player === username);
      if (idx >= 0) queue.splice(idx, 1);
      // Also leave any public lobby room
      for (const [code, room] of rooms) {
        if (room.isPublic && room.status === "lobby") {
          const seatIdx = room.seats.findIndex((s, i) => s && room.names[i] === username);
          if (seatIdx >= 0) {
            room.seats[seatIdx] = false;
            room.names[seatIdx] = `Player ${seatIdx + 1}`;
            room.colors[seatIdx] = "";
            room.ready[seatIdx] = false;
            if (room.host === seatIdx) {
              const nextHost = room.seats.findIndex(s => s);
              room.host = nextHost >= 0 ? nextHost : 0;
            }
            touch(room);
            flush(room);
            if (!room.seats.some(s => s)) {
              rooms.delete(code);
            }
            return sendJson(response, 200, { left: true });
          }
        }
      }
      return sendJson(response, 200, { left: true });
    }

    // POST /api/queue - matchmaking
    // Check if player is already in queue
    if (queue.some(e => e.player === username)) {
      return sendJson(response, 409, { error: "You are already in the queue." });
    }
    // Check if player is already in a public room
    for (const [code, room] of rooms) {
      if (room.isPublic && room.status === "lobby" && room.seats.some((s, i) => s && room.names[i] === username)) {
        return sendJson(response, 409, { error: "You are already in a public room." });
      }
    }

    // Find existing queue entry to pair with
    const existingEntry = queue.find(e => e.player !== username);
    if (existingEntry) {
      // Pop the existing entry and join their room
      queue.splice(queue.indexOf(existingEntry), 1);
      const room = rooms.get(existingEntry.code);
      if (!room || room.status !== "lobby" || room.seats.filter(s => s).length >= 4) {
        // Room no longer valid, create new room instead
        const boardIndex = Math.floor(Math.random() * BOARDS.length);
        const newRoom = {
          code: makeCode(), boardIndex,
          seats: [true, false, false, false], names: [username, "", "", ""], colors: ["blue", "", "", ""], ready: [false, false, false, false],
          status: "lobby", host: 0, isPublic: true,
          version: 1, last: null, pending: null, waiters: [], state: null,
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        assignColors(newRoom);
        rooms.set(newRoom.code, newRoom);
        queue.push({ code: newRoom.code, player: username, createdAt: Date.now() });
        return sendJson(response, 200, { ...snapshot(newRoom, 0), player: 0, queued: true });
      }
      // Join the existing room
      const seatIndex = room.seats.findIndex(s => !s);
      room.seats[seatIndex] = true;
      room.names[seatIndex] = username;
      room.ready[seatIndex] = false;
      assignColors(room);
      touch(room);
      flush(room);
      // If room is now full (4 players), remove all its queue entries
      if (room.seats.filter(s => s).length === 4) {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].code === room.code) queue.splice(i, 1);
        }
      }
      return sendJson(response, 200, { ...snapshot(room, seatIndex), player: seatIndex, queued: false });
    } else {
      // No waiting entry, create new public room and add to queue
      const boardIndex = Math.floor(Math.random() * BOARDS.length);
      const newRoom = {
        code: makeCode(), boardIndex,
        seats: [true, false, false, false], names: [username, "", "", ""], colors: ["blue", "", "", ""], ready: [false, false, false, false],
        status: "lobby", host: 0, isPublic: true,
        version: 1, last: null, pending: null, waiters: [], state: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      assignColors(newRoom);
      rooms.set(newRoom.code, newRoom);
      queue.push({ code: newRoom.code, player: username, createdAt: Date.now() });
      return sendJson(response, 200, { ...snapshot(newRoom, 0), player: 0, queued: true });
    }
  }

  if (parts[1] === "riddles") return handleRiddleApi(request, response, parts);
  const code = (parts[2] || "").toUpperCase();
  const action = parts[3] || "";
  const room = code ? rooms.get(code) : null;

  if (request.method === "POST" && parts.length === 2) {
    const body = await readJson(request);
    // Require auth token for room creation
    const auth = request.headers.authorization;
    const username = auth && auth.startsWith("Bearer ") ? getUsernameFromToken(auth.slice(7)) : null;
    if (!username) return sendJson(response, 401, { error: "Authentication required to create a room." });
    // Server chooses the board — ignore any client-provided boardIndex
    const boardIndex = Math.floor(Math.random() * BOARDS.length);
    const name = cleanName(body.name, username);
    // Creator picks their color
    const color = body.color && DEFAULT_COLORS.includes(body.color) ? body.color : "blue";
    const created = {
      code: makeCode(), boardIndex,
      seats: [true, false, false, false], names: [name, "", "", ""], colors: [color, "", "", ""], ready: [false, false, false, false],
      status: "lobby", host: 0, isPublic: false,
      version: 1, last: null, pending: null, waiters: [], state: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    assignColors(created);
    rooms.set(created.code, created);
    return sendJson(response, 201, { ...snapshot(created, 0), player: 0 });
  }

  if (!room) return sendJson(response, 404, { error: "That room does not exist. Check the code and try again." });
  if (Date.now() - room.updatedAt > ROOM_TTL) { rooms.delete(room.code); return sendJson(response, 410, { error: "That room has expired." }); }

  if (request.method === "POST" && action === "join") {
    const body = await readJson(request);
    // Room must be in lobby state to join
    if (room.status !== "lobby") {
      return sendJson(response, 409, { error: "That room is no longer accepting players." });
    }
    // Check if already in room
    const existingIdx = room.seats.findIndex((s, i) => s && room.names[i] === body.name);
    if (existingIdx >= 0) {
      room.seats[existingIdx] = true;
      room.ready[existingIdx] = false;
      touch(room);
      flush(room);
      return sendJson(response, 200, { ...snapshot(room, existingIdx), player: existingIdx });
    }
    // Find free seat (max 4)
    const freeIdx = room.seats.findIndex(s => !s);
    if (freeIdx === -1 || room.seats.filter(s => s).length >= 4) {
      return sendJson(response, 409, { error: "That room is full (max 4 players)." });
    }
    const color = body.color && DEFAULT_COLORS.includes(body.color) ? body.color : getNextColor(room);
    if (room.colors.includes(color) && room.colors.filter((c, i) => c === color && room.seats[i]).length > 0) {
      return sendJson(response, 409, { error: "That color is already taken." });
    }
    room.seats[freeIdx] = true;
    room.names[freeIdx] = cleanName(body.name, `Player ${freeIdx + 1}`);
    room.colors[freeIdx] = color;
    room.ready[freeIdx] = false;
    // If room was in lobby and now has >=2 players, keep in lobby (host must start)
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, freeIdx), player: freeIdx });
  }

  if (request.method === "POST" && action === "ready") {
    const body = await readJson(request);
    const player = body.player === 1 ? 1 : 0; // For backward compat, but should use seat index
    // Find player's seat index
    const seatIdx = room.seats.findIndex((s, i) => s && (body.seatIndex !== undefined ? i === body.seatIndex : room.names[i] === body.name));
    if (seatIdx === -1) return sendJson(response, 409, { error: "You are not in this room." });
    if (room.status !== "lobby") return sendJson(response, 409, { error: "Cannot toggle ready outside lobby." });
    room.ready[seatIdx] = !room.ready[seatIdx];
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, seatIdx), player: seatIdx });
  }

  if (request.method === "POST" && action === "start") {
    const body = await readJson(request);
    const seatIdx = room.seats.findIndex((s, i) => s && room.names[i] === body.name);
    if (seatIdx === -1) return sendJson(response, 409, { error: "You are not in this room." });
    if (seatIdx !== room.host) return sendJson(response, 403, { error: "Only the host can start the game." });
    if (room.status !== "lobby") return sendJson(response, 409, { error: "Game already started or finished." });
    const seated = room.seats.filter(s => s).length;
    if (seated < 2) return sendJson(response, 409, { error: "Need at least 2 players to start." });
    // Check all non-host seats are ready (or auto-ready if only 2 players)
    const nonHostReady = room.seats.every((s, i) => !s || i === room.host || room.ready[i]);
    if (!nonHostReady) return sendJson(response, 409, { error: "All players must be ready before starting." });
    // Start game
    room.status = "playing";
    room.boardIndex = Math.floor(Math.random() * BOARDS.length);
    room.state = createGame({ boardIndex: room.boardIndex, names: room.names.filter((_, i) => room.seats[i]), colors: room.colors.filter((_, i) => room.seats[i]) });
    room.last = null;
    room.pending = null;
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, seatIdx), player: seatIdx });
  }

  if (request.method === "POST" && action === "rejoin") {
    const body = await readJson(request);
    // Find player's seat by name or index (including empty seats for rejoin)
    let seatIdx = room.seats.findIndex((s, i) => s && (body.seatIndex !== undefined ? i === body.seatIndex : room.names[i] === body.name));
    if (seatIdx === -1 && body.seatIndex !== undefined && body.seatIndex >= 0 && body.seatIndex < room.seats.length) {
      // Allow rejoining an empty seat by seatIndex
      seatIdx = body.seatIndex;
    }
    if (seatIdx === -1) {
      // Try legacy player index
      const legacyIdx = body.player === 1 ? 1 : 0;
      if (room.seats[legacyIdx]) {
        room.seats[legacyIdx] = true;
        if (body.name) room.names[legacyIdx] = cleanName(body.name, room.names[legacyIdx]);
        room.ready[legacyIdx] = false;
        touch(room);
        flush(room);
        return sendJson(response, 200, { ...snapshot(room, legacyIdx), player: legacyIdx });
      }
      return sendJson(response, 409, { error: "You are not in this room." });
    }
    room.seats[seatIdx] = true;
    if (body.name) room.names[seatIdx] = cleanName(body.name, room.names[seatIdx]);
    room.ready[seatIdx] = false;
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, seatIdx), player: seatIdx });
  }

  if (request.method === "POST" && action === "roll") {
    const body = await readJson(request);
    // Find player's seat index
    const seatIdx = room.seats.findIndex((s, i) => s && (body.seatIndex !== undefined ? i === body.seatIndex : room.names[i] === body.name));
    if (seatIdx === -1) return sendJson(response, 409, { error: "You are not in this room." });
    if (room.status !== "playing") return sendJson(response, 409, { error: "Game not started yet." });
    if (room.pending) return sendJson(response, 409, { error: "Resolve the pending snake riddle before rolling again." });
    if (room.state.winner !== null) return sendJson(response, 409, { error: "This game is already finished." });
    if (room.state.turn !== seatIdx) return sendJson(response, 409, { error: "It is not your turn yet." });
    const die = rollDie();
    const result = applyRoll(room.state, die);
    if (result.entry.type === "snake") {
      room.pending = { id: randomUUID(), player: seatIdx, die, from: result.entry.from, landed: result.entry.landed, to: result.entry.to };
      touch(room);
      flush(room);
      return sendJson(response, 200, { ...snapshot(room, seatIdx), player: seatIdx });
    }
    room.state = result.state;
    room.last = { die, player: result.entry.player, sequence: result.entry.sequence, type: result.entry.type, from: result.entry.from, landed: result.entry.landed, to: result.entry.to };
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, seatIdx), player: seatIdx });
  }

  if (request.method === "POST" && action === "resolve") {
    const body = await readJson(request);
    const seatIdx = room.seats.findIndex((s, i) => s && (body.seatIndex !== undefined ? i === body.seatIndex : room.names[i] === body.name));
    if (seatIdx === -1) return sendJson(response, 409, { error: "You are not in this room." });
    const pending = room.pending;
    if (!pending || pending.player !== seatIdx) return sendJson(response, 409, { error: "That snake turn is no longer waiting for you." });
    let rescued = false;
    if (body.choice === "riddle") {
      const challenge = riddles.get(body.riddleId);
      if (!challenge || !challenge.attempted || !challenge.correct || challenge.roomCode !== room.code || challenge.player !== seatIdx || challenge.pendingId !== pending.id || challenge.expiresAt <= Date.now()) {
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
    return sendJson(response, 200, { ...snapshot(room, seatIdx), player: seatIdx });
  }

  if (request.method === "POST" && action === "leave") {
    const body = await readJson(request);
    // Find player's seat by name or index
    const seatIdx = room.seats.findIndex((s, i) => s && (body.seatIndex !== undefined ? i === body.seatIndex : room.names[i] === body.name));
    if (seatIdx === -1) {
      // Try legacy player index
      const legacyIdx = body.player === 1 ? 1 : 0;
      if (room.seats[legacyIdx]) {
        room.seats[legacyIdx] = false;
        room.names[legacyIdx] = `Player ${legacyIdx + 1}`;
        room.colors[legacyIdx] = "";
        room.ready[legacyIdx] = false;
        // If host left, promote next seated player
        if (room.host === legacyIdx) {
          const nextHost = room.seats.findIndex(s => s);
          room.host = nextHost >= 0 ? nextHost : 0;
        }
        // If room empty, delete it
        if (!room.seats.some(s => s)) {
          rooms.delete(room.code);
        } else if (room.status === "playing") {
          freshState(room);
        }
        touch(room);
        flush(room);
        return sendJson(response, 200, { ...snapshot(room, legacyIdx), player: legacyIdx, left: true });
      }
      return sendJson(response, 409, { error: "You are not in this room." });
    }
    room.seats[seatIdx] = false;
    room.names[seatIdx] = `Player ${seatIdx + 1}`;
    room.colors[seatIdx] = "";
    room.ready[seatIdx] = false;
    // If host left, promote next seated player
    if (room.host === seatIdx) {
      const nextHost = room.seats.findIndex(s => s);
      room.host = nextHost >= 0 ? nextHost : 0;
    }
    // Remove from queue if this was a public lobby
    if (room.isPublic && room.status === "lobby") {
      const qIdx = queue.findIndex(e => e.code === room.code && e.player === body.name);
      if (qIdx >= 0) queue.splice(qIdx, 1);
    }
    // If room empty, delete it
    if (!room.seats.some(s => s)) {
      rooms.delete(room.code);
    } else if (room.status === "playing") {
      freshState(room);
    }
    touch(room);
    flush(room);
    return sendJson(response, 200, { ...snapshot(room, seatIdx), player: seatIdx, left: true });
  }

  if (request.method === "GET" && !action) {
    const since = Number(new URL(`http://local${search}`).searchParams.get("since"));
    const playerParam = new URL(`http://local${search}`).searchParams.get("player");
    // Support both legacy player index (0/1) and new seatIndex
    let player = 0;
    if (playerParam !== null) {
      const parsed = parseInt(playerParam, 10);
      if (!Number.isNaN(parsed)) player = parsed;
    }
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
      .catch(error => { 
        console.error("API Error:", error.message, error.stack);
        if (!response.writableEnded) sendJson(response, error.status || 400, { error: error.message || "That request could not be handled." }); 
      });
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
  // Clean up expired queue entries
  const queueCutoff = Date.now() - ROOM_TTL;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].createdAt < queueCutoff) queue.splice(i, 1);
  }
}, 60000);
sweep.unref();

server.listen(port, "0.0.0.0", () => console.log(`Snakes & Ladders is ready at http://0.0.0.0:${server.address().port}`));
