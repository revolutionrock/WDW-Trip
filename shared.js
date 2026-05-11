let rides = [], shows = [], characters = [], dining = [];
let currentView = 'rides';
let rideSort = { col: 'wait', dir: 1 };
let showSort = { col: 'next', dir: 1 };
let characterSort = { col: 'wait', dir: 1 };
let diningSort = { col: 'wait', dir: 1 };

function parseLl(queue) {
  if (!queue) return { type: null };
  if (queue.RETURN_TIME) {
    const rt = queue.RETURN_TIME;
    return { type: 'free', state: rt.state, time: rt.returnStart };
  }
  if (queue.PAID_RETURN_TIME) {
    const rt = queue.PAID_RETURN_TIME;
    return { type: 'paid', state: rt.state, time: rt.returnStart, price: rt.price?.formatted ?? null };
  }
  return { type: null };
}

function trendArrow(forecast) {
  if (!forecast?.length) return '';
  const now = Date.now();
  const future = forecast.filter(f => new Date(f.time) > now).slice(0, 2);
  if (future.length < 2) return '';
  const diff = future[1].waitTime - future[0].waitTime;
  if (diff >= 5) return '<span class="trend up">▲</span>';
  if (diff <= -5) return '<span class="trend down">▼</span>';
  return '';
}

function fmt12(isoStr) {
  return new Date(isoStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function load() {
  const res = await fetch(API_URL);
  const data = await res.json();

  const timestamps = (data.liveData || [])
    .map(e => e.lastUpdated ? new Date(e.lastUpdated).getTime() : 0)
    .filter(t => t > 0);
  const latest = timestamps.length ? Math.max(...timestamps) : null;
  document.getElementById('updated').textContent = latest
    ? 'Last updated: ' + new Date(latest).toLocaleTimeString()
    : '';

  const now = Date.now();
  rides = (data.liveData || [])
    .filter(e => e.entityType === 'ATTRACTION')
    .map(e => ({
      id: e.id,
      name: e.name,
      wait: e.queue?.STANDBY?.waitTime ?? null,
      ll: parseLl(e.queue),
      forecast: e.forecast ?? null,
      status: e.status,
    }));

  const showEntities = (data.liveData || []).filter(e => e.entityType === 'SHOW');
  characters = showEntities
    .filter(e => e.queue?.STANDBY?.waitTime !== undefined)
    .map(e => ({
      name: e.name,
      wait: e.queue.STANDBY.waitTime,
      status: e.status,
    }));
  const characterIds = new Set(characters.map(c => c.name));
  shows = showEntities
    .filter(e => !characterIds.has(e.name))
    .map(e => {
      const times = (e.showtimes || []).map(s => s.startTime).sort();
      const next = times.find(t => new Date(t) > now) ?? null;
      return { name: e.name, times, next, status: e.status };
    });

  dining = (data.liveData || [])
    .filter(e => e.entityType === 'RESTAURANT')
    .map(e => ({
      name: e.name,
      wait: e.queue?.STANDBY?.waitTime ?? null,
      status: e.status,
    }));

  render();
}

function rideWaitValue(r) {
  if (r.status !== 'OPERATING') return Infinity;
  if (r.wait === null) return -1;
  return r.wait;
}

function llSortValue(r) {
  const { type, state, time } = r.ll;
  if (!type) return Number.MAX_SAFE_INTEGER;
  if (state !== 'AVAILABLE') return Number.MAX_SAFE_INTEGER - 1;
  return time ? new Date(time).getTime() : 0;
}

function renderRides() {
  const q = document.getElementById('search').value.toLowerCase();
  const maxWait = parseInt(document.getElementById('waitFilter').value);

  let filtered = rides.filter(r => {
    if (!r.name.toLowerCase().includes(q)) return false;
    if (maxWait > 0 && (r.wait === null || r.wait > maxWait)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const { col, dir } = rideSort;
    if (col === 'wait') return dir * (rideWaitValue(a) - rideWaitValue(b));
    if (col === 'll') return dir * (llSortValue(a) - llSortValue(b));
    return dir * a.name.localeCompare(b.name);
  });

  document.getElementById('count').textContent = `Showing ${filtered.length} of ${rides.length} rides`;

  document.getElementById('ridesTbody').innerHTML = filtered.map(r => {
    const operating = r.status === 'OPERATING';

    let waitHtml;
    if (!operating) {
      waitHtml = '<span class="wait unavail">Closed</span>';
    } else {
      const w = r.wait;
      const cls = w === null ? 'low' : w <= 20 ? 'low' : w <= 45 ? 'mid' : 'high';
      const waitText = w !== null ? w + ' min' : 'No wait';
      waitHtml = `<span class="wait ${cls}">${waitText}</span>${trendArrow(r.forecast)}`;
    }

    let llHtml;
    const { type, state, time } = r.ll;
    if (!type) {
      llHtml = '<span class="ll none">N/A</span>';
    } else if (state === 'AVAILABLE') {
      const label = time ? fmt12(time) : 'Available';
      llHtml = `<span class="ll free">${label}${type === 'paid' ? '*' : ''}</span>`;
    } else {
      llHtml = '<span class="ll full">Full</span>';
    }

    const loc = LOCATIONS[r.name];
    const nameHtml = loc
      ? `<a class="ride-link" href="https://maps.google.com/?q=${loc.lat},${loc.lng}" target="_blank">${r.name}</a>`
      : `<a class="ride-link" href="#" onclick="locateRide('${r.id}',this);return false;">${r.name}</a>`;
    const heightHtml = HEIGHT_REQS[r.name]
      ? ` <span style="font-size:0.78rem;color:#888;">(>${HEIGHT_REQS[r.name]}")</span>`
      : '';

    return `<tr>
      <td>${nameHtml}${heightHtml}</td>
      <td class="td-nowrap">${waitHtml}</td>
      <td class="td-nowrap">${llHtml}</td>
    </tr>`;
  }).join('');
}

function renderShows() {
  const q = document.getElementById('search').value.toLowerCase();
  const now = Date.now();

  let filtered = shows.filter(s => s.name.toLowerCase().includes(q));

  filtered.sort((a, b) => {
    const { col, dir } = showSort;
    if (col === 'next') {
      const av = a.next ? new Date(a.next).getTime() : Infinity;
      const bv = b.next ? new Date(b.next).getTime() : Infinity;
      return dir * (av - bv);
    }
    return dir * a.name.localeCompare(b.name);
  });

  document.getElementById('count').textContent = `Showing ${filtered.length} of ${shows.length} shows`;

  document.getElementById('showsTbody').innerHTML = filtered.map(s => {
    const upcoming = s.times.filter(t => new Date(t) > now).slice(0, 3);
    const timesHtml = upcoming.length ? upcoming.map(t => fmt12(t)).join('  ·  ') : '—';
    return `<tr>
      <td>${s.name}</td>
      <td class="td-nowrap"><div class="showtime-list">${timesHtml}</div></td>
    </tr>`;
  }).join('');
}

function renderDining() {
  const q = document.getElementById('search').value.toLowerCase();
  const maxWait = parseInt(document.getElementById('waitFilter').value);

  let filtered = dining.filter(r => {
    if (!r.name.toLowerCase().includes(q)) return false;
    if (maxWait > 0 && (r.wait === null || r.wait > maxWait)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const { col, dir } = diningSort;
    if (col === 'wait') return dir * (rideWaitValue(a) - rideWaitValue(b));
    return dir * a.name.localeCompare(b.name);
  });

  document.getElementById('count').textContent = `Showing ${filtered.length} of ${dining.length} restaurants`;

  document.getElementById('diningTbody').innerHTML = filtered.map(r => {
    const operating = r.status === 'OPERATING';
    let waitHtml;
    if (!operating) {
      waitHtml = '<span class="wait unavail">Closed</span>';
    } else {
      const w = r.wait;
      const cls = w === null ? 'low' : w <= 20 ? 'low' : w <= 45 ? 'mid' : 'high';
      const waitText = w !== null ? w + ' min' : 'No wait';
      waitHtml = `<span class="wait ${cls}">${waitText}</span>`;
    }
    return `<tr>
      <td>${r.name}</td>
      <td>${waitHtml}</td>
    </tr>`;
  }).join('');
}

function renderCharacters() {
  const q = document.getElementById('search').value.toLowerCase();
  const maxWait = parseInt(document.getElementById('waitFilter').value);

  let filtered = characters.filter(c => {
    if (!c.name.toLowerCase().includes(q)) return false;
    if (maxWait > 0 && (c.wait === null || c.wait > maxWait)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const { col, dir } = characterSort;
    if (col === 'wait') return dir * (rideWaitValue(a) - rideWaitValue(b));
    return dir * a.name.localeCompare(b.name);
  });

  document.getElementById('count').textContent = `Showing ${filtered.length} of ${characters.length} characters`;

  document.getElementById('charactersTbody').innerHTML = filtered.map(c => {
    const operating = c.status === 'OPERATING';
    let waitHtml;
    if (!operating) {
      waitHtml = '<span class="wait unavail">Closed</span>';
    } else {
      const w = c.wait;
      const cls = w === null ? 'low' : w <= 20 ? 'low' : w <= 45 ? 'mid' : 'high';
      const waitText = w !== null ? w + ' min' : 'No wait';
      waitHtml = `<span class="wait ${cls}">${waitText}</span>`;
    }
    return `<tr>
      <td>${c.name}</td>
      <td class="td-nowrap">${waitHtml}</td>
    </tr>`;
  }).join('');
}

function render() {
  if (currentView === 'rides') renderRides();
  else if (currentView === 'shows') renderShows();
  else if (currentView === 'characters') renderCharacters();
  else renderDining();
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('ridesWrap').classList.toggle('hidden', view !== 'rides');
  document.getElementById('showsWrap').classList.toggle('hidden', view !== 'shows');
  document.getElementById('charactersWrap').classList.toggle('hidden', view !== 'characters');
  document.getElementById('diningWrap').classList.toggle('hidden', view !== 'dining');
  document.getElementById('waitFilter').style.display = (view === 'rides' || view === 'characters' || view === 'dining') ? '' : 'none';
  document.getElementById('viewSelect').value = view;
  render();
}

function applySortUI(tableId, sortState) {
  document.querySelectorAll(`#${tableId} th`).forEach(t => {
    t.classList.remove('active');
    if (t.querySelector('.arrow')) t.querySelector('.arrow').textContent = '';
  });
  const active = document.querySelector(`#${tableId} th[data-col="${sortState.col}"]`);
  if (active) {
    active.classList.add('active');
    if (active.querySelector('.arrow'))
      active.querySelector('.arrow').textContent = sortState.dir === -1 ? '▼' : '▲';
  }
}

document.getElementById('search').addEventListener('input', render);
document.getElementById('waitFilter').addEventListener('change', render);
document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
document.getElementById('viewSelect').addEventListener('change', e => setView(e.target.value));

document.querySelectorAll('#ridesTable th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    rideSort.dir = rideSort.col === col ? rideSort.dir * -1 : 1;
    rideSort.col = col;
    applySortUI('ridesTable', rideSort);
    renderRides();
  });
});

document.querySelectorAll('#showsTable th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    showSort.dir = showSort.col === col ? showSort.dir * -1 : 1;
    showSort.col = col;
    applySortUI('showsTable', showSort);
    renderShows();
  });
});

document.querySelectorAll('#diningTable th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    diningSort.dir = diningSort.col === col ? diningSort.dir * -1 : 1;
    diningSort.col = col;
    applySortUI('diningTable', diningSort);
    renderDining();
  });
});

document.querySelectorAll('#charactersTable th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    characterSort.dir = characterSort.col === col ? characterSort.dir * -1 : 1;
    characterSort.col = col;
    applySortUI('charactersTable', characterSort);
    renderCharacters();
  });
});

applySortUI('ridesTable', rideSort);
applySortUI('showsTable', showSort);
applySortUI('charactersTable', characterSort);
applySortUI('diningTable', diningSort);
load();

const locationCache = {};
async function locateRide(id, el) {
  if (locationCache[id]) {
    window.open(`https://maps.google.com/?q=${locationCache[id].lat},${locationCache[id].lng}`, '_blank');
    return;
  }
  el.classList.add('loading');
  try {
    const data = await fetch(`https://api.themeparks.wiki/v1/entity/${id}`).then(r => r.json());
    const lat = data.location?.latitude, lng = data.location?.longitude;
    if (lat && lng) {
      locationCache[id] = { lat, lng };
      window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
    }
  } finally {
    el.classList.remove('loading');
  }
}

function toggleMenu() {
  document.getElementById('parkMenu').classList.toggle('open');
}
document.addEventListener('click', e => {
  if (!document.getElementById('parkHeading').contains(e.target)) {
    document.getElementById('parkMenu').classList.remove('open');
  }
});
