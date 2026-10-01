/* MR (Tofaş Akademi) kayıt silme bildirim robotu — GitHub Actions ile zamanlanmış
   çalışır (bkz. .github/workflows/mr-mail.yml). İK biri MR'dan bir kişi sildiğinde
   mr.html, satisVeri/mrMailKuyruk dokümanındaki "kuyruk" dizisine bir istek yazar.
   Bu script bekleyen (gonderildi:false) istekleri okuyup, kişinin KAYITLI OLDUĞU
   markaya göre sorumlu müdürlere otomatik e-posta gönderir ve gönderildi olarak işaretler.
   (Firebase projesi: yetenek-havuzu — işe alım ile aynı; mevcut secret'lar kullanılır.) */
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

/* Alıcı kuralı — kişinin MR'da KAYITLI olduğu markaya göre (gerçek birimine değil). */
const MGR = {
  ugur: "ugur.sakiroglu@inciroglu.com.tr",
  ali: "ali.buyuk@inciroglu.com.tr",
  tiryaki: "mehmet.tiryaki@inciroglu.com.tr",
  atici: "murat.atici@inciroglu.com.tr",
  ufuk: "ufuk.onsal@inciroglu.com.tr",
  ik: "ik@inciroglu.com.tr"
};
const SET_A = [MGR.ugur, MGR.tiryaki, MGR.atici, MGR.ik]; // PSA: Peugeot/Citroen/Opel/DS/Spoticar (ali & ufuk hariç)
const SET_B = [MGR.ufuk, MGR.ali, MGR.ik];                // Fiat/ARJ: Fiat/Alfa Romeo/Jeep/Maserati
const MARKA_GRUP = {
  "Peugeot": "A", "Citroen": "A", "Opel": "A", "DS Automobiles": "A", "Spoticar": "A",
  "Fiat": "B", "Alfa Romeo": "B", "Jeep": "B", "Maserati": "B"
};
function aliciBul(markalar) {
  const s = new Set();
  (markalar || []).forEach((m) => { const g = MARKA_GRUP[m]; (g === "A" ? SET_A : g === "B" ? SET_B : [MGR.ik]).forEach((e) => s.add(e)); });
  if (!s.size) s.add(MGR.ik);
  return [...s];
}
function trLower(s) { return String(s || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase(); }
function trTitle(s) { return trLower(s).split(/\s+/).map((w) => { if (!w) return w; const f = w.charAt(0); const up = (f === "i") ? "İ" : (f === "ı" ? "I" : f.toLocaleUpperCase("tr")); return up + w.slice(1); }).join(" "); }
function tarihTR(iso) { try { const [y, m, d] = String(iso).split("-"); return d + "." + m + "." + y; } catch (e) { return iso || ""; } }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  const ref = db.doc("satisVeri/mrMailKuyruk");
  const snap = await ref.get();
  if (!snap.exists) { console.log("mrMailKuyruk yok — gönderilecek bir şey yok."); return; }
  const data = snap.data() || {};
  const kuyruk = Array.isArray(data.kuyruk) ? data.kuyruk : [];
  const bekleyen = kuyruk.filter((k) => k && !k.gonderildi);
  if (!bekleyen.length) { console.log("Bekleyen bildirim yok."); return; }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });

  let gonderilen = 0;
  for (const k of bekleyen) {
    const to = aliciBul(k.markalar);            // güvenlik: alıcıyı markadan YENİDEN hesapla
    const ad = trTitle(k.ad || "");
    const markaTxt = (k.markalar || []).join(", ");
    const html = `<div style="font-family:Arial,sans-serif;color:#1c2530;max-width:600px">
      <h2 style="color:#a13030;margin:0 0 6px">⚠ MR / Tofaş Akademi — Kayıt Silme Bildirimi</h2>
      <p style="font-size:14px;margin:0 0 12px">DİKKAT! MR sistemindeki aşağıdaki personel <b>işten ayrılmıştır</b>. Lütfen <b>Tofaş Akademi kaydını siliniz</b>.</p>
      <table style="font-size:14px;border-collapse:collapse">
        <tr><td style="padding:3px 12px 3px 0;color:#667">Personel</td><td style="padding:3px 0"><b>${esc(ad)}</b></td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#667">Ayrılış Tarihi</td><td>${esc(tarihTR(k.ayrilisTarihi))}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#667">Tofaş Akademi Kaydı (Marka)</td><td>${esc(markaTxt)}</td></tr>
        ${k.unvan ? `<tr><td style="padding:3px 12px 3px 0;color:#667">Unvan</td><td>${esc(k.unvan)}</td></tr>` : ""}
      </table>
      <p style="margin:14px 0 0;font-size:14px;color:#a13030"><b>TOFAŞ AKADEMİ KAYDINI SİLİN.</b> (Geç/eksik işlemlerde Tofaş ceza kesebilmektedir.)</p>
      <p style="font-size:11px;color:#999;margin-top:20px">Bu e-posta MR sisteminden otomatik gönderilmiştir · İnciroğlu Otomotiv · İnsan Kaynakları</p>
    </div>`;
    await transporter.sendMail({
      from: `MR Sistemi <${process.env.GMAIL_USER}>`,
      to: to.join(","),
      subject: `MR / Tofaş Akademi — Kayıt Silme Bildirimi: ${ad}`,
      html
    });
    k.gonderildi = true;
    k.gonderimTarihi = new Date().toISOString();
    k.gonderilenAlicilar = to;
    gonderilen++;
    console.log("Gönderildi:", ad, "->", to.join(", "));
  }

  await ref.set({ kuyruk, guncelleme: new Date().toISOString() }, { merge: true });
  console.log("Tamam. Gönderilen bildirim sayısı:", gonderilen);
}

main().catch((e) => { console.error(e); process.exit(1); });
