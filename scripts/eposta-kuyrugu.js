/* E-posta kuyruğu gönderici — GitHub Actions üzerinden 10 dakikada bir çalışır
   (bkz. .github/workflows/eposta-kuyrugu.yml). İK Portalı'ndaki sayfaların Firestore "epostaKuyrugu"
   koleksiyonuna yazdığı "bekliyor" durumundaki e-postaları Gmail ile gönderir ve durumunu işaretler.
   Kullanan: Oryantasyon Formları (sorumlu bildirimi, yeni başlayan bildirimi); Personel Talepleri (onay bildirimi).
   Personel talebi (kaynak "personel-talebi"): konu ve gövde kayıttan ALINMAZ; personelTalepFormlari/{ilgili} kaydından
   personel-talep-eposta.js şablonuyla üretilir ve alıcı, talepte kayıtlı sıradaki onaylayıcının adresiyle yeniden
   karşılaştırılır (tutmazsa gönderilmez).
   Güvenlik:
   - Yalnız @inciroglu.com.tr adreslerine gönderilir (Firestore kuralıyla aynı). Teslim adresi (SMTP zarfı) yalnız
     "kime" alanıdır; görünen ad ("kimeAd") adres içeremez, alıcı ekleyemez.
   - Her kayıt göndermeden önce işlemle (transaction) "gonderiliyor" olarak kilitlenir: aynı e-posta iki kez gitmez,
     bu arada İK'nın iptal ettiği e-posta gönderilmez.
   - Bir çalıştırmada en çok 40 e-posta; hata alan kayıt 3 denemeden sonra "hata" olarak bırakılır.
   - Depo herkese açık olduğundan çalışma günlüğüne kişi adı / e-posta adresi YAZILMAZ (yalnız kayıt kimliği).
   Gizli bilgiler hatırlatma göreviyle aynıdır. */
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const personelTalep = require("./personel-talep-eposta.js");

const ALAN = /^[a-z0-9._%+-]+@inciroglu\.com\.tr$/i;
const EN_FAZLA = 40;
const DENEME = 3;
const zaman = () => admin.firestore.FieldValue.serverTimestamp();
/* Görünen ad: tırnak, ters bölü, @, virgül, noktalı virgül, açılı ayraç ve satır sonu atılır */
const gorunenAd = (s) => String(s || "").replace(/["\\@,;<>\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

async function main() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const snap = await db.collection("epostaKuyrugu").where("durum", "==", "bekliyor").limit(EN_FAZLA).get();
  if (snap.empty) {
    console.log("Kuyrukta bekleyen e-posta yok.");
    return;
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });

  let gonderilen = 0, hatali = 0, atlanan = 0;
  for (const d of snap.docs) {
    const ref = d.ref;
    /* 1) kilitle: hâlâ "bekliyor" ise "gonderiliyor" yap (bu arada iptal edildiyse ya da başka çalıştırma aldıysa atla) */
    let e = null;
    try {
      e = await db.runTransaction(async (tx) => {
        const g = await tx.get(ref);
        if (!g.exists || g.data().durum !== "bekliyor") return null;
        tx.update(ref, { durum: "gonderiliyor", islem: zaman() });
        return g.data();
      });
    } catch (err) {
      console.error("Kilitlenemedi:", d.id, err && err.message);
      hatali++;
      continue;
    }
    if (!e) { atlanan++; continue; }
    const kime = String(e.kime || "").trim().toLowerCase();
    let konu = e.konu, govde = e.html, kimeAd = e.kimeAd;
    /* personel talebi: içerik talep kaydından (istemcinin yazdığı konu/gövde kullanılmaz) */
    if (e.kaynak === "personel-talebi") {
      try {
        const sablon = String(e.sablon || "");
        const ilgili = String(e.ilgili || "");
        const t = /^[A-Za-z0-9]{1,40}$/.test(ilgili) ? await db.collection("personelTalepFormlari").doc(ilgili).get() : null;
        const td = t && t.exists ? t.data() : null;
        const z = td && td.zincir && (sablon === "direktor" || sablon === "ik") ? td.zincir[sablon] : null;
        if (!z || String(z.eposta || "").trim().toLowerCase() !== kime) throw new Error("Talep ya da alıcı tutmuyor");
        /* bayat e-posta gönderilmez: bu arada karar verildiyse / iptal edildiyse kayıt iptal edilir */
        if (td.durum !== sablon) {
          await ref.update({ durum: "iptal", hata: "Talebin aşaması değişti, e-posta gereksiz", islem: zaman() });
          atlanan++;
          continue;
        }
        konu = personelTalep.konu(sablon, td);
        govde = personelTalep.html(sablon, td, ilgili);
        kimeAd = z.ad;
      } catch (err) {
        await ref.update({ durum: "hata", hata: String((err && err.message) || err).slice(0, 300), islem: zaman() });
        hatali++;
        console.error("Personel talebi e-postası hazırlanamadı:", d.id);
        continue;
      }
    }
    if (!ALAN.test(kime) || !konu || !govde) {
      await ref.update({ durum: "hata", hata: "Geçersiz alıcı ya da içerik", islem: zaman() });
      hatali++;
      continue;
    }
    /* 2) gönder: zarf alıcısı yalnız "kime" */
    try {
      await transporter.sendMail({
        from: { name: "İnciroğlu Otomotiv İK", address: process.env.GMAIL_USER },
        to: { name: gorunenAd(kimeAd), address: kime },
        envelope: { from: process.env.GMAIL_USER, to: [kime] },
        subject: String(konu).replace(/[\r\n]+/g, " "),
        html: govde
      });
    } catch (err) {
      const deneme = (e.deneme || 0) + 1;
      await ref.update({ deneme, hata: String((err && err.message) || err).slice(0, 300), durum: deneme >= DENEME ? "hata" : "bekliyor", islem: zaman() });
      hatali++;
      console.error("Gönderilemedi:", d.id, err && err.message);
      continue;
    }
    /* 3) işaretle (gönderim başarılıysa bu adımın hatası e-postayı yeniden göndertmez; kayıt "gonderiliyor" kalır) */
    try {
      await ref.update({ durum: "gonderildi", gonderim: zaman() });
    } catch (err) {
      console.error("Gönderildi ama işaretlenemedi:", d.id, err && err.message);
    }
    gonderilen++;
  }
  console.log(`Gönderilen: ${gonderilen} · hatalı: ${hatali} · atlanan: ${atlanan}`);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
