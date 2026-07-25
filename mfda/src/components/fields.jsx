import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hover/tap info bubble. The bubble is portaled to <body> with fixed
 * positioning so no ancestor's overflow (e.g. a table's overflow-x-auto,
 * which also clips vertical overflow) can hide it. Flips below the trigger
 * when there isn't room above.
 */
export function Tip({ text }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null); // {top, left, placement}

  useLayoutEffect(() => {
    if (!pos || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const W = 256; // w-64
    const margin = 8;
    const above = r.top > 140;
    let left = r.left + r.width / 2 - W / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - W - margin));
    setPos((p) => ({
      ...p,
      left,
      top: above ? r.top - margin : r.bottom + margin,
      placement: above ? 'above' : 'below',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos?.open]);

  if (!text) return null;
  const show = () => setPos({ open: true });
  const hide = () => setPos(null);

  return (
    <span className="inline-block align-middle ml-1">
      <span
        ref={ref}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="cursor-help select-none text-muted border border-border-hi rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] leading-none bg-surface"
        aria-label="What is this?"
      >
        i
      </span>
      {pos &&
        createPortal(
          <span
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left ?? -9999,
              width: 256,
              transform: pos.placement === 'above' ? 'translateY(-100%)' : 'none',
            }}
            className="z-[9999] bg-ink text-bg text-xs font-normal normal-case tracking-normal rounded-lg px-3 py-2 shadow-xl pointer-events-none"
          >
            {text}
          </span>,
          document.body,
        )}
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
