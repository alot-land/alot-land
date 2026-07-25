import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { usd } from '../lib/format';
import { streetViewUrl } from '../lib/parcelscreen';

/**
 * Off-market lead map — Leaflet + OSM (no WebGL, same engine as the other
 * maps). Pin color = screen verdict, so the good ones jump out; ♥-rated
 * parcels get a bigger pin.
 */
const VERDICT_COLORS = {
  pursue: '#2E8C43',
  consider: '#B8860B',
  pass: '#8A8272',
  insufficient: '#3E6DA3',
};

function pinIcon(color, big) {
  const s = big ? 24 : 16;
  return L.divIcon({
    className: '',
    html: `<div style="width:${s}px;height:${s}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer;"></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s],
  });
}

export default function OffMarketMap({ rows, selected, onSelect, onOpen }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    const map = L.map(containerRef.current, { center: [36.16, -86.78], zoom: 11, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  const fitSigRef = useRef(null);
  const lastSelectedRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = rows.filter((p) => p.lat != null && p.lng != null);
    if (!pts.length) return;

    for (const p of pts) {
      L.marker([p.lat, p.lng], {
        icon: pinIcon(VERDICT_COLORS[p.screen?.verdict] || '#8A8272', p.rating === 'heart'),
        title: `${p.situs_address || p.apn} · ${p.owner_name || ''}`,
      })
        .on('click', () => onSelect(p))
        .addTo(layer);
    }
    // Only re-center when something meaningful changed — never reset the
    // user's pan/zoom because a parent re-rendered.
    const sig = pts.map((p) => p.id).join(',');
    const selChanged = (selected?.id ?? null) !== lastSelectedRef.current;
    lastSelectedRef.current = selected?.id ?? null;
    if (selected && selected.lat != null && selChanged) {
      map.setView([selected.lat, selected.lng], Math.max(map.getZoom(), 15), { animate: false });
    } else if (!selected && sig !== fitSigRef.current) {
      map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), {
        padding: [50, 50],
        maxZoom: 14,
        animate: false,
      });
    }
    fitSigRef.current = sig;
  }, [rows, selected, onSelect]);

  const noCoords = rows.length > 0 && rows.every((p) => p.lat == null || p.lng == null);

  return (
    <div className="relative card overflow-hidden" style={{ height: '70vh' }}>
      <div ref={containerRef} className="absolute inset-0" />

      <div
        className="absolute right-3 top-3 bg-surface/95 border border-border rounded-lg px-3 py-2 text-xs shadow"
        style={{ zIndex: 1100 }}
      >
        {[
          ['#2E8C43', 'Pursue'],
          ['#B8860B', 'Consider'],
          ['#8A8272', 'Pass'],
          ['#3E6DA3', 'Needs data'],
        ].map(([c, label]) => (
          <div key={label} className="flex items-center gap-2 py-0.5">
            <span
              style={{
                width: 12, height: 12, background: c, display: 'inline-block',
                borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)',
                border: '1.5px solid #fff', boxShadow: '0 1px 2px rgba(0,0,0,.3)',
              }}
            />
            <span className="text-ink-2">{label}</span>
          </div>
        ))}
        <div className="text-muted mt-1">big pin = ♥ rated</div>
      </div>

      {noCoords && (
        <div
          className="absolute inset-x-0 top-1/3 mx-auto w-fit bg-surface/95 border border-border rounded-lg px-4 py-3 text-sm text-ink-2 shadow"
          style={{ zIndex: 1100 }}
        >
          No coordinates yet — they arrive with the next county data refresh (droplet, ~monthly).
        </div>
      )}

      {selected && (
        <div className="absolute left-3 bottom-3 w-72 card shadow-xl p-3" style={{ zIndex: 1100 }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium leading-tight">{selected.situs_address || `APN ${selected.apn}`}</div>
              <div className="text-xs text-muted">
                {[selected.situs_city, selected.state].filter(Boolean).join(', ')} · {selected.owner_name || '—'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="text-muted hover:text-ink text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2 text-sm">
            {selected.screen?.noi != null && (
              <span className="font-semibold tabular-nums">{usd(selected.screen.noi)} NOI</span>
            )}
            {selected.units != null && <span className="pill bg-surface-2 text-ink-2">{selected.units}u</span>}
            {selected.absentee && <span className="pill bg-gold/20 text-warn">absentee</span>}
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => onOpen(selected)} className="btn-gold text-sm py-1 flex-1">
              Open report
            </button>
            {streetViewUrl(selected) && (
              <a href={streetViewUrl(selected)} target="_blank" rel="noreferrer" className="btn-ghost text-sm py-1">
                Street ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
