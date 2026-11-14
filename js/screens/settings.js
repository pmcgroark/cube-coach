/* Cube Coach — Settings screen.
 *
 * Edits data.settings and saves straight away (CC.App.save()):
 *   theme ('light'|'dark'|null = follow the computer; applied by CC.App.applyTheme), animSpeed,
 *   anticipate (pause-and-predict quizzes), guidanceOverride (null = automatic, or 0..3),
 *   directCross (skip the daisy; for the solve screen to pass to CC.Solver.solve as opts.directCross),
 *   keyboard ('simple'|'cstimer', with the CC.Keys.legend key map), mirror, autoCapture,
 *   cameraId / cameraLabel (preferred camera; null = browser default), inspection, splitTaps,
 *   goalSeconds, welcomeDismissed (home welcome card).
 * Plus: export a JSON backup, import one (CC.Store.importJSON), reset everything, about & privacy.
 * On your phone: the hosted link (CC.App.HOSTED_URL) with Copy/Share, Add to Home Screen steps for
 *   Chrome and Safari on iPhone, and the offline-copy status (CC.App.offlineStatus, 'cc:sw' events).
 * Move my progress: copy/share a progress code (CC.Store.exportCode), paste one (importCode) with a
 *   preview (summary) and Merge (CC.Store.merge) or Replace (CC.Store.replace), with Undo.
 * Params: { section?: 'phone'|'move'|'look'|… } scrolls to that section after mounting.
 */
(function (root) {
  'use strict';

  var STYLE_ID = 'cc-style-settings';
  var CSS = [
    '.cc-settings .card > .card__head { margin-bottom: var(--space-2); }',
    '.cc-set-jump { display: flex; flex-wrap: wrap; gap: 6px; }',
    '.cc-set-block { padding: var(--space-4) 0; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-3); }',
    '.cc-set-block:last-child { border-bottom: 0; padding-bottom: 0; }',
    '.cc-radio-list { display: flex; flex-direction: column; gap: var(--space-2); border: 0; padding: 0; margin: 0; min-width: 0; }',
    '.cc-radio-list > legend { padding: 0; margin-bottom: var(--space-1); font-weight: 600; }',
    '.cc-radio { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); cursor: pointer; transition: border-color var(--dur-1), background var(--dur-1); }',
    '.cc-radio:hover { border-color: var(--border-strong); }',
    '.cc-radio:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }',
    '.cc-radio:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.cc-radio input { flex: none; width: 18px; height: 18px; margin: 3px 0 0; accent-color: var(--accent); }',
    '.cc-radio__title { display: block; font-weight: 600; }',
    '.cc-radio__desc { display: block; font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-keys { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px var(--space-5); grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }',
    '.cc-keys > li { margin: 0; display: grid; grid-template-columns: 5.6em 2.4em minmax(0, 1fr); gap: var(--space-2); align-items: baseline; font-size: var(--text-sm); }',
    '.cc-keys__tok { font-family: var(--font-mono); font-weight: 700; }',
    '.cc-keys__txt { color: var(--text-2); }',
    '.cc-details > summary { cursor: pointer; font-weight: 600; color: var(--accent-text); padding: 4px 0; }',
    '.cc-details[open] > summary { margin-bottom: var(--space-3); }',
    '.cc-goal { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }',
    '.cc-goal .input { width: 6.5em; font-variant-numeric: tabular-nums; }',
    '.cc-goal__err { flex-basis: 100%; margin: 0; color: var(--danger-text); font-size: var(--text-sm); }',
    '.cc-speed { display: flex; align-items: center; gap: var(--space-2); width: 220px; max-width: 100%; }',
    '.cc-speed output { flex: none; width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; color: var(--text-2); font-size: var(--text-sm); }',
    '.cc-cam { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; justify-content: flex-end; }',
    '.cc-cam .select { max-width: 260px; }',
    '.cc-data-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
    '.cc-about p { margin: 0; }',
    '.cc-about ul { margin: 0; padding-left: 1.2em; color: var(--text-2); }',
    '.cc-about li + li { margin-top: var(--space-2); }',
    // On your phone
    '.cc-link { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }',
    '.cc-link__url { flex: 1 1 260px; min-width: 0; padding: 10px 12px; border-radius: 10px; border: 1px dashed var(--border-strong); background: var(--surface-2); font-family: var(--font-mono); font-size: var(--text-sm); font-weight: 600; color: var(--text); overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }',
    '.cc-link__btns { display: flex; flex-wrap: wrap; gap: var(--space-2); }',
    '.cc-qr { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: center; margin: 0; }',
    '.cc-qr img { flex: none; width: 148px; height: 148px; border-radius: 10px; border: 1px solid var(--border); background: #fff; image-rendering: pixelated; }',
    '.cc-qr figcaption { flex: 1 1 220px; min-width: 0; font-size: 0.95rem; color: var(--text-2); }',
    '.cc-steps-grid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }',
    '.cc-steps { margin: 0; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }',
    '.cc-steps.is-yours { border-color: var(--accent); background: var(--accent-soft); }',
    '.cc-steps h3 { font-size: var(--text-md); margin: 0 0 var(--space-2); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }',
    '.cc-steps ol { margin: 0; padding-left: 1.3em; }',
    '.cc-steps li { font-size: 0.95rem; }',
    '.cc-steps li + li { margin-top: 6px; }',
    '.cc-share-glyph { display: inline-grid; place-items: center; width: 1.5em; height: 1.5em; vertical-align: -0.3em; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--accent-text); }',
    '.cc-share-glyph svg { width: 0.95em; height: 0.95em; }',
    '.cc-offline { display: flex; gap: var(--space-3); align-items: flex-start; flex-wrap: wrap; padding: var(--space-3) var(--space-4); border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-2); }',
    '.cc-offline__icon { flex: none; display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--surface-3); color: var(--text-2); }',
    '.cc-offline__text { flex: 1 1 220px; min-width: 0; font-size: 0.95rem; }',
    '.cc-offline__text strong { display: block; }',
    '.cc-offline.is-ready { border-color: var(--success-border); background: var(--success-soft); }',
    '.cc-offline.is-ready .cc-offline__icon { background: var(--success); color: #fff; }',
    '.cc-offline.is-busy .cc-offline__icon { background: transparent; }',
    '.cc-offline.is-update { border-color: var(--accent-soft-2); background: var(--accent-soft); }',
    // Move my progress
    '.cc-move-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); }',
    '.cc-move-step { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); min-width: 0; }',
    '.cc-move-step h3 { font-size: var(--text-md); margin: 0; }',
    '.cc-move-step p { margin: 0; }',
    'textarea.cc-code { font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.35; overflow-wrap: anywhere; word-break: normal; min-height: 6.2em; resize: vertical; }',
    '@media (pointer: coarse) { textarea.cc-code { font-size: 16px; } }',
    '.cc-move-status { margin: 0; font-size: var(--text-sm); color: var(--text-2); }',
    '.cc-move-status.is-ok { color: var(--success-text); font-weight: 600; }',
    '.cc-move-status.is-err { color: var(--danger-text); }',
    '.cc-preview { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius); border: 1px solid var(--accent-soft-2); background: var(--accent-soft); }',
    '.cc-preview__cols { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }',
    '.cc-preview__col h4 { margin: 0 0 4px; font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }',
    '.cc-preview__col ul { margin: 0; padding-left: 1.1em; font-size: 0.95rem; }',
    '.cc-preview__col li + li { margin-top: 2px; }',
    '.cc-preview__choices { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }',
    '.cc-choice { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; height: auto; padding: 10px 14px; }',
    '.cc-choice small { font-weight: 500; font-size: var(--text-sm); opacity: 0.85; line-height: 1.35; }'
  ].join('\n');

  var LEVEL_NAMES = ['Solo', 'Nudge', 'Coach', 'Show'];
  var LEVEL_TEXT = [
    'Stage name and timer only. Ask for a hint if you need one.',
    'Just the goal. "Hint" gives you a little more each time you press it.',
    'Goal, case and algorithm name. Moves are hidden until you ask.',
    'Every move is shown on the 3D cube. Copy it.'
  ];
  var MIN_GOAL = 15, MAX_GOAL = 3600;
  var SPEEDS = [0.5, 0.75, 1, 1.5, 2, 3];
  function nearestSpeedIndex(v) {
    v = Number(v) > 0 ? Number(v) : 1;
    var best = 2, d = Infinity;
    SPEEDS.forEach(function (s, i) { var dd = Math.abs(s - v); if (dd < d) { d = dd; best = i; } });
    return best;
  }
  function speedLabel(v) { return v + '×'; }
  function speedText(v) { return v === 1 ? 'Normal speed' : v < 1 ? v + ' times: slower than normal' : v + ' times: faster than normal'; }

  // ------------------------------------------------------------ helpers (no DOM)
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function clock(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + pad(sec % 60); }
  // '3:00' -> 180, '2:30' -> 150, '3' or '3.5' -> minutes, '90s' -> 90. Returns null if not understood.
  function parseGoal(text) {
    var t = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    var m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = /^(\d+)s(ec(onds?)?)?$/.exec(t);
    if (m) return Number(m[1]);
    m = /^(\d+(?:[.,]\d+)?)(m|min|mins|minutes?)?$/.exec(t);
    if (m) return Math.round(Number(m[1].replace(',', '.')) * 60);
    return null;
  }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function fmtMinutes(m) {
    m = Math.round(Number(m) || 0);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }
  function fmtCount(n) { try { return Number(n).toLocaleString('en-GB'); } catch (e) { return String(n); } }
  // CC.Store.summary(...) -> short plain lines for the "Move my progress" preview
  function summaryLines(s, fmtTime) {
    if (!s) return [];
    var lines = [];
    lines.push(s.solves ? plural(s.solves, 'solve') + (s.bestMs != null ? ' (best ' + fmtTime(s.bestMs) + ')' : '') : 'No solves yet');
    lines.push(s.practiceDays ? plural(s.practiceDays, 'day') + ' of practice (' + fmtMinutes(s.practiceMinutes) + ')' : 'No practice time yet');
    if (s.strongStages) lines.push(plural(s.strongStages, 'stage') + ' mastered');
    if (s.drillAnswers) lines.push(plural(s.drillAnswers, 'drill answer'));
    if (s.milestones) lines.push(plural(s.milestones, 'milestone'));
    if (s.lastActive) lines.push('Last practised ' + fmtDate(s.lastActive));
    return lines;
  }
  function fmtDate(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return 'unknown date';
    try { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return dayKey(new Date(t)); }
  }

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ------------------------------------------------------------ screen
  var def = {
    title: 'Settings',
    mount: function (el, params) {
      injectStyle();
      params = params || {};
      var CC = root.CC, UI = CC.UI, h = UI.h, App = CC.App;
      var data = App.data;
      var settings = data.settings;
      var disposed = false;
      var pendingRevokes = [];
      var uid = 0;

      function save() { App.save(); }
      function id(prefix) { return 'cc-set-' + prefix + '-' + (++uid); }

      function row(title, desc, control, opts) {
        opts = opts || {};
        var tid = id('t'), did = desc ? id('d') : null;
        if (control && control.setAttribute && opts.label !== false) {
          var target = control.querySelector ? (control.matches && control.matches('input,select,textarea') ? control : control.querySelector('input,select,textarea')) : null;
          if (target) {
            target.setAttribute('aria-labelledby', tid);
            if (did) {
              var prev = target.getAttribute('aria-describedby');
              target.setAttribute('aria-describedby', prev ? did + ' ' + prev : did);
            }
          }
        }
        return h('div', { class: 'setting-row' },
          h('div', { class: 'setting-row__text' },
            h('div', { class: 'setting-row__title', id: tid }, title),
            desc ? h('div', { class: 'setting-row__desc', id: did }, desc) : null),
          h('div', { class: 'setting-row__control' }, control));
      }
      function toggle(key, onChange) {
        return h('label', { class: 'toggle' },
          h('input', {
            type: 'checkbox', checked: !!settings[key],
            onChange: function (e) { settings[key] = e.target.checked; save(); if (onChange) onChange(e.target.checked); }
          }),
          h('span', { class: 'toggle__track', 'aria-hidden': 'true' }));
      }
      function section(key, title, intro) {
        var kids = Array.prototype.slice.call(arguments, 3);
        return h('section', { class: 'card', id: 'cc-set-' + key, 'aria-labelledby': 'cc-set-' + key + '-h' },
          h('div', { class: 'card__head' }, h('h2', { class: 'card__title', id: 'cc-set-' + key + '-h', tabindex: '-1' }, title)),
          intro ? h('p', { class: 'small muted' }, intro) : null,
          kids);
      }

      // ---------------------------------------------- appearance
      var themeNow = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'auto';
      var themeSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Theme' }, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (o) {
        return h('button', {
          type: 'button', 'aria-pressed': themeNow === o[0], dataset: { theme: o[0] },
          onClick: function () {
            settings.theme = o[0] === 'auto' ? null : o[0];
            App.applyTheme(settings.theme);
            save();
            Array.prototype.forEach.call(themeSeg.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.theme === o[0])); });
          }
        }, o[1]);
      }));

      // The same steps as the speed buttons on the solve screen (the demo players snap to the nearest),
      // so a speed picked here is exactly the one you get everywhere.
      var speedIdx = nearestSpeedIndex(settings.animSpeed);
      var speedOut = h('output', null, speedLabel(SPEEDS[speedIdx]));
      var speedCtl = h('div', { class: 'cc-speed' },
        h('input', {
          type: 'range', class: 'range', min: 0, max: SPEEDS.length - 1, step: 1, value: speedIdx,
          'aria-valuetext': speedText(SPEEDS[speedIdx]),
          onInput: function (e) {
            var v = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, Math.round(Number(e.target.value) || 0)))];
            settings.animSpeed = v;
            speedOut.textContent = speedLabel(v);
            e.target.setAttribute('aria-valuetext', speedText(v));
          },
          onChange: save
        }), speedOut);

      // ---------------------------------------------- coaching
      var Coach = CC.Coach;
      var levelText = (Coach && Coach.LEVEL_TEXT) || LEVEL_TEXT;
      var current = typeof settings.guidanceOverride === 'number' ? settings.guidanceOverride : null;
      var guidanceNote = h('p', { class: 'small muted m-0', 'aria-live': 'polite' });
      function updateGuidanceNote() {
        var o = settings.guidanceOverride;
        guidanceNote.textContent = typeof o === 'number'
          ? 'Every stage now gets ' + LEVEL_NAMES[o] + ' help, whatever its mastery. Your mastery still updates as you practise; switch back to Automatic any time.'
          : 'Recommended. The coach steps back on its own as you master each stage.';
      }
      updateGuidanceNote();
      var guidanceOpts = [[null, 'Automatic', 'Each stage gets the help it has earned: lots at first, then less and less as you master it.']]
        .concat([3, 2, 1, 0].map(function (l) { return [l, 'Always ' + LEVEL_NAMES[l], levelText[l]]; }));
      var guidance = h('fieldset', { class: 'cc-radio-list' },
        h('legend', null, 'How much help'),
        guidanceOpts.map(function (o) {
          return h('label', { class: 'cc-radio' },
            h('input', {
              type: 'radio', name: 'cc-guidance', value: o[0] == null ? 'auto' : String(o[0]), checked: current === o[0],
              onChange: function (e) {
                if (!e.target.checked) return;
                settings.guidanceOverride = o[0];
                save();
                updateGuidanceNote();
              }
            }),
            h('span', null, h('span', { class: 'cc-radio__title' }, o[1], o[0] == null ? [' ', h('span', { class: 'badge badge-accent' }, 'Recommended')] : null),
              h('span', { class: 'cc-radio__desc' }, o[2])));
        }));

      // ---------------------------------------------- keyboard
      var legendHost = h('div');
      var keyCount = h('span');
      function renderLegend() {
        UI.empty(legendHost);
        var K = CC.Keys;
        var list = [];
        try { list = K && K.legend ? K.legend(settings.keyboard === 'cstimer' ? 'cstimer' : 'simple') : []; } catch (e) { list = []; }
        keyCount.textContent = list.length ? ' (' + list.length + ' keys)' : '';
        if (!list.length) { legendHost.appendChild(h('p', { class: 'small muted m-0' }, 'The key map isn’t available right now.')); return; }
        legendHost.appendChild(h('ul', { class: 'cc-keys' }, list.map(function (k) {
          var info = null;
          try { info = CC.Cube && CC.Cube.moveInfo ? CC.Cube.moveInfo(k.token) : null; } catch (e) { info = null; }
          return h('li', null,
            h('span', null, String(k.key).split('+').map(function (part, i) { return [i ? '+' : null, h('kbd', null, part)]; })),
            h('span', { class: 'cc-keys__tok' }, k.token),
            h('span', { class: 'cc-keys__txt' }, info ? info.text : ''));
        })));
      }
      var kbSelect = h('select', {
        class: 'select select-inline',
        onChange: function (e) { settings.keyboard = e.target.value === 'cstimer' ? 'cstimer' : 'simple'; save(); renderLegend(); }
      },
      h('option', { value: 'simple', selected: settings.keyboard !== 'cstimer' }, 'Simple: R turns R, Shift+R turns R′'),
      h('option', { value: 'cstimer', selected: settings.keyboard === 'cstimer' }, 'Speedcuber (csTimer keys)'));
      renderLegend();

      // ---------------------------------------------- camera
      var camSelect = h('select', {
        class: 'select',
        onChange: function (e) {
          var v = e.target.value;
          settings.cameraId = v || null;
          var opt = e.target.options[e.target.selectedIndex];
          settings.cameraLabel = v && opt ? opt.textContent : null;
          save();
        }
      });
      var camHint = h('p', { class: 'small muted m-0', 'aria-live': 'polite' });
      function fillCameras(list) {
        if (disposed) return;
        UI.empty(camSelect);
        camSelect.appendChild(h('option', { value: '' }, 'Browser default'));
        var named = (list || []).filter(function (c) { return c && c.deviceId; });
        named.forEach(function (c) { camSelect.appendChild(h('option', { value: c.deviceId }, c.label || 'Camera')); });
        if (settings.cameraId && !named.some(function (c) { return c.deviceId === settings.cameraId; })) {
          camSelect.appendChild(h('option', { value: settings.cameraId }, (settings.cameraLabel || 'Your chosen camera') + ' (not connected)'));
        }
        camSelect.value = settings.cameraId || '';
        if (!named.length) {
          camHint.textContent = (list && list.length)
            ? 'Your browser hides camera names until you’ve allowed the camera once. Scan your cube once, then come back and pick one here.'
            : 'No camera found. Plug one in (or allow camera access), then press “Find cameras”.';
        } else {
          camHint.textContent = named.length === 1 ? 'One camera found.' : named.length + ' cameras found. Pick the one that faces you.';
        }
      }
      function findCameras() {
        var S = CC.Scanner;
        var p = null;
        try {
          if (S && typeof S.listCameras === 'function') p = S.listCameras();
          else if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            p = navigator.mediaDevices.enumerateDevices().then(function (l) {
              return l.filter(function (d) { return d.kind === 'videoinput'; }).map(function (d, i) { return { deviceId: d.deviceId, label: d.label || 'Camera ' + (i + 1) }; });
            });
          }
        } catch (e) { p = null; }
        if (!p || typeof p.then !== 'function') { fillCameras([]); camHint.textContent = 'This browser can’t list cameras here.'; return; }
        camHint.textContent = 'Looking for cameras…';
        p.then(fillCameras, function () { fillCameras([]); });
      }
      fillCameras([]);
      findCameras();
      var camCtl = h('div', { class: 'cc-cam' }, camSelect,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: findCameras }, UI.icon('refresh', 16), 'Find cameras'));

      // ---------------------------------------------- goal time
      var goalInput = h('input', {
        type: 'text', class: 'input', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
        value: clock(Number(settings.goalSeconds) > 0 ? settings.goalSeconds : 180), placeholder: '3:00',
        onChange: function () { applyGoal(goalInput.value); },
        onKeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); applyGoal(goalInput.value); } }
      });
      var goalErr = h('p', { class: 'cc-goal__err', id: id('goal-err'), hidden: true, role: 'alert' });
      function applyGoal(text) {
        var s = parseGoal(text);
        if (s == null || s < MIN_GOAL || s > MAX_GOAL) {
          goalErr.textContent = s == null
            ? 'Type minutes and seconds, like 3:00 or 2:30.'
            : 'Pick a goal between ' + clock(MIN_GOAL) + ' and ' + clock(MAX_GOAL) + '.';
          goalErr.hidden = false;
          goalInput.setAttribute('aria-invalid', 'true');
          return false;
        }
        goalErr.hidden = true;
        goalInput.removeAttribute('aria-invalid');
        goalInput.value = clock(s);
        if (settings.goalSeconds !== s) {
          settings.goalSeconds = s;
          save();
          App.toast('Goal set to ' + clock(s) + '.', { kind: 'success' });
        }
        presets.forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.sec) === s)); });
        return true;
      }
      var presets = [300, 180, 120, 90].map(function (sec) {
        return h('button', {
          type: 'button', class: 'chip', dataset: { sec: sec }, 'aria-pressed': Number(settings.goalSeconds) === sec,
          onClick: function () { goalInput.value = clock(sec); applyGoal(clock(sec)); }
        }, clock(sec));
      });
      goalInput.setAttribute('aria-describedby', goalErr.id);
      var goalCtl = h('div', { class: 'cc-goal' }, goalInput, presets, goalErr);

      // ---------------------------------------------- data
      function exportData() {
        var S = CC.Store;
        try {
          var json = S && S.exportJSON ? S.exportJSON(App.data) : JSON.stringify(App.data, null, 2);
          var name = 'cube-coach-backup-' + dayKey(new Date()) + '.json';
          var blob = new Blob([json], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = h('a', { href: url, download: name, style: { display: 'none' } });
          document.body.appendChild(a);
          a.click();
          var t = setTimeout(function () { revoke(url, a); }, 1500);
          pendingRevokes.push({ url: url, a: a, t: t });
          App.toast('Backup saved as ' + name + '. Look in your Downloads folder.', { kind: 'success' });
          return true;
        } catch (e) {
          console.error('[CC] export failed', e);
          App.toast('Couldn’t make the backup file: ' + (e && e.message ? e.message : 'unknown error'), { kind: 'error' });
          return false;
        }
      }
      function revoke(url, a) {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        if (a && a.parentNode) a.parentNode.removeChild(a);
        pendingRevokes = pendingRevokes.filter(function (p) { return p.url !== url; });
      }

      var fileInput = h('input', {
        type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true',
        onChange: function (e) {
          var f = e.target.files && e.target.files[0];
          e.target.value = '';
          if (f) readBackup(f);
        }
      });
      function readBackup(file) {
        var read = file.text ? file.text() : new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onload = function () { resolve(String(r.result || '')); };
          r.onerror = function () { reject(r.error || new Error('Could not read the file.')); };
          r.readAsText(file);
        });
        read.then(function (text) {
          if (disposed) return;
          var S = CC.Store;
          if (!S || !S.importJSON) throw new Error('Importing isn’t available right now.');
          var incoming = S.importJSON(text);
          var mine = (App.data.solves || []).length;
          var theirs = (incoming.solves || []).length;
          var body = h('div', { class: 'stack stack-sm' },
            h('p', null, 'This backup from “' + file.name + '” has ' + theirs + ' solve' + (theirs === 1 ? '' : 's') +
              ' and progress going back to ' + fmtDate(incoming.createdAt) + '.'),
            h('p', null, h('strong', null, 'Importing replaces everything on this computer'),
              mine ? ', including your current ' + mine + ' solve' + (mine === 1 ? '' : 's') + '. If you’re not sure, export a backup of what’s here first.' : '.'));
          return App.modal({
            title: 'Replace your progress with this backup?',
            body: body,
            actions: [{ label: 'Cancel' }, { label: 'Replace my progress', danger: true }]
          }).then(function (choice) {
            if (choice !== 'Replace my progress' || disposed) return;
            App.data = incoming;
            App.save();
            App.applyTheme(App.data.settings && App.data.settings.theme);
            App.toast('Backup imported. Welcome back.', { kind: 'success' });
            App.go('settings', {}, { replace: true });
          });
        }).catch(function (err) {
          if (disposed) return;
          App.toast((err && err.message) || 'That file couldn’t be imported.', { kind: 'error' });
        });
      }

      function resetAll() {
        var body = h('div', { class: 'stack stack-sm' },
          h('p', null, 'This erases everything Cube Coach remembers on this device:'),
          h('ul', null,
            h('li', null, 'every solve, time and stage split'),
            h('li', null, 'your mastery of each stage (all stages go back to Show)'),
            h('li', null, 'drill scores, algorithm flashcards, streak and milestones'),
            h('li', null, 'these settings')),
          h('p', null, h('strong', null, 'It can’t be undone.'), ' Export a backup first if you might want it back.'));
        App.modal({
          title: 'Reset everything?',
          body: body,
          actions: [
            { label: 'Export a backup first', onClick: function () { exportData(); return false; } },
            { label: 'Cancel', primary: true },
            { label: 'Erase everything', danger: true }
          ]
        }).then(function (choice) {
          if (choice !== 'Erase everything' || disposed) return;
          var S = CC.Store;
          var fresh = null;
          try { fresh = S && S.reset ? S.reset() : (S && S.defaults ? S.defaults() : null); } catch (e) { fresh = null; }
          App.data = fresh || (App._fallbackData ? App._fallbackData() : {});
          App.save();
          App.applyTheme(null);
          App.toast('Everything has been reset. A fresh start.', { kind: 'success' });
          App.go('home');
        });
      }

      var persistent = true;
      try { persistent = CC.Store && CC.Store.persistent ? CC.Store.persistent() : true; } catch (e) { persistent = true; }
      var stats = { solves: (data.solves || []).length, since: data.createdAt };

      // ---------------------------------------------- on your phone
      var plat = App.platform ? App.platform() : { ios: false, browser: 'other', standalone: false };
      var HOSTED = App.HOSTED_URL || 'https://pmcgroark.github.io/cube-coach/';
      function shareGlyph() { return h('span', { class: 'cc-share-glyph', role: 'img', 'aria-label': 'Share button' }, UI.icon('share', 14)); }
      function copyWithToast(text, okMsg) {
        return UI.copyText(text).then(function (ok) {
          if (disposed) return ok;
          App.toast(ok ? okMsg : 'Couldn’t copy automatically. Press and hold the text to copy it.', { kind: ok ? 'success' : 'warn' });
          return ok;
        });
      }
      var linkBtns = h('div', { class: 'cc-link__btns' },
        h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { copyWithToast(HOSTED, 'Link copied. Paste it into a message to yourself, or into your phone’s browser.'); } }, UI.icon('copy', 18), 'Copy link'),
        UI.canShare({ title: 'Cube Coach', url: HOSTED })
          ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { UI.shareText({ title: 'Cube Coach', text: 'Cube Coach — learn to solve the cube', url: HOSTED }); } }, UI.icon('share', 18), 'Share…')
          : null);
      var linkBox = h('div', { class: 'cc-link' }, h('div', { class: 'cc-link__url', id: id('url') }, HOSTED), linkBtns);
      // On a laptop, the quickest way onto the phone: point the iPhone camera at a QR code of the link
      // (icons/qr-cube-coach.svg, made by tools/make-icons.js from CC.App.HOSTED_URL).
      var qr = plat.phone ? null : h('figure', { class: 'cc-qr' },
        h('img', { src: 'icons/qr-cube-coach.svg', width: 148, height: 148, alt: 'QR code that opens ' + HOSTED, loading: 'lazy' }),
        h('figcaption', null, h('strong', null, 'Quickest way: '), 'open the Camera on your iPhone and point it at this code, then tap the link that appears.'));

      var yours = plat.ios ? (plat.browser === 'chrome' ? 'chrome' : plat.browser === 'safari' ? 'safari' : null) : null;
      function stepsCard(kind) {
        var isYours = yours === kind;
        var title = kind === 'chrome' ? 'Chrome on iPhone' : 'Safari on iPhone';
        var steps = kind === 'chrome' ? [
          ['Open the link above in ', h('strong', null, 'Chrome'), '.'],
          ['Tap the ', h('strong', null, 'Share'), ' button ', shareGlyph(), ' at the right of the address bar (or in the ', h('strong', null, '•••'), ' menu).'],
          ['Scroll down and tap ', h('strong', null, 'Add to Home Screen'), '.'],
          ['Tap ', h('strong', null, 'Add'), '. Cube Coach is now an app icon on your Home Screen.']
        ] : [
          ['Open the link above in ', h('strong', null, 'Safari'), '.'],
          ['Tap the ', h('strong', null, 'Share'), ' button ', shareGlyph(), ' (at the bottom, or in the ', h('strong', null, '•••'), ' menu on newer iPhones).'],
          ['Scroll down and tap ', h('strong', null, 'Add to Home Screen'), '. If you see “Open as Web App”, leave it on.'],
          ['Tap ', h('strong', null, 'Add'), '.']
        ];
        return h('section', { class: ['cc-steps', isYours ? 'is-yours' : null], 'aria-label': title },
          h('h3', null, title, isYours ? h('span', { class: 'badge badge-accent' }, 'Your browser') : null),
          h('ol', null, steps.map(function (s) { return h('li', null, s); })));
      }
      var stepsGrid = h('div', { class: 'cc-steps-grid' }, yours === 'safari' ? [stepsCard('safari'), stepsCard('chrome')] : [stepsCard('chrome'), stepsCard('safari')]);

      var offlineBox = h('div', { class: 'cc-offline', role: 'status', 'aria-live': 'polite' });
      var offlinePoll = null, offlinePolls = 0;
      function renderOffline(st) {
        if (disposed) return;
        UI.empty(offlineBox);
        offlineBox.className = 'cc-offline';
        var iconName = 'offline', title, text, action = null, busy = false;
        if (st.updateReady || App.updateReady) {
          offlineBox.classList.add('is-update');
          iconName = 'refresh';
          title = 'A new version is ready';
          text = 'Reload to start using it. Your progress is kept.';
          action = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: function () { App.applyUpdate(); } }, 'Reload');
        } else if (st.decision === 'register' && st.ready) {
          offlineBox.classList.add('is-ready');
          iconName = 'check';
          title = 'Offline ready ✓';
          text = 'Cube Coach is saved on this device and works without internet.' + (st.version ? ' (version ' + st.version + ')' : '');
        } else if (st.decision === 'register' && st.supported && !st.error) {
          busy = true;
          offlineBox.classList.add('is-busy');
          title = 'Getting ready for offline use…';
          text = st.total ? 'Saved ' + st.cached + ' of ' + st.total + ' files. Keep this page open for a moment.' : 'Saving the app on this device. Keep this page open for a moment.';
        } else if (st.decision === 'dev') {
          title = 'Offline copy is off on this computer';
          text = 'You’re running Cube Coach from this Mac (localhost), so it always loads the newest files. The link above gives you the offline, installable version.';
        } else if (st.decision === 'off') {
          title = 'Offline copy switched off';
          text = 'Remove “?sw=0” from the address to turn it back on.';
        } else if (st.decision === 'unsupported' || (st.decision === 'register' && !st.supported)) {
          title = 'This browser can’t keep an offline copy';
          text = 'Cube Coach still works here while you’re online. Chrome or Safari on an up-to-date iPhone can.';
        } else if (st.error) {
          title = 'Offline copy not available';
          text = 'Something stopped Cube Coach saving itself on this device (' + st.error + '). It still works while you’re online.';
        } else {
          title = 'Offline copy not available here';
          text = 'Open Cube Coach from the link above to get the offline, installable version.';
        }
        offlineBox.appendChild(h('span', { class: 'cc-offline__icon' }, busy ? h('span', { class: 'spinner' }) : UI.icon(iconName, 18)));
        offlineBox.appendChild(h('div', { class: 'cc-offline__text' }, h('strong', null, title), text));
        if (action) offlineBox.appendChild(action);
        clearTimeout(offlinePoll);
        if (busy && offlinePolls++ < 40) offlinePoll = setTimeout(refreshOffline, 1500);
      }
      function refreshOffline() {
        if (disposed || !App.offlineStatus) return;
        App.offlineStatus().then(renderOffline, function () { renderOffline({ decision: 'unavailable' }); });
      }
      function onSwEvent() { offlinePolls = 0; refreshOffline(); }
      root.addEventListener('cc:sw', onSwEvent);
      refreshOffline();

      var phoneIntro = plat.standalone
        ? UI.callout('success', 'You’re using the Home Screen app ✓', 'It keeps its own progress on this phone and works without internet.')
        : UI.callout('tip', null, plat.ios
          ? 'Add Cube Coach to your Home Screen: it opens full screen like an app and works without internet.'
          : 'Cube Coach also works on your iPhone, in Chrome or Safari. Send yourself the link, open it on the phone, then add it to the Home Screen so it opens like an app and works offline.');

      var phoneSection = section('phone', 'On your phone', null,
        phoneIntro,
        h('div', { class: 'cc-set-block' },
          h('div', { class: 'setting-row__title' }, 'The link'),
          linkBox, qr),
        h('div', { class: 'cc-set-block' },
          h('div', null,
            h('div', { class: 'setting-row__title' }, 'Add it to your Home Screen'),
            h('div', { class: 'setting-row__desc' }, 'Takes ten seconds. The icon opens Cube Coach full screen, like an app.')),
          plat.standalone ? h('details', { class: 'cc-details' }, h('summary', null, 'Show the steps'), stepsGrid) : stepsGrid,
          UI.callout('info', 'The Home Screen app keeps its own progress',
            'It doesn’t share progress with the browser tab or your laptop. Practise in one place, and use “Move my progress” below to bring progress over.')),
        h('div', { class: 'cc-set-block' },
          h('div', { class: 'setting-row__title' }, 'Works offline'),
          offlineBox));

      // ---------------------------------------------- move my progress
      var codeOut = h('textarea', {
        class: 'input cc-code', readonly: true, rows: 4, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
        'aria-label': 'Your progress code', hidden: true,
        onFocus: function (e) { try { e.target.select(); } catch (err) { /* ignore */ } }
      });
      var codeStatus = h('p', { class: 'cc-move-status', 'aria-live': 'polite' });
      function makeCode() {
        var S = CC.Store;
        if (!S || !S.exportCode) throw new Error('Progress codes aren’t available right now.');
        var code = S.exportCode(App.data);
        codeOut.value = code;
        codeOut.hidden = false;
        return code;
      }
      function codeInfo(code) { return fmtCount(code.length) + ' characters · ' + plural((App.data.solves || []).length, 'solve'); }
      function copyCode() {
        var code;
        try { code = makeCode(); } catch (e) { App.toast(e.message, { kind: 'error' }); return; }
        UI.copyText(code).then(function (ok) {
          if (disposed) return;
          codeStatus.className = 'cc-move-status' + (ok ? ' is-ok' : '');
          codeStatus.textContent = ok
            ? 'Copied ✓ (' + codeInfo(code) + '). Paste it into a message to yourself, then open Settings › Move my progress on the other device.'
            : 'Press and hold the code above, choose Select All, then Copy (' + codeInfo(code) + ').';
          if (!ok) { try { codeOut.focus(); codeOut.select(); } catch (e) { /* ignore */ } }
        });
      }
      function shareCode() {
        var code;
        try { code = makeCode(); } catch (e) { App.toast(e.message, { kind: 'error' }); return; }
        UI.shareText({ title: 'Cube Coach progress', text: code }).then(function (r) {
          if (disposed) return;
          if (r === 'shared') { codeStatus.className = 'cc-move-status is-ok'; codeStatus.textContent = 'Sent ✓ (' + codeInfo(code) + ').'; }
          else if (r === 'unsupported' || r === 'failed') copyCode();
        });
      }
      var sendBlock = h('div', { class: 'cc-move-step' },
        h('h3', null, '1. On the device that has your progress'),
        h('p', { class: 'small muted' }, 'Copy your progress code and send it to yourself: Messages, WhatsApp, Notes or email all work.'),
        h('div', { class: 'cc-data-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onClick: copyCode }, UI.icon('copy', 18), 'Copy progress code'),
          UI.canShare({ text: 'x' }) ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: shareCode }, UI.icon('share', 18), 'Share…') : null),
        codeOut, codeStatus);

      var pasteIn = h('textarea', {
        class: 'input cc-code', rows: 4, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
        placeholder: 'Paste the code here (it starts with CUBE1.)', 'aria-label': 'Paste a progress code',
        onInput: function () { clearTimeout(checkTimer); checkTimer = setTimeout(function () { if (/cube1\./i.test(pasteIn.value)) checkCode(true); }, 250); }
      });
      var checkTimer = null;
      var pasteStatus = h('p', { class: 'cc-move-status', 'aria-live': 'polite' });
      var previewHost = h('div');
      var canReadClipboard = !!(root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.readText === 'function');
      function pasteFromClipboard() {
        root.navigator.clipboard.readText().then(function (t) {
          if (disposed) return;
          pasteIn.value = t || '';
          checkCode(false);
        }, function () {
          if (disposed) return;
          pasteStatus.className = 'cc-move-status';
          pasteStatus.textContent = 'Press and hold in the box, then tap Paste.';
          try { pasteIn.focus(); } catch (e) { /* ignore */ }
        });
      }
      var lastChecked = null;
      function checkCode(quiet) {
        UI.empty(previewHost);
        var S = CC.Store;
        var incoming;
        try {
          if (!S || !S.importCode) throw new Error('Progress codes aren’t available right now.');
          incoming = S.importCode(pasteIn.value);
        } catch (e) {
          lastChecked = null;
          pasteStatus.className = 'cc-move-status is-err';
          pasteStatus.textContent = e.message;
          if (!quiet) try { pasteIn.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
          return;
        }
        lastChecked = incoming;
        pasteStatus.className = 'cc-move-status is-ok';
        pasteStatus.textContent = 'Code read ✓';
        var theirs = S.summary(incoming), mine = S.summary(App.data);
        var merged = S.merge(App.data, incoming);
        var added = merged.solves.length - (App.data.solves || []).length;
        var fmt = UI.fmtTime;
        previewHost.appendChild(h('div', { class: 'cc-preview' },
          h('div', { class: 'cc-preview__cols' },
            h('div', { class: 'cc-preview__col' }, h('h4', null, 'In this code'), h('ul', null, summaryLines(theirs, fmt).map(function (l) { return h('li', null, l); }))),
            h('div', { class: 'cc-preview__col' }, h('h4', null, 'On this device now'), h('ul', null, summaryLines(mine, fmt).map(function (l) { return h('li', null, l); })))),
          h('div', { class: 'cc-preview__choices' },
            h('button', { type: 'button', class: 'btn btn-primary cc-choice', onClick: function () { apply('merge'); } },
              h('span', null, 'Merge'), h('small', null, 'Keep everything from both. ' + (added > 0 ? 'Adds ' + plural(added, 'solve') + '.' : 'No new solves; skills and scores take the best of both.'))),
            h('button', { type: 'button', class: 'btn btn-secondary cc-choice', onClick: function () { apply('replace'); } },
              h('span', null, 'Replace'), h('small', null, 'Use only the code’s progress. What’s on this device now is removed.'))),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', style: { alignSelf: 'flex-start' }, onClick: function () { pasteIn.value = ''; UI.empty(previewHost); pasteStatus.textContent = ''; lastChecked = null; } }, 'Cancel')));
      }
      function apply(mode) {
        var S = CC.Store;
        if (!lastChecked || !S) return;
        var before = JSON.parse(JSON.stringify(App.data));
        function commit(next, msg) {
          App.data = next;
          App.save();
          App.applyTheme(App.data.settings && App.data.settings.theme);
          App.toast(msg, {
            kind: 'success', ms: 9000,
            action: { label: 'Undo', onClick: function () { App.data = before; App.save(); App.applyTheme(before.settings && before.settings.theme); App.toast('Undone. Your progress is as it was.'); if (App.current.id === 'settings') App.go('settings', { section: 'move' }, { replace: true }); } }
          });
          App.go('settings', { section: 'move' }, { replace: true });
        }
        if (mode === 'merge') {
          var merged = S.merge(App.data, lastChecked);
          var added = merged.solves.length - (App.data.solves || []).length;
          commit(merged, 'Progress merged: ' + plural(merged.solves.length, 'solve') + (added > 0 ? ' (' + added + ' new)' : '') + '.');
          return;
        }
        var mineCount = (App.data.solves || []).length;
        App.modal({
          title: 'Replace the progress on this device?',
          body: h('div', { class: 'stack stack-sm' },
            h('p', null, 'This device’s progress' + (mineCount ? ' (' + plural(mineCount, 'solve') + ')' : '') + ' will be replaced by the code’s progress (' + plural((lastChecked.solves || []).length, 'solve') + ').'),
            h('p', null, 'Your camera, theme and keyboard settings stay as they are. Merge is safer if you’re not sure.')),
          actions: [{ label: 'Cancel', primary: true }, { label: 'Replace', danger: true }]
        }).then(function (choice) {
          if (choice !== 'Replace' || disposed) return;
          commit(S.replace(App.data, lastChecked), 'Progress replaced with the code’s ' + plural((lastChecked.solves || []).length, 'solve') + '.');
        });
      }
      var receiveBlock = h('div', { class: 'cc-move-step' },
        h('h3', null, '2. On the device you want it on'),
        h('p', { class: 'small muted' }, 'Paste the code, check what’s in it, then merge it with what’s here.'),
        pasteIn,
        h('div', { class: 'cc-data-actions' },
          canReadClipboard ? h('button', { type: 'button', class: 'btn btn-secondary', onClick: pasteFromClipboard }, UI.icon('copy', 18), 'Paste') : null,
          h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { checkCode(false); } }, UI.icon('check', 18), 'Check code')),
        pasteStatus, previewHost);

      var moveSection = section('move', 'Move my progress', 'Your laptop and your phone keep separate progress. A progress code carries it from one to the other.',
        h('div', { class: 'cc-move-grid' }, sendBlock, receiveBlock),
        h('p', { class: 'small muted m-0' }, 'Tip: you can also save a backup file and open it on the other device (Your data, below).'));

      // ---------------------------------------------- jump links
      var SECTIONS = [['phone', 'On your phone'], ['move', 'Move my progress'], ['look', 'Appearance'], ['coach', 'Coaching'], ['keys', 'Keyboard'], ['camera', 'Camera'], ['timer', 'Timer & goal'], ['data', 'Your data'], ['about', 'Privacy']];
      function jumpTo(key, smooth) {
        var head = document.getElementById('cc-set-' + key + '-h');
        var sec = document.getElementById('cc-set-' + key);
        if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: smooth && !(UI.reducedMotion && UI.reducedMotion()) ? 'smooth' : 'auto', block: 'start' });
        if (head) { try { head.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }
      var jump = h('nav', { class: 'cc-set-jump', 'aria-label': 'Settings sections' }, SECTIONS.map(function (s) {
        return h('button', {
          type: 'button', class: 'chip',
          onClick: function () { jumpTo(s[0], true); }
        }, s[1]);
      }));

      // ---------------------------------------------- assemble
      el.appendChild(h('div', { class: 'cc-settings stack stack-lg container-narrow' },
        h('header', { class: 'page-head' },
          h('div', null,
            h('p', { class: 'eyebrow' }, 'Settings'),
            h('h1', null, 'Settings'),
            h('p', { class: 'muted' }, 'Changes save as you make them.'))),
        jump,

        phoneSection,
        moveSection,

        section('look', 'Appearance', null,
          row('Theme', 'Follow your device, or pick light or dark.', themeSeg, { label: false }),
          row('Animation speed', 'How fast the 3D cube turns in demos and hints. Slow it down while you’re learning.', speedCtl)),

        section('coach', 'Coaching', null,
          row('Pause and predict', 'During demos and coached solves, the coach stops now and then and asks what comes next. Guessing first is how you learn to anticipate.', toggle('anticipate')),
          h('div', { class: 'cc-set-block' },
            h('div', null,
              h('div', { class: 'setting-row__title' }, 'Guidance level'),
              h('div', { class: 'setting-row__desc' }, 'Show, Coach, Nudge and Solo are the four levels of help. Normally each stage moves down them by itself as you improve.')),
            guidance,
            guidanceNote),
          row('Skip the daisy (advanced cross)', 'Build the white cross straight onto the bottom instead of making the daisy first. It saves moves, but only switch it on once the daisy feels easy.', toggle('directCross'))),

        section('keys', 'Keyboard', 'Turn the virtual cube from the keyboard. Keys never fire while you’re typing in a box.',
          row('Keyboard moves', 'Which keys turn which layer.', kbSelect),
          h('div', { class: 'cc-set-block' },
            h('details', { class: 'cc-details' },
              h('summary', null, 'Show the key map', keyCount),
              legendHost))),

        section('camera', 'Camera', 'Used only to read the colours of your cube when you scan it.',
          row('Mirror the camera', 'Show the picture like a mirror, which is easier to follow while you turn the cube.', toggle('mirror')),
          row('Capture faces automatically', 'Grab each face as soon as you hold it steady. Turn off to press a button for each face instead.', toggle('autoCapture')),
          h('div', { class: 'cc-set-block' },
            row('Camera to use', 'Handy if your device has more than one.', camCtl),
            camHint)),

        section('timer', 'Timer & goal', null,
          row('15-second inspection', 'Before a timed solve, take up to 15 seconds to look the cube over before the clock starts, like in competitions.', toggle('inspection')),
          row('Split taps', 'In timed solves on your real cube, tap the space bar (or the screen) as you finish each stage, so Stats can show where the time goes.', toggle('splitTaps')),
          row('Goal time', 'The time you’re working towards for an unaided solve. 3:00 is the plan; lower it once you get there.', goalCtl)),

        section('data', 'Your data', null,
          persistent
            ? UI.callout('info', null, 'Your progress is saved in this browser on this device' + (stats.solves ? ' (' + stats.solves + ' solve' + (stats.solves === 1 ? '' : 's') + ' since ' + fmtDate(stats.since) + ')' : '') + '. Export a backup now and then. To copy it to another device, use Move my progress above.')
            : UI.callout('warn', 'This browser isn’t saving your progress', 'It may be a private window, or storage is blocked. Export a backup before you close this tab.'),
          h('div', { class: 'cc-set-block' },
            h('div', { class: 'cc-data-actions' },
              h('button', { type: 'button', class: 'btn btn-secondary', onClick: exportData }, UI.icon('arrowRight', 18), 'Export a backup'),
              h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { fileInput.click(); } }, UI.icon('refresh', 18), 'Import a backup'),
              fileInput),
            h('p', { class: 'small muted m-0' }, 'A backup is a small .json file with your solves, mastery, drill scores and settings. On an iPhone it goes to the Files app.')),
          h('div', { class: 'cc-set-block' },
            row('Welcome card', 'Show the “How Cube Coach works” card on the home screen again.',
              h('button', {
                type: 'button', class: 'btn btn-ghost btn-sm',
                onClick: function () { settings.welcomeDismissed = false; save(); App.toast('The welcome card is back on the home screen.'); }
              }, 'Show it again'), { label: false })),
          h('div', { class: 'cc-set-block' },
            row('Reset everything', 'Start again from scratch. Erases all progress on this device.',
              h('button', { type: 'button', class: 'btn btn-danger-ghost', onClick: resetAll }, UI.icon('alert', 18), 'Reset everything…'), { label: false }))),

        section('about', 'About & privacy', null,
          h('div', { class: 'cc-about stack stack-sm' },
            h('ul', null,
              h('li', null, h('strong', null, 'The camera picture never leaves this device. '), 'Cube Coach reads the sticker colours right here in your browser. No photo or video is saved or sent anywhere.'),
              h('li', null, h('strong', null, 'Your progress lives in this browser’s storage, '), 'not in the cloud and not on any server. Clearing your browsing data erases it, so keep a backup. A progress code only goes where you send it.'),
              h('li', null, h('strong', null, 'No accounts, no tracking. '), 'Cube Coach is a set of files your browser keeps (so it works offline). It doesn’t fetch anything else from the internet.')),
            h('p', { class: 'xsmall subtle' }, 'Cube Coach · data format v' + (data.version || 1) + ' · progress started ' + fmtDate(data.createdAt) + '.')))));

      if (params.section) setTimeout(function () { if (!disposed) jumpTo(String(params.section), false); }, 0);

      return function cleanup() {
        disposed = true;
        clearTimeout(offlinePoll);
        clearTimeout(checkTimer);
        root.removeEventListener('cc:sw', onSwEvent);
        pendingRevokes.slice().forEach(function (p) { clearTimeout(p.t); revoke(p.url, p.a); });
        pendingRevokes = [];
      };
    }
  };

  def._parseGoal = parseGoal;

  if (root.CC && root.CC.App) root.CC.App.registerScreen('settings', def);
  if (typeof module !== 'undefined' && module.exports) module.exports = def;
})(typeof window !== 'undefined' ? window : globalThis);
