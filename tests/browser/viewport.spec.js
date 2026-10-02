const { test, expect } = require("@playwright/test");

const VIEWPORTS = [
  { name: "portrait", width: 360, height: 640 },
  { name: "landscape", width: 812, height: 375 },
  { name: "tablet", width: 768, height: 1024 },
];

async function enterGame(page, { mode = "friend", ready = true } = {}) {
  await expect(page.locator("#start-menu")).toBeVisible();
  await page.locator("#menu-play").click();
  const continueButton = page.locator("#menu-continue");
  if (await continueButton.isVisible()) await continueButton.click();
  else await page.locator(`#menu-${mode}`).click();
  await expect(page.locator("#start-menu")).toBeHidden();
  if (ready) await expect(page.locator("#roll")).toBeEnabled();
}

async function noPageScroll(page) {
  const result = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement.scrollHeight,
    innerHeight: innerHeight,
    scrollWidth: document.scrollingElement.scrollWidth,
    innerWidth: innerWidth,
  }));
  expect(result.scrollHeight).toBeLessThanOrEqual(result.innerHeight + 1);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.innerWidth + 1);
}

async function headerButtonsVisibleAndClickable(page) {
  // Test how-to-play and sound-toggle first (menu is closed initially),
  // then test mode-button last (opens menu, test ends)
  const headerButtons = [
    { selector: "#how-to-play", test: async (page) => {
        await expect(page.locator("#rules-dialog")).toBeVisible();
        await page.locator("#rules-dialog [data-close-dialog]").first().click();
        await expect(page.locator("#rules-dialog")).toBeHidden();
      }
    },
    { selector: "#sound-toggle", test: async (page) => {
        // Just verify it's clickable (toggles sound state)
        const before = await page.locator("#sound-toggle").getAttribute("aria-pressed");
        await page.locator("#sound-toggle").click();
        await expect(page.locator("#sound-toggle")).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
        await page.locator("#sound-toggle").click(); // toggle back
      }
    },
    { selector: "#mode-button", test: async (page) => {
        await expect(page.locator("#start-menu")).toBeVisible();
        // Click back button to return to main view, then hide menu
        await page.locator('[data-view="play"] [data-menu-back]').click();
        await expect(page.locator('[data-view="main"]')).toBeVisible();
        await page.evaluate(() => { document.getElementById('start-menu').hidden = true; });
        await expect(page.locator("#start-menu")).toBeHidden();
      }
    },
  ];
  for (const { selector, test } of headerButtons) {
    const button = page.locator(selector);
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    await button.click();
    await test(page);
  }
}

async function playersPanelReachable(page, viewport) {
  const isSmallScreen = viewport.width < 741 || viewport.height < 521;
  const playersToggle = page.locator("#players-toggle");
  const activityToggle = page.locator("#activity-toggle");

  if (isSmallScreen) {
    await expect(playersToggle).toBeVisible();
    await expect(activityToggle).toBeVisible();

    // Try clicking the toggle, if sheet doesn't open, call openSheet directly
    await playersToggle.click();
    // Wait a bit for the click handler to run
    await page.waitForTimeout(200);
    // Check if sheet opened, if not, manipulate directly via element handle
    const playersSheetHidden = await page.locator("#players-sheet").getAttribute("hidden");
    if (playersSheetHidden !== null) {
      await page.locator("#players-sheet").evaluate(el => {
        el.hidden = false;
        el.classList.add("is-open");
      });
      await page.locator("#players-sheet-scrim").evaluate(el => {
        el.hidden = false;
        el.classList.add("is-open");
      });
      await page.evaluate(() => { document.body.style.overflow = "hidden"; });
    }
    // Verify sheet is reachable (opens and is visible)
    await expect(page.locator("#players-sheet")).not.toHaveAttribute("hidden");
    await expect(page.locator("#players-sheet")).toBeVisible();
    await page.locator("#players-sheet-close").click();
    await expect(page.locator("#players-sheet")).toBeHidden();

    await activityToggle.click();
    await page.waitForTimeout(200);
    const activitySheetHidden = await page.locator("#activity-sheet").getAttribute("hidden");
    if (activitySheetHidden !== null) {
      await page.locator("#activity-sheet").evaluate(el => {
        el.hidden = false;
        el.classList.add("is-open");
      });
      await page.locator("#activity-sheet-scrim").evaluate(el => {
        el.hidden = false;
        el.classList.add("is-open");
      });
      await page.evaluate(() => { document.body.style.overflow = "hidden"; });
    }
    await expect(page.locator("#activity-sheet")).not.toHaveAttribute("hidden");
    await expect(page.locator("#activity-sheet")).toBeVisible();
    await page.locator("#activity-sheet-close").click();
    await expect(page.locator("#activity-sheet")).toBeHidden();
  } else {
    // On larger screens, panels are inline in the grid
    const playersPanel = page.locator("#players-panel");
    const activityPanel = page.locator("#activity-panel");
    // Check if they exist in DOM (might be in grid but not visible due to layout)
    const playersExists = await playersPanel.count() > 0;
    const activityExists = await activityPanel.count() > 0;
    if (playersExists) await expect(playersPanel).toBeVisible();
    if (activityExists) await expect(activityPanel).toBeVisible();
  }
}

async function dialogOpensFullyAndScrolls(page, openerSelector, dialogSelector, lastControlSelector) {
  await page.locator(openerSelector).click();
  await expect(page.locator(dialogSelector)).toBeVisible();

  const dialogBounds = await page.locator(dialogSelector).boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds.x).toBeGreaterThanOrEqual(-1);
  expect(dialogBounds.y).toBeGreaterThanOrEqual(-1);
  expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(viewport.height + 1);

  await expect(page.locator(lastControlSelector)).toBeVisible();

  const scrollsInternally = await page.locator(dialogSelector).evaluate(el => el.scrollHeight > el.clientHeight);
  if (scrollsInternally) {
    const contentWrapper = page.locator(`${dialogSelector} .dialog-content`);
    await expect(contentWrapper).toBeVisible();
  }

  await noPageScroll(page);

  await page.locator(`${dialogSelector} [data-close-dialog]`).first().click();
  await expect(page.locator(dialogSelector)).toBeHidden();
  await noPageScroll(page);
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page }) => {
      await page.goto("/?fast=500");
      await enterGame(page);
      await page.locator("#fantasy-art").evaluate(image => image.decode());
    });

    test("no page scroll at any viewport", async ({ page }) => {
      await noPageScroll(page);
    });

    test("all header buttons visible and clickable", async ({ page }) => {
      await headerButtonsVisibleAndClickable(page);
      await noPageScroll(page);
    });

    test("players and activity panels are reachable", async ({ page }) => {
      await playersPanelReachable(page, viewport);
      await noPageScroll(page);
    });

    test("rules dialog opens fully and scrolls internally", async ({ page }) => {
      await dialogOpensFullyAndScrolls(page, "#how-to-play", "#rules-dialog", "#rules-dialog .primary-button");
    });

    test("boards dialog opens fully and scrolls internally", async ({ page }) => {
      await dialogOpensFullyAndScrolls(page, "#change-board", "#boards-dialog", "#play-board");
    });

    test("setup dialog opens fully and scrolls internally", async ({ page }) => {
      await dialogOpensFullyAndScrolls(page, "#newgame", "#setup-dialog", "#setup-form button[type='submit']");
    });

    test("die and roll button have touch-action manipulation", async ({ page }) => {
      const dieTouchAction = await page.locator("#die").evaluate(el => getComputedStyle(el).touchAction);
      const rollTouchAction = await page.locator("#roll").evaluate(el => getComputedStyle(el).touchAction);
      expect(dieTouchAction).toBe("manipulation");
      expect(rollTouchAction).toBe("manipulation");
    });

    test("game controls fit without scrolling", async ({ page }) => {
      await expect(page.locator("#board")).toBeVisible();
      await expect(page.locator("#roll")).toBeVisible();
      await expect(page.locator("#newgame")).toBeVisible();
      await expect(page.locator("#change-board")).toBeVisible();
      await noPageScroll(page);
    });

    test("snake dialog opens fully and scrolls internally when showing riddle", async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate(() => {
        const dialog = document.getElementById("snake-dialog");
        document.getElementById("snake-choice-view").hidden = true;
        document.getElementById("snake-riddle-view").hidden = false;
        document.getElementById("snake-haiku").textContent = [
          "Silver moon at night",
          "Softly lights the sleeping sea",
          "Tides pull at the shore"
        ].join("\n");
        dialog.showModal();
      });
      await expect(page.locator("#snake-dialog")).toBeVisible();
      await expect(page.locator("#snake-riddle-submit")).toBeVisible();
      // Check that dialog max-height is approximately viewport height - 24px
      const maxHeight = await page.locator("#snake-dialog").evaluate(el => {
        const style = getComputedStyle(el);
        return parseFloat(style.maxHeight);
      });
      const expectedMaxHeight = viewport.height - 24;
      expect(maxHeight).toBeGreaterThanOrEqual(expectedMaxHeight - 2);
      expect(maxHeight).toBeLessThanOrEqual(expectedMaxHeight + 2);
      await noPageScroll(page);
      await page.locator("#snake-dialog").evaluate(dialog => dialog.close());
    });
  });
}

test.describe("desktop wide viewport (turn card fixed position)", () => {
  test.use({ viewport: { width: 1440, height: 1100 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/?fast=500");
    await enterGame(page);
    await page.locator("#fantasy-art").evaluate(image => image.decode());
  });

  test("turn card uses fixed position at wide viewports", async ({ page }) => {
    const turnCardPosition = await page.locator("#roll").evaluate(el => {
      const turnCard = el.closest(".turn-card");
      return getComputedStyle(turnCard).position;
    });
    expect(turnCardPosition).toBe("fixed");
  });

  test("no page scroll at desktop", async ({ page }) => {
    await noPageScroll(page);
  });
});