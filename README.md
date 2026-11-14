# Cube Coach

Cube Coach teaches a complete beginner to solve a 3×3 Rubik's cube, then gives less and less help
until you can solve any cube on your own in under 3 minutes. Plan on about 20 minutes a day.

You can use it in two ways:

- **With your cube.** Show each face to the camera. Cube Coach reads the colours, then coaches you
  through the solve one step at a time.
- **Without a cube.** Watch narrated 3D demos of every stage, do quick drills (notation, spotting
  cases, algorithms, "what's next?", the Middle Layer Gym), or solve the on-screen cube with live
  coaching. This is handy when your cube isn't with you.

The method is the beginner's layer-by-layer method in 8 stages, holding the cube with yellow on top
the whole time: Daisy → White Cross → White Corners → Middle Layer → Yellow Cross → Yellow Edges →
Yellow Corners (position) → Yellow Corners (twist).

It runs on a Mac (from this folder) and on an iPhone (from the web link below). Both are the same app.

## On your iPhone

Open **<https://pmcgroark.github.io/cube-coach/>** in Chrome or Safari.

- Quickest way to get the link onto the phone: on the Mac, open **Settings › On your phone** and point
  the iPhone camera at the QR code. Or use **Copy link** / **Share…** there.

### Add it to your Home Screen

Then it opens full screen, like an app, with its own icon.

- **Chrome on iPhone:** tap the **Share** button (square with an arrow) at the right of the address
  bar (or in the ••• menu) → **Add to Home Screen** → **Add**.
- **Safari on iPhone:** tap **Share** (at the bottom, or in the ••• menu on newer iPhones) →
  **Add to Home Screen** → leave "Open as Web App" on → **Add**.

### Offline

After the first visit, Cube Coach keeps a copy of itself on the phone, so it opens and works with no
internet (on a plane, on the bus). **Settings › On your phone** says **Offline ready ✓** once the copy
is complete. When a new version has been published, the app shows **"A new version is ready —
Reload"**; tap Reload when it suits you (your progress is kept).

The screen stays on during a solve, a scan and gym drills.

### Your progress on the phone

The Home Screen app keeps **its own** progress, separate from the browser tab and from the Mac
(they are different apps as far as the phone is concerned). So: add it to the Home Screen first and
practise there. To bring progress over, see below.

## Moving progress between the Mac and the phone

**Settings › Move my progress**:

1. On the device that has your progress, tap **Copy progress code** (or **Share…**). Send the code to
   yourself in Messages, WhatsApp, Notes or email. It is one long line starting with `CUBE1.`;
   about 40,000 characters after 300 solves.
2. On the other device, open the same screen, paste the code into the box (or tap **Paste**) and tap
   **Check code**. You see what is in the code and what is on this device.
3. Choose **Merge** (keeps everything from both: solves are combined, and skills, drill scores,
   practice minutes and flashcards keep the best of the two) or **Replace** (only the code's
   progress). Either can be undone straight away from the message that appears.

Line breaks, spaces or curly quotes added by a messaging app don't matter. Camera, theme and keyboard
settings stay as they are on each device. The JSON backup file (**Settings › Your data**) still works
too, and on an iPhone it goes to the Files app.

## On a Mac

1. Double-click **Start Cube Coach.command**.
   - The first time, macOS may refuse to open it. Right-click it, choose **Open**, then **Open** again.
     After that, a double-click works.
2. A Terminal window opens and your browser goes to <http://localhost:8765>. Chrome is recommended.
3. Keep the Terminal window open while you use Cube Coach. Close it (or press Ctrl+C) to stop.

If Cube Coach is already running, double-clicking again just opens it in the browser.

The local server tells the browser not to cache anything, so after an update a normal reload
shows the new version. (The offline copy is switched off on `localhost` for the same reason.)

### Why localhost?

Browsers only let a page use the camera when it comes from a secure origin: `https://…` (the iPhone
link) or `http://localhost`. A file you open by double-clicking (`file://…`) does not count. The
`.command` file runs a tiny web server on your Mac (`python3 serve.py`, port 8765), reachable only
from this computer.

## Privacy

Camera frames are processed on the device, in the browser. They are never uploaded or saved. Your
progress (times, practice minutes, skill levels) is stored in that browser's local storage on that
device only. A progress code goes only where you send it. No accounts, no tracking, and nothing is
fetched from the internet apart from the app's own files (three.js is included in `vendor/`).

## Browser support

Recent Chrome, Safari, Edge and Firefox on a Mac or PC; Chrome or Safari on iPhone (iOS 16.4 or
later for the Home Screen app and keeping the screen awake). The camera needs permission the first
time: tap **Allow** when the browser asks.

## For developers

### Files

```
index.html                 the page: loads three.js, then the scripts below in order
manifest.webmanifest       installable-app details (name, icons, colours)
sw.js                      service worker: the offline copy (precache list + version)
.nojekyll                  tells GitHub Pages to serve the files as they are
css/app.css                design system (light/dark themes, cube colours, components, phone layout)
vendor/three.min.js        three.js r128 (MIT licence), the 3D library
icons/                     app icons + the QR code of the link (made by tools/make-icons.js)
js/cube.js                 cube model: states, moves, notation, validation (CC.Cube)
js/solver.js               beginner-method solver, split into stages and steps (CC.Solver)
js/scanner.js              camera capture and colour reading (CC.Scanner)
js/render3d.js             3D cube, flat net, move pad, keyboard moves (CC.View3D, CC.Net2D, CC.MovePad, CC.Keys)
js/lessons.js              lesson text, algorithms, demos, 12-week plan (CC.Lessons)
js/storage.js              saving progress, progress codes, merging (CC.Store)
js/coach.js                guidance levels, mastery, stats, today's plan (CC.Coach)
js/gym.js, js/topview.js   Middle Layer Gym exercises and the top-layer diagram (CC.Gym, CC.TopView)
js/app.js                  app shell: routing, modal, toasts, UI helpers, offline copy, keep-awake (CC.App, CC.UI)
js/screens/*.js            one file per screen: home, scan, solve, learn (+ lesson, watch), drills, stats, settings, gym
tests/*.test.js            unit tests (plain node + assert)
tests/run-all.js           runs every test file
tools/make-icons.js        draws the icons and the QR code (no dependencies)
Start Cube Coach.command   double-click launcher (macOS)
ARCHITECTURE.md            module contracts and conventions
docs/MOBILE-AND-GYM.md     the iPhone version + Middle Layer Gym spec
```

There is no build step and nothing to install: plain HTML, CSS and JavaScript. All paths are
relative, so the same folder works at `http://localhost:8765/` and at `https://…/cube-coach/`.

### Running the tests

You need Node.js (any recent version). From this folder:

```sh
node tests/run-all.js          # every test file, with a summary
node tests/run-all.js solver   # only test files whose name contains "solver"
node tests/cube.test.js        # one file
```

`run-all.js` exits with a non-zero code if any test file fails.

### The offline copy (service worker) while developing

- On `localhost` / `127.0.0.1` the app never installs the offline copy (and removes one if it finds
  it), so you always see your latest edits.
- To test it locally, add `?sw=1`: `http://localhost:8765/?sw=1`. To remove it anywhere, add `?sw=0`.
- In Chrome DevTools, *Application › Service workers* shows it; *Network › Offline* simulates no
  internet.

### Publishing an update (GitHub Pages)

The site is this folder served by GitHub Pages (repository settings › Pages › deploy from the main
branch, root folder). Before you push:

```sh
node tools/make-icons.js            # only if the brand mark or the link changed
node tests/platform.test.js --stamp # lists every app file in sw.js and sets a new VERSION
node tests/run-all.js               # everything green
```

The `--stamp` step matters: installed copies (phones) only fetch new files when `sw.js` changes. If
you add a new file under `js/`, `css/`, `vendor/` or `icons/`, the platform test fails until you
stamp, and its last line reminds you when the files changed since the last stamp.
