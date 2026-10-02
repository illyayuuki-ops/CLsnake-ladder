const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

function startTestServer() {
  const mock = path.join(__dirname, "mock-gemini.cjs");
  const options = {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: "0",
      GEMINI_API_KEY: "test-gemini-key",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${mock}`.trim(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  };
  const child = spawn(process.execPath, ["scripts/server.js"], options);
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
  return { child, ready };
}

async function request(origin, pathname, body) {
  const response = await fetch(`${origin}${pathname}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function makeRoom(origin, name) {
  const created = await request(origin, "/api/rooms", { name, boardIndex: 0 });
  assert.equal(created.status, 201);
  const joined = await request(origin, `/api/rooms/${created.data.code}/join`, { name: "Riddle friend" });
  assert.equal(joined.status, 200);
  return created.data.code;
}

async function rollToSnakeHead(origin, code) {
  for (const player of [0, 1, 0, 1, 0, 1]) {
    const result = await request(origin, `/api/rooms/${code}/roll`, { player });
    assert.equal(result.status, 200);
    assert.equal(result.data.pending, null);
  }
  const pending = await request(origin, `/api/rooms/${code}/roll`, { player: 0 });
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.data.pending && {
    player: pending.data.pending.player,
    die: pending.data.pending.die,
    landed: pending.data.pending.landed,
    to: pending.data.pending.to,
  }, { player: 0, die: 1, landed: 19, to: 5 });
  assert.equal(pending.data.state.totalRolls, 6);
  return pending.data.pending;
}

test("Gemini haiku challenges stay server-side and resolve shared snake turns", async t => {
  const { child, ready } = startTestServer();
  t.after(async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  });
  const origin = await ready;

  const slideRoom = await makeRoom(origin, "Ada");
  const slidePending = await rollToSnakeHead(origin, slideRoom);
  const wrongChallenge = await request(origin, "/api/riddles", {
    roomCode: slideRoom, player: 0, pendingId: slidePending.id,
  });
  assert.equal(wrongChallenge.status, 201);
  assert.equal(wrongChallenge.data.haiku.split(String.fromCharCode(10)).length, 3);
  assert.equal("answer" in wrongChallenge.data, false);
  assert.equal("acceptedAnswers" in wrongChallenge.data, false);
  const wrongAnswer = await request(origin, `/api/riddles/${wrongChallenge.data.id}/answer`, {
    roomCode: slideRoom, player: 0, pendingId: slidePending.id, answer: "the sun",
  });
  assert.deepEqual(wrongAnswer, { status: 200, data: { correct: false, answer: "moon" } });
  const slide = await request(origin, `/api/rooms/${slideRoom}/resolve`, {
    player: 0, choice: "slide", riddleId: wrongChallenge.data.id,
  });
  assert.equal(slide.status, 200);
  assert.equal(slide.data.pending, null);
  assert.equal(slide.data.state.players[0].position, 5);
  assert.equal(slide.data.state.players[0].slides, 1);
  assert.equal(slide.data.last.type, "snake");

  const rescueRoom = await makeRoom(origin, "Grace");
  const rescuePending = await rollToSnakeHead(origin, rescueRoom);
  const challenge = await request(origin, "/api/riddles", {
    roomCode: rescueRoom, player: 0, pendingId: rescuePending.id,
  });
  assert.equal(challenge.status, 201);
  const wrongSeat = await request(origin, `/api/riddles/${challenge.data.id}/answer`, {
    roomCode: rescueRoom, player: 1, pendingId: rescuePending.id, answer: "moon",
  });
  assert.equal(wrongSeat.status, 403);
  const answer = await request(origin, `/api/riddles/${challenge.data.id}/answer`, {
    roomCode: rescueRoom, player: 0, pendingId: rescuePending.id, answer: "the moon",
  });
  assert.deepEqual(answer, { status: 200, data: { correct: true } });
  const rescue = await request(origin, `/api/rooms/${rescueRoom}/resolve`, {
    player: 0, choice: "riddle", riddleId: challenge.data.id,
  });
  assert.equal(rescue.status, 200);
  assert.equal(rescue.data.pending, null);
  assert.equal(rescue.data.state.players[0].position, 19);
  assert.equal(rescue.data.state.players[0].slides, 0);
  assert.equal(rescue.data.state.history[0].type, "riddle");
  assert.equal(rescue.data.last.type, "riddle");
});
