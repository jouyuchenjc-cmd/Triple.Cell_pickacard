'use strict';

// 從舊網站搬過來的資料寫進 localStorage 後（見 migration.js），重新讀取訂閱狀態並重繪。
// 自訂牌陣（tc_custom_spreads）和抽牌紀錄（tc_history）不需要另外處理：
// loadCustomSpreads()/loadHistory() 每次都直接讀 localStorage，下次開啟對應畫面時自然就是新資料。
window.addEventListener('migration:complete', () => {
  loadSubscription();
  renderLockState();
  if (typeof renderMenuSubscriptionInfo === 'function') renderMenuSubscriptionInfo();
});

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
  deck: [],
  selections: [],
  currentPos: 0,
  usedIds: new Set(),
  question: '',
  saved: false,      // 已手動儲存過
  fromHistory: false, // 從歷史還原
};

// ── DOM helpers ──
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');
const showOnly = id => {
  ['screen-launch', 'screen-home', 'screen-spread', 'screen-seasons-confirm', 'screen-board', 'screen-history', 'screen-changelog'].forEach(hide);
  show(id);
  window.scrollTo(0, 0);
};

const CHANGELOG = [
  { date: '2026-08-07', content: '訂閱版釋出，同步上線新的神明訊息牌（擴充神諭）。訂閱內容更新時間不定，但承諾一年至少更新兩次' },
  { date: '2026-06-23', content: '新增自訂牌陣功能：可自訂張數（最多 12 張）與每個位置的提問內容，能儲存供下次直接使用' },
  { date: '2026-06-20', content: '新增塔羅逆位，包含對應關鍵字與專屬訊息，若抽中同時且會以逆位方式呈現牌面' },
  { date: '2026-06-16', content: '新增出遠門牌陣（自選日期，每天一張，最多 30 天）、更新紀錄分頁與預覽、刪除單筆抽牌紀錄、漢堡選單新增資料庫與更新紀錄區塊、修正打字放大畫面問題' },
  { date: '2026-06-15', content: '新增塔羅牌義連結、神明訊息牌牌義顯示修正（標籤樣式與換行保留）' },
];

// ── Subscription (paid unlock) ──
const WORKER_BASE_URL = 'https://triplecell-unlock.jouyu-chen-jc.workers.dev';
const SUBSCRIPTION_KEY = 'tc_subscription';

// ── Email 訂閱（新卡/新功能更新通知，跟上面的付費解鎖是兩件事）──
const WORKER_SUBSCRIBE_URL = 'https://triplecell-unlock.jouyu-chen-jc.workers.dev/subscribe';
const SUBSCRIBE_KEY = 'tc_subscribe_state'; // 'closed' | 'subscribed'（沒有值＝從未出現過，只給牌義解讀那個一次性區塊用）

const subscription = { code: null, expiresAt: null };

function loadSubscription() {
  try {
    const saved = JSON.parse(localStorage.getItem(SUBSCRIPTION_KEY) || 'null');
    if (saved) Object.assign(subscription, saved);
  } catch (e) {}
}

function saveSubscription() {
  try { localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(subscription)); } catch (e) {}
}

function isSubscribed() {
  return !!(subscription.code && subscription.expiresAt && Date.now() < subscription.expiresAt);
}

// app 啟動時背景重新確認到期日（不打斷使用者，靜默更新）
async function refreshSubscription() {
  if (!subscription.code) return;
  try {
    const res = await fetch(`${WORKER_BASE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: subscription.code }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.valid) {
      subscription.expiresAt = data.expiresAt;
    } else {
      subscription.code = null;
      subscription.expiresAt = null;
    }
    saveSubscription();
    renderLockState();
  } catch (e) {
    // 離線或 Worker 還沒上線：先信任本地快取的到期日，不強制登出
  }
}

// 使用者輸入 / 連結帶入 code 時呼叫，主動解鎖
async function redeemCode(code) {
  code = (code || '').trim();
  if (!code) return { ok: false, message: '請輸入解鎖碼' };

  try {
    const res = await fetch(`${WORKER_BASE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.valid) {
      subscription.code = code;
      subscription.expiresAt = data.expiresAt;
      saveSubscription();
      renderLockState();
      return { ok: true, expiresAt: data.expiresAt };
    }
    return { ok: false, message: data.message || '這組解鎖碼無效或已過期' };
  } catch (e) {
    return { ok: false, message: '連線失敗，請稍後再試' };
  }
}

function renderLockState() {
  const hint = $('deity-expansion-hint');
  if (hint) hint.classList.toggle('hidden', isSubscribed());
  renderMenuSubscriptionInfo();
  renderDeityCardCount();
}

function renderDeityCardCount() {
  const el = $('deity-card-count-line');
  if (!el) return;
  const base = DEITY_CARDS.length;
  const total = base + DEITY_EXPANSION_CARDS.length;
  el.textContent = isSubscribed()
    ? `${total} 張牌・神明指引`
    : `${base} 張牌・神明指引`;
}

function renderMenuSubscriptionInfo() {
  const el = $('menu-subscription-info');
  if (!el) return;
  const closeMenu = "document.getElementById('site-menu-panel').classList.remove('open');";
  try {
    if (isSubscribed()) {
      const dateStr = new Date(subscription.expiresAt).toLocaleDateString('zh-TW');
      const daysLeft = Math.ceil((subscription.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
      const expiryWarning = daysLeft <= 7
        ? `<p class="site-menu-sub-status site-menu-sub-status--warning">⚠️ 訂閱將於 ${daysLeft} 天後到期，記得續訂！</p>`
        : '';
      el.innerHTML = `
        <p class="site-menu-sub-status site-menu-sub-status--active">✓ 訂閱中・到期日 ${dateStr}</p>
        ${expiryWarning}
        <p class="site-menu-sub-status">解鎖碼：${subscription.code}（在其他裝置輸入這組碼即可使用）</p>
        <button class="site-menu-series-btn" onclick="${closeMenu} openSubscribeOverlay();">🌟 續訂 / 管理</button>
      `;
    } else {
      el.innerHTML = `
        <p class="site-menu-sub-status">尚未訂閱</p>
        <button class="site-menu-series-btn" onclick="${closeMenu} openSubscribeOverlay();">🩶 立即訂閱解鎖更多神諭</button>
      `;
    }
  } catch (e) {
    console.error('[renderMenuSubscriptionInfo] failed:', e);
    el.innerHTML = `
      <p class="site-menu-sub-status">尚未訂閱</p>
      <button class="site-menu-series-btn" onclick="${closeMenu} openSubscribeOverlay();">🩶 立即訂閱解鎖更多神諭</button>
    `;
  }
}

// ── Subscribe overlay ──
function openSubscribeOverlay() {
  $('redeem-code-input').value = '';
  $('redeem-error').classList.add('hidden');
  $('subscribe-email-input').value = '';
  $('subscribe-email-error').classList.add('hidden');
  $('subscribe-confirm').classList.add('hidden');
  pendingCheckout = null;
  $('subscribe-overlay').classList.remove('hidden');
}

function closeSubscribeOverlay() {
  $('subscribe-overlay').classList.add('hidden');
}

// ── 更新公告（每次重大更新都可以加一筆，只彈一次） ──
// 之後每次想推播新公告，就在這個陣列最後面加一個物件即可
const ANNOUNCEMENTS = [
  {
    id: 'sub-launch-2026-06',
    title: '新功能上線',
    intro: '神明訊息牌新增訂閱制服務',
    benefits: [
      '🔓 解鎖「擴充神諭」，神明訊息牌牌組變大、抽到更多種卡片',
      '🆕 後續的新內容，只要在訂閱期間內都會自動一起解鎖，不用額外付費',
      '📱 同一組解鎖碼可在多個裝置使用，不限定單一手機或瀏覽器',
    ],
    showPlans: true,
    skipIfSubscribed: true,
    ctaText: '即刻訂閱解鎖加值內容',
    onCta: () => { closeAnnounceOverlay(); openSubscribeOverlay(); },
  },
];

const ANNOUNCE_SEEN_KEY = 'tc_last_seen_announce_id';
let _currentAnnounceId = null;

function enterHome() {
  hide('screen-launch');
  show('screen-home');
  maybeShowAnnounce();
}

function maybeShowAnnounce() {
  if (!ANNOUNCEMENTS.length) return;
  const latest = ANNOUNCEMENTS[ANNOUNCEMENTS.length - 1];
  if (latest.skipIfSubscribed && isSubscribed()) return;
  if (new URLSearchParams(location.search).has('order') || new URLSearchParams(location.search).has('unlock')) return; // 付款流程中，先不要蓋上去

  let seenId = null;
  try { seenId = localStorage.getItem(ANNOUNCE_SEEN_KEY); } catch (e) {}
  if (seenId === latest.id) return;

  renderAnnounce(latest);
  show('announce-overlay');
}

function renderAnnounce(a) {
  _currentAnnounceId = a.id;
  $('announce-title').textContent = a.title;
  $('announce-intro').textContent = a.intro;
  $('announce-benefits').innerHTML = (a.benefits || []).map(b => `<li>${b}</li>`).join('');

  $('announce-plans').innerHTML = a.showPlans ? `
    <div class="sub-plan-card sub-plan-card--static">
      <div class="sub-plan-name">季費</div>
      <div class="sub-plan-price">NT$150</div>
      <div class="sub-plan-period">3 個月</div>
    </div>
    <div class="sub-plan-card sub-plan-card--best sub-plan-card--static">
      <div class="sub-plan-badge">最划算</div>
      <div class="sub-plan-name">年費</div>
      <div class="sub-plan-price">NT$399</div>
      <div class="sub-plan-period">12 個月</div>
    </div>
  ` : '';

  const ctaBtn = $('announce-cta-btn');
  ctaBtn.textContent = a.ctaText || '知道了';
  ctaBtn.onclick = a.onCta || closeAnnounceOverlay;

  const laterBtn = $('announce-later-btn');
  if (laterBtn) {
    laterBtn.innerHTML = a.showPlans
      ? '下次再說（可在選單 <span style="color:#9A6B2C">訂閱狀態</span> 找到）'
      : '下次再說';
  }
}

function closeAnnounceOverlay() {
  hide('announce-overlay');
  try { localStorage.setItem(ANNOUNCE_SEEN_KEY, _currentAnnounceId || ''); } catch (e) {}
}

const PENDING_ORDER_KEY = 'tc_pending_order';

// 一般的 Email 格式檢查（有帳號、@、網域三段），足以擋掉大多數打字錯誤
const SUBSCRIBE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 點方案後暫存要結帳的方案與信箱，等使用者在確認框按下「確認正確」才真的送出
let pendingCheckout = null;

// Email 欄位即時檢查：邊打邊提醒格式，格式對了就收起錯誤訊息。
// 只要使用者動了信箱，就把已經跳出來的確認框收掉，避免確認的是舊信箱。
function validateSubscribeEmail() {
  const email = $('subscribe-email-input').value.trim();
  const err = $('subscribe-email-error');

  const confirmBox = $('subscribe-confirm');
  if (confirmBox && !confirmBox.classList.contains('hidden')) {
    confirmBox.classList.add('hidden');
    pendingCheckout = null;
  }

  if (!email) { err.classList.add('hidden'); return; }
  if (SUBSCRIBE_EMAIL_RE.test(email)) {
    err.classList.add('hidden');
  } else {
    err.textContent = 'Email 格式看起來不太對，請確認有 @ 和網域（例如 name@example.com）';
    err.classList.remove('hidden');
  }
}

function goToCheckout(plan) {
  const emailInput = $('subscribe-email-input');
  const err = $('subscribe-email-error');
  const email = emailInput.value.trim();

  if (!SUBSCRIBE_EMAIL_RE.test(email)) {
    err.textContent = '請輸入有效的 Email（例如 name@example.com），解鎖碼會綁定這個信箱';
    err.classList.remove('hidden');
    emailInput.focus();
    return;
  }
  err.classList.add('hidden');

  // 先不直接導去付款：跳一步讓使用者確認信箱正確再走。
  // 打錯信箱不會馬上拿不到解鎖碼（碼付款後會直接顯示在畫面上），但會影響續訂延長與更新通知，所以在付錢前先確認一眼。
  pendingCheckout = { plan, email };
  $('subscribe-confirm-email').textContent = email;
  $('subscribe-confirm').classList.remove('hidden');
  $('subscribe-confirm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 使用者在確認框按「信箱打錯了，返回修改」
function cancelCheckoutConfirm() {
  pendingCheckout = null;
  $('subscribe-confirm').classList.add('hidden');
  $('subscribe-email-input').focus();
}

// 訂單編號用 crypto 亂數產生（8 bytes ≈ 64 bits，寫成 16 個 hex 字元）。
// 不是為了防碰撞（原本的時間戳+3位數亂數已經幾乎不會撞），而是因為 /redeem-by-order
// 只憑 orderId 就能換回解鎖碼、不比對買家身分——舊寫法（時間戳+0~999）猜得到的話，
// 等於別人已付款的訂單、解鎖碼可能被陌生人撈走。換成不可預測的亂數就沒有這個風險。
function generateOrderId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'TC' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 使用者在確認框按「確認正確，前往付款」才真的建立訂單、導去 PayUni
function confirmCheckout() {
  if (!pendingCheckout) return;
  const { plan, email } = pendingCheckout;

  // 訂單編號在「離開本站之前」自己產生、存進 localStorage——
  // 這一步完全在自己網域內完成，不會經過任何跨網域轉址，保證一定存得進去。
  // 之後就算 PayUni 導回來的網址不知道為什麼沒帶到 order 參數，回來時也能從 localStorage 找回這筆訂單繼續查。
  const orderId = generateOrderId();
  try {
    localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({ orderId, createdAt: Date.now() }));
  } catch (e) {}

  // 導去 Worker：Worker 會建立訂單，回傳一個自動送出的表單，導向 PayUni 整合式付款頁（UPP）
  const url = `${WORKER_BASE_URL}/create-order?plan=${encodeURIComponent(plan)}&email=${encodeURIComponent(email)}&orderId=${encodeURIComponent(orderId)}`;
  window.location.href = url;
}

async function submitRedeemCode() {
  const input = $('redeem-code-input');
  const err = $('redeem-error');
  const btn = $('btn-redeem-code');
  err.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = '驗證中…';

  const result = await redeemCode(input.value);

  btn.disabled = false;
  btn.textContent = '輸入解鎖碼';

  if (result.ok) {
    closeSubscribeOverlay();
    alert(`解鎖成功！有效期限到 ${new Date(result.expiresAt).toLocaleDateString('zh-TW')}`);
  } else {
    err.textContent = result.message;
    err.classList.remove('hidden');
  }
}

// ── 付款完成頁：自動解鎖 ──
// PayUni 結帳完成後導回時，網址帶 ?order=訂單編號（同瀏覽器即時解鎖，不用輸入）
// 或信箱裡的解鎖連結帶 ?unlock=解鎖碼（任何瀏覽器都可直接解鎖，無裝置數限制）
async function handlePaymentReturnParams() {
  const params = new URLSearchParams(location.search);
  let orderId = params.get('order');
  const unlockCode = params.get('unlock');

  // 網址沒帶到 order 參數（可能在跨網域轉址過程中被瀏覽器清掉）時，
  // 從離開本站前自己存的 localStorage 找回這筆還沒處理完的訂單，5 分鐘內都算有效。
  if (!orderId) {
    try {
      const pendingRaw = localStorage.getItem(PENDING_ORDER_KEY);
      if (pendingRaw) {
        const pending = JSON.parse(pendingRaw);
        if (pending.orderId && Date.now() - pending.createdAt < 5 * 60 * 1000) {
          orderId = pending.orderId;
        }
      }
    } catch (e) {}
  }

  if (orderId) {
    show('payment-wait-overlay');
    await waitForOrderCode(orderId);
    hide('payment-wait-overlay');
    try { localStorage.removeItem(PENDING_ORDER_KEY); } catch (e) {}
  } else if (unlockCode) {
    const result = await redeemCode(unlockCode);
    alert(result.ok
      ? `解鎖成功！有效期限到 ${new Date(result.expiresAt).toLocaleDateString('zh-TW')}`
      : result.message);
  }

  if (orderId || unlockCode) {
    params.delete('order');
    params.delete('unlock');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }
}

// 付款剛完成時，Worker 可能還在等 PayUni 的背景通知，這裡輪詢幾次等 code 準備好
async function waitForOrderCode(orderId, attempts = 25, intervalMs = 3000) {
  const debugEl = $('payment-wait-debug');
  for (let i = 0; i < attempts; i++) {
    if (debugEl) debugEl.textContent = `[除錯資訊] 訂單：${orderId}・網址參數：${location.search || '(空)'}・第 ${i + 1}/${attempts} 次確認`;
    try {
      const res = await fetch(`${WORKER_BASE_URL}/redeem-by-order?orderId=${encodeURIComponent(orderId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.code) {
          const result = await redeemCode(data.code);
          if (result.ok) {
            alert(`訂閱已啟用！有效期限到 ${new Date(result.expiresAt).toLocaleDateString('zh-TW')}\n\n你的解鎖碼是：${data.code}\n\n⚠️ 請截圖或記下這組碼！在其他裝置上要輸入這組碼才能解鎖（不限裝置數量），目前沒有自動找回功能。`);
            return;
          }
        }
      }
    } catch (e) { /* 忽略，繼續重試 */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  alert('付款確認比較久，但通常還是會成功，請等 1-2 分鐘後重新整理頁面，應該就會自動解鎖。若還是沒有，請聯絡客服協助查詢。');
}

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
  Object.assign(state, { series: null, spread: null, deck: [], selections: [], currentPos: 0, usedIds: new Set(), question: '', saved: false });
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

  // 出遠門（特殊牌陣，需選日期）
  const travelEl = document.createElement('button');
  travelEl.className = 'spread-card';
  travelEl.innerHTML = `
    <div class="spread-count"><svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></div>
    <div class="spread-name">出遠門</div>
    <div class="spread-divider"></div>
    <div class="spread-sub">選擇日期，每天一張牌</div>
  `;
  travelEl.addEventListener('click', openTravelOverlay);
  container.appendChild(travelEl);

  // 已儲存的自訂牌陣
  loadCustomSpreads().forEach(saved => {
    const el = document.createElement('button');
    el.className = 'spread-card';
    el.innerHTML = `
      <div class="spread-count">${saved.count}</div>
      <div class="spread-name">${saved.name}</div>
      <div class="spread-divider"></div>
      <div class="spread-sub">${saved.positions.join('・')}</div>
      <span class="custom-spread-actions">
        <span class="custom-spread-share">分享</span>
        <span class="custom-spread-delete">刪除</span>
      </span>
    `;
    el.querySelector('.custom-spread-share').addEventListener('click', (e) => {
      e.stopPropagation();
      shareCustomSpread(saved.id);
    });
    el.querySelector('.custom-spread-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSavedCustomSpread(saved.id);
    });
    el.addEventListener('click', () => useSavedCustomSpread(saved.id));
    container.appendChild(el);
  });

  // 新增自訂牌陣
  const customEl = document.createElement('button');
  customEl.className = 'spread-card';
  customEl.innerHTML = `
    <div class="spread-count">+</div>
    <div class="spread-name">自訂牌陣</div>
    <div class="spread-divider"></div>
    <div class="spread-sub">設定你自己的張數與位置</div>
  `;
  customEl.addEventListener('click', openCustomSpreadOverlay);
  container.appendChild(customEl);
}

// ── Travel spread ──
function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTravelDate(date) {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getMonth() + 1}/${date.getDate()}（${weekdays[date.getDay()]}）`;
}

function parseDateInput(val) {
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function openTravelOverlay() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(today.getDate() + 6);
  $('travel-start').value = formatDateInput(today);
  $('travel-end').value = formatDateInput(end);
  $('travel-overlay').classList.remove('hidden');
  updateTravelDays();
}

function closeTravelOverlay() {
  $('travel-overlay').classList.add('hidden');
}

function updateTravelDays() {
  const startVal = $('travel-start').value;
  const endVal = $('travel-end').value;
  const display = $('travel-days-display');
  const error = $('travel-error');
  const btn = $('btn-travel-start');

  if (!startVal || !endVal) { display.textContent = ''; btn.disabled = true; return; }

  const start = parseDateInput(startVal);
  const end = parseDateInput(endVal);
  const diff = Math.round((end - start) / 86400000) + 1;

  if (diff < 1) {
    display.textContent = '';
    error.textContent = '回程日不能早於出發日';
    error.classList.remove('hidden');
    btn.disabled = true;
    return;
  }

  error.classList.add('hidden');
  const days = Math.min(diff, 30);
  display.textContent = `共 ${days} 天${diff > 30 ? '（超過 30 天只抽前 30 天）' : ''}`;
  btn.disabled = false;
}

function startTravelSpread() {
  const start = parseDateInput($('travel-start').value);
  const end = parseDateInput($('travel-end').value);
  const positions = [];
  const cur = new Date(start);
  while (cur <= end && positions.length < 30) {
    positions.push(formatTravelDate(new Date(cur)));
    cur.setDate(cur.getDate() + 1);
  }
  state.spread = {
    name: '出遠門',
    subtitle: `${formatTravelDate(start)} ～ ${formatTravelDate(end)}`,
    count: positions.length,
    positions,
    layout: 'row',
    _key: 'travel',
  };
  closeTravelOverlay();
  startSelection();
}

// ── Custom spread ──
const CUSTOM_SPREADS_KEY = 'tc_custom_spreads';

function loadCustomSpreads() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_SPREADS_KEY) || '[]'); } catch { return []; }
}

function openCustomSpreadOverlay() {
  $('custom-spread-name').value = '';
  $('custom-spread-count').value = 3;
  $('custom-spread-save-toggle').checked = false;
  $('custom-spread-error').classList.add('hidden');
  $('custom-spread-positions').innerHTML = '';
  renderCustomSpreadPositions();
  $('custom-spread-overlay').classList.remove('hidden');
}

function closeCustomSpreadOverlay() {
  $('custom-spread-overlay').classList.add('hidden');
}

function renderCustomSpreadPositions() {
  const count = parseInt($('custom-spread-count').value, 10) || 3;

  const container = $('custom-spread-positions');
  const existing = Array.from(container.querySelectorAll('.custom-spread-position-input')).map(i => i.value);
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'custom-spread-position-row';
    const num = document.createElement('span');
    num.className = 'custom-spread-position-num';
    num.textContent = i + 1;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-spread-position-input travel-date-input';
    input.placeholder = '這張牌代表什麼？';
    input.value = existing[i] || '';
    input.addEventListener('input', () => input.classList.remove('input-error'));
    row.appendChild(num);
    row.appendChild(input);
    container.appendChild(row);
  }
}

function buildCustomSpreadFromForm() {
  const count = parseInt($('custom-spread-count').value, 10) || 0;
  const name = $('custom-spread-name').value.trim() || '自訂牌陣';
  const inputs = Array.from(document.querySelectorAll('.custom-spread-position-input'));
  const positions = inputs.map(el => el.value.trim());

  if (count < 1 || positions.length !== count || positions.some(p => !p)) {
    inputs.forEach((el, i) => el.classList.toggle('input-error', !positions[i]));
    return null;
  }

  return {
    name,
    subtitle: '你的專屬牌陣',
    count,
    positions,
    layout: count <= 3 ? 'row' : (count <= 5 ? 'cross' : 'row'),
    _key: 'custom',
  };
}

function startCustomSpread() {
  const spread = buildCustomSpreadFromForm();
  if (!spread) {
    const err = $('custom-spread-error');
    err.textContent = '請確認張數與每個位置都已填寫';
    err.classList.remove('hidden');
    return;
  }

  if ($('custom-spread-save-toggle').checked) {
    const list = loadCustomSpreads();
    list.unshift({ id: Date.now(), name: spread.name, positions: spread.positions, count: spread.count });
    try { localStorage.setItem(CUSTOM_SPREADS_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) {}
  }

  state.spread = spread;
  closeCustomSpreadOverlay();
  startSelection();
}

function useSavedCustomSpread(id) {
  const saved = loadCustomSpreads().find(s => s.id === id);
  if (!saved) return;
  state.spread = {
    name: saved.name,
    subtitle: '你的專屬牌陣',
    count: saved.count,
    positions: saved.positions,
    layout: saved.count <= 3 ? 'row' : (saved.count <= 5 ? 'cross' : 'row'),
    _key: 'custom',
  };
  startSelection();
}

function deleteSavedCustomSpread(id) {
  const list = loadCustomSpreads().filter(s => s.id !== id);
  try { localStorage.setItem(CUSTOM_SPREADS_KEY, JSON.stringify(list)); } catch (e) {}
  renderSpreadOptions();
}

// 分享單一自訂牌陣（輸出檔案格式跟備份/匯入相容，對方可以直接用「匯入自訂牌陣」讀取）
function shareCustomSpread(id) {
  const spread = loadCustomSpreads().find(s => s.id === id);
  if (!spread) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify([spread], null, 2)], { type: 'application/json' }));
  a.download = `Triple.Cell_自訂牌陣_${spread.name}.json`;
  a.click();
}

function exportCustomSpreadsJSON() {
  const list = loadCustomSpreads();
  if (!list.length) { alert('還沒有自訂牌陣可以備份'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }));
  a.download = `Triple.Cell_自訂牌陣備份.json`;
  a.click();
}

function importCustomSpreadsJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!Array.isArray(imported)) throw new Error();
        const existing = loadCustomSpreads();
        const existingIds = new Set(existing.map(s => s.id));
        const newEntries = imported
          .filter(s => s.name && Array.isArray(s.positions) && s.count)
          .map(s => ({
            id: (s.id && !existingIds.has(s.id)) ? s.id : Date.now() + Math.floor(Math.random() * 1000),
            name: s.name,
            positions: s.positions,
            count: s.count,
          }));
        const merged = [...newEntries, ...existing].slice(0, 30);
        localStorage.setItem(CUSTOM_SPREADS_KEY, JSON.stringify(merged));
        renderSpreadOptions();
        alert(`匯入完成，新增 ${newEntries.length} 組自訂牌陣`);
      } catch {
        alert('匯入失敗，請確認是從這個 App 匯出的 JSON 備份檔');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Start selection mode ──
function startSelection(showPrepare = true) {
  const pool = state.series === 'tarot'
    ? TAROT_CARDS
    : (isSubscribed() ? [...DEITY_CARDS, ...DEITY_EXPANSION_CARDS] : DEITY_CARDS);
  state.deck = shuffle(pool);
  state.selections = new Array(state.spread.count).fill(null);
  state.currentPos = 0;
  state.usedIds = new Set();

  showOnly('screen-board');
  $('board-title').textContent = state.spread.name;
  $('board-sub').innerHTML = (state.spread.subtitle || '').replace(/\n/g, '<br>');

  // 同步題目輸入欄
  const qInput = $('board-question-input');
  if (qInput) qInput.value = state.question;

  // 只有第一次進入才顯示準備 overlay
  if (showPrepare) {
    $('prepare-overlay').classList.remove('hidden');
    // 同步 prepare textarea
    const pq = $('prepare-question');
    if (pq) pq.value = state.question;
  } else {
    $('prepare-overlay').classList.add('hidden');
  }

  state.saved = false;
  state.fromHistory = false;
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

  // 50% chance of reversed (tarot only)
  const isReversed = state.series === 'tarot' && Math.random() < 0.5;

  // Fill position slot
  const posIdx = state.currentPos;
  state.selections[posIdx] = { ...card, _isReversed: isReversed };

  const slot = $(`pos-slot-${posIdx}`);
  const posCard = slot.querySelector('.pos-card');
  posCard.classList.remove('empty');

  const folder = state.series === 'tarot' ? 'images/tarot/' : 'images/deity/';
  const imgSrc = `${folder}${card.file}`;
  const isDeity = state.series === 'deity';
  const rotateStyle = isReversed ? ' style="transform:rotate(180deg);cursor:pointer"' : ' style="cursor:pointer"';
  posCard.innerHTML = `<img src="${imgSrc}" alt="${card.name}"${isDeity ? ' class="deity-img"' : ''}${rotateStyle} onclick="openLightbox(this.src, this.style.transform.includes('rotate'))">`;
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

// ── Email 訂閱區塊（牌義解讀畫面）：只主動展開一次，之後收合成一行連結 ──
function renderSubscribeBlock() {
  const s = localStorage.getItem(SUBSCRIBE_KEY);
  if (!$('subscribe-block') || !$('subscribe-link-row')) return;

  if (s === 'subscribed') {
    hide('subscribe-block');
    hide('subscribe-link-row');
    return;
  }
  if (s === 'closed') {
    hide('subscribe-block');
    show('subscribe-link-row');
    return;
  }
  // 從未出現過：主動展開一次，之後收合成連結
  show('subscribe-block');
  hide('subscribe-link-row');
  try { localStorage.setItem(SUBSCRIBE_KEY, 'closed'); } catch (e) {}
}

function closeSubscribeBlock() {
  hide('subscribe-block');
  show('subscribe-link-row');
}

function openSubscribeBlock() {
  show('subscribe-block');
  hide('subscribe-link-row');
}

// 共用的送出流程：牌義解讀區塊跟選單永久入口都用這個，差別只在各自的輸入框/按鈕/訊息元素
async function doSubscribe({ emailInput, msgEl, btn, onSuccess }) {
  const hpInput = emailInput.closest('.subscribe-form, .menu-subscribe-block')?.querySelector('.subscribe-hp');
  const email = (emailInput.value || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msgEl.textContent = '請輸入正確的 Email 格式';
    msgEl.classList.add('subscribe-msg-error');
    return;
  }

  btn.disabled = true;
  msgEl.textContent = '';
  msgEl.classList.remove('subscribe-msg-error');

  try {
    const res = await fetch(WORKER_SUBSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, hp: hpInput ? hpInput.value : '' }),
    });
    if (!res.ok) throw new Error('bad status');

    try { localStorage.setItem(SUBSCRIBE_KEY, 'subscribed'); } catch (e) {}
    onSuccess();
  } catch (e) {
    msgEl.textContent = '訂閱失敗，請稍後再試';
    msgEl.classList.add('subscribe-msg-error');
    btn.disabled = false;
  }
}

function submitSubscribe() {
  doSubscribe({
    emailInput: $('subscribe-email'),
    msgEl: $('subscribe-msg'),
    btn: $('subscribe-submit'),
    onSuccess() {
      const block = $('subscribe-block');
      if (block) block.innerHTML = '<p class="subscribe-thanks">✓ 已訂閱，謝謝你！</p>';
      hide('subscribe-link-row');
      renderMenuSubscribeBlock();
    },
  });
}

// ── Email 訂閱：選單裡的永久入口（跟上面那個不同，固定顯示，不收合成連結）──
function renderMenuSubscribeBlock() {
  const block = $('menu-subscribe-block');
  if (!block) return;
  const s = localStorage.getItem(SUBSCRIBE_KEY);
  if (s === 'subscribed') {
    block.innerHTML = '<p class="subscribe-thanks">✓ 已訂閱，謝謝你！</p>';
  }
}

function submitMenuSubscribe() {
  doSubscribe({
    emailInput: $('menu-subscribe-email'),
    msgEl: $('menu-subscribe-msg'),
    btn: $('menu-subscribe-submit'),
    onSuccess() {
      const block = $('menu-subscribe-block');
      if (block) block.innerHTML = '<p class="subscribe-thanks">✓ 已訂閱，謝謝你！</p>';
      hide('subscribe-link-row');
      const meaningsBlock = $('subscribe-block');
      if (meaningsBlock) meaningsBlock.classList.add('hidden');
    },
  });
}

// ── Show meanings ──
function showMeanings(autoScroll = true) {
  show('meanings-section');
  renderMeanings();
  // 從歷史還原或已儲存過：隱藏儲存按鈕
  const saveBtn = $('btn-save-record');
  if (saveBtn) {
    if (state.fromHistory || state.saved) {
      saveBtn.classList.add('hidden');
    } else {
      saveBtn.classList.remove('hidden');
      saveBtn.textContent = '儲存這次紀錄';
      saveBtn.disabled = false;
    }
  }
  renderSubscribeBlock();
  if (autoScroll) $('meanings-section').scrollIntoView({ behavior: 'smooth' });
}

function renderMeanings() {
  // 顯示題目
  const qEl = $('meanings-question');
  if (qEl) {
    if (state.question) {
      qEl.textContent = `「${state.question}」`;
      qEl.classList.remove('hidden');
    } else {
      qEl.classList.add('hidden');
    }
  }

  const disclaimer = $('meanings-disclaimer');
  if (state.series === 'tarot') {
    disclaimer.innerHTML = '如果你不會解塔羅，歡迎透過閱讀文字，去感受跟進行自我提問，來為自己找到答案。<br><br>任何的訊息，都只是給予我們去尋找別的切角的可能，<br><br>而不是生命只能是這方向的劇本，因為我們永遠擁有自己生命裡的選擇權。';
  } else {
    disclaimer.innerHTML = '這裡沒有任何生命裡的標準答案。這些訊息邀請你重新檢視自己、留意當下的感受，並好好向自己提問，將選擇與行動的力量帶回自己身上，而不是交給外在的指引。';
  }

  const container = $('meanings-list');
  container.innerHTML = '';
  state.selections.forEach((card, i) => {
    if (!card) return;
    const pos = state.spread.positions[i];
    const rev = !!card._isReversed;
    const div = document.createElement('div');
    div.className = 'meaning-card';
    const cardText = rev ? (card.descReversed || card.desc || card.message || '') : (card.desc || card.message || '');
    const oracleText = rev ? (card.oracleReversed || card.oracle || '') : (card.oracle || '');
    const keyword = rev ? (card.meaningReversed || card.meaning || '') : (card.meaning || '');
    const nameLabel = rev ? `${card.name}　<span class="reversed-tag">逆位</span>` : card.name;
    div.innerHTML = `
      <div class="meaning-header">
        <span class="meaning-pos">${pos}</span>
        <span class="meaning-name">${nameLabel}</span>
      </div>
      <div class="meaning-keyword">${keyword}</div>
      ${cardText ? (state.series === 'tarot'
        ? `<div class="meaning-desc"><span class="meaning-label">牌面文字</span>${cardText.replace(/\n/g, '，')}</div>`
        : `<div class="meaning-desc"><span class="meaning-label meaning-label--inline">牌面文字</span>${cardText}</div>`
      ) : ''}
      ${oracleText ? `<div class="meaning-oracle">${oracleText}</div>` : ''}
    `;
    container.appendChild(div);
  });
}

// ── Question helpers ──
function captureQuestion() {
  const pq = $('prepare-question');
  if (pq) state.question = pq.value.trim();
  const bi = $('board-question-input');
  if (bi) bi.value = state.question;
}

function updateQuestion(value) {
  state.question = value.trim();
}

// ── History (localStorage) ──
const HISTORY_KEY = 'tc_history';

function saveHistory() {
  if (!state.selections.some(Boolean)) return;
  const list = loadHistory();
  const entry = {
    id: Date.now(),
    date: new Date().toLocaleDateString('zh-TW'),
    series: state.series,
    spreadKey: state.spread._key,
    spreadName: state.spread.name,
    question: state.question,
    selections: state.selections.map((card, i) => card ? {
      position: state.spread.positions[i],
      cardId: card.id,
      cardName: card.name,
      cardFile: card.file,
      isReversed: !!card._isReversed,
    } : null).filter(Boolean),
  };
  list.unshift(entry);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 60))); } catch(e) {}
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function showHistoryScreen() {
  showOnly('screen-history');
  renderHistoryScreen();
}

function showChangelogScreen() {
  showOnly('screen-changelog');
  renderChangelogScreen();
}

function renderChangelogScreen() {
  const container = $('changelog-list');
  if (!container) return;
  container.innerHTML = CHANGELOG.map(e => `
    <div class="changelog-item">
      <div class="changelog-date">${e.date}</div>
      <div class="changelog-content">${e.content}</div>
    </div>
  `).join('');
}

function renderChangelogLatest() {
  const el = $('menu-latest-update');
  if (!el || !CHANGELOG.length) return;
  const e = CHANGELOG[0];
  el.innerHTML = `<span class="changelog-latest-date">${e.date}</span><span class="changelog-latest-content">${e.content}</span>`;
}

function renderHistoryScreen() {
  const container = $('history-list');
  if (!container) return;
  const list = loadHistory();
  if (!list.length) {
    container.innerHTML = '<p class="history-empty">還沒有儲存任何紀錄</p>';
    return;
  }
  container.innerHTML = list.map(e => `
    <div class="history-item" onclick="viewHistory(${e.id})">
      <div class="history-item-meta">${e.date} · ${e.series === 'tarot' ? '塔羅牌' : '神明訊息牌'} · ${e.spreadName}</div>
      ${e.question ? `<div class="history-item-q">「${e.question}」</div>` : ''}
      <div class="history-item-cards">${e.selections.map(s => s.cardName).join(' · ')}</div>
      <button class="history-item-delete" onclick="event.stopPropagation(); deleteHistory(${e.id})">刪除</button>
    </div>
  `).join('');
}

function manualSave() {
  if (!state.selections.some(Boolean)) return;
  saveHistory();
  state.saved = true;
  const btn = $('btn-save-record');
  if (btn) {
    btn.textContent = '✓ 已儲存';
    btn.disabled = true;
  }
}

function viewHistory(id) {
  const entry = loadHistory().find(e => e.id === id);
  if (!entry) return;
  $('site-menu-panel').classList.remove('open');

  state.series = entry.series;
  state.question = entry.question || '';
  state.saved = true;
  state.fromHistory = true;

  if (entry.series === 'deity') {
    state.spread = { name: '神明訊息牌', subtitle: '抽一張，也許那些讓你糾結的，\n會在這裡找到新的角度去看待這件事', count: 1, positions: ['神明的訊息'], _key: 'deity' };
  } else if (entry.spreadKey === 'travel') {
    const positions = entry.selections.map(s => s.position);
    state.spread = {
      name: entry.spreadName,
      subtitle: `${positions[0]} ～ ${positions[positions.length - 1]}`,
      count: positions.length,
      positions,
      layout: 'row',
      _key: 'travel',
    };
  } else if (entry.spreadKey === 'custom') {
    const positions = entry.selections.map(s => s.position);
    state.spread = {
      name: entry.spreadName,
      subtitle: '你的專屬牌陣',
      count: positions.length,
      positions,
      layout: 'row',
      _key: 'custom',
    };
  } else {
    state.spread = { ...SPREADS[entry.spreadKey], _key: entry.spreadKey };
  }

  const pool = entry.series === 'tarot' ? TAROT_CARDS : [...DEITY_CARDS, ...DEITY_EXPANSION_CARDS];
  state.selections = entry.selections.map(s => {
    const c = pool.find(c => c.id === s.cardId);
    return c ? { ...c, _isReversed: !!s.isReversed } : null;
  });
  state.currentPos = state.selections.filter(Boolean).length;
  state.usedIds = new Set(state.selections.filter(Boolean).map(c => c.id));

  showOnly('screen-board');
  $('board-title').textContent = state.spread.name;
  $('board-sub').innerHTML = (state.spread.subtitle || '').replace(/\n/g, '<br>');
  $('board-question-input').value = state.question;
  $('prepare-overlay').classList.add('hidden');
  $('card-pool-wrap').classList.add('pool-done');
  hide('swipe-hint');
  hide('btn-reveal-meanings');
  hide('btn-reset-selection');
  $('progress-text').textContent = `歷史紀錄 ${entry.date}`;

  renderPositionSlots();

  // 填入牌卡
  const folder = entry.series === 'tarot' ? 'images/tarot/' : 'images/deity/';
  state.selections.forEach((card, i) => {
    if (!card) return;
    const slot = $(`pos-slot-${i}`);
    if (!slot) return;
    const posCard = slot.querySelector('.pos-card');
    posCard.classList.remove('empty');
    const imgSrc = `${folder}${card.file}`;
    const rotStyle = card._isReversed ? 'transform:rotate(180deg);cursor:pointer' : 'cursor:pointer';
    posCard.innerHTML = `<img src="${imgSrc}" alt="${card.name}"${entry.series === 'deity' ? ' class="deity-img"' : ''} onclick="openLightbox(this.src, this.style.transform.includes('rotate'))" style="${rotStyle}">`;
    let nameEl = slot.querySelector('.pos-card-name-below');
    if (!nameEl) { nameEl = document.createElement('div'); nameEl.className = 'pos-card-name-below'; slot.appendChild(nameEl); }
    nameEl.textContent = card.name;
  });

  showMeanings(true, false);
}

function downloadHistory() {
  const list = loadHistory();
  if (!list.length) { alert('還沒有紀錄可以下載'); return; }
  const rows = [['日期', '牌組', '排陣', '題目', '牌卡']];
  list.forEach(e => {
    rows.push([
      e.date,
      e.series === 'tarot' ? '塔羅牌' : '神明訊息牌',
      e.spreadName,
      e.question || '',
      e.selections.map(s => `${s.position}：${s.cardName}`).join('；'),
    ]);
  });
  const csv = '﻿' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Triple.Cell_抽牌紀錄.csv`;
  a.click();
}

function deleteHistory(id) {
  const list = loadHistory().filter(e => e.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  renderHistoryScreen();
}

function clearHistory() {
  if (!confirm('確定要清除全部抽牌紀錄嗎？')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistoryScreen();
}

function exportHistoryJSON() {
  const list = loadHistory();
  if (!list.length) { alert('還沒有紀錄可以備份'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }));
  a.download = `Triple.Cell_抽牌紀錄備份.json`;
  a.click();
}

function importHistoryJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!Array.isArray(imported)) throw new Error();
        const existing = loadHistory();
        const existingIds = new Set(existing.map(h => h.id));
        const newEntries = imported.filter(h => h.id && h.spreadName && Array.isArray(h.selections) && !existingIds.has(h.id));
        const merged = [...newEntries, ...existing].sort((a, b) => b.id - a.id).slice(0, 200);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
        renderHistoryScreen();
        alert(`匯入完成，新增 ${newEntries.length} 筆紀錄`);
      } catch {
        alert('匯入失敗，請確認是從這個 App 匯出的 JSON 備份檔');
      }
    };
    reader.readAsText(file);
  };
  input.click();
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
  renderChangelogLatest();

  loadSubscription();
  renderLockState();
  handlePaymentReturnParams();
  refreshSubscription();
  renderMenuSubscribeBlock();
});
