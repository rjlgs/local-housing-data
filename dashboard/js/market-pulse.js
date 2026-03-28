/**
 * Market Pulse tab — time-series charts showing market conditions.
 */

const MarketPulse = {
  _charts: [
    { id: 'chart-price', field: 'median_sale_price', prefix: '$', label: 'Median Sale Price' },
    { id: 'chart-supply', field: 'months_of_supply', refLines: [4, 6], label: 'Months of Supply', note: 'Below 4 = seller\'s market, above 6 = buyer\'s market' },
    { id: 'chart-ratio', field: 'avg_sale_to_list', refLines: [1.0], label: 'Sale-to-List Ratio', note: 'Below 1.0 = buyers have leverage' },
    { id: 'chart-dom', field: 'median_dom', label: 'Median Days on Market' },
    { id: 'chart-inventory', field: 'inventory', label: 'Active Inventory' },
    { id: 'chart-sold', field: 'homes_sold', label: 'Homes Sold (Monthly)' },
  ],

  init(container, data) {
    const config = data.config;
    const trends = data.market_trends;
    const focusAreas = config.focus_areas;
    const trendOptions = Utils.TREND_TYPES.map(t =>
      `<option value="${t}">${Utils.TREND_LABELS[t]}</option>`
    ).join('');

    const chartOverrideOptions = `<option value="global">Global</option>` + trendOptions;

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>Market Pulse</h2>
          <button id="mp-learn-more" class="btn-learn-more">Learn More</button>
        </div>
        <p class="subtitle">Is now a good time to buy? Track key market indicators over time.</p>
      </div>
      <div id="mp-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <button class="modal-close" id="mp-modal-close">&times;</button>
          <h3>About Market Pulse Data</h3>
          <p>Market Pulse uses <strong>Redfin's public market tracker data</strong>, which provides monthly aggregated statistics at the city and zip code level. This data is downloaded from Redfin's S3 bulk data files and goes back several years, giving you a long-term view of market trends.</p>
          <p>Key metrics include median sale price, months of supply, sale-to-list ratio, days on market, and price drop rates. These are computed by Redfin across <em>all</em> sales in each area, not just the ~90-day window shown in the other tabs.</p>
          <h4>How is this different from the other tabs?</h4>
          <p>The <strong>Property Explorer</strong> and <strong>Area Compare</strong> tabs show individual recently sold homes (last ~90 days) pulled from Redfin's sold listings API. Market Pulse shows broader market-level trends over time, so you can see whether conditions are improving or worsening for buyers before drilling into individual properties.</p>
          <h4>Data sources</h4>
          <ul>
            <li><strong>City-level trends:</strong> Redfin city market tracker (updated weekly)</li>
            <li><strong>Zip-level trends:</strong> Redfin zip code market tracker (updated monthly)</li>
          </ul>
          <p>For neighborhood-type areas (e.g. Irving Park, Sunset Hills), trends are approximated by averaging the zip codes that overlap the neighborhood, since Redfin does not publish neighborhood-level market data.</p>
        </div>
      </div>
      <div class="controls">
        <label>Areas: </label>
        <div id="area-toggles" class="toggle-group"></div>
        <button id="mp-deselect-all" class="btn-deselect-all">Deselect All</button>
        <div class="trend-control">
          <label for="mp-global-trend">Trend:</label>
          <select id="mp-global-trend">${trendOptions}</select>
        </div>
      </div>
      <div id="buyer-score-card"></div>
      <div class="chart-grid">
        ${this._charts.map(c => `
          <div class="chart-card">
            <div class="chart-card-header">
              <h3>${c.label}</h3>
              <div class="chart-card-controls">
                <label class="chart-june-label"><input type="checkbox" class="chart-june-check" data-chart="${c.id}"> June</label>
                <select class="chart-trend-select" data-chart="${c.id}">${chartOverrideOptions}</select>
              </div>
            </div>
            ${c.note ? `<p class="chart-note">${c.note}</p>` : ''}
            <div id="${c.id}"></div>
          </div>
        `).join('')}
      </div>
    `;

    // Learn More modal
    const modal = document.getElementById('mp-modal');
    document.getElementById('mp-learn-more').addEventListener('click', () => modal.style.display = 'flex');
    document.getElementById('mp-modal-close').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Build area toggle buttons
    const toggleContainer = document.getElementById('area-toggles');
    const allAreas = this._buildAreaList(focusAreas, trends);

    // Restore saved active areas, or default to all
    const savedAreas = Prefs.get('mp.activeAreas');
    this._activeAreas = savedAreas
      ? new Set(savedAreas.filter(k => allAreas.some(a => a.key === k)))
      : new Set(allAreas.map(a => a.key));

    allAreas.forEach((area) => {
      const btn = document.createElement('button');
      btn.className = 'toggle-btn' + (this._activeAreas.has(area.key) ? ' active' : '');
      btn.style.borderColor = area.color;
      btn.textContent = area.label;
      btn.dataset.key = area.key;
      btn.addEventListener('click', () => {
        if (this._activeAreas.has(area.key)) {
          this._activeAreas.delete(area.key);
          btn.classList.remove('active');
        } else {
          this._activeAreas.add(area.key);
          btn.classList.add('active');
        }
        Prefs.set('mp.activeAreas', [...this._activeAreas]);
        this._renderCharts(trends, allAreas);
      });
      toggleContainer.appendChild(btn);
    });

    // Deselect All button
    document.getElementById('mp-deselect-all').addEventListener('click', () => {
      this._activeAreas.clear();
      toggleContainer.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      Prefs.set('mp.activeAreas', []);
      this._renderCharts(trends, allAreas);
    });

    // Global trend select
    const globalSelect = document.getElementById('mp-global-trend');
    globalSelect.value = Prefs.get('mp.globalTrend', 'off');
    globalSelect.addEventListener('change', () => {
      Prefs.set('mp.globalTrend', globalSelect.value);
      this._renderCharts(trends, allAreas);
    });

    // Per-chart trend selects
    container.querySelectorAll('.chart-trend-select').forEach(sel => {
      const chartId = sel.dataset.chart;
      sel.value = Prefs.get(`mp.chartTrends.${chartId}`, 'global');
      sel.addEventListener('change', () => {
        Prefs.set(`mp.chartTrends.${chartId}`, sel.value);
        this._renderCharts(trends, allAreas);
      });
    });

    // Per-chart June marker checkboxes
    container.querySelectorAll('.chart-june-check').forEach(chk => {
      const chartId = chk.dataset.chart;
      chk.checked = Prefs.get(`mp.juneMarkers.${chartId}`, false);
      chk.addEventListener('change', () => {
        Prefs.set(`mp.juneMarkers.${chartId}`, chk.checked);
        this._renderCharts(trends, allAreas);
      });
    });

    this._renderCharts(trends, allAreas);
    this._renderBuyerScore(trends, allAreas);
  },

  _buildAreaList(focusAreas, trends) {
    const areas = [];

    if (trends['Greensboro']) {
      areas.push({
        key: 'Greensboro',
        label: 'Greensboro (Metro)',
        color: Utils.baselineColor,
        dash: 'dash',
      });
    }

    focusAreas.forEach((fa, i) => {
      if (fa.type === 'city' && trends[fa.name]) {
        areas.push({
          key: fa.name,
          label: fa.name,
          color: Utils.colorFor(i),
          dash: 'solid',
        });
      }

      // Neighborhood areas: use merged entry keyed by area name
      if (fa.type === 'neighborhood' && trends[fa.name]) {
        areas.push({
          key: fa.name,
          label: fa.name,
          color: Utils.colorFor(i),
          dash: 'solid',
        });
        return;
      }

      // City-type multi-zip: show individual zip traces
      const zips = fa.zip_codes || [];
      if (fa.type === 'city' && zips.length <= 1) return;
      zips.forEach(zip => {
        const zipKey = `Zip Code: ${zip}`;
        if (trends[zipKey]) {
          areas.push({
            key: zipKey,
            label: `${fa.name} (${zip})`,
            color: Utils.colorFor(i),
            dash: 'dot',
          });
        }
      });
    });

    return areas;
  },

  _renderCharts(trends, allAreas) {
    const globalTrend = Prefs.get('mp.globalTrend', 'off');

    this._charts.forEach(chart => {
      const chartTrend = Utils.resolveTrend(
        globalTrend,
        Prefs.get(`mp.chartTrends.${chart.id}`, 'global')
      );
      const juneMarker = Prefs.get(`mp.juneMarkers.${chart.id}`, false);
      const traces = [];

      allAreas.forEach(area => {
        if (!this._activeAreas.has(area.key)) return;
        const records = trends[area.key] || [];
        if (records.length === 0) return;

        const xVals = records.map(r => r.date);
        const yVals = records.map(r => r[chart.field]);

        traces.push({
          x: xVals,
          y: yVals,
          name: area.label,
          type: 'scatter',
          mode: 'lines',
          line: { color: area.color, dash: area.dash, width: area.dash === 'dash' ? 2 : 1.5 },
          connectgaps: true,
          opacity: chartTrend !== 'off' ? 0.2 : 1,
        });

        Utils.buildTrendTraces(xVals, yVals, chartTrend, area.color)
          .forEach(t => traces.push(t));

        if (juneMarker) {
          const juneX = [], juneY = [];
          for (let i = 0; i < xVals.length; i++) {
            if (yVals[i] != null && !isNaN(yVals[i]) && xVals[i] && xVals[i].includes('-06-')) {
              juneX.push(xVals[i]);
              juneY.push(yVals[i]);
            }
          }
          if (juneX.length > 0) {
            traces.push({
              x: juneX,
              y: juneY,
              mode: 'markers',
              type: 'scatter',
              marker: { color: '#dc2626', size: 8, symbol: 'circle' },
              showlegend: false,
              hoverinfo: 'skip',
            });
          }
        }
      });

      const shapes = (chart.refLines || []).map(val => ({
        type: 'line',
        x0: 0, x1: 1, xref: 'paper',
        y0: val, y1: val,
        line: { color: '#9ca3af', width: 1, dash: 'dot' },
      }));

      const layout = {
        ...Utils.plotlyDefaults,
        shapes,
        yaxis: {
          ...Utils.plotlyDefaults.yaxis,
          tickprefix: chart.prefix || '',
        },
      };

      Plotly.newPlot(chart.id, traces, layout, { responsive: true, displayModeBar: false });
    });
  },

  _computeScore(records) {
    if (!records || records.length === 0) return null;
    const recent = records.slice(-3);
    const avgSupply = Utils.median(recent.map(r => r.months_of_supply));
    const avgRatio = Utils.median(recent.map(r => r.avg_sale_to_list));
    const avgDOM = Utils.median(recent.map(r => r.median_dom));
    const avgPriceDrops = Utils.median(recent.map(r => r.price_drops));

    const supplyScore = Math.min(100, Math.max(0, ((avgSupply || 3) - 2) / 4 * 100));
    const ratioScore = Math.min(100, Math.max(0, (1.03 - (avgRatio || 1)) / 0.06 * 100));
    const domScore = Math.min(100, Math.max(0, ((avgDOM || 30) - 14) / 31 * 100));
    const dropScore = Math.min(100, Math.max(0, ((avgPriceDrops || 0.2) - 0.1) / 0.2 * 100));

    const composite = Math.round((supplyScore + ratioScore + domScore + dropScore) / 4);

    let label, colorClass;
    if (composite >= 60) { label = "Buyer's Market"; colorClass = 'score-good'; }
    else if (composite >= 40) { label = 'Balanced'; colorClass = 'score-neutral'; }
    else { label = "Seller's Market"; colorClass = 'score-bad'; }

    return { composite, label, colorClass, avgSupply, avgRatio, avgDOM, avgPriceDrops, supplyScore, ratioScore, domScore, dropScore };
  },

  _computeScoreAt(records, monthsAgo) {
    if (!records || records.length === 0) return null;
    const endIdx = records.length - monthsAgo;
    if (endIdx <= 0) return null;
    return this._computeScore(records.slice(0, endIdx));
  },

  _getHistorical(records, monthsAgo) {
    if (!records || records.length === 0) return null;
    const idx = records.length - 1 - monthsAgo;
    if (idx < 0) return null;
    const r = records[idx];
    return {
      supply: r.months_of_supply,
      ratio: r.avg_sale_to_list,
      dom: r.median_dom,
      drops: r.price_drops,
    };
  },

  _fmtHist(val, type) {
    if (val == null) return '—';
    if (type === 'ratio') return val.toFixed(3);
    if (type === 'pct') return (val * 100).toFixed(0) + '%';
    if (type === 'int') return Math.round(val).toString();
    return val.toFixed(1);
  },

  _histVals(records, field, fmt, monthsAgoList) {
    return monthsAgoList.map(m => {
      const h = this._getHistorical(records, m);
      const val = h ? h[field] : null;
      return `<span class="hist-val" title="${m}mo ago">${this._fmtHist(val, fmt)}</span>`;
    }).join('');
  },

  _renderScoreCard(s, title, showBreakdown, records) {
    if (!s) return '';
    const periods = [3, 6, 12, 24];
    const hasHist = showBreakdown && records && records.length > 0;
    const histHeader = hasHist
      ? `<span class="hist-header">${periods.map(m => `<span class="hist-label">${m}mo</span>`).join('')}</span>`
      : '';

    return `
      <div class="score-card">
        <h3>${title}</h3>
        <div class="score-row">
          <div class="score-value ${s.colorClass}">${s.composite}</div>
          <div class="score-label">${s.label}</div>
        </div>
        ${showBreakdown ? `
        ${hasHist ? `<div class="score-item score-item-header"><span></span><span>Now</span><span class="hist-vals">${periods.map(m => `<span class="hist-val">${m}mo</span>`).join('')}</span><span></span></div>` : ''}
        <div class="score-breakdown">
          <div class="score-item score-item-composite">
            <span>Buyer Favorability</span>
            <span class="${s.colorClass}">${s.composite}</span>
            ${hasHist ? `<span class="hist-vals">${periods.map(m => { const hs = this._computeScoreAt(records, m); return `<span class="hist-val ${hs ? hs.colorClass : ''}">${hs ? hs.composite : '—'}</span>`; }).join('')}</span>` : ''}
            <span></span>
          </div>
          <div class="score-item">
            <span>Months of Supply <span class="info-icon" data-tooltip="How many months it would take to sell all current listings at the current sales pace. Above 6 months favors buyers (more choices, less competition). Below 4 months favors sellers. Score: 0 at 2 months, 100 at 6+ months.">i</span></span>
            <span>${s.avgSupply != null ? s.avgSupply.toFixed(1) : '—'}</span>
            ${hasHist ? `<span class="hist-vals">${this._histVals(records, 'supply', 'dec', periods)}</span>` : ''}
            <div class="score-bar"><div class="score-fill" style="width:${s.supplyScore}%;background:${s.supplyScore>50?'#16a34a':'#dc2626'}"></div></div>
          </div>
          <div class="score-item">
            <span>Sale-to-List Ratio <span class="info-icon" data-tooltip="Average ratio of final sale price to original list price. Below 1.0 means homes sell under asking — buyers have negotiating power. Above 1.0 means bidding wars. Score: 100 at 0.97, 0 at 1.03+.">i</span></span>
            <span>${s.avgRatio != null ? s.avgRatio.toFixed(3) : '—'}</span>
            ${hasHist ? `<span class="hist-vals">${this._histVals(records, 'ratio', 'ratio', periods)}</span>` : ''}
            <div class="score-bar"><div class="score-fill" style="width:${s.ratioScore}%;background:${s.ratioScore>50?'#16a34a':'#dc2626'}"></div></div>
          </div>
          <div class="score-item">
            <span>Days on Market <span class="info-icon" data-tooltip="Median number of days homes sit on the market before selling. Higher means less urgency and more time to decide — good for buyers. Lower means homes sell fast — competitive for buyers. Score: 0 at 14 days, 100 at 45+ days.">i</span></span>
            <span>${s.avgDOM != null ? Math.round(s.avgDOM) : '—'}</span>
            ${hasHist ? `<span class="hist-vals">${this._histVals(records, 'dom', 'int', periods)}</span>` : ''}
            <div class="score-bar"><div class="score-fill" style="width:${s.domScore}%;background:${s.domScore>50?'#16a34a':'#dc2626'}"></div></div>
          </div>
          <div class="score-item">
            <span>Price Drop Rate <span class="info-icon" data-tooltip="Fraction of listings that had at least one price reduction. Higher means sellers are having to cut prices to attract buyers — a sign of buyer leverage. Score: 0 at 10%, 100 at 30%+.">i</span></span>
            <span>${s.avgPriceDrops != null ? (s.avgPriceDrops * 100).toFixed(0) + '%' : '—'}</span>
            ${hasHist ? `<span class="hist-vals">${this._histVals(records, 'drops', 'pct', periods)}</span>` : ''}
            <div class="score-bar"><div class="score-fill" style="width:${s.dropScore}%;background:${s.dropScore>50?'#16a34a':'#dc2626'}"></div></div>
          </div>
        </div>
        <p class="score-note">Based on most recent 3 months of data. Score 0-100; higher = more favorable for buyers.</p>
        ` : ''}
      </div>
    `;
  },

  _renderBuyerScore(trends, allAreas) {
    const container = document.getElementById('buyer-score-card');

    // Metro score with full breakdown + history
    const gsoRecords = trends['Greensboro'] || [];
    const metroHtml = this._renderScoreCard(
      this._computeScore(gsoRecords),
      'Buyer Favorability Score (Greensboro Metro)',
      true,
      gsoRecords
    );

    // Per-area scores (compact — no breakdown)
    const periods = [3, 6, 12, 24];
    const areaScores = allAreas
      .filter(a => a.key !== 'Greensboro' && trends[a.key] && trends[a.key].length > 0)
      .map(a => ({ area: a, score: this._computeScore(trends[a.key]), records: trends[a.key] }))
      .filter(s => s.score);

    let areaHtml = '';
    if (areaScores.length > 0) {
      areaHtml = `
        <div class="score-card">
          <h3>Per-Area Scores</h3>
          <div class="area-scores-grid">
            ${areaScores.map(({ area, score: s, records: r }) => {
              const hists = periods.map(m => ({ m, data: this._getHistorical(r, m) }));
              const histCols = `<span class="ast-hist-vals">${hists.map(h => `<span class="ast-hist-val">${h.m}mo</span>`).join('')}</span>`;
              const histRow = (vals) => `<span class="ast-hist-vals">${hists.map(h => `<span class="ast-hist-val">${vals(h.data)}</span>`).join('')}</span>`;
              return `
              <div class="area-score-item">
                <div class="area-score-value ${s.colorClass}">${s.composite}</div>
                <div class="area-score-meta">
                  <span class="area-score-name">${area.label}</span>
                  <span class="area-score-label">${s.label}</span>
                </div>
                <div class="area-score-tooltip">
                  <div class="ast-row ast-header"><span></span><span>Now</span>${histCols}<span></span></div>
                  <div class="ast-row ast-composite"><span>Buyer Favorability</span><span class="${s.colorClass}">${s.composite}</span><span class="ast-hist-vals">${hists.map(h => { const hs = this._computeScoreAt(r, h.m); return `<span class="ast-hist-val ${hs ? hs.colorClass : ''}">${hs ? hs.composite : '—'}</span>`; }).join('')}</span><span></span></div>
                  <div class="ast-row"><span>Months of Supply</span><span>${s.avgSupply != null ? s.avgSupply.toFixed(1) : '—'}</span>${histRow(d => this._fmtHist(d?.supply, 'dec'))}<div class="score-bar"><div class="score-fill" style="width:${s.supplyScore}%;background:${s.supplyScore>50?'#16a34a':'#dc2626'}"></div></div></div>
                  <div class="ast-row"><span>Sale-to-List</span><span>${s.avgRatio != null ? s.avgRatio.toFixed(3) : '—'}</span>${histRow(d => this._fmtHist(d?.ratio, 'ratio'))}<div class="score-bar"><div class="score-fill" style="width:${s.ratioScore}%;background:${s.ratioScore>50?'#16a34a':'#dc2626'}"></div></div></div>
                  <div class="ast-row"><span>Days on Market</span><span>${s.avgDOM != null ? Math.round(s.avgDOM) : '—'}</span>${histRow(d => this._fmtHist(d?.dom, 'int'))}<div class="score-bar"><div class="score-fill" style="width:${s.domScore}%;background:${s.domScore>50?'#16a34a':'#dc2626'}"></div></div></div>
                  <div class="ast-row"><span>Price Drop Rate</span><span>${s.avgPriceDrops != null ? (s.avgPriceDrops * 100).toFixed(0) + '%' : '—'}</span>${histRow(d => this._fmtHist(d?.drops, 'pct'))}<div class="score-bar"><div class="score-fill" style="width:${s.dropScore}%;background:${s.dropScore>50?'#16a34a':'#dc2626'}"></div></div></div>
                </div>
              </div>
            `}).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `<div class="score-row-wrap">${metroHtml}${areaHtml}</div>`;
  },
};
