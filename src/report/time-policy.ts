// The SHARED presentation-only time policy for the Observer (`src/observe`)
// and Reports (`src/report`) browser bundles.
//
// It lives under `src/report/` deliberately: hard invariant 9 forbids anything
// importing `src/observe`, and `src/observe/server.ts` already imports
// `../report/assets.js`. `src/report/` is therefore the only legal shared home
// for a primitive both read-only leaves need. Duplicating the snippet into both
// bundles is the failure mode this module exists to prevent (#93).
//
// The snippet is interpolated into two `String.raw` templates, so it must
// contain no backtick and no `${` sequence. `test/observe/server.test.ts` pins
// that mechanically.
//
// Policy, in one sentence: the projection emits canonical ISO-8601 UTC with
// milliseconds; the browser is the only thing that knows the operator's zone,
// so every localization happens here, per instant, via `Intl.DateTimeFormat`
// so daylight-saving transitions are the platform's problem and never ours.

export const TIME_POLICY_JS = String.raw`
  const TIME_ZONE = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (error) { return 'UTC'; }
  })();
  const parseInstant = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  // Resolved PER INSTANT, never cached: a cached offset renders both sides of a
  // daylight-saving boundary identically, which is indistinguishable to an
  // operator reading an incident timeline.
  const zoneAbbrev = (date) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'short' }).formatToParts(date);
      const found = parts.find((part) => part.type === 'timeZoneName');
      return found ? found.value : '';
    } catch (error) { return ''; }
  };
  const utcOffset = (date) => {
    let raw = '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' }).formatToParts(date);
      const found = parts.find((part) => part.type === 'timeZoneName');
      raw = found ? found.value : '';
    } catch (error) { raw = ''; }
    if (!raw) return 'UTC+00:00';
    let rest = raw.replace('GMT', '').replace('UTC', '');
    if (!rest) return 'UTC+00:00';
    const sign = rest.charAt(0) === '-' ? '-' : '+';
    rest = rest.replace(/^[+-]/, '');
    const halves = rest.split(':');
    const hours = String(halves[0] || '0').padStart(2, '0');
    const minutes = String(halves.length > 1 ? halves[1] : '00').padStart(2, '0');
    return 'UTC' + sign + hours + ':' + minutes;
  };
  // An alphabetic abbreviation (PDT) is friendlier, but zones such as
  // Asia/Kolkata have none — Intl returns 'GMT+5:30' there. Normalize to the
  // padded UTC offset rather than leaking a second, inconsistent notation.
  const zoneToken = (date) => {
    const abbrev = zoneAbbrev(date);
    return /^[A-Za-z]{2,5}$/.test(abbrev) ? abbrev : utcOffset(date);
  };
  const formatLocal = (date) => date.toLocaleString(undefined, { timeZone: TIME_ZONE }) + ' ' + zoneToken(date);
  const formatUtc = (date) => date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const formatStamp = (value, mode) => {
    const date = parseInstant(value);
    if (date === null) return value ? 'unreadable timestamp' : 'not recorded';
    return mode === 'utc' ? formatUtc(date) : formatLocal(date);
  };
  // Returns a real <time> element so the machine-readable UTC instant and the
  // human rendering can never drift: datetime is always the canonical UTC ISO
  // regardless of the display mode, and the other zone is always in the title
  // so exact UTC is reachable without a toggle.
  const timeEl = (value, mode, prefix) => {
    const date = parseInstant(value);
    if (date === null) {
      const span = document.createElement('span');
      span.className = 'meta';
      span.textContent = value ? 'unreadable timestamp' : 'not recorded';
      return span;
    }
    const iso = date.toISOString();
    const element = document.createElement('time');
    element.setAttribute('datetime', iso);
    element.setAttribute('title', iso.replace('T', ' ').slice(0, 19) + ' UTC · ' + formatLocal(date));
    element.textContent = (prefix ? prefix + ' ' : '') + (mode === 'utc' ? formatUtc(date) : formatLocal(date));
    return element;
  };
  const zoneStatement = (mode) => {
    const now = new Date();
    if (mode === 'utc') return 'Times shown in UTC (UTC+00:00) · source and tooltips UTC';
    const abbrev = zoneAbbrev(now);
    const offset = utcOffset(now);
    const label = /^[A-Za-z]{2,5}$/.test(abbrev) ? abbrev + ', ' + offset : offset;
    return 'Times shown in ' + TIME_ZONE + ' (' + label + ') · source and tooltips UTC';
  };
`;
