// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the board, the filters, the per-protocol detail panel
// and the set-aside live-token table. No network: every value on screen comes
// from data.js, and the page recomputes each row's implied value from the
// snapshot figures so the code and the board visibly agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchOnly: false, tab: 'pre', sort: 'implied', dir: -1, picked: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function chainLabel(p) {
    return p.chains && p.chains.length ? p.chains[0] : 'an unnamed chain';
  }

  // The value model, as the page recomputes it: the same four factors the
  // program used, read from the row's own breakdown, so a stale board shows.
  function recomputed(row) {
    var s = row.score;
    var growth = 1 + (s.growth_pct / 100) * 0.6;
    return Math.max(1, Math.round(row.tvl_usd * s.multiple * growth * s.maturity_factor * s.breadth_factor));
  }

  // The farm plan, derived in the page from the row itself — category, chain,
  // TVL and age — so the detail panel and board.json carry the same plan.
  function stakeFor(row) {
    if (row.tvl_usd >= 2e9) return 300;
    if (row.tvl_usd >= 5e8) return 200;
    if (row.tvl_usd >= 1e8) return 120;
    if (row.tvl_usd >= 2e7) return 75;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 120) return 90;
    if (age < 365) return 60;
    if (age < 730) return 45;
    return 30;
  }
  function coreAction(row, stake, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + stake + ' of USDC as collateral to ' + name + ' on ' + chain + ', borrow $25 of a stablecoin against it, and keep both legs open.';
    if (c.indexOf('leveraged farm') >= 0) return 'Open a $' + stake + ' leveraged farming position in ' + name + ' on ' + chain + ' at 2x leverage and keep the health factor above 1.5.';
    if (c.indexOf('dex') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Add $' + stake + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' (half USDC, half the paired asset) and stake the LP receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + stake + ' of USDC as margin on ' + name + ' on ' + chain + ', open a $50 hedge, and close it after a week.';
    if (c.indexOf('yield') >= 0 || c.indexOf('aggregator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('curator') >= 0) return 'Deposit $' + stake + ' of USDC into a ' + name + ' vault on ' + chain + ' and hold the vault shares instead of trading them.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) return "Stake $" + stake + " of the chain's native staking asset through " + name + ' on ' + chain + ' and keep the liquid receipt in the same wallet.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + stake + ' of USDC into ' + chain + ' through ' + name + ', then use the bridged funds in one app on ' + chain + '.';
    if (c.indexOf('prediction') >= 0) return 'Fund ' + name + ' with $' + stake + ' on ' + chain + ' and take one $10 position in a market that settles within two weeks.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + stake + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it for the full accrual period.';
    if (c.indexOf('stable') >= 0 || c.indexOf('anchor') >= 0) return 'Mint $' + stake + ' of the stable asset through ' + name + ' on ' + chain + ' and keep it in the wallet that minted it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + stake + ' of cover from ' + name + ' on ' + chain + ' for a position you already hold, and keep the policy active.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $25 through ' + name + ' on ' + chain + ' for a real purchase and keep the receipt in the app.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + stake + ' of assets in ' + name + "'s governance on " + chain + ' and vote on the next live proposal.';
    if (c.indexOf('index') >= 0) return 'Buy $' + stake + ' of the ' + name + ' index token on ' + chain + ' and hold it instead of the single assets.';
    if (c.indexOf('basis') >= 0 || c.indexOf('cedefi') >= 0) return 'Deposit $' + stake + " of USDC into " + name + "'s basis strategy on " + chain + ' and leave the position through one funding cycle.';
    return 'Deposit $' + stake + ' of USDC into ' + name + ' on ' + chain + ' and use its main feature once a week.';
  }
  function secondAction(row, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Repay $10 of the borrow on ' + name + ' after two weeks, then borrow $10 again so the wallet shows repeat use.';
    if (c.indexOf('dex') >= 0 || c.indexOf('farm') >= 0) return 'Swap $20 between two assets on ' + name + ' on ' + chain + ' once a week, using a different pair the second week.';
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Move $25 between two ' + name + ' vaults on ' + chain + ' after a month to show the wallet is actively managed.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Place one limit order on ' + name + ' on ' + chain + ' each week, even a $10 one, so the account has maker activity.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Delegate a second $25 stake through ' + name + ' on ' + chain + ' after the first month and keep both receipts.';
    if (c.indexOf('prediction') >= 0) return 'Take a second $10 position on ' + name + ' on the opposite side of a market you already entered.';
    if (c.indexOf('rwa') >= 0) return 'Reinvest one month of ' + name + ' yield on ' + chain + ' back into the same asset instead of withdrawing it.';
    return 'Use a second feature of ' + name + ' on ' + chain + ' once a month, such as its swap, its vote, or its rewards page.';
  }
  function farmPlan(row) {
    var chain = chainLabel(row);
    var stake = stakeFor(row);
    var hold = holdFor(row.age_days);
    var gas = stake >= 200 ? 8 : 5;
    return [
      'Set up a fresh wallet for ' + row.name + ' farming only, fund it with $' + (stake + 25) + ' on ' + chain + ', and store the seed phrase offline on paper. Cost: about $' + gas + ' of gas for the funding transfer. Time: 10 minutes.',
      coreAction(row, stake, chain) + ' Cost: $' + stake + ' of capital plus about $' + gas + ' of gas. Time: 20 minutes to set up.',
      secondAction(row, chain) + ' Cost: about $3 of gas per action. Time: 10 minutes a week.',
      'Keep the ' + row.name + ' position open for at least ' + hold + ' days and do one qualifying action each week, so the wallet appears in more than one activity snapshot. Cost: the $' + stake + ' stays locked in the position. Time: ' + hold + ' days, 10 minutes a week.',
      "Join " + row.name + "'s community channel and read the last two announcements before you act, so you use the live product and not a copy. Cost: nothing. Time: 15 minutes.",
      'Before withdrawing, open ' + row.name + "'s own rewards or points page from the app itself and claim only through the link it publishes there. Cost: no fee to check; never pay anyone to claim. Time: 10 minutes.",
      'Log the wallet address, the dates, and every ' + row.name + ' transaction in a farm notebook, then unwind in reverse order if the position turns against you. Cost: nothing but the notebook. Time: 5 minutes.'
    ];
  }

  function $(id) { return document.getElementById(id); }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }
  function renderBoard() {
    var body = $('rows');
    body.textContent = '';
    var list = sortedRows(visibleRows());
    $('empty').hidden = list.length > 0;
    $('count').textContent = state.tab === 'pre'
      ? list.length + ' of ' + DATA.rows.length + ' rows shown'
      : DATA.live.length + ' live-token protocols';
    var top = (sortedRows(DATA.rows)[0] || {}).implied_value_usd || 1;
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      if (state.picked === r.slug) tr.className = 'selected';
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } });
      tr.appendChild(cell(String(r.rank), 'num'));
      var nameTd = document.createElement('td');
      nameTd.className = 'name-cell';
      var b = document.createElement('b');
      b.textContent = r.name;
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = (r.category || 'Other') + ' · ' + (r.chains || []).slice(0, 2).join(', ');
      nameTd.appendChild(b);
      nameTd.appendChild(sub);
      tr.appendChild(nameTd);
      tr.appendChild(cell(usd(r.tvl_usd), 'num'));
      var g = cell(pct(r.change_7d), 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'));
      tr.appendChild(g);
      tr.appendChild(cell(ageLabel(r.age_days), 'num'));
      var imp = document.createElement('td');
      var bar = document.createElement('span');
      bar.className = 'bar';
      bar.setAttribute('aria-hidden', 'true');
      var fill = document.createElement('i');
      fill.style.width = Math.max(3, Math.round((r.implied_value_usd / top) * 100)) + '%';
      bar.appendChild(fill);
      var val = document.createElement('span');
      val.className = 'num';
      val.textContent = usd(r.implied_value_usd);
      imp.appendChild(bar);
      imp.appendChild(val);
      tr.appendChild(imp);
      var tok = document.createElement('td');
      var pill = document.createElement('span');
      pill.className = 'pill' + (r.watchlist ? ' watch' : '');
      pill.textContent = r.watchlist ? 'watchlist' : 'records no token';
      tok.appendChild(pill);
      tr.appendChild(tok);
      body.appendChild(tr);
    });
  }

  function renderLive() {
    var body = $('live-rows');
    body.textContent = '';
    DATA.live.forEach(function (r) {
      var tr = document.createElement('tr');
      var nameTd = document.createElement('td');
      nameTd.className = 'name-cell';
      var b = document.createElement('b');
      b.textContent = r.name;
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = (r.category || 'Other') + ' · ' + (r.chains || []).slice(0, 2).join(', ');
      nameTd.appendChild(b);
      nameTd.appendChild(sub);
      tr.appendChild(nameTd);
      tr.appendChild(cell(usd(r.tvl_usd), 'num'));
      tr.appendChild(cell(pct(r.change_7d), 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down')));
      tr.appendChild(cell(usd(r.mcap_usd), 'num'));
      var tok = document.createElement('td');
      var pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = 'already trades';
      tok.appendChild(pill);
      tr.appendChild(tok);
      body.appendChild(tr);
    });
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.picked = slug;
    writeHash();
    $('detail').hidden = false;
    $('d-rank').textContent = 'Rank ' + row.rank + ' of ' + DATA.rows.length + (row.watchlist ? ' · watchlist' : '');
    $('d-name').textContent = row.name;
    $('d-sub').textContent = (row.category || 'Other') + ' on ' + (row.chains || []).join(', ') + ' · first listed ' + (row.listed_at || 'unknown') + ' · records no token';
    var s = row.score;
    var facts = [
      ['TVL', usd(row.tvl_usd)],
      ['Seven-day growth', pct(row.change_7d)],
      ['Age with no token', ageLabel(row.age_days)],
      ['Market multiple (mcap / TVL)', s.multiple.toFixed(4)],
      ['Growth factor', s.growth_factor.toFixed(4)],
      ['Maturity factor', s.maturity_factor.toFixed(4)],
      ['Chain breadth factor', s.breadth_factor.toFixed(4)],
      ['Implied value', usd(row.implied_value_usd)]
    ];
    var box = $('d-break');
    box.textContent = '';
    facts.forEach(function (pair) {
      var div = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = pair[0];
      var dd = document.createElement('dd');
      dd.textContent = pair[1];
      div.appendChild(dt);
      div.appendChild(dd);
      box.appendChild(div);
    });
    var again = recomputed(row);
    $('d-check').textContent = 'The page recomputes this row as ' + usd(again) +
      (again === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board, so the data would be stale.') +
      ' An estimate, not a price.';
    var list = $('d-steps');
    list.textContent = '';
    var steps = row.farm_steps && row.farm_steps.length ? row.farm_steps : farmPlan(row);
    steps.forEach(function (text) {
      var li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    renderBoard();
    $('detail').scrollTop = 0;
  }
  function closeDetail() {
    state.picked = null;
    $('detail').hidden = true;
    writeHash();
    renderBoard();
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.picked = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'pre') params.set('tab', state.tab);
    if (state.picked) params.set('p', state.picked);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function fillSelect(id, values) {
    var select = $(id);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
  }
  function setTab(tab) {
    state.tab = tab;
    $('tab-pre').classList.toggle('active', tab === 'pre');
    $('tab-live').classList.toggle('active', tab === 'live');
    $('tab-pre').setAttribute('aria-pressed', tab === 'pre' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-pressed', tab === 'live' ? 'true' : 'false');
    $('board-table').style.display = tab === 'pre' ? '' : 'none';
    $('live-table').style.display = tab === 'live' ? '' : 'none';
    writeHash();
    renderBoard();
  }

  function init() {
    $('snap-date').textContent = 'Snapshot ' + DATA.as_of;
    $('model-tag').textContent = DATA.model_version + ' model';
    $('foot-model').textContent = DATA.model_version;
    $('foot-date').textContent = DATA.as_of;
    $('stat-rows').textContent = String(DATA.rows.length);
    $('stat-watch').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    $('stat-mult').textContent = DATA.multiple + 'x';
    $('stat-tvl').textContent = usd(DATA.total_tvl_usd);
    $('formula').textContent = 'implied = round( tvl_usd x ' + DATA.multiple +
      ' [median mcap/TVL of the snapshot\'s token protocols] x (1 + clamp(change_7d, -40, 80) / 100 x 0.6)' +
      ' x (0.75 + min(age_days, 1460) / 1460 x 0.50) x (1 + min(chains - 1, 4) x 0.03) )';
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    fillSelect('category', categories);
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    fillSelect('chain', chains);

    readHash();
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('min-tvl').value = String(state.minTvl);
    $('watch-only').checked = state.watchOnly;

    $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); renderBoard(); });
    $('category').addEventListener('change', function () { state.category = $('category').value; writeHash(); renderBoard(); });
    $('chain').addEventListener('change', function () { state.chain = $('chain').value; writeHash(); renderBoard(); });
    $('min-tvl').addEventListener('change', function () { state.minTvl = Number($('min-tvl').value) || 0; writeHash(); renderBoard(); });
    $('watch-only').addEventListener('change', function () { state.watchOnly = $('watch-only').checked; writeHash(); renderBoard(); });
    $('clear-filters').addEventListener('click', function () {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false;
      $('q').value = ''; $('category').value = 'all'; $('chain').value = 'all'; $('min-tvl').value = '0'; $('watch-only').checked = false;
      writeHash(); renderBoard();
    });
    $('tab-pre').addEventListener('click', function () { setTab('pre'); });
    $('tab-live').addEventListener('click', function () { setTab('live'); });
    $('d-close').addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('detail').hidden) closeDetail(); });
    var sortButtons = document.querySelectorAll('th button[data-sort]');
    sortButtons.forEach(function (btn) {
      var arrow = document.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      btn.appendChild(arrow);
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        sortButtons.forEach(function (b) {
          b.classList.toggle('sorted', b === btn);
          b.querySelector('span').textContent = b === btn ? (state.dir < 0 ? ' v' : ' ^') : '';
        });
        renderBoard();
      });
    });
    $('live-table').style.display = 'none';
    renderLive();
    renderBoard();
    if (state.tab === 'live') setTab('live');
    if (state.picked) openDetail(state.picked);
  }

  init();
})();
