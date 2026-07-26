/* Travel Planner - main application (vanilla JS, RTL Hebrew UI). */
(function () {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const app = $('#app');

  const CURRENCIES = { USD: '$', EUR: '€', ILS: '₪', GBP: '£' };
  const CABINS = [
    ['business', 'מחלקת עסקים'],
    ['premium_economy', 'פרימיום אקונומי'],
    ['first', 'מחלקה ראשונה'],
    ['economy', 'תיירים']
  ];
  const EXPENSE_CATS = ['טיסות', 'מלון', 'אוכל', 'תחבורה', 'אטרקציות', 'קניות', 'אחר'];
  const ITIN_CATS = [
    ['flight', '✈️ טיסה'], ['meeting', '💼 פגישה/כנס'], ['food', '🍽️ אוכל'],
    ['attraction', '🎯 אטרקציה'], ['transport', '🚕 נסיעה'], ['hotel', '🏨 מלון'], ['other', '📌 אחר']
  ];

  const DEFAULT_CHECKLIST = {
    common: ['דרכון בתוקף (6 חודשים לפחות)', 'ביטוח נסיעות', 'צ׳ק-אין אונליין', 'המרת מט"ח / כרטיס אשראי לחו"ל', 'חבילת גלישה / eSIM', 'מטען + מתאם שקע'],
    business: ['כרטיסי ביקור', 'לפטופ + מטען', 'הזמנה/אישור כניסה לתערוכה', 'חליפה / לבוש עסקי', 'רשימת פגישות ואנשי קשר'],
    private: ['כרטיסים לאטרקציות', 'הזמנות למסעדות', 'מצלמה', 'בגדי ים / ציוד לפי יעד']
  };

  let state = { view: 'home', tripId: null, tab: 'overview', editing: false };

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  function daysBetween(a, b) {
    if (!a || !b) return 0;
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function tripDates(trip) {
    const out = [];
    if (!trip.startDate || !trip.endDate) return out;
    const d = new Date(trip.startDate + 'T00:00:00');
    const end = new Date(trip.endDate + 'T00:00:00');
    while (d <= end && out.length < 60) {
      out.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function currencySymbol(c) { return CURRENCIES[c] || c; }

  function totalExpenses(trip) {
    return (trip.expenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  }

  function daysUntil(iso) {
    if (!iso) return null;
    return Math.ceil((new Date(iso + 'T00:00:00') - new Date()) / 86400000);
  }

  /* ---------- auto reminders ---------- */

  function autoReminders(trip) {
    const out = [];
    if (trip.startDate) {
      const dep = trip.bookedFlight && trip.bookedFlight.outboundDep
        ? new Date(trip.bookedFlight.outboundDep)
        : new Date(trip.startDate + 'T09:00:00');
      out.push({ id: 'auto-checkin-out', auto: true, datetime: new Date(dep - 86400000).toISOString(), text: 'צ׳ק-אין אונליין לטיסת ההלוך (24 שעות לפני)' });
      out.push({ id: 'auto-passport', auto: true, datetime: new Date(new Date(trip.startDate + 'T09:00:00') - 14 * 86400000).toISOString(), text: 'בדיקת תוקף דרכון, ויזה וביטוח נסיעות' });
      out.push({ id: 'auto-pack', auto: true, datetime: new Date(new Date(trip.startDate + 'T18:00:00') - 2 * 86400000).toISOString(), text: 'אריזה + הדפסת אישורים' });
    }
    if (trip.endDate) {
      const ret = trip.bookedFlight && trip.bookedFlight.returnDep
        ? new Date(trip.bookedFlight.returnDep)
        : new Date(trip.endDate + 'T18:00:00');
      out.push({ id: 'auto-checkin-ret', auto: true, datetime: new Date(ret - 86400000).toISOString(), text: 'צ׳ק-אין אונליין לטיסת החזור (24 שעות לפני)' });
    }
    return out;
  }

  function allReminders(trip) {
    return autoReminders(trip).concat(trip.reminders || [])
      .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''));
  }

  /* ---------- views ---------- */

  function render() {
    if (state.view === 'home') return renderHome();
    if (state.view === 'form') return renderForm(state.tripId ? TripStore.get(state.tripId) : null);
    if (state.view === 'trip') return renderTrip();
  }

  function renderHome() {
    const trips = TripStore.all();
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = trips.filter(t => !t.endDate || t.endDate >= today);
    const past = trips.filter(t => t.endDate && t.endDate < today);

    app.innerHTML = `
      <header class="topbar">
        <div class="brand">✈️ מתכנן הנסיעות שלי</div>
        <div class="topbar-actions">
          <button class="btn ghost" data-action="open-settings" title="הגדרות">⚙️</button>
          <button class="btn primary" data-action="new-trip">+ נסיעה חדשה</button>
        </div>
      </header>
      <main class="container">
        ${trips.length === 0 ? `
          <div class="empty">
            <div class="empty-icon">🌍</div>
            <h2>לאן טסים?</h2>
            <p>תכנון מסלול מא׳ עד ת׳: טיסות, מלונות, לו״ז יומי, תקציב, מסמכים ותזכורות - הכל במקום אחד.</p>
            <button class="btn primary big" data-action="new-trip">תכנון נסיעה ראשונה</button>
          </div>` : `
          ${upcoming.length ? `<h2 class="section-title">נסיעות קרובות</h2>
            <div class="trip-grid">${upcoming.map(tripCard).join('')}</div>` : ''}
          ${past.length ? `<h2 class="section-title muted">נסיעות שהסתיימו</h2>
            <div class="trip-grid">${past.map(tripCard).join('')}</div>` : ''}
        `}
      </main>`;
  }

  function tripCard(t) {
    const days = daysUntil(t.startDate);
    const nights = daysBetween(t.startDate, t.endDate);
    return `
      <div class="card trip-card" data-action="open-trip" data-id="${t.id}">
        <div class="trip-card-head">
          <span class="badge ${t.type}">${t.type === 'business' ? '💼 עסקית' : '🏖️ פרטית'}</span>
          ${days !== null && days >= 0 ? `<span class="badge count">בעוד ${days} ימים</span>` : ''}
        </div>
        <h3>${esc(t.name || t.destinationCity)}</h3>
        <div class="muted">${esc(t.destinationCity)}${t.destinationCountry ? ', ' + esc(t.destinationCountry) : ''}</div>
        <div class="trip-card-dates"><bdi>${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}</bdi> · ${nights} לילות</div>
      </div>`;
  }

  function renderForm(trip) {
    const t = trip || TripStore.newTrip();
    const isNew = !trip;
    app.innerHTML = `
      <header class="topbar">
        <button class="btn ghost" data-action="back">→ חזרה</button>
        <div class="brand">${isNew ? 'נסיעה חדשה' : 'עריכת נסיעה'}</div>
        <span></span>
      </header>
      <main class="container narrow">
        <form id="trip-form" class="card form">
          <label>סוג הנסיעה
            <div class="seg" id="type-seg">
              <button type="button" class="seg-btn ${t.type === 'business' ? 'on' : ''}" data-type="business">💼 עסקית</button>
              <button type="button" class="seg-btn ${t.type === 'private' ? 'on' : ''}" data-type="private">🏖️ פרטית</button>
            </div>
            <input type="hidden" name="type" value="${t.type}">
          </label>
          <label>שם הנסיעה <input name="name" value="${esc(t.name)}" placeholder="למשל: תערוכת IFA ברלין"></label>
          <div class="row">
            <label>עיר יעד <input name="destinationCity" required value="${esc(t.destinationCity)}" placeholder="Paris"></label>
            <label>מדינה <input name="destinationCountry" value="${esc(t.destinationCountry)}" placeholder="France"></label>
          </div>
          <div class="row">
            <label>קוד שדה תעופה ביעד <input name="destAirportCode" value="${esc(t.destAirportCode)}" maxlength="3" placeholder="CDG" style="text-transform:uppercase"></label>
            <label>המראה מ- <input name="originAirport" value="${esc(t.originAirport || 'TLV')}" maxlength="3" style="text-transform:uppercase"></label>
          </div>
          <div class="row">
            <label>תאריך יציאה <input type="date" name="startDate" required value="${esc(t.startDate)}"></label>
            <label>תאריך חזרה <input type="date" name="endDate" required value="${esc(t.endDate)}"></label>
          </div>
          <div class="row">
            <label>נוסעים <input type="number" name="travelers" min="1" max="9" value="${t.travelers || 1}"></label>
            <label>מחלקה
              <select name="cabin">${CABINS.map(c => `<option value="${c[0]}" ${t.cabin === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select>
            </label>
          </div>
          <label class="check"><input type="checkbox" name="directOnly" ${t.directOnly ? 'checked' : ''}> עדיפות לטיסות ישירות</label>
          <label>חברת תעופה מועדפת
            <select name="preferredAirline">
              <option value="LY" ${(t.preferredAirline || '') === 'LY' ? 'selected' : ''}>אל על (ברירת מחדל)</option>
              <option value="" ${(t.preferredAirline || '') === '' ? 'selected' : ''}>בלי העדפה - הכי זול</option>
            </select>
          </label>
          <div id="venue-fields" class="${t.type === 'business' ? '' : 'hidden'}">
            <label>שם התערוכה / הכנס <input name="venueName" value="${esc(t.venueName)}" placeholder="Paris Expo Porte de Versailles"></label>
            <label>כתובת התערוכה (המלון יחופש בקרבתה) <input name="venueAddress" value="${esc(t.venueAddress)}" placeholder="1 Place de la Porte de Versailles"></label>
          </div>
          <div class="row">
            <label>תקציב <input type="number" name="budgetAmount" min="0" step="50" value="${t.budgetAmount || ''}" placeholder="5000"></label>
            <label>מטבע
              <select name="budgetCurrency">${Object.keys(CURRENCIES).map(c => `<option ${t.budgetCurrency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn primary big">${isNew ? 'צור נסיעה' : 'שמור שינויים'}</button>
            ${isNew ? '' : `<button type="button" class="btn danger" data-action="delete-trip" data-id="${t.id}">מחיקת נסיעה</button>`}
          </div>
        </form>
      </main>`;

    $('#type-seg').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn'); if (!btn) return;
      document.querySelectorAll('#type-seg .seg-btn').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      $('input[name=type]').value = btn.dataset.type;
      $('#venue-fields').classList.toggle('hidden', btn.dataset.type !== 'business');
    });

    $('#trip-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const merged = Object.assign(isNew ? t : TripStore.get(t.id), {
        type: f.get('type'), name: f.get('name').trim(),
        destinationCity: f.get('destinationCity').trim(),
        destinationCountry: f.get('destinationCountry').trim(),
        destAirportCode: f.get('destAirportCode').trim().toUpperCase(),
        originAirport: (f.get('originAirport').trim() || 'TLV').toUpperCase(),
        startDate: f.get('startDate'), endDate: f.get('endDate'),
        travelers: parseInt(f.get('travelers'), 10) || 1,
        cabin: f.get('cabin'), directOnly: !!f.get('directOnly'),
        preferredAirline: f.get('preferredAirline') || '',
        venueName: f.get('venueName') ? f.get('venueName').trim() : '',
        venueAddress: f.get('venueAddress') ? f.get('venueAddress').trim() : '',
        budgetAmount: parseFloat(f.get('budgetAmount')) || 0,
        budgetCurrency: f.get('budgetCurrency')
      });
      if (merged.endDate < merged.startDate) { alert('תאריך החזרה חייב להיות אחרי תאריך היציאה'); return; }
      if (isNew && merged.checklist.length === 0) {
        const items = DEFAULT_CHECKLIST.common.concat(DEFAULT_CHECKLIST[merged.type] || []);
        merged.checklist = items.map(text => ({ id: TripStore.uid(), text, done: false }));
      }
      TripStore.upsert(merged);
      state = { view: 'trip', tripId: merged.id, tab: 'overview' };
      render();
    });
  }

  /* ---------- trip detail ---------- */

  const TABS = [
    ['overview', '🧭 סקירה'], ['itinerary', '📅 לו״ז'], ['budget', '💰 תקציב'],
    ['documents', '📄 מסמכים'], ['reminders', '⏰ תזכורות']
  ];

  function renderTrip() {
    const t = TripStore.get(state.tripId);
    if (!t) { state = { view: 'home' }; return render(); }
    app.innerHTML = `
      <header class="topbar">
        <button class="btn ghost" data-action="back">→ חזרה</button>
        <div class="brand small">${esc(t.name || t.destinationCity)}</div>
        <button class="btn ghost" data-action="edit-trip">עריכה</button>
      </header>
      <nav class="tabs">${TABS.map(x =>
        `<button class="tab ${state.tab === x[0] ? 'on' : ''}" data-tab="${x[0]}">${x[1]}</button>`).join('')}
      </nav>
      <main class="container">${renderTab(t)}</main>`;
    bindTab(t);
  }

  function renderTab(t) {
    switch (state.tab) {
      case 'overview': return tabOverview(t);
      case 'itinerary': return tabItinerary(t);
      case 'budget': return tabBudget(t);
      case 'documents': return tabDocuments(t);
      case 'reminders': return tabReminders(t);
    }
    return '';
  }

  /* --- overview: trip summary + smart search links + booked details --- */

  function tabOverview(t) {
    const L = TravelLinks.allLinks(t);
    const nights = daysBetween(t.startDate, t.endDate);
    const days = daysUntil(t.startDate);
    const hotelQuery = TravelLinks.hotelSearchQuery(t);
    return `
      <div class="card">
        <div class="overview-head">
          <span class="badge ${t.type}">${t.type === 'business' ? '💼 נסיעה עסקית' : '🏖️ נסיעה פרטית'}</span>
          ${days !== null && days >= 0 ? `<span class="badge count">בעוד ${days} ימים</span>` : ''}
        </div>
        <h2>${esc(t.destinationCity)}${t.destinationCountry ? ', ' + esc(t.destinationCountry) : ''}</h2>
        <p class="muted"><bdi>${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}</bdi> · ${nights} לילות · ${t.travelers} נוסעים ·
          ${esc((CABINS.find(c => c[0] === t.cabin) || ['', ''])[1])}${t.directOnly ? ' · טיסות ישירות' : ''}</p>
        ${t.type === 'business' && (t.venueName || t.venueAddress) ? `<p>📍 <b>${esc(t.venueName)}</b> ${esc(t.venueAddress)}</p>` : ''}
      </div>

      <div class="card">
        <h3>✈️ חיפוש טיסות - <bdi>${esc(t.originAirport)} → ${esc(t.destAirportCode || t.destinationCity)}</bdi></h3>
        <p class="muted small">הקישורים נפתחים כשהם כבר מוגדרים: התאריכים שלך, המחלקה שבחרת, מיון לפי מחיר${t.directOnly ? ', העדפה לטיסות ישירות' : ''}${t.preferredAirline === 'LY' ? ' וסינון לטיסות אל על' : ''}.</p>
        ${TripStore.hasApiCreds()
          ? `<button class="btn primary" data-action="live-flights">🔍 חפש טיסות עכשיו - מחירים בתוך האפליקציה</button>`
          : `<p class="hint">💡 רוצה מחירים חיים כאן, בלי לצאת לאתרים? <button class="btn small" data-action="open-settings">חיבור חיפוש אוטומטי</button></p>`}
        <div id="live-flights" class="live-results"></div>
        <details class="fallback-links"><summary>חיפוש באתרים חיצוניים</summary>
          <div class="links">${L.flights.map(l => `<a class="btn link ${l.id === 'airline-site' ? 'primary' : ''}" href="${l.url}" target="_blank" rel="noopener">${l.label} ↗</a>`).join('')}</div>
          ${t.preferredAirline === 'LY' ? '<p class="hint">🔐 באתר אל על מתחברים עם החשבון האישי שלך (גם למועדון הנוסע המתמיד) - הסיסמה נשארת אצלך ולא נשמרת באפליקציה.</p>' : ''}
        </details>
        ${!/^[A-Z]{3}$/.test(t.destAirportCode || '') ? '<p class="hint">💡 הוסף קוד שדה תעופה ביעד (בעריכת הנסיעה) כדי לפתוח גם Skyscanner ו-Kayak.</p>' : ''}
      </div>

      <div class="card">
        <h3>🏨 חיפוש מלון ${t.hotelStars || 5} כוכבים</h3>
        <p class="muted small">${t.type === 'business'
          ? 'נסיעה עסקית: החיפוש ממוקד ליד התערוכה - ' + esc(hotelQuery)
          : 'נסיעה פרטית: החיפוש ממוקד באזור המרכזי - ' + esc(hotelQuery)}</p>
        ${TripStore.hasApiCreds()
          ? `<button class="btn primary" data-action="live-hotels">🔍 חפש מלונות עכשיו - מחירים בתוך האפליקציה</button>`
          : ''}
        <div id="live-hotels" class="live-results"></div>
        <details class="fallback-links"><summary>חיפוש באתרים חיצוניים</summary>
          <div class="links">${L.hotels.map(l => `<a class="btn link" href="${l.url}" target="_blank" rel="noopener">${l.label} ↗</a>`).join('')}</div>
        </details>
      </div>

      <div class="card">
        <h3>📌 מה שכבר הזמנתי</h3>
        <form id="booked-form" class="form">
          <div class="row">
            <label>טיסת הלוך (מס׳) <input name="outboundNo" value="${esc(t.bookedFlight.outboundNo)}" placeholder="LY 325"></label>
            <label>המראה <input type="datetime-local" name="outboundDep" value="${esc(t.bookedFlight.outboundDep)}"></label>
          </div>
          <div class="row">
            <label>טיסת חזור (מס׳) <input name="returnNo" value="${esc(t.bookedFlight.returnNo)}"></label>
            <label>המראה <input type="datetime-local" name="returnDep" value="${esc(t.bookedFlight.returnDep)}"></label>
          </div>
          <div class="row">
            <label>מלון <input name="hotelName" value="${esc(t.bookedHotel.name)}" placeholder="שם המלון"></label>
            <label>אישור הזמנה <input name="hotelConf" value="${esc(t.bookedHotel.confirmation)}" placeholder="מס׳ אסמכתא"></label>
          </div>
          <label>כתובת המלון <input name="hotelAddress" value="${esc(t.bookedHotel.address)}"></label>
          <button class="btn primary" type="submit">שמירה</button>
        </form>
      </div>`;
  }

  /* --- itinerary --- */

  function tabItinerary(t) {
    const dates = tripDates(t);
    if (!dates.length) return '<div class="card"><p>הגדר תאריכים לנסיעה כדי לבנות לו״ז.</p></div>';
    return dates.map((d, i) => {
      const items = (t.itinerary[d] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      return `
      <div class="card day-card">
        <div class="day-head">
          <h3>יום ${i + 1} · ${fmtDate(d)}</h3>
          <button class="btn small" data-action="add-item" data-date="${d}">+ פעילות</button>
        </div>
        ${items.length ? `<ul class="itin">${items.map(it => `
          <li>
            <span class="itin-time">${esc(it.time || '')}</span>
            <span class="itin-cat">${(ITIN_CATS.find(c => c[0] === it.category) || ['', '📌'])[1].split(' ')[0]}</span>
            <span class="itin-title">${esc(it.title)}${it.notes ? `<small class="muted"> · ${esc(it.notes)}</small>` : ''}</span>
            <button class="icon-btn" data-action="del-item" data-date="${d}" data-id="${it.id}">✕</button>
          </li>`).join('')}</ul>` : '<p class="muted small">אין עדיין פעילויות ליום זה</p>'}
      </div>`;
    }).join('') + `
    <dialog id="item-dialog">
      <form id="item-form" class="form" method="dialog">
        <h3>פעילות חדשה</h3>
        <input type="hidden" name="date">
        <div class="row">
          <label>שעה <input type="time" name="time"></label>
          <label>קטגוריה <select name="category">${ITIN_CATS.map(c => `<option value="${c[0]}">${c[1]}</option>`).join('')}</select></label>
        </div>
        <label>כותרת <input name="title" required placeholder="ביקור בלובר / פגישה בביתן 4"></label>
        <label>הערות <input name="notes" placeholder="כתובת, קוד הזמנה..."></label>
        <div class="form-actions">
          <button class="btn primary" value="ok">הוספה</button>
          <button class="btn ghost" value="cancel" formnovalidate>ביטול</button>
        </div>
      </form>
    </dialog>`;
  }

  /* --- budget --- */

  function tabBudget(t) {
    const spent = totalExpenses(t);
    const sym = currencySymbol(t.budgetCurrency);
    const left = (t.budgetAmount || 0) - spent;
    const pct = t.budgetAmount ? Math.min(100, Math.round(spent / t.budgetAmount * 100)) : 0;
    const byCat = {};
    (t.expenses || []).forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + (parseFloat(e.amount) || 0); });
    return `
      <div class="card">
        <h3>💰 תקציב הנסיעה</h3>
        ${t.budgetAmount ? `
          <div class="budget-bar"><div class="budget-fill ${pct > 90 ? 'over' : ''}" style="width:${pct}%"></div></div>
          <div class="budget-nums">
            <span>נוצל: <b>${sym}${spent.toLocaleString()}</b></span>
            <span class="${left < 0 ? 'danger-text' : ''}">${left < 0 ? 'חריגה: ' : 'נותר: '}<b>${sym}${Math.abs(left).toLocaleString()}</b></span>
            <span>תקציב: <b>${sym}${(t.budgetAmount).toLocaleString()}</b></span>
          </div>` : `<p class="muted">לא הוגדר תקציב - סה״כ הוצאות: <b>${sym}${spent.toLocaleString()}</b></p>`}
        ${Object.keys(byCat).length ? `<div class="cat-chips">${Object.entries(byCat).map(([c, v]) =>
          `<span class="chip">${esc(c)}: ${sym}${v.toLocaleString()}</span>`).join('')}</div>` : ''}
      </div>
      <div class="card">
        <h3>הוספת הוצאה</h3>
        <form id="expense-form" class="form">
          <div class="row">
            <label>תיאור <input name="title" required placeholder="מונית משדה התעופה"></label>
            <label>סכום (${sym}) <input type="number" name="amount" step="0.01" min="0" required></label>
          </div>
          <div class="row">
            <label>קטגוריה <select name="category">${EXPENSE_CATS.map(c => `<option>${c}</option>`).join('')}</select></label>
            <label>תאריך <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label>
          </div>
          <button class="btn primary" type="submit">הוספה</button>
        </form>
      </div>
      ${(t.expenses || []).length ? `<div class="card">
        <h3>הוצאות</h3>
        <ul class="plain-list">${t.expenses.slice().reverse().map(e => `
          <li><span>${esc(e.title)} <small class="muted">· ${esc(e.category)} · ${fmtDate(e.date)}</small></span>
            <span class="row-end"><b>${sym}${(parseFloat(e.amount) || 0).toLocaleString()}</b>
            <button class="icon-btn" data-action="del-expense" data-id="${e.id}">✕</button></span></li>`).join('')}
        </ul></div>` : ''}`;
  }

  /* --- documents --- */

  function tabDocuments(t) {
    return `
      <div class="card">
        <h3>📄 מסמכי הנסיעה</h3>
        <p class="muted small">כרטיסים, אישורי מלון, ביטוח, ויזה - שמורים מקומית במכשיר שלך בלבד. קבצים עד ‎2MB.</p>
        <form id="doc-form" class="form">
          <div class="row">
            <label>שם המסמך <input name="name" required placeholder="כרטיס טיסה הלוך"></label>
            <label>קובץ (לא חובה) <input type="file" name="file" accept=".pdf,image/*"></label>
          </div>
          <label>הערה / קישור <input name="note" placeholder="קוד הזמנה, קישור לאישור..."></label>
          <button class="btn primary" type="submit">שמירת מסמך</button>
        </form>
      </div>
      ${(t.documents || []).length ? `<div class="card"><ul class="plain-list">
        ${t.documents.map(d => `<li>
          <span>📎 ${esc(d.name)}${d.note ? `<small class="muted"> · ${esc(d.note)}</small>` : ''}</span>
          <span class="row-end">
            ${d.dataUrl ? `<a class="btn small" href="${d.dataUrl}" download="${esc(d.name)}">הורדה</a>` : ''}
            <button class="icon-btn" data-action="del-doc" data-id="${d.id}">✕</button>
          </span></li>`).join('')}
      </ul></div>` : ''}
      <div class="card">
        <h3>✅ צ׳ק-ליסט לפני נסיעה</h3>
        <form id="check-form" class="form inline">
          <input name="text" required placeholder="פריט חדש...">
          <button class="btn small primary" type="submit">+</button>
        </form>
        <ul class="plain-list">
          ${(t.checklist || []).map(c => `<li>
            <label class="check"><input type="checkbox" data-action="toggle-check" data-id="${c.id}" ${c.done ? 'checked' : ''}>
              <span class="${c.done ? 'done' : ''}">${esc(c.text)}</span></label>
            <button class="icon-btn" data-action="del-check" data-id="${c.id}">✕</button></li>`).join('')}
        </ul>
      </div>`;
  }

  /* --- reminders --- */

  function tabReminders(t) {
    const items = allReminders(t);
    const now = Date.now();
    return `
      <div class="card">
        <h3>⏰ תזכורות</h3>
        <p class="muted small">תזכורות אוטומטיות נבנות מתאריכי הטיסות; אפשר להוסיף גם תזכורות משלך.
          ${('Notification' in window) && Notification.permission !== 'granted'
            ? '<button class="btn small" data-action="enable-notif">הפעלת התראות בדפדפן</button>' : ''}</p>
        <form id="reminder-form" class="form">
          <div class="row">
            <label>מתי <input type="datetime-local" name="datetime" required></label>
            <label>מה <input name="text" required placeholder="להזמין מונית לשדה"></label>
          </div>
          <button class="btn primary" type="submit">הוספת תזכורת</button>
        </form>
      </div>
      <div class="card"><ul class="plain-list">
        ${items.length ? items.map(r => {
          const past = new Date(r.datetime).getTime() < now;
          return `<li class="${past ? 'muted' : ''}">
            <span>${r.auto ? '🤖' : '🔔'} ${esc(r.text)}<small class="muted"> · ${fmtDateTime(r.datetime)}</small></span>
            ${r.auto ? '' : `<button class="icon-btn" data-action="del-reminder" data-id="${r.id}">✕</button>`}
          </li>`;
        }).join('') : '<li class="muted">אין תזכורות עדיין</li>'}
      </ul></div>`;
  }

  /* ---------- live search (in-app prices via TravelApi) ---------- */

  function fmtTime(iso) { return iso && iso.length >= 16 ? iso.slice(11, 16) : ''; }

  function stopsLabel(stops) {
    if (stops == null) return '';
    if (stops === 0) return 'ישירה';
    if (stops === 1) return 'עצירה אחת';
    return stops + ' עצירות';
  }

  function legLine(label, leg) {
    if (!leg) return '';
    const time = fmtTime(leg.dep);
    const stops = stopsLabel(leg.stops);
    return `<div class="leg"><span class="leg-label">${label}</span>
      <bdi>${esc(leg.from)} → ${esc(leg.to)}${time ? ' · ' + time : ''}</bdi>
      ${stops ? `<span class="muted small">(${stops})</span>` : ''}</div>`;
  }

  function flightRow(r) {
    return `<li class="offer ${r.isElal ? 'elal' : ''}">
      <div class="offer-price"><b>$${Math.round(r.price).toLocaleString()}</b>
        ${r.bookUrl ? `<a class="btn small" href="${r.bookUrl}" target="_blank" rel="noopener">להזמנה ↗</a>` : ''}
      </div>
      <div class="offer-body">
        <div>${r.isElal ? '<span class="badge business">✈️ אל על</span>' : esc(r.airlineName)}</div>
        ${legLine('הלוך:', r.outbound)}
        ${legLine('חזור:', r.inbound)}
      </div>
    </li>`;
  }

  function renderFlightResults(rows, note) {
    if (!rows.length) {
      return '<p class="hint">לא נמצאו מחירים ליעד ולתאריכים האלה במאגר. נסה בלי סינון טיסות ישירות, או פתח את "חיפוש באתרים חיצוניים" למטה.</p>';
    }
    const elal = rows.filter(r => r.isElal);
    const rest = rows.filter(r => !r.isElal).slice(0, 7);
    let html = note ? `<p class="hint">${note}</p>` : '';
    if (elal.length) html += `<h4>טיסות אל על</h4><ul class="offers">${elal.slice(0, 5).map(flightRow).join('')}</ul>`;
    if (rest.length) html += `<h4>${elal.length ? 'חברות אחרות (להשוואה)' : 'הטיסות הזולות ביותר'}</h4><ul class="offers">${rest.map(flightRow).join('')}</ul>`;
    html += '<p class="muted small">מחירים לנוסע, הלוך ושוב, כפי שנצפו בחיפושים אחרונים - המחיר הסופי מאושר בעמוד ההזמנה.</p>';
    return html;
  }

  function renderHotelResults(rows, nights) {
    if (!rows.length) {
      return '<p class="hint">לא נמצאו מלונות במאגר לתאריכים האלה. פתח את "חיפוש באתרים חיצוניים" למטה.</p>';
    }
    const items = rows.slice(0, 8).map(h => `<li class="offer">
      <div class="offer-price"><b>$${Math.round(h.price).toLocaleString()}</b><div class="muted small">ללילה בממוצע</div></div>
      <div class="offer-body">
        <div><b>${esc(h.name)}</b></div>
        <div class="muted small">${'⭐'.repeat(Math.min(5, h.stars || 0))}</div>
      </div>
    </li>`).join('');
    return `<ul class="offers">${items}</ul>
      <p class="muted small">מחיר ממוצע ללילה. להזמנה: חפש את שם המלון ב-Booking דרך הקישורים למטה.</p>`;
  }

  function searchErrorMessage(err) {
    const m = String(err && err.message || err);
    if (m.indexOf('BAD_TOKEN') !== -1) return 'הקוד שהוזן לא תקין. פתח את ההגדרות ⚙️ ובדוק שהעתקת נכון את ה-API Token.';
    if (m.indexOf('RATE_LIMIT') !== -1) return 'יותר מדי חיפושים ברצף - חכה חצי דקה ונסה שוב.';
    if (m.indexOf('Failed to fetch') !== -1 || m.indexOf('NetworkError') !== -1) return 'אין חיבור לשירות החיפוש - בדוק את האינטרנט ונסה שוב.';
    return 'החיפוש נכשל (' + esc(m) + '). נסה שוב עוד רגע, או השתמש בקישורים החיצוניים למטה.';
  }

  function runLiveFlights(t) {
    const box = $('#live-flights');
    if (!box) return;
    box.innerHTML = '<p class="loading">🔍 מחפש טיסות... זה לוקח כמה שניות</p>';
    const creds = TripStore.getSettings();
    TravelApi.searchFlights(t, creds)
      .then(rows => {
        if (!rows.length && t.directOnly) {
          return TravelApi.searchFlights(Object.assign({}, t, { directOnly: false }), creds)
            .then(rows2 => box.innerHTML = renderFlightResults(rows2, 'לא נמצאו טיסות ישירות - מציג גם טיסות עם עצירה:'));
        }
        box.innerHTML = renderFlightResults(rows);
      })
      .catch(err => { box.innerHTML = '<p class="hint">' + searchErrorMessage(err) + '</p>'; });
  }

  function runLiveHotels(t) {
    const box = $('#live-hotels');
    if (!box) return;
    box.innerHTML = '<p class="loading">🔍 מחפש מלונות ' + (t.hotelStars || 5) + ' כוכבים... זה לוקח כמה שניות</p>';
    TravelApi.searchHotels(t, TripStore.getSettings())
      .then(rows => { box.innerHTML = renderHotelResults(rows, daysBetween(t.startDate, t.endDate)); })
      .catch(err => { box.innerHTML = '<p class="hint">' + searchErrorMessage(err) + '</p>'; });
  }

  /* ---------- settings dialog ---------- */

  function openSettingsDialog() {
    const existing = $('#settings-dialog');
    if (existing) existing.remove();
    const s = TripStore.getSettings();
    const dlg = document.createElement('dialog');
    dlg.id = 'settings-dialog';
    dlg.innerHTML = `
      <form class="form" method="dialog">
        <h3>⚙️ חיפוש אוטומטי בתוך האפליקציה</h3>
        <p class="muted small">כדי להציג מחירי טיסות ומלונות בתוך האפליקציה, צריך חיבור חינמי לשירות הנתונים של ‏Travelpayouts‏
        (מבית מנוע הטיסות ‏Aviasales‏). נרשמים פעם אחת, מעתיקים לכאן קוד אחד - וזהו.
        הקוד נשמר רק במכשיר הזה.</p>
        <ol class="muted small steps">
          <li>היכנס ל-<a href="https://www.travelpayouts.com" target="_blank" rel="noopener">travelpayouts.com</a>, לחץ ‏Sign up‏ והירשם בחינם</li>
          <li>אשר את המייל שיישלח אליך</li>
          <li>אחרי הכניסה: לחץ על שם המשתמש למעלה ← ‏Profile‏ ← העתק את ה-‏API token</li>
        </ol>
        <label>API Token <input name="apiToken" dir="ltr" autocomplete="off" value="${esc(s.apiToken || '')}" placeholder="הדבק כאן את הקוד"></label>
        <div class="form-actions">
          <button class="btn primary" value="save">שמירה</button>
          <button class="btn ghost" value="cancel" formnovalidate>סגירה</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.querySelector('form').addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'save') {
        const f = new FormData(e.target);
        TripStore.saveSettings({
          apiToken: String(f.get('apiToken') || '').trim()
        });
        render();
      }
    });
    dlg.showModal();
  }

  /* ---------- event wiring ---------- */

  function saveAndRerender(t) { TripStore.upsert(t); render(); }

  function bindTab(t) {
    const booked = $('#booked-form');
    if (booked) booked.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      t.bookedFlight = { outboundNo: f.get('outboundNo').trim(), outboundDep: f.get('outboundDep'), returnNo: f.get('returnNo').trim(), returnDep: f.get('returnDep'), notes: '' };
      t.bookedHotel = Object.assign(t.bookedHotel, { name: f.get('hotelName').trim(), confirmation: f.get('hotelConf').trim(), address: f.get('hotelAddress').trim() });
      saveAndRerender(t);
    });

    const itemForm = $('#item-form');
    if (itemForm) itemForm.addEventListener('submit', (e) => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      const f = new FormData(itemForm);
      const d = f.get('date');
      t.itinerary[d] = t.itinerary[d] || [];
      t.itinerary[d].push({ id: TripStore.uid(), time: f.get('time'), title: f.get('title').trim(), notes: f.get('notes').trim(), category: f.get('category') });
      saveAndRerender(t);
    });

    const expForm = $('#expense-form');
    if (expForm) expForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      t.expenses.push({ id: TripStore.uid(), title: f.get('title').trim(), amount: parseFloat(f.get('amount')) || 0, category: f.get('category'), date: f.get('date') });
      saveAndRerender(t);
    });

    const docForm = $('#doc-form');
    if (docForm) docForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const file = f.get('file');
      const doc = { id: TripStore.uid(), name: f.get('name').trim(), note: f.get('note').trim() };
      if (file && file.size) {
        if (file.size > 2 * 1024 * 1024) { alert('קובץ גדול מדי (מקסימום 2MB). שמור כהערה/קישור במקום.'); return; }
        const reader = new FileReader();
        reader.onload = () => { doc.dataUrl = reader.result; doc.mime = file.type; t.documents.push(doc); trySave(t); };
        reader.readAsDataURL(file);
      } else { t.documents.push(doc); trySave(t); }
    });

    const checkForm = $('#check-form');
    if (checkForm) checkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      t.checklist.push({ id: TripStore.uid(), text: new FormData(e.target).get('text').trim(), done: false });
      saveAndRerender(t);
    });

    const remForm = $('#reminder-form');
    if (remForm) remForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      t.reminders.push({ id: TripStore.uid(), datetime: new Date(f.get('datetime')).toISOString(), text: f.get('text').trim() });
      saveAndRerender(t);
    });
  }

  function trySave(t) {
    try { TripStore.upsert(t); render(); }
    catch (e) { alert('אין מספיק מקום אחסון במכשיר. מחק מסמכים ישנים ונסה שוב.'); }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action], .tab');
    if (!el) return;
    const t = state.tripId ? TripStore.get(state.tripId) : null;

    if (el.classList.contains('tab')) { state.tab = el.dataset.tab; return render(); }

    switch (el.dataset.action) {
      case 'new-trip': state = { view: 'form', tripId: null }; return render();
      case 'open-trip': state = { view: 'trip', tripId: el.dataset.id, tab: 'overview' }; return render();
      case 'back': state = state.view === 'trip' || state.view === 'form' ? { view: 'home' } : state; return render();
      case 'edit-trip': state = { view: 'form', tripId: state.tripId }; return render();
      case 'delete-trip':
        if (confirm('למחוק את הנסיעה לצמיתות?')) { TripStore.remove(el.dataset.id); state = { view: 'home' }; render(); }
        return;
      case 'add-item': {
        const dlg = $('#item-dialog');
        dlg.querySelector('input[name=date]').value = el.dataset.date;
        dlg.showModal(); return;
      }
      case 'del-item':
        t.itinerary[el.dataset.date] = (t.itinerary[el.dataset.date] || []).filter(x => x.id !== el.dataset.id);
        return saveAndRerender(t);
      case 'del-expense':
        t.expenses = t.expenses.filter(x => x.id !== el.dataset.id); return saveAndRerender(t);
      case 'del-doc':
        t.documents = t.documents.filter(x => x.id !== el.dataset.id); return saveAndRerender(t);
      case 'del-check':
        t.checklist = t.checklist.filter(x => x.id !== el.dataset.id); return saveAndRerender(t);
      case 'del-reminder':
        t.reminders = t.reminders.filter(x => x.id !== el.dataset.id); return saveAndRerender(t);
      case 'enable-notif':
        Notification.requestPermission().then(() => render()); return;
      case 'open-settings': openSettingsDialog(); return;
      case 'live-flights': runLiveFlights(t); return;
      case 'live-hotels': runLiveHotels(t); return;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action=toggle-check]');
    if (!el) return;
    const t = TripStore.get(state.tripId);
    const item = t.checklist.find(x => x.id === el.dataset.id);
    if (item) { item.done = el.checked; TripStore.upsert(t); render(); }
  });

  /* fire due reminders as browser notifications while the app is open */
  function notifyDue() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const fired = JSON.parse(localStorage.getItem('travel-planner:fired') || '[]');
    const now = Date.now();
    TripStore.all().forEach(trip => {
      allReminders(trip).forEach(r => {
        const key = trip.id + ':' + r.id;
        const ts = new Date(r.datetime).getTime();
        if (ts <= now && ts > now - 6 * 3600000 && !fired.includes(key)) {
          new Notification('✈️ ' + (trip.name || trip.destinationCity), { body: r.text });
          fired.push(key);
        }
      });
    });
    localStorage.setItem('travel-planner:fired', JSON.stringify(fired.slice(-200)));
  }
  setInterval(notifyDue, 60000);
  notifyDue();

  /* PWA service worker */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
})();
