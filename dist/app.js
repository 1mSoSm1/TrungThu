const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const KEY = 'moonwish-v1';
const FIREBASE_DB_URL = 'https://trung-thu-1dc8f-default-rtdb.asia-southeast1.firebasedatabase.app';

let state = {
  visitorId: '',
  name: '',
  created: new Date().toISOString(),
  claim: null,
  wishes: [],
  visits: 0
};

try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && typeof saved === 'object') {
    state = { ...state, ...saved };
  }
} catch {}

if (!state.visitorId) {
  state.visitorId = 'user_' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
}

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
      name: state.name,
      created: state.created,
      visits: state.visits
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
    claimReady = fetch(`${FIREBASE_DB_URL}/claims/${state.visitorId}.json`)
      .then(res => res.ok ? res.json() : null)
      .then(claim => {
        if (claim && claim.content) {
          state.claim = claim;
          render();
        }
      })
      .catch(() => {});

    fetch(`${FIREBASE_DB_URL}/wishes.json`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          handleRemoteWishes(data);
        }
      })
      .catch(() => {});

    if (window.EventSource) {
      const source = new EventSource(`${FIREBASE_DB_URL}/wishes.json`);
      source.addEventListener('put', e => {
        try {
          const parsed = JSON.parse(e.data);
          if (parsed.path === '/' && parsed.data) {
            handleRemoteWishes(parsed.data);
          } else if (parsed.path && parsed.path.startsWith('/')) {
            const key = parsed.path.replace('/', '');
            if (key) {
              if (parsed.data) {
                const idx = communityWishes.findIndex(w => w.id === key);
                const item = { ...parsed.data, id: key };
                if (idx >= 0) communityWishes[idx] = item;
                else communityWishes.unshift(item);
              } else {
                communityWishes = communityWishes.filter(w => w.id !== key);
              }
              render();
            }
          }
        } catch {}
      });
    }
  } catch (err) {
    console.warn('Live sync fallback:', err);
  }
}

function handleRemoteWishes(data) {
  communityWishes = Object.entries(data)
    .filter(([_, val]) => val && val.content)
    .map(([id, val]) => ({ ...val, id }))
    .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

  const myRemoteWish = communityWishes.find(w => w.id === state.visitorId);
  if (myRemoteWish) {
    state.wishes = [myRemoteWish];
    save();
  }
  render();
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

  const profileWish = $('#profile-wish');
  if (profileWish) {
    profileWish.textContent = state.claim ? state.claim.content : 'Món quà vẫn đang chờ bạn.';
  }

  const profileSent = $('#profile-sent');
  if (profileSent) {
    profileSent.textContent = state.wishes.length
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
    // 100% Real wishes from Firebase community (or user's own)
    const visible = communityWishes.filter(w => w.public && w.content);
    wishList.replaceChildren();

    if (visible.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'empty-notice';
      emptyNotice.style.cssText = 'text-align:center;padding:45px 20px;grid-column:1/-1;color:#bca992;';
      emptyNotice.innerHTML = `
        <p style="font-size:15px;margin-bottom:14px;">Chưa có lời chúc nào trong Hòm thư.</p>
        <a href="write.html" class="gold" style="font-size:13px;padding:10px 20px;display:inline-block;">Hãy là người đầu tiên gửi lời chúc</a>
      `;
      wishList.append(emptyNotice);
    } else {
      visible.slice(0, expanded ? visible.length : 6).forEach(w => {
        const card = document.createElement('article');
        card.className = 'wish-card';
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.textContent = displayName(w).charAt(0);
        const body = document.createElement('div'),
          name = document.createElement('b'),
          p = document.createElement('p'),
          meta = document.createElement('small');
        name.textContent = displayName(w);
        p.textContent = w.content;
        const isMe = w.id === state.visitorId;
        meta.textContent = isMe ? 'Bạn gửi · ' + new Date(w.created).toLocaleString('vi-VN') : 'Gửi từ ' + displayName(w);
        body.append(name, p, meta);
        card.append(avatar, body);
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
  // Khóa 1 lần duy nhất: Nếu đã mở quà rồi thì chỉ hiển thị lại, KHÔNG cho bốc lại!
  if (state.claim) {
    showWish(state.claim, true);
    return { content: state.claim.content };
  }

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
      created: new Date().toISOString()
    };
    const claimPath = `${FIREBASE_DB_URL}/claims/${state.visitorId}.json`;
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
  $$('nav a').forEach(a => {
    const href = a.getAttribute('href');
    const targetPage = href === 'index.html' ? 'home' : href.replace('.html', '');
    a.classList.toggle('active', targetPage === page);
  });
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
let reunionStream = null;

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

    // Cập nhật các chén trà nhỏ trong preview
    const miniTable = document.querySelector('.mini-tea-table');
    if (miniTable) {
      miniTable.querySelectorAll('i').forEach(el => el.remove());
      const previewCups = Math.min(cap, 12);
      for (let i = 0; i < previewCups; i++) {
        const iEl = document.createElement('i');
        if (cap === 2) {
          iEl.style.left = (i === 0 ? '24px' : '246px');
          iEl.style.top = '135px';
        } else {
          const rad = (-90 + i * (360 / previewCups)) * Math.PI / 180;
          iEl.style.left = (135 + Math.cos(rad) * 105) + 'px';
          iEl.style.top = (135 + Math.sin(rad) * 105) + 'px';
        }
        miniTable.appendChild(iEl);
      }
    }
  };

  [title, message, $('#reunion-flavor'), $('#reunion-tea')].forEach(el => el.addEventListener('input', syncPreview));
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

  if (capacity === 2) {
    $('#reunion-mooncake').style.setProperty('--segment', '180deg');
  } else if (capacity <= 8) {
    $('#reunion-mooncake').style.setProperty('--segment', (360 / capacity) + 'deg');
  } else {
    $('#reunion-mooncake').style.setProperty('--segment', '45deg');
  }
  $('#reunion-mooncake').style.setProperty('--filled', Math.min(360, (count / capacity * 360)) + 'deg');
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
      const cup = document.createElement('span'), label = document.createElement('b');
      cup.className = 'tea-cup';
      cup.textContent = seat ? '♨' : '○';
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
      const cup = document.createElement('span'), label = document.createElement('b');
      cup.className = 'tea-cup';
      cup.textContent = seat ? '♨' : '○';
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
      const cup = document.createElement('span'), label = document.createElement('b');
      cup.className = 'tea-cup';
      cup.textContent = seat ? '♨' : '○';
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
    if (reunionStream) reunionStream.close();
    if (window.EventSource) {
      reunionStream = new EventSource(`${FIREBASE_DB_URL}/reunion_boxes/${encodeURIComponent(id)}.json`);
      const refresh = async () => { const latest = await getReunionBox(id); if (latest?.box) renderReunionBox(latest.box); };
      reunionStream.addEventListener('put', refresh); reunionStream.addEventListener('patch', refresh);
    }
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
  } else if (page === 'profile') {
    renderReunionShelf();
  }

  if (page !== 'reunion' && reunionStream) { reunionStream.close(); reunionStream = null; }

  if (!state.name && page !== 'card' && page !== 'reunion') {
    const welcome = $('#welcome');
    if (welcome && !welcome.open) welcome.showModal();
  }
}

// Initial Boot
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('paused-motion', document.hidden);
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


