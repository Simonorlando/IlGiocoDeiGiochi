const DATA_BASE = './data';

const state = {
  competition: null,       // 'serie_a' | 'champions_league'
  index: null,             // contenuto di index.json per la competizione scelta
  match: null,             // dati completi della partita corrente
  players: {},             // player_id -> dati giocatore
  solved: {},              // player_id -> true se indovinato
  currentCardPlayerId: null,
  currentHints: [],        // indizi della card aperta al momento
  openHints: new Set(),    // id degli indizi espansi al momento
  // stato navigazione giornate (schermata manuale)
  manualRounds: [],        // [{round, label, matches, minDate}]
  manualRoundIdx: 0,
};

const COMP_DIR = { serie_a: 'serie-a', champions_league: 'champions-league' };
const COMP_LABEL = { serie_a: 'Serie A', champions_league: 'Champions League' };

const ROUND_LABELS = {
  '8th Finals': 'Ottavi di finale',
  'Round of 16': 'Ottavi di finale',
  'Quarter-finals': 'Quarti di finale',
  'Semi-finals': 'Semifinale',
  'Final': 'Finale',
};

// Colori societari (maglia principale) usati per colorare i pallini in
// campo -- chiave = parola significativa del nome squadra, valore = colore.
// Il default (nessuna corrispondenza) resta il grigio neutro di prima.
const DEFAULT_DOT_COLOR = '#8a8f99';
// per le squadre bicolori con il nero fra i colori sociali, uso sempre
// l'altro colore (piu' chiaro/riconoscibile) invece del nero -- su un
// pallino piccolo il nero si confonde troppo con lo sfondo scuro dell'app.
const TEAM_COLORS = {
  juventus: '#f2f2f2', milan: '#fb090b', inter: '#010e80', roma: '#8e1f2f',
  napoli: '#12a3d6', lazio: '#87cefa', fiorentina: '#5c2d91', atalanta: '#1e3d59',
  torino: '#881c1c', sampdoria: '#1e3d8f', genoa: '#b71234', udinese: '#f2f2f2',
  bologna: '#7a263a', cagliari: '#b3122a', parma: '#f9d616', verona: '#f7d417',
  sassuolo: '#0e7c3a', empoli: '#005baa', spezia: '#f2f2f2', salernitana: '#8c1d40',
  lecce: '#ffd400', frosinone: '#ffcc00', cremonese: '#8b0000', monza: '#d1001f',
  como: '#003399', venezia: '#1b5e20', cesena: '#f2f2f2', catania: '#c8102e',
  chievo: '#ffd400', palermo: '#f7a8b8', bari: '#c8102e', brescia: '#0033a0',
  pescara: '#87cefa', crotone: '#c8102e', benevento: '#ffd400', reggina: '#8b0000',
  novara: '#6cabdd', siena: '#f2f2f2', livorno: '#b3122a', bergamo: '#1e3d59',

  barcelona: '#004d98', atletico: '#ce3524', bayern: '#dc052d', dortmund: '#fde100',
  leipzig: '#dd0741', leverkusen: '#e32221', manchester: '#da291c', liverpool: '#c8102e',
  chelsea: '#034694', arsenal: '#ef0107', tottenham: '#132257', ajax: '#d2122e',
  eindhoven: '#ee2530', feyenoord: '#e2231a', porto: '#003c7d', benfica: '#e30613',
  sporting: '#007a3d', shakhtar: '#ff6600', kyiv: '#005baa', zenit: '#0057a8',
  cska: '#c8102e', basel: '#e2001a', celtic: '#018749', rangers: '#1c3f94',
  olympiakos: '#d2122e', olympiacos: '#d2122e', galatasaray: '#fdb913', fenerbahce: '#ffe000',
  besiktas: '#f2f2f2', brugge: '#0033a0', anderlecht: '#4b1e78', monaco: '#cc0000',
  lyon: '#0e3399', marseille: '#009de0', lille: '#d0021b', sevilla: '#d2001c',
  valencia: '#ee7203', villarreal: '#ffe500', sociedad: '#0067b1', bilbao: '#ee2523',
  leicester: '#003090', wolfsburg: '#65b32e', schalke: '#004e9e', hoffenheim: '#1c63b7',
  frankfurt: '#e1000f', union: '#eb1923', freiburg: '#e1000f', stuttgart: '#e0001b',
  gladbach: '#f2f2f2', copenhagen: '#d21f34', salzburg: '#ec0e37', psg: '#004170',
  paris: '#004170', wolfsberger: '#65b32e', midtjylland: '#ffd400', slavia: '#a4132c',
  dynamo: '#005baa', braga: '#dc052d',
};

// squadre distinguibili solo per PIU' parole insieme (altrimenti ambigue
// con un'unica parola, es. "Real Madrid" vs "Real Sociedad" vs "Real Betis").
const TEAM_COLORS_MULTI = [
  { words: ['real', 'madrid'], color: '#febe10' },
  { words: ['real', 'sociedad'], color: '#0067b1' },
  { words: ['real', 'betis'], color: '#00954c' },
  { words: ['manchester', 'city'], color: '#6cabdd' },
  { words: ['manchester', 'united'], color: '#da291c' },
];

function teamColor(teamName) {
  const words = teamName.split(/\s+/).map(normalizeName).filter(w => w.length >= 4);
  for (const entry of TEAM_COLORS_MULTI) {
    if (entry.words.every(w => words.includes(w))) return entry.color;
  }
  for (const w of words) {
    if (TEAM_COLORS[w]) return TEAM_COLORS[w];
  }
  return DEFAULT_DOT_COLOR;
}

// segno di spunta scuro sui pallini chiari, bianco su quelli scuri
function contrastingCheckColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
}

// ---------- utilita' ----------

function normalizeName(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function seasonLabel(season) {
  return `${season}-${String(season + 1).slice(-2)}`;
}

function roundLabel(round) {
  if (!round) return 'Turno sconosciuto';
  const m = round.match(/Regular Season - (\d+)/);
  if (m) return `Giornata ${m[1]}`;
  return ROUND_LABELS[round] || round;
}

// Cronologia di navigazione, per la freccia "indietro" universale in alto a
// sinistra: ogni cambio schermata (tranne il tornare indietro stesso) mette
// in pila la schermata di provenienza.
const screenHistory = [];

function showScreen(id, { fromBack = false } = {}) {
  const current = document.querySelector('.screen.active');
  if (!fromBack && current && current.id !== id) screenHistory.push(current.id);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  updateBackButton();
}

function goBack() {
  const prev = screenHistory.pop();
  if (prev) showScreen(prev, { fromBack: true });
}

function updateBackButton() {
  const btn = document.getElementById('globalBackBtn');
  if (!btn) return;
  btn.classList.toggle('hidden', screenHistory.length === 0);
}

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch fallita: ${url}`);
  return resp.json();
}

// ---------- suggerimenti nomi (autocomplete personalizzato, contro errori di battitura) ----------
// Uso l'intero database giocatori (non solo quelli della partita in corso)
// cosi' i suggerimenti non rivelano mai chi sia il giocatore giusto. Lista
// personalizzata (non il datalist nativo del browser) cosi' resta dentro
// lo stile della card invece di apparire come popup di sistema fuori tema.

let playerNamesPromise = null;
function loadAllPlayerNames() {
  if (!playerNamesPromise) {
    playerNamesPromise = fetchJson(`${DATA_BASE}/players_names.json`);
  }
  return playerNamesPromise;
}
loadAllPlayerNames();

function setupSuggestions() {
  const input = document.getElementById('guessInput');
  const list = document.getElementById('suggestList');

  input.addEventListener('input', async () => {
    const raw = input.value.trim();
    if (raw.length < 2) { list.classList.add('hidden'); list.innerHTML = ''; return; }

    const names = await loadAllPlayerNames();
    const q = normalizeName(raw);

    // mostro l'IDENTITA' COMPLETA (nome+cognome), mai un nome isolato --
    // altrimenti il suggerimento stesso rivelerebbe una risposta parziale
    // accettabile. Il confronto e' su ciascuna parola del nome (cosi'
    // digitare il cognome trova comunque il giocatore giusto), lista libera
    // senza limite fisso di risultati.
    const matches = [];
    for (const n of names) {
      const tokens = n.split(/\s+/).map(normalizeName).filter(t => t.length >= 2);
      if (!tokens.some(t => t.startsWith(q))) continue;
      matches.push(n);
    }

    if (matches.length === 0) { list.classList.add('hidden'); list.innerHTML = ''; return; }
    list.innerHTML = matches.map(n => `<div class="suggest-item">${escapeHtml(n)}</div>`).join('');
    list.classList.remove('hidden');
    list.querySelectorAll('.suggest-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = item.textContent;
        list.classList.add('hidden');
        input.focus();
      });
    });
  });

  input.addEventListener('blur', () => {
    setTimeout(() => list.classList.add('hidden'), 120);
  });
  input.addEventListener('focus', () => {
    if (list.innerHTML) list.classList.remove('hidden');
  });
}
setupSuggestions();

// ---------- schermata 0: titolo ----------

document.getElementById('startFromTitle').addEventListener('click', () => showScreen('screen-competition'));
document.getElementById('brandHome').addEventListener('click', () => showScreen('screen-competition'));
document.getElementById('globalBackBtn').addEventListener('click', () => goBack());

// ---------- schermata 1: competizione ----------

document.querySelectorAll('.big-choice').forEach(btn => {
  btn.addEventListener('click', async () => {
    state.competition = btn.dataset.comp;
    state.index = await fetchJson(`${DATA_BASE}/${COMP_DIR[state.competition]}/index.json`);
    showScreen('screen-mode');
  });
});

document.getElementById('backToCompetition').addEventListener('click', () => goBack());

// ---------- schermata 2: modalita' ----------

document.querySelectorAll('.mode-choice').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === 'random') {
      startRandomMatch(state.index);
    } else if (mode === 'year-random') {
      prepareYearsScreen();
      showScreen('screen-years');
    } else if (mode === 'manual') {
      prepareManualScreen();
      showScreen('screen-manual');
    }
  });
});

// ---------- schermata 3a: intervallo anni ----------

function prepareYearsScreen() {
  const seasons = [...new Set(state.index.map(m => m.season))].sort((a, b) => a - b);
  const fromSel = document.getElementById('yearFrom');
  const toSel = document.getElementById('yearTo');
  fromSel.innerHTML = seasons.map(s => `<option value="${s}">${seasonLabel(s)}</option>`).join('');
  toSel.innerHTML = seasons.map(s => `<option value="${s}">${seasonLabel(s)}</option>`).join('');
  toSel.value = seasons[seasons.length - 1];
}

document.getElementById('generateFromYears').addEventListener('click', () => {
  const from = Number(document.getElementById('yearFrom').value);
  const to = Number(document.getElementById('yearTo').value);
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const pool = state.index.filter(m => m.season >= lo && m.season <= hi);
  startRandomMatch(pool);
});

document.getElementById('backToModeFromYears').addEventListener('click', () => goBack());

// ---------- schermata 3b: scelta manuale (con navigazione per giornata) ----------

function prepareManualScreen() {
  const seasons = [...new Set(state.index.map(m => m.season))].sort((a, b) => a - b);
  const yearSel = document.getElementById('manualYear');
  yearSel.innerHTML = seasons.map(s => `<option value="${s}">${seasonLabel(s)}</option>`).join('');
  yearSel.onchange = () => loadRoundsForYear(Number(yearSel.value));
  loadRoundsForYear(seasons[0]);
}

function formatDateShort(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function dateRangeLabel(matches) {
  const dates = matches.map(m => m.date).filter(Boolean).sort();
  if (dates.length === 0) return '';
  const first = formatDateShort(dates[0]);
  const last = formatDateShort(dates[dates.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

function loadRoundsForYear(year) {
  const matches = state.index.filter(m => m.season === year);
  const groups = {};
  matches.forEach(m => {
    (groups[m.round] ||= []).push(m);
  });
  state.manualRounds = Object.keys(groups)
    .map(r => {
      const roundMatches = groups[r].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      return {
        round: r,
        label: roundLabel(r),
        dateRange: dateRangeLabel(roundMatches),
        matches: roundMatches,
        minDate: Math.min(...roundMatches.map(m => m.date ? new Date(m.date).getTime() : 0)),
      };
    })
    .sort((a, b) => a.minDate - b.minDate);
  state.manualRoundIdx = 0;
  fillRoundSelect();
  fillManualMatches();
}

function fillRoundSelect() {
  const sel = document.getElementById('manualRound');
  sel.innerHTML = state.manualRounds.map((r, i) =>
    `<option value="${i}">${r.label}</option>`
  ).join('');
  sel.value = state.manualRoundIdx;

  const round = state.manualRounds[state.manualRoundIdx];
  document.getElementById('roundDateRange').textContent = round?.dateRange || '';
}

function fillManualMatches() {
  const round = state.manualRounds[state.manualRoundIdx];
  const list = document.getElementById('manualMatch');
  state.selectedManualFixture = null;
  document.getElementById('startManualMatch').disabled = true;

  if (!round) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = round.matches.map(m =>
    `<div class="match-item" data-fixture-id="${m.fixture_id}">${escapeHtml(m.home)} — ${escapeHtml(m.away)}</div>`
  ).join('');
  list.querySelectorAll('.match-item').forEach(item => {
    item.addEventListener('click', () => {
      list.querySelectorAll('.match-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      state.selectedManualFixture = Number(item.dataset.fixtureId);
      document.getElementById('startManualMatch').disabled = false;
    });
  });
  document.getElementById('roundPrev').disabled = state.manualRoundIdx === 0;
  document.getElementById('roundNext').disabled = state.manualRoundIdx === state.manualRounds.length - 1;
}

document.getElementById('manualRound').addEventListener('change', (e) => {
  state.manualRoundIdx = Number(e.target.value);
  fillManualMatches();
});

document.getElementById('roundPrev').addEventListener('click', () => {
  if (state.manualRoundIdx > 0) {
    state.manualRoundIdx--;
    fillRoundSelect();
    fillManualMatches();
  }
});
document.getElementById('roundNext').addEventListener('click', () => {
  if (state.manualRoundIdx < state.manualRounds.length - 1) {
    state.manualRoundIdx++;
    fillRoundSelect();
    fillManualMatches();
  }
});

document.getElementById('startManualMatch').addEventListener('click', () => {
  if (state.selectedManualFixture) loadAndStartMatch(state.selectedManualFixture);
});

document.getElementById('backToModeFromManual').addEventListener('click', () => goBack());

// ---------- avvio partita ----------

function startRandomMatch(pool) {
  const pick = pool[Math.floor(Math.random() * pool.length)];
  loadAndStartMatch(pick.fixture_id);
}

async function loadAndStartMatch(fixtureId) {
  const match = await fetchJson(`${DATA_BASE}/${COMP_DIR[state.competition]}/match-${fixtureId}.json`);
  state.match = match;
  state.solved = {};
  state.players = {};
  state.activeTeamIdx = 0; // di base si parte sempre dalla squadra di casa
  const indexEntry = state.index.find(m => m.fixture_id === fixtureId);
  state.matchDate = indexEntry ? indexEntry.date : null;

  const ids = [...new Set(match.teams.flatMap(t => t.lineup.map(e => e.player_id)))];
  const players = await Promise.all(ids.map(id => fetchJson(`${DATA_BASE}/players/player-${id}.json`)));
  players.forEach(p => { state.players[p.player_id] = p; });

  document.getElementById('matchLabel').textContent =
    `${COMP_LABEL[state.competition]} ${seasonLabel(match.season)} — ${match.teams[0].team_name} vs ${match.teams[1].team_name}`;

  const scoreEl = document.getElementById('matchScore');
  if (match.home_score != null && match.away_score != null) {
    scoreEl.textContent = `Risultato finale: ${match.home_score} – ${match.away_score}`;
  } else {
    scoreEl.textContent = '';
  }

  setupTeamTabs(match);

  renderPitch('pitchHome', match.teams[0]);
  renderPitch('pitchAway', match.teams[1]);
  applyPitchSlots(0, null);
  updateScore();

  showScreen('screen-game');
}

document.getElementById('newGameBtn').addEventListener('click', () => showScreen('screen-mode'));

// ---------- switcher squadre (un solo campo alla volta, con transizione) ----------

function setupTeamTabs(match) {
  const tabHome = document.getElementById('teamTabHome');
  const tabAway = document.getElementById('teamTabAway');
  const tabs = [tabHome, tabAway];

  match.teams.forEach((team, i) => {
    const tab = tabs[i];
    const color = teamColor(team.team_name);
    tab.innerHTML = `<span class="team-tab-swatch" style="background:${color}"></span>${escapeHtml(team.team_name)}`;
    tab.onclick = () => {
      if (state.activeTeamIdx === i) return;
      applyPitchSlots(i, state.activeTeamIdx);
      state.activeTeamIdx = i;
    };
  });

  tabHome.classList.toggle('active', true);
  tabAway.classList.toggle('active', false);
}

function applyPitchSlots(newIdx, fromIdx) {
  const panels = [document.getElementById('teamPanelHome'), document.getElementById('teamPanelAway')];
  const tabs = [document.getElementById('teamTabHome'), document.getElementById('teamTabAway')];

  panels.forEach((panel, i) => {
    panel.classList.remove('slot-active', 'slot-hidden-left', 'slot-hidden-right');
    if (i === newIdx) {
      panel.classList.add('slot-active');
    } else if (fromIdx === null) {
      // primissimo render: la squadra non attiva parte gia' fuori campo,
      // senza animazione di scivolamento iniziale
      panel.classList.add(i < newIdx ? 'slot-hidden-left' : 'slot-hidden-right');
    } else {
      // la formazione appena sostituita scivola "dietro" (a destra se si
      // passa dalla prima alla seconda squadra, a sinistra nel verso opposto)
      panel.classList.add(newIdx > fromIdx ? 'slot-hidden-left' : 'slot-hidden-right');
    }
  });

  tabs.forEach((tab, i) => tab.classList.toggle('active', i === newIdx));
}

// ---------- rendering campo ----------

function formationLines(formation) {
  return [1, ...formation.split('-').map(Number)];
}

function renderPitch(svgId, team) {
  const svg = document.getElementById(svgId);
  svg.innerHTML = '';
  const W = 300, H = 440;
  const marginX = 26, marginTop = 28, marginBottom = 40;

  // linee di campo essenziali
  const field = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  field.innerHTML = `
    <rect x="4" y="4" width="${W-8}" height="${H-8}" fill="none" stroke="var(--pitch-line)" stroke-width="2"/>
    <line x1="4" y1="${H/2}" x2="${W-4}" y2="${H/2}" stroke="var(--pitch-line)" stroke-width="1.5"/>
    <circle cx="${W/2}" cy="${H/2}" r="34" fill="none" stroke="var(--pitch-line)" stroke-width="1.5"/>
    <rect x="${W/2-60}" y="4" width="120" height="46" fill="none" stroke="var(--pitch-line)" stroke-width="1.5"/>
    <rect x="${W/2-60}" y="${H-50}" width="120" height="46" fill="none" stroke="var(--pitch-line)" stroke-width="1.5"/>
  `;
  svg.appendChild(field);

  const lines = formationLines(team.formation);
  const nLines = lines.length;
  const dotRadius = Math.max(9, Math.min(14, 130 / Math.max(...lines) / 1.4));
  const color = teamColor(team.team_name);
  const checkColor = contrastingCheckColor(color);

  team.lineup.forEach(entry => {
    const li = entry.line_index, slot = entry.slot_in_line;
    const count = lines[li];
    const y = marginTop + (li / (nLines - 1)) * (H - marginBottom - marginTop);
    const x = marginX + ((slot + 0.5) / count) * (W - marginX * 2);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'player-dot' + (state.solved[entry.player_id] ? ' solved' : ''));
    g.setAttribute('data-player-id', entry.player_id);
    g.setAttribute('transform', `translate(${x},${y})`);
    g.innerHTML = `
      <circle class="dot-fill" r="${dotRadius}" fill="${color}" />
      <text class="dot-check" x="0" y="${dotRadius * 0.35}" text-anchor="middle" font-size="${dotRadius}" fill="${checkColor}" font-weight="900">✓</text>
    `;
    g.addEventListener('click', () => openPlayerCard(entry, team.team_name));
    svg.appendChild(g);
  });
}

function refreshDotState(playerId) {
  document.querySelectorAll(`.player-dot[data-player-id="${playerId}"]`).forEach(el => {
    el.classList.toggle('solved', !!state.solved[playerId]);
  });
}

function updateScore() {
  const total = state.match.teams.reduce((sum, t) => sum + t.lineup.length, 0);
  const done = Object.keys(state.solved).length;
  document.getElementById('scoreLabel').textContent = `${done} / ${total}`;
}

// ---------- carta giocatore (indizi indipendenti, click per rivelare) ----------

// Ricostruisce la carriera come sequenza cronologica di club (senza ripetizioni
// consecutive), ciascuno abbinato alla data del trasferimento con cui il
// giocatore vi e' arrivato (il primo club non ha una data nota di arrivo).
// Le fonti esterne (Wikidata/Wikipedia) e i nostri dati (API-Football) spesso
// chiamano lo stesso club in modo diverso ("Juventus" vs "Juventus FC",
// "AS Roma" vs "Roma") -- confronto per parole significative (>=4 lettere)
// invece che stringa esatta, stessa tecnica gia' usata nella pipeline dati.
function clubNamesLikelyMatch(a, b) {
  const sigWords = s => s.split(/\s+/).map(normalizeName).filter(t => t.length >= 4);
  const aWords = sigWords(a), bWords = sigWords(b);
  if (aWords.length === 0 || bWords.length === 0) return normalizeName(a) === normalizeName(b);
  return aWords.some(w => bWords.includes(w));
}

function careerSteps(player, currentClub) {
  // career_clubs: sequenza di club gia' completa e deduplicata (arricchita da
  // Wikidata/Wikipedia dove disponibile, altrimenti derivata dai trasferimenti
  // originali) -- niente date, solo l'ordine cronologico dei club.
  let base = player.career_clubs && player.career_clubs.length
    ? player.career_clubs
    : (() => {
        const transfers = [...(player.career_transfers || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        const seq = [];
        transfers.forEach((t, i) => {
          if (i === 0 && t.team_out) seq.push(t.team_out);
          if (t.team_in) seq.push(t.team_in);
        });
        return seq;
      })();

  let steps = base.map(club => ({ club, isThisMatch: false }));

  // Garantisco che la squadra di QUESTA partita compaia sempre in carriera,
  // anche quando la fonte esterna non la riporta (es. trasferimento
  // recentissimo non ancora documentato) -- se manca la aggiungo in coda.
  if (currentClub) {
    const existing = steps.find(s => clubNamesLikelyMatch(s.club, currentClub));
    if (existing) {
      existing.isThisMatch = true;
    } else {
      steps.push({ club: currentClub, isThisMatch: true });
    }
  }

  steps = steps.filter((s, i) => !(i > 0 && s.club === steps[i - 1].club && !s.isThisMatch));
  return steps;
}

function careerTimelineHtml(player, currentClub) {
  const steps = careerSteps(player, currentClub);
  if (steps.length === 0) return '<div class="career-club-date">Dati di carriera non disponibili</div>';
  return `<div class="career-timeline">${steps.map((s, i) => `
    <div class="career-step">
      <div class="career-dot-col">
        <div class="career-dot${s.isThisMatch ? ' career-dot-current' : ''}"></div>
        ${i < steps.length - 1 ? '<div class="career-line"></div>' : ''}
      </div>
      <div class="career-step-text">
        <div class="career-club-name">${escapeHtml(s.club)}</div>
      </div>
    </div>
  `).join('')}</div>`;
}

function firstName(fullName) {
  return fullName.split(' ')[0];
}

function buildHints(entry, player, teamName) {
  return [
    { id: 'firstname', label: 'Nome', value: escapeHtml(firstName(player.full_name)) },
    { id: 'shirt', label: 'Numero di maglia', value: escapeHtml(String(entry.shirt_number ?? '—')) },
    { id: 'nationality', label: 'Nazionalità', value: escapeHtml(player.nationality || '—') },
    { id: 'birthdate', label: 'Data di nascita', value: escapeHtml(player.birth_date || '—') },
    { id: 'career', label: 'Carriera', value: careerTimelineHtml(player, teamName) },
    { id: 'reveal', label: 'Chi è?', value: `<strong>${escapeHtml(player.full_name)}</strong>` },
  ];
}

function renderHints() {
  const list = document.getElementById('hintList');
  list.innerHTML = state.currentHints.map(h => {
    const isOpen = state.openHints.has(h.id);
    return `
      <div class="hint-card${isOpen ? ' open' : ''}" data-hint-id="${h.id}">
        <div class="hint-card-head">
          <div class="hint-card-label">${h.label}</div>
          <div class="hint-card-caret">▸</div>
        </div>
        <div class="hint-card-body">
          <div class="hint-card-body-inner">${h.value}</div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.hint-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.hintId;
      if (state.openHints.has(id)) state.openHints.delete(id);
      else state.openHints.add(id);
      renderHints();
    });
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function openPlayerCard(entry, teamName) {
  const player = state.players[entry.player_id];
  state.currentCardPlayerId = entry.player_id;
  state.openHints = new Set();

  const overlay = document.getElementById('playerCardOverlay');
  const solvedBlock = document.getElementById('cardSolved');
  const unsolvedBlock = document.getElementById('cardUnsolved');
  const feedback = document.getElementById('guessFeedback');
  feedback.textContent = '';
  feedback.className = 'guess-feedback';
  document.getElementById('guessInput').value = '';

  if (state.solved[entry.player_id]) {
    solvedBlock.classList.remove('hidden');
    unsolvedBlock.classList.add('hidden');
    document.getElementById('solvedName').textContent = player.full_name;
  } else {
    solvedBlock.classList.add('hidden');
    unsolvedBlock.classList.remove('hidden');
    state.currentHints = buildHints(entry, player, teamName);
    renderHints();
  }

  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('guessInput').focus(), 50);
}

document.getElementById('closePlayerCard').addEventListener('click', () => {
  document.getElementById('playerCardOverlay').classList.add('hidden');
});
document.getElementById('playerCardOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'playerCardOverlay') e.currentTarget.classList.add('hidden');
});

document.getElementById('guessForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const playerId = state.currentCardPlayerId;
  const player = state.players[playerId];
  const guess = normalizeName(document.getElementById('guessInput').value);
  const feedback = document.getElementById('guessFeedback');

  if (!guess) return;

  // Accetto SOLO l'identita' completa (nome+cognome), mai un singolo nome o
  // cognome isolato -- il nome ufficiale completo a volte ha anche un
  // secondo nome (es. "Alvaro Rafael Gonzalez Luengo"), quindi accetto sia
  // la stringa ufficiale intera sia la forma comune "nome+cognome".
  const fullNorm = normalizeName(player.full_name);
  const fullTokens = player.full_name.split(/\s+/).map(normalizeName).filter(t => t.length >= 2);
  const commonNorm = fullTokens.length >= 2 ? fullTokens[0] + fullTokens[fullTokens.length - 1] : fullNorm;
  const isCorrect = guess === fullNorm || guess === commonNorm;

  if (isCorrect) {
    state.solved[playerId] = true;
    refreshDotState(playerId);
    updateScore();
    document.getElementById('cardSolved').classList.remove('hidden');
    document.getElementById('cardUnsolved').classList.add('hidden');
    document.getElementById('solvedName').textContent = player.full_name;
  } else {
    feedback.textContent = 'Non è lui/lei. Riprova!';
    feedback.className = 'guess-feedback wrong';
    document.getElementById('guessInput').value = '';
    document.getElementById('guessInput').focus();
  }
});
