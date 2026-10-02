# Snakes & Ladders

A single-screen Snakes & Ladders game using **the actual 20 supplied JPG pictures** and the snake-head, tail, and ladder mappings from the original HTML. The original exact-roll rules are preserved.

## Play

The start menu opens first. Choose **Play** for an online room, a game with **Fern** (the computer player), or a local game with a friend. **Settings** includes sound, animation pace, 3D view, board selection, and player names. **Exit** shows a farewell screen; close the tab whenever you like, or return to the menu.

Open **`index.html`** in a modern browser for local and computer play, or run the local server:

```sh
npm start
```

Then visit **http://localhost:5173**. Node 18+ is needed for the server, but the game itself has no runtime dependencies or build step. The original `snakes-and-ladders-2-5d-20-boards.html` entry point works too. Keep all 20 `snakes-and-ladders-board-XX.jpg` files, the JavaScript, CSS, and `assets` folder alongside the HTML files when copying the game.

All fonts, illustrations, and artwork are local. Local and Fern games need no internet connection unless a player chooses the Gemini haiku challenge. Browser storage policies for `file://` vary; use the local server for reliable saved progress and Gemini riddles.

## Online rooms

Online play needs the Node server to be running and reachable by both players. Choose **Play → Online → Create a room**, then share the five-character code or use **Copy invite link**. The invite link opens the online screen with the code filled in; your friend can press **Join**. Both devices must use the same server address—`localhost` only works on the device running the server. A static-only host can serve classic local and Fern games, but online rooms and Gemini riddles require the included server (`/api/rooms` and `/api/riddles`).

The server owns the dice rolls and enforces turns. Room state is kept in server memory (not a database), expires after 45 minutes without activity, and is lost if the server restarts. The browser saves local games and settings on that device; it also remembers the room code and seat so a player can try to rejoin. There are no accounts. If someone chooses a haiku challenge, the server sends the riddle prompt to Google Gemini; the API key is never sent to the browser.

### Gemini haiku riddles

To enable the optional human-player challenge, set `GEMINI_API_KEY` in the server environment before running `npm start`. The key stays on the server. `GEMINI_MODEL` can optionally select another supported Gemini model. On a snake, a human may take the classic slide or request a three-line haiku riddle; a correct answer keeps them on the snake’s head, while an incorrect answer or skipping sends them to the tail. Fern always takes the classic slide. If Gemini is not configured or is unavailable, the classic slide remains available.

## What’s included

- A modal-like, viewport-fitted game window. The full board, both players, and Roll/New game controls stay on one screen in desktop, phone portrait, and phone landscape layouts. No page scrolling or board cropping.
- Two players on one device or a game against Fern. Online play synchronizes two devices through a room code.
- Twenty previewable original boards. The board picker shows four pictures per page with Previous/Next buttons instead of a scrolling list, plus a random-board choice.
- The actual original JPG is the main board. Only small picker previews use optimized copies. No replacement Garden tiles, snakes, or ladders are drawn over the artwork.
- Clear picture-loading and retry states. Mouse, keyboard, and computer turns wait until the current JPG has loaded and decoded, so pieces cannot move on a missing or mismatched picture.
- A dark, glass-panel HUD around the board, with player cards, recent moves, a live turn indicator, and a floating dice-and-roll control.
- A tilted 3D board view by default. Drag to rotate, scroll or pinch to zoom, use arrow keys to adjust the camera, and press Home to reset. Switch to the flat view at any time. The original picture and its tracking layer move together.
- Animated dice and numbered pieces, two animation speeds, opt-in sound, endpoint highlighting, and a winner celebration. Click a snake head or ladder to inspect its original mapped destination.
- Autosaved completed turns, players, board, and preferences for local play. Reloading during a roll returns to the last completed turn.
- Keyboard controls, accessible dialogs, live turn feedback, and reduced-motion support.

## Rules & controls

Both players start on **square 1**. Take turns rolling. A ladder’s foot sends you up; a snake’s head offers a choice: slide to its tail or solve a Gemini haiku to stay on the head. Wrong answers and skips slide down, while Fern always uses the classic slide. Only **landing** on a path triggers it. Reach **100 with an exact roll** to win. Overshooting means staying put, and rolling six does **not** give an extra turn.

- Click **Roll the dice** or press **Space** (outside a form or dialog).
- **Start a new game** changes player names, game mode, and animation speed. Canceling keeps the current game.
- **Change board** lets you preview four original pictures at a time. Use Previous/Next to reach all 20 without scrolling. Switching boards starts a fresh game; selecting the current board keeps your progress.
- Click a snake head, tail, ladder, or legend to inspect its tracked endpoints; keyboard users can focus a route and press Enter or Space. Highlights mark existing endpoints rather than redrawing the picture.
- Sound starts off. Use the speaker button to enable it.

## Development & tests

```sh
npm test                 # Engine tests plus mocked Gemini and online-room server tests
npm ci
npx playwright install chromium
npm run test:browser -- --workers=1
npm run test:all
```

Browser tests require Node 20 or newer. If Chromium is installed separately, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path. On Linux, Playwright may also require `npx playwright install-deps chromium`.

### Original-picture alignment

The supplied pictures are 2424 × 2424 with a 12-pixel outer frame and a 2400 × 2400 playing grid. `ARTWORK_GRID` maps that printed grid to the original HTML’s 600 × 600 serpentine coordinate system. Pawns and endpoint hit targets use the same inset layer, so resizing cannot separate the pieces from the pictures. All 20 snake/ladder layouts remain unchanged, and old saved progress is migrated to the original-art view.

### Files

- `game-engine.js`: original layouts, validation, immutable game rules, and safe save restoration; usable in the browser or Node.
- `app.js`: original-picture loading, SVG endpoint tracking, viewport fitting, UI, animation, computer turns, online client, optional sound, and local storage.
- `styles.css`: responsive layout and reduced-motion styling.
- `index.html`: main entry point. The legacy HTML file is an identical compatibility entry point; a test checks they stay in sync.
- `scripts/server.js`: small static server plus the dependency-free, in-memory online room API; bound to `0.0.0.0` for hosted previews.
- `tests/`: Node unit tests and Playwright browser tests.

Computer play is automatic turn-taking, not strategic AI: this is a game of chance. DM Sans is bundled under the SIL Open Font License; see `assets/fonts/OFL.txt`.
