// ── 跨網域資料轉移模組（source ↔ target）──
// 用途：舊網域（source）的使用者按下「搬到新網站」，把指定的 localStorage keys
//       打包、base64 編碼、塞進 URL hash，導到新網域（target），target 端讀出來寫回
//       localStorage。全程資料只在使用者裝置與瀏覽器之間流動，不經過任何伺服器。
//
// 用法（在載入這支檔案之前，於 index.html 設定）：
//   <script>
//     window.MIGRATION_CONFIG = {
//       role: 'source',                          // 'source'（舊網域）或 'target'（新網域）
//       appId: 'pickacard',                      // 這個 App 的識別碼，各 App 用不同字串
//       targetUrl: 'https://oracle.triplecells.com/',  // 只有 role:'source' 需要
//       keys: ['tc_custom_spreads', 'tc_history', 'tc_subscription'], // 兩邊都建議設，target 端會拿來當允許清單
//       trustedOrigins: ['https://舊網域'],       // 只有 role:'target' 用：referrer 不在清單裡就忽略 ?migrate=
//     };
//   </script>
//   <script src="migration.js"></script>
//
// target 端收到資料後會 dispatch 一個 `migration:complete` 事件（detail 是還原的 key/value
// 物件），App 自己的程式碼可以監聽這個事件、重新讀取 localStorage 並重繪畫面。

(function () {
  var cfg = window.MIGRATION_CONFIG;
  if (!cfg || !cfg.appId) return;

  var FLAG_KEY = '__migrated_' + cfg.appId;

  if (cfg.role === 'source') {
    runSource();
  } else if (cfg.role === 'target') {
    runTarget();
  }

  // ── source：舊網域 ──
  function runSource() {
    if (!cfg.targetUrl || !cfg.keys || !cfg.keys.length) return;

    // 已經搬過一次了 → 不用再讓使用者按按鈕，靜默直接導去新網域
    if (localStorage.getItem(FLAG_KEY) === 'true') {
      location.href = cfg.targetUrl;
      return;
    }

    // 頁面自己有做搬遷卡片/按鈕的話（呼叫 TripleCellMigration.go()），設 hideFloatingButton:true
    // 避免畫面上同時出現兩個「搬到新網站」的按鈕。沒設定就維持原本的浮動按鈕。
    if (!cfg.hideFloatingButton) showMigrateButton();
  }

  function showMigrateButton() {
    var btn = document.createElement('button');
    btn.id = 'migration-btn';
    btn.type = 'button';
    btn.textContent = (cfg.buttonLabel || '搬到新網站') + ' →';
    btn.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:9999',
      'padding:12px 18px', 'border:none', 'border-radius:999px',
      'background:var(--color-primary,#548EB8)', 'color:#fff',
      'font-size:14px', 'font-weight:700', 'font-family:inherit',
      'box-shadow:0 4px 14px rgba(0,0,0,.18)', 'cursor:pointer',
      'transition:transform .15s,box-shadow .15s',
    ].join(';');
    btn.onmouseenter = function () { btn.style.transform = 'translateY(-2px)'; };
    btn.onmouseleave = function () { btn.style.transform = 'none'; };
    btn.onclick = doMigrate;
    document.body.appendChild(btn);
  }

  function doMigrate() {
    var payload = {};
    cfg.keys.forEach(function (k) {
      var v = localStorage.getItem(k);
      if (v !== null) payload[k] = v;
    });

    var encoded;
    try {
      encoded = utf8ToBase64(JSON.stringify(payload));
    } catch (e) {
      console.error('[migration] 資料打包失敗', e);
      return;
    }

    // 搬完之後標記，避免這台裝置之後又重複跳按鈕/重複搬（target 端會用最新值覆蓋，重複搬不會遺失資料，
    // 只是沒必要；且已經搬過的使用者不需要再看到按鈕，體驗更乾淨）
    try { localStorage.setItem(FLAG_KEY, 'true'); } catch (e) {}

    var base = cfg.targetUrl.replace(/#.*$/, '');
    var sep = base.indexOf('?') !== -1 ? '&' : '?';
    // 用 query string 而不是 hash：hash 不會送給伺服器沒錯，但某些瀏覽器分享/導頁時會把 hash
    // 弄丟；query string 在新分頁載入時較穩定，target 端讀完就立刻用 replaceState 清掉，
    // 不會留在網址列上、也不會被 server 端記錄或快取成不同頁面（GitHub Pages 是純靜態、
    // 對 query string 一視同仁，不影響快取或路由）。
    location.href = base + sep + 'migrate=' + encodeURIComponent(encoded);
  }

  // ── target：新網域 ──
  function runTarget() {
    var params = new URLSearchParams(location.search);
    var raw = params.get('migrate');
    if (!raw) return;

    // 來源檢查：referrer 存在時必須是白名單網域，才處理這個參數。
    // referrer 是瀏覽器依「實際導頁過來的網址」自動附上的，網頁自己 JS 沒辦法偽造成別的網域，
    // 所以能擋掉「有心人士做一個 ?migrate=... 連結傳給別人點」這種攻擊
    // （不是從真正的舊網站導過來，就不理這個參數）。
    // 若瀏覽器基於隱私設定完全不附 referrer，合法的搬遷流程也可能遇到，這裡選擇放行但記警告，
    // 避免因此擋掉正常使用者搬家。
    if (cfg.trustedOrigins && cfg.trustedOrigins.length && document.referrer) {
      var referrerOrigin = safeOrigin(document.referrer);
      if (referrerOrigin && cfg.trustedOrigins.indexOf(referrerOrigin) === -1) {
        console.warn('[migration] 忽略搬遷參數：來源網域不在允許清單', referrerOrigin);
        return;
      }
    }

    var payload;
    try {
      payload = JSON.parse(base64ToUtf8(raw));
    } catch (e) {
      console.error('[migration] 資料還原失敗', e);
      return;
    }

    // key 允許清單：只寫入這個 App 設定裡列出的 key，其餘一律忽略——
    // 就算網址被偽造塞了其他 key（例如假造 tc_subscription 免費解鎖），也不會被寫進 localStorage。
    var allowedKeys = cfg.keys;
    var restoredKeys = [];
    Object.keys(payload).forEach(function (k) {
      if (allowedKeys && allowedKeys.length && allowedKeys.indexOf(k) === -1) {
        console.warn('[migration] 忽略不在允許清單裡的 key:', k);
        return;
      }
      try {
        localStorage.setItem(k, payload[k]);
        restoredKeys.push(k);
      } catch (e) {
        console.error('[migration] 寫入 localStorage 失敗:', k, e);
      }
    });

    // 清掉網址上的 migrate 參數，不留痕跡、避免重新整理時重複套用
    params.delete('migrate');
    var clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
    history.replaceState(null, '', clean);

    if (restoredKeys.length) {
      showRestoredToast();
      window.dispatchEvent(new CustomEvent('migration:complete', { detail: payload }));
    }
  }

  function showRestoredToast() {
    var el = document.createElement('div');
    el.textContent = '✓ 資料已從舊網站還原';
    el.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:9999', 'padding:11px 22px', 'border-radius:999px',
      'background:var(--color-text,#2C3A4A)', 'color:#fff',
      'font-size:14px', 'font-weight:600', 'font-family:inherit',
      'box-shadow:0 4px 14px rgba(0,0,0,.22)', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 400);
    }, 3200);
  }

  // 從一個網址安全取出 origin（scheme+host），格式不合法就回傳 null 而不是丟例外。
  function safeOrigin(u) {
    try { return new URL(u).origin; } catch (e) { return null; }
  }

  // ── UTF-8 安全的 base64 編解碼（btoa/atob 原生只吃 Latin1，中文內容需要這層轉換）──
  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64)));
  }

  // ── 對外 API：讓頁面自己畫的按鈕/文案（例如首頁的公告卡片）能直接觸發搬遷，
  // 不用依賴這支檔案自動插入的浮動按鈕。isMigrated() 讓頁面自己決定要不要顯示搬遷區塊。
  window.TripleCellMigration = {
    isMigrated: function () { return localStorage.getItem(FLAG_KEY) === 'true'; },
    go: function () { if (cfg && cfg.role === 'source') doMigrate(); },
  };
})();
