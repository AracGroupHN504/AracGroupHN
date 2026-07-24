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
   COLOR DE VELAS — configurable
═══════════════════════════════════════ */
const CANDLE_COLORS_DEFAULT = { up: '#26d994', down: '#ff5470' };
let CANDLE_COLORS = { ...CANDLE_COLORS_DEFAULT };

function hexToRgbaG(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function darkenHex(hex, amt) {
  const h = hex.replace('#', '');
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(parseInt(h.substring(0, 2), 16) * (1 - amt));
  const g = clamp(parseInt(h.substring(2, 4), 16) * (1 - amt));
  const b = clamp(parseInt(h.substring(4, 6), 16) * (1 - amt));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
function applyCandleColorVars() {
  document.documentElement.style.setProperty('--candle-up',   CANDLE_COLORS.up);
  document.documentElement.style.setProperty('--candle-down', CANDLE_COLORS.down);
}

/* ═══════════════════════════════════════
   SESIONES — DEFAULTS
═══════════════════════════════════════ */
const SESS_DEFAULTS = [
  { key:'sydney',   name:'Sydney',      color:'#38bdf8', colorBright:'#7dd3fc', startUtcH:23, endUtcH:31, solapStart:23, solapEnd:24, enabled:true },
  { key:'tokyo',    name:'Tokio',       color:'#b13e3e', colorBright:'#cc8282', startUtcH:0,  endUtcH:9,  solapStart:0,  solapEnd:9,  enabled:true },
  { key:'london',   name:'Londres',     color:'#c084fc', colorBright:'#e879f9', startUtcH:7,  endUtcH:16, solapStart:9,  solapEnd:12, enabled:true },
  { key:'newyork',  name:'New York',    color:'#10b981', colorBright:'#34d399', startUtcH:12, endUtcH:21, solapStart:16, solapEnd:21, enabled:true },
  { key:'nomarket', name:'Sin mercado', color:'#3a3f47', colorBright:'#5a6272', startUtcH:21, endUtcH:23, solapStart:21, solapEnd:23, enabled:true },
];

/* Config estilo "captura" — Sydney/Londres/Sin mercado inactivas,
   Tokio y New York activas con sus horas doradas propias. */
const SESS_PRESET_1 = [
  { key:'sydney',   name:'Sydney',      color:'#38bdf8', colorBright:'#7dd3fc', startUtcH:23, endUtcH:7,  solapStart:23, solapEnd:0,  enabled:false },
  { key:'tokyo',    name:'Tokio',       color:'#b13e3e', colorBright:'#cc8282', startUtcH:23, endUtcH:8,  solapStart:0,  solapEnd:7,  enabled:true  },
  { key:'london',   name:'Londres',     color:'#c084fc', colorBright:'#e879f9', startUtcH:7,  endUtcH:16, solapStart:9,  solapEnd:12, enabled:false },
  { key:'newyork',  name:'New York',    color:'#10b981', colorBright:'#34d399', startUtcH:9,  endUtcH:22, solapStart:12, solapEnd:16, enabled:true  },
  { key:'nomarket', name:'Sin mercado', color:'#3a3f47', colorBright:'#5a6272', startUtcH:21, endUtcH:23, solapStart:21, solapEnd:23, enabled:false },
];

/* ═══════════════════════════════════════
   SESIONES — CONFIGURACIONES GUARDADAS (PRESETS)
   Permite crear varias configuraciones de sesiones,
   elegir cuál se usa y marcar cuál es la predeterminada.
═══════════════════════════════════════ */
const PRESETS_KEY = 'vm_terminal_sess_presets_v1';

function clonePresetSessions(arr) { return arr.map(s => ({ ...s })); }

function seedPresets() {
  return [
    { id: 'preset-1', name: 'Predeterminada 1', sessions: clonePresetSessions(SESS_PRESET_1) },
    { id: 'preset-2', name: 'Predeterminada 2', sessions: clonePresetSessions(SESS_DEFAULTS) },
  ];
}

function loadPresetsData() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.presets) || !parsed.presets.length) return null;
    return parsed;
  } catch (e) { return null; }
}

const _presetsData   = loadPresetsData();
let sessPresets       = _presetsData ? _presetsData.presets : seedPresets();
let defaultPresetId   = (_presetsData && sessPresets.some(p => p.id === _presetsData.defaultPresetId))
  ? _presetsData.defaultPresetId : sessPresets[0].id;
let activePresetId    = (_presetsData && sessPresets.some(p => p.id === _presetsData.activePresetId))
  ? _presetsData.activePresetId : defaultPresetId;

function savePresetsData() {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify({ presets: sessPresets, defaultPresetId, activePresetId }));
  } catch (e) { console.warn('[presets] No se pudo guardar:', e); }
}
if (!_presetsData) savePresetsData();

/* Migración de una sola vez: si el navegador ya tenía guardado el preset
   "preset-1" con horas viejas (de antes de este cambio de código), lo
   reemplaza por los valores actuales de SESS_PRESET_1. Sin esto, un
   "Restablecer" podía revivir horas desactualizadas guardadas de antes. */
const PRESET1_SYNC_KEY = 'vm_terminal_preset1_sync_v2';
if (_presetsData && !localStorage.getItem(PRESET1_SYNC_KEY)) {
  const p1 = sessPresets.find(p => p.id === 'preset-1');
  if (p1) p1.sessions = clonePresetSessions(SESS_PRESET_1);
  savePresetsData();
  try { localStorage.setItem(PRESET1_SYNC_KEY, '1'); } catch (e) {}
}

/* Migración de una sola vez: fuerza el nuevo color de Tokio (#b13e3e)
   en todas las configuraciones ya guardadas, para que el cambio se vea
   sin tener que borrar el localStorage o pulsar "Restaurar valores
   originales". */
const TOKYO_COLOR_SYNC_KEY = 'vm_terminal_tokyo_color_sync_v1';
const _tokyoColorNeedsSync = !localStorage.getItem(TOKYO_COLOR_SYNC_KEY);
if (_presetsData && _tokyoColorNeedsSync) {
  sessPresets.forEach(p => {
    const t = p.sessions.find(s => s.key === 'tokyo');
    if (t) { t.color = '#b13e3e'; t.colorBright = '#cc8282'; }
  });
  savePresetsData();
}
try { localStorage.setItem(TOKYO_COLOR_SYNC_KEY, '1'); } catch (e) {}

function getPresetById(id) { return sessPresets.find(p => p.id === id) || sessPresets[0]; }

let VM_SESSIONS = clonePresetSessions(getPresetById(activePresetId).sessions).filter(s => s.enabled);
let sessConfig  = clonePresetSessions(getPresetById(activePresetId).sessions);

/* ═══════════════════════════════════════
   ESTADO
═══════════════════════════════════════ */
let symbol     = 'BTCUSDT';
let daysCount  = 30;
let rawCandles = [];
let candles    = [];
let camX       = -1;
let snapToEnd  = true;
let isLoadingMore  = false;   // true mientras se está pidiendo historial extra hacia atrás
let noMoreHistory  = false;   // true cuando Binance ya no tiene velas más antiguas
let zoomLevel  = 1.0;
let isDragging = false, dragStartX = 0, dragStartCamX = 0;
let dragStartY = 0, dragStartPriceMin = 0, dragStartPriceMax = 0;
let mouseX = -1, mouseY = -1;
let lastPrice  = 0;
let rulerMode  = false, rulerActive = false, rulerLocked = false;
let rulerTempActive = false; // true si la regla se activó sosteniendo click derecho (se apaga sola al soltar)

// ── Escala de precio manual (drag vertical en el eje de precio, estilo TradingView) ──
let manualScale     = false;  // true = usuario ajustó manualmente, se desactiva el auto-fit
let manualPriceMin  = 0, manualPriceMax = 0;
let isPriceDragging = false;
let priceDragStartY = 0, priceDragBaseMin = 0, priceDragBaseMax = 0;
// Última escala calculada en el draw más reciente (para que los handlers de mouse la lean)
let lastPriceMin = 0, lastPriceMax = 0, lastPADR = 84, lastPADT = 18, lastChartH = 0;
let lastTimeBarY = 0, lastPADB = 36, lastPADL = 8, lastW = 0;

// ── Zoom horizontal manual (drag en el eje de tiempo, estilo TradingView) ──
let isTimeDragging  = false;
let timeDragStartX  = 0, timeDragStartMx = 0, timeDragBaseZoom = 1, timeDragBaseCamX = 0;
let _drawScheduled = false;
function scheduleDraw() {
  if (_drawScheduled) return;
  _drawScheduled = true;
  requestAnimationFrame(() => { _drawScheduled = false; draw(); });
}
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
   PERSISTENCIA — localStorage
   Guarda: símbolo, temporalidad, días, sesiones,
   indicadores activos (y sus parámetros).
═══════════════════════════════════════ */
const STORAGE_KEY = 'vm_terminal_state_v1';
let _saveStateTimer = null;

function saveState() {
  // Pequeño debounce para no saturar localStorage con inputs tipo range/number
  clearTimeout(_saveStateTimer);
  _saveStateTimer = setTimeout(() => {
    try {
      const state = {
        symbol, daysCount, chartMode, activeTF,
        sessConfig,
        candleColors: CANDLE_COLORS,
        panelHeightRatio,
        indicators: (window.INDICATORS ? window.INDICATORS.getActive() : [])
          .map(a => ({ id: a.def.id, params: a.params })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { console.warn('[state] No se pudo guardar:', e); }
  }, 150);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* Aplica el estado guardado ANTES del primer fetchCandles() */
function applySavedState() {
  const st = loadState();
  if (!st) return;

  if (st.symbol)                        symbol    = st.symbol;
  if (Number.isFinite(st.daysCount))    daysCount = st.daysCount;
  if (st.chartMode) {
    chartMode   = st.chartMode;
    activeTF    = st.activeTF || st.chartMode;
    activeTF_MS = TF_MS[activeTF] || TF_MS['15m'];
  }
  if (Array.isArray(st.sessConfig) && st.sessConfig.length) {
    sessConfig  = st.sessConfig.map(s => ({ ...s }));
    if (_tokyoColorNeedsSync) {
      const t = sessConfig.find(s => s.key === 'tokyo');
      if (t) { t.color = '#b13e3e'; t.colorBright = '#cc8282'; }
    }
    VM_SESSIONS = sessConfig.filter(s => s.enabled).map(s => ({ ...s }));
  }
  if (st.candleColors && st.candleColors.up && st.candleColors.down) {
    CANDLE_COLORS = { up: st.candleColors.up, down: st.candleColors.down };
  }
  applyCandleColorVars();
  if (Number.isFinite(st.panelHeightRatio)) panelHeightRatio = st.panelHeightRatio;

  // Reflejar en la UI
  const symEl = document.getElementById('sym-input');
  if (symEl) symEl.value = symbol;
  const daysSel = document.getElementById('days-select');
  if (daysSel) {
    daysSel.value = String(daysCount);
    // Si el valor guardado no coincide con ninguna <option> (por estados
    // viejos guardados antes de este arreglo), el <select> queda en
    // blanco. En ese caso, se ajusta a la opción disponible más cercana.
    if (daysSel.value !== String(daysCount)) {
      const opts = [...daysSel.options].map(o => parseInt(o.value, 10));
      const closest = opts.reduce((a, b) =>
        Math.abs(b - daysCount) < Math.abs(a - daysCount) ? b : a, opts[0]);
      daysCount = closest;
      daysSel.value = String(closest);
    }
  }
  document.querySelectorAll('.tf-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.tf === chartMode);
  });
  if (typeof updateFooter === 'function') updateFooter();
  if (typeof updateLegend === 'function') updateLegend();

  // Restaurar indicadores activos (indicators.js ya registró todos los defs)
  if (Array.isArray(st.indicators) && window.INDICATORS) {
    st.indicators.forEach(({ id, params }) => {
      if (window.INDICATORS.getAll().some(d => d.id === id)) {
        window.INDICATORS.activate(id, params);
      }
    });
  }
}

/* ═══════════════════════════════════════
   DOM
═══════════════════════════════════════ */
const cv      = document.getElementById('cv');
const ctx     = cv.getContext('2d');
const wrap    = document.getElementById('chart-wrap');
const loading = document.getElementById('loading');
const errEl   = document.getElementById('err');
const jumpLatestBtn = document.getElementById('jump-latest-btn');

// Guardan el último maxCam/step calculados en draw(), para saber si el
// usuario se alejó de la vela más reciente (botón estilo TradingView).
let lastMaxCamG = 0, lastStepG = 1;
function updateJumpLatestBtn() {
  if (!jumpLatestBtn) return;
  const awayFromEnd = candles.length && camX < lastMaxCamG - lastStepG * 2;
  jumpLatestBtn.classList.toggle('show', !!awayFromEnd);
}
if (jumpLatestBtn) {
  jumpLatestBtn.addEventListener('click', () => {
    snapToEnd = true;
    draw();
  });
}
const wsDot   = document.getElementById('ws-dot');
const wsLbl   = document.getElementById('ws-label');
const rulerBtn = document.getElementById('ruler-btn');
const chartResetBtn = document.getElementById('reset-btn');
chartResetBtn.addEventListener('click', () => {
  const ok = confirm('Esto restablece el zoom, la escala del gráfico y toda la configuración guardada (símbolo, sesiones, colores, indicadores activos, capital/comisión de Solapamientos), volviendo a los valores originales del código. ¿Continuar?');
  if (!ok) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PRESETS_KEY);
    localStorage.removeItem(PRESET1_SYNC_KEY);
    localStorage.removeItem('vm_solape_calc_v1');
  } catch (e) { console.warn('[reset] No se pudo limpiar localStorage:', e); }
  location.reload();
});

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
  const loadEl = document.getElementById('loading-text');
  loadEl.textContent = 'Cargando datos...';
  loading.style.display = 'flex';
  errEl.style.display   = 'none';
  closeWS();
  rawCandles = [];
  candles    = [];
  noMoreHistory = false;
  manualScale = false; // nuevo símbolo/TF/rango → volver a auto-ajuste vertical

  try {
    const CHUNK    = 1500;
    // Blindaje: si daysCount llegó corrupto (NaN, negativo, o un número
    // enorme heredado de un estado viejo guardado), Binance responde
    // HTTP 400 porque el startTime calculado queda inválido (negativo o
    // antes de época). Se acota a un rango razonable sin tocar el valor
    // que se ve en el <select> (eso ya se resuelve en applySavedState).
    const safeDays = Number.isFinite(daysCount) ? Math.min(Math.max(daysCount, 1), 365) : 30;
    const startG   = Date.now() - safeDays * 24 * 60 * 60 * 1000;
    let curStart   = startG;
    const endG     = Date.now();
    let allData    = [], ci = 0;

    const fetchTF  = TF_BINANCE[chartMode] || activeTF;  // TF real para la API
    const fetchTFMS = TF_MS[fetchTF] || activeTF_MS;

    while (curStart < endG) {
      ci++;
      const pct = Math.min(99, Math.round(((curStart - startG) / (endG - startG)) * 100));
      loadEl.textContent = `Cargando datos... ${pct}%`;
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${fetchTF}&limit=${CHUNK}&startTime=${curStart}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.length) break;
      allData = allData.concat(data);
      curStart = +data[data.length - 1][0] + fetchTFMS;
      if (data.length < CHUNK) break;
    }
    loadEl.textContent = 'Cargando datos... 100%';

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

/* ═══════════════════════════════════════
   CARGAR MÁS HISTORIAL (hacia atrás)
   Se dispara solo cuando el usuario se acerca al borde
   izquierdo del gráfico, para que nunca se quede sin datos.
═══════════════════════════════════════ */
async function loadMoreHistory() {
  if (isLoadingMore || noMoreHistory || !rawCandles.length) return;
  isLoadingMore = true;
  try {
    const CHUNK     = 1500;
    const fetchTF   = TF_BINANCE[chartMode] || activeTF;
    const fetchTFMS = TF_MS[fetchTF] || activeTF_MS;
    const oldestT   = rawCandles[0].t;
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${fetchTF}&limit=${CHUNK}&endTime=${oldestT - 1}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.length) { noMoreHistory = true; return; }

    const seen = new Set(rawCandles.map(c => c.t));
    const older = data
      .map(d => ({ t:+d[0], o:+d[1], h:+d[2], l:+d[3], c:+d[4], v:+d[5], closed: true }))
      .filter(c => !seen.has(c.t))
      .sort((a, b) => a.t - b.t);

    if (!older.length) { noMoreHistory = true; return; }

    const prevCandleCount = candles.length;
    rawCandles = older.concat(rawCandles);
    // Tope de seguridad para no crecer sin límite en sesiones muy largas
    // (se recorta por el lado viejo, conservando siempre lo más reciente)
    if (rawCandles.length > 60000) rawCandles = rawCandles.slice(rawCandles.length - 60000);
    window.rawCandles = rawCandles;
    // OJO: no tocar `daysCount` aquí. Esa variable está atada al <select>
    // "Días" (y se persiste en localStorage); si se pisaba con el rango
    // real ya cargado (ej. 47, 132...) terminaba guardando un valor que
    // no coincide con ninguna <option>, y al recargar la página el
    // <select> se quedaba en blanco. El scroll hacia atrás sigue
    // cargando historial normalmente sin necesidad de mutarla.

    buildCandles();

    // Mantener la vista donde estaba: como se agregaron velas al inicio,
    // hay que compensar camX para que no "salte" el gráfico
    const addedCount = candles.length - prevCandleCount;
    if (addedCount > 0) {
      const W2    = cv.width / devicePixelRatio;
      const vis   = candles.length;
      const bw2   = Math.max(1, Math.min(200, ((W2 - 8 - 84) / Math.min(vis, 500)) * zoomLevel));
      const step2 = bw2 + Math.max(1, bw2 * 0.15);
      camX += addedCount * step2;
    }
  } catch (e) {
    console.error('[loadMoreHistory]', e);
  } finally {
    isLoadingMore = false;
    draw();
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
  lastMaxCamG = maxCam; lastStepG = step;

  const startIdx = Math.max(0, Math.floor(camX / step));
  const visCount = Math.ceil((W - PADL - PADR) / step) + 2;
  const endIdx   = Math.min(candles.length - 1, startIdx + visCount);
  const slice    = candles.slice(startIdx, endIdx + 1);
  if (!slice.length) return;

  // Cerca del borde izquierdo → pedir más historial antes de que el usuario lo alcance
  if (startIdx < 150 && !isLoadingMore && !noMoreHistory) loadMoreHistory();

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < slice.length; i++) { if (slice[i].l < lo) lo = slice[i].l; if (slice[i].h > hi) hi = slice[i].h; }
  const pd = (hi - lo) * 0.07 || lo * 0.01 || 1;
  const autoMin = lo - pd, autoMax = hi + pd;
  const priceMin = manualScale ? manualPriceMin : autoMin;
  const priceMax = manualScale ? manualPriceMax : autoMax;
  const pxPer = chartH / (priceMax - priceMin);
  const py    = price => PADT + chartH - (price - priceMin) * pxPer;
  const barX  = idx   => PADL + idx * step - camX;

  // Guardar para que mousedown/mousemove puedan leer la escala vigente
  lastPriceMin = priceMin; lastPriceMax = priceMax;
  lastPADR = PADR; lastPADT = PADT; lastChartH = chartH;
  lastTimeBarY = timeBarY; lastPADB = PADB; lastPADL = PADL; lastW = W;

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

  // Indicador de escala de precio manual (doble clic en el eje para volver a auto)
  if (manualScale) {
    ctx.font = '10px monospace'; ctx.fillStyle = '#f0b90bcc'; ctx.textAlign = 'right';
    ctx.fillText('🔒 Escala manual (doble clic para auto-ajustar)', W - PADR - 6, PADT + 28);
  }

  // Indicador sutil: cargando más historial hacia atrás
  if (isLoadingMore) {
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#f0b90bcc'; ctx.textAlign = 'left';
    ctx.fillText('⏳ Cargando historial…', PADL + 6, PADT + 14);
  }

  // Velas de sesión
  slice.forEach((c, i) => {
    const xi = startIdx + i, x = barX(xi);
    if (x < PADL - barW * 2 || x > W - PADR + barW) return;
    const midX   = x + barW / 2;
    const yo = py(c.o), yc = py(c.c), yh = py(c.h), yl = py(c.l);
    const bodyTop = Math.min(yo, yc);
    const bodyH   = Math.max(1, Math.abs(yc - yo));

    const bull   = c.c >= c.o;
    const upCol  = CANDLE_COLORS.up, dnCol = CANDLE_COLORS.down;
    const col    = c.color || (bull ? upCol : dnCol);

    if (!c.closed)         { ctx.fillStyle = hexToRgbaG(bull ? upCol : dnCol, 0.07); ctx.fillRect(x - gap/2, PADT, barW + gap, chartH); }
    if (xi === hoveredIdx) { ctx.fillStyle = '#ffffff10'; ctx.fillRect(x - gap/2, PADT, barW + gap, chartH); }

    ctx.strokeStyle = bull ? upCol : dnCol; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(midX, yh); ctx.lineTo(midX, bodyTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(midX, bodyTop + bodyH); ctx.lineTo(midX, yl); ctx.stroke();

    if (bodyH > 1) {
      const grad = ctx.createLinearGradient(x, bodyTop, x, bodyTop + bodyH);
      if (bull) { grad.addColorStop(0, hexToRgbaG(upCol, 0.6)); grad.addColorStop(1, hexToRgbaG(darkenHex(upCol, 0.3), 0.4)); }
      else       { grad.addColorStop(0, hexToRgbaG(dnCol, 0.53)); grad.addColorStop(1, hexToRgbaG(darkenHex(dnCol, 0.2), 0.6)); }
      ctx.fillStyle = grad;
      ctx.fillRect(x, bodyTop, barW, bodyH);
    }
    ctx.strokeStyle = bull ? upCol : dnCol; ctx.lineWidth = 1.5;
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
  const lineCol = last.c >= last.o ? CANDLE_COLORS.up : CANDLE_COLORS.down;
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
      // Duración legible entre apertura y cierre: si pasa de 24h se
      // expresa en días + horas ("1 día y 6 horas"), si no en horas/min.
      function fmtDuracion(ms) {
        if (!ms || ms < 0) return '';
        const totalMin = Math.round(ms / 60000);
        const dias  = Math.floor(totalMin / 1440);
        const horas = Math.floor((totalMin % 1440) / 60);
        const mins  = totalMin % 60;
        if (dias > 0) {
          let s = dias + (dias === 1 ? ' día' : ' días');
          if (horas > 0) s += ' y ' + horas + (horas === 1 ? ' hora' : ' horas');
          return s;
        }
        if (horas > 0) {
          let s = horas + (horas === 1 ? ' hora' : ' horas');
          if (mins > 0) s += ' ' + mins + 'm';
          return s;
        }
        return mins + ' min';
      }
      const sessCol = hc.color || (bull2 ? CANDLE_COLORS.up : CANDLE_COLORS.down);
      const durTxt = fmtDuracion(hc.tClose - hc.t);
      const rows = [
        { label: null, val: (hc.sessionName||tvLabel(hc.t))+(hc.isSolape?' ⚡':''), hora:null, color:sessCol,  bold:true,  size:11 },
        { label: null, val: tvLabel(hc.t) + ' → ' + fmtHora(hc.tClose) + (durTxt ? '  (' + durTxt + ')' : ''), hora:null, color:'#848e9c',bold:false, size:10 },
        { label: 'A:',  val: fmtPrice(hc.o), hora:fmtHora(hc.t),       color:'#eaecef',                        bold:false, size:11 },
        { label: 'C:',  val: fmtPrice(hc.c), hora:fmtHora(hc.tClose),  color:bull2?CANDLE_COLORS.up:CANDLE_COLORS.down,        bold:false, size:11 },
        { label: 'Mx:', val: fmtPrice(hc.h), hora:fmtHora(hc.tHigh),  color:CANDLE_COLORS.up,                        bold:false, size:11 },
        { label: 'Mn:', val: fmtPrice(hc.l), hora:fmtHora(hc.tLow),   color:CANDLE_COLORS.down,                        bold:false, size:11 },
        { label: 'V:',  val: fmtVol(hc.v),   hora:null,                color:'#848e9c',                        bold:false, size:11 },
      ];
      if (!hc.closed) rows.push({ label:null, val:'● En vivo', hora:null, color:'#f0b90b', bold:true, size:11 });

      ctx.font = '10px sans-serif';
      const rangeRowW = ctx.measureText(rows[1].val).width;
      const LH = 17, PAD = 10, tw3 = Math.max(230, rangeRowW + PAD * 2 + 4);
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
    const col   = pDiff >= 0 ? CANDLE_COLORS.up : CANDLE_COLORS.down;
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

  updateJumpLatestBtn();
}

/* ═══════════════════════════════════════
   EVENTOS UI
═══════════════════════════════════════ */
const symInput = document.getElementById('sym-input');

/* ── Resolución automática de símbolo ──────────────────────────────
   Deja escribir "BONK", "BONKUSDT" o "1000BONK" y arma el símbolo real
   de Binance Futures (ej. "1000BONKUSDT") usando el listado oficial
   (exchangeInfo), porque muchas monedas solo cotizan con un prefijo
   multiplicador (1000, 1000000, etc.) que nadie se acuerda de escribir. */
let ALL_SYMBOLS = [];               // [{ symbol, baseAsset, quoteAsset }]
let symbolSet   = new Set();
let coreIndex   = new Map();        // "CORE|QUOTE" → [symbols], más corto primero

async function loadExchangeSymbols() {
  try {
    const r = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
    const j = await r.json();
    const list = (j.symbols || []).filter(s => s.status === 'TRADING');
    ALL_SYMBOLS = list.map(s => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }));
    symbolSet = new Set(ALL_SYMBOLS.map(s => s.symbol));
    coreIndex = new Map();
    ALL_SYMBOLS.forEach(({ symbol, baseAsset, quoteAsset }) => {
      const core = baseAsset.replace(/^\d+/, '') || baseAsset; // "1000BONK" → "BONK"
      const key  = core + '|' + quoteAsset;
      if (!coreIndex.has(key)) coreIndex.set(key, []);
      coreIndex.get(key).push(symbol);
    });
    coreIndex.forEach(arr => arr.sort((a, b) => a.length - b.length)); // sin prefijo primero
  } catch (e) {
    console.warn('No se pudo cargar exchangeInfo (resolución automática de símbolo limitada):', e);
  }
}
loadExchangeSymbols();

const QUOTE_ASSETS = ['USDT', 'USDC', 'BUSD', 'USD'];

function resolveSymbolInput(raw) {
  const s = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  if (symbolSet.has(s)) return s;             // ya es un símbolo válido tal cual

  // separar quote (si el usuario lo escribió) del base
  let quote = 'USDT', base = s;
  for (const q of QUOTE_ASSETS) {
    if (s.length > q.length && s.endsWith(q)) { quote = q; base = s.slice(0, -q.length); break; }
  }

  // intento directo: lo que escribió + el quote, tal cual (cubre "1000BONK" → "1000BONKUSDT")
  const direct = base + quote;
  if (symbolSet.has(direct)) return direct;

  // buscar por el "core" del activo sin prefijo numérico (cubre "BONK" → "1000BONKUSDT")
  const core = base.replace(/^\d+/, '');
  if (!core) return null;
  const matches = coreIndex.get(core + '|' + quote);
  if (matches && matches.length) return matches[0]; // ya viene ordenado: sin prefijo primero

  return null; // sin match conocido — se deja lo escrito y que el fetch avise si no existe
}

function applySymbol() {
  const raw = symInput.value.trim().toUpperCase();
  if (!raw) return;
  const resolved = resolveSymbolInput(raw) || raw;
  symInput.value = resolved;
  symbol = resolved;
  fetchCandles();
  saveState();
}
symInput.addEventListener('change', applySymbol);

/* ── Desplegable propio de monedas (reemplaza el <datalist> nativo,
      que en móvil abría con animación doble y filtraba mal) ── */
const CURATED_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT',
  'AVAXUSDT','LTCUSDT','LINKUSDT','MATICUSDT','DOTUSDT','UNIUSDT','NEARUSDT',
  'ATOMUSDT','WLDUSDT','APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT',
  'PEPEUSDT','WIFUSDT','JUPUSDT','ONDOUSDT',
];
const symDropdown = document.getElementById('sym-dropdown');
const symArrowBtn = document.getElementById('sym-arrow');
let symPrevValue = symInput.value;
let symHlIdx = -1;

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h < 0 ? h + 360 : h;
}
function splitSymbolDisplay(sym) {
  let quote = 'USDT';
  for (const q of QUOTE_ASSETS) { if (sym.length > q.length && sym.endsWith(q)) { quote = q; break; } }
  const base = sym.slice(0, sym.length - quote.length);
  const m = base.match(/^(\d+)/);
  const prefix = m ? m[1] : null;
  const core = prefix ? base.slice(prefix.length) : base;
  return { core: core || base, quote, prefix };
}
/* CDN con logos reales de monedas (mismo set que usa Binance). Si una
   moneda no está en el listado, la imagen falla y se hace fallback
   automático al círculo de color con la inicial (comportamiento previo). */
const COIN_ICON_CDN = 'https://cdn.jsdelivr.net/gh/prasangapokharel/crypto-icons@v1.0.0/binance/';
function symOptionHTML(sym) {
  const { core, quote, prefix } = splitSymbolDisplay(sym);
  const hue = hashHue(core);
  const iconUrl = COIN_ICON_CDN + encodeURIComponent(core.toUpperCase()) + '.png';
  return `
    <div class="sym-opt" data-sym="${sym}">
      <span class="sym-badge" style="background:hsl(${hue} 55% 20%); color:hsl(${hue} 85% 68%);">
        <img src="${iconUrl}" alt="" loading="lazy" onerror="this.remove();" />
        <span class="sym-badge-fallback">${core.charAt(0) || '?'}</span>
      </span>
      <span class="sym-txt">${prefix ? `<span class="sym-prefix">${prefix}x</span>` : ''}<span class="sym-core">${core}</span><span class="sym-quote">${quote}</span></span>
    </div>`;
}

function renderSymDropdown(filterText) {
  const q = (filterText || '').trim().toUpperCase();
  let items, label;
  if (!q) {
    items = CURATED_SYMBOLS; label = 'Populares';
  } else if (ALL_SYMBOLS.length) {
    // busca en TODO el listado real de Binance, por símbolo o por el
    // activo sin prefijo (así "BONK" también encuentra "1000BONKUSDT")
    items = ALL_SYMBOLS
      .filter(s => s.symbol.includes(q) || s.baseAsset.replace(/^\d+/, '').includes(q))
      .map(s => s.symbol)
      .slice(0, 40);
    label = 'Resultados';
  } else {
    items = CURATED_SYMBOLS.filter(s => s.includes(q));
    label = 'Resultados';
  }
  symHlIdx = -1;
  symDropdown.innerHTML = items.length
    ? `<div class="sym-dd-label">${label}</div>${items.map(symOptionHTML).join('')}`
    : `<div class="sym-opt empty">🔍 Sin coincidencias</div>`;
}
function openSymDropdown(filterText) {
  renderSymDropdown(filterText);
  symDropdown.classList.add('open');
}
function closeSymDropdown() {
  symDropdown.classList.remove('open');
  symHlIdx = -1;
}
function highlightSymOpt(opts) {
  opts.forEach((o, i) => o.classList.toggle('hl', i === symHlIdx));
  if (opts[symHlIdx]) opts[symHlIdx].scrollIntoView({ block: 'nearest' });
}
function pickSym(sym) {
  symInput.value = sym;
  applySymbol();
  closeSymDropdown();
}

// mousedown (no click) + preventDefault: evita que el input pierda foco
// (blur) antes de registrar la selección.
symDropdown.addEventListener('mousedown', e => {
  const opt = e.target.closest('.sym-opt[data-sym]');
  if (!opt) return;
  e.preventDefault();
  pickSym(opt.dataset.sym);
});

symInput.addEventListener('focus', () => {
  symPrevValue = symInput.value;
  openSymDropdown('');
});
// Selecciona todo el texto con UN solo clic (no hace falta doble clic).
// preventDefault en mouseup evita que el navegador coloque el cursor en
// el punto exacto del clic, que es lo que pisaría la selección.
symInput.addEventListener('mouseup', e => {
  e.preventDefault();
  symInput.select();
});
symInput.addEventListener('input', () => openSymDropdown(symInput.value));
symArrowBtn.addEventListener('click', () => {
  symInput.focus();
  openSymDropdown(symDropdown.classList.contains('open') ? symInput.value : '');
});
symInput.addEventListener('blur', () => {
  closeSymDropdown();
  if (!symInput.value.trim()) symInput.value = symPrevValue;
});
symInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const opts = [...symDropdown.querySelectorAll('.sym-opt[data-sym]')];
    if (symHlIdx >= 0 && opts[symHlIdx]) { pickSym(opts[symHlIdx].dataset.sym); return; }
    applySymbol();
    closeSymDropdown();
    return;
  }
  if (e.key === 'Escape') { closeSymDropdown(); symInput.blur(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const opts = [...symDropdown.querySelectorAll('.sym-opt[data-sym]')];
    if (!opts.length) return;
    e.preventDefault();
    symHlIdx = e.key === 'ArrowDown'
      ? Math.min(symHlIdx + 1, opts.length - 1)
      : Math.max(symHlIdx - 1, 0);
    highlightSymOpt(opts);
  }
});

document.getElementById('days-select').addEventListener('change', e => {
  daysCount = parseInt(e.target.value, 10);
  fetchCandles();
  saveState();
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
    saveState();
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

// El click derecho es para sostener y usar la regla — no tiene que abrir el
// menú contextual del navegador.
cv.addEventListener('contextmenu', e => e.preventDefault());

cv.addEventListener('mousedown', e => {
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const W2 = cv.width / devicePixelRatio;

  // ── Click derecho sostenido = regla temporal ──
  // Si la regla no estaba ya activada (con el botón 📏 o la tecla R), el
  // click derecho la prende solo por el tiempo que se mantenga apretado.
  // Si ya estaba activada de forma persistente, el click derecho no la
  // apaga al soltar — se respeta el modo que el usuario dejó puesto.
  if (e.button === 2) {
    if (!rulerMode) {
      rulerMode = true; rulerTempActive = true;
      rulerBtn.classList.add('active');
    }
    e.preventDefault();
  }

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

  // ── Arrastrar en el eje de precio (derecha) → escala vertical manual, estilo TradingView ──
  if (!rulerMode && mx > W2 - lastPADR && my >= lastPADT && my <= lastPADT + lastChartH) {
    isPriceDragging  = true;
    priceDragStartY  = e.clientY;
    priceDragBaseMin = manualScale ? manualPriceMin : lastPriceMin;
    priceDragBaseMax = manualScale ? manualPriceMax : lastPriceMax;
    cv.style.cursor = 'ns-resize';
    return;
  }

  // ── Arrastrar en el eje de tiempo (abajo) → zoom horizontal, estilo TradingView ──
  if (!rulerMode && my >= lastTimeBarY && my <= lastTimeBarY + lastPADB && mx >= lastPADL && mx <= lastW - lastPADR) {
    isTimeDragging    = true;
    timeDragStartX    = e.clientX;
    timeDragStartMx   = mx;
    timeDragBaseZoom  = zoomLevel;
    timeDragBaseCamX  = camX;
    cv.style.cursor = 'ew-resize';
    return;
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
  dragStartY = e.clientY;
  dragStartPriceMin = manualScale ? manualPriceMin : lastPriceMin;
  dragStartPriceMax = manualScale ? manualPriceMax : lastPriceMax;
  cv.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', e => {
  const rect = cv.getBoundingClientRect();
  mouseX = e.clientX - rect.left; mouseY = e.clientY - rect.top;
  const W2 = cv.width / devicePixelRatio;

  // ── Arrastrar para redimensionar panel ──
  if (isPanelResizing) {
    const H = cv.height / devicePixelRatio;
    const dy = panelResizeStartY - e.clientY;  // arrastrar arriba = más grande
    const newRatio = panelResizeStartRatio + dy / H;
    panelHeightRatio = Math.max(PANEL_H_MIN / H, Math.min(PANEL_H_MAX / H, newRatio));
    scheduleDraw(); return;
  }

  // ── Arrastrar en el eje de precio → reescalar verticalmente (manual) ──
  if (isPriceDragging) {
    const dy = e.clientY - priceDragStartY; // arriba (dy<0) = zoom in, abajo (dy>0) = zoom out
    const factor = Math.exp(dy * 0.006);
    const range  = (priceDragBaseMax - priceDragBaseMin) * factor;
    const mid    = (priceDragBaseMin + priceDragBaseMax) / 2;
    manualPriceMin = mid - range / 2;
    manualPriceMax = mid + range / 2;
    manualScale = true;
    scheduleDraw(); return;
  }

  // ── Arrastrar en el eje de tiempo → zoom horizontal (derecha = zoom in, izquierda = zoom out) ──
  if (isTimeDragging) {
    const dx = e.clientX - timeDragStartX;
    const factor = Math.exp(dx * 0.006);
    const newZoom = Math.max(0.01, Math.min(500, timeDragBaseZoom * factor));
    const W2     = cv.width / devicePixelRatio;
    const oldBW  = Math.max(1, Math.min(200, ((W2 - 8 - 84) / Math.min(candles.length, 500)) * timeDragBaseZoom));
    const oldSt  = oldBW + Math.max(1, oldBW * 0.15);
    const newBW  = Math.max(1, Math.min(200, ((W2 - 8 - 84) / Math.min(candles.length, 500)) * newZoom));
    const newSt  = newBW + Math.max(1, newBW * 0.15);
    const idxUm  = (timeDragStartMx - 8 + timeDragBaseCamX) / oldSt;
    zoomLevel = newZoom;
    camX = Math.max(0, idxUm * newSt - (timeDragStartMx - 8));
    scheduleDraw(); return;
  }

  // Cursor ns-resize cerca del handle de panel, o sobre el eje de precio; ew-resize sobre el eje de tiempo
  if (!isDragging && !rulerMode) {
    const hY = cv._panelHandleY;
    const overPanelHandle = hY !== undefined && mouseY >= hY - 4 && mouseY <= hY + 8;
    const overPriceAxis   = mouseX > W2 - lastPADR && mouseY >= lastPADT && mouseY <= lastPADT + lastChartH;
    const overTimeAxis    = mouseY >= lastTimeBarY && mouseY <= lastTimeBarY + lastPADB && mouseX >= lastPADL && mouseX <= lastW - lastPADR;
    cv.style.cursor = overPanelHandle ? 'ns-resize' : overPriceAxis ? 'ns-resize' : overTimeAxis ? 'ew-resize' : 'crosshair';
  }

  if (rulerMode && rulerActive) {
    rulerEndX = mouseX; rulerEndY = mouseY;
    const bW2 = Math.max(1, Math.min(200, ((cv.width/devicePixelRatio - 8 - 84) / Math.min(candles.length, 500)) * zoomLevel));
    const s2  = bW2 + Math.max(1, bW2 * 0.15);
    rulerEndIdx = Math.round((mouseX - 8 + camX) / s2);
    scheduleDraw(); return;
  }
  if (isDragging) {
    camX = Math.max(0, dragStartCamX + (dragStartX - e.clientX));
    if (lastChartH > 0) {
      const dy = e.clientY - dragStartY;
      const range = dragStartPriceMax - dragStartPriceMin;
      const priceDelta = dy * range / lastChartH;
      manualPriceMin = dragStartPriceMin + priceDelta;
      manualPriceMax = dragStartPriceMax + priceDelta;
      manualScale = true;
    }
  }
  scheduleDraw();
});

window.addEventListener('mouseup', () => {
  if (isPanelResizing) { isPanelResizing = false; cv.style.cursor = 'crosshair'; draw(); return; }
  if (isPriceDragging)  { isPriceDragging  = false; cv.style.cursor = 'crosshair'; draw(); return; }
  if (isTimeDragging)   { isTimeDragging   = false; cv.style.cursor = 'crosshair'; draw(); return; }
  if (rulerMode && rulerActive) {
    rulerActive = false;
    if (rulerTempActive) {
      // Se soltó el click derecho: la regla se apaga sola, no queda
      // trabada como cuando se activa con el botón 📏 o la tecla R.
      rulerMode = false; rulerLocked = false; rulerTempActive = false;
      rulerStartX = -1; rulerEndX = -1;
      rulerBtn.classList.remove('active');
    } else {
      rulerLocked = true;
    }
    draw(); return;
  }
  isDragging = false; cv.style.cursor = 'crosshair';
});

cv.addEventListener('dblclick', e => {
  const rect = cv.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const W2 = cv.width / devicePixelRatio;
  // Doble clic sobre el eje de tiempo (abajo) → además resetea el zoom horizontal
  if (my >= lastTimeBarY && my <= lastTimeBarY + lastPADB && mx >= lastPADL && mx <= lastW - lastPADR) {
    zoomLevel = 1.0;
  }
  // Doble clic en cualquier parte del gráfico → vuelve al auto-ajuste vertical
  manualScale = false;
  scheduleDraw();
});

cv.addEventListener('mouseleave', () => { mouseX = -1; mouseY = -1; draw(); });

cv.addEventListener('wheel', e => {
  e.preventDefault();
  // Zoom con ctrl/cmd, o con scroll vertical normal (mouse wheel).
  // Solo se considera "pan horizontal" si el deltaX es claramente mayor
  // (ej: swipe de dos dedos en trackpad), para que el ruido horizontal
  // de un mouse normal no tumbe el zoom por accidente.
  const esPanHorizontal = !e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 2;
  if (!esPanHorizontal && e.deltaY !== 0) {
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
  scheduleDraw();
}, { passive: false });

cv.addEventListener('touchstart', e => {
  isDragging = true; dragStartX = e.touches[0].clientX; dragStartCamX = camX;
  dragStartY = e.touches[0].clientY;
  dragStartPriceMin = manualScale ? manualPriceMin : lastPriceMin;
  dragStartPriceMax = manualScale ? manualPriceMax : lastPriceMax;
}, { passive: true });
cv.addEventListener('touchmove',  e => {
  if (!isDragging) return;
  camX = Math.max(0, dragStartCamX + (dragStartX - e.touches[0].clientX));
  if (lastChartH > 0) {
    const dy = e.touches[0].clientY - dragStartY;
    const range = dragStartPriceMax - dragStartPriceMin;
    const priceDelta = dy * range / lastChartH;
    manualPriceMin = dragStartPriceMin + priceDelta;
    manualPriceMax = dragStartPriceMax + priceDelta;
    manualScale = true;
  }
  scheduleDraw();
}, { passive: true });
cv.addEventListener('touchend',   () => isDragging = false);
cv.style.cursor = 'crosshair';

rulerBtn.addEventListener('click', () => {
  rulerMode = !rulerMode; rulerBtn.classList.toggle('active', rulerMode);
  if (!rulerMode) { rulerActive = false; rulerLocked = false; rulerTempActive = false; rulerStartX = -1; rulerEndX = -1; draw(); }
});

window.addEventListener('keydown', e => {
  if (document.activeElement === symInput) return;
  if (e.key === 'r' || e.key === 'R') {
    rulerMode = !rulerMode; rulerBtn.classList.toggle('active', rulerMode);
    if (!rulerMode) { rulerActive = false; rulerLocked = false; rulerTempActive = false; rulerStartX = -1; rulerEndX = -1; draw(); }
  }
  if (e.key === 'Escape' && rulerMode) {
    rulerMode = false; rulerActive = false; rulerLocked = false; rulerTempActive = false; rulerStartX = -1; rulerEndX = -1;
    rulerBtn.classList.remove('active'); draw();
  }
});

setInterval(fetchOI, 30000);
setInterval(fetchFR, 60000);

applySavedState();
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
          <input type="color" class="sess-card-color" data-i="${i}" data-f="color" value="${s.color}" title="Color de esta sesión" />
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
        <input type="color" class="sess-card-color" data-i="${i}" data-f="color" value="${s.color}" title="Color de esta sesión" />
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

  container.querySelectorAll('select[data-f], input[type=checkbox][data-f], input[type=color][data-f]').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = +inp.dataset.i, f = inp.dataset.f;
      if (inp.type === 'checkbox') {
        sessConfig[i][f] = inp.checked;
        const card = document.getElementById(`sess-card-${i}`);
        if (card) card.style.opacity = inp.checked ? '1' : '0.45';
      } else if (inp.type === 'color') {
        sessConfig[i][f] = inp.value;
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
    // Ocultar del todo las sesiones que estén desactivadas en la
    // configuración actual — la leyenda solo debe reflejar lo que
    // realmente está activo en el gráfico.
    const item = dot ? dot.closest('.sess-leg-item') : null;
    if (item) item.style.display = (s && s.enabled) ? '' : 'none';
  });
}

/* ═══════════════════════════════════════
   PRESETS — UI (barra dentro del modal)
═══════════════════════════════════════ */
function renderPresetBar() {
  const list = document.getElementById('sess-presets-list');
  if (!list) return;
  list.innerHTML = '';
  sessPresets.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'preset-chip' + (p.id === activePresetId ? ' active' : '');
    chip.dataset.id = p.id;
    const isDefault = p.id === defaultPresetId;
    chip.innerHTML = `
      <button type="button" class="preset-star${isDefault ? ' is-default' : ''}" title="${isDefault ? 'Es la configuración predeterminada' : 'Marcar como predeterminada'}">★</button>
      <span class="preset-name" title="Usar esta configuración">${p.name}</span>
      <button type="button" class="preset-del" title="Eliminar configuración">✕</button>
    `;
    chip.querySelector('.preset-name').addEventListener('click', () => selectPreset(p.id));
    chip.querySelector('.preset-star').addEventListener('click', e => { e.stopPropagation(); setDefaultPreset(p.id); });
    chip.querySelector('.preset-del').addEventListener('click',  e => { e.stopPropagation(); deletePreset(p.id); });
    list.appendChild(chip);
  });
}

function selectPreset(id) {
  const p = getPresetById(id);
  sessConfig    = clonePresetSessions(p.sessions);
  activePresetId = id;
  buildEditRows();
  applySessionConfig();
  renderPresetBar();
  savePresetsData();
}

function setDefaultPreset(id) {
  defaultPresetId = id;
  savePresetsData();
  renderPresetBar();
}

function deletePreset(id) {
  if (sessPresets.length <= 1) { alert('Debe quedar al menos una configuración guardada.'); return; }
  const p = getPresetById(id);
  if (!confirm(`¿Eliminar la configuración "${p.name}"? Esta acción no se puede deshacer.`)) return;
  sessPresets = sessPresets.filter(x => x.id !== id);
  if (defaultPresetId === id) defaultPresetId = sessPresets[0].id;
  if (activePresetId === id) {
    activePresetId = defaultPresetId;
    sessConfig = clonePresetSessions(getPresetById(activePresetId).sessions);
    buildEditRows();
    applySessionConfig();
  }
  savePresetsData();
  renderPresetBar();
}

function addPresetFromCurrent() {
  const name = prompt('Nombre de la nueva configuración:', `Configuración ${sessPresets.length + 1}`);
  if (name === null) return;
  const finalName = name.trim() || `Configuración ${sessPresets.length + 1}`;
  const id = 'preset-' + Date.now();
  sessPresets.push({ id, name: finalName, sessions: clonePresetSessions(sessConfig) });
  activePresetId = id;
  savePresetsData();
  renderPresetBar();
}

// Modal
const overlay  = document.getElementById('sess-modal-overlay');
const editBtn  = document.getElementById('sess-edit-btn');
const applyBtn = document.getElementById('sess-apply-btn');
const resetBtn = document.getElementById('sess-reset-btn');
const closeBtn = document.getElementById('sess-modal-close');
const presetAddBtn = document.getElementById('sess-preset-add-btn');

editBtn.addEventListener('click',   () => { buildEditRows(); renderPresetBar(); syncCandleColorInputs(); overlay.classList.add('open'); });
overlay.addEventListener('click',   e  => { if (e.target === overlay) overlay.classList.remove('open'); });
closeBtn.addEventListener('click',  () => overlay.classList.remove('open'));
applyBtn.addEventListener('click',  () => { applySessionConfig(); overlay.classList.remove('open'); });
resetBtn.addEventListener('click',  () => {
  sessConfig = clonePresetSessions(getPresetById(defaultPresetId).sessions);
  activePresetId = defaultPresetId;
  buildEditRows(); applySessionConfig(); renderPresetBar(); savePresetsData();
});
if (presetAddBtn) presetAddBtn.addEventListener('click', addPresetFromCurrent);

// Colores de velas
const candleUpInput   = document.getElementById('candle-color-up');
const candleDownInput = document.getElementById('candle-color-down');
const candleResetBtn  = document.getElementById('candle-color-reset-btn');

function syncCandleColorInputs() {
  if (candleUpInput)   candleUpInput.value   = CANDLE_COLORS.up;
  if (candleDownInput) candleDownInput.value = CANDLE_COLORS.down;
}
if (candleUpInput) candleUpInput.addEventListener('input', () => {
  CANDLE_COLORS.up = candleUpInput.value;
  applyCandleColorVars(); scheduleDraw(); saveState();
});
if (candleDownInput) candleDownInput.addEventListener('input', () => {
  CANDLE_COLORS.down = candleDownInput.value;
  applyCandleColorVars(); scheduleDraw(); saveState();
});
if (candleResetBtn) candleResetBtn.addEventListener('click', () => {
  CANDLE_COLORS = { ...CANDLE_COLORS_DEFAULT };
  syncCandleColorInputs(); applyCandleColorVars(); scheduleDraw(); saveState();
});
syncCandleColorInputs();

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
  c.setTransform(1, 0, 0, 1, 0, 0);
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

    let durH        = s.endUtcH - s.startUtcH;
    if (durH <= 0) durH += 24; // la sesión cruza medianoche (ej. Tokio 23→9 UTC)
    const startFrac = utcHToLocalFrac(s.startUtcH);
    const endFrac   = startFrac + Math.min(durH, 24) / 24;

    const _sStart = s.startUtcH % 24;
    const _sEndRaw = s.endUtcH % 24;
    // Cruza medianoche si el cierre (en reloj UTC) queda antes o igual que la apertura
    const _wraps = (s.endUtcH > 24) || (_sEndRaw <= _sStart);
    const _sEnd  = _sEndRaw;
    let isActive = false;
    if (_wraps) {
      isActive = _nowUtcH >= _sStart || _nowUtcH < _sEnd;
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

  // Sincroniza los cambios hacia el preset activo (ej. "Predeterminada 1")
  // para que queden guardados de forma permanente y no se pierdan si se
  // limpia el estado general de la app (botón Restablecer).
  const activePreset = getPresetById(activePresetId);
  if (activePreset) {
    activePreset.sessions = clonePresetSessions(sessConfig);
    savePresetsData();
  }

  if (rawCandles.length) { snapToEnd = true; buildSessionCandles(); draw(); }
  updateLegend();
  drawSessionBar();
  saveState();
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
    // El margin-left:auto vive acá (y no en .topbar-right-group) para que
    // Indicadores + Restablecer + Configuración queden pegados entre sí
    // como un solo bloque, todo empujado al lado derecho del topbar.
    sep.style.marginLeft = 'auto';
    const btn    = document.createElement('button');
    btn.className = 'tf-btn'; btn.id = 'ind-btn';
    btn.title = 'Indicadores (I)';
    btn.innerHTML = '📈 Indicadores';
    // Se inserta ANTES del grupo derecho (Restablecer/Configuración) para
    // que el orden final quede: Indicadores → Restablecer → Configuración
    // → En vivo. Si por algún motivo ese grupo no existe, cae al final.
    const rightGroup = document.querySelector('.topbar-right-group');
    if (rightGroup) {
      topbar.insertBefore(sep, rightGroup);
      topbar.insertBefore(btn, rightGroup);
    } else {
      topbar.appendChild(sep);
      topbar.appendChild(btn);
    }
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
          saveState();
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
      saveState();
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
      saveState();
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
        saveState();
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