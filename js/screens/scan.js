/* Cube Coach — Scan screen ('scan') and the reusable scanner widget CC.ScanUI.
 *
 * CC.ScanUI.mount(container, { purpose:'start'|'rescan', onDone(state), onCancel(), autoStart?, demo?,
 *                              demoState?, inModal?, onPhase?(phase) }) -> { destroy() }
 *   intro (what to do, Start camera / demo camera / type the colours in) → scanning (live camera with a
 *   3×3 guide, a small 3D "how to hold it" cube, the six faces in CC.Scanner.SCAN_ORDER, auto-capture
 *   or Space) or manual entry (copy each face's colours, face by face) → review (the cube unfolded
 *   flat; tap a sticker and pick a colour to fix it; rescan / retype any face) → onDone(state).
 *   onPhase is told 'intro' | 'scanning' | 'manual' | 'review' | 'error' (the screen hides its heading
 *   while scanning on a phone, so the camera and the Capture button fit on one screen).
 *
 * Phones: the rear camera by default (CC.Scanner.defaultFacing), a "Switch camera" button on the
 * preview, the choice remembered in settings.cameraFacing ('user' | 'environment'). The preview is
 * mirrored only for a front camera, and the instructions follow the camera: "Show the GREEN centre to
 * the camera" when the learner faces it, "Point the camera at the GREEN centre" with the rear camera
 * (the next face is then on their right). Portrait layout at 390×844: the face chips in one row, the
 * camera full width, the turn instruction with the mini cube, then a large Capture button.
 * CC.ScanUI.open({ purpose:'rescan', title?, demoState? }) -> Promise<state|null>
 *   The same widget in a full-size dialog, used by the solve screen to rescan mid-solve.
 * States are in the scan frame (WHITE on top, GREEN in front); the solver re-orients them.
 *
 * Screen params: { demo?: 1 } starts the demo camera straight away (a pretend cube, no camera needed);
 * { manual?: 1 } opens manual entry straight away.
 * Classic script; nothing touches the DOM at load time.
 */
(function (root) {
  'use strict';

  function CC() { return root.CC || {}; }
  var STYLE_ID = 'cc-style-scan';
  var COLOURS = ['W', 'Y', 'G', 'B', 'R', 'O'];
  var NAMES = { W: 'WHITE', Y: 'YELLOW', G: 'GREEN', B: 'BLUE', R: 'RED', O: 'ORANGE' };
  var TURN_MS = 800;           // demo camera: how long "the learner" takes to turn to the next face
  var ANYWAY_MS = 6000;        // "Capture anyway" stays armed this long

  // How the cube is held for each scan step, as whole-cube rotations of the scan frame (white top,
  // green front): the step's colour ends up in front and its "on top" colour on top. TURN[i] is the
  // turn from step i-1 to step i (HOLD[i-1] + TURN[i] = HOLD[i]); the mini cube animates it.
  var HOLD = ['', 'y', 'y2', "y'", "x'", 'x'];
  var TURN = ['', 'y', 'y', 'y', "y x'", 'x2'];

  // Camera scanning: the learner faces the camera, so the next face (the cube's right) is on THEIR left.
  var CAMERA_HOW = [
    'Start with WHITE on top and GREEN facing the camera.',
    'Keep WHITE on top. Turn the cube a quarter turn so the face on your left (RED) comes round to the camera.',
    'Keep WHITE on top and turn the same way again: BLUE comes round to the camera.',
    'Same again: ORANGE comes round to the camera.',
    'Turn the same way once more so GREEN faces the camera again, then tip the top of the cube towards the camera: WHITE faces it, BLUE is on top.',
    'Flip the cube over, top over bottom: YELLOW faces the camera, GREEN is on top.'
  ];
  // Typing the colours in: the learner looks at the face themselves, so the next face is on their right.
  var MANUAL_HOW = [
    'Hold the cube with GREEN facing you and WHITE on top.',
    'Keep WHITE on top. Turn the cube a quarter turn to the left, so the RED face (on your right) comes round to face you.',
    'Keep WHITE on top and turn a quarter turn to the left again: BLUE faces you.',
    'Same again, a quarter turn to the left: ORANGE faces you.',
    'Turn to the left once more so GREEN faces you again, then tip the top of the cube towards you: WHITE faces you, BLUE is on top.',
    'Flip the cube over, top over bottom: YELLOW faces you, GREEN is on top.'
  ];
  var CELL_NAMES = ['Top left', 'Top middle', 'Top right', 'Middle left', 'Centre', 'Middle right', 'Bottom left', 'Bottom middle', 'Bottom right'];

  var CSS = [
    '.cc-scan{display:flex;flex-direction:column;gap:var(--space-4);min-width:0}',
    '.cc-scan [hidden]{display:none!important}',
    '.cc-scan__grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:var(--space-5);align-items:start}',
    '.cc-scan--modal .cc-scan__grid{grid-template-columns:minmax(0,1fr);gap:var(--space-3)}',
    '@media (max-width:900px){.cc-scan__grid{grid-template-columns:minmax(0,1fr);gap:var(--space-4)}}',
    '.cc-scan__col{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}',
    '.cc-scan__viewer{position:relative;display:flex;flex-direction:column;gap:var(--space-3);min-width:0}',
    '.cc-scan__cam{position:relative;width:100%;aspect-ratio:4/3;max-height:70vh;border-radius:var(--radius-lg);overflow:hidden;background:#0b0e11;border:1px solid var(--border)}',
    '.cc-scan--modal .cc-scan__cam{max-height:52vh}',
    '@media (max-width:520px){.cc-scan__cam{aspect-ratio:1/1}}',
    '.cc-scan__cam canvas{display:block;width:100%;height:100%;object-fit:cover}',
    '.cc-scan__badge{position:absolute;top:var(--space-2);left:var(--space-2);padding:2px 10px;border-radius:var(--radius-pill);background:rgba(0,0,0,.6);color:#fff;font-size:var(--text-xs);font-weight:600;pointer-events:none}',
    '.cc-scan__switch{position:absolute;top:var(--space-2);right:var(--space-2);z-index:2;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:4px 14px 4px 10px;border-radius:var(--radius-pill);border:1px solid rgba(255,255,255,.4);background:rgba(0,0,0,.6);color:#fff;font:inherit;font-size:var(--text-sm);font-weight:700;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
    '.cc-scan__switch:hover{background:rgba(0,0,0,.75)}',
    '.cc-scan__switch:focus-visible{outline:3px solid #fff;outline-offset:2px}',
    '.cc-scan__switch svg{width:20px;height:20px;flex:none}',
    '.cc-scan__tap{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-2);width:100%;border:0;background:rgba(0,0,0,.6);color:#fff;font:inherit;font-size:1.1rem;font-weight:700;cursor:pointer;touch-action:manipulation}',
    '.cc-scan__tap .icon{width:36px;height:36px}',
    '.cc-scan__msg{display:flex;align-items:center;gap:var(--space-2);min-height:2.6em;padding:var(--space-2) var(--space-3);border-radius:var(--radius);background:var(--surface-2);color:var(--text);font-weight:600}',
    '.cc-scan__msg.is-good{background:var(--success-soft);color:var(--success-text)}',
    '.cc-scan__actions{flex-wrap:nowrap}',
    '.cc-scan__more{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}',
    // compact face chips (phones, the dialog): one row, a finished face is a button that rescans it
    '.cc-scan__steps.is-compact{flex-direction:row;flex-wrap:wrap;gap:6px}',
    '.cc-scan__stepc{display:flex}',
    '.cc-scan__chip{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:44px;min-height:44px;margin:0;padding:5px;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface);color:var(--text);font:inherit}',
    '.cc-scan__chip.is-now{border-color:var(--accent);box-shadow:var(--ring)}',
    '.cc-scan__chip.is-done{background:var(--surface-2)}',
    'button.cc-scan__chip{cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
    'button.cc-scan__chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.cc-scan__chip-redo{position:absolute;top:-6px;right:-6px;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--surface);border:1px solid var(--border-strong);color:var(--text-2)}',
    '.cc-scan__chip-redo .icon{width:12px;height:12px}',
    // camera choice (intro, phones)
    '.cc-scan__facing{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-2);margin:0;padding:0;border:0;min-width:0}',
    '.cc-scan__facing legend{padding:0;margin:0 0 var(--space-2);font-size:var(--text-sm);font-weight:700;color:var(--text)}',
    '.cc-scan__facing label{position:relative;display:flex;flex-direction:column;gap:2px;min-height:44px;padding:var(--space-2) var(--space-3);border-radius:var(--radius);border:1px solid var(--border-strong);background:var(--surface);cursor:pointer;touch-action:manipulation}',
    '.cc-scan__facing input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}',
    '.cc-scan__facing label:has(input:checked){border-color:var(--accent);box-shadow:var(--ring)}',
    '.cc-scan__facing label:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}',
    '.cc-scan__facing strong{font-size:var(--text-sm)}',
    '.cc-scan__facing span{font-size:var(--text-xs);color:var(--text-2)}',
    '.cc-scan__steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}',
    '.cc-scan--modal .cc-scan__steps{flex-direction:row;flex-wrap:wrap}',
    '.cc-scan__step{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2);border-radius:var(--radius);border:1px solid var(--border);background:var(--surface)}',
    '.cc-scan__step.is-now{border-color:var(--accent);box-shadow:var(--ring)}',
    '.cc-scan__step.is-done{background:var(--surface-2)}',
    '.cc-scan__step-text{flex:1 1 auto;min-width:0;font-size:var(--text-sm);color:var(--text-2)}',
    '.cc-scan__step-text strong{color:var(--text)}',
    '.cc-scan--modal .cc-scan__step-text{display:none}',
    '.cc-scan__mini{display:grid;grid-template-columns:repeat(3,9px);gap:1px;padding:2px;border-radius:3px;background:var(--cube-plastic);flex:none}',
    '.cc-scan__mini span{width:9px;height:9px;border-radius:1.5px;background:#5a5d66}',
    '.cc-scan__tip{font-size:var(--text-sm);color:var(--text-2)}',
    '.cc-scan__tip strong{color:var(--text)}',
    '.cc-scan__intro-list .badge{min-width:27px;justify-content:center;flex:none}',
    // "how to hold it" mini cube
    '.cc-scan__hold{display:flex;align-items:flex-start;gap:var(--space-3);min-width:0}',
    '.cc-scan__holdfig{flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;margin:0}',
    '.cc-scan__holdcube{width:112px;height:112px;border-radius:var(--radius);background:var(--stage-bg);border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center}',
    '.cc-scan__holdcube.is-mirrored>*{transform:scaleX(-1)}',
    '.cc-scan__holdsvg{width:92px;height:92px}',
    '.cc-scan__holdsvg svg{display:block;width:100%;height:100%}',
    '.cc-scan__holdfig figcaption{font-size:var(--text-xs);color:var(--text-3);font-weight:600}',
    '.cc-scan__holdtext{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:var(--space-2)}',
    '@media (max-width:420px){.cc-scan__holdcube{width:92px;height:92px}.cc-scan__holdsvg{width:76px;height:76px}}',
    // manual entry
    '.cc-scan__manual{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-5);align-items:start}',
    '.cc-scan--modal .cc-scan__manual{grid-template-columns:minmax(0,1fr)}',
    '@media (max-width:900px){.cc-scan__manual{grid-template-columns:minmax(0,1fr)}}',
    '.cc-scan__face{--cc-face-s:60px;display:grid;grid-template-columns:repeat(3,var(--cc-face-s));gap:6px;padding:8px;width:max-content;max-width:100%;background:var(--cube-plastic);border-radius:var(--radius)}',
    '@media (max-width:420px){.cc-scan__face{--cc-face-s:54px}}',
    '.cc-scan__cell{box-sizing:border-box;width:var(--cc-face-s);height:var(--cc-face-s);margin:0;padding:0;border:0;border-radius:9px;background:repeating-linear-gradient(45deg,#5a5d66 0 5px,#6f727c 5px 10px);color:rgba(255,255,255,.92);font:700 var(--text-sm)/1 var(--font);cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.cc-scan__cell:disabled{cursor:default}',
    '.cc-scan__cell.is-cursor{box-shadow:0 0 0 3px var(--cube-plastic),0 0 0 6px var(--accent)}',
    '.cc-scan__cell:focus-visible{outline:3px solid var(--accent);outline-offset:3px}',
    '.cc-scan__pills{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0}',
    '.cc-scan__pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px 2px 4px;border-radius:var(--radius-pill);border:1px solid var(--border);background:var(--surface);font-size:var(--text-xs);font-weight:600;color:var(--text-2)}',
    '.cc-scan__pill.is-now{border-color:var(--accent);box-shadow:var(--ring);color:var(--text)}',
    '.cc-scan__pill.is-done{background:var(--surface-2)}',
    // review + palettes
    '.cc-scan__review{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-5);align-items:start}',
    '.cc-scan--modal .cc-scan__review{grid-template-columns:minmax(0,1fr)}',
    '@media (max-width:900px){.cc-scan__review{grid-template-columns:minmax(0,1fr)}}',
    '.cc-scan__net{display:flex;justify-content:center;padding:var(--space-3);border-radius:var(--radius-lg);background:var(--stage-bg);border:1px solid var(--border);overflow-x:auto}',
    '.cc-scan__palette{display:flex;flex-wrap:wrap;gap:var(--space-2)}',
    '.cc-scan__swatch{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:4px 12px 4px 6px;border-radius:var(--radius-pill);border:1px solid var(--border-strong);background:var(--surface);color:var(--text);font:inherit;font-size:var(--text-sm);font-weight:600;cursor:pointer}',
    '.cc-scan__swatch:hover:not(:disabled){border-color:var(--accent)}',
    '.cc-scan__swatch[aria-pressed="true"]{border-color:var(--accent);box-shadow:var(--ring)}',
    '.cc-scan__swatch:disabled{opacity:.45;cursor:not-allowed}',
    '.cc-scan__swatch:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.cc-scan__swatch .colour-dot{width:26px;height:26px;border-radius:50%}',
    '.cc-scan__count{font-size:var(--text-xs);font-weight:600;color:var(--text-3);font-variant-numeric:tabular-nums}',
    '.cc-scan__count.is-over{color:var(--danger-text)}',
    '.cc-scan__faces{display:flex;flex-wrap:wrap;gap:var(--space-2)}',
    '.cc-scan__steps-howto{margin:0;padding-left:1.3em;display:flex;flex-direction:column;gap:4px}',
    '.cc-scan__select{max-width:100%}',
    '.cc-scan__permission{display:flex;flex-direction:column;gap:var(--space-3)}',
    // ---- phones, portrait (390×844 is the main target): one column, camera and Capture on one screen
    '@media (max-width:720px){',
    '  .cc-scan button,.cc-scan select,.cc-scan label{touch-action:manipulation}',
    '  .cc-scan__grid{display:flex;flex-direction:column;align-items:stretch;gap:10px}',
    '  .cc-scan__col{display:contents}',
    '  .cc-scan__steps{order:1}',
    '  .cc-scan__steps.is-compact{flex-wrap:nowrap;justify-content:space-between}',
    '  .cc-scan__viewer{order:2}',
    '  .cc-scan__hold{order:3}',
    '  .cc-scan__actions{order:4}',
    '  .cc-scan__more{order:5}',
    // full width, square, but never so tall that the Capture button drops below the screen
    '  .cc-scan__cam{aspect-ratio:1/1;max-height:max(240px,calc(100vh - 390px - env(safe-area-inset-bottom,0px)));max-height:max(240px,calc(100svh - 390px - env(safe-area-inset-bottom,0px)))}',
    '  .cc-scan--modal .cc-scan__cam{max-height:52vh;max-height:min(52vh,max(240px,calc(100svh - 330px)))}',
    '  .cc-scan__holdcube{width:84px;height:84px}',
    '  .cc-scan__holdsvg{width:70px;height:70px}',
    '  .cc-scan__holdfig figcaption{display:none}',
    '  .cc-scan__hold{gap:var(--space-3);align-items:center}',
    '  .cc-scan__holdtext{gap:4px}',
    '  .cc-scan__holdtext h2{font-size:1.05rem}',
    '  .cc-scan__say{display:none}',
    '  .cc-scan__actions .btn-primary{flex:1 1 auto}',
    '  .cc-scan__intro .cc-scan__lead{order:-3}',
    '  .cc-scan__intro .cc-scan__go{order:-1}',
    '  .cc-scan__intro .cc-scan__facing{order:-2}',
    '  .cc-scan__intro .cc-scan__go .btn-primary{flex:1 1 100%;--btn-h:52px;font-size:1.05rem}',
    // review: what it says and the button to go on come before the long explanation and the face list
    '  .cc-scan__review{display:flex;flex-direction:column;align-items:stretch;gap:var(--space-3)}',
    '  .cc-scan__review>.cc-scan__col{display:contents}',
    '  .cc-scan__rv-head{order:1}',
    '  .cc-scan__rv-status{order:2}',
    '  .cc-scan__rv-net{order:3}',
    '  .cc-scan__rv-hint{order:4}',
    '  .cc-scan__rv-palette{order:5}',
    '  .cc-scan__rv-go{order:6}',
    '  .cc-scan__rv-go .btn-lg{flex:1 1 auto}',
    '  .cc-scan__rv-about{order:7}',
    '  .cc-scan__rv-rest{order:8}',
    '}',
    '@media (max-width:720px){.cc-scan-screen.is-live .page-head,.cc-scan-screen.is-busy .page-head{display:none}}',
    // ---- both phone layouts: the message sits on the bottom edge of the picture, below the guide square
    '@media (max-width:720px),(orientation:landscape) and (max-height:520px){',
    '  .cc-scan__viewer .cc-scan__msg{position:absolute;left:8px;right:8px;bottom:8px;z-index:1;min-height:0;padding:5px 10px;font-size:13px;line-height:1.3;background:rgba(0,0,0,.68);color:#fff;pointer-events:none}',
    '  .cc-scan__viewer .cc-scan__msg.is-good{background:rgba(21,128,61,.9);color:#fff}',
    '  .cc-scan__viewer .progress{position:absolute;left:1px;right:1px;bottom:1px;z-index:1;height:5px;border-radius:0 0 var(--radius-lg) var(--radius-lg);background:transparent;overflow:hidden}',
    '}',
    // ---- phones held sideways: camera on the left, everything else beside it
    '@media (orientation:landscape) and (max-height:520px){',
    '  .cc-scan__grid{grid-template-columns:minmax(0,46%) minmax(0,1fr);gap:var(--space-4)}',
    '  .cc-scan__cam{aspect-ratio:auto;height:calc(100vh - 150px);height:calc(100svh - 150px);min-height:200px;max-height:none}',
    '  .cc-scan__steps.is-compact{flex-wrap:nowrap}',
    '  .cc-scan-screen.is-live .page-head{display:none}',
    '}'
  ].join('\n');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function settings() {
    var App = CC().App;
    var d = null;
    try { d = App && App.data; } catch (e) { d = null; }
    return (d && d.settings) || {};
  }
  function save() { var App = CC().App; if (App && App.save) App.save(); }
  function isControl(t) { return !!(t && t.closest && t.closest('button, a[href], input, select, textarea, [role="button"]')); }
  function cap1(name) { return name.charAt(0) + name.slice(1).toLowerCase(); }
  function media(q) { try { return !!(root.matchMedia && root.matchMedia(q).matches); } catch (e) { return false; } }
  // the one-column phone layout (portrait phone, or a phone held sideways)
  function phoneLayout() { return media('(max-width: 720px)') || media('(orientation: landscape) and (max-height: 520px)'); }
  function device() {
    var S = CC().Scanner;
    return S && S.deviceInfo ? S.deviceInfo() : { phone: false, tablet: false, ios: false, android: false, touch: false };
  }
  function validFacing(f) { return f === 'user' || f === 'environment' ? f : null; }
  // the camera to use: the learner's last choice, else the rear camera on a phone and the front one elsewhere
  function prefFacing() {
    var S = CC().Scanner;
    return validFacing(settings().cameraFacing) || (S && S.defaultFacing ? S.defaultFacing() : 'user');
  }
  function facingName(f) { return f === 'environment' ? 'back camera' : 'front camera'; }
  // a camera with turning arrows (the "switch camera" sign)
  function switchIcon() {
    var h = CC().UI.h;
    var svg = h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' });
    ['M3 8.5A2 2 0 0 1 5 6.5h2.2l1.6-2.5h6.4l1.6 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
      'M15.5 11.5a3.6 3.6 0 0 0-6.4-.9', 'M9 9.2v1.6h1.6', 'M8.5 14.5a3.6 3.6 0 0 0 6.4.9', 'M15 16.8v-1.6h-1.6'
    ].forEach(function (d) { svg.appendChild(h('path', { d: d })); });
    return svg;
  }

  // ================================================================ "how to hold it" mini cube
  // A small non-interactive 3D cube (an SVG drawing when WebGL is missing) showing which face points at
  // the camera (or at you) and which colour is on top; it animates the turn from one face to the next.
  function holdCube(o) {
    o = o || {};
    var C = CC(), h = C.UI.h, Cube = C.Cube, V = C.View3D;
    var box = h('div', { class: ['cc-scan__holdcube', o.mirrored ? 'is-mirrored' : null] });
    var fig = h('figure', { class: 'cc-scan__holdfig' }, box, h('figcaption', null, o.caption || 'How to hold it'));
    var view = null, svgHost = null, key = '', step = -1, disposed = false;

    function ensure() {         // created lazily, once the figure is in the page (View3D measures its box)
      if (view || svgHost || disposed) return;
      var ok = false;
      try { ok = !!(root.THREE && V && V.supported && V.supported()); } catch (e) { ok = false; }
      if (ok) {
        try { view = V.create(box, { interactive: false, label: o.label || 'How to hold the cube' }); } catch (e) { view = null; }
        if (view && view.fallback) { view.dispose(); view = null; }
      }
      if (!view) { svgHost = h('div', { class: 'cc-scan__holdsvg', role: 'img', 'aria-label': o.label || 'How to hold the cube' }); box.appendChild(svgHost); }
    }

    // Isometric drawing of the U, F and R faces (CC.Cube points: sticker centres at 0/±2, faces at ±3).
    function drawIso(st) {
      var P = function (p) { return ((p[0] - p[2]) * 0.866).toFixed(3) + ',' + ((p[0] + p[2]) * 0.5 - p[1]).toFixed(3); };
      var svg = h('svg', { viewBox: '-5.6 -6.3 11.2 12.6', 'aria-hidden': 'true', focusable: 'false' });
      [[0, 1, 0], [0, 0, 1], [1, 0, 0]].forEach(function (n) {
        var k = n.indexOf(1), a = [0, 0, 0], b = [0, 0, 0];
        a[(k + 1) % 3] = 1; b[(k + 2) % 3] = 1;
        var corner = function (c, sa, sb, r) { return [c[0] + sa * r * a[0] + sb * r * b[0], c[1] + sa * r * a[1] + sb * r * b[1], c[2] + sa * r * a[2] + sb * r * b[2]]; };
        var mid = [3 * n[0], 3 * n[1], 3 * n[2]];
        svg.appendChild(h('polygon', { points: [corner(mid, -1, -1, 3), corner(mid, 1, -1, 3), corner(mid, 1, 1, 3), corner(mid, -1, 1, 3)].map(P).join(' '), fill: '#14181d', stroke: '#14181d', 'stroke-width': 0.3, 'stroke-linejoin': 'round' }));
        Cube.STICKERS.forEach(function (s) {
          if (s.normal[0] !== n[0] || s.normal[1] !== n[1] || s.normal[2] !== n[2]) return;
          var c = [2 * s.cubie[0] + n[0], 2 * s.cubie[1] + n[1], 2 * s.cubie[2] + n[2]];
          svg.appendChild(h('polygon', {
            points: [corner(c, -1, -1, 0.86), corner(c, 1, -1, 0.86), corner(c, 1, 1, 0.86), corner(c, -1, 1, 0.86)].map(P).join(' '),
            fill: Cube.COLOR_HEX[st[s.index]] || '#6b6e78', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 0.06
          }));
        });
      });
      C.UI.empty(svgHost);
      svgHost.appendChild(svg);
    }

    // show(step, base): base is the cube in the scan frame ('?' for stickers not known yet)
    function show(s, base, animate) {
      if (disposed || !Cube || !(s >= 0 && s < 6) || !base) return;
      ensure();
      var k = s + ':' + base.join('');
      if (k === key) return;
      var turn = !!animate && s === step + 1 && !!TURN[s] && !(C.UI.reducedMotion && C.UI.reducedMotion());
      var from = step >= 0 && step < 6 ? Cube.applyAlg(base, HOLD[step]) : null;
      var target = Cube.applyAlg(base, HOLD[s]);
      key = k; step = s;
      if (view) {
        if (turn && from) { view.setState(from); view.play(TURN[s], { speed: 0.55 }); } else view.setState(target);
      } else drawIso(target);
    }

    return {
      el: fig,
      show: show,
      reset: function () { key = ''; step = -1; },
      setMirror: function (b) { box.classList.toggle('is-mirrored', !!b); },
      state: function () { return view ? view.finalState() : null; },     // for tests: the cube as shown
      is3D: function () { return !!view; },
      dispose: function () { disposed = true; if (view) { view.dispose(); view = null; } }
    };
  }

  // ================================================================ the widget
  function mount(container, opts) {
    opts = opts || {};
    injectStyle();
    var C = CC(), UI = C.UI, h = UI.h, App = C.App, Scanner = C.Scanner, Cube = C.Cube;
    var purpose = opts.purpose === 'rescan' ? 'rescan' : 'start';
    var inModal = !!opts.inModal;
    var destroyed = false, finished = false;
    var phase = 'intro';
    var ctl = null, fake = null, demo = false, camStarted = false, cameras = [];
    var timers = [];
    var captured = [null, null, null, null, null, null];
    var result = null, edited = null, selected = -1, net = null, checked = {};
    var lastMsg = '', lastStepKey = '', retriedDefault = false, anywayUntil = 0;
    var demoTruth = null;        // the cube the demo camera is showing (for tests and debugging)
    var manual = null;           // { state:[54], step, cursor } while typing the colours in
    var ORDER = Scanner ? Scanner.SCAN_ORDER : [];
    var canDemo = purpose === 'start' || !!opts.demoState;
    var dev = device();
    var demoFacing = prefFacing();   // the demo camera pretends to be this camera
    var camState = 'idle', curStep = 0, shownFacing = null, lastCompact = null, awakeOn = false;

    function later(fn, ms) {
      var id = setTimeout(function () { timers.splice(timers.indexOf(id), 1); if (!destroyed) fn(); }, ms || 0);
      timers.push(id);
      return id;
    }
    function active() { if (App && App.markActive) App.markActive(); }
    function stepLabel(i) { var e = ORDER[i]; return e ? NAMES[e.center] + ' centre, ' + NAMES[e.up] + ' on top' : ''; }
    function faceIndex(step) { return Cube.FACES.indexOf(ORDER[step].face); }
    function toast(text, o) { if (App && App.toast) App.toast(text, o); }

    var rootEl = h('div', { class: ['cc-scan', inModal ? 'cc-scan--modal' : null] });
    var live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
    var introEl = h('section', { class: 'stack', 'aria-label': 'Before you scan' });
    var scanEl = h('section', { class: 'stack', hidden: true, 'aria-label': 'Scanning' });
    var manualEl = h('section', { class: 'stack', hidden: true, 'aria-label': 'Type the colours in' });
    var reviewEl = h('section', { class: 'stack', hidden: true, 'aria-label': 'Check the scan' });
    var errorEl = h('section', { class: 'stack', hidden: true, 'aria-label': 'Camera problem' });
    [live, introEl, scanEl, manualEl, reviewEl, errorEl].forEach(function (el) { rootEl.appendChild(el); });
    container.appendChild(rootEl);

    function say(text) { live.textContent = ''; later(function () { live.textContent = text; }, 30); }

    function show(name, noFocus) {
      phase = name;
      if (typeof opts.onPhase === 'function') { try { opts.onPhase(name); } catch (e) { /* ignore */ } }
      introEl.hidden = name !== 'intro';
      scanEl.hidden = name !== 'scanning';
      manualEl.hidden = name !== 'manual';
      reviewEl.hidden = name !== 'review';
      errorEl.hidden = name !== 'error';
      var sec = { intro: introEl, scanning: scanEl, manual: manualEl, review: reviewEl, error: errorEl }[name];
      var head = sec && sec.querySelector('[data-focus-head]');
      if (head && !noFocus) { try { head.focus({ preventScroll: inModal }); } catch (e) { /* ignore */ } }
    }

    function cancel() { if (!finished && typeof opts.onCancel === 'function') opts.onCancel(); }
    // keep the screen on while the camera runs (not in the dialog: the solve screen behind it owns that)
    function awake(on) {
      on = !!on;
      if (inModal || on === awakeOn || !App || typeof App.keepAwake !== 'function') return;
      awakeOn = on;
      try { App.keepAwake(on); } catch (e) { /* ignore */ }
    }
    // which way the camera in use faces ('environment' = a phone's rear camera)
    function activeFacing() {
      if (demo) return demoFacing;
      if (ctl && camStarted && ctl.getFacing) return ctl.getFacing();
      return prefFacing();
    }
    function isRear() { return activeFacing() === 'environment'; }
    function sayFor(e) { return e ? (isRear() ? e.point || e.say : e.say) : ''; }
    function howFor(i, rear) { return rear ? (ORDER[i].tipRear || MANUAL_HOW[i]) : CAMERA_HOW[i]; }
    function virtualInstead() { finished = true; stopAll(); if (App) App.go('solve', { device: 'virtual', source: 'scramble' }); }

    // the cube as far as it is known, in the scan frame ('?' = not seen yet; centres are always known)
    function knownState() {
      var st = [];
      for (var i = 0; i < 54; i++) st.push('?');
      ORDER.forEach(function (e, s) {
        var f = faceIndex(s);
        st[f * 9 + 4] = e.center;
        if (captured[s]) for (var k = 0; k < 9; k++) st[f * 9 + k] = captured[s][k];
      });
      return st;
    }

    function altButtons(o) {
      o = o || {};
      return [
        o.demo && canDemo ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { startCamera(true); } }, UI.icon('play', 18), 'Try the demo camera') : null,
        o.manual ? h('button', { type: 'button', class: ['btn', o.manualPrimary ? 'btn-secondary' : 'btn-ghost'], onClick: function () { startManual(0, 'fresh'); } }, UI.icon('hand', 18), 'Type the colours in') : null,
        o.virtual && purpose === 'start' ? h('button', { type: 'button', class: 'btn btn-ghost', onClick: virtualInstead }, UI.icon('cube', 18), 'Use the virtual cube instead') : null
      ];
    }

    // ---------------------------------------------------------------- intro
    function renderIntro() {
      UI.empty(introEl);
      if (!Scanner || !Cube) {
        introEl.appendChild(UI.callout('danger', 'The scanner didn’t load',
          'Reload the page to try again. Meanwhile you can practise on the on-screen cube.'));
        introEl.appendChild(h('div', { class: 'row' },
          purpose === 'start' ? h('button', { type: 'button', class: 'btn btn-primary', onClick: virtualInstead }, UI.icon('cube', 18), 'Use the virtual cube') : null,
          inModal ? null : h('button', { type: 'button', class: 'btn btn-secondary', onClick: cancel }, 'Back')));
        return;
      }
      var sup = Scanner.isSupported();
      var rear = prefFacing() === 'environment';
      // phones and tablets have a camera on each side: let the learner pick before starting
      var choose = dev.phone || dev.tablet;
      function pick(f) { settings().cameraFacing = f; save(); demoFacing = f; renderIntro(); var r = introEl.querySelector('input[value="' + f + '"]'); if (r) r.focus(); }
      function choice(f, title, sub) {
        return h('label', null,
          h('input', { type: 'radio', name: 'cc-scan-facing', value: f, checked: prefFacing() === f, onChange: function () { pick(f); } }),
          h('strong', null, title), h('span', null, sub));
      }
      introEl.appendChild(h('div', { class: 'scan-intro stack cc-scan__intro' },
        h('h2', { class: 'h3 m-0 cc-scan__lead', tabindex: '-1', 'data-focus-head': '' }, purpose === 'rescan' ? 'Show me your cube' : 'Six faces, about a minute'),
        h('p', { class: 'm-0 muted cc-scan__lead' }, purpose === 'rescan'
          ? (rear ? 'Point the camera at one face at a time, just like the first scan. Don’t turn any layers while you scan.'
            : 'Hold it up to the camera one face at a time, just like the first scan. Don’t turn any layers while you scan.')
          : (rear ? 'Point the camera at each face so it fills the square. The coach reads the colours, then guides your solve.'
            : 'Hold each face up to the camera so it fills the square. The coach reads the colours, then guides your solve.')),
        choose && sup.ok ? h('fieldset', { class: 'cc-scan__facing' },
          h('legend', null, 'Which camera?'),
          choice('environment', 'Back camera', 'Point the phone at the cube'),
          choice('user', 'Front camera', 'Hold the cube up to the screen')) : null,
        h('ol', { class: 'list-plain stack stack-sm cc-scan__intro-list' }, ORDER.map(function (e, i) {
          return h('li', { class: 'row row-nowrap row-top' },
            h('span', { class: 'badge' }, String(i + 1)), UI.colourDot(e.center, { size: 'lg' }),
            h('span', { class: 'small' }, h('strong', null, stepLabel(i) + '.'), ' ', howFor(i, rear)));
        })),
        UI.callout('tip', 'For a clean read', rear
          ? 'Use even light, keep your fingers off the stickers, and hold the phone about a hand-span (20 cm) from the cube. Hold still for a moment on each face.'
          : 'Use even light (face a window or a lamp), keep your fingers off the stickers, and hold still for a moment on each face.'),
        sup.ok ? null : UI.callout('warn', 'The camera can’t start here', sup.reason),
        h('div', { class: 'row cc-scan__go' },
          h('button', { type: 'button', class: 'btn btn-primary', disabled: !sup.ok, onClick: function () { startCamera(false); } }, UI.icon('camera', 18), 'Start camera'),
          altButtons({ demo: true, manual: true, manualPrimary: !sup.ok, virtual: true })),
        h('p', { class: 'xsmall subtle m-0' }, canDemo
          ? 'The demo camera shows a pretend cube being scanned, so you can see how it works. No camera? Type the colours in, face by face.'
          : 'No camera? Type the colours in, face by face.'),
        purpose === 'start' ? h('p', { class: 'xsmall subtle m-0' }, 'Private by design: the picture is read right here in your browser. Nothing is saved or sent anywhere.') : null));
    }

    // ---------------------------------------------------------------- scanning
    var canvas = h('canvas', { width: 640, height: 480, 'aria-label': 'Camera preview with a 3 by 3 guide square' });
    var camBadge = h('span', { class: 'cc-scan__badge', hidden: true }, 'Demo camera');
    var msgEl = h('p', { class: 'cc-scan__msg m-0', role: 'status' }, 'Starting the camera…');
    var bar = h('div', { class: 'progress__bar', style: { width: '0%' } });
    var progress = h('div', { class: 'progress progress-sm', 'aria-hidden': 'true' }, bar);
    var stepsEl = h('ol', { class: 'cc-scan__steps', 'aria-label': 'Faces' });
    var stepHead = h('h2', { class: 'h3 m-0', tabindex: '-1', 'data-focus-head': '' }, 'Face 1 of 6');
    var tipEl = h('p', { class: 'cc-scan__tip m-0' });
    var captureLabel = h('span', null, 'Capture this face');
    var captureBtn = h('button', { type: 'button', class: ['btn', 'btn-primary', phoneLayout() ? 'btn-lg' : null], onClick: function () { captureNow(); } }, UI.icon('camera', 18), captureLabel);
    var autoInput = h('input', { type: 'checkbox', checked: settings().autoCapture !== false, onChange: function () {
      settings().autoCapture = autoInput.checked; save();
      if (ctl) ctl.setAutoCapture(autoInput.checked);
      updateCaptureHint();
    } });
    var mirrorInput = h('input', { type: 'checkbox', checked: settings().mirror !== false, onChange: function () {
      settings().mirror = mirrorInput.checked; save();
      applyFacing();
    } });
    var camSelect = h('select', { class: 'select select-inline cc-scan__select', 'aria-label': 'Camera', onChange: function () {
      var v = camSelect.value || null;
      var opt = camSelect.options[camSelect.selectedIndex];
      var label = v && opt ? opt.textContent : null;
      settings().cameraId = v;
      settings().cameraLabel = label;
      // remember which way it faces too, so the instructions and the mirroring follow it
      var f = Scanner.guessFacing ? Scanner.guessFacing(null, label, prefFacing()) : prefFacing();
      if (label && /back|rear|front|facetime|user|environment/i.test(label)) settings().cameraFacing = f;
      save();
      if (ctl && !demo) restartCamera(v || undefined, f);
    } });
    var camRow = h('label', { class: 'row row-sm', hidden: true }, h('span', { class: 'small' }, 'Camera'), camSelect);
    var captureHint = h('p', { class: 'xsmall subtle m-0' });
    var scanHold = holdCube({ mirrored: false, label: 'How to hold the cube for this face' });
    var switchLabel = h('span', null, 'Switch camera');
    var switchBtn = h('button', { type: 'button', class: 'cc-scan__switch', hidden: true, onClick: function () { switchCamera(); } }, switchIcon(), switchLabel);
    var tapBtn = h('button', { type: 'button', class: 'cc-scan__tap', hidden: true, onClick: function () { resumeCamera(); } },
      UI.icon('camera', 36), h('span', null, 'Tap to start the camera'));

    function toggle(input, label) {
      return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle__track', 'aria-hidden': 'true' }), h('span', { class: 'toggle__label small' }, label));
    }
    var mirrorToggle = toggle(mirrorInput, 'Mirror (selfie view)');

    scanEl.appendChild(h('div', { class: 'cc-scan__grid' },
      h('div', { class: 'cc-scan__col' },
        h('div', { class: 'cc-scan__viewer' },
          h('div', { class: 'cc-scan__cam' }, canvas, camBadge, switchBtn, tapBtn),
          msgEl, progress)),
      h('div', { class: 'cc-scan__col' },
        h('div', { class: 'cc-scan__hold' }, scanHold.el, h('div', { class: 'cc-scan__holdtext' }, stepHead, tipEl)),
        stepsEl,
        h('div', { class: 'row cc-scan__actions' }, captureBtn,
          inModal ? null : h('button', { type: 'button', class: 'btn btn-ghost', onClick: stopAndReset }, 'Stop')),
        h('div', { class: 'cc-scan__more' },
          captureHint,
          h('div', { class: 'row row-lg' }, toggle(autoInput, 'Auto-capture'), mirrorToggle),
          camRow,
          h('p', { class: 'xsmall subtle m-0' }, 'Camera struggling with a face? ',
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: function () { startManual(firstMissingStep(), 'scan'); } }, 'Type the colours in instead'))))));

    function updateCaptureHint() {
      if (anywayUntil > Date.now()) return;
      var touch = dev.phone || dev.tablet;
      captureHint.textContent = autoInput.checked
        ? (touch ? 'Each face is captured by itself once you hold it steady. Or tap Capture to take it now.'
          : 'Each face is captured by itself once you hold it steady. Press Space (or the button) to capture it now.')
        : (touch ? 'Hold the face steady, then tap Capture.' : 'Hold the face steady, then press Space or the button.');
    }
    updateCaptureHint();

    function setAnyway(on) {
      anywayUntil = on ? Date.now() + ANYWAY_MS : 0;
      captureLabel.textContent = on ? 'Capture anyway' : 'Capture this face';
      if (!on) updateCaptureHint();
    }

    function firstMissingStep() { for (var i = 0; i < 6; i++) if (!captured[i]) return i; return 0; }

    function compactSteps() { return inModal || phoneLayout(); }

    function renderSteps(step) {
      UI.empty(stepsEl);
      curStep = step;
      var compact = compactSteps();
      lastCompact = compact;
      stepsEl.classList.toggle('is-compact', compact);
      ORDER.forEach(function (e, i) {
        var done = !!captured[i], now = i === step;
        var mini = h('span', { class: 'cc-scan__mini', 'aria-hidden': 'true' });
        for (var k = 0; k < 9; k++) {
          var l = done ? captured[i][k] : (k === 4 ? e.center : null);
          mini.appendChild(h('span', { style: l && Cube.COLOR_HEX[l] ? { background: Cube.COLOR_HEX[l] } : null }));
        }
        if (compact) {
          // one small chip per face; a finished face is a button that scans it again
          var cls = ['cc-scan__chip', done ? 'is-done' : null, now ? 'is-now' : null];
          stepsEl.appendChild(h('li', { class: 'cc-scan__stepc', 'aria-current': now ? 'step' : null },
            done && phase === 'scanning'
              ? h('button', { type: 'button', class: cls, 'aria-label': 'Redo the ' + NAMES[e.center] + ' face (face ' + (i + 1) + ' of 6, done)', onClick: function () { redo(i); } },
                mini, h('span', { class: 'cc-scan__chip-redo', 'aria-hidden': 'true' }, UI.icon('refresh', 12)))
              : h('span', { class: cls }, mini, h('span', { class: 'sr-only' }, (i + 1) + '. ' + stepLabel(i) + (done ? ': done' : now ? ': now' : '')))));
          return;
        }
        stepsEl.appendChild(h('li', { class: ['cc-scan__step', done ? 'is-done' : null, now ? 'is-now' : null], 'aria-current': now ? 'step' : null },
          mini,
          h('span', { class: 'cc-scan__step-text', 'aria-hidden': 'true' }, h('strong', null, (i + 1) + '. ' + NAMES[e.center]), ' — ', done ? 'done' : now ? 'now' : 'next'),
          h('span', { class: 'sr-only' }, (i + 1) + '. ' + stepLabel(i) + (done ? ': done' : now ? ': now' : '')),
          done && phase === 'scanning' ? h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Redo the ' + NAMES[e.center] + ' face',
            onClick: function () { redo(i); }
          }, UI.icon('refresh', 14), inModal ? null : 'Redo') : null));
      });
    }

    function updateStepText(step, animate) {
      curStep = step;
      shownFacing = activeFacing();
      if (step >= 6 || !ORDER[step]) { stepHead.textContent = 'All six faces done'; tipEl.textContent = ''; return; }
      stepHead.textContent = 'Face ' + (step + 1) + ' of 6: ' + NAMES[ORDER[step].center];
      UI.empty(tipEl);
      tipEl.appendChild(h('strong', { class: 'cc-scan__say' }, sayFor(ORDER[step]) + '. '));
      tipEl.appendChild(document.createTextNode(howFor(step, shownFacing === 'environment') || ORDER[step].tip || ''));
      scanHold.show(step, knownState(), animate);
    }

    function onFrame(info) {
      if (destroyed || phase !== 'scanning' || !info) return;
      if (camState === 'blocked' || camState === 'paused') return;
      var msg = info.message || '', good = !!info.ready;
      // just captured, waiting for the learner to turn: say so (rather than "you already scanned that face")
      if (info.armed === false && info.step < 6 && info.expected) { msg = 'Got it! Now turn the cube: ' + sayFor(info.expected) + '.'; good = true; }
      if (msg !== lastMsg) {
        lastMsg = msg;
        msgEl.textContent = msg;
        msgEl.classList.toggle('is-good', good);
      }
      bar.style.width = Math.round(100 * (info.ready && info.armed ? info.stability : 0)) + '%';
      var key = info.step + ':' + (info.captured || []).join(',');
      if (key !== lastStepKey) {
        lastStepKey = key;
        renderSteps(info.step);
        updateStepText(info.step, true);
      }
    }

    function onCapture(step, letters) {
      if (destroyed) return;
      active();
      captured[step] = letters ? letters.slice() : null;
      setAnyway(false);
      var next = ctl ? ctl.session.step : 6;
      lastStepKey = '';
      renderSteps(next);
      updateStepText(next, true);
      if (next < 6) say('Got the ' + NAMES[ORDER[step].center] + ' face. Next: ' + sayFor(ORDER[next]) + '.');
      if (demo && fake && next < 6) later(function () { if (fake && ctl && ctl.session.step === next) fake.showFace(next); }, TURN_MS);
    }

    function onComplete(res) {
      if (destroyed) return;
      // the controller calls this from inside its frame loop: stop it on the next tick, not now
      later(function () {
        if (ctl) ctl.stop();
        camStarted = false;
        awake(false);
        setAnyway(false);
        result = res;
        edited = res && res.state ? res.state.slice() : null;
        selected = -1; checked = {};
        say('All six faces scanned. Check the colours.');
        renderReview();
        show('review');
      }, 0);
    }

    function onError(err) {
      if (destroyed) return;
      // a remembered camera that is no longer there: fall back to the default camera once
      // (the controller already tries the camera facing the right way; this catches the rest)
      if (err && err.code === 'notfound' && !demo && settings().cameraId && !retriedDefault) {
        retriedDefault = true;
        settings().cameraId = null; settings().cameraLabel = null; save();
        later(function () { if (ctl) ctl.start(undefined, { facing: prefFacing() }).catch(function () { /* onError again */ }); }, 0);
        return;
      }
      later(function () {
        if (ctl) ctl.stop();
        camStarted = false;
        awake(false);
        renderError(err);
        show('error');
      }, 0);
    }

    // camera states from the controller: live / paused (the app went to the background) / blocked (needs a tap)
    function onCamState(st) {
      if (destroyed) return;
      camState = st;
      tapBtn.hidden = st !== 'blocked' || phase !== 'scanning';
      if (phase !== 'scanning') return;
      if (st === 'live') { awake(true); applyFacing(); lastMsg = ''; }
      else if (st === 'paused') { setMsg('Camera paused. It starts again when you come back to Cube Coach.'); }
      else if (st === 'blocked') { setMsg('Tap the picture to start the camera.'); }
      else if (st === 'starting' && !/^Switching/.test(lastMsg)) { setMsg(demo ? 'Starting the demo camera…' : 'Starting the camera… If your browser asks, choose Allow.'); }
    }
    function setMsg(text, good) {
      lastMsg = text;
      msgEl.textContent = text;
      msgEl.classList.toggle('is-good', !!good);
    }

    function resumeCamera() {
      if (!ctl || destroyed) return;
      active();
      tapBtn.hidden = true;
      setMsg('Starting the camera…');
      ctl.resume().then(function () { if (!destroyed && !demo) camStarted = true; }, function () { /* reported through onError */ });
    }

    // the preview's mirroring, the instructions and the controls follow the camera in use
    function applyFacing() {
      if (destroyed) return;
      var f = activeFacing(), rear = f === 'environment';
      if (ctl) { if (demo) ctl.setFacing(f); ctl.setMirror(mirrorInput.checked); }
      var mirrored = ctl && ctl.getMirror ? ctl.getMirror() : (!rear && mirrorInput.checked);
      scanHold.setMirror(mirrored);
      mirrorToggle.hidden = rear;             // a rear camera's picture already matches what you see
      switchBtn.hidden = !canSwitch();
      switchBtn.setAttribute('aria-label', 'Switch camera (now using the ' + facingName(f) + ')');
      switchBtn.title = 'Now using the ' + facingName(f);
      if (phase === 'scanning' && shownFacing !== f) { updateStepText(curStep, false); lastMsg = ''; }
    }
    // phones and tablets switch front <-> rear; a computer only when it has more than one camera
    function canSwitch() {
      if (demo) return dev.phone || dev.tablet;
      return dev.phone || dev.tablet || cameras.length >= 2;
    }

    function restartCamera(deviceId, facing) {
      if (!ctl) return;
      camStarted = false;
      setMsg('Switching to the ' + facingName(facing) + '…');
      var before = ctl.getDeviceId ? ctl.getDeviceId() : null;
      return ctl.start(deviceId, { facing: facing }).then(function () {
        if (destroyed) return;
        camStarted = true;
        if (!deviceId && before && ctl.getDeviceId && ctl.getDeviceId() === before) toast('This device has only one camera.');
        applyFacing();
        fillCameras();
      }, function () { /* reported through onError */ });
    }

    function switchCamera() {
      if (!ctl || destroyed || phase !== 'scanning') return;
      active();
      var next = activeFacing() === 'environment' ? 'user' : 'environment';
      if (demo) {
        demoFacing = next;
        settings().cameraFacing = next; save();
        if (fake && fake.set) fake.set({ scene: next === 'environment' ? 'rear' : 'selfie' });
        applyFacing();
        say('Now using the ' + facingName(next) + '. ' + sayFor(ORDER[curStep]) + '.');
        return;
      }
      if (dev.phone || dev.tablet || cameras.length < 2) {
        settings().cameraFacing = next; settings().cameraId = null; settings().cameraLabel = null; save();
        restartCamera(undefined, next);
      } else {
        // a computer with several cameras: the next one in the list
        var ids = cameras.map(function (c) { return c.deviceId; });
        var cam = cameras[(ids.indexOf(ctl.getDeviceId()) + 1) % cameras.length];
        var f = Scanner.guessFacing ? Scanner.guessFacing(null, cam.label, 'user') : 'user';
        settings().cameraId = cam.deviceId; settings().cameraLabel = cam.label; settings().cameraFacing = f; save();
        restartCamera(cam.deviceId, f);
      }
    }

    function ensureController() {
      if (ctl) return ctl;
      ctl = Scanner.createController({
        canvas: canvas, mirror: mirrorInput.checked, autoCapture: autoInput.checked, facing: prefFacing(), statusText: false,
        hud: !phoneLayout(),            // on a phone the chips and the heading below already say which face
        onFrame: onFrame, onCapture: onCapture, onComplete: onComplete, onError: onError, onState: onCamState
      });
      return ctl;
    }

    function demoCube() {
      if (opts.demoState && opts.demoState.length === 54) demoTruth = opts.demoState.slice();
      else demoTruth = Cube.applyAlg(Cube.solved(), Cube.scramble(25, Math.floor(Math.random() * 1e9)));
      return demoTruth.slice();
    }

    function startCamera(useDemo) {
      if (destroyed || !Scanner) return;
      active();
      // the demo camera fills faces in by itself: never mix it with faces from a real camera (or vice versa)
      if (!!useDemo !== demo && ctl) { ctl.stop(); ctl.reset(); captured = [null, null, null, null, null, null]; }
      if (!useDemo && fake) { try { fake.destroy(); } catch (e) { /* ignore */ } fake = null; }
      demo = !!useDemo;
      retriedDefault = false;
      lastMsg = ''; lastStepKey = '';
      setAnyway(false);
      tapBtn.hidden = true;
      setMsg(demo ? 'Starting the demo camera…' : 'Starting the camera… If your browser asks, choose Allow.');
      bar.style.width = '0%';
      camBadge.hidden = !demo;
      show('scanning');
      if (!inModal && phoneLayout()) { try { root.scrollTo(0, 0); } catch (e) { /* ignore */ } }
      var c = ensureController();
      if (demo) demoFacing = prefFacing();
      c.setFacing(demo ? demoFacing : prefFacing());
      var step = c.session.step < 6 ? c.session.step : 0;
      renderSteps(step);
      scanHold.reset();
      updateStepText(step, false);
      applyFacing();
      var p;
      if (demo) {
        var scene = demoFacing === 'environment' ? 'rear' : 'selfie';
        try {
          if (!fake) {
            // on a phone held upright the pretend camera sends an upright picture, like a real one
            var upright = phoneLayout() && (root.innerHeight || 0) > (root.innerWidth || 0);
            fake = Scanner.createFakeCamera(demoCube(), upright ? { face: step, scene: scene, width: 720, height: 1280 } : { face: step, scene: scene });
          } else { fake.set({ scene: scene }); fake.showFace(step); }
        } catch (e) { onError({ code: 'other', message: 'The demo camera couldn’t start in this browser.' }); return; }
        p = c.useStream(fake.stream, { facing: demoFacing });
      } else {
        p = c.start(settings().cameraId || undefined, { facing: prefFacing() });
      }
      p.then(function () {
        if (destroyed) return;
        camStarted = true;
        applyFacing();
        if (!demo) fillCameras();
      }, function () { /* reported through onError */ });
    }

    function fillCameras() {
      if (!ctl || !ctl.listCameras) return;
      ctl.listCameras().then(function (list) {
        if (destroyed) return;
        cameras = (list || []).filter(function (c) { return c && c.deviceId; });
        UI.empty(camSelect);
        cameras.forEach(function (c, i) { camSelect.appendChild(h('option', { value: c.deviceId }, c.label || 'Camera ' + (i + 1))); });
        var now = ctl && ctl.getDeviceId ? ctl.getDeviceId() : null;
        if (now && cameras.some(function (c) { return c.deviceId === now; })) camSelect.value = now;
        else if (settings().cameraId) camSelect.value = settings().cameraId;
        // a remembered camera that has gone (or got a new id): forget it, the camera facing that way is used
        if (settings().cameraId && now && now !== settings().cameraId) { settings().cameraId = null; settings().cameraLabel = null; save(); }
        camRow.hidden = cameras.length < 2;
        applyFacing();
      }, function () { camRow.hidden = true; });
    }

    function captureNow() {
      if (!ctl || phase !== 'scanning') return;
      active();
      if (!camStarted) { toast('The camera isn’t ready yet.'); return; }
      var info = ctl.getInfo ? ctl.getInfo() : null;
      if (!info) { toast('Nothing to capture yet. Hold a face up to the camera so it fills the square.'); return; }
      // not a clear view of the face the coach expects: ask before using it (a second press captures)
      if (info.ready === false && !(anywayUntil > Date.now())) {
        setAnyway(true);
        captureHint.textContent = (info.message ? info.message + ' ' : '') + 'If the camera has it wrong, press Capture again to use this picture anyway.';
        say(captureHint.textContent);
        later(function () { if (anywayUntil && anywayUntil <= Date.now()) setAnyway(false); }, ANYWAY_MS + 50);
        return;
      }
      setAnyway(false);
      if (!ctl.captureNow()) toast('Nothing to capture yet. Hold a face up to the camera so it fills the square.');
    }

    function redo(step) {
      if (!ctl) return;
      active();
      ctl.redo(step);
      captured[step] = null;
      lastStepKey = '';
      setAnyway(false);
      renderSteps(step);
      scanHold.reset();
      updateStepText(step, false);
      say('Show the ' + NAMES[ORDER[step].center] + ' face again.');
      if (demo && fake) later(function () { if (fake) fake.showFace(step); }, TURN_MS);
    }

    function rescanFace(step) {
      // from the review: restart the camera on that one face; the other five are kept
      if (!ctl) { startCamera(false); return; }
      ctl.redo(step);
      captured[step] = null;
      startCamera(demo);
    }

    function restartAll() {
      if (ctl) { ctl.stop(); ctl.reset(); }
      captured = [null, null, null, null, null, null];
      result = null; edited = null; manual = null;
      if (fake && demo) { try { fake.setState(demoCube()); } catch (e) { /* keep the old cube */ } }
      startCamera(demo);
    }

    // back to the start, forgetting the faces so far
    function stopAndReset() {
      stopAll();
      if (ctl) ctl.reset();
      if (fake) { try { fake.destroy(); } catch (e) { /* ignore */ } fake = null; }
      captured = [null, null, null, null, null, null];
      result = null; edited = null; manual = null;
      renderIntro();
      show('intro');
    }

    // ---------------------------------------------------------------- error
    function renderError(err) {
      UI.empty(errorEl);
      var code = (err && err.code) || 'other';
      var msg = (err && err.message) || 'The camera could not start.';
      var denied = code === 'denied';
      errorEl.appendChild(h('h2', { class: 'h3 m-0', tabindex: '-1', 'data-focus-head': '' },
        denied ? 'Cube Coach isn’t allowed to use the camera' : 'The camera didn’t start'));
      if (denied) {
        var origin = '';
        try { origin = root.location && root.location.origin && root.location.origin !== 'null' ? root.location.origin : ''; } catch (e) { origin = ''; }
        errorEl.appendChild(UI.callout('warn', 'Your browser blocked the camera for this page',
          'That’s easy to fix, and only needed once. Nothing is recorded or sent anywhere.'));
        var phoneHelp = h('div', { class: 'card card-sm stack stack-sm' },
          h('h3', { class: 'small strong m-0' }, 'On iPhone, in Chrome'),
          h('ol', { class: 'small cc-scan__steps-howto' },
            h('li', null, 'Open the iPhone Settings app › Chrome, and switch Camera on. (On iOS 18 and later: Settings › Apps › Chrome › Camera.)'),
            h('li', null, 'Come back to Chrome and press “Try again” below. When Chrome asks to use the camera, tap Allow.'),
            h('li', null, 'Still nothing? Reload the page and try once more.')),
          h('h3', { class: 'small strong m-0 mt-2' }, 'On iPhone, in Safari'),
          h('ol', { class: 'small cc-scan__steps-howto' },
            h('li', null, 'Tap the aA button in the address bar › Website Settings › Camera › Allow.'),
            h('li', null, 'Or open the Settings app › Safari › Camera and choose Ask or Allow. (On iOS 18 and later: Settings › Apps › Safari › Camera.)'),
            h('li', null, 'Press “Try again” below.')));
        var computerHelp = h('div', { class: 'card card-sm stack stack-sm' },
          h('h3', { class: 'small strong m-0' }, dev.phone || dev.tablet ? 'On a computer, in Chrome' : 'In Chrome'),
          h('ol', { class: 'small cc-scan__steps-howto' },
            h('li', null, 'Click the camera icon with a red cross at the right-hand end of the address bar (or the site-settings icon at its left-hand end).'),
            h('li', null, 'Choose “Always allow ' + (origin || 'this site') + ' to access your camera”, then Done.'),
            h('li', null, 'Press “Try again” below. If it still won’t start, reload the page.')),
          h('h3', { class: 'small strong m-0 mt-2' }, 'Still blocked? Check your Mac'),
          h('ol', { class: 'small cc-scan__steps-howto' },
            h('li', null, 'Open the Apple menu > System Settings > Privacy & Security > Camera.'),
            h('li', null, 'Switch on Google Chrome (or the browser you use).'),
            h('li', null, 'Quit the browser completely (Cmd+Q), open it again and come back to Cube Coach.')),
          h('p', { class: 'xsmall subtle m-0' }, 'Using Safari on a Mac? Safari menu > Settings for This Website > Camera > Allow.'));
        // the help for the device in the learner's hand comes first
        errorEl.appendChild(h('div', { class: 'cc-scan__permission' },
          dev.ios || dev.phone ? [phoneHelp, computerHelp] : [computerHelp, phoneHelp]));
      } else {
        errorEl.appendChild(UI.callout('warn', null, msg));
      }
      errorEl.appendChild(h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { startCamera(false); } }, UI.icon('refresh', 18), 'Try again'),
        altButtons({ demo: true, manual: true, manualPrimary: true, virtual: true })));
      errorEl.appendChild(h('p', { class: 'xsmall subtle m-0' }, canDemo
        ? 'No camera today? Type your cube’s colours in instead, or watch the demo camera to see how scanning works.'
        : 'No camera today? Type your cube’s colours in instead.'));
    }

    // ---------------------------------------------------------------- manual entry
    var manualHead = h('h2', { class: 'h3 m-0', tabindex: '-1', 'data-focus-head': '' }, 'Face 1 of 6');
    var manualTip = h('p', { class: 'cc-scan__tip m-0' });
    var manualHold = holdCube({ mirrored: false, label: 'How to hold the cube for this face' });
    var faceGrid = h('div', { class: 'cc-scan__face', role: 'group', 'aria-label': 'The face you are copying' });
    var cells = [];
    for (var ci = 0; ci < 9; ci++) {
      (function (k) {
        var b = h('button', { type: 'button', class: 'cc-scan__cell', onClick: function () { manualCursor(k); } });
        cells.push(b);
        faceGrid.appendChild(b);
      })(ci);
    }
    var manualCounts = {};
    var manualPalette = h('div', { class: 'cc-scan__palette', role: 'group', 'aria-label': 'Colour for the chosen sticker' },
      COLOURS.map(function (c) {
        manualCounts[c] = h('span', { class: 'cc-scan__count' }, '0/9');
        return h('button', { type: 'button', class: 'cc-scan__swatch', title: 'Press ' + c, onClick: function () { manualPaint(c); } },
          UI.colourDot(c), cap1(NAMES[c]), manualCounts[c]);
      }));
    var manualPills = h('ol', { class: 'cc-scan__pills', 'aria-label': 'Faces' });
    var manualBack = h('button', { type: 'button', class: 'btn btn-ghost', onClick: function () { manualPrev(); } }, UI.icon('arrowLeft', 18), 'Back');
    var manualNextLabel = h('span', null, 'Next face');
    var manualNextBtn = h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { manualNext(); } }, manualNextLabel, UI.icon('arrowRight', 18));
    var manualStatus = h('p', { class: 'xsmall subtle m-0', 'aria-live': 'polite' });

    manualEl.appendChild(h('div', { class: 'cc-scan__manual' },
      h('div', { class: 'cc-scan__col' },
        h('div', { class: 'cc-scan__hold' }, manualHold.el, h('div', { class: 'cc-scan__holdtext' }, manualHead, manualTip)),
        faceGrid),
      h('div', { class: 'cc-scan__col' },
        manualPalette,
        manualStatus,
        h('div', { class: 'row' }, manualBack, manualNextBtn),
        manualPills,
        h('p', { class: 'small muted m-0' }, 'Look straight at that face and tap its colours in reading order: top row left to right, then the middle row, then the bottom row. The next square is picked for you; tap any square to change it. Keys W Y G B R O work too.'))));

    function blankState() {
      var st = [];
      for (var i = 0; i < 54; i++) st.push('?');
      ORDER.forEach(function (e, s) { st[faceIndex(s) * 9 + 4] = e.center; });
      return st;
    }
    function faceComplete(step) {
      var f = faceIndex(step);
      for (var k = 0; k < 9; k++) if (COLOURS.indexOf(manual.state[f * 9 + k]) === -1) return false;
      return true;
    }
    function nextUnknown(from) {
      var f = faceIndex(manual.step);
      for (var j = 0; j < 9; j++) {
        var k = (from + j) % 9;
        if (k !== 4 && COLOURS.indexOf(manual.state[f * 9 + k]) === -1) return k;
      }
      return -1;
    }

    // how: 'fresh' (from the intro / error card), 'scan' (keep the faces the camera got), 'review' (fix one face)
    function startManual(step, how) {
      if (destroyed || !Cube) return;
      active();
      stopAll();
      if (fake) { try { fake.destroy(); } catch (e) { /* ignore */ } fake = null; }
      if (ctl) ctl.reset();
      demo = false;
      var st = blankState();
      if (how === 'review' && edited) st = edited.slice();
      else if (how === 'scan') {
        ORDER.forEach(function (e, s) {
          if (captured[s]) for (var k = 0; k < 9; k++) st[faceIndex(s) * 9 + k] = captured[s][k];
        });
      } else if (how !== 'review' && manual && manual.state) st = manual.state.slice();   // carry on where they left off
      captured = [null, null, null, null, null, null];
      manual = { state: st, step: step >= 0 && step < 6 ? step : 0, cursor: 0, from: how };
      var k0 = nextUnknown(0);
      manual.cursor = k0 >= 0 ? k0 : 0;
      manualHold.reset();
      show('manual');             // first, so the mini cube can measure itself
      renderManual(false);
    }

    function renderManual(animate) {
      if (!manual) return;
      var s = manual.step, e = ORDER[s], f = faceIndex(s);
      manualHead.textContent = 'Face ' + (s + 1) + ' of 6: ' + NAMES[e.center];
      UI.empty(manualTip);
      manualTip.appendChild(h('strong', null, MANUAL_HOW[s]));
      manualHold.show(s, manual.state, animate);
      cells.forEach(function (b, k) {
        var l = manual.state[f * 9 + k], known = COLOURS.indexOf(l) !== -1, centre = k === 4;
        b.style.background = known ? Cube.COLOR_HEX[l] : '';
        b.disabled = centre;
        b.classList.toggle('is-cursor', !centre && k === manual.cursor);
        b.textContent = known ? '' : '?';
        b.setAttribute('aria-label', CELL_NAMES[k] + ': ' + (known ? Cube.COLOR_NAME[l] : 'not set yet') + (centre ? ' (the centre never moves)' : ''));
        if (!centre && k === manual.cursor) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
      var counts = {};
      COLOURS.forEach(function (c) { counts[c] = 0; });
      manual.state.forEach(function (l) { if (counts[l] != null) counts[l]++; });
      COLOURS.forEach(function (c) {
        manualCounts[c].textContent = counts[c] + '/9';
        manualCounts[c].classList.toggle('is-over', counts[c] > 9);
      });
      var over = COLOURS.filter(function (c) { return counts[c] > 9; });
      var left = 0;
      for (var k = 0; k < 9; k++) if (COLOURS.indexOf(manual.state[f * 9 + k]) === -1) left++;
      manualStatus.textContent = over.length
        ? 'Too many ' + over.map(function (c) { return NAMES[c]; }).join(' and ') + ' stickers: a cube has 9 of each colour. One of them is probably another colour.'
        : left ? left + ' sticker' + (left === 1 ? '' : 's') + ' left on this face.' : 'This face is done.';
      var allDone = ORDER.every(function (x, i) { return i === s || faceComplete(i); });
      manualNextLabel.textContent = allDone ? 'Check the cube' : 'Next face';
      UI.empty(manualPills);
      ORDER.forEach(function (x, i) {
        var done = faceComplete(i);
        manualPills.appendChild(h('li', { class: ['cc-scan__pill', i === s ? 'is-now' : null, done && i !== s ? 'is-done' : null], 'aria-current': i === s ? 'step' : null },
          UI.colourDot(x.center), cap1(NAMES[x.center]), h('span', { class: 'sr-only' }, done ? ' (done)' : i === s ? ' (now)' : '')));
      });
    }

    function manualCursor(k) {
      if (!manual || k === 4) return;
      active();
      manual.cursor = k;
      renderManual(false);
    }

    function manualPaint(letter) {
      if (!manual || COLOURS.indexOf(letter) === -1) return;
      active();
      var f = faceIndex(manual.step);
      if (manual.cursor === 4 || manual.cursor < 0) { var k1 = nextUnknown(0); if (k1 < 0) { toast('This face is done. Tap a square to change it, or go to the next face.'); return; } manual.cursor = k1; }
      manual.state[f * 9 + manual.cursor] = letter;
      var nxt = nextUnknown(manual.cursor + 1);
      if (nxt >= 0) manual.cursor = nxt;
      renderManual(false);
      if (nxt < 0) say('Face done. ' + (ORDER.every(function (x, i) { return faceComplete(i); }) ? 'Press Check the cube.' : 'Press Next face.'));
    }

    function manualErase() {
      if (!manual) return;
      var f = faceIndex(manual.step), k = manual.cursor;
      if (COLOURS.indexOf(manual.state[f * 9 + k]) === -1) {         // nothing here: step back one square first
        k = k - 1; if (k === 4) k = 3;
        if (k < 0) return;
      }
      manual.state[f * 9 + k] = '?';
      manual.cursor = k;
      renderManual(false);
    }

    function manualNext() {
      if (!manual) return;
      active();
      if (!faceComplete(manual.step)) {
        var k = nextUnknown(0);
        if (k >= 0) { manual.cursor = k; renderManual(false); }
        toast('Fill in all 9 squares of this face first.');
        return;
      }
      for (var j = 1; j <= 6; j++) {
        var s = (manual.step + j) % 6;
        if (!faceComplete(s)) {
          var forward = s === manual.step + 1;
          manual.step = s;
          var k2 = nextUnknown(0);
          manual.cursor = k2 >= 0 ? k2 : 0;
          if (!forward) manualHold.reset();
          renderManual(forward);
          try { manualHead.focus({ preventScroll: inModal }); } catch (e) { /* ignore */ }
          say('Face ' + (s + 1) + ' of 6. ' + MANUAL_HOW[s]);
          return;
        }
      }
      finishManual();
    }

    function manualPrev() {
      if (!manual) return;
      active();
      if (manual.step > 0) {
        manual.step--;
        var k = nextUnknown(0);
        manual.cursor = k >= 0 ? k : 0;
        manualHold.reset();
        renderManual(false);
        return;
      }
      if (manual.from === 'review' && edited) { show('review'); return; }
      renderIntro();
      show('intro');
    }

    function finishManual() {
      result = { state: manual.state.slice(), confidence: null, uncertain: [], suspectSteps: [], warnings: [], manual: true };
      edited = manual.state.slice();
      selected = -1; checked = {};
      renderReview();
      show('review');
    }

    // ---------------------------------------------------------------- review
    function flagged() {
      var out = [];
      function add(i) { if (i % 9 !== 4 && out.indexOf(i) === -1) out.push(i); }
      if (result && Array.isArray(result.uncertain)) result.uncertain.forEach(function (i) { if (!checked[i]) add(i); });
      var v = Cube.validate(edited);
      // only errors that point at particular stickers (a twist / flip / parity error names every piece)
      if (!v.ok) v.errors.forEach(function (e) { if (/^(unknown|count|corner|edge)$/.test(e.type)) (e.stickers || []).forEach(add); });
      return out;
    }

    function netSize() {
      var w = reviewEl.clientWidth || rootEl.clientWidth || container.clientWidth || 360;
      if (!inModal && w > 900) w = w / 2;
      return Math.max(16, Math.min(32, Math.floor((w - 56) / 13)));
    }

    function setColour(letter) {
      if (selected < 0 || !edited) return;
      if (selected % 9 === 4) { toast('Centres can’t be wrong: they decide each face’s colour.'); return; }
      active();
      edited[selected] = letter;
      checked[selected] = true;
      var s = Cube.STICKERS[selected];
      say(Cube.FACE_NAME[s.face] + ' face sticker set to ' + NAMES[letter] + '.');
      var keep = selected;
      renderReview();
      var btn = reviewEl.querySelector('[data-i="' + keep + '"]');
      if (btn) btn.focus();
    }

    function selectSticker(i) {
      if (i % 9 === 4) { toast('Centres can’t be wrong: they decide each face’s colour. Tap another sticker.'); return; }
      selected = selected === i ? -1 : i;
      var keep = i;
      renderReview();
      var btn = reviewEl.querySelector('[data-i="' + keep + '"]');
      if (btn) btn.focus();
    }

    function renderReview() {
      if (net) { net.destroy(); net = null; }
      UI.empty(reviewEl);
      var isManual = !!(result && result.manual);
      if (!edited) {
        reviewEl.appendChild(h('h2', { class: 'h3 m-0', tabindex: '-1', 'data-focus-head': '' }, 'That scan didn’t work'));
        reviewEl.appendChild(UI.callout('warn', null, 'The colours couldn’t be read. Scan the cube again in even light, or type the colours in.'));
        reviewEl.appendChild(h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-primary', onClick: restartAll }, UI.icon('refresh', 18), 'Scan again'),
          altButtons({ manual: true })));
        return;
      }
      var v = Cube.validate(edited);
      var solved = v.ok && Cube.isSolved(edited);
      var flags = flagged();
      var suspect = (result && result.suspectSteps) || [];
      var warnings = (result && result.warnings) || [];
      // many faces wrong at once: the camera never got a proper look (or the wrong faces were shown)
      var junk = !v.ok && !isManual && (suspect.length >= 3 || flags.length >= 16);
      var counts = {};
      COLOURS.forEach(function (c) { counts[c] = 0; });
      edited.forEach(function (l) { if (counts[l] != null) counts[l]++; });
      var netHost = h('div', { class: 'cc-scan__net' });
      var palette = h('div', { class: 'cc-scan__palette', role: 'group', 'aria-label': 'Colour for the chosen sticker' },
        COLOURS.map(function (c) {
          return h('button', {
            type: 'button', class: 'cc-scan__swatch', disabled: selected < 0, title: 'Press ' + c,
            'aria-pressed': selected >= 0 && edited[selected] === c,
            onClick: function () { setColour(c); }
          }, UI.colourDot(c), cap1(NAMES[c]), h('span', { class: ['cc-scan__count', counts[c] !== 9 ? 'is-over' : null] }, counts[c] + '/9'));
        }));

      var status;
      if (v.ok && solved && purpose === 'start') {
        status = UI.callout('info', 'This cube is already solved', 'Mix it up first, or let the coach give you a scramble to follow.');
      } else if (v.ok) {
        status = UI.callout('success', 'Looks like a real cube', flags.length
          ? 'A few stickers were hard to read (outlined). If any is wrong, tap it and pick the right colour.'
          : isManual ? 'Every colour checks out. Glance over it once more, then start.' : 'Every colour checks out. Glance over it, then start.');
      } else if (junk) {
        status = UI.callout('warn', 'This doesn’t look like your cube yet',
          h('p', { class: 'm-0' }, 'The camera probably didn’t get a clear look at several faces (or a face was shown twice). Scan all six again: fill the square with each face, in even light, and hold still until it says “Got it!” before you turn.'),
          h('p', { class: 'm-0' }, 'Camera having a bad day? Type the colours in instead.'));
      } else {
        status = UI.callout('warn', 'A few colours don’t add up',
          h('ul', { class: 'm-0' }, v.errors.slice(0, 3).map(function (e) { return h('li', null, e.message); })),
          h('p', { class: 'm-0' }, flags.length
            ? 'Compare the outlined stickers with your cube. Tap one, then pick its real colour' + (isManual ? '.' : '. Or rescan that face.')
            : 'Compare each face with your cube, holding it the same way as when you ' + (isManual ? 'typed it in' : 'scanned it') + '. Tap a wrong sticker, then pick its real colour.'));
      }

      var faces = h('div', { class: 'cc-scan__faces' }, ORDER.map(function (e, i) {
        var sus = suspect.indexOf(i) !== -1;
        return h('button', {
          type: 'button', class: ['btn', 'btn-sm', sus ? 'btn-secondary' : 'btn-ghost'],
          'aria-label': (isManual ? 'Retype the ' : 'Rescan the ') + NAMES[e.center] + ' face' + (sus ? ' (worth checking)' : ''),
          onClick: function () { if (isManual) startManual(i, 'review'); else rescanFace(i); }
        }, UI.colourDot(e.center), (isManual ? 'Retype ' : 'Rescan ') + NAMES[e.center].toLowerCase(), sus ? h('span', { class: 'badge badge-warn' }, 'check') : null);
      }));

      var primaryLabel = purpose === 'rescan' ? 'Looks right — use it' : 'Looks right — start solving';
      var primary = h('button', {
        type: 'button', class: 'btn btn-primary btn-lg', disabled: !v.ok || (solved && purpose === 'start'),
        onClick: done
      }, UI.icon(purpose === 'rescan' ? 'check' : 'play', 18), primaryLabel);
      var again = isManual
        ? h('button', { type: 'button', class: ['btn', 'btn-sm', junk ? 'btn-primary' : 'btn-ghost'], onClick: function () { manual = null; startManual(0, 'fresh'); } }, UI.icon('refresh', 16), 'Start again')
        : h('button', { type: 'button', class: ['btn', junk ? 'btn-primary' : 'btn-ghost btn-sm'], onClick: restartAll }, UI.icon('refresh', 16), 'Scan all six again');

      reviewEl.appendChild(h('div', { class: 'cc-scan__review' },
        h('div', { class: 'cc-scan__col' },
          h('h2', { class: 'h3 m-0 cc-scan__rv-head', tabindex: '-1', 'data-focus-head': '' }, 'Check your cube'),
          h('p', { class: 'small muted m-0 cc-scan__rv-about' }, 'Your cube unfolded flat: GREEN face in the middle, WHITE above it, YELLOW below, RED to its right, ORANGE to its left and BLUE at the far right. Each face is drawn as you see it looking straight at it, held the way you ' + (isManual ? 'typed it in.' : 'scanned it.')),
          h('div', { class: 'cc-scan__rv-net' }, netHost),
          h('p', { class: 'xsmall subtle m-0 cc-scan__rv-hint' }, selected >= 0
            ? 'Sticker chosen. Pick its colour below (or press W, Y, G, B, R or O).'
            : 'Tap any sticker that doesn’t match your cube.'),
          h('div', { class: 'cc-scan__rv-palette' }, palette)),
        h('div', { class: 'cc-scan__col' },
          h('div', { class: 'stack stack-sm cc-scan__rv-status' }, status,
            warnings.length && !v.ok && !junk ? h('ul', { class: 'small muted m-0' }, warnings.slice(0, 2).map(function (w) { return h('li', null, w); })) : null,
            junk ? h('div', { class: 'row' }, again, altButtons({ manual: true, manualPrimary: true })) : null),
          h('div', { class: 'row cc-scan__rv-go' }, primary,
            solved && purpose === 'start' ? h('button', {
              type: 'button', class: 'btn btn-secondary',
              onClick: function () { finished = true; stopAll(); if (App) App.go('solve', { device: 'physical', source: 'scramble' }); }
            }, UI.icon('cube', 18), 'Give me a scramble') : null),
          h('div', { class: 'stack stack-sm cc-scan__rv-rest' },
            h('h3', { class: 'small strong m-0' }, isManual ? 'Retype one face' : 'Rescan one face'),
            suspect.length && !isManual ? h('p', { class: 'xsmall subtle m-0' }, 'Faces marked “check” are the likeliest culprits.') : null,
            faces,
            junk ? null : h('div', { class: 'row' }, again)))));

      net = C.Net2D.render(netHost, edited, {
        size: netSize(), highlight: selected >= 0 ? [selected] : flags, onSticker: selectSticker
      });
    }

    function done() {
      if (!edited || finished) return;
      var v = Cube.validate(edited);
      if (!v.ok) { toast('Fix the outlined stickers first.'); return; }
      finished = true;
      active();
      stopAll();
      if (typeof opts.onDone === 'function') opts.onDone(edited.slice());
    }

    // ---------------------------------------------------------------- keys
    function topLayerOk() {
      var b = document.querySelectorAll('.modal-backdrop');
      return !b.length || b[b.length - 1].contains(rootEl);
    }
    function onKey(e) {
      if (destroyed || e.defaultPrevented) return;
      if (UI.isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || !topLayerOk()) return;
      if (!rootEl.isConnected) return;
      var k = e.key, L = k && k.length === 1 ? k.toUpperCase() : '';
      if (phase === 'scanning' && (k === ' ' || k === 'Spacebar')) {
        if (isControl(e.target)) return;
        e.preventDefault();
        captureNow();
      } else if (phase === 'manual' && manual) {
        if (COLOURS.indexOf(L) !== -1) { e.preventDefault(); manualPaint(L); }
        else if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); manualErase(); }
        else if (k === 'Enter' && !isControl(e.target)) { e.preventDefault(); manualNext(); }
        else if (/^Arrow/.test(k) && (!isControl(e.target) || (e.target.classList && e.target.classList.contains('cc-scan__cell')))) {
          var r = Math.floor(manual.cursor / 3), c = manual.cursor % 3;
          if (k === 'ArrowLeft') c = Math.max(0, c - 1); else if (k === 'ArrowRight') c = Math.min(2, c + 1);
          else if (k === 'ArrowUp') r = Math.max(0, r - 1); else if (k === 'ArrowDown') r = Math.min(2, r + 1);
          var nk = r * 3 + c;
          if (nk !== 4) { e.preventDefault(); manualCursor(nk); if (cells[nk]) cells[nk].focus(); }
        }
      } else if (phase === 'review' && selected >= 0 && L) {
        if (COLOURS.indexOf(L) !== -1) { e.preventDefault(); setColour(L); }
      } else if (phase === 'review' && selected >= 0 && (k === 'Escape' || k === 'Esc') && !inModal) {
        selected = -1; renderReview();
      }
    }
    document.addEventListener('keydown', onKey);

    // keep the review net fitting the page when the window is resized (or a phone is rotated)
    var resizeTimer = 0;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (destroyed) return;
        if (net && phase === 'review') net.update(null, { size: netSize() });
        // phone <-> wide layout (a rotated phone, a resized window): chips and the Capture button follow
        if (phase === 'scanning' && lastCompact !== null && compactSteps() !== lastCompact) renderSteps(curStep);
        captureBtn.classList.toggle('btn-lg', phoneLayout());
        if (ctl && ctl.setHud) ctl.setHud(!phoneLayout());
      }, 150);
    }
    root.addEventListener('resize', onResize);

    // ---------------------------------------------------------------- lifecycle
    function stopAll() {
      timers.slice().forEach(clearTimeout);
      timers = [];
      if (ctl) ctl.stop();
      camStarted = false;
      tapBtn.hidden = true;
      awake(false);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      timers.forEach(clearTimeout);
      timers = [];
      if (ctl) { try { ctl.stop(); } catch (e) { /* ignore */ } ctl = null; }
      if (fake) { try { fake.destroy(); } catch (e) { /* ignore */ } fake = null; }
      if (net) { net.destroy(); net = null; }
      awake(false);
      scanHold.dispose();
      manualHold.dispose();
      if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    }

    renderIntro();
    show('intro', !inModal);
    if (Scanner && Cube) {
      // iOS opens the camera only in answer to a tap: without one, wait for "Start camera"
      var ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
      var gestureOk = !dev.ios || !ua || ua.isActive;
      if (opts.demo) startCamera(true);
      else if (opts.manual) startManual(0, 'fresh');
      else if (opts.autoStart && Scanner.isSupported().ok && gestureOk) startCamera(false);
    }

    return {
      destroy: destroy,
      // for tests and debugging
      _state: function () {
        return { phase: phase, demo: demo, captured: captured.map(Boolean), edited: edited && edited.slice(), selected: selected, camStarted: camStarted,
          demoTruth: demoTruth && demoTruth.slice(), manual: manual && { step: manual.step, cursor: manual.cursor, state: manual.state.slice() },
          facing: activeFacing(), mirrored: !!(ctl && ctl.getMirror && ctl.getMirror()), camState: camState, canSwitch: canSwitch(), compact: compactSteps() };
      },
      _controller: function () { return ctl; },
      _fake: function () { return fake; },
      _hold: function () { return phase === 'manual' ? manualHold : scanHold; },
      _select: selectSticker,
      _switchCamera: switchCamera,
      _setColour: setColour,
      _complete: onComplete,
      _done: done
    };
  }

  // ================================================================ full-screen overlay
  function open(o) {
    o = o || {};
    var App = CC().App, UI = CC().UI;
    if (!App || !App.modal || !UI || typeof document === 'undefined') return Promise.resolve(null);
    var body = UI.h('div', { class: 'cc-scan-modal' });
    var result = null;
    var p = App.modal({
      title: o.title || 'Scan your cube', body: body, wide: true,
      actions: [{ label: 'Cancel' }]
    });
    var widget = mount(body, {
      purpose: o.purpose === 'start' ? 'start' : 'rescan', inModal: true, autoStart: o.autoStart !== false,
      demo: !!o.demo, demoState: o.demoState || null,
      onDone: function (state) { result = state; p.close('done'); },
      onCancel: function () { p.close(null); }
    });
    var out = p.then(function (label) {
      widget.destroy();
      return label === 'done' ? result : null;
    });
    out.close = function () { p.close(null); };
    out.widget = widget;
    return out;
  }

  var ScanUI = { mount: mount, open: open };
  ScanUI._screen = null;      // the scan screen's def (its ._widget is the mounted widget), for tests

  // ================================================================ the screen
  var def = {
    title: 'Scan your cube',
    mount: function (el, params) {
      params = params || {};
      var C = CC(), h = C.UI.h, App = C.App;
      function flag(v) { return v === true || v === 1 || v === '1' || v === 'true'; }
      var wrap = h('div', { class: 'cc-scan-screen' });
      el.appendChild(wrap);
      wrap.appendChild(h('header', { class: 'page-head' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'With your cube'),
          h('h1', null, 'Scan your cube'),
          h('p', { class: 'muted' }, 'Let the camera see each face (or type the colours in). Cube Coach checks the colours, then coaches you through the solve.'))));
      var host = h('div');
      wrap.appendChild(host);
      var widget = mount(host, {
        purpose: 'start',
        demo: flag(params.demo),
        manual: flag(params.manual),
        onPhase: function (p) {
          wrap.classList.toggle('is-live', p === 'scanning');
          wrap.classList.toggle('is-busy', p === 'manual' || p === 'review' || p === 'error');
        },
        onDone: function (state) { App.go('solve', { device: 'physical', source: 'scan', state: state }); },
        onCancel: function () { App.back(); }
      });
      def._widget = widget;
      return function () { widget.destroy(); if (def._widget === widget) def._widget = null; };
    }
  };

  ScanUI._screen = def;
  root.CC = root.CC || {};
  root.CC.ScanUI = ScanUI;
  if (root.CC.App) root.CC.App.registerScreen('scan', def);
  if (typeof module !== 'undefined' && module.exports) module.exports = { def: def, ScanUI: ScanUI };
})(typeof window !== 'undefined' ? window : globalThis);
