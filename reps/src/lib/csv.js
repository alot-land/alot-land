// Minimal CSV utilities. The import parser is tolerant: it respects quotes when
// present, and for unquoted rows where a free-text description contains commas it
// collapses the extra middle tokens back into the description (columns are fixed).

function tokenizeLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((t) => t.trim());
}

function toISO(mdY) {
  const s = (mdY || '').trim();
  // MM/DD/YYYY -> YYYY-MM-DD
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

// Parse the pasted REPS CSV into raw rows keyed by column meaning.
// Expected header: Date,Day,Activity Category,Description,Hours,Source
export function parseRepsCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l).filter((l) => l.trim().length);
  if (!lines.length) return [];

  let start = 0;
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes('date') && first.includes('hours');
  if (hasHeader) start = 1;

  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    // Skip running-total / grand-total footer lines the agent may append.
    if (/^,*\s*(running total|grand total|total)\b/i.test(line)) continue;

    let t = tokenizeLine(line);
    if (t.length < 6) continue;
    // Collapse extra middle tokens (commas inside description) back together.
    if (t.length > 6) {
      const date = t[0], day = t[1], category = t[2];
      const source = t[t.length - 1], hours = t[t.length - 2];
      const description = t.slice(3, t.length - 2).join(', ');
      t = [date, day, category, description, hours, source];
    }
    const [date, day, csvCategory, description, hoursRaw, source] = t;
    const hours = parseFloat(hoursRaw);
    if (!date || !Number.isFinite(hours)) continue;

    rows.push({
      entry_date: toISO(date),
      day,
      csvCategory,
      description,
      hours,
      source,
    });
  }
  return rows;
}

// Serialize entries to CSV text for export (Excel / Google Sheets friendly).
export function serializeCsv(headers, records) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map(esc).join(',');
  const body = records.map((r) => r.map(esc).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

export function downloadText(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
