/* ArBetter - inject.js | MAIN world */
(() => {
  'use strict';

  if (window.__arbetterInjected) return;
  window.__arbetterInjected = true;

  const OUT = 'ARBETTER_INJECT';
  const IN = 'ARBETTER_CONTENT';
  const ORIGIN = window.location.origin;
  const PROACTIVE_DELAY_MS = 1500;

  // The profile endpoint is not specified in the brief, so this pattern is broad.
  const PROFILE_RE = /\/students\/(student\/(profile|details|info|summary)|home-ui\/(profile|header|user))|\/(user|users)\/(profile|current|me)\b/i;

  const PASSIVE_ROUTES = [
    { type: 'calendar', test: (p) => p.includes('/students/widget-data/get-calendar-data/') },
    { type: 'kpi', test: (p) => p.includes('/students/student/kpis/') },
    { type: 'assignments', test: (p) => p.includes('/students/home-ui/assignments-due/') },
    { type: 'assignmentsOverdue', test: (p) => p.includes('/students/home-ui/assignments-overdue/') },
    { type: 'profile', test: (p) => PROFILE_RE.test(p) }
  ];

  const PROACTIVE = [
    { type: 'assignmentsKpi', url: '/students/student/assignments-kpi/academic-year-id/1' },
    { type: 'assignments', url: '/students/home-ui/assignments-due/academic-year-id/1' },
    { type: 'assignmentsOverdue', url: '/students/home-ui/assignments-overdue/academic-year-id/1?format=javascript' }
  ];


  const NOTIFICATIONS_URL = '/user-notification/get-notifications/format/json/';

  const nativeFetch = window.fetch.bind(window);

  const pathOf = (u) => {
    try {
      return new URL(String(u), window.location.href).pathname;
    } catch (_) {
      return '';
    }
  };

  const routeFor = (path) => {
    const route = PASSIVE_ROUTES.find((r) => r.test(path));
    return route ? route.type : null;
  };

  const post = (type, payload, extra) => {
    window.postMessage(Object.assign({ source: OUT, type, payload }, extra || {}), ORIGIN);
  };

  const csrfHeaders = () => {
    const meta = document.querySelector('meta[name="csrf-token"], meta[name="_csrf"]');
    return meta && meta.content ? { 'X-CSRF-Token': meta.content } : {};
  };

  const requestHeaders = () => Object.assign({
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json'
  }, csrfHeaders());

  const forward = (path, data) => {
    const type = routeFor(path);
    if (type && data !== null && data !== undefined) post(type, data, { url: path });
  };

  /* ---------- Passive interception: XMLHttpRequest ---------- */
  const XHR = window.XMLHttpRequest;
  const xhrOpen = XHR.prototype.open;
  const xhrSend = XHR.prototype.send;

  XHR.prototype.open = function (method, url, ...rest) {
    this.__arbetterPath = pathOf(url);
    return xhrOpen.call(this, method, url, ...rest);
  };

  XHR.prototype.send = function (...args) {
    const path = this.__arbetterPath;
    if (path && routeFor(path)) {
      this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) return;
        try {
          let data = null;
          if (this.responseType === 'json') {
            data = this.response;
          } else if (this.responseType === '' || this.responseType === 'text') {
            data = JSON.parse(this.responseText);
          }
          forward(path, data);
        } catch (_) { /* non-JSON response: ignore */ }
      });
    }
    return xhrSend.apply(this, args);
  };

  /* ---------- Passive interception: fetch ---------- */
  window.fetch = function (input, init) {
    const raw = typeof input === 'string' ? input : (input && input.url) || String(input);
    const path = pathOf(raw);
    const promise = nativeFetch(input, init);
    const type = routeFor(path);

    if (type) {
      promise
        .then((res) => {
          if (!res.ok) return null;
          return res.clone().json().then((data) => forward(path, data));
        })
        .catch(() => { /* ignore parse errors */ });
    }
    return promise;
  };

  /* ---------- Proactive background fetches ---------- */
  const getJson = (url) => nativeFetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: requestHeaders()
  }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });

  let proactiveScheduled = false;

  const runProactive = () => {
    PROACTIVE.forEach(({ type, url }) => {
      getJson(url)
        .then((data) => post(type, data, { url }))
        .catch((err) => post('error', { action: type, message: String(err && err.message || err) }, { url }));
    });
  };

  const scheduleProactive = () => {
    if (proactiveScheduled) return;
    proactiveScheduled = true;
    setTimeout(runProactive, PROACTIVE_DELAY_MS);
  };

  const fetchNotifications = () => {
    getJson(NOTIFICATIONS_URL)
      .then((data) => post('notifications', data))
      .catch((err) => post('error', { action: 'notifications', message: String(err && err.message || err) }));
  };

  /* ---------- Messages from content.js ---------- */
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const d = event.data;
    if (!d || d.source !== IN) return;

    if (d.type === 'config' && d.enabled) {
      scheduleProactive();
    } else if (d.type === 'request' && d.action === 'notifications') {
      fetchNotifications();
    }
  });

  post('ready', null);
})();
