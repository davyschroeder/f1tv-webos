/* Minimal Shaka stand-in for the smoke test: records what the app asks of it. */
(function () {
  var filters = [];
  function NetEngine() {}
  NetEngine.prototype.registerRequestFilter = function (f) { filters.push(f); };
  NetEngine.RequestType = { MANIFEST: 0, SEGMENT: 1, LICENSE: 2 };
  function Player(video) { this.video = video; this.cfg = {}; this.listeners = {}; }
  Player.version = 'stub';
  Player.isBrowserSupported = function () { return true; };
  Player.prototype.addEventListener = function (n, f) { this.listeners[n] = f; };
  Player.prototype.getNetworkingEngine = function () { return new NetEngine(); };
  Player.prototype.configure = function (c) { for (var k in c) this.cfg[k] = c[k]; };
  Player.prototype.load = function (url, start, mime) {
    var req = { headers: {} };
    for (var i = 0; i < filters.length; i++) filters[i](NetEngine.RequestType.LICENSE, req);
    window.__stubLoaded = { url: url, mime: mime, drm: this.cfg.drm && this.cfg.drm.servers['com.widevine.alpha'], licHeaders: req.headers };
    return Promise.resolve();
  };
  Player.prototype.isLive = function () { return true; };
  Player.prototype.getAudioLanguages = function () { return ['en', 'nl']; };
  Player.prototype.getVariantTracks = function () { return [{ active: true, language: 'en' }]; };
  Player.prototype.selectAudioLanguage = function () {};
  Player.prototype.seekRange = function () { return { start: 0, end: 100 }; };
  Player.prototype.unload = function () { return Promise.resolve(); };
  window.shaka = { Player: Player, polyfill: { installAll: function () {} }, net: { NetworkingEngine: NetEngine } };
})();
