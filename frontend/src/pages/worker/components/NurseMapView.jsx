import React, { useEffect, useRef, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';

// A fixed color palette cycled per assigned nurse, so requests going to the
// same person read as the same color on the map — this is what actually
// makes assignment "sane": the worker can see who's clustered near who
// before deciding, instead of the lat/lng sitting unused in the database.
const PALETTE = ['#0a9396', '#ee9b00', '#ca6702', '#9b2226', '#005f73', '#94d2bd', '#e9d8a6', '#bb3e03'];
const UNASSIGNED_COLOR = '#8a8a8a';

function colorForNurse(nurseId, nurseIdList) {
  if (!nurseId) return UNASSIGNED_COLOR;
  const idx = nurseIdList.indexOf(nurseId);
  return PALETTE[idx % PALETTE.length];
}

// `requests` is expected to already reflect whatever the worker has picked
// in the filter bar (name / preferred date / status) — this component just
// plots that set. It only narrows further to what's actually plottable:
// requests need coordinates. Status filtering (including cancelled/no-show)
// is entirely the filter bar's job now.
export default function NurseMapView({ requests, onSelectRequest, branches = [] }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const branchLayerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const geolocated = useMemo(
    () => requests.filter(r => r.address_lat != null && r.address_lng != null),
    [requests]
  );

  const geolocatedBranches = useMemo(
    () => branches.filter(b => b.lat != null && b.lng != null && !(b.lat === 0 && b.lng === 0)),
    [branches]
  );

  const nurseIdList = useMemo(
    () => [...new Set(geolocated.map(r => r.assigned_nurse_id).filter(Boolean))],
    [geolocated]
  );

  useEffect(() => {
    if (mapInstanceRef.current) return;
    import('leaflet').then((L) => {
      const map = L.map(mapRef.current).setView([36.53167, 2.99194], 12); // Bouinan default, same as MapPicker
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      markersLayerRef.current = L.layerGroup().addTo(map);
      branchLayerRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
      setMapReady(true);
    });
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        setMapReady(false);
      }
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !branchLayerRef.current) return;
    import('leaflet').then((L) => {
      branchLayerRef.current.clearLayers();
      geolocatedBranches.forEach(b => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:22px;height:22px;background:#0d1b2a;border:2px solid white;border-radius:6px;transform:rotate(45deg);box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const marker = L.marker([b.lat, b.lng], { icon, zIndexOffset: 1000 }).addTo(branchLayerRef.current);
        marker.bindTooltip(
          `<strong>${b.name}</strong><br/>${b.address || ''}`,
          { direction: 'top' }
        );
      });
    });
  }, [geolocatedBranches, mapReady]);

  useEffect(() => {
    if (!mapReady || !markersLayerRef.current) return;
    import('leaflet').then((L) => {
      markersLayerRef.current.clearLayers();
      if (geolocated.length === 0 && geolocatedBranches.length === 0) return;

      const bounds = geolocatedBranches.map(b => [b.lat, b.lng]);
      geolocated.forEach(r => {
        const color = colorForNurse(r.assigned_nurse_id, nurseIdList);
        const marker = L.circleMarker([r.address_lat, r.address_lng], {
          radius: 9,
          color: 'white',
          weight: 2,
          fillColor: color,
          fillOpacity: 0.9,
        }).addTo(markersLayerRef.current);

        const label = r.assigned_nurse_name
          ? `${r.assigned_nurse_name}${r.preferred_slot ? ` · ${r.preferred_slot === 'morning' ? 'Matin' : 'Après-midi'}` : ''}`
          : 'Non assignée';
        marker.bindTooltip(
          `<strong>${r.first_name || r.username || 'Client'}</strong><br/>${label}`,
          { direction: 'top' }
        );
        marker.on('click', () => onSelectRequest?.(r));
        bounds.push([r.address_lat, r.address_lng]);
      });

      if (bounds.length > 0) {
        mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    });
  }, [geolocated, nurseIdList, onSelectRequest, mapReady]);

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapPin size={15} color="var(--teal)" />
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {geolocated.length} visite{geolocated.length !== 1 ? 's' : ''} géolocalisée{geolocated.length !== 1 ? 's' : ''}
            {geolocated.length !== requests.length && ` (${requests.length - geolocated.length} sans coordonnées)`}
            {geolocatedBranches.length > 0 && ` · ${geolocatedBranches.length} labo${geolocatedBranches.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      <div ref={mapRef} style={styles.map} />

      {(geolocated.length > 0 || geolocatedBranches.length > 0) && (
        <div style={styles.legend}>
          {geolocatedBranches.length > 0 && (
            <div style={styles.legendItem}>
              <span style={{ ...styles.legendDot, borderRadius: 3, transform: 'rotate(45deg)', background: '#0d1b2a' }} />
              Laboratoire
            </div>
          )}
          {nurseIdList.map(id => {
            const req = geolocated.find(r => r.assigned_nurse_id === id);
            return (
              <div key={id} style={styles.legendItem}>
                <span style={{ ...styles.legendDot, background: colorForNurse(id, nurseIdList) }} />
                {req?.assigned_nurse_name || 'Infirmière'}
              </div>
            );
          })}
          {geolocated.length > 0 && (
            <div style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: UNASSIGNED_COLOR }} />
              Non assignée
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: 10 },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  map: { height: 380, borderRadius: 'var(--radius-md)', border: '1.5px solid var(--border)', overflow: 'hidden' },
  legend: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
};