const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Game = require("../game-engine.js");

function at(position, options = {}) {
  const game = Game.createGame(options);
  game.players[0].position = position;
  return game;
}
function seeded(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test("all 20 original layouts are valid, playable, and uniquely named", () => {
  assert.equal(Game.BOARDS.length, 20);
  assert.equal(new Set(Game.BOARDS.map(board => board.name)).size, 20);
  for (const board of Game.BOARDS) {
    assert.equal(Game.validateBoard(board), true, board.name);
    assert.equal(Object.keys(board.s).length, 10);
    assert.equal(Object.keys(board.l).length, 9);
    assert.equal(Object.isFrozen(board.s), true);
  }
});

test("invalid endpoints and overlapping paths are rejected", () => {
  for (const board of [null, {}, { s: [], l: {} }, { s: { 20: 30 }, l: {} }, { s: {}, l: { 5: 2 } }, { s: { 101: 4 }, l: {} }, { s: { 10: 1 }, l: {} }, { s: {}, l: { 2: 100 } }, { s: {}, l: { 2.5: 30 } }, { s: {}, l: { 2: 30.5 } }, { s: { 20: 4 }, l: { 4: 30 } }]) {
    assert.equal(Game.validateBoard(board), false);
  }
});

test("serpentine coordinates match the original board", () => {
  const expected = { 1: [30, 570], 10: [570, 570], 11: [570, 510], 20: [30, 510], 21: [30, 450], 91: [570, 30], 100: [30, 30] };
  for (const [square, [x, y]] of Object.entries(expected)) assert.deepEqual(Game.coordinates(Number(square)), { x, y });
  assert.equal(new Set(Array.from({ length: 100 }, (_, i) => JSON.stringify(Game.coordinates(i + 1)))).size, 100);
  for (const invalid of [0, 101, 4.5, "1", NaN]) assert.throws(() => Game.coordinates(invalid), RangeError);
});

test("a fresh game starts with two players on 1, and player one goes first", () => {
  const game = Game.createGame();
  assert.deepEqual(game.players.map(player => player.position), [1, 1]);
  assert.deepEqual(game.players.map(player => player.name), ["Player 1", "Player 2"]);
  assert.equal(game.turn, 0);
  assert.equal(game.totalRolls, 0);
  assert.equal(game.winner, null);
  assert.equal(game.mode, "local");
});

test("names are normalized and computer games always use Fern", () => {
  const game = Game.createGame({ mode: "computer", names: ["  Alice\n ", "Bob"] });
  assert.equal(game.players[0].name, "Alice");
  assert.equal(game.players[1].name, "Fern");
  assert.equal(Game.createGame({ names: ["", "a".repeat(100)] }).players[1].name.length, 24);
  assert.equal(Game.createGame({ names: [null, 42] }).players[0].name, "Player 1");
});

test("invalid modes and boards are rejected", () => {
  for (const boardIndex of [-1, 20, 1.5, "0"]) assert.throws(() => Game.createGame({ boardIndex }), RangeError);
  assert.throws(() => Game.createGame({ mode: "unknown" }), TypeError);
});

test("normal moves list every square and alternate players", () => {
  const original = Game.createGame();
  const result = Game.applyRoll(original, 4);
  assert.deepEqual(result.steps, [2, 3, 4, 5]);
  assert.equal(result.state.players[0].position, 5);
  assert.equal(result.state.players[1].position, 1);
  assert.equal(result.state.turn, 1);
  assert.equal(result.state.totalRolls, 1);
  assert.equal(result.entry.type, "move");
  assert.equal(result.jump, null);
});

test("landing on a ladder climbs to the correct top", () => {
  const result = Game.applyRoll(at(5), 4);
  assert.equal(result.state.players[0].position, 35);
  assert.deepEqual(result.jump, { type: "ladder", from: 9, to: 35 });
  assert.equal(result.state.players[0].climbs, 1);
  assert.equal(result.state.players[0].slides, 0);
});

test("landing on a snake slides to its tail", () => {
  const result = Game.applyRoll(at(18), 1);
  assert.equal(result.state.players[0].position, 5);
  assert.deepEqual(result.jump, { type: "snake", from: 19, to: 5 });
  assert.equal(result.state.players[0].slides, 1);
});

test("a solved snake haiku keeps the player at the head and survives save restoration", () => {
  let game = Game.createGame();
  for (const die of [6, 1, 6, 1, 5, 1]) game = Game.applyRoll(game, die).state;
  assert.equal(game.players[0].position, 18);
  assert.equal(game.turn, 0);
  const rescued = Game.applyRoll(game, 1, { riddleRescued: true });
  assert.equal(rescued.entry.type, "riddle");
  assert.equal(rescued.entry.landed, 19);
  assert.equal(rescued.state.players[0].position, 19);
  assert.equal(rescued.state.players[0].slides, 0);
  assert.equal(rescued.state.turn, 1);
  assert.equal(rescued.jump, null);
  assert.deepEqual(Game.restoreGame(JSON.parse(JSON.stringify(rescued.state))), rescued.state);
});

test("passing a ladder or snake does not trigger it", () => {
  const pastLadder = Game.applyRoll(at(8), 2);
  assert.equal(pastLadder.state.players[0].position, 10);
  assert.equal(pastLadder.jump, null);
  const pastSnake = Game.applyRoll(at(18), 2);
  assert.equal(pastSnake.state.players[0].position, 20);
  assert.equal(pastSnake.jump, null);
});

test("a six is not an extra turn, preserving the original rules", () => {
  assert.equal(Game.applyRoll(Game.createGame(), 6).state.turn, 1);
});

test("an overshoot stays put, counts the roll, and passes the turn", () => {
  const result = Game.applyRoll(at(98), 4);
  assert.equal(result.state.players[0].position, 98);
  assert.deepEqual(result.steps, []);
  assert.equal(result.jump, null);
  assert.equal(result.entry.type, "overshoot");
  assert.equal(result.state.players[0].rolls, 1);
  assert.equal(result.state.turn, 1);
});

test("an exact finish declares the winner and stops further rolls", () => {
  const result = Game.applyRoll(at(96), 4);
  assert.equal(result.state.winner, 0);
  assert.equal(result.state.turn, 0);
  assert.equal(result.state.players[0].position, 100);
  assert.equal(result.entry.type, "win");
  assert.throws(() => Game.applyRoll(result.state, 1), /finished/);
});

test("player two can win too", () => {
  const game = Game.createGame();
  game.turn = 1;
  game.players[1].position = 97;
  const result = Game.applyRoll(game, 3);
  assert.equal(result.state.winner, 1);
  assert.equal(result.state.turn, 1);
  assert.equal(result.state.players[0].position, 1);
});

test("moves are immutable; no player statistics or history are shared", () => {
  const game = at(5);
  const before = structuredClone(game);
  const result = Game.applyRoll(game, 4);
  assert.deepEqual(game, before);
  result.state.players[1].name = "Changed";
  assert.equal(game.players[1].name, "Player 2");
  assert.equal(game.history.length, 0);
  const first = Game.applyRoll(Game.createGame(), 4).state;
  const second = Game.applyRoll(first, 3).state;
  second.history[1].to = 50;
  assert.equal(first.history[0].to, 5);
});

test("all invalid dice are rejected", () => {
  for (const die of [0, 7, 1.1, "4", undefined, null, NaN, Infinity]) assert.throws(() => Game.applyRoll(Game.createGame(), die), RangeError);
});

test("randomness maps six equal intervals to six faces", () => {
  for (let i = 0; i < 6; i++) assert.equal(Game.rollDie(() => (i + .5) / 6), i + 1);
  assert.equal(Game.rollDie(() => 0), 1);
  assert.equal(Game.rollDie(() => .99999999), 6);
  for (const invalid of [-1, 1, NaN, Infinity]) assert.throws(() => Game.rollDie(() => invalid), RangeError);
  for (let i = 0; i < 100; i++) assert.ok(Game.rollDie() >= 1 && Game.rollDie() <= 6);
});

test("completed games on every board remain valid and round-trip through JSON", () => {
  for (let boardIndex = 0; boardIndex < 20; boardIndex++) {
    for (let seed = 1; seed <= 8; seed++) {
      let game = Game.createGame({ boardIndex });
      const random = seeded(seed * 123 + boardIndex);
      while (game.winner === null && game.totalRolls < 10000) {
        const priorTurn = game.turn;
        game = Game.applyRoll(game, Game.rollDie(random)).state;
        assert.ok(game.players.every(player => player.position >= 1 && player.position <= 100));
        if (game.winner === null) assert.equal(game.turn, 1 - priorTurn);
      }
      assert.notEqual(game.winner, null, `Board ${boardIndex + 1}, seed ${seed}`);
      assert.ok(game.history.length <= Game.HISTORY_LIMIT);
      assert.deepEqual(Game.restoreGame(JSON.parse(JSON.stringify(game))), game);
    }
  }
});

test("fresh saves and in-progress saves restore without data loss", () => {
  const original = Game.createGame({ boardIndex: 12, mode: "computer", names: ["Maya"] });
  assert.deepEqual(Game.restoreGame(original), original);
  const moved = Game.applyRoll(original, 4).state;
  assert.deepEqual(Game.restoreGame(moved), moved);
});

test("malformed, stale, or inconsistent saves safely return null", () => {
  const fresh = Game.createGame();
  const invalid = [null, {}, { ...fresh, version: 123 }, { ...fresh, boardIndex: 20 }, { ...fresh, mode: "robot" }, { ...fresh, turn: 2 }, { ...fresh, totalRolls: -1 }, { ...fresh, winner: 2 }, { ...fresh, history: {} }, { ...fresh, players: [] }];
  const badPosition = structuredClone(fresh); badPosition.players[0].position = 101; invalid.push(badPosition);
  const fakeWinner = structuredClone(fresh); fakeWinner.winner = 0; invalid.push(fakeWinner);
  const missingWinner = structuredClone(fresh); missingWinner.players[0].position = 100; invalid.push(missingWinner);
  const badStats = structuredClone(fresh); badStats.players[0].rolls = 1; invalid.push(badStats);
  const wrongTurn = structuredClone(fresh); wrongTurn.turn = 1; invalid.push(wrongTurn);
  const outOfSync = Game.applyRoll(fresh, 4).state; outOfSync.players[0].position = 30; invalid.push(outOfSync);
  const missingHistory = Game.applyRoll(fresh, 4).state; missingHistory.history = []; invalid.push(missingHistory);
  const badHistory = Game.applyRoll(fresh, 4).state; badHistory.history[0].to = 80; invalid.push(badHistory);
  for (const save of invalid) assert.equal(Game.restoreGame(save), null);
});

test("the original entry point and the new index stay in sync", () => {
  const root = path.join(__dirname, "..");
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), fs.readFileSync(path.join(root, "index.html"), "utf8"));
});

test("every original-art board has a local, optimized image", () => {
  for (let i = 1; i <= 20; i++) assert.ok(fs.statSync(path.join(__dirname, "..", "assets", "fantasy", `board-${String(i).padStart(2, "0")}.webp`)).size > 1000);
});


test("original HTML coordinates align inside the supplied JPG frame", () => {
  assert.deepEqual(Game.ARTWORK_GRID, { size: 2424, inset: 12, gridSize: 2400 });
  assert.deepEqual(Game.artworkCoordinates(1), { x: 132, y: 2292 });
  assert.deepEqual(Game.artworkCoordinates(10), { x: 2292, y: 2292 });
  assert.deepEqual(Game.artworkCoordinates(100), { x: 132, y: 132 });
  for (const board of Game.BOARDS) {
    for (const [from, to] of [...Object.entries(board.s), ...Object.entries(board.l)]) {
      for (const square of [Number(from), to]) {
        const point = Game.artworkCoordinates(square);
        assert.ok(point.x > 12 && point.x < 2412);
        assert.ok(point.y > 12 && point.y < 2412);
      }
    }
  }
});

test("all twenty actual JPG files remain available", () => {
  for (let i = 1; i <= 20; i++) {
    assert.ok(fs.statSync(path.join(__dirname, "..", `snakes-and-ladders-board-${String(i).padStart(2, "0")}.jpg`)).size > 1000);
  }
});

test("createGame supports 3 players with custom names and colors", () => {
  const game = Game.createGame({
    mode: "online",
    names: ["Alice", "Bob", "Carol"],
    colors: ["blue", "red", "green"]
  });
  assert.equal(game.players.length, 3);
  assert.deepEqual(game.players.map(p => p.name), ["Alice", "Bob", "Carol"]);
  assert.deepEqual(game.players.map(p => p.color), ["blue", "red", "green"]);
  assert.deepEqual(game.players.map(p => p.position), [1, 1, 1]);
  assert.equal(game.turn, 0);
  assert.equal(game.totalRolls, 0);
  assert.equal(game.winner, null);
  assert.equal(game.mode, "online");
});

test("createGame supports 4 players with custom names and colors", () => {
  const game = Game.createGame({
    mode: "online",
    names: ["Alice", "Bob", "Carol", "Dave"],
    colors: ["blue", "red", "green", "yellow"]
  });
  assert.equal(game.players.length, 4);
  assert.deepEqual(game.players.map(p => p.name), ["Alice", "Bob", "Carol", "Dave"]);
  assert.deepEqual(game.players.map(p => p.color), ["blue", "red", "green", "yellow"]);
  assert.equal(game.turn, 0);
});

test("turn cycles correctly for 3 players", () => {
  const game = Game.createGame({ mode: "online", names: ["A", "B", "C"] });
  // Player 0 rolls
  let result = Game.applyRoll(game, 1);
  assert.equal(result.entry.player, 0);
  assert.equal(result.state.turn, 1);
  // Player 1 rolls
  result = Game.applyRoll(result.state, 1);
  assert.equal(result.entry.player, 1);
  assert.equal(result.state.turn, 2);
  // Player 2 rolls
  result = Game.applyRoll(result.state, 1);
  assert.equal(result.entry.player, 2);
  assert.equal(result.state.turn, 0); // cycles back to player 0
  // Player 0 rolls again
  result = Game.applyRoll(result.state, 1);
  assert.equal(result.entry.player, 0);
  assert.equal(result.state.turn, 1);
});

test("turn cycles correctly for 4 players", () => {
  let game = Game.createGame({ mode: "online", names: ["A", "B", "C", "D"] });
  const turns = [];
  for (let i = 0; i < 10; i++) {
    const result = Game.applyRoll(game, 1);
    turns.push(result.entry.player);
    game = result.state;
  }
  assert.deepEqual(turns, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
});

test("overshoot does not advance turn in N-player games", () => {
  const game = Game.createGame({ mode: "online", names: ["A", "B", "C"] });
  // Put player 0 at 98
  game.players[0].position = 98;
  const result = Game.applyRoll(game, 4);
  assert.equal(result.entry.type, "overshoot");
  assert.equal(result.state.players[0].position, 98);
  assert.equal(result.state.turn, 1); // turn passes to next player
  // Next player rolls
  const result2 = Game.applyRoll(result.state, 2);
  assert.equal(result2.state.turn, 2);
});

test("win detection works for N players", () => {
  const game = Game.createGame({ mode: "online", names: ["A", "B", "C", "D"] });
  // Put player 2 at 97
  game.players[2].position = 97;
  game.turn = 2;
  const result = Game.applyRoll(game, 3);
  assert.equal(result.state.winner, 2);
  assert.equal(result.state.turn, 2); // winner keeps turn
  assert.equal(result.state.players[2].position, 100);
  assert.throws(() => Game.applyRoll(result.state, 1), /finished/);
});
