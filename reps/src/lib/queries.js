import { supabase } from './supabase';
import { classifyRow, dedupeKey } from './reps';

export async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

export async function fetchEntries() {
  const { data, error } = await supabase
    .from('reps_entries')
    .select('*')
    .order('entry_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateEntry(id, patch) {
  const { data, error } = await supabase
    .from('reps_entries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEntry(id) {
  const { error } = await supabase.from('reps_entries').delete().eq('id', id);
  if (error) throw error;
}

export async function createEntry(entry) {
  const user_id = await currentUserId();
  if (!user_id) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('reps_entries')
    .insert({ ...entry, user_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Turn raw parsed CSV rows into insertable entries via the first-pass classifier.
export function rowsToEntries(rawRows) {
  return rawRows.map((r) => {
    const cls = classifyRow({ csvCategory: r.csvCategory, description: r.description, source: r.source });
    return {
      entry_date: r.entry_date,
      category: cls.category,
      description: r.description || '',
      hours: r.hours,
      is_real_estate: cls.is_real_estate,
      reps_qualifying: cls.reps_qualifying,
      needs_review: cls.needs_review,
      source_tier: cls.source_tier,
      source_ref: r.source || null,
    };
  });
}

// Bulk import. mode 'replace' wipes existing entries first; 'append' adds and
// dedupes against what's already there (by date+description+hours).
export async function importEntries(entries, mode = 'replace') {
  const user_id = await currentUserId();
  if (!user_id) throw new Error('Not signed in');

  if (mode === 'replace') {
    const { error: delErr } = await supabase.from('reps_entries').delete().eq('user_id', user_id);
    if (delErr) throw delErr;
  }

  let toInsert = entries;
  if (mode === 'append') {
    const existing = await fetchEntries();
    const seen = new Set(existing.map(dedupeKey));
    toInsert = entries.filter((e) => !seen.has(dedupeKey(e)));
  } else {
    // dedupe within the incoming batch itself
    const seen = new Set();
    toInsert = entries.filter((e) => {
      const k = dedupeKey(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const withUser = toInsert.map((e) => ({ ...e, user_id }));
  // Insert in chunks to stay under payload limits.
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < withUser.length; i += CHUNK) {
    const slice = withUser.slice(i, i + CHUNK);
    const { error } = await supabase.from('reps_entries').insert(slice);
    if (error) throw error;
    inserted += slice.length;
  }
  return { inserted, skipped: entries.length - toInsert.length };
}
