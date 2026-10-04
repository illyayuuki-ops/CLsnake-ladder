/* Presentation, animation, and browser integrations. Game rules live in game-engine.js. */
(() => {
  "use strict";
  const Game = window.SnakeLadder;
  const $ = id => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const SAVE_KEY = "snakes-and-ladders:v2";
  const COLORS = ["#ca705e", "#5b91ac"];
  const DEFAULT_COLORS = ["blue", "red", "green", "yellow", "white", "black"];
  const COLOR_HEX = { blue: "#5b91ac", red: "#ca705e", green: "#316448", yellow: "#e8efe3", white: "#f6f7f2", black: "#0b1020" };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const BOARDS_PER_PAGE = 4;
  // Kept from the original game for fast, deterministic animation tests.
  const searchParams = new URLSearchParams(location.search);
  const requestedFast = Number(searchParams.get("fast"));
  const inviteRoom = String(searchParams.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const FAST = Number.isFinite(requestedFast) && requestedFast > 0 ? Math.min(requestedFast, 1000) : 1;
  const defaults = { sound: false, art: "original", perspective: true, speed: "normal" };
  let preferences = { ...defaults };
  let storageAvailable = true;
  let restored = false;
  let game = Game.createGame();
  let busy = false;
  let gameEpoch = 0;
  let computerTimer = null;
  let confettiTimer = null;
  let selectedBoard = 0;
  let currentFilter = null;
  let localFriendName = "Player 2";
  let audioContext = null;
  let pickerPage = 0;
  let visualPositions = [1, 1];
  let artworkState = "loading";
  const boardCamera = {
    tiltX: window.innerWidth <= 740 ? 38 : 50,
    tiltY: -3,
    zoom: 1,
    pointers: new Map(),
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    lastPoint: null,
  };
  let artworkEpoch = 0;
  let pictureBoardIndex = null;
  const dialogs = [...document.querySelectorAll("dialog")];
  const startMenu = $("start-menu");
  const menuViews = [...startMenu.querySelectorAll(".menu-view")];
  const gameChrome = [...document.querySelectorAll(".game-window > *")].filter(node => node !== startMenu);
  const menuFocus = { main: "menu-play", play: "menu-friend", online: "online-create", room: "online-enter", settings: "setting-sound", exit: "exit-back" };
  let menuOpen = false;
  let menuView = "main";
  let returnToMenu = false;
  let savedOnline = null;
  let online = null;
  let onlinePoll = null;
  let pollAbort = null;
  let onlineEntered = false;
  let snakePrompt = null;
  let riddleChallenge = null;
  let onlineSnakePromptId = null;
let playersSheetOpen = false;
let activitySheetOpen = false;
let lastSheetTrigger = null;

// Splash loader
let splashLoader = null;
let splashCompleted = false;
const SPLASH_MS = 15000;

function initSplashLoader() {
  const messages = ['Warming up the board', 'Rolling in the pieces', 'Almost ready'];
  splashLoader = new SplashLoader({
    title: 'Snakes & Ladders',
    messages,
    onComplete: onSplashComplete
  });

  // Smooth 0→100 progress over 15s minimum (respect ?fast= for test speedup)
  splashLoader.simulate(Math.max(1, SPLASH_MS / FAST));

  // Respect prefers-reduced-motion: if reduced motion, complete quickly
  if (reducedMotion.matches) {
    splashLoader.complete();
    return;
  }
}

function onSplashComplete() {
  const splash = $("splash");
  if (splash) {
    splashLoader.hide();
    // Remove splash from DOM after fade-out
    setTimeout(() => {
      splash.remove();
    }, 500);
  }
  // Show the start menu via existing flow
  setMenuOpen(true, inviteRoom.length === 5 ? "online" : "main");
  if (inviteRoom.length === 5) {
    $("online-code").focus({ preventScroll: true });
    // Auto-join the room from the invite link
    setTimeout(() => joinRoom(inviteRoom), 100);
  }
}

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.version !== 1) return;
      const state = Game.restoreGame(saved.game);
      if (!state) return;
      game = state;
      restored = true;
      savedOnline = saved.online && typeof saved.online.code === "string"
        ? { code: saved.online.code.toUpperCase().slice(0, 5), player: saved.online.player === 1 ? 1 : 0 }
        : null;
      const prefs = saved.preferences || {};
      preferences = {
        sound: prefs.sound === true,
        art: "original", // Migrate old Garden saves without changing game progress.
        perspective: prefs.perspective !== false,
        speed: prefs.speed === "quick" ? "quick" : "normal",
      };
    } catch (error) {
      // A corrupt save is not a storage failure. Private browsing may block storage.
      if (!(error instanceof SyntaxError)) storageAvailable = false;
    }
  }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, game, preferences, online: online ? { code: online.code, player: online.player } : null, updatedAt: Date.now() }));
      storageAvailable = true;
    } catch { storageAvailable = false; }
    $("save-status").textContent = storageAvailable ? "Your progress is saved automatically" : "Saving unavailable — keep this tab open to continue";
  }

  // Auth state
  let authToken = localStorage.getItem("authToken");
  let authUsername = null;
  let authSkipped = false;

  // Load auth from localStorage
  function loadAuth() {
    try {
      const raw = localStorage.getItem("snl.session");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.token && saved.username) {
          authToken = saved.token;
          authUsername = saved.username;
          localStorage.setItem("authToken", authToken);
        }
      }
      authSkipped = localStorage.getItem("snake-ladder:guest") === "true";
    } catch { }
  }

  function saveAuth() {
    if (authToken && authUsername) {
      localStorage.setItem("snl.session", JSON.stringify({ token: authToken, username: authUsername }));
      localStorage.setItem("authToken", authToken);
    }
  }

  function clearAuth() {
    authToken = null;
    authUsername = null;
    authSkipped = false;
    localStorage.removeItem("snl.session");
    localStorage.removeItem("snake-ladder:guest");
    localStorage.removeItem("authToken");
  }

  // API wrapper with auth
  async function api(path, body) {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const response = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
    if (response.status === 401) {
      clearAuth();
      const authDialog = $("auth-dialog");
      if (authDialog) authDialog.showModal();
      throw new Error("Please log in to continue.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The game server answered with ${response.status}.`);
    return data;
  }

  // Auth-specific API (no auth header needed for login/register)
  async function apiAuth(path, body) {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    const response = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The game server answered with ${response.status}.`);
    return data;
  }

  // Auth API calls
  async function authLogin(username, password) {
    const data = await apiAuth("api/auth/login", { username, password });
    authToken = data.token;
    authUsername = data.username;
    saveAuth();
    return data;
  }

  async function authRegister(username, password) {
    const data = await apiAuth("api/auth/register", { username, password });
    authToken = data.token;
    authUsername = data.username;
    saveAuth();
    return data;
  }

  function setGuestMode() {
    authSkipped = true;
    localStorage.setItem("snake-ladder:guest", "true");
  }

  async function ensureGuestAuth() {
    if (authToken) return;
    // Auto-register a throwaway guest account
    const guestName = `Guest_${Math.random().toString(36).slice(2, 8)}`;
    const guestPass = Math.random().toString(36).slice(2);
    try {
      await authRegister(guestName, guestPass);
    } catch {
      // If registration fails (name taken), try again
      const guestName2 = `Guest_${Math.random().toString(36).slice(2, 8)}`;
      await authRegister(guestName2, guestPass);
    }
  }

  function isAuthenticated() {
    return authToken !== null;
  }

  function duration(ms) {
    if (reducedMotion.matches) return 0;
    return ms * (preferences.speed === "quick" ? .48 : 1) / FAST;
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, duration(ms)));
  const pad = value => String(value).padStart(2, "0");
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const anyDialogOpen = () => menuOpen || dialogs.some(dialog => dialog.open) || anySheetOpen();

  function anySheetOpen() {
    return playersSheetOpen || activitySheetOpen;
  }

  function openSheet(sheetId, scrimId, triggerEl) {
    const sheet = $(sheetId);
    const scrim = $(scrimId);
    if (!sheet || !scrim) return;
    lastSheetTrigger = triggerEl;
    if (sheetId === "players-sheet") {
      playersSheetOpen = true;
      $("players-sheet-body").innerHTML = $("players-panel").innerHTML;
      $("players-sheet-body").querySelectorAll("button").forEach(btn => {
        if (btn.id === "edit-players" || btn.id === "newgame") {
          btn.addEventListener("click", () => {
            closeSheet("players-sheet", "players-sheet-scrim");
            if (btn.id === "edit-players") openSetup();
            else if (btn.id === "newgame") openSetup();
          });
        }
      });
    } else if (sheetId === "activity-sheet") {
      activitySheetOpen = true;
      $("activity-sheet-body").innerHTML = $("activity-panel").innerHTML;
    }
    sheet.hidden = false;
    scrim.classList.add("is-open");
    sheet.classList.add("is-open");
    scrim.hidden = false;
    document.body.style.overflow = "hidden";
    fitBoard();
    triggerEl?.focus({ preventScroll: true });
  }

  function closeSheet(sheetId, scrimId) {
    const sheet = $(sheetId);
    const scrim = $(scrimId);
    if (!sheet || !scrim) return;
    if (sheetId === "players-sheet") playersSheetOpen = false;
    else if (sheetId === "activity-sheet") activitySheetOpen = false;
    scrim.classList.remove("is-open");
    sheet.classList.remove("is-open");
    sheet.addEventListener("transitionend", () => {
      if (!sheet.classList.contains("is-open")) {
        sheet.hidden = true;
        scrim.hidden = true;
        document.body.style.overflow = "";
      }
    }, { once: true });
    lastSheetTrigger?.focus({ preventScroll: true });
    fitBoard();
  }

  function handleSheetKeydown(event) {
    if (event.key !== "Escape") return;
    if (playersSheetOpen) {
      event.preventDefault();
      closeSheet("players-sheet", "players-sheet-scrim");
    } else if (activitySheetOpen) {
      event.preventDefault();
      closeSheet("activity-sheet", "activity-sheet-scrim");
    }
  }

  function svgElement(tag, attributes, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, value);
    if (parent) parent.appendChild(node);
    return node;
  }

  function fitBoard() {
    const stage = $("board-stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const style = getComputedStyle(stage);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const padTop = parseFloat(style.paddingTop) || 0;
    const padBottom = parseFloat(style.paddingBottom) || 0;
    const stageWidth = rect.width - padLeft - padRight;
    const stageHeight = rect.height - padTop - padBottom;
    const size = Math.max(1, Math.floor(Math.min(stageWidth, stageHeight)));
    $("board").style.setProperty("--board-size", `${size}px`);
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function syncBoardCamera() {
    const board = $("board");
    board.style.setProperty("--board-tilt-x", `${boardCamera.tiltX}deg`);
    board.style.setProperty("--board-tilt-y", `${boardCamera.tiltY}deg`);
    board.style.setProperty("--board-zoom", boardCamera.zoom.toFixed(3));
    $("board-stage").classList.toggle("is-camera-active", preferences.perspective);
  }

  function resetBoardCamera() {
    boardCamera.tiltX = window.innerWidth <= 740 ? 38 : 50;
    boardCamera.tiltY = -3;
    boardCamera.zoom = 1;
    syncBoardCamera();
  }

  function installBoardCamera() {
    const stage = $("board-stage");
    const board = $("board");
    const distanceBetween = points => {
      const [a, b] = points;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    stage.addEventListener("pointerdown", event => {
      if (!preferences.perspective || event.button !== 0 || event.target.closest?.("button, a, input, .path-group")) return;
      boardCamera.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try { stage.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional in older browsers. */ }
      if (boardCamera.pointers.size === 1) boardCamera.lastPoint = { x: event.clientX, y: event.clientY };
      if (boardCamera.pointers.size === 2) {
        boardCamera.pinchStartDistance = distanceBetween([...boardCamera.pointers.values()]);
        boardCamera.pinchStartZoom = boardCamera.zoom;
      }
      board.classList.add("is-dragging");
      event.preventDefault();
    });

    stage.addEventListener("pointermove", event => {
      if (!boardCamera.pointers.has(event.pointerId)) return;
      boardCamera.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (boardCamera.pointers.size >= 2) {
        const distance = distanceBetween([...boardCamera.pointers.values()]);
        if (boardCamera.pinchStartDistance > 0) {
          boardCamera.zoom = clamp(boardCamera.pinchStartZoom * distance / boardCamera.pinchStartDistance, .84, 1.08);
        }
      } else if (boardCamera.lastPoint) {
        const dx = event.clientX - boardCamera.lastPoint.x;
        const dy = event.clientY - boardCamera.lastPoint.y;
        boardCamera.tiltX = clamp(boardCamera.tiltX - dy * .28, 23, 66);
        boardCamera.tiltY = clamp(boardCamera.tiltY + dx * .24, -18, 18);
        boardCamera.lastPoint = { x: event.clientX, y: event.clientY };
      }
      syncBoardCamera();
      event.preventDefault();
    });

    const endPointer = event => {
      if (!boardCamera.pointers.has(event.pointerId)) return;
      boardCamera.pointers.delete(event.pointerId);
      if (boardCamera.pointers.size < 2) boardCamera.pinchStartDistance = 0;
      if (boardCamera.pointers.size === 1) boardCamera.lastPoint = [...boardCamera.pointers.values()][0];
      if (!boardCamera.pointers.size) {
        boardCamera.lastPoint = null;
        board.classList.remove("is-dragging");
      }
    };
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    stage.addEventListener("lostpointercapture", endPointer);

    stage.addEventListener("wheel", event => {
      if (!preferences.perspective) return;
      event.preventDefault();
      boardCamera.zoom = clamp(boardCamera.zoom * Math.exp(-event.deltaY * .001), .84, 1.08);
      syncBoardCamera();
    }, { passive: false });

    stage.addEventListener("keydown", event => {
      if (!preferences.perspective || event.target !== stage) return;
      const turn = 5;
      if (event.key === "ArrowLeft") boardCamera.tiltY = clamp(boardCamera.tiltY - turn, -18, 18);
      else if (event.key === "ArrowRight") boardCamera.tiltY = clamp(boardCamera.tiltY + turn, -18, 18);
      else if (event.key === "ArrowUp") boardCamera.tiltX = clamp(boardCamera.tiltX + turn, 23, 66);
      else if (event.key === "ArrowDown") boardCamera.tiltX = clamp(boardCamera.tiltX - turn, 23, 66);
      else if (event.key === "+" || event.key === "=") boardCamera.zoom = clamp(boardCamera.zoom + .04, .84, 1.08);
      else if (event.key === "-") boardCamera.zoom = clamp(boardCamera.zoom - .04, .84, 1.08);
      else if (event.key === "Home") resetBoardCamera();
      else return;
      event.preventDefault();
      syncBoardCamera();
    });

    stage.addEventListener("dblclick", event => {
      if (event.target.closest?.("button, a, input, .path-group")) return;
      resetBoardCamera();
    });
  }

  function makeBoardTracking(svg, board) {
    svg.replaceChildren();
    // Nothing redraws or covers the provided picture. These are hit targets and
    // optional endpoint rings, using the exact s/l maps and pos() space from the HTML.
    for (const [kind, routes] of [["ladder", board.l], ["snake", board.s]]) {
      for (const [start, end] of Object.entries(routes)) {
        const from = Number(start), a = Game.coordinates(from), b = Game.coordinates(end);
        const group = svgElement("g", {
          class: `path-group ${kind}-path`, tabindex: 0, role: "button",
          "aria-label": kind === "snake" ? `Snake head ${from}, tail ${end}` : `Ladder foot ${from}, top ${end}`,
        }, svg);
        group.dataset.kind = kind;
        group.dataset.from = from;
        group.dataset.to = end;
        const title = svgElement("title", {}, group);
        title.textContent = `${kind === "snake" ? "Snake head → tail" : "Ladder foot → top"}: ${from} → ${end}`;
        if (kind === "ladder") {
          svgElement("path", { d: `M${a.x},${a.y}L${b.x},${b.y}`, fill: "none", stroke: "transparent", "stroke-width": 22, "pointer-events": "stroke" }, group);
        }
        for (const [point, endpoint, number] of [[a, "from", from], [b, "to", end]]) {
          svgElement("circle", { class: "path-hit", cx: point.x, cy: point.y, r: 21, fill: "transparent", "pointer-events": "all" }, group);
          const markers = svgElement("g", { class: `endpoint-markers endpoint-${endpoint}`, "pointer-events": "none" }, group);
          svgElement("circle", { class: "marker-outline", cx: point.x, cy: point.y, r: endpoint === "from" ? 19 : 14 }, markers);
          svgElement("circle", { class: "marker-ring", cx: point.x, cy: point.y, r: endpoint === "from" ? 19 : 14 }, markers);
          const label = svgElement("text", { class: "endpoint-number", x: point.x, y: point.y + (endpoint === "from" ? 30 : 25), "text-anchor": "middle" }, markers);
          label.textContent = number;
        }
      }
    }
    svgElement("rect", { id: "landing-highlight", class: "landing-highlight", x: 2, y: 542, width: 56, height: 56, rx: 6, visibility: "hidden" }, svg);
  }

  function pawnSVG(index, prefix) {
    // Use online colors if available, otherwise fall back to default palette
    const colorName = (online && online.colors && online.colors[index]) ? online.colors[index] : DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    const color = COLOR_HEX[colorName] || COLORS[index % COLORS.length];
    const dark = index % 2 === 0 ? "#935747" : "#40697e";
    const light = index % 2 === 0 ? "#e79f86" : "#91bbca";
    // Prefixes make gradient IDs unique across board pieces and player avatars.
    return `<svg viewBox="0 0 34 47" xmlns="${NS}" aria-hidden="true"><defs><linearGradient id="${prefix}" x1="0" y1="0" x2="1" y2=".3"><stop stop-color="${light}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><ellipse cx="17" cy="43" rx="14" ry="3.2" fill="${dark}"/><path d="M5 41q2-5 7-6l2-12h6l2 12q5 1 7 6z" fill="url(#${prefix})" stroke="${dark}" stroke-width="1.1"/><ellipse cx="17" cy="23" rx="7.2" ry="2.5" fill="${color}" stroke="${dark}" stroke-width=".8"/><circle cx="17" cy="12" r="9" fill="url(#${prefix})" stroke="${dark}" stroke-width="1.1"/><ellipse cx="14" cy="9" rx="2.3" ry="1.6" fill="#fff" opacity=".3"/><text x="17" y="35" fill="#fff7e7" font-family="DM Sans, sans-serif" font-size="9" text-anchor="middle" font-weight="750">${index + 1}</text><path d="M7 41h20" stroke="${light}" stroke-width="1.2" stroke-linecap="round" opacity=".7"/></svg>`;
  }

  function buildPieces() {
    const playerCount = online ? online.seats.filter(s => s).length : 2;
    $("pieces").innerHTML = Array.from({ length: playerCount }, (_, i) => `<div class="pawn" id="pawn-${i}"><div class="pawn-shadow"></div><div class="pawn-body">${pawnSVG(i, `piece-${i}`)}</div></div>`).join("");
    visualPositions.forEach((n, i) => positionPawn(i, n));
  }

  function buildPlayers() {
    const playerCount = online ? online.seats.filter(s => s).length : 2;
    const playerColors = (online && online.colors) ? online.colors : (online ? DEFAULT_COLORS.slice(0, online.seats.filter(s => s).length) : COLORS);
    $("players").innerHTML = Array.from({ length: playerCount }, (_, i) => `<article class="player-card" id="player-card-${i}" aria-label="Player ${i + 1}"><div class="player-card-main"><div class="player-avatar">${pawnSVG(i, `avatar-${i}`)}</div><div class="player-details"><h3 id="player-name-${i}"></h3><p><span class="active-dot" id="player-dot-${i}"></span><span id="player-state-${i}"></span></p></div><div class="player-position"><strong id="player-position-${i}">01</strong><small>SQUARE</small></div></div><div class="player-progress" role="progressbar" aria-valuemin="1" aria-valuemax="100" aria-valuenow="1" id="player-progress-${i}"><span></span></div></article>`).join("");
  }

  function positionPawn(index, square) {
    visualPositions[index] = square;
    const pawn = $(`pawn-${index}`), p = Game.coordinates(square);
    // Offset pieces inside their square so they remain visible on shared spaces.
    pawn.style.left = `${(p.x + (index === 0 ? -10 : 10)) / 6}%`;
    pawn.style.top = `${(p.y + 10) / 6}%`;
    pawn.style.setProperty("--step-duration", `${duration(190)}ms`);
    pawn.style.setProperty("--jump-duration", `${duration(720)}ms`);
    pawn.classList.toggle("active-pawn", game.turn === index);
    updatePlayers();
  }

  function highlightSquare(square, visible = true) {
    const p = Game.coordinates(square), highlight = $("landing-highlight");
    highlight.setAttribute("x", p.x - 28);
    highlight.setAttribute("y", p.y - 28);
    highlight.setAttribute("visibility", visible ? "visible" : "hidden");
  }

  function updatePlayers() {
    game.players.forEach((player, i) => {
      if (!$(`player-name-${i}`)) return;
      const active = game.turn === i;
      $(`player-name-${i}`).textContent = player.name;
      $(`player-card-${i}`).classList.toggle("is-active", active);
      $(`player-card-${i}`).setAttribute("aria-label", `${player.name}, square ${visualPositions[i]}${active ? ", current player" : ""}`);
      $(`player-position-${i}`).textContent = pad(visualPositions[i]);
      $(`player-dot-${i}`).hidden = !active;
      $(`player-state-${i}`).textContent = game.winner === i ? "Made it to the top!" : game.winner !== null ? "A good little adventure" : busy && active ? "On the move" : active ? (game.mode === "computer" && i === 1 ? "Thinking of a lucky roll…" : "Ready to roll") : game.totalRolls === 0 ? "Up next" : "Waiting for a turn";
      const progress = $(`player-progress-${i}`);
      progress.setAttribute("aria-valuenow", visualPositions[i]);
      progress.setAttribute("aria-label", `${player.name}’s progress`);
      progress.firstElementChild.style.width = `${visualPositions[i]}%`;
      $(`pawn-${i}`)?.classList.toggle("active-pawn", active);
    });
  }

  function setDie(value) {
    $("die").dataset.value = value;
    $("die").setAttribute("aria-label", `Die showing ${value}`);
  }

  function status(message, tone = "normal") {
    $("board-message").textContent = message;
    $("board-message").closest(".board-status").dataset.tone = tone;
  }

  function updateControls() {
    const computerTurn = !online && game.mode === "computer" && game.turn === 1 && game.winner === null;
    const waitingRoom = Boolean(online && !onlineReady());
    const waitingTurn = Boolean(online && onlineReady() && (game.turn !== online.player || online.pending));
    $("roll").disabled = busy || computerTurn || waitingRoom || waitingTurn || artworkState !== "ready";
    $("roll-label").textContent = busy ? (computerTurn ? "Fern is rolling…" : "Rolling…") : artworkState === "loading" ? "Loading…" : artworkState === "error" ? "Picture error" : waitingRoom ? "Waiting for a player…" : online?.pending ? "Resolve the snake riddle…" : waitingTurn ? `${game.players[game.turn].name}’s turn` : game.winner !== null ? "Play again" : computerTurn ? "Fern’s turn" : "Roll the dice";
    ["newgame", "change-board", "edit-players"].forEach(id => { $(id).disabled = busy || Boolean(online); });
    ["mode-button", "how-to-play"].forEach(id => { $(id).disabled = busy; });
    ["show-ladders", "show-snakes"].forEach(id => { $(id).disabled = busy || artworkState !== "ready"; });
    $("turn-name").textContent = game.winner !== null ? `${game.players[game.winner].name} wins!` : `${game.players[game.turn].name}’s turn`;
    $("hud-turn").textContent = game.winner !== null ? `${game.players[game.winner].name} wins` : game.players[game.turn].name;
    $("hud-board").textContent = Game.BOARDS[game.boardIndex].name;
    const playerColors = (online && online.colors) ? online.colors : (online ? online.seats.map((s, i) => s ? (online.colors[i] || DEFAULT_COLORS[i]) : "").filter(Boolean) : COLORS);
    document.querySelector(".turn-dot").style.background = playerColors[game.turn];
    $("round-label").textContent = `Round ${pad(Math.floor(Math.max(0, game.totalRolls - (game.winner !== null ? 1 : 0)) / 2) + 1)}`;
    $("mode-label").textContent = online ? `Room ${online.code}` : game.mode === "computer" ? "Playing with Fern" : "Playing with a friend";
    $("mode-button").setAttribute("aria-label", online ? "Back to the game menu" : "Choose online, Fern, or friend play");
    $("mode-button").querySelector("use").setAttribute("href", `#i-${online ? "globe" : game.mode === "computer" ? "computer" : "players"}`);
    $("dice-caption").textContent = busy ? "A little luck is on its way…" : game.winner !== null ? "What a lovely finish." : computerTurn ? "Your computer companion is up next." : game.history.length ? `${game.players[game.history[0].player].name} rolled a ${game.history[0].die}. Your move!` : "Big adventures start with a small roll.";
  }

  function describeEntry(entry) {
    if (entry.type === "ladder") return `Climbed ${entry.landed} → ${entry.to}`;
    if (entry.type === "snake") return `Slid ${entry.landed} → ${entry.to}`;
    if (entry.type === "riddle") return `Solved a haiku at ${entry.landed}`;
    if (entry.type === "overshoot") return `Too high — stayed on ${entry.from}`;
    if (entry.type === "win") return "Reached 100. A lovely finish!";
    return `Moved ${entry.from} → ${entry.to}`;
  }

  function updateActivity() {
    $("move-count").textContent = `${game.totalRolls} move${game.totalRolls === 1 ? "" : "s"}`;
    $("hud-moves").textContent = String(game.totalRolls);
    const activity = $("activity");
    activity.replaceChildren();
    if (!game.history.length) {
      activity.innerHTML = `<li class="activity-empty"><span class="empty-trail" aria-hidden="true">· · · ${icon("flag")}</span><p>Your story starts with a roll.</p></li>`;
      return;
    }
    game.history.slice(0, 3).forEach(entry => {
      const item = document.createElement("li");
      item.className = `activity-item${entry.player === 1 ? " player-two" : ""}`;
      const symbol = entry.type === "riddle" ? "sparkle" : entry.type === "snake" ? "snake" : entry.type === "ladder" ? "ladder" : entry.type === "win" ? "flag" : entry.type === "overshoot" ? "refresh" : "arrow";
      item.innerHTML = `<span class="mini-die" aria-label="Rolled ${entry.die}">${entry.die}</span><div class="activity-details"><strong></strong><p></p></div><span class="activity-symbol ${entry.type === "snake" ? "is-snake" : entry.type === "riddle" ? "is-riddle" : ""}">${icon(symbol)}</span>`;
      // Player names are always text, never executable markup.
      item.querySelector("strong").textContent = game.players[entry.player].name;
      item.querySelector("p").textContent = describeEntry(entry);
      activity.appendChild(item);
    });
  }

  function syncMenu() {
    // Any valid save can be continued, including one reloaded mid-animation.
    const saved = !online && restored;
    const isLocalMode = !online && game.mode === "local";
    $("menu-continue").hidden = !saved;
    $("menu-continue").querySelector("span").textContent = saved ? `Continue on ${Game.BOARDS[game.boardIndex].name}` : "Continue your saved game";
    $("menu-rejoin").hidden = !savedOnline;
    $("menu-rejoin").querySelector("span").textContent = savedOnline ? `Rejoin room ${savedOnline.code}` : "Rejoin room";
    $("menu-note").textContent = saved ? `Saved game · Board ${pad(game.boardIndex + 1)} · ${game.totalRolls} move${game.totalRolls === 1 ? "" : "s"}` : "Your progress is saved automatically.";
    $("setting-sound").setAttribute("aria-pressed", String(preferences.sound));
    $("setting-sound-value").textContent = preferences.sound ? "On" : "Off";
    $("setting-sound").querySelector("use").setAttribute("href", `#i-${preferences.sound ? "volume" : "muted"}`);
    $("setting-pace").setAttribute("aria-pressed", String(preferences.speed === "quick"));
    $("setting-pace-value").textContent = preferences.speed === "quick" ? "Quick & breezy" : "Take it easy";
    $("setting-view").setAttribute("aria-pressed", String(preferences.perspective));
    $("setting-view-value").textContent = preferences.perspective ? "Tilted 3D board" : "Flat board";
    // Hide board picker for online/computer modes
    $("change-board").hidden = !isLocalMode;
    $("setting-board").hidden = !isLocalMode;
    $("setting-board-value").textContent = Game.BOARDS[game.boardIndex].name;
    $("setting-names-value").textContent = `${game.players[0].name} and ${game.players[1].name}`;
    // Show/hide QR scan button based on BarcodeDetector support
    if ($("online-scan")) {
      $("online-scan").hidden = !window.BarcodeDetector;
    }
    syncRoomView();
  }

function syncRoomView(message) {
    $("room-code").textContent = online?.code || "-----";
    const joined = Boolean(online && online.seats[0] && online.seats[1]);
    $("online-enter").hidden = !joined;
    if (!online) $("room-status").textContent = "No room yet.";
    else if (!joined) $("room-status").textContent = "Waiting for another player to join… share the room code.";
    else $("room-status").textContent = `Both players are here. ${game.players[game.turn].name} plays first${game.turn === online.player ? " — that's you!" : "."}`;
    if (message) $("online-message").textContent = message;
    // Show QR code for the room
    if (online?.code) generateRoomQR(online.code);
  }

  // Lobby view rendering
  function syncLobbyView(message) {
    if (!online) return;
    $("lobby-code").textContent = online.code;
    const isHost = online.player === online.host;
    const seatedCount = online.seats.filter(s => s).length;
    const allReady = online.seats.every((s, i) => !s || online.ready[i]);
    const canStart = isHost && seatedCount >= 2 && allReady;

    // Update status text
    if (!online.seats.some(s => s)) {
      $("lobby-status").textContent = "Room is empty.";
    } else if (online.status === "playing") {
      $("lobby-status").textContent = "Game in progress…";
    } else if (seatedCount === 1) {
      $("lobby-status").textContent = "Waiting for players to join…";
    } else if (!allReady) {
      $("lobby-status").textContent = "Waiting for all players to ready up.";
    } else {
      $("lobby-status").textContent = "Everyone ready! Host can start the game.";
    }

    // Render seats
    const seatsContainer = $("lobby-seats");
    if (seatsContainer) {
      seatsContainer.innerHTML = online.seats.map((seated, i) => {
        if (!seated) {
          return `<div class="lobby-seat empty" data-seat="${i}"><div class="lobby-seat-pawn" style="background:rgba(255,255,255,0.05)"></div><span class="lobby-seat-name">Empty seat</span></div>`;
        }
        const isCurrentPlayer = i === online.player;
        const name = online.names[i] || `Player ${i + 1}`;
        const color = online.colors[i] || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
        const isReady = online.ready[i];
        const isHost = i === online.host;

        // Build color picker swatches
        const takenColors = online.seats.map((s, idx) => s ? online.colors[idx] : null).filter(Boolean);
        const colorSwatches = DEFAULT_COLORS.map(c => {
          const isTaken = takenColors.includes(c) && c !== color;
          const isSelected = c === color;
          return `<button class="lobby-color-swatch ${isSelected ? 'selected' : ''} ${isTaken ? 'disabled' : ''}" data-seat="${i}" data-color="${c}" style="background:${c}" ${isTaken ? 'disabled' : ''} aria-label="${c}${isTaken ? ' (taken)' : ''}" aria-pressed="${isSelected}"></button>`;
        }).join('');

        const readyBtnClass = isReady ? 'lobby-ready-toggle ready' : 'lobby-ready-toggle';
        const readyBtnText = isReady ? 'Ready' : 'Not ready';

        return `
          <div class="lobby-seat" data-seat="${i}"${isCurrentPlayer ? ' style="box-shadow:0 0 0 2px rgba(207,230,182,0.5);"' : ''}>
            <div class="lobby-seat-pawn" style="background:${color}; border-color:${color}"></div>
            <span class="lobby-seat-name">${name}${isCurrentPlayer ? ' (you)' : ''}${isHost ? ' <span class="lobby-seat-host-badge">Host</span>' : ''}</span>
            <button class="${readyBtnClass}" data-seat="${i}" data-ready="${isReady}" aria-pressed="${isReady}">${readyBtnText}</button>
            <div class="lobby-color-picker" data-seat="${i}">${colorSwatches}</div>
          </div>
        `;
      }).join('');
    }

    // Show/hide start button for host
    const startBtn = $("lobby-start");
    if (startBtn) {
      startBtn.hidden = !canStart || online.status === "playing";
      if (canStart) startBtn.textContent = "Start game";
    }

    // Show leave button
    const leaveBtn = $("lobby-leave");
    if (leaveBtn) leaveBtn.hidden = false;

    // Show copy link button
    const copyBtn = $("lobby-copy");
    if (copyBtn) copyBtn.hidden = false;

    if (message) $("online-message").textContent = message;
    if (online?.code) generateRoomQR(online.code);
  }

  function setMenuOpen(open, view = menuView) {
    menuOpen = open;
    startMenu.hidden = !open;
    gameChrome.forEach(node => { node.inert = open; });
    if (open) { stopComputerTimer(); setMenuView(view); }
  }

  function setMenuView(view) {
    menuView = menuFocus[view] ? view : "main";
    menuViews.forEach(node => { node.hidden = node.dataset.view !== menuView; });
    syncMenu();
    const target = $(menuFocus[menuView]);
    if (target && !target.hidden) target.focus({ preventScroll: true });
  }

  function hideMenu() {
    setMenuOpen(false);
    scheduleComputer();
  }

  function updateArtworkState(state) {
    artworkState = state;
    $("board").dataset.artState = state;
    $("art-loading").hidden = state !== "loading";
    $("art-error").hidden = state !== "error";
    $("tracking-layer").inert = state !== "ready";
    $("tracking-layer").setAttribute("aria-hidden", String(state !== "ready"));
    updateControls();
  }

  function loadArtwork(source) {
    const image = $("fantasy-art");
    const epoch = ++artworkEpoch;
    stopComputerTimer();
    updateArtworkState("loading");
    const finish = state => {
      // A delayed decode or a previous board's load must never unlock this board.
      if (epoch !== artworkEpoch || image.getAttribute("src") !== source || artworkState !== "loading") return;
      updateArtworkState(state);
      if (state === "ready") scheduleComputer();
    };
    image.onload = async () => {
      try {
        // `load` can fire before async decoding paints the actual JPG.
        if (typeof image.decode === "function") await image.decode();
        if (!image.naturalWidth) throw new Error("The original picture could not decode.");
        finish("ready");
      } catch { finish("error"); }
    };
    image.onerror = () => finish("error");
    if (image.getAttribute("src") !== source) image.src = source;
    // The initial picture can finish or fail before this deferred script runs.
    if (image.complete) {
      if (image.naturalWidth) image.onload();
      else image.onerror();
    }
  }

  function applyAppearance() {
    $("board").classList.toggle("is-3d", preferences.perspective);
    syncBoardCamera();
    if (pictureBoardIndex !== game.boardIndex) {
      pictureBoardIndex = game.boardIndex;
      loadArtwork(`snakes-and-ladders-board-${pad(game.boardIndex + 1)}.jpg`);
    }
    $("fantasy-art").alt = `Original Snakes and Ladders board ${game.boardIndex + 1}`;
    $("tracking-layer").style.setProperty("--art-inset", `${Game.ARTWORK_GRID.inset / Game.ARTWORK_GRID.size * 100}%`);
    $("view-toggle").setAttribute("aria-pressed", String(preferences.perspective));
    $("view-toggle").setAttribute("aria-label", preferences.perspective ? "Return to flat board view" : "Enable 3D board view");
    $("sound-toggle").setAttribute("aria-pressed", String(preferences.sound));
    const soundLabel = preferences.sound ? "Turn sound off" : "Turn sound on";
    $("sound-toggle").setAttribute("aria-label", soundLabel);
    $("sound-toggle").title = soundLabel;
    $("sound-toggle").querySelector("use").setAttribute("href", `#i-${preferences.sound ? "volume" : "muted"}`);
    syncMenu();
  }

  function renderBoard() {
    const board = Game.BOARDS[game.boardIndex];
    $("board-name").textContent = board.name;
    $("board-number").textContent = `ORIGINAL PICTURE · BOARD ${pad(game.boardIndex + 1)} OF 20`;
    makeBoardTracking($("board-svg"), board);
    buildPieces();
    clearPaths();
    applyAppearance();
    requestAnimationFrame(fitBoard);
  }

  function render() {
    updatePlayers();
    updateControls();
    updateActivity();
    if (menuOpen) syncMenu();
  }

  function finalMessage(entry) {
    const name = game.players[entry.player].name;
    const next = `${game.players[game.turn].name}’s turn.`;
    if (entry.type === "win") return `${name} reached 100. What a lovely finish!`;
    if (entry.type === "ladder") return `A lucky little climb! ${name}: ${entry.landed} → ${entry.to}. ${next}`;
    if (entry.type === "snake") return `A twist in the trail. ${name} slid ${entry.landed} → ${entry.to}. ${next}`;
    if (entry.type === "riddle") return `${name} solved the haiku and stayed on ${entry.landed}. ${next}`;
    if (entry.type === "overshoot") return `${name} rolled ${entry.die}, but needs ${100 - entry.from} to finish. Staying on ${entry.from}. ${next}`;
    return `${name} rolled ${entry.die} and reached square ${entry.to}. ${next}`;
  }

  function clearPaths() {
    currentFilter = null;
    $("board-svg").classList.remove("filter-ladder", "filter-snake");
    $("board-svg").querySelectorAll(".selected-path").forEach(node => node.classList.remove("selected-path"));
    $("show-ladders").setAttribute("aria-pressed", "false");
    $("show-snakes").setAttribute("aria-pressed", "false");
  }

  function inspectPath(group) {
    if (!group || busy) return;
    const wasSelected = group.classList.contains("selected-path");
    clearPaths();
    if (wasSelected) {
      status(Game.BOARDS[game.boardIndex].tagline);
      return;
    }
    group.classList.add("selected-path");
    const { kind, from, to } = group.dataset;
    status(`${kind === "ladder" ? "A lucky shortcut" : "Watch your step"}: ${from} → ${to}. Land on ${from} to ${kind === "ladder" ? "climb up" : "slide down"}.`, kind);
  }

  function filterPaths(kind) {
    if (busy) return;
    const selected = currentFilter === kind;
    clearPaths();
    if (selected) { status(Game.BOARDS[game.boardIndex].tagline); return; }
    currentFilter = kind;
    $("board-svg").classList.add(`filter-${kind}`);
    $(kind === "ladder" ? "show-ladders" : "show-snakes").setAttribute("aria-pressed", "true");
    status(kind === "ladder" ? "Nine lucky shortcuts. Land at a ladder’s foot to climb to its top." : "Ten little twists. Land on a snake’s head to slide to its tail.", kind);
  }

  const onlineReady = () => online && online.status === "playing";
  const onlineMyTurn = () => online && online.status === "playing" && game.turn === online.player;

  function stopPolling() {
    clearTimeout(onlinePoll);
    onlinePoll = null;
    pollAbort?.abort();
    pollAbort = null;
  }

  async function pollRoom() {
    if (!online) return;
    const { code, player, version } = online;
    pollAbort = new AbortController();
    try {
      const headers = { Accept: "application/json" };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const response = await fetch(`api/rooms/${code}?player=${player}&since=${version}`, { headers, signal: pollAbort.signal });
      const data = await response.json().catch(() => ({}));
      if (!online || online.code !== code) return;
      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {
          // Room gone, leave cleanly
          stopOnline(false);
          save();
          setMenuOpen(true, "play");
          $("online-message").textContent = "That room has ended. Create a new one or ask for a fresh code.";
          return;
        }
        throw new Error(data.error || "Room unavailable.");
      }
      if (!data.unchanged) handleRoomSnapshot(data);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (!online || online.code !== code) return;
      $("room-status").textContent = "This room could not be reached. It may have ended — create a new one.";
    }
    if (!online || online.code !== code) return;
    onlinePoll = setTimeout(pollRoom, 500);
  }

  function startPolling() {
    stopPolling();
    pollRoom();
  }

  function adoptRoom(data, message) {
    online = { code: data.code, player: data.player, version: data.version, seats: [...data.seats], names: [...data.names], colors: [...data.colors], ready: [...data.ready], status: data.status, host: data.host, isPublic: data.isPublic, boardIndex: data.boardIndex, pending: data.pending || null };
    savedOnline = { code: data.code, player: data.player };
    onlineEntered = false;
    game.players.forEach((player, i) => { if (data.names[i]) player.name = data.names[i]; });
    // Only apply game state if status is "playing" (state field arrives in snapshot)
    if (data.status === "playing" && data.state) {
      applyRoomState(data.state, {});
    }
    save();
    // Go to lobby view for lobby status, room view for playing
    setMenuView(data.status === "playing" ? "room" : "lobby");
    syncLobbyView(message);
    generateRoomQR(data.code);
    startPolling();
  }

  async function createRoom() {
    if (authSkipped && !authToken) await ensureGuestAuth();
    $("online-message").textContent = "Creating your room…";
    try {
      const color = $("online-create-color")?.value || "blue";
      const data = await api("api/rooms", { name: game.players[0].name, color });
      adoptRoom(data, `Room ${data.code} is ready. Share the code with your friend.`);
    } catch (error) { $("online-message").textContent = error.message; }
  }

  async function joinRoom(rawCode) {
    if (authSkipped && !authToken) await ensureGuestAuth();
    const code = String(rawCode || "").trim().toUpperCase();
    if (code.length !== 5) {
      $("online-message").textContent = "Enter the five-character room code.";
      $("online-code").focus();
      return;
    }
    $("online-message").textContent = `Joining room ${code}…`;
    try {
      const color = $("online-join-color")?.value || "blue";
      adoptRoom(await api(`api/rooms/${code}/join`, { name: game.players[0].name, color }), `You joined room ${code}.`);
    } catch (error) {
      const msg = error.message || "Could not join room";
      if (msg.includes("404") || msg.includes("410") || msg.includes("expired") || msg.includes("ended")) {
        $("online-message").textContent = "That room has ended or the code is invalid. Create a new room or ask for a fresh code.";
      } else {
        $("online-message").textContent = msg;
      }
    }
  }

  async function rejoinRoom() {
    if (!savedOnline) return;
    try {
      adoptRoom(await api(`api/rooms/${savedOnline.code}/rejoin`, { player: savedOnline.player }), `Back in room ${savedOnline.code}.`);
    } catch {
      savedOnline = null;
      save();
      syncMenu();
      setMenuView("online");
      $("online-message").textContent = "That room has ended. Create a new one or ask for a fresh code.";
    }
  }

  function stopOnline(leave) {
    const room = online;
    online = null;
    onlineEntered = false;
    savedOnline = null;
    stopPolling();
    if (leave && room) api(`api/rooms/${room.code}/leave`, { player: room.player }).catch(() => {});
  }

  function leaveRoom() {
    stopOnline(true);
    save();
    setMenuOpen(true, "play");
    $("online-message").textContent = "You left the room.";
  }

  async function copyInvite() {
    const link = `${location.origin}${location.pathname}?room=${online?.code || ""}`;
    try {
      await navigator.clipboard.writeText(link);
      $("online-message").textContent = "Invite link copied. Send it to your friend!";
    } catch {
      $("online-message").textContent = `Share this code: ${online?.code || ""}.`;
    }
  }

  // Lobby handlers
  async function startGameFromLobby() {
    if (!online || online.player !== online.host) return;
    if (online.status !== "lobby") return;
    const seatedCount = online.seats.filter(s => s).length;
    if (seatedCount < 2) return;
    const allReady = online.seats.every((s, i) => !s || online.ready[i]);
    if (!allReady) return;
    try {
      const data = await api(`api/rooms/${online.code}/start`, { name: game.players[0].name });
      adoptRoom(data, "Game started!");
    } catch (error) { $("online-message").textContent = error.message; }
  }

  function handleLobbySeatClick(event) {
    const readyBtn = event.target.closest('.lobby-ready-toggle');
    if (readyBtn) {
      const seat = Number(readyBtn.dataset.seat);
      const currentReady = readyBtn.dataset.ready === 'true';
      if (seat !== online.player) return; // Only toggle own ready
      toggleReady(seat, !currentReady);
      return;
    }
    const colorSwatch = event.target.closest('.lobby-color-swatch:not(.disabled)');
    if (colorSwatch) {
      const seat = Number(colorSwatch.dataset.seat);
      const color = colorSwatch.dataset.color;
      if (seat !== online.player) return; // Only change own color
      changeColor(seat, color);
      return;
    }
  }

  async function toggleReady(seat, ready) {
    if (!online || online.status !== "lobby") return;
    try {
      await api(`api/rooms/${online.code}/ready`, { seatIndex: seat, name: online.names[seat] });
    } catch (error) { $("online-message").textContent = error.message; }
  }

  async function changeColor(seat, color) {
    if (!online || online.status !== "lobby") return;
    // Check if color is taken by another player
    const taken = online.seats.some((s, i) => s && i !== seat && online.colors[i] === color);
    if (taken) return;
    try {
      await api(`api/rooms/${online.code}/join`, { name: online.names[seat], color });
      // After color change, need to re-ready
      if (online.ready[seat]) {
        await api(`api/rooms/${online.code}/ready`, { seatIndex: seat, name: online.names[seat] });
      }
    } catch (error) { $("online-message").textContent = error.message; }
  }

  // Public queue matchmaking
  let queuePoll = null;
  let queueAbort = null;

  async function joinPublicQueue() {
    if (!isAuthenticated() && !authSkipped) {
      const authDialog = $("auth-dialog");
      if (authDialog) authDialog.showModal();
      return;
    }
    if (authSkipped && !authToken) await ensureGuestAuth();
    setMenuView("queue");
    $("queue-message").textContent = "Searching for a public room…";
    try {
      const data = await api("api/queue", { token: authToken });
      if (data.queued) {
        // We created a new room, wait for someone to join
        waitForQueueRoom(data.code);
      } else {
        // We joined an existing room
        adoptRoom(data, "You've been matched!");
      }
    } catch (error) {
      $("queue-message").textContent = error.message;
      setTimeout(() => setMenuView("online-choice"), 2000);
    }
  }

  function cancelQueue() {
    if (queuePoll) clearTimeout(queuePoll);
    if (queueAbort) queueAbort.abort();
    queuePoll = null;
    queueAbort = null;
    api("api/queue/leave", { token: authToken }).catch(() => {});
    setMenuView("online-choice");
  }

  function waitForQueueRoom(code) {
    const checkRoom = async () => {
      if (queueAbort?.signal?.aborted) return;
      try {
        const headers = { Accept: "application/json" };
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        const response = await fetch(`api/rooms/${code}?since=0`, { headers, signal: queueAbort?.signal });
        const data = await response.json().catch(() => ({}));
        if (queueAbort?.signal?.aborted) return;
        if (data.status === "playing") {
          // Room started, join it
          adoptRoom(data, "Match found! Game starting…");
          return;
        }
        // Still in lobby, keep polling
        queuePoll = setTimeout(checkRoom, 1000);
      } catch (error) {
        if (queueAbort?.signal?.aborted) return;
        queuePoll = setTimeout(checkRoom, 1000);
      }
    };
    queueAbort = new AbortController();
    checkRoom();
  }

  // QR code generation for room
  function generateRoomQR(code) {
    const canvas = $("qr-canvas");
    const display = $("room-code-display");
    const section = canvas?.closest(".qr-section");
    if (!canvas || !code) return;
    canvas.innerHTML = "";
    if (display) display.textContent = code;
    if (typeof qrcode !== "undefined") {
      try {
        const qr = qrcode(0, "M");
        const joinUrl = `${location.origin}${location.pathname}?room=${code}`;
        qr.addData(joinUrl);
        qr.make();
        canvas.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1 });
      } catch (e) {
        console.warn("QR generation failed:", e);
      }
    }
    if (section) section.hidden = false;
  }

  // Scan QR code for joining
  async function scanQRCode() {
    const scanBtn = $("online-scan");
    const msg = $("online-message");
    const codeInput = $("online-code");

    if (!window.BarcodeDetector) {
      msg.textContent = "QR scanning not supported in this browser. Enter the code manually.";
      return;
    }

    scanBtn.disabled = true;
    scanBtn.innerHTML = '<svg class="icon spin" aria-hidden="true"><use href="#i-refresh"/></svg><span>Scanning…</span>';
    msg.textContent = "Point camera at a QR code…";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.setAttribute("playsinline", "");
      video.setAttribute("autoplay", "");
      await video.play();

      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      let scanning = true;

      const scanLoop = async () => {
        if (!scanning) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            scanning = false;
            const raw = barcodes[0].rawValue;
            stream.getTracks().forEach(t => t.stop());
            const match = raw.match(/[?&]room=([A-Z0-9]{5})/i);
            const code = match ? match[1].toUpperCase() : raw.trim().toUpperCase().slice(0, 5);
            if (/^[A-Z0-9]{5}$/.test(code)) {
              codeInput.value = code;
              msg.textContent = "";
              joinRoom(code);
            } else {
              msg.textContent = "QR code did not contain a valid room code.";
            }
            return;
          }
        } catch (e) { /* ignore detection errors */ }
        if (scanning) requestAnimationFrame(scanLoop);
      };
      scanLoop();

      setTimeout(() => {
        if (scanning) {
          scanning = false;
          stream.getTracks().forEach(t => t.stop());
          msg.textContent = "Scan timed out. Try again or enter the code manually.";
        }
      }, 30000);
    } catch (err) {
      stream?.getTracks?.().forEach(t => t.stop());
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        msg.textContent = "Camera permission denied. Enter the room code manually.";
      } else if (err.name === "NotFoundError") {
        msg.textContent = "No camera found. Enter the room code manually.";
      } else {
        msg.textContent = "Could not start camera. Enter the room code manually.";
      }
    } finally {
      scanBtn.disabled = false;
      scanBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-camera"/></svg><span>Scan QR</span>';
    }
  }

  function enterOnlineBoard() {
    onlineEntered = true;
    game.players.forEach((player, i) => { if (online?.names[i]) player.name = online.names[i]; });
    hideMenu();
    renderBoard();
    render();
    save();
    status(onlineReady() ? `${game.players[game.turn].name} starts. ${onlineMyTurn() ? "Your roll!" : "Waiting for your friend…"}` : "Waiting for another player to join…");
    if (online?.pending) handleOnlineSnakePending(online.pending);
  }

  async function copyInvite() {
    const link = `${location.origin}${location.pathname}?room=${online?.code || ""}`;
    try {
      await navigator.clipboard.writeText(link);
      $("online-message").textContent = "Invite link copied. Send it to your friend!";
    } catch {
      $("online-message").textContent = `Share this code: ${online?.code || ""}.`;
    }
  }

  async function scanQRCode() {
    const scanBtn = $("online-scan");
    const msg = $("online-message");
    const codeInput = $("online-code");

    // Check if BarcodeDetector is supported
    if (!window.BarcodeDetector) {
      msg.textContent = "QR scanning not supported in this browser. Enter the code manually.";
      return;
    }

    scanBtn.disabled = true;
    scanBtn.innerHTML = '<svg class="icon spin" aria-hidden="true"><use href="#i-refresh"/></svg><span>Scanning…</span>';
    msg.textContent = "Point camera at a QR code…";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.setAttribute("playsinline", "");
      video.setAttribute("autoplay", "");
      await video.play();

      const detector = new BarcodeDetector({ formats: ["qr_code"] });

      let scanning = true;
      const scanLoop = async () => {
        if (!scanning) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            scanning = false;
            const raw = barcodes[0].rawValue;
            stream.getTracks().forEach(t => t.stop());
            const match = raw.match(/[?&]room=([A-Z0-9]{5})/i);
            const code = match ? match[1].toUpperCase() : raw.trim().toUpperCase().slice(0, 5);
            if (/^[A-Z0-9]{5}$/.test(code)) {
              codeInput.value = code;
              msg.textContent = "";
              joinRoom(code);
            } else {
              msg.textContent = "QR code did not contain a valid room code.";
            }
            return;
          }
        } catch (e) {
          // Ignore detection errors
        }
        if (scanning) requestAnimationFrame(scanLoop);
      };
      scanLoop();

      // Timeout after 30 seconds
      setTimeout(() => {
        if (scanning) {
          scanning = false;
          stream.getTracks().forEach(t => t.stop());
          msg.textContent = "Scan timed out. Try again or enter the code manually.";
        }
      }, 30000);

    } catch (err) {
      stream?.getTracks?.().forEach(t => t.stop());
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        msg.textContent = "Camera permission denied. Enter the room code manually.";
      } else if (err.name === "NotFoundError") {
        msg.textContent = "No camera found. Enter the room code manually.";
      } else {
        msg.textContent = "Could not start camera. Enter the room code manually.";
      }
    } finally {
      scanBtn.disabled = false;
      scanBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-camera"/></svg><span>Scan QR</span>';
    }
  }

  function applyRoomState(state, { animate = false, entry = null } = {}) {
    if (!state) return;
    if (entry && animate && state.totalRolls === game.totalRolls + 1 && entry.player === game.turn) {
      const index = entry.player;
      const name = state.players[index].name;
      const result = Game.applyRoll(game, entry.die, { riddleRescued: entry.type === "riddle" });
      const epoch = gameEpoch;
      busy = true;
      render();
      animateRoll({ index, name, value: entry.die, result, epoch }).then(finished => {
        if (!finished) return;
        game = state;
        visualPositions = game.players.map(player => player.position);
        busy = false;
        render();
        status(finalMessage(entry), entry.type);
        save();
        if (game.winner !== null) { playSound("win"); showWin(); }
      }).catch(() => {
        game = state;
        visualPositions = game.players.map(player => player.position);
        busy = false;
        render();
        save();
      });
      return;
    }
    game = state;
    visualPositions = game.players.map(player => player.position);
    visualPositions.forEach((square, i) => positionPawn(i, square));
    render();
    applyAppearance();
  }

  function handleRoomSnapshot(data) {
    if (busy) { setTimeout(() => handleRoomSnapshot(data), 150); return; }
    if (!online || data.version < online.version) return;
    const wasJoined = Boolean(online.seats[0] && online.seats[1]);
    const wasLobby = online.status === "lobby";
    online.version = data.version;
    online.seats = [...data.seats];
    online.names = [...data.names];
    online.colors = [...data.colors];
    online.ready = [...data.ready];
    online.status = data.status;
    online.host = data.host;
    online.isPublic = data.isPublic;
    online.boardIndex = data.boardIndex;
    online.pending = data.pending || null;
    game.players.forEach((player, i) => { if (data.names[i]) player.name = data.names[i]; });
    const entry = data.last && data.state && data.state.totalRolls > game.totalRolls ? data.last : null;
    // Only apply room state if it exists (i.e., game has started)
    if (data.state) {
      applyRoomState(data.state, { animate: Boolean(entry), entry });
    }
    const joined = online.seats[0] && online.seats[1];
    const isLobby = data.status === "lobby";
    if (isLobby) {
      syncLobbyView(joined && !wasJoined ? "Your friend is here! Get ready." : undefined);
    } else {
      syncRoomView(joined && !wasJoined ? "Your friend is here! Go to the board when you are ready." : undefined);
      // If we just transitioned to playing, enter the board
      if (wasLobby && !isLobby) {
        enterOnlineBoard();
      }
    }
    if (onlineEntered && online.pending) handleOnlineSnakePending(online.pending);
    else if (!online.pending) onlineSnakePromptId = null;
  }

  async function requestOnlineRoll() {
    if (!online || busy || online.pending) return;
    if (!onlineReady()) { status("Waiting for your friend to join the room…"); return; }
    if (!onlineMyTurn()) { status(`It’s ${game.players[game.turn].name}’s turn.`); return; }
    if (artworkState !== "ready") return;
    try {
      busy = true;
      render();
      const data = await api(`api/rooms/${online.code}/roll`, { player: online.player });
      busy = false;
      if (online) handleRoomSnapshot(data);
    } catch (error) {
      busy = false;
      status(error.message);
    } finally {
      render();
    }
  }

  function stopComputerTimer() {
    clearTimeout(computerTimer);
    computerTimer = null;
  }

  function scheduleComputer() {
    stopComputerTimer();
    if (online || game.mode !== "computer" || game.turn !== 1 || game.winner !== null || busy || artworkState !== "ready" || anyDialogOpen() || document.hidden) return;
    computerTimer = setTimeout(() => {
      computerTimer = null;
      if (!anyDialogOpen() && !document.hidden) playTurn(true);
    }, Math.max(70, duration(900)));
  }

  async function animateJump({ index, name, jump, epoch }) {
    const pawn = $(`pawn-${index}`);
    status(jump.type === "ladder" ? `Up, up, and away! ${name} climbs ${jump.from} → ${jump.to}.` : `A little detour! ${name} slides ${jump.from} → ${jump.to}.`, jump.type);
    const route = $("board-svg").querySelector(`[data-kind="${jump.type}"][data-from="${jump.from}"]`);
    route?.classList.add("selected-path");
    await wait(170);
    pawn.classList.add("is-sliding");
    positionPawn(index, jump.to);
    playSound(jump.type);
    await wait(750);
    if (epoch !== gameEpoch) return false;
    pawn.classList.remove("is-sliding");
    highlightSquare(jump.to);
    return true;
  }

  async function animateRoll({ index, name, value, result, epoch, pauseAtSnake = false }) {
    const pawn = $(`pawn-${index}`);
    $("die").classList.add("rolling");
    const frames = reducedMotion.matches ? 1 : 8;
    for (let i = 0; i < frames; i++) {
      setDie((i + value) % 6 + 1);
      if (i % 2 === 0) playSound("roll");
      await wait(55);
      if (epoch !== gameEpoch) return false;
    }
    $("die").classList.remove("rolling");
    setDie(value);
    $("dice-caption").textContent = `${name} rolled a ${value}.`;
    status(`${name} rolled ${value}. ${result.steps.length ? "Let’s see where it leads…" : "An exact roll is needed to finish."}`);
    await wait(140);
    for (const square of result.steps) {
      pawn.classList.remove("hopping");
      void pawn.offsetWidth;
      pawn.classList.add("hopping");
      positionPawn(index, square);
      highlightSquare(square);
      playSound("step");
      await wait(205);
      if (epoch !== gameEpoch) return false;
    }
    pawn.classList.remove("hopping");
    if (result.jump && !(pauseAtSnake && result.jump.type === "snake")) {
      if (!(await animateJump({ index, name, jump: result.jump, epoch }))) return false;
    }
    await wait(180);
    return epoch === gameEpoch;
  }

  function setSnakeDialogView(showRiddle) {
    $("snake-choice-view").hidden = showRiddle;
    $("snake-riddle-view").hidden = !showRiddle;
  }

  function promptSnakeChoice(entry, source = {}) {
    return new Promise(resolve => {
      if (snakePrompt) completeSnakePrompt({ choice: "slide" });
      snakePrompt = { entry, source, resolve };
      riddleChallenge = null;
      setSnakeDialogView(false);
      $("snake-choice-copy").textContent = `You landed on the snake’s head at ${entry.landed}. Its tail is on ${entry.to}. Take the classic slide, or solve a haiku riddle to stay on ${entry.landed}.`;
      $("snake-classic-slide").textContent = `Take the slide to ${entry.to}`;
      $("snake-choice-feedback").textContent = "";
      $("snake-riddle-feedback").textContent = "";
      $("snake-riddle-answer").value = "";
      $("snake-riddle-submit").disabled = false;
      openDialog($("snake-dialog"));
      $("snake-classic-slide").focus({ preventScroll: true });
    });
  }

  function completeSnakePrompt(choice) {
    if (!snakePrompt) return;
    const prompt = snakePrompt;
    snakePrompt = null;
    riddleChallenge = null;
    if ($("snake-dialog").open) $("snake-dialog").close();
    prompt.resolve(choice);
  }

  async function startSnakeRiddle() {
    const prompt = snakePrompt;
    if (!prompt || riddleChallenge) return;
    const button = $("snake-riddle-start");
    button.disabled = true;
    $("snake-choice-feedback").textContent = "Gemini is writing a little haiku…";
    const body = prompt.source.roomCode
      ? { roomCode: prompt.source.roomCode, player: prompt.source.player, pendingId: prompt.source.pendingId }
      : {};
    try {
      const data = await api("api/riddles", body);
      if (snakePrompt !== prompt) return;
      if (typeof data.id !== "string" || typeof data.haiku !== "string") throw new Error("Gemini returned an incomplete riddle. Please try again.");
      riddleChallenge = { id: data.id };
      $("snake-haiku").textContent = data.haiku;
      $("snake-riddle-feedback").textContent = "";
      $("snake-choice-feedback").textContent = "";
      setSnakeDialogView(true);
      $("snake-riddle-answer").focus({ preventScroll: true });
    } catch (error) {
      if (snakePrompt === prompt) $("snake-choice-feedback").textContent = error.message || "Gemini could not make a riddle. You can still take the classic slide.";
    } finally {
      if (snakePrompt === prompt) button.disabled = false;
    }
  }

  async function submitSnakeAnswer(event) {
    event.preventDefault();
    const prompt = snakePrompt;
    if (!prompt || !riddleChallenge) return;
    const answerButton = $("snake-riddle-submit");
    answerButton.disabled = true;
    $("snake-riddle-feedback").textContent = "Checking your answer…";
    const body = { answer: $("snake-riddle-answer").value };
    if (prompt.source.roomCode) Object.assign(body, {
      roomCode: prompt.source.roomCode,
      player: prompt.source.player,
      pendingId: prompt.source.pendingId,
    });
    try {
      const result = await api(`api/riddles/${encodeURIComponent(riddleChallenge.id)}/answer`, body);
      if (snakePrompt !== prompt) return;
      if (result.correct) {
        $("snake-riddle-feedback").textContent = `Lovely! You solved it and stay on ${prompt.entry.landed}.`;
        await wait(450);
        if (snakePrompt === prompt) completeSnakePrompt({ choice: "riddle", riddleId: riddleChallenge.id });
      } else {
        $("snake-riddle-feedback").textContent = `Not quite — the answer was ${result.answer || "a little mystery"}. The snake takes you to ${prompt.entry.to}.`;
        await wait(900);
        if (snakePrompt === prompt) completeSnakePrompt({ choice: "slide" });
      }
    } catch (error) {
      if (snakePrompt === prompt) {
        $("snake-riddle-feedback").textContent = error.message || "The answer could not be checked. Try again, or take the slide.";
        answerButton.disabled = false;
      }
    }
  }

  function handleOnlineSnakePending(pending) {
    if (!online || !onlineEntered) return;
    if (pending.player !== online.player) {
      if (!snakePrompt) status(`${game.players[pending.player].name} landed on snake head ${pending.landed}; waiting for their choice…`, "snake");
      return;
    }
    if (onlineSnakePromptId === pending.id) return;
    onlineSnakePromptId = pending.id;
    busy = true;
    render();
    promptSnakeChoice(pending, { roomCode: online.code, player: online.player, pendingId: pending.id })
      .then(choice => resolveOnlineSnake(choice))
      .catch(error => {
        busy = false;
        onlineSnakePromptId = null;
        status(error.message || "That snake turn could not be resolved.", "snake");
        render();
      });
  }

  async function resolveOnlineSnake(choice) {
    if (!online?.pending) { busy = false; return; }
    const { code, player } = online;
    busy = true;
    render();
    try {
      const data = await api(`api/rooms/${code}/resolve`, { player, choice: choice.choice, riddleId: choice.riddleId });
      busy = false;
      if (online && online.code === code) handleRoomSnapshot(data);
    } catch (error) {
      busy = false;
      onlineSnakePromptId = null;
      status(error.message || "That snake turn could not be resolved. Please choose again.", "snake");
      if (online?.pending) handleOnlineSnakePending(online.pending);
    } finally { render(); }
  }

  async function playTurn(automated = false) {
    if (online) return requestOnlineRoll();
    if (busy || artworkState !== "ready" || anyDialogOpen()) return;
    if (game.winner !== null) { openSetup(); return; }
    if (game.mode === "computer" && game.turn === 1 && !automated) return;
    stopComputerTimer();
    const epoch = gameEpoch;
    const index = game.turn;
    const name = game.players[index].name;
    const value = Game.rollDie();
    let result = Game.applyRoll(game, value);
    const pawn = $(`pawn-${index}`);
    busy = true;
    clearPaths();
    highlightSquare(game.players[index].position);
    render();
    status(`${name} is rolling…`);
    try {
      const fernTurn = game.mode === "computer" && index === 1;
      if (result.entry.type === "snake" && !fernTurn) {
        if (!(await animateRoll({ index, name, value, result, epoch, pauseAtSnake: true }))) return;
        const choice = await promptSnakeChoice(result.entry);
        if (epoch !== gameEpoch) return;
        if (choice?.choice === "riddle") result = Game.applyRoll(game, value, { riddleRescued: true });
        if (result.entry.type === "snake" && !(await animateJump({ index, name, jump: result.jump, epoch }))) return;
      } else if (!(await animateRoll({ index, name, value, result, epoch }))) return;
      // Commit only a completed turn. Reloading mid-animation restores the last safe state.
      game = result.state;
      visualPositions = game.players.map(player => player.position);
      busy = false;
      render();
      status(finalMessage(result.entry), result.entry.type);
      save();
      if (game.winner !== null) { playSound("win"); showWin(); }
      else scheduleComputer();
    } catch (error) {
      console.error("Could not complete this turn:", error);
      if (epoch === gameEpoch) {
        visualPositions = game.players.map(player => player.position);
        visualPositions.forEach((square, i) => positionPawn(i, square));
        status("That roll got a little lost. Your progress is safe — please try again.");
      }
    } finally {
      if (epoch === gameEpoch) {
        busy = false;
        pawn.classList.remove("hopping", "is-sliding");
        $("die").classList.remove("rolling");
        render();
      }
    }
  }

function startGame(options = {}) {
    returnToMenu = false;
    stopComputerTimer();
    if (online) stopOnline(true);
    gameEpoch++;
    busy = false;
    clearTimeout(confettiTimer);
    $("confetti").replaceChildren();
    // For computer (Fern) mode, server picks the board - use random if not explicitly provided
    const isComputerMode = options.mode === "computer" || (options.mode === undefined && game.mode === "computer");
    const boardIndex = (isComputerMode && options.boardIndex === undefined) ? Math.floor(Math.random() * Game.BOARDS.length) : (options.boardIndex ?? game.boardIndex);
    game = Game.createGame({ boardIndex, mode: options.mode ?? game.mode, names: options.names ?? game.players.map(player => player.name) });
    visualPositions = [1, 1];
    if (game.mode === "local") localFriendName = game.players[1].name;
    dialogs.forEach(dialog => { if (dialog.open) dialog.close(); });
    setMenuOpen(false);
    renderBoard();
    render();
    setDie(1);
    status(`${game.players[0].name} starts on square 1. Let's roll!`);
    save();
    $("roll").focus({ preventScroll: true });
    scheduleComputer();
  }

  function openDialog(dialog) {
    stopComputerTimer();
    if (!dialog.open) dialog.showModal();
  }

  function renderPicker() {
    const grid = $("board-picker");
    if (grid.children.length) { updateBoardSelection(); return; }
    Game.BOARDS.forEach((board, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "board-choice";
      button.dataset.board = i;
      button.setAttribute("aria-label", `Board ${i + 1}: ${board.name}`);
      const preview = document.createElement("span");
      preview.className = "board-preview";
      const image = document.createElement("img");
      // Lightweight previews are resized copies of the supplied JPGs, not redrawn boards.
      image.src = `assets/fantasy/board-${pad(i + 1)}.webp`;
      image.alt = "";
      image.loading = "lazy";
      preview.appendChild(image);
      button.appendChild(preview);
      const label = document.createElement("span");
      label.className = "board-choice-name";
      label.textContent = board.name;
      button.appendChild(label);
      const number = document.createElement("span");
      number.className = "board-choice-number";
      button.appendChild(number);
      const check = document.createElement("span");
      check.className = "board-choice-check";
      check.innerHTML = icon("check");
      button.appendChild(check);
      grid.appendChild(button);
    });
    updateBoardSelection();
  }

  function updateBoardSelection() {
    $("board-picker").querySelectorAll(".board-choice").forEach(button => {
      const i = Number(button.dataset.board);
      button.setAttribute("aria-pressed", String(i === selectedBoard));
      button.hidden = Math.floor(i / BOARDS_PER_PAGE) !== pickerPage;
      button.querySelector(".board-choice-number").textContent = `BOARD ${pad(i + 1)}${i === game.boardIndex ? " · CURRENT" : ""}`;
    });
    $("selected-board-label").textContent = Game.BOARDS[selectedBoard].name;
    $("board-page-label").textContent = `Boards ${pickerPage * BOARDS_PER_PAGE + 1}–${Math.min((pickerPage + 1) * BOARDS_PER_PAGE, Game.BOARDS.length)} of ${Game.BOARDS.length}`;
    $("previous-boards").disabled = pickerPage === 0;
    $("next-boards").disabled = (pickerPage + 1) * BOARDS_PER_PAGE >= Game.BOARDS.length;
    $("play-board").innerHTML = `${selectedBoard === game.boardIndex ? "Keep playing" : "Let’s play"}${icon("arrow")}`;
  }

  function openBoards() {
    if (busy) return;
    selectedBoard = game.boardIndex;
    pickerPage = Math.floor(selectedBoard / BOARDS_PER_PAGE);
    renderPicker();
    openDialog($("boards-dialog"));
  }

  function syncNameField() {
    const computer = $("setup-form").elements.mode.value === "computer";
    const field = $("player-two-name");
    if (computer && !field.disabled) localFriendName = field.value || localFriendName;
    field.disabled = computer;
    field.value = computer ? "Fern" : localFriendName;
    $("player-two-label").querySelector("span").textContent = computer ? "Computer companion" : "Friend’s name";
  }

  function openSetup() {
    if (busy) return;
    const form = $("setup-form");
    form.elements.mode.value = game.mode;
    form.elements.speed.value = preferences.speed;
    $("player-one-name").value = game.players[0].name;
    if (game.mode === "local") localFriendName = game.players[1].name;
    $("player-two-name").disabled = game.mode === "computer";
    $("player-two-name").value = game.mode === "computer" ? "Fern" : localFriendName;
    syncNameField();
    $("setup-note").textContent = `You’ll play on ${Game.BOARDS[game.boardIndex].name}.${game.totalRolls ? " Starting replaces your current game." : " First to 100 wins the bragging rights."}`;
    openDialog($("setup-dialog"));
  }

  function showWin() {
    const winner = game.players[game.winner];
    $("winner-name").textContent = winner.name;
    $("winner-rolls").textContent = winner.rolls;
    $("winner-climbs").textContent = winner.climbs;
    $("winner-slides").textContent = winner.slides;
    openDialog($("win-dialog"));
    if (reducedMotion.matches) return;
    $("confetti").replaceChildren();
    for (let i = 0; i < 42; i++) {
      const piece = document.createElement("i");
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = ["#98b47f", "#dfc58a", "#c98b72", "#a2b8c0", "#e8dcae"][i % 5];
      piece.style.animationDelay = `${Math.random() * .8}s`;
      piece.style.setProperty("--drift", `${(Math.random() - .5) * 240}px`);
      piece.style.setProperty("--spin", `${360 + Math.random() * 600}deg`);
      $("confetti").appendChild(piece);
    }
    clearTimeout(confettiTimer);
    confettiTimer = setTimeout(() => $("confetti").replaceChildren(), 3800);
  }

  // Quiet, opt-in Web Audio cues. No audio files, external service, or autoplay.
  function unlockAudio() {
    if (!preferences.sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audioContext ||= new Audio();
      if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    } catch { /* Sound is an enhancement, never a requirement for playing. */ }
  }

  function playSound(kind) {
    if (!preferences.sound || !audioContext || audioContext.state !== "running") return;
    const notes = { roll: [240], step: [430], ladder: [440, 554, 659], snake: [392, 330, 262], win: [523, 659, 784, 1047] }[kind] || [];
    try {
      notes.forEach((frequency, i) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const start = audioContext.currentTime + i * .095;
        oscillator.type = kind === "roll" ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.035, start + .01);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .13);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + .15);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    } catch { /* Browsers may suspend sound when a tab goes into the background. */ }
  }

  $("menu-play").addEventListener("click", () => setMenuView("play"));
  $("menu-settings").addEventListener("click", () => setMenuView("settings"));
  $("menu-exit").addEventListener("click", () => {
    setMenuView("exit");
    // A tab may only close itself when script opened it; the farewell screen stays either way.
    try { window.close(); } catch { /* nothing else to do */ }
  });
  $("exit-back").addEventListener("click", () => setMenuView("main"));
  document.querySelectorAll("[data-menu-back]").forEach(button => button.addEventListener("click", () => setMenuView("main")));
  startMenu.addEventListener("keydown", event => {
    if (event.key === "Escape" && menuView !== "main") { event.preventDefault(); setMenuView(menuView === "online" ? "play" : "main"); }
  });
  $("menu-friend").addEventListener("click", () => startGame({ mode: "local" }));
  $("menu-fern").addEventListener("click", () => startGame({ mode: "computer" }));
  $("menu-online").addEventListener("click", () => {
    if (isAuthenticated() || authSkipped) {
      setMenuView("online-choice");
      $("online-message").textContent = "Choose public matchmaking or a private room.";
    } else {
      const authDialog = $("auth-dialog");
      if (authDialog) authDialog.showModal();
    }
  });
  $("online-public").addEventListener("click", () => joinPublicQueue());
  $("online-private").addEventListener("click", () => {
    setMenuView("online");
    $("online-message").textContent = "Create a room, or join with a code from a friend.";
  });
  $("queue-cancel").addEventListener("click", cancelQueue);
  $("menu-continue").addEventListener("click", () => {
    hideMenu();
    status(`Welcome back! ${game.players[game.turn].name}’s turn.`);
  });
  $("menu-rejoin").addEventListener("click", rejoinRoom);
  $("online-create").addEventListener("click", () => {
    $("online-actions").hidden = true;
    $("online-join-form").hidden = true;
    $("online-create-options").hidden = false;
  });
  $("online-create-cancel").addEventListener("click", () => {
    $("online-create-options").hidden = true;
    $("online-actions").hidden = false;
    $("online-join-form").hidden = false;
  });
  $("online-create-confirm").addEventListener("click", createRoom);
  $("online-join-form").addEventListener("submit", event => { event.preventDefault(); joinRoom($("online-code").value); });
  $("online-code").addEventListener("input", event => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  });
  // Color picker handlers
  document.querySelectorAll('#online-create-color-picker .color-swatch, #online-join-color-picker .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const picker = swatch.closest('.color-picker-row');
      const input = picker.id === 'online-create-color-picker' ? 'online-create-color' : 'online-join-color';
      document.querySelectorAll(`#${picker.id} .color-swatch`).forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      $(input).value = swatch.dataset.color;
    });
  });
  $("online-scan").addEventListener("click", scanQRCode);
  $("online-copy").addEventListener("click", copyInvite);
  $("online-enter").addEventListener("click", enterOnlineBoard);
  $("online-leave").addEventListener("click", leaveRoom);
  $("lobby-start").addEventListener("click", startGameFromLobby);
  $("lobby-leave").addEventListener("click", leaveRoom);
  $("lobby-copy").addEventListener("click", copyInvite);
  // Lobby seat interactions (delegated)
  $("lobby-seats").addEventListener("click", handleLobbySeatClick);
  $("setting-sound").addEventListener("click", () => {
    preferences.sound = !preferences.sound;
    unlockAudio();
    playSound("step");
    applyAppearance();
    save();
  });
  $("setting-pace").addEventListener("click", () => {
    preferences.speed = preferences.speed === "quick" ? "normal" : "quick";
    save();
    syncMenu();
  });
  $("setting-view").addEventListener("click", () => {
    preferences.perspective = !preferences.perspective;
    applyAppearance();
    save();
  });
  $("setting-board").addEventListener("click", () => { returnToMenu = true; setMenuOpen(false); openBoards(); });
  $("setting-names").addEventListener("click", () => { returnToMenu = true; setMenuOpen(false); openSetup(); });
  $("roll").addEventListener("click", () => { unlockAudio(); playTurn(); });
  $("snake-close").addEventListener("click", () => completeSnakePrompt({ choice: "slide" }));
  $("snake-classic-slide").addEventListener("click", () => completeSnakePrompt({ choice: "slide" }));
  $("snake-riddle-start").addEventListener("click", startSnakeRiddle);
  $("snake-riddle-form").addEventListener("submit", submitSnakeAnswer);
  $("snake-riddle-skip").addEventListener("click", () => completeSnakePrompt({ choice: "slide" }));
  $("snake-dialog").addEventListener("cancel", event => {
    event.preventDefault();
    completeSnakePrompt({ choice: "slide" });
  });
  $("newgame").addEventListener("click", openSetup);
  $("edit-players").addEventListener("click", openSetup);
  $("mode-button").addEventListener("click", () => setMenuOpen(true, online ? "room" : "play"));
  $("change-board").addEventListener("click", openBoards);
  $("how-to-play").addEventListener("click", () => { if (!busy) openDialog($("rules-dialog")); });
  $("show-ladders").addEventListener("click", () => filterPaths("ladder"));
  $("show-snakes").addEventListener("click", () => filterPaths("snake"));
  $("view-toggle").addEventListener("click", () => { preferences.perspective = !preferences.perspective; applyAppearance(); save(); });
$("sound-toggle").addEventListener("click", () => {
    preferences.sound = !preferences.sound;
    unlockAudio();
    playSound("step");
    applyAppearance();
    save();
  });

  $("players-toggle").addEventListener("click", () => openSheet("players-sheet", "players-sheet-scrim", $("players-toggle")));
  $("players-sheet-close").addEventListener("click", () => closeSheet("players-sheet", "players-sheet-scrim"));
  $("players-sheet-scrim").addEventListener("click", () => closeSheet("players-sheet", "players-sheet-scrim"));

  $("activity-toggle").addEventListener("click", () => openSheet("activity-sheet", "activity-sheet-scrim", $("activity-toggle")));
  $("activity-sheet-close").addEventListener("click", () => closeSheet("activity-sheet", "activity-sheet-scrim"));
  $("activity-sheet-scrim").addEventListener("click", () => closeSheet("activity-sheet", "activity-sheet-scrim"));

  document.addEventListener("keydown", handleSheetKeydown);

  $("retry-art").addEventListener("click", () => {
    loadArtwork(`snakes-and-ladders-board-${pad(game.boardIndex + 1)}.jpg?retry=${Date.now()}`);
  });
  $("board-svg").addEventListener("click", event => inspectPath(event.target.closest(".path-group")));
  $("board-svg").addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      const group = event.target.closest(".path-group");
      if (group) { event.preventDefault(); inspectPath(group); }
    }
  });
  $("board-picker").addEventListener("click", event => {
    const choice = event.target.closest(".board-choice");
    if (!choice) return;
    selectedBoard = Number(choice.dataset.board);
    updateBoardSelection();
  });
  $("shuffle-board").addEventListener("click", () => {
    selectedBoard = (selectedBoard + 1 + Math.floor(Math.random() * (Game.BOARDS.length - 1))) % Game.BOARDS.length;
    pickerPage = Math.floor(selectedBoard / BOARDS_PER_PAGE);
    updateBoardSelection();
  });
  $("previous-boards").addEventListener("click", () => { pickerPage--; updateBoardSelection(); });
  $("next-boards").addEventListener("click", () => { pickerPage++; updateBoardSelection(); });
  $("board-picker").addEventListener("keydown", event => {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 };
    const choice = event.target.closest(".board-choice");
    if (!choice || !(event.key in offsets)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(Game.BOARDS.length - 1, Number(choice.dataset.board) + offsets[event.key]));
    pickerPage = Math.floor(next / BOARDS_PER_PAGE);
    updateBoardSelection();
    $("board-picker").querySelector(`[data-board="${next}"]`).focus({ preventScroll: true });
  });
  $("play-board").addEventListener("click", () => {
    if (selectedBoard === game.boardIndex) $("boards-dialog").close();
    else startGame({ boardIndex: selectedBoard });
  });
  $("setup-form").addEventListener("change", event => { if (event.target.name === "mode") syncNameField(); });
  $("setup-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    preferences.speed = form.elements.speed.value;
    startGame({ mode: form.elements.mode.value, names: [$("player-one-name").value, $("player-two-name").value] });
  });
  $("play-again").addEventListener("click", () => startGame(game.mode === "computer" ? { boardIndex: Math.floor(Math.random() * Game.BOARDS.length) } : {}));
  $("winner-change-board").addEventListener("click", () => { $("win-dialog").close(); openBoards(); });
  document.querySelectorAll("[data-close-dialog]").forEach(button => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  dialogs.forEach(dialog => {
    dialog.addEventListener("close", () => {
      if (returnToMenu) {
        returnToMenu = false;
        setMenuOpen(true, menuView === "main" ? "settings" : menuView);
        return;
      }
      scheduleComputer();
    });
    dialog.addEventListener("click", event => {
      if (dialog.id === "snake-dialog" || event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  dialogs.forEach(dialog => {
    dialog.addEventListener("close", () => {
      if (returnToMenu) {
        returnToMenu = false;
        setMenuOpen(true, menuView === "main" ? "settings" : menuView);
        return;
      }
      scheduleComputer();
    });
    dialog.addEventListener("click", event => {
      if (dialog.id === "snake-dialog" || event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });

  // Auth dialog handlers
  const authDialog = $("auth-dialog");
  if (authDialog) {
    authDialog.querySelectorAll("[data-close-auth]").forEach(btn => btn.addEventListener("click", () => authDialog.close()));
    authDialog.addEventListener("close", () => {
      if (returnToMenu) {
        returnToMenu = false;
        setMenuOpen(true, menuView === "main" ? "settings" : menuView);
      }
    });
    authDialog.addEventListener("click", event => {
      if (event.target !== authDialog) return;
      const rect = authDialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) authDialog.close();
    });
  }

  // Auth form handlers
  const loginForm = $("auth-login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async event => {
      event.preventDefault();
      const username = loginForm.elements.username.value.trim();
      const password = loginForm.elements.password.value;
      const errorEl = $("auth-login-error");
      errorEl.textContent = "";
      try {
        await authLogin(username, password);
        loginForm.reset();
        $("auth-dialog").close();
        setMenuView("online-choice");
        $("online-message").textContent = "Choose public matchmaking or a private room.";
      } catch (error) {
        errorEl.textContent = error.message;
      }
    });
  }

  const registerForm = $("auth-register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async event => {
      event.preventDefault();
      const username = registerForm.elements.username.value.trim();
      const password = registerForm.elements.password.value;
      const errorEl = $("auth-register-error");
      errorEl.textContent = "";
      try {
        await authRegister(username, password);
        registerForm.reset();
        $("auth-dialog").close();
        setMenuView("online-choice");
        $("online-message").textContent = "Choose public matchmaking or a private room.";
      } catch (error) {
        errorEl.textContent = error.message;
      }
    });
  }

  // Switch between login/register
  const switchToRegister = $("auth-switch-to-register");
  if (switchToRegister) {
    switchToRegister.addEventListener("click", () => {
      $("auth-login-view").hidden = true;
      $("auth-register-view").hidden = false;
    });
  }
  const switchToLogin = $("auth-switch-to-login");
  if (switchToLogin) {
    switchToLogin.addEventListener("click", () => {
      $("auth-register-view").hidden = true;
      $("auth-login-view").hidden = false;
    });
  }

  // Guest/skip buttons
  const skipLogin = $("auth-skip");
  if (skipLogin) {
    skipLogin.addEventListener("click", () => {
      setGuestMode();
      $("auth-dialog").close();
      setMenuView("online-choice");
      $("online-message").textContent = "Choose public matchmaking or a private room.";
    });
  }
  const skipRegister = $("auth-skip-register");
  if (skipRegister) {
    skipRegister.addEventListener("click", () => {
      setGuestMode();
      $("auth-dialog").close();
      setMenuView("online-choice");
      $("online-message").textContent = "Choose public matchmaking or a private room.";
    });
  }

  // Auth menu view close handler (back button)
  const authMenuView = document.querySelector('[data-view="auth"]');
  if (authMenuView) {
    const backBtn = authMenuView.querySelector('[data-menu-back]');
    if (backBtn) {
      backBtn.addEventListener("click", () => setMenuView("play"));
    }
  }

  document.addEventListener("keydown", event => {
    if (event.code !== "Space" || event.repeat || event.ctrlKey || event.altKey || event.metaKey || anyDialogOpen()) return;
    if (event.target.closest("button, a, input, textarea, select, [tabindex], [contenteditable='true']")) return;
    event.preventDefault();
    unlockAudio();
    playTurn();
  });
  document.addEventListener("visibilitychange", () => document.hidden ? stopComputerTimer() : scheduleComputer());
  reducedMotion.addEventListener("change", () => visualPositions.forEach((square, i) => positionPawn(i, square)));
  installBoardCamera();
  window.addEventListener("resize", fitBoard);
  if ("ResizeObserver" in window) new ResizeObserver(fitBoard).observe($("board-stage"));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", fitBoard);
  }
  window.addEventListener("orientationchange", () => setTimeout(fitBoard, 100));

if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    });
  }

  loadAuth();
  loadSave();
  visualPositions = game.players.map(player => player.position);
  if (game.mode === "local") localFriendName = game.players[1].name;
  buildPlayers();
  renderBoard();
  render();
  setDie(game.history[0]?.die || 1);
  if (restored && game.totalRolls) status(game.winner !== null ? `${game.players[game.winner].name} reached 100. What a lovely finish!` : `Welcome back! ${game.players[game.turn].name}’s turn. Your adventure is right where you left it.`);
  save();

  // Ensure board is sized after initial layout paint
  requestAnimationFrame(fitBoard);

  // Initialize splash loader and drive progress from real asset readiness
  initSplashLoader();
})();
