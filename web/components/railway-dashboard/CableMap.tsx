"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS_LABEL } from "./data";
import { Icon } from "./Icon";
import type { CableDetection } from "./types";
import styles from "./CableMap.module.css";

type CableMapProps = {
  detections: CableDetection[];
  selectedId: string | null;
  isDemo: boolean;
  onSelect: (id: string) => void;
  leafletScriptUrl: string;
};

// Leaflet is bundled in /public to avoid adding a package to the host app.
// Its runtime API is deliberately isolated inside this component.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeafletRuntime = any;

export function CableMap({ detections, selectedId, isDemo, onSelect, leafletScriptUrl }: CableMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletRuntime>(null);
  const markersRef = useRef<LeafletRuntime>(null);
  const networkRef = useRef<LeafletRuntime>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    if (!leafletReady || !elementRef.current || mapRef.current) return;
    const L = (window as typeof window & { L?: LeafletRuntime }).L;
    if (!L) return;

    const map = L.map(elementRef.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      minZoom: 3,
      maxZoom: 19,
    }).setView([-33.941, 18.469], 13);
    mapRef.current = map;
    L.control.zoom({ position: "topright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 90 }).addTo(map);

    let loaded = 0;
    let failed = 0;
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);
    tiles.on("tileload", () => { loaded += 1; setTilesFailed(false); });
    tiles.on("tileerror", () => { failed += 1; if (failed >= 4 && loaded === 0) setTilesFailed(true); });

    const network = L.layerGroup().addTo(map);
    networkRef.current = network;
    markersRef.current = L.layerGroup().addTo(map);

    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(elementRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      networkRef.current = null;
    };
  }, [leafletReady]);

  useEffect(() => {
    const L = (window as typeof window & { L?: LeafletRuntime }).L;
    const map = mapRef.current;
    const markers = markersRef.current;
    const network = networkRef.current;
    if (!L || !map || !markers || !network) return;

    if (isDemo && !map.hasLayer(network)) network.addTo(map);
    if (!isDemo && map.hasLayer(network)) map.removeLayer(network);
    markers.clearLayers();

    detections.forEach((detection) => {
      const isSelected = detection.id === selectedId;
      const marker = L.marker([detection.latitude, detection.longitude], {
        title: `${detection.id}: Damaged cable at ${detection.location}. ${STATUS_LABEL[detection.status]}`,
        keyboard: true,
        zIndexOffset: isSelected ? 1_000 : 0,
        icon: L.divIcon({
          className: `${styles.faultMarker} ${isSelected ? styles.selectedMarker : ""}`,
          html: `<span class="${styles.faultPin}"><span>${detection.status === "resolved" ? "✓" : "!"}</span></span>`,
          iconSize: [35, 35],
          iconAnchor: [17, 31],
          popupAnchor: [0, -32],
        }),
      }).addTo(markers);

      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${detection.id} · Damaged cable`;
      const detail = document.createElement("span");
      detail.textContent = `${detection.location} · ${STATUS_LABEL[detection.status]}`;
      detail.className = styles.popupDetail;
      popup.append(title, detail);
      marker.bindPopup(popup, { closeButton: false, autoPan: false, minWidth: 180 });
      marker.on("click", () => onSelect(detection.id));
      if (isSelected) marker.openPopup();
    });
  }, [detections, isDemo, leafletReady, onSelect, selectedId]);

  const fitAll = useCallback(() => {
    const L = (window as typeof window & { L?: LeafletRuntime }).L;
    const map = mapRef.current;
    if (!L || !map || detections.length === 0) return;
    const bounds = L.latLngBounds(detections.map((detection) => [detection.latitude, detection.longitude]));
    map.fitBounds(bounds.pad(0.13), { padding: [30, 45], maxZoom: detections.length === 1 ? 16 : 14, animate: false });
  }, [detections]);

  useEffect(() => { fitAll(); }, [fitAll, leafletReady]);

  return <div className={styles.wrapper}>
    <Script
      src={leafletScriptUrl}
      strategy="afterInteractive"
      onReady={() => setLeafletReady(true)}
    />
    <div ref={elementRef} className={styles.map} aria-label="Interactive damaged-cable detection map" />
    <button className={styles.fitButton} type="button" onClick={fitAll} aria-label="Fit visible detections" title="Fit visible detections">
      <Icon name="focus" />
    </button>
    <div className={styles.disclaimer}>{isDemo ? "Sample locations · illustrative railway" : "Imported GPS coordinates"}</div>
    <div className={styles.legend}>
      {isDemo && <span><i className={styles.railKey} />Illustrative railway</span>}
      <span><i className={styles.cableKey} />Damaged cable</span>
    </div>
    {tilesFailed && <div className={styles.message}>Street tiles are unavailable. Cable markers remain interactive.</div>}
    {!leafletReady && <div className={styles.loading}>Loading map…</div>}
  </div>;
}
