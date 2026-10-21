/* Günlük hatırlatma scripti — GitHub Actions üzerinden zamanlanmış olarak
   çalışır (bkz. .github/workflows/hatirlatma.yml). Firestore'daki adaylar
   koleksiyonunu kontrol eder ve gerekiyorsa Gmail üzerinden bir özet
   e-postası gönderir. Bildirilecek bir şey yoksa e-posta göndermez. */
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

function bugunISO() {
  return new Date().toISOString().slice(0, 10);
}
function yarinISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function gunFarki(iso) {
  const a = new Date(bugunISO() + "T00:00:00"), b = new Date(iso + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const snap = await db.collection("iseAlimAday").get();
  const adaylar = [];
  snap.forEach((d) => adaylar.push({ id: d.id, ...d.data() }));

  const yarin = yarinISO();
  const bugun = bugunISO();

  const sgkYarin = adaylar.filter((a) => a.iseBaslamaTarihi === yarin && a.durum !== "vazgecti" && !a.sgkGirisYapildi);
  const sgkGecikme = adaylar.filter((a) => a.iseBaslamaTarihi && a.iseBaslamaTarihi <= bugun && !a.sgkGirisYapildi && a.durum !== "vazgecti" && a.durum !== "tamamlandi");
  const denemeYaklasan = adaylar.filter((a) => a.durum === "ise_basladi" && a.denemeSuresi && !a.denemeSuresi.degerlendirmeYapildiMi
    && a.denemeSuresi.bitisTarihi && gunFarki(a.denemeSuresi.bitisTarihi) >= 0 && gunFarki(a.denemeSuresi.bitisTarihi) <= 7);

  if (!sgkYarin.length && !sgkGecikme.length && !denemeYaklasan.length) {
    console.log("Bildirilecek bir şey yok, e-posta gönderilmedi.");
    return;
  }

  const satir = (a, ekBilgi) => `<li><b>${a.ad} ${a.soyad}</b> — ${a.unvan || "—"} / ${a.departman || "—"}${ekBilgi ? " · " + ekBilgi : ""}</li>`;
  let html = `<div style="font-family:Arial,sans-serif;color:#1c2530;max-width:560px">
    <h2 style="color:#117a63;margin-bottom:4px">İşe Alım Süreci — Günlük Hatırlatma</h2>
    <p style="color:#666;font-size:12px;margin-top:0">${new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })}</p>`;

  if (sgkYarin.length) {
    html += `<h3 style="color:#b3791f">🔔 Yarın İşe Başlayacaklar — SGK Girişi Gerekiyor</h3><ul>${sgkYarin.map((a) => satir(a)).join("")}</ul>`;
  }
  if (sgkGecikme.length) {
    html += `<h3 style="color:#a13030">⚠ SGK Girişi Gecikmiş</h3><ul>${sgkGecikme.map((a) => satir(a, "işe başlama: " + a.iseBaslamaTarihi)).join("")}</ul>`;
  }
  if (denemeYaklasan.length) {
    html += `<h3 style="color:#117a63">📋 Deneme Süresi Yaklaşan (Değerlendirme Bekliyor)</h3><ul>${denemeYaklasan.map((a) => satir(a, "bitiş: " + a.denemeSuresi.bitisTarihi)).join("")}</ul>`;
  }
  html += `<p style="font-size:11px;color:#999;margin-top:20px">Bu e-posta İşe Alım Süreci sisteminden otomatik olarak gönderilmiştir.</p></div>`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
  await transporter.sendMail({
    from: `İşe Alım Süreci <${process.env.GMAIL_USER}>`,
    to: process.env.ALICI_EPOSTA || process.env.GMAIL_USER,
    subject: "İşe Alım Süreci — Günlük Hatırlatma",
    html
  });
  console.log("E-posta gönderildi.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
