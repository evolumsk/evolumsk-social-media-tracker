/**
 * SOCIAL FOLLOWER TRACKER v2
 * Apify actor k1ra/social-media-followers-scraper → Google Sheets → Looker Studio
 *
 * SHEETS (all created automatically by setup()):
 *   Dashboard : status + backfill date input + buttons (drawings assigned to btn* functions)
 *   Accounts  : enabled | platform | username | brand | account_label | frequency | note
 *               - platform: instagram | facebook | tiktok | youtube | twitter | linkedin | reddit | threads
 *               - brand: You | Competitor 1 | Competitor 2 | Competitor 3
 *               - account_label: main | secondary (use for 2nd IG/FB account of same brand)
 *               - frequency: daily (scraped every day 22:00) | weekly (scraped if 6+ days since last record)
 *               - reddit username = subreddit name without r/
 *               - linkedin format: in/username or company/slug (REQUIRED, else skipped with warning)
 *   Failures  : date | platform | username | brand | account_label | note  (accounts the actor did not return)
 *   Health    : brand | account_label | platform | username | last_record | days_missing | status (auto check after each run)
 *   Raw       : date | platform | username | brand | account_label | followers | posts | profile_url
 *   Monthly   : month | platform | username | brand | account_label | first | last | growth | avg_daily | growth_pct
 *
 * SETUP:
 *   1) Paste your Apify token into APIFY_TOKEN below (Apify Console → Settings → API tokens)
 *   2) Run setup() once → creates sheets, headers, sample rows, triggers
 *   3) Fill in Accounts, set enabled = TRUE
 *   4) Insert → Drawing → save → right-click → Assign script → btnScrapeToday / btnBackfillDate / btnRebuildSummary
 *   5) Looker Studio → connect to Raw + Monthly
 *
 * API LIMITS (Apify docs, verified 2026-09):
 *   - run-sync-get-dataset-items returns HTTP 201 on success, 408 after 300 s timeout
 *   - global rate limit 250 000 req/min per user; run endpoints 400 rps per resource
 *   - free plan: 25 concurrent actor runs, $5 monthly credits
 *   For a handful of profiles one sync run takes seconds – well within limits.
 */

const APIFY_TOKEN = 'PASTE_YOUR_APIFY_TOKEN_HERE';
const ACTOR_ID = 'k1ra~social-media-followers-scraper';
const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter', 'linkedin', 'reddit', 'threads'];

/* ============================= TRIGGERS / MENU ============================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tracker')
    .addItem('Scrape today now', 'btnScrapeToday')
    .addItem('Backfill date from Dashboard!B4', 'btnBackfillDate')
    .addItem('Rebuild monthly summary', 'btnRebuildSummary')
    .addItem('Health check', 'btnHealthCheck')
    .addItem('Refresh dashboard (values, no formulas)', 'refreshDashboard')
    .addItem('Setup sheets + triggers', 'setup')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();

  const dash = ensureSheet_(ss, 'Dashboard', []);
  dash.getRange('A1').setValue('SOCIAL FOLLOWER TRACKER');
  dash.getRange('A2').setValue('Last run:');
  dash.getRange('A4').setValue('Backfill date (yyyy-MM-dd):');
  dash.getRange('C4').setValue('← put a past date here, then click the BACKFILL button');
  dash.getRange('A6').setValue('Buttons (Insert → Drawing → Assign script): btnScrapeToday | btnBackfillDate | btnRebuildSummary');
  dash.getRange('A7').setValue('Scheduled: daily scrape 22:00, monthly summary on 1st 22:30 (script timezone)');
  dash.getRange('A9').setValue('Accounts needing attention (auto Health check):');
  dash.setColumnWidth(1, 220);

  const acc = ensureSheet_(ss, 'Accounts',
    ['enabled', 'platform', 'username', 'brand', 'account_label', 'frequency', 'note']);
  if (acc.getLastRow() === 1) {
    acc.getRange(2, 1, 6, 7).setValues([
      [false, 'instagram', 'yourbrand',      'You',           'main',      'daily',  ''],
      [false, 'instagram', 'yourbrand.second','You',          'secondary', 'daily',  '2nd IG account'],
      [false, 'facebook',  'yourbrand',      'You',           'main',      'daily',  ''],
      [false, 'tiktok',    'yourbrand',      'You',           'main',      'daily',  ''],
      [false, 'youtube',   '@yourbrand',     'You',           'main',      'daily',  ''],
      [false, 'reddit',    'yoursubreddit',  'You',           'main',      'weekly', 'no r/ prefix']
    ]);
  }

  ensureSheet_(ss, 'Raw',
    ['date', 'platform', 'username', 'brand', 'account_label', 'followers', 'posts', 'profile_url']);
  ensureSheet_(ss, 'Monthly',
    ['month', 'platform', 'username', 'brand', 'account_label', 'first', 'last', 'growth', 'avg_daily', 'growth_pct']);
  ensureSheet_(ss, 'Failures',
    ['date', 'platform', 'username', 'brand', 'account_label', 'note']);
  ensureSheet_(ss, 'Health',
    ['brand', 'account_label', 'platform', 'username', 'last_record', 'days_missing', 'status']);

  ScriptApp.getProjectTriggers().forEach(t => {
    const f = t.getHandlerFunction();
    if (['scheduledDailyRun', 'rebuildSummary'].indexOf(f) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledDailyRun').timeBased().everyDays(1).atHour(22).create();
  ScriptApp.newTrigger('rebuildSummary').timeBased().onMonthDay(1).atHour(22).atMinute(30).create();

  ss.toast('Setup done. Fill Accounts, set enabled=TRUE, add buttons on Dashboard.', 'OK', 60);
}

/* ============================= BUTTONS ============================= */

function btnScrapeToday() {
  scrapeCore_(todayStr_(), false); // all enabled accounts
}

function btnBackfillDate() {
  const dash = SpreadsheetApp.getActive().getSheetByName('Dashboard');
  const v = dash.getRange('B4').getValue();
  const d = (v instanceof Date)
    ? Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd')
    : String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    SpreadsheetApp.getActive().toast('Dashboard!B4 must be a date like 2026-09-20', 'Invalid date', 30);
    return;
  }
  scrapeCore_(d, false);
}

function btnRebuildSummary() {
  rebuildSummary();
  SpreadsheetApp.getActive().toast('Monthly summary rebuilt.', 'OK', 15);
}

function btnHealthCheck() {
  const ss = SpreadsheetApp.getActive();
  const acc = ss.getSheetByName('Accounts');
  const accounts = acc.getRange(2, 1, Math.max(acc.getLastRow() - 1, 0), 7).getValues()
    .filter(r => isEnabled_(r[0]) && r[1] && r[2]);
  healthCheck_(ss, accounts);
  ss.toast('Health check written to Health sheet.', 'OK', 15);
}

/* ============================= CORE SCRAPE ============================= */

function scheduledDailyRun() {
  scrapeCore_(todayStr_(), true); // weekly accounts only if due
}

function scrapeCore_(dateStr, weeklyOnlyIfDue) {
  const ss = SpreadsheetApp.getActive();
  const raw = ss.getSheetByName('Raw');
  const tz = ss.getSpreadsheetTimeZone();

  /* --- read accounts --- */
  const acc = ss.getSheetByName('Accounts');
  const allRows = acc.getRange(2, 1, Math.max(acc.getLastRow() - 1, 0), 7).getValues();
  const invalid = [], accounts = [];
  allRows.forEach(r => {
    if (!isEnabled_(r[0])) return;
    const p = String(r[1]).trim().toLowerCase(), u = String(r[2]).trim();
    let err = '';
    if (PLATFORMS.indexOf(p) === -1) err = 'unknown platform';
    else if (!u) err = 'empty username';
    else if (p === 'linkedin' && u.indexOf('/') === -1) err = 'linkedin must be in/username or company/slug';
    else if (p === 'reddit' && u.indexOf('/') > -1) err = 'reddit: remove r/ prefix';
    if (err) invalid.push([dateStr, p, u, r[3], r[4], err]);
    else accounts.push(r);
  });
  if (!accounts.length) { setStatus_(ss, dateStr + ': no enabled accounts'); return; }

  /* --- weekly due check --- */
  const lastDate = {};
  if (raw.getLastRow() > 1) {
    raw.getRange(2, 1, raw.getLastRow() - 1, 3).getValues().forEach(r => {
      const k = r[1] + '|' + norm_(r[2]);
      if (!lastDate[k] || String(r[0]) > lastDate[k]) lastDate[k] = String(r[0]);
    });
  }
  const due = accounts.filter(([en, p, u, , , freq]) => {
    if (!weeklyOnlyIfDue || String(freq).toLowerCase() !== 'weekly') return true;
    const last = lastDate[p + '|' + norm_(u)];
    if (!last) return true; // never scraped
    const days = (new Date(dateStr) - new Date(last)) / 864e5;
    return days >= 6;
  });

  const input = {};
  due.forEach(([en, p, u]) => { (input[p] = input[p] || []).push(String(u).trim()); });
  if (!Object.keys(input).length) { setStatus_(ss, dateStr + ': nothing due (weekly platforms not due yet)'); return; }

  /* --- call Apify synchronously (max 300 s) --- */
  const url = 'https://api.apify.com/v2/acts/' + ACTOR_ID + '/run-sync-get-dataset-items';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + APIFY_TOKEN },
    payload: JSON.stringify(input),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code !== 200 && code !== 201) { // Apify run-sync returns 201 Created on success
    setStatus_(ss, dateStr + ': API error ' + code + ' – ' + resp.getContentText().slice(0, 120));
    return;
  }

  const items = JSON.parse(resp.getContentText());

  /* --- map labels --- */
  const meta = {};
  accounts.forEach(([en, p, u, brand, label]) => {
    meta[p + '|' + norm_(u)] = { brand: brand, label: label };
  });

  /* --- upsert into Raw (re-running same date overwrites, never duplicates) --- */
  const existing = {};
  if (raw.getLastRow() > 1) {
    raw.getRange(2, 1, raw.getLastRow() - 1, 3).getValues().forEach((r, i) => {
      if (String(r[0]) === dateStr) existing[r[1] + '|' + norm_(r[2])] = i + 2;
    });
  }

  const newRows = [];
  const seen = {};
  items.forEach(it => {
    const followers = (it.followers != null) ? it.followers : (it.members != null ? it.members : null);
    const posts = (it.posts != null) ? it.posts : (it.videos != null ? it.videos : null);
    const m = meta[it.platform + '|' + norm_(it.username)] || { brand: '', label: '' };
    const row = [dateStr, it.platform, it.username, m.brand, m.label, followers, posts, it.profileUrl || ''];
    seen[it.platform + '|' + norm_(it.username)] = true;
    const key = it.platform + '|' + norm_(it.username);
    if (existing[key]) raw.getRange(existing[key], 1, 1, 8).setValues([row]);
    else newRows.push(row);
  });
  if (newRows.length) raw.getRange(raw.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);

  /* --- log accounts the actor did NOT return --- */
  const missRows = invalid.slice();
  due.forEach(([en, p, u, brand, label]) => {
    if (!seen[p + '|' + norm_(u)]) missRows.push([dateStr, p, String(u).trim(), brand, label, 'not returned by actor (private / deleted / scrape fail)']);
  });
  if (missRows.length) {
    const fsh = ss.getSheetByName('Failures');
    fsh.getRange(fsh.getLastRow() + 1, 1, missRows.length, 6).setValues(missRows);
  }

  const requested = Object.keys(input).reduce((n, p) => n + input[p].length, 0);
  const failed = requested - items.length + invalid.length;
  setStatus_(ss, dateStr + ': ' + items.length + ' profiles saved' +
    (failed ? ', ' + failed + ' failed/invalid -> see Failures' : ''));
  healthCheck_(ss, accounts);
  refreshDashboard_(ss, accounts);
}

/* ============================= MONTHLY SUMMARY ============================= */

function rebuildSummary() {
  const ss = SpreadsheetApp.getActive();
  const sum = ss.getSheetByName('Monthly');
  const raw = ss.getSheetByName('Raw');
  const tz = ss.getSpreadsheetTimeZone();

  const data = raw.getRange(2, 1, Math.max(raw.getLastRow() - 1, 0), 6).getValues()
    .filter(r => r[0] !== '' && r[5] != null && r[5] !== '');

  const groups = {};
  data.forEach(r => {
    const month = Utilities.formatDate(new Date(r[0]), tz, 'yyyy-MM');
    const key = [month, r[1], norm_(r[2])].join('|');
    (groups[key] = groups[key] || []).push(r);
  });

  const rows = Object.keys(groups).sort().map(key => {
    const parts = key.split('|');
    const g = groups[key];
    const first = g[0], last = g[g.length - 1];
    const days = Math.max((new Date(last[0]) - new Date(first[0])) / 864e5, 1);
    const growth = last[5] - first[5];
    return [parts[0], parts[1], g[0][2], last[3], last[4], first[5], last[5],
            growth, Math.round((growth / days) * 100) / 100,
            Math.round((last[5] / first[5] - 1) * 1000) / 10];
  });

  sum.clearContents();
  sum.getRange(1, 1, 1, 10).setValues([['month','platform','username','brand','account_label','first','last','growth','avg_daily','growth_pct']]);
  if (rows.length) sum.getRange(2, 1, rows.length, 10).setValues(rows);
}

/* ============ HEALTH CHECK: flags enabled accounts with stale data ============ */

function healthCheck_(ss, accounts) {
  const raw = ss.getSheetByName('Raw');
  const tz = ss.getSpreadsheetTimeZone();
  const today = new Date(todayStr_());
  const lastDate = {};
  if (raw.getLastRow() > 1) {
    raw.getRange(2, 1, raw.getLastRow() - 1, 3).getValues().forEach(r => {
      const k = r[1] + '|' + norm_(r[2]);
      if (!lastDate[k] || String(r[0]) > lastDate[k]) lastDate[k] = String(r[0]);
    });
  }
  const rows = accounts.map(([en, p, u, brand, label, freq]) => {
    const last = lastDate[p + '|' + norm_(u)];
    if (!last) return [brand, label, p, u, '', '', 'NEVER SCRAPED'];
    const days = Math.floor((today - new Date(last)) / 864e5);
    const limit = String(freq).toLowerCase() === 'weekly' ? 8 : 2;
    return [brand, label, p, u, last, days, days > limit ? 'STALE (' + days + 'd)' : 'ok'];
  });
  const hsh = ss.getSheetByName('Health');
  hsh.clearContents();
  hsh.getRange(1, 1, 1, 7).setValues([['brand','account_label','platform','username','last_record','days_missing','status']]);
  if (rows.length) hsh.getRange(2, 1, rows.length, 7).setValues(rows);
  const stale = rows.filter(r => String(r[6]).indexOf('ok') !== 0).length;
  ss.getSheetByName('Dashboard').getRange('B9').setValue(stale ? stale + ' account(s) need attention -> see Health' : 'all accounts up to date');
}

/* ============ DASHBOARD AS VALUES (locale-proof, replaces formulas) ============ */

function refreshDashboard() {
  const ss = SpreadsheetApp.getActive();
  const acc = ss.getSheetByName('Accounts');
  const accounts = acc.getRange(2, 1, Math.max(acc.getLastRow() - 1, 0), 7).getValues()
    .filter(r => isEnabled_(r[0]) && r[1] && r[2]);
  refreshDashboard_(ss, accounts);
  SpreadsheetApp.flush();
  const raw = ss.getSheetByName('Raw');
  ss.toast('Dashboard: ' + accounts.length + ' enabled accounts, ' +
           Math.max(raw.getLastRow() - 1, 0) + ' raw rows.', 'refreshDashboard', 60);
}

function refreshDashboard_(ss, accounts) {
  const raw = ss.getSheetByName('Raw');
  const dash = ss.getSheetByName('Dashboard');
  const data = raw.getLastRow() > 1
    ? raw.getRange(2, 1, raw.getLastRow() - 1, 6).getValues().filter(r => r[0] !== '' && r[5] != null && r[5] !== '')
    : [];
  const per = {};
  data.forEach(r => { (per[r[1] + '|' + norm_(r[2])] = per[r[1] + '|' + norm_(r[2])] || []).push(r); });

  dash.getRange('A13:I42').clearContent(); // remove old formulas/values, keep formatting
  const rows = accounts.map(([en, p, u, brand, label]) => {
    const g = per[p + '|' + norm_(u)] || [];
    const last = g[g.length - 1], prev = g[g.length - 2];
    return [brand, p, label, String(u).trim(),
            last ? String(last[0]) : 'missing',
            last ? last[5] : '',
            (last && prev) ? prev[5] : '',
            (last && prev) ? last[5] - prev[5] : '',
            (last && prev && prev[5]) ? Math.round((last[5] - prev[5]) / prev[5] * 10000) / 100 : ''];
  });
  if (rows.length) dash.getRange(13, 1, rows.length, 9).setValues(rows);
}

/* ============================= HELPERS ============================= */

function todayStr_() {
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

function norm_(v) { return String(v).trim().toLowerCase(); }

function isEnabled_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function setStatus_(ss, msg) {
  ss.getSheetByName('Dashboard').getRange('B2').setValue(
    Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm') + ' – ' + msg);
}

function ensureSheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (header.length && sh.getLastRow() === 0) sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}
