'use strict';

// ── Position-aware framing ──
const POSITION_FRAMES = {
  '今日指引':   '今天，這張牌帶給你的訊息是：',
  '過去':       '回顧過去，這樣的能量曾深深影響著你：',
  '現在':       '在當下這個時刻，你正經歷的是：',
  '未來':       '往前看，接下來的走向將是：',
  '情況':       '你目前所身處的狀態是：',
  '障礙':       '橫在你面前、需要去面對的是：',
  '建議':       '牌給你的指引是：',
  '結果':       '這段旅程可能帶來的收穫：',
  '潛意識':     '在你還未意識到的內心深處：',
  '現況核心':   '你當下處境的核心能量是：',
  '挑戰/阻礙':  '你需要跨越的挑戰是：',
  '潛意識根基': '在你潛意識最深層扎根的是：',
  '近期過去':   '在不久前發生、仍在影響你的是：',
  '潛在結果':   '若順著現在的方向走下去：',
  '近期未來':   '在不久的將來，你可能會面對：',
  '你的態度':   '你帶入這個情況的自身能量是：',
  '外在環境':   '你周圍的環境與他人帶來的影響是：',
  '希望與恐懼': '你心裡既期待又害怕的是：',
  '最終結果':   '整個局面最終可能走向的是：',
  '神明的訊息': '',
  '事情類型':       '宇宙想讓你知道，眼前這件事的本質是：',
  '注意事項':       '在這個過程中，你需要特別留意的是：',
  '宇宙的祝福':     '不管結果如何，宇宙想給你的祝福是：',
  '這季留下了什麼': '回顧這一季，真正留在你身上的是：',
  '需要放下的':     '在進入下一季之前，是時候放下：',
  '下一季的意圖':   '帶著清醒的心走入下一季，你的意圖是：',
  '宇宙給你的祝福': '在這個節氣的轉換時刻，宇宙想給你的祝福是：',
};

function getPositionedDesc(card, position) {
  const frame = POSITION_FRAMES[position] ?? '';
  const base = card.desc || card.message || '';
  if (!frame) return base;
  return frame + base;
}

// ── State ──
const state = {
  series: null,
  spread: null,
  deck: [],          // all cards shuffled
  selections: [],    // { positionIndex, card } in order selected
  currentPos: 0,     // which position we're filling next
  usedIds: new Set(),
};

// ── DOM helpers ──
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');
const showOnly = id => {
  ['screen-launch', 'screen-home', 'screen-spread', 'screen-seasons-confirm', 'screen-board'].forEach(hide);
  show(id);
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Navigation ──
function goHome() {
  Object.assign(state, { series: null, spread: null, deck: [], selections: [], currentPos: 0, usedIds: new Set() });
  showOnly('screen-home');
}

function chooseSeries(s) {
  state.series = s;
  if (s === 'tarot') {
    showOnly('screen-spread');
    renderSpreadOptions();
  } else {
    state.spread = { name: '神明訊息牌', subtitle: '抽一張，也許那些讓你糾結的，\n會在這裡找到新的角度去看待這件事', count: 1, positions: ['神明的訊息'], _key: 'deity' };
    startSelection();
  }
}

// ── Spread selection ──
function renderSpreadOptions() {
  const container = $('spread-options');
  container.innerHTML = '';
  Object.entries(SPREADS).forEach(([key, sp]) => {
    const el = document.createElement('button');
    el.className = 'spread-card';
    el.innerHTML = `
      <div class="spread-count">${sp.count}</div>
      <div class="spread-name">${sp.name}</div>
      <div class="spread-divider"></div>
      <div class="spread-sub">${sp.subtitle}</div>
    `;
    el.addEventListener('click', () => {
      state.spread = { ...sp, _key: key };
      if (key === 'seasons') {
        showOnly('screen-seasons-confirm');
      } else {
        startSelection();
      }
    });
    container.appendChild(el);
  });
}

// ── Start selection mode ──
function startSelection(showPrepare = true) {
  const pool = state.series === 'tarot' ? TAROT_CARDS : DEITY_CARDS;
  state.deck = shuffle(pool);
  state.selections = new Array(state.spread.count).fill(null);
  state.currentPos = 0;
  state.usedIds = new Set();

  showOnly('screen-board');
  $('board-title').textContent = state.spread.name;
  $('board-sub').innerHTML = (state.spread.subtitle || '').replace(/\n/g, '<br>');

  // 只有第一次進入才顯示準備 overlay
  if (showPrepare) {
    $('prepare-overlay').classList.remove('hidden');
  } else {
    $('prepare-overlay').classList.add('hidden');
  }

  renderPositionSlots();
  renderCardPool();
  updateProgress();
  hide('meanings-section');
  $('swipe-hint').innerHTML = '<span class="hint-arrow">←</span> 請左右滑動，來選牌 <span class="hint-arrow">→</span>';
}

// ── Position slots (top row) ──
function renderPositionSlots() {
  const container = $('position-slots');
  container.innerHTML = '';
  state.spread.positions.forEach((pos, i) => {
    const slot = document.createElement('div');
    slot.className = 'pos-slot';
    slot.id = `pos-slot-${i}`;
    slot.innerHTML = `
      <div class="pos-label">${pos}</div>
      <div class="pos-card empty">
        <span class="pos-num">${i + 1}</span>
      </div>
    `;
    container.appendChild(slot);
  });
}

function updateProgress() {
  const filled = state.selections.filter(Boolean).length;
  const total = state.spread.count;

  // Highlight current slot
  for (let i = 0; i < total; i++) {
    const slot = $(`pos-slot-${i}`);
    if (!slot) continue;
    slot.classList.toggle('active', i === state.currentPos && filled < total);
    slot.classList.toggle('done', !!state.selections[i]);
  }

  // Progress text
  $('progress-text').textContent = filled < total
    ? `選第 ${filled + 1} 張：${state.spread.positions[state.currentPos]}`
    : '選牌完成！';

  // Show reveal button and animate pool away when all done
  if (filled === total) {
    if (state.series !== 'deity') show('btn-reveal-meanings');
    hide('swipe-hint');
    animatePoolOut();
    if (state.series === 'deity') setTimeout(() => showMeanings(false), 1000);
  } else {
    hide('btn-reveal-meanings');
    show('btn-reset-selection');
    $('card-pool-wrap').classList.remove('pool-done');
  }
}

// ── Card pool ──
function renderCardPool() {
  const container = $('card-pool');
  container.innerHTML = '';

  state.deck.forEach(card => {
    const el = document.createElement('div');
    el.className = 'pool-card';
    el.dataset.id = card.id;

    const folder = state.series === 'tarot' ? 'images/tarot/' : 'images/deity/';
    el.innerHTML = `
      <div class="pool-card-inner">
        <img src="images/tarot/card-back.png" alt="牌背">
      </div>
    `;

    el.addEventListener('click', () => pickCard(card, el));
    container.appendChild(el);
  });
}

function pickCard(card, el) {
  if (state.usedIds.has(card.id)) return;
  if (state.currentPos >= state.spread.count) return;

  // Mark card as used
  state.usedIds.add(card.id);
  el.classList.add('used');

  // Fill position slot
  const posIdx = state.currentPos;
  state.selections[posIdx] = card;

  const slot = $(`pos-slot-${posIdx}`);
  const posCard = slot.querySelector('.pos-card');
  posCard.classList.remove('empty');

  const folder = state.series === 'tarot' ? 'images/tarot/' : 'images/deity/';
  const imgSrc = `${folder}${card.file}`;
  const isDeity = state.series === 'deity';
  posCard.innerHTML = `<img src="${imgSrc}" alt="${card.name}"${isDeity ? ' class="deity-img"' : ''} onclick="openLightbox(this.src)" style="cursor:pointer">`;
  posCard.dataset.imgSrc = imgSrc;

  // 顯示牌名在槽位下方
  let nameEl = slot.querySelector('.pos-card-name-below');
  if (!nameEl) {
    nameEl = document.createElement('div');
    nameEl.className = 'pos-card-name-below';
    slot.appendChild(nameEl);
  }
  nameEl.textContent = card.name;

  // 預先把圖片轉成 data URL，讓存圖時不受 file:// 限制
  const preload = new Image();
  preload.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = preload.naturalWidth;
      c.height = preload.naturalHeight;
      c.getContext('2d').drawImage(preload, 0, 0);
      card._dataURL = c.toDataURL('image/png');
      posCard.dataset.dataUrl = card._dataURL; // lightbox 用
    } catch (e) { /* file:// 環境下可能失敗，留空即可 */ }
  };
  preload.src = imgSrc;


  // Advance
  state.currentPos++;
  updateProgress();
}

// ── Animate pool out (right → left stagger) ──
function animatePoolOut() {
  const wrap = $('card-pool-wrap');
  const cards = Array.from(document.querySelectorAll('#card-pool .pool-card'));
  const total = cards.length;
  const STAGGER = 16; // ms between each card

  wrap.classList.add('animating');
  document.body.style.overflowX = 'hidden'; // 防止動畫期間出現橫向捲軸

  cards.forEach((card, i) => {
    const delay = (total - 1 - i) * STAGGER; // 最右邊先飛出
    card.style.setProperty('--fly-delay', `${delay}ms`);
    card.classList.add('fly-out');
  });

  const totalDuration = (total - 1) * STAGGER + 180 + 60;
  setTimeout(() => {
    document.body.style.overflowX = '';
    wrap.classList.remove('animating');
    wrap.classList.add('pool-done');
    // 牌庫消失後，把排陣結果滾入視野（塔羅牌）
    if (state.series !== 'deity') {
      $('position-slots-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, totalDuration);
}

// ── Reset ──
function resetSelection() {
  startSelection(false);
}

// ── Show meanings ──
function showMeanings(autoScroll = true) {
  show('meanings-section');
  renderMeanings();
  if (autoScroll) $('meanings-section').scrollIntoView({ behavior: 'smooth' });
}

function renderMeanings() {
  const disclaimer = $('meanings-disclaimer');
  if (state.series === 'tarot') {
    disclaimer.innerHTML = '如果你不會解塔羅，歡迎透過閱讀文字，去感受跟進行自我提問，來為自己找到答案。<br><br>任何的訊息，都只是給予我們去尋找別的切角的可能，<br><br>而不是生命只能是這方向的劇本，因為我們永遠擁有自己生命裡的選擇權。';
  } else {
    disclaimer.innerHTML = '這裡沒有任何生命裡的答案，這有的是邀請我們重新檢視自己，注意自己，好好對自己提問，讓我們把力氣放回自己身上，而非外在的追尋。';
  }

  const container = $('meanings-list');
  container.innerHTML = '';
  state.selections.forEach((card, i) => {
    if (!card) return;
    const pos = state.spread.positions[i];
    const div = document.createElement('div');
    div.className = 'meaning-card';
    const cardText = card.desc || card.message || '';
    const oracleText = card.oracle || '';
    div.innerHTML = `
      <div class="meaning-header">
        <span class="meaning-pos">${pos}</span>
        <span class="meaning-name">${card.name}</span>
      </div>
      <div class="meaning-keyword">${card.meaning || ''}</div>
      ${cardText ? `<div class="meaning-desc"><span class="meaning-label">牌面文字</span>${cardText}</div>` : ''}
      ${oracleText ? `<div class="meaning-oracle">${oracleText}</div>` : ''}
    `;
    container.appendChild(div);
  });
}

// ── Fetch image as dataURL (bypasses canvas taint) ──
async function fetchDataURL(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) { console.warn('[fetchDataURL] HTTP error', res.status, src); return null; }
    const blob = await res.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (e) => { console.warn('[fetchDataURL] FileReader error', e); resolve(null); };
      reader.readAsDataURL(blob);
    });
  } catch(e) {
    console.warn('[fetchDataURL] fetch failed:', e.message, src);
    return null;
  }
}

// ── Export: save as PNG (1080×auto canvas renderer) ──
async function saveImage() {
  if (location.protocol === 'file:') {
    alert('存圖功能需要透過伺服器開啟 👇\n\n請用瀏覽器開啟：\nhttp://127.0.0.1:5500');
    return;
  }

  const btn = $('btn-save-image');
  btn.textContent = '產生中…';
  btn.disabled = true;

  try {
    const folder = state.series === 'tarot' ? 'images/tarot/' : 'images/deity/';

    // 用 fetch 把每張圖片轉成 dataURL，完全繞開 canvas taint
    await Promise.all(state.selections.map(async card => {
      if (!card) return;
      card._dataURL = await fetchDataURL(folder + card.file);
    }));

    // 把 dataURL 載入成 Image 物件供 canvas drawImage 使用
    const cardImgs = await Promise.all(state.selections.map(card => {
      if (!card || !card._dataURL) return Promise.resolve(null);
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = card._dataURL;
      });
    }));

    const W = 1080;
    const PAD = 64;
    const INNER = W - PAD * 2;
    const FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    const CARD_RATIO = 207 / 125;
    const count = state.spread.count;

    // Card sizes by count
    let cardW, cardsPerRow;
    if (count === 1)      { cardW = 260; cardsPerRow = 1; }
    else if (count <= 3)  { cardW = 210; cardsPerRow = count; }
    else if (count <= 5)  { cardsPerRow = count; cardW = Math.floor((INNER - (count-1)*16) / count); }
    else                  { cardsPerRow = Math.ceil(count/2); cardW = Math.floor((INNER - (cardsPerRow-1)*16) / cardsPerRow); }
    const cardH = Math.round(cardW * CARD_RATIO);
    const cardRows = Math.ceil(count / cardsPerRow);

    // ── Helpers (work on a temp ctx for measurement) ──
    const tmpC = document.createElement('canvas');
    tmpC.width = INNER;
    const tmpCtx = tmpC.getContext('2d');

    function wrapLine(ctx, text, maxW, font) {
      ctx.font = font;
      const lines = [];
      let cur = '';
      for (const ch of text) {
        const test = cur + ch;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = ch; }
        else cur = test;
      }
      if (cur) lines.push(cur);
      return lines;
    }

    // ── Pre-calculate total canvas height ──
    let totalH = PAD + 52 + 72 + 52 + 44; // top pad + ornament + title + subtitle + divider

    for (let r = 0; r < cardRows; r++) {
      totalH += 40 + cardH + 44 + 20; // label + card + name + gap
    }
    totalH += 44 + 52; // divider + meanings header

    const BPAD = 28;
    const DESC_FONT = `400 30px ${FONT}`;
    const KW_FONT   = `500 26px ${FONT}`;
    for (const card of state.selections) {
      if (!card) continue;
      const pos = state.spread.positions[state.selections.indexOf(card)];
      const desc = getPositionedDesc(card, pos);
      const dLines = wrapLine(tmpCtx, desc, INNER - BPAD*2, DESC_FONT);
      const kLines = card.meaning ? wrapLine(tmpCtx, card.meaning, INNER - BPAD*2, KW_FONT) : [];
      const emptyLines = dLines.filter(l => l === '').length;
      totalH += BPAD + 44 + kLines.length*38 + 10 + (dLines.length - emptyLines)*48 + emptyLines*24 + BPAD + 16;
    }
    totalH += PAD + 52; // bottom

    const H = Math.max(1920, totalH);

    // ── Draw ──
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    function rr(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
      ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
      ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
      ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
      ctx.closePath();
    }

    function ctxWrap(text, maxW, font) {
      ctx.font = font;
      const result = [];
      for (const para of text.split('\n')) {
        if (para === '') { result.push(''); continue; }
        let cur = '';
        for (const ch of para) {
          const test = cur + ch;
          if (ctx.measureText(test).width > maxW && cur) { result.push(cur); cur = ch; }
          else cur = test;
        }
        if (cur) result.push(cur);
      }
      return result;
    }

    // Background
    ctx.fillStyle = '#EDE8DF';
    ctx.fillRect(0, 0, W, H);

    let y = PAD;

    // Ornament
    ctx.fillStyle = '#97AFCA';
    ctx.font = `500 36px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('✦  ✦  ✦', W/2, y + 36);
    y += 52;

    // Title
    ctx.fillStyle = '#2C3A4A';
    ctx.font = `700 58px ${FONT}`;
    ctx.fillText(state.spread.name, W/2, y + 58);
    y += 72;

    // Subtitle
    ctx.fillStyle = '#5A6A7A';
    ctx.font = `400 32px ${FONT}`;
    ctx.fillText(state.spread.subtitle || '', W/2, y + 32);
    y += 52;

    // Divider
    ctx.strokeStyle = '#D9D3C7';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W-PAD, y); ctx.stroke();
    y += 44;

    // Cards
    for (let row = 0; row < cardRows; row++) {
      const rStart = row * cardsPerRow;
      const rEnd   = Math.min(rStart + cardsPerRow, count);
      const rCount = rEnd - rStart;
      const rowW   = rCount * cardW + (rCount-1) * 16;
      const startX = (W - rowW) / 2;

      // Labels
      ctx.font = `600 24px ${FONT}`;
      ctx.textAlign = 'center';
      for (let i = rStart; i < rEnd; i++) {
        const cx = startX + (i-rStart)*(cardW+16) + cardW/2;
        const pos = state.spread.positions[i];
        const lw = ctx.measureText(pos).width + 26;
        ctx.fillStyle = '#4C7A91';
        rr(cx - lw/2, y, lw, 32, 16); ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'middle';
        ctx.fillText(pos, cx, y + 16);
        ctx.textBaseline = 'alphabetic';
      }
      y += 43;

      // Images — 圖片在白框內縮 4% 留邊
      const IMG_INSET = Math.round(cardW * 0.04);
      for (let i = rStart; i < rEnd; i++) {
        const cx = startX + (i-rStart)*(cardW+16);
        const img = cardImgs[i];

        ctx.shadowColor = 'rgba(44,58,74,0.18)';
        ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
        ctx.fillStyle = '#FFFFFF';
        rr(cx-4, y-4, cardW+8, cardH+8, 12); ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

        if (img) {
          ctx.save();
          rr(cx+IMG_INSET, y+IMG_INSET, cardW-IMG_INSET*2, cardH-IMG_INSET*2, 6); ctx.clip();
          ctx.drawImage(img, cx+IMG_INSET, y+IMG_INSET, cardW-IMG_INSET*2, cardH-IMG_INSET*2);
          ctx.restore();
        } else {
          ctx.fillStyle = '#D9D3C7';
          rr(cx+IMG_INSET, y+IMG_INSET, cardW-IMG_INSET*2, cardH-IMG_INSET*2, 6); ctx.fill();
        }
      }
      y += cardH;

      // Card names — 間距 +8%
      ctx.fillStyle = '#2C3A4A';
      ctx.font = `600 26px ${FONT}`;
      ctx.textAlign = 'center';
      for (let i = rStart; i < rEnd; i++) {
        const cx = startX + (i-rStart)*(cardW+16) + cardW/2;
        const card = state.selections[i];
        if (card) ctx.fillText(card.name, cx, y + 35);
      }
      y += 48 + 22;
    }

    // Divider
    ctx.strokeStyle = '#D9D3C7';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W-PAD, y); ctx.stroke();
    y += 44;

    // Meanings header
    ctx.fillStyle = '#97AFCA';
    ctx.font = `500 34px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('✦  牌義解讀  ✦', W/2, y + 34);
    y += 52;

    // Meaning blocks
    for (let i = 0; i < state.selections.length; i++) {
      const card = state.selections[i];
      if (!card) continue;
      const pos = state.spread.positions[i];
      const desc = getPositionedDesc(card, pos);

      const kLines = card.meaning ? ctxWrap(card.meaning, INNER - BPAD*2, KW_FONT) : [];
      const dLines = ctxWrap(desc, INNER - BPAD*2, DESC_FONT);
      const emptyLines = dLines.filter(l => l === '').length;
      const blockH = BPAD + 44 + kLines.length*38 + 10 + (dLines.length - emptyLines)*48 + emptyLines*24 + BPAD;

      ctx.fillStyle = '#F5F2EC';
      rr(PAD, y, INNER, blockH, 16); ctx.fill();

      let by = y + BPAD;

      // Badge
      ctx.font = `600 22px ${FONT}`;
      const bw = ctx.measureText(pos).width + 24;
      ctx.fillStyle = '#4C7A91';
      rr(PAD+BPAD, by, bw, 30, 15); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(pos, PAD+BPAD+12, by+15);
      ctx.textBaseline = 'alphabetic';

      // Name
      ctx.fillStyle = '#2C3A4A';
      ctx.font = `700 34px ${FONT}`;
      ctx.fillText(card.name, PAD+BPAD+bw+14, by+25);
      by += 44;

      // Keywords
      ctx.fillStyle = '#C66240';
      ctx.font = KW_FONT;
      for (const ln of kLines) { ctx.fillText(ln, PAD+BPAD, by+24); by += 38; }
      if (kLines.length) by += 10;

      // Description
      ctx.fillStyle = '#5A6A7A';
      ctx.font = DESC_FONT;
      for (const ln of dLines) {
        if (ln === '') { by += 24; continue; } // 段落間距
        ctx.fillText(ln, PAD+BPAD, by+30); by += 48;
      }

      y += blockH + 16;
    }

    // Bottom ornament + 版權
    const botY = Math.max(y + 32, H - 100);
    ctx.fillStyle = '#97AFCA';
    ctx.font = `500 32px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('✦  ✦  ✦', W/2, botY);

    ctx.fillStyle = '#9AABB8';
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText('CC Triple.Cell_illustration | 細胞日常插畫', W/2, botY + 44);

    // Download
    const link = document.createElement('a');
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    link.download = `Triple.Cell_${state.spread.name}_${dateStr}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();

  } catch (err) {
    console.error(err);
    alert('圖片產生失敗，請重試。');
  } finally {
    btn.textContent = '存成圖片';
    btn.disabled = false;
  }
}

// ── Export: copy text ──
function copyText() {
  const btn = $('btn-copy-text');
  const lines = [`【${state.spread.name}】`, ''];
  state.selections.forEach((card, i) => {
    if (!card) return;
    const pos = state.spread.positions[i];
    lines.push(`▍${pos}・${card.name}`);
    if (card.meaning) lines.push(card.meaning);
    lines.push(card.desc || card.message || '');
    lines.push('');
  });

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    btn.textContent = '✓ 已複製';
    setTimeout(() => { btn.textContent = '複製文字'; }, 2000);
  }).catch(() => {
    btn.textContent = '複製失敗';
    setTimeout(() => { btn.textContent = '複製文字'; }, 2000);
  });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  $('btn-tarot').addEventListener('click', () => chooseSeries('tarot'));
  $('btn-deity').addEventListener('click', () => chooseSeries('deity'));
  $('btn-back-home').addEventListener('click', goHome);
  $('btn-back-home-board').addEventListener('click', goHome);
  $('btn-back-spread').addEventListener('click', () => {
    state.series === 'tarot' ? showOnly('screen-spread') : goHome();
  });
  $('btn-back-seasons').addEventListener('click', () => showOnly('screen-spread'));
  $('btn-seasons-yes').addEventListener('click', startSelection);
  $('btn-seasons-no').addEventListener('click', () => showOnly('screen-spread'));
  $('btn-reset-selection').addEventListener('click', resetSelection);
  $('btn-reveal-meanings').addEventListener('click', showMeanings);
  $('btn-save-image').addEventListener('click', saveImage);
  $('btn-copy-text').addEventListener('click', copyText);
});
