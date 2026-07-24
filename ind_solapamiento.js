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

  let _lastCandles = null;

  // ── Capital y comisión para la simulación de ganancia por fila ──
  // solapeCapital: monto en USDT usado como base de la operación simulada.
  // solapeFeePct : comisión TOTAL de ida y vuelta (entrar + salir), en %.
  //   Binance Futures cobra ~0.10% al entrar y ~0.10% al salir → 0.20% por defecto.
  const SOLAPE_CALC_KEY = 'vm_solape_calc_v1';
  let solapeCapital = 1000;
  let solapeFeePct  = 0.20;
  (function loadCalcSettings() {
    try {
      const raw = localStorage.getItem(SOLAPE_CALC_KEY);
      if (!raw) return;
      const st = JSON.parse(raw);
      if (Number.isFinite(st.capital) && st.capital >= 0) solapeCapital = st.capital;
      if (Number.isFinite(st.feePct)  && st.feePct  >= 0) solapeFeePct  = st.feePct;
    } catch (e) {}
  })();
  function saveCalcSettings() {
    try {
      localStorage.setItem(SOLAPE_CALC_KEY, JSON.stringify({ capital: solapeCapital, feePct: solapeFeePct }));
    } catch (e) {}
  }

  function calcSolapamiento(candles, p) {
    _lastCandles = candles;
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

      // % de cuerpo de la vela siguiente (cur), calculado solo sobre esa
      // vela — no se compara contra el tamaño del hueco.
      const bodyPct = Math.abs(cur.c - cur.o) / cur.o * 100;

      // % de la vela siguiente, según dirección del hueco:
      // - Hueco hacia ABAJO (color amarillo/naranja) → % Open→Low
      // - Hueco hacia ARRIBA (color morado)           → % Open→High
      const openToLowPct  = (cur.o - cur.l) / cur.o * 100;
      const openToHighPct = (cur.h - cur.o) / cur.o * 100;
      const extPct   = up ? openToHighPct : openToLowPct;
      const extLabel = up ? 'Open→High' : 'Open→Low';

      // Simulación de operación de 1000 USDT siguiendo la dirección del hueco:
      // - Hueco ARRIBA (morado)  → se asume LONG: compra en open, vende en close/high
      // - Hueco ABAJO (amarillo) → se asume SHORT: vende en open, compra en close/low
      const CAPITAL = 1000;
      const pnlClose = up
        ? (cur.c - cur.o) / cur.o * CAPITAL
        : (cur.o - cur.c) / cur.o * CAPITAL;
      const pnlExt = up
        ? (cur.h - cur.o) / cur.o * CAPITAL
        : (cur.o - cur.l) / cur.o * CAPITAL;

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
          bodyPct,
          extPct,
          extLabel,
          pnlClose,
          pnlExt,
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
    const conBodyPct  = p.mostrarBodyPct === 'on';
    const conExtPct   = p.mostrarExtPct === 'on';

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
        ctx.fillText('Hueco: ' + g.gapPct.toFixed(2) + '%', (x1 + x2) / 2, yTop - 4);
      }

      if (conBodyPct) {
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        const yLabel = conEtiqueta ? yTop - 15 : yTop - 4;
        ctx.fillText('Cuerpo vela: ' + g.bodyPct.toFixed(2) + '%', (x1 + x2) / 2, yLabel);
      }

      if (conExtPct) {
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        let yLabel2 = yTop - 4;
        if (conEtiqueta) yLabel2 -= 11;
        if (conBodyPct)  yLabel2 -= 11;
        ctx.fillText(g.extLabel + ': ' + g.extPct.toFixed(2) + '%', (x1 + x2) / 2, yLabel2);
      }
    });

    ctx.restore();
  }

  window.INDICATORS.register({
    id: 'solapamiento',
    name: 'Solapamiento — Hueco Cierre/Apertura',
    shortName: 'Solapamiento',
    type: 'overlay',
    defaultOn: true,
    params: [
      { key: 'minGapPct',   label: 'Hueco mínimo (%)',       type: 'number', default: 0,  min: 0, max: 5, step: 0.01 },
      { key: 'colorArriba', label: 'Color hueco hacia arriba', type: 'color', default: '#00ff00' },
      { key: 'colorAbajo',  label: 'Color hueco hacia abajo',  type: 'color', default: '#ff0000' },
      { key: 'opacidad',    label: 'Opacidad relleno (%)',    type: 'number', default: 55, min: 0, max: 100, step: 1 },
      { key: 'mostrarBorde', label: 'Borde de la caja', type: 'select', default: 'on',
        options: [{ v: 'on', l: 'Mostrar' }, { v: 'off', l: 'Ocultar' }] },
      { key: 'mostrarPct',  label: 'Mostrar % del hueco', type: 'select', default: 'on',
        options: [{ v: 'off', l: 'Ocultar' }, { v: 'on', l: 'Mostrar' }] },
      { key: 'mostrarBodyPct', label: '% cuerpo de la vela', type: 'select', default: 'on',
        options: [{ v: 'off', l: 'Ocultar' }, { v: 'on', l: 'Mostrar' }] },
      { key: 'mostrarExtPct', label: '% Open→Low/High', type: 'select', default: 'on',
        options: [{ v: 'off', l: 'Ocultar' }, { v: 'on', l: 'Mostrar' }] },
    ],
    calc: calcSolapamiento,
    draw: drawSolapamiento,
  });

  /* ═══════════════════════════════════════════════════════════════════
     PANEL — pestaña con la lista de solapamientos detectados
     Botón propio en la topbar que abre un modal con una tabla:
     Fecha/hora de la vela, dirección, % del hueco y % de cuerpo de vela.
  ═══════════════════════════════════════════════════════════════════ */

  const DISPLAY_OFFSET = -6; // UTC-6 (Tegucigalpa), igual que el resto de la app

  function tsToLocalLocal(ts) {
    return new Date(ts + DISPLAY_OFFSET * 3600000);
  }

  function fmtFechaHoraLocal(ts) {
    const d = tsToLocalLocal(ts);
    const mo = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getUTCMonth()];
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}, ${hh}:${mm}`;
  }

  function injectPanelStyles() {
    if (document.getElementById('solape-panel-style')) return;
    const style = document.createElement('style');
    style.id = 'solape-panel-style';
    style.textContent = `
      #solape-modal-overlay {
        display: none; position: fixed; inset: 0; z-index: 1000;
        background: rgba(0,0,0,0.82); align-items: center; justify-content: center;
      }
      #solape-modal-overlay.open { display: flex; }
      #solape-modal {
        background: #161a1e; border: 1px solid #2b2f36; border-radius: 12px;
        padding: 26px 30px; width: 1560px; max-width: 98vw; max-height: 92vh;
        overflow: auto; box-shadow: 0 16px 64px rgba(0,0,0,0.9);
        font-family: inherit;
      }
      #solape-table-wrap { overflow-x: auto; }
      #solape-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      #solape-modal h2 { color: #f0b90b; font-size: 15px; font-weight: 700; letter-spacing: .5px; margin: 0; }
      #solape-modal-close {
        background: none; border: none; color: #848e9c; font-size: 20px;
        cursor: pointer; line-height: 1; padding: 0 4px;
      }
      #solape-modal-close:hover { color: #eaecef; }
      .solape-calc-wrap { display: inline-flex; align-items: center; gap: 4px; }
      .solape-calc-wrap label { font-size: 10px; color: #848e9c; white-space: nowrap; }
      #solape-capital-input, #solape-fee-input {
        background: #1e2329; border: 1px solid #2b2f36; color: #eaecef;
        border-radius: 5px; font-size: 11px; padding: 4px 6px; outline: none;
      }
      #solape-capital-input { width: 62px; }
      #solape-fee-input { width: 50px; }
      #solape-capital-input:hover, #solape-capital-input:focus,
      #solape-fee-input:hover, #solape-fee-input:focus { border-color: #f0b90b; }
      .solape-fee-cell { color: #ff5470 !important; background: #ff547014; font-weight: 600; }
      #solape-table th.solape-fee-cell { color: #ff5470 !important; background: #ff547022; }
      .solape-stat-group { display: flex; align-items: center; gap: 8px; }
      .solape-stat-label { color: #848e9c; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
      .solape-stat { color: #eaecef; font-weight: 600; }
      .solape-stat-win  { color: #26d994; }
      .solape-stat-loss { color: #ff5470; }
      #solape-table tfoot td {
        padding: 8px; border-top: 2px solid #2b2f36; font-weight: 700;
        background: #1a1e24; position: sticky; bottom: 0;
      }
      #solape-totals-bar {
        background: #0b0e11; border: 1px solid #2b2f36; border-radius: 8px;
        padding: 10px 16px; margin-bottom: 12px;
      }
      #solape-totals-row {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 12px; font-weight: 700; font-family: monospace;
      }
      #solape-totals-label { color: #eaecef; white-space: nowrap; }
      .solape-totals-vals { display: flex; align-items: center; gap: 26px; }
      .solape-totals-vals .solape-fee-cell { padding: 2px 8px; border-radius: 4px; }
      #solape-stats-row {
        display: flex; flex-wrap: wrap; gap: 18px; align-items: center;
        margin-top: 8px; padding-top: 8px; border-top: 1px solid #2b2f36;
        font-size: 12px;
      }
      #solape-table { width: 100%; min-width: 1080px; border-collapse: collapse; font-size: 12px; white-space: nowrap; }
      #solape-table th {
        text-align: left; color: #848e9c; font-weight: 600; font-size: 10px;
        text-transform: uppercase; letter-spacing: .4px;
        padding: 6px 8px; border-bottom: 1px solid #2b2f36; position: sticky; top: 0; background: #161a1e;
      }
      #solape-table td { padding: 7px 8px; border-bottom: 1px solid #2b2f3644; color: #eaecef; }
      #solape-table tr:hover td { background: #1a1e24; }
      #solape-empty { color: #848e9c; font-size: 12px; padding: 20px 0; text-align: center; }
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    if (document.getElementById('solape-modal-overlay')) return;
    injectPanelStyles();
    const overlay = document.createElement('div');
    overlay.id = 'solape-modal-overlay';
    overlay.innerHTML = `
      <div id="solape-modal">
        <div id="solape-modal-header">
          <h2>📋 Solapamientos detectados</h2>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="solape-calc-wrap" title="Capital y comisión usados para calcular la ganancia simulada de cada fila">
              <label for="solape-capital-input">Capital $</label>
              <input type="number" id="solape-capital-input" value="1000" min="0" step="1" />
              <label for="solape-fee-input">Fee %</label>
              <input type="number" id="solape-fee-input" value="0.20" min="0" step="0.01" />
            </div>
            <button id="solape-export-btn" class="tf-btn" type="button">📤 Exportar a Excel</button>
            <button id="solape-modal-close">✕</button>
          </div>
        </div>
        <div id="solape-table-wrap"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById('solape-modal-close').addEventListener('click', closeModal);
    document.getElementById('solape-export-btn').addEventListener('click', exportCsv);

    const capInput = document.getElementById('solape-capital-input');
    const feeInput = document.getElementById('solape-fee-input');
    capInput.value = solapeCapital;
    feeInput.value = solapeFeePct;
    capInput.addEventListener('input', () => {
      const v = parseFloat(capInput.value);
      solapeCapital = Number.isFinite(v) && v >= 0 ? v : 0;
      saveCalcSettings();
      renderTable();
    });
    feeInput.addEventListener('input', () => {
      const v = parseFloat(feeInput.value);
      solapeFeePct = Number.isFinite(v) && v >= 0 ? v : 0;
      saveCalcSettings();
      renderTable();
    });
  }

  function openModal() {
    buildModal();
    renderTable();
    document.getElementById('solape-modal-overlay').classList.add('open');
  }

  function closeModal() {
    const overlay = document.getElementById('solape-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  let _lastRows = []; // filas ya formateadas, usadas también para exportar

  function renderTable() {
    const wrap = document.getElementById('solape-table-wrap');
    const state = window.INDICATORS.getActive().find(x => x.def.id === 'solapamiento');
    const gaps = (state && state.series && state.series.gaps) || [];

    if (!gaps.length) {
      _lastRows = [];
      wrap.innerHTML = '<div id="solape-empty">No hay solapamientos detectados. Activa el indicador en el gráfico.</div>';
      return;
    }

    const fp = window.INDICATORS.fmtPrice;
    const commission = solapeCapital * (solapeFeePct / 100);

    // Numeración cronológica (el más antiguo es #1), se muestra en orden
    // inverso (más reciente arriba) pero cada fila conserva su número real.
    _lastRows = gaps.map((g, i) => {
      const cur = _lastCandles ? _lastCandles[g.idx2] : null;
      // PnL bruto recalculado con el capital seleccionado (no el de calcSolapamiento,
      // que quedó fijo en 1000 para el dibujo del gráfico).
      const pnlClose = g.up
        ? (cur.c - cur.o) / cur.o * solapeCapital
        : (cur.o - cur.c) / cur.o * solapeCapital;
      const pnlExt = g.up
        ? (cur.h - cur.o) / cur.o * solapeCapital
        : (cur.o - cur.l) / cur.o * solapeCapital;
      return {
        num: i + 1,
        fecha: cur ? fmtFechaHoraLocal(cur.t) : '—',
        sesion: cur && cur.sessionName ? cur.sessionName : '—',
        dir: g.up ? 'Arriba' : 'Abajo',
        gapPct: g.gapPct,
        bodyPct: g.bodyPct,
        extLabel: g.extLabel,
        extPct: g.extPct,
        pnlClose,
        pnlExt,
        comision: commission,
        netClose: pnlClose - commission,
        netExt: pnlExt - commission,
        o: cur ? cur.o : null,
        h: cur ? cur.h : null,
        l: cur ? cur.l : null,
        c: cur ? cur.c : null,
      };
    }).reverse();

    const rows = _lastRows.map(r => {
      const dirColor = r.dir === 'Arriba' ? '#9c6cff' : '#ffa94d';
      const pnlCloseColor = r.pnlClose >= 0 ? '#26d994' : '#ff5470';
      const pnlExtColor   = r.pnlExt   >= 0 ? '#26d994' : '#ff5470';
      const netCloseColor = r.netClose >= 0 ? '#26d994' : '#ff5470';
      const netExtColor   = r.netExt   >= 0 ? '#26d994' : '#ff5470';
      return `
        <tr>
          <td>${r.num}</td>
          <td>${r.fecha}</td>
          <td>${r.sesion}</td>
          <td style="color:${dirColor}">${r.dir === 'Arriba' ? '▲ LONG' : '▼ SHORT'}</td>
          <td>${r.gapPct.toFixed(2)}%</td>
          <td>${r.bodyPct.toFixed(2)}%</td>
          <td>${r.extLabel}: ${r.extPct.toFixed(2)}%</td>
          <td>${fp(r.o)}</td>
          <td>${fp(r.h)}</td>
          <td>${fp(r.l)}</td>
          <td>${fp(r.c)}</td>
          <td style="color:${pnlCloseColor}">${r.pnlClose >= 0 ? '+' : ''}${r.pnlClose.toFixed(2)} USDT</td>
          <td style="color:${pnlExtColor}">${r.pnlExt >= 0 ? '+' : ''}${r.pnlExt.toFixed(2)} USDT</td>
          <td class="solape-fee-cell">-${r.comision.toFixed(2)} USDT</td>
          <td style="color:${netCloseColor}">${r.netClose >= 0 ? '+' : ''}${r.netClose.toFixed(2)} USDT</td>
          <td style="color:${netExtColor}">${r.netExt >= 0 ? '+' : ''}${r.netExt.toFixed(2)} USDT</td>
        </tr>
      `;
    }).join('');

    // ── Resumen: operaciones ganadoras/perdedoras y sumatoria de cada columna ──
    // El resultado ganador/perdedor se cuenta sobre el PnL NETO (ya con comisión
    // descontada), que es lo que realmente importa para saber si conviene o no.
    const n = _lastRows.length;
    let winClose = 0, lossClose = 0, winExt = 0, lossExt = 0;
    let sumPnlClose = 0, sumPnlExt = 0, sumComision = 0, sumNetClose = 0, sumNetExt = 0;
    _lastRows.forEach(r => {
      if (r.netClose > 0) winClose++; else lossClose++;
      if (r.netExt   > 0) winExt++;   else lossExt++;
      sumPnlClose += r.pnlClose;
      sumPnlExt   += r.pnlExt;
      sumComision += r.comision;
      sumNetClose += r.netClose;
      sumNetExt   += r.netExt;
    });
    const winRateClose = n ? (winClose / n * 100) : 0;
    const winRateExt   = n ? (winExt   / n * 100) : 0;
    const sumPnlCloseColor = sumPnlClose >= 0 ? '#26d994' : '#ff5470';
    const sumPnlExtColor   = sumPnlExt   >= 0 ? '#26d994' : '#ff5470';
    const sumNetCloseColor = sumNetClose >= 0 ? '#26d994' : '#ff5470';
    const sumNetExtColor   = sumNetExt   >= 0 ? '#26d994' : '#ff5470';

    const totalsBarHtml = `
      <div id="solape-totals-bar">
        <div id="solape-totals-row">
          <span id="solape-totals-label">TOTAL (${n} operaciones)</span>
          <span class="solape-totals-vals">
            <span style="color:${sumPnlCloseColor}">${sumPnlClose >= 0 ? '+' : ''}${sumPnlClose.toFixed(2)} USDT</span>
            <span style="color:${sumPnlExtColor}">${sumPnlExt >= 0 ? '+' : ''}${sumPnlExt.toFixed(2)} USDT</span>
            <span class="solape-fee-cell">-${sumComision.toFixed(2)} USDT</span>
            <span style="color:${sumNetCloseColor}">${sumNetClose >= 0 ? '+' : ''}${sumNetClose.toFixed(2)} USDT</span>
            <span style="color:${sumNetExtColor}">${sumNetExt >= 0 ? '+' : ''}${sumNetExt.toFixed(2)} USDT</span>
          </span>
        </div>
        <div id="solape-stats-row">
          <div class="solape-stat-group">
            <span class="solape-stat-label">Cierre (O→C):</span>
            <span class="solape-stat solape-stat-win">✅ ${winClose} ganadoras</span>
            <span class="solape-stat solape-stat-loss">❌ ${lossClose} perdedoras</span>
            <span class="solape-stat">Win rate: ${winRateClose.toFixed(1)}%</span>
          </div>
          <div class="solape-stat-group">
            <span class="solape-stat-label">Extremo (O→L/H):</span>
            <span class="solape-stat solape-stat-win">✅ ${winExt} ganadoras</span>
            <span class="solape-stat solape-stat-loss">❌ ${lossExt} perdedoras</span>
            <span class="solape-stat">Win rate: ${winRateExt.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    `;

    wrap.innerHTML = `
      ${totalsBarHtml}
      <table id="solape-table">
        <thead>
          <tr>
            <th>#</th><th>Fecha/Hora</th><th>Sesión</th><th>Dirección</th><th>% Hueco</th><th>% Cuerpo vela</th><th>% Open→Low/High</th>
            <th>Open</th><th>High</th><th>Low</th><th>Close</th>
            <th title="Ganancia bruta con ${solapeCapital} USDT de capital">Bruta O→C</th>
            <th title="Ganancia bruta con ${solapeCapital} USDT de capital">Bruta O→L/H</th>
            <th class="solape-fee-cell" title="Comisión de entrar + salir (${solapeFeePct.toFixed(2)}% sobre ${solapeCapital} USDT)">Comisión</th>
            <th title="Ganancia neta = bruta − comisión">Neto O→C</th>
            <th title="Ganancia neta = bruta − comisión">Neto O→L/H</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="11">TOTAL (${n} operaciones · ✅ ${winClose} / ❌ ${lossClose})</td>
            <td style="color:${sumPnlCloseColor}">${sumPnlClose >= 0 ? '+' : ''}${sumPnlClose.toFixed(2)} USDT</td>
            <td style="color:${sumPnlExtColor}">${sumPnlExt >= 0 ? '+' : ''}${sumPnlExt.toFixed(2)} USDT</td>
            <td class="solape-fee-cell">-${sumComision.toFixed(2)} USDT</td>
            <td style="color:${sumNetCloseColor}">${sumNetClose >= 0 ? '+' : ''}${sumNetClose.toFixed(2)} USDT</td>
            <td style="color:${sumNetExtColor}">${sumNetExt >= 0 ? '+' : ''}${sumNetExt.toFixed(2)} USDT</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  function exportCsv() {
    if (!_lastRows.length) return;
    const headers = ['#', 'Fecha/Hora', 'Sesión', 'Dirección', '% Hueco', '% Cuerpo vela', 'Open→Low/High', 'Open', 'High', 'Low', 'Close',
      `Gan. bruta Open→Close (${solapeCapital} USDT)`, `Gan. bruta Open→Low/High (${solapeCapital} USDT)`,
      `Comisión (${solapeFeePct.toFixed(2)}%)`, 'Neto Open→Close', 'Neto Open→Low/High'];
    const fp = window.INDICATORS.fmtPrice;
    const lines = [headers.join(';')];
    _lastRows.forEach(r => {
      lines.push([
        r.num, r.fecha, r.sesion, (r.dir === 'Arriba' ? 'LONG' : 'SHORT'),
        r.gapPct.toFixed(2) + '%', r.bodyPct.toFixed(2) + '%',
        r.extLabel + ': ' + r.extPct.toFixed(2) + '%',
        fp(r.o), fp(r.h), fp(r.l), fp(r.c),
        r.pnlClose.toFixed(2) + ' USDT',
        r.pnlExt.toFixed(2) + ' USDT',
        '-' + r.comision.toFixed(2) + ' USDT',
        r.netClose.toFixed(2) + ' USDT',
        r.netExt.toFixed(2) + ' USDT',
      ].join(';'));
    });

    // Fila de resumen: ganadoras/perdedoras (según neto) y sumatoria de cada columna
    const n = _lastRows.length;
    let winClose = 0, lossClose = 0, winExt = 0, lossExt = 0;
    let sumPnlClose = 0, sumPnlExt = 0, sumComision = 0, sumNetClose = 0, sumNetExt = 0;
    _lastRows.forEach(r => {
      if (r.netClose > 0) winClose++; else lossClose++;
      if (r.netExt   > 0) winExt++;   else lossExt++;
      sumPnlClose += r.pnlClose;
      sumPnlExt   += r.pnlExt;
      sumComision += r.comision;
      sumNetClose += r.netClose;
      sumNetExt   += r.netExt;
    });
    lines.push('');
    lines.push([`TOTAL (${n} operaciones)`, '', '', '', '', '', '', '', '', '', '',
      sumPnlClose.toFixed(2) + ' USDT', sumPnlExt.toFixed(2) + ' USDT',
      '-' + sumComision.toFixed(2) + ' USDT',
      sumNetClose.toFixed(2) + ' USDT', sumNetExt.toFixed(2) + ' USDT'].join(';'));
    lines.push([`Ganadoras O→C: ${winClose}`, `Perdedoras O→C: ${lossClose}`].join(';'));
    lines.push([`Ganadoras O→L/H: ${winExt}`, `Perdedoras O→L/H: ${lossExt}`].join(';'));

    const csv = '\uFEFF' + lines.join('\r\n'); // BOM para que Excel detecte UTF-8 bien
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solapamientos.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function addPanelButton() {
    if (document.getElementById('solape-list-btn')) return;
    const host = document.querySelector('.topbar-right-group') || document.querySelector('.topbar');
    if (!host) return;
    const btn = document.createElement('button');
    btn.className = 'tf-btn';
    btn.id = 'solape-list-btn';
    btn.type = 'button';
    btn.title = 'Ver lista de solapamientos detectados';
    btn.textContent = '📋 Solapamientos';
    btn.addEventListener('click', openModal);
    host.appendChild(btn);
  }

  addPanelButton();

})();
