'use strict';
/* ═══════════════════════════════════════
   CONSTANTES
═══════════════════════════════════════ */
const UTC_OFFSET = -6;
const DISPLAY_OFFSET = UTC_OFFSET; // siempre UTC-6
const VM_TF      = '15m';
const VM_TF_MS   = 15 * 60 * 1000;

const TF_MS = {
  '1m':  60000,        '3m':  180000,       '5m':  300000,
  '6m':  360000,       '9m':  540000,       '15m': 900000,
  '30m': 1800000,      '1h':  3600000,      '2h':  7200000,
  '3h':  10800000,     '4h':  14400000,     '6h':  21600000,
  '8h':  28800000,     '9h':  32400000,     '12h': 43200000,
  '1d':  86400000,     '3d':  259200000,    '6d':  518400000,
  '9d':  777600000,    '1w':  604800000,
};

/* Mapa de temporalidades no soportadas por Binance → equivalente más cercano */
const TF_BINANCE = {
  '6m': '3m', '9m': '3m',
  '9h': '1h',
  '6d': '1d', '9d': '1d',
};
const TF_AGG = { '6m': 2, '9m': 3, '9h': 9, '6d': 6, '9d': 9 };

/* Modo de gráfico: 'session' | '1m' | '3m' | ... */
let chartMode   = '1h';
let activeTF    = '1h';
let activeTF_MS = TF_MS['1h'];

/* ═══════════════════════════════════════
   SESIONES — DEFAULTS
═══════════════════════════════════════ */
const SESS_DEFAULTS = [
  { key:'sydney',   name:'Sydney',      color:'#38bdf8', colorBright:'#7dd3fc', startUtcH:23, endUtcH:31, solapStart:23, solapEnd:24, enabled:true },
  { key:'tokyo',    name:'Tokio',       color:'#f59e0b', colorBright:'#fcd34d', startUtcH:0,  endUtcH:9,  solapStart:0,  solapEnd:9,  enabled:true },
  { key:'london',   name:'Londres',     color:'#c084fc', colorBright:'#e879f9', startUtcH:7,  endUtcH:16, solapStart:9,  solapEnd:12, enabled:true },
  { key:'newyork',  name:'New York',    color:'#10b981', colorBright:'#34d399', startUtcH:12, endUtcH:21, solapStart:16, solapEnd:21, enabled:true },
  { key:'nomarket', name:'Sin mercado', color:'#3a3f47', colorBright:'#5a6272', startUtcH:21, endUtcH:23, solapStart:21, solapEnd:23, enabled:true },
];

let VM_SESSIONS = SESS_DEFAULTS.map(s => ({ ...s }));
let sessConfig  = SESS_DEFAULTS.map(s => ({ ...s }));

/* ═══════════════════════════════════════
   ESTADO
═══════════════════════════════════════ */
let symbol     = 'BTCUSDT';
let daysCount  = 30;
let rawCandles = [];
let candles    = [];
let camX       = -1;
let snapToEnd  = true;
let zoomLevel  = 1.0;
let isDragging = false, dragStartX = 0, dragStartCamX = 0;
let mouseX = -1, mouseY = -1;
let lastPrice  = 0;
let rulerMode  = false, rulerActive = false, rulerLocked = false;
let rulerStartX = -1, rulerStartY = -1, rulerEndX = -1, rulerEndY = -1;
let rulerStartIdx = -1, rulerEndIdx = -1;

// Panel de indicadores — altura ajustable con drag
let panelHeightRatio = 0.28;   // porcentaje de la altura total
const PANEL_H_MIN    = 80;     // px mínimo por panel
const PANEL_H_MAX    = 400;    // px máximo por panel
let isPanelResizing  = false;
let panelResizeStartY = 0, panelResizeStartRatio = 0;

let wsLastMsg = 0;

/* ═══════════════════════════════════════
   DOM
═══════════════════════════════════════ */
const cv      = document.getElementById('cv');
const ctx     = cv.getContext('2d');
const wrap    = document.getElementById('chart-wrap');
const loading = document.getElementById('loading');
const errEl   = document.getElementById('err');
const wsDot   = document.getElementById('ws-dot');
const wsLbl   = document.getElementById('ws-label');
const rulerBtn = document.getElementById('ruler-btn');

/* ═══════════════════════════════════════
   FORMATTERS
═══════════════════════════════════════ */
function fmtPrice(v) {
  if (v >= 10000) return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (v >= 100)   return v.toFixed(2);
  if (v >= 1)     return v.toFixed(4);
  return v.toFixed(6);
}
function fmtVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}
function tsToLocal(ts) { return new Date(ts + DISPLAY_OFFSET * 3600000); }
function dayKey(ts) {
  const d = tsToLocal(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function tvLabel(ts) {
  const d = tsToLocal(ts);
  const mo = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mo}, ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
let _prevLabelDay = '';
function axisLabel(ts) {
  const d  = tsToLocal(ts);
  const mo = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getUTCMonth()];
  const dk = dayKey(ts);
  if (dk !== _prevLabelDay) { _prevLabelDay = dk; return `${d.getUTCDate()} ${mo}`; }
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
function nowStr() {
  const d = tsToLocal(Date.now());
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')}`;
}

function flashPrice(newP) {
  const el = document.getElementById('cur-price');
  const cls = newP > lastPrice ? 'flash-up' : newP < lastPrice ? 'flash-dn' : '';
  if (cls) { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 280); }
  lastPrice = newP;
  el.textContent = fmtPrice(newP);
}

/* ═══════════════════════════════════════
   SESIONES: SEGMENTOS
═══════════════════════════════════════ */
function normEndH(startH, endH) {
  if (endH <= startH) return endH + 24;
  return endH;
}

function buildSegments() {
  const sessRanges = VM_SESSIONS.map(s => {
    const startH = s.startUtcH % 24;
    const rawEnd = s.endUtcH   % 24;
    const endH   = rawEnd <= startH ? rawEnd + 24 : rawEnd;
    return { sess: s, startH, endH };
  });

  const sessRangesExt = sessRanges.map(r => {
    let sh = r.startH;
    if (sh < 21) sh += 24;
    const eh = sh + (r.endH - r.startH);
    return { sess: r.sess, startH: sh, endH: eh, shifted: sh !== r.startH };
  });

  const cuts = new Set();
  for (const r of sessRangesExt) { cuts.add(r.startH); cuts.add(r.endH); }
  const sorted = Array.from(cuts).sort((a, b) => a - b);

  const segments = [];
  const seenKeys = new Set();

  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i];
    const segEnd   = sorted[i + 1];
    const mid      = (segStart + segEnd) / 2;

    const covering = sessRangesExt.filter(r => mid >= r.startH && mid < r.endH);
    if (!covering.length) continue;

    const normStart = segStart >= 24 ? segStart - 24 : segStart;
    const normEnd   = segEnd   >= 24 ? segEnd   - 24 : segEnd;
    const finalEnd  = normEnd <= normStart ? normEnd + 24 : normEnd;

    const dedupeKey = `${normStart}-${finalEnd}-${covering.map(r=>r.sess.key).sort().join('/')}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    if (covering.length === 1) {
      const s = covering[0].sess;
      segments.push({ startH: normStart, endH: finalEnd, sessionKey: s.key, sessionName: s.name, color: s.color, isSolape: false });
    } else {
      const latest = covering.reduce((best, r) => {
        const rS = r.shifted ? r.startH - 24 : r.startH;
        const bS = best.shifted ? best.startH - 24 : best.startH;
        return rS > bS ? r : best;
      }, covering[0]);
      const s = latest.sess;
      const names = [...new Set(covering.map(r => r.sess.name))].join('/');
      segments.push({ startH: normStart, endH: finalEnd, sessionKey: s.key+'_solap', sessionName: names, color: s.colorBright, isSolape: true });
    }
  }
  return segments;
}

/* ═══════════════════════════════════════
   CONSTRUIR VELAS DE SESIÓN
═══════════════════════════════════════ */
function buildSessionCandles() {
  if (!rawCandles.length) { candles = []; return; }
  const DAY_MS   = 86400000;
  const result   = [];
  const segments = buildSegments();
  const firstTs  = rawCandles[0].t;
  const lastTs   = rawCandles[rawCandles.length - 1].t;
  const firstDay = Math.floor(firstTs / DAY_MS) - 1;
  const lastDay  = Math.floor(lastTs  / DAY_MS) + 1;
  const assigned = new Set();

  for (let dayOrd = firstDay; dayOrd <= lastDay; dayOrd++) {
    const dayStart = dayOrd * DAY_MS;
    for (const seg of segments) {
      const segStartMs = dayStart + seg.startH * 3600000;
      const segEndMs   = dayStart + seg.endH   * 3600000;
      if (segEndMs < firstTs || segStartMs > lastTs + VM_TF_MS) continue;

      const bucket = rawCandles.filter(c => c.t >= segStartMs && c.t < segEndMs && !assigned.has(c.t));

      if (!bucket.length) {
        if (seg.sessionKey === 'nomarket') {
          const prevCandle = rawCandles.filter(c => c.t < segStartMs).slice(-1)[0];
          const nextCandle = rawCandles.find(c => c.t >= segEndMs);
          if (!prevCandle) continue;
          const p = prevCandle.c;
          const pClose = nextCandle ? nextCandle.o : p;
          result.push({
            t: segStartMs, tClose: segEndMs,
            tHigh: segStartMs, tLow: segStartMs,
            o: p, h: Math.max(p, pClose), l: Math.min(p, pClose), c: pClose,
            v: 0,
            closed: true,
            color: seg.color, sessionName: seg.sessionName,
            sessionKey: seg.sessionKey, isSolape: false,
            count: 0, isNoMarket: true,
          });
        }
        continue;
      }

      bucket.forEach(c => assigned.add(c.t));

      const hMax = bucket.reduce((b, c) => c.h > b.h ? c : b, bucket[0]);
      const lMin = bucket.reduce((b, c) => c.l < b.l ? c : b, bucket[0]);

      result.push({
        t: bucket[0].t, tClose: bucket[bucket.length - 1].t + VM_TF_MS,
        tHigh: hMax.t,  tLow:   lMin.t,
        o: bucket[0].o, h: hMax.h, l: lMin.l,
        c: bucket[bucket.length - 1].c,
        v: bucket.reduce((s, c) => s + c.v, 0),
        closed: bucket[bucket.length - 1].closed,
        color: seg.color, sessionName: seg.sessionName,
        sessionKey: seg.sessionKey, isSolape: seg.isSolape,
        count: bucket.length,
        isNoMarket: seg.sessionKey === 'nomarket',
      });
    }
  }

  result.sort((a, b) => a.t - b.t);
  candles = result;
}

/* ═══════════════════════════════════════
   CONSTRUIR VELAS NORMALES (por temporalidad)
═══════════════════════════════════════ */
function buildNormalCandles() {
  if (!rawCandles.length) { candles = []; return; }

  const aggSize = TF_AGG[chartMode];

  if (aggSize) {
    // Para temporalidades custom (6m, 9m, 9h, 6d, 9d):
    // Agrupar por bloques alineados al horario local (UTC-6)
    // La clave de bloque es el timestamp del inicio del período en UTC-6
    const baseTF  = TF_BINANCE[chartMode];           // ej '1h' para 9h
    const baseTFMS = TF_MS[baseTF];                  // ms de la vela base
    const totalMS  = baseTFMS * aggSize;              // ms del período completo

    // Calcular el offset UTC-6 en ms para alinear bloques
    const localOffsetMS = UTC_OFFSET * 3600000;      // -6 * 3600000

    const buckets = new Map();
    rawCandles.forEach(c => {
      // Ajustar timestamp al horario local para calcular a qué bloque pertenece
      const localT = c.t + localOffsetMS;
      const blockKey = Math.floor(localT / totalMS) * totalMS - localOffsetMS;
      if (!buckets.has(blockKey)) buckets.set(blockKey, []);
      buckets.get(blockKey).push(c);
    });

    const grouped = [];
    buckets.forEach((bucket, blockStart) => {
      if (!bucket.length) return;
      bucket.sort((a, b) => a.t - b.t);
      const hMax = bucket.reduce((b, c) => c.h > b.h ? c : b, bucket[0]);
      const lMin = bucket.reduce((b, c) => c.l < b.l ? c : b, bucket[0]);
      grouped.push({
        t: blockStart,
        o: bucket[0].o,
        h: hMax.h,
        l: lMin.l,
        c: bucket[bucket.length - 1].c,
        v: bucket.reduce((s, c) => s + c.v, 0),
        closed: bucket[bucket.length - 1].closed,
      });
    });
    grouped.sort((a, b) => a.t - b.t);

    candles = grouped.map(c => ({
      ...c,
      tClose: c.t + totalMS,
      tHigh: c.t, tLow: c.t,
      color: null,
      sessionName: chartMode.toUpperCase(),
      sessionKey: 'normal',
      isSolape: false, count: aggSize, isNoMarket: false,
    }));
  } else {
    candles = rawCandles.map(c => ({
      ...c,
      tClose: c.t + activeTF_MS,
      tHigh: c.t, tLow: c.t,
      color: null,
      sessionName: chartMode,
      sessionKey: 'normal',
      isSolape: false, count: 1, isNoMarket: false,
    }));
  }
}

/* Despachador: llama al builder correcto según chartMode */
function buildCandles() {
  if (chartMode === 'session') buildSessionCandles();
  else                         buildNormalCandles();
}


async function fetchCandles() {
  const loadEl = document.getElementById('loading');
  loadEl.textContent = 'Cargando datos...';
  loading.style.display = 'flex';
  errEl.style.display   = 'none';
  closeWS();
  rawCandles = [];
  candles    = [];

  try {
    const CHUNK    = 1500;
    let curStart   = Date.now() - daysCount * 24 * 60 * 60 * 1000;
    const endG     = Date.now();
    let allData    = [], ci = 0;

    const fetchTF  = TF_BINANCE[chartMode] || activeTF;  // TF real para la API
    const fetchTFMS = TF_MS[fetchTF] || activeTF_MS;

    while (curStart < endG) {
      ci++;
      loadEl.textContent = `Cargando datos... bloque ${ci}`;
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${fetchTF}&limit=${CHUNK}&startTime=${curStart}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.length) break;
      allData = allData.concat(data);
      curStart = +data[data.length - 1][0] + fetchTFMS;
      if (data.length < CHUNK) break;
    }

    const seen = new Set();
    rawCandles = allData
      .filter(d => { if (seen.has(+d[0])) return false; seen.add(+d[0]); return true; })
      .sort((a, b) => +a[0] - +b[0])
      .map(d => ({ t:+d[0], o:+d[1], h:+d[2], l:+d[3], c:+d[4], v:+d[5], closed: true }));

    buildCandles();
    window.rawCandles = rawCandles;
    snapToEnd = true;
    loading.style.display = 'none';
    loadEl.textContent = 'Cargando datos...';
    draw();
    updateLegend();
    fetchTicker(); fetchFR(); fetchOI();
    startPolling();
  } catch (e) {
    loading.style.display = 'none';
    loadEl.textContent = 'Cargando datos...';
    errEl.style.display = 'block';
    errEl.textContent = '⚠️ Error: ' + e.message;
  }
}

async function fetchTicker() {
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`);
    const d = await r.json();
    flashPrice(+d.lastPrice);
    const cel = document.getElementById('cur-change');
    cel.textContent = (+d.priceChangePercent >= 0 ? '+' : '') + (+d.priceChangePercent).toFixed(2) + '%';
    cel.className = +d.priceChangePercent >= 0 ? 'up' : 'dn';
    document.getElementById('h24').textContent = fmtPrice(+d.highPrice);
    document.getElementById('l24').textContent = fmtPrice(+d.lowPrice);
    document.getElementById('v24').textContent = fmtVol(+d.quoteVolume);
  } catch(e) {}
}

async function fetchFR() {
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
    const d = await r.json();
    if (d && d[0]) {
      const fr = (+d[0].fundingRate * 100).toFixed(4);
      const el = document.getElementById('fr');
      el.textContent = (fr >= 0 ? '+' : '') + fr + '%';
      el.className = fr >= 0 ? 'up' : 'dn';
    }
  } catch(e) {}
}

async function fetchOI() {
  try {
    const r = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
    const d = await r.json();
    if (d && d.openInterest) document.getElementById('oi').textContent = fmtVol(+d.openInterest);
  } catch(e) {}
}

/* ═══════════════════════════════════════
   TIEMPO REAL — POLLING REST cada 1s
═══════════════════════════════════════ */
let _pollTimer = null;
let wsSymbol   = '';

function setWsStatus(state) {
  wsDot.className   = state === 'live' ? 'live' : '';
  wsLbl.textContent = state === 'live' ? 'En vivo' : 'Desconectado';
}

async function pollTick() {
  if (!rawCandles.length) return;
  try {
    const fetchTF = TF_BINANCE[chartMode] || activeTF;
    const r1 = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=' + symbol + '&interval=' + fetchTF + '&limit=1');
    if (!r1.ok) return;
    const klines = await r1.json();
    if (!klines || !klines[0]) return;
    const k = klines[0];
    const incoming = { t:+k[0], o:+k[1], h:+k[2], l:+k[3], c:+k[4], v:+k[5], closed: false };

    document.getElementById('last-update').textContent = nowStr();
    const lastRaw = rawCandles[rawCandles.length - 1];

    if (incoming.t === lastRaw.t) {
      rawCandles[rawCandles.length - 1] = incoming;
      buildCandles();
    } else if (incoming.t > lastRaw.t) {
      rawCandles[rawCandles.length - 1] = { ...lastRaw, closed: true };
      rawCandles.push(incoming);
      if (rawCandles.length > 15000) rawCandles.shift();
      buildCandles();
    } else {
      return;
    }
    window.rawCandles = rawCandles;
    { const W2=cv.width/devicePixelRatio, vis=candles.length, bw=Math.max(1,Math.min(200,((W2-8-84)/Math.min(vis,500))*zoomLevel)), st=bw+Math.max(1,bw*0.15), maxC=Math.max(0,vis*st-(W2-8-84)+st*15); if(camX>=maxC-st*3) snapToEnd=true; }
    draw();

    const r2 = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=' + symbol);
    if (!r2.ok) return;
    const d = await r2.json();
    flashPrice(+d.lastPrice);
    const cel = document.getElementById('cur-change');
    cel.textContent = (+d.priceChangePercent >= 0 ? '+' : '') + (+d.priceChangePercent).toFixed(2) + '%';
    cel.className = +d.priceChangePercent >= 0 ? 'up' : 'dn';
    document.getElementById('h24').textContent = fmtPrice(+d.highPrice);
    document.getElementById('l24').textContent = fmtPrice(+d.lowPrice);
    document.getElementById('v24').textContent = fmtVol(+d.quoteVolume);

    if (candles.length) draw();

  } catch(e) {}
}

function startPolling() {
  if (_pollTimer) clearInterval(_pollTimer);
  wsSymbol = symbol;
  setWsStatus('live');
  pollTick();
  _pollTimer = setInterval(() => {
    if (wsSymbol === symbol) pollTick();
  }, 1000);
}

function closeWS() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  wsSymbol = '';
  setWsStatus('disconnected');
}

/* ═══════════════════════════════════════
   RESIZE
═══════════════════════════════════════ */
function resize() {
  const rect = wrap.getBoundingClientRect();
  cv.width  = rect.width  * devicePixelRatio;
  cv.height = rect.height * devicePixelRatio;
  cv.style.width  = rect.width  + 'px';
  cv.style.height = rect.height + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  snapToEnd = true;
  draw();
}

/* ═══════════════════════════════════════
   DRAW
═══════════════════════════════════════ */
function draw() {
  if (!candles.length) return;
  const W = cv.width  / devicePixelRatio;
  const H = cv.height / devicePixelRatio;
  ctx.clearRect(0, 0, W, H);

  // Calcular espacio para paneles de indicadores
  const _indPanels = window.INDICATORS
    ? window.INDICATORS.getActive().filter(x => x.def.type === 'panel')
    : [];
  const _panelH    = _indPanels.length
    ? Math.max(PANEL_H_MIN, Math.min(PANEL_H_MAX, Math.floor(H * panelHeightRatio)))
    : 0;
  const _panelGap  = _indPanels.length ? 4 : 0;
  const _totalPanelSpace = _indPanels.length * (_panelH + _panelGap);

  const PADT = 18, PADB = 36 + _totalPanelSpace, PADL = 8, PADR = 84;
  const chartH   = H - PADT - PADB - 8;
  const timeBarY = H - PADB;

  const vis  = candles.length;
  const barW = Math.max(1, Math.min(200, ((W - PADL - PADR) / Math.min(vis, 500)) * zoomLevel));
  const gap  = Math.max(1, barW * 0.15);
  const step = barW + gap;
  const maxCam = Math.max(0, vis * step - (W - PADL - PADR) + step * 15);
  if (snapToEnd || camX < 0) { camX = maxCam; if (candles.length) snapToEnd = false; }
  if (camX >= maxCam - step * 2) camX = maxCam;
  camX = Math.max(0, Math.min(maxCam, camX));

  const startIdx = Math.max(0, Math.floor(camX / step));
  const visCount = Math.ceil((W - PADL - PADR) / step) + 2;
  const endIdx   = Math.min(candles.length - 1, startIdx + visCount);
  const slice    = candles.slice(startIdx, endIdx + 1);
  if (!slice.length) return;

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < slice.length; i++) { if (slice[i].l < lo) lo = slice[i].l; if (slice[i].h > hi) hi = slice[i].h; }
  const pd = (hi - lo) * 0.07 || lo * 0.01 || 1;
  const priceMin = lo - pd, priceMax = hi + pd;
  const pxPer = chartH / (priceMax - priceMin);
  const py    = price => PADT + chartH - (price - priceMin) * pxPer;
  const barX  = idx   => PADL + idx * step - camX;

  // Fondo
  ctx.fillStyle = '#0b0e11';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111418';
  ctx.fillRect(0, timeBarY, W - PADR, PADB);

  // Separadores verticales + etiquetas tiempo
  let lastDayKey = '';
  let lastLabelX = -999;
  const MIN_LABEL_GAP = 50;
  slice.forEach((c, i) => {
    const xi  = startIdx + i;
    const x   = barX(xi);
    const d   = tsToLocal(c.t);
    const dk  = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    const mo  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getUTCMonth()];
    const isNewDay = dk !== lastDayKey;

    if (isNewDay && lastDayKey !== '') {
      ctx.strokeStyle = '#3a3f4799'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x + barW/2, PADT); ctx.lineTo(x + barW/2, timeBarY); ctx.stroke();
    }

    if (isNewDay && x > PADL && x < W - PADR - 20 && x - lastLabelX > MIN_LABEL_GAP) {
      lastDayKey  = dk;
      lastLabelX  = x;
      const lbl = `${d.getUTCDate()} ${mo}`;
      ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x + barW/2, timeBarY); ctx.lineTo(x + barW/2, timeBarY + 4); ctx.stroke();
      ctx.fillStyle = '#eaecef';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, x + barW/2, timeBarY + 15);
    } else if (isNewDay) {
      lastDayKey = dk;
    }
  });

  // Grid precios
  const rawStep  = (priceMax - priceMin) / 6;
  const mag      = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const gridStep = Math.ceil(rawStep / mag) * mag;
  let gp = Math.ceil(priceMin / gridStep) * gridStep;
  while (gp <= priceMax) {
    const y = py(gp);
    ctx.strokeStyle = '#1e2533'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
    ctx.fillStyle = '#848e9c'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(gp), W - PADR + 6, y + 3);
    gp += gridStep;
  }

  // Hover
  let hoveredIdx = -1;
  if (mouseX >= PADL && mouseX <= W - PADR)
    hoveredIdx = Math.round((mouseX - PADL + camX) / step);

  // Indicador zoom
  ctx.font = '10px monospace'; ctx.fillStyle = '#3a3f4799'; ctx.textAlign = 'right';
  ctx.fillText(`🔍 ${zoomLevel.toFixed(2)}x`, W - PADR - 6, PADT + 14);

  // Velas de sesión
  slice.forEach((c, i) => {
    const xi = startIdx + i, x = barX(xi);
    if (x < PADL - barW * 2 || x > W - PADR + barW) return;
    const midX   = x + barW / 2;
    const yo = py(c.o), yc = py(c.c), yh = py(c.h), yl = py(c.l);
    const bodyTop = Math.min(yo, yc);
    const bodyH   = Math.max(1, Math.abs(yc - yo));

    if (c.isNoMarket) {
      if (xi === hoveredIdx) { ctx.fillStyle = '#ffffff08'; ctx.fillRect(x - gap/2, PADT, barW + gap, chartH); }
      ctx.fillStyle = '#2b2f3633';
      ctx.fillRect(x, PADT, barW, chartH);
      ctx.strokeStyle = '#5a627266'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(midX, yh); ctx.lineTo(midX, yl); ctx.stroke();
      if (bodyH > 1) {
        ctx.fillStyle = '#3a3f4799';
        ctx.fillRect(x, bodyTop, barW, bodyH);
      }
      ctx.strokeStyle = '#5a627299'; ctx.lineWidth = 1;
      ctx.strokeRect(x, bodyTop, barW, bodyH);
      if (barW > 10) {
        ctx.fillStyle = '#848e9c66';
        ctx.font = `bold ${Math.min(10, barW * 0.6)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('–', midX, bodyTop + bodyH/2 + 3);
      }
      return;
    }

    const bull   = c.c >= c.o;
    const col    = c.color || (bull ? '#26d994' : '#ff5470');

    if (!c.closed)         { ctx.fillStyle = bull ? '#26d99412' : '#ff547012'; ctx.fillRect(x - gap/2, PADT, barW + gap, chartH); }
    if (xi === hoveredIdx) { ctx.fillStyle = '#ffffff10'; ctx.fillRect(x - gap/2, PADT, barW + gap, chartH); }

    ctx.strokeStyle = bull ? '#26d994' : '#ff5470'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(midX, yh); ctx.lineTo(midX, bodyTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(midX, bodyTop + bodyH); ctx.lineTo(midX, yl); ctx.stroke();

    if (bodyH > 1) {
      const grad = ctx.createLinearGradient(x, bodyTop, x, bodyTop + bodyH);
      if (bull) { grad.addColorStop(0, '#26d99499'); grad.addColorStop(1, '#00b86566'); }
      else       { grad.addColorStop(0, '#ff546688'); grad.addColorStop(1, '#cc1f3d99'); }
      ctx.fillStyle = grad;
      ctx.fillRect(x, bodyTop, barW, bodyH);
    }
    ctx.strokeStyle = bull ? '#26d994' : '#ff5470'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x, bodyTop, barW, bodyH);
  });

  // ── Indicadores Overlay (sobre las velas) ──
  if (window.INDICATORS) {
    window.INDICATORS.recalcAll(candles);
    const indLayout = { W, H, PADT, PADB, PADL, PADR, chartH,
      py, barX, step, barW, startIdx, endIdx, candles, camX };
    window.INDICATORS.drawOverlays(ctx, indLayout);
    // Paneles debajo del gráfico
    let panelYStart = H - _totalPanelSpace - PADB + _totalPanelSpace - _panelGap;
    // recalc correcto con el layout real
    const realPanelBase = PADT + chartH + 8;
    _indPanels.forEach(({ def, series, params }, pi) => {
      const pY = realPanelBase + pi * (_panelH + _panelGap);
      if (!series) return;
      const pLayout = { ...indLayout, panelY: pY, panelH: _panelH };
      try {
        if (def.draw) def.draw(ctx, series, pLayout, params);
      } catch(e) {}

      // ── Escala izquierda del panel ──
      const pts = series.lines?.main || series;
      if (pts && pts.length) {
        const visible = pts.filter(p => p.v != null && !isNaN(p.v));
        if (visible.length) {
          const vMin = params.scaleMin ?? Math.min(...visible.map(p => p.v));
          const vMax = params.scaleMax ?? Math.max(...visible.map(p => p.v));
          const range = vMax - vMin || 1;
          const py2 = v => pY + _panelH - ((v - vMin) / range) * _panelH;
          // Dibuja 3 etiquetas: arriba, medio, abajo
          const levels = [vMax, (vMax + vMin) / 2, vMin];
          levels.forEach((lv, li) => {
            const y = py2(lv);
            const lbl = Math.abs(lv) >= 1000 ? lv.toFixed(0)
                      : Math.abs(lv) >= 10   ? lv.toFixed(1)
                      : lv.toFixed(2);
            // Línea guía sutil dentro del panel
            ctx.strokeStyle = '#2b2f3666'; ctx.lineWidth = 0.4; ctx.setLineDash([2, 4]);
            ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(PADL + 30, y); ctx.stroke();
            ctx.setLineDash([]);
            // Fondo para la etiqueta
            ctx.font = '9px monospace';
            const tw = ctx.measureText(lbl).width;
            ctx.fillStyle = '#0b0e11cc';
            ctx.fillRect(PADL + 1, y - 6, tw + 6, 12);
            // Texto
            ctx.fillStyle = '#6a7380';
            ctx.textAlign = 'left';
            ctx.fillText(lbl, PADL + 3, y + 3);
          });
        }
      }

      // ── Handle de redimensionado (borde superior del primer panel) ──
      if (pi === 0) {
        const handleY = pY - 2;
        ctx.fillStyle = isPanelResizing ? '#f0b90b44' : '#2b2f3600';
        ctx.fillRect(PADL, handleY, W - PADL - PADR, 5);
        // Línea de agarre visible
        ctx.strokeStyle = isPanelResizing ? '#f0b90b' : '#3a3f4788';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PADL + 20, handleY + 2); ctx.lineTo(W - PADR - 20, handleY + 2); ctx.stroke();
        ctx.setLineDash([]);
        // Icono de resize
        ctx.fillStyle = isPanelResizing ? '#f0b90b' : '#5a6272';
        ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('⠿', W / 2, handleY + 4);
        // Guardar posición del handle para hit-test en mouse
        cv._panelHandleY = handleY;
      }
    });
  }

  // Línea último precio
  const last  = candles[candles.length - 1];
  const lastY = py(last.c);
  const lineCol = last.c >= last.o ? '#26d994' : '#ff5470';
  ctx.strokeStyle = lineCol + '55'; ctx.lineWidth = 0.8; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(PADL, lastY); ctx.lineTo(W - PADR, lastY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = lineCol;
  ctx.beginPath(); ctx.roundRect(W - PADR + 3, lastY - 9, PADR - 6, 18, 4); ctx.fill();
  ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(fmtPrice(last.c), W - PADR + 3 + (PADR - 6) / 2, lastY + 4);

  if (!last.closed) {
    ctx.fillStyle = '#f0b90b';
    ctx.beginPath(); ctx.arc(barX(candles.length - 1) + barW/2, py(last.c), 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // Crosshair + tooltip
  if (mouseX > PADL && mouseX < W - PADR && mouseY > PADT && mouseY < PADT + chartH) {
    ctx.strokeStyle = '#ffffff1a'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(mouseX, PADT); ctx.lineTo(mouseX, timeBarY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PADL, mouseY); ctx.lineTo(W - PADR, mouseY); ctx.stroke();

    const hoverP = priceMin + (PADT + chartH - mouseY) / pxPer;
    ctx.fillStyle = '#2b2f36';
    ctx.beginPath(); ctx.roundRect(W - PADR + 3, mouseY - 9, PADR - 6, 18, 4); ctx.fill();
    ctx.fillStyle = '#eaecef'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(fmtPrice(hoverP), W - PADR + 3 + (PADR - 6) / 2, mouseY + 4);

    if (hoveredIdx >= 0 && hoveredIdx < candles.length) {
      const hc = candles[hoveredIdx];
      const tlbl = tvLabel(hc.t);
      ctx.font = '10px sans-serif';
      const tw2 = ctx.measureText(tlbl).width + 16;
      const tx2 = Math.min(Math.max(mouseX - tw2/2, PADL), W - PADR - tw2);
      ctx.fillStyle = '#2b2f36';
      ctx.beginPath(); ctx.roundRect(tx2, timeBarY + 1, tw2, 17, 3); ctx.fill();
      ctx.fillStyle = '#eaecef'; ctx.textAlign = 'center';
      ctx.fillText(tlbl, tx2 + tw2/2, timeBarY + 13);

      const bull2 = hc.c >= hc.o;
      function fmtHora(ts) {
        if (!ts) return '--:--';
        const d = tsToLocal(ts);
        return String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
      }
      const sessCol = hc.color || (bull2 ? '#26d994' : '#ff5470');
      const rows = [
        { label: null, val: (hc.sessionName||tvLabel(hc.t))+(hc.isSolape?' ⚡':''), hora:null, color:sessCol,  bold:true,  size:11 },
        { label: null, val: tvLabel(hc.t) + ' → ' + fmtHora(hc.tClose),             hora:null, color:'#848e9c',bold:false, size:10 },
        { label: 'A:',  val: fmtPrice(hc.o), hora:fmtHora(hc.t),       color:'#eaecef',                        bold:false, size:11 },
        { label: 'C:',  val: fmtPrice(hc.c), hora:fmtHora(hc.tClose),  color:bull2?'#26d994':'#ff5470',        bold:false, size:11 },
        { label: 'Mx:', val: fmtPrice(hc.h), hora:fmtHora(hc.tHigh),  color:'#26d994',                        bold:false, size:11 },
        { label: 'Mn:', val: fmtPrice(hc.l), hora:fmtHora(hc.tLow),   color:'#ff5470',                        bold:false, size:11 },
        { label: 'V:',  val: fmtVol(hc.v),   hora:null,                color:'#848e9c',                        bold:false, size:11 },
      ];
      if (!hc.closed) rows.push({ label:null, val:'● En vivo', hora:null, color:'#f0b90b', bold:true, size:11 });

      const LH = 17, PAD = 10, tw3 = 230;
      const th3 = rows.length * LH + PAD * 2 - 2;
      let tx3 = mouseX + 14, ty4 = mouseY - th3/2;
      if (tx3 + tw3 > W - PADR) tx3 = mouseX - tw3 - 14;
      if (ty4 < PADT) ty4 = PADT;
      if (ty4 + th3 > PADT + chartH) ty4 = PADT + chartH - th3;

      ctx.fillStyle = '#1a1d23f0'; ctx.strokeStyle = sessCol; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.roundRect(tx3, ty4, tw3, th3, 6); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(tx3 + PAD, ty4 + PAD*2 + LH*2 - 4); ctx.lineTo(tx3 + tw3 - PAD, ty4 + PAD*2 + LH*2 - 4); ctx.stroke();

      const x0 = tx3 + PAD, x1 = tx3 + tw3 - PAD - 56, x2 = tx3 + tw3 - PAD;
      rows.forEach((r, i) => {
        const y = ty4 + PAD + i * LH + 11;
        ctx.font = (r.bold ? 'bold ' : '') + `${r.size}px ${i < 2 ? 'sans-serif' : 'monospace'}`;
        if (r.label === null) {
          ctx.fillStyle = r.color; ctx.textAlign = 'left'; ctx.fillText(r.val, x0, y);
        } else {
          ctx.fillStyle = '#848e9c'; ctx.textAlign = 'left';   ctx.fillText(r.label, x0, y);
          ctx.fillStyle = r.color;  ctx.textAlign = 'right';  ctx.fillText(r.val,   x1, y);
          if (r.hora) { ctx.fillStyle = '#848e9c'; ctx.font = '10px monospace'; ctx.textAlign = 'right'; ctx.fillText(r.hora, x2, y); }
        }
      });
    }
  }

  // Regla
  if (rulerMode && rulerStartX >= 0 && rulerEndX >= 0 && (rulerActive || rulerLocked)) {
    const rx1 = rulerStartX, ry1 = rulerStartY, rx2 = rulerEndX, ry2 = rulerEndY;
    const p1   = priceMin + (PADT + chartH - ry1) / pxPer;
    const p2   = priceMin + (PADT + chartH - ry2) / pxPer;
    const pDiff = p2 - p1, pPct = p1 !== 0 ? (pDiff / p1 * 100) : 0;
    const i1 = rulerStartIdx >= 0 ? rulerStartIdx : Math.round((rx1 - PADL + camX) / step);
    const i2 = rulerEndIdx   >= 0 ? rulerEndIdx   : Math.round((rx2 - PADL + camX) / step);
    const nBars = Math.abs(i2 - i1);
    const col   = pDiff >= 0 ? '#26d994' : '#ff5470';
    const sign  = pDiff >= 0 ? '+' : '';
    const c1 = candles[Math.min(Math.max(i1, 0), candles.length - 1)];
    const c2 = candles[Math.min(Math.max(i2, 0), candles.length - 1)];
    let timeDiffStr = '';
    if (c1 && c2) {
      const tot = Math.floor(Math.abs(c2.t - c1.t) / 60000);
      if (tot < 60)   timeDiffStr = `${tot}m`;
      else if (tot < 1440) timeDiffStr = `${Math.floor(tot/60)}h ${tot%60}m`;
      else            timeDiffStr = `${Math.floor(tot/1440)}d ${Math.floor((tot%1440)/60)}h`;
    }
    ctx.fillStyle = pDiff >= 0 ? 'rgba(38,217,148,0.10)' : 'rgba(255,84,112,0.10)';
    ctx.fillRect(Math.min(rx1,rx2), Math.min(ry1,ry2), Math.abs(rx2-rx1), Math.abs(ry2-ry1));
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(rx1, ry1); ctx.lineTo(rx2, ry2); ctx.stroke();
    ctx.strokeStyle = col+'88'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(Math.min(rx1,rx2), ry1); ctx.lineTo(Math.max(rx1,rx2), ry1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(Math.min(rx1,rx2), ry2); ctx.lineTo(Math.max(rx1,rx2), ry2); ctx.stroke();
    ctx.strokeStyle = '#9c6cff66'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(rx1, PADT); ctx.lineTo(rx1, timeBarY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx2, PADT); ctx.lineTo(rx2, timeBarY); ctx.stroke();
    ctx.setLineDash([]);

    function drawYLabel(price, y, isStart) {
      const lw = PADR - 6;
      ctx.fillStyle = isStart ? '#2b2f36' : col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 9, lw, 18, 3); ctx.fill();
      ctx.strokeStyle = isStart ? '#3a3f47' : col; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 9, lw, 18, 3); ctx.stroke();
      ctx.fillStyle = isStart ? '#848e9c' : '#0b0e11';
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(fmtPrice(price), W - PADR + 3 + lw/2, y + 4);
    }
    if (ry1 > PADT && ry1 < timeBarY) drawYLabel(p1, ry1, true);
    if (ry2 > PADT && ry2 < timeBarY) drawYLabel(p2, ry2, false);

    function drawXLabel(ts, x, highlight) {
      if (!ts) return;
      const lbl = tvLabel(ts);
      ctx.font = 'bold 10px sans-serif';
      const lw3 = ctx.measureText(lbl).width + 12;
      const lx2 = Math.max(PADL, Math.min(W - PADR - lw3, x - lw3/2));
      ctx.fillStyle = highlight ? col : '#2b2f36';
      ctx.beginPath(); ctx.roundRect(lx2, timeBarY + 1, lw3, 16, 3); ctx.fill();
      ctx.strokeStyle = highlight ? col : '#3a3f47'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.roundRect(lx2, timeBarY + 1, lw3, 16, 3); ctx.stroke();
      ctx.fillStyle = highlight ? '#0b0e11' : '#848e9c'; ctx.textAlign = 'center';
      ctx.fillText(lbl, lx2 + lw3/2, timeBarY + 13);
    }
    if (c1) drawXLabel(c1.t, rx1, false);
    if (c2) drawXLabel(c2.t, rx2, true);

    [{ x: rx1, y: ry1 }, { x: rx2, y: ry2 }].forEach(({ x, y }) => {
      ctx.fillStyle = '#1e2329'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI*2); ctx.stroke();
    });

    const midX = (rx1 + rx2) / 2, midY = (ry1 + ry2) / 2;
    const lns = [
      { text: `${sign}${fmtPrice(Math.abs(pDiff))}`,                                   color: col,       bold: true,  size: 12 },
      { text: `${sign}${pPct.toFixed(2)}%`,                                             color: col,       bold: true,  size: 12 },
      { text: `${nBars} vela${nBars!==1?'s':''}  ·  ${timeDiffStr}`,                  color: '#848e9c', bold: false, size: 10 },
    ];
    ctx.font = 'bold 12px monospace';
    const panelW = Math.max(
      ctx.measureText(lns[0].text).width,
      ctx.measureText(lns[1].text).width,
      (() => { ctx.font = '10px monospace'; return ctx.measureText(lns[2].text).width; })()
    ) + 28;
    const panelH = 62;
    let px2 = Math.max(PADL + 4, Math.min(W - PADR - panelW - 4, midX - panelW/2));
    let py2 = Math.max(PADT + 4, Math.min(PADT + chartH - panelH - 4, midY - panelH/2));
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.roundRect(px2+2, py2+2, panelW, panelH, 6); ctx.fill();
    ctx.fillStyle = '#1a1d23f5';
    ctx.beginPath(); ctx.roundRect(px2, py2, panelW, panelH, 6); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(px2, py2, panelW, panelH, 6); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.roundRect(px2, py2, 3, panelH, [6, 0, 0, 6]); ctx.fill();
    let ty2 = py2 + 16;
    lns.forEach(({ text, color, bold, size }) => {
      ctx.fillStyle = color;
      ctx.font = `${bold?'bold ':''}${size}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(text, px2 + panelW/2, ty2);
      ty2 += size + 5;
    });
  }
}

/* ═══════════════════════════════════════
   EVENTOS UI
═══════════════════════════════════════ */
const symInput = document.getElementById('sym-input');
function applySymbol() {
  const val = symInput.value.trim().toUpperCase();
  if (!val) return;
  symInput.value = val;
  symbol = val;
  fetchCandles();
}
symInput.addEventListener('change', applySymbol);
symInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applySymbol(); } });

document.getElementById('days-select').addEventListener('change', e => {
  daysCount = parseInt(e.target.value, 10);
  fetchCandles();
});

/* ── Botones de temporalidad (píldoras) ── */
document.querySelectorAll('.tf-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const val = btn.dataset.tf;
    if (val === 'session') {
      chartMode   = 'session';
      activeTF    = '15m';
      activeTF_MS = TF_MS['15m'];
    } else {
      chartMode   = val;
      activeTF    = val;
      activeTF_MS = TF_MS[val] || TF_MS['15m'];
    }
    updateFooter();
    fetchCandles();
  });
});

function updateFooter() {
  const el = document.getElementById('footer-txt');
  if (!el) return;
  // Session bar visibility
  const sessLegend = document.getElementById('sess-legend');
  if (sessLegend) sessLegend.style.display = chartMode === 'session' ? '' : 'none';
  if (chartMode === 'session') {
    el.textContent = '🕐 Hora local UTC-6 (Tegucigalpa) · Velas por sesión de mercado · Base: 15m';
  } else {
    el.textContent = `🕐 Hora local UTC-6 (Tegucigalpa) · Velas normales · Temporalidad: ${activeTF}`;
  }
}

cv.addEventListener('mousedown', e => {
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  // ── Redimensionar panel de indicadores ──
  if (cv._panelHandleY !== undefined) {
    const hY = cv._panelHandleY;
    if (my >= hY - 4 && my <= hY + 8) {
      isPanelResizing   = true;
      panelResizeStartY = e.clientY;
      panelResizeStartRatio = panelHeightRatio;
      cv.style.cursor = 'ns-resize';
      return;
    }
  }

  if (rulerMode) {
    rulerActive = true; rulerLocked = false;
    rulerStartX = mx; rulerStartY = my; rulerEndX = mx; rulerEndY = my;
    const bW2 = Math.max(1, Math.min(200, ((cv.width/devicePixelRatio - 8 - 84) / Math.min(candles.length, 500)) * zoomLevel));
    const s2  = bW2 + Math.max(1, bW2 * 0.15);
    rulerStartIdx = Math.round((mx - 8 + camX) / s2);
    rulerEndIdx   = rulerStartIdx;
    return;
  }
  isDragging = true; dragStartX = e.clientX; dragStartCamX = camX;
  cv.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', e => {
  const rect = cv.getBoundingClientRect();
  mouseX = e.clientX - rect.left; mouseY = e.clientY - rect.top;

  // ── Arrastrar para redimensionar panel ──
  if (isPanelResizing) {
    const H = cv.height / devicePixelRatio;
    const dy = panelResizeStartY - e.clientY;  // arrastrar arriba = más grande
    const newRatio = panelResizeStartRatio + dy / H;
    panelHeightRatio = Math.max(PANEL_H_MIN / H, Math.min(PANEL_H_MAX / H, newRatio));
    draw(); return;
  }

  // Cursor ns-resize cerca del handle
  if (cv._panelHandleY !== undefined) {
    const hY = cv._panelHandleY;
    if (mouseY >= hY - 4 && mouseY <= hY + 8 && !isDragging && !rulerMode) {
      cv.style.cursor = 'ns-resize';
    } else if (!isDragging && !rulerMode) {
      cv.style.cursor = 'crosshair';
    }
  }

  if (rulerMode && rulerActive) {
    rulerEndX = mouseX; rulerEndY = mouseY;
    const bW2 = Math.max(1, Math.min(200, ((cv.width/devicePixelRatio - 8 - 84) / Math.min(candles.length, 500)) * zoomLevel));
    const s2  = bW2 + Math.max(1, bW2 * 0.15);
    rulerEndIdx = Math.round((mouseX - 8 + camX) / s2);
    draw(); return;
  }
  if (isDragging) camX = Math.max(0, dragStartCamX + (dragStartX - e.clientX));
  draw();
});

window.addEventListener('mouseup', () => {
  if (isPanelResizing) { isPanelResizing = false; cv.style.cursor = 'crosshair'; draw(); return; }
  if (rulerMode && rulerActive) { rulerActive = false; rulerLocked = true; draw(); return; }
  isDragging = false; cv.style.cursor = 'crosshair';
});

cv.addEventListener('mouseleave', () => { mouseX = -1; mouseY = -1; draw(); });

cv.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
    const zoomFactor = e.deltaY < 0 ? 1.5 : 1 / 1.5;
    const oldZoom = zoomLevel;
    zoomLevel = Math.max(0.01, Math.min(500, zoomLevel * zoomFactor));
    const W2     = cv.width / devicePixelRatio;
    const mxc    = e.clientX - cv.getBoundingClientRect().left;
    const oldBW  = Math.max(1, Math.min(200, ((W2 - 8 - 84) / Math.min(candles.length, 500)) * oldZoom));
    const oldSt  = oldBW + Math.max(1, oldBW * 0.15);
    const newBW  = Math.max(1, Math.min(200, ((W2 - 8 - 84) / Math.min(candles.length, 500)) * zoomLevel));
    const newSt  = newBW + Math.max(1, newBW * 0.15);
    const idxUm  = (mxc - 8 + camX) / oldSt;
    camX = Math.max(0, idxUm * newSt - (mxc - 8));
  } else {
    camX = Math.max(0, camX + e.deltaX * 2);
  }
  draw();
}, { passive: false });

cv.addEventListener('touchstart', e => { isDragging = true; dragStartX = e.touches[0].clientX; dragStartCamX = camX; }, { passive: true });
cv.addEventListener('touchmove',  e => { if (!isDragging) return; camX = Math.max(0, dragStartCamX + (dragStartX - e.touches[0].clientX)); draw(); }, { passive: true });
cv.addEventListener('touchend',   () => isDragging = false);
cv.style.cursor = 'crosshair';

rulerBtn.addEventListener('click', () => {
  rulerMode = !rulerMode; rulerBtn.classList.toggle('active', rulerMode);
  if (!rulerMode) { rulerActive = false; rulerLocked = false; rulerStartX = -1; rulerEndX = -1; draw(); }
});

window.addEventListener('keydown', e => {
  if (document.activeElement === symInput) return;
  if (e.key === 'r' || e.key === 'R') {
    rulerMode = !rulerMode; rulerBtn.classList.toggle('active', rulerMode);
    if (!rulerMode) { rulerActive = false; rulerLocked = false; rulerStartX = -1; rulerEndX = -1; draw(); }
  }
  if (e.key === 'Escape' && rulerMode) {
    rulerMode = false; rulerActive = false; rulerLocked = false; rulerStartX = -1; rulerEndX = -1;
    rulerBtn.classList.remove('active'); draw();
  }
});

setInterval(fetchOI, 30000);
setInterval(fetchFR, 60000);

const ro = new ResizeObserver(resize);
ro.observe(wrap);
resize();
updateFooter();
fetchCandles();

/* ═══════════════════════════════════════
   EDITOR DE SESIONES
═══════════════════════════════════════ */
function localTimeStr(utcH) {
  const norm = ((utcH % 24) + 24) % 24;
  const loc  = norm - 6;
  const fin  = loc < 0 ? loc + 24 : loc;
  return `${String(fin).padStart(2,'0')}:00`;
}

function buildHourOptions(selectedLocal) {
  const selH = parseInt(selectedLocal.split(':')[0], 10) || 0;
  let html = '';
  for (let h = 0; h < 24; h++) {
    const label = `${String(h).padStart(2,'0')}:00`;
    html += `<option value="${h}"${h === selH ? ' selected' : ''}>${label}</option>`;
  }
  return html;
}

function buildEditRows() {
  const container = document.getElementById('sess-edit-rows');
  container.innerHTML = '';

  sessConfig.forEach((s, i) => {
    const openLocal  = localTimeStr(s.startUtcH);
    const closeLocal = localTimeStr(s.endUtcH);
    const solSLocal  = localTimeStr(s.solapStart);
    const solELocal  = localTimeStr(s.solapEnd);

    const card = document.createElement('div');
    card.className = 'sess-card';
    card.id = `sess-card-${i}`;

    if (s.key === 'nomarket') {
      card.innerHTML = `
        <div class="sess-card-header" style="background:#1a1d20">
          <div class="sess-card-dot" style="background:#3a3f47;border:1px solid #5a6272"></div>
          <div class="sess-card-name" style="color:#848e9c">${s.name}</div>
          <div class="sess-card-utc6" id="hdr-${i}">
            <strong style="color:#848e9c">${openLocal} – ${closeLocal}</strong>
            &nbsp;·&nbsp; Período sin actividad de mercado
          </div>
          <div class="sess-card-toggle">
            <label for="chk-${i}" style="cursor:pointer;color:#848e9c;font-size:11px;">Visible</label>
            <input type="checkbox" id="chk-${i}" data-i="${i}" data-f="enabled" ${s.enabled ? 'checked' : ''} />
          </div>
        </div>
        <div class="sess-card-body" style="grid-template-columns:1fr 1fr;">
          <div class="sess-field"><label>🕐 Apertura</label><select data-i="${i}" data-f="startUtcH">${buildHourOptions(openLocal)}</select></div>
          <div class="sess-field"><label>🕐 Cierre</label><select data-i="${i}" data-f="endUtcH">${buildHourOptions(closeLocal)}</select></div>
        </div>
      `;
      container.appendChild(card);
      if (!s.enabled) card.style.opacity = '0.45';
      return;
    }
    card.innerHTML = `
      <div class="sess-card-header">
        <div class="sess-card-dot" style="background:${s.color}"></div>
        <div class="sess-card-name">${s.name}</div>
        <div class="sess-card-utc6" id="hdr-${i}">
          <strong>${openLocal} – ${closeLocal}</strong>
          &nbsp;·&nbsp; Hora dorada: <strong>${solSLocal} – ${solELocal}</strong>
        </div>
        <div class="sess-card-toggle">
          <label for="chk-${i}" style="cursor:pointer;color:#848e9c;font-size:11px;">Activa</label>
          <input type="checkbox" id="chk-${i}" data-i="${i}" data-f="enabled" ${s.enabled ? 'checked' : ''} />
        </div>
      </div>
      <div class="sess-card-body">
        <div class="sess-field"><label>🕐 Apertura</label><select data-i="${i}" data-f="startUtcH">${buildHourOptions(openLocal)}</select></div>
        <div class="sess-field"><label>🕐 Cierre</label><select data-i="${i}" data-f="endUtcH">${buildHourOptions(closeLocal)}</select></div>
        <div class="sess-field"><label>⭐ Hora dorada inicio</label><select data-i="${i}" data-f="solapStart">${buildHourOptions(solSLocal)}</select></div>
        <div class="sess-field"><label>⭐ Hora dorada fin</label><select data-i="${i}" data-f="solapEnd">${buildHourOptions(solELocal)}</select></div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('select[data-f], input[type=checkbox][data-f]').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.i, f = inp.dataset.f;
      if (inp.type === 'checkbox') {
        sessConfig[i][f] = inp.checked;
        const card = document.getElementById(`sess-card-${i}`);
        if (card) card.style.opacity = inp.checked ? '1' : '0.45';
      } else {
        const lh = parseInt(inp.value, 10) || 0;
        let utcH = lh + 6; if (utcH >= 24) utcH -= 24;
        sessConfig[i][f] = utcH;
        if (f === 'startUtcH') {
          sessConfig[i].endUtcH    = normEndH(sessConfig[i].startUtcH, sessConfig[i].endUtcH    % 24);
          sessConfig[i].solapStart = normEndH(sessConfig[i].startUtcH, sessConfig[i].solapStart % 24);
          sessConfig[i].solapEnd   = normEndH(sessConfig[i].solapStart, sessConfig[i].solapEnd  % 24);
        }
        if (f === 'endUtcH')    sessConfig[i].endUtcH    = normEndH(sessConfig[i].startUtcH, utcH);
        if (f === 'solapStart') { sessConfig[i].solapStart = normEndH(sessConfig[i].startUtcH, utcH); sessConfig[i].solapEnd = normEndH(sessConfig[i].solapStart, sessConfig[i].solapEnd % 24); }
        if (f === 'solapEnd')   sessConfig[i].solapEnd   = normEndH(sessConfig[i].solapStart, utcH);
        updateCardHeader(i);
      }
    });
  });

  sessConfig.forEach((s, i) => {
    const card = document.getElementById(`sess-card-${i}`);
    if (card && !s.enabled) card.style.opacity = '0.45';
  });
}

function updateCardHeader(i) {
  const s = sessConfig[i];
  const el = document.getElementById(`hdr-${i}`);
  if (!el) return;
  if (s.key === 'nomarket') {
    el.innerHTML = `<strong style="color:#848e9c">${localTimeStr(s.startUtcH)} – ${localTimeStr(s.endUtcH)}</strong> &nbsp;·&nbsp; Período sin actividad de mercado`;
  } else {
    el.innerHTML = `<strong>${localTimeStr(s.startUtcH)} – ${localTimeStr(s.endUtcH)}</strong> &nbsp;·&nbsp; Hora dorada: <strong>${localTimeStr(s.solapStart)} – ${localTimeStr(s.solapEnd)}</strong>`;
  }
}

function updateLegend() {
  ['sydney','tokyo','london','newyork','nomarket'].forEach(key => {
    const s = sessConfig.find(x => x.key === key);
    const el = document.getElementById(`leg-${key}-txt`);
    if (el && s) el.textContent = `${s.name} (${localTimeStr(s.startUtcH)}–${localTimeStr(s.endUtcH)})`;
    const dot = document.getElementById(`dot-${key}`);
    if (dot && s) dot.style.background = s.color;
  });
}

// Modal
const overlay  = document.getElementById('sess-modal-overlay');
const editBtn  = document.getElementById('sess-edit-btn');
const applyBtn = document.getElementById('sess-apply-btn');
const resetBtn = document.getElementById('sess-reset-btn');
const closeBtn = document.getElementById('sess-modal-close');

editBtn.addEventListener('click',   () => { buildEditRows(); overlay.classList.add('open'); });
overlay.addEventListener('click',   e  => { if (e.target === overlay) overlay.classList.remove('open'); });
closeBtn.addEventListener('click',  () => overlay.classList.remove('open'));
applyBtn.addEventListener('click',  () => { applySessionConfig(); overlay.classList.remove('open'); });
resetBtn.addEventListener('click',  () => {
  sessConfig = SESS_DEFAULTS.map(s => ({ ...s }));
  buildEditRows(); applySessionConfig();
});

/* ═══════════════════════════════════════
   BARRA DE SESIONES ESTILO WTB — CANVAS
═══════════════════════════════════════ */
const sessCv  = document.getElementById('sess-cv');
const sessCtx = sessCv.getContext('2d');
const sessWrap = document.getElementById('sess-canvas-wrap');

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawSessionBar() {
  const dpr = window.devicePixelRatio || 1;
  const W   = sessWrap.clientWidth;
  const H   = 130;
  sessCv.width  = W * dpr;
  sessCv.height = H * dpr;
  sessCv.style.width  = W + 'px';
  sessCv.style.height = H + 'px';
  const c = sessCtx;
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);

  const LABEL_H = 16;
  const ROW_H   = 18;
  const ROW_GAP = 3;
  const ROWS_TOP = LABEL_H + 4;

  c.fillStyle = '#1a1e2488';
  c.fillRect(0, ROWS_TOP, W, H - ROWS_TOP);

  c.font = '9px -apple-system, sans-serif';
  for (let h = 0; h < 24; h++) {
    const x = (h / 24) * W;
    if (h % 6 === 0) {
      c.strokeStyle = '#5a627288'; c.lineWidth = 1;
    } else if (h % 3 === 0) {
      c.strokeStyle = '#3a3f4766'; c.lineWidth = 1;
    } else {
      c.strokeStyle = '#2b2f3633'; c.lineWidth = 1;
    }
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();

    if (true) {
      const lbl = `${String(h).padStart(2,'0')}:00`;
      const tw = c.measureText(lbl).width;
      c.fillStyle = '#161a1e';
      c.fillRect(x - tw/2 - 2, 1, tw + 4, 12);
      c.fillStyle = h % 6 === 0 ? '#848e9c' : '#4a5060';
      c.textAlign = 'center';
      c.fillText(lbl, x, 11);
    }
  }

  const browserOffsetH = UTC_OFFSET;

  function utcHToLocalFrac(utcH) {
    const localH = ((utcH + browserOffsetH) % 24 + 24) % 24;
    return localH / 24;
  }

  const _nowUtc = new Date();
  const _nowUtcH = _nowUtc.getUTCHours() + _nowUtc.getUTCMinutes() / 60;

  VM_SESSIONS.forEach((s, i) => {
    const y = ROWS_TOP + i * (ROW_H + ROW_GAP);

    const durH      = s.endUtcH - s.startUtcH;
    const startFrac = utcHToLocalFrac(s.startUtcH);
    const endFrac   = startFrac + Math.min(durH, 24) / 24;

    const _sStart = s.startUtcH % 24;
    const _sEnd   = s.endUtcH;
    let isActive = false;
    if (_sEnd > 24) {
      isActive = _nowUtcH >= _sStart || _nowUtcH < (_sEnd % 24);
    } else {
      isActive = _nowUtcH >= _sStart && _nowUtcH < _sEnd;
    }

    function seg(f1, f2, fillAlpha, strokeAlpha, useColor, label) {
      const parts = [];
      if (f2 <= 1) {
        parts.push([f1, f2]);
      } else {
        parts.push([f1, 1]);
        parts.push([0, f2 - 1]);
      }
      parts.forEach(([a, b], idx) => {
        if (b <= a) return;
        const px1 = a * W + 1;
        const px2 = b * W - 1;
        const pw  = px2 - px1;
        if (pw < 1) return;
        c.fillStyle   = hexToRgba(useColor, fillAlpha);
        c.strokeStyle = hexToRgba(useColor, strokeAlpha);
        c.lineWidth = 1;
        c.beginPath(); c.roundRect(px1, y, pw, ROW_H, 3); c.fill(); c.stroke();
        if (label && pw > 28 && idx === 0) {
          c.fillStyle = '#000000';
          c.font = 'bold 10px -apple-system, sans-serif';
          c.textAlign = 'left';
          c.fillText(label, px1 + 5, y + ROW_H - 4);
        }
      });
    }

    if (isActive) {
      seg(startFrac, endFrac, 0.85, 1, s.color, '');
    } else {
      seg(startFrac, endFrac, 0.15, 0.35, s.color, '');
    }

    if (startFrac < 1) {
      const nx = startFrac * W + 5;
      c.fillStyle = isActive ? '#000000' : '#ffffff55';
      c.font = 'bold 10px -apple-system, sans-serif';
      c.textAlign = 'left';
      c.fillText(s.name, nx, y + ROW_H - 4);
    }
  });

  // Línea de hora actual
  const now    = new Date();
  const localH = now.getHours();
  const localM = now.getMinutes();
  const nowFrac = (localH * 60 + localM) / (24 * 60);
  const nowX   = nowFrac * W;

  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
  const liveGreen = `rgba(34,197,94,${0.5 + 0.5 * pulse})`;
  c.shadowColor = '#22c55e'; c.shadowBlur = 8 + 6 * pulse;
  c.strokeStyle = liveGreen; c.lineWidth = 2;
  c.beginPath(); c.moveTo(nowX, 0); c.lineTo(nowX, H); c.stroke();
  c.shadowBlur = 0;

  const timeStr = `${String(localH).padStart(2,'0')}:${String(localM).padStart(2,'0')}`;
  c.font = 'bold 9px -apple-system, sans-serif';
  c.textAlign = 'center';
  const tw = c.measureText(timeStr).width + 8;
  const tx = Math.max(tw/2+2, Math.min(W - tw/2 - 2, nowX));
  c.fillStyle = liveGreen;
  c.beginPath(); c.roundRect(tx - tw/2, 1, tw, 12, 4); c.fill();
  c.fillStyle = '#0b0e11';
  c.fillText(timeStr, tx, 10);
}

function applySessionConfig() {
  VM_SESSIONS = sessConfig.filter(s => s.enabled).map(s => ({ ...s }));
  if (rawCandles.length) { snapToEnd = true; buildSessionCandles(); draw(); }
  updateLegend();
  drawSessionBar();
}

const sessRO = new ResizeObserver(drawSessionBar);
sessRO.observe(sessWrap);
drawSessionBar();
setInterval(drawSessionBar, 30000);

let _sessAnimLast = 0;
(function animLoop(ts) {
  if (ts - _sessAnimLast > 100) {
    _sessAnimLast = ts;
    drawSessionBar();
  }
  requestAnimationFrame(animLoop);
})();

/* ═══════════════════════════════════════════════════════════════════
   UI DE INDICADORES — auto-detecta lo que esté en indicators.js
   (o cualquier otro archivo que llame a INDICATORS.register)
═══════════════════════════════════════════════════════════════════ */
(function initIndicatorUI() {

  /* ── Esperar a que INDICATORS esté listo ── */
  if (!window.INDICATORS) {
    console.warn('[APP] window.INDICATORS no encontrado. ¿Cargaste indicators.js?');
    return;
  }

  /* ── Botón en la topbar ── */
  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const sep    = document.createElement('span');
    sep.className = 'sep'; sep.textContent = '|';
    const btn    = document.createElement('button');
    btn.className = 'tf-btn'; btn.id = 'ind-btn';
    btn.title = 'Indicadores (I)';
    btn.innerHTML = '📈 Indicadores';
    topbar.appendChild(sep);
    topbar.appendChild(btn);
    btn.addEventListener('click', openIndicatorModal);
  }

  /* ── Shortcut teclado ── */
  window.addEventListener('keydown', e => {
    const symInput = document.getElementById('sym-input');
    if (document.activeElement === symInput) return;
    if (e.key === 'i' || e.key === 'I') openIndicatorModal();
  });

  /* ══════════════════════════════════════════
     MODAL DE INDICADORES
  ══════════════════════════════════════════ */
  function buildModal() {
    if (document.getElementById('ind-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ind-modal-overlay';
    overlay.style.cssText = `
      display:none; position:fixed; inset:0; z-index:1000;
      background:rgba(0,0,0,0.85); align-items:center; justify-content:center;
    `;

    overlay.innerHTML = `
      <div id="ind-modal" style="
        background:#161a1e; border:1px solid #2b2f36; border-radius:12px;
        padding:0; width:760px; max-width:98vw; max-height:94vh;
        overflow:hidden; box-shadow:0 16px 64px rgba(0,0,0,0.9);
        display:flex; flex-direction:column;
      ">
        <!-- Header -->
        <div style="
          display:flex; align-items:center; justify-content:space-between;
          padding:16px 24px; border-bottom:1px solid #2b2f36; flex-shrink:0;
        ">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:18px;">📈</span>
            <span style="color:#eaecef; font-weight:700; font-size:15px;">Indicadores Técnicos</span>
            <span id="ind-active-badge" style="
              background:#f0b90b22; border:1px solid #f0b90b66; border-radius:10px;
              padding:1px 8px; font-size:10px; color:#f0b90b; display:none;
            "></span>
          </div>
          <button id="ind-modal-close" style="
            background:none; border:none; color:#848e9c; font-size:20px;
            cursor:pointer; line-height:1; padding:0 4px;
          ">✕</button>
        </div>

        <!-- Búsqueda -->
        <div style="padding:12px 24px; border-bottom:1px solid #1e2329; flex-shrink:0;">
          <input id="ind-search" placeholder="🔍 Buscar indicador..." style="
            width:100%; background:#1e2329; border:1px solid #2b2f36;
            color:#eaecef; border-radius:6px; font-size:12px; padding:7px 12px;
            outline:none;
          " />
        </div>

        <!-- Contenido: lista + config -->
        <div style="display:flex; flex:1; min-height:0; overflow:hidden;">

          <!-- Lista de indicadores -->
          <div id="ind-list" style="
            width:280px; flex-shrink:0; overflow-y:auto; border-right:1px solid #2b2f36;
            padding:8px 0;
          "></div>

          <!-- Panel de configuración -->
          <div id="ind-config-panel" style="flex:1; overflow-y:auto; padding:20px 24px;">
            <div id="ind-config-content" style="color:#4a5060; font-size:13px; padding-top:60px; text-align:center;">
              ← Selecciona un indicador para configurarlo
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) closeIndicatorModal(); });
    document.getElementById('ind-modal-close').addEventListener('click', closeIndicatorModal);
    document.getElementById('ind-search').addEventListener('input', e => renderList(e.target.value));
  }

  function openIndicatorModal() {
    buildModal();
    renderList('');
    renderBadge();
    renderChipsBar();
    const overlay = document.getElementById('ind-modal-overlay');
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('ind-search')?.focus(), 50);
  }

  function closeIndicatorModal() {
    const overlay = document.getElementById('ind-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    renderChipsBar();
    draw(); // re-dibujar con cambios
  }

  /* ── Renderizar lista de indicadores ── */
  function renderList(filter = '') {
    const list   = document.getElementById('ind-list');
    if (!list) return;
    const defs   = window.INDICATORS.getAll();
    const q      = filter.toLowerCase();
    const filtered = defs.filter(d =>
      d.name.toLowerCase().includes(q) || d.shortName.toLowerCase().includes(q)
    );

    // Agrupar
    const overlays = filtered.filter(d => d.type === 'overlay');
    const panels   = filtered.filter(d => d.type === 'panel');

    list.innerHTML = '';
    function addGroup(label, items) {
      if (!items.length) return;
      const hdr = document.createElement('div');
      hdr.style.cssText = 'padding:6px 16px 3px; font-size:9px; color:#4a5060; text-transform:uppercase; letter-spacing:.8px; font-weight:700;';
      hdr.textContent = label;
      list.appendChild(hdr);
      items.forEach(def => {
        const active = window.INDICATORS.isActive(def.id);
        const row    = document.createElement('div');
        row.dataset.id = def.id;
        row.style.cssText = `
          display:flex; align-items:center; gap:8px; padding:8px 16px;
          cursor:pointer; transition:background .1s; border-radius:0;
          ${active ? 'background:#f0b90b0a;' : ''}
        `;
        row.innerHTML = `
          <div style="
            width:26px; height:26px; border-radius:5px; flex-shrink:0;
            background:${active ? '#f0b90b22' : '#1e2329'};
            border:1px solid ${active ? '#f0b90b55' : '#2b2f36'};
            display:flex; align-items:center; justify-content:center;
            font-size:10px; font-weight:700; color:${active ? '#f0b90b' : '#848e9c'};
          ">${def.shortName.slice(0,4)}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:12px; color:${active ? '#eaecef' : '#848e9c'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${def.name}</div>
            <div style="font-size:10px; color:${def.type === 'overlay' ? '#38bdf855' : '#f59e0b55'}; margin-top:1px;">${def.type === 'overlay' ? 'Overlay' : 'Panel'}</div>
          </div>
          <div style="
            width:18px; height:18px; border-radius:50%; flex-shrink:0;
            background:${active ? '#26d994' : '#2b2f36'};
            border:1px solid ${active ? '#26d994' : '#3a3f47'};
            display:flex; align-items:center; justify-content:center;
            font-size:10px; color:${active ? '#0b0e11' : '#4a5060'};
          ">${active ? '✓' : ''}</div>
        `;
        row.addEventListener('mouseenter', () => { if (!window.INDICATORS.isActive(def.id)) row.style.background = '#1e2329'; });
        row.addEventListener('mouseleave', () => { row.style.background = window.INDICATORS.isActive(def.id) ? '#f0b90b0a' : ''; });
        row.addEventListener('click', () => selectIndicator(def.id));
        // ── Doble clic = toggle rápido sin abrir config ──
        row.addEventListener('dblclick', e => {
          e.stopPropagation();
          if (window.INDICATORS.isActive(def.id)) {
            window.INDICATORS.deactivate(def.id);
          } else {
            window.INDICATORS.activate(def.id);
          }
          renderList(document.getElementById('ind-search')?.value || '');
          renderBadge();
          renderChipsBar();
          draw();
          if (_selectedId === def.id) renderConfig(def.id);
        });
        list.appendChild(row);
      });
    }
    addGroup('Overlays (sobre el gráfico)', overlays);
    addGroup('Paneles (debajo del gráfico)', panels);
  }

  /* ── Indicador seleccionado → panel config ── */
  let _selectedId = null;
  function selectIndicator(id) {
    _selectedId = id;
    // Resaltar en la lista
    document.querySelectorAll('#ind-list [data-id]').forEach(r => {
      r.style.outline = r.dataset.id === id ? '1px solid #f0b90b44' : '';
    });
    renderConfig(id);
  }

  function renderConfig(id) {
    const panel = document.getElementById('ind-config-content');
    if (!panel) return;
    const def    = window.INDICATORS.getAll().find(d => d.id === id);
    if (!def) return;
    const active = window.INDICATORS.isActive(id);
    const params = active
      ? window.INDICATORS.getActive().find(x => x.def.id === id)?.params || {}
      : {};
    const defaults = {};
    (def.params || []).forEach(p => { defaults[p.key] = p.default; });
    const curParams = { ...defaults, ...params };

    panel.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px;">
        <div>
          <div style="color:#eaecef; font-size:14px; font-weight:700; margin-bottom:3px;">${def.name}</div>
          <div style="font-size:10px; color:${def.type === 'overlay' ? '#38bdf8' : '#f59e0b'};">
            ${def.type === 'overlay' ? '📊 Se dibuja sobre el gráfico principal' : '📉 Se dibuja en panel separado'}
          </div>
        </div>
        <button id="ind-toggle-btn" style="
          background:${active ? '#ff547022' : '#26d99422'};
          border:1px solid ${active ? '#ff5470' : '#26d994'};
          color:${active ? '#ff5470' : '#26d994'};
          border-radius:6px; font-size:11px; padding:6px 14px; cursor:pointer; font-weight:600;
          white-space:nowrap;
        ">${active ? '✕ Desactivar' : '✓ Activar'}</button>
      </div>

      <div id="ind-params-form" style="display:${def.params?.filter(p=>p.type!=='hidden').length ? 'block' : 'none'};">
        <div style="font-size:10px; color:#4a5060; text-transform:uppercase; letter-spacing:.6px; margin-bottom:10px;">Parámetros</div>
        <div id="ind-params-fields" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"></div>
      </div>
    `;

    // Campos de parámetros
    const fieldsEl = document.getElementById('ind-params-fields');
    (def.params || []).filter(p => p.type !== 'hidden').forEach(p => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
      let inputHTML = '';
      if (p.type === 'number') {
        inputHTML = `<input type="number" data-key="${p.key}" value="${curParams[p.key]}"
          min="${p.min ?? ''}" max="${p.max ?? ''}" step="${p.step ?? (p.default < 5 ? 0.1 : 1)}"
          style="background:#1e2329;border:1px solid #2b2f36;color:#eaecef;border-radius:5px;padding:6px 8px;font-size:12px;outline:none;width:100%;" />`;
      } else if (p.type === 'color') {
        inputHTML = `<div style="display:flex; gap:6px; align-items:center;">
          <input type="color" data-key="${p.key}" value="${curParams[p.key]}"
            style="width:32px;height:28px;border:none;background:none;cursor:pointer;padding:0;" />
          <input type="text" data-key-hex="${p.key}" value="${curParams[p.key]}"
            style="flex:1;background:#1e2329;border:1px solid #2b2f36;color:#eaecef;border-radius:5px;padding:5px 7px;font-size:11px;outline:none;" />
        </div>`;
      } else if (p.type === 'select') {
        const rawOpts = typeof p.options === 'function' ? p.options(candles) : (p.options || []);
        const opts = rawOpts.map(o =>
          `<option value="${o.v}" ${curParams[p.key] === o.v ? 'selected' : ''}>${o.l}</option>`
        ).join('');
        inputHTML = `<select data-key="${p.key}"
          style="background:#1e2329;border:1px solid #2b2f36;color:#eaecef;border-radius:5px;padding:6px 8px;font-size:12px;outline:none;width:100%;">${opts}</select>`;
      }
      wrap.innerHTML = `
        <label style="font-size:10px; color:#848e9c; text-transform:uppercase; letter-spacing:.4px;">${p.label}</label>
        ${inputHTML}
      `;
      fieldsEl.appendChild(wrap);
    });

    // Sincronizar color text↔picker
    fieldsEl.querySelectorAll('input[type=color]').forEach(picker => {
      const key    = picker.dataset.key;
      const hexInp = fieldsEl.querySelector(`[data-key-hex="${key}"]`);
      picker.addEventListener('input', () => { if (hexInp) hexInp.value = picker.value; applyParams(); });
      hexInp?.addEventListener('input', () => {
        if (/^#[0-9a-fA-F]{6,8}$/.test(hexInp.value)) { picker.value = hexInp.value.slice(0,7); applyParams(); }
      });
    });

    // Cambios numéricos y selects → aplicar en tiempo real
    fieldsEl.querySelectorAll('input[type=number], select').forEach(inp => {
      inp.addEventListener('input', applyParams);
      inp.addEventListener('change', applyParams);
    });

    // Toggle activo/inactivo
    document.getElementById('ind-toggle-btn')?.addEventListener('click', () => {
      if (window.INDICATORS.isActive(id)) {
        window.INDICATORS.deactivate(id);
      } else {
        window.INDICATORS.activate(id, collectParams());
      }
      renderList(document.getElementById('ind-search')?.value || '');
      renderConfig(id);
      renderBadge();
      renderChipsBar();
      draw();
    });

    function collectParams() {
      const p = {};
      fieldsEl.querySelectorAll('[data-key]').forEach(inp => {
        const key = inp.dataset.key;
        if (!key) return;
        const def2 = def.params?.find(pp => pp.key === key);
        if (inp.type === 'number') p[key] = parseFloat(inp.value) || 0;
        else p[key] = inp.value;
      });
      return p;
    }

    function applyParams() {
      if (!window.INDICATORS.isActive(id)) return;
      window.INDICATORS.setParams(id, collectParams());
      draw();
    }
  }

  /* ── Chips bar: indicadores activos sobre el gráfico ── */
  function renderChipsBar() {
    const bar = document.getElementById('ind-chips-bar');
    if (!bar) return;
    const actives = window.INDICATORS.getActive();
    bar.innerHTML = '';
    if (!actives.length) return;

    const lbl = document.createElement('span');
    lbl.className = 'ind-chip-label';
    lbl.textContent = 'ACTIVOS:';
    bar.appendChild(lbl);

    actives.forEach(({ def }) => {
      const chip = document.createElement('span');
      chip.className = 'ind-chip';
      chip.title = `${def.name}\nDoble clic para desactivar`;
      chip.innerHTML = `
        <span style="font-size:9px;opacity:.7;">${def.type === 'overlay' ? '📊' : '📉'}</span>
        ${def.shortName}
        <span class="chip-x" title="Quitar">×</span>
      `;
      // Clic en la × → desactivar
      chip.querySelector('.chip-x').addEventListener('click', e => {
        e.stopPropagation();
        window.INDICATORS.deactivate(def.id);
        renderChipsBar();
        renderBadge();
        renderList(document.getElementById('ind-search')?.value || '');
        if (_selectedId === def.id) renderConfig(def.id);
        draw();
      });
      // Clic en el chip → abrir modal en ese indicador
      chip.addEventListener('click', () => {
        openIndicatorModal();
        setTimeout(() => selectIndicator(def.id), 30);
      });
      bar.appendChild(chip);
    });
  }

  /* ── Badge contador de activos ── */
  function renderBadge() {
    const badge = document.getElementById('ind-active-badge');
    const btn   = document.getElementById('ind-btn');
    if (!badge) return;
    const n = window.INDICATORS.getActive().length;
    if (n > 0) {
      badge.textContent = `${n} activo${n !== 1 ? 's' : ''}`;
      badge.style.display = 'inline-block';
      if (btn) { btn.classList.add('active'); btn.innerHTML = `📈 Indicadores <span style="background:#f0b90b;color:#0b0e11;border-radius:8px;padding:0 5px;font-size:9px;font-weight:700;margin-left:2px;">${n}</span>`; }
    } else {
      badge.style.display = 'none';
      if (btn) { btn.classList.remove('active'); btn.innerHTML = '📈 Indicadores'; }
    }
  }

  // Inicializar badge y chips
  setTimeout(() => { renderBadge(); renderChipsBar(); }, 200);

})();
