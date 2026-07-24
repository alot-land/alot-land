import { useQueryClient } from '@tanstack/react-query';
import { setDealFavorite } from '../lib/queries';

/** Org-wide favorite toggle for a deal. Optimistic; syncs every deal list. */
export default function HeartButton({ deal, className = '', size = 'text-lg' }) {
  const qc = useQueryClient();

  async function toggle(e) {
    e.preventDefault();
    e.stopPropagation();
    const next = !deal.favorite;
    // Optimistically flip it everywhere it's cached.
    qc.setQueriesData({ queryKey: ['deals'] }, (old) =>
      old?.map?.((d) => (d.id === deal.id ? { ...d, favorite: next } : d)),
    );
    qc.setQueriesData({ queryKey: ['deal', deal.id] }, (old) => (old ? { ...old, favorite: next } : old));
    try {
      await setDealFavorite(deal.id, next);
    } catch {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', deal.id] });
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={deal.favorite ? 'Remove heart' : 'Heart this deal'}
      title={deal.favorite ? 'Remove heart' : 'Heart this deal'}
      className={`${size} leading-none transition-transform hover:scale-110 ${
        deal.favorite ? 'text-[#C0392B]' : 'text-muted hover:text-[#C0392B]'
      } ${className}`}
    >
      {deal.favorite ? '♥' : '♡'}
    </button>
  );
}
