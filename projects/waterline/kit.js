// Shared runtime for project pages. Load it synchronously in <head>.
//
// Kit.preview        true when the page was opened with ?preview (a card on projects.html)
// Kit.reducedMotion  true when the visitor prefers reduced motion
// Kit.playing        whether animation should run right now
// Kit.onPlay(cb)     cb(playing) now and on every change
//
// An embedded preview stays paused until projects.html posts {kit: "play"}, and pauses
// again on {kit: "pause"} or when the tab is hidden. A preview never plays under reduced
// motion, so a paused stage must still draw a representative still frame.
(function () {
  var params = new URLSearchParams(location.search);
  var preview = params.has('preview');
  var embedded = window.parent !== window;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var wanted = !(preview && embedded);
  var listeners = [];
  var last = null;

  if (preview) document.documentElement.classList.add('kit-preview');

  function playing() {
    var reduced = !!(mq && mq.matches);
    return wanted && !document.hidden && !(preview && reduced);
  }

  function update() {
    var now = playing();
    if (now === last) return;
    last = now;
    listeners.slice().forEach(function (cb) { cb(now); });
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || !event.data) return;
    if (event.data.kit === 'play') wanted = true;
    else if (event.data.kit === 'pause') wanted = false;
    else return;
    update();
  });
  document.addEventListener('visibilitychange', update);
  if (mq && mq.addEventListener) mq.addEventListener('change', update);

  window.Kit = {
    preview: preview,
    embedded: embedded,
    get reducedMotion() { return !!(mq && mq.matches); },
    get playing() { return playing(); },
    onPlay: function (cb) {
      listeners.push(cb);
      last = playing();
      cb(last);
    }
  };
})();
