/* ============================================
   Beast Dashboard v2 — Spartan tracking
   - Daily Non-Negotiables (6 checks/day)
   - Weekly Menu (sessions assigned to days)
   Talks to local Python backend at /api/daily and /api/weekly,
   which upserts to Notion DBs. localStorage = offline cache.
   ============================================ */

const BEAST_DATE = new Date("2026-11-21T08:00:00-06:00");
const W1_START = new Date("2026-05-31T00:00:00-05:00");
const TOTAL_WEEKS = 26;
const PHASES = [
  { name: "Reset",      start: "2026-05-17", end: "2026-05-30" },
  { name: "Foundation", start: "2026-05-31", end: "2026-07-26" },
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
  { id: "Elephant Walks",  label: "Elephant walks"     },
  { id: "Burpees",         label: "Burpees", dynamicLabel: () => `Burpees ×${burpeeTargetToday()}` }
];

// Burpee ladder — periodized to peak with fitness, taper down for race
const BURPEE_TARGETS = {
  "Reset": 10,
  "Foundation": 15,
  "Build": 20,
  "Peak": 30,
  "Taper": 15,
  "Race Week": 10,
  "Beast Day": 0
};
function burpeeTargetToday() {
  const phase = getPhase(new Date());
  return BURPEE_TARGETS[phase.name] ?? 15;
}

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Modalities — Required has weekly count targets; Mix is no-target tracking
// Hill Repeats is required ONLY in Build + Peak phases (phase-aware target)
const MODALITIES = {
  required: [
    { id: "X3 Push",      target: 1, tier: "Floor" },
    { id: "X3 Pull",      target: 1, tier: "Floor" },
    { id: "Long Run",     target: 1, tier: "Floor" },
    { id: "Bouldering",   target: 2, tier: "Floor" },
    { id: "Hill Repeats", target: () => ["Build","Peak"].includes(getPhase(new Date()).name) ? 1 : 0, tier: "Standard" }
  ],
  mix: [
    { id: "Jump Rope",       tier: "Standard" },
    { id: "Farmer's Carry",  tier: "Standard" },
    { id: "Bucket Carry",    tier: "Standard" },
    { id: "Sledgehammer",    tier: "Standard" },
    { id: "Boxing",          tier: "Standard" },
    { id: "Nordic Curls",    tier: "Standard" },
    { id: "Burpees (extra)", tier: "Bonus"    }
  ]
};
function modalityTarget(m) {
  return typeof m.target === 'function' ? m.target() : m.target;
}
function modalityTier(id) {
  const m = MODALITIES.required.find(x => x.id === id) || MODALITIES.mix.find(x => x.id === id);
  return m ? m.tier : "Standard";
}

// ── State ─────────────────────────────────────
let dailyState = {};            // { [YYYY-MM-DD]: { "Hip CARs": true, ... } }
let weekSessions = [];          // [{ id?, date, session, tier, status }]
let weekStartIso = null;        // YYYY-MM-DD (Sunday of current week)
let weekDirty = false;          // unsynced local edits exist?
let pendingChanges = 0;         // count since last sync (for the Sync button label)
let viewingDateIso = null;      // YYYY-MM-DD — which daily-NN day the user is currently viewing
let setSyncStatus = () => {};
let planData = null;            // loaded from data/plan.json
let planViewWeek = null;        // which week# the Weekly Focus modal is showing

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
function weekSunday(d) {
  const out = new Date(d);
  const dow = out.getDay(); // 0 Sun, 1 Mon, ...
  out.setDate(out.getDate() - dow);
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
  // Unsynced local edits win — don't clobber them with server data.
  if (localStorage.getItem('beast.week.' + weekStart + '.dirty') === '1') {
    try { weekSessions = JSON.parse(localStorage.getItem('beast.week.' + weekStart) || '[]'); }
    catch (e) { weekSessions = []; }
    weekSessions = dedupeSessions(weekSessions);   // dedupe even local/dirty data
    weekDirty = true; updateSyncButton();
    return;
  }
  const data = await api('GET', `/api/weekly?week=${weekStart}`);
  if (data && Array.isArray(data.sessions)) {
    weekSessions = data.sessions;
  } else {
    try { weekSessions = JSON.parse(localStorage.getItem('beast.week.' + weekStart) || '[]'); }
    catch (e) { weekSessions = []; }
  }
  // Drop exact-duplicate rows left behind by the old auto-sync race (stacks of
  // identical chips). If we cleaned any, mark the week dirty so a Sync pushes the
  // de-duped list back to Notion and clears them at the source.
  const before = weekSessions.length;
  weekSessions = dedupeSessions(weekSessions);
  try { localStorage.setItem('beast.week.' + weekStart, JSON.stringify(weekSessions)); } catch(e) {}
  if (weekSessions.length < before) {
    weekDirty = true;
    try { localStorage.setItem('beast.week.' + weekStart + '.dirty', '1'); } catch(e) {}
  } else {
    weekDirty = false;
  }
  updateSyncButton();
}

async function saveWeek(weekStart) {
  try { localStorage.setItem('beast.week.' + weekStart, JSON.stringify(weekSessions)); } catch(e) {}
  await api('POST', '/api/weekly', { week: weekStart, sessions: weekSessions });
}

// ── Manual sync (no more auto-push-on-every-tap → no race → no duplicates) ──
function dedupeSessions(arr) {
  const seen = new Set(); const out = [];
  for (const s of (arr || [])) {
    const k = [s.date, s.session, s.tier, s.status].join('|');
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
  }
  return out;
}
function markDirty() {
  weekDirty = true; pendingChanges++;
  try {
    localStorage.setItem('beast.week.' + weekStartIso, JSON.stringify(weekSessions));
    localStorage.setItem('beast.week.' + weekStartIso + '.dirty', '1');
  } catch (e) {}
  updateSyncButton();
}
function updateSyncButton() {
  const btn = document.getElementById('sync-week-btn');
  if (!btn) return;
  if (weekDirty) {
    btn.textContent = pendingChanges > 0 ? `⤴ Sync (${pendingChanges})` : '⤴ Sync';
    btn.classList.remove('hidden', 'synced'); btn.classList.add('dirty'); btn.disabled = false;
  } else {
    btn.classList.add('hidden'); btn.classList.remove('dirty', 'synced');
  }
}
async function syncWeek() {
  const btn = document.getElementById('sync-week-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⤴ Syncing…'; btn.classList.remove('dirty'); }
  try {
    await saveWeek(weekStartIso);   // POST → server clears the week in Notion + rewrites it cleanly
    weekDirty = false; pendingChanges = 0;
    try { localStorage.removeItem('beast.week.' + weekStartIso + '.dirty'); } catch (e) {}
    if (btn) { btn.textContent = '✓ Synced'; btn.classList.add('synced'); setTimeout(updateSyncButton, 1600); }
  } catch (e) {
    weekDirty = true;
    if (btn) { btn.disabled = false; btn.classList.add('dirty'); btn.textContent = '⤴ Sync — retry'; }
  }
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

async function renderDailyStrip() {
  // 7 dots Sun-Sat for the current week, each clickable to choose viewing date
  const strip = document.getElementById('daily-strip');
  strip.innerHTML = '';
  const weekStart = new Date(weekStartIso + "T00:00:00");
  const todayStr = todayIso();
  // Ensure all 7 days are loaded into dailyState (from cache; server fetch only for current)
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const iso = dateIso(d);
    if (!dailyState[iso]) {
      try { dailyState[iso] = JSON.parse(localStorage.getItem('beast.daily.' + iso) || '{}'); }
      catch (e) { dailyState[iso] = {}; }
    }
    const state = dailyState[iso];
    const doneCount = DAILY_MOVES.filter(m => state[m.id]).length;
    const isFuture = d > new Date();
    const isToday = iso === todayStr;
    const isViewing = iso === viewingDateIso;

    const cell = document.createElement('button');
    cell.className = 'strip-day' +
      (isViewing ? ' viewing' : '') +
      (isToday ? ' today' : '') +
      (isFuture ? ' future' : '') +
      (doneCount === DAILY_MOVES.length ? ' full' : doneCount > 0 ? ' partial' : '');
    cell.dataset.iso = iso;
    cell.innerHTML = `
      <span class="strip-dow">${DAYS_OF_WEEK[i]}</span>
      <span class="strip-count">${doneCount}/${DAILY_MOVES.length}</span>
    `;
    cell.addEventListener('click', () => {
      viewingDateIso = iso;
      renderDailyStrip();
      renderDailyList();
    });
    strip.appendChild(cell);
  }
}

async function renderDailyList() {
  const iso = viewingDateIso;
  const state = dailyState[iso] || {};
  const doneCount = DAILY_MOVES.filter(m => state[m.id]).length;
  const isToday = iso === todayIso();
  const isPast = new Date(iso + "T23:59:59") < new Date();

  // Header label for the day being viewed
  const labelDate = new Date(iso + "T00:00:00");
  const labelStr = labelDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const sub = document.getElementById('daily-sub');
  if (doneCount === DAILY_MOVES.length) {
    sub.textContent = `${labelStr} · ✅ all ${DAILY_MOVES.length} done`;
  } else {
    sub.textContent = `${labelStr} · ${doneCount} / ${DAILY_MOVES.length} done${isToday ? ' today' : ''}`;
  }

  const list = document.getElementById('daily-list');
  list.innerHTML = '';
  DAILY_MOVES.forEach(move => {
    const li = document.createElement('li');
    li.className = 'check-item' + (state[move.id] ? ' done' : '');
    const labelText = move.dynamicLabel ? move.dynamicLabel() : move.label;
    li.innerHTML = `<div class="check-box"></div><span class="check-label">${labelText}</span>`;
    li.addEventListener('click', async () => {
      dailyState[iso] = dailyState[iso] || {};
      dailyState[iso][move.id] = !dailyState[iso][move.id];
      await saveDaily(iso);
      renderDailyList();
      renderDailyStrip();
      const streak = await computeStreak();
      document.getElementById('streak-num').textContent = streak;
    });
    list.appendChild(li);
  });
}

async function renderDaily() {
  renderDailyStrip();
  renderDailyList();
}

function renderWeek() {
  const weekStart = new Date(weekStartIso + "T00:00:00");
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const fmtDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  document.getElementById('week-range').textContent = `${fmtDay(weekStart)} – ${fmtDay(weekEnd)}`;

  renderStillOwed();
  renderDayGrid(weekStart);
  renderModalityTracker();

  // Bottom stats
  const doneCount = weekSessions.filter(s => s.status === 'Done').length;
  const total = weekSessions.length;
  document.getElementById('week-stats').textContent =
    total === 0 ? 'no sessions yet' : `${doneCount} / ${total} done`;
  updateSyncButton();
}

function renderDayGrid(weekStart) {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';
  const todayStr = todayIso();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const iso = dateIso(d);
    const sessionsForDay = weekSessions.filter(s => s.date === iso);

    const div = document.createElement('div');
    div.className = 'week-day clickable' + (iso === todayStr ? ' today' : '');
    div.dataset.iso = iso;
    // Tap anywhere on the day row (except a chip) opens the log modal for that day
    div.addEventListener('click', (e) => {
      if (e.target.closest('.session-chip')) return;
      openAddModal(iso);
    });

    const label = document.createElement('div');
    label.className = 'day-label';
    label.textContent = DAYS_OF_WEEK[i];

    const sessions = document.createElement('div');
    sessions.className = 'day-sessions';

    if (sessionsForDay.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'empty-day';
      empty.textContent = '+ tap to log';
      sessions.appendChild(empty);
    } else {
      sessionsForDay.forEach((s) => {
        const chip = document.createElement('span');
        chip.className = 'session-chip' + (s.status === 'Done' ? ' done' : s.status === 'Skipped' ? ' skipped' : '');
        const tierKey = (s.tier || modalityTier(s.session) || 'Standard').toLowerCase();
        chip.innerHTML = `<span class="tier-dot ${tierKey}"></span><span>${s.session}</span><span class="chip-x">×</span>`;
        chip.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (e.target.classList.contains('chip-x')) {
            weekSessions = weekSessions.filter(ws => ws !== s);
            markDirty();
            renderWeek();
            return;
          }
          const cycle = { 'Planned': 'Done', 'Done': 'Skipped', 'Skipped': 'Planned' };
          s.status = cycle[s.status || 'Planned'] || 'Done';
          markDirty();
          renderWeek();
        });
        sessions.appendChild(chip);
      });
    }
    div.appendChild(label);
    div.appendChild(sessions);
    grid.appendChild(div);
  }
}

function modalityStats(id) {
  const matches = weekSessions.filter(s => s.session === id);
  const days = matches.map(s => {
    const d = new Date(s.date + "T00:00:00");
    return { dow: DAYS_OF_WEEK[d.getDay()], status: s.status };
  });
  return { count: matches.length, days };
}

function renderStillOwed() {
  const owed = document.getElementById('still-owed');
  const items = [];
  MODALITIES.required.forEach(m => {
    const target = modalityTarget(m);
    if (target <= 0) return; // skip modalities not required this phase
    const { count } = modalityStats(m.id);
    const missing = target - count;
    if (missing > 0) items.push(`${missing}× ${m.id}`);
  });
  if (items.length === 0) {
    owed.className = 'still-owed all-done';
    owed.innerHTML = `<span class="owed-icon">✓</span><span>Required menu complete</span>`;
  } else {
    owed.className = 'still-owed';
    owed.innerHTML = `<span class="owed-icon">⚠</span><span class="owed-label">Owed:</span> <span class="owed-items">${items.join(' · ')}</span>`;
  }
}

function renderModalityTracker() {
  const tracker = document.getElementById('modality-tracker');
  tracker.innerHTML = '';

  function makeRow(mod, includeTarget) {
    const { count, days } = modalityStats(mod.id);
    const target = includeTarget ? modalityTarget(mod) : 0;
    const useTarget = includeTarget && target > 0;
    let status;
    if (useTarget) {
      if (count > target) status = 'over';
      else if (count === target) status = 'done';
      else if (count > 0) status = 'partial';
      else status = 'todo';
    } else {
      status = count > 0 ? 'logged' : 'empty';
    }
    const icon = { over:'✨', done:'✅', partial:'⚠️', todo:'❌', logged:'·', empty:'·' }[status];
    const countText = useTarget ? `${count}/${target}` : `${count}`;

    const row = document.createElement('div');
    row.className = `modality-row status-${status}`;
    row.innerHTML = `
      <span class="mod-icon">${icon}</span>
      <span class="mod-name">${mod.id}</span>
      <span class="mod-count">${countText}</span>
      <span class="mod-days">${days.map(d => `<span class="mod-day-chip ${d.status === 'Done' ? 'done' : d.status === 'Skipped' ? 'skipped' : ''}">${d.dow}</span>`).join('')}</span>
    `;
    return row;
  }

  const reqLabel = document.createElement('div');
  reqLabel.className = 'modality-section-label';
  reqLabel.textContent = 'Required';
  tracker.appendChild(reqLabel);
  MODALITIES.required.forEach(m => tracker.appendChild(makeRow(m, true)));

  const mixLabel = document.createElement('div');
  mixLabel.className = 'modality-section-label';
  mixLabel.textContent = 'Mix & match';
  tracker.appendChild(mixLabel);
  MODALITIES.mix.forEach(m => tracker.appendChild(makeRow(m, false)));
}

// ── Log-session modal ─────────────────────────
function openAddModal(presetDate) {
  // Day picker
  const sel = document.getElementById('add-day');
  sel.innerHTML = '';
  const weekStart = new Date(weekStartIso + "T00:00:00");
  const defaultIso = presetDate || todayIso();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const iso = dateIso(d);
    const opt = document.createElement('option');
    opt.value = iso;
    opt.textContent = `${DAYS_OF_WEEK[i]} (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
    if (iso === defaultIso) opt.selected = true;
    sel.appendChild(opt);
  }

  // Render modality checkbox groups
  function buildCheckboxes(container, list) {
    container.innerHTML = '';
    list.forEach(m => {
      const { count } = modalityStats(m.id);
      const t = modalityTarget(m);
      const isMet = t > 0 && count >= t;
      const label = document.createElement('label');
      label.className = 'modality-cb' + (isMet ? ' met' : '');
      const targetHint = t > 0 ? ` <span class="cb-target">${count}/${t}</span>` : (count > 0 ? ` <span class="cb-target">×${count}</span>` : '');
      label.innerHTML = `<input type="checkbox" value="${m.id}"><span class="cb-mark"></span><span class="cb-name">${m.id}${targetHint}</span>`;
      container.appendChild(label);
    });
  }
  buildCheckboxes(document.getElementById('add-required'), MODALITIES.required);
  buildCheckboxes(document.getElementById('add-mix'), MODALITIES.mix);

  document.getElementById('add-modal').classList.add('open');
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
}

// ── Weekly Focus modal ─────────────────────────
async function loadPlan() {
  try {
    const r = await fetch('data/plan.json');
    if (r.ok) planData = await r.json();
  } catch (e) { console.warn('plan.json fetch failed', e); }
}

function openPlanModal(weekNum) {
  if (!planData) return;
  const wk = weekNum != null ? weekNum : getWeekNum(new Date());
  planViewWeek = wk;
  renderPlanModal();
  document.getElementById('plan-modal').classList.add('open');
}

function closePlanModal() {
  document.getElementById('plan-modal').classList.remove('open');
}

function renderPlanModal() {
  const wk = planViewWeek;
  const data = planData && planData.weeks[String(wk)];
  if (!data) {
    document.getElementById('plan-weeknum').textContent = '—';
    document.getElementById('plan-phase').textContent = wk < 0 ? 'Pre-plan' : 'Post-Beast';
    document.getElementById('plan-theme').textContent = 'No plan entry';
    document.getElementById('plan-intent').textContent = '';
    document.getElementById('plan-run-target').textContent = '—';
    document.getElementById('plan-dont-miss').textContent = '—';
    return;
  }
  document.getElementById('plan-weeknum').textContent = wk === 0 ? 'Reset' : `Week ${wk} / 26`;
  document.getElementById('plan-phase').textContent = data.phase;
  document.getElementById('plan-theme').textContent = data.theme || '—';
  document.getElementById('plan-intent').textContent = data.intent || '';
  document.getElementById('plan-run-target').textContent = data.runTarget || '—';
  document.getElementById('plan-dont-miss').textContent = data.dontMiss || '—';

  // Disable nav buttons at edges
  document.getElementById('plan-prev').disabled = wk <= 0;
  document.getElementById('plan-next').disabled = wk >= 26;
}

async function saveAdd() {
  const date = document.getElementById('add-day').value;
  const checked = Array.from(document.querySelectorAll('#add-required input:checked, #add-mix input:checked'))
    .map(cb => cb.value);
  if (checked.length === 0) {
    closeAddModal();
    return;
  }
  // Auto-status: today/past → Done, future → Planned
  const todayStart = new Date(todayIso() + "T00:00:00");
  const selDate = new Date(date + "T00:00:00");
  const status = selDate > todayStart ? 'Planned' : 'Done';

  for (const session of checked) {
    weekSessions.push({ date, session, tier: modalityTier(session), status });
  }
  markDirty();
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

  // Compute week boundaries (Sunday → Saturday)
  const today = new Date();
  weekStartIso = dateIso(weekSunday(today));
  viewingDateIso = todayIso();

  // Initial render with cached data
  renderHero();
  renderDaily();
  renderWeek();
  computeStreak().then(s => { document.getElementById('streak-num').textContent = s; });

  // Load from server — today's checks + all this week's daily rows + this week's menu
  const weekStart = new Date(weekStartIso + "T00:00:00");
  const dailyLoads = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dailyLoads.push(loadDaily(dateIso(d)));
  }
  await Promise.all([...dailyLoads, loadWeek(weekStartIso)]);
  renderDaily();
  renderWeek();
  const streak = await computeStreak();
  document.getElementById('streak-num').textContent = streak;

  // Load plan + wire up Weekly Focus modal
  await loadPlan();
  document.getElementById('hero-tappable').addEventListener('click', () => openPlanModal());
  document.getElementById('plan-close-btn').addEventListener('click', closePlanModal);
  document.getElementById('plan-modal').addEventListener('click', (e) => {
    if (e.target.id === 'plan-modal') closePlanModal();
  });
  document.getElementById('plan-prev').addEventListener('click', () => {
    if (planViewWeek > 0) { planViewWeek--; renderPlanModal(); }
  });
  document.getElementById('plan-next').addEventListener('click', () => {
    if (planViewWeek < 26) { planViewWeek++; renderPlanModal(); }
  });

  // Wire up buttons (null-safe — a missing element must never break the others)
  document.getElementById('add-session-btn')?.addEventListener('click', () => openAddModal());
  document.getElementById('cancel-add-btn')?.addEventListener('click', closeAddModal);
  document.getElementById('save-add-btn')?.addEventListener('click', saveAdd);
  document.getElementById('sync-week-btn')?.addEventListener('click', syncWeek);
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
