/* All 20 original layouts, with a new presentation layer.
 * This module is deliberately dependency-free: it works in a browser and in Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SnakeLadder = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LAYOUTS = [
    {"s":{"91":52,"94":64,"89":53,"74":55,"70":50,"58":20,"65":37,"46":28,"19":5,"29":10},"l":{"9":35,"16":38,"15":36,"47":73,"45":75,"30":48,"79":96,"60":80,"62":85}},
    {"s":{"99":78,"92":72,"71":51,"79":58,"81":41,"64":38,"45":27,"50":10,"19":5,"29":9},"l":{"20":40,"17":44,"7":33,"34":65,"53":74,"49":73,"75":93,"76":96,"77":97}},
    {"s":{"99":84,"92":71,"82":62,"77":41,"80":60,"43":15,"50":30,"40":20,"34":13,"26":8},"l":{"10":33,"7":18,"19":38,"44":68,"36":53,"49":69,"76":87,"70":94,"64":74}},
    {"s":{"98":78,"93":68,"70":53,"75":44,"80":40,"50":11,"46":15,"54":34,"32":12,"17":7},"l":{"21":38,"5":20,"25":45,"27":49,"42":64,"55":87,"76":96,"59":82,"72":92}},
    {"s":{"96":83,"94":64,"71":47,"70":48,"81":62,"42":19,"56":23,"50":30,"18":6,"28":8},"l":{"25":55,"9":29,"15":35,"27":51,"40":61,"43":63,"77":95,"65":88,"68":91}},
    {"s":{"95":84,"91":71,"87":68,"75":49,"78":56,"50":28,"41":21,"63":45,"39":18,"31":11},"l":{"15":47,"25":42,"3":20,"55":83,"27":48,"44":59,"69":92,"62":82,"76":94}},
    {"s":{"99":62,"96":78,"81":61,"76":58,"73":53,"51":29,"46":26,"40":18,"37":7,"39":5},"l":{"4":20,"13":33,"16":42,"43":67,"34":54,"48":70,"59":85,"69":90,"75":91}},
    {"s":{"98":75,"90":70,"89":52,"77":66,"79":45,"42":18,"48":29,"55":25,"26":7,"34":10},"l":{"9":27,"5":37,"19":40,"47":73,"44":60,"31":53,"56":78,"67":95,"58":80}},
    {"s":{"92":73,"91":53,"76":48,"71":51,"81":41,"56":34,"58":36,"52":30,"23":6,"32":10},"l":{"7":26,"9":28,"3":22,"38":59,"35":57,"33":65,"63":85,"67":87,"62":84}},
    {"s":{"97":87,"99":62,"81":61,"71":51,"77":45,"41":20,"43":18,"44":26,"22":2,"27":9},"l":{"17":37,"3":14,"11":32,"55":69,"35":52,"39":63,"65":89,"76":98,"57":83}},
    {"s":{"91":72,"92":68,"70":48,"80":40,"77":59,"51":11,"49":28,"45":34,"39":20,"17":6},"l":{"18":37,"9":26,"25":57,"47":71,"42":64,"55":85,"79":98,"67":95,"78":96}},
    {"s":{"93":72,"95":73,"70":50,"71":53,"75":43,"49":13,"67":45,"40":19,"30":9,"33":7},"l":{"5":18,"6":27,"25":41,"26":52,"46":68,"44":74,"61":82,"58":86,"62":85}},
    {"s":{"99":79,"96":68,"75":49,"76":42,"84":62,"46":18,"57":39,"44":20,"26":5,"31":9},"l":{"7":29,"3":25,"19":45,"50":69,"33":65,"48":66,"73":92,"63":85,"60":80}},
    {"s":{"98":81,"92":74,"71":52,"79":41,"84":63,"42":21,"67":31,"47":32,"25":5,"37":17},"l":{"7":30,"2":23,"6":26,"27":46,"44":54,"38":64,"65":94,"59":83,"68":91}},
    {"s":{"92":73,"99":80,"70":48,"79":59,"76":58,"69":55,"45":19,"42":20,"28":8,"33":11},"l":{"18":46,"5":27,"25":53,"30":51,"40":61,"43":56,"74":98,"63":83,"72":91}},
    {"s":{"94":75,"96":81,"74":48,"72":52,"88":68,"58":41,"40":25,"64":54,"32":13,"22":4},"l":{"12":31,"6":17,"8":36,"35":63,"50":70,"27":47,"61":78,"71":91,"66":84}},
    {"s":{"91":72,"94":74,"80":58,"82":64,"73":45,"48":29,"40":19,"61":37,"25":3,"34":10},"l":{"4":15,"24":42,"13":36,"47":71,"46":68,"30":52,"57":81,"56":75,"76":96}},
    {"s":{"90":68,"97":82,"80":43,"85":64,"89":67,"42":22,"41":21,"45":23,"30":8,"29":6},"l":{"17":36,"16":32,"3":20,"44":74,"46":70,"31":51,"78":96,"63":81,"65":94}},
    {"s":{"96":64,"98":80,"86":54,"76":55,"83":61,"58":20,"57":19,"51":33,"27":9,"24":2},"l":{"11":31,"3":14,"12":34,"26":56,"48":68,"40":60,"69":94,"62":84,"71":91}},
    {"s":{"91":51,"95":66,"79":57,"82":64,"87":67,"41":23,"47":15,"53":33,"31":13,"30":9},"l":{"25":56,"6":24,"5":19,"32":52,"46":72,"44":61,"65":83,"76":96,"73":93}}
  ];

  const BOARD_META = [
  {
    "name": "The Greenhouse",
    "tagline": "A fresh start, a winding path.",
    "tile": "#e1eddd",
    "paper": "#f4f5e9",
    "accent": "#416c4b"
  },
  {
    "name": "Golden Hour",
    "tagline": "A little sunshine on every square.",
    "tile": "#f1e4c5",
    "paper": "#fcf6e6",
    "accent": "#9a763e"
  },
  {
    "name": "Misty Meadows",
    "tagline": "Take the scenic route to the top.",
    "tile": "#dce9e5",
    "paper": "#f1f5ed",
    "accent": "#49796d"
  },
  {
    "name": "Rosewood",
    "tagline": "A rosy road with a few surprises.",
    "tile": "#eddfda",
    "paper": "#fbf0e9",
    "accent": "#9b6761"
  },
  {
    "name": "Lavender Fields",
    "tagline": "Good things grow along the way.",
    "tile": "#e4dff0",
    "paper": "#f5f0f7",
    "accent": "#78688f"
  },
  {
    "name": "Coastal Trail",
    "tagline": "Catch a lucky little wave.",
    "tile": "#dcebf0",
    "paper": "#f0f7f5",
    "accent": "#487c93"
  },
  {
    "name": "Evergreen",
    "tagline": "For the wonderfully wild at heart.",
    "tile": "#d5e5d9",
    "paper": "#edf2e5",
    "accent": "#366a48"
  },
  {
    "name": "Desert Bloom",
    "tagline": "Even the long way has its moments.",
    "tile": "#f0ddca",
    "paper": "#faf0e2",
    "accent": "#ab7654"
  },
  {
    "name": "Quiet Valley",
    "tagline": "Slow down. The top can wait.",
    "tile": "#e4ead7",
    "paper": "#f7f6e9",
    "accent": "#727e49"
  },
  {
    "name": "Starlight",
    "tagline": "A bright adventure after dark.",
    "tile": "#dfe3ee",
    "paper": "#f1f2f8",
    "accent": "#647497"
  },
  {
    "name": "Clover Club",
    "tagline": "Your next lucky break is waiting.",
    "tile": "#ddeccf",
    "paper": "#f1f5e4",
    "accent": "#58833f"
  },
  {
    "name": "Sunflower Lane",
    "tagline": "Follow the sunny side of the board.",
    "tile": "#eee5be",
    "paper": "#fbf6df",
    "accent": "#9a823f"
  },
  {
    "name": "Cloud Nine",
    "tagline": "A little closer to the clouds.",
    "tile": "#dfeaf4",
    "paper": "#f2f6fa",
    "accent": "#6087ab"
  },
  {
    "name": "Coral Cove",
    "tagline": "Small steps, warm-hearted adventures.",
    "tile": "#f0dcd3",
    "paper": "#fcf1e8",
    "accent": "#ab7563"
  },
  {
    "name": "Moonlit Garden",
    "tagline": "Let a little moonlight guide you.",
    "tile": "#dce4e2",
    "paper": "#eef2e9",
    "accent": "#54756e"
  },
  {
    "name": "Wildflower Way",
    "tagline": "Every turn is a new possibility.",
    "tile": "#ecdfe2",
    "paper": "#faf1ed",
    "accent": "#936979"
  },
  {
    "name": "Alpine Air",
    "tagline": "One small climb. One great view.",
    "tile": "#e0e5f0",
    "paper": "#f1f4f8",
    "accent": "#697f9b"
  },
  {
    "name": "The Oasis",
    "tagline": "A refreshing change of direction.",
    "tile": "#d7eae5",
    "paper": "#eff6ed",
    "accent": "#448879"
  },
  {
    "name": "Autumn Walk",
    "tagline": "Turn over a new leaf.",
    "tile": "#ecdfc9",
    "paper": "#faf2e3",
    "accent": "#967044"
  },
  {
    "name": "Hidden Grove",
    "tagline": "A little wonder around every corner.",
    "tile": "#dbe7d5",
    "paper": "#f1f4e5",
    "accent": "#527446"
  }
];

  const BOARDS = Object.freeze(LAYOUTS.map((layout, index) => Object.freeze({
    ...BOARD_META[index],
    index,
    s: Object.freeze(layout.s),
    l: Object.freeze(layout.l),
  })));
  const STATE_VERSION = 1;
  const HISTORY_LIMIT = 40;
  // The supplied JPGs are 2424px square with a 12px frame around a 2400px grid.
  // Keep the original 600x600 HTML tracking space inside that printed frame.
  const ARTWORK_GRID = Object.freeze({ size: 2424, inset: 12, gridSize: 2400 });
  const validInteger = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

  function validateBoard(board) {
    if (!board || !board.s || !board.l || Array.isArray(board.s) || Array.isArray(board.l)) return false;
    const endpoints = [];
    for (const [type, paths] of [["snake", board.s], ["ladder", board.l]]) {
      if (typeof paths !== "object") return false;
      for (const [start, end] of Object.entries(paths)) {
        const from = Number(start);
        if (!validInteger(from, 2, 99) || !validInteger(end, 2, 99)) return false;
        if (type === "snake" ? from <= end : from >= end) return false;
        endpoints.push(from, end);
      }
    }
    if (new Set(endpoints).size !== endpoints.length) return false;
    // A breadth-first search proves that an exact-roll finish is reachable.
    const visited = new Set([1]);
    const queue = [1];
    for (let i = 0; i < queue.length; i++) {
      for (let die = 1; die <= 6; die++) {
        const landing = queue[i] + die;
        if (landing > 100) continue;
        const next = board.s[landing] || board.l[landing] || landing;
        if (next === 100) return true;
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    return false;
  }

  function coordinates(square) {
    if (!validInteger(square, 1, 100)) throw new RangeError("Square must be between 1 and 100.");
    const row = Math.floor((square - 1) / 10);
    const column = row % 2 ? 9 - ((square - 1) % 10) : (square - 1) % 10;
    return { x: column * 60 + 30, y: (9 - row) * 60 + 30 };
  }

  function artworkCoordinates(square) {
    const point = coordinates(square);
    const scale = ARTWORK_GRID.gridSize / 600;
    return { x: ARTWORK_GRID.inset + point.x * scale, y: ARTWORK_GRID.inset + point.y * scale };
  }

  const DEFAULT_COLORS = ["blue", "red", "green", "yellow", "white", "black"];

function cleanName(value, fallback) {
    if (typeof value !== "string") return fallback;
    return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24) || fallback;
  }

  function createGame(options = {}) {
    const boardIndex = options.boardIndex ?? 0;
    if (!validInteger(boardIndex, 0, BOARDS.length - 1)) throw new RangeError("Unknown board.");
    if (options.mode && !["local", "computer", "online"].includes(options.mode)) throw new TypeError("Unknown game mode.");
    const mode = options.mode || "local";
    const playersInput = options.players || options.names || [];
    const colors = options.colors || [];
    const playerCount = Math.max(2, Math.min(4, playersInput.length));
    const players = [];
    for (let i = 0; i < playerCount; i++) {
      const p = playersInput[i];
      let name = typeof p === "object" && p !== null ? p.name : p;
      // Computer mode: second player is always "Fern"
      if (mode === "computer" && i === 1 && !name) name = "Fern";
      name = cleanName(name, `Player ${i + 1}`);
      // Computer mode: force Fern as player 2 name
      if (mode === "computer" && i === 1) name = "Fern";
      players.push({
        name,
        color: colors[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        position: 1,
        rolls: 0,
        climbs: 0,
        slides: 0,
      });
    }
    return {
      version: STATE_VERSION,
      boardIndex,
      mode,
      players,
      turn: 0,
      totalRolls: 0,
      winner: null,
      history: [],
    };
  }

  function rollDie(random) {
    if (random) {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError("Random value must be in [0, 1).");
      return Math.floor(value * 6) + 1;
    }
    // Rejection sampling avoids modulo bias. Fall back only on older browsers.
    if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      do { globalThis.crypto.getRandomValues(values); } while (values[0] >= 4294967292);
      return (values[0] % 6) + 1;
    }
    return Math.floor(Math.random() * 6) + 1;
  }

  function applyRoll(game, die, options = {}) {
    if (!validInteger(die, 1, 6)) throw new RangeError("A die roll must be an integer from 1 to 6.");
    if (game.winner !== null) throw new Error("This game has already finished.");
    const board = BOARDS[game.boardIndex];
    const playerIndex = game.turn;
    const playerCount = game.players.length;
    const from = game.players[playerIndex].position;
    const steps = [];
    let landed = from;
    let to = from;
    let type = "overshoot";
    let jump = null;
    if (from + die <= 100) {
      for (let square = from + 1; square <= from + die; square++) steps.push(square);
      landed = from + die;
      to = landed;
      type = "move";
      if (board.l[landed]) { to = board.l[landed]; type = "ladder"; }
      else if (board.s[landed]) {
        if (options.riddleRescued === true) { to = landed; type = "riddle"; }
        else { to = board.s[landed]; type = "snake"; }
      }
      if (type === "ladder" || type === "snake") jump = { type, from: landed, to };
      if (to === 100) type = "win";
    }
    const players = game.players.map(player => ({ ...player }));
    const player = players[playerIndex];
    player.position = to;
    player.rolls++;
    if (type === "ladder") player.climbs++;
    if (type === "snake") player.slides++;
    const entry = { sequence: game.totalRolls + 1, player: playerIndex, die, from, landed, to, type };
    const nextTurn = to === 100 ? playerIndex : (playerIndex + 1) % playerCount;
    const state = {
      ...game,
      players,
      totalRolls: entry.sequence,
      winner: to === 100 ? playerIndex : null,
      turn: nextTurn,
      history: [entry, ...game.history.map(item => ({ ...item }))].slice(0, HISTORY_LIMIT),
    };
    return { state, steps, jump, entry };
  }

  // Treat stored data as untrusted. A malformed or old save simply starts fresh.
  function restoreGame(saved) {
    try {
      if (!saved || saved.version !== STATE_VERSION) return null;
      if (!validInteger(saved.boardIndex, 0, BOARDS.length - 1) || !["local", "computer", "online"].includes(saved.mode)) return null;
      if (!Array.isArray(saved.players) || saved.players.length < 2 || saved.players.length > 4) return null;
      const playerCount = saved.players.length;
      if (!validInteger(saved.turn, 0, playerCount - 1) || !validInteger(saved.totalRolls, 0, 1000000)) return null;
      if (saved.winner !== null && !validInteger(saved.winner, 0, playerCount - 1)) return null;
      const fresh = createGame({ boardIndex: saved.boardIndex, mode: saved.mode, names: saved.players.map(player => player?.name) });
      const players = saved.players.map((player, i) => {
        if (!player || typeof player.name !== "string" || !validInteger(player.position, 1, 100)) throw new Error("Invalid player.");
        for (const stat of ["rolls", "climbs", "slides"]) {
          if (!validInteger(player[stat], 0, saved.totalRolls)) throw new Error("Invalid statistics.");
        }
        if (player.climbs + player.slides > player.rolls) throw new Error("Invalid jumps.");
        // Backward compatibility: use saved color or default from fresh game
        const color = player.color ?? fresh.players[i].color;
        return { name: fresh.players[i].name, color, position: player.position, rolls: player.rolls, climbs: player.climbs, slides: player.slides };
      });
      // Backward compatibility: for 2-player saves, validate turn/roll parity
      if (playerCount === 2) {
        if (players[0].rolls !== Math.ceil(saved.totalRolls / 2) || players[1].rolls !== Math.floor(saved.totalRolls / 2)) return null;
        if (saved.winner === null && saved.turn !== saved.totalRolls % 2) return null;
        if (saved.winner !== null && saved.winner !== (saved.totalRolls - 1) % 2) return null;
      }
      if (saved.winner === null && players.some(player => player.position === 100)) return null;
      if (saved.winner !== null && (players[saved.winner].position !== 100 || players.some((p, i) => i !== saved.winner && p.position === 100) || saved.turn !== saved.winner)) return null;
      if (!Array.isArray(saved.history) || saved.history.length !== Math.min(saved.totalRolls, HISTORY_LIMIT)) return null;
      const latestPlayers = new Set();
      const history = saved.history.map((entry, i) => {
        if (!entry || !validInteger(entry.player, 0, playerCount - 1) || !validInteger(entry.die, 1, 6)) throw new Error("Invalid history.");
        if (entry.sequence !== saved.totalRolls - i) throw new Error("Invalid history order.");
        if (!latestPlayers.has(entry.player)) {
          if (players[entry.player].position !== entry.to) throw new Error("Position does not match the latest move.");
          latestPlayers.add(entry.player);
        }
        const prior = createGame({ boardIndex: saved.boardIndex });
        prior.turn = entry.player;
        prior.players[entry.player].position = entry.from;
        const expected = applyRoll(prior, entry.die, { riddleRescued: entry.type === "riddle" }).entry;
        if (expected.landed !== entry.landed || expected.to !== entry.to || expected.type !== entry.type) throw new Error("Invalid move.");
        return { sequence: entry.sequence, player: entry.player, die: entry.die, from: entry.from, landed: entry.landed, to: entry.to, type: entry.type };
      });
      return { ...fresh, players, turn: saved.turn, totalRolls: saved.totalRolls, winner: saved.winner, history };
    } catch { return null; }
  }

  return Object.freeze({ BOARDS, STATE_VERSION, HISTORY_LIMIT, ARTWORK_GRID, validateBoard, coordinates, artworkCoordinates, createGame, applyRoll, rollDie, restoreGame });
});
