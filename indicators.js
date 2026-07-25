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
  let _lastCandlesSig = null; // firma de la última recalculación (evita recalcular en pan/zoom)

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

    /* Recalcula todas las series activas (con caché: solo recalcula
       cuando las velas realmente cambiaron, no en cada pan/zoom/hover) */
    recalcAll(candles) {
      const n = candles.length;
      const last = n ? candles[n - 1] : null;
      // "Firma" barata que detecta si llegó una vela nueva o si la última se actualizó
      const sig = last ? `${n}_${last.t}_${last.c}_${last.closed ? 1 : 0}` : '0';
      const dataChanged = sig !== _lastCandlesSig;
      if (dataChanged) _lastCandlesSig = sig;

      Object.entries(_active).forEach(([id, state]) => {
        const def = _registry[id];
        if (!def || !def.calc) return;
        // Si los datos no cambiaron y ya tenemos serie calculada, no recalcular
        if (!dataChanged && state.series) return;
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
    const { py, barX, startIdx, endIdx, step, barW, PADL, PADR, W, PADT, chartH, candles } = layout;
    const lines = series.lines || { main: series };
    // Rango visible con un pequeño margen, para no cortar la línea en los bordes
    const lo = Math.max(0, startIdx - 2);
    const hi = Math.min(candles.length - 1, endIdx + 2);
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

      if (pts.length === candles.length) {
        // Caso normal: la serie está alineada 1:1 por posición con candles
        // (misma longitud/orden) → acceso directo, sin findIndex.
        for (let ci = lo; ci <= hi; ci++) {
          const pt = pts[ci];
          if (!pt || pt.v == null || isNaN(pt.v)) { started = false; continue; }
          const x = barX(ci) + barW / 2;
          const y = py(pt.v);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
      } else {
        // Caso alternativo: construir un mapa t→índice UNA vez (O(n)),
        // en vez de findIndex por punto (O(n²)).
        const tMap = new Map();
        for (let i = 0; i < candles.length; i++) tMap.set(candles[i].t, i);
        pts.forEach(pt => {
          if (pt.v == null || isNaN(pt.v)) { started = false; return; }
          const ci = tMap.get(pt.t);
          if (ci == null || ci < lo || ci > hi) return;
          const x = barX(ci) + barW / 2;
          const y = py(pt.v);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        });
      }

      ctx.stroke();
      ctx.restore();
    });
  }

  /* ── Dibujado por defecto: panel con línea y área ── */
  function _defaultPanelDraw(ctx, series, layout, params, def) {
    const { barX, startIdx, endIdx, barW, PADL, PADR, W, candles, panelY, panelH } = layout;
    const pts   = series.lines?.main || series;
    if (!pts || !pts.length) return;

    const lo = Math.max(0, startIdx - 2);
    const hi = Math.min(candles.length - 1, endIdx + 2);
    const aligned = pts.length === candles.length;

    // Min/max solo sobre el rango visible (como TradingView autoescala)
    let vMin = Infinity, vMax = -Infinity;
    if (aligned) {
      for (let ci = lo; ci <= hi; ci++) {
        const v = pts[ci] && pts[ci].v;
        if (v == null || isNaN(v)) continue;
        if (v < vMin) vMin = v; if (v > vMax) vMax = v;
      }
    } else {
      for (let i = 0; i < pts.length; i++) {
        const v = pts[i].v;
        if (v == null || isNaN(v)) continue;
        if (v < vMin) vMin = v; if (v > vMax) vMax = v;
      }
    }
    if (!isFinite(vMin) || !isFinite(vMax)) return;
    vMin = params.scaleMin ?? vMin;
    vMax = params.scaleMax ?? vMax;
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

    if (aligned) {
      for (let ci = lo; ci <= hi; ci++) {
        const pt = pts[ci];
        if (!pt || pt.v == null || isNaN(pt.v)) { started = false; continue; }
        const x = barX(ci) + barW / 2;
        const y = py2(pt.v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
    } else {
      const tMap = new Map();
      for (let i = 0; i < candles.length; i++) tMap.set(candles[i].t, i);
      pts.forEach(pt => {
        if (pt.v == null || isNaN(pt.v)) { started = false; return; }
        const ci = tMap.get(pt.t);
        if (ci == null || ci < lo || ci > hi) return;
        const x = barX(ci) + barW / 2;
        const y = py2(pt.v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ── Formato de precio adaptativo (mismo criterio para todo indicador que ──
     dibuje una etiqueta de precio: BTC no necesita los mismos decimales que
     una moneda tipo BONK/SHIB a $0.00002 — con .toFixed(1) fijo esas se ven
     todas como "0.0"). ── */
  function fmtPrice(price) {
    if (price == null || isNaN(price)) return '—';
    const a = Math.abs(price);
    if (a === 0) return '0';
    if (a >= 100) return price.toFixed(2);
    if (a >= 1)   return price.toFixed(4);
    const decimals = Math.min(10, Math.max(2, Math.ceil(-Math.log10(a)) + 2));
    return price.toFixed(decimals);
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

  INDICATORS._defaultOverlayDraw = _defaultOverlayDraw;
  INDICATORS.fmtPrice = fmtPrice;
  window.INDICATORS = INDICATORS;

})();

/* ═══════════════════════════════════════════════════════════════════
   INDICADOR: Mechas Significativas (ex "Mechas 1.5% o Mayor")
   Detecta velas cuya mecha supera un % del cierre anterior, dentro
   de un rango máximo de vela. Dibuja dos líneas de referencia:
     Marca 1 → en el extremo de la mecha (high/low)
     Marca 2 → en un nivel interno configurable (low/high, open o close)
   Cada línea se extiende hasta que el precio la toca de nuevo o se
   alcanza el límite de velas configurado.
═══════════════════════════════════════════════════════════════════ */
(function () {

  function calcMechas(candles, p) {
    const umbral      = p.umbral;
    const maxRango     = p.maxRango;
    const origenMarca2 = p.origenMarca2;        // 'lh' | 'open' | 'close'
    const limMarca1    = p.limMarca1 === 'on';
    const velasMarca1  = p.velasMarca1;
    const limMarca2    = p.limMarca2 === 'on';
    const velasMarca2  = p.velasMarca2;

    const markers = [];
    const marca1  = [];
    const marca2  = [];

    function nivelInterno(c, esSuperior) {
      if (origenMarca2 === 'open')  return c.o;
      if (origenMarca2 === 'close') return c.c;
      // 'lh' → low/high: opuesto al extremo de la mecha
      return esSuperior ? c.l : c.h;
    }

    function buscarFinSup(precio, fromIdx, limitar, maxVelas) {
      const tope = limitar ? Math.min(candles.length - 1, fromIdx + maxVelas) : candles.length - 1;
      for (let j = fromIdx + 1; j <= tope; j++) {
        if (candles[j].h >= precio) return j;
      }
      return tope;
    }
    function buscarFinInf(precio, fromIdx, limitar, maxVelas) {
      const tope = limitar ? Math.min(candles.length - 1, fromIdx + maxVelas) : candles.length - 1;
      for (let j = fromIdx + 1; j <= tope; j++) {
        if (candles[j].l <= precio) return j;
      }
      return tope;
    }

    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const prevClose = candles[i - 1].c;
      if (!prevClose) continue;

      const rango = c.h - c.l;
      const pctRango = (rango / prevClose) * 100;
      const dentroRango = pctRango <= maxRango;
      if (!dentroRango) continue;

      const esAlcista = c.c > c.o;
      const esBajista = c.c < c.o;

      const mechaSup = c.h - (esAlcista ? c.c : c.o);
      const mechaInf = (esBajista ? c.c : c.o) - c.l;
      const pctSup = (mechaSup / prevClose) * 100;
      const pctInf = (mechaInf / prevClose) * 100;

      if (pctSup >= umbral) {
        markers.push({ idx: i, t: c.t, side: 'sup', pct: pctSup, price: c.h });
        const endM1 = buscarFinSup(c.h, i, limMarca1, velasMarca1);
        marca1.push({ side: 'sup', price: c.h, startIdx: i, endIdx: endM1 });
        const nivel2 = nivelInterno(c, true);
        const endM2 = buscarFinInf(nivel2, i, limMarca2, velasMarca2);
        marca2.push({ side: 'sup', price: nivel2, startIdx: i, endIdx: endM2 });
      }
      if (pctInf >= umbral) {
        markers.push({ idx: i, t: c.t, side: 'inf', pct: pctInf, price: c.l });
        const endM1 = buscarFinInf(c.l, i, limMarca1, velasMarca1);
        marca1.push({ side: 'inf', price: c.l, startIdx: i, endIdx: endM1 });
        const nivel2 = nivelInterno(c, false);
        const endM2 = buscarFinSup(nivel2, i, limMarca2, velasMarca2);
        marca2.push({ side: 'inf', price: nivel2, startIdx: i, endIdx: endM2 });
      }
    }

    return { markers, marca1, marca2 };
  }

  function drawMechas(ctx, series, layout, p) {
    const { barX, py, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    if (!series) return;

    const colorSup = p.colorSup || '#26d994';
    const colorInf = p.colorInf || '#ff5470';
    const lo = startIdx - 2, hi = endIdx + 2;
    const enRango = seg => seg.endIdx >= lo && seg.startIdx <= hi;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    function drawLineaSegmento(seg, dashed) {
      const x1 = barX(seg.startIdx) + barW / 2;
      const x2 = barX(seg.endIdx) + barW / 2;
      const y  = py(seg.price);
      ctx.beginPath();
      ctx.strokeStyle = seg.side === 'sup' ? colorSup : colorInf;
      ctx.lineWidth = 1.4;
      ctx.setLineDash(dashed ? [4, 3] : []);
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    (series.marca1 || []).filter(enRango).forEach(seg => drawLineaSegmento(seg, false));
    (series.marca2 || []).filter(enRango).forEach(seg => drawLineaSegmento(seg, true));

    ctx.restore();

    // Marcadores + etiqueta de %
    (series.markers || []).forEach(m => {
      if (m.idx < lo || m.idx > hi) return;
      const x = barX(m.idx) + barW / 2;
      if (x < PADL - barW || x > W - PADR + barW) return;
      const y = py(m.price);
      const color = m.side === 'sup' ? colorSup : colorInf;
      const dirY  = m.side === 'sup' ? -1 : 1;

      ctx.fillStyle = color;
      ctx.beginPath();
      if (m.side === 'sup') {
        ctx.moveTo(x - 4, y - 6); ctx.lineTo(x + 4, y - 6); ctx.lineTo(x, y - 1);
      } else {
        ctx.moveTo(x - 4, y + 6); ctx.lineTo(x + 4, y + 6); ctx.lineTo(x, y + 1);
      }
      ctx.closePath();
      ctx.fill();

      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(m.pct.toFixed(2) + '%', x, y + dirY * 16);
    });
  }

  window.INDICATORS.register({
    id: 'sigwicks',
    name: 'Mechas Significativas',
    shortName: 'Mechas',
    type: 'overlay',
    defaultOn: false,
    params: [
      { key: 'umbral',      label: 'Umbral mecha (%)',        type: 'number', default: 1.5, min: 0.1, max: 20, step: 0.1 },
      { key: 'maxRango',    label: 'Rango máx. vela (%)',     type: 'number', default: 5.0, min: 0.1, max: 50, step: 0.1 },
      { key: 'origenMarca2',label: 'Marca 2 origen',          type: 'select', default: 'lh',
        options: [{ v:'lh', l:'Low/High' }, { v:'open', l:'Open' }, { v:'close', l:'Close' }] },
      { key: 'limMarca1',   label: 'Límite Marca 1',          type: 'select', default: 'on',
        options: [{ v:'on', l:'Activado' }, { v:'off', l:'Desactivado' }] },
      { key: 'velasMarca1', label: 'Máx. velas Marca 1',      type: 'number', default: 100, min: 1, max: 1000, step: 1 },
      { key: 'limMarca2',   label: 'Límite Marca 2',          type: 'select', default: 'on',
        options: [{ v:'on', l:'Activado' }, { v:'off', l:'Desactivado' }] },
      { key: 'velasMarca2', label: 'Máx. velas Marca 2',      type: 'number', default: 50, min: 1, max: 500, step: 1 },
      { key: 'colorSup',    label: 'Color mecha superior',    type: 'color',  default: '#26d994' },
      { key: 'colorInf',    label: 'Color mecha inferior',    type: 'color',  default: '#ff5470' },
    ],
    calc: calcMechas,
    draw: drawMechas,
  });

})();

/* ═══════════════════════════════════════════════════════════════════
   INDICADOR: MA (Media Móvil Simple)
   Puerto directo del script Pine:
     len = input.int(99, "MA")
     Ma  = ta.sma(close, len)
     plot(Ma, color=#FF6D00)
═══════════════════════════════════════════════════════════════════ */
(function () {

  function calcMA(candles, p) {
    const closes = candles.map(c => c.c);
    const ma = window.INDICATORS.math.sma(closes, p.len);
    const main = candles.map((c, i) => ({ t: c.t, v: ma[i] }));

    // Señales de entrada: vela que CIERRA cruzando la MA
    // (close anterior y MA anterior de un lado, close actual y MA actual del otro).
    const signals = [];
    for (let i = 1; i < candles.length; i++) {
      const prevMa = ma[i - 1], curMa = ma[i];
      if (prevMa == null || curMa == null || isNaN(prevMa) || isNaN(curMa)) continue;
      const prevClose = candles[i - 1].c;
      const curClose  = candles[i].c;

      const crucePorArriba = prevClose <= prevMa && curClose > curMa; // cierra por encima → long
      const crucePorAbajo  = prevClose >= prevMa && curClose < curMa; // cierra por debajo → short

      if (crucePorArriba) {
        signals.push({ idx: i, t: candles[i].t, side: 'long', price: curClose });
      } else if (crucePorAbajo) {
        signals.push({ idx: i, t: candles[i].t, side: 'short', price: curClose });
      }
    }

    // ── Medición de recorrido: ¿hasta dónde llegó el precio tras cada señal? ──
    // Se mide el máximo movimiento a favor (high para long / low para short)
    // desde la vela de la señal hasta la vela ANTERIOR a la siguiente señal
    // (es decir, mientras esa dirección seguía "vigente" según la misma MA).
    for (let k = 0; k < signals.length; k++) {
      const s = signals[k];
      const finIdx = (k + 1 < signals.length) ? signals[k + 1].idx : candles.length - 1;
      let extremo = s.side === 'long' ? -Infinity : Infinity;
      for (let j = s.idx; j <= finIdx; j++) {
        if (s.side === 'long') extremo = Math.max(extremo, candles[j].h);
        else extremo = Math.min(extremo, candles[j].l);
      }
      s.movePct = s.side === 'long'
        ? (extremo - s.price) / s.price * 100
        : (s.price - extremo) / s.price * 100;
    }

    // ── Estadísticas agregadas (long y short por separado) ──
    function stats(side) {
      const arr = signals.filter(s => s.side === side).map(s => s.movePct).sort((a, b) => a - b);
      if (!arr.length) return null;
      const sum = arr.reduce((a, b) => a + b, 0);
      const avg = sum / arr.length;
      const median = arr[Math.floor(arr.length / 2)];
      const max = arr[arr.length - 1];
      const umbrales = [0.5, 1, 2, 3, 5];
      const pct = umbrales.map(u => ({
        u, pct: Math.round(arr.filter(v => v >= u).length / arr.length * 100)
      }));
      return { n: arr.length, avg, median, max, pct };
    }

    const summary = { long: stats('long'), short: stats('short') };

    return { lines: { main }, signals, summary };
  }

  function drawMA(ctx, series, layout, p) {
    // Dibuja la línea de la MA con el estilo por defecto...
    window.INDICATORS._defaultOverlayDraw(ctx, series, layout, p, {});

    // ...y encima los marcadores de entrada por cruce de cierre.
    const { barX, py, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    const lo = startIdx - 2, hi = endIdx + 2;
    const colorLong  = p.colorLong  || '#26d994';
    const colorShort = p.colorShort || '#ff5470';

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    (series.signals || []).forEach(s => {
      if (s.idx < lo || s.idx > hi) return;
      const x = barX(s.idx) + barW / 2;
      if (x < PADL - barW || x > W - PADR + barW) return;
      const y = py(s.price);
      const color = s.side === 'long' ? colorLong : colorShort;
      const dirY  = s.side === 'long' ? 1 : -1; // etiqueta debajo (long) o arriba (short) del precio

      ctx.fillStyle = color;
      ctx.beginPath();
      if (s.side === 'long') {
        // triángulo apuntando hacia arriba, debajo del precio
        ctx.moveTo(x - 5, y + 10); ctx.lineTo(x + 5, y + 10); ctx.lineTo(x, y + 2);
      } else {
        // triángulo apuntando hacia abajo, arriba del precio
        ctx.moveTo(x - 5, y - 10); ctx.lineTo(x + 5, y - 10); ctx.lineTo(x, y - 2);
      }
      ctx.closePath();
      ctx.fill();

      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(s.side === 'long' ? 'LONG' : 'SHORT', x, y + dirY * 20);

      // % de recorrido logrado, pegado al marcador
      if (s.movePct != null) {
        ctx.font = '8px sans-serif';
        ctx.fillText('+' + s.movePct.toFixed(2) + '%', x, y + dirY * 30);
      }
    });

    ctx.restore();

    // ── Caja de estadísticas (esquina superior derecha del gráfico) ──
    const sm = series.summary;
    if (sm && (sm.long || sm.short) && p.mostrarStats !== 'off') {
      ctx.save();
      const boxW = 190;
      const lineasLong  = sm.long  ? 3 : 0;
      const lineasShort = sm.short ? 3 : 0;
      const boxH = 20 + (lineasLong + lineasShort) * 13 + (sm.long && sm.short ? 6 : 0);
      const bx = W - PADR - boxW - 6;
      const by = PADT + 6;

      ctx.fillStyle = 'rgba(11,14,17,0.88)';
      ctx.strokeStyle = '#2b2f36';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(bx, by, boxW, boxH);
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f0b90b';
      ctx.fillText('RECORRIDO TRAS SEÑAL', bx + 8, by + 13);

      let yy = by + 28;
      function pintarLado(label, s, color) {
        if (!s) return;
        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(`${label}  (n=${s.n})`, bx + 8, yy);
        yy += 13;
        ctx.font = '9px sans-serif';
        ctx.fillStyle = '#eaecef';
        ctx.fillText(`Prom: ${s.avg.toFixed(2)}%  Med: ${s.median.toFixed(2)}%  Max: ${s.max.toFixed(2)}%`, bx + 8, yy);
        yy += 13;
        const top3 = s.pct.slice(0, 3).map(x => `≥${x.u}%: ${x.pct}%`).join('  ');
        ctx.fillStyle = '#848e9c';
        ctx.fillText(top3, bx + 8, yy);
        yy += 13;
      }
      pintarLado('LONG', sm.long, colorLong);
      if (sm.long && sm.short) yy += 3;
      pintarLado('SHORT', sm.short, colorShort);

      ctx.restore();
    }
  }

  window.INDICATORS.register({
    id: 'ma',
    name: 'MA — Media Móvil Simple',
    shortName: 'MA',
    type: 'overlay',
    defaultOn: false,
    params: [
      { key: 'len',        label: 'Longitud',          type: 'number', default: 99, min: 1, max: 1000, step: 1 },
      { key: 'color',      label: 'Color MA',          type: 'color',  default: '#FF6D00' },
      { key: 'colorLong',  label: 'Color señal long',  type: 'color',  default: '#26d994' },
      { key: 'colorShort', label: 'Color señal short', type: 'color',  default: '#ff5470' },
      { key: 'mostrarStats', label: 'Caja de estadísticas', type: 'select', default: 'on',
        options: [{ v: 'on', l: 'Mostrar' }, { v: 'off', l: 'Ocultar' }] },
    ],
    calc: calcMA,
    draw: drawMA,
  });

})();

/* ═══════════════════════════════════════════════════════════════════
   INDICADOR: Cruce MA Close/Open
   Dos medias móviles simples: una calculada sobre el CLOSE y otra
   sobre el OPEN de cada vela. La entrada ocurre cuando la MA de Close
   cruza a la MA de Open:
     MA-Close cruza HACIA ARRIBA de MA-Open  → señal LONG
     MA-Close cruza HACIA ABAJO de MA-Open   → señal SHORT
═══════════════════════════════════════════════════════════════════ */
(function () {

  function calcMACross(candles, p) {
    const closes = candles.map(c => c.c);
    const opens  = candles.map(c => c.o);
    const maClose = window.INDICATORS.math.sma(closes, p.lenClose);
    const maOpen  = window.INDICATORS.math.sma(opens,  p.lenOpen);

    const close = candles.map((c, i) => ({ t: c.t, v: maClose[i] }));
    const open  = candles.map((c, i) => ({ t: c.t, v: maOpen[i] }));

    // Señales: cruce entre las dos MAs (no precio contra una sola MA)
    const signals = [];
    for (let i = 1; i < candles.length; i++) {
      const pC = maClose[i - 1], pO = maOpen[i - 1];
      const cC = maClose[i],     cO = maOpen[i];
      if (pC == null || pO == null || cC == null || cO == null ||
          isNaN(pC) || isNaN(pO) || isNaN(cC) || isNaN(cO)) continue;

      const cruceArriba = pC <= pO && cC > cO; // MA-Close supera a MA-Open → long
      const cruceAbajo  = pC >= pO && cC < cO; // MA-Close cae bajo MA-Open → short

      if (cruceArriba) {
        signals.push({ idx: i, t: candles[i].t, side: 'long', price: candles[i].c });
      } else if (cruceAbajo) {
        signals.push({ idx: i, t: candles[i].t, side: 'short', price: candles[i].c });
      }
    }

    // Recorrido tras señal (igual criterio que en el indicador MA simple):
    // máximo movimiento a favor hasta la próxima señal (de cualquier lado).
    for (let k = 0; k < signals.length; k++) {
      const s = signals[k];
      const finIdx = (k + 1 < signals.length) ? signals[k + 1].idx : candles.length - 1;
      let extremo = s.side === 'long' ? -Infinity : Infinity;
      for (let j = s.idx; j <= finIdx; j++) {
        if (s.side === 'long') extremo = Math.max(extremo, candles[j].h);
        else extremo = Math.min(extremo, candles[j].l);
      }
      s.movePct = s.side === 'long'
        ? (extremo - s.price) / s.price * 100
        : (s.price - extremo) / s.price * 100;
    }

    function stats(side) {
      const arr = signals.filter(s => s.side === side).map(s => s.movePct).sort((a, b) => a - b);
      if (!arr.length) return null;
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const median = arr[Math.floor(arr.length / 2)];
      const max = arr[arr.length - 1];
      const pct = [0.5, 1, 2, 3, 5].map(u => ({
        u, pct: Math.round(arr.filter(v => v >= u).length / arr.length * 100)
      }));
      return { n: arr.length, avg, median, max, pct };
    }

    const summary = { long: stats('long'), short: stats('short') };

    return { lines: { close, open }, signals, summary };
  }

  function drawMACross(ctx, series, layout, p) {
    // Dibuja las dos líneas de MA (close/open) con el estilo por defecto,
    // usando los colores closeColor / openColor definidos en params.
    window.INDICATORS._defaultOverlayDraw(ctx, series, layout, p, {});

    const { barX, py, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    const lo = startIdx - 2, hi = endIdx + 2;
    const colorLong  = p.colorLong  || '#26d994';
    const colorShort = p.colorShort || '#ff5470';

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    (series.signals || []).forEach(s => {
      if (s.idx < lo || s.idx > hi) return;
      const x = barX(s.idx) + barW / 2;
      if (x < PADL - barW || x > W - PADR + barW) return;
      const y = py(s.price);
      const color = s.side === 'long' ? colorLong : colorShort;
      const dirY  = s.side === 'long' ? 1 : -1;

      ctx.fillStyle = color;
      ctx.beginPath();
      if (s.side === 'long') {
        ctx.moveTo(x - 5, y + 10); ctx.lineTo(x + 5, y + 10); ctx.lineTo(x, y + 2);
      } else {
        ctx.moveTo(x - 5, y - 10); ctx.lineTo(x + 5, y - 10); ctx.lineTo(x, y - 2);
      }
      ctx.closePath();
      ctx.fill();

      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(s.side === 'long' ? 'LONG' : 'SHORT', x, y + dirY * 20);

      if (s.movePct != null) {
        ctx.font = '8px sans-serif';
        ctx.fillText('+' + s.movePct.toFixed(2) + '%', x, y + dirY * 30);
      }
    });

    ctx.restore();

    const sm = series.summary;
    if (sm && (sm.long || sm.short) && p.mostrarStats !== 'off') {
      ctx.save();
      const boxW = 190;
      const lineasLong  = sm.long  ? 3 : 0;
      const lineasShort = sm.short ? 3 : 0;
      const boxH = 20 + (lineasLong + lineasShort) * 13 + (sm.long && sm.short ? 6 : 0);
      const bx = W - PADR - boxW - 6;
      const by = PADT + 6;

      ctx.fillStyle = 'rgba(11,14,17,0.88)';
      ctx.strokeStyle = '#2b2f36';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(bx, by, boxW, boxH);
      ctx.fill();
      ctx.stroke();

      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f0b90b';
      ctx.fillText('RECORRIDO TRAS CRUCE MA', bx + 8, by + 13);

      let yy = by + 28;
      function pintarLado(label, s, color) {
        if (!s) return;
        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(`${label}  (n=${s.n})`, bx + 8, yy);
        yy += 13;
        ctx.font = '9px sans-serif';
        ctx.fillStyle = '#eaecef';
        ctx.fillText(`Prom: ${s.avg.toFixed(2)}%  Med: ${s.median.toFixed(2)}%  Max: ${s.max.toFixed(2)}%`, bx + 8, yy);
        yy += 13;
        const top3 = s.pct.slice(0, 3).map(x => `≥${x.u}%: ${x.pct}%`).join('  ');
        ctx.fillStyle = '#848e9c';
        ctx.fillText(top3, bx + 8, yy);
        yy += 13;
      }
      pintarLado('LONG', sm.long, colorLong);
      if (sm.long && sm.short) yy += 3;
      pintarLado('SHORT', sm.short, colorShort);

      ctx.restore();
    }
  }

  window.INDICATORS.register({
    id: 'ma_cross',
    name: 'Cruce MA Close/Open',
    shortName: 'MA×2',
    type: 'overlay',
    defaultOn: false,
    params: [
      { key: 'lenClose',   label: 'Longitud MA (Close)', type: 'number', default: 21, min: 1, max: 1000, step: 1 },
      { key: 'lenOpen',    label: 'Longitud MA (Open)',  type: 'number', default: 21, min: 1, max: 1000, step: 1 },
      { key: 'closeColor', label: 'Color MA Close',      type: 'color',  default: '#00bcd4' },
      { key: 'openColor',  label: 'Color MA Open',       type: 'color',  default: '#e040fb' },
      { key: 'colorLong',  label: 'Color señal long',    type: 'color',  default: '#26d994' },
      { key: 'colorShort', label: 'Color señal short',   type: 'color',  default: '#ff5470' },
      { key: 'mostrarStats', label: 'Caja de estadísticas', type: 'select', default: 'on',
        options: [{ v: 'on', l: 'Mostrar' }, { v: 'off', l: 'Ocultar' }] },
    ],
    calc: calcMACross,
    draw: drawMACross,
  });

})();

/* ═══════════════════════════════════════════════════════════════════
   INDICADOR: CRUCE DE 2 MAs (ej: 99 y 1) — ambas sobre CLOSE
   Dos medias móviles simples sobre el cierre. Cuando la rápida (len2)
   cruza a la lenta (len1) se marca una señal:
     cruce hacia arriba → LONG
     cruce hacia abajo  → SHORT
═══════════════════════════════════════════════════════════════════ */
(function () {

  function calcMA99_1(candles, p) {
    const closes = candles.map(c => c.c);
    const maLenta  = window.INDICATORS.math.sma(closes, p.len1);
    const maRapida = window.INDICATORS.math.sma(closes, p.len2);
    const lenta  = candles.map((c, i) => ({ t: c.t, v: maLenta[i] }));
    const rapida = candles.map((c, i) => ({ t: c.t, v: maRapida[i] }));

    const signals = [];
    for (let i = 1; i < candles.length; i++) {
      const prevL = maLenta[i - 1], curL = maLenta[i];
      const prevR = maRapida[i - 1], curR = maRapida[i];
      if (prevL == null || curL == null || prevR == null || curR == null ||
          isNaN(prevL) || isNaN(curL) || isNaN(prevR) || isNaN(curR)) continue;

      const cruceArriba = prevR <= prevL && curR > curL; // rápida cruza por encima → long
      const cruceAbajo  = prevR >= prevL && curR < curL; // rápida cruza por debajo → short

      if (cruceArriba) {
        signals.push({ idx: i, t: candles[i].t, side: 'long', price: candles[i].c });
      } else if (cruceAbajo) {
        signals.push({ idx: i, t: candles[i].t, side: 'short', price: candles[i].c });
      }
    }

    return { lines: { lenta, rapida }, signals };
  }

  function drawMA99_1(ctx, series, layout, p) {
    window.INDICATORS._defaultOverlayDraw(ctx, series, layout, p, {
      _lineColors: { lenta: p.colorLenta, rapida: p.colorRapida },
    });

    const { barX, py, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    const lo = startIdx - 2, hi = endIdx + 2;
    const colorLong  = p.colorLong  || '#26d994';
    const colorShort = p.colorShort || '#ff5470';

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    (series.signals || []).forEach(s => {
      if (s.idx < lo || s.idx > hi) return;
      const x = barX(s.idx) + barW / 2;
      if (x < PADL - barW || x > W - PADR + barW) return;
      const y = py(s.price);
      const color = s.side === 'long' ? colorLong : colorShort;
      const dirY  = s.side === 'long' ? 1 : -1;

      ctx.fillStyle = color;
      ctx.beginPath();
      if (s.side === 'long') {
        ctx.moveTo(x - 5, y + 10); ctx.lineTo(x + 5, y + 10); ctx.lineTo(x, y + 2);
      } else {
        ctx.moveTo(x - 5, y - 10); ctx.lineTo(x + 5, y - 10); ctx.lineTo(x, y - 2);
      }
      ctx.closePath();
      ctx.fill();

      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(s.side === 'long' ? 'LONG' : 'SHORT', x, y + dirY * 20);
    });

    ctx.restore();
  }

  window.INDICATORS.register({
    id: 'macross',
    name: 'Cruce de MAs (99/1)',
    shortName: 'MA Cross',
    type: 'overlay',
    defaultOn: false,
    params: [
      { key: 'len1',        label: 'Longitud MA lenta',   type: 'number', default: 99, min: 1, max: 1000, step: 1 },
      { key: 'len2',        label: 'Longitud MA rápida',  type: 'number', default: 1,  min: 1, max: 1000, step: 1 },
      { key: 'colorLenta',  label: 'Color MA lenta',      type: 'color',  default: '#FF6D00' },
      { key: 'colorRapida', label: 'Color MA rápida',     type: 'color',  default: '#2196F3' },
      { key: 'colorLong',   label: 'Color señal long',    type: 'color',  default: '#26d994' },
      { key: 'colorShort',  label: 'Color señal short',   type: 'color',  default: '#ff5470' },
    ],
    calc: calcMA99_1,
    draw: drawMA99_1,
  });

})();

/* ═══════════════════════════════════════════════════════════════════
   INDICADOR: Pivot Fractal (Swing High/Low)
   Detecta un pivot high en la vela i si su máximo es el más alto entre
   [i-leftBars, i+rightBars]; pivot low si su mínimo es el más bajo del
   mismo rango. Es "confirmado" recién en i+rightBars (no repinta hacia
   atrás — mismo criterio de fractal-sin-look-ahead que usás en el
   backtester de estructura/CVD). Cada pivot dibuja una línea horizontal
   que se extiende hasta que el precio la rompe (o hasta el límite de
   velas configurado), sirviendo de referencia de estructura para BOS/CHoCH.
═══════════════════════════════════════════════════════════════════ */
(function () {

  function calcPivots(candles, p) {
    const left  = p.leftBars;
    const right = p.rightBars;
    const limitar  = p.limitarLinea === 'on';
    const maxVelas = p.maxVelas;
    const mostrarProv = p.mostrarProvisional !== 'off';
    const n = candles.length;
    const highs = [];
    const lows  = [];
    const provHighs = [];
    const provLows  = [];

    function tope(fromIdx) {
      return limitar ? Math.min(n - 1, fromIdx + maxVelas) : n - 1;
    }
    function buscarRoturaSup(precio, fromIdx) {
      const lim = tope(fromIdx);
      for (let j = fromIdx + 1; j <= lim; j++) {
        if (candles[j].h > precio) return j;
      }
      return lim;
    }
    function buscarRoturaInf(precio, fromIdx) {
      const lim = tope(fromIdx);
      for (let j = fromIdx + 1; j <= lim; j++) {
        if (candles[j].l < precio) return j;
      }
      return lim;
    }

    for (let i = left; i < n - right; i++) {
      const h = candles[i].h, l = candles[i].l;
      let isHigh = true, isLow = true;
      for (let j = i - left; j <= i + right; j++) {
        if (j === i) continue;
        if (candles[j].h > h) isHigh = false;
        if (candles[j].l < l) isLow = false;
        if (!isHigh && !isLow) break;
      }
      // Confirmación: recién existe una vez pasadas 'rightBars' velas (i+right)
      const confirmIdx = i + right;
      if (isHigh) {
        const endIdx = buscarRoturaSup(h, confirmIdx);
        highs.push({ idx: i, confirmIdx, t: candles[i].t, price: h, endIdx, roto: endIdx < n - 1 });
      }
      if (isLow) {
        const endIdx = buscarRoturaInf(l, confirmIdx);
        lows.push({ idx: i, confirmIdx, t: candles[i].t, price: l, endIdx, roto: endIdx < n - 1 });
      }
    }

    // ── Pivotes provisionales (sin confirmar aún) ──
    // Cubren las últimas 'rightBars' velas, que el algoritmo de arriba
    // todavía no puede confirmar. Se evalúan con lo que hay disponible
    // a la derecha (puede ser 0 velas en la vela más reciente = tiempo
    // real, sin esperar). Pueden cambiar o desaparecer cuando llegan
    // velas nuevas — por eso van marcados como tentativos, no como
    // estructura confirmada.
    if (mostrarProv) {
      const desde = Math.max(left, n - right);
      for (let i = desde; i < n; i++) {
        const h = candles[i].h, l = candles[i].l;
        let isHigh = true, isLow = true;
        const jFrom = Math.max(0, i - left);
        for (let j = jFrom; j < n; j++) {
          if (j === i) continue;
          if (candles[j].h > h) isHigh = false;
          if (candles[j].l < l) isLow = false;
          if (!isHigh && !isLow) break;
        }
        if (isHigh) provHighs.push({ idx: i, t: candles[i].t, price: h });
        if (isLow)  provLows.push({ idx: i, t: candles[i].t, price: l });
      }
    }

    return { highs, lows, provHighs, provLows };
  }

  function drawPivots(ctx, series, layout, p) {
    const { barX, py, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    if (!series) return;

    const colorHigh = p.colorHigh || '#ff5470';
    const colorLow  = p.colorLow  || '#26d994';
    const mostrarLbl = p.mostrarEtiquetas !== 'off';
    const lo = startIdx - 2, hi = endIdx + 2;
    const enRango = seg => seg.endIdx >= lo && seg.idx <= hi;

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    function drawLinea(seg, color) {
      const x1 = barX(seg.confirmIdx) + barW / 2;
      const x2 = barX(seg.endIdx) + barW / 2;
      const y  = py(seg.price);
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash(seg.roto ? [] : [3, 3]);
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    (series.highs || []).filter(enRango).forEach(seg => drawLinea(seg, colorHigh));
    (series.lows  || []).filter(enRango).forEach(seg => drawLinea(seg, colorLow));

    ctx.restore();

    // Marcadores triangulares en el pivot original
    function drawMarcador(seg, esHigh) {
      if (seg.idx < lo || seg.idx > hi) return;
      const x = barX(seg.idx) + barW / 2;
      if (x < PADL - barW || x > W - PADR + barW) return;
      const y = py(seg.price);
      const color = esHigh ? colorHigh : colorLow;

      ctx.fillStyle = color;
      ctx.beginPath();
      if (esHigh) {
        ctx.moveTo(x - 4, y - 9); ctx.lineTo(x + 4, y - 9); ctx.lineTo(x, y - 3);
      } else {
        ctx.moveTo(x - 4, y + 9); ctx.lineTo(x + 4, y + 9); ctx.lineTo(x, y + 3);
      }
      ctx.closePath();
      ctx.fill();

      if (mostrarLbl) {
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(window.INDICATORS.fmtPrice(seg.price), x, y + (esHigh ? -13 : 20));
      }
    }

    (series.highs || []).forEach(seg => drawMarcador(seg, true));
    (series.lows  || []).forEach(seg => drawMarcador(seg, false));

    // Marcadores provisionales (huecos, sin línea) — pueden cambiar
    function drawMarcadorProv(seg, esHigh) {
      if (seg.idx < lo || seg.idx > hi) return;
      const x = barX(seg.idx) + barW / 2;
      if (x < PADL - barW || x > W - PADR + barW) return;
      const y = py(seg.price);
      const color = esHigh ? colorHigh : colorLow;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      if (esHigh) {
        ctx.moveTo(x - 4, y - 9); ctx.lineTo(x + 4, y - 9); ctx.lineTo(x, y - 3); ctx.closePath();
      } else {
        ctx.moveTo(x - 4, y + 9); ctx.lineTo(x + 4, y + 9); ctx.lineTo(x, y + 3); ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();

      if (mostrarLbl) {
        ctx.font = 'italic 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillText('~' + window.INDICATORS.fmtPrice(seg.price), x, y + (esHigh ? -13 : 20));
        ctx.globalAlpha = 1;
      }
    }

    (series.provHighs || []).forEach(seg => drawMarcadorProv(seg, true));
    (series.provLows  || []).forEach(seg => drawMarcadorProv(seg, false));
  }

  window.INDICATORS.register({
    id: 'pivot_fractal',
    name: 'Pivot Fractal (Swing High/Low)',
    shortName: 'Pivots',
    type: 'overlay',
    defaultOn: false,
    params: [
      { key: 'leftBars',        label: 'Velas izquierda',       type: 'number', default: 5, min: 1, max: 50, step: 1 },
      { key: 'rightBars',       label: 'Velas derecha (confirmación)', type: 'number', default: 5, min: 1, max: 50, step: 1 },
      { key: 'limitarLinea',    label: 'Limitar largo de línea', type: 'select', default: 'off',
        options: [{ v: 'off', l: 'Sin límite (hasta romper)' }, { v: 'on', l: 'Limitado' }] },
      { key: 'maxVelas',        label: 'Máx. velas si limitado', type: 'number', default: 200, min: 1, max: 2000, step: 1 },
      { key: 'mostrarEtiquetas', label: 'Mostrar precio',       type: 'select', default: 'on',
        options: [{ v: 'on', l: 'Mostrar' }, { v: 'off', l: 'Ocultar' }] },
      { key: 'mostrarProvisional', label: 'Pivote provisional (sin lag)', type: 'select', default: 'on',
        options: [{ v: 'on', l: 'Mostrar (tentativo, puede cambiar)' }, { v: 'off', l: 'Solo confirmados' }] },
      { key: 'colorHigh', label: 'Color pivot high (resistencia)', type: 'color', default: '#ff5470' },
      { key: 'colorLow',  label: 'Color pivot low (soporte)',      type: 'color', default: '#26d994' },
    ],
    calc: calcPivots,
    draw: drawPivots,
  });

})();

/* ═══════════════════════════════════════════════════════════════════
   INDICADOR: Pivot Points Diario (multi-método)
   Usa H/L/C (y O para DeMark) del día anterior. El corte de "día" es
   configurable (horaInicio/minInicio + utcOffset), por defecto 00:00 UTC
   pero se puede mover a cualquier hora (ej: open de Nueva York). Métodos
   disponibles vía param 'metodo':
     - classic:   PP=(H+L+C)/3, R1=2PP-L/S1=2PP-H, R2=PP±(H-L), R3=H+2(PP-L)/L-2(H-PP)
     - fibonacci: PP=(H+L+C)/3, R/S en 0.382/0.618/1.0 × (H-L)
     - camarilla: PP=C, R1-R4/S1-S4 = C ± (H-L)·1.1/{12,6,4,2}
     - woodie:    PP=(H+L+2C)/4, R1=2PP-L/S1=2PP-H, R2=PP±(H-L)
     - demark:    X según C vs O, PP=X/4, R1=X/2-L, S1=X/2-H
   Cada nivel se dibuja como segmento horizontal fijo durante todo el
   día siguiente (no se mueve intra-día, es el pivot clásico de piso).
═══════════════════════════════════════════════════════════════════ */
(function () {

  const DAY_MS = 86400000;

  // ── Fórmulas de cada método. Reciben H,L,C del día anterior y O del
  //    día anterior (para DeMark). Devuelven un objeto con los niveles
  //    que aplique cada método (no todos tienen R2/R3/R4). ──
  const METODOS = {
    classic: (H, L, C, O) => {
      const PP = (H + L + C) / 3;
      return {
        pp: PP,
        r1: 2 * PP - L,       s1: 2 * PP - H,
        r2: PP + (H - L),     s2: PP - (H - L),
        r3: H + 2 * (PP - L), s3: L - 2 * (H - PP),
      };
    },
    fibonacci: (H, L, C, O) => {
      const PP = (H + L + C) / 3;
      const range = H - L;
      return {
        pp: PP,
        r1: PP + 0.382 * range, s1: PP - 0.382 * range,
        r2: PP + 0.618 * range, s2: PP - 0.618 * range,
        r3: PP + 1.000 * range, s3: PP - 1.000 * range,
      };
    },
    camarilla: (H, L, C, O) => {
      const range = H - L;
      return {
        pp: C,
        r1: C + range * 1.1 / 12, s1: C - range * 1.1 / 12,
        r2: C + range * 1.1 / 6,  s2: C - range * 1.1 / 6,
        r3: C + range * 1.1 / 4,  s3: C - range * 1.1 / 4,
        r4: C + range * 1.1 / 2,  s4: C - range * 1.1 / 2,
      };
    },
    woodie: (H, L, C, O) => {
      const PP = (H + L + 2 * C) / 4;
      return {
        pp: PP,
        r1: 2 * PP - L,   s1: 2 * PP - H,
        r2: PP + (H - L), s2: PP - (H - L),
      };
    },
    demark: (H, L, C, O) => {
      let X;
      if (C < O)      X = H + 2 * L + C;
      else if (C > O) X = 2 * H + L + C;
      else            X = H + L + 2 * C;
      const PP = X / 4;
      return {
        pp: PP,
        r1: X / 2 - L,
        s1: X / 2 - H,
      };
    },
  };

  function calcPivotDaily(candles, p) {
    const n = candles.length;
    if (!n) return { segs: {} };
    const metodo  = METODOS[p.metodo] ? p.metodo : 'classic';
    const formula = METODOS[metodo];
    const showR2 = p.mostrarR2S2 !== 'off';
    const showR3 = p.mostrarR3S3 === 'on';

    // Corte de sesión configurable: en vez de fijo a 00:00 UTC, arranca
    // el "día" a la hora/minuto que definas, ajustado por utcOffset
    // (ej: horaInicio=6, utcOffset=-6 → sesión arranca 06:00 Tegucigalpa).
    const horaInicio = p.horaInicio ?? 0;
    const minInicio  = p.minInicio ?? 0;
    const utcOffset  = p.utcOffset ?? 0;
    const startOffsetMs = (horaInicio * 60 + minInicio) * 60000 - utcOffset * 3600000;
    const dayOf = t => Math.floor((t - startOffsetMs) / DAY_MS);

    // Detectar inicio de cada día (según el corte configurado) dentro de las velas cargadas
    const dayStarts = [];
    let curDay = null;
    for (let i = 0; i < n; i++) {
      const d = dayOf(candles[i].t);
      if (d !== curDay) { dayStarts.push({ day: d, startIdx: i }); curDay = d; }
    }
    for (let k = 0; k < dayStarts.length; k++) {
      dayStarts[k].endIdx = (k + 1 < dayStarts.length) ? dayStarts[k + 1].startIdx - 1 : n - 1;
    }
    // O/H/L/C agregados de cada día (para calcular el pivot del día SIGUIENTE)
    dayStarts.forEach(ds => {
      let h = -Infinity, l = Infinity;
      for (let i = ds.startIdx; i <= ds.endIdx; i++) {
        if (candles[i].h > h) h = candles[i].h;
        if (candles[i].l < l) l = candles[i].l;
      }
      ds.h = h; ds.l = l; ds.o = candles[ds.startIdx].o; ds.c = candles[ds.endIdx].c;
    });

    const segs = { pp: [], r1: [], s1: [], r2: [], s2: [], r3: [], s3: [], r4: [], s4: [] };
    const push = (arr, price, startIdx, endIdx) => arr.push({ startIdx, endIdx, price });

    for (let k = 1; k < dayStarts.length; k++) {
      const prev = dayStarts[k - 1];
      const cur  = dayStarts[k];
      const H = prev.h, L = prev.l, C = prev.c, O = prev.o;
      if (!isFinite(H) || !isFinite(L)) continue;

      const lv = formula(H, L, C, O);

      push(segs.pp, lv.pp, cur.startIdx, cur.endIdx);
      if (lv.r1 !== undefined) push(segs.r1, lv.r1, cur.startIdx, cur.endIdx);
      if (lv.s1 !== undefined) push(segs.s1, lv.s1, cur.startIdx, cur.endIdx);
      if (showR2 && lv.r2 !== undefined) { push(segs.r2, lv.r2, cur.startIdx, cur.endIdx); push(segs.s2, lv.s2, cur.startIdx, cur.endIdx); }
      if (showR3 && lv.r3 !== undefined) { push(segs.r3, lv.r3, cur.startIdx, cur.endIdx); push(segs.s3, lv.s3, cur.startIdx, cur.endIdx); }
      if (showR3 && lv.r4 !== undefined) { push(segs.r4, lv.r4, cur.startIdx, cur.endIdx); push(segs.s4, lv.s4, cur.startIdx, cur.endIdx); }
    }

    return { segs };
  }

  function drawPivotDaily(ctx, series, layout, p) {
    const { barX, py, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    if (!series || !series.segs) return;
    const lo = startIdx - 2, hi = endIdx + 2;

    const colorPP = p.colorPP || '#f0b90b';
    const colorR  = p.colorR  || '#ff5470';
    const colorS  = p.colorS  || '#26d994';
    const styles = {
      pp: { color: colorPP, label: 'PP' },
      r1: { color: colorR,  label: 'R1' }, r2: { color: colorR, label: 'R2' }, r3: { color: colorR, label: 'R3' }, r4: { color: colorR, label: 'R4' },
      s1: { color: colorS,  label: 'S1' }, s2: { color: colorS, label: 'S2' }, s3: { color: colorS, label: 'S3' }, s4: { color: colorS, label: 'S4' },
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    Object.entries(series.segs).forEach(([key, arr]) => {
      const st = styles[key];
      arr.forEach(seg => {
        if (seg.endIdx < lo || seg.startIdx > hi) return;
        const x1 = barX(Math.max(seg.startIdx, lo));
        const x2 = barX(Math.min(seg.endIdx, hi)) + barW;
        const y  = py(seg.price);
        ctx.beginPath();
        ctx.strokeStyle = st.color;
        ctx.lineWidth = key === 'pp' ? 1.4 : 1;
        ctx.setLineDash(key === 'pp' ? [] : [5, 3]);
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    });

    ctx.restore();

    Object.entries(series.segs).forEach(([key, arr]) => {
      const st = styles[key];
      arr.forEach(seg => {
        if (seg.endIdx < lo || seg.startIdx > hi) return;
        const xLbl = barX(Math.max(seg.startIdx, lo)) + 3;
        const y = py(seg.price);
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = st.color;
        ctx.fillText(`${st.label} ${window.INDICATORS.fmtPrice(seg.price)}`, xLbl, y - 3);
      });
    });
  }

  window.INDICATORS.register({
    id: 'pivot_daily',
    name: 'Pivot Points Diario (multi-método)',
    shortName: 'Pivot D',
    type: 'overlay',
    defaultOn: false,
    params: [
      { key: 'metodo', label: 'Método', type: 'select', default: 'classic',
        options: [
          { v: 'classic',   l: 'Clásico (Floor Trader)' },
          { v: 'fibonacci', l: 'Fibonacci' },
          { v: 'camarilla', l: 'Camarilla' },
          { v: 'woodie',    l: 'Woodie' },
          { v: 'demark',    l: 'DeMark' },
        ] },
      { key: 'horaInicio', label: 'Hora de inicio de sesión', type: 'number', default: 0, min: 0, max: 23 },
      { key: 'minInicio',  label: 'Minuto de inicio de sesión', type: 'number', default: 0, min: 0, max: 59 },
      { key: 'utcOffset',  label: 'Ajuste UTC (ej: -6 Tegucigalpa)', type: 'number', default: -6, min: -12, max: 14 },
      { key: 'mostrarR2S2', label: 'Mostrar R2/S2', type: 'select', default: 'on',
        options: [{ v: 'on', l: 'Mostrar' }, { v: 'off', l: 'Ocultar' }] },
      { key: 'mostrarR3S3', label: 'Mostrar R3/S3 (o R4/S4 en Camarilla)', type: 'select', default: 'on',
        options: [{ v: 'on', l: 'Mostrar' }, { v: 'off', l: 'Ocultar' }] },
      { key: 'colorPP', label: 'Color Pivot (PP)',           type: 'color', default: '#f0b90b' },
      { key: 'colorR',  label: 'Color resistencias',         type: 'color', default: '#ff5470' },
      { key: 'colorS',  label: 'Color soportes',             type: 'color', default: '#26d994' },
    ],
    calc: calcPivotDaily,
    draw: drawPivotDaily,
  });

})();

/* ═══════════════════════════════════════════════════════════════════
   ORB — Opening Range Breakout (una vela)
   Puerto del indicador Pine Script "ORB UNA VELA (AracGroupHN)".

   Cada día (en tu hora local, ajustada por "Ajuste UTC"), busca la
   primera vela cuyo horario sea >= a la Hora/Minuto/Segundo de inicio
   configurada. De esa vela toma:
     - High/Low  → el máximo y mínimo de la vela
     - Open/Close → el máximo y mínimo entre apertura y cierre
   Esos dos niveles se dibujan como líneas horizontales desde esa vela
   hasta justo antes de la vela ancla del día siguiente (igual que
   pivot_daily con sus niveles).
═══════════════════════════════════════════════════════════════════ */
(function () {

  const DAY_MS_ORB = 86400000;

  function calcORB(candles, p) {
    const n = candles.length;
    if (!n) return { segs: {} };

    const horaInicio = p.horaInicio ?? 6;
    const minInicio  = p.minInicio  ?? 0;
    const segInicio  = p.segInicio  ?? 0;
    const utcOffset  = p.utcOffset  ?? -6; // horas, ej -6 Tegucigalpa
    const tipoOrb    = p.tipoOrb || 'highlow';

    const targetSecOfDay = horaInicio * 3600 + minInicio * 60 + segInicio;
    const offsetMs = utcOffset * 3600000;

    // ¿Estamos en modo Sesión? app.js marca sessionKey='normal' para
    // temporalidades fijas (15m, 1h, 1D, etc.) y el key real de la sesión
    // (london/tokyo/newyork/sydney/nomarket/..._solap) cuando el modo es "Sesión".
    const esModoSesion = !!(candles[0].sessionKey && candles[0].sessionKey !== 'normal');

    const anchors = [];

    if (!esModoSesion) {
      // Temporalidades fijas: cada vela dura lo mismo, así que basta con
      // encontrar la primera vela de cada día local cuyo INICIO ya alcanzó
      // la hora objetivo (igual que el Pine original).
      let lastDay = null;
      for (let idx = 0; idx < n; idx++) {
        const localT   = candles[idx].t + offsetMs;
        const dayIdx   = Math.floor(localT / DAY_MS_ORB);
        const secOfDay = Math.floor((localT - dayIdx * DAY_MS_ORB) / 1000);
        if (dayIdx !== lastDay && secOfDay >= targetSecOfDay) {
          anchors.push(idx);
          lastDay = dayIdx;
        }
      }
    } else {
      // Modo Sesión: cada vela YA ES una sesión completa (Sydney/Tokio/
      // Londres/New York/Sin mercado), así que en vez de calcular por hora
      // simplemente agarramos la primera vela de cada día local cuya sesión
      // coincida con la elegida en "Sesión a usar".
      const sesionObjetivo = p.sesionObjetivo || 'london';
      const NOMBRES_SESION = { sydney: 'Sydney', tokyo: 'Tokio', london: 'Londres', newyork: 'New York', nomarket: 'Sin mercado' };
      const nombreObjetivo = NOMBRES_SESION[sesionObjetivo] || sesionObjetivo;

      const esFallback = c => {
        if (!c.sessionKey) return false;
        if (c.sessionKey.startsWith(sesionObjetivo + '_solap')) return true;
        if (c.sessionName && c.sessionName.includes(nombreObjetivo)) return true;
        return false;
      };

      // Por día: preferimos SIEMPRE el tramo puro de la sesión (sessionKey
      // exacto, sin '_solap'). Solo si ese día no existe tramo puro (ej. la
      // sesión completa quedó cubierta por un solape) usamos el de solape
      // como respaldo, para no perder el día entero.
      const anchorExacto  = new Map(); // dayIdx → idx
      const anchorSolape  = new Map(); // dayIdx → idx

      for (let idx = 0; idx < n; idx++) {
        const c = candles[idx];
        if (!c.sessionKey) continue;
        const localT = c.t + offsetMs;
        const dayIdx = Math.floor(localT / DAY_MS_ORB);

        if (c.sessionKey === sesionObjetivo) {
          if (!anchorExacto.has(dayIdx)) anchorExacto.set(dayIdx, idx);
        } else if (esFallback(c)) {
          if (!anchorSolape.has(dayIdx)) anchorSolape.set(dayIdx, idx);
        }
      }

      const dias = new Set([...anchorExacto.keys(), ...anchorSolape.keys()]);
      [...dias].sort((a, b) => a - b).forEach(d => {
        anchors.push(anchorExacto.has(d) ? anchorExacto.get(d) : anchorSolape.get(d));
      });
    }
    if (!anchors.length) return { segs: {} };

    const segs = { high: [], low: [] };
    const signals = [];
    for (let k = 0; k < anchors.length; k++) {
      const idx    = anchors[k];
      const endIdx = (k + 1 < anchors.length) ? anchors[k + 1] - 1 : n - 1;
      const c = candles[idx];

      let hi, lo;
      if (tipoOrb === 'openclose') {
        hi = Math.max(c.o, c.c);
        lo = Math.min(c.o, c.c);
      } else {
        hi = c.h;
        lo = c.l;
      }

      segs.high.push({ startIdx: idx, endIdx, price: hi });
      segs.low.push({ startIdx: idx, endIdx, price: lo });

      // Señal: vela siguiente al ancla, según su precio de APERTURA
      // (no su high/low ni cierre) comparado contra las líneas ORB de este día.
      const nextIdx = idx + 1;
      if (nextIdx < n) {
        const c2 = candles[nextIdx];
        const openNext = c2.o;
        let tipo = null;
        if (openNext > hi) tipo = 'long';
        else if (openNext < lo) tipo = 'short';
        if (tipo) {
          const lineaRota = tipo === 'long' ? hi : lo;
          signals.push({
            idx: nextIdx,
            tipo,
            price: openNext,
            t: c2.t, o: c2.o, h: c2.h, l: c2.l, c: c2.c,
            sessionLabel: esModoSesion ? (c.sessionName || null) : null,
            lineaRota,
            distanciaPct: Math.abs(openNext - lineaRota) / lineaRota * 100,
          });
        }
      }
    }

    return { segs, signals };
  }

  function drawORB(ctx, series, layout, p) {
    const { barX, py, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    if (!series || !series.segs) return;
    const lo = startIdx - 2, hi = endIdx + 2;

    const colorHigh = p.colorHigh || '#26d994';
    const colorLow  = p.colorLow  || '#ff5470';
    const esOpenClose = p.tipoOrb === 'openclose';
    const styles = {
      high: { color: colorHigh, label: esOpenClose ? 'ORB Open' : 'ORB High' },
      low:  { color: colorLow,  label: esOpenClose ? 'ORB Close' : 'ORB Low'  },
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    Object.entries(series.segs).forEach(([key, arr]) => {
      const st = styles[key];
      arr.forEach(seg => {
        if (seg.endIdx < lo || seg.startIdx > hi) return;
        const x1 = barX(Math.max(seg.startIdx, lo));
        const x2 = barX(Math.min(seg.endIdx, hi)) + barW;
        const y  = py(seg.price);
        ctx.beginPath();
        ctx.strokeStyle = st.color;
        ctx.lineWidth = 1.6;
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
      });
    });

    ctx.restore();

    Object.entries(series.segs).forEach(([key, arr]) => {
      const st = styles[key];
      arr.forEach(seg => {
        if (seg.endIdx < lo || seg.startIdx > hi) return;
        const xLbl = barX(Math.max(seg.startIdx, lo)) + 3;
        const y = py(seg.price);
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = st.color;
        ctx.fillText(`${st.label} ${window.INDICATORS.fmtPrice(seg.price)}`, xLbl, y - 3);
      });
    });

    // Señales LONG/SHORT (vela siguiente al ancla, según su open)
    if (series.signals && series.signals.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
      ctx.clip();
      series.signals.forEach(sig => {
        if (sig.idx < lo || sig.idx > hi) return;
        const x = barX(sig.idx) + barW / 2;
        const y = py(sig.price);
        const esLong = sig.tipo === 'long';
        const color = esLong ? (p.colorHigh || '#26d994') : (p.colorLow || '#ff5470');
        const texto = esLong ? '▲ LONG' : '▼ SHORT';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(texto, x, esLong ? y - 8 : y + 14);
      });
      ctx.restore();
    }
  }

  window.INDICATORS.register({
    id: 'orb',
    name: 'ORB — Opening Range Breakout (una vela)',
    shortName: 'ORB',
    type: 'overlay',
    defaultOn: false,
    params: [
      { key: 'horaInicio', label: 'Hora de inicio',   type: 'number', default: 6, min: 0, max: 23 },
      { key: 'minInicio',  label: 'Minuto de inicio',  type: 'number', default: 0, min: 0, max: 59 },
      { key: 'segInicio',  label: 'Segundo de inicio', type: 'number', default: 0, min: 0, max: 59 },
      { key: 'utcOffset',  label: 'Ajuste UTC (ej: -6 Tegucigalpa)', type: 'number', default: -6, min: -12, max: 14 },
      { key: 'sesionObjetivo', label: 'Sesión a usar (solo modo Sesión)', type: 'select', default: 'tokyo',
        options: (candles) => {
          // Lista estática de respaldo (modo no-sesión o sin velas todavía)
          const FALLBACK = [
            { v: 'sydney',   l: 'Sydney' },
            { v: 'tokyo',    l: 'Tokio' },
            { v: 'london',   l: 'Londres' },
            { v: 'newyork',  l: 'New York' },
            { v: 'nomarket', l: 'Sin mercado' },
          ];
          if (!candles || !candles.length || !candles[0].sessionKey || candles[0].sessionKey === 'normal') {
            return FALLBACK;
          }
          // Modo Sesión: recorremos las velas reales y sacamos TODOS los
          // sessionKey presentes, incluyendo los de solape (ej. "newyork_solap"
          // = Londres/New York), que antes no aparecían en esta lista.
          const seen = new Map();
          candles.forEach(c => {
            if (!c.sessionKey) return;
            if (!seen.has(c.sessionKey)) {
              const label = c.isSolape ? `⚡ ${c.sessionName} (solape)` : c.sessionName;
              seen.set(c.sessionKey, label);
            }
          });
          if (!seen.size) return FALLBACK;
          // Orden: sesiones puras primero, solapes después, alfabético dentro de cada grupo.
          return [...seen.entries()]
            .sort((a, b) => {
              const aSolap = a[0].endsWith('_solap'), bSolap = b[0].endsWith('_solap');
              if (aSolap !== bSolap) return aSolap ? 1 : -1;
              return a[1].localeCompare(b[1]);
            })
            .map(([v, l]) => ({ v, l }));
        } },
      { key: 'tipoOrb', label: 'Tipo de ORB', type: 'select', default: 'openclose',
        options: [
          { v: 'highlow',   l: 'High/Low' },
          { v: 'openclose', l: 'Open/Close' },
        ] },
      { key: 'colorHigh', label: 'Color ORB High', type: 'color', default: '#26d994' },
      { key: 'colorLow',  label: 'Color ORB Low',  type: 'color', default: '#ff5470' },
    ],
    calc: calcORB,
    draw: drawORB,
  });

  /* ═══════════════════════════════════════════════════════════════════
     PANEL — pestaña con la lista de señales ORB detectadas
     Igual estilo/estructura que el panel de Solapamiento: botón propio
     en la topbar que abre un modal con tabla, capital/comisión
     simulados, totales y exportación a CSV.
  ═══════════════════════════════════════════════════════════════════ */

  const ORB_DISPLAY_OFFSET = -6; // UTC-6 (Tegucigalpa), igual que el resto de la app
  const ORB_CALC_KEY = 'vm_orb_calc_v1';
  let orbCapital = 1000;
  let orbFeePct  = 0.20;
  let orbRangeMonths = null; // null = "Todo". 1, 3, 6, 9, 12 = meses hacia atrás desde la señal más reciente
  (function loadOrbCalcSettings() {
    try {
      const raw = localStorage.getItem(ORB_CALC_KEY);
      if (!raw) return;
      const st = JSON.parse(raw);
      if (Number.isFinite(st.capital) && st.capital >= 0) orbCapital = st.capital;
      if (Number.isFinite(st.feePct)  && st.feePct  >= 0) orbFeePct  = st.feePct;
      if (st.rangeMonths === null || Number.isFinite(st.rangeMonths)) orbRangeMonths = st.rangeMonths;
    } catch (e) {}
  })();
  function saveOrbCalcSettings() {
    try {
      localStorage.setItem(ORB_CALC_KEY, JSON.stringify({ capital: orbCapital, feePct: orbFeePct, rangeMonths: orbRangeMonths }));
    } catch (e) {}
  }

  function orbMonthsAgoTs(ts, n) {
    const d = new Date(ts);
    d.setUTCMonth(d.getUTCMonth() - n);
    return d.getTime();
  }

  function orbTsToLocal(ts) {
    return new Date(ts + ORB_DISPLAY_OFFSET * 3600000);
  }
  function orbFmtFechaHora(ts) {
    const d = orbTsToLocal(ts);
    const mo = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getUTCMonth()];
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}, ${hh}:${mm}`;
  }

  function injectOrbPanelStyles() {
    if (document.getElementById('orb-panel-style')) return;
    const style = document.createElement('style');
    style.id = 'orb-panel-style';
    style.textContent = `
      #orb-modal-overlay {
        display: none; position: fixed; inset: 0; z-index: 1000;
        background: rgba(0,0,0,0.82); align-items: center; justify-content: center;
      }
      #orb-modal-overlay.open { display: flex; }
      #orb-modal {
        background: #161a1e; border: 1px solid #2b2f36; border-radius: 12px;
        padding: 26px 30px; width: 1400px; max-width: 98vw; max-height: 92vh;
        overflow: auto; box-shadow: 0 16px 64px rgba(0,0,0,0.9);
        font-family: inherit;
      }
      #orb-table-wrap { overflow-x: auto; }
      #orb-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
      #orb-modal h2 { color: #f0b90b; font-size: 15px; font-weight: 700; letter-spacing: .5px; margin: 0; }
      #orb-modal-close {
        background: none; border: none; color: #848e9c; font-size: 20px;
        cursor: pointer; line-height: 1; padding: 0 4px;
      }
      #orb-modal-close:hover { color: #eaecef; }
      .orb-calc-wrap { display: inline-flex; align-items: center; gap: 4px; }
      .orb-calc-wrap label { font-size: 10px; color: #848e9c; white-space: nowrap; }
      #orb-capital-input, #orb-fee-input {
        background: #1e2329; border: 1px solid #2b2f36; color: #eaecef;
        border-radius: 5px; font-size: 11px; padding: 4px 6px; outline: none;
      }
      #orb-capital-input { width: 62px; }
      #orb-fee-input { width: 50px; }
      #orb-capital-input:hover, #orb-capital-input:focus,
      #orb-fee-input:hover, #orb-fee-input:focus { border-color: #f0b90b; }
      .orb-fee-cell { color: #ff5470 !important; background: #ff547014; font-weight: 600; }
      #orb-table th.orb-fee-cell { color: #ff5470 !important; background: #ff547022; }
      #orb-table tfoot td {
        padding: 8px; border-top: 2px solid #2b2f36; font-weight: 700;
        background: #1a1e24; position: sticky; bottom: 0;
      }
      #orb-totals-bar {
        background: #0b0e11; border: 1px solid #2b2f36; border-radius: 8px;
        padding: 10px 16px; margin-bottom: 12px;
      }
      #orb-totals-row {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 12px; font-weight: 700; font-family: monospace;
      }
      #orb-totals-label { color: #eaecef; white-space: nowrap; }
      .orb-totals-vals { display: flex; align-items: center; gap: 26px; }
      .orb-totals-vals .orb-fee-cell { padding: 2px 8px; border-radius: 4px; }
      #orb-stats-row {
        display: flex; flex-wrap: wrap; gap: 18px; align-items: center;
        margin-top: 8px; padding-top: 8px; border-top: 1px solid #2b2f36;
        font-size: 12px;
      }
      .orb-stat-group { display: flex; align-items: center; gap: 8px; }
      .orb-stat-label { color: #848e9c; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
      .orb-stat { color: #eaecef; font-weight: 600; }
      .orb-stat-win  { color: #26d994; }
      .orb-stat-loss { color: #ff5470; }
      #orb-table { width: 100%; min-width: 980px; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
      #orb-table th {
        text-align: left; color: #848e9c; font-weight: 600; font-size: 10px;
        text-transform: uppercase; letter-spacing: .4px;
        padding: 6px 8px; border-bottom: 1px solid #2b2f36; position: sticky; top: 0; background: #161a1e;
      }
      #orb-table td { padding: 7px 8px; border-bottom: 1px solid #2b2f3644; color: #eaecef; }
      #orb-table tr:hover td { background: #1a1e24; }
      #orb-empty { color: #848e9c; font-size: 12px; padding: 20px 0; text-align: center; }
      #orb-range-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
      #orb-range-bar .orb-range-label { color: #848e9c; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; margin-right: 2px; }
      .orb-range-btn {
        background: #1e2329; border: 1px solid #2b2f36; color: #eaecef;
        border-radius: 5px; font-size: 11px; padding: 5px 10px; cursor: pointer;
      }
      .orb-range-btn:hover { border-color: #f0b90b; }
      .orb-range-btn.active { background: #f0b90b22; border-color: #f0b90b; color: #f0b90b; font-weight: 700; }
      .orb-range-note { color: #6b7280; font-size: 10px; margin-left: 4px; }
    `;
    document.head.appendChild(style);
  }

  function buildOrbModal() {
    if (document.getElementById('orb-modal-overlay')) return;
    injectOrbPanelStyles();
    const overlay = document.createElement('div');
    overlay.id = 'orb-modal-overlay';
    overlay.innerHTML = `
      <div id="orb-modal">
        <div id="orb-modal-header">
          <h2>📋 Señales ORB detectadas</h2>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div class="orb-calc-wrap" title="Capital y comisión usados para calcular la ganancia simulada de cada fila">
              <label for="orb-capital-input">Capital $</label>
              <input type="number" id="orb-capital-input" value="1000" min="0" step="1" />
              <label for="orb-fee-input">Fee %</label>
              <input type="number" id="orb-fee-input" value="0.20" min="0" step="0.01" />
            </div>
            <button id="orb-export-btn" class="tf-btn" type="button">📤 Exportar a Excel</button>
            <button id="orb-modal-close">✕</button>
          </div>
        </div>
        <div id="orb-range-bar" title="Filtra la lista tomando como punto de partida la señal más reciente"></div>
        <div id="orb-table-wrap"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOrbModal(); });
    document.getElementById('orb-modal-close').addEventListener('click', closeOrbModal);
    document.getElementById('orb-export-btn').addEventListener('click', exportOrbCsv);

    const capInput = document.getElementById('orb-capital-input');
    const feeInput = document.getElementById('orb-fee-input');
    capInput.value = orbCapital;
    feeInput.value = orbFeePct;
    capInput.addEventListener('input', () => {
      const v = parseFloat(capInput.value);
      orbCapital = Number.isFinite(v) && v >= 0 ? v : 0;
      saveOrbCalcSettings();
      renderOrbTable();
    });
    feeInput.addEventListener('input', () => {
      const v = parseFloat(feeInput.value);
      orbFeePct = Number.isFinite(v) && v >= 0 ? v : 0;
      saveOrbCalcSettings();
      renderOrbTable();
    });
  }

  function openOrbModal() {
    buildOrbModal();
    renderOrbTable();
    document.getElementById('orb-modal-overlay').classList.add('open');
  }

  function closeOrbModal() {
    const overlay = document.getElementById('orb-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  let _lastOrbRows = []; // filas ya formateadas, usadas también para exportar

  const ORB_RANGE_OPTIONS = [
    { key: '1',    label: '1 mes',   months: 1  },
    { key: '3',    label: '3 meses', months: 3  },
    { key: '6',    label: '6 meses', months: 6  },
    { key: '9',    label: '9 meses', months: 9  },
    { key: '12',   label: '1 año',   months: 12 },
    { key: 'todo', label: 'Todo',    months: null },
  ];

  // Dibuja la barra de botones de rango y devuelve las señales ya filtradas
  // según la opción activa, tomando como punto de partida la señal más
  // reciente detectada — no la fecha de hoy.
  function renderOrbRangeBarAndFilter(signals) {
    const bar = document.getElementById('orb-range-bar');
    if (!signals.length) {
      if (bar) bar.innerHTML = '';
      return signals;
    }

    const mostRecentTs = signals.reduce((max, s) => Math.max(max, s.t), -Infinity);

    let filtered = signals;
    if (orbRangeMonths !== null && Number.isFinite(mostRecentTs)) {
      const cutoff = orbMonthsAgoTs(mostRecentTs, orbRangeMonths);
      filtered = signals.filter(s => s.t >= cutoff);
    }

    if (bar) {
      const btns = ORB_RANGE_OPTIONS.map(opt => {
        const isActive = (opt.months === null && orbRangeMonths === null) || (opt.months === orbRangeMonths);
        return `<button type="button" class="orb-range-btn${isActive ? ' active' : ''}" data-range="${opt.key}">${opt.label}</button>`;
      }).join('');
      bar.innerHTML = `<span class="orb-range-label">📅 Rango (desde la más reciente):</span>${btns}
        <span class="orb-range-note">${filtered.length} de ${signals.length} señales</span>`;

      bar.querySelectorAll('.orb-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const opt = ORB_RANGE_OPTIONS.find(o => o.key === btn.dataset.range);
          orbRangeMonths = opt.months;
          saveOrbCalcSettings();
          renderOrbTable();
        });
      });
    }

    return filtered;
  }

  function renderOrbTable() {
    const wrap = document.getElementById('orb-table-wrap');
    const state = window.INDICATORS.getActive().find(x => x.def.id === 'orb');
    const allSignals = (state && state.series && state.series.signals) || [];
    const signals = renderOrbRangeBarAndFilter(allSignals);

    if (!signals.length) {
      _lastOrbRows = [];
      wrap.innerHTML = '<div id="orb-empty">No hay señales ORB detectadas. Activa el indicador en el gráfico.</div>';
      return;
    }

    const fp = window.INDICATORS.fmtPrice;
    const commission = orbCapital * (orbFeePct / 100);

    // Numeración cronológica (el más antiguo es #1), mostrado más reciente arriba.
    _lastOrbRows = signals.map((sig, i) => {
      const isLong = sig.tipo === 'long';
      const pnlClose = isLong
        ? (sig.c - sig.o) / sig.o * orbCapital
        : (sig.o - sig.c) / sig.o * orbCapital;
      const pnlExt = isLong
        ? (sig.h - sig.o) / sig.o * orbCapital
        : (sig.o - sig.l) / sig.o * orbCapital;
      const extLabel = isLong ? 'Open→High' : 'Open→Low';
      const extPct = isLong
        ? (sig.h - sig.o) / sig.o * 100
        : (sig.o - sig.l) / sig.o * 100;
      return {
        num: i + 1,
        fecha: orbFmtFechaHora(sig.t),
        sesion: sig.sessionLabel || '—',
        side: isLong ? 'LONG' : 'SHORT',
        distanciaPct: sig.distanciaPct,
        extLabel,
        extPct,
        pnlClose,
        pnlExt,
        comision: commission,
        netClose: pnlClose - commission,
        netExt: pnlExt - commission,
        o: sig.o, h: sig.h, l: sig.l, c: sig.c,
      };
    }).reverse();

    const rows = _lastOrbRows.map(r => {
      const dirColor = r.side === 'LONG' ? '#26d994' : '#ff5470';
      const pnlCloseColor = r.pnlClose >= 0 ? '#26d994' : '#ff5470';
      const pnlExtColor   = r.pnlExt   >= 0 ? '#26d994' : '#ff5470';
      const netCloseColor = r.netClose >= 0 ? '#26d994' : '#ff5470';
      const netExtColor   = r.netExt   >= 0 ? '#26d994' : '#ff5470';
      return `
        <tr>
          <td>${r.num}</td>
          <td>${r.fecha}</td>
          <td>${r.sesion}</td>
          <td style="color:${dirColor}">${r.side === 'LONG' ? '▲ LONG' : '▼ SHORT'}</td>
          <td>${r.distanciaPct.toFixed(2)}%</td>
          <td>${fp(r.o)}</td>
          <td>${fp(r.h)}</td>
          <td>${fp(r.l)}</td>
          <td>${fp(r.c)}</td>
          <td>${r.extLabel}: ${r.extPct.toFixed(2)}%</td>
          <td style="color:${pnlCloseColor}">${r.pnlClose >= 0 ? '+' : ''}${r.pnlClose.toFixed(2)} USDT</td>
          <td style="color:${pnlExtColor}">${r.pnlExt >= 0 ? '+' : ''}${r.pnlExt.toFixed(2)} USDT</td>
          <td class="orb-fee-cell">-${r.comision.toFixed(2)} USDT</td>
          <td style="color:${netCloseColor}">${r.netClose >= 0 ? '+' : ''}${r.netClose.toFixed(2)} USDT</td>
          <td style="color:${netExtColor}">${r.netExt >= 0 ? '+' : ''}${r.netExt.toFixed(2)} USDT</td>
        </tr>
      `;
    }).join('');

    // ── Resumen: ganadoras/perdedoras (según neto) y sumatoria de cada columna ──
    const n = _lastOrbRows.length;
    let winClose = 0, lossClose = 0, winExt = 0, lossExt = 0;
    let sumPnlClose = 0, sumPnlExt = 0, sumComision = 0, sumNetClose = 0, sumNetExt = 0;
    let sumLossClose = 0, sumLossExt = 0;
    _lastOrbRows.forEach(r => {
      if (r.netClose > 0) winClose++; else lossClose++;
      if (r.netExt   > 0) winExt++;   else lossExt++;
      sumPnlClose += r.pnlClose;
      sumPnlExt   += r.pnlExt;
      sumComision += r.comision;
      sumNetClose += r.netClose;
      sumNetExt   += r.netExt;
      if (r.netClose < 0) sumLossClose += r.netClose;
      if (r.netExt   < 0) sumLossExt   += r.netExt;
    });
    const winRateClose = n ? (winClose / n * 100) : 0;
    const winRateExt   = n ? (winExt   / n * 100) : 0;
    const sumPnlCloseColor = sumPnlClose >= 0 ? '#26d994' : '#ff5470';
    const sumPnlExtColor   = sumPnlExt   >= 0 ? '#26d994' : '#ff5470';
    const sumNetCloseColor = sumNetClose >= 0 ? '#26d994' : '#ff5470';
    const sumNetExtColor   = sumNetExt   >= 0 ? '#26d994' : '#ff5470';

    const totalsBarHtml = `
      <div id="orb-totals-bar">
        <div id="orb-totals-row">
          <span id="orb-totals-label">TOTAL (${n} señales)</span>
          <span class="orb-totals-vals">
            <span style="color:${sumPnlCloseColor}">${sumPnlClose >= 0 ? '+' : ''}${sumPnlClose.toFixed(2)} USDT</span>
            <span style="color:${sumPnlExtColor}">${sumPnlExt >= 0 ? '+' : ''}${sumPnlExt.toFixed(2)} USDT</span>
            <span class="orb-fee-cell">-${sumComision.toFixed(2)} USDT</span>
            <span style="color:${sumNetCloseColor}">${sumNetClose >= 0 ? '+' : ''}${sumNetClose.toFixed(2)} USDT</span>
            <span style="color:${sumNetExtColor}">${sumNetExt >= 0 ? '+' : ''}${sumNetExt.toFixed(2)} USDT</span>
          </span>
        </div>
        <div id="orb-stats-row">
          <div class="orb-stat-group">
            <span class="orb-stat-label">Cierre (O→C):</span>
            <span class="orb-stat orb-stat-win">✅ ${winClose} ganadoras</span>
            <span class="orb-stat orb-stat-loss">❌ ${lossClose} perdedoras</span>
            <span class="orb-stat">Win rate: ${winRateClose.toFixed(1)}%</span>
            <span class="orb-stat orb-stat-loss">Suma pérdidas: ${sumLossClose.toFixed(2)} USDT</span>
          </div>
          <div class="orb-stat-group">
            <span class="orb-stat-label">Extremo (O→L/H):</span>
            <span class="orb-stat orb-stat-win">✅ ${winExt} ganadoras</span>
            <span class="orb-stat orb-stat-loss">❌ ${lossExt} perdedoras</span>
            <span class="orb-stat">Win rate: ${winRateExt.toFixed(1)}%</span>
            <span class="orb-stat orb-stat-loss">Suma pérdidas: ${sumLossExt.toFixed(2)} USDT</span>
          </div>
        </div>
      </div>
    `;

    wrap.innerHTML = `
      ${totalsBarHtml}
      <table id="orb-table">
        <thead>
          <tr>
            <th>#</th><th>Fecha/Hora</th><th>Sesión</th><th>Señal</th><th>Distancia a línea</th>
            <th>Open</th><th>High</th><th>Low</th><th>Close</th><th>% Open→Ext</th>
            <th title="Ganancia bruta con ${orbCapital} USDT de capital">Bruta O→C</th>
            <th title="Ganancia bruta con ${orbCapital} USDT de capital">Bruta O→L/H</th>
            <th class="orb-fee-cell" title="Comisión de entrar + salir (${orbFeePct.toFixed(2)}% sobre ${orbCapital} USDT)">Comisión</th>
            <th title="Ganancia neta = bruta − comisión">Neto O→C</th>
            <th title="Ganancia neta = bruta − comisión">Neto O→L/H</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="10">TOTAL (${n} señales · ✅ ${winClose} / ❌ ${lossClose})</td>
            <td style="color:${sumPnlCloseColor}">${sumPnlClose >= 0 ? '+' : ''}${sumPnlClose.toFixed(2)} USDT</td>
            <td style="color:${sumPnlExtColor}">${sumPnlExt >= 0 ? '+' : ''}${sumPnlExt.toFixed(2)} USDT</td>
            <td class="orb-fee-cell">-${sumComision.toFixed(2)} USDT</td>
            <td style="color:${sumNetCloseColor}">${sumNetClose >= 0 ? '+' : ''}${sumNetClose.toFixed(2)} USDT</td>
            <td style="color:${sumNetExtColor}">${sumNetExt >= 0 ? '+' : ''}${sumNetExt.toFixed(2)} USDT</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  function exportOrbCsv() {
    if (!_lastOrbRows.length) return;
    const headers = ['#', 'Fecha/Hora', 'Sesión', 'Señal', 'Distancia a línea (%)', 'Open', 'High', 'Low', 'Close', 'Open→Ext',
      `Gan. bruta Open→Close (${orbCapital} USDT)`, `Gan. bruta Open→Low/High (${orbCapital} USDT)`,
      `Comisión (${orbFeePct.toFixed(2)}%)`, 'Neto Open→Close', 'Neto Open→Low/High'];
    const fp = window.INDICATORS.fmtPrice;
    const lines = [headers.join(';')];
    _lastOrbRows.forEach(r => {
      lines.push([
        r.num, r.fecha, r.sesion, r.side,
        r.distanciaPct.toFixed(2) + '%',
        fp(r.o), fp(r.h), fp(r.l), fp(r.c),
        r.extLabel + ': ' + r.extPct.toFixed(2) + '%',
        r.pnlClose.toFixed(2) + ' USDT',
        r.pnlExt.toFixed(2) + ' USDT',
        '-' + r.comision.toFixed(2) + ' USDT',
        r.netClose.toFixed(2) + ' USDT',
        r.netExt.toFixed(2) + ' USDT',
      ].join(';'));
    });

    const n = _lastOrbRows.length;
    let winClose = 0, lossClose = 0, winExt = 0, lossExt = 0;
    let sumPnlClose = 0, sumPnlExt = 0, sumComision = 0, sumNetClose = 0, sumNetExt = 0;
    let sumLossClose = 0, sumLossExt = 0;
    _lastOrbRows.forEach(r => {
      if (r.netClose > 0) winClose++; else lossClose++;
      if (r.netExt   > 0) winExt++;   else lossExt++;
      sumPnlClose += r.pnlClose;
      sumPnlExt   += r.pnlExt;
      sumComision += r.comision;
      sumNetClose += r.netClose;
      sumNetExt   += r.netExt;
      if (r.netClose < 0) sumLossClose += r.netClose;
      if (r.netExt   < 0) sumLossExt   += r.netExt;
    });
    lines.push('');
    lines.push([`TOTAL (${n} señales)`, '', '', '', '', '', '', '', '', '',
      sumPnlClose.toFixed(2) + ' USDT', sumPnlExt.toFixed(2) + ' USDT',
      '-' + sumComision.toFixed(2) + ' USDT',
      sumNetClose.toFixed(2) + ' USDT', sumNetExt.toFixed(2) + ' USDT'].join(';'));
    lines.push([`Ganadoras O→C: ${winClose}`, `Perdedoras O→C: ${lossClose}`, `Suma pérdidas O→C: ${sumLossClose.toFixed(2)} USDT`].join(';'));
    lines.push([`Ganadoras O→L/H: ${winExt}`, `Perdedoras O→L/H: ${lossExt}`, `Suma pérdidas O→L/H: ${sumLossExt.toFixed(2)} USDT`].join(';'));

    const csv = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'orb_senales.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function addOrbPanelButton() {
    if (document.getElementById('orb-list-btn')) return;
    const host = document.querySelector('.topbar-right-group') || document.querySelector('.topbar');
    if (!host) return;
    const btn = document.createElement('button');
    btn.className = 'tf-btn';
    btn.id = 'orb-list-btn';
    btn.type = 'button';
    btn.title = 'Ver lista de señales ORB detectadas';
    btn.textContent = '📋 ORB';
    btn.addEventListener('click', openOrbModal);
    host.appendChild(btn);
  }

  addOrbPanelButton();

})();
