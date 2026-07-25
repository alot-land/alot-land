/**
 * Three-state parcel rating: ♥ strong (contact first), 👍 has potential,
 * 👎 something's off. Clicking the active icon clears it. Org-shared.
 */
const OPTIONS = [
  ['heart', '♥', 'text-danger', 'Strong — contact first'],
  ['up', '👍', 'text-green-deep', 'Has potential'],
  ['down', '👎', 'text-muted', "Don't like it"],
];

export default function RatingControl({ value, onChange, size = 'text-base' }) {
  return (
    <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {OPTIONS.map(([key, glyph, activeColor, title]) => (
        <button
          key={key}
          type="button"
          title={title}
          aria-label={title}
          onClick={() => onChange(value === key ? null : key)}
          className={`${size} leading-none transition-transform hover:scale-110 ${
            value === key ? activeColor : 'opacity-30 grayscale hover:opacity-70 hover:grayscale-0'
          }`}
        >
          {glyph}
        </button>
      ))}
    </div>
  );
}
