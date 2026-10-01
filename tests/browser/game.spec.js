const { test, expect } = require("@playwright/test");
const SAVE_KEY = "snakes-and-ladders:v2";

async function face(page, value) {
  await page.evaluate(die => { window.crypto.getRandomValues = array => { array[0] = die - 1; return array; }; }, value);
}
async function savedGame(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)).game, SAVE_KEY);
}
async function setPosition(page, position, options = {}) {
  await page.evaluate(({ key, position, options }) => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.game = window.SnakeLadder.createGame(options);
    saved.game.players[0].position = position;
    localStorage.setItem(key, JSON.stringify(saved));
  }, { key: SAVE_KEY, position, options });
  await page.reload();
  await enterGame(page);
  await expect(page.locator("#player-position-0")).toHaveText(String(position).padStart(2, "0"));
}

async function previewBoard(page, index) {
  const label = await page.locator("#board-page-label").textContent();
  let current = Math.floor((Number(label.match(/Boards (\d+)/)[1]) - 1) / 4);
  const target = Math.floor(index / 4);
  while (current < target) { await page.locator("#next-boards").click(); current++; }
  while (current > target) { await page.locator("#previous-boards").click(); current--; }
  await page.locator(`.board-choice[data-board="${index}"]`).click();
}

async function noScroll(page) {
  const result = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    viewportHeight: innerHeight, viewportWidth: innerWidth, x: scrollX, y: scrollY,
  }));
  expect(result.height).toBeLessThanOrEqual(result.viewportHeight + 1);
  expect(result.width).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.x).toBe(0);
  expect(result.y).toBe(0);
}

// Every test starts in the new game menu; this walks it like a player would.
async function enterGame(page, { mode = "friend", ready = true } = {}) {
  await expect(page.locator("#start-menu")).toBeVisible();
  await page.locator("#menu-play").click();
  const continueButton = page.locator("#menu-continue");
  if (await continueButton.isVisible()) await continueButton.click();
  else await page.locator(`#menu-${mode}`).click();
  await expect(page.locator("#start-menu")).toBeHidden();
  if (ready) await expect(page.locator("#roll")).toBeEnabled();
}

async function menuFits(page) {
  const view = page.locator(".menu-view:not([hidden])");
  await fullyInView(page, ".menu-view:not([hidden])");
  await noScroll(page);
  const overflow = await page.evaluate(() => {
    const menu = document.getElementById("start-menu");
    const active = menu.querySelector(".menu-view:not([hidden])");
    const bounds = active.getBoundingClientRect();
    if (bounds.bottom > menu.getBoundingClientRect().bottom + 1 || bounds.right > menu.getBoundingClientRect().right + 1) return "panel";
    const controls = [...active.querySelectorAll("button, input")].filter(node => node.offsetParent !== null);
    const outside = controls.find(node => {
      const box = node.getBoundingClientRect();
      return box.top < -1 || box.left < -1 || box.bottom > innerHeight + 1 || box.right > innerWidth + 1;
    });
    return outside ? `${outside.id || outside.className}: ${JSON.stringify(outside.getBoundingClientRect())}` : "";
  });
  expect(overflow, "menu content must stay inside the window").toBe("");
  return view;
}

async function fullyInView(page, selector) {
  const bounds = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  expect(bounds, `${selector} must be visible`).not.toBeNull();
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

// Each test has its own browser context, including its own storage.
test.beforeEach(async ({ page }) => {
  await page.goto("/?fast=500");
  await enterGame(page);
});

test("starts cleanly with both pieces on square one and no horizontal overflow", async ({ page }) => {
  await expect(page.locator("#board-name")).toHaveText("The Greenhouse");
  await expect(page.locator("#player-position-0")).toHaveText("01");
  await expect(page.locator("#player-position-1")).toHaveText("01");
  await expect(page.locator(".pawn")).toHaveCount(2);
  await expect(page.locator(".path-group")).toHaveCount(19);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("rolling updates pieces, turn, activity, and the saved game", async ({ page }) => {
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#player-position-0")).toHaveText("05");
  await expect(page.locator("#turn-name")).toHaveText("Player 2’s turn");
  await expect(page.locator("#die")).toHaveAttribute("data-value", "4");
  await expect(page.locator("#activity")).toContainText("Moved 1 → 5");
  const state = await savedGame(page);
  expect(state.totalRolls).toBe(1);
  expect(state.players[0].position).toBe(5);
  expect(state.turn).toBe(1);
});

test("ladders and snakes reach their actual endpoints", async ({ page }) => {
  await setPosition(page, 5);
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#player-position-0")).toHaveText("35");
  await expect(page.locator("#board-message")).toContainText("9 → 35");
  await setPosition(page, 18);
  await face(page, 1);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#player-position-0")).toHaveText("05");
  await expect(page.locator("#activity")).toContainText("Slid 19 → 5");
});

test("overshooting stays put, and an exact roll wins with a restart", async ({ page }) => {
  await setPosition(page, 98);
  await face(page, 6);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#player-position-0")).toHaveText("98");
  await expect(page.locator("#board-message")).toContainText("needs 2 to finish");
  await expect(page.locator("#turn-name")).toHaveText("Player 2’s turn");
  await setPosition(page, 98);
  await face(page, 2);
  await page.locator("#roll").click();
  await expect(page.locator("#win-dialog")).toBeVisible();
  await expect(page.locator("#winner-name")).toHaveText("Player 1");
  expect((await savedGame(page)).winner).toBe(0);
  await page.locator("#play-again").click();
  await expect(page.locator("#win-dialog")).not.toBeVisible();
  await expect(page.locator("#player-position-0")).toHaveText("01");
  await expect(page.locator("#move-count")).toHaveText("0 moves");
});

test("board picker exposes all 20 layouts and applies only confirmed choices", async ({ page }) => {
  await page.locator("#change-board").click();
  await expect(page.locator(".board-choice")).toHaveCount(20);
  await previewBoard(page, 19);
  await expect(page.locator("#selected-board-label")).toHaveText("Hidden Grove");
  await expect(page.locator("#board-name")).toHaveText("The Greenhouse");
  await page.locator("#play-board").click();
  await expect(page.locator("#board-name")).toHaveText("Hidden Grove");
  expect((await savedGame(page)).boardIndex).toBe(19);
  await page.locator("#change-board").click();
  await previewBoard(page, 2);
  await page.locator('#boards-dialog [data-close-dialog]').click();
  await expect(page.locator("#board-name")).toHaveText("Hidden Grove");
});

test("choosing the current board and canceling setup preserve progress", async ({ page }) => {
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await page.locator("#change-board").click();
  await page.locator("#play-board").click();
  await expect(page.locator("#player-position-0")).toHaveText("05");
  await page.locator("#newgame").click();
  await page.locator("#player-one-name").fill("Someone else");
  await page.locator('#setup-dialog button:has-text("Not yet")').click();
  await expect(page.locator("#player-name-0")).toHaveText("Player 1");
  expect((await savedGame(page)).totalRolls).toBe(1);
});

test("Fern automatically takes one fair turn, then returns control", async ({ page }) => {
  await page.locator("#newgame").click();
  await page.locator('input[name="mode"][value="computer"]').check();
  await page.locator("#player-one-name").fill("Maya");
  await expect(page.locator("#player-two-name")).toBeDisabled();
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator("#player-name-1")).toHaveText("Fern");
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("2 moves");
  await expect(page.locator("#turn-name")).toHaveText("Maya’s turn");
  await expect(page.locator("#roll")).toBeEnabled();
  const state = await savedGame(page);
  expect(state.players.map(player => player.rolls)).toEqual([1, 1]);
  expect(state.players.map(player => player.position)).toEqual([5, 5]);
});

test("refresh restores turns and 3D view while keeping the actual JPG picture", async ({ page }) => {
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#view-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#view-toggle").click();
  await expect(page.locator("#view-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#view-toggle").click();
  await expect(page.locator("#fantasy-art")).toHaveAttribute("src", "snakes-and-ladders-board-01.jpg");
  await page.locator("#fantasy-art").evaluate(image => image.decode());
  await page.reload();
  await enterGame(page);
  await expect(page.locator("#player-position-0")).toHaveText("05");
  await expect(page.locator("#turn-name")).toHaveText("Player 2’s turn");
  await expect(page.locator("#board-message")).toContainText("Welcome back");
  await expect(page.locator("#fantasy-art")).toBeVisible();
  await expect(page.locator("#view-toggle")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).preferences.art, SAVE_KEY)).toBe("original");
  await noScroll(page);
});

test("the board opens in 3D and supports drag, wheel, and keyboard camera controls", async ({ page }) => {
  await expect(page.locator("#board")).toHaveClass(/is-3d/);
  if (page.viewportSize().width > 740) await expect(page.locator("#board-camera-hint")).toBeVisible();
  else await expect(page.locator("#board-camera-hint")).toBeHidden();
  const board = page.locator("#board");
  const before = await board.evaluate(element => ({
    tiltX: element.style.getPropertyValue("--board-tilt-x"),
    tiltY: element.style.getPropertyValue("--board-tilt-y"),
    zoom: element.style.getPropertyValue("--board-zoom"),
  }));
  const stage = page.locator("#board-stage");
  await stage.focus();
  await page.keyboard.press("ArrowRight");
  const afterKey = await board.evaluate(element => element.style.getPropertyValue("--board-tilt-y"));
  expect(afterKey).not.toBe(before.tiltY);
  const bounds = await stage.boundingBox();
  await page.mouse.move(bounds.x + 6, bounds.y + 6);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 56, bounds.y + 30, { steps: 3 });
  await page.mouse.up();
  const afterDrag = await board.evaluate(element => element.style.getPropertyValue("--board-tilt-x"));
  expect(afterDrag).not.toBe(before.tiltX);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -180);
  const afterWheel = await board.evaluate(element => element.style.getPropertyValue("--board-zoom"));
  expect(afterWheel).not.toBe(before.zoom);
  await stage.focus();
  await page.keyboard.press("Home");
  const resetTilt = page.viewportSize().width <= 740 ? "38deg" : "50deg";
  await expect(board).toHaveCSS("--board-tilt-x", resetTilt);
  await noScroll(page);
});

test("keyboard rolling, path inspection, and accessible instructions work", async ({ page }) => {
  await face(page, 4);
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Space");
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await page.locator('.path-group[data-kind="ladder"][data-from="9"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#board-message")).toContainText("9 → 35");
  await page.locator("#how-to-play").click();
  await expect(page.getByRole("dialog", { name: "A little luck. Four simple rules." })).toBeVisible();
  await expect(page.locator("#rules-dialog")).toContainText("no extra turn");
  await page.keyboard.press("Escape");
  await expect(page.locator("#rules-dialog")).not.toBeVisible();
});

test("corrupt saves are recovered and names cannot inject HTML", async ({ page }) => {
  await page.evaluate(key => localStorage.setItem(key, "broken JSON"), SAVE_KEY);
  await page.reload();
  await enterGame(page);
  await expect(page.locator("#roll")).toBeEnabled();
  expect((await savedGame(page)).totalRolls).toBe(0);
  await page.locator("#newgame").click();
  await page.locator("#player-one-name").fill("<img src=x onerror=x()>");
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator("#player-name-0")).toHaveText("<img src=x onerror=x()>");
  await expect(page.locator("#player-name-0 img")).toHaveCount(0);
});

test("no runtime errors, broken assets, or overflow at narrow widths", async ({ page }) => {
  const errors = [];
  const failures = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failures.push(response.url()); });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await enterGame(page);
  await page.locator("#change-board").click();
  await expect(page.locator(".board-choice")).toHaveCount(20);
  await page.locator('#boards-dialog [data-close-dialog]').click();
  await expect.poll(() => page.locator("#fantasy-art").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test("reduced-motion users can complete a turn without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  expect(await page.locator("#die").evaluate(die => getComputedStyle(die).animationName)).toBe("none");
});

test("the original HTML entry point remains playable", async ({ page }) => {
  await page.goto("/snakes-and-ladders-2-5d-20-boards.html?fast=500");
  await enterGame(page);
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#player-position-0")).toHaveText("05");
});

test("rapid repeated clicks cannot start overlapping turns", async ({ page }) => {
  await page.goto("/?fast=4");
  await enterGame(page);
  await face(page, 4);
  // Check the lock in the same task as the burst, not after a network round trip.
  const lockedDuringBurst = await page.evaluate(() => {
    const roll = document.getElementById("roll");
    let locked = true;
    for (let i = 0; i < 8; i++) {
      roll.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      locked &&= roll.disabled;
    }
    return locked;
  });
  expect(lockedDuringBurst).toBe(true);
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#roll")).toBeEnabled();
  expect((await savedGame(page)).players.map(player => player.rolls)).toEqual([1, 0]);
});

test("reloading during an animation restores only the last completed turn", async ({ page }) => {
  await page.goto("/");
  await enterGame(page);
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#roll")).toBeDisabled();
  expect((await savedGame(page)).totalRolls).toBe(0);
  await page.reload();
  await enterGame(page);
  await expect(page.locator("#roll")).toBeEnabled();
  await expect(page.locator("#player-position-0")).toHaveText("01");
  await expect(page.locator("#turn-name")).toHaveText("Player 1’s turn");
});

test("reading instructions pauses a pending computer turn", async ({ page }) => {
  await page.goto("/?fast=2");
  await enterGame(page);
  await page.locator("#newgame").click();
  await page.locator('input[name="mode"][value="computer"]').check();
  await page.locator('#setup-form button[type="submit"]').click();
  await face(page, 4);
  // Open at the exact completed-turn boundary. This avoids a timing race on
  // busy test machines without changing the computer's real think time.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (document.getElementById("move-count").textContent === "1 move") {
        document.getElementById("how-to-play").click();
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById("move-count"), { childList: true, subtree: true });
  });
  await page.locator("#roll").click();
  await expect(page.locator("#rules-dialog")).toBeVisible();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await page.waitForTimeout(650);
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await page.locator('#rules-dialog [data-close-dialog]').first().click();
  await expect(page.locator("#move-count")).toHaveText("2 moves");
  await expect(page.locator("#roll")).toBeEnabled();
});

test("the game remains playable when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  });
  await page.reload();
  await enterGame(page);
  await expect(page.locator("#save-status")).toContainText("Saving unavailable");
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#player-position-0")).toHaveText("05");
});

test("small-screen board, players, and roll controls fit together without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await enterGame(page);
  await fullyInView(page, "#board");
  await fullyInView(page, "#roll");
  await fullyInView(page, "#newgame");
  await fullyInView(page, "#players");
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#turn-name")).toHaveText("Player 2’s turn");
  await noScroll(page);
  await page.locator("#change-board").click();
  await fullyInView(page, "#boards-dialog");
  await page.locator('#boards-dialog [data-close-dialog]').click();
  await fullyInView(page, "#roll");
  await noScroll(page);
});

test("the downloaded game also works directly from a local HTML file", async ({ page }) => {
  const { pathToFileURL } = require("node:url");
  const path = require("node:path");
  const url = pathToFileURL(path.join(__dirname, "..", "..", "index.html"));
  url.search = "fast=500";
  await page.goto(url.href);
  await enterGame(page);
  await expect(page.locator("#roll")).toBeEnabled();
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await expect(page.locator("#player-position-0")).toHaveText("05");
  await expect.poll(() => page.locator("#fantasy-art").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
});

test("original art is the default, including migration of a saved Garden game", async ({ page }) => {
  await expect(page.locator("#fantasy-art")).toHaveAttribute("src", "snakes-and-ladders-board-01.jpg");
  await page.locator("#fantasy-art").evaluate(image => image.decode());
  await expect(page.locator(".tile-layer, .path-art, .board-numbers")).toHaveCount(0);
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
  await page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.preferences.art = "garden";
    localStorage.setItem(key, JSON.stringify(saved));
  }, SAVE_KEY);
  await page.reload();
  await enterGame(page);
  await expect(page.locator("#fantasy-art")).toHaveAttribute("src", "snakes-and-ladders-board-01.jpg");
  await expect(page.locator("#player-position-0")).toHaveText("05");
  expect((await savedGame(page)).totalRolls).toBe(1);
});

test("paginated original-picture previews expose every board without a scroll list", async ({ page }) => {
  await page.locator("#change-board").click();
  await expect(page.locator(".board-choice:visible")).toHaveCount(4);
  await expect(page.locator("#previous-boards")).toBeDisabled();
  for (let i = 0; i < 5; i++) {
    await expect(page.locator("#board-page-label")).toHaveText(`Boards ${i * 4 + 1}–${i * 4 + 4} of 20`);
    const boards = await page.locator(".board-choice:visible").evaluateAll(buttons => buttons.map(button => Number(button.dataset.board)));
    expect(boards).toEqual([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3]);
    await expect(page.locator(".board-choice:visible img")).toHaveCount(4);
    expect(await page.locator("#boards-dialog").evaluate(dialog => dialog.scrollHeight <= dialog.clientHeight + 1)).toBe(true);
    await noScroll(page);
    if (i < 4) await page.locator("#next-boards").click();
  }
  await expect(page.locator("#next-boards")).toBeDisabled();
  await previewBoard(page, 19);
  await page.locator("#play-board").click();
  await expect(page.locator("#fantasy-art")).toHaveAttribute("src", "snakes-and-ladders-board-20.jpg");
  await page.locator("#fantasy-art").evaluate(image => image.decode());
});

test("head, tail, and ladder tracking agrees with the original HTML on every board", async ({ page }) => {
  test.setTimeout(60000); // Decode all twenty full-resolution supplied pictures.
  for (let board = 0; board < 20; board++) {
    await page.locator("#change-board").click();
    await previewBoard(page, board);
    await page.locator("#play-board").click();
    await expect(page.locator("#roll")).toBeEnabled();
    await expect(page.locator("#board")).toHaveAttribute("data-art-state", "ready");
    expect(await page.locator("#fantasy-art").evaluate(image => image.complete && image.naturalWidth === 2424 && image.naturalHeight === 2424)).toBe(true);
    await expect(page.locator(".path-group")).toHaveCount(19);
    const actual = await page.evaluate(index => {
      const layout = SnakeLadder.BOARDS[index];
      return [...document.querySelectorAll(".path-group")].every(group => {
        const from = Number(group.dataset.from), to = Number(group.dataset.to);
        const mapping = group.dataset.kind === "snake" ? layout.s : layout.l;
        if (mapping[from] !== to) return false;
        const circles = [...group.querySelectorAll(".path-hit")];
        return circles.every((circle, i) => {
          const p = SnakeLadder.coordinates(i === 0 ? from : to);
          return Number(circle.getAttribute("cx")) === p.x && Number(circle.getAttribute("cy")) === p.y;
        });
      });
    }, board);
    expect(actual).toBe(true);
    await expect(page.locator("#fantasy-art")).toHaveAttribute("src", `snakes-and-ladders-board-${String(board + 1).padStart(2, "0")}.jpg`);
  }
});

test("the tracking overlay accounts for the actual picture border", async ({ page }) => {
  await page.locator("#fantasy-art").evaluate(image => image.decode());
  const delta = await page.evaluate(() => {
    const image = document.getElementById("fantasy-art");
    const layer = getComputedStyle(document.getElementById("tracking-layer"));
    const expectedInset = image.offsetWidth * 12 / 2424;
    return {
      x: Math.abs(parseFloat(layer.left) - expectedInset),
      y: Math.abs(parseFloat(layer.top) - expectedInset),
      size: Math.abs(parseFloat(layer.width) - image.offsetWidth * 2400 / 2424),
    };
  });
  expect(delta.x).toBeLessThan(.05);
  expect(delta.y).toBeLessThan(.05);
  expect(delta.size).toBeLessThan(.05);
  await page.locator("#show-snakes").click();
  await expect(page.locator("#show-snakes")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#board-message")).toContainText("snake’s head");
});


test("slow original-picture loading blocks mouse and keyboard turns until it is ready", async ({ page }) => {
  let releasePicture;
  const pictureGate = new Promise(resolve => { releasePicture = resolve; });
  await page.route("**/snakes-and-ladders-board-02.jpg", async route => {
    await pictureGate;
    await route.continue();
  });
  try {
    await page.locator("#change-board").click();
    await previewBoard(page, 1);
    await page.locator("#play-board").click();
    await expect(page.locator("#board")).toHaveAttribute("data-art-state", "loading");
    await expect(page.locator("#art-loading")).toBeVisible();
    await expect(page.locator("#roll")).toBeDisabled();
    await expect(page.locator("#show-snakes")).toBeDisabled();
    await expect(page.locator("#tracking-layer")).toHaveAttribute("inert", "");
    await face(page, 4);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("Space");
    await page.locator("#roll").dispatchEvent("click");
    await page.waitForTimeout(200);
    expect((await savedGame(page)).totalRolls).toBe(0);
    await expect(page.locator("#player-position-0")).toHaveText("01");
    await noScroll(page);
    releasePicture();
    await expect(page.locator("#roll")).toBeEnabled();
    await expect(page.locator("#art-loading")).toBeHidden();
    await expect(page.locator("#tracking-layer")).not.toHaveAttribute("inert", "");
    expect(await page.locator("#fantasy-art").evaluate(image => image.naturalWidth)).toBe(2424);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("Space");
    await expect(page.locator("#move-count")).toHaveText("1 move");
  } finally { releasePicture(); }
});

test("a restored pending computer turn waits for its actual picture", async ({ page }) => {
  await page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.game = SnakeLadder.applyRoll(SnakeLadder.createGame({ mode: "computer" }), 4).state;
    localStorage.setItem(key, JSON.stringify(saved));
  }, SAVE_KEY);
  let releasePicture;
  const pictureGate = new Promise(resolve => { releasePicture = resolve; });
  await page.route("**/snakes-and-ladders-board-01.jpg", async route => {
    await pictureGate;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await enterGame(page, { ready: false });
    await face(page, 4);
    await expect(page.locator("#art-loading")).toBeVisible();
    await expect(page.locator("#move-count")).toHaveText("1 move");
    await page.waitForTimeout(250);
    await expect(page.locator("#move-count")).toHaveText("1 move");
    releasePicture();
    await expect(page.locator("#art-loading")).toBeHidden();
    await expect(page.locator("#move-count")).toHaveText("2 moves");
    await expect(page.locator("#roll")).toBeEnabled();
    expect((await savedGame(page)).players.map(player => player.rolls)).toEqual([1, 1]);
  } finally { releasePicture(); }
});

test("an early picture failure is reported, blocks turns, and can be retried", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  let missing = true;
  await page.route("**/snakes-and-ladders-board-01.jpg*", route => missing ? route.abort() : route.continue());
  await page.reload();
  await enterGame(page, { ready: false });
  await expect(page.locator("#art-error")).toBeVisible();
  await expect(page.locator("#board")).toHaveAttribute("data-art-state", "error");
  await expect(page.locator("#roll")).toBeDisabled();
  await fullyInView(page, "#retry-art");
  const retryContrast = await page.locator("#retry-art").evaluate(button => {
    const style = getComputedStyle(button);
    const luminance = rgb => {
      const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const text = luminance(style.color), background = luminance(style.backgroundColor);
    return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
  });
  expect(retryContrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.locator("#art-error").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const button = element.querySelector("button").getBoundingClientRect();
    return element.scrollHeight <= element.clientHeight + 1 && button.bottom <= bounds.bottom;
  })).toBe(true);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Space");
  await page.locator("#roll").dispatchEvent("click");
  await page.waitForTimeout(200);
  expect((await savedGame(page)).totalRolls).toBe(0);
  await noScroll(page);
  missing = false;
  await page.locator("#retry-art").click();
  await expect(page.locator("#roll")).toBeEnabled();
  await expect(page.locator("#art-error")).toBeHidden();
  await expect(page.locator("#fantasy-art")).toHaveAttribute("src", /^snakes-and-ladders-board-01\.jpg\?retry=\d+$/);
  const retrySource = await page.locator("#fantasy-art").getAttribute("src");
  await page.locator("#view-toggle").click();
  await expect(page.locator("#fantasy-art")).toHaveAttribute("src", retrySource);
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("1 move");
});

test("a previous picture's delayed decode cannot unlock a newly chosen board", async ({ page }) => {
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      const decoded = decode.call(this);
      if (this.id === "fantasy-art" && this.getAttribute("src") === "snakes-and-ladders-board-02.jpg") {
        return decoded.then(() => new Promise(resolve => { window.releasePreviousPictureDecode = resolve; }));
      }
      return decoded;
    };
  });
  let releasePicture;
  const pictureGate = new Promise(resolve => { releasePicture = resolve; });
  await page.route("**/snakes-and-ladders-board-03.jpg", async route => {
    await pictureGate;
    await route.continue();
  });
  try {
    await page.locator("#change-board").click();
    await previewBoard(page, 1);
    await page.locator("#play-board").click();
    await page.waitForFunction(() => typeof window.releasePreviousPictureDecode === "function");
    await page.locator("#change-board").click();
    await previewBoard(page, 2);
    await page.locator("#play-board").click();
    await page.evaluate(() => window.releasePreviousPictureDecode());
    await expect(page.locator("#board")).toHaveAttribute("data-art-state", "loading");
    await expect(page.locator("#roll")).toBeDisabled();
    await expect(page.locator("#art-error")).toBeHidden();
    expect((await savedGame(page)).boardIndex).toBe(2);
    releasePicture();
    await expect(page.locator("#roll")).toBeEnabled();
    await expect(page.locator("#fantasy-art")).toHaveAttribute("src", "snakes-and-ladders-board-03.jpg");
    await expect(page.locator("#board")).toHaveAttribute("data-art-state", "ready");
  } finally { releasePicture(); }
});

test("the start menu offers Play, Settings, and Exit, and Play lists the three modes", async ({ page }) => {
  await page.reload();
  await expect(page.locator("#start-menu")).toBeVisible();
  await expect(page.locator("#start-menu")).toHaveAttribute("role", "dialog");
  await expect(page.locator("#start-menu")).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#menu-play")).toBeVisible();
  await expect(page.locator("#menu-settings")).toBeVisible();
  await expect(page.locator("#menu-exit")).toBeVisible();
  await expect(page.locator("#menu-play")).toBeFocused();
  await expect(page.locator("#menu-online")).toBeHidden();
  await page.locator("#menu-play").click();
  await expect(page.locator("#menu-online")).toBeVisible();
  await expect(page.locator("#menu-fern")).toBeVisible();
  await expect(page.locator("#menu-friend")).toBeVisible();
  // Nothing behind the menu is reachable, so no turn can start by accident.
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Space");
  await page.locator("#roll").dispatchEvent("click");
  await page.waitForTimeout(200);
  expect((await savedGame(page)).totalRolls).toBe(0);
  await expect(page.locator("#move-count")).toHaveText("0 moves");
});

test("Play starts Fern or friend games straight from the menu", async ({ page }) => {
  await page.reload();
  await page.locator("#menu-play").click();
  await page.locator("#menu-fern").click();
  await expect(page.locator("#start-menu")).toBeHidden();
  await expect(page.locator("#player-name-1")).toHaveText("Fern");
  await expect(page.locator("#mode-label")).toHaveText("Playing with Fern");
  await face(page, 4);
  await page.locator("#roll").click();
  await expect(page.locator("#move-count")).toHaveText("2 moves");
  // The header button opens the menu again instead of starting a new game silently.
  await page.locator("#mode-button").click();
  await expect(page.locator("#start-menu")).toBeVisible();
  await expect(page.locator("#menu-friend")).toBeVisible();
  await page.locator("#menu-friend").click();
  await expect(page.locator("#mode-label")).toHaveText("Playing with a friend");
  await expect(page.locator("#move-count")).toHaveText("0 moves");
});

test("settings control sound, pace, 3D view, the board, and player names", async ({ page }) => {
  await page.reload();
  await page.locator("#menu-settings").click();
  await expect(page.locator("#setting-sound")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#setting-sound").click();
  await expect(page.locator("#setting-sound")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#setting-sound-value")).toHaveText("On");
  await page.locator("#setting-pace").click();
  await expect(page.locator("#setting-pace-value")).toHaveText("Quick & breezy");
  await expect(page.locator("#setting-view")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#setting-view").click();
  await expect(page.locator("#setting-view")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#setting-view-value")).toHaveText("Flat board");
  await page.locator("#setting-view").click();
  await expect(page.locator("#setting-view")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#setting-view-value")).toHaveText("Tilted 3D board");
  // The board chooser opens on top of the menu and returns to it when canceled.
  await page.locator("#setting-board").click();
  await expect(page.locator("#boards-dialog")).toBeVisible();
  await previewBoard(page, 4);
  await page.locator("#boards-dialog [data-close-dialog]").click();
  await expect(page.locator("#setting-board-value")).toHaveText("The Greenhouse");
  // Renaming players from settings starts that game and closes the menu.
  await page.locator("#setting-names").click();
  await page.locator("#player-one-name").fill("Maya");
  await page.locator("#player-two-name").fill("Sam");
  await page.locator('#setup-form button[type="submit"]').click();
  await expect(page.locator("#start-menu")).toBeHidden();
  await expect(page.locator("#player-name-0")).toHaveText("Maya");
  await expect(page.locator("#player-name-1")).toHaveText("Sam");
  await expect(page.locator("#view-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("#start-menu")).toBeVisible();
  await page.locator("#menu-settings").click();
  await expect(page.locator("#setting-sound")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#setting-pace")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#setting-names-value")).toHaveText("Maya and Sam");
});

test("Exit shows a farewell and returns to the menu", async ({ page }) => {
  await page.reload();
  await page.locator("#menu-exit").click();
  await expect(page.locator('[data-view="exit"]')).toBeVisible();
  await expect(page.locator("#exit-back")).toBeVisible();
  await noScroll(page);
  await page.locator("#exit-back").click();
  await expect(page.locator('[data-view="main"]')).toBeVisible();
  await expect(page.locator("#menu-play")).toBeFocused();
  await expect(page.locator("#start-menu")).toBeVisible();
});

for (const size of [
  { width: 1440, height: 900 }, { width: 1024, height: 600 },
  { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 },
]) {
  test(`the menu and its views fit ${size.width}x${size.height} without scrolling`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.reload();
    await menuFits(page);
    await page.locator("#menu-play").click();
    await menuFits(page);
    await page.locator("#menu-online").click();
    await menuFits(page);
    await page.locator('[data-view="online"] [data-menu-back]').click();
    await page.locator("#menu-settings").click();
    await menuFits(page);
    await page.locator('[data-view="settings"] [data-menu-back]').click();
    await page.locator("#menu-exit").click();
    await menuFits(page);
  });
}

test("two devices can play together in an online room", async ({ browser }) => {
  test.setTimeout(90000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await host.goto("/?fast=500");
    await host.locator("#menu-play").click();
    await host.locator("#menu-online").click();
    await host.locator("#online-create").click();
    await expect(host.locator("#room-code")).toHaveText(/^[A-Z0-9]{5}$/);
    const code = (await host.locator("#room-code").textContent()).trim();
    await expect(host.locator("#online-enter")).toBeHidden();
    await expect(host.locator("#room-status")).toContainText("Waiting for another player");

    await guest.goto(`/?fast=500&room=${code}`);
    await expect(guest.locator('[data-view="online"]')).toBeVisible();
    await expect(guest.locator("#online-code")).toHaveValue(code);
    await guest.locator("#online-code").fill(code.toLowerCase());
    await guest.locator("#online-join").click();
    await expect(guest.locator("#online-enter")).toBeVisible();
    // The host learns about the second player through the room's long poll.
    await expect(host.locator("#online-enter")).toBeVisible();
    await expect(host.locator("#room-status")).toContainText("Both players are here");

    await host.locator("#online-enter").click();
    await guest.locator("#online-enter").click();
    await expect(host.locator("#mode-label")).toHaveText(`Room ${code}`);
    await expect(host.locator("#roll")).toBeEnabled();
    await expect(guest.locator("#roll")).toBeDisabled();
    await expect(guest.locator("#roll-label")).toContainText("turn");

    await host.locator("#roll").click();
    await expect(host.locator("#move-count")).toHaveText("1 move");
    await expect(guest.locator("#move-count")).toHaveText("1 move");
    await expect(guest.locator("#activity")).toContainText("Moved 1 →");
    await expect(guest.locator("#roll")).toBeEnabled();
    await expect(host.locator("#roll")).toBeDisabled();

    await guest.locator("#roll").click();
    await expect(guest.locator("#move-count")).toHaveText("2 moves");
    await expect(host.locator("#move-count")).toHaveText("2 moves");
    await expect(host.locator("#roll")).toBeEnabled();
    expect((await savedGame(host)).players.map(player => player.position)).toEqual((await savedGame(guest)).players.map(player => player.position));

    // Leaving frees the seat and returns the leaver to the menu.
    await host.locator("#mode-button").click();
    await expect(host.locator('[data-view="room"]')).toBeVisible();
    await host.locator("#online-leave").click();
    await expect(host.locator('[data-view="play"]')).toBeVisible();
    await expect(host.locator("#menu-online")).toBeVisible();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});


for (const size of [
  { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 600 },
  { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 360, height: 640 },
  { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 667, height: 375 },
]) {
  test(`game and dialogs fit ${size.width}x${size.height} without scrolling`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.reload();
    await enterGame(page);
    await page.locator("#fantasy-art").evaluate(image => image.decode());
    await fullyInView(page, "#board");
    await fullyInView(page, "#roll");
    await fullyInView(page, "#newgame");
    await fullyInView(page, "#players");
    await fullyInView(page, "#change-board");
    await noScroll(page);
    for (const [opener, dialog, lastControl] of [
      ["#how-to-play", "#rules-dialog", "#rules-dialog .primary-button"],
      ["#change-board", "#boards-dialog", "#play-board"],
      ["#newgame", "#setup-dialog", "#setup-form button[type='submit']"],
    ]) {
      await page.locator(opener).click();
      await fullyInView(page, dialog);
      await fullyInView(page, lastControl);
      expect(await page.locator(dialog).evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await noScroll(page);
      await page.locator(`${dialog} [data-close-dialog]`).first().click();
    }
  });
}
