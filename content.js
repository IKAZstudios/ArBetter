/* ArBetter - content.js | ISOLATED world | document_start */
(() => {
  'use strict';

  const ROOT_ID = 'arbor-minimal-container';
  const FAB_ID = 'arbetter-return-fab';
  const BANNER_ID = 'arbetter-home-banner';
  const CLS_MINIMAL = 'arbetter-minimal';
  const CLS_PAGE_DARK = 'arbetter-dark';
  const KEY_CACHE_ENABLED = 'arbetter-enabled-cache';
  const KEY_DARK = 'arbetter-dark-mode';
  const KEY_ENABLED = 'enabled';
  const KEY_COMPLETED = 'completedAssignments';
  const MAX_COMPLETED = 300;
  const OUT = 'ARBETTER_CONTENT';
  const IN = 'ARBETTER_INJECT';

  const LOGO_URL = chrome.runtime.getURL('arbetter_logo.png');
  const ICON32_URL = chrome.runtime.getURL('icon32.png');
  const CUSTOM_TITLE = 'ArBetter';
  const DASHBOARD_PATH = '/?/students/home-ui/dashboard';
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const html = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const text = (v) => (v === null || v === undefined ? '' : String(v));
  const esc = (v) => text(v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const getLS = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const setLS = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage disabled */ } };

  /* ---------- Synchronous first paint from cache ---------- */
  const cachedEnabled = getLS(KEY_CACHE_ENABLED);
  const state = {
    active: cachedEnabled === null ? true : cachedEnabled === 'true',
    storageChecked: false,
    injectReady: false,
    configSent: false,
    nativeView: false,
    loading: true,
    loaded: {
      calendar: false,
      kpi: false,
      assignmentsKpi: false,
      assignments: false,
      assignmentsOverdue: false,
      assignmentsSubmitted: false
    },
    tab: 'active',
    completed: {},
    calendar: [],
    kpiMain: [],
    kpiAssign: [],
    assignments: [],
    assignmentsDue: [],
    assignmentsOverdue: [],
    assignmentsSubmitted: [],
    profile: null,
    notifications: [],
    unread: 0
  };

  let loaderTimer = null;
  const hideLoader = () => {
    if (!state.loading) return;
    state.loading = false;
    clearTimeout(loaderTimer);
    const loader = $('ab-loader');
    if (!loader) return;
    loader.classList.add('is-hidden');
    setTimeout(() => { loader.hidden = true; }, 260);
  };

  const markLoaded = (key) => {
    if (!(key in state.loaded)) return;
    state.loaded[key] = true;
    if (Object.values(state.loaded).every(Boolean)) hideLoader();
  };

  if (getLS(KEY_DARK) === 'true') html.classList.add(CLS_PAGE_DARK);
  if (state.active) html.classList.add(CLS_MINIMAL);

  /* ---------- Message listener (registered before injecting) ---------- */
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== IN) return;
    const { type, payload } = event.data;

    if (type === 'ready') {
      state.injectReady = true;
      sendConfig();
      return;
    }
    if (!state.active) return;

    switch (type) {
      case 'calendar': {
        const parsed = [];

        if (payload && payload.items && payload.items.length) {
          const first = payload.items[0];
          const isStatic =
          first &&
          first.fields &&
          first.fields.response &&
          first.fields.response.value &&
          Array.isArray(first.fields.response.value.pages);

          if (isStatic) parsed.push(...parseStaticCalendar(payload));
          else parsed.push(...parseCalendar(payload));
        }

        state.calendar = state.calendar.concat(parsed);
        mergeCalendar();
        renderCalendar();
        markLoaded('calendar');
        break;
      }
      case 'kpi':
        state.kpiMain = parseKpis(payload);
        renderKpis();
        markLoaded('kpi');
        break;
      case 'assignmentsKpi':
        state.kpiAssign = parseKpis(payload);
        renderKpis();
        markLoaded('assignmentsKpi');
        break;
      case 'assignments':
        state.assignmentsDue = parseAssignments(payload);
        mergeAssignments();
        renderAssignments();
        markLoaded('assignments');
        break;
      case 'assignmentsOverdue':
        state.assignmentsOverdue = parseAssignments(payload);
        mergeAssignments();
        renderAssignments();
        markLoaded('assignmentsOverdue');
        break;
      case 'assignmentsSubmitted':
        state.assignmentsSubmitted = parseAssignments(payload);
        mergeAssignments();
        renderAssignments();
        markLoaded('assignmentsSubmitted');
        break;
      case 'profile':
        mergeProfile(payload);
        renderProfile();
        break;
      case 'notifications':
        handleNotifications(payload);
        break;
      case 'error':
        if (payload && payload.action) {
          if (payload.action === 'notifications') toast('Could not load notifications.');
          else markLoaded(payload.action);
        }
        break;
      default:
        break;
    }
  });

  const mergeAssignments = () => {
    const byId = new Map();
    state.assignmentsDue
    .concat(state.assignmentsOverdue)
    .forEach((a) => byId.set(a.id, Object.assign({}, a, { submitted: false })));
    state.assignmentsSubmitted
    .forEach((a) => byId.set(a.id, Object.assign({}, a, { submitted: true })));
    state.assignments = Array.from(byId.values());
  };
  // const mergeCalendar = () => {
  //   const byKey = new Map();
  //   state.calendar.forEach((i) => {
  //     const key = `${i.dayKey}|${i.time}|${i.title}`;
  //     if (!byKey.has(key)) byKey.set(key, i);
  //   });
  //     state.calendar = Array.from(byKey.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  // };


  /* ---------- Inject main-world script ---------- */
  const injectScript = () => {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.onload = () => s.remove();
    (document.head || html).appendChild(s);
  };
  injectScript();

  /* ---------- Messaging helpers ---------- */
  const sendToPage = (msg) => window.postMessage(Object.assign({ source: OUT }, msg), window.location.origin);

  const sendConfig = () => {
    if (!state.injectReady || !state.storageChecked || !state.active || state.configSent) return;
    state.configSent = true;
    loaderTimer = setTimeout(hideLoader, 6000);
    sendToPage({ type: 'config', enabled: true });
  };

  /* ---------- Title & favicon management ---------- */
  const brandState = {
    applied: false,
    origTitle: '',
    origIcons: [],
    activeIconUrl: ICON32_URL,
    observer: null
  };

  const syncBranding = () => {
    if (!brandState.applied) return;

    if (document.title && document.title !== CUSTOM_TITLE) {
      brandState.origTitle = document.title;
    }
    if (document.title !== CUSTOM_TITLE) {
      document.title = CUSTOM_TITLE;
    }

    const head = document.head;
    if (!head) return;

    document.querySelectorAll('link[rel*="icon"]:not([data-arbetter-icon])').forEach((link) => {
      if (!link.hasAttribute('data-arbetter-fallback-icon')) {
        brandState.origIcons.push(link.cloneNode(true));
      }
      link.remove();
    });

    ['icon', 'shortcut icon'].forEach((rel) => {
      let icon = head.querySelector(`link[data-arbetter-icon="${rel}"]`);
      if (!icon) {
        icon = document.createElement('link');
        icon.rel = rel;
        icon.setAttribute('data-arbetter-icon', rel);
        icon.href = brandState.activeIconUrl;
        head.appendChild(icon);
      } else if (icon.href !== brandState.activeIconUrl) {
        icon.href = brandState.activeIconUrl;
      }
    });
  };

  const applyBranding = () => {
    brandState.applied = true;
    syncBranding();

    if (!brandState.observer) {
      brandState.observer = new MutationObserver(() => syncBranding());
      brandState.observer.observe(html, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'rel']
      });
    }
  };

  const restoreBranding = () => {
    brandState.applied = false;
    if (brandState.observer) {
      brandState.observer.disconnect();
      brandState.observer = null;
    }

    const head = document.head;
    if (head) {
      document.querySelectorAll('link[data-arbetter-icon]').forEach((link) => link.remove());
      if (brandState.origIcons.length) {
        brandState.origIcons.forEach((link) => head.appendChild(link));
        brandState.origIcons = [];
      } else {
        const fallback = document.createElement('link');
        fallback.rel = 'icon';
        fallback.href = '/favicon.ico';
        fallback.setAttribute('data-arbetter-fallback-icon', 'true');
        head.appendChild(fallback);
      }
    }

    if (brandState.origTitle) {
      document.title = brandState.origTitle;
    }
  };

  /* ---------- Dashboard page check & warning banner ---------- */
  const isDashboardPage = () =>
  (window.location.pathname === '/' && window.location.search.startsWith('?/students/home-ui/dashboard')) ||
  window.location.pathname.startsWith('/students/home-ui/dashboard');

  const removeHomeWarning = () => {
    const banner = $(BANNER_ID);
    if (banner) banner.remove();
  };

    const showHomeWarning = () => {
      if (window !== window.top || isDashboardPage() || $(BANNER_ID)) return;
      if (/\/(login|logout|auth|sso|saml|oauth)\b/i.test(window.location.href)) return;

      const mount = () => {
        if (!state.active || $(BANNER_ID) || !document.body) return;
        const banner = document.createElement('div');
        banner.id = BANNER_ID;
        banner.className = 'arbetter-home-banner';
        banner.setAttribute('role', 'alert');
        banner.innerHTML = `
        <img class="arbetter-banner-logo" src="${LOGO_URL}" alt="">
        <span class="arbetter-banner-text">ArBetter only works on the Arbor homepage.</span>
        <a class="arbetter-banner-btn" href="${DASHBOARD_PATH}">Go to Homepage</a>
        `;
        document.body.appendChild(banner);
      };

      if (document.body) {
        mount();
        return;
      }
      const obs = new MutationObserver(() => {
        if (document.body) {
          obs.disconnect();
          mount();
        }
      });
      obs.observe(html, { childList: true });
    };

    if (state.active) {
      if (isDashboardPage()) {
        applyBranding();
      } else {
        html.classList.remove(CLS_MINIMAL);
        showHomeWarning();
      }
    }

    /* ---------- Enable / disable ---------- */
    const enable = () => {
      state.active = true;
      if (!isDashboardPage()) {
        html.classList.remove(CLS_MINIMAL);
        restoreBranding();
        showHomeWarning();
        return;
      }
      removeHomeWarning();
      html.classList.add(CLS_MINIMAL);
      if (!state.nativeView) applyBranding();
      ensureUI();
      sendConfig();
    };

    const disable = () => {
      state.active = false;
      html.classList.remove(CLS_MINIMAL);
      restoreBranding();
      removeHomeWarning();
      const root = $(ROOT_ID);
      const fab = $(FAB_ID);
      if (root) root.remove();
      if (fab) fab.remove();
    };

    chrome.storage.sync.get({ [KEY_ENABLED]: true }, (res) => {
      state.storageChecked = true;
      const enabled = res[KEY_ENABLED] !== false;
      setLS(KEY_CACHE_ENABLED, String(enabled));
      if (enabled) enable(); else disable();
    });

  /* ---------- Parsers ---------- */
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const formatDay = (key) => {
    const [y, m, d] = key.split('-');
    return `${Number(d)} ${MONTH_NAMES[Number(m) - 1]} ${y}`;
  };

  const parseDue = (str) => {
    const m = text(str).match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
    if (!m) return null;
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`;
  };

  const hash = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };

  const htmlToText = (markup) => {
    const doc = new DOMParser().parseFromString(text(markup), 'text/html');
    const el = doc.querySelector('.mis-htmlpanel-measure-value') || doc.body;
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const parseCalendar = (payload) => (payload && payload.items ? payload.items : [])
  .map((it) => {
    const f = it.fields || {};
    const start = text(f.start_datetime && f.start_datetime.value);
    const end = text(f.end_datetime && f.end_datetime.value);
    return {
      dayKey: start.slice(0, 10),
       sortKey: start,
       time: `${start.slice(11, 16)}–${end.slice(11, 16)}`,
       title: text(f.title && f.title.value).trim() || 'Untitled',
       room: text(f.location && f.location.value).trim()
    };
  })
  .filter((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.dayKey));

  const tooltipCache = new Map();
  const tooltipInFlight = new Set();
  const tooltipQueue = [];
  let activeTooltipWorkers = 0;

  const parseTooltipHtml = (markup) => {
    const doc = new DOMParser().parseFromString(text(markup), 'text/html');
    const title = text(doc.querySelector('.mis-tooltip .title')?.textContent).trim();
    const fields = {};

    doc.querySelectorAll('.aligned-list li').forEach((li) => {
      const label = text(li.querySelector('b')?.textContent).replace(/:$/, '').trim().toLowerCase();
      const val = text(li.querySelector('span')?.textContent).replace(/\s+/g, ' ').trim();
      if (label && val) fields[label] = val;
    });

      const location = fields.location || '';
      const room = location.includes(': ') ? location.split(': ').pop().trim() : location;

      return {
        title,
        date: fields.date || '',
        location,
        room,
        staff: fields.staff || ''
      };
  };

  const pumpTooltipQueue = () => {
    while (activeTooltipWorkers < 5 && tooltipQueue.length) {
      const eventId = tooltipQueue.shift();
      if (!eventId || tooltipCache.has(eventId) || tooltipInFlight.has(eventId)) continue;

      tooltipInFlight.add(eventId);
      activeTooltipWorkers++;

      fetch(`/students/calendar-entry/tooltip/id/${encodeURIComponent(eventId)}`, {
        credentials: 'same-origin'
      })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('HTTP ' + res.status))))
      .then((html) => {
        const details = parseTooltipHtml(html);
        tooltipCache.set(eventId, details);

        let needsRender = false;
        const viewedDay = state.currentCalendarDay || todayKey();
        state.calendar.forEach((ev) => {
          if (ev.eventId === eventId) {
            if (!ev.room && details.room) ev.room = details.room;
            ev.details = details;
            if (ev.dayKey === viewedDay) needsRender = true;
          }
        });
        if (needsRender) renderCalendar();
      })
      .catch(() => {
        tooltipCache.set(eventId, null);
      })
      .finally(() => {
        tooltipInFlight.delete(eventId);
        activeTooltipWorkers--;
        pumpTooltipQueue();
      });
    }
  };

  const queueTooltipFetches = () => {
    const viewedDay = state.currentCalendarDay || todayKey();
    const pending = state.calendar
    .filter((ev) => ev.eventId && !tooltipCache.has(ev.eventId) && !tooltipInFlight.has(ev.eventId))
    .sort((a, b) => {
      const aCurrent = a.dayKey === viewedDay ? 0 : 1;
      const bCurrent = b.dayKey === viewedDay ? 0 : 1;
      return aCurrent - bCurrent || a.sortKey.localeCompare(b.sortKey);
    });

    pending.forEach((ev) => {
      if (!tooltipQueue.includes(ev.eventId)) tooltipQueue.push(ev.eventId);
    });
      pumpTooltipQueue();
  };

  const parseStaticCalendar = (payload) => {
    const out = [];
    const items = payload && Array.isArray(payload.items) ? payload.items : [];

    items.forEach((it) => {
      const pages = it && it.fields && it.fields.response && it.fields.response.value && it.fields.response.value.pages;
      if (!Array.isArray(pages)) return;

      pages.forEach((page) => {
        const pageHtml = text(page && page.html);
        if (!pageHtml) return;

        const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
        const table = doc.querySelector('table.mis-cal');
        if (!table) return;

        const dayCells = Array.from(table.querySelectorAll('thead .mis-calendar-date[data-date]'));
        const bodyRow = table.querySelector('tbody tr');
        if (!bodyRow) return;

        dayCells.forEach((cell) => {
          const dayKey = cell.getAttribute('data-date');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey || '')) return;

          const colCell = bodyRow.cells[cell.cellIndex];
          const events = colCell ? Array.from(colCell.querySelectorAll('.mis-cal-event')) : [];

          events.forEach((ev) => {
            const rawTime = text(ev.querySelector('.mis-cal-event-time span')?.textContent).trim();
            const time = rawTime.replace(/\s*-\s*/g, '–');
            const title = text(ev.querySelector('.title')?.textContent).trim() || 'Untitled';
            const eventId = text(ev.getAttribute('data-eventid')).trim()
            || (text(ev.getAttribute('ajax-link')).match(/\/id\/(\d+)/) || [])[1]
            || '';
            const cached = eventId ? tooltipCache.get(eventId) : null;

            out.push({
              eventId,
              dayKey,
              sortKey: `${dayKey} ${time || '00:00'}`,
              time,
              title,
              room: (cached && cached.room) || '',
                     details: cached || null
            });
          });
        });
      });
    });

    return out;
  };

  const mergeCalendar = () => {
    const byKey = new Map();
    state.calendar.forEach((i) => {
      const normTime = text(i.time).replace(/\s*[–-]\s*/g, '–');
      const key = `${i.dayKey}|${normTime}|${i.title}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, Object.assign({}, i, { time: normTime }));
      } else {
        if (!existing.room && i.room) existing.room = i.room;
        if (!existing.eventId && i.eventId) existing.eventId = i.eventId;
        if (!existing.details && i.details) existing.details = i.details;
      }
    });
    state.calendar = Array.from(byKey.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    queueTooltipFetches();
  };

  const parseKpis = (payload) => (payload && payload.items ? payload.items : [])
    .map((it) => {
      const f = it.fields || {};
      return {
        label: text(f.title && f.title.value).trim(),
        value: htmlToText(f.html && f.html.value)
      };
    })
    .filter((k) => k.label);

  const collectRows = (node, out, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 50) return;
    if (Array.isArray(node)) {
      node.forEach((n) => collectRows(n, out, depth + 1));
      return;
    }
    if (node.componentName === 'Arbor.container.PropertyRow' && node.props) {
      out.push(node.props);
    }
    Object.keys(node).forEach((k) => {
      if (k !== 'props') collectRows(node[k], out, depth + 1);
    });
  };

  const parseAssignments = (payload) => {
    const rows = [];
    collectRows(payload && payload.content ? payload.content : payload, rows);
    return rows.map((props) => {
      const markup = text(props.value);
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      const full = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      const boldEl = doc.querySelector('b, strong');
      const dueMatch = full.match(/\(?Due\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})\)?/i);
      const dueKey = dueMatch ? parseDue(dueMatch[1]) : null;
      const title = boldEl
        ? boldEl.textContent.replace(/\s+/g, ' ').trim()
        : full.replace(dueMatch ? dueMatch[0] : '', '').trim();
      if (!title) return null;
      return {
        id: 'a' + hash(`${title}|${dueKey || ''}`),
        title,
        dueKey,
        dueLabel: dueMatch ? dueMatch[1] : '',
        description: text(props.description).trim()
      };
    }).filter(Boolean);
  };

  const extractProfile = (root) => {
    const out = { first: '', last: '', full: '', avatar: '', extra: {} };
    const EXTRA_RE = /^(form|form_?group|tutor_?group|year_?group|year|house)$/i;

    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) { node.forEach((n) => visit(n, depth + 1)); return; }

      Object.keys(node).forEach((k) => {
        const raw = node[k];
        const v = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;

        if (typeof v === 'string' && v.trim()) {
          const s = v.trim();
          if (!out.avatar && /(avatar|photo|image|picture|thumbnail)/i.test(k) && /^(https?:\/\/|\/)/i.test(s)) {
            try { out.avatar = new URL(s, window.location.href).href; } catch (_) { /* ignore */ }
          } else if (!out.first && /^(forename|first_?name|firstname)$/i.test(k)) {
            out.first = s;
          } else if (!out.last && /^(surname|last_?name|lastname|family_?name)$/i.test(k)) {
            out.last = s;
          } else if (!out.full && /^(full_?name|display_?name|student_?name)$/i.test(k) && s.length < 100) {
            out.full = s;
          } else if (EXTRA_RE.test(k) && !out.extra[k]) {
            out.extra[k] = s;
          }
        }
        if (raw && typeof raw === 'object') visit(raw, depth + 1);
      });
    };

    visit(root, 0);
    return {
      name: out.full || [out.first, out.last].filter(Boolean).join(' '),
      avatar: out.avatar,
      extra: out.extra
    };
  };

  const mergeProfile = (payload) => {
    const p = extractProfile(payload);
    if (!p.name && !p.avatar && !Object.keys(p.extra).length) return;
    state.profile = {
      name: p.name || (state.profile && state.profile.name) || '',
      avatar: p.avatar || (state.profile && state.profile.avatar) || '',
      extra: Object.assign({}, state.profile && state.profile.extra, p.extra)
    };
  };

  const noteText = (n) => {
    if (!n || typeof n !== 'object') return text(n) || 'Notification';
    const key = ['title', 'subject', 'message', 'text', 'description'].find((k) => n[k]);
    return key ? text(n[key]).trim() : 'Notification';
  };

  /* ---------- UI construction ---------- */
  const ICON_BELL = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  const buildUI = () => {
    if ($(ROOT_ID) || !document.body) return;

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'arbetter-root';
    root.innerHTML = `
      <header class="ab-header">
        <div class="ab-brand">
          <img class="ab-logo" src="${LOGO_URL}" alt="">
          <span class="ab-title">ArBetter</span>
        </div>
        <div class="ab-profile">
          <button type="button" id="ab-avatar-btn" class="ab-avatar-btn" aria-expanded="false" aria-controls="ab-profile-details" title="Show profile details">
            <img id="ab-avatar" class="ab-avatar" alt="" hidden>
            <span id="ab-avatar-fallback" class="ab-avatar ab-avatar-fallback">?</span>
          </button>
          <span id="ab-student-name" class="ab-student-name">Loading…</span>
        </div>
        <div class="ab-header-actions">
          <button type="button" id="ab-notif-btn" class="ab-icon-btn" aria-label="Notifications" title="Notifications">
            ${ICON_BELL}
            <span id="ab-badge" class="ab-badge" hidden></span>
          </button>
          <button type="button" id="ab-theme-btn" class="ab-icon-btn" aria-pressed="false" aria-label="Toggle dark mode" title="Toggle dark mode">
            ${ICON_MOON}
          </button>
        </div>
      </header>
      <div id="ab-profile-details" class="ab-profile-details" hidden></div>
      <div id="ab-toast" class="ab-toast" role="status" hidden></div>
      <div id="ab-cal-tooltip" class="ab-cal-tooltip" role="tooltip" hidden></div>
      <div id="ab-loader" class="ab-loader-overlay" role="status" aria-live="polite" aria-label="Loading ArBetter"${state.loading ? '' : ' hidden'}>
      <div class="ab-spinner" aria-hidden="true">
      <span class="ab-spinner-circle ab-circle-top"></span>
      <span class="ab-spinner-circle ab-circle-right"></span>
      <span class="ab-spinner-circle ab-circle-bottom"></span>
      <span class="ab-spinner-circle ab-circle-left"></span>
      </div>
      </div>
      <main class="ab-main">
        <section class="ab-card">
        <div class="ab-card-head">
          <h2>Timetable</h2>
          <div class="ab-calendar-nav">
            <button type="button" id="ab-cal-prev" class="ab-nav-btn">‹</button>
            <span id="ab-calendar-date" class="ab-muted"></span>
            <button type="button" id="ab-cal-next" class="ab-nav-btn">›</button>
          </div>
        </div>

          <div class="ab-table-wrap">
            <table class="calendar-table">
              <thead><tr><th>Time</th><th>Subject / Title</th><th>Room</th></tr></thead>
              <tbody id="ab-calendar-body"></tbody>
            </table>
          </div>
        </section>
        <section class="ab-card">
          <div class="ab-card-head"><h2>Statistics</h2></div>
          <div class="ab-table-wrap">
            <table class="kpi-table">
              <thead><tr><th>Metric</th><th>Value</th></tr></thead>
              <tbody id="ab-kpi-body"></tbody>
            </table>
          </div>
        </section>
        <section class="ab-card">
          <div class="ab-card-head"><h2>Assignments (Checklist)</h2></div>
          <div class="ab-tabs" role="tablist">
            <button type="button" role="tab" class="ab-tab is-active" data-tab="active" aria-selected="true">Active <span id="ab-count-active"></span></button>
            <button type="button" role="tab" class="ab-tab" data-tab="completed" aria-selected="false">Completed <span id="ab-count-completed"></span></button>
          </div>
          <ul id="ab-assignments" class="ab-assignment-list"></ul>
        </section>
      </main>
      <footer class="ab-footer">
        <button type="button" id="ab-more-btn" class="ab-btn">See more on official page</button>
        <p id="ab-footer-text" class="ab-footer-text">This extension has some known limitations:</p>
        <ul class="ab-footer-text">
            <li>Calendar can only view the current day</li>
            <li>Cannot load profile picture and name</li>
            <li>Notifications are not displayed only indicated</li>
        </ul>
        <p id="ab-footer-text" class="ab-footer-text">These changes are either coming soon or not possible due to Arbor's design.</p>
        <a href="https://github.com/IKAZstudios/ArBetter" target="_blank" rel="noopener noreferrer">Abour ArBetter</a>  
      </footer>`;
    document.body.appendChild(root);

    const fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.type = 'button';
    fab.className = 'arbetter-fab';
    fab.textContent = 'Back to ArBetter';
    fab.hidden = !state.nativeView;
    document.body.appendChild(fab);

    bindEvents(root, fab);
    applyTheme(isDark());
    renderAll();
  };

  const ensureUI = () => {
    if (!state.active) return;
    if (document.body) {
      buildUI();
      return;
    }
    const obs = new MutationObserver(() => {
      if (document.body) {
        obs.disconnect();
        buildUI();
      }
    });
    obs.observe(html, { childList: true });
  };

  const renderAll = () => {
    renderProfile();
    renderCalendar();
    renderKpis();
    renderAssignments();
    updateBadge();
  };

  /* ---------- Events ---------- */
  const bindEvents = (root, fab) => {
    const goCalendar = (dir) => {
      const days = Array.from(new Set(state.calendar.map((i) => i.dayKey))).sort();
      if (!days.length) return;

      const current = state.currentCalendarDay || todayKey();
      let idx = days.indexOf(current);
      if (idx < 0) idx = 0;

      idx = Math.max(0, Math.min(days.length - 1, idx + dir));
      state.currentCalendarDay = days[idx];
      renderCalendar();
    };

    $('ab-cal-prev')?.addEventListener('click', () => goCalendar(-1));
    $('ab-cal-next')?.addEventListener('click', () => goCalendar(1));
    const calBody = $('ab-calendar-body');
    const calTip = $('ab-cal-tooltip');

    const hideCalTooltip = () => {
      if (calTip) calTip.hidden = true;
    };

      const showCalTooltip = (row) => {
        if (!calTip || !row) return;
        const idx = Number(row.dataset.calIdx);
        const day = state.currentCalendarDay || todayKey();
        const dayEvents = state.calendar
        .filter((i) => i.dayKey === day)
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        const ev = dayEvents[idx];
        if (!ev) return;

        const d = ev.details || (ev.eventId && tooltipCache.get(ev.eventId)) || {};
        const rows = [
          d.date ? ['Date', d.date] : ['Time', ev.time],
          (d.location || ev.room) ? ['Location', d.location || ev.room] : null,
 d.staff ? ['Staff', d.staff] : null
        ].filter(Boolean);

        if (!rows.length) return;

        calTip.innerHTML = `
        <div class="ab-cal-tip-title">${esc(d.title || ev.title)}</div>
        <dl class="ab-cal-tip-list">
        ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
        </dl>
        `;
        calTip.hidden = false;

        const rect = row.getBoundingClientRect();
        const tipRect = calTip.getBoundingClientRect();
        const left = Math.min(window.innerWidth - tipRect.width - 12, Math.max(12, rect.left + 16));
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow >= tipRect.height + 12
        ? rect.bottom + 6
        : Math.max(12, rect.top - tipRect.height - 6);

        calTip.style.left = `${left}px`;
        calTip.style.top = `${top}px`;
      };

      calBody?.addEventListener('mouseover', (e) => {
        const row = e.target.closest('tr[data-cal-idx]');
        if (row) showCalTooltip(row);
      });
        calBody?.addEventListener('mouseout', (e) => {
          if (!calBody.contains(e.relatedTarget)) hideCalTooltip();
        });
          calBody?.addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-cal-idx]');
            if (row) showCalTooltip(row);
          });
            window.addEventListener('scroll', hideCalTooltip, { passive: true });
    $('ab-avatar-btn').addEventListener('click', () => {
      const details = $('ab-profile-details');
      const expanded = $('ab-avatar-btn').getAttribute('aria-expanded') === 'true';
      $('ab-avatar-btn').setAttribute('aria-expanded', String(!expanded));
      details.hidden = expanded;
    });

    $('ab-notif-btn').addEventListener('click', onNotifClick);

    $('ab-theme-btn').addEventListener('click', () => applyTheme(!isDark()));

    root.querySelectorAll('.ab-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        root.querySelectorAll('.ab-tab').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        renderAssignments();
      });
    });

    root.addEventListener('change', (e) => {
      const cb = e.target;
      if (!cb || cb.type !== 'checkbox' || !cb.dataset.id) return;
      if (cb.checked) state.completed[cb.dataset.id] = true;
      else delete state.completed[cb.dataset.id];
      pruneCompleted();
      saveCompleted();
      renderAssignments();
    });

    $('ab-more-btn').addEventListener('click', showNative);
    fab.addEventListener('click', showMinimal);
  };

  const onNotifClick = () => {
    if (state.unread > 0) {
      const list = state.notifications.slice(0, 5).map((n) => '• ' + noteText(n)).join('\n');
      alert(`You have ${state.unread} notification(s):\n\n${list}\n\nOpening the official page so you can view them.`);
      state.unread = 0;
      updateBadge();
      showNative();
      return;
    }
    toast('Checking notifications…');
    sendToPage({ type: 'request', action: 'notifications' });
  };

  const handleNotifications = (payload) => {
    const list = payload && Array.isArray(payload.notifications) ? payload.notifications : [];
    state.notifications = list;
    state.unread = list.length;
    updateBadge();
    toast(list.length
      ? `${list.length} notification(s). Click the bell to view them.`
      : 'No new notifications.');
  };

  const updateBadge = () => {
    const badge = $('ab-badge');
    const bell = $('ab-notif-btn');
    if (!badge || !bell) return;
    badge.hidden = state.unread === 0;
    badge.textContent = state.unread > 9 ? '9+' : String(state.unread);
    bell.classList.toggle('has-unread', state.unread > 0);
  };

  let toastTimer = null;
  const toast = (msg) => {
    const t = $('ab-toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  };

  /* ---------- View switching ---------- */
  const showNative = () => {
    state.nativeView = true;
    html.classList.remove(CLS_MINIMAL);
    restoreBranding();
    const fab = $(FAB_ID);
    if (fab) fab.hidden = false;
  };

    const showMinimal = () => {
      state.nativeView = false;
      html.classList.add(CLS_MINIMAL);
      applyBranding();
      const fab = $(FAB_ID);
      if (fab) fab.hidden = true;
    };

  /* ---------- Theme ---------- */
  const isDark = () => html.classList.contains(CLS_PAGE_DARK);

  const applyTheme = (dark) => {
    html.classList.toggle(CLS_PAGE_DARK, dark);
    const root = $(ROOT_ID);
    if (root) root.classList.toggle('dark-mode', dark);
    const btn = $('ab-theme-btn');
    if (btn) btn.setAttribute('aria-pressed', String(dark));
    setLS(KEY_DARK, String(dark));
  };

  /* ---------- Renderers ---------- */
  const initials = (name) => (name || '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]).join('').toUpperCase() || '?';

  const labelize = (k) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  const renderProfile = () => {
    const nameEl = $('ab-student-name');
    if (!nameEl) return;
    const p = state.profile || {};
    const name = p.name || 'Student';
    nameEl.textContent = name;

    const img = $('ab-avatar');
    const fb = $('ab-avatar-fallback');
    if (p.avatar) {
      img.onerror = () => { img.hidden = true; fb.hidden = false; };
      img.src = p.avatar;
      img.hidden = false;
      fb.hidden = true;
    } else {
      img.hidden = true;
      fb.hidden = false;
      fb.textContent = initials(name);
    }

    const details = $('ab-profile-details');
    const entries = Object.entries(p.extra || {});
    details.innerHTML = entries.length
      ? '<dl>' + entries.map(([k, v]) => `<dt>${esc(labelize(k))}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>'
      : '<p class="ab-muted">No additional details available.</p>';
  };

  const renderCalendar = () => {
    const body = $('ab-calendar-body');
    if (!body) return;

    const today = todayKey();
    const days = Array.from(new Set(state.calendar.map((i) => i.dayKey))).sort();

    if (!days.length) {
      $('ab-calendar-date').textContent = '';
      body.innerHTML = '<tr><td colspan="3" class="ab-empty">No timetabled lessons.</td></tr>';
      return;
    }

    let dayIndex = days.indexOf(state.currentCalendarDay || today);
    if (dayIndex < 0) dayIndex = days.indexOf(today);
    if (dayIndex < 0) dayIndex = 0;

    state.currentCalendarDay = days[dayIndex];
    const day = state.currentCalendarDay;
    const list = state.calendar
    .filter((i) => i.dayKey === day)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    $('ab-calendar-date').textContent = formatDay(day) + (day === today ? ' (today)' : '');

    body.innerHTML = list.length
    ? list.map((i, idx) => `<tr class="ab-cal-row" data-cal-idx="${idx}">
    <td class="ab-nowrap">${esc(i.time)}</td>
    <td>${esc(i.title)}</td>
    <td>${esc(i.room || '—')}</td>
    </tr>`).join('')
    : '<tr><td colspan="3" class="ab-empty">No timetabled lessons.</td></tr>';
  };


  const renderKpis = () => {
    const body = $('ab-kpi-body');
    if (!body) return;
    const all = state.kpiMain.concat(state.kpiAssign);
    body.innerHTML = all.length
      ? all.map((k) => `<tr>
          <td>${esc(k.label)}</td>
          <td class="ab-kpi-value">${esc(k.value || '—')}</td>
        </tr>`).join('')
      : '<tr><td colspan="2" class="ab-empty">No indicators available yet.</td></tr>';
  };

  const byDue = (a, b) =>
    (a.dueKey || '9999-12-31').localeCompare(b.dueKey || '9999-12-31') || a.title.localeCompare(b.title);

  const renderAssignments = () => {
    const list = $('ab-assignments');
    if (!list) return;
    const today = todayKey();
    const active = state.assignments.filter((a) => !state.completed[a.id]).sort(byDue);
    const done = state.assignments.filter((a) => state.completed[a.id]).sort(byDue);

    $('ab-count-active').textContent = `(${active.length})`;
    $('ab-count-completed').textContent = `(${done.length})`;

    const isActiveTab = state.tab === 'active';
    const items = isActiveTab ? active : done;

    list.innerHTML = items.length
    ? items.map((a) => {
      const submitted = Boolean(a.submitted);
      const overdue = isActiveTab && !submitted && a.dueKey && a.dueKey < today;
      const meta = [
        a.dueLabel ? `Due ${a.dueLabel}` : 'No due date',
        a.description
      ].filter(Boolean).join(' · ');
      const badge = submitted
      ? '<span class="ab-chip ab-chip-success">Submitted</span>'
      : (overdue ? '<span class="ab-chip ab-chip-danger">Overdue</span>' : '');
      return `<li class="ab-assignment${submitted ? ' is-submitted' : ''}${overdue ? ' is-overdue' : ''}${isActiveTab ? '' : ' is-done'}">
      <label class="ab-check">
      <input type="checkbox" data-id="${esc(a.id)}" ${isActiveTab ? '' : 'checked'}
      aria-label="Mark ${esc(a.title)} as ${isActiveTab ? 'completed' : 'active'}">
      </label>
      <div class="ab-a-body">
      <div class="ab-a-title">${esc(a.title)}</div>
      <div class="ab-a-meta">${esc(meta)}</div>
      </div>
      ${badge}
      </li>`;
    }).join('')
    : `<li class="ab-empty">${isActiveTab ? 'No active assignments.' : 'Nothing completed yet.'}</li>`;
  };

  /* ---------- Completed-state persistence ---------- */
  const pruneCompleted = () => {
    const keys = Object.keys(state.completed);
    if (keys.length > MAX_COMPLETED) {
      keys.slice(0, keys.length - MAX_COMPLETED).forEach((k) => delete state.completed[k]);
    }
  };

  const saveCompleted = () => {
    chrome.storage.sync.set({ [KEY_COMPLETED]: state.completed }, () => {
      if (chrome.runtime.lastError) toast('Could not save assignment state.');
    });
  };

  chrome.storage.sync.get({ [KEY_COMPLETED]: {} }, (res) => {
    state.completed = res[KEY_COMPLETED] || {};
    renderAssignments();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes[KEY_ENABLED]) {
      const enabled = changes[KEY_ENABLED].newValue !== false;
      setLS(KEY_CACHE_ENABLED, String(enabled));
      if (enabled) enable(); else disable();
    }
    if (changes[KEY_COMPLETED]) {
      state.completed = changes[KEY_COMPLETED].newValue || {};
      renderAssignments();
    }
  });
})();
