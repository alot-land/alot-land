/**
 * Parses seo-engine/queue.md into data the dashboard renders.
 *
 * The queue stays a Markdown file on purpose: David and anyone hired can edit
 * it in any editor, it reviews cleanly in a diff, and it does not need the CMS.
 * The dashboard reads it rather than keeping a second copy — one source of
 * truth, so the page can never disagree with the file.
 */

// Cell contents are written by us, not submitted by anyone, so a small
// inline renderer is enough — bold, code and links.
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function inlineMarkdown(text = '') {
  return escape(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" class="underline decoration-gold decoration-2 underline-offset-2 hover:text-bg-dark">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 rounded text-[0.85em]">$1</code>');
}

function parseTable(lines) {
  const rows = lines.filter(l => l.trim().startsWith('|'));
  if (rows.length < 2) return [];
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const headers = cells(rows[0]).map(h => h.toLowerCase());
  return rows
    .slice(2) // skip the header and the |---| separator
    .map(r => {
      const values = cells(r);
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
      return row;
    })
    .filter(r => Object.values(r).some(Boolean));
}

export function parseQueue(markdown) {
  const sections = {};
  let current = null;
  let buffer = [];

  const flush = () => {
    if (current) sections[current] = parseTable(buffer);
    buffer = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) { flush(); current = heading[1].trim().toLowerCase(); continue; }
    buffer.push(line);
  }
  flush();

  const pick = name => sections[name] ?? [];
  const norm = r => ({
    n: r['#'] ?? '',
    item: r.item ?? '',
    why: r['why it matters'] ?? r['blocked by'] ?? '',
    owner: r.owner ?? '',
    status: (r.status ?? '').toLowerCase(),
    blockedBy: r['blocked by'] ?? '',
  });

  return {
    now: pick('now').map(norm),
    next: pick('next').map(norm),
    blocked: pick('waiting on something').map(norm),
    done: pick('done').map(r => ({ item: r.item ?? '', cycle: r.cycle ?? '' })),
  };
}
