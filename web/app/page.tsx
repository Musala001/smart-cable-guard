"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Det = { x: number; y: number; w: number; h: number; score: number; cls: number };
type Track = { id: number; cls: number; x: number; y: number; w: number; h: number; hits: number; missed: number; peak: number; logged: boolean };
type Sev = "Critical" | "High" | "Medium";
type Geo = { lat: number; lon: number; acc: number } | null;
type Incident = { id: number; cls: number; sev: Sev; conf: number; ts: number; thumb: string; action: string; areaFrac: number; persist: number; region: string; geo: Geo };
type AI = { cablePresent: string; observation: string; condition: string; concerns: string; verdict: string };
type Hist = { id: string; ts: number; mode: string; total: number; crit: number; high: number; med: number; risk: string; riskColor: string; concerns: boolean; geo: Geo };

const NAMES = ["break", "thunderbolt", "foreign object"];
const SEV_COLOR: Record<Sev, string> = { Critical: "#FF3B3B", High: "#FF8A2F", Medium: "#C99A18" };
const CONFIRM = 2, MAX_MISSED = 8, IOU_MATCH = 0.3;
const HKEY = "cableguard_history_v1";

function iou(a: Track | Det, b: Det) {
  const ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy; const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}
function sevScore(cls: number, conf: number, areaFrac: number) {
  const base = cls === 0 ? 0.45 : cls === 1 ? 0.28 : 0.34;
  return base + 0.35 * conf + 0.2 * Math.min(areaFrac * 6, 1);
}
function sevBucket(s: number): Sev { return s >= 0.78 ? "Critical" : s >= 0.58 ? "High" : "Medium"; }
function regionOf(cy: number) { return cy < 0.34 ? "upper span" : cy < 0.67 ? "mid span" : "lower span"; }
function actionFor(cls: number, sev: Sev) {
  if (cls === 0) return sev === "Critical" ? "Conductor break — de-energize section and dispatch emergency crew."
    : sev === "High" ? "Probable break — schedule urgent inspection; prepare to isolate."
    : "Minor strand damage — log for scheduled maintenance.";
  if (cls === 1) return sev === "Critical" ? "Severe arc damage — inspect insulation/hardware immediately."
    : sev === "High" ? "Arc/lightning damage — inspect hardware; monitor for recurrence."
    : "Surface arc marking — log for scheduled maintenance.";
  return sev === "Critical" ? "Large foreign object on the line — dispatch crew to remove; risk of flashover or mechanical load."
    : sev === "High" ? "Foreign object entangled on conductor — schedule prompt removal."
    : "Minor debris on line — log for routine removal.";
}
function sevDrivers(i: Incident) {
  const d: string[] = [];
  d.push(i.conf >= 0.75 ? "high detection confidence" : i.conf >= 0.5 ? "moderate confidence" : "low confidence");
  if (i.areaFrac >= 0.03) d.push("a large affected area"); else if (i.areaFrac >= 0.01) d.push("a moderate affected area");
  if (i.persist >= 8) d.push("persistence across many frames"); else if (i.persist >= CONFIRM + 1) d.push("confirmation across multiple frames");
  return d;
}
function evidenceText(i: Incident) {
  const p = [`${(i.conf * 100).toFixed(0)}% confidence`, `~${(i.areaFrac * 100).toFixed(1)}% of frame`];
  if (i.persist > 1) p.push(`tracked ${i.persist}+ frames`);
  p.push(i.region);
  if (i.geo) p.push(`${i.geo.lat.toFixed(5)}, ${i.geo.lon.toFixed(5)}`);
  return p.join(" · ");
}
function reasoningText(i: Incident) {
  const base = i.cls === 0 ? "conductor break (strand separation)" : i.cls === 1 ? "arc / lightning (thunderbolt) damage" : "foreign object on the conductor";
  let r = `Classified as ${base}. Rated ${i.sev}, driven by ${sevDrivers(i).join(", ")}.`;
  if (i.conf < 0.5) r += " Confidence is low — flagged for human verification rather than automatic action.";
  return r;
}
function aiHasConcerns(ai: AI | null) {
  if (!ai) return false;
  const c = (ai.concerns || "").toLowerCase().trim();
  return !(!c || c === "none visible" || c === "none" || c === "n/a");
}
function aiUrgent(ai: AI | null) {
  if (!ai) return false;
  return /high urgency|urgent|immediate|severe|critical|poor/.test(((ai.verdict || "") + " " + (ai.condition || "")).toLowerCase());
}
function buildAnalysis(incidents: Incident[], ai: AI | null, ctx: { mode: string; frames: number; dur: string }) {
  const n = incidents.length;
  const crit = incidents.filter(i => i.sev === "Critical").length;
  const high = incidents.filter(i => i.sev === "High").length;
  const med = incidents.filter(i => i.sev === "Medium").length;
  const breaks = incidents.filter(i => i.cls === 0).length;
  const arcs = incidents.filter(i => i.cls === 1).length;
  const objs = incidents.filter(i => i.cls === 2).length;
  const low = incidents.filter(i => i.conf < 0.5).length;
  const noCable = ai?.cablePresent === "no";
  const concerns = aiHasConcerns(ai) && !noCable;
  const urgent = aiUrgent(ai) && !noCable;
  let risk = "No issues identified", riskColor = "#1D9E8B";
  if (crit > 0) { risk = "Elevated — immediate attention required"; riskColor = "#FF3B3B"; }
  else if (urgent && concerns) { risk = "Elevated — visual review flagged urgent concerns"; riskColor = "#FF3B3B"; }
  else if (high > 0) { risk = "Moderate — prioritized inspection advised"; riskColor = "#FF8A2F"; }
  else if (concerns) { risk = "Moderate — visual review identified concerns"; riskColor = "#FF8A2F"; }
  else if (med > 0) { risk = "Low–Moderate — routine maintenance"; riskColor = "#C99A18"; }
  else if (noCable) { risk = "Not applicable — no cable identified in view"; riskColor = "#6B7785"; }
  const order = (s: Sev) => ["Medium", "High", "Critical"].indexOf(s);
  const sorted = [...incidents].sort((a, b) => (order(b.sev) - order(a.sev)) || b.conf - a.conf);
  const narr: string[] = [];
  const scope = ctx.mode === "image" ? "1 image" : `${ctx.frames} frame(s) over ${ctx.dur}`;
  if (noCable) {
    narr.push(`Automated inspection analysed ${scope}. The visual review did not identify a cable or conductor in the frame, so this scan cannot be treated as a valid cable inspection.`);
    if (n > 0) narr.push(`The specialist detector logged ${n} detection${n === 1 ? "" : "s"}, but with no cable confirmed in view these are treated as probable false positives and should not be actioned.`);
  } else {
    narr.push(`Automated inspection analysed ${scope}. The specialist detector logged ${n} finding${n === 1 ? "" : "s"} across its three trained types: ${breaks} conductor break${breaks === 1 ? "" : "s"}, ${arcs} arc-damage finding${arcs === 1 ? "" : "s"}, and ${objs} foreign object${objs === 1 ? "" : "s"}.`);
    if (n > 0) narr.push(`Severity distribution: ${crit} Critical, ${high} High, ${med} Medium.`);
    if (sorted[0] && sorted[0].sev !== "Medium") { const t = sorted[0]; narr.push(`Highest-priority detector finding: ${NAMES[t.cls]} on the ${t.region} at ${(t.conf * 100).toFixed(0)}% confidence, flagged ${t.sev}.`); }
    if (breaks >= 3) narr.push(`Multiple break findings (${breaks}) suggest a recurring or localized mechanical issue rather than an isolated defect.`);
    else if (arcs >= 3) narr.push(`Multiple arc-damage findings (${arcs}) may indicate repeated electrical stress or lightning exposure in this section.`);
    else if (objs >= 3) narr.push(`Multiple foreign objects (${objs}) suggest a recurring debris or encroachment problem along this corridor.`);
    if (n === 0 && concerns) narr.push(`Although the specialist detector found none of its three trained fault types, the vision-model review identified other visible concerns: ${ai!.concerns} These fall outside the detector's scope and should not be dismissed.`);
    else if (n > 0 && concerns) narr.push(`In addition to the detector findings, the vision-model review noted: ${ai!.concerns}`);
    else if (n === 0 && ai && !concerns) narr.push(`The vision-model review also reported no visible concerns, giving two independent sources in agreement.`);
    else if (n === 0 && !ai) narr.push(`No vision-model review was run for this scan. A clear result from the specialist detector alone does not certify the asset as fault-free.`);
    if (low > 0) narr.push(`${low} detector finding${low === 1 ? "" : "s"} fell below 50% confidence and ${low === 1 ? "is" : "are"} flagged for human verification.`);
  }
  const recs: { c: string; t: string }[] = [];
  if (noCable) recs.push({ c: "#6B7785", t: "Re-capture the inspection with the cable clearly in frame; discard this scan's detections." });
  else {
    if (crit > 0) recs.push({ c: "#FF3B3B", t: "Immediate: de-energize affected section(s) and dispatch an emergency crew." });
    if (urgent && concerns) recs.push({ c: "#FF3B3B", t: `Urgent (visual review): ${ai!.verdict || "prioritize on-site inspection of the flagged conditions."}` });
    if (high > 0) recs.push({ c: "#FF8A2F", t: "Urgent: schedule a prioritized on-site inspection of high-severity spans." });
    if (concerns && !urgent) recs.push({ c: "#FF8A2F", t: `Investigate conditions raised by visual review: ${ai!.concerns}` });
    if (med > 0) recs.push({ c: "#C99A18", t: "Routine: add medium-severity findings to the scheduled maintenance cycle." });
    if (n > 0 || concerns) recs.push({ c: "#444", t: "Verify all AI findings on-site before any switching or repair action." });
    if (n === 0 && !concerns) recs.push({ c: "#1D9E8B", t: "No action indicated by this scan. Re-inspect per routine schedule." });
  }
  const caveat = "This assessment combines two independent sources: a specialist detector trained on three fault types (conductor break, arc/thunderbolt damage, and foreign objects), which provides measurable confidence, affected area, position and frame-persistence; and a general vision-model review covering broader visual context outside the detector's training scope. Neither source certifies an asset as fault-free, and all findings require confirmation by a qualified inspector.";
  return { risk, riskColor, crit, high, med, narr, recs, caveat, findings: sorted, noCable, concerns };
}

export default function Page() {
  const [mode, setMode] = useState<"live" | "video" | "image">("live");
  const [running, setRunning] = useState(false);
  const [thresh, setThresh] = useState(0.45);
  const [fps, setFps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [vprog, setVprog] = useState(0);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [utility, setUtility] = useState("Grid Operator");
  const [ai, setAi] = useState<AI | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<Geo>(null);
  const [history, setHistory] = useState<Hist[]>([]);
  const [busyImg, setBusyImg] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const threshRef = useRef(thresh);
  const sendRef = useRef<HTMLCanvasElement | null>(null);
  const cropRef = useRef<HTMLCanvasElement | null>(null);
  const snapRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fpsRef = useRef({ t: 0, n: 0 });
  const busyRef = useRef(false);
  const tracksRef = useRef<Track[]>([]);
  const nextIdRef = useRef(1);
  const incRef = useRef<Incident[]>([]);
  const startRef = useRef(0);
  const framesRef = useRef(0);
  const lastBoxesRef = useRef<any[]>([]);
  const geoRef = useRef<Geo>(null);
  const watchRef = useRef<number | null>(null);

  useEffect(() => { threshRef.current = thresh; }, [thresh]);
  useEffect(() => { geoRef.current = geo; }, [geo]);
  useEffect(() => { try { const raw = localStorage.getItem(HKEY); if (raw) setHistory(JSON.parse(raw)); } catch {} }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      p => setGeo({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );
    return () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current); };
  }, []);

  // send a frame/image to the server detector
  const detect = useCallback(async (src: CanvasImageSource, sw: number, sh: number, maxSide: number) => {
    let c = sendRef.current; if (!c) { c = document.createElement("canvas"); sendRef.current = c; }
    const s = Math.min(maxSide / sw, maxSide / sh, 1);
    c.width = Math.round(sw * s); c.height = Math.round(sh * s);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.75);
    const r = await fetch("/api/detect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, thresh: threshRef.current }),
    });
    if (!r.ok) throw new Error((await r.json()).error || "detect failed");
    const j = await r.json();
    // server boxes are in the scaled image space -> map back to source space
    const back = 1 / s;
    return (j.dets as Det[]).map(d => ({ ...d, x: d.x * back, y: d.y * back, w: d.w * back, h: d.h * back }));
  }, []);

  const makeThumb = useCallback((src: CanvasImageSource, d: any, sw: number, sh: number) => {
    let c = cropRef.current; if (!c) { c = document.createElement("canvas"); c.width = 96; c.height = 96; cropRef.current = c; }
    const g = c.getContext("2d")!; const pad = 0.2;
    let sx = Math.max(0, d.x - d.w * pad), sy = Math.max(0, d.y - d.h * pad);
    let sW = Math.min(sw - sx, d.w * (1 + 2 * pad)), sH = Math.min(sh - sy, d.h * (1 + 2 * pad));
    g.fillStyle = "#05080B"; g.fillRect(0, 0, 96, 96);
    if (sW > 0 && sH > 0) g.drawImage(src, sx, sy, sW, sH, 0, 0, 96, 96);
    return c.toDataURL("image/jpeg", 0.7);
  }, []);

  const logIncident = useCallback((id: number, cls: number, conf: number, box: any, src: CanvasImageSource, sw: number, sh: number, persist: number) => {
    const areaFrac = (box.w * box.h) / (sw * sh);
    const sev = sevBucket(sevScore(cls, conf, areaFrac));
    const inc: Incident = { id, cls, sev, conf, ts: Date.now(), thumb: makeThumb(src, box, sw, sh), action: actionFor(cls, sev), areaFrac, persist, region: regionOf((box.y + box.h / 2) / sh), geo: geoRef.current };
    incRef.current = [inc, ...incRef.current].slice(0, 200);
    setIncidents(incRef.current);
  }, [makeThumb]);

  const track = useCallback((dets: Det[], src: CanvasImageSource, sw: number, sh: number) => {
    const tracks = tracksRef.current;
    tracks.forEach(t => t.missed++);
    const used = new Set<number>();
    dets.sort((a, b) => b.score - a.score);
    for (const det of dets) {
      let best = -1, bi = -1;
      tracks.forEach((t, i) => { if (used.has(i) || t.cls !== det.cls) return; const v = iou(t, det); if (v > IOU_MATCH && v > best) { best = v; bi = i; } });
      if (bi >= 0) {
        const t = tracks[bi]; used.add(bi);
        t.x = det.x; t.y = det.y; t.w = det.w; t.h = det.h; t.hits++; t.missed = 0; t.peak = Math.max(t.peak, det.score);
        if (t.hits >= CONFIRM && !t.logged) { t.logged = true; logIncident(t.id, t.cls, t.peak, t, src, sw, sh, t.hits); }
      } else tracks.push({ id: nextIdRef.current++, cls: det.cls, x: det.x, y: det.y, w: det.w, h: det.h, hits: 1, missed: 0, peak: det.score, logged: false });
    }
    tracksRef.current = tracks.filter(t => t.missed <= MAX_MISSED);
    return tracksRef.current.filter(t => t.hits >= CONFIRM);
  }, [logIncident]);

  const fitCanvas = useCallback(() => {
    const cv = canvasRef.current; if (!cv || !cv.parentElement) return;
    cv.width = cv.parentElement.clientWidth; cv.height = cv.parentElement.clientHeight;
  }, []);

  const draw = useCallback((src: CanvasImageSource, sw: number, sh: number, boxes: any[]) => {
    const cv = canvasRef.current!; const ctx = cv.getContext("2d")!; const cw = cv.width, ch = cv.height;
    const scale = Math.min(cw / sw, ch / sh); const dw = sw * scale, dh = sh * scale, dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    ctx.clearRect(0, 0, cw, ch); ctx.drawImage(src, dx, dy, dw, dh);
    for (const b of boxes) {
      const sev = sevBucket(sevScore(b.cls, b.peak ?? b.score, (b.w * b.h) / (sw * sh))); const col = SEV_COLOR[sev];
      const bx = dx + b.x * scale, by = dy + b.y * scale, bw = b.w * scale, bh = b.h * scale;
      ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.strokeRect(bx, by, bw, bh);
      const label = `${NAMES[b.cls]} · ${sev} ${((b.peak ?? b.score) * 100).toFixed(0)}%`;
      ctx.font = "600 13px 'Space Grotesk', sans-serif"; const tw = ctx.measureText(label).width;
      ctx.fillStyle = col; ctx.fillRect(bx - 1.25, by - 20, tw + 12, 20);
      ctx.fillStyle = "#0a0a0a"; ctx.fillText(label, bx + 5, by - 6);
    }
  }, []);

  const loop = useCallback(async () => {
    if (!runningRef.current) return;
    const v = videoRef.current!;
    if (v.readyState >= 2) {
      draw(v, v.videoWidth, v.videoHeight, lastBoxesRef.current);
      if (!busyRef.current) {
        busyRef.current = true;
        (async () => {
          try {
            const dets = await detect(v, v.videoWidth, v.videoHeight, 512);
            const boxes = track(dets, v, v.videoWidth, v.videoHeight);
            lastBoxesRef.current = boxes.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, cls: b.cls, peak: b.peak }));
            framesRef.current++;
            const fr = fpsRef.current; fr.n++; const now = performance.now();
            if (now - fr.t >= 1000) { setFps(Math.round((fr.n * 1000) / (now - fr.t))); fr.n = 0; fr.t = now; setElapsed(Math.round((Date.now() - startRef.current) / 1000)); if (v.duration) setVprog(v.currentTime / v.duration); }
          } catch {}
          busyRef.current = false;
        })();
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [detect, track, draw]);

  const grabFrame = useCallback(() => {
    let c = snapRef.current; if (!c) { c = document.createElement("canvas"); snapRef.current = c; }
    const g = c.getContext("2d")!;
    if (mode === "image" && imgRef.current) {
      const im = imgRef.current; const s = Math.min(1024 / im.naturalWidth, 1024 / im.naturalHeight, 1);
      c.width = im.naturalWidth * s; c.height = im.naturalHeight * s;
      g.drawImage(im, 0, 0, c.width, c.height);
    } else {
      const v = videoRef.current!; if (!v.videoWidth) return null;
      const s = Math.min(1024 / v.videoWidth, 1024 / v.videoHeight, 1);
      c.width = v.videoWidth * s; c.height = v.videoHeight * s;
      g.drawImage(v, 0, 0, c.width, c.height);
    }
    return c.toDataURL("image/jpeg", 0.85);
  }, [mode]);

  const runAI = useCallback(async () => {
    const image = grabFrame(); if (!image) { setAiErr("No frame to analyse."); return; }
    setAiBusy(true); setAiErr(null); setAi(null);
    const f = incRef.current.length ? incRef.current.slice(0, 5).map(i => `${NAMES[i.cls]} (${(i.conf * 100).toFixed(0)}%)`).join(", ") : "no faults detected";
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, findings: f }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "failed");
      setAi(d);
    } catch (e: any) { setAiErr(e?.message || "AI analysis failed."); }
    setAiBusy(false);
  }, [grabFrame]);

  const saveHistory = useCallback((incs: Incident[], aiv: AI | null, m: string) => {
    if (incs.length === 0 && !aiv) return;
    const A = buildAnalysis(incs, aiv, { mode: m, frames: framesRef.current, dur: "" });
    const h: Hist = { id: `${Date.now()}`, ts: Date.now(), mode: m, total: incs.length, crit: A.crit, high: A.high, med: A.med, risk: A.risk, riskColor: A.riskColor, concerns: A.concerns, geo: geoRef.current };
    setHistory(prev => { const next = [h, ...prev].slice(0, 40); try { localStorage.setItem(HKEY, JSON.stringify(next)); } catch {} return next; });
  }, []);

  const resetScan = useCallback(() => {
    tracksRef.current = []; incRef.current = []; setIncidents([]); framesRef.current = 0; setElapsed(0); setVprog(0);
    setAi(null); setAiErr(null); lastBoxesRef.current = [];
    const cv = canvasRef.current; if (cv) cv.getContext("2d")!.clearRect(0, 0, cv.width, cv.height);
  }, []);

  const startCam = useCallback(async () => {
    setErr(null); resetScan();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      streamRef.current = s; const v = videoRef.current!; v.srcObject = s; v.src = ""; await v.play();
      fitCanvas(); fpsRef.current = { t: performance.now(), n: 0 }; startRef.current = Date.now();
      runningRef.current = true; setRunning(true); loop();
    } catch { setErr("Camera blocked or unavailable. Allow access, or use Video/Image."); }
  }, [fitCanvas, loop, resetScan]);

  const stopCam = useCallback((save = true) => {
    if (runningRef.current && save) saveHistory(incRef.current, ai, mode);
    runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    const v = videoRef.current; if (v) { v.pause(); if (v.src) { v.removeAttribute("src"); v.load(); } }
  }, [saveHistory, ai, mode]);

  const onVideo = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    stopCam(false); resetScan(); setErr(null);
    const v = videoRef.current!; v.srcObject = null; v.src = URL.createObjectURL(file); v.muted = true;
    v.onloadeddata = async () => { fitCanvas(); fpsRef.current = { t: performance.now(), n: 0 }; startRef.current = Date.now(); runningRef.current = true; setRunning(true); await v.play(); loop(); };
    v.onended = () => { runningRef.current = false; setRunning(false); cancelAnimationFrame(rafRef.current); setVprog(1); saveHistory(incRef.current, null, "video"); setTimeout(() => setShowReport(true), 400); };
  }, [stopCam, resetScan, fitCanvas, loop, saveHistory]);

  const onImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    stopCam(false); resetScan(); setErr(null); setBusyImg(true);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      requestAnimationFrame(async () => {
        fitCanvas();
        draw(img, img.naturalWidth, img.naturalHeight, []);
        try {
          const dets = await detect(img, img.naturalWidth, img.naturalHeight, 1280);
          draw(img, img.naturalWidth, img.naturalHeight, dets);
          dets.forEach((d, i) => logIncident(1000 + i, d.cls, d.score, d, img, img.naturalWidth, img.naturalHeight, 1));
          saveHistory(incRef.current, null, "image");
        } catch (e: any) { setErr(e?.message || "Detection failed."); }
        setBusyImg(false);
      });
    };
    img.src = URL.createObjectURL(file);
  }, [stopCam, resetScan, fitCanvas, detect, draw, logIncident, saveHistory]);

  const exportData = useCallback((fmt: "json" | "csv") => {
    const rows = incRef.current;
    let blob: Blob, name: string;
    if (fmt === "json") {
      blob = new Blob([JSON.stringify({ operator: utility, generated: new Date().toISOString(), mode, frames: framesRef.current, visionReview: ai, incidents: rows.map(({ thumb, ...r }) => r) }, null, 2)], { type: "application/json" });
      name = `cable-inspection-${Date.now()}.json`;
    } else {
      const head = "id,type,severity,confidence,timestamp,region,area_pct,persisted_frames,latitude,longitude,action";
      const body = rows.map(r => [r.id, NAMES[r.cls], r.sev, (r.conf * 100).toFixed(1), new Date(r.ts).toISOString(), r.region, (r.areaFrac * 100).toFixed(2), r.persist, r.geo?.lat ?? "", r.geo?.lon ?? "", `"${r.action.replace(/"/g, "'")}"`].join(",")).join("\n");
      blob = new Blob([head + "\n" + body], { type: "text/csv" });
      name = `cable-inspection-${Date.now()}.csv`;
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }, [utility, mode, ai]);

  useEffect(() => { fitCanvas(); }, [mode, fitCanvas]);
  useEffect(() => { const r = () => fitCanvas(); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [fitCanvas]);
  useEffect(() => () => { runningRef.current = false; if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); }, []);

  function switchMode(m: "live" | "video" | "image") { if (m === mode) return; stopCam(false); resetScan(); imgRef.current = null; setMode(m); }
  function clearHistory() { setHistory([]); try { localStorage.removeItem(HKEY); } catch {} }

  const counts = { Critical: 0, High: 0, Medium: 0 } as Record<Sev, number>;
  incidents.forEach(i => counts[i.sev]++);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0"), ss = String(elapsed % 60).padStart(2, "0");
  const A = showReport ? buildAnalysis(incidents, ai, { mode, frames: framesRef.current || (mode === "image" ? 1 : 0), dur: `${mm}:${ss}` }) : null;
  const falsePos = ai && ai.cablePresent === "no" && incidents.length > 0;
  const aiTag = ai ? (ai.cablePresent === "yes" ? { t: "Cable confirmed", c: "#35E0C4" } : ai.cablePresent === "no" ? { t: "No cable seen", c: "#FF5A3C" } : { t: "Unclear view", c: "#C99A18" }) : null;
  const sideConcern = aiHasConcerns(ai) && ai?.cablePresent !== "no";

  return (
    <div className="wrap">
      <header className="hdr">
        <div className="brand">
          <div className="mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#04120F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg></div>
          <div><h1>Cable-Guard</h1><span>AI cable inspection &amp; fault triage</span></div>
        </div>
        <div className="hstat">
          <span className={"gps" + (geo ? " on" : "")} title={geo ? `±${geo.acc.toFixed(0)}m` : "No location"}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>
            {geo ? "GPS" : "—"}
          </span>
          <span className="prov">server</span>
          <span className={"live" + (running ? " on" : "")}><i />{running ? "SCANNING" : "IDLE"}</span>
        </div>
      </header>

      <main className="main">
        <div className="stagewrap">
          <div className="stage">
            <canvas ref={canvasRef} />
            {mode === "live" && !running && !err && <div className="overlay"><button className="cta" onClick={startCam}>Start scan</button><p>Point the camera along a cable to inspect for breaks, arc faults and foreign objects.</p></div>}
            {mode === "video" && !running && incidents.length === 0 && !ai && !err && <div className="overlay"><label className="cta">Upload footage<input type="file" accept="video/*" hidden onChange={onVideo} /></label><p>Upload a recorded line-scan to auto-generate an inspection report.</p></div>}
            {mode === "image" && !imgRef.current && !err && <div className="overlay"><label className="cta">Choose image<input type="file" accept="image/*" hidden onChange={onImage} /></label><p>Analyse a single still image at full resolution.</p></div>}
            {busyImg && <div className="overlay"><div className="spin" /><p>Analysing image…</p></div>}
            {err && <div className="overlay err"><p>{err}</p></div>}
            <video ref={videoRef} playsInline muted style={{ display: "none" }} />
          </div>
          {mode === "video" && <div className="vbar"><i style={{ width: `${vprog * 100}%` }} /></div>}
        </div>

        <aside className="side">
          <div className="seg">
            <button className={mode === "live" ? "on" : ""} onClick={() => switchMode("live")}>Live</button>
            <button className={mode === "video" ? "on" : ""} onClick={() => switchMode("video")}>Video</button>
            <button className={mode === "image" ? "on" : ""} onClick={() => switchMode("image")}>Image</button>
          </div>

          <div className="ctl">
            {mode === "live" && (running ? <button className="btn stop" onClick={() => stopCam(true)}>Stop scan</button> : <button className="btn go" onClick={startCam}>Start scan</button>)}
            {mode === "video" && (running ? <button className="btn stop" onClick={() => stopCam(true)}>Stop</button> : <label className="btn go">Upload footage<input type="file" accept="video/*" hidden onChange={onVideo} /></label>)}
            {mode === "image" && <label className="btn go">Choose image<input type="file" accept="image/*" hidden onChange={onImage} /></label>}
            <button className="btn ghost" onClick={() => setShowReport(true)} disabled={incidents.length === 0 && !ai} style={{ flex: "0 0 auto", minWidth: 88 }}>Report</button>
          </div>

          <button className="btn ghost" onClick={runAI} disabled={aiBusy} style={{ width: "100%" }}>
            {aiBusy ? "Analysing…" : "AI Analysis"}
          </button>

          <div className="stats">
            <div className="stat"><span className="k">Engine</span><span className="v" style={{ fontSize: ".92rem", textTransform: "uppercase" }}>server</span></div>
            <div className="stat"><span className="k">{mode === "image" ? "Faults" : "FPS"}</span><span className="v">{mode === "image" ? incidents.length : (running ? fps : "—")}</span></div>
            <div className="stat"><span className="k">Duration</span><span className="v">{mode === "image" ? "—" : `${mm}:${ss}`}</span></div>
          </div>

          <div className="sevbar">
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.Critical }}><div className="n">{counts.Critical}</div><div className="l">Critical</div></div>
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.High }}><div className="n">{counts.High}</div><div className="l">High</div></div>
            <div className="sv" style={{ ["--c" as any]: SEV_COLOR.Medium }}><div className="n">{counts.Medium}</div><div className="l">Medium</div></div>
          </div>

          {(ai || aiBusy || aiErr) && (
            <div className="aibox">
              <div className="aihead">
                <span className="t">Vision-model review</span>
                {aiTag && <span className="aitag" style={{ background: aiTag.c }}>{aiTag.t}</span>}
              </div>
              {aiBusy && <div className="aispin"><i />Reviewing the frame…</div>}
              {aiErr && <div className="aiwarn">{aiErr}</div>}
              {ai && !aiBusy && (
                <div className="aibody">
                  {ai.observation}
                  {sideConcern && (<><b>Concerns</b>{ai.concerns}</>)}
                  {sideConcern && incidents.length === 0 && <div className="aiwarn">Detector found none of its three trained fault types, but the visual review raised concerns above — see report.</div>}
                  {falsePos && <div className="aiwarn">No cable identified in view — the {incidents.length} logged detection(s) are likely false positives.</div>}
                </div>
              )}
            </div>
          )}

          <div className="thr">
            <div className="thrhead"><span>Sensitivity</span><span>{thresh.toFixed(2)}</span></div>
            <input type="range" min="0.1" max="0.9" step="0.05" value={thresh} onChange={e => setThresh(parseFloat(e.target.value))} />
          </div>

          <div className="ctl">
            <button className="btn ghost sm" onClick={() => exportData("csv")} disabled={incidents.length === 0}>Export CSV</button>
            <button className="btn ghost sm" onClick={() => exportData("json")} disabled={incidents.length === 0 && !ai}>Export JSON</button>
          </div>

          <div className="feed">
            <h4><span>Incident log</span><span>{incidents.length}</span></h4>
            <div className="feedscroll">
              {incidents.length === 0 ? <p className="none">No detector faults logged.</p>
                : incidents.map(i => (
                  <div className="inc" key={i.id}>
                    <img src={i.thumb} alt="" />
                    <div className="body">
                      <div className="top"><span className="ty">{NAMES[i.cls]}</span><span className="chip" style={{ background: SEV_COLOR[i.sev] }}>{i.sev}</span></div>
                      <div className="act">{i.action}</div>
                    </div>
                    <span className="cf">{(i.conf * 100).toFixed(0)}%</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="hist">
            <h4><span>Inspection history ({history.length})</span>{history.length > 0 && <button onClick={clearHistory}>Clear</button>}</h4>
            <div className="histscroll">
              {history.length === 0 ? <p className="none">No saved inspections yet.</p>
                : history.map(h => (
                  <div className="hrow" key={h.id} title={h.risk}>
                    <span className="hd" style={{ background: h.riskColor }} />
                    <span className="hm">{new Date(h.ts).toLocaleString()} · {h.mode}{h.geo ? " · GPS" : ""}</span>
                    <span className="hn">{h.total}</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="foot">YOLO26m · 3 classes · mAP50 0.884 · server inference + vision review</div>
        </aside>
      </main>

      {showReport && A && (
        <div className="report" onClick={e => { if (e.target === e.currentTarget) setShowReport(false); }}>
          <div className="reportsheet">
            <h2>Cable Inspection Report</h2>
            <p className="sub">Generated by Cable-Guard — specialist detector + vision-model review</p>
            <div className="rmeta">
              <span>Operator: <input value={utility} onChange={e => setUtility(e.target.value)} /></span>
              <span>Date: {new Date().toLocaleString()}</span>
              {mode !== "image" && <span>Scan duration: {mm}:{ss}</span>}
              <span>Frames analysed: {framesRef.current || (mode === "image" ? 1 : 0)}</span>
              {geo && <span>Location: {geo.lat.toFixed(5)}, {geo.lon.toFixed(5)} (±{geo.acc.toFixed(0)}m)</span>}
            </div>

            <div className="rsum">
              <div className="c"><div className="n">{incidents.length}</div><div className="l">Detector faults</div></div>
              <div className="c"><div className="n" style={{ color: SEV_COLOR.Critical }}>{A.crit}</div><div className="l">Critical</div></div>
              <div className="c"><div className="n" style={{ color: SEV_COLOR.High }}>{A.high}</div><div className="l">High</div></div>
              <div className="c"><div className="n" style={{ color: A.concerns ? "#FF8A2F" : "#1D9E8B" }}>{A.concerns ? "Yes" : ai ? "No" : "—"}</div><div className="l">Visual concerns</div></div>
            </div>

            <div className="rrisk" style={{ background: A.riskColor }}><span className="rl">Risk level</span><span className="rt">{A.risk}</span></div>

            {ai && (
              <div className="rsection">
                <h3>Vision-model review</h3>
                <div className="rai">
                  <span className="rl">Independent visual assessment</span>
                  <p>{ai.observation}</p>
                  {ai.condition && (<><b>Condition</b><p>{ai.condition}</p></>)}
                  {ai.concerns && (<><b>Additional concerns</b><p>{ai.concerns}</p></>)}
                  {ai.verdict && (<><b>Verdict</b><p>{ai.verdict}</p></>)}
                  {A.noCable && <div className="fp">No cable was identified in the reviewed frame — detector findings are likely false positives and should not be actioned.</div>}
                  {A.concerns && incidents.length === 0 && <div className="fp">Note: the specialist detector reported zero faults, but this review identified concerns outside its three trained fault types. A nil detector result does not mean the asset is healthy.</div>}
                </div>
              </div>
            )}

            <div className="rsection">
              <h3>Combined assessment</h3>
              <div className="rnarr">
                {A.narr.map((p, i) => <p key={i}>{p}</p>)}
                <p className="caveat">{A.caveat}</p>
              </div>
            </div>

            <div className="rsection">
              <h3>Prioritized recommendations</h3>
              <ul className="rrecs">{A.recs.map((r, i) => <li key={i} style={{ ["--rc" as any]: r.c }}>{r.t}</li>)}</ul>
            </div>

            <div className="rsection">
              <h3>Detector findings ({A.findings.length})</h3>
              {A.findings.length === 0 ? <p style={{ color: "#777", fontSize: ".86rem" }}>The specialist detector logged no faults of its three trained types in this scan.</p>
                : A.findings.map(i => (
                  <div className="finding" key={i.id}>
                    <img src={i.thumb} alt="" />
                    <div className="fb">
                      <div className="fh"><span className="ft">{NAMES[i.cls]}</span><span className="rchip" style={{ background: SEV_COLOR[i.sev] }}>{i.sev}</span>{i.conf < 0.5 && <span className="vtag">Verify</span>}</div>
                      <p className="fev">{evidenceText(i)}</p>
                      <p className="fr">{reasoningText(i)}</p>
                      <div className="fa"><b>Recommended action</b>{i.action}</div>
                    </div>
                  </div>
                ))}
            </div>

            <div className="rbtns">
              <button className="close" onClick={() => setShowReport(false)}>Close</button>
              <button className="exp" onClick={() => exportData("csv")}>Export CSV</button>
              <button className="print" onClick={() => window.print()}>Print / Save PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
