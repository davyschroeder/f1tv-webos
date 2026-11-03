/*
 * F1 TV (onofficieel) voor LG webOS — single-file app, ES5 omdat de tv Chromium 53 draait.
 *
 * Flow: device-code login (id.formula1.com) → MENU + PAGE-API (f1tv.formula1.com) generiek gerenderd
 * (hero, rijen, weekend-banner, schema) → feeds van een sessie → entitlement (PLAY) → Shaka + Widevine.
 * Gele knop = debug-log aan/uit. API-details afgekeken van open-source clients (F1AppleTV, RaceControl, F1-Web-Viewer).
 */
(function () {
  'use strict';

  var CFG = {
    clientId: '13c21153-f2f3-484b-a642-f2a2927e55de',          // publieke tv-client van F1 (device-code grant, geen secret)
    oauthBase: 'https://id.formula1.com/as/',
    catalogBase: 'https://f1tv.formula1.com/',
    accountBase: 'https://api.formula1.com/',
    apiKey: 'fCUCjWrKPu9ylJwRAv8BpGLEgiAuThx7',                 // publieke web-apikey, staat ook in de F1TV-website zelf
    systemId: '60a9ad84-e93d-480f-80d6-af37494f2e22',
    lang: 'ENG',
    catalogProvider: 'WEB_HLS',                                 // voor menu/pagina's/lijsten (volledige catalogus)
    playProviders: ['BIG_SCREEN_DASH', 'WEB_DASH', 'BIG_SCREEN_HLS', 'WEB_HLS'], // voor afspelen: eerste bruikbare wint
    entitlement: 'F1_TV_Pro_Annual/14',
    deviceInfo: 'device=web;screen=bigscreen;os=webos;model=lgtv;osVersion=4.5;appVersion=0.2.0;playerVersion=4.3.6',
    shakaUrls: [
      'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.3.6/shaka-player.compiled.min.js',
      'https://cdn.jsdelivr.net/npm/shaka-player@4.3.6/dist/shaka-player.compiled.min.js'
    ],
    seekStep: 15,
    overlayMs: 4000
  };

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412,
              RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };

  /* ======================================================================
   * Hulpfuncties
   * ====================================================================== */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function qs(obj) {
    var parts = [];
    for (var k in obj) if (obj.hasOwnProperty(k) && obj[k] !== undefined && obj[k] !== null) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    return parts.join('&');
  }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
  }
  function b64urlDecode(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
  }
  function decodeJwt(token) {
    if (!token || typeof token !== 'string') return null;
    var p = token.split('.');
    if (p.length !== 3) return null;
    try { return JSON.parse(b64urlDecode(p[1])); } catch (e) { return null; }
  }
  function redact(s) { return String(s).replace(/(token=)[^&]+/gi, '$1…').replace(/eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, '<jwt>'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(ms) { var d = new Date(Number(ms)); return isNaN(d.getTime()) ? '' : pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function imgUrl(pictureUrl, w, h) {
    if (!pictureUrl) return '';
    if (/^https?:\/\//.test(pictureUrl)) return pictureUrl;
    return CFG.catalogBase + 'image-resizer/image/' + String(pictureUrl).replace(/^\//, '') + '?w=' + w + '&h=' + h + '&q=HI&o=L';
  }

  var Store = {
    get: function (k, def) { try { var v = localStorage.getItem('f1tv.' + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem('f1tv.' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('f1tv.' + k); } catch (e) {} }
  };

  var Debug = {
    lines: [], visible: false,
    log: function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        parts.push(typeof a === 'string' ? a : (function () { try { return JSON.stringify(a); } catch (e) { return String(a); } })());
      }
      var line = new Date().toTimeString().slice(0, 8) + ' ' + redact(parts.join(' '));
      this.lines.push(line.length > 400 ? line.slice(0, 400) + '…' : line);
      if (this.lines.length > 80) this.lines.shift();
      try { console.log(line); } catch (e) {}
      if (this.visible) this.render();
    },
    toggle: function () { this.visible = !this.visible; $('debug').className = 'debug' + (this.visible ? '' : ' hidden'); this.render(); },
    render: function () { $('debug-pre').textContent = this.lines.slice(-40).join('\n'); }
  };

  /* XHR-wrapper: cb(err, {status, text, json}). err alleen bij netwerkfout/timeout. */
  function http(opts, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; try { x.abort(); } catch (e) {} cb(new Error('timeout')); } }, opts.timeout || 20000);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || done) return;
      done = true; clearTimeout(timer);
      var res = { status: x.status, text: x.responseText || '', json: null };
      try { res.json = JSON.parse(res.text); } catch (e) {}
      if (x.status === 0) { cb(new Error('netwerkfout (status 0)'), res); return; }
      cb(null, res);
    };
    try {
      x.open(opts.method || 'GET', opts.url, true);
      var h = opts.headers || {};
      for (var k in h) if (h.hasOwnProperty(k)) { try { x.setRequestHeader(k, h[k]); } catch (e) {} }
      x.send(opts.body !== undefined ? opts.body : null);
    } catch (e) { done = true; clearTimeout(timer); cb(e); }
  }

  /* ======================================================================
   * Auth: device-code login + refresh
   * ====================================================================== */
  var Auth = {
    session: null,          // { refreshToken, accessExp, subscriptionToken, subExp, sessionId, profile }
    playbackSessionId: 'WEB-' + uuid(),
    loginRun: 0,

    load: function () { this.session = Store.get('session', null); return this.session; },
    save: function (s) { this.session = s; if (s) Store.set('session', s); else Store.del('session'); },

    parseTokens: function (json, previous) {
      if (!json || !json.access_token) throw new Error('geen access_token');
      var access = decodeJwt(json.access_token) || {};
      var subToken = access.subscriptionToken || (previous && previous.subscriptionToken);
      if (!subToken) throw new Error('geen subscriptionToken in antwoord');
      var claims = decodeJwt(subToken) || {};
      var subExp = (claims.exp || 0) * 1000;
      if (subExp && subExp < Date.now()) throw new Error('subscriptionToken verlopen');
      return {
        refreshToken: json.refresh_token || (previous && previous.refreshToken) || null,
        accessExp: Date.now() + (Number(json.expires_in) || 3600) * 1000,
        subscriptionToken: subToken, subExp: subExp,
        sessionId: claims.SessionId || (previous && previous.sessionId) || null,
        profile: { firstName: claims.FirstName || '', lastName: claims.LastName || '', email: claims.Email || '', country: claims.HomeCountry || '', status: claims.SubscriptionStatus || '' }
      };
    },

    form: function (path, fields, cb) {
      http({ method: 'POST', url: CFG.oauthBase + path, body: qs(fields), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' } }, cb);
    },

    /* onCode({userCode, verificationUri, verificationUriComplete}); onDone(err, session) */
    startDeviceLogin: function (onCode, onDone) {
      var self = this;
      var run = ++this.loginRun;
      this.form('device_authorization', { client_id: CFG.clientId, scope: 'openid f1tv_groups' }, function (err, res) {
        if (run !== self.loginRun) return;
        Debug.log('device_authorization', err ? String(err) : res.status, res && res.text ? res.text.slice(0, 200) : '');
        if (err) return onDone(err);
        var j = res.json;
        if (res.status !== 200 || !j || !j.device_code || !j.user_code) return onDone(new Error('login-service gaf HTTP ' + res.status));
        onCode({ userCode: j.user_code, verificationUri: j.verification_uri, verificationUriComplete: j.verification_uri_complete || j.verification_uri });
        var interval = (Number(j.interval) || 5) * 1000;
        var expires = Date.now() + (Number(j.expires_in) || 600) * 1000;
        (function poll() {
          if (run !== self.loginRun) return;
          if (Date.now() > expires) return onDone(new Error('expired'));
          setTimeout(function () {
            if (run !== self.loginRun) return;
            self.form('token', { client_id: CFG.clientId, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: j.device_code }, function (err2, res2) {
              if (run !== self.loginRun) return;
              if (err2) { Debug.log('token poll fout', String(err2)); return poll(); }
              if (res2.status === 200) {
                try { var s = self.parseTokens(res2.json, null); self.save(s); Debug.log('ingelogd als', s.profile.email, 'sub exp', new Date(s.subExp).toISOString()); return onDone(null, s); }
                catch (e) { Debug.log('token parse fout', String(e), res2.text.slice(0, 300)); return onDone(e); }
              }
              var oe = res2.json && res2.json.error;
              Debug.log('token poll', res2.status, oe || res2.text.slice(0, 120));
              if (oe === 'authorization_pending') return poll();
              if (oe === 'slow_down') { interval += 5000; return poll(); }
              if (res2.status >= 500) { interval = Math.min(interval * 2, 60000); return poll(); }
              if (oe === 'access_denied') return onDone(new Error('denied'));
              if (oe === 'expired_token') return onDone(new Error('expired'));
              return onDone(new Error('login geweigerd: ' + (oe || res2.status)));
            });
          }, interval);
        })();
      });
    },

    cancelLogin: function () { this.loginRun++; },

    refresh: function (cb) {
      var self = this, s = this.session;
      if (!s || !s.refreshToken) return cb(new Error('geen refresh token'));
      this.form('token', { client_id: CFG.clientId, grant_type: 'refresh_token', refresh_token: s.refreshToken }, function (err, res) {
        Debug.log('refresh', err ? String(err) : res.status, res && res.json && res.json.error ? res.json.error : '');
        if (err) return cb(err);
        if (res.status === 400 && res.json && res.json.error === 'invalid_grant') { self.save(null); return cb(new Error('invalid_grant')); }
        if (res.status !== 200) return cb(new Error('refresh HTTP ' + res.status));
        try { var ns = self.parseTokens(res.json, s); self.save(ns); cb(null, ns); }
        catch (e) { if (String(e).indexOf('verlopen') >= 0) self.save(null); cb(e); }
      });
    },

    retrieveSubscriber: function (cb) {
      var self = this, s = this.session;
      if (!s || !s.sessionId) return cb(new Error('geen sessie'));
      http({ method: 'POST', url: CFG.accountBase + 'v1/account/Subscriber/RetrieveSubscriber', body: '{}',
             headers: { 'Content-Type': 'application/json', 'apikey': CFG.apiKey, 'CD-SystemID': CFG.systemId, 'CD-Language': CFG.lang, 'CD-SessionID': s.sessionId } },
        function (err, res) {
          Debug.log('RetrieveSubscriber', err ? String(err) : res.status);
          if (err || res.status !== 200 || !res.json || !res.json.data || !res.json.data.subscriptionToken) return cb(err || new Error('RetrieveSubscriber HTTP ' + (res && res.status)));
          var claims = decodeJwt(res.json.data.subscriptionToken) || {};
          s.subscriptionToken = res.json.data.subscriptionToken; s.subExp = (claims.exp || 0) * 1000; s.sessionId = claims.SessionId || s.sessionId;
          self.save(s); cb(null, s);
        });
    },

    /* Zorgt voor een geldige subscriptionToken: cb(err, token). err 'login' = opnieuw inloggen nodig. */
    ensure: function (cb) {
      var self = this, s = this.session;
      if (!s) return cb(new Error('login'));
      var now = Date.now();
      var subOk = !s.subExp || s.subExp - now > 60000;
      if (subOk && s.accessExp - now > 60000) return cb(null, s.subscriptionToken);
      this.refresh(function (err, ns) {
        if (!err && ns.subExp - Date.now() > 60000) return cb(null, ns.subscriptionToken);
        if (!self.session) return cb(new Error('login'));
        self.retrieveSubscriber(function (err2, rs) {
          if (!err2 && rs.subExp - Date.now() > 60000) return cb(null, rs.subscriptionToken);
          if (subOk) return cb(null, self.session.subscriptionToken);
          self.save(null); cb(new Error('login'));
        });
      });
    },

    authHeaders: function (token, entitlementToken) {
      return { 'ascendontoken': token, 'entitlementtoken': entitlementToken || token, 'sessionid': this.playbackSessionId, 'x-f1-device-info': CFG.deviceInfo };
    }
  };

  /* ======================================================================
   * Catalogus-API: menu, pagina's, feeds, entitlement
   * ====================================================================== */
  var Api = {
    playProvider: Store.get('provider', null),
    cache: {},

    resolve: function (uri) {
      var u = String(uri);
      if (/^https?:\/\//.test(u)) { if (u.indexOf(CFG.catalogBase) !== 0) return null; u = u.slice(CFG.catalogBase.length - 1); }
      u = u.replace(/^\//, '');
      // provider-segment vervangen door onze catalogus-provider (zoals de officiële clients doen)
      u = u.replace(/^(\d\.\d\/[RA]\/[A-Z]{3}\/)[A-Z_]+(\/ALL\/)/, '$1' + CFG.catalogProvider + '$2');
      return u;
    },

    get: function (path, headers, cb) {
      http({ method: 'GET', url: CFG.catalogBase + path, headers: headers || {} }, function (err, res) {
        var rc = res && res.json && res.json.resultCode;
        Debug.log('GET', path.slice(0, 110), err ? String(err) : res.status, rc || (res ? res.text.slice(0, 80) : ''));
        if (err) return cb(err);
        if (!res.json) return cb(new Error('geen JSON (HTTP ' + res.status + ')'), null, res);
        cb(null, res.json, res);
      });
    },

    action: function (node, key) {
      var a = node && node.actions;
      if (!a || !a.length) return null;
      for (var i = 0; i < a.length; i++) if (a[i] && a[i].key === key && a[i].uri) return a[i];
      return null;
    },

    menu: function (cb) {
      var self = this;
      this.get('2.0/R/' + CFG.lang + '/' + CFG.catalogProvider + '/ALL/MENU/PREMIUM/14', null, function (err, json) {
        if (err) return cb(err);
        var cs = (json.resultObj && json.resultObj.containers) || [];
        var tabs = [];
        for (var i = 0; i < cs.length; i++) {
          var n = cs[i], label = n.metadata && n.metadata.label, a = self.action(n, 'onClick');
          if (!label || !a || (a.targetType && a.targetType !== 'PAGE')) continue;
          var uri = self.resolve(a.uri);
          if (!uri || uri.indexOf('PAGE/') < 0) continue;
          tabs.push({ title: label, uri: uri });
        }
        if (!tabs.length) { Debug.log('menu leeg; keys:', cs[0] ? Object.keys(cs[0]).join(',') : '-'); tabs.push({ title: 'Home', uri: '2.0/R/' + CFG.lang + '/' + CFG.catalogProvider + '/ALL/PAGE/395/' + CFG.entitlement }); }
        cb(null, tabs);
      });
    },

    item: function (node) {
      var m = node.metadata || {}, emf = m.emfAttributes || {};
      var ct = String(m.contentType || m.objectType || '').toUpperCase();
      var cid = m.contentId || node.contentId || null;
      var onClick = this.action(node, 'onClick');
      var sub = String(m.contentSubtype || '').toUpperCase();
      var it = {
        title: m.title || m.titleBrief || m.label || emf.Global_Meeting_Name || '',
        label: m.label || (emf.Series && emf.Global_Meeting_Name ? emf.Series + ': ' + emf.Global_Meeting_Name : (emf.Global_Meeting_Name || '')),
        desc: m.longDescription || '',
        pictureUrl: m.pictureUrl || (node.platformVariants && node.platformVariants[0] && node.platformVariants[0].pictureUrl) || '',
        contentId: cid, isVideo: ct === 'VIDEO' && !!cid,
        subtype: sub, duration: m.uiDuration || '',
        series: emf.Series || (node.properties && node.properties[0] && node.properties[0].series) || '',
        live: sub === 'LIVE' || m.isOnAir === true,
        isSession: emf.VideoType === 'meetingSession' || (m.additionalStreams && m.additionalStreams.length > 0),
        start: emf.sessionStartDate || null, end: emf.sessionEndDate || null,
        emf: emf,
        pageUri: onClick ? this.resolve(onClick.uri) : null
      };
      it.playbackUrl = cid ? 'CONTENT/PLAY?contentId=' + cid : null;
      return it;
    },

    /* Pagina → secties: {type:'hero'|'gp'|'row'|'schedule'|'heading', ...} */
    parsePage: function (json) {
      var self = this;
      var out = { sections: [], live: [] };
      var cs = (json.resultObj && json.resultObj.containers) || [];
      var pending = null;
      for (var i = 0; i < cs.length; i++) {
        var n = cs[i], layout = String(n.layout || '');
        var skip = false, acts = n.actions || [];
        for (var k = 0; k < acts.length; k++) if (acts[k] && acts[k].uri && (/\/CONTENT\/WATCHING\//.test(acts[k].uri) || /\/USERSELECTIONS\//.test(acts[k].uri))) skip = true;
        if (skip) continue; // persoonlijke rijen (Continue Watching) hebben andere auth; later
        var raw = (n.retrieveItems && n.retrieveItems.resultObj && n.retrieveItems.resultObj.containers) || [];
        var label = (n.metadata && n.metadata.label) || '';
        var items = [], j;
        if (layout === 'CONTENT_ITEM') {
          if (!pending) { pending = { type: 'row', title: label, items: [], poster: false }; out.sections.push(pending); }
          pending.items.push(self.item(n)); continue;
        }
        pending = null;
        if (layout === '__page_header') continue;
        if (layout === 'title' || layout === 'subtitle') { if (label) out.sections.push({ type: 'heading', title: label }); continue; }
        if (layout === 'hero') {
          for (j = 0; j < raw.length; j++) items.push(self.item(raw[j]));
          if (items.length) out.sections.push({ type: 'hero', items: items });
          continue;
        }
        if (layout === 'gp_banner') {
          out.sections.push({ type: 'gp', item: self.item(raw[0] || n) });
          continue;
        }
        if (layout === 'interactive_schedule') {
          var days = [];
          for (j = 0; j < raw.length; j++) {
            var g = raw[j], evs = [];
            var ge = g.events || [];
            for (var e = 0; e < ge.length; e++) evs.push(self.item(ge[e]));
            if (evs.length) days.push({ name: g.eventShortName || g.eventName || '', events: evs });
          }
          if (days.length) out.sections.push({ type: 'schedule', days: days });
          continue;
        }
        for (j = 0; j < raw.length; j++) items.push(self.item(raw[j]));
        if (!items.length) { if (layout) Debug.log('sectie zonder items', layout, label); continue; }
        var va = self.action(n, 'onTitleClick');
        out.sections.push({ type: 'row', title: label, items: items, poster: /poster/i.test(layout) || /^vertical/i.test(layout), viewAll: va ? self.resolve(va.uri) : null });
      }
      // live-items verzamelen (voor de LIVE-tab)
      for (var s = 0; s < out.sections.length; s++) {
        var sec = out.sections[s], list = sec.items || [];
        if (sec.type === 'schedule') { list = []; for (var d = 0; d < sec.days.length; d++) list = list.concat(sec.days[d].events); }
        for (var q = 0; q < list.length; q++) if (list[q].live && list[q].isVideo) out.live.push(list[q]);
      }
      return out;
    },

    page: function (uri, cb) {
      var self = this;
      if (this.cache[uri] && Date.now() - this.cache[uri].t < 120000) return cb(null, this.cache[uri].page);
      this.get(uri, null, function (err, json) {
        if (err) return cb(err);
        if (json.resultCode && json.resultCode !== 'OK') return cb(new Error('resultCode ' + json.resultCode));
        var page = self.parsePage(json);
        if (!page.sections.length) {
          var cs = (json.resultObj && json.resultObj.containers) || [];
          Debug.log('pagina zonder secties; layouts:', cs.map(function (c) { return c.layout; }).join(','));
        }
        self.cache[uri] = { t: Date.now(), page: page };
        cb(null, page);
      });
    },

    /* Feeds van een sessie: hoofdfeed + additionalStreams (onboards, pitlane, data). */
    channels: function (contentId, cb) {
      this.get('3.0/R/' + CFG.lang + '/' + CFG.catalogProvider + '/ALL/CONTENT/VIDEO/' + contentId + '/' + CFG.entitlement, null, function (err, json) {
        if (err) return cb(err);
        var cs = (json.resultObj && json.resultObj.containers) || [];
        var meta = (cs[0] && cs[0].metadata) || {};
        var feeds = [{ title: 'Hoofduitzending', type: 'main', playbackUrl: 'CONTENT/PLAY?contentId=' + contentId }];
        var add = meta.additionalStreams || [];
        for (var i = 0; i < add.length; i++) {
          var a = add[i];
          feeds.push({
            title: a.title || (a.driverFirstName ? a.driverFirstName + ' ' + a.driverLastName : 'Feed ' + (i + 1)),
            type: a.type || 'additional', playbackUrl: a.playbackUrl, racingNumber: a.racingNumber,
            teamName: a.teamName || a.constructorName || '', hex: a.hex, driver: !!a.driverFirstName
          });
        }
        cb(null, feeds, meta);
      });
    },

    /* Entitlement: {url, isDash, isHls, drmType, laURL, entitlementToken}. Probeert providers tot er een bruikbare stream is. */
    entitlement: function (playbackUrl, token, cb) {
      var self = this;
      var order = CFG.playProviders.slice();
      if (this.playProvider && order.indexOf(this.playProvider) > 0) { order.splice(order.indexOf(this.playProvider), 1); order.unshift(this.playProvider); }
      var tried = [];
      (function next(i) {
        if (i >= order.length) return cb(new Error('geen bruikbare stream (' + tried.join(', ') + ')'));
        var prov = order[i];
        self.get('2.0/R/' + CFG.lang + '/' + prov + '/ALL/' + playbackUrl, Auth.authHeaders(token), function (err, json, res) {
          var ro = json && json.resultObj;
          if (!err && res && res.status === 401) return cb(new Error('401'));
          if (err || !ro || !ro.url) { tried.push(prov + ':' + (err ? 'err' : (json && (json.errorDescription || json.resultCode || (res && res.status))))); return next(i + 1); }
          var st = String(ro.streamType || '').toUpperCase();
          var isDash = st.indexOf('DASH') >= 0 || /\.mpd(\?|$)/i.test(ro.url);
          var isHls = st.indexOf('HLS') >= 0 || /\.m3u8(\?|$)/i.test(ro.url);
          var drm = String(ro.drmType || '').toLowerCase();
          Debug.log('entitlement', prov, 'streamType', ro.streamType, 'drmType', ro.drmType, 'laURL', ro.laURL ? 'ja' : 'nee', 'url', ro.url.slice(0, 90));
          if (drm.indexOf('fairplay') >= 0 || (!isDash && !isHls)) { tried.push(prov + ':' + (ro.drmType || ro.streamType)); return next(i + 1); }
          self.playProvider = prov; Store.set('provider', prov);
          cb(null, { url: ro.url, isDash: isDash, isHls: isHls, drmType: drm, laURL: ro.laURL || ro.laUrl || null, entitlementToken: ro.entitlementToken || null, channelId: ro.channelId });
        });
      })(0);
    }
  };

  /* ======================================================================
   * Speler (Shaka, lazy geladen)
   * ====================================================================== */
  var Player = {
    shaka: null, player: null, video: null, overlayTimer: null, loadingShaka: false, ent: null, live: false,

    loadShaka: function (cb) {
      var self = this;
      if (window.shaka && window.shaka.Player) return cb(null);
      if (this.loadingShaka) return cb(new Error('bezig met laden'));
      this.loadingShaka = true;
      var urls = CFG.shakaUrls.slice();
      (function tryNext() {
        var url = urls.shift();
        if (!url) { self.loadingShaka = false; return cb(new Error('Shaka Player kon niet worden geladen (internet?)')); }
        var s = document.createElement('script');
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; Debug.log('shaka timeout', url); tryNext(); } }, 20000);
        s.onload = function () { if (done) return; done = true; clearTimeout(t); self.loadingShaka = false; Debug.log('shaka geladen', url); cb(null); };
        s.onerror = function () { if (done) return; done = true; clearTimeout(t); Debug.log('shaka fout', url); tryNext(); };
        s.src = url; document.head.appendChild(s);
      })();
    },

    init: function () {
      var self = this;
      if (this.player) return;
      this.shaka = window.shaka;
      this.shaka.polyfill.installAll();
      this.video = $('video');
      this.player = new this.shaka.Player(this.video);
      this.player.addEventListener('error', function (e) { self.onError(e.detail); });
      this.player.getNetworkingEngine().registerRequestFilter(function (type, req) {
        if (type === self.shaka.net.NetworkingEngine.RequestType.LICENSE && self.ent) {
          var h = Auth.authHeaders(self.ent.token, self.ent.entitlementToken);
          for (var k in h) if (h.hasOwnProperty(k)) req.headers[k] = h[k];
        }
      });
      this.player.configure({ streaming: { bufferingGoal: 20, rebufferingGoal: 3, retryParameters: { maxAttempts: 4 } }, manifest: { retryParameters: { maxAttempts: 4 } }, abr: { enabled: true } });
      this.video.addEventListener('playing', function () { self.msg(null); });
      this.video.addEventListener('waiting', function () { self.msg('Bufferen…'); });
    },

    onError: function (err) {
      var code = err && err.code, cat = err && err.category;
      Debug.log('shaka error', 'code', code, 'cat', cat, err && err.data ? JSON.stringify(err.data).slice(0, 200) : '');
      var hint = cat === 6 ? ' (DRM/licentie)' : cat === 1 ? ' (netwerk)' : cat === 4 ? ' (manifest)' : cat === 3 ? ' (media/codec)' : '';
      this.msg('Afspeelfout ' + code + hint + ' — gele knop voor details');
    },

    msg: function (text) { var m = $('player-msg'); if (!text) { m.className = 'player-msg hidden'; return; } m.textContent = text; m.className = 'player-msg'; },

    showOverlay: function () {
      $('player-overlay').style.display = 'block';
      clearTimeout(this.overlayTimer);
      this.overlayTimer = setTimeout(function () { $('player-overlay').style.display = 'none'; }, CFG.overlayMs);
    },

    /* info = {title, sub, playbackUrl, back: 'browse'|'feeds'} */
    play: function (info) {
      var self = this;
      this.back = info.back || 'browse';
      UI.show('player');
      $('player-title').textContent = info.title;
      $('player-sub').textContent = info.sub || '';
      this.showOverlay();
      this.msg('Laden…');
      this.loadShaka(function (err) {
        if (err) return self.msg(String(err.message || err));
        self.init();
        Auth.ensure(function (err2, token) {
          if (err2) { self.msg('Sessie verlopen — ga terug en log opnieuw in'); return; }
          Api.entitlement(info.playbackUrl, token, function (err3, ent) {
            if (err3) { self.msg(String(err3.message || err3) + (String(err3.message) === '401' ? ' — niet gemachtigd (abonnement / sessie?)' : '')); return; }
            ent.token = token; self.ent = ent;
            var drm = { servers: {} };
            if (ent.laURL) { if (ent.drmType.indexOf('playready') >= 0) drm.servers['com.microsoft.playready'] = ent.laURL; else drm.servers['com.widevine.alpha'] = ent.laURL; }
            self.player.configure({ drm: drm });
            var mime = ent.isDash ? 'application/dash+xml' : (ent.isHls ? 'application/x-mpegURL' : undefined);
            Debug.log('load', mime, ent.laURL ? 'drm ' + (ent.drmType || 'widevine?') : 'geen drm');
            self.player.load(ent.url, null, mime).then(function () {
              self.live = self.player.isLive();
              Debug.log('geladen; live', self.live, 'audio', JSON.stringify(self.player.getAudioLanguages()));
              $('player-sub').textContent = (info.sub || '') + (self.live ? ' · LIVE' : '') + self.audioLabel();
              self.msg(null);
              var p = self.video.play(); if (p && p.catch) p.catch(function () {});
            }, function (e) { self.onError(e); });
          });
        });
      });
    },

    stop: function () {
      this.msg(null);
      if (this.player) { try { this.player.unload(); } catch (e) {} }
      try { this.video.pause(); } catch (e) {}
      this.ent = null;
    },

    audioLabel: function () {
      try { var t = this.player.getVariantTracks(); for (var i = 0; i < t.length; i++) if (t[i].active && t[i].language) return ' · audio ' + t[i].language; } catch (e) {}
      return '';
    },
    togglePause: function () {
      if (!this.video) return;
      if (this.video.paused) { var p = this.video.play(); if (p && p.catch) p.catch(function () {}); } else this.video.pause();
      this.showOverlay();
    },
    seek: function (delta) {
      if (!this.player || !this.video) return;
      var r = this.player.seekRange();
      this.video.currentTime = Math.max(r.start, Math.min(r.end, this.video.currentTime + delta)); this.showOverlay();
    },
    goLive: function () { if (!this.player) return; try { this.video.currentTime = this.player.seekRange().end; } catch (e) {} this.showOverlay(); },
    cycleAudio: function () {
      if (!this.player) return;
      var self = this, langs = this.player.getAudioLanguages();
      if (!langs || langs.length < 2) { this.msg('Slechts één audiotaal'); setTimeout(function () { self.msg(null); }, 1500); return; }
      var cur = '', t = this.player.getVariantTracks();
      for (var i = 0; i < t.length; i++) if (t[i].active) cur = t[i].language;
      var next = langs[(langs.indexOf(cur) + 1) % langs.length];
      this.player.selectAudioLanguage(next);
      Debug.log('audio ->', next);
      $('player-sub').textContent = $('player-sub').textContent.replace(/ · audio .*$/, '') + ' · audio ' + next;
      this.showOverlay();
    }
  };

  /* ======================================================================
   * UI-basis: schermen + focus
   * ====================================================================== */
  var UI = {
    current: null,
    show: function (name, data) {
      var all = document.querySelectorAll('.screen');
      for (var i = 0; i < all.length; i++) all[i].className = 'screen hidden';
      $('scr-' + name).className = 'screen';
      this.current = name;
      if (Screens[name] && Screens[name].enter) Screens[name].enter(data || {});
    },
    setFocus: function (el, on) { if (!el) return; el.className = el.className.replace(/ ?\bfocus\b/, '') + (on ? ' focus' : ''); }
  };

  /* ======================================================================
   * Bladeren: tabs + generieke pagina met secties
   * ====================================================================== */
  var Browse = {
    tabs: [], tabIndex: 0, stack: [], live: [],
    // focus: secties met kolommen; s = -1 → tabs
    secs: [], s: 0, c: 0, r: 0, rowX: [],

    enter: function () {
      var p = Auth.session && Auth.session.profile;
      $('browse-user').textContent = p ? (p.firstName + ' ' + p.lastName) : '';
      if (!this.tabs.length) this.loadMenu();
      else if (!this.stack.length) this.openTab(0);
      else { var top = this.stack[this.stack.length - 1]; if (top.page) this.render(top.nav); else this.push(top.uri, top.title, top.root); }
    },

    saveNav: function () {
      if (!this.stack.length) return;
      this.stack[this.stack.length - 1].nav = { s: this.s, c: this.c, r: this.r, rowX: this.rowX.slice() };
    },

    status: function (msg) { var el = $('page-status'); el.textContent = msg || ''; el.className = 'page-status' + (msg ? '' : ' hidden'); },

    loadMenu: function () {
      var self = this;
      this.status('Menu laden…');
      Api.menu(function (err, tabs) {
        if (err) { self.status('Menu kon niet geladen worden: ' + err.message + ' (OK = opnieuw)'); self.tabs = []; self.renderTabs(); return; }
        self.tabs = tabs; self.renderTabs(); self.openTab(0);
      });
    },

    renderTabs: function () {
      var html = '';
      for (var i = 0; i < this.tabs.length; i++) html += '<div class="tab' + (i === this.tabIndex ? ' active' : '') + '" data-i="' + i + '">' + esc(this.tabs[i].title) + '</div>';
      if (this.live.length) html += '<div class="tab live" data-i="live">LIVE</div>';
      $('tabs').innerHTML = html;
      var self = this, els = $('tabs').querySelectorAll('.tab');
      for (var k = 0; k < els.length; k++) (function (el, idx) {
        el.onmouseover = function () { self.focusTo(-1, idx, 0); };
        el.onclick = function () { self.focusTo(-1, idx, 0); self.activate(); };
      })(els[k], k);
    },

    openTab: function (i) {
      this.tabIndex = i; this.stack = [];
      this.renderTabs();
      this.push(this.tabs[i].uri, this.tabs[i].title, true);
    },

    push: function (uri, title, isRoot) {
      var self = this;
      this.saveNav();
      var entry = { uri: uri, title: title, page: null, nav: null, root: !!isRoot };
      this.stack.push(entry);
      this.status('Laden…');
      $('page').innerHTML = '';
      Api.page(uri, function (err, page) {
        if (self.stack[self.stack.length - 1] !== entry) return;
        if (err) { self.status('Kon pagina niet laden: ' + err.message + ' (BACK = terug)'); self.secs = []; return; }
        entry.page = page;
        if (entry.root && self.tabIndex === 0) { self.live = page.live; self.renderTabs(); }
        self.status(page.sections.length ? '' : 'Lege pagina (gele knop voor details)');
        self.render();
      });
    },

    pop: function () {
      if (this.stack.length <= 1) return false;
      this.stack.pop();
      var top = this.stack[this.stack.length - 1];
      if (!top.page) { this.push(top.uri, top.title, top.root); this.stack.splice(this.stack.length - 2, 1); return true; }
      this.render(top.nav);
      return true;
    },

    /* Virtuele LIVE-pagina */
    openLive: function () {
      if (!this.live.length) return;
      if (this.live.length === 1) return this.open(this.live[0]);
      this.saveNav();
      this.stack.push({ uri: 'live', title: 'Live', page: { sections: [{ type: 'heading', title: 'Live nu' }, { type: 'row', title: '', items: this.live }], live: this.live }, nav: null });
      this.render();
    },

    /* ---------- renderen ---------- */
    render: function (nav) {
      var top = this.stack[this.stack.length - 1];
      var page = top.page, html = '', secs = [];
      for (var i = 0; i < page.sections.length; i++) {
        var sec = page.sections[i];
        if (sec.type === 'hero') html += this.renderHero(sec, i);
        else if (sec.type === 'gp') html += this.renderGp(sec);
        else if (sec.type === 'heading') html += '<div class="section heading"><div class="section-title">' + esc(sec.title) + '</div></div>';
        else if (sec.type === 'schedule') html += this.renderSchedule(sec, i);
        else html += this.renderRow(sec, i);
      }
      $('page').innerHTML = html;
      $('page').style.transform = $('page').style.webkitTransform = 'translate3d(0,0,0)';
      // focus-kolommen opbouwen
      var self = this;
      for (i = 0; i < page.sections.length; i++) {
        var s2 = page.sections[i], cols = [], el = document.querySelector('[data-sec="' + i + '"]');
        if (!el) continue;
        if (s2.type === 'hero') { var btns = el.querySelectorAll('.hero-btn'); for (var b = 0; b < btns.length; b++) cols.push([btns[b]]); }
        else if (s2.type === 'row') { var cards = el.querySelectorAll('.card'); for (var cI = 0; cI < cards.length; cI++) cols.push([cards[cI]]); }
        else if (s2.type === 'schedule') { var days = el.querySelectorAll('.day'); for (var d = 0; d < days.length; d++) cols.push(Array.prototype.slice.call(days[d].querySelectorAll('.sess'))); }
        if (cols.length) secs.push({ idx: i, sec: s2, el: el, cols: cols });
      }
      this.secs = secs; this.rowX = [];
      for (i = 0; i < secs.length; i++) (function (si) {
        for (var c = 0; c < secs[si].cols.length; c++) for (var r = 0; r < secs[si].cols[c].length; r++) (function (ci, ri, fel) {
          fel.onmouseover = function () { self.focusTo(si, ci, ri); };
          fel.onclick = function () { self.focusTo(si, ci, ri); self.activate(); };
        })(c, r, secs[si].cols[c][r]);
      })(i);
      if (nav) { this.rowX = nav.rowX || []; this.focusTo(nav.s, nav.c, nav.r); }
      else if (secs.length) this.focusTo(0, 0, 0);
      else this.focusTo(-1, this.tabIndex, 0);
    },

    cardHtml: function (it, poster) {
      var img = it.pictureUrl ? '<img src="' + esc(imgUrl(it.pictureUrl, poster ? 244 : 404, poster ? 346 : 227)) + '" alt="">' : '';
      var meta = [];
      if (it.duration) meta.push(it.duration);
      if (it.subtype && !it.live) meta.push(it.subtype.charAt(0) + it.subtype.slice(1).toLowerCase());
      if (it.emf && it.emf.Meeting_Display_Date) meta.push(it.emf.Meeting_Display_Date);
      return '<div class="card' + (poster ? ' poster' : '') + '"><div class="thumb">' + img + (it.live ? '<div class="live-tag">LIVE</div>' : '') + '</div>' +
             '<div class="ctitle">' + esc(it.title) + '</div>' +
             (meta.length ? '<div class="cmeta">' + esc(meta.join(' | ')) + '</div>' : '') +
             (it.series ? '<div class="cseries">' + esc(it.series) + '</div>' : '') + '</div>';
    },

    renderRow: function (sec, i) {
      var html = '<div class="section" data-sec="' + i + '">';
      if (sec.title) html += '<div class="section-title">' + esc(sec.title) + (sec.viewAll ? '<span class="viewall">Alles →</span>' : '') + '</div>';
      html += '<div class="row-wrap"><div class="row">';
      for (var j = 0; j < sec.items.length; j++) html += this.cardHtml(sec.items[j], sec.poster);
      return html + '</div></div></div>';
    },

    renderHero: function (sec, i) {
      var html = '<div class="hero" data-sec="' + i + '">';
      for (var j = 0; j < sec.items.length; j++) {
        var it = sec.items[j];
        html += '<div class="hero-slide' + (j === 0 ? ' current' : '') + '">' + (it.pictureUrl ? '<img src="' + esc(imgUrl(it.pictureUrl, 1920, 760)) + '" alt="">' : '') + '<div class="hero-shade"></div>' +
                '<div class="hero-text"><div class="hero-label">' + esc(it.label) + (it.live ? ' <span class="badge live">LIVE</span>' : '') + '</div><div class="hero-title">' + esc(it.title) + '</div>' +
                '<div class="hero-btn">' + (it.isVideo ? (it.live ? 'Kijk live' : 'Kijk nu') : 'Open') + '</div></div></div>';
      }
      if (sec.items.length > 1) { html += '<div class="hero-dots">'; for (j = 0; j < sec.items.length; j++) html += '<span' + (j === 0 ? ' class="on"' : '') + '></span>'; html += '</div>'; }
      return html + '</div>';
    },

    renderGp: function (sec) {
      var it = sec.item, emf = it.emf || {};
      var big = emf.Meeting_Country_Name || emf.Global_Meeting_Name || it.title;
      var meta = [];
      if (emf.Championship_Meeting_Ordinal) meta.push('Round ' + emf.Championship_Meeting_Ordinal);
      if (emf.Meeting_Display_Date) meta.push(emf.Meeting_Display_Date);
      return '<div class="gp">' + (it.pictureUrl ? '<img src="' + esc(imgUrl(it.pictureUrl, 1920, 620)) + '" alt="">' : '') + '<div class="gp-shade"></div>' +
             '<div class="gp-text"><div class="gp-name">' + esc(big) + '</div>' +
             (emf.Meeting_Official_Name ? '<div class="gp-official">' + esc(emf.Meeting_Official_Name) + '</div>' : '') +
             (meta.length ? '<div class="gp-meta">' + meta.map(esc).join('<b>|</b>') + '</div>' : '') + '</div></div>';
    },

    renderSchedule: function (sec, i) {
      var html = '<div class="section" data-sec="' + i + '"><div class="schedule">';
      for (var d = 0; d < sec.days.length; d++) {
        var day = sec.days[d];
        html += '<div class="day"><div class="day-name">' + esc(day.name) + '</div>';
        for (var e = 0; e < day.events.length; e++) {
          var ev = day.events[e];
          html += '<div class="sess"><div class="tag">' + esc((ev.series || 'F1').replace(/^FORMULA\s*/i, 'F').slice(0, 3)) + '</div><div class="stitle">' + esc(ev.title) + '</div>' +
                  (ev.live ? '<span class="badge live">LIVE</span>' : (ev.start ? '<div class="stime">' + esc(fmtTime(ev.start)) + '</div>' : '')) + '</div>';
        }
        html += '</div>';
      }
      return html + '</div></div>';
    },

    /* ---------- focus ---------- */
    currentEl: function () {
      if (this.s === -1) { var t = $('tabs').querySelectorAll('.tab'); return t[this.c] || null; }
      var sec = this.secs[this.s]; if (!sec) return null;
      var col = sec.cols[this.c]; return col ? (col[this.r] || null) : null;
    },

    focusTo: function (s, c, r) {
      UI.setFocus(this.currentEl(), false);
      if (s !== -1 && !this.secs[s]) s = this.secs.length ? 0 : -1;
      this.s = s;
      if (s === -1) {
        var n = $('tabs').querySelectorAll('.tab').length;
        this.c = Math.max(0, Math.min(c, n - 1)); this.r = 0;
        this.scrollTo(0);
      } else {
        var sec = this.secs[s];
        this.c = Math.max(0, Math.min(c, sec.cols.length - 1));
        this.r = Math.max(0, Math.min(r, sec.cols[this.c].length - 1));
        if (sec.sec.type === 'hero') this.showSlide(sec, this.c);
        if (sec.sec.type === 'row') this.scrollRow(sec, s);
        var bottom = sec.el.offsetTop + sec.el.offsetHeight;
        this.scrollTo(sec.sec.type === 'hero' || bottom <= 1040 ? 0 : Math.max(0, sec.el.offsetTop - 150));
      }
      UI.setFocus(this.currentEl(), true);
    },

    showSlide: function (sec, idx) {
      var slides = sec.el.querySelectorAll('.hero-slide'), dots = sec.el.querySelectorAll('.hero-dots span');
      for (var i = 0; i < slides.length; i++) slides[i].className = 'hero-slide' + (i === idx ? ' current' : '');
      for (i = 0; i < dots.length; i++) dots[i].className = i === idx ? 'on' : '';
    },

    scrollRow: function (sec, s) {
      var row = sec.el.querySelector('.row'), card = sec.cols[this.c][0];
      var x = this.rowX[s] || 0, visible = 1920 - 70 - 40;
      var left = card.offsetLeft, right = left + card.offsetWidth;
      if (left < x) x = left; else if (right > x + visible) x = right - visible;
      this.rowX[s] = x;
      row.style.transform = row.style.webkitTransform = 'translate3d(' + (-x) + 'px,0,0)';
    },

    scrollTo: function (y) {
      var page = $('page');
      var max = Math.max(0, page.offsetHeight - 1080);
      y = Math.min(y, max);
      page.style.transform = page.style.webkitTransform = 'translate3d(0,' + (-y) + 'px,0)';
    },

    move: function (dx, dy) {
      if (this.s === -1) {
        if (dx) { this.focusTo(-1, this.c + dx, 0); return; }
        if (dy > 0 && this.secs.length) this.focusTo(0, 0, 0);
        return;
      }
      var sec = this.secs[this.s];
      if (dx) { this.focusTo(this.s, this.c + dx, this.r); return; }
      var col = sec.cols[this.c];
      var nr = this.r + dy;
      if (nr >= 0 && nr < col.length) { this.focusTo(this.s, this.c, nr); return; }
      var ns = this.s + dy;
      if (ns < 0) { this.focusTo(-1, this.tabIndex, 0); return; }
      if (ns >= this.secs.length) return;
      var nsec = this.secs[ns];
      var nc = Math.min(this.c, nsec.cols.length - 1);
      if (nsec.sec.type !== 'schedule') nc = nsec.sec.type === 'row' ? Math.min(nc, nsec.cols.length - 1) : 0;
      this.focusTo(ns, nc, dy > 0 ? 0 : nsec.cols[nc].length - 1);
    },

    activate: function () {
      if (this.s === -1) {
        var t = $('tabs').querySelectorAll('.tab')[this.c];
        if (!t) return;
        var di = t.getAttribute('data-i');
        if (di === 'live') return this.openLive();
        return this.openTab(parseInt(di, 10));
      }
      var sec = this.secs[this.s];
      var it = null;
      if (sec.sec.type === 'hero' || sec.sec.type === 'row') it = sec.sec.items[this.c];
      else if (sec.sec.type === 'schedule') it = sec.sec.days[this.c].events[this.r];
      if (it) this.open(it);
    },

    open: function (it) {
      var top = this.stack[this.stack.length - 1];
      var ctx = top && top.title ? top.title : '';
      if (it.isVideo) {
        this.saveNav();
        if (it.isSession || it.live) { State.session = { id: it.contentId, title: it.title, sub: it.label || ctx }; UI.show('feeds'); return; }
        Player.play({ title: it.title, sub: it.label || ctx, playbackUrl: it.playbackUrl, back: 'browse' }); return;
      }
      if (it.pageUri) { this.push(it.pageUri, it.title); return; }
      Debug.log('item zonder actie', it.title, it.subtype);
      this.status('Hier zit (nog) niets achter'); var self = this; setTimeout(function () { self.status(''); }, 1500);
    },

    key: function (k) {
      switch (k) {
        case KEY.LEFT: this.move(-1, 0); return true;
        case KEY.RIGHT: this.move(1, 0); return true;
        case KEY.UP: this.move(0, -1); return true;
        case KEY.DOWN: this.move(0, 1); return true;
        case KEY.OK: if (!this.tabs.length) { this.loadMenu(); return true; } this.activate(); return true;
        case KEY.RED: if (this.live.length) this.openLive(); return true;
        case KEY.BACK:
          if (this.pop()) return true;
          if (this.tabIndex !== 0 && this.tabs.length) { this.openTab(0); return true; }
          window.close(); return true;
      }
      return false;
    }
  };

  /* ======================================================================
   * Schermen
   * ====================================================================== */
  var State = { session: null, feeds: null, feedIndex: 0 };

  var Screens = {
    boot: { enter: function () {}, key: function () { return false; } },

    login: {
      enter: function () {
        $('login-code').textContent = '…'; $('login-url').textContent = '…'; $('login-qr').innerHTML = ''; $('login-full').textContent = '';
        $('login-status').textContent = 'Code ophalen…';
        Auth.startDeviceLogin(function (code) {
          $('login-code').textContent = code.userCode;
          $('login-url').textContent = String(code.verificationUri).replace(/^https?:\/\//, '');
          $('login-full').textContent = String(code.verificationUriComplete).replace(/^https?:\/\//, '');
          $('login-status').textContent = 'Wachten tot je de code bevestigt…';
          try { var q = window.qrcode(0, 'M'); q.addData(code.verificationUriComplete); q.make(); $('login-qr').innerHTML = q.createImgTag(6, 0); }
          catch (e) { Debug.log('qr fout', String(e)); }
        }, function (err) {
          if (err) {
            var m = String(err.message || err);
            $('login-status').textContent = m === 'expired' ? 'Code verlopen — druk op OK voor een nieuwe code' : m === 'denied' ? 'Geweigerd — druk op OK om opnieuw te proberen' : 'Fout: ' + m + ' — OK = opnieuw';
            return;
          }
          UI.show('browse');
        });
      },
      key: function (k) {
        if (k === KEY.OK) { UI.show('login'); return true; }
        if (k === KEY.BACK) { Auth.cancelLogin(); window.close(); return true; }
        return false;
      }
    },

    browse: { enter: function () { Browse.enter(); }, key: function (k) { return Browse.key(k); } },

    feeds: {
      els: [], idx: 0,
      enter: function () {
        var self = this;
        $('feeds-title').textContent = State.session.title + (State.session.sub ? ' — ' + State.session.sub : '');
        $('feeds-status').textContent = 'Feeds laden…';
        $('feeds-list').innerHTML = ''; this.els = []; this.idx = State.feedIndex || 0;
        Api.channels(State.session.id, function (err, feeds) {
          if (err) { $('feeds-status').textContent = 'Kon feeds niet laden: ' + err.message; return; }
          State.feeds = feeds;
          $('feeds-status').textContent = 'OK = afspelen · BACK = terug';
          var html = '';
          for (var i = 0; i < feeds.length; i++) {
            var f = feeds[i];
            var swatch = f.driver ? '<div class="swatch" style="background:#' + esc((f.hex || '555').replace('#', '')) + '"></div>' : '';
            var num = f.driver && f.racingNumber ? '<div class="num">' + esc(f.racingNumber) + '</div>' : '';
            html += '<div class="lrow" data-i="' + i + '">' + num + swatch + '<div class="main">' + esc(f.title) + '</div>' + (f.teamName ? '<div class="sub">' + esc(f.teamName) + '</div>' : '') + '</div>';
          }
          $('feeds-list').innerHTML = html;
          self.els = Array.prototype.slice.call($('feeds-list').querySelectorAll('.lrow'));
          for (i = 0; i < self.els.length; i++) (function (i) {
            self.els[i].onmouseover = function () { self.focus(i); };
            self.els[i].onclick = function () { self.focus(i); self.select(); };
          })(i);
          self.focus(Math.min(self.idx, self.els.length - 1));
        });
      },
      focus: function (i) {
        if (!this.els.length) return;
        UI.setFocus(this.els[this.idx], false);
        this.idx = Math.max(0, Math.min(i, this.els.length - 1));
        UI.setFocus(this.els[this.idx], true);
        var el = this.els[this.idx], list = $('feeds-list');
        var top = el.offsetTop - list.offsetTop, bottom = top + el.offsetHeight;
        if (top < list.scrollTop + 10) list.scrollTop = Math.max(0, top - 10);
        else if (bottom > list.scrollTop + list.clientHeight - 10) list.scrollTop = bottom - list.clientHeight + 10;
      },
      select: function () {
        var f = State.feeds && State.feeds[this.idx];
        if (!f) return;
        State.feedIndex = this.idx;
        Player.play({ title: State.session.title + ' — ' + f.title, sub: State.session.sub, playbackUrl: f.playbackUrl, back: 'feeds' });
      },
      key: function (k) {
        switch (k) {
          case KEY.BACK: State.feedIndex = 0; UI.show('browse'); return true;
          case KEY.OK: this.select(); return true;
          case KEY.UP: this.focus(this.idx - 2); return true;
          case KEY.DOWN: this.focus(this.idx + 2); return true;
          case KEY.LEFT: this.focus(this.idx - 1); return true;
          case KEY.RIGHT: this.focus(this.idx + 1); return true;
        }
        return false;
      }
    },

    player: {
      enter: function () {},
      key: function (k) {
        switch (k) {
          case KEY.BACK: case KEY.STOP: Player.stop(); UI.show(Player.back === 'feeds' ? 'feeds' : 'browse'); return true;
          case KEY.OK: case KEY.PLAY: case KEY.PAUSE: Player.togglePause(); return true;
          case KEY.LEFT: case KEY.RW: Player.seek(-CFG.seekStep); return true;
          case KEY.RIGHT: case KEY.FF: Player.seek(CFG.seekStep); return true;
          case KEY.RED: Player.goLive(); return true;
          case KEY.GREEN: Player.cycleAudio(); return true;
          case KEY.UP: case KEY.DOWN: Player.showOverlay(); return true;
        }
        return false;
      }
    }
  };

  /* ======================================================================
   * Toetsen
   * ====================================================================== */
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === KEY.YELLOW) { Debug.toggle(); e.preventDefault(); return; }
    var scr = Screens[UI.current];
    var handled = scr && scr.key ? scr.key(k) : false;
    if (handled || k === KEY.BACK || (k >= 37 && k <= 40)) e.preventDefault();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && Player.video && !Player.video.paused) Player.video.pause();
  });

  /* ======================================================================
   * Start
   * ====================================================================== */
  function launchParams() {
    var p = null;
    try { if (window.PalmSystem && PalmSystem.launchParams) p = JSON.parse(PalmSystem.launchParams); } catch (e) {}
    return p || {};
  }

  function boot() {
    Debug.log('start', navigator.userAgent.slice(0, 80));
    var lp = launchParams();
    var manual = lp.token || null;
    if (!manual && lp.cookie) { // waarde van de 'login-session'-cookie van f1tv.formula1.com (URL-encoded JSON)
      var raw = String(lp.cookie);
      try { raw = decodeURIComponent(raw); } catch (e) {}
      try { var cj = JSON.parse(raw); manual = cj && cj.data && cj.data.subscriptionToken; } catch (e2) { Debug.log('cookie parse fout', String(e2)); }
    }
    if (manual) { // handmatige fallback: launch met params {"token": "<subscriptionToken>"} of {"cookie": "<login-session>"}
      var claims = decodeJwt(manual) || {};
      Auth.save({ refreshToken: null, accessExp: Date.now() + 3600000, subscriptionToken: manual, subExp: (claims.exp || 0) * 1000,
                  sessionId: claims.SessionId || null, profile: { firstName: claims.FirstName || '', lastName: claims.LastName || '', email: claims.Email || '', country: '', status: claims.SubscriptionStatus || '' } });
      Debug.log('sessie via launch params; sub exp', claims.exp ? new Date(claims.exp * 1000).toISOString() : '?');
    }
    if (lp.logout) Auth.save(null);
    Auth.load();
    if (!Auth.session) return UI.show('login');
    $('boot-msg').textContent = 'Sessie controleren…';
    Auth.ensure(function (err) {
      if (err) { Debug.log('ensure', String(err)); return UI.show('login'); }
      UI.show('browse');
    });
  }

  document.addEventListener('webOSRelaunch', function () {}, false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
