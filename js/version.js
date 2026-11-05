/*
 * version.js — shows the app version as the last line of the footer.
 * The version is the cache number in sw.js ('teslasound-v87' → "Version 87"),
 * which goes up on every release, so there is only one number to bump.
 */
(function () {
  'use strict';

  function show(v) {
    Array.prototype.forEach.call(document.querySelectorAll('.foot-made'), function (foot) {
      // The version links to what changed in it (changelog.html).
      var p = document.createElement('p'), a = document.createElement('a');
      p.className = 'made-version';
      a.href = 'changelog.html';
      a.textContent = 'Version ' + v;
      p.appendChild(a);
      foot.appendChild(p);
    });
  }

  function init() {
    if (!window.fetch || !document.querySelector('.foot-made')) return;
    fetch('sw.js').then(function (res) { return res.ok ? res.text() : ''; }).then(function (src) {
      var m = /teslasound-v(\d+)/.exec(src);
      if (m) show(m[1]);
    }).catch(function () { /* offline with no cached copy: leave the line out */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
