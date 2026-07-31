// ============================================================
// FIREBASE PROJE AYARLARI
// Yetenek Havuzu ile aynı Firebase projesi kullanılıyor (ayrı bir
// koleksiyon altında) — kurulum kolaylığı için altyapı paylaşılıyor,
// veriler birbirine karışmıyor.
// ============================================================

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCWlB0nU-ETZxuo9xa6gG4VMYVu09P3fnE",
  authDomain: "yetenek-havuzu.firebaseapp.com",
  projectId: "yetenek-havuzu",
  storageBucket: "yetenek-havuzu.firebasestorage.app",
  messagingSenderId: "714642441227",
  appId: "1:714642441227:web:bf49ac51367c6d9437b30e"
};

// Yönetici/müdür girişleri Yetenek Havuzu'ndaki "managers" koleksiyonuyla
// AYNI hesapları kullanır — aynı kişiler zaten oradan giriş yapıyor.
export const LOGIN_DOMAIN = "ihdegerlendirme.local";

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig, "ise-alim-sureci");
