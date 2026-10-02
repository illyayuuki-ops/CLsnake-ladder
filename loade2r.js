/**
 * SplashLoader: reusable game loading screen.
 *
 *   var loader = new SplashLoader({ title, logo, messages, tiles, onComplete });
 *   loader.setProgress(0.5);   // 0 to 1
 *   loader.complete();         // jump to 100% and finish
 *   loader.simulate(5000);     // fake progress (for testing)
 *   loader.hide();             // fade the splash out
 */
(function (global) {
  function SplashLoader(opts) {
    opts = opts || {};
    this.tiles = opts.tiles || 12;
    this.messages = opts.messages || ['Loading'];
    this.onComplete = opts.onComplete || function () {};
    this.autoHide = opts.autoHide !== false;      // fade out when finished
    this.hideDelay = opts.hideDelay == null ? 900 : opts.hideDelay;
    this.shown = 0;
    this.finished = false;

    var $ = function (id) { return document.getElementById(id); };
    this.root = $('splash'); this.board = $('splash-board'); this.tok = $('tok');
    this.ring = $('ring'); this.pct = $('pct'); this.msg = $('msg');
    if (opts.title) $('title').textContent = opts.title;
    if (opts.logo) $('logo').src = opts.logo;

    this.board.innerHTML = '';
    this.sq = [];
    for (var i = 0; i < this.tiles; i++) {
      var d = document.createElement('div');
      d.className = 'sq c' + (i % 4);
      this.board.appendChild(d);
      this.sq.push(d);
    }
    this.board.style.gridTemplateColumns = 'repeat(' + this.tiles + ',1fr)';
    this.tok.style.width = 'calc((100% - ' + (this.tiles - 1) * 4 + 'px)/' + this.tiles + ')';
    this.setProgress(0);
  }

  SplashLoader.prototype.setProgress = function (p) {
    p = Math.max(0, Math.min(1, p));
    if (p < this.shown) return;                   // never go backwards
    this.shown = p;
    var n = Math.floor(p * this.tiles), self = this;
    this.sq.forEach(function (e, i) { e.classList.toggle('on', i < n); });
    var step = (this.board.clientWidth + 4) / this.tiles;
    this.tok.style.transform = 'translateX(' + Math.min(n, this.tiles - 1) * step + 'px)';
    this.ring.style.strokeDashoffset = 1000 - 1000 * p;
    this.pct.textContent = Math.round(p * 100) + '%';
    this.msg.textContent = this.messages[Math.min(Math.floor(p * this.messages.length), this.messages.length - 1)];
    if (p >= 1 && !this.finished) {
      this.finished = true;
      this.root.classList.add('done');
      setTimeout(function () {
        self.onComplete();
        if (self.autoHide) self.hide();
      }, this.hideDelay);
    }
  };

  SplashLoader.prototype.complete = function () { this.setProgress(1); };
  SplashLoader.prototype.hide = function () { this.root.classList.add('hide'); };

  SplashLoader.prototype.simulate = function (ms) {
    var self = this, t0 = null;
    function frame(t) {
      if (!t0) t0 = t;
      var x = Math.min((t - t0) / ms, 1);
      self.setProgress(x < 0.5 ? x * 1.3 : 0.65 + (x - 0.5) * 0.7);
      if (x < 1) requestAnimationFrame(frame); else self.complete();
    }
    requestAnimationFrame(frame);
  };

  global.SplashLoader = SplashLoader;
})(window);
