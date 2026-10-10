import { db } from "../firebase/firebase.js";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc
} from "firebase/firestore";

// Escape user content for safe insertion into HTML attributes / text.
// Prevents broken markup (e.g. a " or ' inside a benefit tag) from
// breaking the input value or the onclick="..." handlers, which made
// benefit tags and plans impossible to discard.
const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const escapeAttr = escapeHtml;

/**
 * One-time compaction for already-stored website images: any data-URL image
 * bigger than ~200KB gets re-encoded web-light. Shrinks the website_content
 * doc permanently so every future open is fast. File paths untouched.
 */
const compactStoredImage = (src) => {
  return new Promise((resolve) => {
    if (!src || !String(src).startsWith("data:image") || String(src).length <= 200000) {
      resolve(src);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 640;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round((height / width) * MAX); width = MAX; }
          else { width = Math.round((width / height) * MAX); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch (_) {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
};

/**
 * Client-side Canvas Image Compression (upload path).
 * Web-light output (640px, q0.72) keeps the website_content doc small.
 */
const compressImage = (file, maxWidth = 640, quality = 0.72) => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Selected file is not an image."));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth || height > maxWidth) {
        if (width > height) {
          height = Math.round((height / width) * maxWidth);
          width = maxWidth;
        } else {
          width = Math.round((width / height) * maxWidth);
          height = maxWidth;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
};

const AUTHENTIC_17_FEATURES = [
  {
    id: "f1",
    title: "Fully Air Conditioned",
    titleGu: "સંપૂર્ણ એર કંડિશન્ડ",
    icon: "Snowflake",
    image: "/WhatsApp Image 2026-08-16 at 12.58.47 PM.jpeg",
    desc: "Mitsubishi Heavy Duty Jetflow AC maintains a constant 24°C temperature with zero humidity.",
    descGu: "મિત્સુબિશી હેવી ડ્યુટી જેટફ્લો AC ૨૪°C તાપમાન સાથે ભેજરહિત અને અવાજરહિત ઠંડક આપે છે."
  },
  {
    id: "f2",
    title: "Ergonomic Chairs",
    titleGu: "આરામદાયક અર્ગોનોમિક ખુરશી",
    icon: "Armchair",
    image: "/WhatsApp Image 2026-08-16 at 12.58.49 PM.jpeg",
    desc: "Adjustable high-density lumbar support chairs engineered for 10–14 hours of continuous study.",
    descGu: "કમરના ટેકા સાથે ૧૦ થી ૧૪ કલાક સળંગ આરામથી બેસી શકાય તેવી અર્ગોનોમિક ઓફિસ ચેર."
  },
  {
    id: "f3",
    title: "Spacious Study Tables",
    titleGu: "વિશાળ સ્ટડી ડેસ્ક",
    icon: "Grid",
    image: "/WhatsApp Image 2026-08-16 at 12.58.48 PM (2).jpeg",
    desc: "Partitioned wooden study desks with dedicated book racks, top shelves and study maps.",
    descGu: "પુસ્તકો, નોટ્સ અને નકશા રાખવા માટે ઉપરના શેલ્ફ સાથેનું મોટું લાકડાનું ક્યુબિકલ ટેબલ."
  },
  {
    id: "f4",
    title: "High-Speed Wi-Fi",
    titleGu: "હાઇ-સ્પીડ ફાઇબર વાઇ-ફાઇ",
    icon: "Wifi",
    image: "/WhatsApp Image 2026-08-16 at 12.58.50 PM.jpeg",
    desc: "Dual high-speed optical fiber network across all desks for video lectures and test series.",
    descGu: "ઓનલાઇન વિડીયો લેક્ચર્સ અને મોક ટેસ્ટ માટે અવિરત સુપરફાસ્ટ ઓપ્ટિકલ ફાઇબર વાઇ-ફાઇ."
  },
  {
    id: "f5",
    title: "Individual Charging Points",
    titleGu: "સ્વતંત્ર ચાર્જિંગ પોઇન્ટ્સ",
    icon: "Plug",
    image: "/WhatsApp Image 2026-08-16 at 12.58.50 PM.jpeg",
    desc: "Dedicated 230V socket & switchboard at every single study desk for laptop and tablet charging.",
    descGu: "લેપટોપ, ટેબ્લેટ અને મોબાઇલ ચાર્જિંગ માટે દરેક ડેસ્ક પર સ્વતંત્ર 230V પાવર સ્વિચબોર્ડ."
  },
  {
    id: "f6",
    title: "Silent Study Environment",
    titleGu: "સંપૂર્ણ સાયલન્ટ વાતાવરણ",
    icon: "VolumeX",
    image: "/hero-study-hall.jpg",
    desc: "Strict pin-drop silence policy inside the central reading hall with zero interruptions.",
    descGu: "અભ્યાસના તમામ કલાકો દરમિયાન સંપૂર્ણ પિન-ડ્રોપ શાંતિના નિયમનું ચુસ્ત પાલન."
  },
  {
    id: "f7",
    title: "24×7 CCTV Security",
    titleGu: "૨૪×૭ CCTV કેમેરા સુરક્ષા",
    icon: "ShieldCheck",
    image: "/WhatsApp Image 2026-08-16 at 12.58.51 PM (1).jpeg",
    desc: "Comprehensive 24x7 HD camera surveillance ensuring the safety of your laptop, books, and bags.",
    descGu: "તમારા પુસ્તકો, લેપટોપ અને સામાનની સલામતી માટે ૨૪ કલાક હાઇ-ડેફિનેશન CCTV કેમેરા સર્વેલન્સ."
  },
  {
    id: "f8",
    title: "Purified Drinking Water",
    titleGu: "શુદ્ધ ઠંડુ RO પીવાનું પાણી",
    icon: "Droplets",
    image: "/WhatsApp Image 2026-08-16 at 12.58.50 PM (2).jpeg",
    desc: "Filtered chilled and room-temperature RO drinking water available 24/7 with open tea break lounge.",
    descGu: "ચોવીસેય કલાક શુદ્ધ, ફિલ્ટર કરેલ ઠંડુ અને નોર્મલ RO પીવાનું પાણી ઉપલબ્ધ."
  },
  {
    id: "f9",
    title: "Clean Washrooms",
    titleGu: "સ્વચ્છ અને હાઇજેનિક વૉશરૂમ",
    icon: "Sparkles",
    image: "/WhatsApp Image 2026-08-16 at 12.58.50 PM (2).jpeg",
    desc: "Spotless, regularly sanitized and well-ventilated washrooms maintained daily.",
    descGu: "નિયમિતપણે સેનિટાઇઝ થતા અને એકદમ સ્વચ્છ હાઇજેનિક વૉશરૂમ્સ."
  },
  {
    id: "f10",
    title: "Daily Cleaning",
    titleGu: "રોજિંદી સાફ-સફાઈ",
    icon: "RefreshCw",
    image: "/WhatsApp Image 2026-08-16 at 12.58.49 PM (1).jpeg",
    desc: "Dedicated housekeeping staff ensuring dust-free desks, clean floors, and fresh atmosphere.",
    descGu: "ડેસ્ક અને ફ્લોરિંગની રોજેરોજ સઘન સાફ-સફાઈ જેથી વાતાવરણ હંમેશા તાજગીસભર રહે."
  },
  {
    id: "f11",
    title: "Power Backup",
    titleGu: "૧૦૦% પાવર બેકઅપ",
    icon: "Zap",
    image: "/WhatsApp Image 2026-08-16 at 12.58.47 PM.jpeg",
    desc: "Instant generator and inverter backup so your study flow and AC cooling never get interrupted.",
    descGu: "વીજળી જાય ત્યારે તાત્કાલિક જનરેટર અને ઇન્વર્ટર બેકઅપથી અભ્યાસ અટકતો નથી."
  },
  {
    id: "f12",
    title: "Natural Lighting",
    titleGu: "કુદરતી રોશની અને વેન્ટિલેશન",
    icon: "Sun",
    image: "/WhatsApp Image 2026-08-16 at 12.58.50 PM (2).jpeg",
    desc: "Spacious open terrace providing natural sunlight and fresh air for relaxing study breaks.",
    descGu: "અભ્યાસના વિરામ દરમિયાન તાજી હવા અને કુદરતી રોશની માટે સુંદર ઓપન ટેરેસ."
  },
  {
    id: "f13",
    title: "Flexible Timings",
    titleGu: "અનુકૂળ સમયપત્રક",
    icon: "Clock",
    image: "/hero-study-hall.jpg",
    desc: "Open 17 hours daily (06:00 AM – 11:00 PM), 365 days a year including Sundays & holidays.",
    descGu: "રવિવાર અને જાહેર રજાઓ સહિત દરરોજ સવારે ૦૬:૦૦ થી રાત્રે ૧૧:૦૦ સુધી ખુલ્લી રહે છે."
  },
  {
    id: "f14",
    title: "Affordable Membership",
    titleGu: "કિફાયતી માસિક ફી",
    icon: "Wallet",
    image: "/WhatsApp Image 2026-08-16 at 12.58.48 PM (2).jpeg",
    desc: "Simple, transparent monthly pricing starting from ₹700 with zero hidden charges.",
    descGu: "કોઈપણ છુપા એડમિશન ચાર્જ વગર માત્ર ₹૭૦૦ થી શરૂ થતી કિફાયતી માસિક ફી."
  },
  {
    id: "f15",
    title: "Friendly Management",
    titleGu: "વિદ્યાર્થી-મૈત્રીપૂર્ણ સંચાલન",
    icon: "Heart",
    image: "/WhatsApp Image 2026-08-16 at 12.58.51 PM (2).jpeg",
    desc: "Helpful and supportive library coordinators always available to assist students.",
    descGu: "વિદ્યાર્થીઓની કોઈપણ મુશ્કેલી કે પ્રશ્નમાં તુરંત મદદરૂપ થતું સહાયક સંચાલન."
  },
  {
    id: "f16",
    title: "Personal Secure Lockers",
    titleGu: "સુરક્ષિત લોકર સુવિધા",
    icon: "Lock",
    image: "/WhatsApp Image 2026-08-16 at 12.58.49 PM (2).jpeg",
    desc: "Personal lockers and top shelves to securely keep your heavy books and notes overnight.",
    descGu: "તમારા સંદર્ભ પુસ્તકો અને સાહિત્ય રાત્રે સુરક્ષિત રાખવા માટે વ્યક્તિગત લોકર્સ."
  },
  {
    id: "f17",
    title: "Parking Facility",
    titleGu: "ટૂ-વ્હીલર પાર્કિંગ સુવિધા",
    icon: "Car",
    image: "/WhatsApp Image 2026-08-16 at 12.58.51 PM (1).jpeg",
    desc: "Dedicated, secure two-wheeler parking space directly outside the library building.",
    descGu: "લાઇબ્રેરી બિલ્ડિંગના ગ્રાઉન્ડ ફ્લોર પર વાહનો માટે સુરક્ષિત પાર્કિંગ વ્યવસ્થા."
  }
];

const AUTHENTIC_SERVICES = [
  {
    id: "s1",
    title: "Silent Study Hall",
    badge: "THE SILENT HALL",
    desc: "Acoustically treated, pin-drop silent environment engineered specifically for deep focus and competitive exam preparation.",
    image: "/WhatsApp Image 2026-08-16 at 12.58.49 PM (3).jpeg",
    points: ["Mitsubishi AC Cooling", "Ergonomic Lumbar Chairs", "100% Power Backup", "Unlimited Wi-Fi"]
  },
  {
    id: "s2",
    title: "Terrace & Refreshment Lounge",
    badge: "TERRACE & RO WATER",
    desc: "Dedicated terrace breakout space to stretch, relax, drink tea, and recharge between intense study marathons.",
    image: "/WhatsApp Image 2026-08-16 at 12.58.48 PM (2).jpeg",
    points: ["Open Air Break Lounge", "Purified Chilled Water", "Tea & Snack Pantry", "Hygienic Washrooms"]
  }
];

export const websiteAdminUI = {
  data: {
    services: JSON.parse(JSON.stringify(AUTHENTIC_SERVICES)),
    features: JSON.parse(JSON.stringify(AUTHENTIC_17_FEATURES))
  },

  plans: [],
  activeTab: "services", // Strictly 3 tabs: "services", "features", "plans"

  async init() {
    window.websiteAdminUI = this;
    // Paint instantly from local defaults — never stare at "Loading..."
    // waiting on the network. Firestore refresh lands right after.
    try { this.render(); } catch (_) {}
    this.listenToPlans();
    try { await this.loadData(); } catch (_) {}
    try { this.render(); } catch (_) {}
  },

  async loadData() {
    try {
      const docRef = doc(db, "settings", "website_content");
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const remoteData = docSnap.data();

        // Check if remote features are valid (at least 3 features). If corrupted or single test item (e.g. "okay"), heal with all 17 authentic features.
        const hasValidFeatures = Array.isArray(remoteData.features) && remoteData.features.length >= 3;
        const finalFeatures = hasValidFeatures ? remoteData.features : JSON.parse(JSON.stringify(AUTHENTIC_17_FEATURES));

        // Check if remote services are valid
        const hasValidServices = Array.isArray(remoteData.services) && remoteData.services.length > 0;
        const finalServices = hasValidServices ? remoteData.services : JSON.parse(JSON.stringify(AUTHENTIC_SERVICES));

        this.data = {
          services: finalServices,
          features: finalFeatures
        };

        // Compact oversized stored images once (web-light), so the doc
        // stays small and the page opens instantly from now on.
        try {
          let changed = false;
          for (const item of [...this.data.services, ...this.data.features]) {
            if (item && typeof item.image === "string" && item.image.length > 200000) {
              const small = await compactStoredImage(item.image);
              if (small !== item.image) { item.image = small; changed = true; }
            }
          }
          if (changed) {
            await setDoc(docRef, {
              services: this.data.services,
              features: this.data.features,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
        } catch (_) { /* compaction is best-effort */ }

        // If remote features were corrupted (e.g. <= 2 items), immediately heal Firestore doc
        if (!hasValidFeatures || !hasValidServices) {
          await setDoc(docRef, {
            services: this.data.services,
            features: this.data.features,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      } else {
        // Doc doesn't exist, create clean initial state
        await setDoc(docRef, {
          services: this.data.services,
          features: this.data.features,
          updatedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Error loading website data:", error);
    }
  },

  listenToPlans() {
    try {
      const plansRef = collection(db, "membershipPlans");
      onSnapshot(plansRef, (snapshot) => {
        if (snapshot.empty) {
          // If we previously had plans, the user deleted them all — respect
          // the empty state so deleted plans/tags stay discarded.
          // Only auto-seed on the very first load (no plans ever loaded).
          if (this.plans && this.plans.length > 0) {
            this.plans = [];
            this.renderPlans();
            return;
          }
          // Guard: one seed attempt per page-load + no concurrent double-fire
          // (two tabs seeing empty at once would otherwise write 2x sets).
          if (this._seedAttempted || this._seedInFlight) return;
          this.seedInitialPlans();
          return;
        }
        const loaded = [];
        snapshot.forEach((d) => {
          const data = d.data() || {};
          // Normalize benefits / benefitsEn to a single in-memory list.
          // Older plans may only have `benefitsEn`; newer ones have both.
          // Without normalization, remove/update only touched `benefits`,
          // so tags backed by `benefitsEn` could never be discarded.
          const normalized = Array.isArray(data.benefits)
            ? [...data.benefits]
            : (Array.isArray(data.benefitsEn) ? [...data.benefitsEn] : []);
          loaded.push({ id: d.id, ...data, benefits: normalized, benefitsEn: [...normalized] });
        });
        this.plans = loaded;
        this.renderPlans();
      }, (err) => {
        console.error("Error listening to plans in Website module:", err?.code || "", err?.message || err);
      });
    } catch (err) {
      console.error("Failed to setup plans listener:", err);
    }
  },

  async seedInitialPlans() {
    // One attempt per page-load; concurrent callers wait on the same flag.
    if (this._seedAttempted || this._seedInFlight) return;
    this._seedAttempted = true;
    this._seedInFlight = true;
    try {
      // Re-check via a direct read: the empty snapshot may have raced a
      // parallel seeder (memberships page / second tab). Never write blind.
      try {
        const recheck = await getDocs(collection(db, "membershipPlans"));
        if (!recheck.empty) return;
      } catch (_) { /* fall through and try the seed anyway */ }
      const defaultPlans = [
        {
          planName: "Half Day Plan",
          nameGu: "હાફ ડે પ્લાન",
          price: 700,
          duration: "6–8 hours daily",
          taglineGu: "રોજના ૬-૮ કલાક",
          seatType: "Fixed",
          featured: false,
          seatPreference: false,
          badge: "",
          badgeGu: "",
          status: "Active",
          benefits: [
            "Choice of morning / evening shift",
            "Personal desk allocation",
            "AC + High-Speed Wi-Fi + charging",
            "Personal locker access",
            "Purified RO drinking water",
            "Weekend access included"
          ],
          createdAt: new Date().toISOString()
        },
        {
          planName: "Full Day Plan",
          nameGu: "ફુલ ડે પ્લાન",
          price: 1000,
          duration: "17 hours daily (6 AM – 11 PM)",
          taglineGu: "રોજના ૧૭ કલાક (સવારે ૬ થી રાત્રે ૧૧)",
          seatType: "Fixed",
          featured: true,
          seatPreference: true,
          badge: "Recommended",
          badgeGu: "સૌથી વધુ પસંદગી",
          status: "Active",
          benefits: [
            "Full 17-hour access: 6:00 AM – 11:00 PM",
            "100% Guaranteed fixed reserved seat",
            "Personal dedicated locker facility",
            "AC + High-Speed Wi-Fi + switchboard",
            "Open terrace refreshment lounge access",
            "Purified chilled RO drinking water",
            "Open all 7 days including public holidays"
          ],
          createdAt: new Date().toISOString()
        }
      ];

      const plansRef = collection(db, "membershipPlans");
      for (const p of defaultPlans) {
        await addDoc(plansRef, { ...p, benefitsEn: [...p.benefits], createdAt: new Date().toISOString() });
      }
      console.info("[websiteAdminUI] Seeded 2 canonical membership plans.");
    } catch (e) {
      console.error("Error seeding initial plans:", e?.code || "", e?.message || e);
    } finally {
      this._seedInFlight = false;
    }
  },

  switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll(".website-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
    });
    document.querySelectorAll(".website-tab-panel").forEach((panel) => {
      panel.style.display = panel.id === `website-panel-${tabName}` ? "block" : "none";
    });
  },

  render() {
    this.renderServices();
    this.renderFeatures();
    this.renderPlans();
  },

  // ==================== TAB 1: SERVICES (FACILITIES) ====================
  renderServices() {
    const list = document.getElementById("website-services-list");
    if (!list) return;

    if (!this.data.services || this.data.services.length === 0) {
      list.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted); background:var(--bg-card); border-radius:12px; border:1px dashed var(--border);">No services added yet. Click "+ Add New Service" to create one.</div>`;
      return;
    }

    list.innerHTML = "";
    this.data.services.forEach((s, idx) => {
      const card = document.createElement("div");
      card.className = "facility-card-item";

      const pointsHtml = (s.points || []).map((pt, pIdx) => `
        <span class="website-pill-tag">
          <span style="color:var(--accent-emerald, #10b981); font-weight:700;">✓</span> ${pt}
          <button type="button" onclick="websiteAdminUI.removeServicePoint(${idx}, ${pIdx})" style="border:none; background:none; cursor:pointer; color:var(--text-muted); font-size:14px; line-height:1; padding:0 3px;" title="Remove">&times;</button>
        </span>
      `).join("");

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem; border-bottom:1px solid var(--border); padding-bottom:1rem; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
            <span class="badge badge-info" style="font-size:11px; font-weight:700; padding:4px 10px; border-radius:8px; flex-shrink:0;">FACILITY #${idx + 1}</span>
            <h3 style="margin:0; font-size:1.15rem; font-weight:700; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.title || "Untitled Facility"}</h3>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="websiteAdminUI.removeService(${idx})" style="color:var(--accent-red, #f43f5e); display:inline-flex; align-items:center; gap:6px; font-size:0.82rem; padding:6px 12px; border-radius:8px; border:1px solid rgba(244,63,94,0.2); flex-shrink:0;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Remove
          </button>
        </div>

        <div class="facility-form-grid">
          <div>
            <label class="facility-label">Facility Title</label>
            <input type="text" class="form-control" value="${s.title || ""}" placeholder="e.g. Silent Study Hall" onchange="websiteAdminUI.updateService(${idx}, 'title', this.value)" />
          </div>
          <div>
            <label class="facility-label">Badge / Subtitle</label>
            <input type="text" class="form-control" value="${s.badge || ""}" placeholder="e.g. THE SILENT HALL" onchange="websiteAdminUI.updateService(${idx}, 'badge', this.value)" />
          </div>
          <div style="grid-column: 1 / -1;">
            <label class="facility-label">Description (Shown on Website)</label>
            <textarea class="form-control" rows="3" placeholder="Describe the facility or reading hall..." onchange="websiteAdminUI.updateService(${idx}, 'desc', this.value)">${s.desc || ""}</textarea>
          </div>

          <!-- Professional Photo Edit Widget (Real preview & clean upload, no raw URL text boxes) -->
          <div style="grid-column: 1 / -1;">
            <label class="facility-label">Facility Photo</label>
            <div class="photo-preview-box">
              <div style="width:160px; height:105px; border-radius:10px; overflow:hidden; border:1px solid var(--border-bright); background:#000; flex-shrink:0; position:relative; box-shadow:0 4px 10px rgba(0,0,0,0.15);">
                <img id="service-img-preview-${idx}" src="${s.image || AUTHENTIC_SERVICES[idx]?.image || AUTHENTIC_SERVICES[0].image}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='/WhatsApp Image 2026-08-16 at 12.58.49 PM (3).jpeg'" />
              </div>
              <div style="display:flex; flex-direction:column; gap:8px; flex:1; min-width:0;">
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                  <label class="btn btn-secondary btn-sm" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-weight:600; font-size:12px; padding:7px 16px; border-radius:8px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Upload New Photo
                    <input type="file" accept="image/*" style="display:none;" onchange="websiteAdminUI.handleServiceImageUpload(${idx}, event)" />
                  </label>
                  <button type="button" class="btn btn-ghost btn-sm" onclick="websiteAdminUI.resetServiceImage(${idx})" style="color:var(--text-muted); font-size:12px; padding:6px 12px; border-radius:8px; border:1px solid var(--border);" title="Reset to authentic library photo">
                    Reset Original
                  </button>
                </div>
                <span style="font-size:12px; color:var(--text-muted); line-height:1.4;">Select any photo from your device. Live thumbnail updates immediately.</span>
              </div>
            </div>
          </div>

          <div style="grid-column: 1 / -1;">
            <label class="facility-label">Highlights / Bullet Points</label>
            <div style="margin-bottom:0.75rem; display:flex; flex-wrap:wrap; gap:6px;">
              ${pointsHtml || `<span style="font-size:0.8rem; color:var(--text-muted);">No bullet points yet. Add points below.</span>`}
            </div>
            <div style="display:flex; gap:0.6rem; max-width:600px; flex-wrap:wrap;">
              <input type="text" id="service-pt-input-${idx}" class="form-control form-control-sm" style="flex:1; min-width:180px;" placeholder="Add a feature point (e.g. 100% Power Backup)" onkeydown="if(event.key==='Enter'){event.preventDefault(); websiteAdminUI.addServicePointFromInput(${idx});}" />
              <button class="btn btn-secondary btn-sm" onclick="websiteAdminUI.addServicePointFromInput(${idx})" style="white-space:nowrap; padding:0 16px; font-weight:600; flex-shrink:0;">+ Add Point</button>
            </div>
          </div>
        </div>
      `;
      list.appendChild(card);
    });
  },

  addService() {
    this.data.services.push({
      id: "s" + Date.now(),
      title: "New Facility",
      badge: "FACILITY HIGHLIGHT",
      desc: "Comprehensive library feature for members.",
      image: "/WhatsApp Image 2026-08-16 at 12.58.49 PM (3).jpeg",
      points: ["High Quality", "Available Daily"]
    });
    this.renderServices();
  },

  updateService(index, field, value) {
    if (this.data.services[index]) {
      this.data.services[index][field] = value;
    }
  },

  removeService(index) {
    if (confirm("Are you sure you want to remove this service?")) {
      this.data.services.splice(index, 1);
      this.renderServices();
    }
  },

  addServicePointFromInput(idx) {
    const input = document.getElementById(`service-pt-input-${idx}`);
    if (!input || !input.value.trim()) return;
    if (!this.data.services[idx].points) this.data.services[idx].points = [];
    this.data.services[idx].points.push(input.value.trim());
    input.value = "";
    this.renderServices();
  },

  removeServicePoint(serviceIndex, pointIndex) {
    if (this.data.services[serviceIndex]?.points) {
      this.data.services[serviceIndex].points.splice(pointIndex, 1);
      this.renderServices();
    }
  },

  async handleServiceImageUpload(index, event) {
    const file = event.target.files[0];
    if (file) {
      try {
        // Web-light: 640px / q0.72 keeps the single website_content doc
        // safely under Firestore's 1MB limit. The old 1200px/q0.82 output
        // bloated the doc past the limit, and every save then failed with
        // INVALID_ARGUMENT, surfaced in the console as Write/channel 400.
        const compressedBase64 = await compressImage(file, 640, 0.72);
        this.updateService(index, "image", compressedBase64);

        // Instant visual thumbnail update
        const previewEl = document.getElementById(`service-img-preview-${index}`);
        if (previewEl) {
          previewEl.src = compressedBase64;
        }
        if (typeof window.showToast === "function") {
          window.showToast("Photo loaded! Click 'Save All Changes' to publish.", "info");
        }
      } catch (err) {
        console.error("Service image compression error:", err);
        alert("Failed to process image: " + err.message);
      }
    }
  },

  resetServiceImage(index) {
    const defaultImg = AUTHENTIC_SERVICES[index]?.image || AUTHENTIC_SERVICES[0].image;
    this.updateService(index, "image", defaultImg);
    const previewEl = document.getElementById(`service-img-preview-${index}`);
    if (previewEl) {
      previewEl.src = defaultImg;
    }
    if (typeof window.showToast === "function") {
      window.showToast("Photo reset to authentic library default.", "info");
    }
  },

  // ==================== TAB 2: FEATURES & AMENITIES ====================
  renderFeatures() {
    const list = document.getElementById("website-features-list");
    if (!list) return;

    if (!this.data.features || this.data.features.length === 0) {
      list.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted); grid-column: 1 / -1; background:var(--bg-card); border-radius:12px; border:1px dashed var(--border);">No features added. Click "+ Add Feature" to restore.</div>`;
      return;
    }

    const availableIcons = [
      // Current Library Amenities
      "Snowflake", "Armchair", "Grid", "Wifi", "Plug",
      "VolumeX", "ShieldCheck", "Droplets", "Sparkles", "RefreshCw",
      "Zap", "Sun", "Clock", "Wallet", "Heart", "Lock", "Car",
      // Popular Library, Study & Facility Icons
      "BookOpen", "Coffee", "Monitor", "Users", "CheckCircle",
      "Award", "Compass", "MapPin", "BatteryCharging", "Bell",
      "Shield", "Flame", "Target", "Star", "Smile",
      "Headphones", "Printer", "Briefcase", "Layers", "Tv",
      "PhoneCall", "Calendar", "Bookmark", "Search", "FileText"
    ];

    list.innerHTML = "";
    this.data.features.forEach((feature, index) => {
      const card = document.createElement("div");
      card.className = "amenity-card-item";
      const isCustomIcon = feature.icon && !availableIcons.includes(feature.icon);

      card.innerHTML = `
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; border-bottom:1px solid var(--border); padding-bottom:0.65rem; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
              <span class="badge badge-active" style="font-size:11px; font-weight:700; padding:3px 8px; border-radius:6px; flex-shrink:0;">#${index + 1}</span>
              <strong style="font-size:0.95rem; font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${feature.title || "Untitled Feature"}</strong>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="websiteAdminUI.removeFeature(${index})" style="color:var(--accent-red, #f43f5e); padding:4px 8px; border-radius:6px;" title="Remove feature">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>

          <div class="amenity-inputs-row">
            <div>
              <label class="facility-label">Title</label>
              <input type="text" class="form-control form-control-sm" value="${feature.title || ""}" placeholder="Feature Title" onchange="websiteAdminUI.updateFeature(${index}, 'title', this.value)" />
            </div>
            <div>
              <label class="facility-label">Icon</label>
              <select class="form-control form-control-sm" onchange="websiteAdminUI.handleIconSelect(${index}, this.value)">
                ${isCustomIcon ? `<option value="${feature.icon}" selected>${feature.icon} (Custom)</option>` : ""}
                ${availableIcons.map((ic) =>
        `<option value="${ic}" ${feature.icon === ic ? "selected" : ""}>${ic}</option>`
      ).join("")}
                <option value="__custom_new__">+ Add Custom Icon Name...</option>
              </select>
            </div>
          </div>

          <div style="margin-bottom:0.75rem;">
            <label class="facility-label">Description</label>
            <input type="text" class="form-control form-control-sm" value="${feature.desc || ""}" placeholder="Short detail for card" onchange="websiteAdminUI.updateFeature(${index}, 'desc', this.value)" />
          </div>

          <!-- Professional Amenity Photo Preview & Upload (No raw URLs) -->
          <div style="margin-top:0.75rem; border-top:1px solid var(--border); padding-top:0.75rem;">
            <label class="facility-label">Amenity Photo Preview</label>
            <div class="amenity-photo-box" style="display:flex; gap:12px; align-items:center; background:var(--bg-hover); padding:10px 12px; border-radius:10px; border:1px solid var(--border);">
              <div style="width:84px; height:58px; border-radius:8px; overflow:hidden; border:1px solid var(--border-bright); background:#000; flex-shrink:0; box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                <img id="feature-img-preview-${index}" src="${feature.image || AUTHENTIC_17_FEATURES[index]?.image || AUTHENTIC_17_FEATURES[0].image}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='/WhatsApp Image 2026-08-16 at 12.58.47 PM.jpeg'" />
              </div>
              <div style="display:flex; flex-direction:column; gap:5px; flex:1; min-width:0;">
                <label class="btn btn-secondary btn-sm" style="cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:5px; font-size:11px; padding:5px 10px; font-weight:600; width:fit-content; border-radius:6px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Change Photo
                  <input type="file" accept="image/*" style="display:none;" onchange="websiteAdminUI.handleFeatureImageUpload(${index}, event)" />
                </label>
                <button type="button" class="btn btn-ghost btn-sm" onclick="websiteAdminUI.resetFeatureImage(${index})" style="color:var(--text-muted); font-size:11px; padding:2px 0; width:fit-content; height:auto; text-decoration:underline;">
                  Reset Default
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
      list.appendChild(card);
    });
  },

  handleIconSelect(index, val) {
    if (val === "__custom_new__") {
      const customName = prompt("Enter any Lucide icon name (e.g. Laptop, HelpCircle, Key, Award, Flame):");
      if (customName && customName.trim()) {
        const cleanName = customName.trim().replace(/[^a-zA-Z0-9]/g, "");
        if (cleanName) {
          this.updateFeature(index, 'icon', cleanName);
          this.renderFeatures();
          return;
        }
      }
      this.renderFeatures();
      return;
    }
    this.updateFeature(index, 'icon', val);
  },

  addFeature() {
    this.data.features.push({
      id: "f" + Date.now(),
      title: "New Amenity",
      desc: "Premium library study amenity.",
      icon: "Sparkles",
      image: "/WhatsApp Image 2026-08-16 at 12.58.47 PM.jpeg"
    });
    this.renderFeatures();
  },

  updateFeature(index, field, value) {
    if (this.data.features[index]) {
      this.data.features[index][field] = value;
    }
  },

  removeFeature(index) {
    this.data.features.splice(index, 1);
    this.renderFeatures();
  },

  async handleFeatureImageUpload(index, event) {
    const file = event.target.files[0];
    if (file) {
      try {
        const compressedBase64 = await compressImage(file, 900, 0.8);
        this.updateFeature(index, "image", compressedBase64);

        // Instant visual thumbnail update
        const previewEl = document.getElementById(`feature-img-preview-${index}`);
        if (previewEl) {
          previewEl.src = compressedBase64;
        }
        if (typeof window.showToast === "function") {
          window.showToast("Photo loaded! Click 'Save All Changes' to publish.", "info");
        }
      } catch (err) {
        console.error("Feature image compression error:", err);
        alert("Failed to process image: " + err.message);
      }
    }
  },

  resetFeatureImage(index) {
    const defaultImg = AUTHENTIC_17_FEATURES[index]?.image || AUTHENTIC_17_FEATURES[0].image;
    this.updateFeature(index, "image", defaultImg);
    const previewEl = document.getElementById(`feature-img-preview-${index}`);
    if (previewEl) {
      previewEl.src = defaultImg;
    }
    if (typeof window.showToast === "function") {
      window.showToast("Amenity photo reset to default.", "info");
    }
  },

  // ==================== TAB 3: MEMBERSHIP PLANS (FETCHED FROM SYSTEM & EDITABLE) ====================
  renderPlans() {
    const container = document.getElementById("website-plans-list");
    if (!container) return;

    if (!this.plans || this.plans.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:3rem; color:var(--text-muted); grid-column: 1 / -1; background:var(--bg-card); border-radius:12px; border:1px dashed var(--border);">
          <div style="font-size:1.1rem; font-weight:600; margin-bottom:0.5rem; color:var(--text-primary);">No Membership Plans in Database</div>
          <p style="font-size:0.85rem; max-width:400px; margin:0 auto 1.5rem auto;">Create your first membership plan to display on the public website and CRM.</p>
          <button class="btn btn-primary" onclick="websiteAdminUI.addPlan()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            + Create New Plan
          </button>
        </div>`;
      return;
    }

    container.innerHTML = "";
    this.plans.forEach((plan) => {
      const card = document.createElement("div");
      card.className = `website-plan-card ${plan.featured ? "featured-card" : ""}`;

      // Use the normalized in-memory list. Do NOT fall back to benefitsEn
      // when benefits is empty — an empty list means the user discarded
      // all tags and must stay empty (old code resurrected deleted tags).
      const benefits = Array.isArray(plan.benefits)
        ? plan.benefits
        : (Array.isArray(plan.benefitsEn) ? plan.benefitsEn : []);

      const benefitsListHtml = benefits.map((b, bIdx) => `
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px; background:var(--bg-hover); padding:6px 10px; border-radius:8px; border:1px solid var(--border);">
          <span style="color:var(--accent-emerald, #10b981); font-weight:700; font-size:12px;">✓</span>
          <input type="text" class="form-control form-control-sm" value="${escapeAttr(b)}" onchange="websiteAdminUI.updatePlanBenefit('${plan.id}', ${bIdx}, this.value)" style="border:none; background:transparent; font-size:0.8rem; padding:0; height:auto; color:var(--text-primary); flex:1;" />
          <button type="button" onclick="websiteAdminUI.removePlanBenefit('${plan.id}', ${bIdx})" style="border:none; background:transparent; cursor:pointer; color:var(--text-muted); font-size:14px; line-height:1; padding:2px 6px;" title="Remove point">&times;</button>
        </div>
      `).join("");

      const safeIdShort = escapeHtml(String(plan.id || "").slice(0, 8));
      const safeName = escapeAttr(plan.planName || plan.nameEn || "");
      const safeNameGu = escapeAttr(plan.nameGu || "");
      const safeDuration = escapeAttr(plan.duration || plan.taglineEn || "");
      const safeBadge = escapeAttr(plan.badge || plan.badgeEn || "");

      card.innerHTML = `
        <div>
          <!-- Plan Header -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border);">
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <span class="badge" style="font-family:monospace; font-size:11px; background:var(--bg-hover); color:var(--text-muted); border:1px solid var(--border);">ID: ${safeIdShort}</span>
              ${plan.featured ? `
                <span style="background:linear-gradient(135deg, #f59e0b, #d97706); color:white; font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; display:inline-flex; align-items:center; gap:4px;">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  FEATURED${plan.badge ? `: ${escapeHtml(plan.badge)}` : ": Popular"}
                </span>` : ""}
              ${plan.seatPreference ? `
                <span style="background:rgba(16,185,129,.14); color:var(--accent-emerald); border:1px solid rgba(16,185,129,.45); font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; display:inline-flex; align-items:center; gap:4px;">
                  SEAT CHOICE
                </span>` : ""}
            </div>
            <div style="display:flex; gap:0.4rem;">
              <button class="btn btn-primary btn-sm" onclick="websiteAdminUI.saveSinglePlan('${plan.id}')" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.78rem;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
                Save
              </button>
              <button class="btn btn-ghost btn-sm" onclick="websiteAdminUI.deletePlan('${plan.id}')" style="color:var(--accent-red, #f43f5e); padding:4px 8px;" title="Delete this plan">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>

          <!-- Plan Basic Info -->
          <div class="plan-fields-grid">
            <div>
              <label class="facility-label">Plan Name (English)</label>
              <input type="text" class="form-control" id="plan-name-${plan.id}" value="${safeName}" />
            </div>
            <div>
              <label class="facility-label">Plan Name (Gujarati)</label>
              <input type="text" class="form-control" id="plan-nameGu-${plan.id}" value="${safeNameGu}" placeholder="દા.ત. ફુલ ડે પ્લાન" />
            </div>
            <div>
              <label class="facility-label">Price (₹ / Month)</label>
              <div style="position:relative; display:flex; align-items:center;">
                <span style="position:absolute; left:12px; color:var(--text-muted); font-weight:700;">₹</span>
                <input type="number" class="form-control" id="plan-price-${plan.id}" value="${plan.price || 0}" min="0" style="padding-left:26px !important;" />
              </div>
            </div>
            <div>
              <label class="facility-label">Duration / Tagline</label>
              <input type="text" class="form-control" id="plan-duration-${plan.id}" value="${safeDuration}" placeholder="e.g. 1 Month / 17 hrs daily" />
            </div>
            <div>
              <label class="facility-label">Seat Type</label>
              <select class="form-control" id="plan-seattype-${plan.id}">
                <option value="Fixed" ${plan.seatType === "Fixed" ? "selected" : ""}>Fixed Reserved Seat</option>
                <option value="Rotational" ${plan.seatType === "Rotational" ? "selected" : ""}>Rotational Seat</option>
                <option value="Night" ${plan.seatType === "Night" ? "selected" : ""}>Night Shift</option>
                <option value="Flexible" ${plan.seatType === "Flexible" ? "selected" : ""}>Flexible / Any</option>
              </select>
            </div>
            <div>
              <label class="facility-label">Highlight Ribbon Badge</label>
              <input type="text" class="form-control" id="plan-badge-${plan.id}" value="${safeBadge}" placeholder="e.g. Recommended, Popular" />
            </div>
            <div>
              <label class="facility-label">Max Capacity (optional)</label>
              <input type="number" class="form-control" id="plan-capacity-${plan.id}" value="${plan.capacity != null ? plan.capacity : ""}" min="0" placeholder="e.g. 30" />
            </div>
            <div>
              <label class="facility-label">Allowed Start Time (optional)</label>
              <input type="time" class="form-control" id="plan-starttime-${plan.id}" value="${plan.allowedStartTime || ""}" />
            </div>
            <div>
              <label class="facility-label">Allowed End Time (optional)</label>
              <input type="time" class="form-control" id="plan-endtime-${plan.id}" value="${plan.allowedEndTime || ""}" />
            </div>
          </div>

          <!-- Featured Toggle -->
          <div style="margin-bottom:1rem; padding:10px 14px; background:var(--bg-hover); border-radius:8px; border:1px solid var(--border);">
            <label style="display:flex; align-items:center; gap:0.6rem; font-size:0.85rem; cursor:pointer; margin:0; user-select:none;">
              <input type="checkbox" id="plan-featured-${plan.id}" ${plan.featured ? "checked" : ""} onchange="websiteAdminUI.togglePlanFlag('${plan.id}', 'featured', this.checked)" style="width:16px; height:16px; cursor:pointer;" />
              <span style="font-weight:600; color:var(--text-primary);">Highlight as Featured / Most Popular Plan on Website</span>
            </label>
          </div>

          <!-- Seat Preference Toggle -->
          <div style="margin-bottom:1rem; padding:10px 14px; background:var(--bg-hover); border-radius:8px; border:1px solid var(--border);">
            <label style="display:flex; align-items:center; gap:0.6rem; font-size:0.85rem; cursor:pointer; margin:0; user-select:none;">
              <input type="checkbox" id="plan-seatpref-${plan.id}" ${plan.seatPreference ? "checked" : ""} onchange="websiteAdminUI.togglePlanFlag('${plan.id}', 'seatPreference', this.checked)" style="width:16px; height:16px; cursor:pointer;" />
              <span style="font-weight:600; color:var(--text-primary);">Seat Preference — students on this plan can pick their seat on the website map</span>
            </label>
          </div>

          <!-- Plan Notes (shown on the Memberships card) -->
          <div style="margin-bottom:1rem;">
            <label class="facility-label">Notes (optional)</label>
            <textarea class="form-control" id="plan-notes-${plan.id}" rows="2" placeholder="Extra info for staff, shown on the Memberships card...">${escapeHtml(plan.notes || "")}</textarea>
          </div>

          <!-- Benefits List -->
          <div>
            <label class="facility-label">Plan Benefits & Bullet Points</label>
            <div style="margin-bottom:0.5rem;">
              ${benefitsListHtml || `<div style="font-size:0.75rem; color:var(--text-muted); padding:6px 0;">No bullet points yet.</div>`}
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
              <input type="text" id="new-benefit-${plan.id}" class="form-control form-control-sm" style="flex:1; min-width:160px;" placeholder="Add benefit (e.g. Personal Locker Access)" onkeydown="if(event.key==='Enter'){event.preventDefault(); websiteAdminUI.addPlanBenefitFromInput('${plan.id}');}" />
              <button class="btn btn-secondary btn-sm" onclick="websiteAdminUI.addPlanBenefitFromInput('${plan.id}')" style="white-space:nowrap; flex-shrink:0;">+ Add</button>
            </div>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  },

  async addPlan() {
    try {
      const plansRef = collection(db, "membershipPlans");
      const newPlan = {
        planName: "New Custom Plan",
        nameEn: "New Custom Plan",
        nameGu: "નવો પ્લાન",
        price: 900,
        duration: "1 Month",
        taglineEn: "1 Month Daily Access",
        taglineGu: "૧ મહિનો દૈનિક એક્સેસ",
        seatType: "Fixed",
        featured: false,
        seatPreference: false,
        badge: "",
        badgeEn: "",
        status: "Active",
        benefits: [
          "Guaranteed Study Seat Allocation",
          "AC + High-Speed Wi-Fi access",
          "Dedicated power charging socket",
          "Purified RO Drinking Water"
        ],
        benefitsEn: [
          "Guaranteed Study Seat Allocation",
          "AC + High-Speed Wi-Fi access",
          "Dedicated power charging socket",
          "Purified RO Drinking Water"
        ],
        createdAt: new Date().toISOString()
      };
      await addDoc(plansRef, newPlan);
      if (typeof window.showToast === "function") {
        window.showToast("New membership plan created in database!", "success");
      }
    } catch (e) {
      console.error("Error adding plan:", e);
      alert("Failed to add plan: " + e.message);
    }
  },

  getPlanBenefits(plan) {
    if (Array.isArray(plan.benefits)) return plan.benefits;
    if (Array.isArray(plan.benefitsEn)) {
      plan.benefits = [...plan.benefitsEn];
      return plan.benefits;
    }
    plan.benefits = [];
    return plan.benefits;
  },

  syncPlanBenefits(plan) {
    const list = this.getPlanBenefits(plan);
    plan.benefitsEn = [...list];
    return list;
  },

  updatePlanBenefit(planId, bIdx, val) {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return;
    const list = this.getPlanBenefits(plan);
    list[bIdx] = val;
    this.syncPlanBenefits(plan);
  },

  async removePlanBenefit(planId, bIdx) {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return;
    const list = this.getPlanBenefits(plan);
    if (bIdx < 0 || bIdx >= list.length) return;
    const [removed] = list.splice(bIdx, 1);
    // Keep both arrays in sync so a discarded tag does not reappear
    // via the legacy `benefitsEn` fallback on re-render / save.
    this.syncPlanBenefits(plan);
    this.renderPlans();
    // Persist immediately. Removal used to live only in memory until Save,
    // so any Firestore snapshot landing in between resurrected the point
    // and the next Save wrote it straight back. Now × means gone — in the
    // database and on every surface reading it. Writes are chained per plan
    // so rapid clicks cannot land out of order.
    this._benefitWrites = this._benefitWrites || {};
    this._benefitWrites[planId] = (this._benefitWrites[planId] || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const live = this.plans.find((p) => p.id === planId);
        const current = live ? this.getPlanBenefits(live) : [];
        await updateDoc(doc(db, "membershipPlans", planId), {
          benefits: [...current],
          benefitsEn: [...current],
          updatedAt: new Date().toISOString()
        });
      })
      .then(() => {
        if (typeof window.showToast === "function") {
          window.showToast("Benefit removed.", "success");
        }
      })
      .catch((e) => {
        console.error("Error removing benefit:", e);
        const live = this.plans.find((p) => p.id === planId);
        if (live && removed !== undefined) {
          const liveList = this.getPlanBenefits(live);
          if (!liveList.includes(removed)) {
            liveList.splice(Math.min(bIdx, liveList.length), 0, removed);
          }
          this.syncPlanBenefits(live);
          this.renderPlans();
        }
        if (typeof window.showToast === "function") {
          window.showToast("Could not remove. Please try again.", "error");
        }
      });
    await this._benefitWrites[planId];
  },

  addPlanBenefitFromInput(planId) {
    const input = document.getElementById(`new-benefit-${planId}`);
    if (!input || !input.value.trim()) return;
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return;
    const list = this.getPlanBenefits(plan);
    list.push(input.value.trim());
    this.syncPlanBenefits(plan);
    input.value = "";
    this.renderPlans();
  },

  /**
   * Instant-save for the Featured / Seat Preference toggles — no separate
   * Save press needed. Writes the single flag, syncs local state and
   * re-renders so chips update immediately.
   */
  async togglePlanFlag(planId, field, value) {
    if (field !== "featured" && field !== "seatPreference") return;
    const plan = this.plans.find((p) => p.id === planId);
    try {
      await updateDoc(doc(db, "membershipPlans", planId), {
        [field]: !!value,
        updatedAt: new Date().toISOString()
      });
      if (plan) plan[field] = !!value;
      this.renderPlans();
      if (typeof window.showToast === "function") {
        window.showToast(`Plan updated — ${field === "featured" ? "Popular mark" : "Seat Preference"} ${value ? "ON" : "OFF"}.`, "success");
      }
    } catch (e) {
      console.error("Error saving plan flag:", e);
      if (plan) plan[field] = !value;
      this.renderPlans();
      if (typeof window.showToast === "function") {
        window.showToast("Could not save. Please try again.", "error");
      }
    }
  },

  async saveSinglePlan(planId) {    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) return;

    const nameInput = document.getElementById(`plan-name-${planId}`);
    const name = nameInput ? nameInput.value.trim() : (plan.planName || plan.nameEn || "Plan");

    const nameGuInput = document.getElementById(`plan-nameGu-${planId}`);
    const nameGu = nameGuInput ? nameGuInput.value.trim() : (plan.nameGu || "");

    const priceInput = document.getElementById(`plan-price-${planId}`);
    const price = priceInput ? (Number(priceInput.value) || 0) : (Number(plan.price) || 0);

    const durationInput = document.getElementById(`plan-duration-${planId}`);
    const duration = durationInput ? durationInput.value.trim() : (plan.duration || plan.taglineEn || "1 Month");

    const seatTypeInput = document.getElementById(`plan-seattype-${planId}`);
    const seatType = seatTypeInput ? seatTypeInput.value : (plan.seatType || "Fixed");

    const badgeInput = document.getElementById(`plan-badge-${planId}`);
    const badge = badgeInput ? badgeInput.value.trim() : (plan.badge || plan.badgeEn || "");

    const featuredInput = document.getElementById(`plan-featured-${planId}`);
    const featured = featuredInput ? featuredInput.checked : (!!plan.featured);

    const seatPrefInput = document.getElementById(`plan-seatpref-${planId}`);
    const seatPreference = seatPrefInput ? seatPrefInput.checked : (!!plan.seatPreference);

    const capacityInput = document.getElementById(`plan-capacity-${planId}`);
    const capacityRaw = capacityInput ? capacityInput.value.trim() : "";
    const capacity = capacityRaw === "" ? null : (Number(capacityRaw) || 0);

    const startInput = document.getElementById(`plan-starttime-${planId}`);
    const allowedStartTime = startInput ? startInput.value : (plan.allowedStartTime || "");

    const endInput = document.getElementById(`plan-endtime-${planId}`);
    const allowedEndTime = endInput ? endInput.value : (plan.allowedEndTime || "");

    const notesInput = document.getElementById(`plan-notes-${planId}`);
    const notes = notesInput ? notesInput.value.trim() : (plan.notes || "");

    // Allow an empty list — discarding all tags must persist as [].
    // Old code fell back to benefitsEn when benefits was empty, so
    // deleted tags instantly reappeared after re-render / save.
    const currentBenefits = Array.isArray(plan.benefits)
      ? [...plan.benefits]
      : (Array.isArray(plan.benefitsEn) ? [...plan.benefitsEn] : []);

    const updates = {
      planName: name,
      nameEn: name,
      nameGu: nameGu,
      price: price,
      duration: duration,
      taglineEn: duration,
      seatType: seatType,
      capacity: capacity,
      allowedStartTime: allowedStartTime,
      allowedEndTime: allowedEndTime,
      notes: notes,
      badge: badge,
      badgeEn: badge,
      featured: featured,
      seatPreference: seatPreference,
      benefits: currentBenefits,
      benefitsEn: [...currentBenefits],
      updatedAt: new Date().toISOString()
    };
    // Keep local state in sync so re-renders don't resurrect old tags.
    plan.featured = featured;
    plan.seatPreference = seatPreference;
    plan.capacity = capacity;
    plan.allowedStartTime = allowedStartTime;
    plan.allowedEndTime = allowedEndTime;
    plan.notes = notes;
    plan.benefits = [...currentBenefits];
    plan.benefitsEn = [...currentBenefits];

    try {
      const docRef = doc(db, "membershipPlans", planId);
      await updateDoc(docRef, updates);
      if (typeof window.showToast === "function") {
        window.showToast(`Plan "${name}" updated successfully!`, "success");
      }
    } catch (e) {
      console.error("Error saving plan:", e);
      alert("Failed to update plan: " + e.message);
    }
  },

  async deletePlan(planId, planName) {
    const plan = this.plans.find((p) => p.id === planId);
    const displayName = planName || plan?.planName || plan?.nameEn || "Plan";
    if (confirm(`Are you sure you want to delete the plan "${displayName}"? This will remove it from both the software and website.`)) {
      try {
        const docRef = doc(db, "membershipPlans", planId);
        await deleteDoc(docRef);
        // Optimistically drop it from local state so the card/tag
        // disappears instantly even before the snapshot fires.
        this.plans = (this.plans || []).filter((p) => p.id !== planId);
        this.renderPlans();
        if (typeof window.showToast === "function") {
          window.showToast("Plan deleted successfully!", "success");
        }
      } catch (e) {
        console.error("Error deleting plan:", e);
        alert("Failed to delete plan: " + e.message);
      }
    }
  },

  // ==================== SAVE ALL WEBSITE SETTINGS ====================
  async saveChanges() {
    const saveBtns = document.querySelectorAll('button[onclick*="websiteAdminUI.saveChanges"]');
    saveBtns.forEach((btn) => {
      btn.disabled = true;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="0.8"/></svg> Saving...`;
    });

    try {
      // Sync any un-blurred inputs for services
      (this.data.services || []).forEach((s, idx) => {
        const titleInput = document.querySelector(`input[onchange*="websiteAdminUI.updateService(${idx}, 'title'"]`);
        if (titleInput) s.title = titleInput.value.trim();
        const badgeInput = document.querySelector(`input[onchange*="websiteAdminUI.updateService(${idx}, 'badge'"]`);
        if (badgeInput) s.badge = badgeInput.value.trim();
        const descInput = document.querySelector(`textarea[onchange*="websiteAdminUI.updateService(${idx}, 'desc'"]`);
        if (descInput) s.desc = descInput.value.trim();
      });

      // Sync any un-blurred inputs for features
      (this.data.features || []).forEach((f, idx) => {
        const titleInput = document.querySelector(`input[onchange*="websiteAdminUI.updateFeature(${idx}, 'title'"]`);
        if (titleInput) f.title = titleInput.value.trim();
        const iconInput = document.querySelector(`select[onchange*="websiteAdminUI.updateFeature(${idx}, 'icon'"]`);
        if (iconInput) f.icon = iconInput.value;
        const descInput = document.querySelector(`input[onchange*="websiteAdminUI.updateFeature(${idx}, 'desc'"]`);
        if (descInput) f.desc = descInput.value.trim();
      });

      const docRef = doc(db, "settings", "website_content");
      // Firestore caps a document at ~1,048,576 bytes. Base64 photos live
      // inside this single doc, so estimate first: a doomed oversized write
      // comes back as INVALID_ARGUMENT, which the console shows as a
      // Write/channel 400. Fail fast with a human message instead.
      const approxBytes = JSON.stringify({
        services: this.data.services,
        features: this.data.features
      }).length;
      if (approxBytes > 900000) {
        const msg = `Website content is ~${Math.round(approxBytes / 1024)}KB — over Firestore's ~1MB per-document limit. Remove or Reset some photos, then save again. Nothing was written.`;
        console.error("[websiteAdminUI] " + msg);
        if (typeof window.showToast === "function") window.showToast(msg, "error");
        else alert(msg);
        return;
      }
      await setDoc(docRef, {
        services: this.data.services,
        features: this.data.features,
        updatedAt: new Date().toISOString()
      });

      // Also save all membership plans currently displayed
      for (const p of this.plans) {
        if (p.id) {
          await this.saveSinglePlan(p.id);
        }
      }

      if (typeof window.showToast === "function") {
        window.showToast("Services, features & plans saved! Public website updated live.", "success");
      } else {
        alert("Website content saved successfully! Changes are live on the website.");
      }
    } catch (error) {
      console.error("Error saving website content:", error?.code || "", error?.message || error);
      alert("Failed to save website content. " + (error?.code ? `[${error.code}] ` : "") + error.message);
    } finally {
      saveBtns.forEach((btn) => {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save All Changes`;
      });
    }
  }
};
