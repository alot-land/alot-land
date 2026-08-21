export default function PageHeader({ title, subtitle, right }) {
  return (
    <div className="px-4 sm:px-8 pt-5 sm:pt-8 pb-4 sm:pb-5 border-b border-border">
      <div className="flex items-start sm:items-end justify-between gap-3 sm:gap-6 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] sm:text-[11px] uppercase tracking-widest text-muted">{subtitle}</div>
          <h1 className="font-display text-xl sm:text-3xl mt-1 leading-tight break-words">{title}</h1>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </div>
  );
}
