import { collection, query, where, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firebase.js";

// State
let allSeats = [];
let activeAttendance = [];
let studentPhotos = {};
let currentFloor = "Ground Floor";
let unsubSeats = null;
let unsubAttendance = null;

// Helpers — IST-aware date (India is UTC+5:30)
const getTodayStr = () => {
  // Add 5h30m to UTC so the date matches IST local date even near midnight
  const now = new Date();
  const istOffset = 5 * 60 + 30; // minutes
  const istMs = now.getTime() + istOffset * 60 * 1000;
  const d = new Date(istMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
};

// NOTE: NO zero-padding — matches Firestore seat numbers exactly ("A1", "A34", not "A01")
const generateRange = (prefix, start, end) => {
  const arr = [];
  if (start <= end) {
    for (let i = start; i <= end; i++) arr.push(`${prefix}${i}`);
  } else {
    for (let i = start; i >= end; i--) arr.push(`${prefix}${i}`);
  }
  return arr;
};

// ── Seat naming helpers ─────────────────────────────────────────────────────
// The hardcoded room layouts below only cover A1..A68 / B1..B40. Imported
// floors may use other names (e.g. "2".."40" or "R1".."R20") — those fall
// back to a generic grid so every real seat still renders.
const AB_SEAT_PATTERN = /^[AB]\d+$/;

// Numeric-aware ordering: 2,3,...,10,...,40 and R1,R2,...,R9,R10,...,R20
// (so "R10" sorts after "R9" instead of lexically before it).
const compareSeatNumbers = (a, b) =>
  String(a == null ? "" : a).localeCompare(String(b == null ? "" : b), undefined, {
    numeric: true,
    sensitivity: "base",
  });

// True when this floor's seats are A/B-named (hardcoded layout applies).
// An empty floor keeps the existing placeholder layout (unchanged behaviour).
const shouldUseABLayout = (seats) => {
  if (!Array.isArray(seats) || seats.length === 0) return true;
  const firstIsAB = AB_SEAT_PATTERN.test(String(seats[0] && seats[0].seatNumber));
  if (!firstIsAB) return false;
  return seats.every(s => AB_SEAT_PATTERN.test(String(s && s.seatNumber)));
};

// Rule 1 — normalize seat names before matching (DB "A01" vs layout "A1")
const normalizeSeatNumber = (value) => {
  const raw = String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, "");
  const m = raw.match(/^([A-Z]+)-?0*(\d+)$/);
  return m ? `${m[1]}${Number(m[2])}` : raw;
};

// Theme-aware status colors — mirrors seatMapUI's palette so the live map
// follows the night/day toggle instead of staying light.
const isLightTheme = () => !!(document.body && document.body.classList.contains("light-mode"));

const liveStatusStyle = (status) => {
  if (isLightTheme()) {
    switch (status) {
      case "Occupied":    return { bg: "#fef2f2", border: "1.5px solid #fecaca", color: "#991b1b" };
      case "Reserved":    return { bg: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" };
      case "Maintenance": return { bg: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af" };
      case "Inactive":    return { bg: "#f8fafc", border: "1px dashed #cbd5e1", color: "#94a3b8" };
      default:            return { bg: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534" };
    }
  }
  switch (status) {
    case "Occupied":    return { bg: "rgba(239,68,68,0.16)", border: "1.5px solid rgba(239,68,68,0.5)", color: "#f87171" };
    case "Reserved":    return { bg: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.45)", color: "#fbbf24" };
    case "Maintenance": return { bg: "rgba(59,130,246,0.16)", border: "1px solid rgba(59,130,246,0.5)", color: "#60a5fa" };
    case "Inactive":    return { bg: "rgba(148,163,184,0.08)", border: "1px dashed rgba(148,163,184,0.4)", color: "#94a3b8" };
    default:            return { bg: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.45)", color: "#4ade80" };
  }
};

// Present-seat card colors, also theme-aware.
const livePresentStyle = () => isLightTheme()
  ? { bg: "#fef2f2", border: "1.5px solid #fecaca", color: "#991b1b", sub: "#dc2626" }
  : { bg: "rgba(239,68,68,0.16)", border: "1.5px solid rgba(239,68,68,0.5)", color: "#f87171", sub: "#fca5a5" };

// Legend pill colors, theme-aware (same values as the seat cards above).
const liveLegendStyle = (kind) => {
  if (isLightTheme()) {
    if (kind === "vacant") return "background:#f0fdf4; color:#166534; border:1px solid #bbf7d0;";
    if (kind === "present") return "background:#fef2f2; color:#991b1b; border:1px solid #fecaca;";
    if (kind === "reserved") return "background:#fffbeb; color:#92400e; border:1px solid #fde68a;";
    return "background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe;";
  }
  if (kind === "vacant") return "background:rgba(34,197,94,0.14); color:#4ade80; border:1px solid rgba(34,197,94,0.45);";
  if (kind === "present") return "background:rgba(239,68,68,0.16); color:#f87171; border:1px solid rgba(239,68,68,0.5);";
  if (kind === "reserved") return "background:rgba(245,158,11,0.16); color:#fbbf24; border:1px solid rgba(245,158,11,0.45);";
  return "background:rgba(59,130,246,0.16); color:#60a5fa; border:1px solid rgba(59,130,246,0.5);";
};

const fetchMissingPhotos = async (records) => {
  for (const rec of records) {
    if (studentPhotos[rec.studentId] === undefined) {
      try {
        // Primary: the single canonical studentDocuments/{id}.photo
        // (legacy profilePhoto / selfie copies still work as fallback),
        // then the denormalised student fields.
        const docsSnap = await getDoc(doc(db, "studentDocuments", rec.studentId));
        const dd = docsSnap.exists() ? docsSnap.data() : null;
        let photoUrl = (dd && (dd.photo || dd.profilePhoto || dd.selfie)) ? (dd.photo || dd.profilePhoto || dd.selfie) : null;

        // Fallback: students/{id} denormalised photo fields
        if (!photoUrl) {
          const stuSnap = await getDoc(doc(db, "students", rec.studentId));
          const sd = stuSnap.exists() ? stuSnap.data() : null;
          photoUrl = (sd && (sd.profilePhotoUrl || sd.photoUrl || sd.photo || sd.selfieUrl)) || null;
        }

        studentPhotos[rec.studentId] = photoUrl; // null means "checked, no photo"
      } catch (e) {
        studentPhotos[rec.studentId] = null;
      }
    }
  }
  // Always re-render after resolving photos — even if all are null
  renderLiveMap();
};

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
export const initLiveSeatMapUI = () => {
  initLiveSeatMapInTab("page-live-seat-map");
};

export const initLiveSeatMapInTab = (containerId) => {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <!-- Header -->
    <div class="page-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h1 data-i18n="liveSeat.title">Live Seat Map</h1>
        <p class="page-subtitle" id="live-subtitle">Real-time occupancy and attendance.</p>
      </div>
      <div style="display:flex; align-items:center; gap:0.75rem;">
        <div style="background:var(--bg-hover); padding:4px 14px; border-radius:999px; display:inline-flex; align-items:center; gap:6px; border:1px solid var(--border);">
          <span style="width:8px; height:8px; background:#ef4444; border-radius:50%; animation:pulse 1.5s infinite;"></span>
          <span style="font-size:13px; font-weight:600; color:var(--text-secondary);" data-i18n="liveSeat.liveActive">Live Updates Active</span>
        </div>
      </div>
    </div>

    <!-- Legend — painted by paintLiveLegend() so it follows night/day theme -->
    <div class="seat-legend" style="display:flex; gap:1rem; margin-bottom:1.5rem; flex-wrap:wrap;">
      <span class="legend-pill" id="live-legend-vacant" style="padding:4px 12px; border-radius:999px; font-size:13px; font-weight:500; display:inline-flex; align-items:center; gap:6px;">
        <span style="width:8px; height:8px; border-radius:50%; background:currentColor;"></span>
        <span data-i18n="liveSeat.vacant">Vacant</span>
      </span>
      <span class="legend-pill" id="live-legend-present" style="padding:4px 12px; border-radius:999px; font-size:13px; font-weight:500; display:inline-flex; align-items:center; gap:6px;">
        <span style="width:8px; height:8px; border-radius:50%; background:currentColor;"></span>
        <span data-i18n="liveSeat.present">Present</span>
      </span>
      <span class="legend-pill" id="live-legend-reserved" style="padding:4px 12px; border-radius:999px; font-size:13px; font-weight:500; display:inline-flex; align-items:center; gap:6px;">
        <span style="width:8px; height:8px; border-radius:50%; background:currentColor;"></span>
        Reserved
      </span>
      <span class="legend-pill" id="live-legend-maint" style="padding:4px 12px; border-radius:999px; font-size:13px; font-weight:500; display:inline-flex; align-items:center; gap:6px;">
        <span style="width:8px; height:8px; border-radius:50%; background:currentColor;"></span>
        Maintenance
      </span>
    </div>

    <!-- Floor Tabs — identical markup to regular Seat Map -->
    <div class="floor-tabs" style="display:inline-flex; gap:0.5rem; background:var(--bg-hover); padding:4px; border-radius:999px; margin-bottom:1.5rem;">
      <button class="live-floor-tab active" data-floor="Ground Floor" data-i18n="floor.ground"
        style="border:none; background:var(--bg-card); color:var(--text-primary); padding:6px 16px; border-radius:999px; font-weight:500; font-size:13px; cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
        Ground Floor
      </button>
      <button class="live-floor-tab" data-floor="First Floor" data-i18n="floor.first"
        style="border:none; background:transparent; color:var(--text-secondary); padding:6px 16px; border-radius:999px; font-weight:500; font-size:13px; cursor:pointer;">
        First Floor
      </button>
    </div>

    <!-- Main Floor Card — identical structure to regular Seat Map -->
    <div class="card" style="background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:1.5rem; margin-bottom:2rem; overflow-x:auto;">
      <h3 style="font-size:15px; font-weight:600; color:var(--text-primary); margin-bottom:4px;" id="live-floor-title" data-i18n="floor.ground">Ground Floor</h3>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:1.5rem;">Section A · Section B · hover a seat to see who is present</p>
      <div id="live-seat-grid">
        <div style="text-align:center; padding:3rem; color:var(--text-muted);">Connecting to live stream...</div>
      </div>
    </div>
  `;

  if (typeof window.translateDOM === 'function') window.translateDOM();

  // Floor tab click listeners
  document.querySelectorAll(".live-floor-tab").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".live-floor-tab").forEach(b => {
        b.style.background = 'transparent';
        b.style.color = "var(--text-secondary)";
        b.style.boxShadow = 'none';
      });
      const target = e.currentTarget;
      target.style.background = "var(--bg-card)";
      target.style.color = "var(--text-primary)";
      target.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
      currentFloor = target.getAttribute("data-floor");

      const titleEl = document.getElementById("live-floor-title");
      if (titleEl) {
        titleEl.setAttribute('data-i18n', currentFloor === 'First Floor' ? 'floor.first' : 'floor.ground');
        if (typeof window.translateDOM === 'function') window.translateDOM();
      }
      renderLiveMap();
    });
  });

  startListeners();
  paintLiveLegend();
};

// Paints the legend pills for the current theme (called on init + toggle).
const paintLiveLegend = () => {
  const pairs = [
    ["live-legend-vacant", "vacant"],
    ["live-legend-present", "present"],
    ["live-legend-reserved", "reserved"],
    ["live-legend-maint", "maint"],
  ];
  pairs.forEach(([id, kind]) => {
    const el = document.getElementById(id);
    if (el) el.style.cssText += liveLegendStyle(kind);
  });
};

// Re-paint seat colors when night/day theme toggles.
if (typeof window !== "undefined" && !window.__liveSeatThemeObserver) {
  window.__liveSeatThemeObserver = new MutationObserver(() => {
    paintLiveLegend();
    renderLiveMap();
  });
  if (document.body) window.__liveSeatThemeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

// ─────────────────────────────────────────────────────────────
// FIRESTORE LISTENERS
// ─────────────────────────────────────────────────────────────
const startListeners = () => {
  // Tear down any existing listeners before re-subscribing (prevents duplicates)
  if (unsubSeats) { unsubSeats(); unsubSeats = null; }
  if (unsubAttendance) { unsubAttendance(); unsubAttendance = null; }

  unsubSeats = onSnapshot(collection(db, "seats"), (snap) => {
    allSeats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLiveMap();
  });

  const today = getTodayStr();

  // Use checkOut==null as the query — this is a single-field filter that
  // catches ALL currently-present students, including records created before
  // the `status` field was added to the attendance schema.
  // Firestore can query null values with a single-field auto-index (no composite index needed).
  // We then filter by today's date client-side to exclude any stale open sessions from previous days.
  const q = query(
    collection(db, "attendance"),
    where("checkOut", "==", null)
  );
  unsubAttendance = onSnapshot(q, (snap) => {
    // Filter to today's date only (handles stale records from days where app crashed before checkout)
    activeAttendance = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.date === today);
    renderLiveMap();
    fetchMissingPhotos(activeAttendance);
  }, (err) => {
    console.error("[LiveSeatMap] Firestore attendance query error:", err);
    const grid = document.getElementById("live-seat-grid");
    if (grid) grid.innerHTML = `<div style="text-align:center;padding:2rem;color:#ef4444;">Error loading attendance data: ${err.message}</div>`;
  });
};

// ─────────────────────────────────────────────────────────────
// RENDER — card style exactly matches regular Seat Map
// ─────────────────────────────────────────────────────────────
const renderLiveMap = () => {
  const grid = document.getElementById("live-seat-grid");
  if (!grid) return;

  const presentCount = activeAttendance.length;
  const subtitle = document.getElementById("live-subtitle");
  if (subtitle) subtitle.innerText = `${presentCount} present · live`;

  // ── Single seat card — attendance wins, else live seat status shows ──
  const renderSeatCard = (seat) => {
    const seatNumStr = seat.seatNumber;
    const att = activeAttendance.find(a =>
      normalizeSeatNumber(a.seatNumber) === normalizeSeatNumber(seatNumStr));

    if (att) {
      // PRESENT — show photo or colored initial avatar
      const name = att.studentName || '?';
      const firstName = name.split(' ')[0];
      const initial = firstName.charAt(0).toUpperCase();

      const colors = [
        '#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f43f5e'
      ];
      const avatarColor = colors[initial.charCodeAt(0) % colors.length];

      // Check-in time badge
      let checkInTime = '';
      if (att.checkIn) {
        const t = new Date(att.checkIn);
        const hh = String(t.getHours()).padStart(2,'0');
        const mm = String(t.getMinutes()).padStart(2,'0');
        checkInTime = `${hh}:${mm}`;
      }

      // Use real photo if available, else initial avatar
      const photoUrl = studentPhotos[att.studentId];
      const avatarHtml = photoUrl
        ? `<img src="${photoUrl}" alt="${name}"
            style="width:28px; height:28px; border-radius:50%; object-fit:cover;
                   border:1.5px solid #fca5a5; flex-shrink:0;"
            onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';" />
           <div style="display:none; width:28px; height:28px; border-radius:50%; background:${avatarColor};
                       color:#fff; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0;">${initial}</div>`
        : `<div style="width:28px; height:28px; border-radius:50%; background:${avatarColor};
                       color:#fff; display:flex; align-items:center; justify-content:center;
                       font-size:12px; font-weight:700; flex-shrink:0;">${initial}</div>`;

      const ps = livePresentStyle();
      return `
        <div style="background:${ps.bg}; border:${ps.border}; color:${ps.color}; border-radius:10px;
                 width:100%; height:70px; box-sizing:border-box;
                 display:flex; flex-direction:column; align-items:center;
                 justify-content:center; gap:2px; cursor:default; overflow:hidden; padding:4px;
                 box-shadow:0 1px 3px rgba(239,68,68,0.12); position:relative;">
          <div style="position:absolute; top:4px; left:4px; font-size:9px; font-weight:700; color:${ps.sub}; line-height:1;">${seatNumStr}</div>
          <div style="display:flex; align-items:center; justify-content:center; position:relative; margin-top:6px;">
            ${avatarHtml}
            <div style="position:absolute; bottom:-1px; right:-2px; width:9px; height:9px;
                        background:#22c55e; border-radius:50%; border:1px solid #fff;"></div>
          </div>
          <div style="font-size:9px; font-weight:600; color:${ps.color}; max-width:100%; white-space:nowrap;
                      overflow:hidden; text-overflow:ellipsis; line-height:1; text-align:center;" title="${firstName}">${firstName}</div>
          ${checkInTime ? `<div style="position:absolute; bottom:4px; right:4px; font-size:8px; color:${ps.sub}; font-weight:500;">${checkInTime}</div>` : ''}
        </div>
      `;
    }

    // NOT PRESENT — paint the seat's live status (Available/Occupied/
    // Reserved/Maintenance/Inactive) so status changes reflect here instantly.
    const st = liveStatusStyle(seat.status);
    const sub = seat.assignedStudentName
      ? `<div style="font-size:9px; font-weight:600; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1; text-align:center;" title="${seat.assignedStudentName}">${String(seat.assignedStudentName).split(' ')[0]}</div>`
      : "";
    const statusTag = (seat.status !== "Available")
      ? `<div style="position:absolute; top:4px; left:4px; font-size:8px; font-weight:700; line-height:1; opacity:0.8;">${seat.status}</div>`
      : "";
    return `
      <div style="background:${st.bg}; border:${st.border}; color:${st.color}; border-radius:10px;
                  width:100%; height:70px; box-sizing:border-box;
                  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
                  cursor:default; padding:4px; position:relative; overflow:hidden;"
           title="${seatNumStr} · ${seat.status}${seat.assignedStudentName ? ' · ' + seat.assignedStudentName : ''}">
        ${statusTag}
        <div style="font-size:15px; font-weight:600; line-height:1; margin-top:${sub ? "6px" : "0"};">${seatNumStr}</div>
        ${sub}
      </div>
    `;
  };

  // ── Data-driven room: seat positions come from backend col/row ───────────
  const floorSeats = allSeats.filter(s => (s.floor || "Ground Floor") === currentFloor);

  // Generic grid for non-A/B floors
  if (!shouldUseABLayout(floorSeats)) {
    const sortedSeats = [...floorSeats].sort((a, b) =>
      compareSeatNumbers(a.seatNumber, b.seatNumber));
    const genericHtml = sortedSeats.map(seat => renderSeatCard(seat)).join("");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(70px,1fr))";
    grid.style.gap = "0.6rem";
    grid.innerHTML = genericHtml;
    return;
  }

  const posMap = new Map();
  const place = (seat) => {
    const c = Number(seat.col), r = Number(seat.row);
    if (Number.isFinite(c) && Number.isFinite(r) && c >= 1 && c <= 4 && r >= 1) {
      const key = `${c}x${r}`;
      if (!posMap.has(key)) { posMap.set(key, seat); return true; }
      return false;
    }
    return false;
  };

  // Inference from the spec layout for docs that predate col/row.
  const groundSpec = [
    [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18],
    [null,34,33,32,31,30,29,28,27,26,25,24,67,23,22,21,20,19],
    [null,35,36,null,37,38,39,40,41,42,null,43,68,44,45,46,47,48],
    [66,65,64,63,62,61,60,59,58,57,56,55,54,53,52,51,50,49],
  ];
  const firstSpec = [
    [1,2,3,4,5,6,7,8,9,10,null],
    [null,20,19,18,17,16,15,14,13,12,11],
    [null,21,22,23,24,25,26,27,28,29,30],
    [40,39,38,37,36,35,34,33,32,31,null],
  ];
  const specCols = currentFloor === "First Floor" ? firstSpec : groundSpec;
  const specName = (n) => (currentFloor === "First Floor" ? "B" : "A") + n;

  floorSeats.forEach(seat => {
    if (place(seat)) return;
    const norm = normalizeSeatNumber(seat.seatNumber);
    specCols.forEach((colArr, ci) => {
      colArr.forEach((n, ri) => {
        if (n != null && normalizeSeatNumber(specName(n)) === norm && !posMap.has(`${ci + 1}x${ri + 1}`)) {
          posMap.set(`${ci + 1}x${ri + 1}`, seat);
        }
      });
    });
  });

  const baseRows = currentFloor === "First Floor" ? 11 : 18;
  let maxRow = baseRows;
  posMap.forEach(seat => { if (Number(seat.row) > maxRow) maxRow = Number(seat.row); });

  const renderCell = (col, row) => {
    const seat = posMap.get(`${col}x${row}`);
    if (seat) return renderSeatCard(seat);
    return `<div style="height:70px; width:100%;"></div>`;
  };
  const renderColByPosition = (colIdx) => {
    let html = `<div style="display:flex; flex-direction:column; gap:0.5rem; flex:1; min-width:0;">`;
    for (let r = 1; r <= maxRow; r++) html += renderCell(colIdx, r);
    html += `</div>`;
    return html;
  };

  const colsHtml = renderColByPosition(1) + renderColByPosition(2) + renderColByPosition(3) + renderColByPosition(4);

  // Clear inline grid styles possibly left behind by a non-A/B (generic) floor
  // so the room layout keeps its original block layout.
  grid.style.display = "";
  grid.style.gridTemplateColumns = "";
  grid.style.gap = "";

  if (currentFloor === 'First Floor') {
    grid.innerHTML = `
      <div style="background:var(--bg-card); padding:2rem 1rem 4rem 1rem; border-radius:12px; position:relative; border:1px solid var(--border); min-width:800px; overflow-x:auto;">
        <div style="position:absolute; top:0; left:50%; transform:translateX(-50%); background:var(--bg-hover); border:1px solid var(--border); border-top:none; padding:0.25rem 1.5rem; border-radius:0 0 8px 8px; font-weight:700; color:var(--text-secondary); letter-spacing:1px; font-size:11px;">DOOR</div>
        <div style="display:flex; gap:1.5rem; justify-content:center; max-width:800px; margin:0 auto; align-items:flex-start;">
          ${colsHtml}
        </div>
        <div style="position:absolute; bottom:0; left:0; right:0; display:flex; justify-content:space-around; pointer-events:none;">
          <div style="background:var(--bg-hover); border:1px solid var(--border); border-bottom:none; padding:0.25rem 1.5rem; border-radius:8px 8px 0 0; font-weight:700; color:var(--text-secondary); letter-spacing:1px; font-size:11px;">TOILET-1</div>
          <div style="background:var(--bg-hover); border:1px solid var(--border); border-bottom:none; padding:0.25rem 1.5rem; border-radius:8px 8px 0 0; font-weight:700; color:var(--text-secondary); letter-spacing:1px; font-size:11px;">TOILET-2</div>
        </div>
      </div>
    `;
  } else {
    grid.innerHTML = `
      <div style="background:var(--bg-card); padding:2rem 1rem 4rem 1rem; border-radius:12px; position:relative; border:1px solid var(--border); min-width:900px; overflow-x:auto;">
        <div style="position:absolute; top:0; left:50%; transform:translateX(-50%); background:var(--bg-hover); border:1px solid var(--border); border-top:none; padding:0.25rem 1.5rem; border-radius:0 0 8px 8px; font-weight:700; color:var(--text-secondary); letter-spacing:1px; font-size:11px;">DOOR</div>
        <div style="display:flex; gap:1.5rem; justify-content:center; max-width:900px; margin:0 auto; align-items:flex-start;">
          ${colsHtml}
        </div>
        <div style="position:absolute; bottom:0; left:0; right:0; display:flex; justify-content:space-around; pointer-events:none;">
          <div style="background:var(--bg-hover); border:1px solid var(--border); border-bottom:none; padding:0.25rem 1.5rem; border-radius:8px 8px 0 0; font-weight:700; color:var(--text-secondary); letter-spacing:1px; font-size:11px;">TOILET-1</div>
          <div style="background:var(--bg-hover); border:1px solid var(--border); border-bottom:none; padding:0.25rem 1.5rem; border-radius:8px 8px 0 0; font-weight:700; color:var(--text-secondary); letter-spacing:1px; font-size:11px;">TOILET-2</div>
        </div>
      </div>
    `;
  }
};
