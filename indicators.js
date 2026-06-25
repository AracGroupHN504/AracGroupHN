'use strict';
/* ═══════════════════════════════════════════════════════════════════
   MOTOR DE INDICADORES — indicators.js
   
   Cómo funciona (igual que TradingView):
   ─────────────────────────────────────
   1. Cada indicador se registra con window.INDICATORS.register(def).
   2. app.js llama a window.INDICATORS.getActive() para obtener los
      indicadores activos y sus series calculadas.
   3. app.js llama a drawIndicatorOverlays() y drawIndicatorPanels()
      en los momentos correctos del draw loop.
   4. Para añadir tu propio indicador: crea un nuevo archivo
      my_indicator.js, llama a window.INDICATORS.register({...})
      y añade el <script> en index.html. ¡Listo!

   Estructura de un indicador:
   ───────────────────────────
   {
     id:          string único (ej: 'ema')
     name:        nombre bonito (ej: 'EMA — Media Móvil Exponencial')
     shortName:   etiqueta corta (ej: 'EMA')
     type:        'overlay' | 'panel'   — overlay se dibuja sobre velas,
                                          panel se dibuja abajo (como RSI)
     defaultOn:   boolean               — activado por defecto
     params: [                          — parámetros configurables
       { key, label, type:'number'|'color'|'select', default, min, max, options }
     ],
     calc(candles, params) → series     — función de cálculo puro
       series es un array de objetos { t, value, ... }
       puede tener varias líneas:
       { lines: { main:[{t,v}], signal:[{t,v}] }, ... }
     
     draw(ctx, series, layout, params)  — función de dibujo (opcional)
       layout = { W, H, PADT, PADB, PADL, PADR, chartH, py, barX, step, barW,
                  startIdx, endIdx, candles, camX, panelY, panelH }
   }
═══════════════════════════════════════════════════════════════════ */

(function () {

  /* ── Registro central ── */
  const _registry = {};
  const _active   = {};  // id → { params: {...}, series: [...] }

  const INDICATORS = {

    /* Registra un nuevo indicador */
    register(def) {
      if (!def || !def.id) { console.warn('[INDICATORS] register sin id'); return; }
      _registry[def.id] = def;
      // Activar por defecto si corresponde
      if (def.defaultOn && !_active[def.id]) {
        const params = {};
        (def.params || []).forEach(p => { params[p.key] = p.default; });
        _active[def.id] = { params, series: null };
      }
    },

    /* Todos los indicadores registrados */
    getAll() { return Object.values(_registry); },

    /* Indicadores activos */
    getActive() {
      return Object.entries(_active).map(([id, state]) => ({
        def: _registry[id],
        params: state.params,
        series: state.series,
      })).filter(x => x.def);
    },

    /* Activa un indicador con los params dados */
    activate(id, params) {
      const def = _registry[id];
      if (!def) return;
      const finalParams = {};
      (def.params || []).forEach(p => { finalParams[p.key] = p.default; });
      Object.assign(finalParams, params || {});
      _active[id] = { params: finalParams, series: null };
    },

    /* Desactiva */
    deactivate(id) { delete _active[id]; },

    isActive(id) { return !!_active[id]; },

    /* Actualiza parámetros */
    setParams(id, params) {
      if (!_active[id]) return;
      Object.assign(_active[id].params, params);
      _active[id].series = null; // forzar recalc
    },

    /* Recalcula todas las series activas */
    recalcAll(candles) {
      Object.entries(_active).forEach(([id, state]) => {
        const def = _registry[id];
        if (!def || !def.calc) return;
        try {
          state.series = def.calc(candles, state.params);
        } catch (e) {
          console.error(`[INDICATORS] Error calculando ${id}:`, e);
          state.series = null;
        }
      });
    },

    /* Dibuja overlays (encima de las velas) */
    drawOverlays(ctx, layout) {
      Object.entries(_active).forEach(([id, state]) => {
        const def = _registry[id];
        if (!def || def.type !== 'overlay' || !state.series) return;
        try {
          if (def.draw) def.draw(ctx, state.series, layout, state.params);
          else _defaultOverlayDraw(ctx, state.series, layout, state.params, def);
        } catch (e) { console.error(`[INDICATORS] Error dibujando ${id}:`, e); }
      });
    },

    /* Dibuja paneles (debajo del gráfico) */
    drawPanels(ctx, layout) {
      const panelDefs = Object.entries(_active)
        .filter(([id]) => _registry[id] && _registry[id].type === 'panel')
        .map(([id, state]) => ({ id, def: _registry[id], state }));

      if (!panelDefs.length) return 0;

      const panelH   = Math.min(120, Math.floor(layout.H * 0.22));
      const panelGap = 4;
      let yOff       = layout.H - layout.PADB - panelDefs.length * (panelH + panelGap);

      panelDefs.forEach(({ id, def, state }) => {
        if (!state.series) { yOff += panelH + panelGap; return; }
        const panelLayout = { ...layout, panelY: yOff, panelH };
        try {
          if (def.draw) def.draw(ctx, state.series, panelLayout, state.params);
          else _defaultPanelDraw(ctx, state.series, panelLayout, state.params, def);
        } catch (e) { console.error(`[INDICATORS] Error dibujando panel ${id}:`, e); }
        yOff += panelH + panelGap;
      });

      return panelDefs.length * (panelH + panelGap);
    },

    /* Retorna cuánto espacio vertical ocupan los paneles */
    getPanelHeight() {
      const n = Object.entries(_active)
        .filter(([id]) => _registry[id] && _registry[id].type === 'panel').length;
      if (!n) return 0;
      return n * (Math.min(120, 0) + 4); // se recalcula en draw
    },
  };

  /* ── Dibujado por defecto: overlay de líneas ── */
  function _defaultOverlayDraw(ctx, series, layout, params, def) {
    const { py, barX, startIdx, endIdx, step, barW, PADL, PADR, W, PADT, chartH } = layout;
    const lines = series.lines || { main: series };
    Object.entries(lines).forEach(([key, pts]) => {
      if (!pts || !pts.length) return;
      const color = params[`${key}Color`] || params.color || def._lineColors?.[key] || '#f0b90b';
      const width = params[`${key}Width`] || params.width || 1.5;
      ctx.save();
      // Clip region — beginPath propio para no contaminar el path de la línea
      ctx.beginPath();
      ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
      ctx.clip();
      // Nuevo path limpio para la línea del indicador
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = width;
      ctx.lineJoin    = 'round';
      let started = false;
      pts.forEach(pt => {
        if (pt.v == null || isNaN(pt.v)) { started = false; return; }
        const ci = layout.candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2;
        const y = py(pt.v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    });
  }

  /* ── Dibujado por defecto: panel con línea y área ── */
  function _defaultPanelDraw(ctx, series, layout, params, def) {
    const { barX, startIdx, endIdx, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts   = series.lines?.main || series;
    if (!pts || !pts.length) return;

    const vals  = pts.map(p => p.v).filter(v => v != null && !isNaN(v));
    if (!vals.length) return;
    const vMin  = params.scaleMin ?? Math.min(...vals);
    const vMax  = params.scaleMax ?? Math.max(...vals);
    const range = vMax - vMin || 1;
    const py2   = v => panelY + panelH - ((v - vMin) / range) * panelH;

    // Fondo
    ctx.fillStyle = '#0b0e1199';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f36';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Etiqueta
    ctx.fillStyle = '#4a5060';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(def.shortName || def.name, PADL + 4, panelY + 11);

    // Líneas de referencia (ej: 70/30 para RSI)
    (params.levels || []).forEach(lv => {
      const y = py2(lv.value);
      ctx.strokeStyle = lv.color || '#3a3f4766';
      ctx.lineWidth = 0.6;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = lv.color || '#848e9c';
      ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(lv.value, W - PADR - 2, y - 2);
    });

    // Escala derecha (3 niveles)
    [vMax, (vMax + vMin) / 2, vMin].forEach(lv => {
      const y   = py2(lv);
      const lbl = Math.abs(lv) >= 1000 ? lv.toFixed(0)
                : Math.abs(lv) >= 10   ? lv.toFixed(1)
                : lv.toFixed(2);
      ctx.fillStyle = '#5a6272'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
      ctx.fillText(lbl, W - PADR - 3, y + 3);
    });

    // Línea principal
    const color = params.color || '#f0b90b';
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.clip();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    let started = false;
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) { started = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2;
      const y = py2(pt.v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  /* ── Helpers matemáticos compartidos ── */
  INDICATORS.math = {
    ema(src, period) {
      const k   = 2 / (period + 1);
      const out  = new Array(src.length).fill(null);
      let sum = 0, count = 0;
      for (let i = 0; i < src.length; i++) {
        if (src[i] == null) continue;
        if (count < period) { sum += src[i]; count++; if (count === period) out[i] = sum / period; }
        else out[i] = src[i] * k + out[i - 1] * (1 - k);
      }
      return out;
    },
    sma(src, period) {
      const out = new Array(src.length).fill(null);
      for (let i = period - 1; i < src.length; i++) {
        let s = 0; for (let j = 0; j < period; j++) s += src[i - j];
        out[i] = s / period;
      }
      return out;
    },
    stdev(src, period) {
      const mn  = INDICATORS.math.sma(src, period);
      const out = new Array(src.length).fill(null);
      for (let i = period - 1; i < src.length; i++) {
        let sum2 = 0;
        for (let j = 0; j < period; j++) sum2 += Math.pow(src[i - j] - mn[i], 2);
        out[i] = Math.sqrt(sum2 / period);
      }
      return out;
    },
  };

  window.INDICATORS = INDICATORS;

})();


/* ═══════════════════════════════════════════════════════════════════
   INDICADORES INTEGRADOS
   Cada indicador se registra automáticamente al cargar el archivo.
═══════════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────
   EMA — Media Móvil Exponencial
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'ema',
  name:      'EMA — Media Móvil Exponencial',
  shortName: 'EMA',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'period', label: 'Período',   type: 'number', default: 20,       min: 2,  max: 500 },
    { key: 'color',  label: 'Color',     type: 'color',  default: '#f0b90b' },
    { key: 'width',  label: 'Grosor',    type: 'number', default: 1.5,      min: 0.5, max: 5 },
    { key: 'source', label: 'Fuente',    type: 'select', default: 'close',
      options: [{ v: 'close', l: 'Cierre' }, { v: 'open', l: 'Apertura' },
                { v: 'high', l: 'Máximo' },  { v: 'low', l: 'Mínimo' },
                { v: 'hl2', l: 'HL/2' },     { v: 'hlc3', l: 'HLC/3' }] },
  ],
  calc(candles, p) {
    const src = candles.map(c => ({
      close: c.c, open: c.o, high: c.h, low: c.l,
      hl2: (c.h + c.l) / 2, hlc3: (c.h + c.l + c.c) / 3,
    }[p.source]));
    const ema = INDICATORS.math.ema(src, p.period);
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: ema[i] })) } };
  },
});

/* ────────────────────────────────────
   SMA — Media Móvil Simple
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'sma',
  name:      'SMA — Media Móvil Simple',
  shortName: 'SMA',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'period', label: 'Período', type: 'number', default: 20,       min: 2, max: 500 },
    { key: 'color',  label: 'Color',   type: 'color',  default: '#38bdf8' },
    { key: 'width',  label: 'Grosor',  type: 'number', default: 1.5,      min: 0.5, max: 5 },
  ],
  calc(candles, p) {
    const src = candles.map(c => c.c);
    const sma = INDICATORS.math.sma(src, p.period);
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: sma[i] })) } };
  },
});

/* ────────────────────────────────────
   BOLLINGER BANDS
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'bb',
  name:      'Bandas de Bollinger',
  shortName: 'BB',
  type:      'overlay',
  defaultOn: false,
  _lineColors: { upper: '#c084fc', mid: '#a855f755', lower: '#c084fc' },
  params: [
    { key: 'period',      label: 'Período',       type: 'number', default: 20,       min: 2,   max: 500 },
    { key: 'mult',        label: 'Multiplicador', type: 'number', default: 2,        min: 0.1, max: 10 },
    { key: 'upperColor',  label: 'Banda sup.',    type: 'color',  default: '#c084fc' },
    { key: 'midColor',    label: 'Media',         type: 'color',  default: '#a855f755' },
    { key: 'lowerColor',  label: 'Banda inf.',    type: 'color',  default: '#c084fc' },
  ],
  calc(candles, p) {
    const src   = candles.map(c => c.c);
    const mid   = INDICATORS.math.sma(src, p.period);
    const stdev = INDICATORS.math.stdev(src, p.period);
    return {
      lines: {
        upper: candles.map((c, i) => ({ t: c.t, v: mid[i] != null ? mid[i] + p.mult * stdev[i] : null })),
        mid:   candles.map((c, i) => ({ t: c.t, v: mid[i] })),
        lower: candles.map((c, i) => ({ t: c.t, v: mid[i] != null ? mid[i] - p.mult * stdev[i] : null })),
      }
    };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;

    // Área rellena entre upper y lower
    const upper = series.lines.upper;
    const lower = series.lines.lower;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    // Zona sombreada
    ctx.beginPath();
    let started = false;
    upper.forEach(pt => {
      if (pt.v == null) { started = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2;
      if (!started) { ctx.moveTo(x, py(pt.v)); started = true; }
      else ctx.lineTo(x, py(pt.v));
    });
    const lowerRev = [...lower].reverse();
    lowerRev.forEach(pt => {
      if (pt.v == null) return;
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      ctx.lineTo(barX(ci) + barW / 2, py(pt.v));
    });
    ctx.closePath();
    ctx.fillStyle = '#c084fc11';
    ctx.fill();

    // Líneas
    [
      { pts: upper, col: params.upperColor },
      { pts: series.lines.mid,   col: params.midColor },
      { pts: lower, col: params.lowerColor },
    ].forEach(({ pts, col }) => {
      ctx.beginPath();
      ctx.strokeStyle = col; ctx.lineWidth = 1.2;
      let s = false;
      pts.forEach(pt => {
        if (pt.v == null) { s = false; return; }
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2;
        if (!s) { ctx.moveTo(x, py(pt.v)); s = true; }
        else ctx.lineTo(x, py(pt.v));
      });
      ctx.stroke();
    });
    ctx.restore();
  },
});

/* ────────────────────────────────────
   RSI — Índice de Fuerza Relativa
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'rsi',
  name:      'RSI — Índice de Fuerza Relativa',
  shortName: 'RSI',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'period',   label: 'Período',       type: 'number', default: 14,       min: 2,  max: 200 },
    { key: 'color',    label: 'Color',         type: 'color',  default: '#f0b90b' },
    { key: 'overbought', label: 'Sobrecompra', type: 'number', default: 70,       min: 50, max: 99 },
    { key: 'oversold',   label: 'Sobreventa',  type: 'number', default: 30,       min: 1,  max: 50 },
    { key: 'scaleMin', label: '', type: 'number', default: 0,  min: 0,  max: 0 },
    { key: 'scaleMax', label: '', type: 'number', default: 100, min: 100, max: 100 },
  ],
  calc(candles, p) {
    const closes = candles.map(c => c.c);
    const gains  = [], losses = [];
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      gains.push(d > 0 ? d : 0);
      losses.push(d < 0 ? -d : 0);
    }
    const rsi = [null]; // primer valor sin dato
    let avgG = gains.slice(0, p.period).reduce((a, b) => a + b, 0) / p.period;
    let avgL = losses.slice(0, p.period).reduce((a, b) => a + b, 0) / p.period;
    for (let i = p.period; i < gains.length; i++) {
      if (i === p.period) { rsi.push(100 - 100 / (1 + avgG / (avgL || 1e-10))); }
      avgG = (avgG * (p.period - 1) + gains[i]) / p.period;
      avgL = (avgL * (p.period - 1) + losses[i]) / p.period;
      rsi.push(100 - 100 / (1 + avgG / (avgL || 1e-10)));
    }
    while (rsi.length < candles.length) rsi.unshift(null);
    return {
      lines: { main: candles.map((c, i) => ({ t: c.t, v: rsi[i] })) },
    };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts   = series.lines.main;
    const vMin  = 0, vMax = 100;
    const range = 100;
    const py2   = v => panelY + panelH - ((v - vMin) / range) * panelH;

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Zonas sobrecompra / sobreventa
    const yOB = py2(params.overbought), yOS = py2(params.oversold);
    ctx.fillStyle = '#ff547011'; ctx.fillRect(PADL, panelY, W - PADL - PADR, yOB - panelY);
    ctx.fillStyle = '#26d99411'; ctx.fillRect(PADL, yOS,   W - PADL - PADR, panelY + panelH - yOS);

    // Líneas de referencia
    [
      { v: params.overbought, col: '#ff547066' },
      { v: 50,                col: '#3a3f4766' },
      { v: params.oversold,   col: '#26d99466' },
    ].forEach(({ v, col }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.7; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right';
      ctx.fillText(v, W - PADR - 3, y - 2);
    });

    // Etiqueta
    ctx.fillStyle = '#f0b90b99'; ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`RSI(${params.period})`, PADL + 4, panelY + 11);

    // Línea RSI con color dinámico
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.clip();
    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let started = false, prevX = 0, prevY = 0, prevV = 0;
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) { started = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2;
      const y = py2(pt.v);
      const col = pt.v >= params.overbought ? '#ff5470' : pt.v <= params.oversold ? '#26d994' : params.color;
      if (!started) { ctx.beginPath(); ctx.moveTo(x, y); }
      else {
        ctx.lineTo(x, y);
        ctx.strokeStyle = col; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y);
      }
      started = true; prevX = x; prevY = y; prevV = pt.v;
    });
    ctx.restore();

    // Valor actual del RSI en eje derecho
    const lastRSI = pts.filter(p => p.v != null && !isNaN(p.v)).slice(-1)[0];
    if (lastRSI) {
      const y   = py2(lastRSI.v);
      const col = lastRSI.v >= params.overbought ? '#ff5470' : lastRSI.v <= params.oversold ? '#26d994' : params.color;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(lastRSI.v.toFixed(1), W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }
  },
});

/* ────────────────────────────────────
   MACD
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'macd',
  name:      'MACD — Convergencia/Divergencia de Medias Móviles',
  shortName: 'MACD',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'fast',        label: 'EMA rápida',  type: 'number', default: 12,       min: 2,  max: 200 },
    { key: 'slow',        label: 'EMA lenta',   type: 'number', default: 26,       min: 2,  max: 200 },
    { key: 'signal',      label: 'Señal',       type: 'number', default: 9,        min: 2,  max: 200 },
    { key: 'macdColor',   label: 'MACD',        type: 'color',  default: '#38bdf8' },
    { key: 'signalColor', label: 'Señal',       type: 'color',  default: '#f59e0b' },
  ],
  calc(candles, p) {
    const closes = candles.map(c => c.c);
    const emaF   = INDICATORS.math.ema(closes, p.fast);
    const emaS   = INDICATORS.math.ema(closes, p.slow);
    const macd   = emaF.map((f, i) => (f != null && emaS[i] != null) ? f - emaS[i] : null);
    const sig    = INDICATORS.math.ema(macd, p.signal);
    const hist   = macd.map((m, i) => (m != null && sig[i] != null) ? m - sig[i] : null);
    return {
      lines: {
        macd:   candles.map((c, i) => ({ t: c.t, v: macd[i] })),
        signal: candles.map((c, i) => ({ t: c.t, v: sig[i] })),
        hist:   candles.map((c, i) => ({ t: c.t, v: hist[i] })),
      }
    };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const { macd: macdPts, signal: sigPts, hist: histPts } = series.lines;

    const allVals = [...macdPts, ...sigPts, ...histPts]
      .map(p => p.v).filter(v => v != null && !isNaN(v));
    if (!allVals.length) return;
    const vMin  = Math.min(...allVals), vMax = Math.max(...allVals);
    const vRange = vMax - vMin || 1;
    const py2   = v => panelY + panelH - ((v - vMin) / vRange) * panelH;
    const yZero = py2(0);

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Línea cero
    ctx.strokeStyle = '#3a3f4799'; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, yZero); ctx.lineTo(W - PADR, yZero); ctx.stroke();
    ctx.setLineDash([]);

    // Histograma
    histPts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) return;
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x  = barX(ci);
      const y  = py2(pt.v);
      const h  = Math.abs(yZero - y);
      if (h < 0.5) return;
      ctx.fillStyle = pt.v >= 0
        ? (pt.v > (histPts[Math.max(0, histPts.indexOf(pt) - 1)]?.v ?? 0) ? '#26d994cc' : '#26d99466')
        : (pt.v < (histPts[Math.max(0, histPts.indexOf(pt) - 1)]?.v ?? 0) ? '#ff5470cc' : '#ff547066');
      ctx.fillRect(x + 1, Math.min(y, yZero), barW - 1, h);
    });

    // Líneas MACD y señal
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.clip();
    [
      { pts: macdPts, col: params.macdColor,   lw: 1.5 },
      { pts: sigPts,  col: params.signalColor, lw: 1.2 },
    ].forEach(({ pts, col, lw }) => {
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = lw;
      let s = false;
      pts.forEach(pt => {
        if (pt.v == null || isNaN(pt.v)) { s = false; return; }
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2, y = py2(pt.v);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.restore();

    // Escala derecha MACD (3 niveles)
    [vMax, 0, vMin].forEach(lv => {
      const y   = py2(lv);
      const lbl = Math.abs(lv) >= 1000 ? lv.toFixed(0)
                : Math.abs(lv) >= 1    ? lv.toFixed(2)
                : lv.toFixed(4);
      ctx.fillStyle = '#5a6272'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
      ctx.fillText(lbl, W - PADR - 3, y - 2);
    });

    // Etiqueta
    ctx.fillStyle = '#38bdf899'; ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`MACD(${params.fast},${params.slow},${params.signal})`, PADL + 4, panelY + 11);
  },
});

/* ────────────────────────────────────
   VOLUMEN — Barras de volumen en overlay
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'volume',
  name:      'Volumen',
  shortName: 'VOL',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'opacity', label: 'Opacidad (%)', type: 'number', default: 30, min: 5, max: 100 },
    { key: 'heightPct', label: 'Altura (%)', type: 'number', default: 20, min: 5, max: 40 },
  ],
  calc(candles, p) {
    return { lines: { main: candles.map(c => ({ t: c.t, v: c.v })) } };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    const pts    = series.lines.main;
    const volH   = chartH * (params.heightPct / 100);
    const volBase = PADT + chartH;
    const maxVol  = Math.max(...candles.map(c => c.v));
    if (!maxVol) return;
    const alpha = params.opacity / 100;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();
    pts.forEach(pt => {
      if (pt.v == null || !pt.v) return;
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const c  = candles[ci];
      const x  = barX(ci);
      const h  = (pt.v / maxVol) * volH;
      const bull = c.c >= c.o;
      ctx.fillStyle = bull
        ? `rgba(38,217,148,${alpha})`
        : `rgba(255,84,112,${alpha})`;
      ctx.fillRect(x, volBase - h, barW, h);
    });
    ctx.restore();
  },
});

/* ────────────────────────────────────
   STOCHASTIC — Oscilador Estocástico
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'stoch',
  name:      'Estocástico',
  shortName: 'STOCH',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'kPeriod',    label: '%K período',   type: 'number', default: 14, min: 2, max: 200 },
    { key: 'dPeriod',    label: '%D período',   type: 'number', default: 3,  min: 1, max: 50 },
    { key: 'smooth',     label: 'Suavizado',    type: 'number', default: 3,  min: 1, max: 50 },
    { key: 'kColor',     label: '%K color',     type: 'color',  default: '#38bdf8' },
    { key: 'dColor',     label: '%D color',     type: 'color',  default: '#f59e0b' },
    { key: 'overbought', label: 'Sobrecompra',  type: 'number', default: 80, min: 50, max: 99 },
    { key: 'oversold',   label: 'Sobreventa',   type: 'number', default: 20, min: 1,  max: 50 },
    { key: 'scaleMin',   label: '', type: 'number', default: 0 },
    { key: 'scaleMax',   label: '', type: 'number', default: 100 },
    { key: 'levels',     label: '', type: 'hidden', default: [] },
  ],
  calc(candles, p) {
    const rawK = [];
    for (let i = 0; i < candles.length; i++) {
      if (i < p.kPeriod - 1) { rawK.push(null); continue; }
      const window = candles.slice(i - p.kPeriod + 1, i + 1);
      const lo  = Math.min(...window.map(c => c.l));
      const hi  = Math.max(...window.map(c => c.h));
      rawK.push(hi === lo ? 50 : (candles[i].c - lo) / (hi - lo) * 100);
    }
    const smoothK = INDICATORS.math.sma(rawK, p.smooth);
    const dLine   = INDICATORS.math.sma(smoothK, p.dPeriod);
    return {
      lines: {
        main:   candles.map((c, i) => ({ t: c.t, v: smoothK[i] })),
        signal: candles.map((c, i) => ({ t: c.t, v: dLine[i] })),
      }
    };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const kPts = series.lines.main, dPts = series.lines.signal;
    const py2  = v => panelY + panelH - (v / 100) * panelH;

    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const yOB = py2(params.overbought), yOS = py2(params.oversold);
    ctx.fillStyle = '#ff547011'; ctx.fillRect(PADL, panelY, W - PADL - PADR, yOB - panelY);
    ctx.fillStyle = '#26d99411'; ctx.fillRect(PADL, yOS, W - PADL - PADR, panelY + panelH - yOS);

    [{ v: params.overbought, col: '#ff547066' }, { v: 50, col: '#3a3f4766' }, { v: params.oversold, col: '#26d99466' }].forEach(({ v, col }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    [{ pts: kPts, col: params.kColor, lw: 1.5 }, { pts: dPts, col: params.dColor, lw: 1.2 }].forEach(({ pts, col, lw }) => {
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = lw;
      let s = false;
      pts.forEach(pt => {
        if (pt.v == null || isNaN(pt.v)) { s = false; return; }
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2, y = py2(pt.v);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.restore();

    ctx.fillStyle = '#38bdf899'; ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`STOCH(%K ${params.kPeriod},%D ${params.dPeriod})`, PADL + 4, panelY + 11);
  },
});

/* ────────────────────────────────────
   ATR — Average True Range  (FIXED)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'atr',
  name:      'ATR — Rango Verdadero Medio',
  shortName: 'ATR',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'period', label: 'Período', type: 'number', default: 14, min: 2, max: 200 },
    { key: 'color',  label: 'Color',   type: 'color',  default: '#c084fc' },
  ],
  calc(candles, p) {
    const trs = candles.map((c, i) => {
      if (i === 0) return c.h - c.l;
      const prev = candles[i - 1];
      return Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
    });
    // Wilder smoothing (RMA) — más fiel al ATR estándar
    const atr = new Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < p.period; i++) sum += trs[i];
    atr[p.period - 1] = sum / p.period;
    for (let i = p.period; i < candles.length; i++)
      atr[i] = (atr[i - 1] * (p.period - 1) + trs[i]) / p.period;
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: atr[i] })) } };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts  = series.lines.main;
    const vals = pts.map(p => p.v).filter(v => v != null && !isNaN(v));
    if (!vals.length) return;
    const vMin = 0, vMax = Math.max(...vals) * 1.05;
    const range = vMax - vMin || 1;
    const py2 = v => panelY + panelH - ((v - vMin) / range) * panelH;

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Área rellena bajo la línea ATR
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.clip();

    const visiblePts = pts.filter(pt => {
      if (pt.v == null || isNaN(pt.v)) return false;
      const ci = candles.findIndex(c => c.t === pt.t);
      return ci >= 0;
    });
    if (visiblePts.length > 1) {
      // Área
      ctx.beginPath();
      ctx.moveTo(barX(candles.findIndex(c => c.t === visiblePts[0].t)) + barW / 2, panelY + panelH);
      visiblePts.forEach(pt => {
        const ci = candles.findIndex(c => c.t === pt.t);
        ctx.lineTo(barX(ci) + barW / 2, py2(pt.v));
      });
      ctx.lineTo(barX(candles.findIndex(c => c.t === visiblePts[visiblePts.length-1].t)) + barW / 2, panelY + panelH);
      ctx.closePath();
      ctx.fillStyle = params.color + '22';
      ctx.fill();
      // Línea
      ctx.beginPath();
      ctx.strokeStyle = params.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      let s = false;
      visiblePts.forEach(pt => {
        const ci = candles.findIndex(c => c.t === pt.t);
        const x = barX(ci) + barW / 2, y = py2(pt.v);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.restore();

    // Escala derecha
    [vMax, vMax / 2].forEach(lv => {
      const y   = py2(lv);
      const lbl = lv >= 1000 ? lv.toFixed(0) : lv >= 10 ? lv.toFixed(1) : lv.toFixed(4);
      ctx.fillStyle = '#5a6272'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
      ctx.fillText(lbl, W - PADR - 3, y - 2);
    });

    // Valor actual en eje derecho
    const lastATR = visiblePts.slice(-1)[0];
    if (lastATR) {
      const y   = py2(lastATR.v);
      const lbl = lastATR.v >= 1000 ? lastATR.v.toFixed(0) : lastATR.v >= 10 ? lastATR.v.toFixed(1) : lastATR.v.toFixed(4);
      ctx.fillStyle = params.color;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(lbl, W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }

    // Etiqueta
    ctx.fillStyle = '#c084fc99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`ATR(${params.period})`, PADL + 4, panelY + 11);
  },
});

/* ────────────────────────────────────
   VWAP — Volume Weighted Average Price
   (Indicador #1 para traders institucionales)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'vwap',
  name:      'VWAP — Precio Promedio Ponderado por Volumen',
  shortName: 'VWAP',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'color',       label: 'VWAP color',    type: 'color',  default: '#f0b90b' },
    { key: 'band1Color',  label: 'Banda 1 color', type: 'color',  default: '#f0b90b44' },
    { key: 'stdDev1',     label: 'Desv. est. 1',  type: 'number', default: 1, min: 0.1, max: 5 },
    { key: 'showBands',   label: 'Mostrar bandas',type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'width',       label: 'Grosor',         type: 'number', default: 1.8, min: 0.5, max: 5 },
  ],
  calc(candles, p) {
    // Acumula por día (reinicio diario)
    const DAY_MS = 86400000;
    let cumTPV = 0, cumVol = 0;
    let cumTPV2 = 0;  // para desviación estándar
    let dayStart = -1;
    const vwap = [], upperBand = [], lowerBand = [];

    candles.forEach((c, i) => {
      const day = Math.floor(c.t / DAY_MS);
      if (day !== dayStart) { cumTPV = 0; cumVol = 0; cumTPV2 = 0; dayStart = day; }
      const tp = (c.h + c.l + c.c) / 3;
      cumTPV  += tp * c.v;
      cumTPV2 += tp * tp * c.v;
      cumVol  += c.v;
      const vw = cumVol > 0 ? cumTPV / cumVol : tp;
      const variance = cumVol > 0 ? (cumTPV2 / cumVol) - vw * vw : 0;
      const sd = Math.sqrt(Math.max(0, variance));
      vwap.push({ t: c.t, v: vw });
      upperBand.push({ t: c.t, v: vw + p.stdDev1 * sd });
      lowerBand.push({ t: c.t, v: vw - p.stdDev1 * sd });
    });
    return { lines: { main: vwap, upper: upperBand, lower: lowerBand } };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    const { main: vwapPts, upper: upPts, lower: loPts } = series.lines;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    // Bandas (área sombreada)
    if (params.showBands === 'yes' && upPts && loPts) {
      ctx.beginPath();
      let s = false;
      upPts.forEach(pt => {
        if (pt.v == null) { s = false; return; }
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2, y = py(pt.v);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      });
      for (let i = loPts.length - 1; i >= 0; i--) {
        const pt = loPts[i];
        if (pt.v == null) continue;
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) continue;
        ctx.lineTo(barX(ci) + barW / 2, py(pt.v));
      }
      ctx.closePath();
      ctx.fillStyle = params.band1Color;
      ctx.fill();

      // Líneas de banda
      [upPts, loPts].forEach(bandPts => {
        ctx.beginPath(); ctx.strokeStyle = params.color + '55'; ctx.lineWidth = 0.8; ctx.setLineDash([4, 4]);
        let bs = false;
        bandPts.forEach(pt => {
          if (pt.v == null) { bs = false; return; }
          const ci = candles.findIndex(c => c.t === pt.t);
          if (ci < 0) return;
          const x = barX(ci) + barW / 2;
          if (!bs) { ctx.moveTo(x, py(pt.v)); bs = true; } else ctx.lineTo(x, py(pt.v));
        });
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // Línea VWAP principal
    ctx.beginPath(); ctx.strokeStyle = params.color; ctx.lineWidth = params.width; ctx.lineJoin = 'round';
    let s2 = false;
    vwapPts.forEach(pt => {
      if (pt.v == null) { s2 = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2;
      if (!s2) { ctx.moveTo(x, py(pt.v)); s2 = true; } else ctx.lineTo(x, py(pt.v));
    });
    ctx.stroke();
    ctx.restore();

    // Etiqueta "VWAP" al final de la línea
    const lastV = vwapPts.filter(p => p.v != null).slice(-1)[0];
    if (lastV) {
      const ci = candles.findIndex(c => c.t === lastV.t);
      if (ci >= 0) {
        const endX = barX(ci) + barW / 2;
        const endY = py(lastV.v);
        if (endX > PADL && endX < W - PADR) {
          ctx.fillStyle = params.color + 'cc';
          ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText('VWAP', Math.min(endX + 3, W - PADR - 36), endY - 4);
        }
      }
    }
  },
});

/* ────────────────────────────────────
   SUPERTREND — Tendencia dinámica con ATR
   (Muy usado en crypto y futuros)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'supertrend',
  name:      'Supertrend — Tendencia con ATR',
  shortName: 'ST',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'period',    label: 'ATR período',  type: 'number', default: 10,       min: 2, max: 200 },
    { key: 'factor',    label: 'Multiplicador',type: 'number', default: 3,        min: 0.5, max: 20 },
    { key: 'bullColor', label: 'Color alcista',type: 'color',  default: '#26d994' },
    { key: 'bearColor', label: 'Color bajista',type: 'color',  default: '#ff5470' },
    { key: 'width',     label: 'Grosor',        type: 'number', default: 2, min: 0.5, max: 5 },
  ],
  calc(candles, p) {
    const trs = candles.map((c, i) => {
      if (i === 0) return c.h - c.l;
      const prev = candles[i - 1];
      return Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
    });
    // ATR Wilder
    const atr = new Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < p.period; i++) sum += trs[i];
    atr[p.period - 1] = sum / p.period;
    for (let i = p.period; i < candles.length; i++)
      atr[i] = (atr[i-1] * (p.period - 1) + trs[i]) / p.period;

    const st  = new Array(candles.length).fill(null);
    const dir = new Array(candles.length).fill(1); // 1=bullish, -1=bearish
    let upperBasic, lowerBasic, finalUpper, finalLower;

    for (let i = p.period; i < candles.length; i++) {
      const hl2 = (candles[i].h + candles[i].l) / 2;
      upperBasic = hl2 + p.factor * atr[i];
      lowerBasic = hl2 - p.factor * atr[i];

      if (i === p.period) {
        finalUpper = upperBasic;
        finalLower = lowerBasic;
        dir[i]     = candles[i].c <= finalUpper ? 1 : -1;
      } else {
        const prevUpper = st[i-1] !== null && dir[i-1] === -1 ? st[i-1] : finalUpper;
        const prevLower = st[i-1] !== null && dir[i-1] ===  1 ? st[i-1] : finalLower;
        finalUpper = upperBasic < prevUpper || candles[i-1].c > prevUpper ? upperBasic : prevUpper;
        finalLower = lowerBasic > prevLower || candles[i-1].c < prevLower ? lowerBasic : prevLower;

        if (dir[i-1] === -1 && candles[i].c > finalUpper) dir[i] = 1;
        else if (dir[i-1] === 1 && candles[i].c < finalLower) dir[i] = -1;
        else dir[i] = dir[i-1];
      }
      st[i] = dir[i] === 1 ? finalLower : finalUpper;
    }
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: st[i], dir: dir[i] })) } };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    const pts = series.lines.main;
    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();
    ctx.lineWidth = params.width; ctx.lineJoin = 'round';

    let seg = [], segDir = null;
    const flush = () => {
      if (seg.length < 2) { seg = []; return; }
      ctx.beginPath();
      ctx.strokeStyle = segDir === 1 ? params.bullColor : params.bearColor;
      seg.forEach((pt, i) => {
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2, y = py(pt.v);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // Círculo en el cambio de dirección
      if (seg.length > 0) {
        const last = seg[seg.length - 1];
        const ci   = candles.findIndex(c => c.t === last.t);
        if (ci >= 0) {
          ctx.fillStyle = segDir === 1 ? params.bullColor : params.bearColor;
          ctx.beginPath(); ctx.arc(barX(ci) + barW / 2, py(last.v), 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      seg = [];
    };
    pts.forEach(pt => {
      if (pt.v == null) { flush(); segDir = null; return; }
      if (segDir !== null && pt.dir !== segDir) flush();
      if (!seg.length) segDir = pt.dir;
      seg.push(pt);
    });
    flush();
    ctx.restore();
  },
});

/* ────────────────────────────────────
   Williams %R — Oscilador de momentum
   (Clásico para timing de entradas)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'willr',
  name:      'Williams %R — Oscilador de Momentum',
  shortName: '%R',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'period',     label: 'Período',     type: 'number', default: 14,       min: 2, max: 200 },
    { key: 'color',      label: 'Color',       type: 'color',  default: '#38bdf8' },
    { key: 'overbought', label: 'Sobrecompra', type: 'number', default: -20,      min: -50, max: 0 },
    { key: 'oversold',   label: 'Sobreventa',  type: 'number', default: -80,      min: -100, max: -50 },
    { key: 'scaleMin',   label: '', type: 'hidden', default: -100 },
    { key: 'scaleMax',   label: '', type: 'hidden', default: 0 },
  ],
  calc(candles, p) {
    const vals = candles.map((c, i) => {
      if (i < p.period - 1) return null;
      const slice = candles.slice(i - p.period + 1, i + 1);
      const hi = Math.max(...slice.map(x => x.h));
      const lo = Math.min(...slice.map(x => x.l));
      return hi === lo ? -50 : ((hi - c.c) / (hi - lo)) * -100;
    });
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: vals[i] })) } };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts  = series.lines.main;
    const py2  = v => panelY + panelH - ((v - (-100)) / 100) * panelH;

    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const yOB = py2(params.overbought), yOS = py2(params.oversold);
    ctx.fillStyle = '#ff547011'; ctx.fillRect(PADL, panelY, W - PADL - PADR, yOB - panelY);
    ctx.fillStyle = '#26d99411'; ctx.fillRect(PADL, yOS,   W - PADL - PADR, panelY + panelH - yOS);

    [{ v: params.overbought, col: '#ff547066' }, { v: -50, col: '#3a3f4766' }, { v: params.oversold, col: '#26d99466' }].forEach(({ v, col }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right';
      ctx.fillText(v, W - PADR - 3, y - 2);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    ctx.beginPath(); ctx.strokeStyle = params.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let s = false;
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) { s = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2, y = py2(pt.v);
      if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    // Valor actual
    const lastV = pts.filter(p => p.v != null).slice(-1)[0];
    if (lastV) {
      const col = lastV.v >= params.overbought ? '#ff5470' : lastV.v <= params.oversold ? '#26d994' : params.color;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, py2(lastV.v) - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(lastV.v.toFixed(1), W - PADR + 3 + (PADR - 6) / 2, py2(lastV.v) + 3);
    }

    ctx.fillStyle = '#38bdf899'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`%R(${params.period})`, PADL + 4, panelY + 11);
  },
});

/* ────────────────────────────────────
   CCI — Commodity Channel Index
   (Excelente para crypto, detecta extremos)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'cci',
  name:      'CCI — Commodity Channel Index',
  shortName: 'CCI',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'period',     label: 'Período',     type: 'number', default: 20,       min: 2, max: 200 },
    { key: 'color',      label: 'Color',       type: 'color',  default: '#f59e0b' },
    { key: 'overbought', label: 'Sobrecompra', type: 'number', default: 100,      min: 50, max: 300 },
    { key: 'oversold',   label: 'Sobreventa',  type: 'number', default: -100,     min: -300, max: -50 },
  ],
  calc(candles, p) {
    const tp = candles.map(c => (c.h + c.l + c.c) / 3);
    const vals = candles.map((c, i) => {
      if (i < p.period - 1) return null;
      const slice  = tp.slice(i - p.period + 1, i + 1);
      const mean   = slice.reduce((a, b) => a + b, 0) / p.period;
      const meanDev = slice.reduce((a, b) => a + Math.abs(b - mean), 0) / p.period;
      return meanDev === 0 ? 0 : (tp[i] - mean) / (0.015 * meanDev);
    });
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: vals[i] })) } };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts  = series.lines.main;
    const vals = pts.map(p => p.v).filter(v => v != null && !isNaN(v));
    if (!vals.length) return;
    const vAbs = Math.max(Math.abs(Math.min(...vals)), Math.abs(Math.max(...vals)), Math.abs(params.overbought), 150);
    const vMin = -vAbs, vMax = vAbs;
    const range = vMax - vMin;
    const py2   = v => panelY + panelH - ((v - vMin) / range) * panelH;

    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const yZero = py2(0);
    [
      { v: params.overbought, col: '#ff547066' },
      { v: 0,                 col: '#3a3f4766' },
      { v: params.oversold,   col: '#26d99466' },
    ].forEach(({ v, col }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'right';
      ctx.fillText(v, W - PADR - 3, y - 2);
    });

    // Barras con color arriba/abajo de 0
    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) return;
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci), y = py2(pt.v), h = Math.abs(yZero - y);
      if (h < 0.5) return;
      const isOB = pt.v >= params.overbought, isOS = pt.v <= params.oversold;
      ctx.fillStyle = pt.v > 0
        ? (isOB ? '#ff5470cc' : '#f59e0b66')
        : (isOS ? '#26d994cc' : '#38bdf866');
      ctx.fillRect(x + 1, Math.min(y, yZero), barW - 1, h);
    });

    // Línea CCI
    ctx.beginPath(); ctx.strokeStyle = params.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let s = false;
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) { s = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2, y = py2(pt.v);
      if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    // Valor actual
    const lastV = pts.filter(p => p.v != null).slice(-1)[0];
    if (lastV) {
      const col = lastV.v >= params.overbought ? '#ff5470' : lastV.v <= params.oversold ? '#26d994' : params.color;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, py2(lastV.v) - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(lastV.v.toFixed(0), W - PADR + 3 + (PADR - 6) / 2, py2(lastV.v) + 3);
    }

    ctx.fillStyle = '#f59e0b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`CCI(${params.period})`, PADL + 4, panelY + 11);
  },
});

/* ────────────────────────────────────
   OBV — On Balance Volume
   (Confirma tendencias con volumen real)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'obv',
  name:      'OBV — On Balance Volume',
  shortName: 'OBV',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'color',       label: 'Color OBV',   type: 'color',  default: '#10b981' },
    { key: 'signalPeriod',label: 'Señal EMA',   type: 'number', default: 21, min: 2, max: 200 },
    { key: 'signalColor', label: 'Color señal', type: 'color',  default: '#f0b90b' },
  ],
  calc(candles, p) {
    const obv = [0];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      if (candles[i].c > prev.c)      obv.push(obv[i-1] + candles[i].v);
      else if (candles[i].c < prev.c) obv.push(obv[i-1] - candles[i].v);
      else                             obv.push(obv[i-1]);
    }
    const sig = INDICATORS.math.ema(obv, p.signalPeriod);
    const n   = candles.length;

    // Cruces OBV / EMA señal
    // BUY  → OBV cruza arriba de la EMA
    // SELL → OBV cruza abajo  de la EMA
    const crossBuy  = new Array(n).fill(false);
    const crossSell = new Array(n).fill(false);
    for (let i = 1; i < n; i++) {
      const o = obv[i], o0 = obv[i-1], s = sig[i], s0 = sig[i-1];
      if (o != null && o0 != null && s != null && s0 != null) {
        if (o >= s && o0 < s0) crossBuy[i]  = true;
        if (o <= s && o0 > s0) crossSell[i] = true;
      }
    }

    return {
      lines: {
        main:   candles.map((c, i) => ({ t: c.t, v: obv[i], crossBuy: crossBuy[i], crossSell: crossSell[i] })),
        signal: candles.map((c, i) => ({ t: c.t, v: sig[i] })),
      }
    };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const mainPts = series.lines.main, sigPts = series.lines.signal;
    const vals = mainPts.map(p => p.v).filter(v => v != null && !isNaN(v));
    if (!vals.length) return;
    const vMin = Math.min(...vals), vMax = Math.max(...vals);
    const range = vMax - vMin || 1;
    const py2 = v => panelY + panelH - ((v - vMin) / range) * panelH;

    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Línea cero relativa (midpoint)
    const mid = (vMax + vMin) / 2;
    ctx.strokeStyle = '#3a3f4766'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, py2(mid)); ctx.lineTo(W - PADR, py2(mid)); ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Área bajo OBV
    const visMain = mainPts.filter(p => p.v != null);
    if (visMain.length > 1) {
      ctx.beginPath();
      const firstCI = candles.findIndex(c => c.t === visMain[0].t);
      ctx.moveTo(barX(firstCI) + barW / 2, panelY + panelH);
      visMain.forEach(pt => {
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci >= 0) ctx.lineTo(barX(ci) + barW / 2, py2(pt.v));
      });
      const lastCI = candles.findIndex(c => c.t === visMain[visMain.length-1].t);
      ctx.lineTo(barX(lastCI) + barW / 2, panelY + panelH);
      ctx.closePath();
      ctx.fillStyle = params.color + '22';
      ctx.fill();
    }

    // Línea OBV
    ctx.beginPath(); ctx.strokeStyle = params.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let s = false;
    mainPts.forEach(pt => {
      if (pt.v == null) { s = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2, y = py2(pt.v);
      if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Línea señal EMA
    ctx.beginPath(); ctx.strokeStyle = params.signalColor; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
    let s2 = false;
    sigPts.forEach(pt => {
      if (pt.v == null) { s2 = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2, y = py2(pt.v);
      if (!s2) { ctx.moveTo(x, y); s2 = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Escala derecha
    const fmtOBV = v => Math.abs(v) >= 1e9 ? (v/1e9).toFixed(1)+'B' : Math.abs(v) >= 1e6 ? (v/1e6).toFixed(1)+'M' : Math.abs(v) >= 1e3 ? (v/1e3).toFixed(1)+'K' : v.toFixed(0);
    [vMax, (vMax+vMin)/2, vMin].forEach(lv => {
      ctx.fillStyle = '#5a6272'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
      ctx.fillText(fmtOBV(lv), W - PADR - 3, py2(lv) - 2);
    });

    // Señales de cruce OBV / EMA
    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    mainPts.forEach(pt => {
      if (!pt.crossBuy && !pt.crossSell) return;
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x  = barX(ci) + barW / 2;
      const y  = py2(pt.v);
      const col = pt.crossBuy ? '#26d994' : '#ff5470';

      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = '#0b0e11'; ctx.lineWidth = 1; ctx.stroke();

      ctx.fillStyle = col; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      if (pt.crossBuy)  ctx.fillText('▲ BUY',  x, y - 8);
      if (pt.crossSell) ctx.fillText('▼ SELL', x, y + 16);
    });
    ctx.restore();

    ctx.fillStyle = '#10b98199'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`OBV  EMA(${params.signalPeriod})`, PADL + 4, panelY + 11);
  },
});

/* ────────────────────────────────────
   ICHIMOKU CLOUD — Sistema completo japonés
   (El indicador más completo del mercado)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'ichimoku',
  name:      'Ichimoku Cloud — Sistema Japonés Completo',
  shortName: 'ICHI',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'tenkanPeriod',  label: 'Tenkan (rápida)',  type: 'number', default: 9,  min: 2, max: 100 },
    { key: 'kijunPeriod',   label: 'Kijun (lenta)',    type: 'number', default: 26, min: 2, max: 200 },
    { key: 'senkouBPeriod', label: 'Senkou B',         type: 'number', default: 52, min: 2, max: 300 },
    { key: 'displacement',  label: 'Desplazamiento',   type: 'number', default: 26, min: 1, max: 100 },
    { key: 'tenkanColor',   label: 'Tenkan color',     type: 'color',  default: '#38bdf8' },
    { key: 'kijunColor',    label: 'Kijun color',      type: 'color',  default: '#f59e0b' },
    { key: 'cloudBullColor',label: 'Nube alcista',     type: 'color',  default: '#26d99422' },
    { key: 'cloudBearColor',label: 'Nube bajista',     type: 'color',  default: '#ff547022' },
    { key: 'chikouColor',   label: 'Chikou color',     type: 'color',  default: '#c084fc' },
  ],
  calc(candles, p) {
    const mid = (arr, i, period) => {
      if (i < period - 1) return null;
      const sl = arr.slice(i - period + 1, i + 1);
      return (Math.max(...sl.map(c => c.h)) + Math.min(...sl.map(c => c.l))) / 2;
    };
    const tenkan  = candles.map((c, i) => ({ t: c.t, v: mid(candles, i, p.tenkanPeriod) }));
    const kijun   = candles.map((c, i) => ({ t: c.t, v: mid(candles, i, p.kijunPeriod) }));
    const senkouA = candles.map((c, i) => {
      const t = tenkan[i].v, k = kijun[i].v;
      return { t: c.t, v: (t != null && k != null) ? (t + k) / 2 : null };
    });
    const senkouB = candles.map((c, i) => ({ t: c.t, v: mid(candles, i, p.senkouBPeriod) }));
    const chikou  = candles.map((c, i) => ({ t: c.t, v: c.c }));
    return { lines: { tenkan, kijun, senkouA, senkouB, chikou } };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    const { tenkan, kijun, senkouA, senkouB, chikou } = series.lines;
    const D = params.displacement;

    const ci = t => candles.findIndex(c => c.t === t);

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();

    // Nube (Kumo) — Senkou A y B desplazados hacia adelante D velas
    const buildShiftedPath = (pts, shift) => {
      const result = [];
      pts.forEach((pt, i) => {
        if (pt.v == null) return;
        const targetIdx = ci(pt.t) + shift;
        if (targetIdx < 0 || targetIdx >= candles.length) return;
        result.push({ x: barX(targetIdx) + barW / 2, y: py(pt.v), v: pt.v });
      });
      return result;
    };

    const pathA = buildShiftedPath(senkouA, D);
    const pathB = buildShiftedPath(senkouB, D);

    if (pathA.length > 1 && pathB.length > 1) {
      // Nube alcista y bajista por segmentos
      const len = Math.min(pathA.length, pathB.length);
      for (let i = 0; i < len - 1; i++) {
        const bull = pathA[i].v >= pathB[i].v;
        ctx.fillStyle = bull ? params.cloudBullColor : params.cloudBearColor;
        ctx.beginPath();
        ctx.moveTo(pathA[i].x,   pathA[i].y);
        ctx.lineTo(pathA[i+1].x, pathA[i+1].y);
        ctx.lineTo(pathB[i+1].x, pathB[i+1].y);
        ctx.lineTo(pathB[i].x,   pathB[i].y);
        ctx.closePath();
        ctx.fill();
      }
      // Bordes de la nube
      [pathA, pathB].forEach((path, pi) => {
        ctx.beginPath();
        ctx.strokeStyle = pi === 0 ? '#26d99466' : '#ff547066';
        ctx.lineWidth = 0.8;
        path.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
        ctx.stroke();
      });
    }

    // Chikou Span (precio desplazado hacia atrás D velas)
    ctx.beginPath(); ctx.strokeStyle = params.chikouColor; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    let s = false;
    chikou.forEach((pt, i) => {
      const targetIdx = i - D;
      if (targetIdx < 0) return;
      const x = barX(targetIdx) + barW / 2, y = py(pt.v);
      if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke(); ctx.setLineDash([]);

    // Tenkan-sen y Kijun-sen
    [
      { pts: tenkan, col: params.tenkanColor, lw: 1.2 },
      { pts: kijun,  col: params.kijunColor,  lw: 1.8 },
    ].forEach(({ pts, col, lw }) => {
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round';
      let s2 = false;
      pts.forEach(pt => {
        if (pt.v == null) { s2 = false; return; }
        const idx = ci(pt.t);
        if (idx < 0) return;
        const x = barX(idx) + barW / 2, y = py(pt.v);
        if (!s2) { ctx.moveTo(x, y); s2 = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    ctx.restore();

    // Leyenda compacta
    const items = [
      { label: 'T', col: params.tenkanColor },
      { label: 'K', col: params.kijunColor },
      { label: '☁', col: '#26d994' },
    ];
    let lx = PADL + 4;
    const ly = PADT + 12;
    ctx.font = 'bold 9px sans-serif';
    items.forEach(({ label, col }) => {
      ctx.fillStyle = col;
      ctx.fillText(label, lx, ly);
      lx += ctx.measureText(label).width + 6;
    });
    ctx.fillStyle = '#4a506088'; ctx.font = '9px sans-serif';
    ctx.fillText(`Ichimoku(${params.tenkanPeriod},${params.kijunPeriod},${params.senkouBPeriod})`, lx, ly);
  },
});

/* ────────────────────────────────────
   SUPERTREND — Seguidor de tendencia (muy popular en futuros)
   Basado en ATR. Cambia de color según dirección.
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'supertrend',
  name:      'Supertrend',
  shortName: 'ST',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'period',    label: 'Período ATR',  type: 'number', default: 10,       min: 2,  max: 200 },
    { key: 'mult',      label: 'Multiplicador',type: 'number', default: 3,        min: 0.5, max: 10 },
    { key: 'bullColor', label: 'Color alcista',type: 'color',  default: '#26d994' },
    { key: 'bearColor', label: 'Color bajista',type: 'color',  default: '#ff5470' },
  ],
  calc(candles, p) {
    const n = candles.length;
    // ATR Wilder
    const trs = candles.map((c, i) => i === 0 ? c.h - c.l :
      Math.max(c.h - c.l, Math.abs(c.h - candles[i-1].c), Math.abs(c.l - candles[i-1].c)));
    const atr = new Array(n).fill(null);
    let sum = 0;
    for (let i = 0; i < p.period; i++) sum += trs[i];
    atr[p.period - 1] = sum / p.period;
    for (let i = p.period; i < n; i++)
      atr[i] = (atr[i-1] * (p.period - 1) + trs[i]) / p.period;

    const hl2 = candles.map(c => (c.h + c.l) / 2);
    const upperBand = new Array(n).fill(null);
    const lowerBand = new Array(n).fill(null);
    const supertrend = new Array(n).fill(null);
    const direction  = new Array(n).fill(1); // 1=alcista, -1=bajista

    for (let i = p.period - 1; i < n; i++) {
      const basicUpper = hl2[i] + p.mult * atr[i];
      const basicLower = hl2[i] - p.mult * atr[i];
      upperBand[i] = (i > 0 && upperBand[i-1] != null && basicUpper < upperBand[i-1]) || candles[i-1]?.c > upperBand[i-1]
        ? basicUpper : (upperBand[i-1] ?? basicUpper);
      lowerBand[i] = (i > 0 && lowerBand[i-1] != null && basicLower > lowerBand[i-1]) || candles[i-1]?.c < lowerBand[i-1]
        ? basicLower : (lowerBand[i-1] ?? basicLower);
      if (i === p.period - 1) { supertrend[i] = upperBand[i]; direction[i] = -1; continue; }
      if (supertrend[i-1] === upperBand[i-1]) {
        direction[i] = candles[i].c > upperBand[i] ? 1 : -1;
      } else {
        direction[i] = candles[i].c < lowerBand[i] ? -1 : 1;
      }
      supertrend[i] = direction[i] === 1 ? lowerBand[i] : upperBand[i];
    }
    return {
      lines: {
        main: candles.map((c, i) => ({ t: c.t, v: supertrend[i] })),
      },
      direction,
    };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    const pts = series.lines.main;
    const dir = series.direction || [];
    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].v == null || pts[i-1].v == null) continue;
      const ci1 = candles.findIndex(c => c.t === pts[i-1].t);
      const ci2 = candles.findIndex(c => c.t === pts[i].t);
      if (ci1 < 0 || ci2 < 0) continue;
      ctx.beginPath();
      ctx.strokeStyle = dir[i] === 1 ? params.bullColor : params.bearColor;
      ctx.moveTo(barX(ci1) + barW/2, py(pts[i-1].v));
      ctx.lineTo(barX(ci2) + barW/2, py(pts[i].v));
      ctx.stroke();
    }
    ctx.restore();
    // Leyenda
    ctx.fillStyle = '#26d99499'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Supertrend(${params.period},${params.mult})`, PADL + 4, PADT + 12);
  },
});

/* ────────────────────────────────────
   WILLIAMS %R — Oscilador de Larry Williams
   (Excelente para detectar reversiones)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'willr',
  name:      'Williams %R',
  shortName: '%R',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'period',     label: 'Período',     type: 'number', default: 14,       min: 2,  max: 200 },
    { key: 'color',      label: 'Color',       type: 'color',  default: '#c084fc' },
    { key: 'overbought', label: 'Sobrecompra', type: 'number', default: -20,      min: -50, max: -1 },
    { key: 'oversold',   label: 'Sobreventa',  type: 'number', default: -80,      min: -99, max: -51 },
    { key: 'scaleMin',   label: '', type: 'number', default: -100 },
    { key: 'scaleMax',   label: '', type: 'number', default: 0 },
  ],
  calc(candles, p) {
    const willr = candles.map((c, i) => {
      if (i < p.period - 1) return null;
      const sl  = candles.slice(i - p.period + 1, i + 1);
      const hi  = Math.max(...sl.map(c => c.h));
      const lo  = Math.min(...sl.map(c => c.l));
      return hi === lo ? -50 : ((hi - c.c) / (hi - lo)) * -100;
    });
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: willr[i] })) } };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts  = series.lines.main;
    const vMin = -100, vMax = 0, range = 100;
    const py2  = v => panelY + panelH - ((v - vMin) / range) * panelH;

    ctx.fillStyle = '#0b0e1188'; ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const yOB = py2(params.overbought), yOS = py2(params.oversold);
    ctx.fillStyle = '#ff547011'; ctx.fillRect(PADL, panelY, W - PADL - PADR, yOB - panelY);
    ctx.fillStyle = '#26d99411'; ctx.fillRect(PADL, yOS, W - PADL - PADR, panelY + panelH - yOS);

    [{ v: params.overbought, col: '#ff547066' }, { v: -50, col: '#3a3f4766' }, { v: params.oversold, col: '#26d99466' }].forEach(({ v, col }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(v, W - PADR - 3, y - 2);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    ctx.beginPath(); ctx.strokeStyle = params.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let s = false;
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) { s = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW/2, y = py2(pt.v);
      if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#c084fc99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Williams %R(${params.period})`, PADL + 4, panelY + 11);

    const last = pts.filter(p => p.v != null).slice(-1)[0];
    if (last) {
      const y = py2(last.v);
      ctx.fillStyle = params.color;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(last.v.toFixed(1), W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }
  },
});

/* ────────────────────────────────────
   CCI — Commodity Channel Index
   (Detecta tendencias y reversiones extremas)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'cci',
  name:      'CCI — Commodity Channel Index',
  shortName: 'CCI',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'period', label: 'Período', type: 'number', default: 20,       min: 2,  max: 200 },
    { key: 'color',  label: 'Color',   type: 'color',  default: '#f59e0b' },
  ],
  calc(candles, p) {
    const tp  = candles.map(c => (c.h + c.l + c.c) / 3);
    const cci = candles.map((c, i) => {
      if (i < p.period - 1) return null;
      const sl  = tp.slice(i - p.period + 1, i + 1);
      const avg = sl.reduce((a, b) => a + b, 0) / p.period;
      const md  = sl.reduce((a, b) => a + Math.abs(b - avg), 0) / p.period;
      return md === 0 ? 0 : (tp[i] - avg) / (0.015 * md);
    });
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: cci[i] })) } };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts  = series.lines.main;
    const vals = pts.map(p => p.v).filter(v => v != null && !isNaN(v));
    if (!vals.length) return;
    const ext  = Math.max(Math.abs(Math.min(...vals)), Math.abs(Math.max(...vals)), 100);
    const vMin = -ext, vMax = ext, range = 2 * ext;
    const py2  = v => panelY + panelH - ((v - vMin) / range) * panelH;
    const yZero = py2(0);

    ctx.fillStyle = '#0b0e1188'; ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    [{ v: 100, col: '#ff547055' }, { v: 0, col: '#3a3f4766' }, { v: -100, col: '#26d99455' }].forEach(({ v, col }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(v, W - PADR - 3, y - 2);
    });

    // Histograma de barras
    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) return;
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x = barX(ci), y = py2(pt.v), h = Math.abs(y - yZero);
      ctx.fillStyle = pt.v >= 100 ? '#ff5470cc' : pt.v <= -100 ? '#26d994cc' : pt.v > 0 ? '#f59e0b55' : '#38bdf855';
      ctx.fillRect(x + 1, Math.min(y, yZero), barW - 1, h);
    });

    ctx.beginPath(); ctx.strokeStyle = params.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let s = false;
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) { s = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x = barX(ci) + barW/2, y = py2(pt.v);
      if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#f59e0b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`CCI(${params.period})`, PADL + 4, panelY + 11);
  },
});

/* ────────────────────────────────────
   ADX — Average Directional Index
   (Mide la FUERZA de la tendencia, no dirección)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'adx',
  name:      'ADX — Índice Direccional Promedio',
  shortName: 'ADX',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'period',    label: 'Período',      type: 'number', default: 14,       min: 2,  max: 200 },
    { key: 'adxColor',  label: 'ADX color',    type: 'color',  default: '#f0b90b' },
    { key: 'diPColor',  label: '+DI color',    type: 'color',  default: '#26d994' },
    { key: 'diMColor',  label: '−DI color',    type: 'color',  default: '#ff5470' },
    { key: 'scaleMin',  label: '', type: 'number', default: 0 },
    { key: 'scaleMax',  label: '', type: 'number', default: 100 },
  ],
  calc(candles, p) {
    const n = candles.length;
    const trArr = [], dmP = [], dmM = [];
    for (let i = 1; i < n; i++) {
      const c = candles[i], prev = candles[i-1];
      trArr.push(Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c)));
      const upMove = c.h - prev.h, downMove = prev.l - c.l;
      dmP.push(upMove > downMove && upMove > 0 ? upMove : 0);
      dmM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    // Wilder smoothing
    const wilder = (arr, period) => {
      const out = new Array(arr.length).fill(null);
      let sum = arr.slice(0, period).reduce((a, b) => a + b, 0);
      out[period - 1] = sum;
      for (let i = period; i < arr.length; i++)
        out[i] = out[i-1] - out[i-1] / period + arr[i];
      return out;
    };
    const atr14 = wilder(trArr, p.period);
    const dp14  = wilder(dmP,   p.period);
    const dm14  = wilder(dmM,   p.period);
    const diP   = dp14.map((v, i) => v != null && atr14[i] ? (v / atr14[i]) * 100 : null);
    const diM   = dm14.map((v, i) => v != null && atr14[i] ? (v / atr14[i]) * 100 : null);
    const dx    = diP.map((v, i) => (v != null && diM[i] != null && (v + diM[i]) > 0)
      ? Math.abs(v - diM[i]) / (v + diM[i]) * 100 : null);
    const adxRaw = wilder(dx.filter(v => v != null), p.period);
    // Reconstruct aligned to candles
    const offset = n - 1 - trArr.length;
    const adxAligned = new Array(n).fill(null);
    const diPAligned = new Array(n).fill(null);
    const diMAligned = new Array(n).fill(null);
    for (let i = 0; i < trArr.length; i++) {
      diPAligned[i + 1] = diP[i];
      diMAligned[i + 1] = diM[i];
    }
    let adxPos = 0;
    for (let i = 0; i < n; i++) {
      if (dx[i - 1] != null && adxPos < adxRaw.length) {
        adxAligned[i] = adxRaw[adxPos++];
      }
    }
    // Detectar cruces +DI / -DI
    const crossBuy  = new Array(n).fill(false);
    const crossSell = new Array(n).fill(false);
    for (let i = 1; i < n; i++) {
      const dp  = diPAligned[i],  dm  = diMAligned[i];
      const dp0 = diPAligned[i-1], dm0 = diMAligned[i-1];
      if (dp != null && dm != null && dp0 != null && dm0 != null) {
        if (dp >= dm && dp0 < dm0) crossBuy[i]  = true;  // +DI cruza arriba de -DI → BUY
        if (dp <= dm && dp0 > dm0) crossSell[i] = true;  // +DI cruza abajo de -DI → SELL
      }
    }
    return {
      lines: {
        main:   candles.map((c, i) => ({ t: c.t, v: adxAligned[i] })),
        diPlus: candles.map((c, i) => ({ t: c.t, v: diPAligned[i], crossBuy:  crossBuy[i]  })),
        diMinus:candles.map((c, i) => ({ t: c.t, v: diMAligned[i], crossSell: crossSell[i] })),
      }
    };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const { main: adxPts, diPlus, diMinus } = series.lines;
    const vMin = 0, vMax = 100, range = 100;
    const py2 = v => panelY + panelH - ((v - vMin) / range) * panelH;

    const colBull = params.diPColor || '#26d994';
    const colBear = params.diMColor || '#ff5470';

    ctx.fillStyle = '#0b0e1188'; ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Zona tendencia fuerte (>25)
    ctx.fillStyle = '#f0b90b08';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, py2(25) - panelY);

    [{ v: 25, col: '#f0b90b55', lbl: '25 (tendencia)' }, { v: 50, col: '#f0b90b33' }].forEach(({ v, col, lbl }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(lbl || v, W - PADR - 3, y - 2);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Dibujar líneas DI y ADX
    [
      { pts: diPlus,  col: colBull,           lw: 1, dash: [4,3] },
      { pts: diMinus, col: colBear,           lw: 1, dash: [4,3] },
      { pts: adxPts,  col: params.adxColor,  lw: 2, dash: [] },
    ].forEach(({ pts, col, lw, dash }) => {
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash);
      let s = false;
      pts.forEach(pt => {
        if (pt.v == null || isNaN(pt.v)) { s = false; return; }
        const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
        const x = barX(ci) + barW/2, y = py2(pt.v);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke(); ctx.setLineDash([]);
    });

    // Señales de cruce +DI / -DI
    diPlus.forEach((pt) => {
      if (!pt.crossBuy) return;
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x  = barX(ci) + barW / 2;
      const y  = py2(pt.v != null ? pt.v : 25);
      // Círculo
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = colBull; ctx.fill();
      ctx.strokeStyle = '#0b0e11'; ctx.lineWidth = 1; ctx.stroke();
      // Etiqueta
      ctx.fillStyle = colBull; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('▲ BUY', x, y - 8);
    });

    diMinus.forEach((pt) => {
      if (!pt.crossSell) return;
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x  = barX(ci) + barW / 2;
      const y  = py2(pt.v != null ? pt.v : 25);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = colBear; ctx.fill();
      ctx.strokeStyle = '#0b0e11'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = colBear; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('▼ SELL', x, y + 16);
    });

    ctx.restore();

    ctx.fillStyle = '#f0b90b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`ADX(${params.period})  +DI  −DI`, PADL + 4, panelY + 11);
  },
});

/* ────────────────────────────────────
   STOCH RSI — RSI del RSI (muy sensible)
   (Favorito en criptos para entradas precisas)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'stochrsi',
  name:      'Stochastic RSI',
  shortName: 'StochRSI',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'rsiPeriod',  label: 'RSI período',  type: 'number', default: 14,       min: 2, max: 200 },
    { key: 'stochPeriod',label: 'Stoch período', type: 'number', default: 14,       min: 2, max: 200 },
    { key: 'kPeriod',    label: '%K suavizado',  type: 'number', default: 3,        min: 1, max: 50 },
    { key: 'dPeriod',    label: '%D suavizado',  type: 'number', default: 3,        min: 1, max: 50 },
    { key: 'kColor',     label: '%K color',      type: 'color',  default: '#38bdf8' },
    { key: 'dColor',     label: '%D color',      type: 'color',  default: '#f59e0b' },
    { key: 'scaleMin',   label: '', type: 'number', default: 0 },
    { key: 'scaleMax',   label: '', type: 'number', default: 100 },
  ],
  calc(candles, p) {
    // Primero calcular RSI
    const closes = candles.map(c => c.c);
    const gains = [], losses = [];
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i] - closes[i-1];
      gains.push(d > 0 ? d : 0);
      losses.push(d < 0 ? -d : 0);
    }
    const rsiArr = [null];
    let avgG = gains.slice(0, p.rsiPeriod).reduce((a,b)=>a+b,0) / p.rsiPeriod;
    let avgL = losses.slice(0, p.rsiPeriod).reduce((a,b)=>a+b,0) / p.rsiPeriod;
    for (let i = p.rsiPeriod; i < gains.length; i++) {
      if (i === p.rsiPeriod) rsiArr.push(100 - 100 / (1 + avgG / (avgL || 1e-10)));
      avgG = (avgG * (p.rsiPeriod - 1) + gains[i]) / p.rsiPeriod;
      avgL = (avgL * (p.rsiPeriod - 1) + losses[i]) / p.rsiPeriod;
      rsiArr.push(100 - 100 / (1 + avgG / (avgL || 1e-10)));
    }
    while (rsiArr.length < candles.length) rsiArr.unshift(null);

    // Stochastico sobre RSI
    const rawK = rsiArr.map((v, i) => {
      if (v == null || i < p.stochPeriod - 1) return null;
      const sl  = rsiArr.slice(i - p.stochPeriod + 1, i + 1).filter(x => x != null);
      if (!sl.length) return null;
      const lo = Math.min(...sl), hi = Math.max(...sl);
      return hi === lo ? 50 : (v - lo) / (hi - lo) * 100;
    });
    const smoothK = INDICATORS.math.sma(rawK, p.kPeriod);
    const dLine   = INDICATORS.math.sma(smoothK, p.dPeriod);

    return {
      lines: {
        main:   candles.map((c, i) => ({ t: c.t, v: smoothK[i] })),
        signal: candles.map((c, i) => ({ t: c.t, v: dLine[i] })),
      }
    };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const kPts = series.lines.main, dPts = series.lines.signal;
    const py2 = v => panelY + panelH - (v / 100) * panelH;

    ctx.fillStyle = '#0b0e1188'; ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const yOB = py2(80), yOS = py2(20);
    ctx.fillStyle = '#ff547011'; ctx.fillRect(PADL, panelY, W - PADL - PADR, yOB - panelY);
    ctx.fillStyle = '#26d99411'; ctx.fillRect(PADL, yOS, W - PADL - PADR, panelY + panelH - yOS);

    [{ v: 80, col: '#ff547066' }, { v: 50, col: '#3a3f4766' }, { v: 20, col: '#26d99466' }].forEach(({ v, col }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    [{ pts: kPts, col: params.kColor, lw: 1.5 }, { pts: dPts, col: params.dColor, lw: 1.2 }].forEach(({ pts, col, lw }) => {
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = lw;
      let s = false;
      pts.forEach(pt => {
        if (pt.v == null || isNaN(pt.v)) { s = false; return; }
        const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
        const x = barX(ci) + barW/2, y = py2(pt.v);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.restore();

    ctx.fillStyle = '#38bdf899'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`StochRSI(%K ${params.kPeriod},%D ${params.dPeriod})`, PADL + 4, panelY + 11);
  },
});


/* ────────────────────────────────────
   PIVOT POINTS — Soportes y resistencias clave
   (Clásico institucional, muy usado en futuros)
   
   Ancla de sesión: permite elegir en qué vela de sesión
   comienza cada período del cálculo.
   Las velas de sesión tienen sessionKey:
     sydney | tokyo | london | newyork | nomarket | *_solap
   El ancla agrupa por "cada vez que aparece esa sesión".
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'pivots',
  name:      'Pivot Points — Soportes y Resistencias',
  shortName: 'PP',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'type',     label: 'Tipo',         type: 'select', default: 'standard',
      options: [
        { v: 'standard',  l: 'Estándar'  },
        { v: 'fibonacci', l: 'Fibonacci' },
        { v: 'camarilla', l: 'Camarilla' },
      ]
    },
    { key: 'anchor', label: 'Ancla (inicio periodo)', type: 'select', default: 'daily',
      options(candles) {
        // Opciones fijas de calendario
        const fixed = [
          { v: 'daily',  l: 'Dia calendario (UTC-6)' },
          { v: 'weekly', l: 'Semana calendario (UTC-6)' },
        ];

        if (!candles || !candles.length) return fixed;

        // Detectar sessionKeys unicos reales en las velas
        // y calcular hora local de inicio/fin de cada una
        const UTC_OFF = -6;
        const hhmm = (utcH) => {
          let h = ((utcH % 24) + UTC_OFF + 24) % 24;
          return String(h).padStart(2,'0') + ':00';
        };

        // Agrupar por sessionKey: tomar primera y ultima vela de cada sesion consecutiva
        // para calcular apertura y cierre en hora local
        const seen = {}; // sessionKey -> { name, firstT, lastT }
        let prevKey = null;
        candles.forEach(c => {
          const k = c.sessionKey || '';
          if (!k || k === prevKey) {
            if (seen[k]) seen[k].lastT = c.tClose || c.t;
          } else {
            if (!seen[k]) seen[k] = { name: c.sessionName || k, firstT: c.t, lastT: c.tClose || c.t };
          }
          prevKey = k;
        });

        // Construir opciones de sesion
        const sessOpts = Object.entries(seen).map(([k, info]) => {
          // Hora local de apertura y cierre
          const toLocal = (ms) => {
            const d = new Date(ms + UTC_OFF * 3600000);
            return String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
          };
          const open  = toLocal(info.firstT);
          const close = toLocal(info.lastT);
          const name  = info.name;
          return { v: k, l: name + '  ' + open + ' -> ' + close };
        });

        // Ordenar por hora de primera aparicion
        sessOpts.sort((a, b) => {
          const tA = seen[a.v]?.firstT ?? 0;
          const tB = seen[b.v]?.firstT ?? 0;
          return tA - tB;
        });

        return [...fixed, ...sessOpts];
      },
    },
    { key: 'ppColor',  label: 'Pivot',         type: 'color',  default: '#f0b90b' },
    { key: 'rColor',   label: 'Resistencia',   type: 'color',  default: '#ff5470' },
    { key: 'sColor',   label: 'Soporte',       type: 'color',  default: '#26d994' },
  ],
  calc(candles, p) {
    // ── Modo calendario (día / semana) ──────────────────────────────
    if (p.anchor === 'daily' || p.anchor === 'weekly') {
      const TZ_OFFSET_S = 6 * 3600;
      const isWeekly = p.anchor === 'weekly';

      const groupKey = (tMs) => {
        const tSec = tMs / 1000 - TZ_OFFSET_S;
        if (!isWeekly) return Math.floor(tSec / 86400);
        const dayAbs = Math.floor(tSec / 86400);
        return Math.floor((dayAbs + 3) / 7);
      };

      const groups = {};
      candles.forEach((c, i) => {
        const key = groupKey(c.t);
        if (!groups[key]) groups[key] = { candles: [], key };
        groups[key].candles.push({ ...c, idx: i });
      });

      const sortedGroups = Object.values(groups).sort((a, b) => a.key - b.key);
      const levels = [];

      for (let d = 1; d < sortedGroups.length; d++) {
        const prev = sortedGroups[d - 1].candles;
        const curr = sortedGroups[d].candles;
        if (!prev.length || !curr.length) continue;

        const H  = Math.max(...prev.map(c => c.h));
        const L  = Math.min(...prev.map(c => c.l));
        const C  = prev[prev.length - 1].c;
        const PP = (H + L + C) / 3;

        let lvs = { PP };
        if (p.type === 'standard') {
          lvs = { PP, R1: 2*PP-L, R2: PP+(H-L), R3: H+2*(PP-L), S1: 2*PP-H, S2: PP-(H-L), S3: L-2*(H-PP) };
        } else if (p.type === 'fibonacci') {
          const r = H - L;
          lvs = { PP, R1: PP+0.382*r, R2: PP+0.618*r, R3: PP+r, S1: PP-0.382*r, S2: PP-0.618*r, S3: PP-r };
        } else {
          const r = H - L;
          lvs = { PP, R1: C+r*1.1/12, R2: C+r*1.1/6, R3: C+r*1.1/4, R4: C+r*1.1/2,
                      S1: C-r*1.1/12, S2: C-r*1.1/6, S3: C-r*1.1/4, S4: C-r*1.1/2 };
        }

        levels.push({ startIdx: curr[0].idx, endIdx: curr[curr.length - 1].idx, ...lvs });
      }
      return { levels };
    }

    // ── Modo sesión: ancla en cada aparición de la sesión elegida ───
    // Las velas de sesión tienen sessionKey como 'newyork', 'london', etc.
    // También puede haber solapamientos: 'london_solap', 'newyork_solap', etc.
    // Buscamos velas cuyo sessionKey comience con el anchor elegido.
    const anchor = p.anchor; // 'newyork' | 'london' | 'tokyo' | 'sydney' | 'nomarket'

    // Identificar indices donde comienza una vela de la sesion ancla
    // El usuario eligio el sessionKey exacto (ej: 'newyork_solap', 'london', etc.)
    const isAnchorCandle = (c) => {
      return (c.sessionKey || '') === anchor;
    };

    // Construir grupos: cada grupo comienza cuando aparece la sesión ancla
    // y termina justo antes de la próxima aparición
    const groups = [];
    let currentGroup = null;

    candles.forEach((c, i) => {
      if (isAnchorCandle(c)) {
        // Nueva sesión ancla → cerrar grupo anterior, abrir nuevo
        if (currentGroup && currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [{ ...c, idx: i }];
      } else if (currentGroup) {
        currentGroup.push({ ...c, idx: i });
      }
    });
    // Cerrar el último grupo
    if (currentGroup && currentGroup.length > 0) groups.push(currentGroup);

    if (groups.length < 2) return { levels: [] };

    const levels = [];

    // Cada período [d-1] genera niveles para el período [d]
    for (let d = 1; d < groups.length; d++) {
      const prev = groups[d - 1];
      const curr = groups[d];
      if (!prev.length || !curr.length) continue;

      const H  = Math.max(...prev.map(c => c.h));
      const L  = Math.min(...prev.map(c => c.l));
      const C  = prev[prev.length - 1].c;
      const PP = (H + L + C) / 3;

      let lvs = { PP };
      if (p.type === 'standard') {
        lvs = { PP, R1: 2*PP-L, R2: PP+(H-L), R3: H+2*(PP-L), S1: 2*PP-H, S2: PP-(H-L), S3: L-2*(H-PP) };
      } else if (p.type === 'fibonacci') {
        const r = H - L;
        lvs = { PP, R1: PP+0.382*r, R2: PP+0.618*r, R3: PP+r, S1: PP-0.382*r, S2: PP-0.618*r, S3: PP-r };
      } else {
        const r = H - L;
        lvs = { PP, R1: C+r*1.1/12, R2: C+r*1.1/6, R3: C+r*1.1/4, R4: C+r*1.1/2,
                    S1: C-r*1.1/12, S2: C-r*1.1/6, S3: C-r*1.1/4, S4: C-r*1.1/2 };
      }

      levels.push({ startIdx: curr[0].idx, endIdx: curr[curr.length - 1].idx, ...lvs });
    }

    return { levels };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH } = layout;
    if (!series.levels || !series.levels.length) return;

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();

    series.levels.forEach(lv => {
      const x1 = barX(lv.startIdx);
      const x2 = barX(lv.endIdx) + barW;

      const draw = (val, color, label, lw = 1, dash = []) => {
        if (val == null || isNaN(val)) return;
        const y = py(val);
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash(dash);
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color + 'cc'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
        const fmt = v => v >= 10000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);
        ctx.fillText(`${label} ${fmt(val)}`, x2 - 2, y - 2);
      };

      draw(lv.PP, params.ppColor, 'PP', 1.5);
      draw(lv.R1, params.rColor, 'R1', 1, [4,2]);
      draw(lv.R2, params.rColor, 'R2', 1, [4,2]);
      draw(lv.R3, params.rColor, 'R3', 0.7, [2,4]);
      draw(lv.R4, params.rColor, 'R4', 0.7, [2,4]);
      draw(lv.S1, params.sColor, 'S1', 1, [4,2]);
      draw(lv.S2, params.sColor, 'S2', 1, [4,2]);
      draw(lv.S3, params.sColor, 'S3', 0.7, [2,4]);
      draw(lv.S4, params.sColor, 'S4', 0.7, [2,4]);
    });

    ctx.restore();

    // Etiqueta con tipo y ancla activa
    const anchorLabels = {
      daily: 'Día', weekly: 'Semana',
      newyork: 'NY', london: 'LON', tokyo: 'TOK', sydney: 'SYD', nomarket: 'OFF',
    };
    const anchorTag = anchorLabels[params.anchor] || params.anchor;
    ctx.fillStyle = '#f0b90b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Pivots (${params.type} · ${anchorTag})`, PADL + 4, PADT + 12);
  },
});

/* ────────────────────────────────────
   MFI — Money Flow Index
   (RSI que incluye el volumen — "RSI ponderado")
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'mfi',
  name:      'MFI — Money Flow Index',
  shortName: 'MFI',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'period',     label: 'Período',     type: 'number', default: 14,       min: 2,  max: 200 },
    { key: 'color',      label: 'Color',       type: 'color',  default: '#10b981' },
    { key: 'overbought', label: 'Sobrecompra', type: 'number', default: 80,       min: 50, max: 99 },
    { key: 'oversold',   label: 'Sobreventa',  type: 'number', default: 20,       min: 1,  max: 50 },
    { key: 'scaleMin',   label: '', type: 'number', default: 0 },
    { key: 'scaleMax',   label: '', type: 'number', default: 100 },
  ],
  calc(candles, p) {
    const tp  = candles.map(c => (c.h + c.l + c.c) / 3);
    const rmf = tp.map((t, i) => t * candles[i].v);
    const mfi = candles.map((c, i) => {
      if (i < p.period) return null;
      let posFlow = 0, negFlow = 0;
      for (let j = i - p.period + 1; j <= i; j++) {
        if (tp[j] > tp[j-1]) posFlow += rmf[j];
        else negFlow += rmf[j];
      }
      return negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
    });
    return { lines: { main: candles.map((c, i) => ({ t: c.t, v: mfi[i] })) } };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts = series.lines.main;
    const vMin = 0, vMax = 100, range = 100;
    const py2 = v => panelY + panelH - ((v - vMin) / range) * panelH;

    ctx.fillStyle = '#0b0e1188'; ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const yOB = py2(params.overbought), yOS = py2(params.oversold);
    ctx.fillStyle = '#ff547011'; ctx.fillRect(PADL, panelY, W - PADL - PADR, yOB - panelY);
    ctx.fillStyle = '#26d99411'; ctx.fillRect(PADL, yOS, W - PADL - PADR, panelY + panelH - yOS);

    [{ v: params.overbought, col: '#ff547066' }, { v: 50, col: '#3a3f4766' }, { v: params.oversold, col: '#26d99466' }].forEach(({ v, col }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(v, W - PADR - 3, y - 2);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    // Área rellena
    const visPts = pts.filter(pt => pt.v != null && !isNaN(pt.v) && candles.findIndex(c => c.t === pt.t) >= 0);
    if (visPts.length > 1) {
      ctx.beginPath();
      const fci = candles.findIndex(c => c.t === visPts[0].t);
      ctx.moveTo(barX(fci) + barW/2, panelY + panelH);
      visPts.forEach(pt => {
        const ci = candles.findIndex(c => c.t === pt.t);
        ctx.lineTo(barX(ci) + barW/2, py2(pt.v));
      });
      const lci = candles.findIndex(c => c.t === visPts[visPts.length-1].t);
      ctx.lineTo(barX(lci) + barW/2, panelY + panelH);
      ctx.closePath();
      ctx.fillStyle = params.color + '22'; ctx.fill();
    }
    ctx.beginPath(); ctx.strokeStyle = params.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let s = false;
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) { s = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x = barX(ci) + barW/2, y = py2(pt.v);
      if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#10b98199'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`MFI(${params.period})`, PADL + 4, panelY + 11);

    const last = visPts.slice(-1)[0];
    if (last) {
      const y = py2(last.v);
      const col = last.v >= params.overbought ? '#ff5470' : last.v <= params.oversold ? '#26d994' : params.color;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(last.v.toFixed(1), W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }
  },
});

/* ────────────────────────────────────
   DELTA — Volume Delta (Compra vs Venta estimada)
   (Indicador de flujo de órdenes — muy popular en futuros)
   Estima presión compradora/vendedora por vela.
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'delta',
  name:      'Delta — Volumen Compra vs Venta',
  shortName: 'DELTA',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'smooth',    label: 'Suavizado',   type: 'number', default: 1,        min: 1, max: 20 },
    { key: 'buyColor',  label: 'Compra',      type: 'color',  default: '#26d994' },
    { key: 'sellColor', label: 'Venta',       type: 'color',  default: '#ff5470' },
  ],
  calc(candles, p) {
    // Estimación: delta = vol * (2 * (close - low) / (high - low) - 1)
    // Rango 0..1 donde 1=compra pura, 0=venta pura
    const raw = candles.map(c => {
      const range = c.h - c.l;
      if (!range) return 0;
      const buyRatio = (c.c - c.l) / range;
      return c.v * (2 * buyRatio - 1); // positivo=compra, negativo=venta
    });
    const smoothed = p.smooth > 1 ? INDICATORS.math.sma(raw, p.smooth) : raw;
    // Delta acumulado (cumDelta)
    const cumDelta = [];
    let cum = 0;
    smoothed.forEach(v => { cum += (v || 0); cumDelta.push(cum); });

    return {
      lines: {
        main:     candles.map((c, i) => ({ t: c.t, v: smoothed[i] })),
        cumDelta: candles.map((c, i) => ({ t: c.t, v: cumDelta[i] })),
      },
      raw: smoothed,
    };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts = series.lines.main;
    const vals = pts.map(p => p.v).filter(v => v != null && !isNaN(v));
    if (!vals.length) return;
    const ext   = Math.max(Math.abs(Math.min(...vals)), Math.abs(Math.max(...vals))) * 1.05 || 1;
    const vMin  = -ext, vMax = ext, range = 2 * ext;
    const py2   = v => panelY + panelH - ((v - vMin) / range) * panelH;
    const yZero = py2(0);

    ctx.fillStyle = '#0b0e1188'; ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Línea cero
    ctx.strokeStyle = '#3a3f4799'; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, yZero); ctx.lineTo(W - PADR, yZero); ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Barras de delta
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) return;
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x = barX(ci), y = py2(pt.v), h = Math.abs(y - yZero);
      ctx.fillStyle = pt.v >= 0
        ? (pt.v > (pts[Math.max(0, pts.indexOf(pt)-1)]?.v ?? 0) ? params.buyColor + 'cc' : params.buyColor + '77')
        : (pt.v < (pts[Math.max(0, pts.indexOf(pt)-1)]?.v ?? 0) ? params.sellColor + 'cc' : params.sellColor + '77');
      ctx.fillRect(x + 1, Math.min(y, yZero), barW - 1, Math.max(h, 1));
    });
    ctx.restore();

    // Escala derecha
    const fmt = v => Math.abs(v) >= 1e9 ? (v/1e9).toFixed(1)+'B' : Math.abs(v) >= 1e6 ? (v/1e6).toFixed(1)+'M' : Math.abs(v) >= 1e3 ? (v/1e3).toFixed(0)+'K' : v.toFixed(0);
    [vMax, 0, vMin].forEach(lv => {
      ctx.fillStyle = '#5a6272'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
      ctx.fillText(fmt(lv), W - PADR - 3, py2(lv) - 2);
    });

    ctx.fillStyle = '#26d99499'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Delta Vol (estimado)`, PADL + 4, panelY + 11);
  },
});


/* ════════════════════════════════════════════════════════════════════
   LIQUIDEZ DE SESIÓN — Session Liquidity
   Marca máximos y mínimos de sesiones anteriores que NO han sido
   "barridos" (swept) por el precio posterior.
   Estos niveles son imanes de liquidez — donde hay stops acumulados.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'sess_liquidity',
  name:      'Liquidez de Sesión — Highs/Lows no barridos',
  shortName: 'LIQ',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'lookback',  label: 'Sesiones atrás', type: 'number', default: 8,        min: 2,  max: 50 },
    { key: 'highColor', label: 'Liquidez alta',  type: 'color',  default: '#ff5470' },
    { key: 'lowColor',  label: 'Liquidez baja',  type: 'color',  default: '#26d994' },
    { key: 'swept',     label: 'Mostrar barridos', type: 'select', default: 'no',
      options: [{ v: 'no', l: 'No (solo activos)' }, { v: 'yes', l: 'Sí (todos)' }] },
    { key: 'minSess',   label: 'Sesiones mínimas igual nivel', type: 'number', default: 1, min: 1, max: 5 },
  ],
  calc(candles, p) {
    // Para cada vela i, tomamos las últimas p.lookback velas anteriores
    // y marcamos sus highs/lows si el precio posterior NO los ha tocado
    const levels = [];
    const n = candles.length;

    for (let i = p.lookback; i < n; i++) {
      const prev = candles[i - p.lookback];
      const future = candles.slice(i);

      // ¿El high de prev fue barrido por alguna vela posterior?
      const highSwept = future.some(c => c.h >= prev.h);
      const lowSwept  = future.some(c => c.l <= prev.l);

      if (!highSwept || p.swept === 'yes') {
        levels.push({
          price:    prev.h,
          startIdx: i - p.lookback,
          endIdx:   highSwept ? future.findIndex(c => c.h >= prev.h) + i : n - 1,
          type:     'high',
          swept:    highSwept,
          sessName: prev.sessionName || prev.sessionKey || '',
        });
      }
      if (!lowSwept || p.swept === 'yes') {
        levels.push({
          price:    prev.l,
          startIdx: i - p.lookback,
          endIdx:   lowSwept ? future.findIndex(c => c.l <= prev.l) + i : n - 1,
          type:     'low',
          swept:    lowSwept,
          sessName: prev.sessionName || prev.sessionKey || '',
        });
      }
    }

    // Deduplicar niveles muy cercanos (dentro de 0.05% del precio)
    const deduped = [];
    levels.forEach(lv => {
      const dup = deduped.find(d =>
        d.type === lv.type &&
        Math.abs(d.price - lv.price) / lv.price < 0.0005 &&
        d.swept === lv.swept
      );
      if (!dup) deduped.push(lv);
    });

    return { levels: deduped };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    if (!series.levels || !series.levels.length) return;

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();

    const fmt = v => v >= 10000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);

    series.levels.forEach(lv => {
      const x1  = barX(lv.startIdx);
      const x2  = barX(Math.min(lv.endIdx, candles.length - 1)) + barW;
      const y   = py(lv.price);
      const col = lv.type === 'high' ? params.highColor : params.lowColor;
      const alpha = lv.swept ? '44' : 'cc';

      // Línea punteada
      ctx.strokeStyle = col + alpha;
      ctx.lineWidth   = lv.swept ? 0.6 : 1.2;
      ctx.setLineDash(lv.swept ? [2, 5] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      ctx.setLineDash([]);

      if (!lv.swept) {
        // Triángulo indicador al inicio
        ctx.fillStyle = col + 'cc';
        ctx.beginPath();
        if (lv.type === 'high') {
          ctx.moveTo(x1, y); ctx.lineTo(x1 + 6, y - 5); ctx.lineTo(x1 + 6, y); ctx.fill();
        } else {
          ctx.moveTo(x1, y); ctx.lineTo(x1 + 6, y + 5); ctx.lineTo(x1 + 6, y); ctx.fill();
        }
        // Etiqueta precio al final
        ctx.fillStyle = col + 'cc';
        ctx.font = '8px monospace'; ctx.textAlign = 'left';
        ctx.fillText(fmt(lv.price), x2 + 2, y + (lv.type === 'high' ? -2 : 9));
      }
    });

    ctx.restore();
    ctx.fillStyle = '#ff547099'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Liquidez (${params.lookback} ses.)`, PADL + 4, PADT + 12);
  },
});


/* ════════════════════════════════════════════════════════════════════
   SOPORTE / RESISTENCIA DINÁMICA DE SESIÓN
   Detecta zonas donde el precio ha rebotado múltiples veces.
   Agrupa niveles cercanos en "zonas" con grosor proporcional
   a la cantidad de toques.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'sess_sr',
  name:      'Soporte/Resistencia Dinámica de Sesión',
  shortName: 'S/R',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'sensitivity', label: 'Sensibilidad (%)',  type: 'number', default: 0.3,  min: 0.05, max: 2,  step: 0.05 },
    { key: 'minTouches',  label: 'Toques mínimos',   type: 'number', default: 2,    min: 2,    max: 10 },
    { key: 'lookback',    label: 'Sesiones atrás',   type: 'number', default: 30,   min: 5,    max: 200 },
    { key: 'supColor',    label: 'Soporte',           type: 'color',  default: '#26d994' },
    { key: 'resColor',    label: 'Resistencia',       type: 'color',  default: '#ff5470' },
    { key: 'neutColor',   label: 'Neutral (ambos)',   type: 'color',  default: '#f0b90b' },
    { key: 'showZone',    label: 'Mostrar zona',      type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí (banda)' }, { v: 'no', l: 'No (línea)' }] },
  ],
  calc(candles, p) {
    const n = candles.length;
    const start = Math.max(0, n - p.lookback);
    const slice = candles.slice(start);
    const lastPrice = candles[n - 1]?.c ?? 0;

    // Recolectar todos los pivots de sesión (highs y lows)
    const pivots = [];
    slice.forEach((c, i) => {
      pivots.push({ price: c.h, idx: start + i, isHigh: true });
      pivots.push({ price: c.l, idx: start + i, isHigh: false });
    });

    // Agrupar pivots cercanos en zonas
    const tol = p.sensitivity / 100;
    const zones = [];

    pivots.forEach(pv => {
      const existing = zones.find(z => Math.abs(z.center - pv.price) / z.center < tol);
      if (existing) {
        existing.touches++;
        existing.highs  += pv.isHigh ? 1 : 0;
        existing.lows   += pv.isHigh ? 0 : 1;
        existing.center  = (existing.center * (existing.touches - 1) + pv.price) / existing.touches;
        existing.minIdx  = Math.min(existing.minIdx, pv.idx);
        existing.maxIdx  = Math.max(existing.maxIdx, pv.idx);
        existing.priceMin = Math.min(existing.priceMin, pv.price);
        existing.priceMax = Math.max(existing.priceMax, pv.price);
      } else {
        zones.push({
          center: pv.price, touches: 1,
          highs: pv.isHigh ? 1 : 0, lows: pv.isHigh ? 0 : 1,
          minIdx: pv.idx, maxIdx: pv.idx,
          priceMin: pv.price, priceMax: pv.price,
        });
      }
    });

    // Filtrar por mínimo de toques y extender hasta ahora
    const active = zones
      .filter(z => z.touches >= p.minTouches)
      .map(z => ({
        ...z,
        endIdx: n - 1,
        isSupport:    lastPrice > z.center,
        isResistance: lastPrice < z.center,
      }));

    return { zones: active };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    if (!series.zones || !series.zones.length) return;

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();

    const fmt = v => v >= 10000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2);

    series.zones.forEach(z => {
      const x1 = barX(z.minIdx);
      const x2 = barX(z.endIdx) + barW;
      const yC  = py(z.center);
      const yHi = py(z.priceMax);
      const yLo = py(z.priceMin);

      const col = z.highs > z.lows * 1.5 ? params.resColor
                : z.lows  > z.highs * 1.5 ? params.supColor
                : params.neutColor;

      const strength = Math.min(1, z.touches / 8);

      // Banda de zona
      if (params.showZone === 'yes') {
        ctx.fillStyle = col + Math.floor(strength * 28).toString(16).padStart(2,'0');
        const bandH = Math.max(yLo - yHi, 2);
        ctx.fillRect(x1, yHi, x2 - x1, bandH);
      }

      // Línea central
      ctx.strokeStyle = col + Math.floor(strength * 180 + 40).toString(16).padStart(2,'0');
      ctx.lineWidth   = 0.8 + strength * 1.2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(x1, yC); ctx.lineTo(x2, yC); ctx.stroke();
      ctx.setLineDash([]);

      // Badge de toques al final
      const badgeTxt = `${z.touches}x`;
      ctx.font = 'bold 8px monospace';
      const bw = ctx.measureText(badgeTxt).width + 6;
      ctx.fillStyle = col + 'cc';
      ctx.fillRect(x2 + 2, yC - 6, bw, 12);
      ctx.fillStyle = '#0b0e11';
      ctx.textAlign = 'center';
      ctx.fillText(badgeTxt, x2 + 2 + bw / 2, yC + 3);

      // Precio
      ctx.fillStyle = col + '99';
      ctx.font = '8px monospace'; ctx.textAlign = 'left';
      ctx.fillText(fmt(z.center), x2 + bw + 6, yC + 3);
    });

    ctx.restore();
    ctx.fillStyle = '#f0b90b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`S/R Dinámico (${params.minTouches}+ toques)`, PADL + 4, PADT + 12);
  },
});


/* ════════════════════════════════════════════════════════════════════
   ACUMULACIÓN / DISTRIBUCIÓN / TENDENCIA por sesión
   Clasifica cada vela de sesión en una de 4 fases de mercado:
   
   ACUMULACIÓN  — Rango estrecho, volumen bajo, precio lateral
                  (Smart money comprando silenciosamente)
   DISTRIBUCIÓN — Rango amplio, volumen alto, cierre en extremos
                  (Smart money vendiendo a retail)
   TENDENCIA ↑  — Sesiones consecutivas con HH y HL, cierres altos
   TENDENCIA ↓  — Sesiones consecutivas con LH y LL, cierres bajos
   
   Se muestra como panel de barras coloreadas + línea de fase.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'sess_phase',
  name:      'Fase de Mercado — Acumulación / Distribución / Tendencia',
  shortName: 'FASE',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'smoothing',   label: 'Suavizado (sesiones)', type: 'number', default: 3,  min: 1, max: 10 },
    { key: 'accColor',    label: 'Acumulación',          type: 'color',  default: '#38bdf8' },
    { key: 'distColor',   label: 'Distribución',         type: 'color',  default: '#f59e0b' },
    { key: 'trendUColor', label: 'Tendencia alcista',    type: 'color',  default: '#26d994' },
    { key: 'trendDColor', label: 'Tendencia bajista',    type: 'color',  default: '#ff5470' },
  ],
  calc(candles, p) {
    const n = candles.length;
    if (n < 4) return { bars: [] };

    // Calcular ATR de sesión para normalizar el rango
    const ranges = candles.map(c => c.h - c.l);
    const atrRaw = INDICATORS.math.sma(ranges, Math.min(10, n));

    // Score de cada vela:
    // rangeScore: qué tan amplio es el rango vs ATR (>1 = amplio, <0.5 = estrecho)
    // closeScore: dónde cerró dentro del rango (0=abajo, 1=arriba, 0.5=medio)
    // volScore:   volumen relativo vs media
    const vols = candles.map(c => c.v);
    const volMa = INDICATORS.math.sma(vols, Math.min(10, n));

    const scores = candles.map((c, i) => {
      const atr = atrRaw[i] || 1;
      const rangeScore = (c.h - c.l) / atr;
      const closeScore = (c.h === c.l) ? 0.5 : (c.c - c.l) / (c.h - c.l);
      const volScore   = volMa[i] ? c.v / volMa[i] : 1;

      // Dirección vs vela anterior
      const prev = candles[i - 1];
      const bullish = prev ? c.c > prev.c : true;
      const hh = prev ? c.h > prev.h : true;
      const ll = prev ? c.l < prev.l : false;
      const hl = prev ? c.l > prev.l : true;
      const lh = prev ? c.h < prev.h : false;

      return { rangeScore, closeScore, volScore, bullish, hh, hl, ll, lh, i };
    });

    // Clasificar cada vela
    const classify = (sc, prev2) => {
      // Tendencia alcista: HH + HL, cierre en parte alta
      if (sc.hh && sc.hl && sc.closeScore > 0.6) return 'trendU';
      // Tendencia bajista: LH + LL, cierre en parte baja
      if (sc.lh && sc.ll && sc.closeScore < 0.4) return 'trendD';
      // Distribución: rango amplio, volumen alto, cierre en extremo
      if (sc.rangeScore > 1.3 && sc.volScore > 1.2) {
        return sc.closeScore > 0.5 ? 'trendU' : 'trendD';
      }
      // Acumulación: rango estrecho, volumen bajo/medio, precio lateral
      if (sc.rangeScore < 0.7) return 'acc';
      // Distribución: rango medio-amplio con volumen alto
      if (sc.volScore > 1.4) return 'dist';
      return 'acc'; // default neutral → acumulación
    };

    const phases = scores.map((sc, i) => ({
      t:     candles[i].t,
      phase: classify(sc, i > 0 ? scores[i-1] : null),
      range: sc.rangeScore,
      close: sc.closeScore,
      vol:   sc.volScore,
    }));

    // Suavizado: si smoothing > 1, usar la fase más frecuente en ventana
    const smoothed = phases.map((ph, i) => {
      if (p.smoothing <= 1) return ph;
      const win = phases.slice(Math.max(0, i - p.smoothing + 1), i + 1);
      const freq = {};
      win.forEach(w => { freq[w.phase] = (freq[w.phase] || 0) + 1; });
      const dominant = Object.entries(freq).sort((a,b) => b[1]-a[1])[0][0];
      return { ...ph, phase: dominant };
    });

    return { bars: smoothed };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    if (!series.bars || !series.bars.length) return;

    const phaseColors = {
      trendU: params.trendUColor,
      trendD: params.trendDColor,
      acc:    params.accColor,
      dist:   params.distColor,
    };
    const phaseLabels = {
      trendU: 'Tend. ↑',
      trendD: 'Tend. ↓',
      acc:    'Acum.',
      dist:   'Dist.',
    };

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Dibujar barra de fase por cada vela
    series.bars.forEach(bar => {
      const ci = candles.findIndex(c => c.t === bar.t);
      if (ci < 0) return;
      const x   = barX(ci);
      const col = phaseColors[bar.phase] || '#848e9c';

      // Barra de fondo coloreada
      ctx.fillStyle = col + '33';
      ctx.fillRect(x, panelY, barW, panelH);

      // Línea de intensidad basada en volumen relativo
      const intensity = Math.min(1, bar.vol / 2);
      const barHeight = panelH * intensity;
      ctx.fillStyle = col + 'aa';
      ctx.fillRect(x + 1, panelY + panelH - barHeight, barW - 2, barHeight);
    });

    // Línea de fase (conecta el centro de cada barra con color)
    const phaseOrder = { acc: 0.2, dist: 0.5, trendU: 0.85, trendD: 0.15 };
    let prev = null;
    series.bars.forEach(bar => {
      const ci = candles.findIndex(c => c.t === bar.t);
      if (ci < 0) { prev = null; return; }
      const x = barX(ci) + barW / 2;
      const y = panelY + panelH * (1 - phaseOrder[bar.phase]);
      const col = phaseColors[bar.phase] || '#848e9c';

      if (prev) {
        ctx.strokeStyle = col + 'dd';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y); ctx.stroke();
      }
      // Punto
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      prev = { x, y, col };
    });

    ctx.restore();

    // Leyenda interna
    const lastBar = series.bars[series.bars.length - 1];
    const lastPhase = lastBar?.phase || 'acc';
    const lastCol   = phaseColors[lastPhase];
    const lastLbl   = phaseLabels[lastPhase];

    ctx.fillStyle = lastCol + 'cc'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`FASE: ${lastLbl}`, PADL + 4, panelY + 11);

    // Mini leyenda de colores
    const legend = [
      { phase: 'trendU', lbl: 'Tend.↑' },
      { phase: 'trendD', lbl: 'Tend.↓' },
      { phase: 'acc',    lbl: 'Acum.'  },
      { phase: 'dist',   lbl: 'Dist.'  },
    ];
    let lx = PADL + 80;
    legend.forEach(({ phase, lbl }) => {
      ctx.fillStyle = phaseColors[phase] + 'aa';
      ctx.fillRect(lx, panelY + 3, 8, 8);
      ctx.fillStyle = '#848e9c';
      ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(lbl, lx + 10, panelY + 11);
      lx += ctx.measureText(lbl).width + 18;
    });

    // Valor último en eje derecho
    if (lastBar) {
      const y = panelY + panelH * (1 - phaseOrder[lastPhase]);
      ctx.fillStyle = lastCol;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(lastLbl, W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }
  },
});


/* ════════════════════════════════════════════════════════════════════
   SESSION DOMINANCE — ¿Qué sesión controló el mercado?

   Funciona POR VELA: cada vela ya tiene su sessionKey asignado
   por app.js (sydney, tokyo, london, newyork, _solap, nomarket).
   
   Para cada vela calcula un score de actividad relativo al promedio
   histórico de esa misma sesión (lookback velas de esa sesión atrás).
   Score = 0→1, donde 1 = máxima actividad histórica de esa sesión.
   
   Se dibuja una barra vertical por vela, coloreada con el color de
   su sesión, con altura proporcional al score. Las velas nomarket
   se muestran como una línea muy tenue.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'sess_dominance',
  name:      'Session Dominance — ¿Quién controla el mercado?',
  shortName: 'DOM',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'metric', label: 'Métrica', type: 'select', default: 'combined',
      options: [
        { v: 'combined',  l: 'Combinado (rango + vol + dirección)' },
        { v: 'range',     l: 'Solo rango (movimiento de precio)'   },
        { v: 'volume',    l: 'Solo volumen'                        },
        { v: 'direction', l: 'Solo dirección (fuerza del cierre)'  },
      ]
    },
    { key: 'lookback', label: 'Velas atrás (por sesión)', type: 'number', default: 20, min: 3, max: 100 },
  ],

  calc(candles, p) {
    if (!candles.length) return { bars: [] };

    // Colores de sesión (igual que la app)
    const SESS_COLORS = {
      sydney:        '#38bdf8',
      sydney_solap:  '#7dd3fc',
      tokyo:         '#f59e0b',
      tokyo_solap:   '#fcd34d',
      london:        '#c084fc',
      london_solap:  '#e879f9',
      newyork:       '#10b981',
      newyork_solap: '#34d399',
      nomarket:      '#3a3f47',
    };

    // Historial de métricas por sessionKey para calcular score relativo
    // Guardamos las últimas `lookback` métricas de cada sesión
    const history = {}; // sessionKey → [metric, ...]

    const bars = candles.map((c, i) => {
      const sk   = c.sessionKey || 'unknown';
      const col  = SESS_COLORS[sk] || '#848e9c';
      const isNM = sk === 'nomarket' || sk === 'unknown';

      // Calcular métrica bruta de esta vela
      const range = c.h - c.l;
      const vol   = c.v || 0;
      const dir   = range > 0 ? Math.abs(c.c - c.o) / range : 0;

      let raw;
      if (p.metric === 'range')     raw = range;
      else if (p.metric === 'volume')    raw = vol;
      else if (p.metric === 'direction') raw = dir;
      else raw = range * 0.4 + vol * 0.4 + dir * 0.2; // combined — vol y range en distintas escalas, se normaliza luego

      // Obtener/actualizar historial de esta sesión
      if (!history[sk]) history[sk] = [];
      const hist = history[sk];

      // Score = qué tan alta es esta vela vs el máximo histórico de su sesión
      let score = 0;
      if (!isNM && hist.length > 0) {
        const maxHist = Math.max(...hist);
        score = maxHist > 0 ? Math.min(1, raw / maxHist) : 0;
      }

      // Añadir al historial (ventana deslizante)
      hist.push(raw);
      if (hist.length > p.lookback) hist.shift();

      // Nombre corto legible
      const name = c.sessionName || sk;

      return {
        t:       c.t,
        idx:     i,
        sk,
        color:   col,
        score,
        bullish: c.c >= c.o,
        isNM,
        name,
      };
    });

    return { bars };
  },

  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    if (!series.bars || !series.bars.length) return;

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Línea de referencia al 50%
    const yMid = panelY + panelH * 0.5;
    ctx.strokeStyle = '#3a3f4755'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(PADL, yMid); ctx.lineTo(W - PADR, yMid); ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    const PAD_TOP = 14; // margen superior para que barras al 100% no toquen el borde
    const PAD_BOT = 4;
    const innerH  = panelH - PAD_TOP - PAD_BOT;

    series.bars.forEach(bar => {
      const ci = candles.findIndex(c => c.t === bar.t);
      if (ci < 0) return;

      const x  = barX(ci);
      const bw = Math.max(1, barW - 1);

      if (bar.isNM) {
        // Sin mercado → línea muy tenue al fondo
        ctx.fillStyle = '#3a3f4722';
        ctx.fillRect(x, panelY + panelH - PAD_BOT, bw, 2);
        return;
      }

      // Barra de fondo (color de sesión, muy tenue)
      ctx.fillStyle = bar.color + '1a';
      ctx.fillRect(x, panelY + PAD_TOP, bw, innerH);

      // Barra de score (altura = score, desde abajo)
      const bh    = Math.max(1, innerH * bar.score);
      const yTop  = panelY + PAD_TOP + innerH - bh;
      const alpha = bar.score > 0.7 ? 'cc' : bar.score > 0.4 ? '99' : '55';
      ctx.fillStyle = bar.color + alpha;
      ctx.fillRect(x, yTop, bw, bh);

      // Cap en la punta de la barra (línea brillante para ver dónde termina)
      if (bw >= 2) {
        ctx.fillStyle = bar.color + 'ff';
        ctx.fillRect(x, yTop, bw, 2);
      }

      // Marcador de dirección (pequeño triángulo justo encima de la barra)
      if (bar.score > 0.5 && bw >= 5) {
        ctx.fillStyle = bar.bullish ? '#26d994aa' : '#ff5470aa';
        const mx = x + bw / 2;
        const my = yTop - 2;
        ctx.beginPath();
        if (bar.bullish) {
          ctx.moveTo(mx, my - 4); ctx.lineTo(mx - 3, my); ctx.lineTo(mx + 3, my);
        } else {
          ctx.moveTo(mx, my + 4); ctx.lineTo(mx - 3, my); ctx.lineTo(mx + 3, my);
        }
        ctx.fill();
      }
    });

    ctx.restore();

    // ── Leyenda con la última sesión visible ──
    const lastBar = series.bars.filter(b => !b.isNM).slice(-1)[0];
    if (lastBar) {
      const pct = (lastBar.score * 100).toFixed(0);
      ctx.fillStyle = lastBar.color + 'cc';
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
      const label = lastBar.name.split('/')[0].trim();
      ctx.fillText(`DOM · ${label} · ${pct}%`, PADL + 4, panelY + panelH - 4);
    } else {
      ctx.fillStyle = '#f0b90b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('Dominancia de Sesión', PADL + 4, panelY + panelH - 4);
    }

    // Etiqueta eje derecho (score de última barra)
    if (lastBar) {
      const _innerH = panelH - 14 - 4;
      const yLabel  = panelY + 14 + _innerH - _innerH * lastBar.score;
      ctx.fillStyle = lastBar.color;
      ctx.beginPath();
      ctx.roundRect(W - PADR + 3, yLabel - 8, PADR - 6, 16, 3);
      ctx.fill();
      ctx.fillStyle = '#0b0e11';
      ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText((lastBar.score * 100).toFixed(0) + '%', W - PADR + 3 + (PADR - 6) / 2, yLabel + 3);
    }
  },
});


/* ════════════════════════════════════════════════════════════════════
   PRICE POSITION — ¿El precio está caro o barato?
   
   Muestra dónde está el precio actual dentro del rango de las
   últimas N sesiones, como un percentil (0%=mínimo, 100%=máximo).
   
   Incluye:
   - Línea de percentil (0-100)
   - Zona "cara" (>80%) en rojo, "barata" (<20%) en verde
   - Media histórica (50%) como referencia
   - Etiqueta del nivel exacto en eje derecho
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'price_position',
  name:      'Price Position — Precio caro vs barato (percentil histórico)',
  shortName: 'POS%',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'lookback',   label: 'Sesiones atrás',  type: 'number', default: 20,  min: 5,  max: 200 },
    { key: 'overbought', label: 'Zona cara (%)',    type: 'number', default: 80,  min: 60, max: 99  },
    { key: 'oversold',   label: 'Zona barata (%)',  type: 'number', default: 20,  min: 1,  max: 40  },
    { key: 'lineColor',  label: 'Color línea',      type: 'color',  default: '#f0b90b' },
    { key: 'highColor',  label: 'Zona cara',        type: 'color',  default: '#ff5470' },
    { key: 'lowColor',   label: 'Zona barata',      type: 'color',  default: '#26d994' },
    { key: 'scaleMin',   label: '', type: 'number', default: 0   },
    { key: 'scaleMax',   label: '', type: 'number', default: 100 },
  ],
  calc(candles, p) {
    const n = candles.length;
    const pct = candles.map((c, i) => {
      if (i < p.lookback - 1) return null;
      const window = candles.slice(i - p.lookback + 1, i + 1);
      const hi = Math.max(...window.map(w => w.h));
      const lo = Math.min(...window.map(w => w.l));
      if (hi === lo) return 50;
      return ((c.c - lo) / (hi - lo)) * 100;
    });

    // También calcular el rango histórico absoluto para referencia
    const rangeHi = candles.map((c, i) => {
      if (i < p.lookback - 1) return null;
      return Math.max(...candles.slice(i - p.lookback + 1, i + 1).map(w => w.h));
    });
    const rangeLo = candles.map((c, i) => {
      if (i < p.lookback - 1) return null;
      return Math.min(...candles.slice(i - p.lookback + 1, i + 1).map(w => w.l));
    });

    return {
      lines: {
        main: candles.map((c, i) => ({ t: c.t, v: pct[i] })),
      },
      rangeHi: candles.map((c, i) => ({ t: c.t, v: rangeHi[i] })),
      rangeLo: candles.map((c, i) => ({ t: c.t, v: rangeLo[i] })),
    };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts  = series.lines.main;
    const vMin = 0, vMax = 100, range = 100;
    const py2  = v => panelY + panelH - (v / range) * panelH;

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Zonas cara/barata
    const yOB = py2(params.overbought), yOS = py2(params.oversold);
    ctx.fillStyle = params.highColor + '18';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, yOB - panelY);
    ctx.fillStyle = params.lowColor + '18';
    ctx.fillRect(PADL, yOS, W - PADL - PADR, panelY + panelH - yOS);

    // Líneas de referencia
    [
      { v: params.overbought, col: params.highColor + '88', lbl: `${params.overbought}% Caro`   },
      { v: 50,                col: '#3a3f4766',              lbl: '50% Media'                    },
      { v: params.oversold,   col: params.lowColor  + '88', lbl: `${params.oversold}% Barato`   },
    ].forEach(({ v, col, lbl }) => {
      const y = py2(v);
      ctx.strokeStyle = col; ctx.lineWidth = 0.7; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(lbl, W - PADR - 3, y - 2);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Área rellena bajo la línea
    const visPts = pts.filter(pt => pt.v != null && !isNaN(pt.v) && candles.findIndex(c => c.t === pt.t) >= 0);
    if (visPts.length > 1) {
      ctx.beginPath();
      const fci = candles.findIndex(c => c.t === visPts[0].t);
      ctx.moveTo(barX(fci) + barW / 2, py2(50)); // desde la media
      visPts.forEach(pt => {
        const ci = candles.findIndex(c => c.t === pt.t);
        ctx.lineTo(barX(ci) + barW / 2, py2(pt.v));
      });
      const lci = candles.findIndex(c => c.t === visPts[visPts.length - 1].t);
      ctx.lineTo(barX(lci) + barW / 2, py2(50));
      ctx.closePath();
      // Color del área según posición
      const lastV = visPts[visPts.length - 1].v;
      const areaCol = lastV >= params.overbought ? params.highColor
                    : lastV <= params.oversold   ? params.lowColor
                    : params.lineColor;
      ctx.fillStyle = areaCol + '22'; ctx.fill();
    }

    // Línea principal con color dinámico por zona
    ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    let started = false;
    pts.forEach(pt => {
      if (pt.v == null || isNaN(pt.v)) { started = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x   = barX(ci) + barW / 2;
      const y   = py2(pt.v);
      const col = pt.v >= params.overbought ? params.highColor
                : pt.v <= params.oversold   ? params.lowColor
                : params.lineColor;
      if (!started) { ctx.beginPath(); ctx.moveTo(x, y); ctx.strokeStyle = col; }
      else {
        ctx.lineTo(x, y);
        ctx.strokeStyle = col; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, y);
      }
      started = true;
    });
    ctx.restore();

    // Etiqueta
    ctx.fillStyle = '#f0b90b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`POS% (${params.lookback} ses.)`, PADL + 4, panelY + 11);

    // Valor actual en eje derecho
    const last = visPts.slice(-1)[0];
    if (last) {
      const y   = py2(last.v);
      const col = last.v >= params.overbought ? params.highColor
                : last.v <= params.oversold   ? params.lowColor
                : params.lineColor;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(last.v.toFixed(0) + '%', W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }
  },
});

/* ════════════════════════════════════════════════════════════════════
   1. SESSION MOMENTUM TRANSFER (SMT)
   
   Detecta si la sesión siguiente CONTINÚA o REVIERTE el movimiento
   de la sesión anterior. Muestra un panel de barras:
     +1  = continuación fuerte (misma dirección)
      0  = neutral
     -1  = reversión fuerte (dirección opuesta)
   
   Muy útil en futuros: si Londres sube fuerte, ¿New York continúa
   o lo revierte? El color de la barra es el de la sesión actual.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'smt',
  name:      'Session Momentum Transfer — ¿La sesión continúa o revierte?',
  shortName: 'SMT',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'threshold', label: 'Umbral continuación (%)', type: 'number', default: 30, min: 5, max: 90 },
    { key: 'scaleMin',  label: '', type: 'number', default: -1 },
    { key: 'scaleMax',  label: '', type: 'number', default:  1 },
  ],
  calc(candles, p) {
    if (candles.length < 2) return { bars: [] };
    const thresh = p.threshold / 100;
    const bars = candles.map((c, i) => {
      if (i === 0) return { t: c.t, v: 0, color: c.color || '#848e9c', sk: c.sessionKey, label: '—' };
      const prev = candles[i - 1];
      // Movimiento de la sesión anterior (normalizado por su rango)
      const prevRange = prev.h - prev.l || 1;
      const prevMove  = (prev.c - prev.o) / prevRange; // -1..+1
      // Movimiento de la sesión actual
      const curRange  = c.h - c.l || 1;
      const curMove   = (c.c - c.o) / curRange;
      // Transfer = correlación de dirección * magnitud
      const transfer  = Math.max(-1, Math.min(1, curMove * Math.sign(prevMove) * 2));
      const label = transfer >  thresh ? '▲ Continúa'
                  : transfer < -thresh ? '▼ Revierte'
                  : '◆ Neutral';
      return { t: c.t, v: transfer, color: c.color || '#848e9c', sk: c.sessionKey, name: c.sessionName, label, bullish: transfer > 0 };
    });
    return { bars };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    if (!series.bars?.length) return;

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const midY = panelY + panelH / 2;
    // Línea cero
    ctx.strokeStyle = '#3a3f47aa'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, midY); ctx.lineTo(W - PADR, midY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3a3f4799'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText('0', W - PADR - 3, midY - 2);

    // Líneas de umbral
    const thresh = params.threshold / 100;
    [thresh, -thresh].forEach(v => {
      const y = midY - v * (panelH / 2 - 4);
      ctx.strokeStyle = '#3a3f4755'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    series.bars.forEach(bar => {
      const ci = candles.findIndex(c => c.t === bar.t);
      if (ci < 0) return;
      const x  = barX(ci);
      const bw = Math.max(1, barW - 1);
      const halfH = panelH / 2 - 4;
      const bh  = Math.abs(bar.v) * halfH;
      const col = bar.color || '#848e9c';
      const alpha = Math.abs(bar.v) > thresh ? 'cc' : '66';

      if (bar.v >= 0) {
        ctx.fillStyle = col + alpha;
        ctx.fillRect(x, midY - bh, bw, bh);
        // cap
        ctx.fillStyle = col + 'ff';
        ctx.fillRect(x, midY - bh, bw, 2);
      } else {
        ctx.fillStyle = col + alpha;
        ctx.fillRect(x, midY, bw, bh);
        // cap
        ctx.fillStyle = col + 'ff';
        ctx.fillRect(x, midY + bh - 2, bw, 2);
      }
    });

    ctx.restore();

    // Leyenda
    const last = series.bars.slice(-1)[0];
    if (last) {
      const col = last.color || '#848e9c';
      ctx.fillStyle = col + 'cc'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`SMT · ${last.label} · ${(last.v * 100).toFixed(0)}%`, PADL + 4, panelY + panelH - 4);
    }

    // Eje derecho
    if (last) {
      const col  = last.color || '#848e9c';
      const midY2 = panelY + panelH / 2;
      const y    = midY2 - last.v * (panelH / 2 - 4);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText((last.v * 100).toFixed(0) + '%', W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }
  },
});


/* ════════════════════════════════════════════════════════════════════
   2. SESSION RANGE EXPANSION INDEX (SREI)
   
   Compara el rango de cada sesión contra su PROPIO promedio histórico
   (lookback velas de esa misma sesión). Cuando supera el umbral X%
   del promedio, la barra se resalta: la sesión está "despertando".
   
   Score = rango_actual / promedio_histórico_sesión
     1.0 = igual al promedio (normal)
     2.0 = doble del promedio (expansión fuerte)
     0.5 = mitad del promedio (contracción)
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'srei',
  name:      'Session Range Expansion Index — ¿La sesión está despertando?',
  shortName: 'SREI',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'lookback',  label: 'Velas históricas (por sesión)', type: 'number', default: 15, min: 3, max: 60 },
    { key: 'alertMult', label: 'Alerta expansión (x promedio)', type: 'number', default: 1.5, min: 1.1, max: 5 },
    { key: 'scaleMin',  label: '', type: 'number', default: 0 },
    { key: 'scaleMax',  label: '', type: 'number', default: 3 },
  ],
  calc(candles, p) {
    if (!candles.length) return { bars: [] };
    const history = {};
    const bars = candles.map((c, i) => {
      const sk  = c.sessionKey || 'unknown';
      const col = c.color || '#848e9c';
      const isNM = sk === 'nomarket' || sk === 'unknown';
      const range = c.h - c.l;

      if (!history[sk]) history[sk] = [];
      const hist = history[sk];

      let score = 1;
      if (!isNM && hist.length > 0) {
        const avg = hist.reduce((s, v) => s + v, 0) / hist.length;
        score = avg > 0 ? range / avg : 1;
      }

      hist.push(range);
      if (hist.length > p.lookback) hist.shift();

      const alert = score >= p.alertMult;
      return { t: c.t, v: score, color: col, sk, name: c.sessionName, isNM, alert, bullish: c.c >= c.o };
    });
    return { bars };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    if (!series.bars?.length) return;

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const PAD_TOP = 14; const PAD_BOT = 4;
    const innerH  = panelH - PAD_TOP - PAD_BOT;
    const maxScale = params.scaleMax || 3;
    const alertY   = panelY + PAD_TOP + innerH * (1 - params.alertMult / maxScale);

    // Línea de promedio (1.0)
    const avgY = panelY + PAD_TOP + innerH * (1 - 1 / maxScale);
    ctx.strokeStyle = '#3a3f47aa'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, avgY); ctx.lineTo(W - PADR, avgY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3a3f4799'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText('1×', W - PADR - 3, avgY - 2);

    // Línea de alerta
    if (alertY > panelY + PAD_TOP && alertY < panelY + panelH - PAD_BOT) {
      ctx.strokeStyle = '#f0b90b55'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, alertY); ctx.lineTo(W - PADR, alertY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f0b90b88'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`${params.alertMult}×`, W - PADR - 3, alertY - 2);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    series.bars.forEach(bar => {
      if (bar.isNM) return;
      const ci = candles.findIndex(c => c.t === bar.t);
      if (ci < 0) return;
      const x  = barX(ci);
      const bw = Math.max(1, barW - 1);
      const clampedV = Math.min(bar.v, maxScale);
      const bh    = Math.max(1, innerH * (clampedV / maxScale));
      const yTop  = panelY + PAD_TOP + innerH - bh;
      const alpha = bar.alert ? 'ee' : bar.v > 1 ? '99' : '44';
      const col   = bar.alert ? '#f0b90b' : bar.color;

      // Fondo tenue
      ctx.fillStyle = bar.color + '15';
      ctx.fillRect(x, panelY + PAD_TOP, bw, innerH);

      // Barra
      ctx.fillStyle = col + alpha;
      ctx.fillRect(x, yTop, bw, bh);

      // Cap
      ctx.fillStyle = col + 'ff';
      ctx.fillRect(x, yTop, bw, 2);

      // Halo de alerta
      if (bar.alert && bw >= 4) {
        ctx.strokeStyle = '#f0b90baa';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1, yTop - 1, bw + 2, bh + 2);
      }
    });

    ctx.restore();

    // Leyenda
    const last = series.bars.filter(b => !b.isNM).slice(-1)[0];
    if (last) {
      const col = last.alert ? '#f0b90b' : last.color;
      ctx.fillStyle = col + 'cc'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
      const lbl = last.name?.split('/')[0].trim() || last.sk;
      ctx.fillText(`SREI · ${lbl} · ${last.v.toFixed(2)}× promedio${last.alert ? ' ⚡' : ''}`, PADL + 4, panelY + panelH - 4);
    }

    // Eje derecho
    if (last) {
      const col     = last.alert ? '#f0b90b' : last.color;
      const clampedV = Math.min(last.v, maxScale);
      const bh      = innerH * (clampedV / maxScale);
      const yLabel  = panelY + PAD_TOP + innerH - bh;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, yLabel - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText(last.v.toFixed(1) + '×', W - PADR + 3 + (PADR - 6) / 2, yLabel + 3);
    }
  },
});


/* ════════════════════════════════════════════════════════════════════
   3. SESSION VWAP
   
   VWAP recalculado por sesión (no por día completo).
   Cada sesión tiene su propio VWAP que empieza de cero al inicio
   de esa sesión. Así ves si el precio está caro/barato DENTRO de
   la sesión actual, no del día completo.
   
   Se dibuja como overlay sobre las velas, con el color de cada sesión.
   También muestra bandas ±1σ opcionales.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'sess_vwap',
  name:      'Session VWAP — Precio justo por sesión de mercado',
  shortName: 'sVWAP',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'showBands', label: 'Mostrar bandas ±1σ', type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'lineWidth', label: 'Grosor línea', type: 'number', default: 1.5, min: 0.5, max: 4 },
  ],
  calc(candles, p) {
    if (!candles.length) return { lines: { main: [] }, bands: [] };

    const pts   = [];
    const upper = [];
    const lower = [];

    // Agrupar por sesión (sessionKey + inicio de bloque contiguo)
    let curSk    = null;
    let cumPV    = 0, cumV = 0, cumPV2 = 0;

    candles.forEach((c, i) => {
      const sk = c.sessionKey || 'unknown';
      // Nueva sesión → resetear acumuladores
      if (sk !== curSk) {
        curSk = sk; cumPV = 0; cumV = 0; cumPV2 = 0;
      }
      if (sk === 'nomarket' || sk === 'unknown' || c.v === 0) {
        pts.push({ t: c.t, v: null, color: c.color });
        upper.push({ t: c.t, v: null }); lower.push({ t: c.t, v: null });
        return;
      }
      const typical = (c.h + c.l + c.c) / 3;
      cumPV  += typical * c.v;
      cumV   += c.v;
      cumPV2 += typical * typical * c.v;
      const vwap = cumPV / cumV;
      const variance = Math.max(0, cumPV2 / cumV - vwap * vwap);
      const sigma = Math.sqrt(variance);
      pts.push({ t: c.t, v: vwap, color: c.color });
      upper.push({ t: c.t, v: vwap + sigma });
      lower.push({ t: c.t, v: vwap - sigma });
    });

    return { lines: { main: pts }, upper, lower };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, startIdx, endIdx, PADL, PADR, W, PADT, chartH, candles } = layout;

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();

    // Bandas ±1σ rellenas
    if (params.showBands === 'yes' && series.upper?.length) {
      // Dibujar área entre upper y lower por segmentos de sesión
      let segColor = null; let segUpper = []; let segLower = [];
      const flush = () => {
        if (segUpper.length < 2 || !segColor) return;
        ctx.beginPath();
        segUpper.forEach((pt, j) => {
          const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
          const x = barX(ci) + barW / 2, y = py(pt.v);
          j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        [...segLower].reverse().forEach(pt => {
          const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
          ctx.lineTo(barX(ci) + barW / 2, py(pt.v));
        });
        ctx.closePath();
        ctx.fillStyle = segColor + '18';
        ctx.fill();
        segUpper = []; segLower = [];
      };
      series.lines.main.forEach((pt, i) => {
        if (!pt.v || !series.upper[i]?.v) { flush(); segColor = null; return; }
        if (pt.color !== segColor) { flush(); segColor = pt.color; }
        segUpper.push(series.upper[i]);
        segLower.push(series.lower[i]);
      });
      flush();
    }

    // Línea VWAP principal (coloreada por sesión)
    let prevPt = null; let prevColor = null;
    series.lines.main.forEach((pt, i) => {
      if (!pt.v) { prevPt = null; return; }
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x = barX(ci) + barW / 2, y = py(pt.v);
      if (prevPt && pt.color === prevColor) {
        ctx.strokeStyle = pt.color + 'dd';
        ctx.lineWidth   = params.lineWidth;
        ctx.lineJoin    = 'round';
        ctx.beginPath(); ctx.moveTo(prevPt.x, prevPt.y); ctx.lineTo(x, y); ctx.stroke();
      }
      prevPt = { x, y }; prevColor = pt.color;
    });

    ctx.restore();
  },
});


/* ════════════════════════════════════════════════════════════════════
   4. SESSION BIAS SCORE
   
   Para cada sesión calcula el sesgo histórico alcista/bajista:
   ¿Cuántas veces fue alcista en las últimas N apariciones?
   
   Panel de líneas:
     > 60% → sesgo alcista (verde)
     < 40% → sesgo bajista (rojo)
     40-60% → neutral (gris)
   
   Útil para probabilidades de dirección al entrar en una nueva sesión.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'sess_bias',
  name:      'Session Bias Score — Sesgo histórico alcista/bajista por sesión',
  shortName: 'BIAS',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'lookback',   label: 'Ocurrencias atrás (por sesión)', type: 'number', default: 20, min: 5, max: 100 },
    { key: 'bullThresh', label: 'Umbral alcista (%)',             type: 'number', default: 60, min: 51, max: 90 },
    { key: 'bearThresh', label: 'Umbral bajista (%)',             type: 'number', default: 40, min: 10, max: 49 },
    { key: 'scaleMin',   label: '', type: 'number', default: 0   },
    { key: 'scaleMax',   label: '', type: 'number', default: 100 },
  ],
  calc(candles, p) {
    if (!candles.length) return { lines: { main: [] } };
    const history = {}; // sk → [1=bull, 0=bear, ...]
    const pts = candles.map((c, i) => {
      const sk  = c.sessionKey || 'unknown';
      const isNM = sk === 'nomarket' || sk === 'unknown';
      if (!history[sk]) history[sk] = [];
      const bull = c.c >= c.o ? 1 : 0;
      const hist = history[sk];
      // Score ANTES de añadir la vela actual
      let score = 50;
      if (!isNM && hist.length > 0) {
        score = (hist.reduce((s, v) => s + v, 0) / hist.length) * 100;
      }
      hist.push(bull);
      if (hist.length > p.lookback) hist.shift();
      return { t: c.t, v: isNM ? null : score, color: c.color, sk, name: c.sessionName, isNM };
    });
    return { lines: { main: pts } };
  },
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts = series.lines?.main;
    if (!pts?.length) return;

    // Fondo
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const py2 = v => panelY + panelH - (v / 100) * panelH;

    // Zonas alcista/bajista
    const yBull = py2(params.bullThresh), yBear = py2(params.bearThresh);
    ctx.fillStyle = '#26d99412';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, yBull - panelY);
    ctx.fillStyle = '#ff547012';
    ctx.fillRect(PADL, yBear, W - PADL - PADR, panelY + panelH - yBear);

    // Líneas de umbral
    [
      { y: py2(params.bullThresh), col: '#26d99455', lbl: `${params.bullThresh}% Bull` },
      { y: py2(50),                col: '#3a3f4755', lbl: '50%' },
      { y: py2(params.bearThresh), col: '#ff547055', lbl: `${params.bearThresh}% Bear` },
    ].forEach(({ y, col, lbl }) => {
      ctx.strokeStyle = col; ctx.lineWidth = 0.7; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(lbl, W - PADR - 3, y - 2);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Línea por sesión (coloreada según sesión + opacidad por sesgo)
    let prev = null;
    pts.forEach((pt, i) => {
      if (pt.v == null) { prev = null; return; }
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x = barX(ci) + barW / 2, y = py2(pt.v);
      const col = pt.v >= params.bullThresh ? '#26d994'
                : pt.v <= params.bearThresh ? '#ff5470'
                : pt.color || '#848e9c';
      if (prev && prev.sk === pt.sk) {
        ctx.strokeStyle = col + 'cc'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y); ctx.stroke();
      }
      // Punto
      ctx.fillStyle = col + 'cc';
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      prev = { x, y, sk: pt.sk };
    });

    ctx.restore();

    // Leyenda
    const last = pts.filter(p => p.v != null).slice(-1)[0];
    if (last) {
      const col = last.v >= params.bullThresh ? '#26d994'
                : last.v <= params.bearThresh ? '#ff5470'
                : last.color || '#848e9c';
      const dir = last.v >= params.bullThresh ? '▲ ALCISTA'
                : last.v <= params.bearThresh ? '▼ BAJISTA'
                : '◆ NEUTRAL';
      ctx.fillStyle = col + 'cc'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
      const lbl = last.name?.split('/')[0].trim() || last.sk;
      ctx.fillText(`BIAS · ${lbl} · ${last.v.toFixed(0)}% ${dir}`, PADL + 4, panelY + panelH - 4);

      // Eje derecho
      const y = py2(last.v);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(last.v.toFixed(0) + '%', W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }
  },
});


/* ════════════════════════════════════════════════════════════════════
   5. LIQUIDITY SWEEP DETECTOR (LSD)
   
   Detecta barridas de liquidez por sesión: cuando una sesión rompe
   el máximo O mínimo de la sesión anterior y luego lo RECUPERA
   (cierra de vuelta adentro del rango previo).
   
   Patrón ICT/SMC muy común:
     🔴 Sweep alcista  = rompió mínimo previo y recuperó → posible long
     🟢 Sweep bajista  = rompió máximo previo y recuperó → posible short
   
   Se dibuja como overlay: marcadores en las velas afectadas.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'lsd',
  name:      'Liquidity Sweep Detector — Barridas de liquidez entre sesiones',
  shortName: 'LSD',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'minSweep', label: 'Sweep mínimo (%)', type: 'number', default: 0.05, min: 0.01, max: 2 },
    { key: 'showLabel', label: 'Mostrar etiqueta', type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],
  calc(candles, p) {
    if (candles.length < 2) return { sweeps: [] };
    const sweeps = [];
    for (let i = 1; i < candles.length; i++) {
      const cur  = candles[i];
      const prev = candles[i - 1];
      if (cur.sessionKey === 'nomarket' || prev.sessionKey === 'nomarket') continue;
      if (cur.sessionKey === prev.sessionKey) continue; // misma sesión, no cuenta
      const minSweepPct = p.minSweep / 100;
      // Bull sweep: baja del mínimo previo y cierra encima del mínimo previo
      const bullSweep = cur.l < prev.l && cur.c > prev.l && (prev.l - cur.l) / prev.l > minSweepPct;
      // Bear sweep: sube del máximo previo y cierra debajo del máximo previo
      const bearSweep = cur.h > prev.h && cur.c < prev.h && (cur.h - prev.h) / prev.h > minSweepPct;
      if (bullSweep) sweeps.push({ t: cur.t, idx: i, type: 'bull', price: cur.l, prevLevel: prev.l, color: '#26d994' });
      if (bearSweep) sweeps.push({ t: cur.t, idx: i, type: 'bear', price: cur.h, prevLevel: prev.h, color: '#ff5470' });
    }
    return { sweeps };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    if (!series.sweeps?.length) return;

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();

    series.sweeps.forEach(sw => {
      const ci = candles.findIndex(c => c.t === sw.t);
      if (ci < 0) return;
      const x  = barX(ci) + barW / 2;
      const y  = py(sw.price);
      const isBull = sw.type === 'bull';

      // Círculo marcador
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = sw.color + 'cc'; ctx.fill();
      ctx.strokeStyle = sw.color + 'ff'; ctx.lineWidth = 1.5; ctx.stroke();

      // Línea horizontal al nivel barrido
      const yLevel = py(sw.prevLevel);
      ctx.strokeStyle = sw.color + '55'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(barX(ci) - barW, yLevel); ctx.lineTo(x + barW * 2, yLevel); ctx.stroke();
      ctx.setLineDash([]);

      // Flecha de dirección
      ctx.fillStyle = sw.color + 'ff';
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(isBull ? '↑' : '↓', x, y + (isBull ? -10 : 14));

      // Etiqueta
      if (params.showLabel === 'yes') {
        const lbl = isBull ? 'SWEEP↑' : 'SWEEP↓';
        ctx.fillStyle = sw.color + 'ee';
        ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
        ctx.fillText(lbl, x, y + (isBull ? -20 : 26));
      }
    });

    ctx.restore();
  },
});


/* ════════════════════════════════════════════════════════════════════
   6. OPENING RANGE BREAKOUT POR SESIÓN (ORB)
   
   Para cada sesión, toma las primeras N velas como "rango de apertura"
   y marca el máximo y mínimo de ese rango como niveles clave.
   
   Cuando el precio rompe el rango de apertura se genera una señal:
     🟢 Breakout alcista = precio supera el máximo del rango
     🔴 Breakout bajista = precio rompe el mínimo del rango
   
   Se dibuja como overlay: zonas sombreadas del rango y líneas de rotura.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'orb',
  name:      'Opening Range Breakout — Rotura del rango de apertura por sesión',
  shortName: 'ORB',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'rangeCandles', label: 'Velas de apertura', type: 'number', default: 2, min: 1, max: 10 },
    { key: 'showZone',     label: 'Mostrar zona ORB',  type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showBreak',    label: 'Mostrar rotura',    type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'zoneColor',    label: 'Color zona',        type: 'color',  default: '#f0b90b' },
  ],
  calc(candles, p) {
    if (!candles.length) return { zones: [], breaks: [] };

    const zones  = [];
    const breaks = [];

    // Agrupar velas por sesión (bloque contiguo de mismo sessionKey)
    let curSk    = null;
    let sessBuf  = [];
    let sessStart = 0;

    const flushSession = (endIdx) => {
      if (sessBuf.length === 0 || curSk === 'nomarket' || curSk === 'unknown') return;
      const n = Math.min(p.rangeCandles, sessBuf.length);
      const openRange = sessBuf.slice(0, n);
      const orbHi = Math.max(...openRange.map(c => c.h));
      const orbLo = Math.min(...openRange.map(c => c.l));
      const startI = sessBuf[0]._idx;
      const endI   = sessBuf[sessBuf.length - 1]._idx;
      zones.push({ orbHi, orbLo, startIdx: startI, endIdx: endI, color: sessBuf[0].color || '#f0b90b' });

      // Buscar roturas después de las primeras N velas
      let broken = { up: false, dn: false };
      sessBuf.slice(n).forEach(c => {
        if (!broken.up && c.h > orbHi) {
          breaks.push({ t: c.t, idx: c._idx, type: 'up', price: orbHi, color: '#26d994' });
          broken.up = true;
        }
        if (!broken.dn && c.l < orbLo) {
          breaks.push({ t: c.t, idx: c._idx, type: 'dn', price: orbLo, color: '#ff5470' });
          broken.dn = true;
        }
      });
    };

    candles.forEach((c, i) => {
      const sk = c.sessionKey || 'unknown';
      if (sk !== curSk) {
        flushSession(i - 1);
        curSk = sk; sessBuf = [];
      }
      sessBuf.push({ ...c, _idx: i });
    });
    flushSession(candles.length - 1);

    return { zones, breaks };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    if (!series.zones?.length && !series.breaks?.length) return;

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();

    // Zonas ORB (rectángulos sombreados)
    if (params.showZone === 'yes') {
      series.zones.forEach(z => {
        const x1 = barX(z.startIdx);
        const x2 = barX(z.endIdx) + barW;
        const yHi = py(z.orbHi), yLo = py(z.orbLo);
        // Zona sombreada
        ctx.fillStyle = (z.color || params.zoneColor) + '18';
        ctx.fillRect(x1, yHi, x2 - x1, yLo - yHi);
        // Líneas del rango
        ctx.strokeStyle = (z.color || params.zoneColor) + '66';
        ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(x1, yHi); ctx.lineTo(x2, yHi); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1, yLo); ctx.lineTo(x2, yLo); ctx.stroke();
        // Extensión hacia la derecha (líneas punteadas)
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = (z.color || params.zoneColor) + '33';
        ctx.lineWidth = 0.8;
        const xEnd = Math.min(W - PADR, x2 + barW * 6);
        ctx.beginPath(); ctx.moveTo(x2, yHi); ctx.lineTo(xEnd, yHi); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, yLo); ctx.lineTo(xEnd, yLo); ctx.stroke();
        ctx.setLineDash([]);
        // Etiqueta ORB
        ctx.fillStyle = (z.color || params.zoneColor) + 'aa';
        ctx.font = 'bold 7px monospace'; ctx.textAlign = 'left';
        ctx.fillText('ORB', x1 + 2, yHi - 2);
      });
    }

    // Marcadores de rotura
    if (params.showBreak === 'yes') {
      series.breaks.forEach(br => {
        const ci = candles.findIndex(c => c.t === br.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2;
        const y = py(br.price);
        const isUp = br.type === 'up';

        // Triángulo de rotura
        ctx.fillStyle = br.color + 'ee';
        ctx.beginPath();
        if (isUp) {
          ctx.moveTo(x, y - 12); ctx.lineTo(x - 5, y - 4); ctx.lineTo(x + 5, y - 4);
        } else {
          ctx.moveTo(x, y + 12); ctx.lineTo(x - 5, y + 4); ctx.lineTo(x + 5, y + 4);
        }
        ctx.fill();

        // Halo
        ctx.strokeStyle = br.color + '66'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y + (isUp ? -8 : 8), 7, 0, Math.PI * 2); ctx.stroke();
      });
    }

    ctx.restore();
  },
});


/* ════════════════════════════════════════════════════════════════════
   NEXT — Predictor de dirección de la siguiente vela
   
   Combina 6 señales independientes para estimar la probabilidad
   direccional de la PRÓXIMA vela de sesión. Cada señal aporta
   un voto ponderado al score final (-100 a +100):
   
   Señal 1 · Momentum actual (25%)
     ¿Qué tan fuerte cerró la vela actual vs su rango?
     Cierre en la mitad alta → voto alcista.
   
   Señal 2 · Bias histórico de la SIGUIENTE sesión (20%)
     ¿La sesión que viene suele ser alcista o bajista?
     Usa las últimas N apariciones de esa sesión.
   
   Señal 3 · SMT — Transferencia de momentum (15%)
     ¿La sesión actual continúa el patrón de la anterior?
     Si hay momentum acumulado, tiende a continuar un tick más.
   
   Señal 4 · Posición en rango reciente (20%)
     Precio en extremo alto → probable reversión bajista.
     Precio en extremo bajo → probable reversión alcista.
     (Mean reversion)
   
   Señal 5 · Cuerpo vs mecha de la vela actual (10%)
     Vela con cuerpo grande y mecha pequeña → continuación.
     Vela con mecha grande vs cuerpo → posible reversión.
   
   Señal 6 · SREI — Expansión de rango (10%)
     Si el rango actual es muy alto vs promedio histórico,
     la siguiente vela tiende a contraerse (mean reversion).
     Si es bajo, hay energía acumulada para expandir.
   
   ⚠️  IMPORTANTE: Este indicador es probabilístico, no profético.
       Un score de +70 significa que las condiciones históricas
       favorecen el alza — NO que el precio subirá con certeza.
       Úsalo como confirmación adicional, nunca como señal única.
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'next',
  name:      'NEXT — Predictor probabilístico de la siguiente vela',
  shortName: 'NEXT',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'lookback',    label: 'Ventana histórica (velas por sesión)', type: 'number', default: 20, min: 5,  max: 100 },
    { key: 'w_momentum',  label: 'Peso: Momentum actual (%)',            type: 'number', default: 25, min: 0,  max: 100 },
    { key: 'w_bias',      label: 'Peso: Bias sesión siguiente (%)',      type: 'number', default: 20, min: 0,  max: 100 },
    { key: 'w_smt',       label: 'Peso: Transferencia momentum (%)',     type: 'number', default: 15, min: 0,  max: 100 },
    { key: 'w_reversion', label: 'Peso: Posición en rango (%)',          type: 'number', default: 20, min: 0,  max: 100 },
    { key: 'w_body',      label: 'Peso: Cuerpo vs mecha (%)',            type: 'number', default: 10, min: 0,  max: 100 },
    { key: 'w_srei',      label: 'Peso: Expansión de rango (%)',         type: 'number', default: 10, min: 0,  max: 100 },
    { key: 'scaleMin',    label: '', type: 'number', default: -100 },
    { key: 'scaleMax',    label: '', type: 'number', default:  100 },
  ],

  calc(candles, p) {
    if (candles.length < 3) return { bars: [], accuracy: null };

    // ── Historial por sessionKey ──────────────────────────────────
    const sessHist  = {};  // sk → [bull:1/bear:0, ...]  (para bias)
    const rangeHist = {};  // sk → [range, ...]           (para SREI)
    const priceWin  = [];  // ventana global de precios de cierre (para posición)

    // ── Calcular señales vela a vela ──────────────────────────────
    const bars = candles.map((c, i) => {
      const sk   = c.sessionKey || 'unknown';
      const isNM = sk === 'nomarket' || sk === 'unknown';

      if (!sessHist[sk])  sessHist[sk]  = [];
      if (!rangeHist[sk]) rangeHist[sk] = [];

      const range  = c.h - c.l || 0.0001;
      const body   = Math.abs(c.c - c.o);
      const upper  = c.h - Math.max(c.c, c.o);
      const lower  = Math.min(c.c, c.o) - c.l;
      const bullC  = c.c >= c.o;

      priceWin.push(c.c);
      if (priceWin.length > p.lookback * 4) priceWin.shift();

      // ── Señal 1: Momentum actual ──────────────────────────────
      // Posición del cierre dentro del rango de la vela (0=bajo, 1=alto)
      const closePos   = (c.c - c.l) / range;         // 0..1
      const s_momentum = (closePos - 0.5) * 2;        // -1..+1 (>0 = alcista)

      // ── Señal 2: Bias histórico de esta sesión ────────────────
      const hist_bias  = sessHist[sk];
      let s_bias = 0;
      if (!isNM && hist_bias.length >= 3) {
        const pctBull = hist_bias.reduce((a, v) => a + v, 0) / hist_bias.length;
        s_bias = (pctBull - 0.5) * 2; // -1..+1
      }

      // ── Señal 3: SMT (transferencia de momentum) ──────────────
      let s_smt = 0;
      if (i > 0) {
        const prev      = candles[i - 1];
        const prevRange = prev.h - prev.l || 0.0001;
        const prevMove  = (prev.c - prev.o) / prevRange; // -1..+1
        const curMove   = (c.c - c.o) / range;
        // Si la sesión anterior tuvo movimiento fuerte, evaluar si continúa
        s_smt = Math.max(-1, Math.min(1, prevMove * 0.6 + curMove * 0.4));
      }

      // ── Señal 4: Posición en rango reciente (mean reversion) ──
      let s_reversion = 0;
      if (priceWin.length >= 5) {
        const winHi = Math.max(...priceWin);
        const winLo = Math.min(...priceWin);
        const winRng = winHi - winLo || 0.0001;
        const pctInRange = (c.c - winLo) / winRng; // 0..1
        // En extremo alto → probable reversión (bajista = negativo)
        // En extremo bajo → probable reversión (alcista = positivo)
        s_reversion = -(pctInRange - 0.5) * 2; // -1..+1 invertido
      }

      // ── Señal 5: Cuerpo vs mecha ──────────────────────────────
      // Cuerpo grande + mecha pequeña → continuación (favor del cuerpo)
      // Mecha grande vs cuerpo → posible reversión (neutro/contrario)
      let s_body = 0;
      if (!isNM) {
        const bodyRatio  = body / range;          // 0..1 (1 = sin mechas)
        const wickRatio  = (upper + lower) / range; // 0..1 (1 = todo mechas)
        const upperBias  = upper > lower ? -1 : 1; // mecha arriba → resistencia → bajista
        s_body = bullC
          ? bodyRatio - wickRatio * 0.5 + (lower > upper ? 0.3 : -0.3)
          : -(bodyRatio - wickRatio * 0.5 + (upper > lower ? 0.3 : -0.3));
        s_body = Math.max(-1, Math.min(1, s_body));
      }

      // ── Señal 6: SREI — Expansión de rango ───────────────────
      // Rango muy alto vs promedio → probable contracción (mean rev)
      // Rango muy bajo → energía acumulada → posible expansión
      let s_srei = 0;
      const hist_range = rangeHist[sk];
      if (!isNM && hist_range.length >= 3) {
        const avgRange = hist_range.reduce((a, v) => a + v, 0) / hist_range.length;
        const mult     = range / (avgRange || 0.0001);
        // Expansión alta → reversión del rango (pero NO de dirección necesariamente)
        // Aquí penalizamos si hay sobre-extensión del rango actual
        const contraction = Math.max(-1, Math.min(1, 1 - mult)); // neg si mult>1
        // Dirección del contraction: si la vela fue alcista, contraction bajista = -1
        s_srei = bullC ? contraction : -contraction;
      }

      // ── Score combinado ───────────────────────────────────────
      const totalW = p.w_momentum + p.w_bias + p.w_smt + p.w_reversion + p.w_body + p.w_srei || 100;
      const score  = isNM ? 0 : (
        s_momentum  * (p.w_momentum  / totalW) +
        s_bias      * (p.w_bias      / totalW) +
        s_smt       * (p.w_smt       / totalW) +
        s_reversion * (p.w_reversion / totalW) +
        s_body      * (p.w_body      / totalW) +
        s_srei      * (p.w_srei      / totalW)
      ) * 100; // → -100..+100

      // Señales individuales para tooltip/debug
      const signals = { s_momentum, s_bias, s_smt, s_reversion, s_body, s_srei };

      // Actualizar historial DESPUÉS de calcular (no contaminar con el presente)
      sessHist[sk].push(bullC ? 1 : 0);
      if (sessHist[sk].length  > p.lookback) sessHist[sk].shift();
      rangeHist[sk].push(range);
      if (rangeHist[sk].length > p.lookback) rangeHist[sk].shift();

      return {
        t: c.t, idx: i, sk,
        score: Math.round(score),
        color: c.color || '#848e9c',
        name:  c.sessionName || sk,
        isNM, bullish: bullC, signals,
      };
    });

    // ── Calcular precisión histórica (backtesting simple) ─────────
    // Para cada barra, ¿el score predijo correctamente la SIGUIENTE vela?
    let correct = 0, total = 0;
    for (let i = 0; i < bars.length - 1; i++) {
      const b = bars[i]; const next = bars[i + 1];
      if (b.isNM || next.isNM || b.score === 0) continue;
      const predicted = b.score > 0;
      const actual    = next.bullish;
      if (predicted === actual) correct++;
      total++;
    }
    const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : null;

    return { bars, accuracy, total };
  },

  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    if (!series.bars?.length) return;

    // ── Fondo ─────────────────────────────────────────────────────
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    const midY = panelY + panelH / 2;

    // Zonas de confianza
    const zoneH = panelH / 2;
    ctx.fillStyle = '#26d99408';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, zoneH * 0.4);        // zona fuerte alcista
    ctx.fillStyle = '#ff547008';
    ctx.fillRect(PADL, midY + zoneH * 0.6, W - PADL - PADR, zoneH * 0.4); // zona fuerte bajista

    // Línea cero
    ctx.strokeStyle = '#3a3f47cc'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(PADL, midY); ctx.lineTo(W - PADR, midY); ctx.stroke();
    ctx.fillStyle = '#3a3f47aa'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText('0', W - PADR - 3, midY - 3);

    // Líneas de umbral ±60
    [60, -60].forEach(v => {
      const y = midY - v / 100 * zoneH;
      ctx.strokeStyle = (v > 0 ? '#26d994' : '#ff5470') + '33';
      ctx.lineWidth = 0.7; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = (v > 0 ? '#26d994' : '#ff5470') + '66';
      ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`${v > 0 ? '+' : ''}${v}`, W - PADR - 3, y - 2);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // ── Barras ────────────────────────────────────────────────────
    series.bars.forEach(bar => {
      if (bar.isNM) return;
      const ci = candles.findIndex(c => c.t === bar.t); if (ci < 0) return;
      const x  = barX(ci);
      const bw = Math.max(1, barW - 1);
      const v  = Math.max(-100, Math.min(100, bar.score));
      const bh = Math.abs(v) / 100 * (zoneH - 4);
      const isUp = v >= 0;

      // Color: verde=alcista, rojo=bajista, intensidad según score
      const absV   = Math.abs(v);
      const alpha  = absV > 60 ? 'dd' : absV > 30 ? 'aa' : '55';
      const col    = isUp ? '#26d994' : '#ff5470';

      // Barra
      ctx.fillStyle = col + alpha;
      const yTop = isUp ? midY - bh : midY;
      ctx.fillRect(x, yTop, bw, bh);

      // Cap brillante
      ctx.fillStyle = col + 'ff';
      if (isUp) ctx.fillRect(x, midY - bh, bw, 2);
      else      ctx.fillRect(x, midY + bh - 2, bw, 2);

      // Brillo de fondo tenue (color de sesión)
      ctx.fillStyle = (bar.color || '#848e9c') + '0a';
      ctx.fillRect(x, panelY, bw, panelH);
    });

    // ── Línea de score suavizada (media móvil simple de 3) ────────
    const smoothed = [];
    series.bars.forEach((bar, i) => {
      if (bar.isNM) { smoothed.push(null); return; }
      const window = series.bars.slice(Math.max(0, i - 2), i + 1).filter(b => !b.isNM);
      const avg    = window.reduce((s, b) => s + b.score, 0) / (window.length || 1);
      smoothed.push({ t: bar.t, v: avg, color: bar.color });
    });

    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let prev = null;
    smoothed.forEach((pt, i) => {
      if (!pt) { prev = null; return; }
      const ci = candles.findIndex(c => c.t === pt.t); if (ci < 0) return;
      const x  = barX(ci) + barW / 2;
      const y  = midY - pt.v / 100 * (zoneH - 4);
      const col = pt.v > 0 ? '#26d994' : '#ff5470';
      if (prev) {
        ctx.strokeStyle = col + 'cc'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y); ctx.stroke();
      }
      prev = { x, y };
    });

    ctx.restore();

    // ══════════════════════════════════════════════════════════════
    // PANEL DE INFORMACIÓN DERECHO — señales + score + precisión
    // Se dibuja en el lado derecho del panel, encima de las barras
    // ══════════════════════════════════════════════════════════════
    const last = series.bars.filter(b => !b.isNM).slice(-1)[0];
    if (!last) return;

    const sig   = last.signals;
    const v     = last.score;
    const mainCol = v > 30 ? '#26d994' : v < -30 ? '#ff5470' : '#848e9c';
    const dir   = v > 60  ? '▲▲ ALCISTA FUERTE'
                : v > 30  ? '▲ Alcista'
                : v < -60 ? '▼▼ BAJISTA FUERTE'
                : v < -30 ? '▼ Bajista'
                : '◆ Neutral';

    // Área del panel de info (esquina superior derecha, dentro del gráfico)
    const INFO_W  = 210;
    const INFO_H  = panelH - 10;
    const INFO_X  = W - PADR - INFO_W - 4;
    const INFO_Y  = panelY + 5;
    const LINE_H  = 13;

    // Fondo semitransparente
    ctx.fillStyle = '#0b0e11cc';
    ctx.beginPath();
    ctx.roundRect(INFO_X, INFO_Y, INFO_W, INFO_H, 5);
    ctx.fill();
    ctx.strokeStyle = mainCol + '44';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(INFO_X, INFO_Y, INFO_W, INFO_H, 5);
    ctx.stroke();

    // ── Cabecera: score grande ────────────────────────────────────
    ctx.fillStyle = mainCol;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`NEXT  ${v > 0 ? '+' : ''}${v}`, INFO_X + 8, INFO_Y + 15);

    ctx.fillStyle = mainCol + 'cc';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(dir, INFO_X + INFO_W - 6, INFO_Y + 15);

    // Separador
    ctx.strokeStyle = '#2b2f36';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(INFO_X + 6, INFO_Y + 20);
    ctx.lineTo(INFO_X + INFO_W - 6, INFO_Y + 20);
    ctx.stroke();

    // ── Señales individuales ──────────────────────────────────────
    const signals_def = [
      { key: 's_momentum',  label: 'Momentum vela',      icon: '⚡', w: params.w_momentum  },
      { key: 's_bias',      label: 'Bias histórico ses.', icon: '📊', w: params.w_bias      },
      { key: 's_smt',       label: 'Transfer. momentum', icon: '🔄', w: params.w_smt       },
      { key: 's_reversion', label: 'Posición en rango',  icon: '↔', w: params.w_reversion },
      { key: 's_body',      label: 'Cuerpo vs mecha',    icon: '🕯', w: params.w_body      },
      { key: 's_srei',      label: 'Expansión de rango', icon: '📈', w: params.w_srei      },
    ];

    let rowY = INFO_Y + 30;
    const BAR_X  = INFO_X + 100;
    const BAR_W  = INFO_W - 110;

    signals_def.forEach(({ key, label, icon, w }) => {
      if (w === 0) return;
      const val  = sig[key] ?? 0;          // -1..+1
      const pct  = Math.round(val * 100);  // -100..+100
      const col  = val > 0.15 ? '#26d994' : val < -0.15 ? '#ff5470' : '#848e9c';

      // Etiqueta
      ctx.fillStyle = '#848e9c';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${icon} ${label}`, INFO_X + 7, rowY + 8);

      // Mini barra horizontal centrada
      const halfW  = BAR_W / 2;
      const midBX  = BAR_X + halfW;
      const barLen = Math.abs(val) * halfW;

      // Fondo de la barra
      ctx.fillStyle = '#1e232966';
      ctx.fillRect(BAR_X, rowY + 1, BAR_W, 9);

      // Línea central
      ctx.strokeStyle = '#3a3f47';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(midBX, rowY + 1);
      ctx.lineTo(midBX, rowY + 10);
      ctx.stroke();

      // Barra de valor
      ctx.fillStyle = col + 'bb';
      if (val >= 0) ctx.fillRect(midBX, rowY + 2, barLen, 7);
      else          ctx.fillRect(midBX - barLen, rowY + 2, barLen, 7);

      // Número
      ctx.fillStyle = col;
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'right';
      ctx.fillText((pct > 0 ? '+' : '') + pct + '%', INFO_X + INFO_W - 4, rowY + 9);

      rowY += LINE_H;
    });

    // Separador
    ctx.strokeStyle = '#2b2f36';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(INFO_X + 6, rowY + 2);
    ctx.lineTo(INFO_X + INFO_W - 6, rowY + 2);
    ctx.stroke();
    rowY += 8;

    // ── Precisión histórica ───────────────────────────────────────
    if (series.accuracy) {
      const acc    = parseFloat(series.accuracy);
      const accCol = acc >= 58 ? '#26d994' : acc >= 52 ? '#f0b90b' : '#ff5470';
      ctx.fillStyle = '#848e9c';
      ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`Precisión histórica (${series.total} velas):`, INFO_X + 7, rowY + 8);

      // Barra de precisión
      const pBarW = INFO_W - 14;
      ctx.fillStyle = '#1e2329';
      ctx.fillRect(INFO_X + 7, rowY + 11, pBarW, 7);
      ctx.fillStyle = accCol + 'aa';
      ctx.fillRect(INFO_X + 7, rowY + 11, pBarW * (acc / 100), 7);

      ctx.fillStyle = accCol;
      ctx.font = 'bold 8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(acc.toFixed(1) + '%', INFO_X + INFO_W - 4, rowY + 18);

      rowY += 22;
    }

    // ── Sesión actual ─────────────────────────────────────────────
    ctx.fillStyle = (last.color || '#848e9c') + 'cc';
    ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Sesión: ${(last.name || last.sk).split('/')[0].trim()}`, INFO_X + 7, rowY + 8);

    // ── Disclaimer ────────────────────────────────────────────────
    ctx.fillStyle = '#3a3f4777';
    ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('⚠ Probabilístico — no profético', INFO_X + INFO_W / 2, INFO_Y + INFO_H - 4);

    // ── Eje derecho (score) ───────────────────────────────────────
    const yAxis = midY - v / 100 * (panelH / 2 - 4);
    ctx.fillStyle = mainCol;
    ctx.beginPath();
    ctx.roundRect(W - PADR + 3, yAxis - 8, PADR - 6, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#0b0e11';
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
    ctx.fillText((v > 0 ? '+' : '') + v, W - PADR + 3 + (PADR - 6) / 2, yAxis + 3);
  },
});


/* ════════════════════════════════════════════════════════════════════
   ANATOMÍA DE VELA (CVA) — Candlestick Anatomy & Reversal Detector
   
   Analiza para cada vela:
     • Ratio cuerpo / rango total  → fuerza direccional
     • Mecha superior / rango      → presión vendedora
     • Mecha inferior / rango      → presión compradora
     • Desequilibrio mechas        → dirección dominante
   
   Detecta patrones clásicos de cambio de tendencia:
     Alcistas: Martillo, Martillo invertido, Engulfing alcista,
               Morning Star, Harami alcista, Tweezer Bottom, Pin Bar alcista
     Bajistas: Estrella fugaz, Hombre colgado, Engulfing bajista,
               Evening Star, Harami bajista, Tweezer Top, Pin Bar bajista
   
   Panel inferior: barras de fuerza corporal coloreadas + señales
   Overlay:        iconos / flechas encima de velas con patrón detectado
════════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'cva',
  name:      'Anatomía de Vela — Cambio de Tendencia',
  shortName: 'CVA',
  type:      'panel',
  defaultOn: false,

  params: [
    { key: 'bodyThresh',   label: 'Umbral cuerpo fuerte (%)',  type: 'number', default: 60,  min: 20, max: 90 },
    { key: 'wickThresh',   label: 'Umbral mecha larga (%)',    type: 'number', default: 60,  min: 20, max: 90 },
    { key: 'doji',         label: 'Umbral doji (%)',           type: 'number', default: 10,  min: 2,  max: 30 },
    { key: 'engulf',       label: 'Mín. engulfing (%)',        type: 'number', default: 100, min: 80, max: 150 },
    { key: 'showPatterns', label: 'Mostrar patrones overlay',  type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'colBull',      label: 'Color alcista',  type: 'color', default: '#26d994' },
    { key: 'colBear',      label: 'Color bajista',  type: 'color', default: '#ff5470' },
    { key: 'colDoji',      label: 'Color doji',     type: 'color', default: '#f0b90b' },
  ],

  /* ── CÁLCULO ─────────────────────────────────────────────────── */
  calc(candles, p) {
    const N = candles.length;
    const results = [];

    for (let i = 0; i < N; i++) {
      const c  = candles[i];
      const range = c.h - c.l;
      if (range === 0) { results.push({ t: c.t, range: 0, body: 0, uwik: 0, lwik: 0, bodyPct: 0, uwikPct: 0, lwikPct: 0, bias: 0, patterns: [], doji: false }); continue; }

      const body    = Math.abs(c.c - c.o);
      const isUp    = c.c >= c.o;
      const bodyTop = Math.max(c.c, c.o);
      const bodyBot = Math.min(c.c, c.o);
      const uwik    = c.h - bodyTop;   // mecha superior
      const lwik    = bodyBot - c.l;   // mecha inferior

      const bodyPct = body / range * 100;
      const uwikPct = uwik / range * 100;
      const lwikPct = lwik / range * 100;

      // Bias: +100 vela alcista perfecta (sin mechas), -100 bajista perfecta
      // Incorpora dirección, fuerza del cuerpo y desequilibrio de mechas
      let bias = 0;
      const wickBalance = (lwik - uwik) / range; // >0 más mecha abajo = presión compradora
      bias = (isUp ? 1 : -1) * bodyPct           // dirección * fuerza cuerpo
           + wickBalance * 40;                     // sesgo de mechas
      bias = Math.max(-100, Math.min(100, bias));

      const isDoji = bodyPct < p.doji;

      /* — Detección de patrones — */
      const patterns = [];
      const prev  = i > 0 ? candles[i - 1] : null;
      const prev2 = i > 1 ? candles[i - 2] : null;
      const next  = i < N - 1 ? candles[i + 1] : null;

      /* Helpers locales */
      const prevRange  = prev  ? (prev.h - prev.l)   || 1 : 1;
      const prevBody   = prev  ? Math.abs(prev.c - prev.o) : 0;
      const prevIsUp   = prev  ? prev.c >= prev.o : false;
      const prevBodyPct = prev ? prevBody / prevRange * 100 : 0;

      // ── PATRONES DE 1 VELA ──────────────────────────────────────

      // Martillo (bull) — cuerpo pequeño arriba, mecha inferior larga, poca mecha superior
      if (lwikPct >= p.wickThresh && bodyPct < 35 && uwikPct < 15) {
        patterns.push({ name: 'Martillo', dir: 'bull', icon: '🔨', strength: 2 });
      }
      // Hombre colgado (bear) — igual forma que martillo pero tras tendencia alcista
      // (simplificado: si la vela anterior fue alcista fuerte)
      if (lwikPct >= p.wickThresh && bodyPct < 35 && uwikPct < 15 && prev && prevIsUp && prevBodyPct >= p.bodyThresh) {
        // reemplaza martillo
        const idx = patterns.findIndex(p => p.name === 'Martillo');
        if (idx >= 0) patterns.splice(idx, 1);
        patterns.push({ name: 'Hombre colgado', dir: 'bear', icon: '🪣', strength: 2 });
      }

      // Estrella fugaz (bear) — cuerpo pequeño abajo, mecha superior larga
      if (uwikPct >= p.wickThresh && bodyPct < 35 && lwikPct < 15) {
        patterns.push({ name: 'Estrella fugaz', dir: 'bear', icon: '💫', strength: 2 });
      }
      // Martillo invertido (bull) — igual forma que estrella pero tras bajista
      if (uwikPct >= p.wickThresh && bodyPct < 35 && lwikPct < 15 && prev && !prevIsUp && prevBodyPct >= p.bodyThresh) {
        const idx = patterns.findIndex(p => p.name === 'Estrella fugaz');
        if (idx >= 0) patterns.splice(idx, 1);
        patterns.push({ name: 'Martillo inv.', dir: 'bull', icon: '🔃', strength: 2 });
      }

      // Doji (neutral / cambio) — cuerpo casi nulo
      if (isDoji) {
        patterns.push({ name: 'Doji', dir: 'neutral', icon: '✚', strength: 1 });
        // Doji libélula: mecha inferior muy larga → bull
        if (lwikPct > 70 && uwikPct < 10) patterns.push({ name: 'Doji libélula', dir: 'bull', icon: '⬆✚', strength: 2 });
        // Doji lápida: mecha superior muy larga → bear
        if (uwikPct > 70 && lwikPct < 10) patterns.push({ name: 'Doji lápida', dir: 'bear', icon: '⬇✚', strength: 2 });
      }

      // Marubozu alcista — casi sin mechas, cuerpo enorme
      if (isUp && bodyPct >= p.bodyThresh && uwikPct < 5 && lwikPct < 5) {
        patterns.push({ name: 'Marubozu Bull', dir: 'bull', icon: '▶', strength: 3 });
      }
      // Marubozu bajista
      if (!isUp && bodyPct >= p.bodyThresh && uwikPct < 5 && lwikPct < 5) {
        patterns.push({ name: 'Marubozu Bear', dir: 'bear', icon: '◀', strength: 3 });
      }

      // ── PATRONES DE 2 VELAS ─────────────────────────────────────
      if (prev) {
        const prevBodyTop = Math.max(prev.c, prev.o);
        const prevBodyBot = Math.min(prev.c, prev.o);

        // Engulfing alcista — bajista previa, alcista actual que la envuelve
        if (!prevIsUp && isUp
            && c.o <= prev.c && c.c >= prev.o
            && body >= prevBody * (p.engulf / 100)) {
          patterns.push({ name: 'Engulfing Bull', dir: 'bull', icon: '⬆⬆', strength: 3 });
        }
        // Engulfing bajista
        if (prevIsUp && !isUp
            && c.o >= prev.c && c.c <= prev.o
            && body >= prevBody * (p.engulf / 100)) {
          patterns.push({ name: 'Engulfing Bear', dir: 'bear', icon: '⬇⬇', strength: 3 });
        }

        // Harami alcista — bajista grande, alcista pequeña dentro
        if (!prevIsUp && isUp && prevBodyPct >= p.bodyThresh
            && bodyTop < prevBodyTop && bodyBot > prevBodyBot && bodyPct < 40) {
          patterns.push({ name: 'Harami Bull', dir: 'bull', icon: '◈↑', strength: 2 });
        }
        // Harami bajista
        if (prevIsUp && !isUp && prevBodyPct >= p.bodyThresh
            && bodyTop < prevBodyTop && bodyBot > prevBodyBot && bodyPct < 40) {
          patterns.push({ name: 'Harami Bear', dir: 'bear', icon: '◈↓', strength: 2 });
        }

        // Tweezer bottom — dos mínimos iguales, distinta dirección
        if (!prevIsUp && isUp && Math.abs(c.l - prev.l) / range < 0.03) {
          patterns.push({ name: 'Tweezer Bot.', dir: 'bull', icon: '⇅↑', strength: 2 });
        }
        // Tweezer top — dos máximos iguales
        if (prevIsUp && !isUp && Math.abs(c.h - prev.h) / range < 0.03) {
          patterns.push({ name: 'Tweezer Top', dir: 'bear', icon: '⇅↓', strength: 2 });
        }

        // Pin bar alcista — mecha inferior ≥ 2× cuerpo, cierre en tercio superior
        if (lwik >= 2 * body && (c.c - c.l) / range > 0.6 && uwikPct < 20) {
          // solo si no se detectó ya martillo
          if (!patterns.find(x => x.name === 'Martillo' || x.name === 'Martillo inv.')) {
            patterns.push({ name: 'Pin Bar Bull', dir: 'bull', icon: '📌↑', strength: 2 });
          }
        }
        // Pin bar bajista — mecha superior ≥ 2× cuerpo, cierre en tercio inferior
        if (uwik >= 2 * body && (c.h - c.c) / range > 0.6 && lwikPct < 20) {
          if (!patterns.find(x => x.name === 'Estrella fugaz')) {
            patterns.push({ name: 'Pin Bar Bear', dir: 'bear', icon: '📌↓', strength: 2 });
          }
        }
      }

      // ── PATRONES DE 3 VELAS (Morning/Evening Star) ───────────────
      if (prev && prev2) {
        const prev2IsUp  = prev2.c >= prev2.o;
        const prev2Body  = Math.abs(prev2.c - prev2.o);
        const prev2Range = (prev2.h - prev2.l) || 1;
        const prevBodyPct2 = prev2Body / prev2Range * 100;

        // Morning Star (bull): bajista grande → estrella/doji → alcista grande
        if (!prev2IsUp && prevBodyPct2 >= p.bodyThresh
            && prevBodyPct < 30
            && isUp && bodyPct >= p.bodyThresh * 0.6
            && c.c > (prev2.o + prev2.c) / 2) {
          patterns.push({ name: 'Morning Star', dir: 'bull', icon: '🌅', strength: 3 });
        }
        // Evening Star (bear): alcista grande → estrella/doji → bajista grande
        if (prev2IsUp && prevBodyPct2 >= p.bodyThresh
            && prevBodyPct < 30
            && !isUp && bodyPct >= p.bodyThresh * 0.6
            && c.c < (prev2.o + prev2.c) / 2) {
          patterns.push({ name: 'Evening Star', dir: 'bear', icon: '🌆', strength: 3 });
        }
      }

      // Señal resumen: el patrón de mayor fuerza
      const topPattern = patterns.slice().sort((a, b) => b.strength - a.strength)[0] || null;

      results.push({
        t: c.t,
        range, body, uwik, lwik,
        bodyPct, uwikPct, lwikPct,
        bias: Math.round(bias),
        isDoji,
        isUp,
        patterns,
        topPattern,
      });
    }

    /* Precisión histórica estimada (look-ahead 1 vela) */
    let correct = 0, total = 0;
    for (let i = 0; i < results.length - 1; i++) {
      const tp = results[i].topPattern;
      if (!tp || tp.dir === 'neutral') continue;
      const nxt = candles[i + 1];
      const actualBull = nxt.c > nxt.o;
      if ((tp.dir === 'bull' && actualBull) || (tp.dir === 'bear' && !actualBull)) correct++;
      total++;
    }
    const accuracy = total > 5 ? ((correct / total) * 100).toFixed(1) : null;

    return { bars: results, accuracy, total };
  },

  /* ── DIBUJO PANEL ─────────────────────────────────────────────── */
  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH, py, PADT, chartH } = layout;
    const { colBull, colBear, colDoji } = params;
    const bars = series.bars;
    if (!bars || !bars.length) return;

    /* — Fondo — */
    ctx.fillStyle = '#0b0e1199';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    /* — Etiqueta — */
    ctx.fillStyle = '#4a5060'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('CVA · Anatomía Vela', PADL + 4, panelY + 11);

    /* — Línea cero y zonas — */
    const midY  = panelY + panelH / 2;
    const zoneH = panelH / 2 - 6;

    // Zona alcista tenue
    ctx.fillStyle = colBull + '08';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH / 2);
    // Zona bajista tenue
    ctx.fillStyle = colBear + '08';
    ctx.fillRect(PADL, midY, W - PADL - PADR, panelH / 2);

    // Líneas de referencia
    [
      { y: midY,             col: '#3a3f4788', dash: [] },
      { y: midY - zoneH * 0.6, col: colBull + '33', dash: [3, 4] },
      { y: midY + zoneH * 0.6, col: colBear + '33', dash: [3, 4] },
    ].forEach(({ y, col, dash }) => {
      ctx.strokeStyle = col; ctx.lineWidth = 0.7;
      ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
    });

    // Etiquetas eje
    ctx.fillStyle = '#3a3f47'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText('+100', W - PADR - 3, panelY + 9);
    ctx.fillText('0',    W - PADR - 3, midY + 3);
    ctx.fillText('−100', W - PADR - 3, panelY + panelH - 3);

    /* — Barras de bias — */
    const bw = Math.max(1, barW - 1);

    bars.forEach((bar, i) => {
      const ci = candles.findIndex(c => c.t === bar.t);
      if (ci < 0) return;
      const x  = barX(ci);
      const v  = bar.bias; // -100..+100
      const bh = Math.abs(v) / 100 * zoneH;
      if (bh < 0.5) return;

      const col = bar.isDoji   ? colDoji
                : v > 0        ? colBull
                :                colBear;
      const alpha = Math.abs(v) > 60 ? 'dd' : Math.abs(v) > 30 ? 'aa' : '66';

      ctx.fillStyle = col + alpha;
      const yTop = v >= 0 ? midY - bh : midY;
      ctx.fillRect(x, yTop, bw, bh);

      // Cap brillante
      ctx.fillStyle = col + 'ff';
      if (v >= 0) ctx.fillRect(x, midY - bh, bw, 2);
      else        ctx.fillRect(x, midY + bh - 2, bw, 2);
    });

    /* — Línea de bias suavizada (SMA 3) — */
    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();
    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    let prev = null;
    bars.forEach((bar, i) => {
      const window3 = bars.slice(Math.max(0, i - 2), i + 1);
      const avg = window3.reduce((s, b) => s + b.bias, 0) / window3.length;
      const ci = candles.findIndex(c => c.t === bar.t);
      if (ci < 0) { prev = null; return; }
      const x  = barX(ci) + barW / 2;
      const y  = midY - avg / 100 * zoneH;
      const col = avg > 0 ? colBull : colBear;
      if (prev) {
        ctx.strokeStyle = col + 'cc';
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y); ctx.stroke();
      }
      prev = { x, y };
    });
    ctx.restore();

    /* — Descomposición de la última vela (mini-diagrama derecho) — */
    const last = bars[bars.length - 1];
    if (!last) return;

    const INFO_W = 200;
    const INFO_H = panelH - 10;
    const INFO_X = W - PADR - INFO_W - 4;
    const INFO_Y = panelY + 5;
    const mainCol = last.isDoji ? colDoji : last.bias > 0 ? colBull : colBear;
    const lineH = 13;

    // Fondo panel info
    ctx.fillStyle = '#0b0e11cc';
    ctx.beginPath(); ctx.roundRect(INFO_X, INFO_Y, INFO_W, INFO_H, 5); ctx.fill();
    ctx.strokeStyle = mainCol + '44'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(INFO_X, INFO_Y, INFO_W, INFO_H, 5); ctx.stroke();

    // Bias score
    const biasLabel = last.bias > 60  ? '▲▲ ALCISTA FUERTE'
                    : last.bias > 20  ? '▲ Alcista'
                    : last.bias < -60 ? '▼▼ BAJISTA FUERTE'
                    : last.bias < -20 ? '▼ Bajista'
                    : '◆ Neutral / Indecisión';

    ctx.fillStyle = mainCol; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`CVA  ${last.bias > 0 ? '+' : ''}${last.bias}`, INFO_X + 8, INFO_Y + 15);
    ctx.fillStyle = mainCol + 'cc'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(biasLabel, INFO_X + INFO_W - 6, INFO_Y + 15);

    // Separador
    ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(INFO_X + 6, INFO_Y + 20); ctx.lineTo(INFO_X + INFO_W - 6, INFO_Y + 20); ctx.stroke();

    // Anatomía: 3 métricas
    let rowY = INFO_Y + 29;
    const metrics = [
      { label: '🕯 Cuerpo',        val: last.bodyPct,  col: last.isDoji ? colDoji : last.isUp ? colBull : colBear },
      { label: '⬆ Mecha sup.',    val: last.uwikPct,  col: colBear },
      { label: '⬇ Mecha inf.',    val: last.lwikPct,  col: colBull },
    ];

    const BAR_X = INFO_X + 80;
    const BAR_W = INFO_W - 90;

    metrics.forEach(({ label, val, col }) => {
      const frac = val / 100;

      ctx.fillStyle = '#848e9c'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(label, INFO_X + 7, rowY + 8);

      // Barra de composición
      ctx.fillStyle = '#1e232966';
      ctx.fillRect(BAR_X, rowY + 1, BAR_W, 9);
      ctx.fillStyle = col + 'aa';
      ctx.fillRect(BAR_X, rowY + 1, BAR_W * frac, 9);

      ctx.fillStyle = col; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(0) + '%', INFO_X + INFO_W - 4, rowY + 9);

      rowY += lineH;
    });

    // Separador
    ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(INFO_X + 6, rowY + 2); ctx.lineTo(INFO_X + INFO_W - 6, rowY + 2); ctx.stroke();
    rowY += 8;

    // Patrones detectados en la última vela
    if (last.patterns.length) {
      ctx.fillStyle = '#848e9c'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('Patrones detectados:', INFO_X + 7, rowY + 8);
      rowY += lineH;

      last.patterns.slice(0, 3).forEach(pat => {
        const pCol = pat.dir === 'bull' ? colBull : pat.dir === 'bear' ? colBear : colDoji;
        ctx.fillStyle = pCol; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(`${pat.icon}  ${pat.name}`, INFO_X + 10, rowY + 8);
        // Estrellitas de fuerza
        const stars = '★'.repeat(pat.strength) + '☆'.repeat(3 - pat.strength);
        ctx.fillStyle = pCol + '99'; ctx.textAlign = 'right';
        ctx.fillText(stars, INFO_X + INFO_W - 4, rowY + 8);
        rowY += lineH;
      });
    } else {
      ctx.fillStyle = '#3a3f47'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('Sin patrón claro', INFO_X + 7, rowY + 8);
      rowY += lineH;
    }

    // Precisión histórica
    if (series.accuracy) {
      ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(INFO_X + 6, rowY + 2); ctx.lineTo(INFO_X + INFO_W - 6, rowY + 2); ctx.stroke();
      rowY += 8;

      const acc = parseFloat(series.accuracy);
      const accCol = acc >= 58 ? colBull : acc >= 52 ? colDoji : colBear;
      ctx.fillStyle = '#848e9c'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`Precisión patrones (${series.total} señales):`, INFO_X + 7, rowY + 8);

      const pBarW = INFO_W - 14;
      ctx.fillStyle = '#1e2329'; ctx.fillRect(INFO_X + 7, rowY + 11, pBarW, 7);
      ctx.fillStyle = accCol + 'aa'; ctx.fillRect(INFO_X + 7, rowY + 11, pBarW * (acc / 100), 7);
      ctx.fillStyle = accCol; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(acc + '%', INFO_X + INFO_W - 4, rowY + 18);
    }

    // Disclaimer
    ctx.fillStyle = '#3a3f4777'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('⚠ Probabilístico — no profético', INFO_X + INFO_W / 2, INFO_Y + INFO_H - 4);

    /* ── OVERLAY sobre velas: iconos de patrones ──────────────────
       Dibujamos en el espacio del gráfico principal (py space)
       Esto es posible porque draw() recibe el layout completo.     */
    if (params.showPatterns !== 'yes') return;

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, PADT, W - PADL - PADR, chartH); ctx.clip();

    bars.forEach((bar) => {
      const tp = bar.topPattern;
      if (!tp || tp.dir === 'neutral') return;

      const ci = candles.findIndex(c => c.t === bar.t);
      if (ci < 0) return;
      const candle = candles[ci];
      const x = barX(ci) + barW / 2;

      if (tp.dir === 'bull') {
        // Icono debajo del mínimo
        const yPos = py(candle.l) + 12;
        ctx.fillStyle = colBull;
        ctx.font = `${Math.max(9, Math.min(13, barW * 1.5))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(tp.icon, x, yPos);
        // Nombre para patrones fuertes
        if (tp.strength >= 3 && barW > 6) {
          ctx.fillStyle = colBull + 'cc'; ctx.font = '7px sans-serif';
          ctx.fillText(tp.name, x, yPos + 9);
        }
      } else {
        // Icono encima del máximo
        const yPos = py(candle.h) - 5;
        ctx.fillStyle = colBear;
        ctx.font = `${Math.max(9, Math.min(13, barW * 1.5))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(tp.icon, x, yPos);
        if (tp.strength >= 3 && barW > 6) {
          ctx.fillStyle = colBear + 'cc'; ctx.font = '7px sans-serif';
          ctx.fillText(tp.name, x, yPos - 6);
        }
      }
    });

    ctx.restore();
  },
});


/* ────────────────────────────────────
   MA — Media Móvil Simple (Pine: SMA 99)
──────────────────────────────────── */
window.INDICATORS.register({
  id:        'ma99',
  name:      'MA — Media Móvil (SMA 99)',
  shortName: 'MA',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'period', label: 'Período', type: 'number', default: 99,       min: 1, max: 500 },
    { key: 'color',  label: 'Color',   type: 'color',  default: '#FF6D00' },
    { key: 'width',  label: 'Grosor',  type: 'number', default: 1.5,      min: 0.5, max: 5 },
  ],
  calc(candles, p) {
    const src = candles.map(c => c.c);
    const sma = INDICATORS.math.sma(src, p.period);
    // Guardamos índice junto al valor — no buscamos por timestamp
    return { byIndex: candles.map((c, i) => ({ i, v: sma[i] })) };
  },
  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    const pts = series.byIndex;
    if (!pts || !pts.length) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    ctx.beginPath();
    ctx.strokeStyle = params.color || '#FF6D00';
    ctx.lineWidth   = params.width || 1.5;
    ctx.lineJoin    = 'round';

    let started = false;
    for (let i = startIdx; i <= endIdx; i++) {
      const pt = pts[i];
      if (!pt || pt.v == null || isNaN(pt.v)) { started = false; continue; }
      const x = barX(i) + barW / 2;
      const y = py(pt.v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  },
});

/* ────────────────────────────────────────────────────────────────
   MECHA ≥ X% — Detector de mechas significativas
   
   Lógica:
   ─ Mecha superior = (high − max(open,close)) / high  × 100
   ─ Mecha inferior = (min(open,close) − low)  / high  × 100
   
   Si cualquiera de las dos supera el umbral configurado,
   la vela se marca con:
     • Un triángulo de color sobre/bajo la mecha
     • Una línea punteada horizontal en el extremo de la mecha
     • Label con el % exacto de la mecha
   
   Parámetros configurables:
     threshold  — umbral mínimo (default 1 %)
     showUpper  — mostrar mechas superiores
     showLower  — mostrar mechas inferiores
     colorUpper — color para mecha superior (bajista)
     colorLower — color para mecha inferior (alcista)
──────────────────────────────────────────────────────────────── */
window.INDICATORS.register({
  id:        'wickpct',
  name:      'Mecha ≥ % — Detector de mechas significativas',
  shortName: 'MECHA%',
  type:      'overlay',
  defaultOn: false,
  params: [
    { key: 'threshold',  label: 'Umbral (%)',       type: 'number', default: 1,        min: 0.1, max: 20  },
    { key: 'showUpper',  label: 'Mecha superior',   type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showLower',  label: 'Mecha inferior',   type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'colorUpper', label: 'Color mecha sup.', type: 'color',  default: '#ff5470' },
    { key: 'colorLower', label: 'Color mecha inf.', type: 'color',  default: '#26d994' },
    { key: 'showLabel',  label: 'Mostrar %',        type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showLine',   label: 'Línea horizontal', type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles, p) {
    const thr = p.threshold;
    const n   = candles.length;

    // Paso 1: calcular mechas + clasificar rechazo vs trampa
    const bars = candles.map((c, i) => {
      const bodyTop    = Math.max(c.o, c.c);
      const bodyBot    = Math.min(c.o, c.c);
      const range      = c.h - c.l || 1e-10;
      const upperWick  = (c.h - bodyTop) / c.h * 100;
      const lowerWick  = (bodyBot - c.l)  / c.h * 100;

      // Posición del cierre dentro del rango total (0=low, 1=high)
      const closeRel   = (c.c - c.l) / range;

      // Si AMBAS mechas superan el umbral → indecisión, se ignora
      const bothSides  = (upperWick >= thr) && (lowerWick >= thr);

      // ── MECHA SUPERIOR ──
      // Rechazo real  → cierre en mitad inferior (vendedores ganaron)
      // Trampa/contin → cierre en mitad superior (compradores absorbieron)
      const upperIsRejection = closeRel < 0.5;  // true=rechazo 🔴, false=trampa 🟢

      // ── MECHA INFERIOR ──
      // Rechazo real  → cierre en mitad superior (compradores ganaron)
      // Trampa/contin → cierre en mitad inferior (vendedores absorbieron)
      const lowerIsRejection = closeRel > 0.5;  // true=rechazo 🟢, false=trampa 🔴

      return {
        i,
        t:              c.t,
        h:              c.h,
        l:              c.l,
        upperWick,
        lowerWick,
        closeRel,
        hasUpper:       !bothSides && upperWick >= thr,
        hasLower:       !bothSides && lowerWick >= thr,
        bothSides,
        upperIsRejection,
        lowerIsRejection,
        coveredUpperAt: null,
        coveredLowerAt: null,
      };
    });

    // Paso 2: buscar cuándo se cubre cada mecha
    for (let i = 0; i < n; i++) {
      const bar = bars[i];
      if (bar.hasUpper) {
        for (let j = i + 1; j < n; j++) {
          if (candles[j].h >= bar.h) { bar.coveredUpperAt = j; break; }
        }
      }
      if (bar.hasLower) {
        for (let j = i + 1; j < n; j++) {
          if (candles[j].l <= bar.l) { bar.coveredLowerAt = j; break; }
        }
      }
    }

    const withUpper = bars.filter(b => b.hasUpper).length;
    const withLower = bars.filter(b => b.hasLower).length;

    return { bars, withUpper, withLower, total: n, threshold: thr };
  },

  draw(ctx, series, layout, params) {
    const { py, barX, barW, PADL, PADR, PADT, W, chartH, startIdx, endIdx } = layout;
    const { bars, threshold } = series;

    // Colores base configurados por el usuario
    const colURej   = params.colorUpper || '#ff5470';   // mecha sup rechazo  (bajista)
    const colLRej   = params.colorLower || '#26d994';   // mecha inf rechazo  (alcista)
    const colTrap   = '#f0b90b';                         // trampa/continuación (ambas)

    const showU     = params.showUpper  !== 'no';
    const showL     = params.showLower  !== 'no';
    const showLabel = params.showLabel  !== 'no';
    const showLine  = params.showLine   !== 'no';

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    const fontSize = Math.max(7, Math.min(10, barW * 1.2));
    const triSize  = Math.max(4, Math.min(8, barW * 0.9));

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (!bar) continue;

      const lineEndUpper = bar.coveredUpperAt !== null ? bar.coveredUpperAt : endIdx;
      const lineEndLower = bar.coveredLowerAt !== null ? bar.coveredLowerAt : endIdx;

      const upperVisible = showU && bar.hasUpper && i <= endIdx && lineEndUpper >= startIdx;
      const lowerVisible = showL && bar.hasLower && i <= endIdx && lineEndLower >= startIdx;

      if (!upperVisible && !lowerVisible) continue;

      const xStart = barX(i) + barW / 2;

      /* ── MECHA SUPERIOR ── */
      if (upperVisible) {
        const yHigh   = py(bar.h);
        const xEnd    = barX(lineEndUpper) + barW / 2;
        const covered = bar.coveredUpperAt !== null;

        // Color según tipo: rechazo=rojo, trampa/continuación=amarillo
        const col = bar.upperIsRejection ? colURej : colTrap;

        if (showLine) {
          ctx.save();
          ctx.strokeStyle = covered ? col + '44' : col + 'bb';
          ctx.lineWidth   = covered ? 0.7 : 1.2;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.max(PADL, xStart), yHigh);
          ctx.lineTo(Math.min(W - PADR, xEnd), yHigh);
          ctx.stroke();
          ctx.setLineDash([]);
          if (covered && lineEndUpper >= startIdx && lineEndUpper <= endIdx) {
            ctx.strokeStyle = col + 'aa';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(xEnd, yHigh - 4);
            ctx.lineTo(xEnd, yHigh + 4);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (i >= startIdx && i <= endIdx) {
          const ty = yHigh - triSize - 3;

          // Triángulo apuntando abajo
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(xStart,           ty);
          ctx.lineTo(xStart - triSize, ty - triSize);
          ctx.lineTo(xStart + triSize, ty - triSize);
          ctx.closePath();
          ctx.fill();

          if (showLabel && barW > 3) {
            // Etiqueta: porcentaje + tipo
            const tag = bar.upperIsRejection ? 'REJ' : 'CONT';
            ctx.fillStyle = col;
            ctx.font      = `bold ${fontSize}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(`${bar.upperWick.toFixed(1)}% ${tag}`, xStart, ty - triSize - 2);
          }
        }
      }

      /* ── MECHA INFERIOR ── */
      if (lowerVisible) {
        const yLow    = py(bar.l);
        const xEnd    = barX(lineEndLower) + barW / 2;
        const covered = bar.coveredLowerAt !== null;

        const col = bar.lowerIsRejection ? colLRej : colTrap;

        if (showLine) {
          ctx.save();
          ctx.strokeStyle = covered ? col + '44' : col + 'bb';
          ctx.lineWidth   = covered ? 0.7 : 1.2;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.max(PADL, xStart), yLow);
          ctx.lineTo(Math.min(W - PADR, xEnd), yLow);
          ctx.stroke();
          ctx.setLineDash([]);
          if (covered && lineEndLower >= startIdx && lineEndLower <= endIdx) {
            ctx.strokeStyle = col + 'aa';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(xEnd, yLow - 4);
            ctx.lineTo(xEnd, yLow + 4);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (i >= startIdx && i <= endIdx) {
          const ty = yLow + triSize + 3;

          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(xStart,           ty);
          ctx.lineTo(xStart - triSize, ty + triSize);
          ctx.lineTo(xStart + triSize, ty + triSize);
          ctx.closePath();
          ctx.fill();

          if (showLabel && barW > 3) {
            const tag = bar.lowerIsRejection ? 'REJ' : 'CONT';
            ctx.fillStyle = col;
            ctx.font      = `bold ${fontSize}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(`${bar.lowerWick.toFixed(1)}% ${tag}`, xStart, ty + triSize + fontSize + 1);
          }
        }
      }
    }

    ctx.restore();

    /* ── Mini-resumen ── */
    const visible  = bars.slice(startIdx, endIdx + 1);
    const vURej    = visible.filter(b => b && b.hasUpper &&  b.upperIsRejection).length;
    const vUCont   = visible.filter(b => b && b.hasUpper && !b.upperIsRejection).length;
    const vLRej    = visible.filter(b => b && b.hasLower &&  b.lowerIsRejection).length;
    const vLCont   = visible.filter(b => b && b.hasLower && !b.lowerIsRejection).length;

    const BOX_X = PADL + 6;
    const BOX_Y = PADT + 6;
    const BOX_W = 200;
    const BOX_H = 58;

    ctx.fillStyle = '#0b0e11cc';
    ctx.beginPath(); ctx.roundRect(BOX_X, BOX_Y, BOX_W, BOX_H, 5); ctx.fill();
    ctx.strokeStyle = '#f0b90b44'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(BOX_X, BOX_Y, BOX_W, BOX_H, 5); ctx.stroke();

    ctx.fillStyle = '#f0b90b'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`MECHA ≥ ${threshold}%`, BOX_X + 7, BOX_Y + 13);

    // Fila mecha superior
    ctx.fillStyle = '#848e9c'; ctx.font = '8px sans-serif';
    ctx.fillText('▼ Sup:', BOX_X + 7, BOX_Y + 27);
    ctx.fillStyle = colURej;
    ctx.fillText(`${vURej} REJ`, BOX_X + 46, BOX_Y + 27);
    ctx.fillStyle = colTrap;
    ctx.fillText(`${vUCont} CONT`, BOX_X + 90, BOX_Y + 27);

    // Fila mecha inferior
    ctx.fillStyle = '#848e9c';
    ctx.fillText('▲ Inf:', BOX_X + 7, BOX_Y + 40);
    ctx.fillStyle = colLRej;
    ctx.fillText(`${vLRej} REJ`, BOX_X + 46, BOX_Y + 40);
    ctx.fillStyle = colTrap;
    ctx.fillText(`${vLCont} CONT`, BOX_X + 90, BOX_Y + 40);

    ctx.fillStyle = '#3a3f47'; ctx.font = '7px sans-serif';
    ctx.fillText('REJ=rechazo  CONT=continuación', BOX_X + 7, BOX_Y + 53);
  },
});


/* ────────────────────────────────────────────────────────────────
   COPPOCK CURVE — Oscilador de momentum a largo plazo
   Edwin S. Coppock, 1962

   Fórmula:
     ROC(n) = (close - close[n]) / close[n] * 100
     Coppock = WMA( ROC(roc1) + ROC(roc2) , wma )

   Señales:
     ▲ Cruce hacia arriba del cero  → compra
     ▼ Cruce hacia abajo del cero   → venta / cierre largo

   Por defecto: ROC 14, ROC 11, WMA 10
   (originalmente períodos mensuales; aquí se usan en velas)
──────────────────────────────────────────────────────────────── */
window.INDICATORS.register({
  id:        'coppock',
  name:      'Coppock Curve',
  shortName: 'COPPOCK',
  type:      'panel',
  defaultOn: false,
  params: [
    { key: 'roc1',      label: 'ROC período 1', type: 'number', default: 14,  min: 2,   max: 300 },
    { key: 'roc2',      label: 'ROC período 2', type: 'number', default: 11,  min: 2,   max: 300 },
    { key: 'wma',       label: 'WMA período',   type: 'number', default: 10,  min: 2,   max: 300 },
    { key: 'colorBull', label: 'Color alcista', type: 'color',  default: '#26d994' },
    { key: 'colorBear', label: 'Color bajista', type: 'color',  default: '#ff5470' },
    { key: 'colorLine', label: 'Color línea',   type: 'color',  default: '#f0b90b' },
  ],

  calc(candles, p) {
    const closes = candles.map(c => c.c);
    const n      = closes.length;
    const r1     = p.roc1;
    const r2     = p.roc2;
    const wmaP   = p.wma;

    // ROC = (close - close[period]) / close[period] * 100
    const roc = (period) => {
      const out = new Array(n).fill(null);
      for (let i = period; i < n; i++) {
        const prev = closes[i - period];
        if (prev && prev !== 0) out[i] = (closes[i] - prev) / prev * 100;
      }
      return out;
    };

    const roc1 = roc(r1);
    const roc2 = roc(r2);

    // Suma de los dos ROC
    const rocSum = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (roc1[i] !== null && roc2[i] !== null) rocSum[i] = roc1[i] + roc2[i];
    }

    // WMA sobre la suma
    // WMA(n) = Σ(peso_i * valor_i) / Σ(pesos)
    // peso_i = posición 1..n (más reciente = mayor peso)
    const totalWeight = (wmaP * (wmaP + 1)) / 2;
    const curve = new Array(n).fill(null);

    for (let i = wmaP - 1; i < n; i++) {
      // Verificar que todos los valores del período estén disponibles
      let allValid = true;
      for (let j = 0; j < wmaP; j++) {
        if (rocSum[i - j] === null) { allValid = false; break; }
      }
      if (!allValid) continue;

      let sum = 0;
      for (let j = 0; j < wmaP; j++) {
        const weight = wmaP - j;   // más reciente = peso wmaP, más antiguo = peso 1
        sum += rocSum[i - j] * weight;
      }
      curve[i] = sum / totalWeight;
    }

    // Detectar cruces del cero
    const pts = candles.map((c, i) => ({
      t: c.t,
      v: curve[i],
      // true si esta vela cruzó el cero hacia arriba
      crossUp:   i > 0 && curve[i] !== null && curve[i - 1] !== null
                 && curve[i] >= 0 && curve[i - 1] < 0,
      // true si esta vela cruzó el cero hacia abajo
      crossDown: i > 0 && curve[i] !== null && curve[i - 1] !== null
                 && curve[i] <= 0 && curve[i - 1] > 0,
    }));

    return { lines: { main: pts }, pts };
  },

  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts    = series.lines.main;
    if (!pts || !pts.length) return;

    const colBull = params.colorBull || '#26d994';
    const colBear = params.colorBear || '#ff5470';
    const colLine = params.colorLine || '#f0b90b';

    // Escala dinámica
    const vals = pts.map(p => p.v).filter(v => v !== null && !isNaN(v));
    if (!vals.length) return;
    const absMax = Math.max(Math.abs(Math.min(...vals)), Math.abs(Math.max(...vals))) || 1;
    const vMin   = -absMax;
    const vMax   =  absMax;
    const range  = vMax - vMin;
    const py2    = v => panelY + panelH - ((v - vMin) / range) * panelH;
    const yZero  = py2(0);

    // Fondo del panel
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Etiqueta
    ctx.fillStyle = '#4a5060'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('COPPOCK', PADL + 4, panelY + 11);

    // Línea cero
    ctx.strokeStyle = '#3a3f4799'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, yZero); ctx.lineTo(W - PADR, yZero); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3a3f47'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText('0', W - PADR - 3, yZero - 2);

    // Escala: máx y mín
    [vMax, vMin].forEach(v => {
      const y   = py2(v);
      const lbl = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
      ctx.fillStyle = '#3a3f47'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(lbl, W - PADR - 3, y + 3);
    });

    // Área rellena bajo/sobre el cero (coloreada por zona)
    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Área alcista (sobre cero)
    ctx.beginPath();
    let inSeg = false;
    pts.forEach((pt, idx) => {
      if (pt.v === null) { inSeg = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x  = barX(ci) + barW / 2;
      const y  = py2(Math.max(0, pt.v));
      if (!inSeg) { ctx.moveTo(x, yZero); ctx.lineTo(x, y); inSeg = true; }
      else { ctx.lineTo(x, y); }
    });
    ctx.lineTo(barX(candles.length - 1) + barW / 2, yZero);
    ctx.closePath();
    ctx.fillStyle = colBull + '22';
    ctx.fill();

    // Área bajista (bajo cero)
    ctx.beginPath();
    inSeg = false;
    pts.forEach((pt) => {
      if (pt.v === null) { inSeg = false; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x  = barX(ci) + barW / 2;
      const y  = py2(Math.min(0, pt.v));
      if (!inSeg) { ctx.moveTo(x, yZero); ctx.lineTo(x, y); inSeg = true; }
      else { ctx.lineTo(x, y); }
    });
    ctx.lineTo(barX(candles.length - 1) + barW / 2, yZero);
    ctx.closePath();
    ctx.fillStyle = colBear + '22';
    ctx.fill();

    // Línea de la curva — color cambia según zona
    let prevX = null, prevY = null, prevAbove = null;
    pts.forEach((pt) => {
      if (pt.v === null) { prevX = null; return; }
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x     = barX(ci) + barW / 2;
      const y     = py2(pt.v);
      const above = pt.v >= 0;

      if (prevX !== null) {
        ctx.beginPath();
        ctx.strokeStyle = above ? colBull : colBear;
        ctx.lineWidth   = 1.5;
        ctx.lineJoin    = 'round';
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prevX = x; prevY = y; prevAbove = above;
    });

    // Señales de cruce del cero
    pts.forEach((pt) => {
      if (!pt.crossUp && !pt.crossDown) return;
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2;
      const y = py2(pt.v);

      // Círculo en el punto de cruce
      ctx.beginPath();
      ctx.arc(x, yZero, 4, 0, Math.PI * 2);
      ctx.fillStyle   = pt.crossUp ? colBull : colBear;
      ctx.fill();
      ctx.strokeStyle = '#0b0e11';
      ctx.lineWidth   = 1;
      ctx.stroke();

      // Flecha + etiqueta
      ctx.fillStyle = pt.crossUp ? colBull : colBear;
      ctx.font      = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      if (pt.crossUp) {
        ctx.fillText('▲ BUY', x, yZero - 8);
      } else {
        ctx.fillText('▼ SELL', x, yZero + 16);
      }
    });

    ctx.restore();

    // Valor actual en la esquina derecha
    const last = [...pts].reverse().find(p => p.v !== null);
    if (last) {
      const col   = last.v >= 0 ? colBull : colBear;
      const label = last.v >= 0 ? '▲' : '▼';
      ctx.fillStyle = col; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`${label} ${last.v.toFixed(2)}`, W - PADR - 4, panelY + 11);
    }
  },
});

/* ══════════════════════════════════════════════════════════════════
   VOLUME PROFILE POR SESIÓN
   Usa las rawCandles (15m) que caen dentro de cada sesión visible.
   Dibuja el perfil DENTRO de la vela de sesión, pegado a su izquierda.
   POC = nivel con más volumen. VA = zona que concentra el X% del vol.
══════════════════════════════════════════════════════════════════ */
INDICATORS.register({
  id:        'volume_profile_session',
  name:      'Volume Profile por Sesión',
  shortName: 'VP·Ses',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'bins',          label: 'Niveles (bins)',        type: 'number', default: 24,  min: 6,  max: 100 },
    { key: 'vaPercent',     label: 'Value Area %',          type: 'number', default: 70,  min: 50, max: 95  },
    { key: 'widthPct',      label: 'Ancho barras %',        type: 'number', default: 80,  min: 10, max: 100 },
    { key: 'colorBull',     label: 'Color alcista',         type: 'color',  default: '#26d994' },
    { key: 'colorBear',     label: 'Color bajista',         type: 'color',  default: '#ff5470' },
    { key: 'colorPOC',      label: 'Color POC',             type: 'color',  default: '#f0b90b' },
    { key: 'colorVA',       label: 'Color Value Area',      type: 'color',  default: '#9c6cff' },
    { key: 'showPOC',       label: 'Línea POC',             type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'showVA',        label: 'Fondo Value Area',      type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'bullBearSplit', label: 'Split alcista/bajista', type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'skipNoMarket',  label: 'Omitir Sin Mercado',    type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
  ],

  calc(candles, params) {
    return { _ready: true };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series._ready) return;

    // Bug 1 fix: acceder a rawCandles desde window o desde la variable global del app
    const raw = window.rawCandles || (typeof rawCandles !== 'undefined' ? rawCandles : null);
    if (!raw || !raw.length) return;

    const { W, PADT, PADL, PADR, chartH, py, barX, barW,
            candles, startIdx, endIdx } = layout;

    const bins      = Math.max(6,  Math.min(100, params.bins | 0));
    const vaPercent = Math.max(50, Math.min(95,  params.vaPercent));
    const widthPct  = Math.max(10, Math.min(100, params.widthPct)) / 100;
    const splitBull = params.bullBearSplit === 'yes';
    const skipNM    = params.skipNoMarket  === 'yes';

    const colBull = params.colorBull || '#26d994';
    const colBear = params.colorBear || '#ff5470';
    const colPOC  = params.colorPOC  || '#f0b90b';
    const colVA   = params.colorVA   || '#9c6cff';

    const slice = candles.slice(startIdx, endIdx + 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    slice.forEach((c, i) => {
      const ci = startIdx + i;
      if (skipNM && c.isNoMarket) return;
      if (!c.v || c.h <= c.l) return;

      // Bug 3 fix: usar tClose si existe, o inferirlo desde la siguiente vela de sesión
      const tClose = c.tClose != null
        ? c.tClose
        : (candles[startIdx + i + 1] ? candles[startIdx + i + 1].t : c.t + 24 * 3600000);

      // rawCandles dentro de esta sesión
      const bucket = raw.filter(r => r.t >= c.t && r.t < tClose);
      if (!bucket.length) return;

      const lo      = c.l;
      const hi      = c.h;
      const binSize = (hi - lo) / bins;
      const volBull = new Float64Array(bins);
      const volBear = new Float64Array(bins);

      for (const r of bucket) {
        if (!r.v || r.v <= 0) continue;
        const bull = r.c >= r.o;
        const bLo  = Math.max(0,        Math.floor((r.l - lo) / binSize));
        const bHi  = Math.min(bins - 1, Math.floor((r.h - lo) / binSize));

        if (bLo === bHi) {
          if (bull) volBull[bLo] += r.v; else volBear[bLo] += r.v;
        } else {
          const rng = r.h - r.l || 1;
          for (let b = bLo; b <= bHi; b++) {
            const bS   = lo + b * binSize;
            const bE   = bS + binSize;
            const over = Math.min(r.h, bE) - Math.max(r.l, bS);
            const frac = over / rng;
            if (frac <= 0) continue;
            if (bull) volBull[b] += r.v * frac; else volBear[b] += r.v * frac;
          }
        }
      }

      const volTotal = new Float64Array(bins);
      for (let b = 0; b < bins; b++) volTotal[b] = volBull[b] + volBear[b];
      const maxVol   = Math.max(...volTotal);
      const totalVol = volTotal.reduce((a, v) => a + v, 0);
      if (maxVol <= 0 || totalVol <= 0) return;

      // POC
      let pocBin = 0;
      for (let b = 1; b < bins; b++) if (volTotal[b] > volTotal[pocBin]) pocBin = b;

      // Value Area desde POC hacia afuera
      const vaTarget = totalVol * (vaPercent / 100);
      let vaLo = pocBin, vaHi = pocBin, vaVol = volTotal[pocBin];
      while (vaVol < vaTarget && (vaLo > 0 || vaHi < bins - 1)) {
        const addLo = vaLo > 0        ? volTotal[vaLo - 1] : -Infinity;
        const addHi = vaHi < bins - 1 ? volTotal[vaHi + 1] : -Infinity;
        if (addLo >= addHi) { vaLo--; vaVol += volTotal[vaLo]; }
        else                { vaHi++; vaVol += volTotal[vaHi]; }
      }

      const xLeft   = barX(ci);
      const xRight  = xLeft + barW;
      const maxBarW = barW * widthPct;

      // Fondo Value Area
      if (params.showVA === 'yes') {
        const yVAH = py(lo + (vaHi + 1) * binSize);
        const yVAL = py(lo + vaLo       * binSize);
        ctx.fillStyle = colVA + '18';
        ctx.fillRect(xLeft, Math.min(yVAH, yVAL), barW, Math.abs(yVAL - yVAH));
      }

      // Barras
      for (let b = 0; b < bins; b++) {
        if (volTotal[b] <= 0) continue;
        const yTop  = py(lo + (b + 1) * binSize);
        const yBot  = py(lo + b       * binSize);
        const barH  = Math.max(1, yBot - yTop);
        const isPOC = b === pocBin;
        const isVA  = b >= vaLo && b <= vaHi;

        if (isPOC) {
          // POC: siempre amarillo encima de todo
          const tw = (volTotal[b] / maxVol) * maxBarW;
          ctx.fillStyle = colPOC + 'ee';
          ctx.fillRect(xLeft, yTop, tw, Math.max(2, barH));
        } else if (splitBull) {
          const bw = (volBull[b] / maxVol) * maxBarW;
          const rw = (volBear[b] / maxVol) * maxBarW;
          ctx.fillStyle = colBull + (isVA ? 'cc' : '55');
          ctx.fillRect(xLeft, yTop, bw, barH);
          ctx.fillStyle = colBear + (isVA ? 'cc' : '55');
          ctx.fillRect(xLeft + bw, yTop, rw, barH);
        } else {
          const tw = (volTotal[b] / maxVol) * maxBarW;
          ctx.fillStyle = isVA ? colVA + 'aa' : '#4a527277';
          ctx.fillRect(xLeft, yTop, tw, barH);
        }
      }

      // Línea POC horizontal dentro de la sesión
      if (params.showPOC === 'yes') {
        const yPOC = py(lo + (pocBin + 0.5) * binSize);
        ctx.strokeStyle = colPOC;
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xLeft, yPOC);
        ctx.lineTo(xRight, yPOC);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    ctx.restore();
  },
});

/* ══════════════════════════════════════════════════════════════════
   VOLUME PROFILE DIARIO
   Agrupa TODAS las rawCandles (15m) de cada día calendario completo
   (medianoche a medianoche en la hora local UTC-6) y dibuja un único
   perfil por día, pegado al lado derecho de ese rango de velas.
   Ideal para ver dónde se concentró el volumen total del día anterior.
══════════════════════════════════════════════════════════════════ */
INDICATORS.register({
  id:        'volume_profile_daily',
  name:      'Volume Profile Diario',
  shortName: 'VP·Día',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'bins',          label: 'Niveles (bins)',        type: 'number', default: 30,  min: 6,  max: 120 },
    { key: 'vaPercent',     label: 'Value Area %',          type: 'number', default: 70,  min: 50, max: 95  },
    { key: 'widthPct',      label: 'Ancho perfil % del día',type: 'number', default: 85,  min: 10, max: 100 },
    { key: 'colorBull',     label: 'Color alcista',         type: 'color',  default: '#26d994' },
    { key: 'colorBear',     label: 'Color bajista',         type: 'color',  default: '#ff5470' },
    { key: 'colorPOC',      label: 'Color POC',             type: 'color',  default: '#f0b90b' },
    { key: 'colorVA',       label: 'Color Value Area',      type: 'color',  default: '#9c6cff' },
    { key: 'showPOC',       label: 'Línea POC',             type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'pocExtend',     label: 'Extender POC al día sig.',type:'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'showVA',        label: 'Fondo Value Area',      type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'bullBearSplit', label: 'Split alcista/bajista', type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'showLabel',     label: 'Etiqueta día',          type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
  ],

  calc(candles, params) {
    return { _ready: true };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series._ready) return;

    const raw = window.rawCandles || (typeof rawCandles !== 'undefined' ? rawCandles : null);
    if (!raw || !raw.length) return;

    const { W, PADT, PADL, PADR, chartH, py, barX, barW,
            candles, startIdx, endIdx } = layout;

    const UTC_OFF_MS = -6 * 3600000; // UTC-6 Tegucigalpa
    const DAY_MS     = 86400000;

    const bins      = Math.max(6,  Math.min(120, params.bins | 0));
    const vaPercent = Math.max(50, Math.min(95,  params.vaPercent));
    const widthPct  = Math.max(10, Math.min(100, params.widthPct)) / 100;
    const splitBull = params.bullBearSplit === 'yes';

    const colBull = params.colorBull || '#26d994';
    const colBear = params.colorBear || '#ff5470';
    const colPOC  = params.colorPOC  || '#f0b90b';
    const colVA   = params.colorVA   || '#9c6cff';

    // ── Agrupar rawCandles por día local (UTC-6) ──
    // Clave de día = floor((t + UTC_OFF_MS) / DAY_MS)
    const dayMap = new Map(); // dayKey → rawCandles[]
    for (const r of raw) {
      const dk = Math.floor((r.t + UTC_OFF_MS) / DAY_MS);
      if (!dayMap.has(dk)) dayMap.set(dk, []);
      dayMap.get(dk).push(r);
    }

    // ── Para cada día visible en el gráfico, calcular y dibujar el perfil ──
    // Primero construimos un mapa dayKey → {firstCandleIdx, lastCandleIdx}
    // iterando las session-candles visibles
    const slice = candles.slice(startIdx, endIdx + 1);

    // Agrupar velas de sesión por día local
    const daySliceMap = new Map(); // dayKey → { firstCI, lastCI, firstX, lastX }
    slice.forEach((c, i) => {
      const ci  = startIdx + i;
      const dk  = Math.floor((c.t + UTC_OFF_MS) / DAY_MS);
      const x   = barX(ci);
      if (!daySliceMap.has(dk)) {
        daySliceMap.set(dk, { firstCI: ci, lastCI: ci, firstX: x, lastX: x + barW });
      } else {
        const rec = daySliceMap.get(dk);
        rec.lastCI = ci;
        rec.lastX  = x + barW;
      }
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    for (const [dk, dayRec] of daySliceMap) {
      const bucket = dayMap.get(dk);
      if (!bucket || !bucket.length) continue;

      // Precio mínimo y máximo del día usando las rawCandles
      let lo = Infinity, hi = -Infinity;
      for (const r of bucket) {
        if (r.l < lo) lo = r.l;
        if (r.h > hi) hi = r.h;
      }
      if (hi <= lo) continue;

      const binSize  = (hi - lo) / bins;
      const volBull  = new Float64Array(bins);
      const volBear  = new Float64Array(bins);

      for (const r of bucket) {
        if (!r.v || r.v <= 0) continue;
        const bull = r.c >= r.o;
        const bLo  = Math.max(0,        Math.floor((r.l - lo) / binSize));
        const bHi  = Math.min(bins - 1, Math.floor((r.h - lo) / binSize));

        if (bLo === bHi) {
          if (bull) volBull[bLo] += r.v; else volBear[bLo] += r.v;
        } else {
          const rng = r.h - r.l || 1;
          for (let b = bLo; b <= bHi; b++) {
            const bS   = lo + b * binSize;
            const bE   = bS + binSize;
            const over = Math.min(r.h, bE) - Math.max(r.l, bS);
            const frac = over / rng;
            if (frac <= 0) continue;
            if (bull) volBull[b] += r.v * frac; else volBear[b] += r.v * frac;
          }
        }
      }

      const volTotal = new Float64Array(bins);
      for (let b = 0; b < bins; b++) volTotal[b] = volBull[b] + volBear[b];
      const maxVol   = Math.max(...volTotal);
      const totalVol = volTotal.reduce((a, v) => a + v, 0);
      if (maxVol <= 0 || totalVol <= 0) continue;

      // POC
      let pocBin = 0;
      for (let b = 1; b < bins; b++) if (volTotal[b] > volTotal[pocBin]) pocBin = b;

      // Value Area desde POC hacia afuera
      const vaTarget = totalVol * (vaPercent / 100);
      let vaLo = pocBin, vaHi = pocBin, vaVol = volTotal[pocBin];
      while (vaVol < vaTarget && (vaLo > 0 || vaHi < bins - 1)) {
        const addLo = vaLo > 0        ? volTotal[vaLo - 1] : -Infinity;
        const addHi = vaHi < bins - 1 ? volTotal[vaHi + 1] : -Infinity;
        if (addLo >= addHi) { vaLo--; vaVol += volTotal[vaLo]; }
        else                { vaHi++; vaVol += volTotal[vaHi]; }
      }

      // Coordenadas X del día en el canvas
      const xLeft  = dayRec.firstX;
      const xRight = dayRec.lastX;
      const dayW   = Math.max(4, xRight - xLeft);
      const maxBarW = dayW * widthPct;

      // ── Fondo Value Area ──
      if (params.showVA === 'yes') {
        const yVAH = py(lo + (vaHi + 1) * binSize);
        const yVAL = py(lo + vaLo       * binSize);
        ctx.fillStyle = colVA + '18';
        ctx.fillRect(xLeft, Math.min(yVAH, yVAL), dayW, Math.abs(yVAL - yVAH));
      }

      // ── Barras del perfil ──
      for (let b = 0; b < bins; b++) {
        if (volTotal[b] <= 0) continue;
        const yTop  = py(lo + (b + 1) * binSize);
        const yBot  = py(lo + b       * binSize);
        const barH  = Math.max(1, yBot - yTop);
        const isPOC = b === pocBin;
        const isVA  = b >= vaLo && b <= vaHi;

        if (isPOC) {
          const tw = (volTotal[b] / maxVol) * maxBarW;
          ctx.fillStyle = colPOC + 'ee';
          ctx.fillRect(xLeft, yTop, tw, Math.max(2, barH));
        } else if (splitBull) {
          const bw = (volBull[b] / maxVol) * maxBarW;
          const rw = (volBear[b] / maxVol) * maxBarW;
          ctx.fillStyle = colBull + (isVA ? 'cc' : '55');
          ctx.fillRect(xLeft, yTop, bw, barH);
          ctx.fillStyle = colBear + (isVA ? 'cc' : '55');
          ctx.fillRect(xLeft + bw, yTop, rw, barH);
        } else {
          const tw = (volTotal[b] / maxVol) * maxBarW;
          ctx.fillStyle = isVA ? colVA + 'aa' : '#4a527277';
          ctx.fillRect(xLeft, yTop, tw, barH);
        }
      }

      // ── Línea POC horizontal a través de todo el día ──
      if (params.showPOC === 'yes') {
        const yPOC = py(lo + (pocBin + 0.5) * binSize);
        ctx.strokeStyle = colPOC;
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xLeft, yPOC);
        ctx.lineTo(xRight, yPOC);
        ctx.stroke();
        ctx.setLineDash([]);

        // Etiqueta del POC en el lado derecho del día
        const pocPrice = lo + (pocBin + 0.5) * binSize;
        ctx.fillStyle   = colPOC + 'dd';
        ctx.font        = 'bold 9px monospace';
        ctx.textAlign   = 'left';
        const pocLabel  = pocPrice >= 10000
          ? pocPrice.toLocaleString('en-US', {minimumFractionDigits:1,maximumFractionDigits:1})
          : pocPrice >= 1 ? pocPrice.toFixed(2) : pocPrice.toFixed(5);
        ctx.fillText(`POC ${pocLabel}`, xRight + 3, yPOC + 3);
      }

      // ── Extender POC al siguiente día (línea punteada tenue) ──
      if (params.pocExtend === 'yes' && params.showPOC === 'yes') {
        // Buscar el inicio del siguiente día en el canvas
        const nextDk   = dk + 1;
        const nextRec  = daySliceMap.get(nextDk);
        const extRight = nextRec ? nextRec.lastX : xRight + dayW * 0.5;
        const yPOC     = py(lo + (pocBin + 0.5) * binSize);
        ctx.strokeStyle = colPOC + '55';
        ctx.lineWidth   = 0.8;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(xRight, yPOC);
        ctx.lineTo(extRight, yPOC);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── Etiqueta del día en la parte superior ──
      if (params.showLabel === 'yes' && dayW > 20) {
        const d   = new Date(dk * DAY_MS - UTC_OFF_MS);
        const mo  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getUTCMonth()];
        const lbl = `${d.getUTCDate()} ${mo}`;
        ctx.fillStyle   = '#848e9c99';
        ctx.font        = 'bold 9px sans-serif';
        ctx.textAlign   = 'center';
        ctx.fillText(lbl, xLeft + dayW / 2, PADT + 10);
      }
    }

    ctx.restore();
  },
});

/* ═══════════════════════════════════════════════════════════════════
   HH / HL / LH / LL  —  Fractales de estructura de mercado
   Traducción 1-a-1 del script Pine v3 "HL/LH" por fgavro
   ─────────────────────────────────────────────────────────────────
   Lógica:
   • isBWFractal(1)  → fractal alcista (pivot high): high[2] es el pico
     high[4]<high[2], high[3]<=high[2], high[2]>=high[1], high[2]>high[0]
   • isBWFractal(-1) → fractal bajista (pivot low): low[2] es el suelo
     low[4]>low[2], low[3]>=low[2], low[2]<=low[1], low[2]<low[0]
   • Se compara el fractal actual vs los 2 anteriores del mismo tipo:
     - HH: nuevo máximo supera los 2 fractales anteriores
     - LH: nuevo máximo por debajo de los 2 fractales anteriores
     - HL: nuevo mínimo por encima de los 2 fractales anteriores
     - LL: nuevo mínimo por debajo de los 2 fractales anteriores
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'hhll',
  name:      'HH / HL / LH / LL — Estructura de Mercado',
  shortName: 'HHLL',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'showHH',    label: 'Mostrar HH',          type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'showLL',    label: 'Mostrar LL',           type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'showHL',    label: 'Mostrar HL',           type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'showLH',    label: 'Mostrar LH',           type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'colorHH',  label: 'Color HH',             type: 'color',  default: '#26d994' },
    { key: 'colorLL',  label: 'Color LL',              type: 'color',  default: '#ff5470' },
    { key: 'colorHL',  label: 'Color HL',              type: 'color',  default: '#5da0ff' },
    { key: 'colorLH',  label: 'Color LH',              type: 'color',  default: '#f59e0b' },
    { key: 'lineWidth', label: 'Grosor de línea',      type: 'number', default: 1.5, min: 0.5, max: 4 },
    { key: 'labelSize', label: 'Tamaño etiqueta (px)', type: 'number', default: 10,  min: 7,   max: 18 },
    { key: 'showLines', label: 'Líneas entre fractales', type: 'select', default: 'yes', options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
    { key: 'extend',    label: 'Extender última línea', type: 'select', default: 'no',  options: [{v:'yes',l:'Sí'},{v:'no',l:'No'}] },
  ],

  /* ── CÁLCULO ─────────────────────────────────────────────────── */
  calc(candles, params) {
    const n = candles.length;
    if (n < 5) return { pivotHighs: [], pivotLows: [] };

    // isBWFractal en posición i (pivot centrado en i-2)
    function isBWHigh(i) {
      if (i < 4) return false;
      const h = idx => candles[idx].h;
      return h(i-4) <  h(i-2) &&
             h(i-3) <= h(i-2) &&
             h(i-2) >= h(i-1) &&
             h(i-2) >  h(i-0);
    }
    function isBWLow(i) {
      if (i < 4) return false;
      const l = idx => candles[idx].l;
      return l(i-4) >  l(i-2) &&
             l(i-3) >= l(i-2) &&
             l(i-2) <= l(i-1) &&
             l(i-2) <  l(i-0);
    }

    // Recolectar todos los fractales (guardamos el precio en i-2)
    const allHighs = []; // { ci, price, t }
    const allLows  = [];
    for (let i = 4; i < n; i++) {
      if (isBWHigh(i)) allHighs.push({ ci: i - 2, price: candles[i-2].h, t: candles[i-2].t });
      if (isBWLow(i))  allLows.push({ ci: i - 2, price: candles[i-2].l, t: candles[i-2].t });
    }

    // Para cada fractal (desde el 3.º en adelante), determinar HH/LH ó HL/LL
    // comparando con los 2 anteriores del mismo tipo
    const pivotHighs = []; // { ci, price, t, label:'HH'|'LH' }
    const pivotLows  = [];

    for (let k = 2; k < allHighs.length; k++) {
      const cur  = allHighs[k].price;
      const prev1 = allHighs[k-1].price;
      const prev2 = allHighs[k-2].price;
      const label = (cur > prev1 && cur > prev2) ? 'HH' : (cur < prev1 && cur < prev2) ? 'LH' : null;
      if (label) pivotHighs.push({ ...allHighs[k], label });
      else       pivotHighs.push({ ...allHighs[k], label: null }); // sin etiqueta definitiva
    }
    for (let k = 2; k < allLows.length; k++) {
      const cur   = allLows[k].price;
      const prev1 = allLows[k-1].price;
      const prev2 = allLows[k-2].price;
      const label = (cur > prev1 && cur > prev2) ? 'HL' : (cur < prev1 && cur < prev2) ? 'LL' : null;
      if (label) pivotLows.push({ ...allLows[k], label });
      else       pivotLows.push({ ...allLows[k], label: null });
    }

    return { pivotHighs, pivotLows, allHighs, allLows };
  },

  /* ── DIBUJO ──────────────────────────────────────────────────── */
  draw(ctx, series, layout, params) {
    if (!series) return;
    const { W, H, PADT, PADB, PADL, PADR, chartH, py, barX, barW,
            candles, startIdx, endIdx } = layout;

    const { pivotHighs, pivotLows } = series;
    if (!pivotHighs || !pivotLows) return;

    const showHH   = params.showHH   !== 'no';
    const showLL   = params.showLL   !== 'no';
    const showHL   = params.showHL   !== 'no';
    const showLH   = params.showLH   !== 'no';
    const showLn   = params.showLines !== 'no';
    const extendLn = params.extend   === 'yes';
    const lw       = params.lineWidth || 1.5;
    const fs       = (params.labelSize || 10) + 'px';

    const COLOR = {
      HH: params.colorHH || '#26d994',
      LL: params.colorLL || '#ff5470',
      HL: params.colorHL || '#5da0ff',
      LH: params.colorLH || '#f59e0b',
    };
    const SHOW = { HH: showHH, LL: showLL, HL: showHL, LH: showLH };

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    // Helper: x coordinate for a candle index
    function cx(ci) { return barX(ci) + barW / 2; }

    // Draw a group of pivot points (highs or lows)
    function drawGroup(pivots, isHigh) {
      // Filter only labeled + visible pivots
      const vis = pivots.filter(p => p.label && SHOW[p.label]);
      if (!vis.length) return;

      // Draw lines connecting consecutive labeled pivots of same label-type
      if (showLn) {
        // Group by label type for line connections
        ['HH','LH','HL','LL'].forEach(lbl => {
          if (!SHOW[lbl]) return;
          const pts = vis.filter(p => p.label === lbl);
          if (pts.length < 2) return;
          ctx.strokeStyle = COLOR[lbl] + 'aa';
          ctx.lineWidth   = lw * 0.7;
          ctx.setLineDash([4, 4]);
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i-1], b = pts[i];
            const ax = cx(a.ci), ay = py(a.price);
            const bx = cx(b.ci), by = py(b.price);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
          // Extend the last line
          if (extendLn && pts.length >= 2) {
            const a = pts[pts.length-2], b = pts[pts.length-1];
            const ax = cx(a.ci), ay = py(a.price);
            const bx = cx(b.ci), by = py(b.price);
            const slope = (by - ay) / (bx - ax || 1);
            const extX  = W - PADR;
            ctx.strokeStyle = COLOR[lbl] + '44';
            ctx.setLineDash([2, 6]);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(extX, by + slope * (extX - bx));
            ctx.stroke();
          }
          ctx.setLineDash([]);
        });
      }

      // Draw dots + labels
      vis.forEach(p => {
        const x  = cx(p.ci);
        const y  = py(p.price);
        const col = COLOR[p.label];

        // Dot
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = '#0b0e11';
        ctx.lineWidth   = 1;
        ctx.stroke();

        // Label badge
        ctx.font = `bold ${fs} sans-serif`;
        ctx.textAlign = 'center';
        const txtW = ctx.measureText(p.label).width + 6;
        const txtH = parseInt(fs) + 4;
        const badgeY = isHigh ? y - 16 - txtH : y + 16;

        ctx.fillStyle = col + 'cc';
        const rx = x - txtW / 2, ry = badgeY;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rx, ry, txtW, txtH, 3);
        else ctx.rect(rx, ry, txtW, txtH);
        ctx.fill();

        ctx.fillStyle = '#0b0e11';
        ctx.fillText(p.label, x, badgeY + txtH - 4);
      });
    }

    drawGroup(pivotHighs, true);
    drawGroup(pivotLows,  false);

    ctx.restore();
  },
});

/* ═══════════════════════════════════════════════════════════════════
   HIGHEST HIGH / LOWEST LOW BANDS  —  by HermanBrummer (4 Apr 2021)
   Pine v4 traducido a JS para este motor de indicadores.
   • Banda superior : highest(high, topPer)  → verde
   • Banda inferior : lowest(low,  botPer)   → rojo
   • Media móvil   : sma(close, maPer)       → cian
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'hhll_bands',
  name:      'Highest High / Lowest Low Bands — HermanBrummer',
  shortName: 'HHLL-B',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'topPer',   label: 'Período banda superior', type: 'number', default: 20,  min: 1, max: 500 },
    { key: 'botPer',   label: 'Período banda inferior', type: 'number', default: 20,  min: 1, max: 500 },
    { key: 'maPer',    label: 'Período media móvil',    type: 'number', default: 20,  min: 1, max: 500 },
    { key: 'colorTop', label: 'Color banda superior',   type: 'color',  default: '#00ff00' },
    { key: 'colorBot', label: 'Color banda inferior',   type: 'color',  default: '#ff0000' },
    { key: 'colorMA',  label: 'Color media móvil',      type: 'color',  default: '#00ffff' },
    { key: 'widthTop', label: 'Grosor banda superior',  type: 'number', default: 1.5, min: 0.5, max: 5 },
    { key: 'widthBot', label: 'Grosor banda inferior',  type: 'number', default: 1.5, min: 0.5, max: 5 },
    { key: 'widthMA',  label: 'Grosor media móvil',     type: 'number', default: 1.5, min: 0.5, max: 5 },
    { key: 'showTop',  label: 'Mostrar banda superior', type: 'select', default: 'yes', options: [{v:'yes',l:'Si'},{v:'no',l:'No'}] },
    { key: 'showBot',  label: 'Mostrar banda inferior', type: 'select', default: 'yes', options: [{v:'yes',l:'Si'},{v:'no',l:'No'}] },
    { key: 'showMA',   label: 'Mostrar media movil',    type: 'select', default: 'yes', options: [{v:'yes',l:'Si'},{v:'no',l:'No'}] },
    { key: 'fillBand', label: 'Relleno entre bandas',   type: 'select', default: 'yes', options: [{v:'yes',l:'Si'},{v:'no',l:'No'}] },
  ],

  calc(candles, params) {
    const n      = candles.length;
    const topPer = Math.max(1, params.topPer | 0);
    const botPer = Math.max(1, params.botPer | 0);
    const maPer  = Math.max(1, params.maPer  | 0);
    const topLine = [], botLine = [], maLine = [];

    for (let i = 0; i < n; i++) {
      const t = candles[i].t;

      let hh = -Infinity;
      for (let k = Math.max(0, i - topPer + 1); k <= i; k++)
        if (candles[k].h > hh) hh = candles[k].h;
      topLine.push({ t, v: hh });

      let ll = Infinity;
      for (let k = Math.max(0, i - botPer + 1); k <= i; k++)
        if (candles[k].l < ll) ll = candles[k].l;
      botLine.push({ t, v: ll });

      let sum = 0, cnt = 0;
      for (let k = Math.max(0, i - maPer + 1); k <= i; k++) { sum += candles[k].c; cnt++; }
      maLine.push({ t, v: sum / cnt });
    }

    return { lines: { top: topLine, bot: botLine, ma: maLine } };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.lines) return;
    const { W, PADT, PADL, PADR, chartH, py, barX, barW, candles } = layout;
    const { top, bot, ma } = series.lines;
    const showTop  = params.showTop  !== 'no';
    const showBot  = params.showBot  !== 'no';
    const showMA   = params.showMA   !== 'no';
    const fillBand = params.fillBand !== 'no';

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    function ciFor(t) { return candles.findIndex(c => c.t === t); }
    function toXY(pt) {
      const ci = ciFor(pt.t);
      if (ci < 0) return null;
      return { x: barX(ci) + barW / 2, y: py(pt.v) };
    }
    function tracePath(pts) {
      ctx.beginPath();
      let started = false;
      for (const pt of pts) {
        if (pt.v == null || !isFinite(pt.v)) { started = false; continue; }
        const p = toXY(pt);
        if (!p) continue;
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
    }

    // Relleno suave entre bandas
    if (fillBand && showTop && showBot) {
      const valid = t => {
        const ci = ciFor(t); return ci >= 0;
      };
      const tPts = top.filter(p => p.v != null && isFinite(p.v) && valid(p.t));
      const bPts = bot.filter(p => p.v != null && isFinite(p.v) && valid(p.t));
      if (tPts.length && bPts.length) {
        ctx.beginPath();
        tPts.forEach((pt, i) => {
          const p = toXY(pt); if (!p) return;
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        for (let i = bPts.length - 1; i >= 0; i--) {
          const p = toXY(bPts[i]); if (!p) continue;
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = (params.colorTop || '#00ff00') + '12';
        ctx.fill();
      }
    }

    if (showTop) {
      tracePath(top);
      ctx.strokeStyle = params.colorTop || '#00ff00';
      ctx.lineWidth = params.widthTop || 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    if (showBot) {
      tracePath(bot);
      ctx.strokeStyle = params.colorBot || '#ff0000';
      ctx.lineWidth = params.widthBot || 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    if (showMA) {
      tracePath(ma);
      ctx.strokeStyle = params.colorMA || '#00ffff';
      ctx.lineWidth = params.widthMA || 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    ctx.restore();
  },
});

/* ═══════════════════════════════════════════════════════════════════
   CVD — Cumulative Volume Delta
   Volumen comprador vs vendedor acumulado.
   Aproximación: vela alcista (c>o) → volumen comprador, bajista → vendedor.
   La divergencia entre precio y CVD revela manipulación o convicción real.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'cvd',
  name:      'CVD — Cumulative Volume Delta',
  shortName: 'CVD',
  type:      'panel',
  defaultOn: false,

  params: [
    { key: 'colorBuy',  label: 'Color comprador', type: 'color',  default: '#26d994' },
    { key: 'colorSell', label: 'Color vendedor',  type: 'color',  default: '#ff5470' },
    { key: 'colorLine', label: 'Color línea CVD', type: 'color',  default: '#f0b90b' },
    { key: 'showBars',  label: 'Mostrar barras delta', type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles) {
    let cvd = 0;
    return candles.map(c => {
      // Delta por vela: si cierre > apertura es bullish, si no bearish
      const range  = c.h - c.l || 1;
      const buyVol  = c.v * ((c.c - c.l) / range);
      const sellVol = c.v * ((c.h - c.c) / range);
      const delta   = buyVol - sellVol;
      cvd += delta;
      return { t: c.t, v: cvd, delta, buyVol, sellVol };
    });
  },

  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    if (!series || !series.length) return;

    const pts    = series;
    const vals   = pts.map(p => p.v).filter(v => v != null);
    const deltas = pts.map(p => p.delta).filter(d => d != null);
    if (!vals.length) return;

    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);
    const dMax = Math.max(...deltas.map(Math.abs)) || 1;
    const range = vMax - vMin || 1;
    const py2   = v => panelY + panelH - ((v - vMin) / range) * panelH;
    const zero  = py2(0);

    // Fondo
    ctx.fillStyle = '#0b0e1199';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f36';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Línea de cero
    const zeroY = panelY + panelH / 2;
    ctx.strokeStyle = '#3a3f4766';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, zeroY); ctx.lineTo(W - PADR, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    // Etiqueta
    ctx.fillStyle = '#4a5060';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CVD', PADL + 4, panelY + 11);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.clip();

    // Barras delta (opcional)
    if (params.showBars !== 'no') {
      const barHMax = panelH * 0.35;
      pts.forEach(pt => {
        if (pt.delta == null) return;
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x   = barX(ci);
        const bw  = Math.max(1, barW - 1);
        const h   = Math.abs(pt.delta / dMax) * barHMax;
        const isBuy = pt.delta >= 0;
        ctx.fillStyle = (isBuy ? params.colorBuy : params.colorSell) + '55';
        if (isBuy) ctx.fillRect(x, panelY + panelH - h, bw, h);
        else       ctx.fillRect(x, panelY + panelH - barHMax, bw, h);
      });
    }

    // Línea CVD
    ctx.beginPath();
    ctx.strokeStyle = params.colorLine || '#f0b90b';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    let started = false;
    pts.forEach(pt => {
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x = barX(ci) + barW / 2;
      const y = py2(pt.v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Valor actual
    const last = pts[pts.length - 1];
    if (last) {
      const lbl = last.v >= 1e6 ? (last.v / 1e6).toFixed(2) + 'M'
                : last.v >= 1e3 ? (last.v / 1e3).toFixed(1) + 'K'
                : last.v.toFixed(0);
      const isPos = last.v >= 0;
      ctx.fillStyle = isPos ? params.colorBuy : params.colorSell;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(lbl, W - PADR - 4, panelY + 11);
    }

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   VWAP — Volume Weighted Average Price con bandas ±1σ y ±2σ
   Se resetea cada día. Los institucionales operan contra el VWAP.
   Las bandas marcan zonas de sobreextensión / reversión.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'vwap',
  name:      'VWAP — Precio Promedio Ponderado por Volumen',
  shortName: 'VWAP',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'colorVwap', label: 'Color VWAP',    type: 'color',  default: '#f0b90b' },
    { key: 'color1',    label: 'Color banda 1σ', type: 'color',  default: '#38bdf888' },
    { key: 'color2',    label: 'Color banda 2σ', type: 'color',  default: '#c084fc66' },
    { key: 'width',     label: 'Grosor',         type: 'number', default: 1.5, min: 0.5, max: 5 },
    { key: 'showBand1', label: 'Banda ±1σ',      type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showBand2', label: 'Banda ±2σ',      type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'resetMode', label: 'Resetear cada',  type: 'select', default: 'day',
      options: [{ v: 'day', l: 'Día' }, { v: 'week', l: 'Semana' }, { v: 'never', l: 'Nunca' }] },
  ],

  calc(candles, p) {
    const UTC_OFF = -6;
    const vwap = [], up1 = [], dn1 = [], up2 = [], dn2 = [];
    let cumTPV = 0, cumVol = 0, cumTPV2 = 0, prevKey = null;

    candles.forEach((c, i) => {
      const d = new Date(c.t + UTC_OFF * 3600000);
      let key;
      if (p.resetMode === 'day')
        key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      else if (p.resetMode === 'week') {
        const day = d.getUTCDay();
        const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
        key = `${monday.getUTCFullYear()}-${monday.getUTCMonth()}-${monday.getUTCDate()}`;
      } else key = 'all';

      if (key !== prevKey) { cumTPV = 0; cumVol = 0; cumTPV2 = 0; prevKey = key; }

      const tp = (c.h + c.l + c.c) / 3;
      cumTPV  += tp * c.v;
      cumVol  += c.v;
      cumTPV2 += tp * tp * c.v;

      const vw   = cumVol ? cumTPV / cumVol : tp;
      const vari = cumVol ? (cumTPV2 / cumVol) - vw * vw : 0;
      const sd   = Math.sqrt(Math.max(0, vari));

      vwap.push({ t: c.t, v: vw });
      up1.push({ t: c.t, v: vw + sd });
      dn1.push({ t: c.t, v: vw - sd });
      up2.push({ t: c.t, v: vw + 2 * sd });
      dn2.push({ t: c.t, v: vw - 2 * sd });
    });

    return { lines: { vwap, up1, dn1, up2, dn2 } };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.lines) return;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    const { vwap, up1, dn1, up2, dn2 } = series.lines;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    function toXY(pt) {
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return null;
      return { x: barX(ci) + barW / 2, y: py(pt.v) };
    }
    function drawLine(pts, color, width, dash = []) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      let started = false;
      pts.forEach(pt => {
        if (pt.v == null) { started = false; return; }
        const p2 = toXY(pt); if (!p2) return;
        if (!started) { ctx.moveTo(p2.x, p2.y); started = true; }
        else ctx.lineTo(p2.x, p2.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    function fillBand(ptsTop, ptsBot, color) {
      ctx.beginPath();
      let started = false;
      ptsTop.forEach(pt => {
        if (pt.v == null) { started = false; return; }
        const p2 = toXY(pt); if (!p2) return;
        if (!started) { ctx.moveTo(p2.x, p2.y); started = true; }
        else ctx.lineTo(p2.x, p2.y);
      });
      [...ptsBot].reverse().forEach(pt => {
        if (pt.v == null) return;
        const p2 = toXY(pt); if (!p2) return;
        ctx.lineTo(p2.x, p2.y);
      });
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    if (params.showBand2 !== 'no') {
      fillBand(up2, dn2, (params.color2 || '#c084fc') + '18');
      drawLine(up2, params.color2 || '#c084fc66', 0.8, [4, 4]);
      drawLine(dn2, params.color2 || '#c084fc66', 0.8, [4, 4]);
    }
    if (params.showBand1 !== 'no') {
      fillBand(up1, dn1, (params.color1 || '#38bdf8') + '20');
      drawLine(up1, params.color1 || '#38bdf888', 1, [2, 3]);
      drawLine(dn1, params.color1 || '#38bdf888', 1, [2, 3]);
    }
    drawLine(vwap, params.colorVwap || '#f0b90b', params.width || 1.5);

    // Etiqueta VWAP al final
    const last = vwap[vwap.length - 1];
    if (last) {
      const p2 = toXY(last);
      if (p2) {
        ctx.fillStyle = params.colorVwap || '#f0b90b';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('VWAP', p2.x + 4, p2.y - 3);
      }
    }

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   OFI — Order Flow Imbalance (por vela)
   Compara volumen en bid vs ask estimado por vela.
   Barras verdes = presión compradora, rojas = vendedora.
   Divergencia precio vs OFI = señal de trampa o continuación.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'ofi',
  name:      'OFI — Order Flow Imbalance',
  shortName: 'OFI',
  type:      'panel',
  defaultOn: false,

  params: [
    { key: 'colorBuy',   label: 'Color comprador',  type: 'color',  default: '#26d994' },
    { key: 'colorSell',  label: 'Color vendedor',   type: 'color',  default: '#ff5470' },
    { key: 'smoothing',  label: 'Suavizado (EMA)',  type: 'number', default: 3, min: 1, max: 20 },
    { key: 'showSignal', label: 'Línea de señal',   type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles, p) {
    // OFI por vela: estimación basada en posición del cierre dentro del rango
    const raw = candles.map(c => {
      const range = c.h - c.l || 1;
      const buyFrac  = (c.c - c.l) / range;   // fracción compradora
      const sellFrac = (c.h - c.c) / range;   // fracción vendedora
      return (buyFrac - sellFrac) * c.v;       // imbalance ponderado por volumen
    });

    // Normalizar por media móvil de absolutos
    const absRaw = raw.map(Math.abs);
    const window = Math.max(1, p.smoothing * 5);
    const norm = raw.map((v, i) => {
      const slice = absRaw.slice(Math.max(0, i - window + 1), i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length || 1;
      return v / avg;
    });

    // EMA de señal
    const k = 2 / (p.smoothing + 1);
    let ema = null;
    const signal = norm.map(v => {
      ema = ema == null ? v : v * k + ema * (1 - k);
      return ema;
    });

    return candles.map((c, i) => ({ t: c.t, v: norm[i], signal: signal[i] }));
  },

  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    if (!series || !series.length) return;

    const vals = series.map(p => p.v).filter(v => v != null && isFinite(v));
    if (!vals.length) return;
    const absMax = Math.max(...vals.map(Math.abs)) || 1;

    // Fondo
    ctx.fillStyle = '#0b0e1199';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    // Línea cero
    const midY = panelY + panelH / 2;
    ctx.strokeStyle = '#3a3f4766'; ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, midY); ctx.lineTo(W - PADR, midY); ctx.stroke();
    ctx.setLineDash([]);

    // Etiqueta
    ctx.fillStyle = '#4a5060'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('OFI', PADL + 4, panelY + 11);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.clip();

    const halfH = panelH / 2;
    const py2 = v => midY - (v / absMax) * halfH;

    // Barras OFI
    series.forEach(pt => {
      if (pt.v == null) return;
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x  = barX(ci);
      const bw = Math.max(1, barW - 1);
      const h  = Math.abs(pt.v / absMax) * halfH;
      const isBuy = pt.v >= 0;
      ctx.fillStyle = isBuy ? params.colorBuy + 'cc' : params.colorSell + 'cc';
      if (isBuy) ctx.fillRect(x, midY - h, bw, h);
      else       ctx.fillRect(x, midY, bw, h);
    });

    // Línea de señal (EMA del OFI)
    if (params.showSignal !== 'no') {
      ctx.beginPath();
      ctx.strokeStyle = '#f0b90b';
      ctx.lineWidth = 1.2;
      let started = false;
      series.forEach(pt => {
        if (pt.signal == null) return;
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2;
        const y = py2(pt.signal);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   SESSION OHLC — Open / High / Low / Close por sesión de mercado
   Dibuja líneas horizontales del OHLC de cada sesión.
   Las rupturas del High/Low de Londres son entradas clásicas de SMC.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'session_ohlc',
  name:      'Session OHLC — Niveles por Sesión',
  shortName: 'S-OHLC',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'showSydney',  label: 'Sydney',      type: 'select', default: 'no',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showTokyo',   label: 'Tokio',       type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showLondon',  label: 'Londres',     type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showNY',      label: 'New York',    type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showOpen',    label: 'Línea Open',  type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showHL',      label: 'Líneas H/L',  type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'extendLines', label: 'Extender al siguiente cierre de sesión', type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles, p) {
    const UTC_OFF = -6;
    // Definición de sesiones en horas UTC
    const SESSIONS = [
      { key: 'sydney',  name: 'SYD', color: '#38bdf8', startH: 23, endH: 31, show: p.showSydney },
      { key: 'tokyo',   name: 'TOK', color: '#f59e0b', startH: 0,  endH: 9,  show: p.showTokyo  },
      { key: 'london',  name: 'LON', color: '#c084fc', startH: 7,  endH: 16, show: p.showLondon },
      { key: 'newyork', name: 'NY',  color: '#10b981', startH: 12, endH: 21, show: p.showNY     },
    ];

    function utcHour(ts) { return new Date(ts).getUTCHours(); }
    function dayOfYear(ts) {
      const d = new Date(ts);
      return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    }

    const sessionLevels = []; // { sessKey, color, name, startT, endT, open, high, low, close }

    SESSIONS.forEach(sess => {
      if (sess.show === 'no') return;

      // Agrupar velas por sesión
      const groups = {};
      candles.forEach(c => {
        const h = utcHour(c.t);
        const nextH = utcHour(c.t + 15 * 60000);
        // Ajustar para sesiones que cruzan medianoche (Sydney: 23-31 → 23-07)
        let inSess = false;
        if (sess.endH > 24) {
          inSess = h >= sess.startH || h < (sess.endH - 24);
        } else {
          inSess = h >= sess.startH && h < sess.endH;
        }
        if (!inSess) return;

        // Key de sesión = día UTC del inicio lógico de la sesión
        let sessDay = dayOfYear(c.t);
        if (sess.endH > 24 && h < sess.endH - 24) {
          sessDay = dayOfYear(c.t - 24 * 3600000); // pertenece al día anterior
        }
        const gk = `${sess.key}-${sessDay}`;
        if (!groups[gk]) groups[gk] = { candles: [], sessKey: sess.key, color: sess.color, name: sess.name };
        groups[gk].candles.push(c);
      });

      Object.values(groups).forEach(g => {
        if (!g.candles.length) return;
        const cs = g.candles;
        sessionLevels.push({
          sessKey: g.sessKey,
          color:   g.color,
          name:    g.name,
          startT:  cs[0].t,
          endT:    cs[cs.length - 1].t + 15 * 60000,
          open:    cs[0].o,
          high:    Math.max(...cs.map(c => c.h)),
          low:     Math.min(...cs.map(c => c.l)),
          close:   cs[cs.length - 1].c,
        });
      });
    });

    // Ordenar por tiempo
    sessionLevels.sort((a, b) => a.startT - b.startT);
    return sessionLevels;
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.length) return;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    const extend = params.extendLines !== 'no';

    // Para cada sesión, encontrar rango X visible
    series.forEach(sess => {
      const ciStart = candles.findIndex(c => c.t >= sess.startT);
      if (ciStart < 0) return;

      // X inicio = primera vela de la sesión
      const xStart = barX(ciStart);

      // X fin: próxima sesión del mismo tipo, o borde del gráfico si extend
      let xEnd;
      if (extend) {
        // Buscar cuándo empieza la siguiente sesión del mismo tipo
        const nextSess = series.find(s => s.sessKey === sess.sessKey && s.startT > sess.startT);
        if (nextSess) {
          const ciNext = candles.findIndex(c => c.t >= nextSess.startT);
          xEnd = ciNext >= 0 ? barX(ciNext) : W - PADR;
        } else {
          xEnd = W - PADR;
        }
      } else {
        const ciEnd = candles.findIndex(c => c.t >= sess.endT);
        xEnd = ciEnd >= 0 ? barX(ciEnd) : W - PADR;
      }

      if (xEnd <= xStart) return;

      const col = sess.color;

      // Relleno del período de sesión
      ctx.fillStyle = col + '08';
      ctx.fillRect(xStart, PADT, xEnd - xStart, chartH);

      function drawLevel(price, dash, width, alpha) {
        if (price == null) return;
        const y = py(price);
        ctx.strokeStyle = col + alpha;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(xStart, y);
        ctx.lineTo(xEnd, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // High y Low
      if (params.showHL !== 'no') {
        drawLevel(sess.high, [4, 3], 1,   'cc');  // High sólido
        drawLevel(sess.low,  [4, 3], 1,   'cc');  // Low sólido
      }
      // Open
      if (params.showOpen !== 'no') {
        drawLevel(sess.open, [2, 4], 0.8, '88');
      }

      // Etiqueta de sesión
      ctx.fillStyle = col + 'bb';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(sess.name, xStart + 3, PADT + 10);

      // Etiqueta de precio en High y Low
      if (params.showHL !== 'no') {
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = col + '99';
        const fmtP = v => v >= 10000 ? v.toFixed(1) : v >= 100 ? v.toFixed(2) : v.toFixed(4);
        ctx.fillText(fmtP(sess.high), xEnd - 2, py(sess.high) - 2);
        ctx.fillText(fmtP(sess.low),  xEnd - 2, py(sess.low)  + 8);
      }
    });

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   LIQ ZONES — Zonas de Liquidez Estimadas
   Identifica clusters donde hay órdenes acumuladas:
   - Sobre máximos recientes (stop hunts alcistas)
   - Bajo mínimos recientes (stop hunts bajistas)
   El precio se mueve hacia la liquidez como imán.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'liq_zones',
  name:      'Zonas de Liquidez — Stop Hunt Levels',
  shortName: 'LIQ',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'lookback',    label: 'Velas para detectar swing', type: 'number', default: 10,  min: 3, max: 50 },
    { key: 'zonePct',     label: 'Grosor de zona (%)',        type: 'number', default: 0.15, min: 0.05, max: 1, step: 0.05 },
    { key: 'colorHigh',   label: 'Color zona alta (sell-side)', type: 'color', default: '#ff5470' },
    { key: 'colorLow',    label: 'Color zona baja (buy-side)',  type: 'color', default: '#26d994' },
    { key: 'minTouches',  label: 'Mínimo de toques',          type: 'number', default: 2, min: 1, max: 5 },
    { key: 'showSwings',  label: 'Mostrar puntos swing',      type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles, p) {
    const lb      = Math.max(3, p.lookback | 0);
    const zones   = [];

    // Detectar swing highs y lows
    const swingHighs = [], swingLows = [];

    for (let i = lb; i < candles.length - lb; i++) {
      const c = candles[i];
      let isHigh = true, isLow = true;
      for (let j = i - lb; j <= i + lb; j++) {
        if (j === i) continue;
        if (candles[j].h >= c.h) isHigh = false;
        if (candles[j].l <= c.l) isLow  = false;
      }
      if (isHigh) swingHighs.push({ i, t: c.t, price: c.h });
      if (isLow)  swingLows.push({ i, t: c.t, price: c.l });
    }

    // Agrupar swings cercanos en zonas (cluster = liquidez acumulada)
    function cluster(swings, isHigh) {
      const zs = [];
      swings.forEach(sw => {
        const tol = sw.price * (p.zonePct / 100);
        const existing = zs.find(z => Math.abs(z.price - sw.price) < tol * 3);
        if (existing) {
          existing.touches++;
          existing.price = (existing.price * (existing.touches - 1) + sw.price) / existing.touches;
          existing.lastT = sw.t;
        } else {
          zs.push({ price: sw.price, touches: 1, firstT: sw.t, lastT: sw.t, isHigh, firstI: sw.i });
        }
      });
      return zs.filter(z => z.touches >= (p.minTouches | 0));
    }

    const highZones = cluster(swingHighs, true);
    const lowZones  = cluster(swingLows,  false);

    return {
      zones: [...highZones, ...lowZones],
      swingHighs,
      swingLows,
      zonePct: p.zonePct,
    };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.zones) return;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    const lastC = candles[candles.length - 1];
    const curPrice = lastC?.c || 0;

    series.zones.forEach(zone => {
      const tol   = zone.price * (series.zonePct / 100) * 0.5;
      const yTop  = py(zone.price + tol);
      const yBot  = py(zone.price - tol);
      const h     = Math.max(2, yBot - yTop);
      const col   = zone.isHigh ? params.colorHigh : params.colorLow;

      // Verificar si la zona ya fue barrida (precio cerró a través)
      const ciFirst = candles.findIndex(c => c.t >= zone.firstT);
      let swept = false;
      if (ciFirst >= 0) {
        for (let j = ciFirst; j < candles.length; j++) {
          if (zone.isHigh && candles[j].c > zone.price + tol) { swept = true; break; }
          if (!zone.isHigh && candles[j].c < zone.price - tol) { swept = true; break; }
        }
      }

      // Relleno de zona
      ctx.fillStyle = col + (swept ? '18' : '33');
      ctx.fillRect(PADL, yTop, W - PADL - PADR, h);

      // Borde
      ctx.strokeStyle = col + (swept ? '44' : '99');
      ctx.lineWidth = swept ? 0.5 : 1;
      ctx.setLineDash(swept ? [3, 4] : []);
      ctx.strokeRect(PADL, yTop, W - PADL - PADR, h);
      ctx.setLineDash([]);

      // Etiqueta (solo zonas no barridas)
      if (!swept) {
        const dist = ((zone.price - curPrice) / curPrice * 100);
        ctx.fillStyle = col + 'cc';
        ctx.font = `bold 8px sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(
          `LIQ ${zone.isHigh ? '↑' : '↓'} ×${zone.touches}  ${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%`,
          W - PADR - 3, yTop - 2
        );
      }
    });

    // Puntos swing
    if (params.showSwings !== 'no') {
      [...series.swingHighs, ...series.swingLows].forEach(sw => {
        const ci = candles.findIndex(c => c.t === sw.t);
        if (ci < 0) return;
        const x   = barX(ci) + barW / 2;
        const y   = py(sw.price);
        const col = sw.price === sw.price ? (
          series.swingHighs.includes(sw) ? params.colorHigh : params.colorLow
        ) : params.colorLow;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = (series.swingHighs.includes(sw) ? params.colorHigh : params.colorLow) + '88';
        ctx.fill();
      });
    }

    ctx.restore();
  },
});




/* ═══════════════════════════════════════════════════════════════════
   FVG — Fair Value Gaps (Gaps de Valor Justo)
   Zonas donde el precio se movió tan rápido que dejó desequilibrio.
   Patrón clave de SMC / ICT. El precio tiende a regresar a llenarlos.
   
   Un FVG alcista: vela[i-1].high < vela[i+1].low (gap entre i-1 y i+1)
   Un FVG bajista: vela[i-1].low  > vela[i+1].high
   
   Se "llena" cuando el precio cierra dentro del gap.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'fvg',
  name:      'FVG — Fair Value Gaps (SMC/ICT)',
  shortName: 'FVG',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'minSizePct',  label: 'Tamaño mínimo (%)',       type: 'number', default: 0.05, min: 0, max: 5, step: 0.01 },
    { key: 'showFilled',  label: 'Mostrar gaps llenados',   type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'extend',      label: 'Extender hasta llenarse', type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'bullColor',   label: 'Color alcista',           type: 'color',  default: '#26d994' },
    { key: 'bearColor',   label: 'Color bajista',           type: 'color',  default: '#ff5470' },
    { key: 'maxGaps',     label: 'Máx. gaps visibles',      type: 'number', default: 30, min: 5, max: 100 },
  ],

  calc(candles, p) {
    const gaps = [];
    const minSize = p.minSizePct / 100;

    for (let i = 1; i < candles.length - 1; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const next = candles[i + 1];

      // FVG alcista: gap entre high de i-1 y low de i+1
      const bullGapLo = prev.h;
      const bullGapHi = next.l;
      if (bullGapHi > bullGapLo) {
        const size = (bullGapHi - bullGapLo) / curr.c;
        if (size >= minSize) {
          // Encontrar si fue llenado
          let filledAt = null;
          for (let j = i + 1; j < candles.length; j++) {
            if (candles[j].l <= bullGapLo + (bullGapHi - bullGapLo) * 0.5) {
              filledAt = j;
              break;
            }
          }
          gaps.push({ type: 'bull', lo: bullGapLo, hi: bullGapHi, startI: i, endI: filledAt, t: curr.t });
        }
      }

      // FVG bajista: gap entre low de i-1 y high de i+1
      const bearGapHi = prev.l;
      const bearGapLo = next.h;
      if (bearGapLo < bearGapHi) {
        const size = (bearGapHi - bearGapLo) / curr.c;
        if (size >= minSize) {
          let filledAt = null;
          for (let j = i + 1; j < candles.length; j++) {
            if (candles[j].h >= bearGapLo + (bearGapHi - bearGapLo) * 0.5) {
              filledAt = j;
              break;
            }
          }
          gaps.push({ type: 'bear', lo: bearGapLo, hi: bearGapHi, startI: i, endI: filledAt, t: curr.t });
        }
      }
    }

    // Recortar a los últimos N gaps
    const max = Math.max(5, p.maxGaps | 0);
    return { gaps: gaps.slice(-max) };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.gaps) return;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    const extend = params.extend !== 'no';
    const showFilled = params.showFilled !== 'no';

    series.gaps.forEach(gap => {
      const filled = gap.endI != null;
      if (filled && !showFilled) return;

      const xStart = barX(gap.startI) + barW;
      let xEnd;

      if (filled) {
        xEnd = barX(gap.endI) + barW;
      } else if (extend) {
        xEnd = W - PADR;
      } else {
        // Draw for just 3 candles if not extending and not filled
        xEnd = barX(Math.min(gap.startI + 3, candles.length - 1)) + barW;
      }

      if (xEnd <= xStart) return;
      if (xStart > W - PADR || xEnd < PADL) return;

      const col  = gap.type === 'bull' ? params.bullColor : params.bearColor;
      const yTop = py(gap.hi);
      const yBot = py(gap.lo);
      const h    = Math.max(1, yBot - yTop);

      // Fill
      ctx.fillStyle = col + (filled ? '18' : '33');
      ctx.fillRect(xStart, yTop, xEnd - xStart, h);

      // Border lines (top and bottom of gap)
      ctx.strokeStyle = col + (filled ? '55' : 'aa');
      ctx.lineWidth = filled ? 0.6 : 1;
      ctx.setLineDash(filled ? [3, 4] : []);

      ctx.beginPath();
      ctx.moveTo(xStart, yTop);
      ctx.lineTo(xEnd,   yTop);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(xStart, yBot);
      ctx.lineTo(xEnd,   yBot);
      ctx.stroke();

      ctx.setLineDash([]);

      // Label on right edge (only unfilled)
      if (!filled && xEnd >= W - PADR - 2) {
        const midY  = (yTop + yBot) / 2 + 3;
        const label = `FVG ${gap.type === 'bull' ? '↑' : '↓'}`;
        ctx.font = 'bold 8px sans-serif';
        ctx.fillStyle = col + 'cc';
        ctx.textAlign = 'right';
        ctx.fillText(label, W - PADR - 3, midY);
      }
    });

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   MSB / CHoCH — Market Structure Break / Change of Character
   Detecta rupturas de estructura de mercado:
   - BOS  (Break of Structure): continuación de impulso
   - CHoCH (Change of Character): cambio de tendencia
   
   Metodología ICT/SMC:
   - Swing High barrido + cierre previo roto → CHoCH bajista
   - Swing Low barrido + cierre previo roto  → CHoCH alcista
   - BOS es la confirmación en dirección de tendencia
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'msb',
  name:      'MSB / CHoCH — Market Structure Break',
  shortName: 'MSB',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'swingLen',    label: 'Largo de swing',         type: 'number', default: 5,  min: 2, max: 30 },
    { key: 'showBOS',     label: 'Mostrar BOS',            type: 'select', default: 'yes', options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showCHoCH',   label: 'Mostrar CHoCH',          type: 'select', default: 'yes', options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'bosColor',    label: 'Color BOS',              type: 'color',  default: '#38bdf8' },
    { key: 'chochBullColor', label: 'Color CHoCH alcista', type: 'color',  default: '#26d994' },
    { key: 'chochBearColor', label: 'Color CHoCH bajista', type: 'color',  default: '#ff5470' },
    { key: 'lineWidth',   label: 'Grosor línea',           type: 'number', default: 1.5, min: 0.5, max: 4 },
  ],

  calc(candles, p) {
    const lb = Math.max(2, p.swingLen | 0);
    const n  = candles.length;

    // Detectar swing highs y lows
    const swingHighs = [];
    const swingLows  = [];

    for (let i = lb; i < n - lb; i++) {
      let isH = true, isL = true;
      for (let j = i - lb; j <= i + lb; j++) {
        if (j === i) continue;
        if (j < 0 || j >= n) continue;
        if (candles[j].h >= candles[i].h) isH = false;
        if (candles[j].l <= candles[i].l) isL  = false;
      }
      if (isH) swingHighs.push({ i, price: candles[i].h, t: candles[i].t });
      if (isL)  swingLows.push({ i, price: candles[i].l, t: candles[i].t });
    }

    const breaks = [];

    // Scan for BOS/CHoCH
    // Determine current trend by comparing last two swing highs/lows
    let trend = 0; // 1 = bullish, -1 = bearish

    for (let i = lb; i < n; i++) {
      const c = candles[i];

      // Check if a swing high was broken (bearish)
      const recentHigh = swingHighs.filter(s => s.i < i - lb).slice(-1)[0];
      const prevHigh   = swingHighs.filter(s => s.i < i - lb).slice(-2, -1)[0];
      if (recentHigh && c.c > recentHigh.price) {
        const isCHoCH = trend === -1; // was bearish, now breaking up = CHoCH
        breaks.push({
          type:    isCHoCH ? 'CHoCH' : 'BOS',
          dir:     'bull',
          price:   recentHigh.price,
          i:       recentHigh.i,
          breakI:  i,
          t:       candles[i].t,
        });
        trend = 1;
      }

      // Check if a swing low was broken (bullish → broken = bearish)
      const recentLow = swingLows.filter(s => s.i < i - lb).slice(-1)[0];
      if (recentLow && c.c < recentLow.price) {
        const isCHoCH = trend === 1; // was bullish, now breaking down = CHoCH
        breaks.push({
          type:    isCHoCH ? 'CHoCH' : 'BOS',
          dir:     'bear',
          price:   recentLow.price,
          i:       recentLow.i,
          breakI:  i,
          t:       candles[i].t,
        });
        trend = -1;
      }
    }

    // Deduplicate — keep only last break at each structural level
    const seen = new Set();
    const deduped = breaks.filter(b => {
      const key = `${b.dir}-${b.i}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { breaks: deduped.slice(-40), swingHighs, swingLows };
  },

  draw(ctx, series, layout, params) {
    if (!series) return;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    // Draw swing points (subtle dots)
    const dotR = 2;
    if (series.swingHighs) {
      series.swingHighs.forEach(sw => {
        const x = barX(sw.i) + barW / 2;
        const y = py(sw.price) - dotR - 2;
        if (x < PADL || x > W - PADR) return;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = '#ff547066';
        ctx.fill();
      });
    }
    if (series.swingLows) {
      series.swingLows.forEach(sw => {
        const x = barX(sw.i) + barW / 2;
        const y = py(sw.price) + dotR + 2;
        if (x < PADL || x > W - PADR) return;
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = '#26d99466';
        ctx.fill();
      });
    }

    // Draw structure breaks
    (series.breaks || []).forEach(b => {
      const isCHoCH = b.type === 'CHoCH';
      if (!isCHoCH && params.showBOS === 'no') return;
      if (isCHoCH && params.showCHoCH === 'no') return;

      const col = isCHoCH
        ? (b.dir === 'bull' ? params.chochBullColor : params.chochBearColor)
        : params.bosColor;

      const xSw    = barX(b.i) + barW / 2;
      const xBreak = barX(b.breakI) + barW / 2;
      const y      = py(b.price);

      if (xBreak < PADL && xSw < PADL) return;
      if (xSw > W - PADR) return;

      // Horizontal line at the structural level
      ctx.strokeStyle = col + 'cc';
      ctx.lineWidth   = params.lineWidth;
      ctx.setLineDash(isCHoCH ? [] : [4, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.max(xSw, PADL), y);
      ctx.lineTo(Math.min(xBreak, W - PADR), y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrow/triangle at breakout point
      const arrX = Math.min(xBreak, W - PADR - 10);
      const arrY = b.dir === 'bull' ? y - 4 : y + 4;
      ctx.fillStyle = col;
      ctx.beginPath();
      if (b.dir === 'bull') {
        ctx.moveTo(arrX - 4, y + 4);
        ctx.lineTo(arrX + 4, y + 4);
        ctx.lineTo(arrX,     y - 2);
      } else {
        ctx.moveTo(arrX - 4, y - 4);
        ctx.lineTo(arrX + 4, y - 4);
        ctx.lineTo(arrX,     y + 2);
      }
      ctx.closePath();
      ctx.fill();

      // Label
      if (arrX > PADL + 20) {
        ctx.font = `bold 8px sans-serif`;
        ctx.fillStyle = col;
        ctx.textAlign = 'center';
        const labelY = b.dir === 'bull' ? y - 8 : y + 14;
        ctx.fillText(b.type, arrX, labelY);
      }
    });

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   IMBALANCE HEATMAP — Mapa de calor de desequilibrios
   Acumula todas las zonas FVG no llenadas y las colorea por densidad.
   Las zonas con más imbalances actúan como imanes de precio.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'imbalance_heatmap',
  name:      'Imbalance / Inefficiency Heatmap',
  shortName: 'IMB',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'bins',        label: 'Niveles de precio',  type: 'number', default: 50, min: 10, max: 200 },
    { key: 'minPct',      label: 'Tamaño mínimo (%)',  type: 'number', default: 0.03, min: 0, max: 2, step: 0.01 },
    { key: 'opacity',     label: 'Opacidad máx (%)',   type: 'number', default: 60, min: 10, max: 100 },
    { key: 'bullColor',   label: 'Color alcista',      type: 'color',  default: '#26d994' },
    { key: 'bearColor',   label: 'Color bajista',      type: 'color',  default: '#ff5470' },
    { key: 'showLabels',  label: 'Etiquetas densidad', type: 'select', default: 'yes', options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles, p) {
    const bins   = Math.max(10, p.bins | 0);
    const minPct = (p.minPct || 0) / 100;

    if (candles.length < 3) return { bins: [], priceMin: 0, priceMax: 1 };

    const allLow  = Math.min(...candles.map(c => c.l));
    const allHigh = Math.max(...candles.map(c => c.h));
    const range   = allHigh - allLow || 1;
    const binSize = range / bins;

    const bullDensity = new Float32Array(bins);
    const bearDensity = new Float32Array(bins);

    for (let i = 1; i < candles.length - 1; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const next = candles[i + 1];

      // Bullish FVG: prev.h < next.l
      const bgLo = prev.h, bgHi = next.l;
      if (bgHi > bgLo && (bgHi - bgLo) / curr.c >= minPct) {
        // Check if still unfilled
        let filled = false;
        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].l <= bgLo) { filled = true; break; }
        }
        if (!filled) {
          const bLo = Math.max(0, Math.floor((bgLo - allLow) / binSize));
          const bHi = Math.min(bins - 1, Math.floor((bgHi - allLow) / binSize));
          for (let b = bLo; b <= bHi; b++) bullDensity[b]++;
        }
      }

      // Bearish FVG: prev.l > next.h
      const bdHi = prev.l, bdLo = next.h;
      if (bdLo < bdHi && (bdHi - bdLo) / curr.c >= minPct) {
        let filled = false;
        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].h >= bdHi) { filled = true; break; }
        }
        if (!filled) {
          const bLo = Math.max(0, Math.floor((bdLo - allLow) / binSize));
          const bHi = Math.min(bins - 1, Math.floor((bdHi - allLow) / binSize));
          for (let b = bLo; b <= bHi; b++) bearDensity[b]++;
        }
      }
    }

    const maxDensity = Math.max(
      Math.max(...bullDensity),
      Math.max(...bearDensity),
      1
    );

    return { bullDensity, bearDensity, maxDensity, priceMin: allLow, priceMax: allHigh, binSize, bins };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.bullDensity) return;
    const { py, PADL, PADR, W, PADT, chartH } = layout;

    const { bullDensity, bearDensity, maxDensity, priceMin, binSize, bins } = series;
    const maxAlpha = (params.opacity || 60) / 100;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    const chartW = W - PADL - PADR;

    for (let b = 0; b < bins; b++) {
      const bPrice  = priceMin + b * binSize;
      const yBot    = py(bPrice);
      const yTop    = py(bPrice + binSize);
      const h       = Math.max(1, yBot - yTop);

      if (bullDensity[b] > 0) {
        const alpha = (bullDensity[b] / maxDensity) * maxAlpha;
        ctx.fillStyle = params.bullColor + Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.fillRect(PADL, yTop, chartW, h);
      }
      if (bearDensity[b] > 0) {
        const alpha = (bearDensity[b] / maxDensity) * maxAlpha;
        ctx.fillStyle = params.bearColor + Math.round(alpha * 255).toString(16).padStart(2, '0');
        ctx.fillRect(PADL, yTop, chartW, h);
      }

      // Label for high-density zones
      if (params.showLabels !== 'no') {
        const total = bullDensity[b] + bearDensity[b];
        if (total >= 3) {
          const midY = yTop + h / 2 + 3;
          if (midY > PADT && midY < PADT + chartH) {
            ctx.fillStyle = '#ffffff55';
            ctx.font = '7px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`×${total}`, PADL + 3, midY);
          }
        }
      }
    }

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   OI DELTA — Cambio en Open Interest vela a vela
   Requiere Binance Futures API (/fapi/v1/openInterestHist).
   
   OI↑ + Precio↑ = tendencia sana (longs entrando)
   OI↑ + Precio↓ = shorts acumulando → explosión inminente
   OI↓ = posiciones cerrándose (toma de ganancias / stop loss)
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'oi_delta',
  name:      'OI Delta — Cambio en Open Interest',
  shortName: 'OI·Δ',
  type:      'panel',
  defaultOn: false,

  params: [
    { key: 'colorBull',     label: 'OI↑ + precio↑',   type: 'color', default: '#26d994' },
    { key: 'colorBear',     label: 'OI↑ + precio↓',   type: 'color', default: '#ff5470' },
    { key: 'colorClose',    label: 'OI↓ (cierre)',     type: 'color', default: '#848e9c' },
    { key: 'smaPeriod',     label: 'SMA suavizado',    type: 'number', default: 5, min: 1, max: 50 },
  ],

  // OI historical data is fetched separately and cached
  _oiCache: null,
  _oiSymbol: null,
  _oiFetching: false,

  calc(candles, p) {
    // Try to use cached OI data
    const sym = (window._appSymbol || 'BTCUSDT').toUpperCase();

    // Kick off fetch if needed (async, won't block calc)
    if (!this._oiFetching && (this._oiSymbol !== sym || !this._oiCache)) {
      this._oiFetching = true;
      this._oiSymbol   = sym;
      const self = this;

      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${sym}&period=15m&limit=500`)
        .then(r => r.json())
        .then(data => {
          if (!Array.isArray(data)) { self._oiCache = []; return; }
          self._oiCache = data.map(d => ({
            t:  +d.timestamp,
            oi: +d.sumOpenInterest,
          }));
          self._oiFetching = false;
          // Trigger a redraw via draw() naturally
        })
        .catch(() => { self._oiCache = []; self._oiFetching = false; });
    }

    if (!this._oiCache || !this._oiCache.length) {
      return { loading: true, pts: [] };
    }

    const oiMap = new Map(this._oiCache.map(d => [d.t, d.oi]));

    const pts = [];
    for (let i = 1; i < candles.length; i++) {
      const c    = candles[i];
      const prev = candles[i - 1];
      const oi     = oiMap.get(c.t);
      const oiPrev = oiMap.get(prev.t);

      if (oi == null || oiPrev == null) {
        pts.push({ t: c.t, v: null });
        continue;
      }

      const delta      = oi - oiPrev;
      const priceUp    = c.c >= prev.c;
      const oiUp       = delta >= 0;

      pts.push({
        t:       c.t,
        v:       delta,
        oiUp,
        priceUp,
        bull:    oiUp && priceUp,
        bear:    oiUp && !priceUp,
        close:   !oiUp,
      });
    }

    // SMA of OI delta
    const vals = pts.map(p => p.v);
    const sma  = INDICATORS.math.sma(vals, p.smaPeriod);

    return {
      loading: false,
      pts,
      sma: candles.map((c, i) => ({ t: c.t, v: sma[i] })),
    };
  },

  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;

    // Background
    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    if (!series || series.loading) {
      ctx.fillStyle = '#848e9c';
      ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Cargando OI de Binance…', PADL + (W - PADL - PADR) / 2, panelY + panelH / 2 + 4);
      return;
    }

    const pts = series.pts || [];
    const validVals = pts.map(p => p.v).filter(v => v != null && isFinite(v));
    if (!validVals.length) {
      ctx.fillStyle = '#848e9c';
      ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Sin datos OI para este símbolo', PADL + (W - PADL - PADR) / 2, panelY + panelH / 2 + 4);
      return;
    }

    const absMax = Math.max(...validVals.map(Math.abs), 1);
    const vMin = -absMax, vMax = absMax;
    const range = vMax - vMin;
    const py2   = v => panelY + panelH - ((v - vMin) / range) * panelH;
    const yZero = py2(0);

    // Zero line
    ctx.strokeStyle = '#3a3f4799'; ctx.lineWidth = 0.6; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(PADL, yZero); ctx.lineTo(W - PADR, yZero); ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Bars
    pts.forEach(pt => {
      if (pt.v == null || !isFinite(pt.v)) return;
      const ci = candles.findIndex(c => c.t === pt.t);
      if (ci < 0) return;
      const x  = barX(ci);
      const y  = py2(pt.v);
      const h  = Math.abs(yZero - y);
      if (h < 0.5) return;

      const col = pt.bull  ? params.colorBull
                : pt.bear  ? params.colorBear
                :              params.colorClose;
      ctx.fillStyle = col + 'cc';
      ctx.fillRect(x + 1, Math.min(y, yZero), barW - 1, h);
    });

    // SMA line
    if (series.sma) {
      ctx.beginPath(); ctx.strokeStyle = '#f0b90bcc'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
      let s2 = false;
      series.sma.forEach(pt => {
        if (pt.v == null || !isFinite(pt.v)) { s2 = false; return; }
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2, y = py2(pt.v);
        if (!s2) { ctx.moveTo(x, y); s2 = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    ctx.restore();

    // Legend
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    let lx = PADL + 4;
    const ly = panelY + 11;
    [
      { col: params.colorBull,  label: '■ OI↑P↑' },
      { col: params.colorBear,  label: '■ OI↑P↓' },
      { col: params.colorClose, label: '■ OI↓' },
    ].forEach(({ col, label }) => {
      ctx.fillStyle = col + 'cc';
      ctx.fillText(label, lx, ly);
      lx += ctx.measureText(label).width + 8;
    });
  },
});


/* ═══════════════════════════════════════════════════════════════════
   FUNDING RATE HISTORY — Historial del Funding Rate
   Grafica el historial del funding rate como panel.
   Funding extremadamente positivo = longs sobrecomprados → squeeze.
   Funding negativo extremo = oportunidad larga.
   Datos de Binance Futures /fapi/v1/fundingRate
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'funding_rate',
  name:      'Funding Rate — Historial',
  shortName: 'FR',
  type:      'panel',
  defaultOn: false,

  params: [
    { key: 'bullColor',     label: 'Positivo (longs pagan)',  type: 'color', default: '#ff5470' },
    { key: 'bearColor',     label: 'Negativo (shorts pagan)', type: 'color', default: '#26d994' },
    { key: 'extremeLevel',  label: 'Nivel extremo (%)',       type: 'number', default: 0.05, min: 0.01, max: 0.5, step: 0.01 },
  ],

  _frCache: null,
  _frSymbol: null,
  _frFetching: false,

  calc(candles, p) {
    const sym = (window._appSymbol || 'BTCUSDT').toUpperCase();

    if (!this._frFetching && (this._frSymbol !== sym || !this._frCache)) {
      this._frFetching = true;
      this._frSymbol   = sym;
      const self = this;

      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=500`)
        .then(r => r.json())
        .then(data => {
          if (!Array.isArray(data)) { self._frCache = []; return; }
          self._frCache = data.map(d => ({
            t:  +d.fundingTime,
            fr: +d.fundingRate * 100,   // store as %
          }));
          self._frFetching = false;
        })
        .catch(() => { self._frCache = []; self._frFetching = false; });
    }

    if (!this._frCache || !this._frCache.length) return { loading: true, pts: [] };

    // Map funding times to candle timestamps (funding every 8h)
    const pts = candles.map(c => {
      // Find the funding entry closest to (and before) this candle
      const match = this._frCache
        .filter(f => f.t <= c.t + 4 * 3600000 && f.t >= c.t - 8 * 3600000)
        .slice(-1)[0];
      return { t: c.t, v: match ? match.fr : null };
    });

    return { loading: false, pts };
  },

  draw(ctx, series, layout, params) {
    const { barX, barW, PADL, PADR, W, candles, panelY, panelH } = layout;

    ctx.fillStyle = '#0b0e1188';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
    ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
    ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

    if (!series || series.loading) {
      ctx.fillStyle = '#848e9c'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Cargando Funding Rate…', PADL + (W - PADL - PADR) / 2, panelY + panelH / 2 + 4);
      return;
    }

    const pts = series.pts || [];
    const validVals = pts.map(p => p.v).filter(v => v != null && isFinite(v));
    if (!validVals.length) {
      ctx.fillStyle = '#848e9c'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Sin datos FR', PADL + (W - PADL - PADR) / 2, panelY + panelH / 2 + 4);
      return;
    }

    const extreme  = params.extremeLevel || 0.05;
    const absMax   = Math.max(...validVals.map(Math.abs), extreme * 1.5);
    const vMin = -absMax, vMax = absMax;
    const range    = vMax - vMin;
    const py2      = v => panelY + panelH - ((v - vMin) / range) * panelH;
    const yZero    = py2(0);
    const yExtHi   = py2(extreme);
    const yExtLo   = py2(-extreme);

    // Extreme zones
    ctx.fillStyle = params.bullColor + '15';
    ctx.fillRect(PADL, panelY, W - PADL - PADR, yExtHi - panelY);
    ctx.fillStyle = params.bearColor + '15';
    ctx.fillRect(PADL, yExtLo, W - PADL - PADR, panelY + panelH - yExtLo);

    // Reference lines
    [{ y: yZero, col: '#3a3f4766', dash: [3, 4] },
     { y: yExtHi, col: params.bullColor + '55', dash: [3, 3] },
     { y: yExtLo, col: params.bearColor + '55', dash: [3, 3] }
    ].forEach(({ y, col, dash }) => {
      ctx.strokeStyle = col; ctx.lineWidth = 0.6; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
      ctx.setLineDash([]);
    });

    ctx.save();
    ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

    // Area fill + line
    const visPts = pts.filter(pt => pt.v != null && isFinite(pt.v));
    if (visPts.length > 1) {
      // Filled area
      ctx.beginPath();
      const firstCI = candles.findIndex(c => c.t === visPts[0].t);
      ctx.moveTo(barX(firstCI) + barW / 2, yZero);
      visPts.forEach(pt => {
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci >= 0) ctx.lineTo(barX(ci) + barW / 2, py2(pt.v));
      });
      const lastCI = candles.findIndex(c => c.t === visPts[visPts.length - 1].t);
      ctx.lineTo(barX(lastCI) + barW / 2, yZero);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, panelY, 0, panelY + panelH);
      grad.addColorStop(0,   params.bullColor + '66');
      grad.addColorStop(0.5, '#ffffff11');
      grad.addColorStop(1,   params.bearColor + '66');
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath(); ctx.strokeStyle = '#f0b90b'; ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
      let s = false;
      visPts.forEach(pt => {
        const ci = candles.findIndex(c => c.t === pt.t);
        if (ci < 0) return;
        const x = barX(ci) + barW / 2, y = py2(pt.v);
        if (!s) { ctx.moveTo(x, y); s = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    ctx.restore();

    // Scale labels
    [vMax, 0, vMin].forEach(lv => {
      const y = py2(lv);
      ctx.fillStyle = '#5a6272'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(lv.toFixed(4) + '%', W - PADR - 3, y - 2);
    });

    // Last value badge
    const lastV = visPts.slice(-1)[0];
    if (lastV) {
      const y   = py2(lastV.v);
      const col = lastV.v > extreme ? params.bullColor : lastV.v < -extreme ? params.bearColor : '#f0b90b';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect(W - PADR + 3, y - 8, PADR - 6, 16, 3); ctx.fill();
      ctx.fillStyle = '#0b0e11'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText(lastV.v.toFixed(4) + '%', W - PADR + 3 + (PADR - 6) / 2, y + 3);
    }

    ctx.fillStyle = '#f0b90b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Funding Rate', PADL + 4, panelY + 11);
  },
});


/* ═══════════════════════════════════════════════════════════════════
   LIQUIDATION CLUSTERS — Clusters de liquidaciones estimadas
   Estima zonas con alta concentración de stops usando:
   - Swing highs/lows con múltiples toques (stop hunts)
   - Distancia del precio actual
   - Apalancamiento típico (10x, 20x, 50x, 100x)
   El precio se mueve exactamente hacia estas zonas.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'liq_clusters',
  name:      'Liquidation Clusters — Stops Estimados',
  shortName: 'LIQ·C',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'lookback',    label: 'Velas de lookback',     type: 'number', default: 8,    min: 3, max: 30 },
    { key: 'minTouches',  label: 'Toques mínimos',        type: 'number', default: 2,    min: 1, max: 10 },
    { key: 'leverages',   label: 'Apalancamientos',       type: 'select', default: 'all',
      options: [{ v: 'all', l: 'Todos (10-100x)' }, { v: 'high', l: 'Alto (50-100x)' }, { v: 'med', l: 'Medio (20-50x)' }] },
    { key: 'colorSell',   label: 'Longs liquidados (↓)',  type: 'color',  default: '#ff5470' },
    { key: 'colorBuy',    label: 'Shorts liquidados (↑)', type: 'color',  default: '#26d994' },
    { key: 'showDistPct', label: 'Mostrar distancia %',   type: 'select', default: 'yes', options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles, p) {
    const lb = Math.max(3, p.lookback | 0);
    const n  = candles.length;
    const levs = p.leverages === 'high' ? [50, 100]
               : p.leverages === 'med'  ? [20, 50]
               : [10, 20, 50, 100];

    // Find swing highs and lows
    const swingHighs = [], swingLows = [];
    for (let i = lb; i < n - lb; i++) {
      let isH = true, isL = true;
      for (let j = i - lb; j <= i + lb; j++) {
        if (j === i) continue;
        if (candles[j].h >= candles[i].h) isH = false;
        if (candles[j].l <= candles[i].l) isL  = false;
      }
      if (isH) swingHighs.push({ i, price: candles[i].h, t: candles[i].t });
      if (isL)  swingLows.push({ i, price: candles[i].l, t: candles[i].t });
    }

    // Cluster nearby swings
    function cluster(swings) {
      const clusters = [];
      swings.forEach(sw => {
        const tol = sw.price * 0.002; // 0.2% tolerance for clustering
        const existing = clusters.find(cl => Math.abs(cl.price - sw.price) < tol * 3);
        if (existing) {
          existing.touches++;
          existing.price = (existing.price + sw.price) / 2;
          existing.lastI = sw.i;
        } else {
          clusters.push({ price: sw.price, touches: 1, firstI: sw.i, lastI: sw.i });
        }
      });
      return clusters.filter(cl => cl.touches >= (p.minTouches | 0));
    }

    const highClusters = cluster(swingHighs).map(cl => ({ ...cl, type: 'sell' }));
    const lowClusters  = cluster(swingLows).map(cl => ({ ...cl, type: 'buy' }));
    const allClusters  = [...highClusters, ...lowClusters];

    const currentPrice = candles[n - 1]?.c || 1;

    // For each cluster, compute estimated liq levels for each leverage
    const zones = [];
    allClusters.forEach(cl => {
      levs.forEach(lev => {
        const liqPct = 1 / lev;  // simplified: liq when price moves 1/lev from entry
        const entryEstimate = cl.price;

        // If sell cluster (longs stopped above): estimate longs entered below with SL above
        // If buy cluster (shorts stopped below):  estimate shorts entered above with SL below
        const liqPrice = cl.type === 'sell'
          ? entryEstimate * (1 - liqPct)   // long entry below cluster, liq further down
          : entryEstimate * (1 + liqPct);  // short entry above cluster, liq further up

        const distPct = ((liqPrice - currentPrice) / currentPrice) * 100;

        zones.push({
          ...cl,
          lev,
          liqPrice,
          distPct,
          size: cl.touches * Math.sqrt(lev), // strength = touches × sqrt(leverage)
        });
      });
    });

    // Sort by strength
    zones.sort((a, b) => b.size - a.size);

    return { zones: zones.slice(0, 50), currentPrice };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.zones) return;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    const curP = series.currentPrice;

    series.zones.forEach(zone => {
      const y   = py(zone.liqPrice);
      if (y < PADT || y > PADT + chartH) return;

      const col   = zone.type === 'sell' ? params.colorSell : params.colorBuy;
      const alpha = Math.min(0.8, 0.2 + (zone.size / 20) * 0.6);
      const lw    = Math.min(3, 0.5 + zone.size / 15);

      // Line
      ctx.strokeStyle = col + Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.lineWidth   = lw;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(PADL, y);
      ctx.lineTo(W - PADR, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label on right
      if (params.showDistPct !== 'no') {
        const sign   = zone.distPct >= 0 ? '+' : '';
        const label  = `${zone.lev}x  ${sign}${zone.distPct.toFixed(1)}%`;
        ctx.fillStyle = col + 'aa';
        ctx.font      = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(label, W - PADR - 3, y - 2);
      }
    });

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   DELTA DIVERGENCE DETECTOR — Divergencias CVD vs Precio
   Compara el Cumulative Volume Delta con el precio.
   Marca automáticamente con flechas las divergencias:
   - Precio hace HH pero CVD hace LH → divergencia bajista
   - Precio hace LL pero CVD hace HL → divergencia alcista
   En vez de que tú las busques visualmente, el indicador las señala.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'delta_divergence',
  name:      'Delta Divergence — CVD vs Precio',
  shortName: 'DIV·Δ',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'swingLen',    label: 'Largo de swing',        type: 'number', default: 5,  min: 2, max: 20 },
    { key: 'bullColor',   label: 'Divergencia alcista',   type: 'color',  default: '#26d994' },
    { key: 'bearColor',   label: 'Divergencia bajista',   type: 'color',  default: '#ff5470' },
    { key: 'showLabel',   label: 'Etiquetas',             type: 'select', default: 'yes', options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'minStrength', label: 'Fuerza mínima (%)',     type: 'number', default: 0.5, min: 0, max: 10, step: 0.1 },
  ],

  calc(candles, p) {
    const lb = Math.max(2, p.swingLen | 0);
    const n  = candles.length;

    // Calculate CVD (Cumulative Volume Delta) from OHLCV
    // Approximation: bull volume = v * (c-l)/(h-l), bear = v * (h-c)/(h-l)
    const cvd = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c   = candles[i];
      const hl  = c.h - c.l || 1;
      const delta = c.v * ((c.c - c.l) - (c.h - c.c)) / hl;  // bull - bear volume
      cvd[i] = (i > 0 ? cvd[i - 1] : 0) + delta;
    }

    // Find swing highs/lows in PRICE and CVD simultaneously
    const priceSwingH = [], priceSwingL = [];
    const cvdSwingH   = [], cvdSwingL   = [];

    for (let i = lb; i < n - lb; i++) {
      let isPH = true, isPL = true;
      for (let j = i - lb; j <= i + lb; j++) {
        if (j === i) continue;
        if (candles[j].h >= candles[i].h) isPH = false;
        if (candles[j].l <= candles[i].l) isPL  = false;
      }

      // CVD swing
      let isCH = true, isCL = true;
      for (let j = i - lb; j <= i + lb; j++) {
        if (j === i) continue;
        if (j < 0 || j >= n) continue;
        if (cvd[j] >= cvd[i]) isCH = false;
        if (cvd[j] <= cvd[i]) isCL  = false;
      }

      if (isPH) priceSwingH.push({ i, price: candles[i].h });
      if (isPL)  priceSwingL.push({ i, price: candles[i].l });
      if (isCH) cvdSwingH.push({ i, val: cvd[i] });
      if (isCL)  cvdSwingL.push({ i, val: cvd[i] });
    }

    const divergences = [];
    const minStr = (p.minStrength || 0) / 100;

    // Bearish divergence: price HH + CVD LH (among last pair of highs)
    for (let k = 1; k < priceSwingH.length; k++) {
      const pH1 = priceSwingH[k - 1], pH2 = priceSwingH[k];
      if (pH2.price <= pH1.price) continue;  // not HH

      // Find closest CVD highs near these price swings
      const cH1 = cvdSwingH.find(c => Math.abs(c.i - pH1.i) <= lb * 2);
      const cH2 = cvdSwingH.find(c => Math.abs(c.i - pH2.i) <= lb * 2);
      if (!cH1 || !cH2) continue;
      if (cH2.val >= cH1.val) continue;  // not LH in CVD

      const priceChg = (pH2.price - pH1.price) / pH1.price;
      if (priceChg < minStr) continue;

      divergences.push({ type: 'bear', i1: pH1.i, i2: pH2.i, price1: pH1.price, price2: pH2.price });
    }

    // Bullish divergence: price LL + CVD HL
    for (let k = 1; k < priceSwingL.length; k++) {
      const pL1 = priceSwingL[k - 1], pL2 = priceSwingL[k];
      if (pL2.price >= pL1.price) continue;  // not LL

      const cL1 = cvdSwingL.find(c => Math.abs(c.i - pL1.i) <= lb * 2);
      const cL2 = cvdSwingL.find(c => Math.abs(c.i - pL2.i) <= lb * 2);
      if (!cL1 || !cL2) continue;
      if (cL2.val <= cL1.val) continue;  // not HL in CVD

      const priceChg = (pL1.price - pL2.price) / pL1.price;
      if (priceChg < minStr) continue;

      divergences.push({ type: 'bull', i1: pL1.i, i2: pL2.i, price1: pL1.price, price2: pL2.price });
    }

    return { divergences: divergences.slice(-20), cvd };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.divergences) return;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    series.divergences.forEach(div => {
      const col    = div.type === 'bull' ? params.bullColor : params.bearColor;
      const x1     = barX(div.i1) + barW / 2;
      const x2     = barX(div.i2) + barW / 2;
      const y1     = py(div.price1);
      const y2     = py(div.price2);

      if (x2 < PADL || x1 > W - PADR) return;

      // Line connecting the two swing points
      ctx.strokeStyle = col + 'cc';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.max(x1, PADL), y1);
      ctx.lineTo(Math.min(x2, W - PADR), y2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Circles at swing points
      [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(({ x, y }) => {
        if (x < PADL || x > W - PADR) return;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = col + '44';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Arrow at second swing point
      if (x2 > PADL && x2 < W - PADR) {
        const arrowY = div.type === 'bull' ? y2 + 14 : y2 - 14;
        ctx.fillStyle = col;
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(div.type === 'bull' ? '▲' : '▼', x2, arrowY);

        if (params.showLabel !== 'no') {
          ctx.font = 'bold 8px sans-serif';
          ctx.fillStyle = col + 'cc';
          ctx.fillText(`DIV ${div.type === 'bull' ? 'BULL' : 'BEAR'}`, x2, arrowY + (div.type === 'bull' ? 10 : -4));
        }
      }
    });

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   VPVR — Volume Profile Visible Range
   Histograma horizontal de volumen por nivel de precio
   calculado SOLO sobre las velas visibles en pantalla.
   El Point of Control (POC) = nivel con más volumen = imán de precio.
   Imprescindible en futuros. Usa rawCandles para máxima precisión.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'vpvr',
  name:      'VPVR — Volume Profile Visible Range',
  shortName: 'VPVR',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'bins',        label: 'Niveles de precio',      type: 'number', default: 48,  min: 10, max: 200 },
    { key: 'vaPercent',   label: 'Value Area %',           type: 'number', default: 70,  min: 50, max: 95  },
    { key: 'widthPct',    label: 'Ancho del histograma %', type: 'number', default: 25,  min: 5,  max: 60  },
    { key: 'side',        label: 'Lado',                   type: 'select', default: 'right',
      options: [{ v: 'right', l: 'Derecha' }, { v: 'left', l: 'Izquierda' }] },
    { key: 'bullColor',   label: 'Color alcista',          type: 'color',  default: '#26d994' },
    { key: 'bearColor',   label: 'Color bajista',          type: 'color',  default: '#ff5470' },
    { key: 'pocColor',    label: 'Color POC',              type: 'color',  default: '#f0b90b' },
    { key: 'vaColor',     label: 'Color Value Area',       type: 'color',  default: '#9c6cff' },
    { key: 'showPOC',     label: 'Línea POC',              type: 'select', default: 'yes', options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showVA',      label: 'Value Area fondo',       type: 'select', default: 'yes', options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'splitBull',   label: 'Split alcista/bajista',  type: 'select', default: 'yes', options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles, p) {
    // Actual computation is done in draw() because it depends on visible range (layout)
    return { _ready: true };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series._ready) return;

    const raw = window.rawCandles || (typeof rawCandles !== 'undefined' ? rawCandles : null);
    if (!raw || !raw.length) return;

    const { py, PADL, PADR, W, PADT, chartH, candles, startIdx, endIdx } = layout;

    const bins      = Math.max(10, Math.min(200, params.bins | 0));
    const vaPercent = Math.max(50, Math.min(95, params.vaPercent));
    const widthPct  = Math.max(5, Math.min(60, params.widthPct)) / 100;
    const onRight   = params.side !== 'left';
    const splitBull = params.splitBull !== 'no';

    // Only visible candles
    const visSlice   = candles.slice(startIdx, endIdx + 1).filter(c => !c.isNoMarket);
    if (!visSlice.length) return;

    const lo = Math.min(...visSlice.map(c => c.l));
    const hi = Math.max(...visSlice.map(c => c.h));
    if (hi <= lo) return;

    const binSize = (hi - lo) / bins;
    const bullVol = new Float64Array(bins);
    const bearVol = new Float64Array(bins);

    // Get visible time range
    const tMin = visSlice[0].t;
    const tMax = visSlice[visSlice.length - 1].t + (visSlice[0].tClose
      ? visSlice[0].tClose - visSlice[0].t
      : 15 * 60 * 1000);

    // Use rawCandles within the visible range
    const bucket = raw.filter(r => r.t >= tMin && r.t <= tMax);

    for (const r of bucket) {
      if (!r.v || r.v <= 0 || r.h <= r.l) continue;
      const bLo = Math.max(0,        Math.floor((r.l - lo) / binSize));
      const bHi = Math.min(bins - 1, Math.floor((r.h - lo) / binSize));
      const bull = r.c >= r.o;
      const rng  = r.h - r.l || 1;

      if (bLo === bHi) {
        if (bull) bullVol[bLo] += r.v; else bearVol[bLo] += r.v;
      } else {
        for (let b = bLo; b <= bHi; b++) {
          const bS   = lo + b * binSize;
          const bE   = bS + binSize;
          const over = Math.min(r.h, bE) - Math.max(r.l, bS);
          const frac = Math.max(0, over / rng);
          if (bull) bullVol[b] += r.v * frac; else bearVol[b] += r.v * frac;
        }
      }
    }

    const totalVol = new Float64Array(bins);
    for (let b = 0; b < bins; b++) totalVol[b] = bullVol[b] + bearVol[b];
    const maxVol  = Math.max(...totalVol, 1);
    const sumVol  = totalVol.reduce((a, v) => a + v, 0);
    if (sumVol <= 0) return;

    // POC
    let pocBin = 0;
    for (let b = 1; b < bins; b++) if (totalVol[b] > totalVol[pocBin]) pocBin = b;

    // Value Area
    const vaTarget = sumVol * (vaPercent / 100);
    let vaLo = pocBin, vaHi = pocBin, vaVol = totalVol[pocBin];
    while (vaVol < vaTarget && (vaLo > 0 || vaHi < bins - 1)) {
      const addLo = vaLo > 0        ? totalVol[vaLo - 1] : -Infinity;
      const addHi = vaHi < bins - 1 ? totalVol[vaHi + 1] : -Infinity;
      if (addLo >= addHi) { vaLo--; vaVol += totalVol[vaLo]; }
      else                { vaHi++; vaVol += totalVol[vaHi]; }
    }

    const histW   = (W - PADL - PADR) * widthPct;
    const xOrigin = onRight ? W - PADR - histW : PADL;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    // Value Area background
    if (params.showVA !== 'no') {
      const yVAH = py(lo + (vaHi + 1) * binSize);
      const yVAL = py(lo + vaLo * binSize);
      ctx.fillStyle = params.vaColor + '18';
      ctx.fillRect(xOrigin, Math.min(yVAH, yVAL), histW, Math.abs(yVAL - yVAH));
    }

    // Bars
    for (let b = 0; b < bins; b++) {
      if (totalVol[b] <= 0) continue;
      const yTop  = py(lo + (b + 1) * binSize);
      const yBot  = py(lo + b       * binSize);
      const barH  = Math.max(1, yBot - yTop);
      const isPOC = b === pocBin;
      const isVA  = b >= vaLo && b <= vaHi;

      if (isPOC) {
        const bw = (totalVol[b] / maxVol) * histW;
        ctx.fillStyle = params.pocColor + 'ee';
        ctx.fillRect(xOrigin, yTop, bw, Math.max(2, barH));
      } else if (splitBull) {
        const bwBull = (bullVol[b] / maxVol) * histW;
        const bwBear = (bearVol[b] / maxVol) * histW;
        ctx.fillStyle = params.bullColor + (isVA ? 'cc' : '55');
        ctx.fillRect(xOrigin, yTop, bwBull, barH);
        ctx.fillStyle = params.bearColor + (isVA ? 'cc' : '55');
        ctx.fillRect(xOrigin + bwBull, yTop, bwBear, barH);
      } else {
        const bw = (totalVol[b] / maxVol) * histW;
        ctx.fillStyle = isVA ? params.vaColor + 'aa' : '#4a527277';
        ctx.fillRect(xOrigin, yTop, bw, barH);
      }
    }

    // POC line (full width)
    if (params.showPOC !== 'no') {
      const yPOC = py(lo + (pocBin + 0.5) * binSize);
      ctx.strokeStyle = params.pocColor;
      ctx.lineWidth   = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(PADL, yPOC);
      ctx.lineTo(W - PADR, yPOC);
      ctx.stroke();
      ctx.setLineDash([]);

      // POC label
      ctx.fillStyle = params.pocColor;
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = onRight ? 'right' : 'left';
      ctx.fillText(`POC`, onRight ? W - PADR - 4 : PADL + 4, yPOC - 3);
    }

    // Label
    ctx.fillStyle = '#f0b90b99'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('VPVR', PADL + 4, PADT + 12);

    ctx.restore();
  },
});

/* ═══════════════════════════════════════════════════════════════════
   LELEDC EXHAUSTION LEVELS
   Detecta barras de agotamiento: cuando un move extendido alcanza
   un extremo del rango (highest/lowest N velas) con confirmación
   de reversión, dibuja flecha y traza el nivel como S/R horizontal.
   
   Señal BAJISTA: 10+ velas bullish consecutivas + high en máximo
                  del rango + vela cierra bajista → flecha roja arriba
   Señal ALCISTA: 10+ velas bearish consecutivas + low en mínimo
                  del rango + vela cierra alcista → flecha verde abajo
   
   Los niveles persisten hasta que aparezca la siguiente señal.
   Port exacto del script Pine v4 de InSilico / Leledc.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'leledc',
  name:      'Leledc — Exhaustion Levels',
  shortName: 'LELEDC',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'length',        label: 'Swing length (rango)',      type: 'number',  default: 40,       min: 5,  max: 200 },
    { key: 'bars',          label: 'Barras de agotamiento',     type: 'number',  default: 10,       min: 3,  max: 50  },
    { key: 'showArrows',    label: 'Mostrar flechas',           type: 'select',  default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showLevels',    label: 'Mostrar niveles S/R',       type: 'select',  default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'lineThickness', label: 'Grosor de líneas',          type: 'number',  default: 2,        min: 1,  max: 5   },
    { key: 'bearColor',     label: 'Color bajista (resistencia)', type: 'color', default: '#ff5470' },
    { key: 'bullColor',     label: 'Color alcista (soporte)',   type: 'color',   default: '#26d994' },
    { key: 'arrowAlpha',    label: 'Opacidad flechas (0–1)',    type: 'number',  default: 0.85,     min: 0.1, max: 1, step: 0.05 },
  ],

  calc(candles, p) {
    const len  = Math.max(5,  Math.round(p.length));
    const bars = Math.max(3,  Math.round(p.bars));
    const n    = candles.length;

    /* ── helpers ─────────────────────────────────────── */
    const highest = (arr, i, period, key) => {
      let v = -Infinity;
      for (let k = Math.max(0, i - period + 1); k <= i; k++) v = Math.max(v, arr[k][key]);
      return v;
    };
    const lowest = (arr, i, period, key) => {
      let v = Infinity;
      for (let k = Math.max(0, i - period + 1); k <= i; k++) v = Math.min(v, arr[k][key]);
      return v;
    };

    /* ── cálculo barra a barra ───────────────────────── */
    const signals    = [];   // { t, type:'bull'|'bear', price }
    const resistance = [];   // { t, v } (línea horizontal roja)
    const support    = [];   // { t, v } (línea horizontal verde)

    let bindex = 0;  // contador de velas alcistas consecutivas
    let sindex = 0;  // contador de velas bajistas consecutivas
    let lastResistance = null;
    let lastSupport    = null;

    for (let i = 4; i < n; i++) {
      const c = candles[i];

      /* Igual que Pine: bindex/sindex comparan close[0] vs close[4] */
      if (c.c > candles[i - 4].c) bindex++;
      else bindex = 0;

      if (c.c < candles[i - 4].c) sindex++;
      else sindex = 0;

      let sig = 0; // -1 bear, 1 bull

      if (bindex > bars && c.c < c.o && c.h >= highest(candles, i, len, 'h')) {
        bindex = 0;
        sig = -1;
      } else if (sindex > bars && c.c > c.o && c.l <= lowest(candles, i, len, 'l')) {
        sindex = 0;
        sig = 1;
      }

      if (sig === -1) {
        signals.push({ t: c.t, type: 'bear', price: c.h });
        lastResistance = c.h;
      }
      if (sig === 1) {
        signals.push({ t: c.t, type: 'bull', price: c.l });
        lastSupport = c.l;
      }

      /* Nivel de resistencia: se mantiene hasta la próxima señal bear */
      resistance.push({ t: c.t, v: lastResistance });
      /* Nivel de soporte: se mantiene hasta la próxima señal bull */
      support.push({ t: c.t, v: lastSupport });
    }

    return { signals, lines: { resistance, support } };
  },

  draw(ctx, series, layout, params) {
    if (!series) return;
    const { signals, lines } = series;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles, startIdx, endIdx } = layout;

    const showArrows = params.showArrows !== 'no';
    const showLevels = params.showLevels !== 'no';
    const lw         = Math.max(1, Math.round(params.lineThickness));
    const alpha      = Math.min(1, Math.max(0.05, params.arrowAlpha));

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    /* ── Niveles horizontales ─────────────────────────── */
    if (showLevels && lines) {
      const drawLevel = (pts, color) => {
        if (!pts || !pts.length) return;
        // Agrupa segmentos continuos con el mismo valor
        let segStart = null, segVal = null;

        const flushSeg = (endX) => {
          if (segStart == null) return;
          const y = py(segVal);
          if (y < PADT || y > PADT + chartH) return;
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth   = lw;
          ctx.globalAlpha = 0.75;
          ctx.moveTo(segStart, y);
          ctx.lineTo(endX, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        };

        for (let k = 0; k < pts.length; k++) {
          const pt = pts[k];
          if (pt.v == null) { flushSeg(null); segStart = null; segVal = null; continue; }
          const ci = candles.findIndex(c => c.t === pt.t);
          if (ci < startIdx || ci > endIdx) { flushSeg(null); segStart = null; segVal = null; continue; }
          const x = barX(ci) + barW / 2;
          if (segVal !== pt.v) {
            flushSeg(x);
            segStart = x;
            segVal   = pt.v;
          }
          // extend to current x
          flushSeg(x + barW / 2);
          segStart = x - barW / 2;
        }
        flushSeg(null);
      };

      /* Resistencias: dibujar línea continua en el último valor */
      /* Más eficiente: busca el último valor de resistencia visible y traza */
      const drawContinuousLevel = (pts, color) => {
        if (!pts || !pts.length) return;
        let prevVal = null;
        let lineStartX = null;

        const flush = (endX) => {
          if (prevVal == null || lineStartX == null) return;
          const y = py(prevVal);
          if (y < PADT - 5 || y > PADT + chartH + 5) return;
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth   = lw;
          ctx.globalAlpha = 0.8;
          ctx.moveTo(lineStartX, y);
          ctx.lineTo(endX, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        };

        for (let k = 0; k < pts.length; k++) {
          const pt = pts[k];
          const ci = candles.findIndex(c => c.t === pt.t);
          if (ci < startIdx || ci > endIdx) {
            flush(barX(Math.min(ci, endIdx)) + barW / 2);
            prevVal = pt.v;
            lineStartX = null;
            continue;
          }
          const x = barX(ci) + barW / 2;
          if (pt.v !== prevVal) {
            flush(x);
            lineStartX = x;
            prevVal = pt.v;
          }
        }
        flush(barX(endIdx) + barW);
      };

      drawContinuousLevel(lines.resistance, params.bearColor);
      drawContinuousLevel(lines.support,    params.bullColor);
    }

    /* ── Flechas en señales ───────────────────────────── */
    if (showArrows && signals && signals.length) {
      signals.forEach(sig => {
        const ci = candles.findIndex(c => c.t === sig.t);
        if (ci < startIdx || ci > endIdx) return;
        const x    = barX(ci) + barW / 2;
        const isBear = sig.type === 'bear';
        const price  = sig.price;
        const y      = py(price);

        /* Flecha */
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = isBear ? params.bearColor : params.bullColor;
        ctx.font        = `bold ${Math.max(14, barW * 1.2)}px sans-serif`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = isBear ? 'bottom' : 'top';
        const offsetPx  = Math.max(4, barW * 0.6);
        ctx.fillText(isBear ? '▼' : '▲', x, isBear ? y - offsetPx : y + offsetPx);

        /* Mini-etiqueta */
        ctx.globalAlpha = alpha * 0.7;
        ctx.font        = 'bold 8px sans-serif';
        ctx.textBaseline = isBear ? 'bottom' : 'top';
        const lblY      = isBear ? y - offsetPx - 14 : y + offsetPx + 4;
        ctx.fillText('EXHAUST', x, lblY);

        ctx.restore();
      });
    }

    /* ── Label indicador ─────────────────────────────── */
    ctx.fillStyle = '#f0b90b88';
    ctx.font      = 'bold 9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('LELEDC', PADL + 4, PADT + 22);

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   MECHAS SIGNIFICATIVAS
   Detecta velas con mechas superiores o inferiores >= umbral% respecto
   al close anterior, filtrando velas con rango total excesivo.
   
   Mecha superior (rechazo de precio arriba):
     high − (close si alcista, open si bajista) >= umbral%
     → wick verde ▲ debajo de la vela, etiqueta con %
   
   Mecha inferior (rechazo de precio abajo):
     (open si bajista, close si alcista) − low >= umbral%
     → wick rojo ▼ arriba de la vela, etiqueta con %
   
   Líneas de entrada (punteadas) y TP (sólidas) que se extienden
   hasta que el precio las toca o se agota el límite de velas.
   Port de Pine v5.
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'mechas',
  name:      'Mechas Significativas',
  shortName: 'MECHAS',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'umbral',        label: 'Mecha mínima (%)',          type: 'number', default: 1.5,  min: 0.1, max: 20,  step: 0.1 },
    { key: 'maxRango',      label: 'Rango máx vela (%)',        type: 'number', default: 5.0,  min: 0.1, max: 50,  step: 0.1 },
    { key: 'entradaEn',     label: 'Precio de entrada',         type: 'select', default: 'lowhigh',
      options: [{ v: 'lowhigh', l: 'LOW/HIGH' }, { v: 'open', l: 'OPEN' }, { v: 'close', l: 'CLOSE' }] },
    { key: 'limEntrada',    label: 'Límite velas entrada',      type: 'number', default: 50,   min: 1,   max: 500 },
    { key: 'limTP',         label: 'Límite velas TP',           type: 'number', default: 100,  min: 1,   max: 1000 },
    { key: 'bullColor',     label: 'Color mecha inferior',      type: 'color',  default: '#26d994' },
    { key: 'bearColor',     label: 'Color mecha superior',      type: 'color',  default: '#ff5470' },
    { key: 'showLabels',    label: 'Mostrar % en etiqueta',     type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'showLines',     label: 'Mostrar líneas entrada/TP', type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
  ],

  calc(candles, p) {
    const umbral   = p.umbral   / 100;
    const maxRango = p.maxRango / 100;
    const n        = candles.length;

    const signals = [];  // { t, mechaSup, mechaInf, pctSup, pctInf, entradaSup, entradaInf, tp_sup, tp_inf }

    for (let i = 1; i < n; i++) {
      const c    = candles[i];
      const prev = candles[i - 1];

      const bull  = c.c >= c.o;
      const rango = (c.h - c.l) / prev.c;
      if (rango > maxRango) continue;

      // Mecha superior: desde high hasta el cuerpo
      const mechaSup = c.h - (bull ? c.c : c.o);
      const pctSup   = mechaSup / prev.c;

      // Mecha inferior: desde el cuerpo hasta low
      const mechaInf = (bull ? c.o : c.c) - c.l;
      const pctInf   = mechaInf / prev.c;

      const hasSup = pctSup >= umbral;
      const hasInf = pctInf >= umbral;

      if (!hasSup && !hasInf) continue;

      // Precio de entrada
      const getEntrada = (esSuperior) => {
        if (p.entradaEn === 'open')  return c.o;
        if (p.entradaEn === 'close') return c.c;
        // lowhigh: mecha sup → entrada en low; mecha inf → entrada en high
        return esSuperior ? c.l : c.h;
      };

      signals.push({
        t:          c.t,
        idx:        i,
        hasSup,
        hasInf,
        pctSup:     pctSup * 100,
        pctInf:     pctInf * 100,
        tp_sup:     c.h,     // TP de la mecha superior = el high
        tp_inf:     c.l,     // TP de la mecha inferior = el low
        entSup:     getEntrada(true),
        entInf:     getEntrada(false),
      });
    }

    return { signals, candles };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.signals) return;
    const { signals } = series;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles, startIdx, endIdx } = layout;

    const showLines  = params.showLines  !== 'no';
    const showLabels = params.showLabels !== 'no';
    const limEnt     = Math.round(params.limEntrada);
    const limTP      = Math.round(params.limTP);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    /* ── Para cada señal en el rango visible ─────────── */
    signals.forEach(sig => {
      if (sig.idx < startIdx || sig.idx > endIdx) return;

      const x  = barX(sig.idx) + barW / 2;
      const hw = Math.max(barW * 0.6, 4);

      /* ── FLECHAS ─────────────────────────────────── */
      if (sig.hasSup) {
        const y = py(sig.tp_sup);
        ctx.fillStyle   = params.bearColor;
        ctx.globalAlpha = 0.9;
        ctx.font        = `bold ${Math.max(11, barW)}px sans-serif`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('▼', x, y - 2);

        if (showLabels) {
          ctx.globalAlpha  = 0.75;
          ctx.font         = 'bold 8px monospace';
          ctx.textBaseline = 'bottom';
          ctx.fillText(sig.pctSup.toFixed(2) + '%', x, y - 14);
        }
      }

      if (sig.hasInf) {
        const y = py(sig.tp_inf);
        ctx.fillStyle   = params.bullColor;
        ctx.globalAlpha = 0.9;
        ctx.font        = `bold ${Math.max(11, barW)}px sans-serif`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('▲', x, y + 2);

        if (showLabels) {
          ctx.globalAlpha  = 0.75;
          ctx.font         = 'bold 8px monospace';
          ctx.textBaseline = 'top';
          ctx.fillText(sig.pctInf.toFixed(2) + '%', x, y + 14);
        }
      }

      ctx.globalAlpha = 1;

      if (!showLines) return;

      /* ── LÍNEAS ──────────────────────────────────── */
      // Para cada línea necesitamos saber hasta qué barra llega
      const drawMgmtLine = (price, startCi, isTP, isBull) => {
        const lim    = isTP ? limTP : limEnt;
        const col    = isBull ? params.bullColor : params.bearColor;
        const hitFn  = isTP
          ? (c) => (isBull ? c.h >= price : c.l <= price)  // TP bull = precio toca high; bear = low
          : (c) => (isBull ? c.h >= price : c.l <= price); // entrada bull = precio baja a entry

        // Corregir hit para entrada vs TP:
        // Entrada sup (bear): busca precio de entrada (low de la vela señal) → se toca cuando low <= entSup
        // Entrada inf (bull): busca precio de entrada (high de la vela señal) → se toca cuando high >= entInf
        // TP sup (bear): high → se toca cuando high >= tp_sup
        // TP inf (bull): low → se toca cuando low <= tp_inf

        let endCi = Math.min(startCi + lim, candles.length - 1);
        for (let k = startCi + 1; k <= startCi + lim && k < candles.length; k++) {
          const hit = isTP
            ? (isBull ? candles[k].l <= price : candles[k].h >= price)
            : (isBull ? candles[k].h >= price : candles[k].l <= price);
          if (hit) { endCi = k; break; }
        }

        const x1 = barX(startCi) + barW / 2;
        const x2 = barX(endCi)   + barW / 2;
        const y  = py(price);

        if (y < PADT - 2 || y > PADT + chartH + 2) return;
        if (x2 < PADL || x1 > W - PADR) return;

        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.lineWidth   = 1.2;
        ctx.globalAlpha = isTP ? 0.7 : 0.45;
        if (!isTP) ctx.setLineDash([4, 3]);
        ctx.moveTo(Math.max(x1, PADL), y);
        ctx.lineTo(Math.min(x2, W - PADR), y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      };

      if (sig.hasSup) {
        drawMgmtLine(sig.tp_sup,  sig.idx, true,  false); // TP   bear = sólida roja
        drawMgmtLine(sig.entSup,  sig.idx, false, false); // ENT  bear = punteada roja
      }
      if (sig.hasInf) {
        drawMgmtLine(sig.tp_inf,  sig.idx, true,  true);  // TP   bull = sólida verde
        drawMgmtLine(sig.entInf,  sig.idx, false, true);  // ENT  bull = punteada verde
      }
    });

    /* ── Label ───────────────────────────────────────── */
    ctx.fillStyle    = '#f0b90b88';
    ctx.font         = 'bold 9px sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('MECHAS', PADL + 4, PADT + 33);

    ctx.restore();
  },
});


/* ═══════════════════════════════════════════════════════════════════
   ORDER BLOCK (OB) — Bloques de Órdenes Institucionales (SMC/ICT)
   
   Un Order Block es la última vela en dirección contraria al movimiento,
   justo antes de un impulso que rompe estructura (BOS/CHoCH).
   Representa la zona donde instituciones acumularon órdenes antes de
   mover el precio.

   Lógica de detección:
   ────────────────────
   1. Detectar impulso: vela cuyo rango supera un múltiplo del rango
      promedio reciente (movimiento "fuerte").
   2. Buscar hacia atrás la última vela OPUESTA al impulso
      (bajista antes de impulso alcista → OB alcista, y viceversa).
   3. Zona del OB = [open, close] de esa vela (cuerpo), o [low, high]
      si se activa "rango completo".
   4. Mitigación: el OB se considera "mitigado" cuando el precio regresa
      y toca la zona (similar a FVG).

   Combina con: MSB (define el impulso/ruptura), FVG (desequilibrio) y
   CVD (confirma si el volumen real respalda la zona institucional).
═══════════════════════════════════════════════════════════════════ */
window.INDICATORS.register({
  id:        'ob',
  name:      'Order Blocks — Zonas Institucionales (SMC/ICT)',
  shortName: 'OB',
  type:      'overlay',
  defaultOn: false,

  params: [
    { key: 'impulseMult',  label: 'Fuerza del impulso (x rango prom.)', type: 'number', default: 2.0, min: 1.0, max: 5.0, step: 0.1 },
    { key: 'lookbackAvg',  label: 'Velas para rango promedio',          type: 'number', default: 14,  min: 5,   max: 50 },
    { key: 'zoneMode',     label: 'Zona del OB',                        type: 'select', default: 'body',
      options: [{ v: 'body', l: 'Solo cuerpo (open-close)' }, { v: 'range', l: 'Rango completo (high-low)' }] },
    { key: 'showMitigated', label: 'Mostrar OBs mitigados',             type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'extend',       label: 'Extender hasta mitigarse',           type: 'select', default: 'yes',
      options: [{ v: 'yes', l: 'Sí' }, { v: 'no', l: 'No' }] },
    { key: 'bullColor',    label: 'Color OB alcista',                   type: 'color',  default: '#5da0ff' },
    { key: 'bearColor',    label: 'Color OB bajista',                   type: 'color',  default: '#f59e0b' },
    { key: 'maxBlocks',    label: 'Máx. bloques visibles',              type: 'number', default: 20, min: 5, max: 60 },
  ],

  calc(candles, p) {
    const n = candles.length;
    const lookback = Math.max(5, p.lookbackAvg | 0);
    if (n < lookback + 3) return { blocks: [] };

    const blocks = [];

    // Rango promedio móvil simple (proxy de ATR, sin dependencias externas)
    function avgRange(i) {
      let sum = 0, cnt = 0;
      for (let j = Math.max(0, i - lookback); j < i; j++) {
        sum += (candles[j].h - candles[j].l);
        cnt++;
      }
      return cnt > 0 ? sum / cnt : 0;
    }

    for (let i = lookback; i < n; i++) {
      const c = candles[i];
      const range = c.h - c.l;
      const avgR = avgRange(i);
      if (avgR <= 0) continue;

      const isImpulse = range >= avgR * p.impulseMult;
      if (!isImpulse) continue;

      const bullImpulse = c.c > c.o; // vela de impulso alcista
      const bearImpulse = c.c < c.o; // vela de impulso bajista
      if (!bullImpulse && !bearImpulse) continue;

      // Buscar hacia atrás la última vela opuesta al impulso
      let obIdx = -1;
      for (let j = i - 1; j >= Math.max(0, i - lookback); j--) {
        const cand = candles[j];
        const candBear = cand.c < cand.o;
        const candBull = cand.c > cand.o;
        if (bullImpulse && candBear) { obIdx = j; break; }
        if (bearImpulse && candBull) { obIdx = j; break; }
      }
      if (obIdx === -1) continue;

      const obCandle = candles[obIdx];
      let lo, hi;
      if (p.zoneMode === 'range') {
        lo = obCandle.l;
        hi = obCandle.h;
      } else {
        lo = Math.min(obCandle.o, obCandle.c);
        hi = Math.max(obCandle.o, obCandle.c);
      }
      if (hi <= lo) continue;

      const type = bullImpulse ? 'bull' : 'bear';

      // Evitar duplicados: mismo obIdx + tipo ya registrado
      if (blocks.some(b => b.obIdx === obIdx && b.type === type)) continue;

      // Mitigación: precio regresa y toca la zona después del impulso
      let mitigatedAt = null;
      for (let k = i + 1; k < n; k++) {
        const cand = candles[k];
        if (type === 'bull') {
          // OB alcista se mitiga si el precio cae dentro de la zona
          if (cand.l <= hi) { mitigatedAt = k; break; }
        } else {
          // OB bajista se mitiga si el precio sube dentro de la zona
          if (cand.h >= lo) { mitigatedAt = k; break; }
        }
      }

      blocks.push({
        type, lo, hi,
        obIdx,
        impulseIdx: i,
        endI: mitigatedAt,
        t: obCandle.t,
      });
    }

    const max = Math.max(5, p.maxBlocks | 0);
    return { blocks: blocks.slice(-max) };
  },

  draw(ctx, series, layout, params) {
    if (!series || !series.blocks) return;
    const { py, barX, barW, PADL, PADR, W, PADT, chartH, candles } = layout;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    const extend = params.extend !== 'no';
    const showMitigated = params.showMitigated !== 'no';

    series.blocks.forEach(block => {
      const mitigated = block.endI != null;
      if (mitigated && !showMitigated) return;

      const xStart = barX(block.obIdx) + barW;
      let xEnd;

      if (mitigated) {
        xEnd = barX(block.endI) + barW;
      } else if (extend) {
        xEnd = W - PADR;
      } else {
        xEnd = barX(Math.min(block.obIdx + 5, candles.length - 1)) + barW;
      }

      if (xEnd <= xStart) return;
      if (xStart > W - PADR || xEnd < PADL) return;

      const col  = block.type === 'bull' ? params.bullColor : params.bearColor;
      const yTop = py(block.hi);
      const yBot = py(block.lo);
      const h    = Math.max(1, yBot - yTop);

      // Fill
      ctx.fillStyle = col + (mitigated ? '14' : '2a');
      ctx.fillRect(xStart, yTop, xEnd - xStart, h);

      // Borde superior e inferior
      ctx.strokeStyle = col + (mitigated ? '44' : '99');
      ctx.lineWidth = mitigated ? 0.6 : 1.2;
      ctx.setLineDash(mitigated ? [3, 4] : []);

      ctx.beginPath();
      ctx.moveTo(xStart, yTop);
      ctx.lineTo(xEnd,   yTop);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(xStart, yBot);
      ctx.lineTo(xEnd,   yBot);
      ctx.stroke();

      ctx.setLineDash([]);

      // Etiqueta en el borde derecho (solo zonas activas)
      if (!mitigated && xEnd >= W - PADR - 2) {
        const midY  = (yTop + yBot) / 2 + 3;
        const label = `OB ${block.type === 'bull' ? '↑' : '↓'}`;
        ctx.font = 'bold 8px sans-serif';
        ctx.fillStyle = col + 'dd';
        ctx.textAlign = 'right';
        ctx.fillText(label, W - PADR - 3, midY);
      }
    });

    ctx.restore();
  },
});


/* ════════════════════════════════════════════════════════════════════
   MATRIZ DE TRANSICIÓN DE SESIONES (A→B) — Probabilidad de continuación
   ─────────────────────────────────────────────────────────────────────
   Esto NO es una estrategia con nombre bonito. Es una tabla de
   frecuencias condicionadas (datos fríos), calculada con WALK-FORWARD
   real: cada predicción usa solo información que ya existía en ese
   momento del historial, nunca datos futuros.

   Para cada sesión A ya cerrada se clasifica por:
     · Rango   → alto / medio / bajo, relativo al promedio histórico
                 RECIENTE de ESE MISMO tipo de sesión (no al global).
     · Volumen → alto / medio / bajo, mismo criterio relativo.
     · Dirección → alcista / bajista (cierre vs apertura del bloque).

   Y se pregunta: de todas las veces pasadas que esa sesión tuvo
   exactamente esa combinación, ¿qué % de las veces la sesión B
   (la siguiente inmediata, o siempre la próxima NY — parámetro
   "targetMode") continuó en la misma dirección que A?

   La ALERTA solo se dispara si se cumplen las dos condiciones:
     1) Probabilidad de continuación ≥ umbral configurado (def. 65%)
     2) Muestra histórica suficiente (n ≥ mínimo configurado, def. 15)
   Si no se cumplen ambas → no hay señal. Es 50/50, te cruzas de
   brazos, y el panel lo muestra en gris en vez de inventar una señal.

   VALIDACIÓN ANTI-SOBREAJUSTE (esto es la parte importante):
   El indicador NUNCA mide su acierto contra la misma tabla completa
   que usó para predecir — eso sería circular y siempre parecería
   mejor de lo que es en realidad. En su lugar, en cada punto del
   historial usa SOLO la matriz construida con transiciones YA
   resueltas hasta ese momento (ventana expandente), y al final
   reporta una sola cifra honesta: de las veces que esto habría
   disparado una alerta en tiempo real (no en retrospectiva), ¿qué
   % realmente continuó? Esa es la cifra que importa para saber si
   hay edge real, no la matriz completa con todo el historial metido
   de una vez.

   Para inspeccionar la tabla completa de frecuencias desde la
   consola del navegador (con el indicador activado):
       printTransitionMatrix()
════════════════════════════════════════════════════════════════════ */
(function () {

  let _lastReport = null; // snapshot de la matriz completa, para consulta desde consola

  function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
  function bucketRatio(ratio, lowM, highM) {
    if (ratio < lowM)  return 'bajo';
    if (ratio > highM) return 'alto';
    return 'medio';
  }

  window.INDICATORS.register({
    id:        'session_transition_matrix',
    name:      'Matriz de Transición de Sesiones A→B — Probabilidad de continuación (walk-forward)',
    shortName: 'A→B MTX',
    type:      'panel',
    defaultOn: false,
    params: [
      { key: 'maxBlocks',      label: 'Máx. bloques de sesión a considerar',     type: 'number', default: 1000, min: 50,  max: 5000 },
      { key: 'historyLook',    label: 'Historia por tipo de sesión (n bloques)', type: 'number', default: 50,   min: 10,  max: 300 },
      { key: 'targetMode',     label: 'Sesión B objetivo', type: 'select', default: 'next',
        options: [{ v: 'next', l: 'Sesión inmediata siguiente' }, { v: 'ny', l: 'Siempre la próxima NY' }] },
      { key: 'rangeLowMult',   label: 'Rango bajo (x prom. de esa sesión)',      type: 'number', default: 0.75, min: 0.1, max: 1 },
      { key: 'rangeHighMult',  label: 'Rango alto (x prom. de esa sesión)',      type: 'number', default: 1.25, min: 1,   max: 5 },
      { key: 'volLowMult',     label: 'Volumen bajo (x prom. de esa sesión)',    type: 'number', default: 0.75, min: 0.1, max: 1 },
      { key: 'volHighMult',    label: 'Volumen alto (x prom. de esa sesión)',    type: 'number', default: 1.25, min: 1,   max: 5 },
      { key: 'minSamples',     label: 'Muestra mínima para confiar (n)',         type: 'number', default: 15,  min: 3,   max: 200 },
      { key: 'alertThreshold', label: 'Umbral de alerta (%)',                    type: 'number', default: 65,  min: 50,  max: 95 },
    ],

    calc(candles, p) {
      if (!candles.length) return { blocks: [], current: null, matrix: {}, oos: null };

      /* ── 0. Fallback de sessionKey por hora UTC ─────────────────────────────────
         En temporalidades normales (1h, 4h, etc.) las velas de Binance llegan
         sin sessionKey — ese campo solo existe en modo Sesión. Si no hay al
         menos el 20% de velas con sessionKey real, lo derivamos del timestamp.
         Prioridad: NY > London > Tokyo > Sydney > NoMarket (cuando solapan,
         gana la sesión de mayor liquidez).
            UTC  0-07  → tokyo
            UTC  7-12  → london
            UTC 12-21  → newyork
            UTC 21-23  → nomarket
            UTC 23-24  → sydney (cierra el día siguiente)
      ── */
      const skPopulated = candles.filter(c => c.sessionKey && c.sessionKey !== 'unknown').length;
      const needsFallback = skPopulated / Math.max(1, candles.length) < 0.2;

      function _skFromUtc(t) {
        const h = new Date(t).getUTCHours();
        if (h >= 12 && h < 21) return { sk: 'newyork',  name: 'New York',  color: '#10b981' };
        if (h >= 7  && h < 12) return { sk: 'london',   name: 'Londres',   color: '#c084fc' };
        if (h >= 0  && h <  7) return { sk: 'tokyo',    name: 'Tokio',     color: '#f59e0b' };
        if (h >= 21 && h < 23) return { sk: 'nomarket', name: 'Sin mercado', color: '#3a3f47' };
        return                         { sk: 'sydney',   name: 'Sydney',    color: '#38bdf8' };
      }

      /* ── 1. Agrupar velas en bloques de sesión contiguos (mismo patrón que ORB) ── */
      const rawBlocks = [];
      let curSk = null, buf = [];
      const flush = () => {
        if (!buf.length) return;
        const skb = buf[0]._sk || buf[0].sessionKey || 'unknown';
        if (skb === 'nomarket' || skb === 'unknown') return; // fuera de mercado: no cuenta como bloque
        const o = buf[0].o, c = buf[buf.length - 1].c;
        const h = Math.max(...buf.map(x => x.h));
        const l = Math.min(...buf.map(x => x.l));
        const v = buf.reduce((s, x) => s + (x.v || 0), 0);
        rawBlocks.push({
          sk: skb, name: buf[0].sessionName || skb,
          o, h, l, c, v, range: h - l, bullish: c >= o,
          color: buf[0].color,
          _idxStart: buf[0]._idx, _idxEnd: buf[buf.length - 1]._idx,
        });
      };
      candles.forEach((cd, i) => {
        let sk = cd.sessionKey || 'unknown';
        let cdExtra = {};
        if (needsFallback || sk === 'unknown') {
          const fb = _skFromUtc(cd.t);
          sk = fb.sk;
          cdExtra = { sessionName: fb.name, color: fb.color };
        }
        if (sk !== curSk) { flush(); curSk = sk; buf = []; }
        buf.push({ ...cd, ...cdExtra, _sk: sk, _idx: i });
      });
      flush();

      const blocks = rawBlocks.length > p.maxBlocks ? rawBlocks.slice(-p.maxBlocks) : rawBlocks;
      if (blocks.length < 5) return { blocks: [], current: null, matrix: {}, oos: null };

      /* ── 2. Walk-forward: construir y consultar la matriz usando SOLO el pasado ── */
      const matrix = {};          // key → { cont, total }
      const rangeHist = {};       // sk → [range,...]  (ventana rodante, solo pasado)
      const volHist   = {};       // sk → [vol,...]
      const pendingByIdx = {};    // idx donde B cierra → [{key, continued}], se aplica justo ahí

      let baseHits = 0, baseTotal = 0;     // continuidad cruda, sin filtrar por confianza (referencia)
      let alertHits = 0, alertTotal = 0;   // SOLO los casos donde esto habría disparado alerta real

      const results = blocks.map((A, i) => {
        // Aplicar al matrix las resoluciones que "llegan" justo en este punto del tiempo
        const pend = pendingByIdx[i];
        if (pend) {
          pend.forEach(({ key, continued }) => {
            if (!matrix[key]) matrix[key] = { cont: 0, total: 0 };
            matrix[key].total++;
            if (continued) matrix[key].cont++;
          });
          delete pendingByIdx[i];
        }

        const sk = A.sk;
        if (!rangeHist[sk]) rangeHist[sk] = [];
        if (!volHist[sk])   volHist[sk]   = [];

        let rangeBucket = null, volBucket = null, key = null, prob = null, n = 0, alert = false;
        if (rangeHist[sk].length >= 3 && volHist[sk].length >= 3) {
          const avgR = avg(rangeHist[sk]);
          const avgV = avg(volHist[sk]);
          const rRatio = avgR ? A.range / avgR : 1;
          const vRatio = avgV ? A.v     / avgV : 1;
          rangeBucket = bucketRatio(rRatio, p.rangeLowMult, p.rangeHighMult);
          volBucket   = bucketRatio(vRatio, p.volLowMult,   p.volHighMult);
          key = `${sk}|${rangeBucket}|${volBucket}|${A.bullish ? 'bull' : 'bear'}`;
          const m = matrix[key];
          if (m && m.total > 0) {
            prob  = m.cont / m.total;
            n     = m.total;
            alert = n >= p.minSamples && prob * 100 >= p.alertThreshold;
          }
        }

        // Ubicar la sesión B según el modo elegido
        let B = null, jIdx = null;
        if (p.targetMode === 'ny') {
          for (let j = i + 1; j < blocks.length; j++) {
            if (blocks[j].sk === 'newyork') { B = blocks[j]; jIdx = j; break; }
          }
        } else {
          B = blocks[i + 1] || null; jIdx = i + 1;
        }

        let resolved = false, continued = null;
        if (B) {
          continued = (B.bullish === A.bullish);
          resolved  = true;
          baseTotal++; if (continued) baseHits++;
          if (alert) { alertTotal++; if (continued) alertHits++; }
          if (key) {
            if (!pendingByIdx[jIdx]) pendingByIdx[jIdx] = [];
            pendingByIdx[jIdx].push({ key, continued });
          }
        }

        // Actualizar historial de rango/volumen DESPUÉS de clasificar (no contaminar con el presente)
        rangeHist[sk].push(A.range); if (rangeHist[sk].length > p.historyLook) rangeHist[sk].shift();
        volHist[sk].push(A.v);       if (volHist[sk].length   > p.historyLook) volHist[sk].shift();

        return { ...A, idx: i, rangeBucket, volBucket, key, prob, n, alert, resolved, continued };
      });

      const current = results.length ? results[results.length - 1] : null;
      const oos = { baseHits, baseTotal, alertHits, alertTotal };

      _lastReport = { matrix, oos, params: p };

      return { blocks: results, current, matrix, oos };
    },

    draw(ctx, series, layout, params) {
      const { barX, barW, PADL, PADR, W, panelY, panelH } = layout;

      if (!series.blocks?.length) {
        ctx.fillStyle = '#0b0e1188';
        ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
        ctx.fillStyle = '#5a6272'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Acumulando bloques de sesión (necesita más historial)...', PADL + 6, panelY + panelH / 2);
        return;
      }

      ctx.fillStyle = '#0b0e1188';
      ctx.fillRect(PADL, panelY, W - PADL - PADR, panelH);
      ctx.strokeStyle = '#2b2f3688'; ctx.lineWidth = 0.5;
      ctx.strokeRect(PADL, panelY, W - PADL - PADR, panelH);

      const midY  = panelY + panelH / 2;
      const zoneH = panelH / 2 - 8;

      // Línea 50% (cero edge)
      ctx.strokeStyle = '#3a3f47cc'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(PADL, midY); ctx.lineTo(W - PADR, midY); ctx.stroke();
      ctx.fillStyle = '#3a3f47aa'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText('50%', W - PADR - 3, midY - 3);

      // Líneas del umbral de alerta (espejadas arriba/abajo)
      const thrFrac = Math.min(1, (params.alertThreshold - 50) / 50);
      [1, -1].forEach(sign => {
        const y = midY - sign * thrFrac * zoneH;
        ctx.strokeStyle = '#f0b90b55'; ctx.setLineDash([3, 5]); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(PADL, y); ctx.lineTo(W - PADR, y); ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.fillStyle = '#f0b90b88'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`±${params.alertThreshold}%`, W - PADR - 3, midY - thrFrac * zoneH - 2);

      ctx.save();
      ctx.beginPath(); ctx.rect(PADL, panelY, W - PADL - PADR, panelH); ctx.clip();

      series.blocks.forEach(b => {
        if (b.prob === null) return;
        const x1 = barX(b._idxStart);
        const x2 = barX(b._idxEnd) + barW;
        const probPct   = b.prob * 100;
        const dirSign    = b.bullish ? 1 : -1;
        const confDelta  = Math.max(-1, Math.min(1, (probPct - 50) / 50));
        const barEdge    = midY - confDelta * dirSign * zoneH;
        const yTop = Math.min(midY, barEdge);
        const h    = Math.max(1, Math.abs(barEdge - midY));
        const baseColor = b.alert ? (b.bullish ? '#26d994' : '#ff5470') : '#5a6272';
        ctx.fillStyle = baseColor + (b.alert ? 'cc' : '40');
        ctx.fillRect(x1, yTop, Math.max(1, x2 - x1 - 1), h);
        if (b.alert) {
          ctx.strokeStyle = baseColor; ctx.lineWidth = 1.1;
          ctx.strokeRect(x1, yTop, Math.max(1, x2 - x1 - 1), h);
        }
      });

      ctx.restore();

      // Leyenda inferior: estado de la sesión actual (la última, aún sin resolver)
      const cur = series.current;
      if (cur) {
        const txt = cur.prob === null
          ? `${cur.name} ${cur.bullish ? '▲' : '▼'} · acumulando historial todavía (sin muestra suficiente)`
          : `${cur.name} ${cur.bullish ? '▲' : '▼'} · rango ${cur.rangeBucket} · vol ${cur.volBucket} → P(continúa)=${(cur.prob * 100).toFixed(0)}% (n=${cur.n})${cur.alert ? '  ⚡ ALERTA' : ''}`;
        ctx.fillStyle = cur.alert ? (cur.bullish ? '#26d994' : '#ff5470') : '#848e9c';
        ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(txt, PADL + 4, panelY + panelH - 4);
      }

      // Acierto histórico REAL de la alerta (walk-forward, no circular)
      const oos = series.oos;
      ctx.font = '8px monospace'; ctx.textAlign = 'right';
      if (oos && oos.alertTotal > 0) {
        const acc = (oos.alertHits / oos.alertTotal * 100).toFixed(1);
        const base = (oos.baseHits / oos.baseTotal * 100).toFixed(1);
        ctx.fillStyle = '#848e9c';
        ctx.fillText(`Acierto real de la alerta: ${acc}% (n=${oos.alertTotal}) · base sin filtro: ${base}% (n=${oos.baseTotal})`, W - PADR - 3, panelY + 10);
      } else {
        ctx.fillStyle = '#5a6272';
        ctx.fillText('Todavía no se disparó ninguna alerta con estos parámetros en el historial cargado', W - PADR - 3, panelY + 10);
      }
    },
  });

  /* Helper de consola: imprime la tabla completa de frecuencias (la "tabla fría").
     Úsalo desde DevTools, con el indicador activado:
         printTransitionMatrix()                                                    */
  window.printTransitionMatrix = function () {
    if (!_lastReport) { console.warn('[A→B MTX] Activa el indicador primero (necesita haber calculado al menos una vez).'); return; }
    const rows = Object.entries(_lastReport.matrix).map(([key, m]) => {
      const [sk, rangeB, volB, dir] = key.split('|');
      return {
        sesión: sk, rango: rangeB, volumen: volB, dirección: dir,
        n: m.total, continuó: m.cont,
        'P(continúa) %': m.total ? (m.cont / m.total * 100).toFixed(1) : '—',
      };
    }).sort((a, b) => b.n - a.n);
    console.table(rows);
    const o = _lastReport.oos;
    if (o.alertTotal > 0) {
      console.log(`[A→B MTX] Acierto real walk-forward de la alerta: ${(o.alertHits / o.alertTotal * 100).toFixed(1)}% sobre ${o.alertTotal} casos. Base sin filtro: ${(o.baseHits / o.baseTotal * 100).toFixed(1)}% sobre ${o.baseTotal} casos.`);
    } else {
      console.log('[A→B MTX] Aún no hay casos donde la alerta se haya disparado con los parámetros actuales.');
    }
    return rows;
  };

})();


console.log('[INDICATORS] Motor cargado — indicadores registrados:',
  window.INDICATORS.getAll().map(d => d.shortName).join(', '));
