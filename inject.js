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
    { type: 'calendar', test: (p) => p.includes('/students/widget-data/get-calendar-data/') || p.includes('/calendar-entry/list-static/') },
    //{ type: 'calendar', test: (p) => p.includes('/calendar-entry/list-static/format/json/') },
    { type: 'kpi', test: (p) => p.includes('/students/student/kpis/') },
    { type: 'assignments', test: (p) => p.includes('/students/home-ui/assignments-due/') },
    { type: 'assignmentsOverdue', test: (p) => p.includes('/students/home-ui/assignments-overdue/') },
    { type: 'assignmentsSubmitted', test: (p) => p.includes('/students/home-ui/assignments-submitted') },
    { type: 'profile', test: (p) => PROFILE_RE.test(p) }
  ];

  const PROACTIVE = [
    //{ type: 'calendar', url: '/?/my-mis-ui/calendar/' },
    { type: 'assignmentsKpi', url: '/students/student/assignments-kpi/' },
    { type: 'assignments', url: '/students/home-ui/assignments-due/' },
    { type: 'assignmentsOverdue', url: '/students/home-ui/assignments-overdue/?format=javascript' }
  ];


  const CALENDAR_PAGE_URL = '/?/my-mis-ui/calendar/';
  const ASSIGNMENTS_SUBMITTED_PAGE_URL = '/?/students/home-ui/assignments-submitted/';
  const NOTIFICATIONS_URL = '/user-notification/get-notifications/format/json/';

  const nativeFetch = window.fetch.bind(window);

  const pathOf = (u) => {
    try {
      const parsed = new URL(String(u), window.location.href);
      return parsed.pathname + parsed.search;
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
  /* ---------- Passive interception: XHR & fetch ---------- */
  const hookWindow = (win, onCaptured) => {
    if (!win || win.__arbetterHooked) return;
    win.__arbetterHooked = true;

    const XHR = win.XMLHttpRequest;
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
            if (onCaptured) onCaptured(path);
          } catch (_) { /* non-JSON response: ignore */ }
        });
      }
      return xhrSend.apply(this, args);
    };

    const winFetch = win.fetch.bind(win);
    win.fetch = function (input, init) {
      const raw = typeof input === 'string' ? input : (input && input.url) || String(input);
      const path = pathOf(raw);
      const promise = winFetch(input, init);
      const type = routeFor(path);

      if (type) {
        promise
        .then((res) => {
          if (!res.ok) return null;
          return res.clone().json().then((data) => {
            forward(path, data);
            if (onCaptured) onCaptured(path);
          });
        })
        .catch(() => { /* ignore parse errors */ });
      }
      return promise;
    };
  };

  hookWindow(window);

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

  const loadHiddenPage = (pageUrl, pageSlug, apiSegment, actionName, onDone) => {
    if (window.location.href.includes(pageSlug)) {
      if (onDone) onDone();
      return;
    }

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1024px;height:768px;border:0;opacity:0;pointer-events:none;';

    let cleaned = false;
    let rafId = 0;
    const cleanup = (timedOut = false) => {
      if (cleaned) return;
      cleaned = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('message', onFrameMsg);
      clearTimeout(timeout);
      frame.remove();
      if (timedOut && actionName) {
        post('error', { action: actionName, message: 'timeout' }, { url: pageUrl });
      }
      if (onDone) onDone();
    };

      const watchFrame = () => {
        if (cleaned) return;
        try {
          const win = frame.contentWindow;
          if (win && win.location.href !== 'about:blank') {
            hookWindow(win, (path) => {
              if (path.includes(apiSegment)) cleanup(false);
            });
          }
        } catch (_) { /* mid-navigation */ }
        rafId = requestAnimationFrame(watchFrame);
      };

      const onFrameMsg = (event) => {
        if (event.origin !== ORIGIN || !event.data || event.data.source !== OUT) return;
        if (typeof event.data.url === 'string' && event.data.url.includes(apiSegment)) {
          cleanup(false);
        }
      };

      window.addEventListener('message', onFrameMsg);
      const timeout = setTimeout(() => cleanup(true), 15000);
      frame.src = pageUrl;
      (document.body || document.documentElement).appendChild(frame);
      rafId = requestAnimationFrame(watchFrame);
  };

  const runProactive = () => {
    PROACTIVE.forEach(({ type, url }) => {
      getJson(url)
      .then((data) => post(type, data, { url }))
      .catch((err) => post('error', { action: type, message: String(err && err.message || err) }, { url }));
    });
    loadHiddenPage(
      CALENDAR_PAGE_URL,
      '/my-mis-ui/calendar',
      '/calendar-entry/list-static/',
      'calendar',
      () => loadHiddenPage(
        ASSIGNMENTS_SUBMITTED_PAGE_URL,
        '/students/home-ui/assignments-submitted',
        '/students/home-ui/assignments-submitted',
        'assignmentsSubmitted'
      )
    );
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
