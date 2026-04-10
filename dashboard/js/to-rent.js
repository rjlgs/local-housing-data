/**
 * To Rent tab — browse active rental listings.
 * Parallels the "To Buy" (Listings) tab but consumes rental data aggregated
 * from multiple providers (Redfin + Zillow + RentCast) and drops features
 * that only make sense for purchase (sold comps, HOA, price delta).
 */

const ToRent = {
  _filteredRentals: [],
  _allRentals: [],
  _sort: { col: 'first_seen', asc: false },
  _map: null,
  _markersLayer: null,
  _drawnItems: null,
  _drawControl: null,
  _areaPolygonsLayer: null,
  _customPolygon: null,
  _selectedAreas: new Set(),
  _selectedSources: new Set(),
  _markersByAddr: {},
  _photoTooltip: null,
  _photoTimeout: { id: null },

  NEW_DAYS: 3,

  // Source codes → display labels used on badges + the source filter.
  SOURCE_LABELS: {
    redfin:   { code: 'RF', label: 'Redfin' },
    zillow:   { code: 'ZL', label: 'Zillow' },
    rentcast: { code: 'RC', label: 'RentCast' },
  },

  _headers: [
    { col: null, label: '', sortable: false },
    { col: 'first_seen', label: 'Listed' },
    { col: 'address', label: 'Address' },
    { col: 'city', label: 'City' },
    { col: 'rent_monthly', label: 'Rent/mo' },
    { col: 'deposit', label: 'Deposit' },
    { col: 'sqft', label: 'SqFt' },
    { col: 'beds', label: 'Bd' },
    { col: 'baths', label: 'Ba' },
    { col: 'year_built', label: 'Year' },
    { col: 'pets_allowed', label: 'Pets' },
    { col: 'furnished', label: 'Furn.' },
    { col: 'lease_term_months', label: 'Lease' },
    { col: 'available_date', label: 'Avail.' },
    { col: 'source', label: 'Src' },
  ],

  init(container, data) {
    this._allRentals = data.rental_listings || [];
    this._metro = data.config.metro || {};
    this._focusAreas = data.config.focus_areas;
    const focusAreas = this._focusAreas;

    const freshness = data.data_freshness || {};
    const lastUpdated = freshness.rental_listings
      ? MapUtils.formatAge(freshness.rental_listings) : 'unknown';

    // Providers actually represented in this dataset, used to populate the
    // Source filter checkboxes. Fall back to all known providers if the
    // dataset is empty (so the UI still shows the options).
    const discoveredSources = new Set();
    this._allRentals.forEach(r => {
      if (r.source) discoveredSources.add(r.source);
      (r.sources || []).forEach(s => s && discoveredSources.add(s));
    });
    const sourceOptions = discoveredSources.size > 0
      ? Array.from(discoveredSources)
      : Object.keys(this.SOURCE_LABELS);

    container.innerHTML = `
      <div class="tab-header">
        <div class="tab-title-row">
          <h2>To Rent</h2>
          <button id="tr-learn-more" class="btn-learn-more">Learn More</button>
          <span class="freshness-badge" title="Last data refresh">Rental listings updated ${lastUpdated}</span>
        </div>
        <p class="subtitle">Browse active rental listings aggregated from Redfin, Zillow, and RentCast. Duplicates across providers are merged automatically.</p>
      </div>
      <div id="tr-modal" class="modal-overlay" style="display:none">
        <div class="modal-content">
          <button class="modal-close" id="tr-modal-close">&times;</button>
          <h3>About Rental Data</h3>
          <p>To Rent shows <strong>currently active rental listings</strong> pulled from multiple providers:</p>
          <ul>
            <li><strong>Redfin</strong> (<code>RF</code>) — scraped from Redfin's public rental search. Covers the same 29 metro cities as our for-sale data.</li>
            <li><strong>Zillow</strong> (<code>ZL</code>) — scraped from Zillow's rental search. Zillow aggressively rate-limits scrapers, so this source may occasionally be empty.</li>
            <li><strong>RentCast</strong> (<code>RC</code>) — official API (opt-in via API key). Returns cleaner deposit, pets, furnished, and lease-term data.</li>
          </ul>
          <h4>Dedupe</h4>
          <p>When the same unit appears on multiple providers, rows are merged by normalized address + zip + bedroom count. The <strong>Src</strong> column shows the primary provider; hover it to see every provider that surfaced the listing.</p>
          <h4>Favorites</h4>
          <p>Star rentals to save them. Rental favorites appear under the "To Rent" segment of the Favorites tab, separate from purchase favorites.</p>
        </div>
      </div>
      <div class="filter-bar">
        <div class="filter-cluster">
          <div class="filter-cluster-label">Area</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <div id="tr-area-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="tr-area-trigger">
                  <span class="multiselect-label">All Areas</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="tr-area-dropdown">
                  <div class="multiselect-options" id="tr-area-options"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Beds</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="tr-filter-beds-min" min="0" step="1"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="tr-filter-beds-max" min="0" step="1"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Baths</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="tr-filter-baths-min" min="0" step="0.5"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="tr-filter-baths-max" min="0" step="0.5"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Sq Ft</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="tr-filter-sqft-min" step="100"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="tr-filter-sqft-max" step="100"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Rent / mo</div>
          <div class="filter-cluster-row">
            <div class="filter-group"><label>Min</label><input type="number" id="tr-filter-price-min" step="100"></div>
            <div class="filter-group"><label>Max</label><input type="number" id="tr-filter-price-max" step="100"></div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Pets</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="tr-filter-pets">
                <option value="">Any</option>
                <option value="yes">Allowed</option>
                <option value="no">Not allowed</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Furnished</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="tr-filter-furnished">
                <option value="">Any</option>
                <option value="yes">Furnished</option>
                <option value="no">Unfurnished</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Type</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="tr-filter-type">
                <option value="">Any</option>
                <option value="Single Family Residential">Single Family</option>
                <option value="Townhouse">Townhouse</option>
                <option value="Condo/Co-op">Condo</option>
                <option value="Apartment">Apartment</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Source</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <div id="tr-source-select" class="multiselect">
                <button type="button" class="multiselect-trigger" id="tr-source-trigger">
                  <span class="multiselect-label">All Sources</span>
                  <span class="multiselect-arrow">&#9662;</span>
                </button>
                <div class="multiselect-dropdown" id="tr-source-dropdown">
                  <div class="multiselect-options" id="tr-source-options"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="filter-cluster">
          <div class="filter-cluster-label">Status</div>
          <div class="filter-cluster-row">
            <div class="filter-group">
              <label>&nbsp;</label>
              <select id="tr-filter-status">
                <option value="">All</option>
                <option value="new">New Only</option>
                <option value="favorited">Favorited</option>
                <option value="hide-downvoted">Hide Ruled Out</option>
                <option value="downvoted">Ruled Out Only</option>
              </select>
            </div>
          </div>
        </div>
        <div class="filter-cluster filter-actions">
          <button id="tr-filter-apply" class="btn-primary">Apply</button>
          <button id="tr-filter-clear" class="btn-secondary">Clear</button>
        </div>
      </div>
      <div id="tr-map" class="explorer-map"></div>
      <div id="tr-results-summary" class="results-summary"></div>
      <div id="tr-results-table-wrap" class="table-scroll"></div>
    `;

    // Learn More modal
    const modal = document.getElementById('tr-modal');
    document.getElementById('tr-learn-more').addEventListener('click', () => modal.style.display = 'flex');
    document.getElementById('tr-modal-close').addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Restore saved filters
    const saved = Prefs.get('tr', {});
    if (Array.isArray(saved.areas)) this._selectedAreas = new Set(saved.areas);
    if (Array.isArray(saved.sources)) this._selectedSources = new Set(saved.sources);
    if (saved.bedsMin) document.getElementById('tr-filter-beds-min').value = saved.bedsMin;
    if (saved.bedsMax) document.getElementById('tr-filter-beds-max').value = saved.bedsMax;
    if (saved.bathsMin) document.getElementById('tr-filter-baths-min').value = saved.bathsMin;
    if (saved.bathsMax) document.getElementById('tr-filter-baths-max').value = saved.bathsMax;
    if (saved.sqftMin) document.getElementById('tr-filter-sqft-min').value = saved.sqftMin;
    if (saved.sqftMax) document.getElementById('tr-filter-sqft-max').value = saved.sqftMax;
    if (saved.priceMin) document.getElementById('tr-filter-price-min').value = saved.priceMin;
    if (saved.priceMax) document.getElementById('tr-filter-price-max').value = saved.priceMax;
    if (saved.pets) document.getElementById('tr-filter-pets').value = saved.pets;
    if (saved.furnished) document.getElementById('tr-filter-furnished').value = saved.furnished;
    if (saved.type) document.getElementById('tr-filter-type').value = saved.type;
    if (saved.status) document.getElementById('tr-filter-status').value = saved.status;
    // Source checkboxes are restored when the source multiselect is initialized below.

    // Bind events
    document.getElementById('tr-filter-apply').addEventListener('click', () => this._applyFilters(focusAreas));
    document.getElementById('tr-filter-clear').addEventListener('click', () => this._clearFilters(focusAreas));
    container.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter') this._applyFilters(focusAreas); });
    });
    this._initMap();
    this._photoTooltip = MapUtils.createPhotoTooltip();
    MapUtils.initAreaMultiSelect({
      optionsElId: 'tr-area-options', dropdownElId: 'tr-area-dropdown',
      triggerElId: 'tr-area-trigger', selectElId: 'tr-area-select',
      focusAreas, selectedAreas: this._selectedAreas,
      onChanged: () => { this._updateAreaTrigger(); this._applyFilters(focusAreas); },
      enableDraw: () => this._enableDraw(),
      disableDraw: () => { this._disableDraw(); this._customPolygon = null; },
    });
    this._updateAreaTrigger();
    this._initSourceMultiSelect(sourceOptions, focusAreas);
    this._applyFilters(focusAreas);
  },

  _initMap() {
    this._map = MapUtils.createMap('tr-map', this._allRentals, this._metro.map_center, this._metro.map_zoom);
    this._areaPolygonsLayer = L.featureGroup().addTo(this._map);
    this._drawnItems = L.featureGroup().addTo(this._map);
    this._markersLayer = L.layerGroup().addTo(this._map);
    this._drawControl = MapUtils.createDrawControl(this._drawnItems);
    MapUtils.bindDrawEvents(this._map, this._drawnItems, {
      onCreated: (polygon) => { this._customPolygon = polygon; this._applyFilters(this._focusAreas); },
      onDeleted: () => {
        this._customPolygon = null;
        this._selectedAreas.delete('custom');
        const cb = document.querySelector('#tr-area-options [data-key="custom"] input');
        if (cb) cb.checked = false;
        this._updateAreaTrigger();
        this._applyFilters(this._focusAreas);
      },
      onEdited: (polygon) => { this._customPolygon = polygon; this._applyFilters(this._focusAreas); },
    });
    this._renderMarkers(this._allRentals);
  },

  _enableDraw() { MapUtils.enableDraw(this._map, this._drawControl); },
  _disableDraw() { MapUtils.disableDraw(this._map, this._drawControl, this._drawnItems); },
  _updateAreaTrigger() { MapUtils.updateAreaTrigger('#tr-area-trigger', this._selectedAreas, this._focusAreas); },

  _initSourceMultiSelect(sourceOptions, focusAreas) {
    const options = document.getElementById('tr-source-options');
    const dropdown = document.getElementById('tr-source-dropdown');
    const trigger = document.getElementById('tr-source-trigger');

    sourceOptions.forEach(s => {
      const label = document.createElement('label');
      label.className = 'multiselect-option';
      label.dataset.key = s;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = s;
      cb.checked = this._selectedSources.has(s);
      const text = document.createElement('span');
      text.textContent = this.SOURCE_LABELS[s]?.label || s;
      label.append(cb, text);
      options.appendChild(label);

      cb.addEventListener('change', () => {
        if (cb.checked) this._selectedSources.add(s);
        else this._selectedSources.delete(s);
        this._updateSourceTrigger();
        this._applyFilters(focusAreas);
      });
    });

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tr-source-select')) dropdown.classList.remove('open');
    });

    this._updateSourceTrigger();
  },

  _updateSourceTrigger() {
    const label = document.querySelector('#tr-source-trigger .multiselect-label');
    if (!label) return;
    const count = this._selectedSources.size;
    if (count === 0) {
      label.textContent = 'All Sources';
    } else if (count === 1) {
      const src = [...this._selectedSources][0];
      label.textContent = this.SOURCE_LABELS[src]?.label || src;
    } else {
      label.textContent = `${count} sources`;
    }
  },

  _markerColor(rental) {
    if (this._isNew(rental)) return '#ea580c';
    return '#7c3aed';
  },

  _isNew(rental) {
    if (!rental.first_seen) return false;
    try { return (new Date() - new Date(rental.first_seen)) / 86400000 <= this.NEW_DAYS; }
    catch { return false; }
  },

  _renderMarkers(rentals) {
    this._markersByAddr = MapUtils.renderMarkers({
      layer: this._markersLayer, data: rentals,
      rowSelector: '#tr-results-table-wrap .clickable-row',
      colorFn: (h) => this._markerColor(h),
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
    });
  },

  _getFilters() {
    return {
      areas: [...this._selectedAreas],
      sources: [...this._selectedSources],
      bedsMin: document.getElementById('tr-filter-beds-min').value,
      bedsMax: document.getElementById('tr-filter-beds-max').value,
      bathsMin: document.getElementById('tr-filter-baths-min').value,
      bathsMax: document.getElementById('tr-filter-baths-max').value,
      sqftMin: document.getElementById('tr-filter-sqft-min').value,
      sqftMax: document.getElementById('tr-filter-sqft-max').value,
      priceMin: document.getElementById('tr-filter-price-min').value,
      priceMax: document.getElementById('tr-filter-price-max').value,
      pets: document.getElementById('tr-filter-pets').value,
      furnished: document.getElementById('tr-filter-furnished').value,
      type: document.getElementById('tr-filter-type').value,
      status: document.getElementById('tr-filter-status').value,
    };
  },

  _clearFilters(focusAreas) {
    this._selectedAreas = new Set();
    this._selectedSources = new Set();
    document.querySelectorAll('#tr-area-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#tr-source-options input[type="checkbox"]').forEach(cb => cb.checked = false);
    this._updateAreaTrigger();
    this._updateSourceTrigger();
    ['tr-filter-beds-min','tr-filter-beds-max','tr-filter-baths-min','tr-filter-baths-max',
     'tr-filter-sqft-min','tr-filter-sqft-max','tr-filter-price-min','tr-filter-price-max',
     'tr-filter-pets','tr-filter-furnished','tr-filter-type','tr-filter-status',
    ].forEach(id => document.getElementById(id).value = '');
    this._customPolygon = null;
    this._disableDraw();
    this._areaPolygonsLayer.clearLayers();
    this._applyFilters(focusAreas);
  },

  _applyFilters(focusAreas) {
    const f = this._getFilters();
    Prefs.set('tr', f);
    let rentals = MapUtils.applyAreaFilter([...this._allRentals], f.areas, this._customPolygon, focusAreas);
    rentals = MapUtils.applyCommonFilters(rentals, f, 'rent_monthly');

    // Rental-specific filters
    if (f.pets === 'yes') rentals = rentals.filter(h => {
      const p = (h.pets_allowed || '').toLowerCase();
      return p && p !== 'no';
    });
    if (f.pets === 'no') rentals = rentals.filter(h => (h.pets_allowed || '').toLowerCase() === 'no');
    if (f.furnished === 'yes') rentals = rentals.filter(h => (h.furnished || '').toLowerCase() === 'yes');
    if (f.furnished === 'no') rentals = rentals.filter(h => (h.furnished || '').toLowerCase() === 'no');
    if (f.sources && f.sources.length > 0) {
      const want = new Set(f.sources);
      rentals = rentals.filter(h => {
        if (want.has(h.source)) return true;
        // Also match if the provider appears in the merged sources list
        return (h.sources || []).some(s => want.has(s));
      });
    }

    if (f.status === 'new') rentals = rentals.filter(h => this._isNew(h));
    if (f.status === 'favorited') rentals = rentals.filter(h => FavoritesStore.isFavorited(h.address, 'rent'));
    if (f.status === 'hide-downvoted') rentals = rentals.filter(h => !DownvoteStore.isDownvoted(h.address, 'rent'));
    if (f.status === 'downvoted') rentals = rentals.filter(h => DownvoteStore.isDownvoted(h.address, 'rent'));

    this._filteredRentals = rentals;
    this._renderMarkers(rentals);

    const namedAreas = f.areas.filter(a => a !== 'custom');
    if (namedAreas.length > 0) {
      MapUtils.showAreaPolygons(this._map, this._areaPolygonsLayer, namedAreas, focusAreas, rentals);
    }
    this._renderResults(rentals);
  },

  _sourceBadge(rental) {
    const primary = rental.source || '';
    const info = this.SOURCE_LABELS[primary] || { code: primary.slice(0, 2).toUpperCase() || '?', label: primary || 'Unknown' };
    const allSources = (rental.sources && rental.sources.length > 0)
      ? rental.sources
      : (primary ? [primary] : []);
    const tooltipParts = allSources.map(s => (this.SOURCE_LABELS[s]?.label || s));
    const tooltip = tooltipParts.length > 1
      ? `Surfaced by: ${tooltipParts.join(', ')}`
      : (info.label || '');
    return `<span class="source-badge source-${primary}" title="${tooltip.replace(/"/g, '&quot;')}">${info.code}</span>`;
  },

  _formatPets(val) {
    if (!val) return '\u2014';
    const v = val.toLowerCase();
    if (v === 'yes') return 'Yes';
    if (v === 'no') return 'No';
    if (v === 'cats') return 'Cats';
    if (v === 'dogs') return 'Dogs';
    if (v === 'cats_dogs' || v === 'cats,dogs') return 'Cats & Dogs';
    return val;
  },

  _formatFurnished(val) {
    if (!val) return '\u2014';
    const v = val.toLowerCase();
    if (v === 'yes') return 'Yes';
    if (v === 'no') return 'No';
    return val;
  },

  _renderResults(rentals) {
    const rents = rentals.map(h => h.rent_monthly).filter(v => v != null);
    const sqfts = rentals.map(h => h.sqft).filter(v => v != null);
    const newCount = rentals.filter(h => this._isNew(h)).length;

    document.getElementById('tr-results-summary').innerHTML = `
      <span><strong>${rentals.length}</strong> rentals</span>
      <span>Median rent: <strong>${Utils.formatCurrency(Utils.median(rents))}/mo</strong></span>
      <span>Median SqFt: <strong>${Utils.formatNumber(Utils.median(sqfts))}</strong></span>
      ${newCount > 0 ? `<span class="badge badge-new" title="Listed within the last 3 days">${newCount} new</span>` : ''}
      ${(() => { const fc = rentals.filter(h => FavoritesStore.isFavorited(h.address, 'rent')).length; return fc > 0 ? `<span class="badge badge-fav" title="Rentals you've marked as favorites">${fc} favorited</span>` : ''; })()}
      ${(() => { const dc = rentals.filter(h => DownvoteStore.isDownvoted(h.address, 'rent')).length; return dc > 0 ? `<span class="badge badge-downvote" title="Rentals you've ruled out">${dc} ruled out</span>` : ''; })()}
    `;

    MapUtils.sortData(rentals, this._sort.col, this._sort.asc);
    const display = rentals.slice(0, 200);
    const headerHtml = MapUtils.renderHeaders(this._headers, this._sort.col, this._sort.asc);

    const rowsHtml = display.map(h => {
      const badges = [];
      if (this._isNew(h)) badges.push('<span class="badge badge-new" title="Listed within the last 3 days">NEW</span>');
      const isFav = FavoritesStore.isFavorited(h.address, 'rent');
      const isDown = DownvoteStore.isDownvoted(h.address, 'rent');
      const rentHtml = h.rent_monthly != null ? `${Utils.formatCurrency(h.rent_monthly)}/mo` : '\u2014';
      const depositHtml = h.deposit != null ? Utils.formatCurrency(h.deposit) : '\u2014';
      const leaseHtml = h.lease_term_months != null ? `${h.lease_term_months} mo` : '\u2014';
      const availHtml = h.available_date ? Utils.formatDate(h.available_date) : '\u2014';
      return `
        <tr class="clickable-row${isDown ? ' downvoted-row' : ''}" data-addr="${(h.address || '').replace(/"/g, '&quot;')}">
          <td><button class="btn-fav${isFav ? ' active' : ''}" data-fav-addr="${(h.address || '').replace(/"/g, '&quot;')}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '&#9733;' : '&#9734;'}</button><button class="btn-downvote${isDown ? ' active' : ''}" data-down-addr="${(h.address || '').replace(/"/g, '&quot;')}" title="${isDown ? 'Remove rule-out' : 'Rule out this rental'}">${isDown ? '&#8634;' : '&#10005;'}</button></td>
          ${MapUtils.PHOTO_BTN_HTML}
          <td>${Utils.formatDate(h.first_seen)} ${badges.join(' ')}</td>
          <td class="addr-cell"><a href="${h.listing_url || '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${h.address || '\u2014'}</a></td>
          <td>${h.city || '\u2014'}</td>
          <td>${rentHtml}</td>
          <td>${depositHtml}</td>
          <td>${Utils.formatNumber(h.sqft)}</td>
          <td>${h.beds ?? '\u2014'}</td>
          <td>${h.baths ?? '\u2014'}</td>
          <td>${h.year_built ?? '\u2014'}</td>
          <td>${this._formatPets(h.pets_allowed)}</td>
          <td>${this._formatFurnished(h.furnished)}</td>
          <td>${leaseHtml}</td>
          <td>${availHtml}</td>
          <td>${this._sourceBadge(h)}</td>
        </tr>
      `;
    }).join('');

    document.getElementById('tr-results-table-wrap').innerHTML = `
      <table class="data-table"><thead><tr><th class="photo-preview-cell"></th>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
      ${rentals.length > 200 ? `<p class="table-note">Showing 200 of ${rentals.length} results</p>` : ''}
      ${rentals.length === 0 ? '<p class="empty-state">No rental listings match these filters. Try widening the beds or rent range, or clear the Source filter.</p>' : ''}
    `;

    MapUtils.bindSortHeaders('#tr-results-table-wrap .sortable', this._sort, ['address', 'first_seen'],
      () => this._renderResults(this._filteredRentals));

    // Star (favorite) button handlers
    document.querySelectorAll('#tr-results-table-wrap .btn-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const addr = btn.dataset.favAddr;
        const rental = this._allRentals.find(h => h.address === addr);
        if (!rental) return;
        const nowFav = FavoritesStore.toggle(rental, 'rent');
        btn.classList.toggle('active', nowFav);
        btn.innerHTML = nowFav ? '&#9733;' : '&#9734;';
        btn.title = nowFav ? 'Remove from favorites' : 'Add to favorites';
        // Mutual exclusion: favoriting removes downvote
        if (nowFav && DownvoteStore.isDownvoted(addr, 'rent')) {
          DownvoteStore.remove(addr, 'rent');
          const downBtn = btn.parentElement.querySelector('.btn-downvote');
          if (downBtn) downBtn.classList.remove('active');
          btn.closest('tr').classList.remove('downvoted-row');
        }
        this._updateFavTabCount();
      });
    });

    // Downvote (rule-out) button handlers
    document.querySelectorAll('#tr-results-table-wrap .btn-downvote').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const addr = btn.dataset.downAddr;
        const nowDown = DownvoteStore.toggle(addr, 'rent');
        btn.classList.toggle('active', nowDown);
        btn.title = nowDown ? 'Remove rule-out' : 'Rule out this rental';
        const row = btn.closest('tr');
        row.classList.toggle('downvoted-row', nowDown);
        // Mutual exclusion: downvoting removes favorite
        if (nowDown && FavoritesStore.isFavorited(addr, 'rent')) {
          FavoritesStore.remove(addr, 'rent');
          const favBtn = row.querySelector('.btn-fav');
          if (favBtn) {
            favBtn.classList.remove('active');
            favBtn.innerHTML = '&#9734;';
            favBtn.title = 'Add to favorites';
          }
          this._updateFavTabCount();
        }
      });
    });

    MapUtils.bindTableMarkerHovers({
      rows: '#tr-results-table-wrap .clickable-row', items: rentals,
      markersByAddr: this._markersByAddr,
      showPhoto: (h, x, y) => this._showPhoto(h, x, y),
      hidePhoto: () => this._hidePhoto(),
    });
  },

  _updateFavTabCount() {
    const count = FavoritesStore.count();
    const badge = document.getElementById('fav-tab-count');
    if (badge) {
      badge.textContent = count > 0 ? count : '';
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  },

  _showPhoto(rental, x, y) { MapUtils.showPhoto(this._photoTooltip, this._photoTimeout, rental, x, y, 'rent_monthly'); },
  _hidePhoto() { MapUtils.hidePhoto(this._photoTooltip, this._photoTimeout); },
};
