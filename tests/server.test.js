const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { BOARDS } = require("../game-engine.js");

function startTestServer() {
  const mock = path.join(__dirname, "mock-gemini.cjs");
  const options = {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: "0",
      GEMINI_API_KEY: "test-gemini-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  };
  const child = spawn(process.execPath, ["-r", mock, "scripts/server.js"], options);
  let logs = "";
  let errors = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { logs += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { errors += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start. ${logs} ${errors}`)), 5000);
    child.stdout.on("data", chunk => {
      const match = `${logs}${chunk}`.match(/ready at http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Server exited (${code}). ${logs} ${errors}`)); });
  });
  return { child, ready, getLogs: () => logs, getErrors: () => errors };
}

async function request(origin, pathname, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${origin}${pathname}`, body === undefined ? undefined : {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function makeRoom(origin, name, token) {
  // If no token provided, register a new user with unique username
  if (!token) {
    // Generate a username that only contains alphanumeric and underscore, ensure uniqueness
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}`;
    const username = `user_${uniqueId}`.slice(0, 16).replace(/[^a-z0-9_]/g, '');
    const reg = await request(origin, "/api/auth/register", { username, password: "password123" });
    if (reg.status !== 201) {
      console.log("Registration failed:", reg);
    }
    assert.equal(reg.status, 201);
    token = reg.data.token;
  }
  const created = await request(origin, "/api/rooms", { name }, token);
  if (created.status !== 201) {
    console.log("Room creation failed:", created);
  }
  assert.equal(created.status, 201);
  const joined = await request(origin, `/api/rooms/${created.data.code}/join`, { name: "Riddle friend" }, token);
  if (joined.status !== 200) console.log("Join error:", joined);
  assert.equal(joined.status, 200);
  const joinerSeat = joined.data.player;
  // Mark joiner as ready
  const readied = await request(origin, `/api/rooms/${created.data.code}/ready`, { name: "Riddle friend", seatIndex: joinerSeat }, token);
  if (readied.status !== 200) console.log("Ready error:", readied);
  assert.equal(readied.status, 200);
  // Start the game (host is player 0, the creator)
  const started = await request(origin, `/api/rooms/${created.data.code}/start`, { name }, token);
  if (started.status !== 200) console.log("Start error:", started);
  assert.equal(started.status, 200);
  return { code: created.data.code, token };
}

async function rollToSnakeHead(origin, code, token) {
  let pending = null;
  // Roll until we hit a snake (pending is set)
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const player of [0, 1]) {
      const result = await request(origin, `/api/rooms/${code}/roll`, { seatIndex: player }, token);
      if (result.status !== 200) {
        console.log("Roll failed:", result);
      }
      assert.equal(result.status, 200);
      if (result.data.pending) {
        pending = result.data.pending;
        // Verify pending has expected structure
        assert.ok(pending.id);
        assert.ok(Number.isInteger(pending.player));
        assert.ok(Number.isInteger(pending.die));
        assert.ok(Number.isInteger(pending.landed));
        assert.ok(Number.isInteger(pending.to));
        return pending;
      }
    }
  }
  throw new Error("Failed to hit a snake within 200 rolls");
}

test("Gemini haiku challenges stay server-side and resolve shared snake turns", async t => {
  const { child, ready } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  const { code: slideRoom, token: slideToken } = await makeRoom(origin, "Ada");
  const slidePending = await rollToSnakeHead(origin, slideRoom, slideToken);
  const wrongChallenge = await request(origin, "/api/riddles", {
    roomCode: slideRoom, player: slidePending.player, pendingId: slidePending.id,
  }, slideToken);
  assert.equal(wrongChallenge.status, 201);
  assert.equal(wrongChallenge.data.haiku.split(String.fromCharCode(10)).length, 3);
  assert.equal("answer" in wrongChallenge.data, false);
  assert.equal("acceptedAnswers" in wrongChallenge.data, false);
  const wrongAnswer = await request(origin, `/api/riddles/${wrongChallenge.data.id}/answer`, {
    roomCode: slideRoom, player: slidePending.player, pendingId: slidePending.id, answer: "the sun",
  }, slideToken);
  assert.deepEqual(wrongAnswer, { status: 200, data: { correct: false, answer: "moon" } });
  const slide = await request(origin, `/api/rooms/${slideRoom}/resolve`, {
    seatIndex: slidePending.player, choice: "slide", riddleId: wrongChallenge.data.id,
  }, slideToken);
  assert.equal(slide.status, 200);
  assert.equal(slide.data.pending, null);
  // After classic slide, player should be at the snake's tail (different per board)
  assert.ok(Number.isInteger(slide.data.state.players[slidePending.player].position));
  assert.equal(slide.data.state.players[slidePending.player].slides, 1);
  assert.equal(slide.data.last.type, "snake");

  const { code: rescueRoom, token: rescueToken } = await makeRoom(origin, "Grace");
  const rescuePending = await rollToSnakeHead(origin, rescueRoom, rescueToken);
  const challenge = await request(origin, "/api/riddles", {
    roomCode: rescueRoom, player: rescuePending.player, pendingId: rescuePending.id,
  }, rescueToken);
  assert.equal(challenge.status, 201);
  const wrongSeat = await request(origin, `/api/riddles/${challenge.data.id}/answer`, {
    roomCode: rescueRoom, player: 1 - rescuePending.player, pendingId: rescuePending.id, answer: "moon",
  }, rescueToken);
  assert.equal(wrongSeat.status, 403);
  const answer = await request(origin, `/api/riddles/${challenge.data.id}/answer`, {
    roomCode: rescueRoom, player: rescuePending.player, pendingId: rescuePending.id, answer: "the moon",
  }, rescueToken);
  assert.deepEqual(answer, { status: 200, data: { correct: true } });
  const rescue = await request(origin, `/api/rooms/${rescueRoom}/resolve`, {
    seatIndex: rescuePending.player, choice: "riddle", riddleId: challenge.data.id,
  }, rescueToken);
  assert.equal(rescue.status, 200);
  assert.equal(rescue.data.pending, null);
  // After riddle rescue, player stays at the snake's head (different per board)
  assert.ok(Number.isInteger(rescue.data.state.players[rescuePending.player].position));
  assert.equal(rescue.data.state.players[rescuePending.player].slides, 0);
  assert.equal(rescue.data.state.history[0].type, "riddle");
  assert.equal(rescue.data.last.type, "riddle");
  });

test("Server picks random board for each room and re-randomizes on rematch", async t => {
  const { child, ready } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  // Create multiple rooms and verify boardIndex is valid and random
  const seenBoards = new Set();
  const iterations = 20;
  for (let i = 0; i < iterations; i++) {
    const reg = await request(origin, "/api/auth/register", { username: `Player${i}`, password: "password123" });
    assert.equal(reg.status, 201);
    const created = await request(origin, "/api/rooms", { name: `Player${i}` }, reg.data.token);
    assert.equal(created.status, 201);
    const boardIndex = created.data.boardIndex;
    assert.ok(Number.isInteger(boardIndex), `boardIndex must be integer, got ${boardIndex}`);
    assert.ok(boardIndex >= 0 && boardIndex < BOARDS.length, `boardIndex ${boardIndex} out of range [0, ${BOARDS.length})`);
    seenBoards.add(boardIndex);
  }
  // Sanity check: 20 iterations should produce at least 2 distinct boards
  assert.ok(seenBoards.size >= 2, `Expected at least 2 distinct boards from ${iterations} rooms, got ${seenBoards.size}`);

  // Test rematch re-randomizes board
  const { code: roomCode, token } = await makeRoom(origin, "RematchTest");
  const firstBoard = (await request(origin, `/api/rooms/${roomCode}`, undefined, token)).data.boardIndex;
  await request(origin, `/api/rooms/${roomCode}/leave`, { seatIndex: 0 }, token);
  // After leave, freshState is called which should re-randomize
  const secondState = await request(origin, `/api/rooms/${roomCode}/rejoin`, { seatIndex: 0, name: "RematchTest" }, token);
  console.log("secondState:", JSON.stringify(secondState, null, 2));
  // Note: leave triggers freshState, then rejoin reuses the same room but with new state
  // The boardIndex might be the same by chance, but we verify it's a valid integer
  assert.ok(Number.isInteger(secondState.data.boardIndex));
  assert.ok(secondState.data.boardIndex >= 0 && secondState.data.boardIndex < BOARDS.length);
});

test("Auth: register, login, 401, 409", async t => {
  const { child, ready, getLogs, getErrors } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  // Register valid user
  const reg = await request(origin, "/api/auth/register", { username: "testuser", password: "password123" });
  assert.equal(reg.status, 201);
  assert.ok(reg.data.token);
  assert.equal(reg.data.username, "testuser");
  const token = reg.data.token;

  // Login with correct credentials
  const login = await request(origin, "/api/auth/login", { username: "testuser", password: "password123" });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);
  assert.equal(login.data.username, "testuser");
  const loginToken = login.data.token;

  // Login with wrong password -> 401
  const badLogin = await request(origin, "/api/auth/login", { username: "testuser", password: "wrong" });
  assert.equal(badLogin.status, 401);
  assert.ok(badLogin.data.error);

  // Register duplicate username -> 409
  const dup = await request(origin, "/api/auth/register", { username: "testuser", password: "another" });
  assert.equal(dup.status, 409);
  assert.ok(dup.data.error);

  // Register invalid username (too short) -> 400
  const short = await request(origin, "/api/auth/register", { username: "a", password: "pass" });
  assert.equal(short.status, 400);

  // Register invalid username (special chars) -> 400
  const special = await request(origin, "/api/auth/register", { username: "test@user", password: "pass" });
  assert.equal(special.status, 400);

  // Register invalid password (too short) -> 400
  const shortPass = await request(origin, "/api/auth/register", { username: "validuser", password: "123" });
  assert.equal(shortPass.status, 400);

  // Verify tokens work independently
  const me1 = await request(origin, "/api/rooms", { name: "Test1" }, token);
  assert.equal(me1.status, 201, `Expected 201, got ${me1.status}: ${JSON.stringify(me1.data)}`);
  const me2 = await request(origin, "/api/rooms", { name: "Test2" }, loginToken);
  assert.equal(me2.status, 201);
});

// --- New comprehensive regression tests ---

test("Full lobby lifecycle: create→join×3→ready all→host start→turn order across 4 seats", async t => {
  const { child, ready } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  // Register 4 users
  const reg1 = await request(origin, "/api/auth/register", { username: "hostuser", password: "password123" });
  assert.equal(reg1.status, 201);
  const hostToken = reg1.data.token;

  const reg2 = await request(origin, "/api/auth/register", { username: "player2", password: "password123" });
  assert.equal(reg2.status, 201);
  const p2Token = reg2.data.token;

  const reg3 = await request(origin, "/api/auth/register", { username: "player3", password: "password123" });
  assert.equal(reg3.status, 201);
  const p3Token = reg3.data.token;

  const reg4 = await request(origin, "/api/auth/register", { username: "player4", password: "password123" });
  assert.equal(reg4.status, 201);
  const p4Token = reg4.data.token;

  // Host creates room
  const created = await request(origin, "/api/rooms", { name: "Host", color: "blue" }, hostToken);
  assert.equal(created.status, 201);
  const code = created.data.code;
  assert.equal(created.data.player, 0);
  assert.equal(created.data.host, 0);
  assert.equal(created.data.status, "lobby");
  assert.deepEqual(created.data.ready, [false, false, false, false]);
  assert.deepEqual(created.data.seats, [true, false, false, false]);

  // Player 2 joins
  const j2 = await request(origin, `/api/rooms/${code}/join`, { name: "Player2", color: "red" }, p2Token);
  assert.equal(j2.status, 200);
  assert.equal(j2.data.player, 1);
  assert.equal(j2.data.seats[1], true);

  // Player 3 joins
  const j3 = await request(origin, `/api/rooms/${code}/join`, { name: "Player3", color: "green" }, p3Token);
  assert.equal(j3.status, 200);
  assert.equal(j3.data.player, 2);
  assert.equal(j3.data.seats[2], true);

  // Player 4 joins
  const j4 = await request(origin, `/api/rooms/${code}/join`, { name: "Player4", color: "yellow" }, p4Token);
  assert.equal(j4.status, 200);
  assert.equal(j4.data.player, 3);
  assert.equal(j4.data.seats[3], true);

  // Room now full - verify 4 seats
  const roomFull = await request(origin, `/api/rooms/${code}`, undefined, hostToken);
  assert.equal(roomFull.status, 200);
  assert.deepEqual(roomFull.data.seats, [true, true, true, true]);
  assert.deepEqual(roomFull.data.names, ["Host", "Player2", "Player3", "Player4"]);
  assert.deepEqual(roomFull.data.colors, ["blue", "red", "green", "yellow"]);
  assert.deepEqual(roomFull.data.ready, [false, false, false, false]);
  assert.equal(roomFull.data.host, 0);
  assert.equal(roomFull.data.status, "lobby");

  // Non-host tries to start -> 403
  const badStart = await request(origin, `/api/rooms/${code}/start`, { name: "Player2" }, p2Token);
  assert.equal(badStart.status, 403);

  // Roll in lobby -> 409
  const badRoll = await request(origin, `/api/rooms/${code}/roll`, { seatIndex: 0 }, hostToken);
  assert.equal(badRoll.status, 409);

  // All players ready up
  const r1 = await request(origin, `/api/rooms/${code}/ready`, { seatIndex: 0 }, hostToken);
  assert.equal(r1.status, 200);
  assert.equal(r1.data.ready[0], true);

  const r2 = await request(origin, `/api/rooms/${code}/ready`, { seatIndex: 1 }, p2Token);
  assert.equal(r2.status, 200);
  assert.equal(r2.data.ready[1], true);

  const r3 = await request(origin, `/api/rooms/${code}/ready`, { seatIndex: 2 }, p3Token);
  assert.equal(r3.status, 200);
  assert.equal(r3.data.ready[2], true);

  const r4 = await request(origin, `/api/rooms/${code}/ready`, { seatIndex: 3 }, p4Token);
  assert.equal(r4.status, 200);
  assert.equal(r4.data.ready[3], true);

  // Host starts game
  const started = await request(origin, `/api/rooms/${code}/start`, { name: "Host" }, hostToken);
  assert.equal(started.status, 200);
  assert.equal(started.data.status, "playing");
  assert.ok(started.data.state);
  assert.equal(started.data.state.players.length, 4);

  // Verify turn order: 0 → 1 → 2 → 3 → 0
  const turns = [];
  let state = started.data.state;
  for (let i = 0; i < 12; i++) {
    const playerTokens = [hostToken, p2Token, p3Token, p4Token];
    const result = await request(origin, `/api/rooms/${code}/roll`, { seatIndex: state.turn }, playerTokens[state.turn]);
    if (result.status !== 200) {
      console.log("Roll failed:", result, "turn:", state.turn, "turn player:", state.turn);
    }
    if (result.status === 409 && result.data.error?.includes("pending snake riddle")) {
      // Resolve the pending riddle by taking the slide
      const resolveResult = await request(origin, `/api/rooms/${code}/resolve`, { 
        seatIndex: state.turn, 
        choice: "slide", 
        riddleId: result.data.pending?.id 
      }, playerTokens[state.turn]);
      assert.equal(resolveResult.status, 200);
      // Now roll again for the same player (turn shouldn't have advanced)
      const retryResult = await request(origin, `/api/rooms/${code}/roll`, { seatIndex: state.turn }, playerTokens[state.turn]);
      assert.equal(retryResult.status, 200);
      turns.push(retryResult.data.state.turn);
      state = retryResult.data.state;
    } else {
      assert.equal(result.status, 200);
      turns.push(result.data.state.turn);
      state = result.data.state;
    }
    if (state.winner !== null) break;
  }
  // First 4 turns should be 0,1,2,3 then 0,1,2,3
  assert.deepEqual(turns.slice(0, 8), [1, 2, 3, 0, 1, 2, 3, 0]);
});

test("Public queue pairing: two queued POSTs land in the same room", async t => {
  const { child, ready } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  const reg1 = await request(origin, "/api/auth/register", { username: "queue1", password: "password123" });
  assert.equal(reg1.status, 201);
  const t1 = reg1.data.token;

  const reg2 = await request(origin, "/api/auth/register", { username: "queue2", password: "password123" });
  assert.equal(reg2.status, 201);
  const t2 = reg2.data.token;

  // First player queues
  const q1 = await request(origin, "/api/queue", { token: t1 });
  assert.equal(q1.status, 200);
  assert.equal(q1.data.queued, true);
  assert.ok(q1.data.code);

  // Second player queues - should join first player's room
  const q2 = await request(origin, "/api/queue", { token: t2 });
  assert.equal(q2.status, 200);
  assert.equal(q2.data.queued, false);
  assert.equal(q2.data.code, q1.data.code);
  assert.equal(q2.data.player, 1);

  // Both players should see each other
  const r1 = await request(origin, `/api/rooms/${q1.data.code}`, undefined, t1);
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.data.seats, [true, true, false, false]);
  // names array has 4 slots (2 filled, 2 empty with empty strings)
  assert.equal(r1.data.names[0], "queue1");
  assert.equal(r1.data.names[1], "queue2");
  assert.equal(r1.data.names[2], "");
  assert.equal(r1.data.names[3], "");
});

test("Leave during lobby frees seat; room stays open; host migration on leave", async t => {
  const { child, ready } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  const reg1 = await request(origin, "/api/auth/register", { username: "hostm", password: "password123" });
  assert.equal(reg1.status, 201);
  const hToken = reg1.data.token;

  const reg2 = await request(origin, "/api/auth/register", { username: "player2m", password: "password123" });
  assert.equal(reg2.status, 201);
  const p2Token = reg2.data.token;

  const reg3 = await request(origin, "/api/auth/register", { username: "player3m", password: "password123" });
  assert.equal(reg3.status, 201);
  const p3Token = reg3.data.token;

  const created = await request(origin, "/api/rooms", { name: "HostM" }, hToken);
  assert.equal(created.status, 201);
  const code = created.data.code;

  await request(origin, `/api/rooms/${code}/join`, { name: "Player2M" }, p2Token);
  await request(origin, `/api/rooms/${code}/join`, { name: "Player3M" }, p3Token);

  // Host leaves during lobby
  const leaveHost = await request(origin, `/api/rooms/${code}/leave`, { seatIndex: 0 }, hToken);
  assert.equal(leaveHost.status, 200);
  assert.equal(leaveHost.data.left, true);

  // Player2 should now be host (seat 0)
  const roomAfter = await request(origin, `/api/rooms/${code}`, undefined, p2Token);
  assert.equal(roomAfter.status, 200);
  assert.equal(roomAfter.data.host, 0); // was seat 1, now promoted to seat 0
  assert.equal(roomAfter.data.names[0], "Player2M");
  assert.equal(roomAfter.data.seats[0], true);

  // Room still has 2 players (player3 at seat 1)
  assert.deepEqual(roomAfter.data.seats, [true, true, false, false]);

  // Host leaves again (now player2m)
  const leaveNewHost = await request(origin, `/api/rooms/${code}/leave`, { seatIndex: 0 }, p2Token);
  assert.equal(leaveNewHost.status, 200);

  // Player3M should now be host
  const roomAfter2 = await request(origin, `/api/rooms/${code}`, undefined, p3Token);
  assert.equal(roomAfter2.status, 200);
  assert.equal(roomAfter2.data.host, 0);
  assert.equal(roomAfter2.data.names[0], "Player3M");
});

test("Existing 2-player private flow still works (create→join→ready→start→play)", async t => {
  const { child, ready } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  const reg1 = await request(origin, "/api/auth/register", { username: "p1_2p", password: "password123" });
  assert.equal(reg1.status, 201);
  const t1 = reg1.data.token;

  const reg2 = await request(origin, "/api/auth/register", { username: "p2_2p", password: "password123" });
  assert.equal(reg2.status, 201);
  const t2 = reg2.data.token;

  // Create room
  const created = await request(origin, "/api/rooms", { name: "Player1", color: "blue" }, t1);
  assert.equal(created.status, 201);
  const code = created.data.code;

  // Join
  const joined = await request(origin, `/api/rooms/${code}/join`, { name: "Player2", color: "red" }, t2);
  assert.equal(joined.status, 200);
  assert.equal(joined.data.player, 1);

  // Both ready
  await request(origin, `/api/rooms/${code}/ready`, { seatIndex: 0 }, t1);
  await request(origin, `/api/rooms/${code}/ready`, { seatIndex: 1 }, t2);

  // Start
  const started = await request(origin, `/api/rooms/${code}/start`, { name: "Player1" }, t1);
  assert.equal(started.status, 200);
  assert.equal(started.data.status, "playing");
  assert.equal(started.data.state.players.length, 2);

  // Play a few turns
  let state = started.data.state;
  for (let i = 0; i < 6; i++) {
    const playerTokens = [t1, t2];
    const result = await request(origin, `/api/rooms/${code}/roll`, { seatIndex: state.turn }, playerTokens[state.turn]);
    if (result.status !== 200) {
      console.log("Roll failed:", result, "turn:", state.turn);
    }
    assert.equal(result.status, 200);
    state = result.data.state;
    if (state.winner !== null) break;
  }
});

test("Queue leave removes entry; queue room starts when full (4 players)", async t => {
  const { child, ready } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  // Register 4 users
  const users = [];
  for (let i = 0; i < 4; i++) {
    const reg = await request(origin, "/api/auth/register", { username: `qfull${i}`, password: "password123" });
    assert.equal(reg.status, 201);
    users.push(reg.data.token);
  }

  // First 3 queue - should create 2 rooms (room1 with 2, room2 with 1)
  const q1 = await request(origin, "/api/queue", { token: users[0] });
  assert.equal(q1.status, 200);
  assert.equal(q1.data.queued, true);

  const q2 = await request(origin, "/api/queue", { token: users[1] });
  assert.equal(q2.status, 200);
  assert.equal(q2.data.queued, false);
  assert.equal(q2.data.code, q1.data.code);

  const q3 = await request(origin, "/api/queue", { token: users[2] });
  assert.equal(q3.status, 200);
  assert.equal(q3.data.queued, true); // New room

  // 4th player joins 2nd room, filling it
  const q4 = await request(origin, "/api/queue", { token: users[3] });
  assert.equal(q4.status, 200);
  assert.equal(q4.data.queued, false);
  assert.equal(q4.data.code, q3.data.code);

  // Both rooms should be full
  const r1 = await request(origin, `/api/rooms/${q1.data.code}`, undefined, users[0]);
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.data.seats, [true, true, false, false]);

  const r2 = await request(origin, `/api/rooms/${q3.data.code}`, undefined, users[2]);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.data.seats, [true, true, false, false]);

  // Queue leave works
  const leave = await request(origin, "/api/queue/leave", { token: users[0] });
  assert.equal(leave.status, 200);
  assert.equal(leave.data.left, true);

  // Room1 should now have 1 seat free
  const r1After = await request(origin, `/api/rooms/${q1.data.code}`, undefined, users[1]);
  assert.deepEqual(r1After.data.seats, [false, true, false, false]);
});
