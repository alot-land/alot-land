import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * US market map — Leaflet + OSM (no WebGL, same engine as ListingsMap).
 * Counties render as circles: color = score (red→gold→green), radius =
 * population. All numbers arrive pre-computed from mf-calc via the page.
 */
export function scoreColor(score) {
  // 0 → red (hue 4), 50 → gold (hue 45), 100 → green (hue 130)
  const hue = score < 50 ? 4 + (score / 50) * 41 : 45 + ((score - 50) / 50) * 85;
  return `hsl(${Math.round(hue)} 62% 42%)`;
}

export default function MarketsMap({ markets, selectedId, onSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    const map = L.map(containerRef.current, { center: [39.5, -96.5], zoom: 4, zoomControl: true });
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

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const m of markets) {
      if (m.lat == null || m.lng == null) continue;
      const pop = m.population || 20000;
      const radius = Math.max(4, Math.min(18, Math.sqrt(pop) / 90));
      const selected = m.geo_id === selectedId;
      L.circleMarker([m.lat, m.lng], {
        radius: selected ? radius + 3 : radius,
        color: selected ? '#1F2937' : '#ffffff',
        weight: selected ? 2.5 : 1,
        fillColor: scoreColor(m.score),
        fillOpacity: 0.82,
      })
        .bindTooltip(`${m.name}, ${m.state} — ${Math.round(m.score)}`, { direction: 'top' })
        .on('click', () => onSelect(m))
        .addTo(layer);
    }
  }, [markets, selectedId, onSelect]);

  return (
    <div className="relative card overflow-hidden" style={{ height: '62vh' }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div
        className="absolute right-3 top-3 bg-surface/95 border border-border rounded-lg px-3 py-2 text-xs shadow"
        style={{ zIndex: 1100 }}
      >
        <div className="font-medium mb-1">Score</div>
        {[
          [90, '90+ excellent'],
          [70, '70s strong'],
          [50, '50s middling'],
          [25, 'below 40 weak'],
        ].map(([v, label]) => (
          <div key={label} className="flex items-center gap-2 py-0.5">
            <span style={{ width: 12, height: 12, borderRadius: '50%', display: 'inline-block', background: scoreColor(v) }} />
            <span className="text-ink-2">{label}</span>
          </div>
        ))}
        <div className="text-muted mt-1">circle size = population</div>
      </div>
    </div>
  );
}
