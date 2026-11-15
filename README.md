# Cube Coach

Cube Coach teaches a complete beginner to solve a 3×3 Rubik's cube, then gives less and less help
until you can solve any cube on your own in under 3 minutes. Plan on about 20 minutes a day.

- **With your cube:** show each face to the camera. Cube Coach reads the colours, then coaches you
  through the solve one step at a time.
- **Without a cube:** narrated 3D demos of every stage, quick drills, the **Middle Layer Gym**
  (short exercises for the stage most people get stuck on), and an on-screen cube you can solve
  with live coaching.

The method is the beginner's layer-by-layer method in 8 stages, holding the cube with yellow on top
the whole time: Daisy → White Cross → White Corners → Middle Layer → Yellow Cross → Yellow Edges →
Yellow Corners (position) → Yellow Corners (twist).

## Use it on your iPhone

1. Open **<https://pmcgroark.github.io/cube-coach/>** in Chrome (or Safari).
   From a laptop, the quickest way is **Settings › On your phone**: point the iPhone camera at the
   QR code there, or use **Copy link** / **Share…**.
2. Add it to your Home Screen, so it opens full screen like an app, with its own icon:
   - **Chrome:** tap **Share** (the square with an arrow, at the right of the address bar, or in the
     **•••** menu) → **Add to Home Screen** → **Add**.
   - **Safari:** tap **Share** (at the bottom, or in the **•••** menu) → **Add to Home Screen** →
     leave "Open as Web App" on → **Add**.
3. Open Cube Coach from the new icon and practise there.

**It works offline.** After the first visit Cube Coach keeps a copy of itself on the phone, so it
opens with no internet (on a plane, on the bus). **Settings › On your phone** says **Offline ready ✓**
when the copy is complete. When a new version comes out you see **"A new version is ready —
Reload"**: tap Reload when it suits you. Your progress is kept.

The camera uses the back of the phone: point it at the cube. **Switch camera** on the scan screen
swaps to the front camera. The screen stays on during a solve, a scan and the Gym.

## Your progress

Progress is saved **on each device, in each app, separately**. The Home Screen app, a Safari or
Chrome tab and your laptop each keep their own. So pick one place to practise (the Home Screen app
on the phone is best) and move progress with a **progress code** when you switch:

1. On the device that has your progress: **Settings › Move my progress** → **Copy progress code**
   (or **Share…**). Send it to yourself in Messages, WhatsApp, Notes or email. It is one long line
   starting with `CUBE1.` (about 40,000 characters after 300 solves).
2. On the other device, same place: paste it into the box (or tap **Paste**) and tap **Check code**.
   You see what is in the code and what is on this device.
3. Tap **Merge** (keeps everything from both: solves are combined, skills and scores keep the best
   of the two) or **Replace** (only the code's progress). Either can be undone straight away.

Line breaks, spaces or curly quotes added by a messaging app don't matter. Camera, theme and
keyboard settings stay as they are on each device. A backup file (**Settings › Your data**) works too.

## On a laptop

The same link works in a laptop browser (Chrome recommended), camera included. Or run it from this
folder: double-click **Start Cube Coach.command** (the first time, macOS may refuse: right-click it,
choose **Open**, then **Open** again). Your browser opens <http://localhost:8765>; keep the Terminal
window open while you use it. The link and localhost keep separate progress.

## Privacy

Camera pictures are processed on the device and never uploaded or saved. Progress is stored only in
that browser on that device; a progress code goes only where you send it. No accounts, no tracking,
and nothing is fetched from the internet apart from the app's own files.

## Browser support

Recent Chrome, Safari, Edge or Firefox on a laptop; Chrome or Safari on an up-to-date iPhone. The
camera asks for permission the first time: tap **Allow**. If the screen still dims during a solve,
update iOS or set a longer Auto-Lock (Settings › Display & Brightness).

---

## For developers

Plain HTML, CSS and JavaScript: no build step, nothing to install, all paths relative (the same
folder works at `http://localhost:8765/` and at `https://…/cube-coach/`). ARCHITECTURE.md has the
module contracts and file list; docs/MOBILE-AND-GYM.md is the iPhone + Middle Layer Gym spec.

```sh
python3 serve.py              # http://localhost:8765, no caching (or double-click the .command file)
node tests/run-all.js         # every test file, with a summary (exits 1 if any fail)
node tests/run-all.js gym     # only test files whose name contains "gym"
```

The offline copy (service worker) is off on `localhost` so you always see your latest edits
(and an old copy is removed). Add `?sw=1` to test it locally, `?sw=0` to remove it anywhere.

### Publishing an update

GitHub Pages serves the `main` branch, root folder (`.nojekyll` keeps the files as they are), at
<https://pmcgroark.github.io/cube-coach/>. Before you push:

```sh
node tests/platform.test.js --stamp   # lists every app file in sw.js and sets a new VERSION
node tests/run-all.js                 # everything green
node tools/make-icons.js              # only if the brand mark or the link changed
```

The stamp matters: installed phones only fetch new files when `sw.js` changes. The platform test
fails when a new file under `js/`, `css/`, `vendor/` or `icons/` is not listed yet, and reminds you
when files have changed since the last stamp. Then commit and push to `main`; phones get the
"new version" message the next time they open the app.
