import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '../lib/org';
import { useAuth } from '../lib/auth';
import { listNotes, addNote, deleteNote } from '../lib/queries';
import { Tip } from './fields';

/** Timestamped, org-shared notes for any entity (parcel or deal). */
export default function NotesCard({ entityType, entityId }) {
  const { org } = useOrg();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const key = ['notes', entityType, entityId];
  const notes = useQuery({
    queryKey: key,
    queryFn: () => listNotes(org.id, entityType, entityId),
    enabled: !!org && !!entityId,
  });

  async function save() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await addNote(org.id, user, entityType, entityId, body);
      setDraft('');
      qc.invalidateQueries({ queryKey: key });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    await deleteNote(id);
    qc.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="card p-4 mt-4">
      <div className="text-sm font-medium mb-2">
        Notes
        <Tip text="Timestamped and shared with your whole org — call outcomes, drive-by impressions, seller conversations. Notes stay attached through data refreshes." />
      </div>
      <div className="flex gap-2">
        <textarea
          className="input text-sm flex-1"
          rows={2}
          placeholder="Add a note — who you talked to, what they said, what's next…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || !draft.trim()}
          className="btn-gold text-sm self-end disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add'}
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {notes.isLoading && <div className="text-muted text-sm">Loading…</div>}
        {notes.data?.length === 0 && <div className="text-muted text-sm">No notes yet.</div>}
        {(notes.data || []).map((n) => (
          <div key={n.id} className="border-t border-border pt-2">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{new Date(n.created_at).toLocaleString()}</span>
              {n.author_email && <span>· {n.author_email}</span>}
              <button
                type="button"
                onClick={() => remove(n.id)}
                className="ml-auto hover:text-danger"
                title="Delete note"
              >
                ✕
              </button>
            </div>
            <div className="text-sm whitespace-pre-wrap mt-0.5">{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
