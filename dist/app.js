const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const KEY = 'moonwish-v1';
const FIREBASE_DB_URL = 'https://trung-thu-1dc8f-default-rtdb.asia-southeast1.firebasedatabase.app';

let state = {
  visitorId: '',
  deviceId: '',
  name: '',
  created: new Date().toISOString(),
  claim: null,
  wishes: [],
  visits: 0,
  likedWishes: {}
};

try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && typeof saved === 'object') {
    state = { ...state, ...saved, likedWishes: saved.likedWishes || {} };
  }
} catch {}

if (!state.visitorId) {
  state.visitorId = 'user_' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
}

// Hardware Device Fingerprint (Nhận diện thiết bị vật lý qua các trình duyệt khác nhau trên cùng 1 máy)
async function hashFingerprint(str) {
  if (globalThis.crypto?.subtle?.digest) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      const arr = Array.from(new Uint8Array(buf));
      return 'dev_' + arr.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
    } catch (_) {}
  }
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const num = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return 'dev_' + num.toString(16);
}

async function getDeviceFingerprint() {
  const parts = [];
  try {
    const w = screen.width || 0, h = screen.height || 0, cd = screen.colorDepth || 0;
    parts.push(`res:${Math.min(w, h)}x${Math.max(w, h)}x${cd}`);
  } catch (_) { parts.push('res:def'); }

  try {
    parts.push(`cpu:${navigator.hardwareConcurrency || 4}`);
  } catch (_) { parts.push('cpu:def'); }

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const tzo = new Date().getTimezoneOffset();
    parts.push(`tz:${tz}:${tzo}`);
  } catch (_) { parts.push('tz:def'); }

  try {
    parts.push(`plt:${navigator.platform || ''}`);
  } catch (_) { parts.push('plt:def'); }

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        let renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
        renderer = renderer.replace(/ANGLE \(/i, '').replace(/\s*Direct3D.*$/i, '').replace(/vs_\d+_\d+\s*ps_\d+_\d+/i, '').replace(/[(),]/g, '').trim();
        parts.push(`gpu:${renderer}`);
      }
    }
  } catch (_) { parts.push('gpu:none'); }

  try {
    const cvs = document.createElement('canvas');
    cvs.width = 160; cvs.height = 40;
    const ctx = cvs.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial, sans-serif';
      ctx.fillStyle = '#ff9900';
      ctx.fillRect(8, 4, 50, 18);
      ctx.fillStyle = '#0066aa';
      ctx.fillText('Trăng2026☾', 12, 12);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Trăng2026☾', 14, 14);
      const dataUri = cvs.toDataURL();
      parts.push(`cvs:${dataUri.slice(dataUri.length - 40, dataUri.length - 8)}`);
    }
  } catch (_) { parts.push('cvs:none'); }

  return hashFingerprint(parts.join('|'));
}

const deviceReady = getDeviceFingerprint().then(id => {
  state.deviceId = id;
  return id;
});

// Dữ liệu nội dung luôn được nạp lại từ Firebase.
state.claim = null;
state.wishes = [];

try {
  if (!sessionStorage.getItem('moonwish-visit')) {
    state.visits++;
    sessionStorage.setItem('moonwish-visit', '1');
  }
} catch {
  state.visits++;
}

let storageWarning = false;
function save() {
  try {
    // Chỉ lưu định danh và tùy chọn phiên trên máy. Nội dung cộng đồng nằm trên Firebase.
    localStorage.setItem(KEY, JSON.stringify({
      visitorId: state.visitorId,
      deviceId: state.deviceId,
      name: state.name,
      created: state.created,
      visits: state.visits,
      likedWishes: state.likedWishes || {}
    }));
  } catch {
    if (!storageWarning) {
      toast('Trình duyệt không cho phép lưu. Kết quả chỉ giữ trong phiên này.');
      storageWarning = true;
    }
  }
}

let communityWishes = [];
let claimReady = Promise.resolve();

const lanternTypes = ['ong-sao', 'ca-chep', 'keo-quan', 'tho-ngoc', 'hoi-an'];
function normalizeLanternType(type) {
  if (type === 'thien-dang') return 'hoi-an'; // Older locally saved wishes
  if (type === 'hoa-sen') return 'keo-quan';
  return lanternTypes.includes(type) ? type : 'ong-sao';
}
function getLanternAsset(type, extension = 'webp') {
  return `assets/lantern-${normalizeLanternType(type)}.${extension}`;
}

const defaultBlessings = [
  'Mong bạn luôn là phiên bản hạnh phúc nhất của chính mình. Trăng đêm nay thật đẹp, và bạn cũng vậy.',
  'Mong những ngày sắp tới, bạn luôn gặp được những người tốt, những cơ hội tốt và đủ dũng cảm để theo đuổi điều mình muốn.',
  'Chúc bạn một mùa trăng tròn đầy, đủ bình an để nghỉ ngơi và đủ niềm tin để bắt đầu những điều mới.',
  'Dù hôm nay có bận rộn đến đâu, mong bạn vẫn tìm được một khoảng bình yên để ngắm trăng và mỉm cười.',
  'Đừng quên rằng bạn đang làm rất tốt rồi. Cứ chậm rãi bước đi, những điều tốt đẹp đang đợi bạn ở phía trước.'
];

/* Live Cloud Sync (Firebase Realtime Database) */
function initLiveSync() {
  try {
    claimReady = (async () => {
      const devId = await deviceReady;

      // 1. Đồng bộ người dùng thiết bị vật lý trên Firebase
      try {
        const devUserRes = await fetch(`${FIREBASE_DB_URL}/device_users/${devId}.json`);
        if (devUserRes.ok) {
          const linkedVisitorId = await devUserRes.json();
          if (linkedVisitorId && typeof linkedVisitorId === 'string') {
            state.visitorId = linkedVisitorId;
            save();
          } else if (state.visitorId) {
            fetch(`${FIREBASE_DB_URL}/device_users/${devId}.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(state.visitorId)
            }).catch(() => {});
          }
        }
      } catch (_) {}

      // 2. Khóa thiết bị: Kiểm tra xem thiết bị này đã từng bốc quà chưa (kể cả trên trình duyệt khác)
      try {
        const devClaimRes = await fetch(`${FIREBASE_DB_URL}/device_claims/${devId}.json`);
        if (devClaimRes.ok) {
          const devClaim = await devClaimRes.json();
          if (devClaim && devClaim.content) {
            state.claim = devClaim;
            render();
            return state.claim;
          }
        }
      } catch (_) {}

      // 3. Fallback theo visitorId nếu có
      try {
        const res = await fetch(`${FIREBASE_DB_URL}/claims/${state.visitorId}.json`);
        if (res.ok) {
          const claim = await res.json();
          if (claim && claim.content) {
            state.claim = claim;
            render();
            fetch(`${FIREBASE_DB_URL}/device_claims/${devId}.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...claim, deviceId: devId })
            }).catch(() => {});
            return state.claim;
          }
        }
      } catch (_) {}

      return state.claim;
    })().catch(() => {});

    syncRemoteWishes();

    // Polling nhẹ nhàng 10 giây/lần qua HTTP REST (không giữ kết nối liên tục)
    if (wishesPollingTimer) clearInterval(wishesPollingTimer);
    wishesPollingTimer = setInterval(syncRemoteWishes, 10000);
  } catch (err) {
    console.warn('Live sync fallback:', err);
  }
}

let wishesPollingTimer = null;
async function syncRemoteWishes() {
  if (document.hidden) return;
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/wishes.json`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        handleRemoteWishes(data);
      }
    }
  } catch {}
}

function handleRemoteWishes(data) {
  communityWishes = Object.entries(data)
    .filter(([_, val]) => val && val.content)
    .map(([id, val]) => ({
      ...val,
      id,
      likesCount: typeof val.likesCount === 'number' ? val.likesCount : 0,
      picksCount: typeof val.picksCount === 'number' ? val.picksCount : 0
    }))
    .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

  const myRemoteWish = communityWishes.find(w => w.id === state.visitorId);
  if (myRemoteWish) {
    state.wishes = [myRemoteWish];
    save();
  }
  render();
}

async function toggleWishLike(wishId) {
  if (!wishId) return;
  if (!state.likedWishes) state.likedWishes = {};
  const isLiked = Boolean(state.likedWishes[wishId]);

  const wish = communityWishes.find(w => w.id === wishId);
  const currentCount = (wish && typeof wish.likesCount === 'number') ? wish.likesCount : 0;
  const newCount = isLiked ? Math.max(0, currentCount - 1) : currentCount + 1;

  if (isLiked) {
    delete state.likedWishes[wishId];
  } else {
    state.likedWishes[wishId] = true;
  }
  if (wish) wish.likesCount = newCount;

  save();
  render();

  try {
    await fetch(`${FIREBASE_DB_URL}/wishes/${encodeURIComponent(wishId)}/likesCount.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCount)
    });
    await fetch(`${FIREBASE_DB_URL}/wish_likes/${encodeURIComponent(wishId)}/${state.visitorId}.json`, {
      method: isLiked ? 'DELETE' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: isLiked ? undefined : JSON.stringify(true)
    });
  } catch (err) {
    console.warn('Like sync failed:', err);
  }
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
}

function displayName(w) {
  return w.anonymous ? 'Một người bạn' : w.name;
}

/* Audio Synthesizer (Persistent across PJAX navigation) */
let audioCtx = null, musicTimer = null;
let musicOn = localStorage.getItem('midautumn_music_muted') !== '1'; // Mặc định bật!
const notes = [261.63, 329.63, 392, 523.25, 440, 392, 329.63, 293.66, 261.63, 392, 440, 523.25, 659.25, 523.25, 392, 329.63];
let noteIndex = 0;

const MUSIC_ICONS = {
  on: `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path class="music-wave-1" d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path class="music-wave-2" d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  off: `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
};

function updateMusicUI() {
  const btn = $('#music');
  if (btn) {
    btn.innerHTML = musicOn ? MUSIC_ICONS.on : MUSIC_ICONS.off;
    btn.setAttribute('aria-label', musicOn ? 'Tắt nhạc' : 'Bật nhạc');
    btn.setAttribute('title', musicOn ? 'Tắt nhạc' : 'Bật nhạc');
    btn.setAttribute('aria-pressed', String(musicOn));
    btn.classList.toggle('music-playing', musicOn);
  }
  const label = $('#music-label');
  if (label) {
    label.textContent = musicOn ? 'Đang phát · Chạm để tắt' : 'Đã tắt · Chạm để bật';
  }
  const actionTitle = $('#music-action-title');
  if (actionTitle) {
    actionTitle.textContent = musicOn ? 'Khúc nhạc đêm trăng' : 'Bật khúc nhạc trăng';
  }
}

function playNote() {
  if (!audioCtx || !musicOn || audioCtx.state !== 'running') return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = notes[noteIndex++ % notes.length];
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.06);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.9);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 2);
}

async function startMusic(userInitiated = false) {
  if (!musicOn && !userInitiated) return;
  musicOn = true;
  localStorage.removeItem('midautumn_music_muted');
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    if (!musicTimer) {
      playNote();
      musicTimer = setInterval(playNote, 750);
    }
    updateMusicUI();
  } catch (err) {
    // Autoplay policy deferred until user gesture
  }
}

async function stopMusic() {
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  if (audioCtx && audioCtx.state === 'running') {
    await audioCtx.suspend();
  }
  musicOn = false;
  localStorage.setItem('midautumn_music_muted', '1');
  updateMusicUI();
}

async function toggleMusic() {
  try {
    if (musicOn) {
      await stopMusic();
      toast('Đã tắt khúc nhạc đêm trăng');
    } else {
      await startMusic(true);
      toast('Đang phát khúc nhạc đêm trăng ♫');
    }
  } catch {
    toast('Thiết bị chưa hỗ trợ âm thanh này.');
  }
}

/* Page Rendering & State Synchronization */
let expanded = false;
let currentWishFilter = 'recent';

function render() {
  // Common states
  const heroName = $('#hero-name');
  if (heroName) heroName.textContent = state.name || 'bạn';

  const senderName = $('#sender-name');
  if (senderName && !senderName.value) senderName.value = state.name;

  const profileName = $('#profile-name');
  if (profileName) profileName.textContent = state.name || 'Bạn';

  const profileDate = $('#profile-date');
  if (profileDate) {
    profileDate.textContent = new Date(state.created).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
  }

  const profileWishText = $('#profile-wish-text');
  if (profileWishText) {
    profileWishText.textContent = state.wishes.length > 0
      ? state.wishes.map(w => '“' + w.content + '”' + (w.public ? '' : ' (Riêng tư)')).join('\n\n')
      : 'Chưa có lời chúc nào.';
  }

  const visitCount = $('#visit-count');
  if (visitCount) visitCount.textContent = state.visits;

  const sentCount = $('#sent-count');
  if (sentCount) sentCount.textContent = state.wishes.length;

  const claimCount = $('#claim-count');
  if (claimCount) claimCount.textContent = state.claim ? 1 : 0;

  const giftCta = $('#gift-cta');
  if (giftCta) {
    giftCta.textContent = state.claim ? 'Xem lại lời chúc' : 'Mở quà ngay';
  }

  const profileGiftText = $('#profile-gift-text');
  if (profileGiftText) {
    profileGiftText.textContent = state.claim ? 'Xem lại món quà' : 'Mở hộp quà';
  }

  // Wishes list rendering (wishes.html)
  const wishList = $('#wish-list');
  if (wishList) {
    // Filter tabs binding
    const tabButtons = $$('#wish-filter-tabs .filter-tab');
    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === currentWishFilter);
      btn.onclick = () => {
        if (currentWishFilter !== btn.dataset.filter) {
          currentWishFilter = btn.dataset.filter;
          render();
        }
      };
    });

    // Filter public wishes
    let visible = communityWishes.filter(w => w.public && w.content);
    if (currentWishFilter === 'top-liked') {
      visible.sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0) || (new Date(b.created || 0) - new Date(a.created || 0)));
    } else if (currentWishFilter === 'top-picked') {
      visible.sort((a, b) => (b.picksCount || 0) - (a.picksCount || 0) || (new Date(b.created || 0) - new Date(a.created || 0)));
    } else {
      visible.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
    }

    wishList.replaceChildren();

    if (visible.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'empty-notice';
      emptyNotice.style.cssText = 'text-align:center;padding:45px 20px;grid-column:1/-1;color:#bca992;';
      emptyNotice.innerHTML = `
        <p style="font-size:15px;margin-bottom:14px;">Chưa có lời chúc nào trong mục này.</p>
        <a href="write.html" class="gold" style="font-size:13px;padding:10px 20px;display:inline-block;">Gửi lời chúc đầu tiên ngay</a>
      `;
      wishList.append(emptyNotice);
    } else {
      visible.slice(0, expanded ? visible.length : 6).forEach((w, rankIdx) => {
        const card = document.createElement('article');
        card.className = 'wish-card';

        const main = document.createElement('div');
        main.className = 'wish-card-main';

        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.textContent = displayName(w).charAt(0);

        const body = document.createElement('div');
        body.style.flex = '1';

        const topRow = document.createElement('div');
        topRow.className = 'wish-card-top-row';
        const name = document.createElement('b');
        name.textContent = displayName(w);
        topRow.appendChild(name);

        // Honor badges for top ranked or notable wishes
        if (currentWishFilter === 'top-liked' && rankIdx === 0 && (w.likesCount || 0) > 0) {
          const badge = document.createElement('span');
          badge.className = 'wish-honor-tag top-rank';
          badge.textContent = '✦ Yêu thích nhất';
          topRow.appendChild(badge);
        } else if (currentWishFilter === 'top-picked' && rankIdx === 0 && (w.picksCount || 0) > 0) {
          const badge = document.createElement('span');
          badge.className = 'wish-honor-tag top-rank';
          badge.textContent = '✦ Đón nhận nhiều nhất';
          topRow.appendChild(badge);
        } else if ((w.likesCount || 0) >= 3) {
          const badge = document.createElement('span');
          badge.className = 'wish-honor-tag';
          badge.textContent = `✦ Ấm lòng (${w.likesCount})`;
          topRow.appendChild(badge);
        } else if ((w.picksCount || 0) >= 3) {
          const badge = document.createElement('span');
          badge.className = 'wish-honor-tag';
          badge.textContent = `✦ Duyên lành (${w.picksCount})`;
          topRow.appendChild(badge);
        }

        const p = document.createElement('p');
        p.textContent = w.content;

        body.append(topRow, p);
        main.append(avatar, body);

        // Footer with timestamp & interactive like button
        const footer = document.createElement('div');
        footer.className = 'wish-card-footer';
        const isMe = w.id === state.visitorId;
        const meta = document.createElement('small');
        meta.textContent = isMe ? 'Bạn gửi · ' + new Date(w.created).toLocaleString('vi-VN') : 'Gửi từ ' + displayName(w);

        const actions = document.createElement('div');
        actions.className = 'wish-card-actions';

        if ((w.picksCount || 0) > 0) {
          const pickPill = document.createElement('span');
          pickPill.className = 'wish-stat-pill';
          pickPill.title = `${w.picksCount} người đã bốc trúng lời chúc này`;
          pickPill.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/></svg> <span>${w.picksCount} bốc</span>`;
          actions.appendChild(pickPill);
        }

        const isLiked = Boolean(state.likedWishes?.[w.id]);
        const likeBtn = document.createElement('button');
        likeBtn.type = 'button';
        likeBtn.className = 'wish-like-btn' + (isLiked ? ' liked' : '');
        likeBtn.title = isLiked ? 'Bỏ thích' : 'Yêu thích lời chúc này';
        likeBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> <span>${w.likesCount || 0}</span>`;
        likeBtn.onclick = e => {
          e.stopPropagation();
          toggleWishLike(w.id);
        };
        actions.appendChild(likeBtn);

        footer.append(meta, actions);
        card.append(main, footer);
        card.onclick = () => showWish(w, isMe);
        wishList.append(card);
      });
    }

    const moreBtn = $('#more-wishes');
    if (moreBtn) {
      moreBtn.hidden = visible.length <= 6;
      moreBtn.textContent = expanded ? 'Thu gọn' : 'Xem thêm lời chúc';
    }
  }

  // Edit Mode UI on write.html
  const wishForm = $('#wish-form');
  if (wishForm && state.wishes.length > 0) {
    const myWish = state.wishes[0];
    const wishContent = $('#wish-content');
    const senderName = $('#sender-name');
    const charCount = $('#char-count');

    if (wishContent && !wishContent.dataset.touched) {
      wishContent.value = myWish.content;
      if (charCount) charCount.textContent = myWish.content.length + '/300';
    }
    if (senderName && !senderName.dataset.touched) {
      senderName.value = myWish.name || state.name;
    }
    const anon = $('#anonymous');
    if (anon && !anon.dataset.touched) anon.checked = myWish.anonymous;
    const pub = $('#public');
    if (pub && !pub.dataset.touched) pub.checked = myWish.public;
    const radio = $(`input[name="lantern-type"][value="${myWish.lanternType}"]`);
    if (radio && !radio.dataset.touched) radio.checked = true;

    const eyebrow = wishForm.querySelector('.eyebrow');
    if (eyebrow) eyebrow.textContent = 'BẠN ĐÃ CÓ 1 LỜI CHÚC TRÊN BẦU TRỜI';
    const h2 = wishForm.querySelector('h2');
    if (h2) h2.textContent = 'Chỉnh sửa lời chúc của bạn';
    const formNote = wishForm.querySelector('.form-note');
    if (formNote) formNote.textContent = 'Mỗi người thắp 1 ngọn đèn ước nguyện dưới ánh trăng. Bạn có thể cập nhật nội dung bất cứ lúc nào.';
    const submitBtn = wishForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.innerHTML = 'Lưu thay đổi lời chúc';
  }

  // Sky lanterns rendering (sky.html)
  const skyContainer = $('#sky-lanterns');
  if (skyContainer) {
    skyContainer.replaceChildren();

    // Prioritize user's own wish and all community wishes
    const livePublic = communityWishes.filter(w => w.public && w.content);
    const wishMap = new Map();
    if (state.wishes.length > 0 && state.wishes[0].public) {
      wishMap.set(state.visitorId, { ...state.wishes[0], isUser: true });
    }
    livePublic.forEach(w => {
      if (!wishMap.has(w.id)) {
        wishMap.set(w.id, { ...w, isUser: w.id === state.visitorId });
      }
    });

    const pool = Array.from(wishMap.values());

    if (pool.length === 0) {
      const emptySky = document.createElement('div');
      emptySky.className = 'sky-empty';
      emptySky.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#eed9be;z-index:15;padding:20px;';
      emptySky.innerHTML = `
        <p style="font-size:16px;margin-bottom:12px;font-family:'Charm',cursive;font-size:24px;color:var(--gold);">Bầu trời đêm rằm đang đợi ngọn đèn đầu tiên…</p>
        <a href="write.html" class="gold" style="font-size:13px;padding:10px 22px;display:inline-block;">Thả ngọn đèn đầu tiên lên trời ✧</a>
      `;
      skyContainer.append(emptySky);
    } else {
      const targetCount = Math.min(pool.length, matchMedia('(max-width: 600px)').matches ? 8 : 14);
      const lanes = [5, 19, 33, 48, 63, 78, 92, 12, 26, 41, 56, 70, 84, 96];
      const durations = [31, 39, 35, 42, 33, 38, 44, 36, 41, 32, 45, 37, 34, 40];
      const depths = ['depth-mid', 'depth-near', 'depth-far', 'depth-mid', 'depth-near', 'depth-mid', 'depth-far'];
      let nextIndex = 0;

      function assignWish(button) {
        const w = pool[nextIndex % pool.length];
        nextIndex++;
        const type = normalizeLanternType(w.lanternType);
        button.classList.remove(...lanternTypes, 'user-wish');
        button.classList.add(type);
        if (w.isUser) button.classList.add('user-wish');
        const icon = button.querySelector('img');
        if (icon) {
          icon.onerror = () => { icon.onerror = null; icon.src = getLanternAsset(type, 'png'); };
          icon.src = getLanternAsset(type);
        }

        const nameText = w.isUser ? (state.name || 'Bạn') : displayName(w);

        // Ribbon name tag under lantern (Ý tưởng 1)
        let tag = button.querySelector('.lantern-tag');
        if (!tag) {
          tag = document.createElement('span');
          tag.className = 'lantern-tag';
          button.append(tag);
        }
        tag.textContent = nameText;
        if (w.isUser) {
          tag.innerHTML = `<span class="user-badge">☾</span> ${nameText}`;
        }

        // Hover tooltip preview card (Ý tưởng 1)
        let preview = button.querySelector('.lantern-preview-card');
        if (!preview) {
          preview = document.createElement('div');
          preview.className = 'lantern-preview-card';
          button.append(preview);
        }
        const snippet = w.content && w.content.length > 72 ? w.content.slice(0, 70) + '…' : (w.content || '...');
        preview.innerHTML = `
          <div class="preview-sender">${nameText}</div>
          <div class="preview-text">“${snippet}”</div>
          <div class="preview-hint">Chạm để mở trọn vẹn ☾</div>
        `;

        button.setAttribute('aria-label', `Lời chúc từ ${nameText}`);
        button.onclick = (e) => {
          e.stopPropagation();
          showWish(w, Boolean(w.isUser));
        };
      }

      for (let i = 0; i < targetCount; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `sky-lantern ${depths[i % depths.length]}`;

        const xLane = lanes[i % lanes.length];
        const duration = durations[i % durations.length];
        const progress = i / targetCount;
        const delay = -((progress * duration + (i % 4) * 1.3) % duration);
        const rotStart = (i % 2 === 0 ? -3.5 : 3.5);
        const rotMid = -rotStart;
        const drift = ((i % 4) - 1.5) * 14;

        b.style.setProperty('--x', xLane + '%');
        b.style.setProperty('--duration', duration + 's');
        b.style.setProperty('--delay', delay.toFixed(2) + 's');
        b.style.setProperty('--rot-start', rotStart + 'deg');
        b.style.setProperty('--rot-mid', rotMid + 'deg');
        b.style.setProperty('--drift-1', (drift + 14) + 'px');
        b.style.setProperty('--drift-2', (-drift - 12) + 'px');
        b.style.setProperty('--drift-3', (drift + 16) + 'px');
        b.style.setProperty('--drift-4', (-drift) + 'px');

        b.setAttribute('aria-label', 'Mở một lời chúc trên bầu trời');

        const icon = document.createElement('img');
        icon.className = 'lantern-icon';
        icon.alt = '';
        icon.loading = 'eager';
        b.append(icon);
        assignWish(b);
        b.addEventListener('animationiteration', () => assignWish(b));
        skyContainer.append(b);
      }
    }
  }

  updateMusicUI();
}

function start(name) {
  name = String(name).trim();
  if (!name || name.length > 40) throw new Error('Tên cần từ 1 đến 40 ký tự.');
  state.name = name;
  save();
  render();
  const welcome = $('#welcome');
  if (welcome && welcome.open) welcome.close();
  toast('Chào mừng ' + name + ' đến với Đêm Trăng ☾');
  if (musicOn) startMusic(true);
  return { name };
}

function showWish(w, own) {
  if (!w) return;
  const dialog = $('#wish-dialog');
  if (!dialog) return;

  const title = $('#dialog-title');
  if (title) title.textContent = own ? ((state.name || 'Bạn') + ' ơi, trăng gửi bạn…') : 'Một lời dưới ánh trăng';

  const kicker = $('#dialog-kicker');
  if (kicker) kicker.textContent = 'MỘT CHÚT YÊU THƯƠNG GỬI ĐẾN BẠN';

  const content = $('#received-content') || $('#wish-text');
  if (content) content.textContent = w.content || '';

  const sender = $('#received-sender') || $('#wish-sender');
  if (sender) sender.textContent = '— ' + (own ? (w.name || 'Một người bạn dưới ánh trăng ☾') : displayName(w));

  const actions = $('#received-actions');
  if (actions) actions.hidden = !own;

  // Dialog Like Button update
  const dialogLikeBtn = $('#dialog-like-btn');
  if (dialogLikeBtn) {
    if (w.id) {
      dialogLikeBtn.hidden = false;
      const syncDialogLikeUI = () => {
        const isLiked = Boolean(state.likedWishes?.[w.id]);
        dialogLikeBtn.classList.toggle('liked', isLiked);
        const countEl = $('#dialog-like-count');
        const latestWish = communityWishes.find(item => item.id === w.id);
        const count = latestWish?.likesCount ?? w.likesCount ?? 0;
        if (countEl) countEl.textContent = count;
        const labelEl = $('#dialog-like-label');
        if (labelEl) labelEl.textContent = isLiked ? 'Đã yêu thích' : 'Thả tim';
      };
      syncDialogLikeUI();
      dialogLikeBtn.onclick = async () => {
        await toggleWishLike(w.id);
        syncDialogLikeUI();
      };
    } else {
      dialogLikeBtn.hidden = true;
    }
  }

  try {
    if (!dialog.open) dialog.showModal();
  } catch {
    dialog.setAttribute('open', '');
  }
}

let opening = false;
async function openGift() {
  if (!state.name) {
    const welcome = $('#welcome');
    if (welcome) welcome.showModal();
    return { needsName: true };
  }

  await claimReady;
  const devId = state.deviceId || (await deviceReady);

  // Khóa 1 lần duy nhất: Nếu đã mở quà rồi thì chỉ hiển thị lại, KHÔNG cho bốc lại!
  if (state.claim) {
    showWish(state.claim, true);
    return { content: state.claim.content };
  }

  // Kiểm tra trực tiếp trên Firebase xem thiết bị vật lý này đã mở quà ở trình duyệt khác chưa
  try {
    const devCheck = await fetch(`${FIREBASE_DB_URL}/device_claims/${devId}.json`);
    const devClaim = devCheck.ok ? await devCheck.json() : null;
    if (devClaim && devClaim.content) {
      state.claim = devClaim;
      render();
      toast('Thiết bị này đã nhận quà Trung Thu rồi! Đang mở lại món quà của bạn ☾');
      showWish(state.claim, true);
      return { content: state.claim.content };
    }
  } catch (_) {}

  if (opening) return { opening: true };
  opening = true;

  const giftObj = $('.gift-object');
  if (giftObj) giftObj.classList.add('opening');
  $$('[data-action="gift"]').forEach(b => b.disabled = true);

  await new Promise(r => setTimeout(r, 900));

  if (!state.claim) {
    // Bể bốc quà: Lời chúc thật từ cộng đồng Firebase
    const liveWishes = communityWishes.filter(w => w.public && w.content);
    // Ưu tiên bốc lời chúc của người khác nếu có
    const others = liveWishes.filter(w => w.id !== state.visitorId);
    let picked;

    if (others.length > 0) {
      picked = others[Math.floor(Math.random() * others.length)];
    } else if (liveWishes.length > 0) {
      picked = liveWishes[Math.floor(Math.random() * liveWishes.length)];
    } else {
      // Fallback chỉ khi hoàn toàn chưa có ai gửi lời chúc nào
      const text = defaultBlessings[Math.floor(Math.random() * defaultBlessings.length)];
      picked = { content: text, name: 'Một người bạn dưới ánh trăng ☾', lanternType: 'ong-sao' };
    }

    const claim = {
      content: picked.content,
      name: picked.anonymous ? 'Một người bạn' : (picked.name || 'Một người bạn'),
      lanternType: picked.lanternType || 'ong-sao',
      sourceWishId: picked.id || '',
      visitorId: state.visitorId,
      deviceId: devId,
      created: new Date().toISOString()
    };
    const claimPath = `${FIREBASE_DB_URL}/claims/${state.visitorId}.json`;
    const devClaimPath = `${FIREBASE_DB_URL}/device_claims/${devId}.json`;
    const claimCheck = await fetch(claimPath, { headers: { 'X-Firebase-ETag': 'true' } });
    const existingClaim = claimCheck.ok ? await claimCheck.json() : null;
    if (existingClaim?.content) {
      state.claim = existingClaim;
    } else {
      const claimResponse = await fetch(claimPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': claimCheck.headers.get('etag') || '*' },
      body: JSON.stringify(claim)
      });
      if (claimResponse.status === 412) {
        const locked = await fetch(claimPath).then(res => res.json());
        if (!locked?.content) throw new Error('Chưa thể khóa món quà trên Firebase.');
        state.claim = locked;
      } else {
        if (!claimResponse.ok) throw new Error('Chưa thể lưu món quà lên Firebase.');
        state.claim = claim;

        // Lưu đồng thời khóa thiết bị vật lý lên Firebase
        fetch(devClaimPath, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(claim)
        }).catch(() => {});

        // Liên kết deviceId -> visitorId
        fetch(`${FIREBASE_DB_URL}/device_users/${devId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.visitorId)
        }).catch(() => {});

        // Tăng lượt bốc của lời chúc nguồn nếu có
        if (picked && picked.id) {
          try {
            const newPicks = (picked.picksCount || 0) + 1;
            picked.picksCount = newPicks;
            fetch(`${FIREBASE_DB_URL}/wishes/${encodeURIComponent(picked.id)}/picksCount.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newPicks)
            }).catch(() => {});
          } catch {}
        }
      }
    }
  }

  if (giftObj) giftObj.classList.remove('opening');
  $$('[data-action="gift"]').forEach(b => b.disabled = false);
  opening = false;

  render();
  showWish(state.claim, true);

  // Sparkles
  const dialog = $('#wish-dialog');
  if (dialog) {
    for (let i = 0; i < 24; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.textContent = '✦';
      s.style.setProperty('--dx', Math.cos(i) * 190 + 'px');
      s.style.setProperty('--dy', Math.sin(i) * 240 + 'px');
      dialog.append(s);
      setTimeout(() => s.remove(), 1600);
    }
  }

  return { content: state.claim.content };
}

async function sendWish(content, name, anonymous, isPublic, lanternType) {
  content = String(content).trim();
  name = String(name).trim();
  if (content.length < 10 || content.length > 300) throw new Error('Lời chúc cần từ 10 đến 300 ký tự.');
  if (!name || name.length > 40) throw new Error('Vui lòng nhập tên từ 1 đến 40 ký tự.');

  // Quy tắc: 1 người = 1 ngọn đèn duy nhất (chỉ cho sửa, không sinh mới)
  const isUpdate = state.wishes.length > 0;
  const wishId = state.visitorId;

  const w = {
    id: wishId,
    visitorId: state.visitorId,
    name,
    content,
    anonymous: !!anonymous,
    public: !!isPublic,
    lanternType: normalizeLanternType(lanternType),
    created: isUpdate && state.wishes[0]?.created ? state.wishes[0].created : new Date().toISOString(),
    updated: new Date().toISOString()
  };

  const response = await fetch(`${FIREBASE_DB_URL}/wishes/${wishId}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(w)
  });
  if (!response.ok) throw new Error('Chưa thể lưu lời chúc lên Firebase. Vui lòng thử lại.');
  state.wishes = [w];

  // Lưu liên kết device -> wish
  const devId = state.deviceId || (await deviceReady);
  if (devId) {
    fetch(`${FIREBASE_DB_URL}/device_wishes/${devId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wishId)
    }).catch(() => {});
  }

  // Cập nhật bộ nhớ đệm lời chúc cộng đồng
  const existIdx = communityWishes.findIndex(item => item.id === wishId);
  if (existIdx >= 0) communityWishes[existIdx] = w;
  else communityWishes.unshift(w);

  render();
  return { id: w.id, public: w.public, lanternType: w.lanternType, isUpdate };
}

/* Sharing & Copying */
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Đã sao chép liên kết ♡');
  } catch {
    toast('Bạn có thể sao chép địa chỉ trên thanh trình duyệt.');
  }
}

async function share(text) {
  const url = location.href.split('#')[0].split('?')[0];
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Dưới Ánh Trăng · Trung Thu 2026',
        text,
        url
      });
    } catch (e) {
      if (e.name !== 'AbortError') await copy(text + '\n' + url);
    }
  } else {
    await copy(text + '\n' + url);
  }
}

/* Canvas Image Generation (Dynamic Centering & Safe Signature Positioning) */
async function exportWishImage(wishText, recipientName) {
  if (!wishText) return;
  toast('Đang chuẩn bị ảnh thiệp…');
  try {
    await document.fonts.ready;
  } catch {}

  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const ctx = c.getContext('2d');

  // Background Gradient
  const grad = ctx.createLinearGradient(0, 0, 1080, 1350);
  grad.addColorStop(0, '#0a1222');
  grad.addColorStop(0.5, '#13192d');
  grad.addColorStop(1, '#231828');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1350);

  // Outer Golden Frame
  ctx.strokeStyle = '#c99f57';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(45, 45, 990, 1260);

  // Inner Subtle Frame
  ctx.strokeStyle = '#634b35';
  ctx.lineWidth = 1;
  ctx.strokeRect(55, 55, 970, 1240);

  // Top Moon Ornament
  ctx.fillStyle = '#f3c678';
  ctx.beginPath();
  ctx.arc(540, 195, 62, 0, Math.PI * 2);
  ctx.fill();

  // Crescent Shadow
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(562, 185, 52, 0, Math.PI * 2);
  ctx.fill();

  // Eyebrow Header
  ctx.textAlign = 'center';
  ctx.fillStyle = '#d4b782';
  ctx.font = '22px "Be Vietnam Pro", sans-serif';
  ctx.fillText('TRUNG THU · 2026', 540, 310);

  // Recipient Name
  ctx.fillStyle = '#f5cf89';
  ctx.font = 'bold 50px "Charm", cursive';
  ctx.fillText(recipientName || 'Bạn', 540, 395, 900);

  // Ornament Divider
  ctx.font = '22px serif';
  ctx.fillStyle = '#9f7842';
  ctx.fillText('✧ ───── ☾ ───── ✧', 540, 445);

  // Wish text wrapping
  ctx.fillStyle = '#fff4e6';
  ctx.font = '40px "Charm", cursive';
  const words = wishText.split(/\s+/);
  const lines = [];
  let currentLine = '';
  for (const w of words) {
    const testLine = currentLine ? currentLine + ' ' + w : w;
    if (ctx.measureText(testLine).width > 820) {
      lines.push(currentLine);
      currentLine = w;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Dynamic Vertical Centering
  const lineHeight = 64;
  const totalHeight = lines.length * lineHeight;
  const textCenterY = 720;
  const startY = Math.max(500, textCenterY - (totalHeight / 2) + 20);

  lines.forEach((l, i) => {
    ctx.fillText(l, 540, startY + i * lineHeight);
  });

  // Dynamic Signature Position with Safe Clearance
  const sigY = Math.max(startY + totalHeight + 70, 1130);
  ctx.font = '30px "Charm", cursive';
  ctx.fillStyle = '#e8caa2';
  ctx.fillText('— Một người bạn dưới ánh trăng ☾', 540, Math.min(sigY, 1150));

  ctx.font = '18px "Be Vietnam Pro", sans-serif';
  ctx.fillStyle = '#a98c63';
  ctx.fillText('DƯỚI ÁNH TRĂNG · NHẬN VÀ TRAO YÊU THƯƠNG', 540, 1225);

  c.toBlob(blob => {
    if (!blob) {
      toast('Chưa thể tạo ảnh. Vui lòng thử lại.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loi-chuc-trung-thu.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('Đã tạo ảnh lời chúc để lưu ♡');
  }, 'image/png');
}

/* Page Specific Bindings */
function bindPageEvents() {
  // Gift buttons
  $$('[data-action="gift"]').forEach(b => {
    b.onclick = e => {
      e.preventDefault();
      if (document.body.dataset.page !== 'gift') {
        navigateTo('gift.html?open=true');
      } else {
        openGift().catch(err => {
          opening = false;
          $('.gift-object')?.classList.remove('opening');
          $$('[data-action="gift"]').forEach(btn => btn.disabled = false);
          toast(err.message || 'Chưa thể mở quà từ Firebase.');
        });
      }
    };
  });

  // Music controls
  const musicBtn = $('#music');
  if (musicBtn) musicBtn.onclick = toggleMusic;
  const musicCard = $('#music-card');
  if (musicCard) musicCard.onclick = toggleMusic;

  // Name form
  const nameForm = $('#name-form');
  if (nameForm) {
    nameForm.onsubmit = e => {
      e.preventDefault();
      try {
        start($('#visitor-name').value);
      } catch (err) {
        toast(err.message);
      }
    };
  }

  // Edit name button
  const editName = $('#edit-name');
  if (editName) {
    editName.onclick = () => {
      const input = $('#visitor-name');
      if (input) input.value = state.name;
      const welcome = $('#welcome');
      if (welcome) welcome.showModal();
    };
  }

  // Wish form (write.html)
  const wishForm = $('#wish-form');
  const wishContent = $('#wish-content');
  const charCount = $('#char-count');
  if (wishContent && charCount) {
    wishContent.oninput = e => {
      charCount.textContent = e.target.value.length + '/300';
    };
  }

  if (wishForm) {
    wishForm.onsubmit = async e => {
      e.preventDefault();
      try {
        const isAnon = $('#anonymous')?.checked;
        const isPub = $('#public')?.checked;
        const lanternType = $('input[name="lantern-type"]:checked')?.value || 'ong-sao';
        const result = await sendWish(wishContent.value, $('#sender-name').value, isAnon, isPub, lanternType);
        wishContent.value = '';
        if (charCount) charCount.textContent = '0/300';

        const letter = document.createElement('img');
        letter.className = 'flying-letter';
        letter.src = getLanternAsset(lanternType, 'png');
        letter.alt = '';
        letter.style.width = '64px';
        letter.style.height = '64px';
        letter.style.objectFit = 'contain';
        document.body.append(letter);

        setTimeout(() => {
          letter.remove();
          navigateTo(result.public ? 'sky.html' : 'profile.html');
        }, 1800);

        toast(result.isUpdate
          ? 'Đã cập nhật lời chúc của bạn.'
          : (result.public ? 'Ngọn đèn ước nguyện đã bay lên bầu trời.' : 'Lời chúc riêng tư đã được lưu trong Trang của bạn.'));
      } catch (err) {
        toast(err.message);
      }
    };
  }

  // More wishes button (wishes.html)
  const moreWishes = $('#more-wishes');
  if (moreWishes) {
    moreWishes.onclick = () => {
      expanded = !expanded;
      render();
    };
  }

  // Sharing buttons
  const shareSite = $('#share-site');
  if (shareSite) shareSite.onclick = () => share('Có một món quà Trung Thu dành cho bạn ☾');

  const copySite = $('#copy-site');
  if (copySite) copySite.onclick = () => copy(location.href.split('#')[0].split('?')[0]);

  const shareWish = $('#share-wish');
  if (shareWish) shareWish.onclick = () => share(state.claim?.content || '');

  // Save image buttons
  const saveImg = $('#save-image');
  if (saveImg) {
    saveImg.onclick = () => {
      if (state.claim) exportWishImage(state.claim.content, state.name);
    };
  }

  const saveProfileImg = $('#save-image-profile');
  if (saveProfileImg) {
    saveProfileImg.onclick = () => {
      if (state.claim) {
        exportWishImage(state.claim.content, state.name);
      } else {
        toast('Bạn chưa mở món quà nào để lưu thiệp.');
      }
    };
  }

  // Dialog close buttons
  const closeWish = $('#close-wish-dialog');
  if (closeWish) closeWish.onclick = () => $('#wish-dialog').close();

  const leaveWish = $('#leave-wish');
  if (leaveWish) {
    leaveWish.onclick = () => {
      $('#wish-dialog').close();
      navigateTo('write.html');
    };
  }

  const showQr = $('#show-qr');
  if (showQr) showQr.onclick = () => $('#qr-dialog').showModal();

  const closeQr = $('#close-qr');
  if (closeQr) closeQr.onclick = () => $('#qr-dialog').close();
}

function updateActiveNav(page) {
  const normalizedPage = (page === 'reunion') ? 'create-reunion' : (page === 'feast') ? 'create-feast' : page;
  let activeItem = null;
  $$('nav a').forEach(a => {
    const href = a.getAttribute('href');
    const targetPage = href === 'index.html' ? 'home' : href.replace('.html', '');
    const isActive = targetPage === normalizedPage;
    a.classList.toggle('active', isActive);
    if (isActive) activeItem = a;
  });
  if (activeItem && typeof activeItem.scrollIntoView === 'function') {
    try {
      activeItem.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    } catch (_) {}
  }
}

/* PJAX Router: Continuous Audio & Seamless Page Transitions */
async function navigateTo(url, replaceState = false) {
  const targetUrl = new URL(url, location.href);

  // If internal anchor on same page
  if (targetUrl.pathname === location.pathname) {
    if (targetUrl.search) handleQueryParams(targetUrl.searchParams);
    return;
  }

  try {
    const mainEl = $('main');
    if (mainEl) mainEl.style.opacity = '0.3';

    const res = await fetch(targetUrl.href);
    if (!res.ok) throw new Error('Fetch status ' + res.status);
    const html = await res.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const newMain = doc.querySelector('main');
    const newPage = doc.body.dataset.page || 'home';
    const newTitle = doc.title;

    if (newMain && mainEl) {
      mainEl.replaceWith(newMain);
    }

    // Sync any dialogs provided by the target page
    const newDialogs = doc.querySelectorAll('dialog');
    newDialogs.forEach(d => {
      const existing = document.getElementById(d.id);
      if (existing) {
        existing.innerHTML = d.innerHTML;
      }
    });

    document.title = newTitle;
    document.body.dataset.page = newPage;

    if (replaceState) {
      history.replaceState({ page: newPage }, '', targetUrl.href);
    } else {
      history.pushState({ page: newPage }, '', targetUrl.href);
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
    initPage();
    handleQueryParams(targetUrl.searchParams);
  } catch (err) {
    // Fallback to normal navigation if fetch is unsupported or CORS-blocked
    location.href = url;
  }
}

function handleQueryParams(params) {
  if (document.body.dataset.page === 'gift') {
    if (params.get('open') === 'true' || params.get('open') === '1') {
      setTimeout(() => {
        openGift().catch(err => toast(err.message || 'Chưa thể mở quà từ Firebase.'));
      }, 350);
    }
  }
}

// Intercept all internal navigation clicks
document.addEventListener('click', e => {
  const link = e.target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('http') || link.getAttribute('download')) {
    return;
  }
  // Internal page navigation
  e.preventDefault();
  navigateTo(href);
});

window.addEventListener('popstate', () => {
  navigateTo(location.href, true);
});

/* Atmosphere Generation */
function initAtmosphere() {
  const atmo = $('#atmosphere');
  if (!atmo || atmo.children.length > 0) return;

  for (let i = 0; i < 10; i++) {
    const l = document.createElement('img');
    const type = lanternTypes[i % lanternTypes.length];
    l.src = getLanternAsset(type);
    l.onerror = () => { l.onerror = null; l.src = getLanternAsset(type, 'png'); };
    l.alt = '';
    l.className = 'floating-lantern';
    l.style.cssText = `--x:${i * 11}%;--size:${18 + (i % 3) * 8}px;--duration:${24 + i * 2}s;--delay:${-i * 5}s`;
    atmo.append(l);
  }

  for (let i = 0; i < 40; i++) {
    const s = document.createElement('span');
    s.className = 'star';
    s.style.cssText = `--x:${(i * 29.7) % 100}%;--y:${(i * 13.3) % 100}%;--duration:${2 + (i % 5)}s;--delay:${-i}s`;
    atmo.append(s);
  }
}

/* =========================================================
   PRIVATE GREETING CARDS (create-card.html & card.html)
   ========================================================= */
let currentQrInstance = null;
let lastCreatedCard = null;
let currentCardData = null;

async function createPrivateCard(data) {
  const cardId = 'trang-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const cardPayload = {
    id: cardId,
    to: data.to.trim(),
    from: data.from.trim(),
    message: data.message.trim(),
    lanternType: data.lanternType || 'ong-sao',
    theme: data.theme || 'gold',
    stamp: data.stamp || 'Đoàn Viên',
    passcode: data.passcode ? data.passcode.trim() : '',
    created: Date.now()
  };

  const res = await fetch(`${FIREBASE_DB_URL}/private_cards/${cardId}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cardPayload)
  });

  if (!res.ok) throw new Error('Không thể kết nối lưu thiệp.');

  await fetch(`${FIREBASE_DB_URL}/private_card_owners/${state.visitorId}/${cardId}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'owner', created: cardPayload.created })
  });

  return cardPayload;
}

async function getPrivateCard(cardId) {
  if (!cardId) return null;
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/private_cards/${cardId}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function exportPrivateCardImage(card) {
  if (!card || !card.message) return;
  toast('Đang tạo ảnh thiệp kỷ niệm…');
  try {
    await document.fonts.ready;
  } catch {}

  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1440;
  const ctx = c.getContext('2d');

  // Determine theme styling
  const theme = card.theme || 'gold';
  let colors;
  if (theme === 'midnight') {
    colors = {
      bg: ['#0e1b33', '#091325', '#050a14'],
      outerBorder: '#d4a754',
      innerBorder: 'rgba(212, 167, 84, 0.4)',
      corner: '#d4a754',
      eyebrow: '#dfbe87',
      to: '#ffdca8',
      divider: '#b88d55',
      message: '#fff4e3',
      from: '#ffdca8',
      date: '#b59f84',
      stamp: '#d4a754'
    };
  } else if (theme === 'ruby') {
    colors = {
      bg: ['#741318', '#560d12', '#3b0609'],
      outerBorder: '#f2c779',
      innerBorder: 'rgba(242, 199, 121, 0.4)',
      corner: '#f2c779',
      eyebrow: '#f0cb9e',
      to: '#ffe6bd',
      divider: '#f2c779',
      message: '#fff8f0',
      from: '#ffe6bd',
      date: '#f0cb9e',
      stamp: '#f2c779'
    };
  } else if (theme === 'emerald') {
    colors = {
      bg: ['#103227', '#0a231b', '#05140e'],
      outerBorder: '#d4a754',
      innerBorder: 'rgba(212, 167, 84, 0.4)',
      corner: '#d4a754',
      eyebrow: '#cfdec7',
      to: '#ffd899',
      divider: '#a8caa0',
      message: '#ffffff',
      from: '#ffd899',
      date: '#a8caa0',
      stamp: '#d4a754'
    };
  } else {
    // Default 'gold' (Giấy Dó)
    colors = {
      bg: ['#fffbf2', '#f6e5d0', '#edd1b3'],
      outerBorder: '#b88a53',
      innerBorder: 'rgba(184, 138, 83, 0.5)',
      corner: '#b88a53',
      eyebrow: '#8f6236',
      to: '#821c1c',
      divider: '#a87e49',
      message: '#2e1c15',
      from: '#6e4125',
      date: '#8c6a51',
      stamp: '#b82828'
    };
  }

  // Background Gradient
  const grad = ctx.createLinearGradient(0, 0, 1080, 1440);
  grad.addColorStop(0, colors.bg[0]);
  grad.addColorStop(0.5, colors.bg[1]);
  grad.addColorStop(1, colors.bg[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1440);

  // Outer Golden Frame
  ctx.strokeStyle = colors.outerBorder;
  ctx.lineWidth = 3;
  ctx.strokeRect(45, 45, 990, 1350);

  // Inner Frame
  ctx.strokeStyle = colors.innerBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(58, 58, 964, 1324);

  // Corner Ornaments
  ctx.strokeStyle = colors.corner;
  ctx.lineWidth = 2;
  const corners = [[70, 70], [1010, 70], [70, 1370], [1010, 1370]];
  corners.forEach(([cx, cy]) => {
    ctx.strokeRect(cx - 8, cy - 8, 16, 16);
  });

  // Top Lantern Image
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = getLanternAsset(card.lanternType || 'ong-sao', 'png');
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 540 - 75, 120, 150, 150);
    }
  } catch {}

  // Header Eyebrow
  ctx.textAlign = 'center';
  ctx.fillStyle = colors.eyebrow;
  ctx.font = '20px "Be Vietnam Pro", sans-serif';
  ctx.fillText('DƯỚI ÁNH TRĂNG · TRUNG THU 2026', 540, 310);

  // Recipient Salutation
  ctx.fillStyle = colors.to;
  ctx.font = 'bold 52px "Charm", cursive';
  ctx.fillText('Gửi tặng: ' + (card.to || 'Bố Mẹ và Gia đình'), 540, 385, 900);

  // Divider
  ctx.fillStyle = colors.divider;
  ctx.font = '22px "Be Vietnam Pro", sans-serif';
  ctx.fillText('✧ ───── ☾ ───── ✧', 540, 440);

  // Message body with multiline wrapping
  ctx.fillStyle = colors.message;
  ctx.font = '34px/1.8 "Charm", cursive';
  const maxWidth = 860;
  const words = (card.message || '').split(' ');
  let line = '';
  let y = 520;
  const lineHeight = 65;

  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && i > 0) {
      ctx.fillText(line.trim(), 540, y);
      line = words[i] + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), 540, y);

  // Signature
  const sigY = Math.max(y + 90, 1180);
  ctx.textAlign = 'right';
  ctx.fillStyle = colors.from;
  ctx.font = '38px "Charm", cursive';
  ctx.fillText('— ' + (card.from || 'Người bạn dưới ánh trăng'), 940, sigY);

  // Date
  ctx.fillStyle = colors.date;
  ctx.font = '20px "Be Vietnam Pro", sans-serif';
  const dateStr = card.created ? new Date(card.created).toLocaleDateString('vi-VN') : 'Rằm tháng Tám 2026';
  ctx.fillText('Mùa trăng rằm · ' + dateStr, 940, sigY + 45);

  // Blessing seal stamp (Bottom left)
  const stampText = card.stamp || 'Đoàn Viên';
  ctx.save();
  ctx.translate(160, sigY + 15);
  ctx.rotate(-8 * Math.PI / 180);
  ctx.strokeStyle = colors.stamp;
  ctx.lineWidth = 3;
  ctx.strokeRect(-50, -50, 100, 100);
  ctx.fillStyle = colors.stamp;
  ctx.font = 'bold 24px "Charm", cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stampText, 0, 0);
  ctx.restore();

  c.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thiep-trung-thu-${(card.to || 'tang-ban').toLowerCase().replace(/\s+/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('Đã lưu thiệp ảnh thành công');
  }, 'image/png');
}

function initCreateCardPage() {
  const form = $('#create-card-form');
  if (!form) return;

  const toInput = $('#card-to');
  const fromInput = $('#card-from');
  const msgInput = $('#card-message');
  const passcode = $('#card-passcode');
  const charCount = $('#card-char-count');

  if (fromInput && !fromInput.value && state.name) {
    fromInput.value = state.name;
    const prevFrom = $('#preview-from');
    if (prevFrom) prevFrom.textContent = '— ' + state.name;
  }

  if (toInput) {
    toInput.oninput = () => {
      const prev = $('#preview-to');
      if (prev) prev.textContent = 'Gửi tặng: ' + (toInput.value.trim() || 'Bố Mẹ và Gia đình');
    };
  }

  if (fromInput) {
    fromInput.oninput = () => {
      const prev = $('#preview-from');
      if (prev) prev.textContent = '— ' + (fromInput.value.trim() || 'Con của bố mẹ');
    };
  }

  if (msgInput) {
    msgInput.oninput = () => {
      if (charCount) charCount.textContent = msgInput.value.length + '/400';
      const prev = $('#preview-msg');
      if (prev) prev.textContent = msgInput.value || 'Viết lời nhắn nhủ đêm trăng...';
    };
  }

  // Theme selection
  function applySelectedTheme(theme) {
    $$('#card-theme-selector .theme-select-card').forEach(c => {
      const isMatch = c.dataset.theme === theme;
      c.classList.toggle('active', isMatch);
      const r = c.querySelector('input');
      if (r) r.checked = isMatch;
    });
    const preview = $('#card-live-preview');
    if (preview) {
      preview.className = 'royal-letter theme-' + theme;
    }
  }

  $$('#card-theme-selector .theme-select-card').forEach(card => {
    card.addEventListener('click', () => {
      applySelectedTheme(card.dataset.theme || 'gold');
    });
  });

  $$('input[name="card-theme"]').forEach(radio => {
    radio.addEventListener('change', () => {
      applySelectedTheme(radio.value);
    });
  });

  // Stamp selection
  function applySelectedStamp(stamp) {
    $$('#card-stamp-selector .stamp-chip').forEach(c => {
      const isMatch = c.dataset.stamp === stamp;
      c.classList.toggle('active', isMatch);
      const r = c.querySelector('input');
      if (r) r.checked = isMatch;
    });
    const previewStamp = $('#preview-stamp');
    if (previewStamp) {
      previewStamp.textContent = stamp;
    }
  }

  $$('#card-stamp-selector .stamp-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      applySelectedStamp(chip.dataset.stamp || 'Đoàn Viên');
    });
  });

  $$('input[name="card-stamp"]').forEach(radio => {
    radio.addEventListener('change', () => {
      applySelectedStamp(radio.value);
    });
  });

  // Lantern selection
  function applySelectedLantern(type) {
    $$('#card-lantern-selector .lantern-select-card').forEach(c => {
      const isMatch = c.dataset.type === type;
      c.classList.toggle('active', isMatch);
      const r = c.querySelector('input');
      if (r) r.checked = isMatch;
    });
    const previewImg = $('#preview-lantern');
    if (previewImg) {
      previewImg.src = getLanternAsset(type);
    }
  }

  $$('#card-lantern-selector .lantern-select-card').forEach(card => {
    card.addEventListener('click', () => {
      applySelectedLantern(card.dataset.type || 'ong-sao');
    });
  });

  $$('input[name="card-lantern"]').forEach(radio => {
    radio.addEventListener('change', () => {
      applySelectedLantern(radio.value);
    });
  });

  // Quote suggestion chips (fills both recipient and message if available)
  $$('.quote-chip').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.to && toInput) {
        toInput.value = btn.dataset.to;
        toInput.dispatchEvent(new Event('input'));
      }
      if (msgInput) {
        msgInput.value = btn.dataset.quote || '';
        msgInput.dispatchEvent(new Event('input'));
      }
    };
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btnSubmit = $('#btn-submit-card');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Đang niêm phong thiệp…';
    }

    try {
      const selectedType = $('input[name="card-lantern"]:checked')?.value || 'ong-sao';
      const selectedTheme = $('input[name="card-theme"]:checked')?.value || 'gold';
      const selectedStamp = $('input[name="card-stamp"]:checked')?.value || 'Đoàn Viên';
      const card = await createPrivateCard({
        to: toInput.value,
        from: fromInput.value,
        message: msgInput.value,
        lanternType: selectedType,
        theme: selectedTheme,
        stamp: selectedStamp,
        passcode: passcode?.value
      });

      lastCreatedCard = card;
      const cardUrl = new URL('card.html?id=' + card.id, location.href).href;

      const qrBox = $('#generated-qrcode');
      if (qrBox) {
        qrBox.innerHTML = '';
        if (typeof QRCode !== 'undefined') {
          currentQrInstance = new QRCode(qrBox, {
            text: cardUrl,
            width: 200,
            height: 200,
            colorDark: "#2c1b0d",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      }

      const linkInput = $('#card-link-input');
      if (linkInput) linkInput.value = cardUrl;

      const directView = $('#btn-view-card-direct');
      if (directView) directView.href = cardUrl;

      const modal = $('#card-result-dialog');
      if (modal) modal.showModal();

      toast('Tấm thiệp đã sẵn sàng trao gửi');
    } catch (err) {
      toast('Có lỗi khi lưu thiệp: ' + err.message);
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<svg class="btn-icon" style="stroke:#2c1b0d;" viewBox="0 0 24 24"><path d="M12 7.5c-1.8-2.2-4.5-2.2-4.5-.3 0 1.6 3 2.8 4.5 2.8s4.5-1.2 4.5-2.8c0-1.9-2.7-1.9-4.5.3z" fill="none"/><rect x="3" y="7.5" width="18" height="3.5" rx="1.5"/><path d="M5 11v8.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V11"/><path d="M12 7.5V21.5"/></svg> Tạo thiệp và Xuất mã QR`;
      }
    }
  };

  const copyBtn = $('#btn-copy-card-link');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const linkInput = $('#card-link-input');
      if (linkInput) copy(linkInput.value);
    };
  }

  const dlQrBtn = $('#btn-download-qr');
  if (dlQrBtn) {
    dlQrBtn.onclick = () => {
      const qrCanvas = $('#generated-qrcode canvas');
      const qrImg = $('#generated-qrcode img');
      const src = qrCanvas ? qrCanvas.toDataURL('image/png') : (qrImg ? qrImg.src : null);
      if (src) {
        const a = document.createElement('a');
        a.href = src;
        a.download = 'ma-qr-thiep-trung-thu.png';
        a.click();
        toast('Đã tải mã QR về máy');
      } else {
        toast('Chưa tạo xong mã QR.');
      }
    };
  }

  const dlCardImgBtn = $('#btn-download-card-image');
  if (dlCardImgBtn) {
    dlCardImgBtn.onclick = () => {
      if (lastCreatedCard) exportPrivateCardImage(lastCreatedCard);
    };
  }

  const closeResult = $('#close-card-result');
  if (closeResult) {
    closeResult.onclick = () => $('#card-result-dialog').close();
  }
}

async function initCardPage() {
  const envelopeView = $('#envelope-view');
  const letterView = $('#letter-view');
  const errorView = $('#card-error-view');
  if (!envelopeView) return;

  const params = new URLSearchParams(location.search);
  const cardId = params.get('id');

  if (!cardId) {
    const to = params.get('to');
    const from = params.get('from');
    const msg = params.get('msg');
    if (to && msg) {
      currentCardData = {
        to,
        from: from || 'Người bạn dưới trăng',
        message: msg,
        lanternType: params.get('lantern') || 'ong-sao',
        created: Date.now()
      };
      displayCard(currentCardData);
      return;
    }
    if (errorView) errorView.style.display = 'block';
    envelopeView.style.display = 'none';
    return;
  }

  try {
    const card = await getPrivateCard(cardId);
    if (!card) {
      if (errorView) errorView.style.display = 'block';
      envelopeView.style.display = 'none';
      return;
    }
    currentCardData = card;
    displayCard(card);
  } catch (err) {
    if (errorView) errorView.style.display = 'block';
    envelopeView.style.display = 'none';
  }
}

function displayCard(card) {
  const theme = card.theme || 'gold';

  const recipientLabel = $('#envelope-recipient-label');
  if (recipientLabel) recipientLabel.textContent = 'Gửi riêng ' + card.to;

  const envelope = $('#btn-open-envelope');
  if (envelope) {
    envelope.className = 'royal-envelope theme-' + theme;
  }

  const revealedLetter = $('#revealed-card-letter');
  if (revealedLetter) {
    revealedLetter.className = 'royal-letter theme-' + theme;
  }

  const sealStamp = $('#card-seal-stamp');
  if (sealStamp) {
    sealStamp.textContent = card.stamp || 'Đoàn Viên';
  }

  const cardLantern = $('#card-lantern-img');
  if (cardLantern) {
    cardLantern.src = getLanternAsset(card.lanternType || 'ong-sao');
  }

  const cardTo = $('#card-recipient-text');
  if (cardTo) cardTo.textContent = 'Gửi tặng: ' + card.to;

  const cardMsg = $('#card-message-text');
  if (cardMsg) cardMsg.textContent = card.message;

  const cardFrom = $('#card-sender-text');
  if (cardFrom) cardFrom.textContent = '— ' + (card.from || 'Một người bạn dưới ánh trăng');

  const cardTime = $('#card-time-text');
  if (cardTime) {
    cardTime.textContent = card.created
      ? 'Đêm rằm tháng Tám · ' + new Date(card.created).toLocaleDateString('vi-VN')
      : 'Mùa trăng rằm · 2026';
  }

  const openBtn = $('#btn-open-envelope');
  if (openBtn) {
    openBtn.onclick = () => {
      if (card.passcode) {
        const dialog = $('#passcode-dialog');
        if (dialog) {
          dialog.showModal();
          const form = $('#passcode-form');
          if (form) {
            form.onsubmit = (e) => {
              e.preventDefault();
              const val = $('#passcode-input')?.value?.trim();
              if (val && val.toLowerCase() === card.passcode.toLowerCase()) {
                dialog.close();
                revealLetter();
              } else {
                toast('Mật khẩu chưa chính xác rồi!');
              }
            };
          }
        }
      } else {
        revealLetter();
      }
    };
  }

  const saveImgBtn = $('#btn-save-recipient-card');
  if (saveImgBtn) {
    saveImgBtn.onclick = () => {
      if (currentCardData) exportPrivateCardImage(currentCardData);
    };
  }
}

function revealLetter() {
  const env = $('#envelope-view');
  const letView = $('#letter-view');
  if (env) env.style.display = 'none';
  if (letView) letView.style.display = 'block';

  for (let i = 0; i < 8; i++) {
    const s = document.createElement('span');
    s.className = 'spark';
    s.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
    s.style.setProperty('--dy', (Math.random() * -160 - 40) + 'px');
    s.textContent = '✧';
    document.body.append(s);
    setTimeout(() => s.remove(), 1500);
  }

  if (musicOn) startMusic(true);
}

/* Bánh Trăng Đoàn Viên */
let lastReunionBox = null;
let reunionPollingTimer = null;

async function rememberReunion(id, role) {
  const response = await fetch(`${FIREBASE_DB_URL}/reunion_members/${state.visitorId}/${id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, touchedAt: Date.now() })
  });
  if (!response.ok) throw new Error('Chưa thể ghi bàn trà vào hồ sơ Firebase.');
}

function safeText(value, max) {
  return String(value || '').trim().slice(0, max);
}

async function createReunionBox(data) {
  const id = 'ban-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const now = new Date().toISOString();
  const box = {
    id,
    ownerId: state.visitorId,
    ownerName: safeText(data.ownerName, 40),
    title: safeText(data.title, 60),
    style: ['tre', 'son-mai', 'bao-cap'].includes(data.style) ? data.style : 'tre',
    flavor: safeText(data.flavor, 60), tea: safeText(data.tea, 60),
    capacity: [4, 6, 8].includes(Number(data.capacity)) ? Number(data.capacity) : 4,
    message: safeText(data.message, 260), created: now, updated: now,
    seats: {
      [state.visitorId]: {
        visitorId: state.visitorId, name: safeText(data.ownerName, 40),
        reply: 'Mình đã chuẩn bị bánh và trà, chờ mọi người cùng về.',
        role: 'owner', joinedAt: now
      }
    }
  };
  if (!box.ownerName || !box.title || box.message.length < 10) throw new Error('Vui lòng điền đủ tên, tên bàn trà và lời mời.');
  const response = await fetch(`${FIREBASE_DB_URL}/reunion_boxes/${id}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(box)
  });
  if (!response.ok) throw new Error('Chưa thể tạo bàn trà trên Firebase.');
  await rememberReunion(id, 'owner');
  return box;
}

async function getReunionBox(id, withEtag = false) {
  if (!id) return null;
  const response = await fetch(`${FIREBASE_DB_URL}/reunion_boxes/${encodeURIComponent(id)}.json`, {
    headers: withEtag ? { 'X-Firebase-ETag': 'true' } : {}
  });
  if (!response.ok) return null;
  return { box: await response.json(), etag: response.headers.get('etag') };
}

async function saveReunionSeat(boxId, name, reply) {
  name = safeText(name, 40); reply = safeText(reply, 180);
  if (!name || reply.length < 2) throw new Error('Vui lòng nhập tên và một lời đáp ngắn.');
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getReunionBox(boxId, true);
    if (!current?.box) throw new Error('Bàn trà không còn tồn tại.');
    const box = current.box, seats = box.seats || {};
    const isEditing = Boolean(seats[state.visitorId]);
    if (!isEditing && Object.keys(seats).length >= Number(box.capacity || 4)) throw new Error('Bàn trà vừa đủ người rồi.');
    seats[state.visitorId] = {
      visitorId: state.visitorId, name, reply,
      role: state.visitorId === box.ownerId ? 'owner' : 'guest',
      joinedAt: seats[state.visitorId]?.joinedAt || new Date().toISOString(),
      updated: new Date().toISOString()
    };
    box.seats = seats; box.updated = new Date().toISOString();
    const response = await fetch(`${FIREBASE_DB_URL}/reunion_boxes/${encodeURIComponent(boxId)}.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'if-match': current.etag || '*' }, body: JSON.stringify(box)
    });
    if (response.ok) {
      await rememberReunion(boxId, state.visitorId === box.ownerId ? 'owner' : 'guest');
      return box;
    }
    if (response.status !== 412) throw new Error('Chưa thể lưu lời đáp lên Firebase.');
  }
  throw new Error('Nhiều người đang nhận bánh cùng lúc. Vui lòng thử lại.');
}

async function shareReunion(url, box) {
  const message = `${box?.ownerName || 'Một người bạn'} mời bạn về chung bàn “${box?.title || 'Bánh Trăng Đoàn Viên'}”.`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Bánh Trăng Đoàn Viên', text: message, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  await copy(message + '\n' + url);
}

function initCreateReunionPage() {
  const form = $('#reunion-create-form'); if (!form) return;
  const owner = $('#reunion-owner'), title = $('#reunion-title'), message = $('#reunion-message');
  const customWrap = $('#custom-capacity-wrap'), customInput = $('#custom-capacity-input');
  if (!owner.value) owner.value = state.name || '';

  const getCapacity = () => {
    const checked = $('input[name="reunion-capacity"]:checked')?.value;
    if (checked === 'custom') {
      const val = parseInt(customInput?.value, 10);
      return (Number.isFinite(val) && val >= 2) ? Math.min(60, val) : 10;
    }
    const num = parseInt(checked, 10);
    return (Number.isFinite(num) && num >= 2) ? num : 4;
  };

  const updateCustomVisibility = () => {
    const isCustom = $('input[name="reunion-capacity"]:checked')?.value === 'custom';
    if (customWrap) {
      customWrap.hidden = !isCustom;
      if (isCustom && customInput) customInput.focus();
    }
  };
  document.querySelectorAll('input[name="reunion-capacity"]').forEach(r => r.addEventListener('change', () => {
    updateCustomVisibility();
    syncPreview();
  }));
  if (customInput) customInput.addEventListener('input', syncPreview);

  const syncPreview = () => {
    const cap = getCapacity();
    $('#reunion-preview-title').textContent = title.value || (cap === 2 ? 'Chỉ hai ta dưới trăng' : 'Nhà mình dưới trăng');
    if (cap === 2) {
      $('#reunion-preview-message').textContent = message.value || 'Một chiếc bánh tròn dành riêng cho hai người tri kỷ.';
    } else if (cap > 8) {
      $('#reunion-preview-message').textContent = message.value || `Một mâm bánh lớn đang chờ ${cap} người sum vầy đông đủ.`;
    } else {
      $('#reunion-preview-message').textContent = message.value || 'Một chiếc bánh tròn đang chờ những người thương cùng trở về.';
    }
    $('#reunion-message-count').textContent = message.value.length + '/260';
    $('#reunion-preview-flavor').textContent = $('#reunion-flavor').value;
    $('#reunion-preview-tea').textContent = $('#reunion-tea').value;

    const selectedStyle = $('input[name="box-style"]:checked')?.value || 'tre';
    const boxAssets = { tre: 'assets/box-bamboo.webp', 'son-mai': 'assets/box-lacquer.webp', 'bao-cap': 'assets/box-paper.webp' };
    const previewBox = $('#reunion-preview-box');
    const previewCake = $('#reunion-preview-cake');
    if (previewBox) previewBox.src = boxAssets[selectedStyle];
    if (previewCake) previewCake.src = cap === 2 ? 'assets/mooncake-cut-2.webp' : 'assets/mooncake-cut-4.webp';

    // Mỗi vị trí được thể hiện bằng một chén gốm thật; bàn lớn vẫn xem gọn tối đa 12 chén.
    const cupsLayer = $('#reunion-preview-cups');
    if (cupsLayer) {
      cupsLayer.replaceChildren();
      const previewCups = Math.min(cap, 12);
      for (let i = 0; i < previewCups; i++) {
        const cup = document.createElement('img');
        cup.src = i === 0 ? 'assets/cup-filled.webp' : 'assets/cup-empty.webp';
        cup.alt = '';
        if (cap === 2) {
          cup.style.left = (i === 0 ? '12%' : '88%');
          cup.style.top = '52%';
        } else {
          const rad = (-90 + i * (360 / previewCups)) * Math.PI / 180;
          cup.style.left = (50 + Math.cos(rad) * 42) + '%';
          cup.style.top = (50 + Math.sin(rad) * 42) + '%';
        }
        cupsLayer.appendChild(cup);
      }
    }
  };

  [title, message, $('#reunion-flavor'), $('#reunion-tea')].forEach(el => el.addEventListener('input', syncPreview));
  $$('input[name="box-style"]').forEach(el => el.addEventListener('change', syncPreview));
  updateCustomVisibility();
  syncPreview();

  form.onsubmit = async e => {
    e.preventDefault(); const button = form.querySelector('[type="submit"]');
    button.disabled = true; button.textContent = 'Đang chuẩn bị bàn trà…';
    try {
      const cap = getCapacity();
      const box = await createReunionBox({
        ownerName: owner.value, title: title.value, message: message.value,
        style: $('input[name="box-style"]:checked')?.value, flavor: $('#reunion-flavor').value,
        tea: $('#reunion-tea').value, capacity: cap
      });
      state.name = box.ownerName; save(); lastReunionBox = box;
      const url = new URL('reunion.html?id=' + box.id, location.href).href;
      $('#reunion-link-output').value = url; $('#open-reunion-link').href = url;
      $('#reunion-result-dialog').showModal();
    } catch (err) { toast(err.message); }
    finally { button.disabled = false; button.textContent = 'Mở bàn trà & tạo liên kết mời'; }
  };
  $('#copy-reunion-link').onclick = () => copy($('#reunion-link-output').value);
  $('#share-reunion-link').onclick = () => shareReunion($('#reunion-link-output').value, lastReunionBox);
  $('#close-reunion-result').onclick = () => $('#reunion-result-dialog').close();
}

function makeReunionCup(seat) {
  const cup = document.createElement('img');
  cup.className = 'tea-cup';
  cup.src = seat ? 'assets/cup-filled.webp' : 'assets/cup-empty.webp';
  cup.alt = seat ? `Chén trà của ${seat.name}` : 'Chén trà đang chờ';
  return cup;
}

function renderReunionBox(box) {
  if (!box || !$('#reunion-content')) return;
  lastReunionBox = box;
  $('#reunion-loading').hidden = true; $('#reunion-error').hidden = true; $('#reunion-content').hidden = false;
  $('#reunion-table-title').textContent = box.title || 'Bàn trà đoàn viên';
  $('#reunion-owner-name').textContent = box.ownerName || 'Một người bạn';
  $('#reunion-invitation').textContent = box.message || '';
  $('#reunion-menu').textContent = `${box.flavor || 'Bánh Trung Thu'} · ${box.tea || 'Trà thơm'}`;

  const seats = Object.values(box.seats || {}).sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
  const capacity = Math.max(2, Number(box.capacity || 4)), count = seats.length, complete = count >= capacity;
  const scene = $('#tea-scene'); scene.classList.toggle('complete', complete); scene.dataset.style = box.style || 'tre';
  scene.dataset.capacityMode = capacity === 2 ? 'duo' : (capacity > 8 ? 'grand' : 'standard');
  $('#reunion-mooncake').src = capacity === 2 ? 'assets/mooncake-cut-2.webp' : 'assets/mooncake-cut-4.webp';
  const boxAssets = { tre: 'assets/box-bamboo.webp', 'son-mai': 'assets/box-lacquer.webp', 'bao-cap': 'assets/box-paper.webp' };
  $('#reunion-box-image').src = boxAssets[box.style] || boxAssets.tre;
  $('#reunion-progress-bar').style.width = Math.min(100, count / capacity * 100) + '%';

  if (capacity === 2) {
    $('#reunion-progress-text').textContent = complete
      ? '2/2 chỗ · Trăng tròn vẹn, hai người cùng thưởng trà'
      : '1/2 chỗ · Đang chờ người thương cùng nâng chén trà';
    $('#reunion-complete-message').textContent = 'Vầng trăng đã tròn, đôi bạn đã cùng nâng chén trà bên nhau.';
  } else {
    $('#reunion-progress-text').textContent = complete
      ? `${count}/${capacity} chỗ · Vòng tròn đoàn viên đã đầy`
      : `${count}/${capacity} chỗ · Còn ${capacity - count} phần bánh đang chờ`;
    $('#reunion-complete-message').textContent = 'Trăng đã tròn, bàn trà đã đủ — chúng mình đang ở bên nhau.';
  }
  $('#reunion-complete-message').hidden = !complete;

  const seatsEl = $('#reunion-seats'); seatsEl.replaceChildren();

  if (capacity === 2) {
    // 2 ghế đối xứng hai bên mâm trà
    const duoPositions = [{ left: 16, top: 50 }, { left: 84, top: 50 }];
    for (let i = 0; i < 2; i++) {
      const seat = seats[i];
      const el = document.createElement('div');
      el.className = 'reunion-seat mode-duo ' + (seat ? 'occupied' : 'empty') + (seat?.visitorId === state.visitorId ? ' mine' : '');
      el.style.left = duoPositions[i].left + '%';
      el.style.top = duoPositions[i].top + '%';
      const cup = makeReunionCup(seat), label = document.createElement('b');
      label.textContent = seat ? seat.name : (i === 0 ? (box.ownerName || 'Chủ bàn') : 'Chờ người thương…');
      el.append(cup, label);
      seatsEl.append(el);
    }
  } else if (capacity <= 8) {
    // 1 vòng tròn tiêu chuẩn
    for (let i = 0; i < capacity; i++) {
      const seat = seats[i], angle = -90 + i * (360 / capacity), rad = angle * Math.PI / 180;
      const el = document.createElement('div');
      el.className = 'reunion-seat ' + (seat ? 'occupied' : 'empty') + (seat?.visitorId === state.visitorId ? ' mine' : '');
      el.style.left = (50 + Math.cos(rad) * 44) + '%';
      el.style.top = (50 + Math.sin(rad) * 44) + '%';
      const cup = makeReunionCup(seat), label = document.createElement('b');
      label.textContent = seat ? seat.name : `Phần ${i + 1}`;
      el.append(cup, label);
      seatsEl.append(el);
    }
  } else {
    // Bàn tiệc lớn (>8 chỗ): 2 vòng đồng tâm so le
    const innerCount = Math.floor(capacity / 2);
    const outerCount = capacity - innerCount;
    const cupScale = capacity > 16 ? 'cup-compact' : 'cup-medium';

    for (let i = 0; i < capacity; i++) {
      const isInner = i < innerCount;
      const ringIndex = isInner ? i : (i - innerCount);
      const ringTotal = isInner ? innerCount : outerCount;
      const offsetDeg = isInner ? -90 : (-90 + (180 / ringTotal));
      const angle = offsetDeg + ringIndex * (360 / ringTotal);
      const rad = angle * Math.PI / 180;
      const radiusPct = isInner ? 33 : 48;

      const seat = seats[i];
      const el = document.createElement('div');
      el.className = `reunion-seat mode-grand ${cupScale} ` + (seat ? 'occupied' : 'empty') + (seat?.visitorId === state.visitorId ? ' mine' : '');
      el.style.left = (50 + Math.cos(rad) * radiusPct) + '%';
      el.style.top = (50 + Math.sin(rad) * radiusPct) + '%';
      const cup = makeReunionCup(seat), label = document.createElement('b');
      label.textContent = seat ? seat.name : `Phần ${i + 1}`;
      el.append(cup, label);
      seatsEl.append(el);
    }
  }

  const replies = $('#reunion-reply-list'); replies.replaceChildren();
  seats.forEach(seat => {
    const card = document.createElement('article'); card.className = 'reunion-reply-card';
    const mark = document.createElement('span'), body = document.createElement('div'), name = document.createElement('b'), p = document.createElement('p');
    mark.textContent = seat.role === 'owner' ? '☾' : '茶';
    name.textContent = seat.name + (seat.role === 'owner' ? ' · Chủ bàn' : '');
    p.textContent = seat.reply;
    body.append(name, p); card.append(mark, body); replies.append(card);
  });

  const mine = (box.seats || {})[state.visitorId], form = $('#reunion-join-form'), full = $('#reunion-full');
  form.hidden = complete && !mine; full.hidden = !complete || Boolean(mine);
  if (mine) {
    $('#reunion-guest-name').value = mine.name || state.name || ''; $('#reunion-reply').value = mine.reply || '';
    $('#reunion-join-title').textContent = 'Sửa lời đáp của bạn'; $('#reunion-join-button').textContent = 'Cập nhật chén trà của mình';
  } else if (!complete) { $('#reunion-guest-name').value = state.name || ''; }
}

async function initReunionPage() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { $('#reunion-loading').hidden = true; $('#reunion-error').hidden = false; return; }
  try {
    const result = await getReunionBox(id); if (!result?.box) throw new Error('not-found');
    renderReunionBox(result.box);
    if (reunionPollingTimer) clearInterval(reunionPollingTimer);
    reunionPollingTimer = setInterval(async () => {
      if (document.hidden) return;
      const latest = await getReunionBox(id);
      if (latest?.box) renderReunionBox(latest.box);
    }, 10000);
    $('#reunion-join-form').onsubmit = async e => {
      e.preventDefault(); const btn = $('#reunion-join-button'); btn.disabled = true;
      try {
        const box = await saveReunionSeat(id, $('#reunion-guest-name').value, $('#reunion-reply').value);
        state.name = safeText($('#reunion-guest-name').value, 40); save(); renderReunionBox(box);
        toast('Phần bánh của bạn đã được đặt bên bàn trà.');
      } catch (err) { toast(err.message); } finally { btn.disabled = false; }
    };
    $('#copy-current-reunion').onclick = () => copy(location.href);
    $('#share-current-reunion').onclick = () => shareReunion(location.href, lastReunionBox);
  } catch { $('#reunion-loading').hidden = true; $('#reunion-error').hidden = false; }
}

async function renderReunionShelf() {
  const shelf = $('#reunion-shelf'); if (!shelf) return;
  let entries = [];
  try {
    const response = await fetch(`${FIREBASE_DB_URL}/reunion_members/${state.visitorId}.json`);
    const data = response.ok ? await response.json() : null;
    entries = data ? Object.entries(data).map(([id, value]) => ({ id, ...value })).sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0)) : [];
  } catch {}
  if (!entries.length) { shelf.innerHTML = '<p class="empty-shelf">Bạn chưa mở hoặc tham gia bàn trà nào.</p>'; return; }
  shelf.innerHTML = '<p class="empty-shelf">Đang gọi những bàn trà của bạn…</p>';
  const results = await Promise.all(entries.slice(0, 12).map(async item => ({ item, result: await getReunionBox(item.id) })));
  shelf.replaceChildren();
  results.filter(x => x.result?.box).forEach(({ item, result }) => {
    const box = result.box, count = Object.keys(box.seats || {}).length;
    const card = document.createElement('a'); card.className = 'reunion-shelf-card'; card.href = `reunion.html?id=${box.id}`;
    const icon = document.createElement('span'), body = document.createElement('div'), title = document.createElement('b'), meta = document.createElement('small'), arrow = document.createElement('em');
    icon.textContent = item.role === 'owner' ? '☾' : '茶'; title.textContent = box.title; meta.textContent = `${item.role === 'owner' ? 'Bàn bạn mở' : 'Bàn bạn tham gia'} · ${count}/${box.capacity} chỗ`; arrow.textContent = '→';
    body.append(title, meta); card.append(icon, body, arrow); shelf.append(card);
  });
  if (!shelf.children.length) shelf.innerHTML = '<p class="empty-shelf">Chưa tìm thấy bàn trà nào còn hoạt động.</p>';
}

/* =========================================================
   FEAST & PHÁ CỖ LOGIC (Góp cỗ trông trăng & Phá cỗ bí mật)
   ========================================================= */
const FEAST_ITEM_MAP = {
  'cho-buoi': { name: 'Chú chó bưởi lông xù', asset: 'assets/item-cho-buoi.webp', desc: 'Linh hồn mâm cỗ Trung Thu Việt' },
  'den-ong-sao': { name: 'Đèn ông sao ngũ sắc', asset: 'assets/item-den-ong-sao.webp', desc: 'Thắp sáng tuổi thơ rực rỡ' },
  'nai-chuoi': { name: 'Nải chuối tiêu trứng cuốc', asset: 'assets/item-nai-chuoi.webp', desc: 'Nâng đỡ mâm ngũ quả sum vầy' },
  'com-sen': { name: 'Gói cốm non bọc lá sen', asset: 'assets/item-com-vong.webp', desc: 'Hương thơm thanh tao mùa thu' },
  'banh-nuong': { name: 'Cặp bánh nướng ngũ phúc', asset: 'assets/mooncake-full.webp', desc: 'Vị đậm đà gắn kết tình thân' },
  'banh-deo': { name: 'Cặp bánh dẻo hoa bưởi', asset: 'assets/mooncake-cut-4.webp', desc: 'Trắng mịn thanh khiết an yên' },
  'hong-na': { name: 'Đĩa quả hồng đỏ và na', asset: 'assets/item-hong-na.webp', desc: 'Sắc đỏ may mắn và ngọt ngào' },
  'qua-thi': { name: 'Đĩa thị chín thơm lừng', asset: 'assets/item-hong-na.webp', desc: 'Hương thơm cổ tích dịu dàng' },
  'den-keo-quan': { name: 'Đèn kéo quân cổ truyền', asset: 'assets/lantern-keo-quan.webp', desc: 'Bóng hình kỷ niệm đêm trăng' }
};

function renderFeastArt(element, meta) {
  if (!element || !meta) return;
  element.replaceChildren();
  const image = document.createElement('img');
  image.src = meta.asset || 'assets/item-cho-buoi.webp';
  image.alt = meta.name;
  image.className = 'feast-item-badge-img';
  element.appendChild(image);
}

let feastPollingTimer = null;
let currentFeastBox = null;

async function rememberFeast(id, role = 'contributor') {
  if (!id || !state.visitorId) return;
  try {
    await fetch(`${FIREBASE_DB_URL}/feast_members/${state.visitorId}/${id}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role, touchedAt: Date.now() })
    });
  } catch {}
}

async function createFeastBox(data) {
  const now = new Date().toISOString();
  const id = 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const target = data.target === 'open' ? 'open' : (parseInt(data.target, 10) || 25);

  let deadlineIso = null;
  const deadlineVal = data.deadline;
  if (deadlineVal === '1h') {
    deadlineIso = new Date(Date.now() + 3600 * 1000).toISOString();
  } else if (deadlineVal === '2h') {
    deadlineIso = new Date(Date.now() + 7200 * 1000).toISOString();
  } else if (deadlineVal === 'tonight') {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= Date.now()) {
      d.setDate(d.getDate() + 1);
    }
    deadlineIso = d.toISOString();
  } else if (deadlineVal === '24h') {
    deadlineIso = new Date(Date.now() + 86400 * 1000).toISOString();
  }

  const box = {
    id,
    title: safeText(data.title, 60),
    ownerName: safeText(data.ownerName, 40),
    ownerId: state.visitorId,
    style: data.style || 'dong',
    targetCount: target,
    deadline: deadlineIso,
    message: safeText(data.message, 280),
    status: 'open',
    created: now,
    updated: now,
    items: {
      [state.visitorId]: {
        visitorId: state.visitorId,
        senderName: safeText(data.ownerName, 40),
        itemType: data.ownerItem || 'cho-buoi',
        secretWish: safeText(data.ownerWish, 200),
        joinedAt: now,
        isOwner: true,
        thanked: false
      }
    },
    picks: {}
  };

  if (!box.ownerName || !box.title || box.message.length < 10) {
    throw new Error('Vui lòng điền đủ tên, tên mâm cỗ và lời mở hội.');
  }

  const response = await fetch(`${FIREBASE_DB_URL}/feast_boxes/${id}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(box)
  });
  if (!response.ok) throw new Error('Chưa thể tạo mâm cỗ trên Firebase.');
  await rememberFeast(id, 'owner');
  return box;
}

async function getFeastBox(id, withEtag = false) {
  if (!id) return null;
  const response = await fetch(`${FIREBASE_DB_URL}/feast_boxes/${encodeURIComponent(id)}.json`, {
    headers: withEtag ? { 'X-Firebase-ETag': 'true' } : {}
  });
  if (!response.ok) return null;
  return { box: await response.json(), etag: response.headers.get('etag') };
}

async function saveFeastItem(feastId, name, itemType, secretWish) {
  name = safeText(name, 40);
  secretWish = safeText(secretWish, 220);
  if (!name || secretWish.length < 5) throw new Error('Vui lòng nhập tên và lời chúc bí mật (tối thiểu 5 ký tự).');

  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getFeastBox(feastId, true);
    if (!current?.box) throw new Error('Mâm cỗ không tồn tại.');
    const box = current.box;
    const items = box.items || {};
    const existing = items[state.visitorId];

    items[state.visitorId] = {
      visitorId: state.visitorId,
      senderName: name,
      itemType: itemType || 'cho-buoi',
      secretWish: secretWish,
      joinedAt: existing?.joinedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isOwner: state.visitorId === box.ownerId,
      thanked: existing?.thanked || false
    };

    box.items = items;
    box.updated = new Date().toISOString();

    const response = await fetch(`${FIREBASE_DB_URL}/feast_boxes/${encodeURIComponent(feastId)}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': current.etag || '*' },
      body: JSON.stringify(box)
    });
    if (response.ok) {
      await rememberFeast(feastId, state.visitorId === box.ownerId ? 'owner' : 'contributor');
      return box;
    }
    if (response.status !== 412) throw new Error('Chưa thể lưu món cỗ lên máy chủ.');
  }
  throw new Error('Nhiều người đang góp cỗ cùng lúc. Vui lòng thử lại.');
}

async function triggerFeastCelebration(feastId) {
  const current = await getFeastBox(feastId);
  if (!current?.box) return;
  const box = current.box;
  box.status = 'celebrating';
  box.celebratedAt = new Date().toISOString();
  box.updated = new Date().toISOString();
  await fetch(`${FIREBASE_DB_URL}/feast_boxes/${encodeURIComponent(feastId)}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(box)
  });
  return box;
}

async function drawFeastGift(feastId) {
  const current = await getFeastBox(feastId);
  if (!current?.box) throw new Error('Mâm cỗ không còn tồn tại.');
  const box = current.box;
  const picks = box.picks || {};

  if (picks[state.visitorId]) {
    const existingSenderId = picks[state.visitorId].senderId;
    const item = box.items?.[existingSenderId];
    return { item, senderId: existingSenderId, isNew: false };
  }

  const itemKeys = Object.keys(box.items || {});
  if (!itemKeys.length) throw new Error('Mâm cỗ chưa có món nào.');

  const pool = itemKeys.length > 1 ? itemKeys.filter(k => k !== state.visitorId) : itemKeys;
  const chosenKey = pool[Math.floor(Math.random() * pool.length)];
  const chosenItem = box.items[chosenKey];

  picks[state.visitorId] = {
    receiverId: state.visitorId,
    receiverName: state.name || 'Người bạn',
    senderId: chosenKey,
    pickedAt: new Date().toISOString()
  };

  box.picks = picks;
  box.updated = new Date().toISOString();

  await fetch(`${FIREBASE_DB_URL}/feast_boxes/${encodeURIComponent(feastId)}/picks/${state.visitorId}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(picks[state.visitorId])
  });

  return { item: chosenItem, senderId: chosenKey, isNew: true };
}

async function markFeastThanked(feastId, senderId) {
  try {
    await fetch(`${FIREBASE_DB_URL}/feast_boxes/${encodeURIComponent(feastId)}/items/${senderId}/thanked.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(true)
    });
  } catch {}
}

function initCreateFeastPage() {
  const form = $('#feast-create-form'); if (!form) return;
  const owner = $('#feast-owner'), title = $('#feast-title'), message = $('#feast-message');
  const ownerWish = $('#feast-owner-wish');
  if (!owner.value) owner.value = state.name || '';

  const syncPreview = () => {
    $('#feast-preview-title').textContent = title.value || 'Mâm cỗ Lớp 12A3';
    $('#feast-preview-message').textContent = message.value || 'Một mâm cỗ đầy đặn đang chờ từng người bạn chung tay vun vén.';
    const targetVal = $('input[name="feast-target"]:checked')?.value || '25';
    $('#feast-preview-target').textContent = targetVal === 'open' ? 'Mục tiêu: Mở rộng tự do' : `Mục tiêu: ${targetVal} món cỗ`;
    const styleVal = $('input[name="feast-style"]:checked')?.value || 'dong';
    const styleNames = { dong: 'Mâm đồng cổ truyền', tre: 'Mẹt tre lá chuối', 'son-mai': 'Khay gấm hoa sen' };
    $('#feast-preview-style').textContent = styleNames[styleVal] || 'Mâm cỗ truyền thống';
    const stage = $('#feast-preview-stage');
    if (stage) stage.dataset.style = styleVal;
  };

  [title, message, ownerWish].forEach(el => el && el.addEventListener('input', syncPreview));
  document.querySelectorAll('input[name="feast-target"], input[name="feast-style"]').forEach(el => el.addEventListener('change', syncPreview));

  syncPreview();

  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = 'Đang khởi tạo mâm cỗ…';
    try {
      const box = await createFeastBox({
        ownerName: owner.value,
        title: title.value,
        message: message.value,
        style: $('input[name="feast-style"]:checked')?.value,
        target: $('input[name="feast-target"]:checked')?.value,
        deadline: $('input[name="feast-deadline"]:checked')?.value || 'manual',
        ownerItem: $('#feast-owner-item')?.value,
        ownerWish: ownerWish.value
      });
      state.name = box.ownerName; save();
      const url = new URL('feast.html?id=' + box.id, location.href).href;
      $('#feast-link-output').value = url;
      $('#open-feast-link').href = url;
      $('#feast-result-dialog').showModal();
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; btn.textContent = 'Khởi tạo Mâm Cỗ & Lấy liên kết mời'; }
  };

  $('#copy-feast-link').onclick = () => copy($('#feast-link-output').value);
  $('#share-feast-link').onclick = () => {
    const url = $('#feast-link-output').value;
    const msg = `Mời bạn cùng vào góp cỗ trông trăng cho “${title.value || 'Mâm Cỗ Đoàn Viên'}”!`;
    if (navigator.share) navigator.share({ title: 'Góp Cỗ Trông Trăng', text: msg, url }).catch(() => {});
    else copy(msg + '\n' + url);
  };
  $('#close-feast-result').onclick = () => $('#feast-result-dialog').close();
}

let feastCountdownInterval = null;

function updateFeastCountdown(box) {
  const card = $('#feast-countdown-card');
  const clock = $('#feast-countdown-clock');
  const note = $('#feast-countdown-note');
  if (!card || !clock) return;

  if (!box.deadline || box.status === 'celebrating') {
    card.hidden = true;
    if (feastCountdownInterval) {
      clearInterval(feastCountdownInterval);
      feastCountdownInterval = null;
    }
    return;
  }

  card.hidden = false;

  const tick = async () => {
    const targetTime = new Date(box.deadline).getTime();
    const now = Date.now();
    const diff = targetTime - now;

    if (diff <= 0) {
      clock.textContent = '00:00:00';
      if (note) note.textContent = '✦ ĐÃ ĐẾN GIỜ HOÀNG ĐẠO PHÁ CỖ! ✦';
      if (feastCountdownInterval) {
        clearInterval(feastCountdownInterval);
        feastCountdownInterval = null;
      }
      if (box.status === 'open') {
        try {
          const updated = await triggerFeastCelebration(box.id);
          if (updated) renderFeastPage(updated);
        } catch {}
      }
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');

    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      clock.textContent = `${days} ngày ${pad(remHours)}:${pad(mins)}:${pad(secs)}`;
    } else {
      clock.textContent = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    }
  };

  tick();
  if (feastCountdownInterval) clearInterval(feastCountdownInterval);
  feastCountdownInterval = setInterval(tick, 1000);
}

function renderFeastPage(box) {
  if (!box || !$('#feast-content')) return;
  currentFeastBox = box;
  $('#feast-loading').hidden = true; $('#feast-error').hidden = true; $('#feast-content').hidden = false;

  updateFeastCountdown(box);

  const items = Object.values(box.items || {}).sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)));
  const count = items.length;
  const target = box.targetCount === 'open' ? 'open' : (parseInt(box.targetCount, 10) || 25);
  const isTargetOpen = target === 'open';
  const complete = isTargetOpen ? count >= 10 : count >= target;
  const isCelebrating = box.status === 'celebrating';

  // Status badge & texts
  $('#feast-table-title').textContent = box.title || 'Mâm Cỗ Đoàn Viên';
  $('#feast-owner-name').textContent = box.ownerName || 'Chủ xị';
  $('#feast-invitation-text').textContent = box.message || '';
  $('#feast-stage').dataset.style = box.style || 'dong';

  const badge = $('#feast-status-badge');
  if (isCelebrating) {
    badge.textContent = '✦ ĐÃ MỞ HỘI PHÁ CỖ ✦';
    badge.style.color = '#ffd700';
  } else {
    badge.textContent = `ĐẠI HỘI TRĂNG RẰM · ĐANG GÓP CỖ (${count}${isTargetOpen ? '' : '/' + target} MÓN)`;
    badge.style.color = '';
  }

  // Progress bar
  $('#feast-progress-stats').textContent = `Đã có ${count} người góp cỗ`;
  $('#feast-progress-target').textContent = isTargetOpen ? 'Mục tiêu: Tự do sum vầy' : `Mục tiêu: ${target} món`;
  const pct = isTargetOpen ? Math.min(100, count * 5) : Math.min(100, Math.round((count / target) * 100));
  $('#feast-progress-bar').style.width = pct + '%';
  $('#feast-progress-sub').textContent = isCelebrating
    ? 'Đại lễ phá cỗ đang diễn ra rộn rã! Hãy bốc quà may mắn của bạn.'
    : (complete ? 'Mâm cỗ đã đủ đầy! Chủ xị có thể bấm Mở Hội Phá Cỗ.' : `Cần thêm ${isTargetOpen ? 'nhiều' : Math.max(0, target - count)} món cỗ nữa để cùng nhau mở hội.`);

  // Action Buttons
  const myItem = (box.items || {})[state.visitorId];
  const myPick = (box.picks || {})[state.visitorId];
  const isOwner = state.visitorId === box.ownerId;

  const btnContribute = $('#btn-open-contribute');
  btnContribute.textContent = myItem ? 'Sửa món cỗ của bạn' : 'Góp một món vào mâm';

  const btnCelebrate = $('#btn-start-celebrate');
  btnCelebrate.hidden = isCelebrating || (!isOwner && !complete);

  const btnPick = $('#btn-pick-gift');
  btnPick.hidden = !isCelebrating;
  if (btnPick && !btnPick.hidden) {
    btnPick.textContent = myPick ? 'Xem Lại Quà Bạn Đã Bốc' : 'Hái Lộc Phá Cỗ (Bốc Quà May Mắn)';
  }

  $('#feast-celebration-banner').hidden = !isCelebrating;

  // Render Platter Items (supports up to 100+ items!)
  const container = $('#feast-items-container');
  container.replaceChildren();

  // Multi-tier radial distribution algorithm
  let rings = [];
  if (count <= 10) {
    rings = [{ count: count, radius: 38 }];
  } else if (count <= 25) {
    const inner = Math.floor(count * 0.4);
    rings = [{ count: inner, radius: 26 }, { count: count - inner, radius: 42 }];
  } else if (count <= 60) {
    const r1 = Math.floor(count * 0.22);
    const r2 = Math.floor(count * 0.38);
    rings = [{ count: r1, radius: 21 }, { count: r2, radius: 33 }, { count: count - r1 - r2, radius: 44 }];
  } else {
    const r1 = Math.floor(count * 0.15);
    const r2 = Math.floor(count * 0.25);
    const r3 = Math.floor(count * 0.3);
    rings = [
      { count: r1, radius: 19 },
      { count: r2, radius: 28 },
      { count: r3, radius: 37 },
      { count: count - r1 - r2 - r3, radius: 46 }
    ];
  }

  let itemIdx = 0;
  rings.forEach((ring, ringIdx) => {
    const ringItemsCount = ring.count;
    const radiusPct = ring.radius;
    const offset = -90 + (ringIdx * 17);

    for (let i = 0; i < ringItemsCount; i++) {
      if (itemIdx >= count) break;
      const item = items[itemIdx];
      const angle = offset + (i * (360 / ringItemsCount));
      const rad = angle * Math.PI / 180;
      const leftPct = 50 + Math.cos(rad) * radiusPct;
      const topPct = 50 + Math.sin(rad) * radiusPct;

      const node = document.createElement('div');
      node.className = 'feast-item-node' + (item.visitorId === state.visitorId ? ' mine' : '') + (!isCelebrating ? ' sealed' : '');
      node.id = `item-node-${item.visitorId}`;
      node.style.left = leftPct + '%';
      node.style.top = topPct + '%';

      const meta = FEAST_ITEM_MAP[item.itemType] || FEAST_ITEM_MAP['cho-buoi'];
      const badge = document.createElement('span');
      badge.className = 'item-badge';
      renderFeastArt(badge, meta);
      badge.title = `${item.senderName}: ${meta.name}`;

      const tag = document.createElement('span');
      tag.className = 'item-tag' + (item.visitorId === state.visitorId ? ' mine-tag' : '');
      tag.textContent = item.visitorId === state.visitorId ? '☾ Bạn' : item.senderName;

      node.append(badge, tag);
      node.onclick = () => openItemInspect(item, isCelebrating, myPick);
      container.appendChild(node);

      itemIdx++;
    }
  });

  // Render Contributor Wall
  renderFeastWall(items, myPick, isCelebrating);
}

function openItemInspect(item, isCelebrating, myPick) {
  const dialog = $('#item-inspect-dialog'); if (!dialog) return;
  const meta = FEAST_ITEM_MAP[item.itemType] || FEAST_ITEM_MAP['cho-buoi'];

  $('#inspect-item-title').textContent = meta.name;
  renderFeastArt($('#inspect-avatar'), meta);
  $('#inspect-sender-name').textContent = item.senderName + (item.isOwner ? ' · Chủ xị mâm cỗ' : '');
  $('#inspect-time').textContent = `Góp vào: ${new Date(item.joinedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;

  const isMine = item.visitorId === state.visitorId;
  const isPickedByMe = myPick && myPick.senderId === item.visitorId;
  const canReadWish = isMine || isPickedByMe;

  const sealedBox = $('#inspect-sealed-box');
  const unsealedBox = $('#inspect-unsealed-box');

  if (canReadWish) {
    sealedBox.hidden = true;
    unsealedBox.hidden = false;
    $('#inspect-secret-content').textContent = item.secretWish;
    const thankRow = $('#inspect-thank-row');
    const thankedNote = $('#inspect-thanked-note');
    thankRow.hidden = isMine || item.thanked;
    thankedNote.hidden = !item.thanked;

    $('#btn-thank-sender').onclick = async () => {
      if (!currentFeastBox) return;
      await markFeastThanked(currentFeastBox.id, item.visitorId);
      item.thanked = true;
      thankRow.hidden = true;
      thankedNote.hidden = false;
      toast(`Đã gửi lời cảm ơn ấm lòng đến ${item.senderName}!`);
    };
  } else {
    sealedBox.hidden = false;
    unsealedBox.hidden = true;
  }

  dialog.showModal();
}

function renderFeastWall(items, myPick, isCelebrating) {
  const list = $('#feast-contributors-list'); if (!list) return;
  const searchInput = $('#feast-search-input');
  const query = (searchInput?.value || '').toLowerCase().trim();

  const filtered = items.filter(item => {
    if (!query) return true;
    const meta = FEAST_ITEM_MAP[item.itemType] || FEAST_ITEM_MAP['cho-buoi'];
    return item.senderName.toLowerCase().includes(query) || meta.name.toLowerCase().includes(query);
  });

  $('#feast-wall-count').textContent = `${items.length} người đã góp cỗ`;
  list.replaceChildren();

  if (!filtered.length) {
    list.innerHTML = '<p class="empty-shelf">Không tìm thấy người bạn nào phù hợp.</p>';
    return;
  }

  filtered.forEach(item => {
    const meta = FEAST_ITEM_MAP[item.itemType] || FEAST_ITEM_MAP['cho-buoi'];
    const card = document.createElement('div');
    card.className = 'feast-contributor-card';

    const avatar = document.createElement('span');
    avatar.className = 'feast-contributor-avatar';
    renderFeastArt(avatar, meta);

    const metaBox = document.createElement('div');
    metaBox.className = 'feast-contributor-meta';
    const nameB = document.createElement('b');
    nameB.textContent = item.senderName + (item.isOwner ? ' · Chủ xị' : '');
    const itemS = document.createElement('small');
    itemS.textContent = meta.name;
    metaBox.append(nameB, itemS);

    const badge = document.createElement('span');
    badge.className = 'feast-contributor-badge';
    if (myPick && myPick.senderId === item.visitorId) {
      badge.className += ' unsealed';
      badge.textContent = 'Bạn đã bốc';
    } else if (item.visitorId === state.visitorId) {
      badge.textContent = 'Món của bạn';
    } else {
      badge.textContent = isCelebrating ? 'Đã lên mâm' : 'Niêm phong';
    }

    card.append(avatar, metaBox, badge);
    card.onclick = () => {
      // Highlight on the platter
      const targetNode = document.getElementById(`item-node-${item.visitorId}`);
      if (targetNode) {
        document.querySelectorAll('.feast-item-node').forEach(el => el.classList.remove('highlighted'));
        targetNode.classList.add('highlighted');
        targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => targetNode.classList.remove('highlighted'), 3200);
      }
    };
    list.appendChild(card);
  });
}

async function initFeastPage() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { $('#feast-loading').hidden = true; $('#feast-error').hidden = false; return; }

  try {
    const result = await getFeastBox(id);
    if (!result?.box) throw new Error('not-found');
    renderFeastPage(result.box);

    if (feastPollingTimer) clearInterval(feastPollingTimer);
    feastPollingTimer = setInterval(async () => {
      if (document.hidden) return;
      const latest = await getFeastBox(id);
      if (latest?.box) renderFeastPage(latest.box);
    }, 10000);

    // Search filter input
    $('#feast-search-input')?.addEventListener('input', () => {
      if (currentFeastBox) {
        const items = Object.values(currentFeastBox.items || {});
        renderFeastWall(items, currentFeastBox.picks?.[state.visitorId], currentFeastBox.status === 'celebrating');
      }
    });

    // Contribute dialog open
    $('#btn-open-contribute').onclick = () => {
      const dialog = $('#contribute-dialog');
      const myItem = currentFeastBox?.items?.[state.visitorId];
      if (myItem) {
        $('#contribute-name').value = myItem.senderName || state.name || '';
        $('#contribute-item-type').value = myItem.itemType || 'cho-buoi';
        $('#contribute-secret-wish').value = myItem.secretWish || '';
        $('#contribute-dialog-title').textContent = 'Sửa món cỗ của bạn';
        $('#btn-submit-contribute').textContent = 'Cập nhật món cỗ';
      } else {
        $('#contribute-name').value = state.name || '';
        $('#contribute-dialog-title').textContent = 'Góp một món vào mâm cỗ';
        $('#btn-submit-contribute').textContent = 'Đặt món cỗ lên mâm';
      }
      dialog.showModal();
    };
    $('#close-contribute-dialog').onclick = () => $('#contribute-dialog').close();

    // Contribute submit
    $('#contribute-form').onsubmit = async e => {
      e.preventDefault();
      const btn = $('#btn-submit-contribute');
      btn.disabled = true;
      try {
        const name = $('#contribute-name').value;
        const itemType = $('#contribute-item-type').value;
        const secretWish = $('#contribute-secret-wish').value;
        const updatedBox = await saveFeastItem(id, name, itemType, secretWish);
        state.name = safeText(name, 40);
        save();
        renderFeastPage(updatedBox);
        $('#contribute-dialog').close();
        toast('Món cỗ của bạn đã được đặt trang trọng lên mâm!');
      } catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    };

    // Close inspect dialog
    $('#close-inspect-dialog').onclick = () => $('#item-inspect-dialog').close();

    // Start celebration (Host action)
    $('#btn-start-celebrate').onclick = async () => {
      if (!confirm('Bạn có chắc chắn muốn MỞ HỘI PHÁ CỖ cho cả nhóm ngay bây giờ?')) return;
      try {
        const updated = await triggerFeastCelebration(id);
        renderFeastPage(updated);
        toast('Màn mở hội phá cỗ đã bắt đầu! Tiếng trống tùng rinh vang dội!');
      } catch (err) { toast(err.message); }
    };

    // Pick gift (Lucky Draw)
    $('#btn-pick-gift').onclick = async () => {
      const btn = $('#btn-pick-gift');
      btn.disabled = true;
      try {
        const drawResult = await drawFeastGift(id);
        const item = drawResult.item;
        const meta = FEAST_ITEM_MAP[item.itemType] || FEAST_ITEM_MAP['cho-buoi'];

        renderFeastArt($('#lucky-gift-icon'), meta);
        $('#lucky-item-name').textContent = meta.name;
        $('#lucky-sender-name').textContent = item.senderName;
        $('#lucky-secret-wish').textContent = item.secretWish;
        $('#lucky-signer').textContent = `— ${item.senderName} gửi gắm đêm trăng`;

        const thankBtn = $('#btn-lucky-thank');
        thankBtn.hidden = item.visitorId === state.visitorId || item.thanked;
        thankBtn.onclick = async () => {
          await markFeastThanked(id, item.visitorId);
          thankBtn.hidden = true;
          toast(`Đã gửi lời cảm ơn chân thành đến ${item.senderName}!`);
        };

        $('#btn-save-lucky-card').onclick = () => {
          toast('Món quà may mắn đã được lưu giữ trong Trang của bạn!');
          $('#lucky-draw-dialog').close();
        };

        $('#lucky-draw-dialog').showModal();
        // Re-render feast
        const latest = await getFeastBox(id);
        if (latest?.box) renderFeastPage(latest.box);
      } catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    };
    $('#close-lucky-dialog').onclick = () => $('#lucky-draw-dialog').close();

    // Share link button
    $('#btn-share-feast').onclick = () => {
      const url = location.href;
      const msg = `Mời bạn cùng vào góp cỗ trông trăng cho “${currentFeastBox?.title || 'Mâm Cỗ Đoàn Viên'}”!`;
      if (navigator.share) navigator.share({ title: 'Góp Cỗ Trông Trăng', text: msg, url }).catch(() => {});
      else copy(msg + '\n' + url);
    };

  } catch {
    $('#feast-loading').hidden = true;
    $('#feast-error').hidden = false;
  }
}

async function renderFeastShelf() {
  const shelf = $('#feast-shelf'); if (!shelf) return;
  let entries = [];
  try {
    const response = await fetch(`${FIREBASE_DB_URL}/feast_members/${state.visitorId}.json`);
    const data = response.ok ? await response.json() : null;
    entries = data ? Object.entries(data).map(([id, value]) => ({ id, ...value })).sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0)) : [];
  } catch {}
  if (!entries.length) {
    shelf.innerHTML = '<p class="empty-shelf">Bạn chưa khởi tạo hoặc tham gia mâm cỗ nào.</p>';
    return;
  }
  shelf.innerHTML = '<p class="empty-shelf">Đang tải những mâm cỗ bạn đã tham gia…</p>';
  const results = await Promise.all(entries.slice(0, 10).map(async item => ({ item, result: await getFeastBox(item.id) })));
  shelf.replaceChildren();
  results.filter(x => x.result?.box).forEach(({ item, result }) => {
    const box = result.box, count = Object.keys(box.items || {}).length;
    const card = document.createElement('a');
    card.className = 'reunion-shelf-card';
    card.href = `feast.html?id=${box.id}`;
    const icon = document.createElement('span'), body = document.createElement('div'), title = document.createElement('b'), meta = document.createElement('small'), arrow = document.createElement('em');
    icon.className = 'shelf-card-icon';
    icon.innerHTML = `<img src="assets/lantern-keo-quan.webp" alt="" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;">`;
    title.textContent = box.title;
    meta.textContent = `${item.role === 'owner' ? 'Mâm cỗ bạn tạo' : 'Mâm cỗ bạn góp'} · ${count} món · ${box.status === 'celebrating' ? 'Đang mở hội' : 'Đang góp'}`;
    arrow.textContent = '→';
    body.append(title, meta);
    card.append(icon, body, arrow);
    shelf.append(card);
  });
  if (!shelf.children.length) shelf.innerHTML = '<p class="empty-shelf">Chưa tìm thấy mâm cỗ nào còn hoạt động.</p>';
}

function initPage() {
  const page = document.body.dataset.page || 'home';
  updateActiveNav(page);
  bindPageEvents();
  render();

  if (page === 'create-card') {
    initCreateCardPage();
  } else if (page === 'card') {
    initCardPage();
  } else if (page === 'create-reunion') {
    initCreateReunionPage();
  } else if (page === 'reunion') {
    initReunionPage();
  } else if (page === 'create-feast') {
    initCreateFeastPage();
  } else if (page === 'feast') {
    initFeastPage();
  } else if (page === 'profile') {
    renderReunionShelf();
    renderFeastShelf();
  }

  if (page !== 'reunion' && reunionPollingTimer) { clearInterval(reunionPollingTimer); reunionPollingTimer = null; }
  if (page !== 'feast' && feastPollingTimer) { clearInterval(feastPollingTimer); feastPollingTimer = null; }

  if (!state.name && page !== 'card' && page !== 'reunion' && page !== 'feast') {
    const welcome = $('#welcome');
    if (welcome && !welcome.open) welcome.showModal();
  }
}

// Initial Boot & Smart Disconnect on Tab Sleep
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('paused-motion', document.hidden);
  if (!document.hidden) {
    syncRemoteWishes();
    const id = new URLSearchParams(location.search).get('id');
    const page = document.body.dataset.page;
    if (page === 'feast' && id) {
      getFeastBox(id).then(res => { if (res?.box) renderFeastPage(res.box); });
    } else if (page === 'reunion' && id) {
      getReunionBox(id).then(res => { if (res?.box) renderReunionBox(res.box); });
    }
  }
});

function initAutoMusic() {
  updateMusicUI();
  if (musicOn) {
    startMusic(false);
    const unlockAudio = () => {
      if (musicOn && (!audioCtx || audioCtx.state !== 'running')) {
        startMusic(true);
      }
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('click', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    window.addEventListener('click', unlockAudio, { once: true });
  }
}

initAtmosphere();
initPage();
initAutoMusic();
initLiveSync();
save();
handleQueryParams(new URLSearchParams(location.search));


