import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { usd } from '../lib/format';

/**
 * Map of on-market leads — Leaflet + OSM raster tiles (same stack as the
 * marketing site's lot maps). Deliberately NOT WebGL: plain <img> tiles and
 * DOM pins render on every machine, including GPUs where WebGL canvases
 * paint blank (observed in the field on macOS Chrome/Brave).
 */
const PIN_COLORS = { active: '#2E8C43', pending: '#B8860B', comingsoon: '#3E6DA3' };

function pinIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer;"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}

export default function ListingsMap({ rows, onAnalyze }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [selected, setSelected] = useState(null);

  // Init once.
  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: [33.45, -112.07],
      zoom: 10,
      zoomControl: true,
    });
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

  // Sync pins with rows.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = rows.filter((d) => d.lat != null && d.lng != null);
    if (!pts.length) return;

    for (const d of pts) {
      L.marker([d.lat, d.lng], {
        icon: pinIcon(PIN_COLORS[d.listing_status] || '#8A8272'),
        title: `${d.address} · ${usd(Number(d.price))}`,
      })
        .on('click', () => setSelected(d))
        .addTo(layer);
    }
    map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), {
      padding: [60, 60],
      maxZoom: 14,
      animate: false,
    });
  }, [rows]);

  // Clear selection when it drops out of the filtered rows.
  useEffect(() => {
    if (selected && !rows.some((r) => r.id === selected.id)) setSelected(null);
  }, [rows, selected]);

  return (
    <div className="relative card overflow-hidden" style={{ height: '70vh' }}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Legend — above Leaflet's panes (z ~1000) */}
      <div
        className="absolute right-3 top-3 bg-surface/95 border border-border rounded-lg px-3 py-2 text-xs shadow"
        style={{ zIndex: 1100 }}
      >
        {[
          ['#2E8C43', 'Active'],
          ['#B8860B', 'Pending'],
          ['#3E6DA3', 'Coming soon'],
          ['#8A8272', 'Unknown'],
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
      </div>

      {selected && (
        // Leaflet's internal panes reach z-index ~1000 — the card must sit above.
        <div className="absolute left-3 bottom-3 w-72 card shadow-xl overflow-hidden" style={{ zIndex: 1100 }}>
          {selected.photo_url ? (
            <img src={selected.photo_url} alt="" className="w-full h-36 object-cover" />
          ) : (
            <div className="w-full h-20 bg-surface-2 flex items-center justify-center text-muted text-xs">
              no photo yet
            </div>
          )}
          <div className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium leading-tight">{selected.address}</div>
                <div className="text-xs text-muted">
                  {[selected.city, selected.state].filter(Boolean).join(', ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-muted hover:text-ink text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2 text-sm">
              <span className="font-semibold tabular-nums">{usd(Number(selected.price))}</span>
              <span className="pill bg-surface-2 text-ink-2">{selected.unit_bucket}u</span>
              {selected.year_built && <span className="text-xs text-muted">{selected.year_built}</span>}
              {selected.beds_total != null && (
                <span className="text-xs text-muted">{selected.beds_total} bd total</span>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => onAnalyze(selected)} className="btn-gold text-sm py-1 flex-1">
                Analyze
              </button>
              {selected.listing_url && (
                <a
                  href={selected.listing_url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost text-sm py-1"
                >
                  Redfin ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
