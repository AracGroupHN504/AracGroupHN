'use strict';
/* ═══════════════════════════════════════════════════════════════════
   INDICADOR: Solapamiento — Hueco Cierre/Apertura
   ─────────────────────────────────────────────
   Detecta, entre cada dos velas consecutivas, si el cierre de la
   vela anterior y la apertura de la vela siguiente NO coinciden.
   Ese espacio (hueco de precio sin solapamiento de cuerpos) se
   dibuja como una caja rectangular fija sobre el gráfico:

     - Si el precio saltó hacia ABAJO (open siguiente < close anterior)
       → caja ROJA.
     - Si el precio saltó hacia ARRIBA (open siguiente > close anterior)
       → caja VERDE.

   Las cajas quedan fijas para siempre en el gráfico, se rellene o
   no el hueco más adelante con el precio.
═══════════════════════════════════════════════════════════════════ */
(function () {

  function hexToRgbaLocal(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Resta un rango de cuerpo [blo,bhi] de una lista de segmentos [lo,hi],
  // devolviendo los trozos que quedan fuera de ese cuerpo.
  function subtractBody(segments, body) {
    const [blo, bhi] = body;
    const result = [];
    segments.forEach(([lo, hi]) => {
      if (bhi <= lo || blo >= hi) { result.push([lo, hi]); return; } // sin solape
      if (blo > lo) result.push([lo, blo]);
      if (bhi < hi) result.push([bhi, hi]);
    });
    return result;
  }

  function calcSolapamiento(candles, p) {
    const minGapPct = p.minGapPct || 0;
    const gaps = [];

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const cur  = candles[i];
      const prevClose = prev.c;
      const curOpen   = cur.o;
      if (curOpen === prevClose) continue;

      const gapPct = Math.abs(curOpen - prevClose) / prevClose * 100;
      if (gapPct < minGapPct) continue;

      const up = curOpen > prevClose; // hueco hacia arriba
      const rawLow  = Math.min(curOpen, prevClose);
      const rawHigh = Math.max(curOpen, prevClose);

      // Cuerpos reales de ambas velas (no solo su close/open)
      const prevBody = [Math.min(prev.o, prev.c), Math.max(prev.o, prev.c)];
      const curBody  = [Math.min(cur.o,  cur.c),  Math.max(cur.o,  cur.c)];

      // Recorta el hueco: si una parte ya está dentro del cuerpo de la
      // vela anterior o de la siguiente, no cuenta como hueco real.
      let segments = [[rawLow, rawHigh]];
      segments = subtractBody(segments, prevBody);
      segments = subtractBody(segments, curBody);

      segments.forEach(([lo, hi]) => {
        if (hi - lo <= 0) return;
        gaps.push({
          idx1: i - 1,
          idx2: i,
          top: hi,
          bottom: lo,
          gapPct,
          up,
        });
      });
    }

    return { gaps };
  }

  function drawSolapamiento(ctx, series, layout, p) {
    if (!series || !series.gaps || !series.gaps.length) return;
    const { barX, py, barW, PADL, PADR, W, PADT, chartH, startIdx, endIdx } = layout;
    const lo = startIdx - 2, hi = endIdx + 2;

    const colorArriba = p.colorArriba || '#9c6cff';
    const colorAbajo  = p.colorAbajo  || '#ffa94d';
    const alpha       = (p.opacidad ?? 22) / 100;
    const conBorde    = p.mostrarBorde !== 'off';
    const conEtiqueta = p.mostrarPct === 'on';

    ctx.save();
    ctx.beginPath();
    ctx.rect(PADL, PADT, W - PADL - PADR, chartH);
    ctx.clip();

    series.gaps.forEach(g => {
      if (g.idx2 < lo || g.idx1 > hi) return;
      const x1 = barX(g.idx1) + barW / 2;
      const x2 = barX(g.idx2) + barW / 2;
      if (x2 < PADL - barW || x1 > W - PADR + barW) return;

      const yTop = py(g.top);
      const yBot = py(g.bottom);
      const h    = Math.max(1, yBot - yTop);
      const color = g.up ? colorArriba : colorAbajo;

      ctx.fillStyle = hexToRgbaLocal(color, alpha);
      ctx.fillRect(x1, yTop, x2 - x1, h);

      if (conBorde) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x1 + 0.5, yTop + 0.5, Math.max(0, x2 - x1 - 1), Math.max(0, h - 1));
      }

      if (conEtiqueta) {
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.fillText(g.gapPct.toFixed(2) + '%', (x1 + x2) / 2, yTop - 4);
      }
    });

    ctx.restore();
  }

  window.INDICATORS.register({
    id: 'solapamiento',
    name: 'Solapamiento — Hueco Cierre/Apertura',
    shortName: 'Solapamiento',
    type: 'overlay',
    defaultOn: false,
    params: [
      { key: 'minGapPct',   label: 'Hueco mínimo (%)',       type: 'number', default: 0,  min: 0, max: 5, step: 0.01 },
      { key: 'colorArriba', label: 'Color hueco hacia arriba', type: 'color', default: '#9c6cff' },
      { key: 'colorAbajo',  label: 'Color hueco hacia abajo',  type: 'color', default: '#ffa94d' },
      { key: 'opacidad',    label: 'Opacidad relleno (%)',    type: 'number', default: 22, min: 0, max: 100, step: 1 },
      { key: 'mostrarBorde', label: 'Borde de la caja', type: 'select', default: 'on',
        options: [{ v: 'on', l: 'Mostrar' }, { v: 'off', l: 'Ocultar' }] },
      { key: 'mostrarPct',  label: 'Mostrar % del hueco', type: 'select', default: 'off',
        options: [{ v: 'off', l: 'Ocultar' }, { v: 'on', l: 'Mostrar' }] },
    ],
    calc: calcSolapamiento,
    draw: drawSolapamiento,
  });

})();
