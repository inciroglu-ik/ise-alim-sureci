/* Ajan Ofisi zamanlayıcısı — GitHub Actions ile her sabah 06:00'da (TR) çalışır
   (bkz. .github/workflows/ajan-ofisi.yml). IK-PLATFORM deposundaki ortak/ajan-ofisi/kadro.js'i
   (roller, talimatlar, zamanlama ve maliyet kuralları) okur; vadesi gelen işleri çalıştırır:
     - İçerik Avcısı: günlük içerik avı (her gün)
     - Rakip Analisti: haftalık rakip raporu (her hafta)
     - Muhasebeci: 3 günlük muhasebe raporu + tasarruf ayarları
   Claude API anahtarı yalnız ofis sahibinin Firestore kaydındadır (ajanOfisi/anahtarlar); burada yönetici
   yetkisiyle okunur, hiçbir yere yazılmaz/basılmaz.
   Güvenlik: Depo HERKESE AÇIK; çalışma günlüğüne anahtar, içerik ya da kişi bilgisi YAZILMAZ (yalnız iş kimliği,
   durum ve maliyet). Aynı iş sayfa ile aynı anda çalışmasın diye Firestore işlemiyle (transaction) kilitlenir. */
const admin = require("firebase-admin");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

async function kadroYukle() {
  const kaynak = process.env.KADRO_YOLU || path.join(process.cwd(), "ikp", "ortak", "ajan-ofisi", "kadro.js");
  const hedef = path.join(os.tmpdir(), "ajan-ofisi-kadro-" + Date.now() + ".mjs");
  fs.copyFileSync(kaynak, hedef);
  return import(pathToFileURL(hedef).href);
}

async function main() {
  const K = await kadroYukle();
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  const sahip = await db.doc("ajanOfisi/sahip").get();
  if (!sahip.exists) { console.log("Ajan Ofisi henüz kurulmamış; atlandı."); return; }
  const anahtar = ((await db.doc("ajanOfisi/anahtarlar").get()).data() || {}).claude;
  if (!anahtar) { console.log("Claude anahtarı girilmemiş; atlandı."); return; }
  const ayar = Object.assign({ model: K.VARSAYILAN_MODEL, aylikButce: 20 }, (await db.doc("ajanOfisi/ayar").get()).data() || {});
  const kadro = (await db.doc("ajanOfisi/kadro").get()).data() || K.baslangicKadrosu();
  const zRef = db.doc("ajanOfisi/zamanlama");
  const vade = K.vadesiGelenler((await zRef.get()).data() || {}, new Date());
  if (!vade.length) { console.log("Vadesi gelen iş yok."); return; }

  const harcamaKol = db.collection("ajanOfisi").doc("ofis").collection("harcama");
  const notKol = db.collection("ajanOfisi").doc("ofis").collection("notlar");
  const ay = K.ayAnahtari();
  let harcanan = (await harcamaKol.where("ay", "==", ay).get()).docs.reduce((s, d) => s + (d.data().maliyet || 0), 0);
  const client = new Anthropic({ apiKey: anahtar, maxRetries: 2, timeout: 10 * 60 * 1000 });

  for (const v of vade) {
    const butce = Number(ayar.aylikButce) || 0;
    if (butce > 0 && harcanan >= butce) { console.log(v.id + ": aylık bütçe dolu, atlandı."); continue; }
    /* En kötü durum ön kontrolü (sayfa ile aynı kural): olası en yüksek maliyet kalan bütçeyi aşıyorsa başlatma */
    const onIstek = v.id === "icerik" ? K.icerikAviIstegi(K.trTarih(), ayar) : v.id === "rakip" ? K.rakipRaporuIstegi(K.isoHafta(), ayar) : null;
    if (butce > 0 && onIstek && harcanan + K.azamiTahmin(ayar.model, onIstek, 16000) > butce) { console.log(v.id + ": kalan bütçe yetersiz, atlandı."); continue; }
    const kilitId = K.kilitKimligi();
    const alindi = await db.runTransaction(async (tx) => {
      const s = await tx.get(zRef);
      const k = ((s.data() || {})[v.id]) || {};
      if (!K.kilitAlinabilir(k, v.anahtar, Date.now(), false)) return false;
      tx.set(zRef, { [v.id]: K.kilitKaydi(k, v.anahtar, kilitId, Date.now()) }, { merge: true });
      return true;
    });
    if (!alindi) { console.log(v.id + ": zaten yapılmış, başka bir çalıştırmada ya da deneme sınırında."); continue; }
    const kilitYaz = (fn) => db.runTransaction(async (tx) => {
      const s = await tx.get(zRef);
      const y = fn(((s.data() || {})[v.id]) || {});
      if (y) tx.set(zRef, { [v.id]: y }, { merge: true });
    });

    const tanim = K.ZAMANLI_ISLER.find((z) => z.id === v.id);
    const rol = tanim.rol;
    const c = (kadro.calisanlar || {})[rol] || { ad: K.ROL[rol].baslangicAd, kademe: K.ROL[rol].baslangicKademe };
    const effort = K.kademeBilgisi(c.kademe).effort;
    const defter = (k, sure, model, hata) => harcamaKol.add({
      rol, ad: c.ad, kademe: c.kademe | 0, model: model || ayar.model, effort,
      giris: k.giris, cikis: k.cikis, okuma: k.okuma, yazma: k.yazma, arama: k.arama, maliyet: k.maliyet,
      sureMs: sure || 0, isId: null, tur: v.id, hata: hata || null, ay, tsMs: Date.now(), kaynak: "zamanlayici"
    });
    try {
      let istek;
      if (v.id === "icerik") istek = K.icerikAviIstegi(K.trTarih(), ayar);
      else if (v.id === "rakip") istek = K.rakipRaporuIstegi(K.isoHafta(), ayar);
      else {
        const son30 = await harcamaKol.where("tsMs", ">=", Date.now() - 30 * 86400000).get();
        istek = K.muhasebeIstegi(K.harcamaOzeti(son30.docs.map((d) => d.data())));
      }
      const s = await K.calistir(client, istek, { model: ayar.model, effort });
      harcanan += s.kullanim.maliyet;
      await defter(s.kullanim, s.sure, s.model, null);
      const z = K.zamanliSonuc(v.id, s);
      if (z.ayarYamasi) await db.doc("ajanOfisi/ayar").set(z.ayarYamasi, { merge: true });
      await notKol.add(Object.assign({ tur: v.id, rol, ad: c.ad, baslik: z.baslik, icerik: z.icerik, kaynaklar: s.kaynaklar, maliyet: s.kullanim.maliyet, kaynak: "zamanlayici", tarihMs: Date.now() }, z.ek));
      await kilitYaz((k) => K.kilitBitir(k, v.anahtar, kilitId, Date.now(), "zamanlayici"));
      console.log(v.id + ": tamam (" + s.kullanim.maliyet.toFixed(4) + " USD).");
    } catch (e) {
      await kilitYaz((k) => K.kilitBirak(k, kilitId, (e && e.kod) || "hata")).catch(() => {});
      if (e && e.kullanim) await defter(e.kullanim, e.sure, null, e.kod || "hata").catch(() => {});
      /* İleti içeriği basılmaz (açık depo): yalnız durum kodu / tür */
      console.log(v.id + ": hata (" + (e && e.status ? "HTTP " + e.status : (e && e.kod) || (e && e.name) || "bilinmeyen") + ").");
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.log("Zamanlayıcı durdu (" + ((e && e.name) || "hata") + ")."); process.exit(1); });
