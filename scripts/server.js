/* A small static development server plus in-memory online rooms. No build step, no dependencies.
 * Rooms are deliberately simple: the server owns the dice and the turn, so two devices stay in step.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createGame, applyRoll, rollDie } = require("../game-engine.js");

const root = path.resolve(__dirname, "..");
const portFlag = process.argv.indexOf("--port");
const port = Number(process.env.PORT || (portFlag >= 0 ? process.argv[portFlag + 1] : 5173));
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
};

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL = 45 * 60 * 1000;
const POLL_HOLD = 12000;
const rooms = new Map();

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

function snapshot(room, player) {
  return {
    code: room.code, version: room.version, boardIndex: room.boardIndex,
    player, seats: [...room.seats], names: [...room.names], state: room.state, last: room.last,
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
}

function touch(room) {
  room.updatedAt = Date.now();
  room.version += 1;
}

async function handleApi(request, response, pathname, search) {
  const parts = pathname.split("/").filter(Boolean);
  const code = (parts[2] || "").toUpperCase();
  const action = parts[3] || "";
  const room = code ? rooms.get(code) : null;

  if (request.method === "POST" && parts.length === 2) {
    const body = await readJson(request);
    const boardIndex = Number.isInteger(body.boardIndex) ? Math.min(Math.max(body.boardIndex, 0), 19) : 0;
    const name = cleanName(body.name, "Player 1");
    const created = {
      code: makeCode(), boardIndex, seats: [true, false], names: [name, "Player 2"],
      version: 1, last: null, waiters: [], state: null,
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
    if (room.state.winner !== null) return sendJson(response, 409, { error: "This game is already finished." });
    if (room.state.turn !== player) return sendJson(response, 409, { error: "It is not your turn yet." });
    const die = rollDie();
    const result = applyRoll(room.state, die);
    room.state = result.state;
    room.last = { die, player: result.entry.player, sequence: result.entry.sequence, type: result.entry.type, from: result.entry.from, landed: result.entry.landed, to: result.entry.to };
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
      .catch(error => { if (!response.writableEnded) sendJson(response, 400, { error: error.message || "That request could not be handled." }); });
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
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
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

server.listen(port, "0.0.0.0", () => console.log(`Snakes & Ladders is ready at http://0.0.0.0:${port}`));
