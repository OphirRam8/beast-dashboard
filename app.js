/* ============================================
   Beast Dashboard — Spartan Beast 2026
   Static client-side app · localStorage persistence
   ============================================ */

// ============================================
// Plan data
// ============================================

const BEAST_DATE = new Date("2026-11-21T08:00:00-06:00");

const PHASES = [
  { name: "Reset",       short: "0",  start: "2026-05-17", end: "2026-05-31", color: "#6b6b78" },
  { name: "Foundation",  short: "1",  start: "2026-06-01", end: "2026-07-26", color: "#5a8def" },
  { name: "Build",       short: "2",  start: "2026-07-27", end: "2026-09-20", color: "#f1b542" },
  { name: "Peak",        short: "3",  start: "2026-09-21", end: "2026-11-01", color: "#d4302f" },
  { name: "Taper",       short: "4",  start: "2026-11-02", end: "2026-11-15", color: "#a55ee8" },
  { name: "Race Week",   short: "5",  start: "2026-11-16", end: "2026-11-20", color: "#f1b542" },
  { name: "Beast Day",   short: "6",  start: "2026-11-21", end: "2026-11-21", color: "#d4302f" }
];

const W1_START = new Date("2026-06-01T00:00:00-05:00"); // Monday of W1

const RACES = [
  {
    n: 1,
    name: "Run for Coffee Lovers",
    distance: "10K",
    date: "2026-07-25T07:30:00-05:00",
    location: "Olmos Basin Park, SA",
    url: "https://raceroster.com/events/2026/110988/run-for-coffee-lovers-5k10k131-san-antonio/"
  },
  {
    n: 2,
    name: "National Chocolate Day",
    distance: "10K (2nd)",
    date: "2026-09-12T07:30:00-05:00",
    location: "Olmos Basin Park, SA",
    url: "https://runsignup.com/Race/TX/SanAntonio/NationalChocolateDayRunForChocolatesSANANTONIO"
  },
  {
    n: 3,
    name: "Day of the Dead Half",
    distance: "Half marathon",
    date: "2026-10-04T08:00:00-05:00",
    location: "Live Oak, SA",
    url: "https://runsignup.com/Race/TX/LiveOak/DayoftheDeadHalfMarathonSanAntonio"
  },
  {
    n: "F",
    name: "Spartan Beast",
    distance: "21K + obstacles",
    date: "2026-11-21T08:00:00-06:00",
    location: "San Antonio",
    url: "https://www.spartan.com/",
    isBeast: true
  }
];

const DAILY_NN = [
  {
    id: "hip-cars",
    name: "Hip CARs",
    detail: "60s/side · controlled circles, full active range",
    video: "https://www.youtube.com/watch?v=m_l9DCL2zL0"
  },
  {
    id: "90-90",
    name: "90/90 hip switches",
    detail: "60s/side · internal + external rotation",
    video: "https://www.youtube.com/watch?v=qq_Z7sAmVrA"
  },
  {
    id: "couch",
    name: "Couch stretch + overhead reach",
    detail: "60s/side · quads + hip flexors + spine",
    video: "https://www.youtube.com/watch?v=IioW8A3fgW0"
  },
  {
    id: "squat-reach",
    name: "Bottom squat hold + overhead reach",
    detail: "45s · hip + ankle + back + T-spine",
    video: "https://www.youtube.com/watch?v=lbozu0DPcYI"
  },
  {
    id: "dead-hang",
    name: "Dead hang",
    detail: "45s · grip + shoulder decompression",
    video: "https://www.youtube.com/watch?v=2vspW4N4BMs"
  }
];

const WEEKLY_MENU = {
  floor: [
    { name: "X3 push session", detail: "20–30 min, one-set-to-failure + Nordstick finisher", freq: "1× / wk" },
    { name: "X3 pull session", detail: "20–30 min, one-set-to-failure + Nordstick finisher", freq: "1× / wk" },
    { name: "Long trail run", detail: "60–90 min · Fri AM or night-after-bedtime (finish by 9 PM)", freq: "1× / wk" },
    { name: "Bouldering", detail: "90 min · PROTECTED, never cut for tune-up tapers", freq: "2× / wk" },
    { name: "Daily Non-Negotiables", detail: "5 min · see above", freq: "daily" },
    { name: "Theragun (targeted)", detail: "10–15 min on muscles worked that day", freq: "daily" },
    { name: "Theragun full-body reset", detail: "20–30 min · Sunday evening ritual", freq: "1× / wk" },
    { name: "Sleep 7+ hrs", detail: "non-negotiable", freq: "nightly" },
    { name: "Key Nutrition electrolytes", detail: "1 packet daily, more on training days", freq: "daily" },
    { name: "Magnesium glycinate", detail: "400–500mg nightly", freq: "nightly" }
  ],
  standard: [
    { name: "Cardio + grip ladder", detail: "CrossRope intervals + Eleviia / Switch Grips", freq: "1× / wk" },
    { name: "Posterior chain + farmer's carry", detail: "Nordstick + KB + bucket farmer carry", freq: "1× / wk" },
    { name: "Mixed block + bucket bear-hug", detail: "Wavemaster + Steel Club + bucket bear-hug carry", freq: "1× / wk" }
  ],
  bonus: [
    { name: "Extra grip ladder", detail: "Eleviia or hangs", freq: "if green" },
    { name: "Extra Nordstick rep", detail: "Add to one more session", freq: "if green" },
    { name: "3rd bouldering session", detail: "Only if body says yes", freq: "if green" },
    { name: "Obstacle skill block", detail: "Wall kick-up surrogates, rope pulls", freq: "if green" }
  ]
};

const BODY_MAINTENANCE = [
  {
    weakness: "Hamstrings (cramps + tight)",
    fix: "Nordstick as X3 finisher · Elephant Walks after dog walk · magnesium glycinate · electrolytes",
    freq: "3× Nordstick/wk · daily Elephant Walks"
  },
  {
    weakness: "Tight hips",
    fix: "Hip CARs + 90/90 + couch stretch (all in Daily NN flow)",
    freq: "daily"
  },
  {
    weakness: "Tight lower back",
    fix: "Cat-cow + dead hang decompression + bottom squat reach (fix hips → back loosens)",
    freq: "daily"
  },
  {
    weakness: "Weak-feeling knees",
    fix: "ATG split squat as X3 Push finisher (1 set/side, bodyweight)",
    freq: "2× / wk"
  },
  {
    weakness: "Hyperhidrosis (sweat in heat)",
    fix: "Natural heat acclimation through TX summer trail runs · daily electrolytes · race-day cooling kit",
    freq: "ongoing"
  }
];

// ============================================
// Helpers
// ============================================

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a, b) {
  return Math.ceil((startOfDay(b) - startOfDay(a)) / (1000 * 60 * 60 * 24));
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateShort(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function getPhase(now) {
  for (const p of PHASES) {
    const start = new Date(p.start + "T00:00:00-05:00");
    const end = new Date(p.end + "T23:59:59-05:00");
    if (now >= start && now <= end) return p;
  }
  if (now < new Date(PHASES[0].start + "T00:00:00-05:00")) return { name: "Pre-Reset", short: "—" };
  return { name: "Post-Beast", short: "✓" };
}

function getWeekNumber(now) {
  // W1 starts Mon Jun 1 2026. Before that = W0.
  if (now < W1_START) return 0;
  const days = Math.floor((startOfDay(now) - startOfDay(W1_START)) / (1000 * 60 * 60 * 24));
  return Math.floor(days / 7) + 1;
}

function getWeekWindow(now) {
  const weekNum = getWeekNumber(now);
  if (weekNum === 0) {
    return { start: new Date("2026-05-17"), end: new Date("2026-05-31"), label: "May 17 – May 31 · Reset" };
  }
  const start = new Date(W1_START);
  start.setDate(start.getDate() + (weekNum - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end, label: `${fmtDateShort(start)} – ${fmtDateShort(end)}` };
}

function getNextRace(now) {
  for (const r of RACES) {
    if (new Date(r.date) >= startOfDay(now)) return r;
  }
  return null;
}

// ============================================
// Render: hero
// ============================================

function renderHero() {
  const now = new Date();
  const days = daysBetween(now, BEAST_DATE);
  document.getElementById("days-to-beast").textContent = days >= 0 ? days : "✓";

  const phase = getPhase(now);
  document.getElementById("phase-tag").textContent = `Phase ${phase.short} · ${phase.name}`;
  document.getElementById("phase-label").textContent = `Phase: ${phase.name}`;

  // Progress: percent of the full timeline (May 17 → Nov 21)
  const start = new Date("2026-05-17T00:00:00-05:00");
  const total = BEAST_DATE - start;
  const elapsed = Math.max(0, now - start);
  const pct = Math.min(100, (elapsed / total) * 100);
  document.getElementById("phase-progress").style.width = pct + "%";

  const weekNum = getWeekNumber(now);
  document.getElementById("week-label").textContent = `Week ${weekNum} / 26`;
}

// ============================================
// Render: this week
// ============================================

function renderThisWeek() {
  const now = new Date();
  const phase = getPhase(now);
  const weekNum = getWeekNumber(now);
  const window = getWeekWindow(now);
  const nextRace = getNextRace(now);

  document.getElementById("week-phase").textContent = phase.name;
  document.getElementById("week-num").textContent = `W${weekNum}`;
  document.getElementById("week-window").textContent = window.label;

  if (nextRace) {
    document.getElementById("next-race").textContent = `${nextRace.distance} · ${fmtDateShort(new Date(nextRace.date))}`;
    document.getElementById("next-race-in").textContent = `${daysBetween(now, new Date(nextRace.date))}d`;
  } else {
    document.getElementById("next-race").textContent = "—";
    document.getElementById("next-race-in").textContent = "—";
  }
}

// ============================================
// Render: Daily Non-Negotiables
// ============================================

function getDnnState() {
  try {
    const raw = localStorage.getItem("beast.dnn." + todayKey());
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function setDnnState(state) {
  try {
    localStorage.setItem("beast.dnn." + todayKey(), JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

function pruneOldDnn() {
  try {
    const today = todayKey();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("beast.dnn.") && !key.endsWith(today)) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) { /* ignore */ }
}

function renderDnn() {
  pruneOldDnn();
  const state = getDnnState();
  const list = document.getElementById("dnn-list");
  list.innerHTML = "";

  DAILY_NN.forEach(item => {
    const li = document.createElement("li");
    li.className = "dnn-item" + (state[item.id] ? " done" : "");
    li.innerHTML = `
      <div class="dnn-check"></div>
      <div class="dnn-info">
        <p class="dnn-name">${item.name}</p>
        <p class="dnn-detail">${item.detail}</p>
      </div>
      <a class="dnn-video" href="${item.video}" target="_blank" rel="noopener" title="Watch the form video">▶</a>
    `;
    li.addEventListener("click", (e) => {
      // Don't toggle if user clicked the video link
      if (e.target.closest(".dnn-video")) return;
      const s = getDnnState();
      s[item.id] = !s[item.id];
      setDnnState(s);
      renderDnn();
      updateDnnStreak();
    });
    list.appendChild(li);
  });
}

function updateDnnStreak() {
  const state = getDnnState();
  const done = DAILY_NN.filter(i => state[i.id]).length;
  const total = DAILY_NN.length;
  const el = document.getElementById("dnn-streak");
  if (done === total) {
    el.textContent = `✅ All ${total} done today. Reset at midnight.`;
    el.style.color = "var(--gold)";
  } else {
    el.textContent = `${done} / ${total} done today. Tap each move as you finish.`;
    el.style.color = "var(--text-dim)";
  }
}

// ============================================
// Render: Weekly menu
// ============================================

function renderMenu(tier = "floor") {
  const list = document.getElementById("menu-list");
  list.innerHTML = "";
  WEEKLY_MENU[tier].forEach(item => {
    const li = document.createElement("li");
    li.className = "menu-item";
    li.innerHTML = `
      <div class="menu-info">
        <p class="menu-name">${item.name}</p>
        <p class="menu-detail">${item.detail}</p>
      </div>
      <span class="menu-freq">${item.freq}</span>
    `;
    list.appendChild(li);
  });
}

function bindMenuTabs() {
  document.querySelectorAll(".tier-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tier-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderMenu(btn.dataset.tier);
    });
  });
}

// ============================================
// Render: Race ladder
// ============================================

function renderRaces() {
  const list = document.getElementById("race-list");
  list.innerHTML = "";
  const now = new Date();

  RACES.forEach(r => {
    const raceDate = new Date(r.date);
    const days = daysBetween(now, raceDate);
    const isPast = days < 0;
    const item = document.createElement("a");
    item.className = "race-item" + (r.isBeast ? " beast" : "");
    item.href = r.url;
    item.target = "_blank";
    item.rel = "noopener";
    item.innerHTML = `
      <span class="race-num">${r.n}</span>
      <div class="race-info">
        <p class="race-name">${r.name}</p>
        <p class="race-meta">${r.distance} · ${fmtDateShort(raceDate)} · ${r.location}</p>
      </div>
      <div class="race-countdown">
        ${isPast
          ? `<span class="race-status-done">✓ done</span>`
          : `<span class="race-days">${days}</span><div class="race-days-label">days</div>`}
      </div>
    `;
    list.appendChild(item);
  });
}

// ============================================
// Render: Body maintenance
// ============================================

function renderBody() {
  const list = document.getElementById("body-list");
  list.innerHTML = "";
  BODY_MAINTENANCE.forEach(item => {
    const li = document.createElement("li");
    li.className = "body-item";
    li.innerHTML = `
      <div class="body-weakness">${item.weakness}</div>
      <p class="body-fix">${item.fix}</p>
      <div class="body-freq">${item.freq}</div>
    `;
    list.appendChild(li);
  });
}

// ============================================
// Collapsibles
// ============================================

function bindCollapsibles() {
  document.querySelectorAll(".collapsible .card-head").forEach(head => {
    head.addEventListener("click", () => {
      head.closest(".collapsible").classList.toggle("open");
    });
  });
}

// ============================================
// Footer
// ============================================

function setLastUpdated() {
  document.getElementById("last-updated").textContent = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });
}

// ============================================
// Init
// ============================================

function init() {
  renderHero();
  renderThisWeek();
  renderDnn();
  updateDnnStreak();
  renderMenu("floor");
  bindMenuTabs();
  renderRaces();
  renderBody();
  bindCollapsibles();
  setLastUpdated();

  document.getElementById("dnn-reset").addEventListener("click", () => {
    setDnnState({});
    renderDnn();
    updateDnnStreak();
  });

  // Auto-refresh every minute so countdowns stay live
  setInterval(() => {
    renderHero();
    renderThisWeek();
    renderRaces();
  }, 60 * 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
