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
  // modalita' a tempo (null = nessun limite)
  timing: null,             // {key, label, minutes}
  timeRemaining: 0,         // secondi rimasti, solo se state.timing e' impostato
  timerHandle: null,
};

// Fasce di tempo selezionabili e costo in secondi di ogni indizio -- fissi,
// indipendenti dalla fascia scelta: e' la fascia stessa (quanto tempo hai
// in totale) a rendere Rapida piu' rischiosa di Rilassata, non il costo dei
// singoli indizi.
const TIME_BANDS = {
  rapida: { label: 'Sfangata', minutes: 15 },
  normale: { label: 'Gol nel recupero', minutes: 20 },
  rilassata: { label: 'Ribaltone', minutes: 25 },
};
const HINT_TIME_PENALTY = {
  birthdate: 5,
  shirt: 8,
  career: 10,
  nationality: 12,
};
const WRONG_GUESS_TIME_PENALTY = 5;

// "Nome" e' l'indizio piu' potente (rivela l'informazione E aiuta a
// filtrare i suggerimenti mentre scrivi) -- niente costo in secondi, ma un
// tetto di utilizzi per partita che PARTE da 3 e cresce con lo streak
// (vedi STREAK_FOR_JOLLY). Solo in modalita' a tempo, in gioco libero resta
// illimitato.
const NAME_HINT_MAX_USES = 3;
const STREAK_FOR_JOLLY = 3; // risposte perfette di fila per guadagnare un uso extra di "Nome"
const STREAK_FOR_MINUTE = 5; // risposte perfette di fila per guadagnare un minuto intero
const STREAK_JOLLY_SECONDS_BONUS = 90; // secondi guadagnati insieme al jolly, a quota 3
const STREAK_MINUTE_BONUS = 180; // secondi guadagnati insieme al jolly, a quota 5 (poi lo streak si azzera)
const TEAM_CHOICE_SECONDS = 10;
const TEAM_LOCK_BONUS = 60; // secondi guadagnati completando la prima formazione scelta

// Bonus in secondi su risposta corretta, a tre livelli in base a quanto e'
// stato "pulito" il tentativo per QUEL giocatore -- ricompensa chi rischia
// rispondendo subito invece di aprire indizi, coerente col tema Remuntada
// (recuperare tempo con belle giocate).
const GUESS_BONUS = {
  base: 9,      // sempre garantito quando indovini
  noHints: 15,  // nessun indizio usato, ma con qualche errore
  perfect: 25,  // primo colpo, zero indizi, zero errori
};

const COMP_DIR = { serie_a: 'serie-a', champions_league: 'champions-league' };
const COMP_LABEL = { serie_a: 'Serie A', champions_league: 'Champions League' };

// Fasce di riconoscibilita' delle squadre (solo Serie A) -- usate per
// stimare la difficolta' di una partita in base a QUANTO sono note le due
// squadre coinvolte, non a criteri sportivi (classifica, forza attuale).
// I nomi devono combaciare esattamente con quelli usati in home/away
// nell'index.json di Serie A.
const TEAM_TIER = {
  Juventus: 'alta', 'AC Milan': 'alta', Inter: 'alta', Napoli: 'alta', 'AS Roma': 'alta',
  Lazio: 'media', Fiorentina: 'media', Udinese: 'media', Genoa: 'media', Bologna: 'media',
  Atalanta: 'media', Cagliari: 'media', Torino: 'media', Sampdoria: 'media', Sassuolo: 'media',
  Parma: 'media', Verona: 'media', Chievo: 'media', Empoli: 'media', Lecce: 'media',
  Palermo: 'bassa', Catania: 'bassa', Cesena: 'bassa', Frosinone: 'bassa', Crotone: 'bassa',
  Spal: 'bassa', Spezia: 'bassa', Salernitana: 'bassa', Monza: 'bassa', Brescia: 'bassa',
  'Robur Siena': 'bassa', Pescara: 'bassa', Benevento: 'bassa', Venezia: 'bassa', Cremonese: 'bassa',
  Como: 'bassa', Bari: 'bassa', Novara: 'bassa', Livorno: 'bassa', Carpi: 'bassa', Pisa: 'bassa',
};
const TIER_SCORE = { alta: 3, media: 2, bassa: 1 };
// somma dei punteggi (2-6) -> livello di difficolta' della partita
const DIFFICULTY_FROM_SCORE = { 6: 'facile', 5: 'medio', 4: 'impegnativo', 3: 'difficile', 2: 'difficile' };

function matchDifficulty(home, away) {
  const tHome = TEAM_TIER[home] || 'media';
  const tAway = TEAM_TIER[away] || 'media';
  const score = TIER_SCORE[tHome] + TIER_SCORE[tAway];
  return DIFFICULTY_FROM_SCORE[score];
}

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

// i colori sociali reali sono spesso scuri (bordeaux Roma, blu Inter...),
// che su un pallino piccolo contro il verde scuro del campo risultano
// spenti e poco distinguibili. Li "svecchio" alzando un minimo di
// luminosita' e saturazione in HSL invece di ridefinire a mano ogni
// singolo colore -- i colori gia' chiari (bianco Juventus, azzurro
// Napoli...) restano quasi identici, quelli scuri diventano vivaci.
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function vividifyColor(hex) {
  const { h, s, l } = hexToHsl(hex);
  const newL = Math.max(l, 0.46);
  const newS = s < 0.05 ? s : Math.min(1, s + 0.12);
  return hslToHex(h, newS, newL);
}

function teamColor(teamName) {
  const words = teamName.split(/\s+/).map(normalizeName).filter(w => w.length >= 4);
  let raw = DEFAULT_DOT_COLOR;
  for (const entry of TEAM_COLORS_MULTI) {
    if (entry.words.every(w => words.includes(w))) { raw = entry.color; break; }
  }
  if (raw === DEFAULT_DOT_COLOR) {
    for (const w of words) {
      if (TEAM_COLORS[w]) { raw = TEAM_COLORS[w]; break; }
    }
  }
  return raw === DEFAULT_DOT_COLOR ? raw : vividifyColor(raw);
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

// Solo per la VISUALIZZAZIONE -- il team_name originale ("AS Roma", "AC
// Milan") resta invariato ovunque nei dati e nella logica (teamColor,
// abbinamento Sofascore/Wikipedia per parole significative), cosi' non si
// rompe nulla che dipenda dal nome completo. Tolgo solo il prefisso
// societario quando e' seguito da un nome proprio (maiuscola), per non
// toccare per sbaglio squadre il cui nome INIZIA legittimamente con
// quelle lettere.
function teamDisplayName(name) {
  if (name === 'Robur Siena') return 'Siena';
  return name.replace(/^(AS|AC)\s+(?=[A-ZÀ-Ý])/, '');
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

// Etichetta turno per l'intestazione della partita in corso ("Giornata 12"
// in Serie A, "Ottavi di finale — andata" in Champions). L'andata/ritorno
// non e' un dato salvato da nessuna parte: lo ricavo confrontando la data
// di questa partita con l'altra gara dello stesso incrocio (stessa
// stagione, stesso turno, stesse due squadre) nell'indice gia' caricato --
// la piu' vecchia delle due e' sempre l'andata.
function matchRoundInfo(competition, indexEntry) {
  if (!indexEntry || !indexEntry.round) return '';
  if (competition === 'serie_a') return roundLabel(indexEntry.round);

  const base = ROUND_LABELS[indexEntry.round] || indexEntry.round;
  const teamsKey = [indexEntry.home, indexEntry.away].sort().join('|');
  const tie = (state.index || []).filter(m =>
    m.season === indexEntry.season &&
    m.round === indexEntry.round &&
    [m.home, m.away].sort().join('|') === teamsKey
  );
  if (tie.length <= 1) return base;
  tie.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const legIdx = tie.findIndex(m => m.fixture_id === indexEntry.fixture_id);
  return `${base}, ${legIdx === 0 ? 'andata' : 'ritorno'}`;
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
  // "Nuova partita" vive nel banner in alto (centrato) -- visibile solo
  // durante la sessione di gioco, dove ha senso interromperla.
  document.getElementById('newGameBtn').classList.toggle('hidden', id !== 'screen-game');
  // il countdown non deve continuare a scorrere se si lascia la partita
  // (es. tasto indietro/home) senza finirla.
  if (id !== 'screen-game') stopTimer();
  // musica di sottofondo: gira su titolo e menu, si ferma appena inizia
  // davvero una sessione di gioco (e riparte se si torna al menu).
  if (id === 'screen-game') stopMenuMusicForGame();
  else playMenuMusic();
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

// Codice bandiera (per le immagini in web/icons/flags/) da mostrare nel
// pallino quando si usa l'indizio nazionalita' -- caricato una volta sola
// all'avvio, dizionario piccolo (110 voci).
let NATIONALITY_ISO = {};
fetchJson(`${DATA_BASE}/nationality_iso.json`).then(map => { NATIONALITY_ISO = map; });

// Set dei nomi completi validi (normalizzati), per sapere se il testo
// scritto ORA e' un giocatore vero -- usato per abilitare "Indovina" solo
// su un'identita' reale (vedi setupSuggestions), mai su testo a caso.
let validNamesSetPromise = null;
async function loadValidNamesSet() {
  if (!validNamesSetPromise) {
    validNamesSetPromise = loadAllPlayerNames().then(names => new Set(names.map(normalizeName)));
  }
  return validNamesSetPromise;
}
loadValidNamesSet();

// Distanza di edit (Levenshtein) semplice, senza dipendenze -- usata solo
// come fallback quando il prefisso esatto non trova nulla, per tollerare
// piccoli errori di battitura (una lettera sbagliata/mancante/di troppo)
// senza pero' diventare cosi' permissiva da suggerire nomi a caso.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prevDiag
        : 1 + Math.min(prevDiag, dp[j], dp[j - 1]);
      prevDiag = tmp;
    }
  }
  return dp[n];
}

// Vero se la parola digitata "qw" puo' ragionevolmente riferirsi al token
// "t" del nome: prefisso esatto (caso normale, anche mentre si sta ancora
// scrivendo), oppure -- solo da 4 lettere in su, per non essere troppo
// larghi su query cortissime -- una distanza di edit piccola (1 errore
// fino a 6 lettere, 2 oltre) confrontata sia col token intero sia con un
// suo prefisso della stessa lunghezza circa. Se l'errore e' troppo esteso
// (nome scritto a caso) semplicemente non scatta, come deve essere.
function fuzzyTokenMatch(qw, t) {
  if (t.startsWith(qw)) return true;
  if (qw.length < 4) return false;
  const maxDist = qw.length <= 6 ? 1 : 2;
  const prefix = t.slice(0, Math.min(t.length, qw.length + 2));
  return levenshtein(qw, prefix) <= maxDist || levenshtein(qw, t) <= maxDist;
}

function setupSuggestions() {
  const input = document.getElementById('guessInput');
  const list = document.getElementById('suggestList');
  const submitBtn = document.getElementById('guessSubmitBtn');

  // "Indovina" si abilita SOLO se il testo scritto ora e' un nome reale
  // (identita' completa) -- cosi' un invio a vuoto/per sbaglio su un testo
  // a caso non conta mai come tentativo (niente penalita', niente reset
  // dello streak per un errore di battitura o un tasto premuto per sbaglio).
  async function updateSubmitEnabled() {
    const validNames = await loadValidNamesSet();
    submitBtn.disabled = !validNames.has(normalizeName(input.value));
  }

  input.addEventListener('input', async () => {
    updateSubmitEnabled();
    const raw = input.value.trim();
    if (raw.length < 2) { list.classList.add('hidden'); list.innerHTML = ''; return; }

    const names = await loadAllPlayerNames();
    // ogni parola digitata (es. "de rossi" -> ["de","rossi"]) deve
    // combaciare con UN token del nome (non necessariamente lo stesso per
    // tutte) -- cosi' digitare piu' parole insieme funziona esattamente
    // come digitarne una sola, invece di cercare l'intera query come
    // stringa unica senza spazi (che non trova mai nulla per query
    // multi-parola, es. "de rossi" o "fabian ruiz").
    const qWords = raw.split(/[\s\-']+/).map(normalizeName).filter(w => w.length >= 1);

    // mostro l'IDENTITA' COMPLETA (nome+cognome), mai un nome isolato --
    // altrimenti il suggerimento stesso rivelerebbe una risposta parziale
    // accettabile. Il confronto e' su ciascuna parola del nome (cosi'
    // digitare il cognome trova comunque il giocatore giusto, in
    // qualunque ordine) e tollera piccoli errori di battitura, lista
    // libera senza limite fisso di risultati.
    const matches = [];
    for (const n of names) {
      const tokens = n.split(/[\s\-']+/).map(normalizeName).filter(t => t.length >= 2);
      if (!qWords.every(qw => tokens.some(t => fuzzyTokenMatch(qw, t)))) continue;
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
        updateSubmitEnabled();
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

document.getElementById('startFromTitle').addEventListener('click', () => {
  playTapSound();
  showScreen('screen-play-type');
});
document.getElementById('brandHome').addEventListener('click', () => showScreen('screen-play-type'));
document.getElementById('globalBackBtn').addEventListener('click', () => goBack());

// ---------- schermata 1a: gioco libero / sfida a tempo ----------

document.querySelectorAll('[data-play-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.playType === 'libero') {
      state.timing = null;
      showScreen('screen-competition');
    } else {
      showScreen('screen-timing');
    }
  });
});

document.getElementById('remuntadaInfoBtn').addEventListener('click', () => {
  document.getElementById('remuntadaInfoOverlay').classList.remove('hidden');
});
document.getElementById('closeRemuntadaInfo').addEventListener('click', () => {
  document.getElementById('remuntadaInfoOverlay').classList.add('hidden');
});
document.getElementById('remuntadaInfoOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'remuntadaInfoOverlay') e.currentTarget.classList.add('hidden');
});

// ---------- schermata 1b: scelta fascia di tempo ----------

document.querySelectorAll('[data-timing]').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.timing;
    state.timing = { key, ...TIME_BANDS[key] };
    showScreen('screen-competition');
  });
});
document.getElementById('backToPlayTypeFromTiming').addEventListener('click', () => goBack());

// ---------- schermata 1c: competizione ----------

document.querySelectorAll('.big-choice[data-comp]').forEach(btn => {
  btn.addEventListener('click', async () => {
    state.competition = btn.dataset.comp;
    state.index = await fetchJson(`${DATA_BASE}/${COMP_DIR[state.competition]}/index.json`);
    showScreen('screen-mode');
  });
});

document.getElementById('backToCompetition').addEventListener('click', () => goBack());

// ---------- schermata 2: modalita' ----------

document.querySelectorAll('.mode-choice[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === 'random') {
      if (state.competition === 'serie_a') {
        state.pendingPool = state.index;
        showScreen('screen-difficulty');
      } else {
        startRandomMatch(state.index);
      }
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
  if (state.competition === 'serie_a') {
    state.pendingPool = pool;
    showScreen('screen-difficulty');
  } else {
    startRandomMatch(pool);
  }
});

document.getElementById('backToModeFromYears').addEventListener('click', () => goBack());

// ---------- schermata 3a-bis: difficolta' (solo Serie A) ----------

document.querySelectorAll('.mode-choice[data-difficulty]').forEach(btn => {
  btn.addEventListener('click', () => {
    const level = btn.dataset.difficulty;
    const filtered = state.pendingPool.filter(m => matchDifficulty(m.home, m.away) === level);
    // range anni troppo stretto per quel livello: meglio generare comunque
    // (dal pool non filtrato) che bloccare il giocatore senza partita.
    startRandomMatch(filtered.length ? filtered : state.pendingPool);
  });
});

document.getElementById('backFromDifficulty').addEventListener('click', () => goBack());

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

  // In Champions ogni turno (tranne la finale) e' andata/ritorno: raggruppo
  // le partite per incrocio (stesse due squadre), ordino ogni incrocio per
  // data (andata prima) e gli incroci fra loro per data dell'andata --
  // cosi' l'ordine delle gare di ritorno rispecchia esattamente quello
  // delle andate (stessa posizione = stesso incrocio), invece di dipendere
  // dall'ordine "grezzo" per data che poteva disallinearle.
  const showLegDivider = state.competition === 'champions_league' && round.round !== 'Final';
  let orderedMatches = round.matches;
  let ritornoStartsAt = -1;
  if (showLegDivider) {
    const ties = new Map();
    const tieOrder = [];
    for (const m of round.matches) {
      const key = [m.home, m.away].sort().join('|');
      if (!ties.has(key)) { ties.set(key, []); tieOrder.push(key); }
      ties.get(key).push(m);
    }
    for (const key of tieOrder) ties.get(key).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    tieOrder.sort((a, b) => (ties.get(a)[0].date || '').localeCompare(ties.get(b)[0].date || ''));
    const andataList = tieOrder.map(k => ties.get(k)[0]);
    const ritornoList = tieOrder.filter(k => ties.get(k).length > 1).map(k => ties.get(k)[1]);
    orderedMatches = [...andataList, ...ritornoList];
    ritornoStartsAt = andataList.length;
  }

  let html = '';
  orderedMatches.forEach((m, i) => {
    if (i === ritornoStartsAt) html += `<div class="round-leg-divider">Ritorno</div>`;
    html += `<div class="match-item" data-fixture-id="${m.fixture_id}">${escapeHtml(teamDisplayName(m.home))} — ${escapeHtml(teamDisplayName(m.away))}</div>`;
  });
  list.innerHTML = html;
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
  state.startTime = Date.now();
  state.usedHints = new Set();   // "playerId:hintId", esclude 'reveal'
  state.failedAttempts = 0;
  state.wrongAttemptsByPlayer = {}; // player_id -> quante volte sbagliato, per il bonus
  state.totalBonusSeconds = 0; // secondi totali guadagnati con i bonus, mostrati a fine partita
  state.nameHintUsesLeft = NAME_HINT_MAX_USES;
  state.perfectStreak = 0;
  state.bestStreak = 0; // streak piu' lunga raggiunta in partita, mostrata a fine partita
  state.commitTeamIdx = null;      // squadra scelta per iniziare (Remuntada) -- null finche' non si sceglie, o sempre null in gioco libero
  document.querySelector('.pitch-stage').classList.remove('match-over');
  state.teamLockBonusGiven = false;
  document.getElementById('teamTabHome').classList.remove('locked');
  document.getElementById('teamTabAway').classList.remove('locked');
  updateStreakLabel();
  const indexEntry = state.index.find(m => m.fixture_id === fixtureId);
  state.matchDate = indexEntry ? indexEntry.date : null;

  const ids = [...new Set(match.teams.flatMap(t => t.lineup.map(e => e.player_id)))];
  const players = await Promise.all(ids.map(id => fetchJson(`${DATA_BASE}/players/player-${id}.json`)));
  players.forEach(p => { state.players[p.player_id] = p; });

  // riga 1 (piccola/grigia): campionato + stagione + turno/giornata --
  // contesto, non il centro dell'attenzione. riga 2 (grande/grassetto): le
  // due squadre, la cosa che conta davvero. riga 3 (piccola/grigia): data
  // e risultato, col risultato evidenziato in verde per farlo spiccare un
  // filo rispetto alla data.
  const roundInfo = matchRoundInfo(state.competition, indexEntry);
  document.getElementById('matchLabel').textContent =
    [`${COMP_LABEL[state.competition]} ${seasonLabel(match.season)}`, roundInfo].filter(Boolean).join(' — ');

  document.getElementById('matchTeams').textContent =
    `${teamDisplayName(match.teams[0].team_name)} vs ${teamDisplayName(match.teams[1].team_name)}`;

  const detailsEl = document.getElementById('matchDetails');
  const dateShort = formatDateShort(state.matchDate);
  const scoreText = (match.home_score != null && match.away_score != null)
    ? `<span class="score-highlight">${match.home_score} – ${match.away_score}</span>`
    : '';
  detailsEl.innerHTML = [dateShort, scoreText].filter(Boolean).join(' · ');

  setupTeamTabs(match);

  renderPitch('pitchHome', match.teams[0]);
  renderPitch('pitchAway', match.teams[1]);
  applyPitchSlots(0, null);
  updateScore();

  showScreen('screen-game');

  // Remuntada: prima di far partire il countdown principale, si sceglie da
  // quale squadra iniziare (10s, altrimenti scelta casuale) -- evita di
  // poter "spizzicare" i giocatori piu' facili di entrambe le formazioni
  // per costruire streak comode. In gioco libero si parte subito, libero
  // di passare da una squadra all'altra come sempre. Il fischio d'inizio
  // segue lo stesso ritmo: in Remuntada suona solo quando il campo con la
  // formazione compare davvero (dopo la scelta squadra), non gia' durante
  // il countdown "da quale squadra parti?".
  if (state.timing) {
    showTeamChoiceOverlay(match);
  } else {
    playKickoffWhistle();
    startTimer();
  }
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
    tab.innerHTML = `<span class="team-tab-swatch" style="background:${color}"></span><span class="team-tab-name">${escapeHtml(teamDisplayName(team.team_name))}</span>`;
    tab.onclick = () => {
      if (tab.classList.contains('locked')) return;
      if (state.activeTeamIdx === i) return;
      applyPitchSlots(i, state.activeTeamIdx);
      state.activeTeamIdx = i;
      updateFormationLabel();
    };
  });

  tabHome.classList.toggle('active', true);
  tabAway.classList.toggle('active', false);
  updateFormationLabel();
}

// Modulo e allenatore della squadra attualmente selezionata, sempre
// visibili sopra il campo -- si aggiornano a ogni cambio tab. Il nome
// dell'allenatore e' sempre quello ufficiale completo (mai l'abbreviazione
// "M. Cognome"), e si accorcia da solo coi puntini se troppo lungo per
// stare sulla riga (vedi .coach-label in style.css).
function updateFormationLabel() {
  const el = document.getElementById('formationLabel');
  const coachEl = document.getElementById('coachLabel');
  if (!el || !state.match) return;
  const team = state.match.teams[state.activeTeamIdx];
  el.textContent = team.formation ? `Modulo: ${team.formation}` : '';
  if (coachEl) {
    const coachName = team.coach && (team.coach.full_name || team.coach.name);
    coachEl.textContent = coachName ? `Allenatore: ${coachName}` : '';
    coachEl.classList.toggle('hidden', !coachName);
  }
}

// Quanto manca al prossimo jolly di "Nome" -- solo in modalita' a tempo.
function updateStreakLabel() {
  const el = document.getElementById('streakLabel');
  if (!el) return;
  if (!state.timing) {
    el.classList.add('hidden');
    return;
  }
  // il traguardo mostrato cambia: prima punta al primo jolly (3), poi --
  // una volta superato -- al secondo jolly+minuto (5), invece di mostrare
  // sempre "/5" anche quando sei ancora a 0 o 1 (fuorviante).
  const target = state.perfectStreak < STREAK_FOR_JOLLY ? STREAK_FOR_JOLLY : STREAK_FOR_MINUTE;
  el.innerHTML = `🃏 ${state.nameHintUsesLeft}<span class="streak-sep">·</span>⚡ ${state.perfectStreak}/${target}`;
  el.classList.remove('hidden');
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

// ---------- Remuntada: scelta squadra iniziale + blocco formazione ----------

let teamChoiceInterval = null;

function showTeamChoiceOverlay(match) {
  const overlay = document.getElementById('teamChoiceOverlay');
  const buttons = [document.getElementById('teamChoiceHome'), document.getElementById('teamChoiceAway')];

  match.teams.forEach((team, idx) => {
    const btn = buttons[idx];
    const color = teamColor(team.team_name);
    btn.innerHTML = `<span class="team-tab-swatch" style="background:${color}"></span>${escapeHtml(teamDisplayName(team.team_name))}`;
    btn.onclick = () => commitTeamChoice(idx);
  });

  let secondsLeft = TEAM_CHOICE_SECONDS;
  const countdownEl = document.getElementById('teamChoiceCountdown');
  countdownEl.textContent = secondsLeft;
  overlay.classList.remove('hidden');
  // il campo resta nascosto finche' non si sceglie la squadra, non solo
  // coperto dall'overlay semi-trasparente (che lasciava intravedere i
  // colori della formazione dietro). Stesso discorso per "Modulo": prima
  // di scegliere la squadra non ha senso mostrarlo (e sarebbe comunque
  // quello sbagliato se la scelta finale cade sull'altra squadra).
  document.querySelector('.pitch-stage').classList.add('hidden');
  document.getElementById('formationLabel').classList.add('hidden');
  document.getElementById('coachLabel').classList.add('hidden');

  clearInterval(teamChoiceInterval);
  teamChoiceInterval = setInterval(() => {
    secondsLeft--;
    countdownEl.textContent = secondsLeft;
    if (secondsLeft <= 0) {
      clearInterval(teamChoiceInterval);
      commitTeamChoice(Math.random() < 0.5 ? 0 : 1); // scelta casuale se il tempo scade
    }
  }, 1000);
}

function commitTeamChoice(idx) {
  clearInterval(teamChoiceInterval);
  document.getElementById('teamChoiceOverlay').classList.add('hidden');
  document.querySelector('.pitch-stage').classList.remove('hidden');
  document.getElementById('formationLabel').classList.remove('hidden');
  updateFormationLabel();
  playKickoffWhistle();
  if (idx !== state.activeTeamIdx) {
    applyPitchSlots(idx, state.activeTeamIdx);
    state.activeTeamIdx = idx;
    updateFormationLabel();
  }
  state.commitTeamIdx = idx;
  updateTeamLockUI();
  startTimer();
}

function isTeamFullySolved(teamIdx) {
  return state.match.teams[teamIdx].lineup.every(e => state.solved[e.player_id]);
}

function updateTeamLockUI() {
  if (state.commitTeamIdx === null) return; // gioco libero: nessun blocco
  const lockedIdx = 1 - state.commitTeamIdx;
  const lockedTab = [document.getElementById('teamTabHome'), document.getElementById('teamTabAway')][lockedIdx];
  lockedTab.classList.toggle('locked', !isTeamFullySolved(state.commitTeamIdx));
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

  // Passata 1: per ogni giocatore calcolo posizione + etichetta (cognome,
  // gestendo le particelle "El/Di/Van/..." cosi' "El Shaarawy" e "Di Natale"
  // non perdono la prima parola), raggruppati per linea -- serve per capire
  // quali etichette si accavallerebbero davvero (larghezza reale via canvas)
  // prima di disegnare, e stringerle finche' non entrano tutte in riga.
  const byLine = new Map();
  team.lineup.forEach(entry => {
    const li = entry.line_index, slot = entry.slot_in_line;
    const count = lines[li];
    const y = marginTop + (li / (nLines - 1)) * (H - marginBottom - marginTop);
    const x = marginX + ((slot + 0.5) / count) * (W - marginX * 2);
    const surname = lastName(displayName(state.players[entry.player_id]));
    // direzione fissa per ruolo, mai in base a eventuali scontri: il
    // portiere punta sempre verso gli attaccanti (sotto), tutti gli altri
    // sempre verso il portiere (sopra) -- coerente su tutto il campo.
    const band = entry.line_index === 0 ? 'below' : 'above';
    if (!byLine.has(li)) byLine.set(li, []);
    byLine.get(li).push({ entry, slot, count, x, y, band, surname, wrapped: false, fontSize: surname.length > 8 ? 8 : 9 });
  });

  const pad = 3;
  byLine.forEach(lineEntries => {
    lineEntries.sort((a, b) => a.slot - b.slot);
    // provo a far entrare tutte le etichette centrate sul proprio pallino:
    // se due vicine (stessa banda, quindi sempre per i non-portiere dato
    // che sono tutti sulla stessa riga) si accavallerebbero, o se
    // un'etichetta di bordo uscirebbe dal campo, prima vado a capo su due
    // righe, poi se non basta ancora riduco il font -- mai alternare sopra/
    // sotto, la direzione resta fissa per ruolo.
    const MIN_FONT = 6;
    for (let iter = 0; iter < 8; iter++) {
      lineEntries.forEach(item => { item.label = buildNameLabel(item.surname, item.fontSize, item.wrapped); });

      const conflicts = new Set();
      // bordo sinistro/destro del campo (le etichette sono sempre centrate,
      // quindi mezza larghezza da ciascun lato del pallino).
      const first = lineEntries[0], last = lineEntries[lineEntries.length - 1];
      if (first.x - first.label.width / 2 - pad < 4) conflicts.add(first);
      if (last.x + last.label.width / 2 + pad > W - 4) conflicts.add(last);
      // vicini nella stessa linea, stessa banda -> stesso confronto per
      // TUTTI i non-portiere (sono sempre tutti "above"); il portiere e'
      // sempre solo nella sua linea quindi non ha vicini da controllare.
      for (let i = 1; i < lineEntries.length; i++) {
        const prev = lineEntries[i - 1], cur = lineEntries[i];
        if (prev.band !== cur.band) continue;
        const gapNeeded = prev.label.width / 2 + cur.label.width / 2 + pad * 2;
        if ((cur.x - prev.x) < gapNeeded) { conflicts.add(prev); conflicts.add(cur); }
      }
      if (conflicts.size === 0) break;
      let changedAny = false;
      conflicts.forEach(item => {
        if (!item.wrapped && item.surname.includes(' ')) {
          item.wrapped = true;
          changedAny = true;
        } else if (item.fontSize > MIN_FONT) {
          item.fontSize -= 1;
          changedAny = true;
        }
      });
      if (!changedAny) break;
    }
  });

  byLine.forEach(lineEntries => {
    lineEntries.forEach(item => {
      const { entry, x, y, label, band } = item;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'player-dot' + (state.solved[entry.player_id] ? ' solved' : ''));
      g.setAttribute('data-player-id', entry.player_id);
      g.setAttribute('transform', `translate(${x},${y})`);
      const clipId = `flagclip-${svgId}-${entry.player_id}`;
      const photoClipId = `photoclip-${svgId}-${entry.player_id}`;
      const flagCode = flagCodeForPlayer(entry.player_id);
      const initials = initialsForPlayer(entry.player_id);
      g.innerHTML = `
        <circle class="dot-fill" r="${dotRadius}" fill="${color}" />
        <clipPath id="${clipId}"><circle r="${dotRadius}" /></clipPath>
        <clipPath id="${photoClipId}"><circle r="${dotRadius}" /></clipPath>
        <image class="dot-flag" href="${flagCode ? flagImageHref(flagCode) : ''}"
               x="${-dotRadius}" y="${-dotRadius}" width="${dotRadius * 2}" height="${dotRadius * 2}"
               preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"
               style="display:${flagCode ? 'inline' : 'none'}" />
        <g class="dot-solved-face">
          <image class="dot-photo" href="${playerPhotoHref(entry.player_id)}"
                 x="${-dotRadius}" y="${-dotRadius}" width="${dotRadius * 2}" height="${dotRadius * 2}"
                 preserveAspectRatio="xMidYMid slice" clip-path="url(#${photoClipId})" />
          <g class="dot-initials">
            <circle r="${dotRadius}" fill="var(--panel-2, #333)" />
            <text x="0" y="${dotRadius * 0.35}" text-anchor="middle" font-size="${dotRadius}" fill="#fff" font-weight="700">${initials}</text>
          </g>
        </g>
        ${nameLabelSvg(label, band, dotRadius)}
      `;
      const photoImg = g.querySelector('.dot-photo');
      photoImg.addEventListener('error', () => {
        g.querySelector('.dot-solved-face').classList.add('photo-failed');
      });
      g.addEventListener('click', () => openPlayerCard(entry, team.team_name));
      svg.appendChild(g);
    });
  });
}

// Cognome sempre con le particelle attaccate ("El Shaarawy", "Di Natale",
// "Van Dijk", "De Ligt"...) -- prendo dal primo token riconosciuto come
// particella in poi, invece della sola ultima parola.
const SURNAME_PARTICLES = new Set([
  'de', 'di', 'da', 'van', 'von', 'der', 'den', 'ter', 'el', 'al',
  'le', 'la', 'les', 'del', 'della', 'dello', 'degli', 'dei', 'delle',
  'dos', 'das', 'do', 'bin',
]);
function lastName(fullName) {
  const tokens = fullName.trim().split(/\s+/);
  if (tokens.length === 1) return tokens[0];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (SURNAME_PARTICLES.has(tokens[i].toLowerCase())) {
      return tokens.slice(i).join(' ');
    }
  }
  return tokens[tokens.length - 1];
}

// Prepara l'etichetta da mostrare al dato fontSize: se "wrapped" e il
// cognome ha piu' parole, va su due righe (l'ultima parola, il "cuore" del
// cognome, da sola sulla seconda riga, le particelle sulla prima) --
// entrambe le righe restano centrate allo stesso modo, una sopra l'altra.
function buildNameLabel(surname, fontSize, wrapped) {
  const words = surname.split(' ');
  if (!wrapped || words.length === 1) {
    return { lines: [surname], fontSize, width: measureTextWidth(surname, fontSize) };
  }
  const line1 = words.slice(0, -1).join(' ');
  const line2 = words[words.length - 1];
  const w1 = measureTextWidth(line1, fontSize);
  const w2 = measureTextWidth(line2, fontSize);
  return { lines: [line1, line2], fontSize, width: Math.max(w1, w2) };
}

// Etichetta sempre centrata sul pallino (mai spostata a sinistra/destra).
function nameLabelSvg(label, band, dotRadius) {
  const lineHeight = label.fontSize + 2;
  const nLines = label.lines.length;
  // sotto: la prima riga e' la piu' vicina al pallino; sopra: e' l'ultima
  // (cosi' il testo "cresce" allontanandosi dal pallino in entrambi i casi).
  const firstDy = band === 'below'
    ? dotRadius + 11 + label.fontSize * 0.75
    : -(dotRadius + 6) - (nLines - 1) * lineHeight;
  return label.lines.map((line, i) => {
    const dy = firstDy + i * lineHeight;
    return `<text class="dot-name-label" x="0" y="${dy}" text-anchor="middle" font-size="${label.fontSize}">${escapeHtml(line)}</text>`;
  }).join('');
}

// misura la larghezza reale del testo (stesse unita' SVG usate per
// posizionare i pallini) con un canvas offscreen condiviso.
let __labelMeasureCtx = null;
function measureTextWidth(text, fontSize) {
  if (!__labelMeasureCtx) {
    __labelMeasureCtx = document.createElement('canvas').getContext('2d');
  }
  __labelMeasureCtx.font = `700 ${fontSize}px sans-serif`;
  return __labelMeasureCtx.measureText(text).width;
}

function playerPhotoHref(playerId) {
  return `icons/players/${playerId}.webp`;
}

// iniziali (nome+cognome, o le prime due lettere se e' un alias monoparola)
// da mostrare quando il giocatore non ha una foto vera disponibile.
function initialsForPlayer(playerId) {
  const name = displayName(state.players[playerId]).trim();
  const tokens = name.split(/\s+/);
  if (tokens.length === 1) return escapeHtml(tokens[0].slice(0, 2).toUpperCase());
  return escapeHtml((tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase());
}

function flagImageHref(code) {
  return `icons/flags/${code}.png`;
}

// codice bandiera da mostrare nel pallino: solo se l'indizio nazionalita' e'
// gia' stato usato per QUESTO giocatore e la sua nazionalita' ha un codice
// mappato -- altrimenti null (pallino resta come oggi, colore di squadra).
function flagCodeForPlayer(playerId) {
  if (!state.usedHints.has(`${playerId}:nationality`)) return null;
  const player = state.players[playerId];
  const nat = player && player.nationality;
  return (nat && NATIONALITY_ISO[nat]) || null;
}

// aggiorna solo la bandiera del pallino di un giocatore, senza ridisegnare
// tutto il campo -- chiamata subito dopo aver aperto per la prima volta
// l'indizio nazionalita' nella card. La bandiera riempie l'intero pallino
// (ritaglio circolare), sostituendo il colore di squadra, non un'iconcina
// dentro al pallino.
function refreshDotFlag(playerId) {
  const code = flagCodeForPlayer(playerId);
  document.querySelectorAll(`.player-dot[data-player-id="${playerId}"] .dot-flag`).forEach(el => {
    if (code) {
      el.setAttribute('href', flagImageHref(code));
      el.style.display = 'inline';
    } else {
      el.style.display = 'none';
    }
  });
}

function refreshDotState(playerId) {
  document.querySelectorAll(`.player-dot[data-player-id="${playerId}"]`).forEach(el => {
    el.classList.toggle('solved', !!state.solved[playerId]);
  });
}

// ---------- suoni ----------

const MUTE_KEY = 'chigioca_muted';
let isMuted = localStorage.getItem(MUTE_KEY) === '1';

function updateMuteButton() {
  const btn = document.getElementById('muteBtn');
  if (!btn) return;
  btn.textContent = isMuted ? '🔇' : '🔊';
  btn.setAttribute('aria-label', isMuted ? 'Attiva audio' : 'Disattiva audio');
}

function toggleMute() {
  isMuted = !isMuted;
  localStorage.setItem(MUTE_KEY, isMuted ? '1' : '0');
  updateMuteButton();
}

// ---------- musica di sottofondo (titolo + menu, mai durante la partita) ----------

const MUSIC_MUTE_KEY = 'chigioca_music_muted';
let isMusicMuted = localStorage.getItem(MUSIC_MUTE_KEY) === '1';

const menuMusic = new Audio('music/menu-theme.mp3');
menuMusic.loop = true;
menuMusic.volume = 0.35;
menuMusic.preload = 'auto';

function updateMusicButton() {
  const btn = document.getElementById('musicBtn');
  if (!btn) return;
  // stessa nota sempre (mai l'icona 🔇 gia' usata per gli effetti sonori,
  // altrimenti sembrerebbero lo stesso controllo) -- da muto la sbarro
  // con una riga invece di cambiare simbolo.
  btn.textContent = '♫';
  btn.classList.toggle('music-btn-muted', isMusicMuted);
  btn.setAttribute('aria-label', isMusicMuted ? 'Attiva musica' : 'Disattiva musica');
}

function playMenuMusic() {
  if (isMusicMuted) return;
  // i browser bloccano l'autoplay senza interazione: se il primo tentativo
  // fallisce (schermata di titolo appena caricata) riprovo al primo tap
  // dell'utente in qualunque punto della pagina, una volta sola.
  menuMusic.play().catch(() => {
    const retry = () => { menuMusic.play().catch(() => {}); };
    document.addEventListener('pointerdown', retry, { once: true });
  });
}

// pausa "semplice": muto dall'icona o app in background -- riprende da
// dove si era fermata, non da capo.
function pauseMenuMusic() {
  menuMusic.pause();
}

// pausa quando inizia davvero una partita: li' la si vuole sempre da
// capo alla prossima volta che si torna al menu (vedi showScreen()).
function stopMenuMusicForGame() {
  menuMusic.pause();
  menuMusic.currentTime = 0;
}

function toggleMusic() {
  isMusicMuted = !isMusicMuted;
  localStorage.setItem(MUSIC_MUTE_KEY, isMusicMuted ? '1' : '0');
  updateMusicButton();
  if (isMusicMuted) pauseMenuMusic();
  else if (document.getElementById('screen-game') && !document.getElementById('screen-game').classList.contains('active')) playMenuMusic();
}

// se l'app va in background (schermata bloccata, cambio app, tab
// nascosta) la musica si mette in pausa da sola, e riprende da dove
// era rimasta quando si torna -- solo se non e' gia' muta o a partita
// in corso, altrimenti resterebbe zitta per un motivo diverso.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseMenuMusic();
  } else {
    const gameScreen = document.getElementById('screen-game');
    const inGame = gameScreen && gameScreen.classList.contains('active');
    if (!isMusicMuted && !inGame) playMenuMusic();
  }
});

document.getElementById('musicBtn').addEventListener('click', toggleMusic);
updateMusicButton();
playMenuMusic();

document.getElementById('muteBtn').addEventListener('click', toggleMute);
updateMuteButton();

const SOUND_FILES = {
  gol: 'sounds/gol.m4a',
  palo: 'sounds/palo.m4a',
  fischio: 'sounds/triplice-fischio.m4a',
  fischioInizio: 'sounds/fischio-inizio.m4a',
};
const soundCache = {};

// Precarico i file audio subito, invece di crearli al primo play -- senza
// questo il primo gol/palo/fischio di ogni partita partiva con un ritardo
// percepibile (fetch + decode iniziano solo alla prima riproduzione).
function preloadSounds() {
  for (const [name, src] of Object.entries(SOUND_FILES)) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.load();
    soundCache[name] = audio;
  }
}
preloadSounds();

function playSound(name) {
  if (isMuted) return;
  try {
    let audio = soundCache[name];
    if (!audio) {
      audio = new Audio(SOUND_FILES[name]);
      soundCache[name] = audio;
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
    audio.play().catch(() => {});
  } catch (e) {
    // audio non disponibile: nessun suono, ma il gioco continua normalmente.
  }
}

// Fine partita: triplice fischio e gol in contemporanea.
function playMatchCompleteSound() {
  playSound('fischio');
  playSound('gol');
}

// Fischio d'inizio (un solo soffio), suona quando si apre davvero la
// formazione da indovinare.
let audioCtx = null;
function playKickoffWhistle() {
  playSound('fischioInizio');
}

// Tap leggero per i pulsanti di menu (es. "Inizia a giocare") -- un breve
// pizzicato pulito, ben distinto dal fischietto che invece segna l'inizio
// vero e proprio della partita.
function playTapSound() {
  if (isMuted) return;
  try {
    const ctx = audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === 'suspended') ctx.resume();
    const start = ctx.currentTime;
    const duration = 0.1;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, start);
    osc.frequency.exponentialRampToValueAtTime(660, start + duration);
    gain.gain.setValueAtTime(0.25, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  } catch (e) {
    // Web Audio non disponibile: nessun suono, ma il gioco continua normalmente.
  }
}

function updateScore() {
  const total = state.match.teams.reduce((sum, t) => sum + t.lineup.length, 0);
  const done = Object.keys(state.solved).length;
  document.getElementById('scoreLabel').textContent = `${done} / ${total}`;
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- modalita' a tempo ----------

function stopTimer() {
  if (state.timerHandle) {
    clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
}

function updateTimerDisplay() {
  const el = document.getElementById('timerLabel');
  if (!el) return;

  // Terzi calcolati sul totale FISSO della fascia scelta a inizio partita,
  // non ricalcolati se il tempo sale coi bonus -- se superi i 2/3 grazie ai
  // bonus, torni tranquillamente verde. L'ultimo minuto lampeggia sempre,
  // indipendentemente dalla fascia (soglia assoluta, non proporzionale).
  const totalSeconds = state.timing ? state.timing.minutes * 60 : 0;
  const isYellow = totalSeconds > 0 && state.timeRemaining <= totalSeconds * (2 / 3) && state.timeRemaining > totalSeconds / 3;
  const isRed = totalSeconds > 0 && state.timeRemaining <= totalSeconds / 3;
  el.classList.toggle('timer-warning', isYellow);
  el.classList.toggle('timer-danger', isRed);
  el.classList.toggle('timer-blink', state.timeRemaining <= 60);

  el.textContent = formatElapsed(state.timeRemaining * 1000);
}

// Riparte da zero a ogni nuova partita (schermata campo) -- se non e'
// impostata una fascia a tempo, il countdown resta semplicemente nascosto.
function startTimer() {
  stopTimer();
  const el = document.getElementById('timerLabel');
  if (!state.timing) {
    if (el) el.classList.add('hidden');
    return;
  }
  state.timeRemaining = state.timing.minutes * 60;
  if (el) el.classList.remove('hidden');
  updateTimerDisplay();
  state.timerHandle = setInterval(() => {
    state.timeRemaining--;
    updateTimerDisplay();
    if (state.timeRemaining <= 0) {
      stopTimer();
      showMatchComplete(false);
    }
  }, 1000);
}

// Aiuti e tentativi sbagliati tolgono secondi invece di punti -- se il
// countdown arriva a zero qui, e' una sconfitta per tempo scaduto.
function applyTimePenalty(seconds) {
  if (!state.timing) return;
  state.timeRemaining = Math.max(0, state.timeRemaining - seconds);
  updateTimerDisplay();
  showTimerFlash(`-${seconds}s`, false);
  if (state.timeRemaining <= 0) {
    stopTimer();
    showMatchComplete(false);
  }
}

function applyTimeBonus(seconds, flashText) {
  if (!state.timing) return;
  state.timeRemaining += seconds;
  state.totalBonusSeconds += seconds;
  updateTimerDisplay();
  showTimerFlash(flashText || `+${seconds}s`, true);
}

function showTimerFlash(text, positive) {
  const el = document.getElementById('timerFlash');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('flash-positive', 'flash-negative', 'flash-active');
  void el.offsetWidth;
  el.classList.add(positive ? 'flash-positive' : 'flash-negative', 'flash-active');
}

function computeGuessBonus(playerId) {
  const hintsUsed = [...state.usedHints].some(k => k.startsWith(`${playerId}:`));
  if (hintsUsed) return GUESS_BONUS.base;
  const wrongAttempts = state.wrongAttemptsByPlayer[playerId] || 0;
  return wrongAttempts > 0 ? GUESS_BONUS.noHints : GUESS_BONUS.perfect;
}

function updateGuessIncentiveLine() {
  const el = document.getElementById('wrongGuessCost');
  const pid = state.currentCardPlayerId;
  if (!state.timing || state.solved[pid]) {
    el.classList.add('hidden');
    return;
  }
  const bonus = computeGuessBonus(pid);
  el.textContent = `Indovina ora: +${bonus}s`;
  el.classList.remove('hidden');
}

// Pannello di fine partita, in due varianti: vittoria (formazione
// completata) o sconfitta (tempo scaduto prima di finire, solo in modalita'
// a tempo). Suono diverso nei due casi: fischio+gol se vinta, solo fischio
// (niente esultanza) se persa.
function showMatchComplete(won) {
  document.getElementById('playerCardOverlay').classList.add('hidden');
  stopTimer();
  // a partita finita il blocco squadra non serve piu' -- sblocco entrambi i
  // tab cosi' si puo' sempre sfogliare liberamente il campo di entrambe
  // (serve anche a "Chi non hai indovinato?" per vedere l'altra squadra).
  document.getElementById('teamTabHome').classList.remove('locked');
  document.getElementById('teamTabAway').classList.remove('locked');
  // i pallini non devono restare cliccabili a partita finita -- altrimenti
  // durante "Chi non hai indovinato?" si potrebbe riaprire la card e
  // continuare a "giocare" un giocatore anche a tempo scaduto/gioco vinto.
  document.querySelector('.pitch-stage').classList.add('match-over');

  const total = state.match.teams.reduce((sum, t) => sum + t.lineup.length, 0);
  const done = Object.keys(state.solved).length;

  const panel = document.getElementById('completePanel');
  const guessedRow = document.getElementById('completeGuessedRow');
  panel.classList.toggle('lost', !won);
  document.getElementById('completeFlag').textContent = won ? '🏁' : '⏱️';
  document.getElementById('completeTitle').textContent = won ? 'Formazione completata' : 'Tempo scaduto';
  guessedRow.classList.toggle('hidden', won);
  if (!won) document.getElementById('completeGuessed').textContent = `${done} / ${total}`;

  if (won) {
    playMatchCompleteSound();
  } else {
    playSound('fischio');
  }

  document.getElementById('completeTime').textContent = formatElapsed(Date.now() - state.startTime);
  document.getElementById('completeHints').textContent = String(state.usedHints.size);
  document.getElementById('completeFailed').textContent = String(state.failedAttempts);

  // streak solo in Remuntada -- in gioco libero non esiste il concetto.
  const streakRow = document.getElementById('completeStreakRow');
  streakRow.classList.toggle('hidden', !state.timing);
  if (state.timing) document.getElementById('completeStreak').textContent = String(state.bestStreak);

  exitMissedReveal();
  const toggle = document.getElementById('completeMissedToggle');
  if (won) {
    toggle.classList.add('hidden');
  } else {
    const anyMissed = state.match.teams.some(t => t.lineup.some(e => !state.solved[e.player_id]));
    toggle.textContent = 'Chi non hai indovinato? ▸';
    toggle.classList.toggle('hidden', !anyMissed);
  }

  document.getElementById('matchCompleteOverlay').classList.remove('hidden');
}

// "Chi non hai indovinato?" -- invece di una lista a parte, il pannello si
// fa da parte e sul campo compaiono i cognomi solo sui pallini non
// indovinati (al massimo restano 5-6 a partita, quindi non affolla).
// Funziona su entrambe le squadre: i tab restano cliccabili anche in questa
// modalita'.
document.getElementById('completeMissedToggle').addEventListener('click', () => {
  const overlay = document.getElementById('matchCompleteOverlay');
  const toggle = document.getElementById('completeMissedToggle');
  const active = overlay.classList.toggle('peeking');
  document.querySelector('.pitch-stage').classList.toggle('reveal-missed', active);
  toggle.textContent = active ? '← Torna al risultato' : 'Chi non hai indovinato? ▸';
});

function exitMissedReveal() {
  document.getElementById('matchCompleteOverlay').classList.remove('peeking');
  document.querySelector('.pitch-stage').classList.remove('reveal-missed');
}

function maybeShowMatchComplete() {
  const total = state.match.teams.reduce((sum, t) => sum + t.lineup.length, 0);
  const done = Object.keys(state.solved).length;
  if (done < total) return false;
  showMatchComplete(true);
  return true;
}

document.getElementById('completeBackToMenu').addEventListener('click', () => {
  document.getElementById('matchCompleteOverlay').classList.add('hidden');
  showScreen('screen-play-type');
});
document.getElementById('completeNewGame').addEventListener('click', () => {
  document.getElementById('matchCompleteOverlay').classList.add('hidden');
  showScreen('screen-mode');
});

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

// Se il nome mostrato e' un mononimo (es. "Neymar", "Ronaldinho"), l'unica
// "parola" disponibile e' gia' l'identita' completa -- dare quella come
// indizio "Nome" rivelerebbe la risposta, quindi l'indizio resta vuoto.
function firstName(fullName) {
  const tokens = fullName.trim().split(/\s+/);
  return tokens.length > 1 ? tokens[0] : '';
}

function displayName(player) {
  return player.display_name || player.full_name;
}

function buildHints(entry, player, teamName) {
  // Ordine: "Nome" sempre primo (e' il piu' importante concettualmente,
  // indipendentemente dal costo), poi gli altri crescenti per costo in
  // secondi (5/8/10/12) cosi' il piu' economico e' il primo che si nota.
  const hints = [
    { id: 'firstname', label: 'Nome', value: escapeHtml(firstName(displayName(player))) },
    { id: 'birthdate', label: 'Anno di nascita', value: escapeHtml(player.birth_date ? player.birth_date.slice(0, 4) : '—') },
    { id: 'shirt', label: 'Numero di maglia', value: escapeHtml(String(entry.shirt_number ?? '—')) },
    { id: 'career', label: 'Carriera', value: careerTimelineHtml(player, teamName) },
    { id: 'nationality', label: 'Nazionalità', value: escapeHtml(player.nationality || '—') },
  ];
  // "Chi e'?" rivela la risposta diretta -- niente scorciatoie mentre
  // corri contro il tempo.
  if (!state.timing) {
    hints.push({ id: 'reveal', label: 'Chi è?', value: `<strong>${escapeHtml(displayName(player))}</strong>` });
  }
  return hints;
}

function renderHints() {
  const list = document.getElementById('hintList');
  list.innerHTML = state.currentHints.map(h => {
    const isOpen = state.openHints.has(h.id);
    // in modalita' a tempo mostro quanto costa l'indizio in secondi -- solo
    // finche' non e' mai stato usato per QUESTO giocatore. Una volta pagato
    // resta nascosto anche richiudendo la card (non e' legato al toggle
    // aperto/chiuso, cosi' si ricorda facilmente quali indizi sono gia'
    // stati "spesi" su questo giocatore).
    const alreadyUsed = state.usedHints.has(`${state.currentCardPlayerId}:${h.id}`);
    // "Nome" non costa secondi ma ha un tetto di utilizzi a partita (parte
    // da NAME_HINT_MAX_USES, cresce con lo streak) -- mostro quanti ne
    // restano invece del prezzo, e se sono a zero la card resta visibile
    // ma disabilitata con un badge "Esaurito".
    const exhausted = h.id === 'firstname' && state.timing && !alreadyUsed && state.nameHintUsesLeft <= 0;
    let cost = '';
    if (exhausted) {
      cost = `<span class="hint-cost hint-exhausted">Esaurito</span>`;
    } else if (h.id === 'firstname' && state.timing && !alreadyUsed) {
      cost = `<span class="hint-cost hint-remaining"><span class="jolly-emoji">🃏</span> ${state.nameHintUsesLeft} rimasti</span>`;
    } else if (state.timing && !alreadyUsed && HINT_TIME_PENALTY[h.id] != null) {
      cost = `<span class="hint-cost">-${HINT_TIME_PENALTY[h.id]}s</span>`;
    }
    return `
      <div class="hint-card${isOpen ? ' open' : ''}${exhausted ? ' disabled' : ''}" data-hint-id="${h.id}">
        <div class="hint-card-head">
          <div class="hint-card-label">${h.label}</div>
          <div class="hint-card-head-right">
            ${cost}
            <div class="hint-card-caret">▸</div>
          </div>
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
      if (card.classList.contains('disabled')) return;
      if (state.openHints.has(id)) {
        state.openHints.delete(id);
      } else {
        // "Nome" esaurito (mai usato per QUESTO giocatore, zero utilizzi
        // rimasti): niente apertura, resta un rifiuto silenzioso -- il
        // badge "Esaurito" ha gia' spiegato perche'.
        if (id === 'firstname' && state.timing && !state.usedHints.has(`${state.currentCardPlayerId}:${id}`) && state.nameHintUsesLeft <= 0) {
          return;
        }
        state.openHints.add(id);
        // conto l'aiuto la prima volta che si apre (chiudere/riaprire non
        // vale doppio) -- "Chi e'?" e' la rivelazione diretta, non un vero
        // aiuto, quindi non entra nel conteggio. In modalita' a tempo, la
        // stessa prima apertura toglie anche i secondi di penalita'.
        if (id !== 'reveal') {
          const key = `${state.currentCardPlayerId}:${id}`;
          const isFirstOpen = !state.usedHints.has(key);
          if (isFirstOpen && id === 'firstname' && state.timing) {
            state.nameHintUsesLeft--;
            updateStreakLabel();
          }
          state.usedHints.add(key);
          if (isFirstOpen && id === 'nationality') refreshDotFlag(state.currentCardPlayerId);
          if (isFirstOpen && HINT_TIME_PENALTY[id] != null) applyTimePenalty(HINT_TIME_PENALTY[id]);
        }
      }
      renderHints();
      updateGuessIncentiveLine();
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
  // il suggerimento di autocomplete restava visibile da un giocatore
  // precedente (impostare .value via JS non fa scattare l'evento 'input'
  // che di solito lo aggiorna) -- lo svuoto esplicitamente ogni volta che
  // si apre una card, cosi' e' sempre pulita.
  const suggestListEl = document.getElementById('suggestList');
  suggestListEl.innerHTML = '';
  suggestListEl.classList.add('hidden');
  document.getElementById('guessSubmitBtn').disabled = true;

  updateGuessIncentiveLine();

  // a partita finita basta il nome, anche per i giocatori mai indovinati --
  // niente piu' indizi/tentativo di indovinare a tempo scaduto.
  const matchOver = document.querySelector('.pitch-stage').classList.contains('match-over');
  if (state.solved[entry.player_id] || matchOver) {
    solvedBlock.classList.remove('hidden');
    unsolvedBlock.classList.add('hidden');
    document.getElementById('solvedName').textContent = displayName(player);
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
  const rawGuess = document.getElementById('guessInput').value;
  const guess = normalizeName(rawGuess);
  const feedback = document.getElementById('guessFeedback');

  if (!guess) return;
  // difesa in profondita': il pulsante e' gia' disabilitato quando il testo
  // non e' un nome reale (vedi setupSuggestions), ma un invio comunque
  // arrivato (es. Invio da tastiera) non deve mai contare come tentativo.
  if (document.getElementById('guessSubmitBtn').disabled) return;

  // Accetto SOLO l'identita' completa (nome+cognome), mai un singolo nome o
  // cognome isolato -- ma con tolleranza: confronto sia il nome ufficiale
  // completo sia il nome corto mostrato in gioco (display_name), spezzando
  // anche su trattini/apostrofi (es. "Agyemang-Badu" -> due token) cosi'
  // piccole differenze di punteggiatura non bloccano una risposta giusta.
  const nameTokenLists = [];
  const acceptedNorms = new Set();
  for (const name of [player.full_name, displayName(player)]) {
    const norm = normalizeName(name);
    if (norm) acceptedNorms.add(norm);
    const tokens = name.split(/[\s\-']+/).map(normalizeName).filter(t => t.length >= 2);
    if (tokens.length >= 2) acceptedNorms.add(tokens[0] + tokens[tokens.length - 1]);
    nameTokenLists.push(tokens);
  }
  let isCorrect = acceptedNorms.has(guess);

  // Tolleranza per cognomi con particella ("De Rossi", "de Vrij", "Fabian
  // Ruiz" senza accento): se le parole digitate (>=2) formano una sequenza
  // contigua di token del nome, la accetto anche se non e' l'intera
  // identita' o la forma "primo+ultimo token" -- niente token isolato pero',
  // la regola "identita' completa" resta.
  if (!isCorrect) {
    const guessTokens = rawGuess.trim().split(/[\s\-']+/).map(normalizeName).filter(t => t.length >= 1);
    if (guessTokens.length >= 2) {
      isCorrect = nameTokenLists.some(tokens => {
        for (let i = 0; i + guessTokens.length <= tokens.length; i++) {
          if (guessTokens.every((g, j) => tokens[i + j] === g)) return true;
        }
        return false;
      });
    }
  }

  if (isCorrect) {
    const bonus = computeGuessBonus(playerId);
    let totalGained = bonus;
    let flashText = null; // null = lascia che applyTimeBonus mostri il default "+Xs"

    // Streak di risposte consecutive senza indizi, ciclo fisso da 5: a 3 un
    // uso extra di "Nome", a 5 un altro jolly PIU' un minuto intero, poi lo
    // streak si azzera e riparte da capo. Usare un indizio non fa avanzare
    // lo streak ma nemmeno lo azzera -- e' una scelta, non una colpa. Un
    // ERRORE invece lo azzera subito, nel momento stesso in cui accade
    // (vedi ramo "else" sotto) -- ma da quel momento in poi lo streak non
    // ha piu' memoria dell'errore: se ora rispondi senza indizi, anche
    // sullo stesso giocatore su cui avevi appena sbagliato, conta come
    // qualunque altra risposta pulita (bonus.perfect o .noHints sono
    // equivalenti per lo streak, la differenza tra i due resta solo nel
    // bonus in secondi). Se piu' cose scattano sulla stessa risposta, un
    // solo flash combinato invece di piu' animazioni che si accavallano.
    if (state.timing) {
      if (bonus === GUESS_BONUS.perfect || bonus === GUESS_BONUS.noHints) {
        state.perfectStreak++;
        state.bestStreak = Math.max(state.bestStreak, state.perfectStreak);
        const badges = [];
        if (state.perfectStreak === STREAK_FOR_JOLLY) {
          state.nameHintUsesLeft++;
          totalGained += STREAK_JOLLY_SECONDS_BONUS;
          badges.push('🃏');
        }
        if (state.perfectStreak === STREAK_FOR_MINUTE) {
          state.nameHintUsesLeft++;
          totalGained += STREAK_MINUTE_BONUS;
          badges.push('🃏⚡');
          state.perfectStreak = 0; // ciclo completo: si azzera e riparte
        }
        if (badges.length) flashText = `+${totalGained}s ${badges.join(' ')}`;
      }
      // bonus === GUESS_BONUS.base (indizi usati per QUESTA risposta):
      // streak congelato, non si tocca qui.
      updateStreakLabel();
    }

    applyTimeBonus(totalGained, flashText);
    state.solved[playerId] = true;
    refreshDotState(playerId);
    updateScore();

    // Se la formazione "impegnata" (Remuntada) e' ora completa, si sblocca
    // l'altra squadra e si guadagna un bonus una tantum.
    if (state.timing && state.commitTeamIdx !== null && !state.teamLockBonusGiven && isTeamFullySolved(state.commitTeamIdx)) {
      state.teamLockBonusGiven = true;
      updateTeamLockUI();
      applyTimeBonus(TEAM_LOCK_BONUS);
    }

    // Sull'ultimo giocatore si salta del tutto la card "risolto" (e il suo
    // suono gol): si va dritti al pannello finale con fischio+gol, invece
    // di mostrare per un attimo lo stato risolto e poi passare al pannello.
    const matchCompleted = maybeShowMatchComplete();
    if (!matchCompleted) {
      document.getElementById('cardSolved').classList.remove('hidden');
      document.getElementById('cardUnsolved').classList.add('hidden');
      document.getElementById('solvedName').textContent = displayName(player);
      playSound('gol');
    }
  } else {
    state.failedAttempts++;
    state.wrongAttemptsByPlayer[playerId] = (state.wrongAttemptsByPlayer[playerId] || 0) + 1;
    // un errore azzera subito lo streak, nel momento stesso in cui accade --
    // non aspetta che QUESTO giocatore venga eventualmente risolto (prima
    // il reset scattava solo li', e nel frattempo altre risposte perfette
    // continuavano a far crescere lo streak come se l'errore non ci fosse
    // mai stato, e l'etichetta a schermo non si aggiornava sull'errore).
    if (state.timing) {
      state.perfectStreak = 0;
      updateStreakLabel();
    }
    applyTimePenalty(WRONG_GUESS_TIME_PENALTY);
    playSound('palo');
    feedback.textContent = 'Non è lui/lei. Riprova!';
    feedback.className = 'guess-feedback wrong';
    document.getElementById('guessInput').value = '';
    // niente re-focus qui: su mobile la tastiera che riappare scrolla la
    // vista sull'input, spostando il pannello dal centro dello schermo
    // (dove invece deve restare, cosi' si vede anche il flash del
    // countdown sullo sfondo). L'utente rifocalizza lui stesso se vuole
    // riprovare subito.
    document.getElementById('guessInput').blur();
    document.getElementById('suggestList').innerHTML = '';
    document.getElementById('suggestList').classList.add('hidden');
    document.getElementById('guessSubmitBtn').disabled = true;
    updateGuessIncentiveLine();
  }
});
