# Cube Coach — architecture & module contracts

A single-page HTML app that teaches a complete beginner to solve a 3×3 Rubik's cube, then weans
them off help until they can solve any cube unaided in under 3 minutes. It works in two ways:

* **With a real cube** — hold the cube up to the laptop camera (or point a phone's rear camera at
  it), the app scans all six faces and coaches the solve step by step, giving less and less help as
  the learner improves.
* **Without a cube** — an on-screen 3D cube the learner can turn (mouse or finger drag, keyboard,
  move buttons): narrated "watch & learn" demos, a virtual solve with *live* coaching (the app always
  knows the virtual cube's state), drills (notation, case recognition, algorithm recall, repetition
  counts, predict-the-next-step) and the **Middle Layer Gym** (17 short exercises for stage 4).

The learner is a total beginner, practising ~20 min/day. Goal: any cube in < 3:00.
The same files run on a laptop (`http://localhost:8765`) and on an iPhone, installed from
**<https://pmcgroark.github.io/cube-coach/>** with Add to Home Screen and working offline.
docs/MOBILE-AND-GYM.md is the spec for the iPhone version and the Gym (with its own "As built" notes).

This file describes contracts. Where it and the code disagree, **the code is the truth**: each
module's header comment and exports are kept up to date; check them with grep before relying on a name.

## Engineering rules

* Plain files: `index.html` + classic `<script>` files. NO ES modules, NO build step, NO npm deps.
  Every module is an IIFE that attaches to `window.CC` and also does `module.exports = …` when
  `module` exists so it can be unit-tested with plain `node`. Copy this pattern:
  ```js
  (function (root) { 'use strict'; /* … */ root.CC = root.CC || {}; root.CC.Thing = Thing;
    if (typeof module !== 'undefined' && module.exports) module.exports = Thing;
  })(typeof window !== 'undefined' ? window : globalThis);
  ```
  Modules look each other up lazily via `root.CC.X` at call time (never at load time).
* The only third-party code is three.js r128 (global `THREE`), **vendored** as `vendor/three.min.js`
  (MIT licence header kept) and loaded from there, so the offline copy can cache it. Nothing is
  fetched from a CDN at runtime; no web fonts (system font stack). If three.js fails to load, the
  app adds `html.no-3d` and every View3D falls back to a flat net.
* **Relative paths only** (`js/app.js`, never `/js/app.js`): the hosted site lives under `/cube-coach/`.
* Served locally from `http://localhost:8765` by `serve.py` (a tiny Python server that sends
  no-cache headers, so edits always show on reload). `Start Cube Coach.command` runs
  `python3 serve.py 8765` in the folder and opens the browser. The camera needs a secure context:
  `http://localhost` or `https://`.
* Tests: `node tests/<name>.test.js` using plain `assert`; `node tests/run-all.js [filter]` runs them
  all (9 files: cube, solver, scanner, render3d, lessons, coach (+ store), gym, topview, platform).
  Pure logic must be testable in node (no DOM at load time; DOM only inside functions that need it).
  Every claim about what moves do (lessons, the gym) is re-derived by simulation with `CC.Cube`.
* Script load order in index.html: `vendor/three.min.js`, then cube.js, solver.js, scanner.js,
  render3d.js, lessons.js, storage.js, coach.js, gym.js, topview.js, app.js, then the screens:
  home, scan, solve, learn, drills, stats, settings, gym. (There is no js/drills.js: see `CC.Drills`.)
* Write for a beginner: plain English, short sentences, colour names not face letters where it
  helps ("turn the cube so the RED centre faces you"). Notation is always shown *with* a plain
  English description (`CC.Cube.moveInfo(token).text`).
* Use British spelling consistently ("colour", "centre", "practise" as the verb).
* Phone first: 390×844 CSS px is the main target (also 375×667, 430×932, landscape). Tap targets
  ≥ 44 px on touch screens, inputs ≥ 16 px font, no horizontal scroll, nothing under the notch or the
  tab bar (`env(safe-area-inset-*)`). No personal names in files.

## Files

```
index.html               the page (brand mark, top bar / phone tab bar, script tags in load order)
css/app.css              design tokens (light + dark), components, phone layout
js/*.js                  the modules below;  js/screens/*.js  one file per screen
vendor/three.min.js      three.js r128
manifest.webmanifest     installable app: name, start_url ".", scope ".", display standalone, icons
sw.js                    service worker: the offline copy (VERSION + PRECACHE written by --stamp)
icons/                   app icons (192/512, maskable 192/512, apple-touch-icon 180) + qr-cube-coach.svg
tools/make-icons.js      draws icons/ from the brand mark (no deps; --check exits 1 if they are stale)
tests/*.test.js          node tests;  tests/run-all.js  runs them
serve.py                 local no-cache server (port 8765);  Start Cube Coach.command  macOS launcher
.nojekyll                GitHub Pages serves the files as they are
dev/                     developer pages (render-demo.html, scan-sim.html); not precached
docs/MOBILE-AND-GYM.md   iPhone version + Middle Layer Gym spec, with "As built" notes
```

## Conventions (from js/cube.js — read it, it is the foundation, it is tested, don't modify it
without a very good reason)

* State = array of 54 colour letters `W Y G B R O`, Kociemba facelet order U R F D L B, row-major
  as seen looking at each face (U viewed from above with BACK at the top of the grid; D viewed
  from below with FRONT at the top; R F L B viewed head-on with U at the top).
  Index = faceIndex*9 + row*3 + col.
* The state is always *as the user is holding it*: x / y / z rotations move the centres too, so
  `U` always means "whatever face is on top right now".
* Standard scheme: white opposite yellow, green opposite blue, red opposite orange; white top +
  green front ⇒ red on the right.
* Moves: `U D R L F B`, `M E S`, wide `u d r l f b` (also `Rw`), rotations `x y z`, suffixes `'` and `2`.
* Key API: `CC.Cube.solved()`, `applyMove`, `applyAlg(state, "R U R' U'")`, `parseAlg`, `invertAlg`,
  `invertMove`, `simplifyAlg`, `isSolved`, `isRotation`, `baseOf`, `amountOf`,
  `validate(state) -> {ok, errors:[{type,message,stickers}]}`,
  `findEdge(state,a,b)`, `findCorner(state,a,b,c)`, `center(state,face)`, `centers`,
  `rotationTo(state, upColour, frontColour|null) -> tokens`, `yRotationTo(state, frontColour)`,
  `stickerAfter(index, alg)`, `algPerm(alg)`, `scramble(len, seed)`, `mulberry32(seed)`,
  `moveInfo(token) -> {token, base, amount, rotation, face, label, how, text}`,
  tables `STICKERS[i] = {face,row,col,cubie,normal,point}`, `EDGES`, `CORNERS` (with `.name`,
  `.stickers`, `.faces`), `FACES`, `NORMAL`, `COLOR_HEX`, `COLOR_NAME`, `FACE_NAME`, `PERM[token]`.

## The method we teach (beginner layer-by-layer, "daisy" variant)

The whole solve is done holding **YELLOW ON TOP** (white ends up on the bottom), so the learner
never flips the cube mid-solve. Stage ids are fixed and used everywhere:

| # | id         | name                      | goal (cumulative)                                                      | tool / algorithm |
|---|------------|---------------------------|------------------------------------------------------------------------|------------------|
| 1 | `daisy`    | The Daisy                 | 4 white edges around the yellow centre, white stickers facing up       | intuitive        |
| 2 | `cross`    | White Cross               | 4 white edges on the bottom, each side colour matching its centre      | match + F2       |
| 3 | `corners`  | White Corners             | whole white (bottom) layer solved                                      | `R U R' U'` repeated ("right trigger") |
| 4 | `middle`   | Middle Layer              | first two layers solved                                                | right: `U R U' R' U' F' U F`, left: `U' L' U L U F U' F'` |
| 5 | `ycross`   | Yellow Cross              | + yellow cross on top (top edges oriented)                             | `F R U R' U' F'` |
| 6 | `yedges`   | Yellow Edges              | + top edges match their side centres                                   | `R U R' U R U2 R' U` (Sune + U) |
| 7 | `ycorners` | Yellow Corners: Position  | + every top corner in its correct spot (any twist)                     | `U R U' L' U R' U' L` |
| 8 | `yorient`  | Yellow Corners: Twist     | cube solved                                                            | `R' D' R D` repeated, only `U` between corners |

If the cross is already solved, `daisy` is skipped (it is a means to the cross, not a goal).

The "learning frame" used by demos, drills, drill scrambles and the Gym is **yellow on top, green
in front**, i.e. `CC.Cube.applyAlg(CC.Cube.solved(), 'z2')` — in that frame ORANGE is on the right
and RED on the left. Scanning, by contrast, always happens in the standard frame (white top, green front).

The middle layer is taught as **two halves of four moves** and **left as the mirror of right**
(swap R↔L, turn every move the other way), so there is one thing to remember. Right:
`U R U' R'` ("away, up, back, down": the white corner comes out and parks on top beside the edge)
then `U' F' U F` ("aside, open, back, close": the pair goes into the slot). The second half is the
first with F in place of R and every move turned the other way. All of this is asserted by
tests/gym.test.js and tests/lessons.test.js.

Milestone ids (shared by Lessons, which names/describes them, and Coach, which awards them):
`first-solve` (any completed solve) · `first-virtual` (completed virtual solve) · `first-coach`
(completed solve with no stage at Show level) · `first-solo` (completed real-cube solve, every
stage at Solo level, zero hints) · `sub-10` · `sub-5` · `sub-3` · `sub-2` · `sub-90` (unaided
real-cube solves under 10:00 / 5:00 / 3:00 / 2:00 / 1:30) · `streak-7` · `streak-30` ·
`all-mastered` (every stage mastery ≥ 78) · `solves-100`.

Algorithm ids (shared by Solver, Lessons, Coach, Drills, Store):
`rtrigger` = `R U R' U'` · `mid-right` = `U R U' R' U' F' U F` · `mid-left` = `U' L' U L U F U' F'` ·
`ycross` = `F R U R' U' F'` · `sune` = `R U R' U R U2 R'` (used as `R U R' U R U2 R' U`) ·
`corner-cycle` = `U R U' L' U R' U' L` · `twist` = `R' D' R D`.

## Module contracts

### `CC.Solver` — js/solver.js
```
CC.Solver.STAGES : [{ id, name, short, goal, algorithm: algId|null }]  // the table above, in order
CC.Solver.check[id](state) -> bool   // stage goal met? orientation-independent (any way the cube is held)
CC.Solver.progress(state) -> { index, id, done:[ids] }   // first unfinished stage; {index:8, id:'solved'} when solved
CC.Solver.solve(state, opts?) -> Solution          // must be fast: < 30 ms typical (it is re-run after every virtual move)
CC.Solver.nextStep(state) -> Step|null             // = first step of solve(state); convenience for live hints
CC.Solver.drillScramble(stageId, seed?) -> { scramble:[face moves only], holding:'Yellow on top, green in front', state }
     // applied to a SOLVED cube held yellow-up / green-front, leaves every stage before stageId solved and stageId unsolved
Solution = { start, end, moves:[tokens incl. rotations], moveCount (face turns only), stages:[Stage] }
Stage    = { id, name, goal, skipped:bool, startState, endState, steps:[Step] }
Step     = {
  id: 'cross-2', stage: 'cross',
  kind: 'rotate'|'intuitive'|'algorithm'|'repeat'|'align',
  title: 'Bring the white–red petal down',             // short imperative
  explain: 'The red sticker is now right above the red centre, so a half turn of the front drops it into place.',
  moves: ['y', 'U', 'F2'],                              // exact tokens; may include x/y/z rotations
  segments: [{ label:'Turn the cube so red faces you', moves:['y'] }, …],   // partition of moves, in order
  alg: { id:'rtrigger', name:'Right trigger', notation:"R U R' U'", reps:3 } | null,
  case: { id:'corner-white-front', name:'White sticker facing you' } | null,
  focus: [sticker indices in startState],              // the piece(s) being worked on (for highlighting)
  startState, endState,
  quiz: { prompt, options:[strings], answer:index, explain } | null   // recognition question at a decision point
}
```
Invariants (tested on thousands of random cubes): applying every step's `moves` in order to `start`
gives `end`, which `isSolved`; each stage's `check` holds at its `endState` and every earlier
check still holds; `segments` concatenate to `moves`; no step has empty `moves`.

### `CC.Scanner` — js/scanner.js
```
CC.Scanner.SCAN_ORDER = [{ face, center, up, say, tip, point, tipRear }, …]
    // F/green, R/red, B/blue, L/orange (WHITE on top), U/white (BLUE on top), D/yellow (GREEN on top)
    // say/tip: the learner FACES the camera (laptop, phone front camera): the next face is on their LEFT
    // point/tipRear: the learner points a phone's REAR camera at the cube: the next face is on their RIGHT
CC.Scanner.sayFor(entry, facing) -> entry.point when facing === 'environment', else entry.say
CC.Scanner.isSupported() -> { ok, code, reason }   // secure context + navigator.mediaDevices.getUserMedia
CC.Scanner.deviceInfo(env?) -> { phone, tablet, ios, android, touch }   // env injectable for tests
CC.Scanner.isPhone(env?) -> bool      CC.Scanner.defaultFacing(env?) -> 'environment' on a phone, else 'user'
CC.Scanner.cameraConstraints({ deviceId?, facing? }) -> [getUserMedia constraints, best first]
    // remembered deviceId -> facingMode {ideal} + 1280×720 -> facingMode alone -> any camera (iOS is picky)
CC.Scanner.retryCamera(err) -> bool   // worth trying plainer constraints? never after a permission refusal
CC.Scanner.guessFacing(trackSettings, label, requested) -> 'user'|'environment'   // settings, else label words, else requested
CC.Scanner.createController({ canvas, mirror:true, autoCapture:true, facing:'user'|'environment', hud:true,
                              statusText:true, maxWidth, startTimeout,
                              onFrame(info), onCapture(stepIndex, colours9), onComplete(result), onError(err), onState(state) })
   .start(deviceId?, { facing? }) -> Promise     .stop()     .captureNow()   .redo(stepIndex)   .reset()
   .useStream(mediaStream, { facing? })           // e.g. the fake camera (the caller owns and stops the stream)
   .switchCamera() -> Promise                     // front <-> rear; resolves once the other camera shows
   .setFacing(f)  .getFacing()  .getMirror()  .getDeviceId()  .getState()
   .setMirror(bool)  .setAutoCapture(bool)  .setHud(bool)   // hud = the "2/6 RED centre" label on the canvas
   .pause() -> bool   .resume() -> Promise         // release / reopen the camera; resume() must come from a tap
   .listCameras() -> Promise<[{deviceId,label}]>  .getInfo()  .getResult()  .session
   state  = 'idle' | 'starting' | 'live' | 'paused' (page in the background: own camera released and
            reopened on return, or the camera was interrupted) | 'blocked' (the browser wants a tap
            before the video may play, or the camera could not reopen by itself: call resume() from a tap)
   info   = { step, expected:SCAN_ORDER[step], live:[9 letters], confidence:[9], centerMatches:bool, stability:0..1,
              captured:[bool×6], message, … }
   result = { state:[54], confidence:[54], uncertain:[indices], validation, warnings, repaired, suspectSteps }
   err    = { code:'denied'|'notfound'|'insecure'|'unsupported'|'busy'|'other', message (friendly, says how to fix), name }
CC.Scanner.classifyCube({U:[9 rgb],R:…,F:…,D:…,L:…,B:…}) -> result   // pure; constrained clustering, exactly 9 of each colour
CC.Scanner.rgbToLab(r,g,b) -> [L,a,b]
CC.Scanner.createFakeCamera(state, { scene:'selfie'|'rear', width, height, … }?)
    -> { stream, canvas, showFace(stepIndex), current(), hideCube(bool), set(opts), setState(state), destroy() }
```
The camera sees each face exactly as it is defined in the facelet order, so raw-frame cell
(row, col) = sticker (face, row, col). That holds for a phone's rear camera too (the frame is still
the face head-on, upright): only the learner's position changes, hence `point`/`tipRear`. Only the
on-screen preview is mirrored, and only for a front camera (`mirror` is ignored for a rear one);
sampling always uses the raw frame. The controller asks for `facingMode: {ideal}` (never exact),
stops its own camera while the page is hidden and reopens it on return.

### `CC.View3D`, `CC.Net2D`, `CC.MovePad`, `CC.Keys` — js/render3d.js
```
CC.View3D.supported() -> bool                                  // WebGL available
const v = CC.View3D.create(container, { interactive:true, turnable:false, size:'fill', state?, speed?, zoom?, label?, fallback? })
v.setState(state)   v.getState()   v.finalState()   v.isBusy()   v.setSpeed(s)
v.play(tokens|string, { speed:1, onMove(i, token) }) -> Promise<endState>   // animated layer turns + rotations, queued
v.cancel()                                                      // jump to the end state of anything queued
v.showArrow(token|null)                                         // curved arrow on the layer that will turn next
v.highlight(indices|null)                                       // emphasise these stickers; follows the pieces through moves
v.setTurnable(bool)                                             // user may turn layers by dragging on stickers
v.onUserMove = (token) => {}                                    // fired after a user drag-turn (or v.userMove(token)) completes
v.userMove(token)                                               // animate a move as if the user made it (fires onUserMove)
v.resetCamera()   v.resize()   v.dispose()   v.el   v.fallback (true for the flat-net fallback)
CC.View3D.DEFAULT_VIEW = { az: 34°, el: 27° }                   // front-top-right: U, F and R visible
CC.Net2D.render(container, state, { highlight:[…], onSticker(i), size:'sm'|'md'|'lg', labels:bool }) -> { update(state, opts), destroy() }
CC.MovePad.render(container, { onMove(token), compact:bool, rotations:true, slices?:bool }) -> { destroy() }   // U U' R R' … + x y z
CC.Keys.toMove(keyboardEvent, scheme:'simple'|'cstimer') -> token|null
    // simple: letter = clockwise, Shift+letter = anticlockwise (U D R L F B M E S X Y Z → x y z)
    // cstimer: I=R K=R' J=U F=U' H=F G=F' S=D L=D' D=L E=L' W=B O=B' ;=y A=y' T=x N=x' P=z Q=z' …
CC.Keys.legend(scheme) -> [{ key, token }]
```
**Touch.** A draggable cube's canvas has `touch-action: pan-y` (not `none`): a non-passive
touchstart claims (preventDefault) only touches that land on the cube's on-screen outline (convex
hull of its 8 projected corners plus `TOUCH_MARGIN` = 12 px); a touch on the background around it
scrolls the page vertically and orbits sideways. A picture-only cube leaves touch alone. Orbit is
0.0085 rad per px of drag. Pure helpers on `CC.View3D._internal`: `projectPoint`, `convexHull`,
`inHull`, `cubeOutline`, `touchActionFor`, `viewDir`, `dragToToken`, `createSequencer`, … and the
constants `TOUCH_MARGIN`, `FOV` (30°), `FIT_RADIUS`. Camera API: `setView(side)` glides the camera
to `'right'` (the default, front-top-right), `'left'`, `'back-right'` or `'back-left'` (degrees in
`CC.View3D.VIEW_SIDES`, the same as the Gym screen's `VIEW_AZ`) and makes that side the home that
`resetCamera()` and a double-click return to; the 2D fallback's `setView` is a no-op. The Gym uses it for
Left-algorithm items and stuck-fix back slots (its synthetic-drag fallback only runs without `setView`).

### `CC.TopView` — js/topview.js (SVG cube pictures; pure geometry testable in node)
```
CC.TopView.render(container, state, { highlight:[idx], selectable:['UF','UR','UB','UL'], selected:[pos],
                                      marks:{ [pos]: 'right'|'wrong'|'missed' }, onSelect(pos),
                                      size:'xs'|'sm'|'md'|'lg'|'fill'|px, caption:true|string, label })
    -> { el, update(state?, opts?), focus(pos), destroy() }
    // the standard last-layer diagram: top face 3×3 seen from above with the top row of each side folded
    // out round it, FRONT AT THE BOTTOM; top edges are buttons when selectable (Enter/Space work too)
CC.TopView.renderIso(container, state, { side:'right'|'left', highlight, dim:true, size:'sm', label, caption })
    -> { el, update(state?, opts?), destroy() }
    // a small flat picture of the cube as held: top, front and one side. Cheap enough to show several at
    // once — one WebGL View3D per screen is the rule, so picture choices use these.
pure: gridCell(i) -> {row,col} on a 5×5 grid | null   cells()   layout()   positions()   positionOf(i)
      hitRect(pos)   describe(state, pos) -> 'Front edge: yellow on top, blue on the side'
      isoLayout(side)   isoProject(side, point)   POSITIONS = ['UF','UR','UB','UL']   SIZE
```
The grid is derived from `CC.Cube.STICKERS` geometry, not typed in. With a highlight, the other
stickers are dimmed to opacity .74 (enough to keep yellow and orange recognisable); the highlight
ring is the same pink as View3D's.

### `CC.Lessons` — js/lessons.js (content only)
```
CC.Lessons.STAGES[stageId] = { id, index, title, tagline, goal, why, howTo:[paragraph], recognise:[{caseId, name, look, action}],
                               algorithms:[algId], mnemonics:[str], mistakes:[str], hints:[h1 concept, h2 case+alg, h3 'exact moves'], speedTips:[str] }
   // STAGES.middle also has:
   //   halves:[{ algId, first, second, rhythm:[first, second], firstDoes, secondDoes }]   (mid-right, mid-left)
   //   mirrorRule, whyItWorks, landmarks:[str] (after the first half / at the end / "broken mid-way is normal"),
   //   lostPlace:[str] (what to do when you lose your place)
CC.Lessons.ALGORITHMS[algId] = { id, name, notation, plain:[per-move English], mnemonic, usedIn:[stageId], fingerTricks, reps? }
CC.Lessons.NOTATION = [{ token, title, text, tip }]     // primer: faces, ', 2, rotations, how to hold
CC.Lessons.DEMOS[stageId] = [{ id, title, summary, caseIds, setup:"face moves applied to a SOLVED cube held yellow-up green-front",
                               moves:"demonstrated solution", narration:[{ at:moveIndex, text }], checkpoints? }]
   // middle has 9: middle-right, middle-left, middle-stuck, middle-right-back, middle-right-turn, middle-two,
   //               middle-wrong-slot, middle-no-edge, middle-yellow-trap
CC.Lessons.CURRICULUM = [{ week, title, focus, goals:[str], routine:[{ minutes, activity }], milestone }]   // ~12 weeks
CC.Lessons.MILESTONES = [{ id, name, desc }]
CC.Lessons.SPEED_TIPS = [{ title, text }]
CC.Lessons.GLOSSARY = [{ term, text }]
```
Invariant (tested): for every DEMO, applying `setup` then `moves` to a solved yellow-up cube leaves
that stage's goal met (and all earlier stages), and `setup` alone leaves the stage unsolved.
The Middle Layer lesson page shows `halves`, `mirrorRule`, `landmarks` and `lostPlace` as their own
cards and leaves the How-to lines they repeat out of the list (`_coveredByExtras` in
js/screens/learn.js matches them by their opening words; reword both together).

### `CC.Store` — js/storage.js
```
CC.Store.load() -> data   CC.Store.save(data) -> bool (false = memory only)   CC.Store.reset()   CC.Store.defaults()
CC.Store.exportJSON(data) -> string   CC.Store.importJSON(str) -> data   // throws a friendly Error; does not save
CC.Store.exportCode(data) -> 'CUBE1.' + base64(zlib(compact JSON))     // a progress code (~40,000 chars after 300 solves)
CC.Store.importCode(text) -> data       // tolerant of what Messages/WhatsApp/Notes do: whitespace and line breaks,
                                        // smart quotes, zero-width characters, words before the code, junk after it,
                                        // lower-case prefix; the text of a JSON backup imports too. Throws a friendly
                                        // Error ("This code looks damaged or cut short…"). Does not save.
CC.Store.merge(local, incoming) -> data    // pure, idempotent, order-independent for progress (rules below)
CC.Store.replace(local, incoming) -> data  // the incoming progress, keeping this device's DEVICE_SETTINGS
CC.Store.summary(data) -> { solves, completed, fullSolves, bestMs, practiceDays, practiceMinutes, milestones,
                            strongStages, drillAnswers, createdAt, lastActive }   // for the paste preview
CC.Store.DEVICE_SETTINGS = ['theme','mirror','autoCapture','cameraId','cameraLabel','cameraFacing','keyboard']
                                        // belong to one device: never travel with progress
CC.Store.persistent() -> bool   CC.Store.useStorage(storage|null|undefined)   // test hook
CC.Store.KEY = 'cubecoach.v1'  CODE_PREFIX = 'CUBE1.'  VERSION  MAX_SOLVES = 2000  STAGE_IDS  ALG_IDS  migrate  normalize
data = {
  version: 1, createdAt: ISO,
  settings: { mirror:true, autoCapture:true, animSpeed:1, anticipate:true, guidanceOverride:null|0..3,
              keyboard:'simple'|'cstimer', inspection:true, goalSeconds:180, splitTaps:true, …screen-owned keys },
  skills: { [stageId]: { mastery:0..100, sessions:0, soloClean:0, lastLevel:3, lastPracticed:ISO|null } },
  solves: [{ id, at:ISO, device:'physical'|'virtual', source:'scan'|'scramble'|'drill', stage:null|stageId,
             scramble:string|null, totalMs, splits:{[stageId]:ms}, levels:{[stageId]:0..3}, hints:{[stageId]:n},
             quiz:{ right, total }, completed:bool }],
  drills: { [drillType]: { right, total, lastAt } },        // includes 'gym-<drillId>' rows (CC.Coach.recordDrill)
  algs: { [algId]: { box:1..5, due:ISO, right, total } },
  practiceLog: { ['YYYY-MM-DD']: minutes },
  milestones: { [id]: ISO },
  gym: { [gymDrillId]: { right, total, streak, best, bestMs, bestRoundMs?, lastAt, recent:[0|1 … last 10] } }  // CC.Gym
}
```
Loading never throws (missing/blocked storage falls back to memory; corrupt JSON is kept under
`cubecoach.v1.corrupt`). Unknown keys are kept, so a newer version's data survives a round trip.
**Merge rules:** solves = union by id (the same solve counts once); skills = higher mastery, larger
session and soloClean counts, latest practice date; drills and gym = the record with the larger total
(gym also keeps the higher best streak, the lower `bestMs` and the lower `bestRoundMs`); practiceLog = per day the larger
minutes; milestones = earliest date; algs = the higher Leitner box; settings = this device's, with
keys it lacks filled in from the code (never the DEVICE_SETTINGS).

### `CC.Coach` — js/coach.js (pure functions over `data`; `now` is always injectable for tests)
```
CC.Coach.LEVELS = [{id:0,name:'Solo'},{id:1,name:'Nudge'},{id:2,name:'Coach'},{id:3,name:'Show'}]
CC.Coach.levelFor(data, stageId) -> 0..3                  // from mastery, unless settings.guidanceOverride is set
CC.Coach.masteryOf(data, stageId, now?) -> 0..100
CC.Coach.recordStage(data, stageId, { level, hints, ms, quizRight, quizTotal, device }) -> { mastery, delta, level, … }
CC.Coach.recordSolve(data, solve, now?) -> { newMilestones:[ids] }
CC.Coach.recordDrill(data, type, correct, now?)            // the Gym records as type 'gym-' + drillId
CC.Coach.logPractice(data, minutes, now?)
CC.Coach.stats(data, { device }?) -> { count, best, last, ao5, ao12, mean, trend:[{at,ms}], byStage:{[id]:{avgMs, share}},
                                       streak, todayMinutes, weekMinutes, slowestStage }
CC.Coach.journey(data) -> { phase:'learn'|'practice'|'independent'|'speed', title, description, progress:0..1, next, focusStage }
CC.Coach.todayPlan(data, now?, { cube }?) -> [{ minutes, kind:'lesson'|'watch'|'drill'|'virtual'|'solve'|'timed'|'algs'|'gym', target, title, why, … }]
CC.Coach.milestones(data) -> [{ id, name, desc, earnedAt|null }]
CC.Coach.algDue(data, now?) -> [algIds]    CC.Coach.gradeAlg(data, algId, correct, now?)
CC.Coach.hintLadder(step) -> [{ level:1, text }, { level:2, text }, { level:3, text, moves, plain }]
```
While the middle layer has been tried and is still under Nudge (mastery < 50), `todayPlan` adds a
5-minute `kind:'gym'` item early in the plan (`stageId:'middle'`, `drillId` from `CC.Gym.suggest`; the
5 minutes come from the longest other items, none below 2). Home routes it to `go('gym', { drill })`.
Home also shows a "Middle Layer Gym" tile and Practice a nudge on the middle-stage row.

### `CC.Drills` — the generator inside js/screens/drills.js (pure; uses Solver, Lessons, Cube)
```
CC.Drills.TYPES = [{ id, name, desc, stageIds:[…]|null }]
   // 'notation'  watch a move animate → name it (4 options)         | 'perform' see a move/alg → do it on the virtual cube
   // 'recognise' see a case → choose the right action/algorithm      | 'reps'    how many times R U R' U' / R' D' R D?
   // 'predict'   mid-solve: what is the next step?                    | 'algorithm' perform the algorithm for this case
CC.Drills.next(type, { stageId?, seed }) -> Item
Item = { type, stageId, prompt, state (54, as held: yellow on top), demo: tokens|null (animate before asking),
         options:[str]|null, answer:index|null, targetState:[54]|null (perform/algorithm items), explain, algId|null }
CC.Drills.check(item, response) -> { correct, explain }   // response = option index, or the virtual cube state after the user's moves
```
There is no js/drills.js: the Practice screen defines `CC.Drills` (only if nothing else has).

### `CC.Gym` — js/gym.js (the Middle Layer Gym engine; pure, node-testable)
```
CC.Gym.ALGS = { right: { id:'right', algId:'mid-right', name:'Right', slot:'front-right', slotPos:'FR', notation, moves:[8],
                         plain:[8 per-move English], mirrorOf:'left',
                         halves:[{ moves:[4], name:'First half: corner out', rhythm:'away, up, back, down', plain, does },
                                 { moves:[4], name:'Second half: pair in', rhythm:'aside, open, back, close', plain, does, link }] },
                left:  { …same shape, algId:'mid-left', slot:'front-left', slotPos:'FL', mirrorOf:'right' } }
CC.Gym.MIRROR_RULE   // 'Swap R and L, and turn every move the other way (U becomes U', F' becomes F).'
CC.Gym.MIRROR_FEEL   // what the mirror feels like in your hands (R and L' both lift a side UP)
CC.Gym.mirror(tokens) / mirrorMove(token)   // left = mirror(right) and back (tested)
CC.Gym.GROUPS = [{ id:1..5, name, problem (the learner's words), desc }]
    // 1 See it "I don't know what to do" · 2 Remember it "I can't remember the moves" · 3 Stuck edges "An edge is
    // stuck" · 4 Keep your place "I lose my place" · 5 Put it together
CC.Gym.PRIORITY = [2, 1, 3, 4]   // the learner's own order: the hub lists groups in it (then 5); suggest() ties follow it
CC.Gym.DRILLS = [{ id, group, groupName, name, desc, kind:'tap'|'multi'|'sequence'|'walkthrough'|'perform'|'route',
                   needsCube:false|'virtual'|'real', route?:{ id, params } }]   // 17 drills, table in docs/MOBILE-AND-GYM.md
CC.Gym.drill(id) -> drill|null      CC.Gym.CONCEPTS[drillId] -> the sub-cases a round spreads over
CC.Gym.LANDMARKS = { right:[{ after:4, title, text, note, facts }, { after:8, title, text, facts }], left:[…] }
CC.Gym.whereText(alg, k) -> where things are after k moves (0..8)
CC.Gym.next(drillId, { seed, level?, concept? }) -> Item     // deterministic per seed
CC.Gym.session(drillId, { seed, count:10, level? }) -> [Item] // sub-cases spread evenly, no duplicates (by item.key)
CC.Gym.check(item, response) -> { correct, explain, partial?, step? }
CC.Gym.goalMet(goal, state) -> { ok, why? }                  // for perform drills; any way the cube is held
CC.Gym.record(data, drillId, correct, { ms?, coach? }, now?) -> { entry, strong }
CC.Gym.recordRound(data, drillId, { right, total, ms }) -> { best, previous? }
CC.Gym.isStrong(entry) -> bool       // at least 8 right in the last 10 answers
CC.Gym.suggest(data, { hasCube }) -> { drillId, group, reason }
geometry: slotStatus(state, 'FR'|'FL'|'BL'|'BR') -> 'home'|'flipped'|'wrong-slot'|'yellow'   usableTop(state)
          SLOTS  ROT_TO_FR  ROT_TO_FL  PAD (the 8 moves of the mirror pad)
```
**Items.** Common fields: `{ drillId, kind, needsCube, prompt, state (54, as held, learning frame),
view:'3d'|'top'|'both', highlight:[sticker indices], options:[{ id, label, sub?, stickers?, state?,
highlight?, why? }]|null, answer: id | [ids] | null, explain, level, key, concept, index (in a
session) }`. Depending on the drill: `steps` (decide, halves, mirror: `[{ prompt, options, answer,
explain, … }]`), `moves` (the intended solution or demonstration), `alg`, `edge:[side, top]`,
`targetState`, `goal`, `cues:[bool×8]` (recall: which moves are shown, fading by level 1–4),
`halfStates`/`landmarks` (halves), `done`/`startState` (nextmove, whereami, slip), `slot`
(stuck-spot, stuck-fix), `performPrompt` (stuck-fix), `checkpoints` (slowmo), `scramble`/`route`
(full-virtual, full-real). `decide` asks four steps: which edge → which centre in front → which
top turn → left or right.

**Why on wrong options.** Every wrong option (top-level and step options) carries `why`, a
one-line reason worked out by simulation (where that turn really takes the edge, which slot the
other algorithm drops it into, which move a wrong token really is). `check()` puts the chosen
option's `why` first in `explain`, for taps and for `{ step, id }` answers, so a screen just shows
`explain`. `multi` (spot) returns `partial: { hits, missed, extra }`; whole-sequence answers return
`partial: { right, of, firstWrong }`.

**Perform goals** (`goalMet`, used by `check(item, state)` for recall, slip, stuck-fix, sprint):
the cube is first turned yellow-up (`CC.Solver.yellowUp`); the white layer must be whole; then
`insert` = that edge home and every edge in `goal.keep` still home; `popout` = that edge out in the
top layer **or already put back home properly** (also accepted), with `keep` still home; `f2l` =
the first two layers solved. Route drills just hand over to the solve screen.

**Progress.** `record()` keeps `data.gym[drillId] = { right, total, streak, best, bestMs, lastAt,
recent }` and also calls `CC.Coach.recordDrill(data, 'gym-' + drillId, correct)` (unless
`coach:false`). The screen passes `ms` only for a solved sprint, so `bestMs` is the best sprint
time. `recordRound()` is for the `leftright` speed round: only a perfect round (right === total)
counts, and a faster one replaces `bestRoundMs`. `suggest()` takes the weakest of groups 1–4 (average
of each drill's last-10 score, strong = 1), then the weakest drill in it that is not strong yet;
ties follow `PRIORITY` and drill order, so empty data suggests `halves` (group 2). Real-cube drills
only with `hasCube`; when everything is strong it suggests `sprint` (or `full-real` with a cube).

### App shell — index.html, css/app.css, js/app.js
```
CC.App.registerScreen(id, { title, mount(el, params) -> cleanup?, unmount?() })
CC.App.go(id, params?, { replace? })   CC.App.back()   CC.App.current -> { id, params }   CC.App.screens()
CC.App.data            // the loaded CC.Store data (settable: CC.App.data = merged);  CC.App.save()
CC.App.toast(text, kind | { kind, ms, action:{ label, onClick } }) -> { close() }
CC.App.notice(text, { kind, id }) -> { close() }        // slim dismissible banner under the top bar
CC.App.modal({ title, body: Node|string, actions:[{ label, primary?, danger?, onClick? }], dismissible?, wide? }) -> Promise<label|null>
CC.App.applyTheme(theme)   CC.App.markActive()   CC.App.boot()
// phone / installable app
CC.App.keepAwake(on, reason?) -> bool   // Screen Wake Lock; true when the browser supports it
CC.App.isAwake() -> bool                // a lock is held right now
CC.App.isStandalone() -> bool           // opened from the Home Screen icon (display-mode standalone / navigator.standalone)
CC.App.platform() -> { ios, ipad, android, phone, browser:'chrome'|'safari'|'firefox'|'edge'|'other', standalone, touch }
CC.App.HOSTED_URL = 'https://pmcgroark.github.io/cube-coach/'
CC.App.swDecision({ protocol, hostname, search }) -> 'register'|'dev'|'off'|'insecure'|'unavailable'   // pure
CC.App.offlineStatus() -> Promise<{ decision, supported, registered, controlled, ready, cached, total, version,
                                     updateReady, installing, error }>
CC.App.updateReady      // getter: a new version is waiting
CC.App.applyUpdate()    // switch to the waiting version and reload (the toast's Reload button)
window events: 'cc:boot' · 'cc:screen' {id, params} · 'cc:practice' {minutes} · 'cc:sw' {decision, updateReady}
CC.UI.h(tag, attrs, ...children) -> Element     // tiny hyperscript; attrs: class, style (object), on* handlers, dataset, ref
CC.UI.fmtTime(ms) -> '1:23.45'   CC.UI.algChips(tokens, { current, done, size }) -> Element (.update({current, done}))
CC.UI.stageTrack(currentId, doneIds) -> Element   CC.UI.colourDot(letter) -> Element   CC.UI.empty(el)
CC.UI.copyText(text) -> Promise<bool>     // Clipboard API, else a hidden textarea + execCommand (call from a tap)
CC.UI.canShare(data?) -> bool             // navigator.share is there and accepts this data
CC.UI.shareText({ title, text, url }) -> Promise<'shared'|'cancelled'|'unsupported'|'failed'>   // system share sheet
```
**keepAwake.** The screen stays on while any reason is on; `keepAwake(false, reason)` drops only
that reason and `keepAwake(false)` with no reason clears them all. **Every route change resets it**,
so a screen asks again in `mount()`. Reasons in use: `'solve'`, `'scan'` (also inside the rescan
dialog, which sits on top of a solve), `'gym'` (while a round runs). The lock is re-taken on
`visibilitychange`, and a refused request is retried on the next tap. Unsupported browsers: no-op.

**Service worker.** `swDecision`: `register` on https (or `?sw=1` on localhost); `dev` on
localhost / 127.0.0.1 / `*.localhost` without `?sw=1` (never cache, and remove any old copy, so
serve.py always shows the latest files); `off` with `?sw=0` anywhere; `insecure` on plain http
elsewhere; `unavailable` for file:// (at runtime `unsupported` when the browser has no service
workers). When a new version has installed and is waiting, a toast says "A new version is ready —
Reload"; Reload posts `SKIP_WAITING` and reloads on `controllerchange`. A Home Screen app checks
for a new version when it comes back to the front (at most every 30 minutes). The app also asks for
persistent storage so the browser does not clear progress under storage pressure.

Screens live in js/screens/*.js and register themselves (or queue on `CC.PendingScreens` if they
load before app.js): `home`, `scan`, `solve`, `learn`, `lesson`, `watch`, `drills`, `stats`,
`settings`, `gym`. Hash routing (`#/learn`, `#/gym?drill=spot`). Navigation: Home · Learn · Practice
· Stats · Settings — in the top bar on wide screens, a bottom tab bar at ≤ 720 px wide (64 px +
`env(safe-area-inset-bottom)`), and back in the top bar on a phone on its side (≤ 720 px wide and
≤ 500 px high), so the cube keeps the height. `scan`, `solve`, `drills` and `gym` light up
Practice. `html` classes: `is-booted`, `is-standalone`, `is-ios`, `no-3d`, `has-modal`.
Keyboard shortcuts never fire while typing in inputs or while a modal is open.

## Guidance levels (the "less help over time" engine)

Per stage, chosen from mastery (learner can override):
* **3 Show** — every step is animated on the 3D cube; the learner copies it.
* **2 Coach** — goal, case and algorithm *name* shown; moves hidden behind "Show moves";
  recognition quizzes at decision points ("which way does this edge go?").
* **1 Nudge** — only the stage goal; "Hint" escalates: concept → case + algorithm → exact moves.
* **0 Solo** — stage name and timer only; hints on request.

With a real cube at levels 0–1 the learner turns on their own, so the app no longer knows the
state; asking for a hint offers a quick rescan (or "I haven't moved since"). On the virtual cube
the state is always known, so hints are always exact and stage completion is detected automatically.

## As built — integration notes for screen authors (read before using a module)

Each module's own header/exports are the source of truth; these are the gotchas.

* **Solver** — use `progress(state)` (not `check[]`) to drive the stage track: mid-`yorient` the
  lower layers are temporarily scrambled and `progress` knows that. `solve()` throws
  `Error` with `.validation` on an impossible cube. Extra exports: `STAGE_IDS`, `ALGS`, `CASES`,
  `yellowUp(state)`, `shapeOf(state)`; `opts.directCross` skips the daisy (for advanced learners).
  If a learner stops part-way through an algorithm, a fresh `solve()` may pick a different piece,
  so on the virtual cube FOLLOW THE CURRENT STEP (match the learner's moves against
  `step.moves`); only re-plan with `solve()` when they deviate. `solve(step.endState)` always equals
  the remaining plan. Middle-layer steps intentionally keep "U' U R U' …" (line-up U + algorithm).
* **Scanner** — `onCapture(stepIndex, colours)` can fire for a step other than the current one
  (if the learner showed ORANGE before RED, the scanner swaps them): treat it as "set this step's
  colours", never "append". `info.live` is in raw sticker order; `info.message` is a ready-made
  hint ("Hold still…", "Tilt the cube — glare"); after the last face `info.step === 6`,
  `expected === null`. `start()` both calls `onError` and rejects. `stop()` only stops tracks it
  opened itself (for `useStream`, the owner stops the stream, e.g. `fake.destroy()`).
  The controller resizes the canvas to the camera aspect; size it with CSS. Demo/fake camera:
  `const fake = CC.Scanner.createFakeCamera(stateInScanFrame); ctl.useStream(fake.stream);` and call
  `fake.showFace(i)` when the controller asks for step i (wait ~0.8 s, like a person turning it).
  Use `sayFor(SCAN_ORDER[i], ctl.getFacing())` for the instruction so it follows the camera in use.
  Pass `statusText:false` when the page shows its own "Camera paused" / "Tap to start" message, and
  call `resume()` from the learner's tap when the state is `blocked`.
* **View3D** — `play()` accepts tokens or a string and resolves with the end state. Arrows are
  fixed to the default view; call `showArrow(null)` when the move has been played. Unknown sticker
  letters (e.g. `'?'`) render grey in View3D and Net2D — use that for partially scanned cubes.
  `onMove` also fires for moves skipped by `cancel()`. One WebGL View3D per mounted screen; use
  `CC.TopView` SVGs for extra pictures.
* **Lessons** — helpers `stage(id)`, `algorithm(id)`, `findDemo(id)`, `demoStates(demo) ->
  {stageId, start, moves, end, holding}`. DEMOS carry `checkpoints` ("pause and predict":
  `{at, kind:'next'|'reps'|'alg', prompt, options, answer, explain}`) — show them in watch/lesson
  players; narration `at` is an index into `parseAlg(moves)` shown just before that move plays,
  `at === moves.length` is the closing remark. Also `NO_CUBE_TIPS`, `EXPECTATIONS`,
  `LEARNING_FRAME`; `sune.asUsed` is the with-U version.
* **Coach** — `recordSolve` does NOT change mastery: call `recordStage` for every stage the
  learner attempted, then `recordSolve`. `recordStage` returns `{promoted, demoted, level, prevLevel,
  newMilestones, …}` — celebrate promotions ("next time I'll only show you the goal").
  `todayPlan(data, now, {cube:false})` gives the no-cube plan; items carry `needsCube`, `alt`,
  `stageId`, `drillType`, `algIds`. `hintLadder(step)[2]` also has `plain` (English per move).
* **Gym** — `CC.Gym.session()` is what the screen uses; a round is 10 items, except `halves` and
  `slowmo` (4) and `sprint` (3); route drills have no round (`_helpers.roundSize`). Perform drills
  (recall, slip, stuck-fix) count as right only when done in at most **the clean number of face
  turns + 6** (rotations don't count); the sprint counts whenever the goal is met and records the
  time; stuck-fix also needs the right choice first ("front-right, Right algorithm"). Every answer:
  `CC.Gym.record`, then `CC.App.save()`.
* **App/UI** — `mount` may return a cleanup function; `modal()` resolves `null` when dismissed.
  Extra UI helpers: `CC.UI.callout(kind,title,...body)`, `tile({icon,title,desc,onClick,badge})`,
  `icon(name,size)` (see ICONS in app.js), `stages()`, `reducedMotion()`, `shortcutsBlocked(e)`,
  `isTyping(e)`. `CC.App.markActive()` keeps the practice-minutes tracker counting during passive
  watching. Toasts sit above the tab bar (and above the solve screen's dock).

## Screen routes & params (shared contract)

```
go('home')                      go('stats')
go('settings', { section?: 'phone'|'move'|'look'|'coach'|'keys'|'camera'|'timer'|'data'|'about' })   // scrolls to that card
go('learn', { section? })       go('lesson', { id: stageId | 'notation' })     // 'stage' is accepted for id
go('watch', { stage?: stageId, seed?: number })        // narrated demo solve; with stage → just that stage
go('drills', { tab?: 'drills'|'algs'|'stages'|'timed', type?: drillType, stage?: stageId })
go('gym', { drill?: gymDrillId })                      // hub, or a round of that drill; a route drill opens solve
go('scan', { demo?: 1, manual?: 1 })                   // scan a real cube → review → go('solve', {device:'physical', source:'scan', state}); demo = demo camera, manual = type the colours in
go('solve', { device: 'physical'|'virtual', source: 'scan'|'scramble'|'drill', state?, scramble?, stage?, seed?, timed?: bool })
   // physical+scan: state given (scan frame: white top, green front)
   // physical+scramble: screen generates a WCA scramble, learner applies it to a SOLVED cube (white top, green front)
   // virtual+scramble: virtual cube scrambled for them
   // source 'drill' + stage: CC.Solver.drillScramble(stage) (learning frame: yellow top, green front); ends when that stage is done
   // timed: speed mode — no guidance, inspection + timer, hints only on request
```
Complex params (cube states) stay in memory, keyed by route; only short simple params go in the
hash. The solve screen's `leave()` goes home and `leave({ id, params })` goes there instead (the
middle stage's "Stuck? Practise in the Gym" uses `{ id:'gym', params:{} }`); either way a solve in
progress is confirmed first and saved as not finished. On a portrait phone (≤ 720 px wide) the
solve controls become a sticky dock above the tab bar (`.cc-solve__transport.is-docked`); on a
phone on its side (≤ 500 px high) the solve is two columns with the cube kept in view. In both, the
cards' action buttons and the quiz move next to the cube and controls.

Gym entry points: Home (a "Middle Layer Gym" tile when the middle layer is the journey's focus
stage, or the weakest practised stage and below Solo mastery, or the gym was used in the last 14
days), the Middle Layer lesson and its stage card ("Go to the gym"), Practice › Stages (middle row,
plus a nudge when middle is the weakest stage and below Solo mastery), Stats (one "Middle Layer Gym" row in Drill accuracy, linking to the weakest drill),
and the solve screen on the middle stage.

`CC.ScanUI` (js/screens/scan.js) is the reusable scanner widget:
`CC.ScanUI.mount(container, { purpose:'start'|'rescan', onDone(state), onCancel(), autoStart?, demo?, demoState?,
inModal?, manual?, onPhase?(phase) }) -> { destroy() }` and
`CC.ScanUI.open({ purpose:'rescan', title?, demo?, demoState?, autoStart? }) -> Promise<state|null>` (full-screen
overlay; used by the solve screen to rescan mid-solve without losing the session). `onPhase` is told
`'intro' | 'scanning' | 'manual' | 'review' | 'error'` (the scan screen hides its heading while scanning on
a phone, so the camera and the Capture button fit on one screen). Returned states are in the scan frame
(white top, green front) — the solver re-orients them. The widget also has a manual "type the colours in"
path, a 3D "how to hold it" cube per step (mirrored when the preview is mirrored), a "Switch camera" button,
and a review step whose primary button is "Looks right — start solving" / "Looks right — use it". On a
phone it starts the rear camera (`CC.Scanner.defaultFacing`) unless `settings.cameraFacing` says otherwise.

Extra settings keys owned by screens (Store keeps unknown keys): `theme` (null|'light'|'dark'), `hasCube`,
`welcomeDismissed`, `plan` (home's daily snapshot), `directCross` (Settings › Skip the daisy — passed to
`CC.Solver.solve` by the solve screen), `cameraId` / `cameraLabel` (a chosen camera; wins over facing),
`cameraFacing` (null = automatic: rear on phones, front elsewhere | 'environment' | 'user'; set by Settings ›
Camera and by "Switch camera"; choosing a facing clears `cameraId`/`cameraLabel`, and a named camera whose
label says front/back also sets it). `theme`, `mirror`, `autoCapture`, the camera keys and `keyboard`
never travel in a progress code (`CC.Store.DEVICE_SETTINGS`).

## Offline copy, publishing and deploy

* `sw.js` precaches every app file (`index.html`, `manifest.webmanifest`, everything under `css/`,
  `js/`, `vendor/`, `icons/`) under the cache `'cube-coach-' + VERSION`; cache-first for same-origin
  GETs; navigations fall back to the cached `index.html`; old `cube-coach-*` caches are deleted on
  activate; `{type:'STATUS'}` replies `{ version, cached, total, ready }` (Settings › On your phone
  shows "Offline ready ✓"); `{type:'SKIP_WAITING'}` activates a waiting version.
* **Stamp before publishing:** `node tests/platform.test.js --stamp` rewrites `PRECACHE` (the file
  list) and `VERSION` (date + a hash of the files' contents) in sw.js. Installed phones only fetch
  new files when **sw.js itself changes**, so an unstamped push never reaches them. The platform test
  fails when a file is missing from the list and prints a NOTE when files changed since the last stamp.
  `node tools/make-icons.js` is only needed when the brand mark or `HOSTED_URL` changes
  (`--check` tells you).
* **Deploy:** GitHub Pages serves the `main` branch, root folder, of the repository at
  <https://pmcgroark.github.io/cube-coach/> (`.nojekyll` makes Pages serve the files as they are). So
  publishing = stamp, run the tests, commit, push to `main`.
