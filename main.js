import { app, LOGIN_DOMAIN } from "./firebase-config.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, collection, onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
/* Not: Dosya yükleme (Firebase Storage) bilinçli olarak kullanılmıyor —
   Storage artık ücretli "Blaze" planı gerektiriyor. Evrak takibi şimdilik
   yalnızca "Teslim Alındı" işaretiyle yapılıyor; ileride istenirse Storage
   eklenip bu davranış genişletilebilir. */

const auth = getAuth(app);
const db = getFirestore(app);
const el = (sel) => document.querySelector(sel);
const root = () => document.getElementById("app");

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => (t.style.display = "none"), 2800);
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------------------------------------------------------------
// Standart işe giriş evrak listesi (v1: herkes için tek liste)
// ---------------------------------------------------------------
const STANDART_EVRAK_LISTESI = [
  "Nüfus Cüzdanı Fotokopisi",
  "Diploma / Öğrenim Belgesi Fotokopisi",
  "İkametgah Belgesi (E-Devlet)",
  "Adli Sicil Kaydı (E-Devlet)",
  "İşe Giriş Sağlık Raporu",
  "SGK Hizmet Dökümü (4A)",
  "Banka IBAN Bilgisi",
  "Vesikalık Fotoğraf (2 Adet)",
  "Askerlik Durum Belgesi",
  "Sürücü Belgesi Fotokopisi (Gerekiyorsa)"
];

const DURUM_ETIKET = {
  evrak_bekliyor: { label: "Evrak Bekliyor", cls: "st-evrak" },
  sgk_bekliyor: { label: "SGK Bekliyor", cls: "st-sgk" },
  ise_basladi: { label: "İşe Başladı", cls: "st-basladi" },
  tamamlandi: { label: "Tamamlandı", cls: "st-tamam" },
  vazgecti: { label: "Vazgeçildi", cls: "st-vazgecti" }
};

const AVATAR_COLORS = ["#117a63", "#8a5a2b", "#3d5a80", "#7c5cbf", "#a13030", "#4a5568"];
function avatarHtml(name, size) {
  size = size || 36;
  const n = (name || "?").trim();
  const initials = n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toLocaleUpperCase("tr") || "?";
  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:${color}">${initials}</span>`;
}
function fmtTarih(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
}
function bugunISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function yarinISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function evrakOrani(aday) {
  const list = aday.evraklar || [];
  if (!list.length) return 0;
  return Math.round((list.filter((e) => e.teslimAlindi).length / list.length) * 100);
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let currentUid = null;
let currentProfile = null;
let adaylar = [];
let unsubAday = null;

onAuthStateChanged(auth, async (user) => {
  if (unsubAday) unsubAday();
  if (!user) {
    currentUid = null;
    currentProfile = null;
    renderLogin();
    return;
  }
  currentUid = user.uid;
  try {
    const snap = await getDoc(doc(db, "managers", user.uid));
    if (!snap.exists()) {
      renderLogin("Bu hesap sisteme tanımlı değil. Lütfen İK ile iletişime geçin.");
      await signOut(auth);
      return;
    }
    currentProfile = snap.data();
    subscribeAdaylar();
  } catch (e) {
    console.error(e);
    renderLogin("Giriş sırasında bir hata oluştu: " + e.message);
  }
});

function subscribeAdaylar() {
  unsubAday = onSnapshot(collection(db, "iseAlimAday"), (qs) => {
    adaylar = [];
    qs.forEach((d) => adaylar.push({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error(err);
    root().innerHTML = `<div class="center-screen"><div class="login-card"><h1>Veri okunamadı</h1><p class="hint">${esc(err.message)}</p></div></div>`;
  });
}

// ---------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------
function renderLogin(errMsg) {
  root().innerHTML = `
  <div class="center-screen">
    <div class="login-card">
      <div class="login-brand">
        <div class="mark">İA</div>
        <div>
          <div class="name">İşe Alım Süreci</div>
          <div class="sub">İnciroğlu Otomotiv · İnsan Kaynakları</div>
        </div>
      </div>
      <h1>Giriş Yap</h1>
      <p class="hint">Yetenek Havuzu ile aynı kullanıcı adı ve şifreyle giriş yapabilirsiniz.</p>
      <div class="error-box" id="loginErr" style="${errMsg ? "display:block" : ""}">${errMsg || ""}</div>
      <form id="loginForm">
        <div class="field"><label>Kullanıcı Adı</label><input type="text" id="username" autocomplete="username" required></div>
        <div class="field"><label>Şifre</label><input type="password" id="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary" type="submit">Giriş Yap</button>
      </form>
      <div class="login-foot">Sorun yaşıyorsanız İK departmanı ile iletişime geçin.</div>
    </div>
  </div>`;
  el("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = el("#username").value.trim().toLowerCase();
    const p = el("#password").value;
    const btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Giriş yapılıyor…";
    try {
      await signInWithEmailAndPassword(auth, `${u}@${LOGIN_DOMAIN}`, p);
    } catch (err) {
      const box = el("#loginErr");
      box.style.display = "block";
      box.textContent = "Kullanıcı adı veya şifre hatalı.";
      btn.disabled = false; btn.textContent = "Giriş Yap";
    }
  });
}

// ---------------------------------------------------------------
// SHELL
// ---------------------------------------------------------------
const ICONS = {
  people: `<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4" fill="currentColor"/><path d="M2.5 20c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5" fill="currentColor" opacity=".85"/><circle cx="17.5" cy="8.5" r="2.6" fill="currentColor" opacity=".55"/><path d="M14.8 13.9c1-.6 2.1-.9 3-.9 2.8 0 5 2 5.2 5" fill="currentColor" opacity=".55"/></svg>`
};
function topbar() {
  return `
  <div class="topbar">
    <div class="brand">
      <div class="mark">İA</div>
      <div class="t">İşe Alım Süreci<small>İK Takip Paneli</small></div>
    </div>
    <div class="who">
      <span class="pill">${currentProfile.role === "admin" ? "İK / Admin" : "Müdür"}</span>
      <span><b>${esc(currentProfile.adSoyad)}</b></span>
      <button class="btn btn-ghost btn-sm" id="pwBtn">Şifre Değiştir</button>
      <button class="btn btn-ghost btn-sm" id="logoutBtn">Çıkış</button>
    </div>
  </div>`;
}
function wireTopbar() {
  el("#logoutBtn").addEventListener("click", () => signOut(auth));
  el("#pwBtn").addEventListener("click", () => openPasswordModal());
}

// ---------------------------------------------------------------
// ŞİFRE DEĞİŞTİR (Firebase Auth üzerinden — Yetenek Havuzu ile aynı hesaplar,
// aynı mantık). Sahte e-posta alan adı yüzünden "şifremi unuttum" e-postası
// çalışmaz; unutulan şifre için tek yol Firebase konsolundan admin sıfırlaması.
// ---------------------------------------------------------------
function openPasswordModal() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="drawer" style="width:min(420px,100%)">
      <div class="drawer-head">
        <div><h2>Şifre Değiştir</h2><div class="meta">${esc(currentProfile.adSoyad)}</div></div>
        <button class="close-x" id="closePwModal">✕</button>
      </div>
      <div class="drawer-body">
        <div class="field"><label>Mevcut Şifre</label><input type="password" id="pwCur"></div>
        <div class="field"><label>Yeni Şifre</label><input type="password" id="pwNew1" placeholder="en az 6 karakter"></div>
        <div class="field"><label>Yeni Şifre (Tekrar)</label><input type="password" id="pwNew2"></div>
        <div id="pwMsg" style="font-size:12.5px;margin-top:6px"></div>
      </div>
      <div class="drawer-foot">
        <button class="btn btn-ghost" id="pwVazgec">Vazgeç</button>
        <button class="btn btn-teal" id="pwKaydet">Kaydet</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  el("#closePwModal").onclick = () => overlay.remove();
  el("#pwVazgec").onclick = () => overlay.remove();
  el("#pwKaydet").onclick = async () => {
    const cur = el("#pwCur").value, n1 = el("#pwNew1").value, n2 = el("#pwNew2").value;
    const msg = el("#pwMsg");
    if (!cur) { msg.innerHTML = '<span style="color:var(--bad)">Mevcut şifrenizi girin.</span>'; return; }
    if (!n1 || n1.length < 6) { msg.innerHTML = '<span style="color:var(--bad)">Yeni şifre en az 6 karakter olmalı.</span>'; return; }
    if (n1 !== n2) { msg.innerHTML = '<span style="color:var(--bad)">Yeni şifreler birbiriyle uyuşmuyor.</span>'; return; }
    const btn = el("#pwKaydet");
    btn.disabled = true; btn.textContent = "Kaydediliyor…";
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, cur);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, n1);
      msg.innerHTML = '<span style="color:var(--good)">✓ Şifre güncellendi.</span>';
      setTimeout(() => overlay.remove(), 1200);
    } catch (e) {
      msg.innerHTML = '<span style="color:var(--bad)">' + (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential" ? "Mevcut şifre hatalı." : "Hata: " + e.message) + '</span>';
      btn.disabled = false; btn.textContent = "Kaydet";
    }
  };
}

let TAB = "adaylar";
function render() {
  const isAdmin = currentProfile.role === "admin";
  const gorulenAdaylar = isAdmin ? adaylar : adaylar.filter((a) => a.departman === currentProfile.muduluk);

  root().innerHTML = `
  ${topbar()}
  <div class="app-body">
    <div class="sidebar">
      <div class="nav-item active" data-nav="adaylar"><span class="ic">${ICONS.people}</span>Adaylar</div>
    </div>
    <div class="main-content"><div class="wrap" id="pageWrap"></div></div>
  </div>`;
  wireTopbar();
  renderAdaylarPage(gorulenAdaylar, isAdmin);
}

// ---------------------------------------------------------------
// ADAYLAR SAYFASI
// ---------------------------------------------------------------
function renderAdaylarPage(list, isAdmin) {
  const total = list.length;
  const evrakBekleyen = list.filter((a) => a.durum === "evrak_bekliyor").length;
  const sgkBekleyen = list.filter((a) => a.durum === "sgk_bekliyor").length;
  const iseBasladi = list.filter((a) => a.durum === "ise_basladi" || a.durum === "tamamlandi").length;

  const yarin = yarinISO();
  const yarinBaslayanlar = list.filter((a) => a.iseBaslamaTarihi === yarin && a.durum !== "vazgecti" && !a.sgkGirisYapildi);
  const bugun = bugunISO();
  const gecikenSgk = list.filter((a) => a.iseBaslamaTarihi && a.iseBaslamaTarihi <= bugun && !a.sgkGirisYapildi && a.durum !== "vazgecti" && a.durum !== "tamamlandi");

  const banner = (yarinBaslayanlar.length || gecikenSgk.length) ? `
    <div class="banner">
      <div class="ic">🔔</div>
      <div>
        ${yarinBaslayanlar.length ? `<div><b>Yarın işe başlayacak ${yarinBaslayanlar.length} kişi var</b> — SGK girişini unutmayın: ${yarinBaslayanlar.map((a) => esc(a.ad + " " + a.soyad)).join(", ")}</div>` : ""}
        ${gecikenSgk.length ? `<div style="margin-top:${yarinBaslayanlar.length ? "6px" : "0"}">⚠ <b>${gecikenSgk.length} kişinin</b> işe başlama tarihi geçti ama SGK girişi hâlâ yapılmamış: ${gecikenSgk.map((a) => esc(a.ad + " " + a.soyad)).join(", ")}</div>` : ""}
      </div>
    </div>` : "";

  el("#pageWrap").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Aday Takibi</h1>
        <p>İşe alım öncesi evrak ve SGK süreçlerini buradan yönetin.</p>
      </div>
      ${isAdmin ? `<button class="btn btn-teal" id="yeniAdayBtn">+ Yeni Aday Ekle</button>` : ""}
    </div>
    ${banner}
    <div class="stat-row">
      <div class="stat-card"><div class="n">${total}</div><div class="l">Toplam Aday</div></div>
      <div class="stat-card"><div class="n">${evrakBekleyen}</div><div class="l">Evrak Bekliyor</div></div>
      <div class="stat-card"><div class="n">${sgkBekleyen}</div><div class="l">SGK Bekliyor</div></div>
      <div class="stat-card"><div class="n">${iseBasladi}</div><div class="l">İşe Başladı</div></div>
    </div>
    <div class="toolbar">
      <input type="text" id="searchBox" placeholder="İsimle ara…" style="min-width:200px">
      <select id="durumFilter">
        <option value="">Tüm Durumlar</option>
        ${Object.keys(DURUM_ETIKET).map((k) => `<option value="${k}">${DURUM_ETIKET[k].label}</option>`).join("")}
      </select>
    </div>
    <div class="card-list" id="adayList"></div>`;

  if (isAdmin) el("#yeniAdayBtn").addEventListener("click", () => openAdayForm());

  function draw() {
    const term = el("#searchBox").value.trim().toLocaleLowerCase("tr");
    const stF = el("#durumFilter").value;
    const filtered = list
      .filter((a) => (a.ad + " " + a.soyad).toLocaleLowerCase("tr").includes(term))
      .filter((a) => !stF || a.durum === stF)
      .sort((a, b) => (a.iseBaslamaTarihi || "").localeCompare(b.iseBaslamaTarihi || ""));

    el("#adayList").innerHTML = filtered.length ? filtered.map((a) => adayCardHtml(a)).join("") : `<div class="empty-state">Aramanızla eşleşen aday bulunamadı.</div>`;
    document.querySelectorAll(".aday-card[data-id]").forEach((card) => {
      card.addEventListener("click", () => {
        const aday = adaylar.find((x) => x.id === card.dataset.id);
        if (aday) openAdayDetay(aday, isAdmin);
      });
    });
  }
  function adayCardHtml(a) {
    const st = DURUM_ETIKET[a.durum] || DURUM_ETIKET.evrak_bekliyor;
    const oran = evrakOrani(a);
    return `
    <div class="aday-card" data-id="${a.id}">
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:220px">
        ${avatarHtml(a.ad + " " + a.soyad, 38)}
        <div class="main">
          <b>${esc(a.ad)} ${esc(a.soyad)}</b>
          <div class="meta">${esc(a.unvan || "")} · ${esc(a.departman || "")} · İşe Başlama: ${fmtTarih(a.iseBaslamaTarihi)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="min-width:110px">
          <div style="font-size:10.5px;color:var(--ink-soft);margin-bottom:3px">Evrak %${oran}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${oran}%"></div></div>
        </div>
        <span class="status-badge ${st.cls}">${st.label}</span>
      </div>
    </div>`;
  }
  el("#searchBox").addEventListener("input", draw);
  el("#durumFilter").addEventListener("change", draw);
  draw();
}

// ---------------------------------------------------------------
// YENİ ADAY FORMU
// ---------------------------------------------------------------
function openAdayForm() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <div><h2>Yeni Aday Ekle</h2><div class="meta">Standart evrak listesi otomatik atanacaktır</div></div>
        <button class="close-x" id="closeDrawer">✕</button>
      </div>
      <div class="drawer-body">
        <div class="two-col">
          <div class="field"><label>Ad</label><input type="text" id="fAd" required></div>
          <div class="field"><label>Soyad</label><input type="text" id="fSoyad" required></div>
        </div>
        <div class="two-col">
          <div class="field"><label>Unvan</label><input type="text" id="fUnvan" placeholder="Örn: Satış Danışmanı"></div>
          <div class="field"><label>Departman</label><input type="text" id="fDepartman" placeholder="Örn: Peugeot"></div>
        </div>
        <div class="two-col">
          <div class="field"><label>Telefon</label><input type="text" id="fTelefon" placeholder="05xx xxx xx xx"></div>
          <div class="field"><label>E-posta</label><input type="email" id="fEmail"></div>
        </div>
        <div class="field"><label>İşe Başlama Tarihi</label><input type="date" id="fTarih" required></div>
        <div class="field"><label>Not</label><textarea id="fNot" rows="3" placeholder="Varsa eklemek istediğiniz not…"></textarea></div>
      </div>
      <div class="drawer-foot">
        <button class="btn btn-ghost" id="vazgecBtn">Vazgeç</button>
        <button class="btn btn-teal" id="kaydetBtn">Aday Ekle</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  el("#closeDrawer").onclick = () => overlay.remove();
  el("#vazgecBtn").onclick = () => overlay.remove();
  el("#kaydetBtn").onclick = async () => {
    const ad = el("#fAd").value.trim(), soyad = el("#fSoyad").value.trim(), tarih = el("#fTarih").value;
    if (!ad || !soyad || !tarih) { toast("Ad, soyad ve işe başlama tarihi zorunludur."); return; }
    const btn = el("#kaydetBtn");
    btn.disabled = true; btn.textContent = "Kaydediliyor…";
    try {
      await addDoc(collection(db, "iseAlimAday"), {
        ad, soyad,
        unvan: el("#fUnvan").value.trim(),
        departman: el("#fDepartman").value.trim(),
        telefon: el("#fTelefon").value.trim(),
        email: el("#fEmail").value.trim(),
        iseBaslamaTarihi: tarih,
        notlar: el("#fNot").value.trim(),
        durum: "evrak_bekliyor",
        sgkGirisYapildi: false,
        sgkGirisTarihi: null,
        evraklar: STANDART_EVRAK_LISTESI.map((ad2) => ({ ad: ad2, teslimAlindi: false, dosyaUrl: null, dosyaAdi: null, yuklemeTarihi: null })),
        olusturanKullanici: currentProfile.adSoyad,
        olusturmaTarihi: serverTimestamp(),
        guncellemeTarihi: serverTimestamp()
      });
      toast("✓ Aday eklendi.");
      overlay.remove();
    } catch (e) {
      toast("Kaydedilemedi: " + e.message);
      btn.disabled = false; btn.textContent = "Aday Ekle";
    }
  };
}

// ---------------------------------------------------------------
// ADAY DETAY
// ---------------------------------------------------------------
function openAdayDetay(aday, isAdmin) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  function bodyHtml(a) {
    const st = DURUM_ETIKET[a.durum] || DURUM_ETIKET.evrak_bekliyor;
    const oran = evrakOrani(a);
    return `
    <div class="section-title" style="margin-top:0">Genel Bilgiler</div>
    <div class="two-col">
      <div class="field"><label>Telefon</label><input type="text" id="dTelefon" value="${esc(a.telefon || "")}" ${isAdmin ? "" : "disabled"}></div>
      <div class="field"><label>E-posta</label><input type="email" id="dEmail" value="${esc(a.email || "")}" ${isAdmin ? "" : "disabled"}></div>
    </div>
    <div class="field"><label>İşe Başlama Tarihi</label><input type="date" id="dTarih" value="${esc(a.iseBaslamaTarihi || "")}" ${isAdmin ? "" : "disabled"}></div>
    <div class="field"><label>Durum</label>
      <select id="dDurum" ${isAdmin ? "" : "disabled"}>
        ${Object.keys(DURUM_ETIKET).map((k) => `<option value="${k}" ${a.durum === k ? "selected" : ""}>${DURUM_ETIKET[k].label}</option>`).join("")}
      </select>
    </div>

    <div class="section-title">SGK Girişi</div>
    <div class="evrak-row ${a.sgkGirisYapildi ? "done" : ""}">
      <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;flex:1">
        <input type="checkbox" id="dSgk" ${a.sgkGirisYapildi ? "checked" : ""} ${isAdmin ? "" : "disabled"}>
        SGK Girişi Yapıldı
      </label>
      <span style="font-size:12px;color:var(--ink-soft)">${a.sgkGirisTarihi ? "Tarih: " + fmtTarih(a.sgkGirisTarihi) : "—"}</span>
    </div>

    <div class="section-title">Evrak Listesi (%${oran} tamamlandı)</div>
    <div class="progress-track" style="margin-bottom:12px"><div class="progress-fill" style="width:${oran}%"></div></div>
    <div id="evrakListesi">
      ${(a.evraklar || []).map((e, i) => evrakRowHtml(e, i)).join("")}
    </div>

    <div class="section-title">Not</div>
    <textarea id="dNot" rows="3" ${isAdmin ? "" : "disabled"}>${esc(a.notlar || "")}</textarea>`;
  }

  function evrakRowHtml(e, i) {
    return `
    <div class="evrak-row ${e.teslimAlindi ? "done" : ""}" data-idx="${i}">
      <label style="display:flex;align-items:center;gap:8px;" class="name">
        <input type="checkbox" data-evrak-check="${i}" ${e.teslimAlindi ? "checked" : ""} ${isAdmin ? "" : "disabled"}>
        ${esc(e.ad)}
      </label>
    </div>`;
  }

  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <div style="display:flex;align-items:center;gap:12px;">
          ${avatarHtml(aday.ad + " " + aday.soyad, 38)}
          <div>
            <h2>${esc(aday.ad)} ${esc(aday.soyad)}</h2>
            <div class="meta">${esc(aday.unvan || "")} · ${esc(aday.departman || "")}</div>
          </div>
        </div>
        <button class="close-x" id="closeDrawer">✕</button>
      </div>
      <div class="drawer-body" id="drawerBody">${bodyHtml(aday)}</div>
      <div class="drawer-foot">
        ${isAdmin ? `<button class="btn btn-ghost" id="silBtn" style="color:var(--bad)">Adayı Sil</button>` : ""}
        <button class="btn btn-teal" id="guncelleBtn">${isAdmin ? "Kaydet" : "Kapat"}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  el("#closeDrawer").onclick = () => overlay.remove();

  let workingCopy = JSON.parse(JSON.stringify(aday));

  function wireEvrakEvents() {
    document.querySelectorAll("[data-evrak-check]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const i = +cb.dataset.evrakCheck;
        workingCopy.evraklar[i].teslimAlindi = cb.checked;
        cb.closest(".evrak-row").classList.toggle("done", cb.checked);
      });
    });
  }
  wireEvrakEvents();

  async function persist(patch) {
    await setDoc(doc(db, "iseAlimAday", aday.id), { ...patch, guncellemeTarihi: serverTimestamp() }, { merge: true });
  }

  el("#guncelleBtn").onclick = async () => {
    if (!isAdmin) { overlay.remove(); return; }
    const btn = el("#guncelleBtn");
    btn.disabled = true; btn.textContent = "Kaydediliyor…";
    const sgkChecked = el("#dSgk").checked;
    try {
      await persist({
        telefon: el("#dTelefon").value.trim(),
        email: el("#dEmail").value.trim(),
        iseBaslamaTarihi: el("#dTarih").value,
        durum: el("#dDurum").value,
        sgkGirisYapildi: sgkChecked,
        sgkGirisTarihi: sgkChecked ? (aday.sgkGirisTarihi || bugunISO()) : null,
        notlar: el("#dNot").value.trim(),
        evraklar: workingCopy.evraklar
      });
      toast("✓ Kaydedildi.");
      overlay.remove();
    } catch (e) {
      toast("Kaydedilemedi: " + e.message);
      btn.disabled = false; btn.textContent = "Kaydet";
    }
  };

  if (isAdmin) {
    el("#silBtn").onclick = async () => {
      if (!confirm(`"${aday.ad} ${aday.soyad}" adlı adayı kalıcı olarak silmek istediğinize emin misiniz?`)) return;
      try {
        await deleteDoc(doc(db, "iseAlimAday", aday.id));
        toast("✓ Aday silindi.");
        overlay.remove();
      } catch (e) { toast("Silinemedi: " + e.message); }
    };
  }
}
