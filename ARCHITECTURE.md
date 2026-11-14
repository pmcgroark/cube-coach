# Cube Coach — architecture & module contracts

A single-page HTML app that teaches a complete beginner to solve a 3×3 Rubik's cube, then weans
them off help until they can solve any cube unaided in under 3 minutes. It works in two ways:

* **With a real cube** — hold the cube up to the laptop camera, the app scans all six faces and
  coaches the solve step by step, giving less and less help as the learner improves.
* **Without a cube** — an on-screen 3D cube the learner can turn (mouse drag, keyboard, move
  buttons): narrated "watch & learn" demos, a virtual solve with *live* coaching (the app always
  knows the virtual cube's state), and drills (notation, case recognition, algorithm recall,
  repetition counts, predict-the-next-step).

The learner is a total beginner, practising ~20 min/day. Goal: any cube in < 3:00.

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
* Only external dependency: three.js r128 global build
  `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` (global `THREE`).
  No other CDNs, no web fonts required (system font stack).
* Served from `http://localhost:8765` (the camera needs a secure context). `Start Cube Coach.command`
  runs `python3 -m http.server 8765` in the folder and opens the browser.
* Tests: `node tests/<name>.test.js` using plain `assert`; `node tests/run-all.js` runs them all.
  Pure logic must be testable in node (no DOM at load time; DOM only inside functions that need it).
* Script load order in index.html: cube.js, solver.js, scanner.js, render3d.js, lessons.js,
  storage.js, coach.js, drills.js, app.js, then js/screens/*.js.
* Write for a beginner: plain English, short sentences, colour names not face letters where it
  helps ("turn the cube so the RED centre faces you"). Notation is always shown *with* a plain
  English description (`CC.Cube.moveInfo(token).text`).
* Use British/neutral spelling consistently ("colour", "centre").

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
  `simplifyAlg`, `isSolved`, `validate(state) -> {ok, errors:[{type,message,stickers}]}`,
  `findEdge(state,a,b)`, `findCorner(state,a,b,c)`, `center(state,face)`, `centers`,
  `rotationTo(state, upColour, frontColour|null) -> tokens`, `yRotationTo(state, frontColour)`,
  `stickerAfter(index, alg)`, `algPerm(alg)`, `scramble(len, seed)`, `mulberry32(seed)`,
  `moveInfo(token) -> {token, base, amount, rotation, face, label, how, text}`,
  tables `STICKERS[i] = {face,row,col,cubie,normal}`, `EDGES`, `CORNERS` (with `.name`,
  `.stickers`, `.faces`), `COLOR_HEX`, `COLOR_NAME`, `FACE_NAME`, `PERM[token]`.

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

The "learning frame" used by demos, drills and drill scrambles is **yellow on top, green in front**,
i.e. `CC.Cube.applyAlg(CC.Cube.solved(), 'z2')` — in that frame ORANGE is on the right and RED on
the left. Scanning, by contrast, always happens in the standard frame (white top, green front).

Milestone ids (shared by Lessons, which names/describes them, and Coach, which awards them):
`first-solve` (any completed solve) · `first-virtual` (completed virtual solve) · `first-coach`
(completed solve with no stage at Show level) · `first-solo` (completed real-cube solve, every
stage at Solo level, zero hints) · `sub-10` · `sub-5` · `sub-3` · `sub-2` · `sub-90` (unaided
real-cube solves under 10:00 / 5:00 / 3:00 / 2:00 / 1:30) · `streak-7` · `streak-30` ·
`all-mastered` (every stage mastery ≥ 78) · `solves-100`.

Algorithm ids (shared by Solver, Lessons, Coach, Drills):
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
CC.Scanner.SCAN_ORDER = [ {face:'F', center:'G', up:'W', say:'…'}, R/red, B/blue, L/orange, U/white (blue on top), D/yellow (green on top) ]
CC.Scanner.isSupported() -> { ok, reason }        // secure context + navigator.mediaDevices.getUserMedia
CC.Scanner.createController({ canvas, mirror:true, autoCapture:true, onFrame(info), onCapture(stepIndex, colours9), onComplete(result), onError(err) })
   .start(deviceId?) -> Promise   .stop()   .captureNow()   .redo(stepIndex)   .setMirror(bool)   .setAutoCapture(bool)
   .useStream(mediaStream)          // e.g. the fake camera
   .listCameras() -> Promise<[{deviceId,label}]>
   info   = { step, expected:SCAN_ORDER[step], live:[9 letters], confidence:[9], centerMatches:bool, stability:0..1, captured:[bool×6] }
   result = { state:[54], confidence:[54], uncertain:[indices], validation }
   err    = { code:'denied'|'notfound'|'insecure'|'unsupported'|'busy'|'other', message (friendly, says how to fix) }
CC.Scanner.classifyCube({U:[9 rgb],R:…,F:…,D:…,L:…,B:…}) -> result   // pure; constrained clustering, exactly 9 of each colour
CC.Scanner.rgbToLab(r,g,b) -> [L,a,b]
CC.Scanner.createFakeCamera(state, opts?) -> { stream, showFace(stepIndex), destroy() }   // synthetic camera for demo/testing
```
The canvas shows the camera frame (mirrored by default, like a selfie) with a 3×3 guide and the live
colour guesses drawn on top; sampling always uses the raw (unmirrored) frame. The camera sees each
face exactly as it is defined in the facelet order, so raw-frame cell (row, col) = sticker (face, row, col).

### `CC.View3D`, `CC.Net2D`, `CC.MovePad`, `CC.Keys` — js/render3d.js
```
CC.View3D.supported() -> bool                                  // WebGL available
const v = CC.View3D.create(container, { interactive:true, turnable:false, size:'fill' })
v.setState(state)   v.getState()
v.play(tokens, { speed:1, onMove(i, token) }) -> Promise        // animated layer turns + rotations, queued & sequential
v.cancel()                                                      // jump to the end state of anything queued
v.showArrow(token|null)                                         // curved arrow on the layer that will turn next
v.highlight(indices|null)                                       // emphasise these stickers; follows the pieces through moves
v.setTurnable(bool)                                             // user may turn layers by dragging on stickers
v.onUserMove = (token) => {}                                    // fired after a user drag-turn (or v.userMove(token) from pad/keys) completes
v.userMove(token)                                               // animate a move as if the user made it (fires onUserMove)
v.resetCamera()   v.resize()   v.dispose()
CC.Net2D.render(container, state, { highlight:[…], onSticker(i), size:'sm'|'md'|'lg', labels:bool }) -> { update(state, opts), destroy() }
CC.MovePad.render(container, { onMove(token), compact:bool, rotations:true }) -> { destroy() }   // buttons U U' R R' … + x y z
CC.Keys.toMove(keyboardEvent, scheme:'simple'|'cstimer') -> token|null
    // simple: letter = clockwise, Shift+letter = anticlockwise (U D R L F B M E S X Y Z → x y z)
    // cstimer: I=R K=R' J=U F=U' H=F G=F' S=D L=D' D=L E=L' W=B O=B' ;=y A=y' T=x N=x' P=z Q=z' …
CC.Keys.legend(scheme) -> [{ key, token }]
```

### `CC.Lessons` — js/lessons.js (content only)
```
CC.Lessons.STAGES[stageId] = { id, title, tagline, goal, why, howTo:[paragraph], recognise:[{caseId, name, look, action}],
                               algorithms:[algId], mnemonics:[str], mistakes:[str], hints:[h1 concept, h2 case+alg, h3 'exact moves'], speedTips:[str] }
CC.Lessons.ALGORITHMS[algId] = { id, name, notation, plain:[per-move English], mnemonic, usedIn:[stageId], fingerTricks, reps? }
CC.Lessons.NOTATION = [{ token, title, text, tip }]     // primer: faces, ', 2, rotations, how to hold
CC.Lessons.DEMOS[stageId] = [{ id, title, setup:"face moves applied to a SOLVED cube held yellow-up green-front",
                               moves:"demonstrated solution", narration:[{ at:moveIndex, text }] }]
CC.Lessons.CURRICULUM = [{ week, title, focus, goals:[str], routine:[{ minutes, activity }], milestone }]   // ~12 weeks
CC.Lessons.MILESTONES = [{ id, name, desc }]
CC.Lessons.SPEED_TIPS = [{ title, text }]
CC.Lessons.GLOSSARY = [{ term, text }]
```
Invariant (tested): for every DEMO, applying `setup` then `moves` to a solved yellow-up cube leaves
that stage's goal met (and all earlier stages), and `setup` alone leaves the stage unsolved.

### `CC.Store` — js/storage.js
```
CC.Store.load() -> data   CC.Store.save(data)   CC.Store.reset()   CC.Store.exportJSON(data) -> string   CC.Store.importJSON(str) -> data
CC.Store.defaults() -> data   // localStorage key 'cubecoach.v1'; survives missing/blocked storage (falls back to memory)
data = {
  version: 1, createdAt: ISO,
  settings: { mirror:true, autoCapture:true, animSpeed:1, anticipate:true, guidanceOverride:null|0..3,
              keyboard:'simple'|'cstimer', inspection:true, goalSeconds:180, splitTaps:true },
  skills: { [stageId]: { mastery:0..100, sessions:0, soloClean:0, lastLevel:3, lastPracticed:ISO|null } },
  solves: [{ id, at:ISO, device:'physical'|'virtual', source:'scan'|'scramble'|'drill', stage:null|stageId,
             scramble:string|null, totalMs, splits:{[stageId]:ms}, levels:{[stageId]:0..3}, hints:{[stageId]:n},
             quiz:{ right, total }, completed:bool }],
  drills: { [drillType]: { right, total, lastAt } },
  algs: { [algId]: { box:1..5, due:ISO, right, total } },
  practiceLog: { ['YYYY-MM-DD']: minutes },
  milestones: { [id]: ISO }
}
```

### `CC.Coach` — js/coach.js (pure functions over `data`; `now` is always injectable for tests)
```
CC.Coach.LEVELS = [{id:0,name:'Solo'},{id:1,name:'Nudge'},{id:2,name:'Coach'},{id:3,name:'Show'}]
CC.Coach.levelFor(data, stageId) -> 0..3                  // from mastery, unless settings.guidanceOverride is set
CC.Coach.recordStage(data, stageId, { level, hints, ms, quizRight, quizTotal, device }) -> { mastery, delta, level }
CC.Coach.recordSolve(data, solve, now?) -> { newMilestones:[ids] }
CC.Coach.recordDrill(data, type, correct, now?)
CC.Coach.logPractice(data, minutes, now?)
CC.Coach.stats(data, { device }?) -> { count, best, last, ao5, ao12, mean, trend:[{at,ms}], byStage:{[id]:{avgMs, share}},
                                       streak, todayMinutes, weekMinutes, slowestStage }
CC.Coach.journey(data) -> { phase:'learn'|'practice'|'independent'|'speed', title, description, progress:0..1, next }
CC.Coach.todayPlan(data, now?) -> [{ minutes, kind:'lesson'|'watch'|'drill'|'virtual'|'solve'|'timed'|'algs', target, title, why }]
CC.Coach.milestones(data) -> [{ id, name, desc, earnedAt|null }]
CC.Coach.algDue(data, now?) -> [algIds]    CC.Coach.gradeAlg(data, algId, correct, now?)
CC.Coach.hintLadder(step) -> [{ level:1, text }, { level:2, text }, { level:3, text, moves }]
```

### `CC.Drills` — js/drills.js (pure; uses Solver, Lessons, Cube)
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

### App shell — index.html, css/app.css, js/app.js
```
CC.App.registerScreen(id, { title, mount(el, params), unmount?() })
CC.App.go(id, params?)   CC.App.back()   CC.App.current -> { id, params }
CC.App.data            // the loaded CC.Store data;  CC.App.save()
CC.App.toast(text)     CC.App.modal({ title, body: Node|string, actions:[{ label, primary?, onClick? }] }) -> Promise<label>
CC.UI.h(tag, attrs, ...children) -> Element     // tiny hyperscript; attrs: class, style (object), on* handlers, dataset
CC.UI.fmtTime(ms) -> '1:23.45'   CC.UI.algChips(tokens, { current }) -> Element   CC.UI.stageTrack(currentId, doneIds) -> Element
CC.UI.colourDot(letter) -> Element   CC.UI.empty(el)
```
Screens live in js/screens/*.js and register themselves: `home`, `scan`, `solve`, `learn`, `lesson`,
`watch`, `drills`, `stats`, `settings`. Hash routing (`#/learn`). Top nav: Home · Learn · Practice ·
Stats · Settings. Keyboard shortcuts never fire while typing in inputs.

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
  Result also has `warnings[]`, `repaired`, `suspectSteps[]` (steps worth re-scanning).
* **View3D** — `play()` accepts tokens or a string and resolves with the end state; `finalState()`,
  `isBusy()`, `setSpeed(s)`. Arrows are fixed to the default view; call `showArrow(null)` when the
  move has been played. Unknown sticker letters (e.g. `'?'`) render grey in View3D and Net2D —
  use that for partially scanned cubes. `onMove` also fires for moves skipped by `cancel()`.
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
* **App/UI** — `mount` may return a cleanup function; `modal()` resolves `null` when dismissed.
  Extra UI helpers: `CC.UI.callout(kind,title,...body)`, `tile({icon,title,desc,onClick,badge})`,
  `icon(name,size)` (see ICONS in app.js), `stages()`, `reducedMotion()`, `shortcutsBlocked(e)`.
  `CC.App.markActive()` keeps the practice-minutes tracker counting during passive watching.

## Screen routes & params (shared contract)

```
go('home')                      go('stats')                     go('settings')
go('learn')                     go('lesson', { id: stageId | 'notation' })
go('watch', { stage?: stageId, seed?: number })        // narrated demo solve; with stage → just that stage
go('drills', { tab?: 'drills'|'algs'|'stages'|'timed', type?: drillType, stage?: stageId })
go('scan', { demo?: 1, manual?: 1 })                   // scan a real cube → review → go('solve', {device:'physical', source:'scan', state}); demo = demo camera, manual = type the colours in
go('solve', { device: 'physical'|'virtual', source: 'scan'|'scramble'|'drill', state?, scramble?, stage?, timed?: bool })
   // physical+scan: state given (scan frame: white top, green front)
   // physical+scramble: screen generates a WCA scramble, learner applies it to a SOLVED cube (white top, green front)
   // virtual+scramble: virtual cube scrambled for them
   // source 'drill' + stage: CC.Solver.drillScramble(stage) (learning frame: yellow top, green front); ends when that stage is done
   // timed: speed mode — no guidance, inspection + timer, hints only on request
```
`CC.ScanUI` (js/screens/scan.js) is the reusable scanner widget:
`CC.ScanUI.mount(container, { purpose:'start'|'rescan', onDone(state), onCancel() }) -> { destroy() }` and
`CC.ScanUI.open({ purpose:'rescan', title? }) -> Promise<state|null>` (full-screen overlay; used by the solve
screen to rescan mid-solve without losing the session). Returned states are in the scan frame (white top,
green front) — the solver re-orients them. The widget also has a manual "type the colours in" path, a 3D
"how to hold it" cube per step (mirrored when the preview is mirrored), and a review step whose primary
button is "Looks right — start solving" / "Looks right — use it".

Extra settings keys owned by screens (Store keeps unknown keys): `theme` (null|'light'|'dark'), `hasCube`,
`welcomeDismissed`, `plan` (home's daily snapshot), `directCross` (Settings › Skip the daisy — passed to
`CC.Solver.solve` by the solve screen), `cameraId` / `cameraLabel`.

There is no js/drills.js: the Practice screen (js/screens/drills.js) contains its own generator with the
CC.Drills contract and would prefer a real CC.Drills module if one is ever added.
