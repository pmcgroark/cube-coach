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
    '.cc-about li + li { margin-top: var(--space-2); }'
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
    mount: function (el) {
      injectStyle();
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
          h('p', null, 'This erases everything Cube Coach remembers on this computer:'),
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

      // ---------------------------------------------- jump links
      var SECTIONS = [['look', 'Appearance'], ['coach', 'Coaching'], ['keys', 'Keyboard'], ['camera', 'Camera'], ['timer', 'Timer & goal'], ['data', 'Your data'], ['about', 'Privacy']];
      var jump = h('nav', { class: 'cc-set-jump', 'aria-label': 'Settings sections' }, SECTIONS.map(function (s) {
        return h('button', {
          type: 'button', class: 'chip',
          onClick: function () {
            var head = document.getElementById('cc-set-' + s[0] + '-h');
            var sec = document.getElementById('cc-set-' + s[0]);
            if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: UI.reducedMotion && UI.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
            if (head) { try { head.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
          }
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

        section('look', 'Appearance', null,
          row('Theme', 'Follow your computer, or pick light or dark.', themeSeg, { label: false }),
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
            row('Camera to use', 'Handy if your computer has more than one.', camCtl),
            camHint)),

        section('timer', 'Timer & goal', null,
          row('15-second inspection', 'Before a timed solve, take up to 15 seconds to look the cube over before the clock starts, like in competitions.', toggle('inspection')),
          row('Split taps', 'In timed solves on your real cube, tap the space bar (or the screen) as you finish each stage, so Stats can show where the time goes.', toggle('splitTaps')),
          row('Goal time', 'The time you’re working towards for an unaided solve. 3:00 is the plan; lower it once you get there.', goalCtl)),

        section('data', 'Your data', null,
          persistent
            ? UI.callout('info', null, 'Your progress is saved in this browser on this computer' + (stats.solves ? ' (' + stats.solves + ' solve' + (stats.solves === 1 ? '' : 's') + ' since ' + fmtDate(stats.since) + ')' : '') + '. Export a backup now and then, or to move to another computer.')
            : UI.callout('warn', 'This browser isn’t saving your progress', 'It may be a private window, or storage is blocked. Export a backup before you close this tab.'),
          h('div', { class: 'cc-set-block' },
            h('div', { class: 'cc-data-actions' },
              h('button', { type: 'button', class: 'btn btn-secondary', onClick: exportData }, UI.icon('arrowRight', 18), 'Export a backup'),
              h('button', { type: 'button', class: 'btn btn-secondary', onClick: function () { fileInput.click(); } }, UI.icon('refresh', 18), 'Import a backup'),
              fileInput),
            h('p', { class: 'small muted m-0' }, 'A backup is a small .json file with your solves, mastery, drill scores and settings.')),
          h('div', { class: 'cc-set-block' },
            row('Welcome card', 'Show the “How Cube Coach works” card on the home screen again.',
              h('button', {
                type: 'button', class: 'btn btn-ghost btn-sm',
                onClick: function () { settings.welcomeDismissed = false; save(); App.toast('The welcome card is back on the home screen.'); }
              }, 'Show it again'), { label: false })),
          h('div', { class: 'cc-set-block' },
            row('Reset everything', 'Start again from scratch. Erases all progress on this computer.',
              h('button', { type: 'button', class: 'btn btn-danger-ghost', onClick: resetAll }, UI.icon('alert', 18), 'Reset everything…'), { label: false }))),

        section('about', 'About & privacy', null,
          h('div', { class: 'cc-about stack stack-sm' },
            h('ul', null,
              h('li', null, h('strong', null, 'The camera picture never leaves this computer. '), 'Cube Coach reads the sticker colours right here in your browser. No photo or video is saved or sent anywhere.'),
              h('li', null, h('strong', null, 'Your progress lives in this browser’s storage, '), 'not in the cloud and not on any server. Clearing your browsing data erases it, so keep a backup.'),
              h('li', null, h('strong', null, 'No accounts, no tracking. '), 'The only thing fetched from the internet is the 3D drawing library. Without it, you get a flat cube and everything else still works.')),
            h('p', { class: 'xsmall subtle' }, 'Cube Coach · data format v' + (data.version || 1) + ' · progress started ' + fmtDate(data.createdAt) + '.')))));

      return function cleanup() {
        disposed = true;
        pendingRevokes.slice().forEach(function (p) { clearTimeout(p.t); revoke(p.url, p.a); });
        pendingRevokes = [];
      };
    }
  };

  def._parseGoal = parseGoal;

  if (root.CC && root.CC.App) root.CC.App.registerScreen('settings', def);
  if (typeof module !== 'undefined' && module.exports) module.exports = def;
})(typeof window !== 'undefined' ? window : globalThis);
