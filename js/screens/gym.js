/* Cube Coach — Middle Layer Gym screen ('gym'). Stub: being built (see docs/MOBILE-AND-GYM.md). */
(function (root) {
  'use strict';
  function CC() { return root.CC || {}; }
  var def = {
    title: 'Middle Layer Gym',
    mount: function (el) {
      var h = CC().UI.h;
      el.appendChild(h('div', { class: 'card' }, h('h1', null, 'Middle Layer Gym'), h('p', null, 'Coming in a moment.')));
    }
  };
  if (CC().App && CC().App.registerScreen) CC().App.registerScreen('gym', def);
  else { root.CC = root.CC || {}; (root.CC.PendingScreens = root.CC.PendingScreens || []).push(['gym', def]); }
  if (typeof module !== 'undefined' && module.exports) module.exports = def;
})(typeof window !== 'undefined' ? window : globalThis);
