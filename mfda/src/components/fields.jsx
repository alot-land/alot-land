import { useState } from 'react';

/** Hover/tap info bubble. Keyboard-focusable; resets the label's uppercase. */
export function Tip({ text }) {
  if (!text) return null;
  return (
    <span className="relative inline-block group align-middle ml-1">
      <span
        tabIndex={0}
        className="cursor-help select-none text-muted border border-border-hi rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] leading-none bg-surface"
        aria-label="What is this?"
      >
        i
      </span>
      <span className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity absolute z-30 left-0 bottom-full mb-1.5 w-64 bg-ink text-bg text-xs font-normal normal-case tracking-normal rounded-lg px-3 py-2 shadow-xl pointer-events-none">
        {text}
      </span>
    </span>
  );
}

export function Field({ label, hint, tip, children }) {
  return (
    <label className="block">
      <span className="label">{label}{tip && <Tip text={tip} />}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1">{hint}</span>}
    </label>
  );
}

export function TextInput({ value, onChange, ...rest }) {
  return <input className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

/** Numeric input storing a raw Number (or null). `scale` lets a % field store a decimal. */
export function NumberInput({ value, onChange, scale = 1, suffix, ...rest }) {
  const shown = value == null ? '' : scale === 1 ? value : +(value * (1 / scale)).toFixed(6);
  return (
    <div className="relative">
      <input
        className="input"
        type="number"
        inputMode="decimal"
        value={shown}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : Number(v) * scale);
        }}
        {...rest}
      />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
    </div>
  );
}

/** Percent field: displays whole percent, stores a decimal (7 → 0.07). */
export function PercentInput({ value, onChange, ...rest }) {
  return <NumberInput value={value} onChange={onChange} scale={0.01} suffix="%" step="0.01" {...rest} />;
}

export function Section({ title, subtitle, tip, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left"
      >
        <span>
          <span className="font-medium">{title}{tip && <Tip text={tip} />}</span>
          {subtitle && <span className="block text-xs text-muted">{subtitle}</span>}
        </span>
        <span className="text-muted">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-5 pb-5 pt-1 border-t border-border">{children}</div>}
    </section>
  );
}

export function Grid({ cols = 3, children }) {
  const map = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' };
  return <div className={`grid grid-cols-1 ${map[cols]} gap-4`}>{children}</div>;
}
