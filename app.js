/* ============================================
   Beast Dashboard v2 — Spartan tracking
   - Daily Non-Negotiables (6 checks/day)
   - Weekly Menu (sessions assigned to days)
   Talks to local Python backend at /api/daily and /api/weekly,
   which upserts to Notion DBs. localStorage = offline cache.
   ============================================ */

const BEAST_DATE = new Date("2026-11-21T08:00:00-06:00");
const W1_START = new Date("2026-06-01T00:00:00-05:00");
const TOTAL_WEEKS = 26;
const PHASES = [
  { name: "Reset",      start: "2026-05-17", end: "2026-05-31" },
  { name: "Foundation", start: "2026-06-01", end: "2026-07-26" },
  { name: "Build",      start: "2026-07-27", end: "2026-09-20" },
  { name: "Peak",       start: "2026-09-21", end: "2026-11-01" },
  { name: "Taper",      start: "2026-11-02", end: "2026-11-15" },
  { name: "Race Week",  start: "2026-11-16", end: "2026-11-20" },
  { name: "Beast Day",  start: "2026-11-21", end: "2026-11-21" }
];

const DAILY_MOVES = [
  { id: "Hip CARs",        label: "Hip CARs"          },
  { id: "90/90",           label: "90/90 hip switches" },
  { id: "Spinal Waves",    label: "Spinal waves"       },
  { id: "Bottom Squat",    label: "Bottom squat hold"  },
  { id: "Passive Hang",    label: "Passive hang"       },
  { id: "Elephant Walks",  label: "Elephant walks"     }
];

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SESSION_TIERS = {
  "X3 Push": "Floor", "X3 Pull": "Floor", "Long Run": "Floor", "Bouldering": "Floor",
  "Cardio + Grip": "Standard", "Posterior Chain + Farmer's Carry": "Standard",
  "Mixed Block + Bear-Hug": "Standard",
  "Daily NN": "Floor", "Bonus": "Bonus"
};

// ── State ─────────────────────────────────────
let dailyState = {};            // { [YYYY-MM-DD]: { "Hip CARs": true, ... } }
let weekSessions = [];          // [{ id?, date, session, tier, status }]
let weekStartIso = null;        // YYYY-MM-DD (Monday of current week)
let setSyncStatus = () => {};

// ── Helpers ───────────────────────────────────
function todayIso() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dateIso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function weekMonday(d) {
  const out = new Date(d);
  const dow = out.getDay(); // 0 Sun, 1 Mon, ...
  const diff = (dow + 6) % 7;
  out.setDate(out.getDate() - diff);
  out.setHours(0, 0, 0, 0);
  return out;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysBetween(a, b) {
  return Math.ceil((startOfDay(b) - startOfDay(a)) / 86400000);
}
function getPhase(now) {
  for (const p of PHASES) {
    const s = new Date(p.start + "T00:00:00-05:00");
    const e = new Date(p.end + "T23:59:59-05:00");
    if (now >= s && now <= e) return p;
  }
  if (now < new Date(PHASES[0].start + "T00:00:00-05:00")) return { name: "Pre-Reset" };
  return { name: "Post-Beast" };
}
function getWeekNum(now) {
  if (now < W1_START) return 0;
  const days = Math.floor((startOfDay(now) - startOfDay(W1_START)) / 86400000);
  return Math.floor(days / 7) + 1;
}

// ── Sync layer ────────────────────────────────
async function api(method, path, body) {
  setSyncStatus('syncing');
  try {
    const opts = { method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    const json = r.status === 204 ? null : await r.json();
    setSyncStatus('synced');
    return json;
  } catch (e) {
    console.warn('api fail', path, e);
    setSyncStatus('error');
    return null;
  }
}

async function loadDaily(date) {
  const data = await api('GET', `/api/daily?date=${date}`);
  if (data && typeof data === 'object') {
    dailyState[date] = data.checks || {};
  } else {
    // offline fallback to localStorage
    try {
      const cached = JSON.parse(localStorage.getItem('beast.daily.' + date) || '{}');
      dailyState[date] = cached;
    } catch (e) { dailyState[date] = {}; }
  }
  // Cache
  try { localStorage.setItem('beast.daily.' + date, JSON.stringify(dailyState[date])); } catch(e) {}
}

async function saveDaily(date) {
  // Cache locally first
  try { localStorage.setItem('beast.daily.' + date, JSON.stringify(dailyState[date] || {})); } catch(e) {}
  // Push to server
  await api('POST', '/api/daily', { date, checks: dailyState[date] || {} });
}

async function loadWeek(weekStart) {
  const data = await api('GET', `/api/weekly?week=${weekStart}`);
  if (data && Array.isArray(data.sessions)) {
    weekSessions = data.sessions;
  } else {
    try {
      const cached = JSON.parse(localStorage.getItem('beast.week.' + weekStart) || '[]');
      weekSessions = cached;
    } catch (e) { weekSessions = []; }
  }
  try { localStorage.setItem('beast.week.' + weekStart, JSON.stringify(weekSessions)); } catch(e) {}
}

async function saveWeek(weekStart) {
  try { localStorage.setItem('beast.week.' + weekStart, JSON.stringify(weekSessions)); } catch(e) {}
  await api('POST', '/api/weekly', { week: weekStart, sessions: weekSessions });
}

// ── Streak calc ───────────────────────────────
async function computeStreak() {
  // Walk back from today; a "streak day" requires all 6 moves checked.
  // Get the past 14 days of cached state for speed; fetch server if missing.
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = dateIso(d);
    if (!dailyState[iso]) {
      // load from cache only (don't hit API for each day)
      try {
        dailyState[iso] = JSON.parse(localStorage.getItem('beast.daily.' + iso) || '{}');
      } catch(e) { dailyState[iso] = {}; }
    }
    const state = dailyState[iso] || {};
    const doneCount = DAILY_MOVES.filter(m => state[m.id]).length;
    if (doneCount === DAILY_MOVES.length) {
      streak++;
    } else if (i === 0) {
      // today not yet complete — streak can still continue from yesterday
      continue;
    } else {
      break;
    }
  }
  return streak;
}

// ── Rendering ─────────────────────────────────
function renderHero() {
  const now = new Date();
  const phase = getPhase(now);
  const weekNum = getWeekNum(now);
  document.getElementById('hero-meta').textContent =
    `${phase.name} · Week ${weekNum} / ${TOTAL_WEEKS}`;
  document.getElementById('days-to-beast').textContent = Math.max(0, daysBetween(now, BEAST_DATE));
  const start = new Date("2026-05-17T00:00:00-05:00");
  const total = BEAST_DATE - start;
  const elapsed = Math.max(0, now - start);
  document.getElementById('phase-progress').style.width = Math.min(100, (elapsed / total) * 100) + '%';
}

async function renderDaily() {
  const today = todayIso();
  const state = dailyState[today] || {};
  const doneCount = DAILY_MOVES.filter(m => state[m.id]).length;
  document.getElementById('daily-sub').textContent =
    doneCount === DAILY_MOVES.length
      ? `✅ All ${DAILY_MOVES.length} done today.`
      : `${doneCount} / ${DAILY_MOVES.length} done today`;

  const list = document.getElementById('daily-list');
  list.innerHTML = '';
  DAILY_MOVES.forEach(move => {
    const li = document.createElement('li');
    li.className = 'check-item' + (state[move.id] ? ' done' : '');
    li.innerHTML = `<div class="check-box"></div><span class="check-label">${move.label}</span>`;
    li.addEventListener('click', async () => {
      dailyState[today] = dailyState[today] || {};
      dailyState[today][move.id] = !dailyState[today][move.id];
      await saveDaily(today);
      renderDaily();
      const streak = await computeStreak();
      document.getElementById('streak-num').textContent = streak;
    });
    list.appendChild(li);
  });
}

function renderWeek() {
  const weekStart = new Date(weekStartIso + "T00:00:00");
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const fmtDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  document.getElementById('week-range').textContent = `${fmtDay(weekStart)} – ${fmtDay(weekEnd)}`;

  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  const todayStr = todayIso();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const iso = dateIso(d);
    const sessionsForDay = weekSessions.filter(s => s.date === iso);

    const div = document.createElement('div');
    div.className = 'week-day' + (iso === todayStr ? ' today' : '');

    const label = document.createElement('div');
    label.className = 'day-label';
    label.textContent = DAYS_OF_WEEK[i];

    const sessions = document.createElement('div');
    sessions.className = 'day-sessions';

    if (sessionsForDay.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'empty-day';
      empty.textContent = '—';
      sessions.appendChild(empty);
    } else {
      sessionsForDay.forEach((s, idx) => {
        const chip = document.createElement('span');
        chip.className = 'session-chip' + (s.status === 'Done' ? ' done' : s.status === 'Skipped' ? ' skipped' : '');
        const tierKey = (s.tier || 'Standard').toLowerCase();
        chip.innerHTML = `<span class="tier-dot ${tierKey}"></span><span>${s.session}</span><span class="chip-x">×</span>`;

        chip.addEventListener('click', async (e) => {
          if (e.target.classList.contains('chip-x')) {
            // Delete this session
            weekSessions = weekSessions.filter(ws => ws !== s);
            await saveWeek(weekStartIso);
            renderWeek();
            return;
          }
          // Cycle status: Planned → Done → Skipped → Planned
          const cycle = { 'Planned': 'Done', 'Done': 'Skipped', 'Skipped': 'Planned' };
          s.status = cycle[s.status || 'Planned'] || 'Done';
          await saveWeek(weekStartIso);
          renderWeek();
        });

        sessions.appendChild(chip);
      });
    }

    div.appendChild(label);
    div.appendChild(sessions);
    grid.appendChild(div);
  }

  // Stats
  const doneCount = weekSessions.filter(s => s.status === 'Done').length;
  const total = weekSessions.length;
  document.getElementById('week-stats').textContent =
    total === 0 ? 'no sessions yet' : `${doneCount} / ${total} done this week`;
}

// ── Add-session modal ─────────────────────────
function openAddModal() {
  const sel = document.getElementById('add-day');
  sel.innerHTML = '';
  const weekStart = new Date(weekStartIso + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const iso = dateIso(d);
    const opt = document.createElement('option');
    opt.value = iso;
    opt.textContent = `${DAYS_OF_WEEK[i]} (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
    if (iso === todayIso()) opt.selected = true;
    sel.appendChild(opt);
  }
  // Auto-tier based on session
  document.getElementById('add-session').onchange = () => {
    const s = document.getElementById('add-session').value;
    document.getElementById('add-tier').value = SESSION_TIERS[s] || 'Standard';
  };
  document.getElementById('add-modal').classList.add('open');
}
function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
}
async function saveAdd() {
  const date = document.getElementById('add-day').value;
  const session = document.getElementById('add-session').value;
  const tier = document.getElementById('add-tier').value;
  weekSessions.push({ date, session, tier, status: 'Planned' });
  await saveWeek(weekStartIso);
  closeAddModal();
  renderWeek();
}

// ── Init ──────────────────────────────────────
async function init() {
  // sync-dot helper
  setSyncStatus = (state) => {
    const dot = document.getElementById('sync-dot');
    dot.className = 'sync-dot' + (state ? ' ' + state : '');
  };

  // Compute week boundaries
  const today = new Date();
  weekStartIso = dateIso(weekMonday(today));

  // Initial render with cached data
  renderHero();
  renderDaily();
  renderWeek();
  computeStreak().then(s => { document.getElementById('streak-num').textContent = s; });

  // Load from server
  await Promise.all([
    loadDaily(todayIso()),
    loadWeek(weekStartIso)
  ]);
  renderDaily();
  renderWeek();
  const streak = await computeStreak();
  document.getElementById('streak-num').textContent = streak;

  // Wire up buttons
  document.getElementById('add-session-btn').addEventListener('click', openAddModal);
  document.getElementById('cancel-add-btn').addEventListener('click', closeAddModal);
  document.getElementById('save-add-btn').addEventListener('click', saveAdd);
  document.getElementById('add-modal').addEventListener('click', (e) => {
    if (e.target.id === 'add-modal') closeAddModal();
  });

  // Refresh hero countdown every minute
  setInterval(renderHero, 60000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
