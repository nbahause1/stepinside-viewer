/**
 * Self-contained German HTML report for property owners.
 *
 * Design goals: premium, calm, Apple-like — system font stack, soft cards,
 * generous whitespace, no JS, no external requests (all CSS inline, emoji
 * only). Mobile-friendly via fluid grids; wide tables scroll inside their own
 * container. Every user-originated string is HTML-escaped.
 */

export interface ReportLeadRow {
  ts: number;
  name: string;
  contact: string;
  interest: string | null;
  timeframe: string | null;
}

export interface ReportData {
  propertyId: string;
  label: string | null;
  generatedAt: number;
  opens: number;
  avgDwellMs: number | null;
  tourStarts: number;
  tourCompletes: number;
  stagings: number;
  shares: number;
  ctaClicks: number;
  annotations: { label: string; count: number }[];
  /** 1-5 helpfulness scale, index 0 = rating 1 ("gar nicht hilfreich"). */
  survey: number[];
  questions: { ts: number; text: string }[];
  leads: ReportLeadRow[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const nf = new Intl.NumberFormat('de-DE');

const dateFmt = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
});

function fmtInt(n: number): string {
  return nf.format(n);
}

function fmtDate(ts: number): string {
  return ts > 0 ? dateFmt.format(new Date(ts)) : '–';
}

function fmtDwell(ms: number | null): string {
  if (ms === null || ms <= 0) return '–';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} min`;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '–';
  return `${Math.round((part / whole) * 100)} %`;
}

const STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f5f7;
    color: #1d1d1f;
    line-height: 1.5;
    padding: clamp(16px, 4vw, 48px) clamp(14px, 4vw, 32px) 64px;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  .eyebrow {
    font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
    color: #86868b; margin-bottom: 6px;
  }
  h1 { font-size: clamp(24px, 5vw, 34px); font-weight: 700; letter-spacing: -0.02em; }
  .sub { color: #86868b; font-size: 14px; margin-top: 4px; margin-bottom: 28px; }
  .kpis {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px; margin-bottom: 28px;
  }
  .kpi {
    background: #fff; border-radius: 18px; padding: 18px 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04);
  }
  .kpi .v { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .kpi .l { font-size: 13px; color: #86868b; margin-top: 2px; }
  .card {
    background: #fff; border-radius: 20px; padding: 22px clamp(16px, 3vw, 26px);
    box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04);
    margin-bottom: 16px;
  }
  .card h2 { font-size: 17px; font-weight: 650; margin-bottom: 14px; letter-spacing: -0.01em; }
  .card h2 .avg { float: right; font-size: 14px; font-weight: 600; color: #3d7bfd; }
  .hint { font-size: 13px; color: #86868b; margin: -8px 0 14px; }
  .scale-hint { font-size: 12px; color: #86868b; margin-top: 10px; }
  .empty { color: #86868b; font-size: 14px; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .bar-row:last-child { margin-bottom: 0; }
  .bar-label { flex: 0 0 auto; min-width: 2em; font-size: 15px; }
  .bar-track { flex: 1; height: 10px; background: #f0f0f2; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #3d7bfd, #6aa2ff); border-radius: 999px; }
  .bar-count { flex: 0 0 auto; font-size: 13px; color: #86868b; min-width: 2.5em; text-align: right; font-variant-numeric: tabular-nums; }
  .anno-label { flex: 0 1 40%; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .funnel { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .funnel .step { background: #f5f5f7; border-radius: 14px; padding: 14px 16px; }
  .funnel .v { font-size: 22px; font-weight: 700; }
  .funnel .l { font-size: 13px; color: #86868b; }
  ul.questions { list-style: none; }
  ul.questions li {
    padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.06);
    font-size: 14px;
  }
  ul.questions li:last-child { border-bottom: none; }
  ul.questions time { display: block; font-size: 12px; color: #86868b; margin-top: 2px; }
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; min-width: 480px; }
  th {
    text-align: left; font-size: 12px; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: #86868b; padding: 8px 12px 8px 0;
    border-bottom: 1px solid rgba(0,0,0,0.1);
  }
  td { padding: 10px 12px 10px 0; border-bottom: 1px solid rgba(0,0,0,0.06); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .footer { text-align: center; color: #86868b; font-size: 12.5px; margin-top: 32px; line-height: 1.7; }
`;

function kpiCell(value: string, label: string): string {
  return `<div class="kpi"><div class="v">${value}</div><div class="l">${label}</div></div>`;
}

function surveyBar(label: string, count: number, max: number): string {
  const width = max > 0 ? Math.max(count > 0 ? 4 : 0, Math.round((count / max) * 100)) : 0;
  return `<div class="bar-row"><span class="bar-label">${label}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><span class="bar-count">${fmtInt(count)}</span></div>`;
}

/** Render the full report document. All dynamic strings must be escaped here. */
export function renderReportHtml(d: ReportData): string {
  const title = d.label ? escapeHtml(d.label) : escapeHtml(d.propertyId);

  const surveyTotal = d.survey.reduce((a, b) => a + b, 0);
  const surveyMax = Math.max(...d.survey, 0);
  const surveyAvg =
    surveyTotal > 0
      ? (d.survey.reduce((sum, n, i) => sum + n * (i + 1), 0) / surveyTotal).toFixed(1)
      : null;

  const annotationMax = d.annotations.reduce((m, a) => Math.max(m, a.count), 0);
  const annotationRows = d.annotations
    .filter((a) => a.label.length > 0)
    .map((a) => {
      const width = annotationMax > 0 ? Math.max(4, Math.round((a.count / annotationMax) * 100)) : 0;
      return `<div class="bar-row"><span class="anno-label">${escapeHtml(a.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div><span class="bar-count">${fmtInt(a.count)}</span></div>`;
    })
    .join('\n');

  const questionItems = d.questions
    .map((q) => `<li>„${escapeHtml(q.text)}“<time>${escapeHtml(fmtDate(q.ts))}</time></li>`)
    .join('\n');

  const leadRows = d.leads
    .map(
      (l) =>
        `<tr><td>${escapeHtml(fmtDate(l.ts))}</td><td>${escapeHtml(l.name)}</td><td>${escapeHtml(l.contact)}</td><td>${l.interest ? escapeHtml(l.interest) : '–'}</td><td>${l.timeframe ? escapeHtml(l.timeframe) : '–'}</td></tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Bericht · ${title}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">innsyn · Exposé-Bericht</p>
  <h1>${title}</h1>
  <p class="sub">Stand: ${escapeHtml(fmtDate(d.generatedAt))} · alle Zahlen anonym erhoben</p>

  <div class="kpis">
    ${kpiCell(fmtInt(d.opens), 'Aufrufe')}
    ${kpiCell(escapeHtml(fmtDwell(d.avgDwellMs)), 'Ø Verweildauer')}
    ${kpiCell(fmtInt(d.tourStarts), 'Tour-Starts')}
    ${kpiCell(`${fmtInt(d.tourCompletes)}`, `Tour-Abschlüsse (${pct(d.tourCompletes, d.tourStarts)})`)}
    ${kpiCell(fmtInt(d.stagings), 'Staging-Nutzungen')}
    ${kpiCell(fmtInt(d.shares), 'Share-Klicks')}
  </div>

  <div class="card">
    <h2>Beliebteste Punkte im Rundgang</h2>
    ${annotationRows.length > 0 ? annotationRows : '<p class="empty">Noch keine Daten – sobald Besucher Anmerkungen öffnen, siehst Du sie hier.</p>'}
  </div>

  <div class="card">
    <h2>Wie hilfreich war der Rundgang?${surveyAvg !== null ? ` <span class="avg">Ø ${surveyAvg} / 5</span>` : ''}</h2>
    ${
      surveyTotal > 0
        ? d.survey.map((n, i) => surveyBar(String(i + 1), n, surveyMax)).join('\n    ')
        : '<p class="empty">Noch keine Bewertungen abgegeben.</p>'
    }
    ${surveyTotal > 0 ? '<p class="scale-hint">1 = gar nicht hilfreich · 5 = sehr hilfreich</p>' : ''}
  </div>

  <div class="card">
    <h2>Vom Interesse zur Anfrage</h2>
    <div class="funnel">
      <div class="step"><div class="v">${fmtInt(d.ctaClicks)}</div><div class="l">CTA-Klicks</div></div>
      <div class="step"><div class="v">${fmtInt(d.leads.length)}</div><div class="l">Anfragen (Leads)</div></div>
      <div class="step"><div class="v">${pct(d.leads.length, d.ctaClicks)}</div><div class="l">Abschlussquote</div></div>
    </div>
  </div>

  <div class="card">
    <h2>Fragen an den Concierge</h2>
    <p class="hint">Wörtliche Fragen der Besucher — können persönliche Angaben enthalten, bitte vertraulich behandeln.</p>
    ${questionItems.length > 0 ? `<ul class="questions">${questionItems}</ul>` : '<p class="empty">Noch keine Fragen gestellt.</p>'}
  </div>

  <div class="card">
    <h2>Leads</h2>
    ${
      leadRows.length > 0
        ? `<div class="table-scroll"><table>
      <thead><tr><th>Datum</th><th>Name</th><th>Kontakt</th><th>Interesse</th><th>Einzug</th></tr></thead>
      <tbody>${leadRows}</tbody>
    </table></div>`
        : '<p class="empty">Noch keine Anfragen eingegangen.</p>'
    }
  </div>

  <p class="footer">
    Erhoben ohne Cookies und ohne IP-Adressen. Besucher-Sitzungen sind anonym,<br>
    leben nur im Arbeitsspeicher des Browsers und werden nie über Besuche hinweg verknüpft.
  </p>
</div>
</body>
</html>`;
}

/** Uniform 404 page — identical for "wrong token" and "no such property". */
export function renderReportNotFoundHtml(): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Nicht gefunden</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap" style="text-align:center; padding-top: 18vh;">
  <p class="eyebrow">innsyn</p>
  <h1>Bericht nicht gefunden</h1>
  <p class="sub">Der Link ist ungültig oder abgelaufen. Bitte prüfe die Adresse oder frag nach einem neuen Link.</p>
</div>
</body>
</html>`;
}
