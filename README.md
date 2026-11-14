# Cube Coach

Cube Coach teaches a complete beginner to solve a 3×3 Rubik's cube, then gives less and less help
until you can solve any cube on your own in under 3 minutes. Plan on about 20 minutes a day.

You can use it in two ways:

- **With your cube.** Hold each face up to the laptop camera. Cube Coach reads the colours, then
  coaches you through the solve one step at a time.
- **Without a cube.** Watch narrated 3D demos of every stage, do quick drills (notation, spotting
  cases, algorithms, "what's next?"), or solve the on-screen cube with live coaching. This is handy
  when your cube isn't with you.

The method is the beginner's layer-by-layer method in 8 stages, holding the cube with yellow on top
the whole time: Daisy → White Cross → White Corners → Middle Layer → Yellow Cross → Yellow Edges →
Yellow Corners (position) → Yellow Corners (twist).

## Starting it

1. Double-click **Start Cube Coach.command**.
   - The first time, macOS may refuse to open it. Right-click it, choose **Open**, then **Open** again.
     After that, a double-click works.
2. A Terminal window opens and your browser goes to <http://localhost:8765>. Chrome is recommended.
3. Keep the Terminal window open while you use Cube Coach. Close it (or press Ctrl+C) to stop.

If Cube Coach is already running, double-clicking again just opens it in the browser.

The local server tells the browser not to cache anything, so after an update a normal reload
shows the new version.

### Why localhost?

Browsers only let a page use the camera when it comes from a secure origin. `http://localhost`
counts as secure, but a file you open by double-clicking (`file://…`) does not. The `.command` file
runs a tiny web server on your Mac (`python3 serve.py`, port 8765), reachable only from this
computer.

## Privacy

Camera frames are processed locally, in your browser, on your computer. They are never uploaded or
saved. Your progress (times, practice minutes, skill levels) is stored in the browser's local
storage on this computer only. You can export a backup from Settings.

The only thing fetched from the internet is the 3D library (three.js, from cdnjs). Without an
internet connection the app still works and shows a flat cube instead of the 3D one.

## Browser support

Recent versions of Chrome, Edge, Safari and Firefox. Chrome or Edge give the best camera and 3D
performance. The camera needs permission the first time: click **Allow** when the browser asks.

## Files

```
index.html                 the page: loads three.js, then the scripts below in order
css/app.css                design system (light and dark themes, cube colours, components)
js/cube.js                 cube model: states, moves, notation, validation (CC.Cube)
js/solver.js               beginner-method solver, split into stages and steps (CC.Solver)
js/scanner.js              camera capture and colour reading (CC.Scanner)
js/render3d.js             3D cube, flat net, move pad, keyboard moves (CC.View3D, CC.Net2D, CC.MovePad, CC.Keys)
js/lessons.js              lesson text, algorithms, demos, 12-week plan (CC.Lessons)
js/storage.js              saving progress in the browser (CC.Store)
js/coach.js                guidance levels, mastery, stats, today's plan (CC.Coach)
js/drills.js               drill generator and checker (CC.Drills)
js/app.js                  app shell: routing, modal, toasts, UI helpers (CC.App, CC.UI)
js/screens/*.js            one file per screen: home, scan, solve, learn (+ lesson, watch), drills, stats, settings
tests/*.test.js            unit tests (plain node + assert)
tests/run-all.js           runs every test file
Start Cube Coach.command   double-click launcher (macOS)
ARCHITECTURE.md            module contracts and conventions for developers
```

There is no build step and nothing to install: plain HTML, CSS and JavaScript.

## Running the tests

You need Node.js (any recent version). From this folder:

```sh
node tests/run-all.js          # every test file, with a summary
node tests/run-all.js solver   # only test files whose name contains "solver"
node tests/cube.test.js        # one file
```

`run-all.js` exits with a non-zero code if any test file fails.
