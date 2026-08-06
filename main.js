import { app, LOGIN_DOMAIN } from "./firebase-config.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, collection, onSnapshot,
  query, where, serverTimestamp
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
  gorusme_bekliyor: { label: "Görüşme / Karar Bekliyor", cls: "st-gorusme" },
  olumsuz: { label: "Olumsuz (Reddedildi)", cls: "st-olumsuz" },
  evrak_bekliyor: { label: "Evrak Bekliyor", cls: "st-evrak" },
  sgk_bekliyor: { label: "SGK Bekliyor", cls: "st-sgk" },
  ise_basladi: { label: "İşe Başladı (Deneme Süresi)", cls: "st-basladi" },
  tamamlandi: { label: "Tamamlandı", cls: "st-tamam" },
  vazgecti: { label: "Vazgeçildi", cls: "st-vazgecti" }
};
// Aday havuzunda ("gorusme_bekliyor" ve öncesi/karar aşaması) gösterilen
// gruplar sıralı bir akış izler; onboarding tarafı (evrak -> ... -> tamamlandı)
// önceki sürümle aynı kalır.
const AKIS_GRUPLARI = [
  { key: "gorusme_bekliyor", baslik: "Görüşme / Karar Bekliyor", ic: "🗓️" },
  { key: "evrak_bekliyor", baslik: "Evrak Bekliyor", ic: "📄" },
  { key: "sgk_bekliyor", baslik: "SGK Bekliyor", ic: "🏥" },
  { key: "ise_basladi", baslik: "Deneme Süresinde", ic: "⏳" },
  { key: "tamamlandi", baslik: "Tamamlandı", ic: "✅" },
  { key: "vazgecti", baslik: "Vazgeçildi", ic: "🚫" },
  { key: "olumsuz", baslik: "Olumsuz (Reddedildi) — yalnız İK görür", ic: "✗", sadeceAdmin: true }
];
const RED_NEDENLERI = [
  "Deneyim / yetkinlik yetersiz",
  "Maaş beklentisi uyuşmadı",
  "Kurum kültürüne / ekibe uyum endişesi",
  "Başka bir aday tercih edildi",
  "Aday kendi vazgeçti",
  "Evrak / referans sorunu",
  "Diğer"
];

// ---------------------------------------------------------------
// Personel Talepleri — şirketin kağıt üzerindeki gerçek "Personel Talep
// Formu"nun alanları birebir işlenmiştir (poziyon bilgileri, talep nedeni,
// iç aday değerlendirmesi, sürdürülebilirlik analizi, riskler, ücret/bütçe,
// marka zorunluluğu). Onay zinciri kağıtta Müdür→Direktör→İK Direktörü→CEO
// şeklinde görünse de, uygulamadaki karar adımı bilinçli olarak TEK adımda
// (İK/admin onaylar/reddeder/erteler/revize ister) tutuluyor — talep
// sahibinin istediği basit akış budur. Onaylanan bir talep 1:N ilişkiyle
// birden fazla adaya bağlanabilir (karsilananAdet sayacı otomatik ilerler,
// adet'e ulaşınca talep kendiliğinden "karsilandi" olur).
// ---------------------------------------------------------------
const TALEP_DURUM_ETIKET = {
  talep_edildi: { label: "Onay Bekliyor", cls: "st-gorusme" },
  onaylandi: { label: "Onaylandı — Aday Aranıyor", cls: "st-basladi" },
  revize_istendi: { label: "Revize İstendi", cls: "st-sgk" },
  ertelendi: { label: "Ertelendi", cls: "st-sgk" },
  kismen_karsilandi: { label: "Kısmen Karşılandı", cls: "st-sgk" },
  karsilandi: { label: "Karşılandı", cls: "st-tamam" },
  reddedildi: { label: "Reddedildi", cls: "st-olumsuz" },
  iptal_edildi: { label: "İptal Edildi", cls: "st-vazgecti" }
};
const TALEP_KARAR_OPT = [
  { key: "onaylandi", label: "Onaylandı" },
  { key: "revize_istendi", label: "Revize İstendi" },
  { key: "ertelendi", label: "Ertelendi" },
  { key: "reddedildi", label: "Reddedildi" }
];
const TALEP_NEDEN_OPT = [
  { key: "ek_kadro", label: "Ek Kadro" },
  { key: "is_hacmi_artisi", label: "İş Hacmi Artışı" },
  { key: "yeni_kadro", label: "Yeni Kadro Açılması" },
  { key: "personel_yedekleme", label: "Personel Yedekleme" },
  { key: "organizasyonel_revizyon", label: "Organizasyonel Revizyon" },
  { key: "yerine_alim", label: "Yerine Alım (kimin yerine olduğunu ve çıkış tarihini yazınız)" }
];
const IC_ADAY_OPT = [
  { key: "degerlendirilebilir", label: "İç Aday Değerlendirilebilir" },
  { key: "talebi_yoktur", label: "İç Aday Talebi Yoktur" },
  { key: "gelistirilebilir", label: "Geliştirilebilir İç Aday Değerlendirilebilir" }
];
const SURDURULEBILIRLIK_OPT = [
  { key: "surdurulebilir", label: "Sürdürülebilir" },
  { key: "kisa_vadede", label: "Kısa Vadede Sürdürülebilir" },
  { key: "surdurulemez", label: "Sürdürülemez" }
];
const RISK_OPT = [
  { key: "is_kaybi", label: "İş Kaybı" },
  { key: "musteri_memnuniyeti", label: "Müşteri Memnuniyeti" },
  { key: "kalite_etkisi", label: "Kalite Etkisi" }
];
const MARKA_ZORUNLULUK_OPT = [
  { key: "zorunlu_kadro", label: "Zorunlu Kadro" },
  { key: "tavsiye_edilen", label: "Tavsiye Edilen Kadro" },
  { key: "zorunluluk_yok", label: "Zorunluluk Yok" }
];
function checkboxGrupHtml(name, secililer, opts) {
  return `<div style="display:flex;flex-direction:column;gap:6px">${opts.map((o) => `
    <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;font-weight:500;cursor:pointer">
      <input type="checkbox" name="${name}" value="${o.key}" ${(secililer || []).includes(o.key) ? "checked" : ""} style="margin-top:2px">
      ${esc(o.label)}
    </label>`).join("")}</div>`;
}
function checkboxGrupOku(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((c) => c.value);
}
function radioGrupHtml(name, secili, opts, disabled) {
  return `<div style="display:flex;flex-direction:column;gap:6px">${opts.map((o) => `
    <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;font-weight:500;cursor:pointer">
      <input type="radio" name="${name}" value="${o.key}" ${secili === o.key ? "checked" : ""} ${disabled ? "disabled" : ""} style="margin-top:2px">
      ${esc(o.label)}
    </label>`).join("")}</div>`;
}
function radioGrupOku(name) {
  const el2 = document.querySelector(`input[name="${name}"]:checked`);
  return el2 ? el2.value : null;
}

// ---------------------------------------------------------------
// Unvan listesi — Ağustos 2026 Çalışan Listesi'ndeki aktif unvanlardan
// derlenmiştir. Listede olmayan bir unvan çıkarsa "Diğer (elle yaz)"
// seçeneğiyle serbest metin girilebilir.
// ---------------------------------------------------------------
const UNVAN_LISTESI = [
  "Satış Danışmanı", "Kıdemli Satış Danışmanı", "Aktif Satış Danışmanı", "Satış Müdürü", "Satış Şefi",
  "Servis Danışmanı", "Kıdemli Servis Danışmanı", "Servis Müdürü", "Hasar Servis Danışmanı", "Hasar Servis Müdürü",
  "Servis Resepsiyonist", "Servis Teknik Danışman", "Randevu Planlama Sorumlusu",
  "Otomotiv Mekanikçisi", "Otomotiv Mekanik Formeni", "Otomotiv Kaporta Teknisyeni", "Otomotiv Elektrik Teknisyeni",
  "Otomotiv Boya Teknisyeni", "Otomotiv Boya Elemanı", "Otomotiv Boya Formeni", "Trim Teknisyeni",
  "Lpg Bakım Teknisyeni", "Kalite Kontrol Teknisyeni", "Ön Düzen ve Balans Ayarcısı", "Atölye Şefi", "Atölye Takip Uzmanı",
  "Yedek Parça Danışmanı", "Yedek Parça Yöneticisi", "Garanti Uzmanı", "Garanti Uzman Yardımcısı", "Expertiz Uzmanı",
  "Lojistik Uzmanı", "Müşteri İlişkileri Sorumlusu", "Showrom Elemanı", "Resepsiyon Elemanı", "Resepsiyonst",
  "Teslimat Sorumlusu", "Araç Alım Uzmanı", "Araç Alım Yöneticisi", "Araç Hazırlama Uzmanı", "Kredi Görevlisi",
  "Kredi Tahsis Uzmanı", "Ek Satışlardan Sorumlu Müdür", "FİLO SATIŞ MÜDÜRÜ", "Genius", "Vale", "Oto Yıkama Elemanı", "Oto Yıkama Yöneticisi",
  "İkram Görevlisi", "SERVİS MÜHENDİSİ",
  "Direktör", "MARKA DİREKTÖRÜ", "Ceo", "Ceo Teknik Asistanı", "Yönetim Kurulu Başkanı",
  "DİJİTAL DÖNÜŞÜM & PAZARLAMA & STRATEJİ GENEL MÜDÜR YARDIMCISI", "MALİ İŞLER GENEL MÜDÜR YARDIMCISI",
  "Pazarlama Müdürü", "Pazarlama Uzmanı", "Pazarlama Uzman Yardımcısı", "Sosyal Medya Uzmanı", "İş Geliştirme Uzmanı",
  "Marka Muhasebe Sorumlusu", "Marka Muhasebe Uzman Yardımcısı", "Muhasebe Yöneticisi", "Finans Yöneticisi", "Finans Uzmanı", "Vezne",
  "Satın Alma Yöneticisi", "İc Denetim Uzmanı", "Bordro Ve Özlük İşleri Uzmanı",
  "İnsan Kaynakları Uzman Yardımcısı", "Bilgi İşlem Yöneticisi", "Bilgi İşlem Yardımcısı", "Plaka Tescil Sorumlusu",
  "Şoför", "Bahçivan", "Ev Temizlik Görevlisi", "Yat Hostesi", "Gemi", "Engelli",
  "BİNA-ELEKTRİK BAKIM TEKNİSYENİ", "Plaza Bakım Teknisyeni",
  "Stajyer", "Analist Öğrenci"
];

// ---------------------------------------------------------------
// Departman (marka/birim) ve Bölüm listeleri — Ağustos 2026 Çalışan
// Listesi'ndeki aktif departmanlardan derlenmiştir. Açılır liste olarak
// sunulur ki "Fiat" / "FIAT" gibi büyük-küçük harf farkları yüzünden
// müdür-departman eşleşmesi (Firestore kuralları dahil) hiç bozulmasın.
// ---------------------------------------------------------------
const DEPARTMAN_LISTESI = [
  "FIAT", "PSA", "BMW", "HASAR", "HONDA", "2. EL", "PEUGEOT", "CITROEN", "JAECOO", "OPEL",
  "BPS", "FİLO", "MINI", "ARJ", "EK SATIŞ DEPARTMANI",
  "İCRA KURULU", "MALİ İŞLER", "İNSAN KAYNAKLARI", "YIKAMA BİRİMİ", "SATIN ALMA",
  "PAZARLAMA", "FİNANS", "DENETİM", "YÖNETİM KURULU", "D-EXPERT", "BİLGİ İŞLEM"
];
const BOLUM_LISTESI = ["Satış", "Servis", "İdari"];

// ---------------------------------------------------------------
// Oryantasyon — 4 unvan için şirketin gerçek/detaylı oryantasyon formları
// birebir işlenmiştir (kategori/sıra/kapsam/sorumlu alanlarıyla). Diğer tüm
// unvanlar için genel bir liste kullanılır (kapsamlı unvan-bazlı şablonlar
// zamanla eklenebilir).
// ---------------------------------------------------------------
function _oExpand(satirlar) {
  // satirlar: [kategoriYaKiBosBirak, baslik, kapsam, sorumlu][]
  let sonKategori = "";
  return satirlar.map(([kategori, baslik, kapsam, sorumlu], i) => {
    if (kategori) sonKategori = kategori;
    return { kategori: sonKategori, sira: i + 1, baslik, kapsam: kapsam || "", sorumlu: sorumlu || "", tamamlandi: false, tamamlanmaTarihi: null };
  });
}
const IK_SURECLERI_ORTAK = [
  ["İK Süreçleri", "İşe girişinin ve özlük dosyasının hazırlanması", "Özlük dosyalarının kontrolü, sözleşme imzaları, yüz tanıtma, sicil açma vb.", "İnsan Kaynakları"],
  [null, "İK tanışma", "İK ekibi ile tanışma, iletişim kuracağı kişilerin bilgilerinin verilmesi.", "İnsan Kaynakları"],
  [null, "Hoş Geldin maili paylaşımı", "Şirket çalışanlarına işe başlama duyurusunun yapılması", "İnsan Kaynakları"],
  [null, "Ekibi hakkında genel bilgilendirme", "Ekip listesinin verilmesi", "İnsan Kaynakları"],
  [null, "Şirketin organizasyonel yapısının anlatılması", "Organizasyon şeması üzerinden şirketin genel yapısının ve birim liderlerinin anlatılması", "İnsan Kaynakları"],
  [null, "İşe alım süreçleri bilgilendirme", "İşe alım iş akışı, süreçleri ve uygulamaları hakkında bilgilendirme", "İnsan Kaynakları"],
  [null, "Zimmetlerinin teslim edilmesinin sağlanması", "Mail açılması, telefon, bilgisayar gibi zimmetlerin tesliminin IT birimi ile organize edilmesi", "IT"],
  [null, "Tesis yapısının fiziki anlatımı", "Servis saatleri, durakları, çalışma saatleri, yemekhane, tesislerin yerleri vb. bilgilendirilmesi", "İnsan Kaynakları"]
];
const ORYANTASYON_SABLONLARI_DETAYLI = {
  "satış müdürü": _oExpand([
    ...IK_SURECLERI_ORTAK,
    [null, "Ceo ile tanıştırma", "", "İnsan Kaynakları"],
    [null, "Yönetim Kurulu Başkanı ile tanıştırma", "", "İnsan Kaynakları"],
    ["Kurumsal ve Operasyonel Entegrasyon", "Satış süreçleri, oryantasyon", "Satış danışmanları başta olmak üzere kendisine bağlı olan personel ile tanıştırma", ""],
    [null, "Satış müdürleri / Şirket müdürleri ile tanıştırma", "", ""],
    [null, "Bölge Müdürü ile tanıştırma", "Online toplantı aracılığıyla bölge müdürü ile tanışma", ""],
    [null, "İn Grup Sistemleri Eğitimi", "Copilot, Rapor, Föy, Satın Alma, IT sistemlerinin tanıtımı ve kullanımı", ""],
    [null, "Takas Sistemi", "İkinci el takas süreci ve işleyişinin anlatılması", ""],
    [null, "Föy Detayları", "Tahsilat, fatura ve ek satış süreçlerinin tanıtımı", ""],
    [null, "Showroom Düzeni", "Alanların kuralları, düzeni ve müşteri karşılama alanlarının yönetimi", ""],
    [null, "Araç Alım ve Vadeler", "Araç tahsis süreçleri ve vade planlaması", ""],
    [null, "Lojistik Süreçleri", "Faturalama süreçleri, araç giriş–çıkış ve teslim organizasyonu", ""],
    [null, "PDI", "Sisteme giriş ve süreç akışının anlatımı", ""],
    [null, "Filo Kanalı", "Talep ve faturalama süreçlerinin tanıtımı", ""],
    [null, "ÖTV Kanunu ve Araç ÖTV Dilimleri", "Araç ÖTV matrahları ve katılım oranlarının açıklanması", ""],
    [null, "Kredi Dilimleri", "Araç bedeline göre kredi kullandırım limitlerinin anlatılması", ""],
    [null, "Şirket Kültürü", "Şirketin temel değerleri, olmazsa olmaz ilkeleri ve olaylara yaklaşım biçimi", ""],
    [null, "Estetik Şirketi Çalışma Prensipleri", "Araç estetik işlemleri ve satış politikaları hakkında bilgilendirme", ""],
    [null, "Oryantasyon gidişat toplantısı", "Oryantasyon konularının tamamlanma durumu hakkında İK ile görüşme", "İnsan Kaynakları"],
    ["Satış Yönetimi ve Performans Süreçleri", "Satış Danışmanı Süreçleri", "Müşteri ile ilişkilerin kuralları, danışman davranış standartları", ""],
    [null, "Müşteri Yönetimi", "Müşteri karşılama ve uğurlama süreçleri", ""],
    [null, "Müşteri İlişkileri", "Müşteri şikayetleri ve cevaplama süreçleri", ""],
    [null, "Prim Dönemleri", "Araç prim dönemleri ve ödeme tarihleri", ""],
    [null, "Tahsilat Kuralları", "Tahsilatlar ve danışmanların para ile olan ilişkilerinin kuralları", ""],
    [null, "Satış Danışmanı Performans Süreçleri", "Günlük, haftalık ve aylık hedef planlaması", ""],
    [null, "Stok Yaşı Yüksek Araç Hedefi", "Stoktaki araçlara göre prim hedefi verilmesi", ""],
    [null, "Satış Müdürü Satış Verme Politikası", "Satış müdürünün araç sattığında hangi mantıkla satış vereceği", ""],
    [null, "Prim Sisteminin Anlatılması", "Prim sisteminin genel yapısının ve kriterlerinin açıklanması", ""],
    [null, "Takip Edilen Satış KPI'ları", "Satış performansında izlenen temel göstergeler (adet, brüt kâr, müşteri memnuniyeti vb.)", ""],
    [null, "Veri Odaklı Yönetim", "Satış KPI'ları, stok yaş analizi, raporlama araçları (Power BI, Copilot entegrasyonları) konusunda uygulamalı eğitim", ""],
    [null, "2. El ile toplantı", "Süreç ve bilgi aktarımı", "2. El Birimi"],
    [null, "Mali İşler departmanı ile tanışma ve iş akışı bilgilendirmesi", "Süreç ve bilgi aktarımı", "Mali İşler Birimi"],
    [null, "Pazarlama ekibi ile işbirliği ve birlikte çalışma konularının aktarımı", "Süreç ve bilgi aktarımı", "Pazarlama Birimi"],
    ["Marka ve Stratejik Yönetim", "Marka Sistemine Kayıt", "e-Link, Salesforce, Efes sistemlerine kayıt ve temel kullanım eğitimi", ""],
    [null, "Marka Dinamikleri", "Markaların pazar payı, hedefleri ve rekabet pozisyonlarının anlatılması", ""],
    [null, "Marka Yöneticileri", "Her markaya bağlı sorumlu alanlardaki kişilerle tanışma", ""],
    [null, "Marka Eğitim", "Marka özelinde verilen eğitimlerin kapsamı ve sorumlulukları", ""],
    [null, "Raporlamalar", "Satış kayıtları, veri detayları ve rapor formatlarının tanıtımı", ""],
    [null, "Danışman Toplantıları", "Toplantı konuları, sıklığı ve zamanlama düzeni", ""],
    [null, "Marka Farklılıkları Workshopu", "Markaların farklı müşteri profilleri, satış döngüleri ve fiyatlandırma stratejileri arasındaki farkların vurgulanması", ""],
    [null, "Saha Uygulama Günü", "Satış müdürünün bir gününü showroomda danışmanlarla birlikte geçirmesi, müşteri sürecini sahada deneyimlemesi", ""],
    [null, "Oryantasyon final toplantısı", "Oryantasyon konularının tamamlanma durumu hakkında CEO ile görüşme", "İlgili Direktör"]
  ]),
  "servis müdürü": _oExpand([
    ...IK_SURECLERI_ORTAK,
    [null, "Ceo ile tanıştırma", "", "İnsan Kaynakları"],
    [null, "Yönetim Kurulu Başkanı ile tanıştırma", "", "İnsan Kaynakları"],
    ["Servis Müdürlüğü Sorumlulukları", "Veri Odaklı Yönetim", "Bayi organizasyonu içindeki diğer birimlerle koordinasyonu sağlamak, hasar toplantılarına katılmak, distribütör ile bilgi alışverişi ve raporlamaları yürütmek, atölye iş akış organizasyonunu kurmak, servis müşterilerine ait açık hesapları kontrol etmek.", ""],
    [null, "İş Akışı ve Verimlilik Takibi", "Çalışma ortamını gözlemleyerek öncelikleri belirlemek, atölye iş akışlarının verimli yürütülmesini sağlamak.", ""],
    [null, "Teknik Yönetim ve Denetim", "Teşhis konmamış, parça bekleyen araçların durumlarını takip etmek, atölye donanımlarını kontrol etmek, bakım ve yenileme planları yapmak.", ""],
    [null, "Kalite ve Teşhis Süreçleri", "Teşhis ve onarım kalitesini artırmak, iş gecikmeleri ve plan değişikliklerine yönelik önlem almak.", ""],
    [null, "Envanter ve Ekipman Yönetimi", "Servisin tüm alet, edevat, ekipman ve demirbaşlarının güvenliğini, bakım/onarımını sağlamak.", ""],
    [null, "Tesis Yönetimi", "Tesis içi ve dışı düzenin, temizliğin sağlanması, yasal belge ve süreçlerin yönetilmesi, atık yönetim planının uygulanması.", ""],
    [null, "Müşteri İlişkileri Yönetimi", "Müşteri İlişkileri Sorumlusu'ndan gelen kritik müşteri bilgilerini takip etmek, şikayetleri çözüm odaklı yönetmek.", ""],
    [null, "Müşteri Sadakati ve Pazarlama", "Mevcut müşterilerle ilişkileri güçlendirmek, filo müşterilerini düzenli ziyaret etmek, servis pazarlama faaliyetlerini planlamak.", ""],
    [null, "Mali Yönetim", "Servisin ciro ve karlılığını yönetmek, işçilik ücretlerini belirlemek, parça stokları ve tahsilat süreçlerini izlemek.", ""],
    [null, "Bütçe ve Finansal Takip", "Servis departmanı bütçesini planlamak, bütçe sapmalarını analiz etmek, karlılığı artıracak eylem planları oluşturmak.", ""],
    [null, "İnsan Kaynakları Yönetimi", "Ekip katılımını kontrol etmek, çalışan verimliliğini izlemek, yeni işe alınan personelin oryantasyonunu yürütmek.", ""],
    [null, "Ekip Motivasyonu ve Disiplin", "İnsan Kaynakları ile iş birliği içinde ekip moralini yüksek tutmak, disiplin süreçlerini yönetmek.", "İnsan Kaynakları"],
    [null, "İzin ve Devamlılık Takibi", "Ekip yıllık izin planlamasını yapmak, hastalık/doğum/vefat gibi durumlarda İnsan Kaynakları'nı bilgilendirmek.", "İnsan Kaynakları"],
    [null, "Görev Dağılımı ve Kapasite Yönetimi", "Çalışanların görev dağılımlarını yapmak, beceri ve yeteneklerine göre iş planlamak.", ""],
    ["Değerlendirme", "Oryantasyon gidişat toplantısı", "Oryantasyon konularının tamamlanma durumu hakkında İK ile görüşme", "İnsan Kaynakları"],
    [null, "Oryantasyon final toplantısı", "Oryantasyon konularının tamamlanma durumu hakkında CEO ile görüşme", "İlgili Direktör"]
  ]),
  "satış danışmanı": _oExpand([
    ...IK_SURECLERI_ORTAK,
    [null, "Servis direktörü ile tanışma", "Mevcut süreçler, hiyerarşi, iş akışı hakkında bilgilendirme", "İnsan Kaynakları"],
    ["Oryantasyon Süreçleri", "Satış Ekibi ve İş Ortakları ile Tanışma", "Showroom ekibi ve iş ortaklarıyla tanışma, ekip içi iletişim ve görev tanımlarının anlatılması.", "Satış Müdürü / İnsan Kaynakları"],
    [null, "Şirket Kültürü ve Kurallarının Aktarımı", "Şirket politikaları, çalışma saatleri, izin prosedürleri, kılık-kıyafet kuralları, marka vizyonu ve misyonunun aktarılması.", "Satış Müdürü"],
    [null, "Organizasyon Şeması ve Yönetici Görüşmesi", "Organizasyon şemasının tanıtılması, yöneticilerle tanışma, hedef ve beklentilerin paylaşılması.", "Satış Müdürü"],
    [null, "Body (Eşlikçi) Ataması ve Gölgeleme Süreci", "Yeni danışmana body atanır, showroom süreci, araç tanıtımı, teklif hazırlığı ve teslimat gözlemi yapılır.", "Body Danışman / Satış Müdürü"],
    [null, "Sistemsel Tanımlamalar ve Talep Süreçleri", "Yaka kartı, kartvizit, e-posta, sistem erişimi, kullanıcı yetkileri ve talep süreçlerinin tamamlanması.", "IT / Satış Destek"],
    [null, "Süreç ve Ürün Bilgilendirmesi", "Genel satış süreci, showroom işleyişi, müşteri karşılamaya dair bilgilendirme.", "Satış Müdürü / Body Danışman"],
    [null, "Ürün Bilgisi Eğitimi", "Ürün gamı, donanım seviyeleri, teknik özellikler ve fiyatlandırma detaylarının aktarılması.", "Satış Müdürü / Body Danışman"],
    [null, "Hizmet Bilgisi Eğitimi", "Müşteri karşılama, ihtiyaç analizi, sunum, teklif hazırlama, kredi bilgilendirme, test sürüşü, zaman yönetimi eğitimi.", "Satış Müdürü / Body Danışman"],
    [null, "Mevzuat Bilgilendirmesi", "ÖTV, KDV, kredi ve yasal mevzuat hakkında bilgi.", "Satış Müdürü / Finans"],
    [null, "Araç / Hizmet Satışı Sürecine Giriş", "Showroom'a gelen müşterinin karşılanması, ihtiyaç analizi, uygun aracın sunulması, gizli müşteri kriterlerinin öğrenilmesi.", "Satış Müdürü / Eğitim Departmanı"],
    [null, "Showroom Düzeni ve Teşhir Kontrolü", "Showroom içi ve dışı araçların temizliği, teşhir düzeni, görsel bütünlüğün korunması.", "Showroom Sorumlusu / Satış Müdürü"],
    [null, "Müşteri Takip Programı Kullanımı", "DMS, Efes vb. müşteri takip sistemlerinin doğru kullanımı, sistem kayıtlarının güncel tutulması.", "Satış Destek / MİS"],
    [null, "Sistem Kullanımı Oryantasyonu", "Markaya özel sistemler (Copilot, Takas Takip vb.) hakkında eğitim verilmesi.", "Satış Müdürü / Body Danışman"],
    [null, "Stok Kontrolü ve Yönetimi", "Araç stoklarının düzenli kontrolü, doğru tahsis ve stok hareket takibi.", "Satış Müdürü"],
    [null, "Satış Süreci ve Akışı", "Müşteri ihtiyacı belirleme, tekliflendirme, satış kapama, sözleşme hazırlığı, kredi ve sigorta süreçleri, plaka ve teslimat işlemleri.", "Satış Müdürü / Kredi Tahsis Uzmanı"],
    [null, "Takas Süreçleri", "Takas araçların değerlemesi, 2. El Sorumlusu ile koordinasyon, prosedürlere uygun teslim alma.", "2. El Sorumlusu / Satış Müdürü"],
    [null, "Finansal İşlemler", "Müşterilerin kredi yönlendirmeleri, bankalarla koordinasyon, kasko ve sigorta işlemlerinin yürütülmesi.", "Kredi Tahsis Uzmanı / Satış Müdürü"],
    [null, "Garanti ve Teslimat Süreçleri", "Garanti belgelerinin düzenlenmesi, araç tesliminde belgelerin eksiksiz sunulması.", "Satış Destek / Teslimat Sorumlusu"],
    [null, "Araç Teslimi ve Memnuniyet Araması", "Teslimatın marka standartlarına uygun yapılması, teslim sonrası müşteri memnuniyet araması.", "Satış Danışmanı / MİS"],
    [null, "Artı Garanti Satışı", "Ek garanti seçeneklerinin müşteriye sunulması ve satış sonrası süreçlere dâhil edilmesi.", "Satış Danışmanı"],
    [null, "Kalite ve Müşteri Takip Süreçleri", "Müşteri aramaları, anket ve gizli müşteri takibi, teklif adetlerinin kontrolü.", "Satış Müdürü / MİS"],
    [null, "Müşteri Şikayet Yönetimi", "Şikayetlerin çözülmesi, çözülemeyen durumların yönlendirilmesi, sonuç takibi.", "Satış Müdürü / MİS"],
    [null, "Kampanyalar ve Promosyonlar", "Güncel kampanyaların öğrenilmesi, müşterilere doğru aktarılması.", "Pazarlama / Satış Müdürü"],
    [null, "Satış Hedefleri ve Fiyat Politikası", "Satış hedeflerinin belirlenmesi, fiyat ve indirim politikalarına uyum sağlanması.", "Satış Müdürü"],
    [null, "Satış Hedef Planlaması", "Hedeflere ulaşmak için strateji oluşturulması, kişisel satış planının hazırlanması.", "Satış Müdürü"],
    [null, "Yeni Müşteri Kazanımı", "Distribütör ve yerel pazarlama faaliyetleriyle müşteri portföyünün geliştirilmesi.", "Satış Danışmanı / Pazarlama"],
    [null, "Referans Yönetimi ve Aday Takibi", "Mevcut müşterilerden referans alınması, potansiyel müşterilerin takibi.", "Satış Danışmanı / MİS"],
    [null, "Yeniden Satış Çalışmaları", "Mevcut müşterilerle yeniden iletişim kurularak yeni satış fırsatlarının yaratılması.", "Satış Danışmanı"],
    [null, "Ürün Bilgisi Geliştirme", "Araçların teknik ve rekabet avantajları hakkında sürekli bilgi güncellemesi.", "Satış Müdürü / Body Danışman"],
    [null, "Yasal Sorumluluk ve Finansal Bilgi", "Satışın yasal sonuçları, garanti ve finansman süreçleri hakkında bilgi sahibi olunması.", "Satış Müdürü / Finans"],
    [null, "Distribütör Yazılım ve Eğitimleri", "Distribütör sistemlerinin (Efes, DMS, Jato vb.) etkin kullanımı, eğitimlere katılım.", "Satış Müdürü / Body Danışman"],
    [null, "Filo ve Özel Satış İşlemleri", "Filo veya özel satış müşteri evraklarının eksiksiz hazırlanması ve teslimi.", "Filo Satış / Satış Müdürü"],
    [null, "Satış Sonrası Müşteri Takibi", "Kredi talebi ve tahsilat süreçlerinin takibi, muhasebeye iletilmesi.", "Satış Danışmanı / Muhasebe"]
  ]),
  "servis danışmanı": _oExpand([
    ...IK_SURECLERI_ORTAK,
    [null, "Servis direktörü ile tanışma", "Mevcut süreçler, hiyerarşi, iş akışı hakkında bilgilendirme", "İnsan Kaynakları"],
    ["Oryantasyon Süreçleri", "Satış Ekibi ve İş Ortakları ile Tanışma", "Showroom ekibi ve iş ortaklarıyla tanışma, ekip içi iletişim ve görev tanımlarının anlatılması.", "Servis Müdürü / İnsan Kaynakları"],
    [null, "Şirket Kültürü ve Kurallarının Aktarımı", "Şirket politikaları, çalışma saatleri, izin prosedürleri, kılık-kıyafet kuralları, marka vizyonu ve misyonunun aktarılması.", "Servis Müdürü"],
    [null, "Organizasyon Şeması ve Yönetici Görüşmesi", "Organizasyon şemasının tanıtılması, yöneticilerle tanışma, hedef ve beklentilerin paylaşılması.", "Servis Müdürü"],
    [null, "Body (Eşlikçi) Ataması ve Gölgeleme Süreci", "Yeni danışmana body atanır, showroom süreci, iş süreci, teklif hazırlığı ve teslimat gözlemi yapılır.", "Body Danışman / Servis Müdürü"],
    [null, "Sistemsel Tanımlamalar ve Talep Süreçleri", "Yaka kartı, kartvizit, e-posta, sistem erişimi, kullanıcı yetkileri ve talep süreçlerinin tamamlanması.", "IT / Satış Destek"],
    [null, "Süreç ve Ürün Bilgilendirmesi", "Genel servis süreci, showroom işleyişi, müşteri karşılamaya dair bilgilendirme.", "Servis Müdürü / Body Danışman"],
    [null, "Müşteri taleplerinin kabulü sürecine giriş", "Telefonla veya yüz yüze başvuran müşterilerin karşılanması, araç ve müşteri bilgilerinin alınması, taleplerin değerlendirilmesi.", ""],
    [null, "Randevu öncesi hazırlık", "Randevu gününden önce gerekli yedek parçaların kontrol edilmesi ve hazır bulundurulması.", ""],
    [null, "Araç kabul süreci", "Müşteri servise geldiğinde aracın teslim alınması, mevcut hasar ve eksiklerin kayıt altına alınması (5 Nokta Kontrolü), müşteri onayının alınması.", ""],
    [null, "İş Emri oluşturma", "Araç için İş Emri Formu'nun eksiksiz doldurulması, yapılacak işlemler ve tahmini maliyetlerin müşteriye açıklanması, onay alınması.", ""],
    [null, "Kampanya ve parça kontrolü", "Aracın geri çağırma kampanyalarına dahil olup olmadığının ve kullanılacak parçaların stok durumunun kontrol edilmesi.", ""],
    [null, "Araç takibi ve bilgilendirme", "Atölye sürecinde aracın ilerleyişinin takip edilmesi, yapılan işlemler hakkında müşteriye düzenli bilgi verilmesi.", ""],
    [null, "Servis satışı sürecine giriş", "Araç kabulü sırasında yapılan araç turunda ek bakım, onarım veya aksesuar ihtiyaçlarının tespiti, müşteriye sunumu ve onayı.", ""],
    [null, "Ek satış ve hizmet bilgilendirmesi", "Marka tarafından sunulan hizmetlerin, kampanyaların ve önerilen bakım işlemlerinin müşteriye anlatılması.", ""],
    [null, "Ek işlemler ve onay süreci", "Servis sürecinde ortaya çıkan ek işlemler için müşterinin bilgilendirilmesi, tahmini maliyetlerin paylaşılması.", ""],
    [null, "Tahsilat ve hesap takibi", "Haftalık olarak açık müşteri hesaplarının kontrol edilmesi, tahsilatların zamanında gerçekleşmesinin sağlanması.", ""],
    [null, "Araç teslim öncesi kontrol", "Onarımı tamamlanan araçların kontrol edilmesi, eksik/hatalı uygulamaların tespiti, aracın teslim öncesi temizlenmesi.", ""],
    [null, "Müşteriye araç teslimi", "Aracın teslimi sırasında yapılan işlemlerin, değişen parçaların ve fatura detaylarının müşteriye açıklanması.", ""],
    [null, "Faturalandırma ve ödeme işlemleri", "Tahsilat sürecinde giriş verilerinin doğruluğunun kontrolü, kredi kartı veya nakit ödeme alınması, fatura kesimi.", ""],
    [null, "Garanti dışı parça süreci", "Garanti kapsamı dışındaki değişen parçaların müşteriye gösterilmesi, isterse teslim edilmesi, iş emrine not edilip imzalanması.", ""],
    [null, "Sonraki bakım ve bilgilendirme", "Müşteriye bir sonraki bakım tarihi ve kilometre bilgisinin verilmesi, memnuniyet anketi hakkında bilgilendirme yapılması.", ""],
    [null, "Yasal bilgilendirme ve müşteri onayı", "Şirketin zorunlu gördüğü bakım/onarım işlemlerinin müşteriye açıklanması, reddetmesi durumunda imza alınması.", ""],
    [null, "Müşteri ve araç verilerinin güncellenmesi", "Her araç girişinde müşteri ve araç bilgilerinin kontrol edilmesi, sigorta, kasko, egzoz muayenesi gibi eksiklerin belirlenmesi.", ""],
    [null, "Servis sonrası süreç bilgilendirmesi", "Müşterinin araç tesliminden sonra memnuniyet anketi hakkında bilgilendirilmesi.", ""]
  ])
};
const ORYANTASYON_GENEL = _oExpand([
  ["Genel Oryantasyon", "Şirket Tanıtımı ve Kurumsal Kültür", "Şirketin tarihçesi, değerleri ve kurumsal kültürünün anlatılması", "İnsan Kaynakları"],
  [null, "İş Sağlığı ve Güvenliği Eğitimi", "Temel İSG kuralları, acil durum prosedürleri", "İnsan Kaynakları"],
  [null, "Departman ve Ekip Tanıtımı", "Bağlı olduğu departman ve ekip üyeleriyle tanıştırma", "İlgili Yönetici"],
  [null, "Görev Tanımı ve Sorumlulukların Açıklanması", "Pozisyonun görev tanımı ve beklentilerin netleştirilmesi", "İlgili Yönetici"],
  [null, "Sistem / Yazılım Erişimlerinin Tanımlanması", "Görevi için gerekli sistem ve yazılımlara erişim tanımlanması", "IT"],
  [null, "Çalışma Saatleri ve Kurumsal Kurallar", "Çalışma saatleri, izin prosedürleri, kılık-kıyafet kuralları", "İnsan Kaynakları"],
  [null, "Bordro ve Özlük İşlemleri Bilgilendirmesi", "Maaş, bordro ve özlük süreçleri hakkında bilgilendirme", "İnsan Kaynakları"],
  [null, "Şirket İçi İletişim Kanalları", "Kullanılan iletişim araçları ve bilgi akış kanalları", "İlgili Yönetici"],
  [null, "Acil Durum ve Yangın Tatbikatı Bilgilendirmesi", "Acil çıkış yolları, toplanma alanı ve yangın prosedürü", "İnsan Kaynakları"],
  [null, "İlk Hafta Değerlendirme Görüşmesi", "İlk hafta izlenimleri ve varsa sorunların görüşülmesi", "İlgili Yönetici / İnsan Kaynakları"]
]);
const UNVAN_GENEL_SABLON_ESLESME = {
  "Otomotiv Mekanikçisi": "servis_teknisyeni_genel",
  "Stajyer": "stajyer_ogrenci",
  "Otomotiv Kaporta Teknisyeni": "servis_teknisyeni_genel",
  "Oto Yıkama Elemanı": "destek_hizmetleri",
  "Yedek Parça Danışmanı": "depo_lojistik_yedek_parca",
  "Lojistik Uzmanı": "depo_lojistik_yedek_parca",
  "Müşteri İlişkileri Sorumlusu": "satis_destek_showroom",
  "İkram Görevlisi": "destek_hizmetleri",
  "Showrom Elemanı": "satis_destek_showroom",
  "Resepsiyon Elemanı": "satis_destek_showroom",
  "Analist Öğrenci": "stajyer_ogrenci",
  "Hasar Servis Danışmanı": "servis_danismanlik_destek",
  "Otomotiv Elektrik Teknisyeni": "servis_teknisyeni_genel",
  "Engelli": "idari_ofis_personeli",
  "Otomotiv Boya Teknisyeni": "servis_teknisyeni_genel",
  "Direktör": "yonetici_direktor_genel",
  "Resepsiyonst": "satis_destek_showroom",
  "Teslimat Sorumlusu": "satis_destek_showroom",
  "Marka Muhasebe Uzman Yardımcısı": "idari_ofis_personeli",
  "MARKA DİREKTÖRÜ": "yonetici_direktor_genel",
  "Otomotiv Mekanik Formeni": "servis_teknisyeni_genel",
  "Otomotiv Boya Elemanı": "servis_teknisyeni_genel",
  "Marka Muhasebe Sorumlusu": "idari_ofis_personeli",
  "Ön Düzen ve Balans Ayarcısı": "servis_teknisyeni_genel",
  "Bahçivan": "destek_hizmetleri",
  "Satın Alma Yöneticisi": "yonetici_direktor_genel",
  "Araç Alım Uzmanı": "satis_destek_showroom",
  "İnsan Kaynakları Uzman Yardımcısı": "idari_ofis_personeli",
  "Satış Şefi": "satis_destek_showroom",
  "Pazarlama Uzman Yardımcısı": "idari_ofis_personeli",
  "Expertiz Uzmanı": "servis_danismanlik_destek",
  "Pazarlama Uzmanı": "idari_ofis_personeli",
  "Garanti Uzman Yardımcısı": "servis_danismanlik_destek",
  "Finans Uzmanı": "idari_ofis_personeli",
  "Vezne": "idari_ofis_personeli",
  "İc Denetim Uzmanı": "idari_ofis_personeli",
  "Hasar Servis Müdürü": "yonetici_direktor_genel",
  "Araç Alım Yöneticisi": "yonetici_direktor_genel",
  "Lpg Bakım Teknisyeni": "servis_teknisyeni_genel",
  "Trim Teknisyeni": "servis_teknisyeni_genel",
  "Servis Teknik Danışman": "servis_danismanlik_destek",
  "Ev Temizlik Görevlisi": "destek_hizmetleri",
  "Ceo": "yonetici_direktor_genel",
  "Şoför": "destek_hizmetleri",
  "Gemi": "destek_hizmetleri",
  "Randevu Planlama Sorumlusu": "servis_danismanlik_destek",
  "Otomotiv Boya Formeni": "servis_teknisyeni_genel",
  "Oto Yıkama Yöneticisi": "yonetici_direktor_genel",
  "Kıdemli Servis Danışmanı": "servis_danismanlik_destek",
  "Servis Resepsiyonist": "servis_danismanlik_destek",
  "Atölye Takip Uzmanı": "servis_danismanlik_destek",
  "Kredi Görevlisi": "satis_destek_showroom",
  "FİLO SATIŞ MÜDÜRÜ": "yonetici_direktor_genel",
  "SERVİS MÜHENDİSİ": "servis_danismanlik_destek",
  "Bilgi İşlem Yardımcısı": "idari_ofis_personeli",
  "İş Geliştirme Uzmanı": "idari_ofis_personeli",
  "Ceo Teknik Asistanı": "idari_ofis_personeli",
  "DİJİTAL DÖNÜŞÜM & PAZARLAMA & STRATEJİ GENEL MÜDÜR YARDIMCISI": "yonetici_direktor_genel",
  "Atölye Şefi": "servis_teknisyeni_genel",
  "Araç Hazırlama Uzmanı": "satis_destek_showroom",
  "Vale": "destek_hizmetleri",
  "Genius": "satis_destek_showroom",
  "Finans Yöneticisi": "yonetici_direktor_genel",
  "Sosyal Medya Uzmanı": "idari_ofis_personeli",
  "Kıdemli Satış Danışmanı": "satis_destek_showroom",
  "Bilgi İşlem Yöneticisi": "yonetici_direktor_genel",
  "Bordro Ve Özlük İşleri Uzmanı": "idari_ofis_personeli",
  "Kalite Kontrol Teknisyeni": "servis_teknisyeni_genel",
  "Pazarlama Müdürü": "yonetici_direktor_genel",
  "MALİ İŞLER GENEL MÜDÜR YARDIMCISI": "yonetici_direktor_genel",
  "Yat Hostesi": "destek_hizmetleri",
  "Ek Satışlardan Sorumlu Müdür": "yonetici_direktor_genel",
  "BİNA-ELEKTRİK BAKIM TEKNİSYENİ": "destek_hizmetleri",
  "Yedek Parça Yöneticisi": "yonetici_direktor_genel",
  "Plaza Bakım Teknisyeni": "destek_hizmetleri",
  "Muhasebe Yöneticisi": "yonetici_direktor_genel",
  "Yönetim Kurulu Başkanı": "yonetici_direktor_genel",
  "Plaka Tescil Sorumlusu": "satis_destek_showroom",
  "Garanti Uzmanı": "servis_danismanlik_destek",
  "Kredi Tahsis Uzmanı": "satis_destek_showroom",
  "Aktif Satış Danışmanı": "satis_destek_showroom"
};

const ORYANTASYON_SABLONLARI_GENEL_GRUPLAR = {
  "servis_teknisyeni_genel": {
    adi: "Servis Teknisyeni / Atölye Personeli Genel Oryantasyonu",
    maddeler: [
      { kategori: "İK SÜREÇLERİ", sira: 1, baslik: "Özlük Dosyası ve İşe Giriş Evrakları", kapsam: "İşe giriş evraklarının (kimlik fotokopisi, sağlık raporu, adli sicil kaydı, ikametgah, banka hesap bilgileri) eksiksiz teslim alınması ve özlük dosyasının oluşturulması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 2, baslik: "SGK İşe Giriş Bildirgesi ve Bordro Bilgilendirmesi", kapsam: "Sigorta girişinin yapılması, ücret/prim/mesai politikalarının ve bordro kesim tarihlerinin çalışana anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İş Sağlığı ve Güvenliği", sira: 3, baslik: "İSG Temel Eğitimi ve Kişisel Koruyucu Donanım (KKD) Teslimi", kapsam: "Atölye ortamında iş güvenliği kurallarının, acil durum prosedürlerinin anlatılması; iş ayakkabısı, eldiven, gözlük, tulum gibi KKD'lerin zimmetle teslim edilmesi.", sorumlu: "İş Sağlığı ve Güvenliği Uzmanı" },
      { kategori: "İş Sağlığı ve Güvenliği", sira: 4, baslik: "Yangın, Kaza ve Acil Durum Tatbikat Bilgilendirmesi", kapsam: "Atölyedeki yangın söndürme ekipmanlarının yerleri, acil çıkış noktaları, iş kazası bildirim prosedürünün aktarılması.", sorumlu: "İş Sağlığı ve Güvenliği Uzmanı / Servis Müdürü" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 5, baslik: "Atölye ve Tesis Tanıtımı", kapsam: "Atölye bölümlerinin (mekanik, kaporta-boya, elektrik, yıkama, yedek parça deposu) gezdirilmesi, dinlenme/soyunma alanlarının gösterilmesi.", sorumlu: "Formen / Servis Müdürü" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 6, baslik: "Ekip ve Yönetim ile Tanışma", kapsam: "Servis Müdürü, formen, servis danışmanları ve diğer teknisyenlerle tanıştırılması, raporlama hattının netleştirilmesi.", sorumlu: "Servis Müdürü" },
      { kategori: "Teknik Sistemler ve Ekipman", sira: 7, baslik: "İş Emri Takip Sistemi Kullanım Eğitimi", kapsam: "Servis iş emri/DMS sisteminde iş emri açma, parça talep etme, işçilik girişi yapma adımlarının uygulamalı anlatılması.", sorumlu: "IT / Servis Müdürü" },
      { kategori: "Teknik Sistemler ve Ekipman", sira: 8, baslik: "Marka Teknik Bilgi Sistemlerine (WIS/EPC vb.) Erişim Tanımlama", kapsam: "Aracın markasına özgü teknik döküman, arıza kodu ve parça kataloğu sistemlerine kullanıcı erişiminin açılması ve temel kullanımın gösterilmesi.", sorumlu: "IT / Teknik Şef" },
      { kategori: "Teknik Sistemler ve Ekipman", sira: 9, baslik: "Kişisel Takım Çantası ve Ortak Ekipman Zimmeti", kapsam: "Kişisel el aletlerinin, teşhis cihazlarının ve kaldırma ekipmanlarının teslim/zimmet kaydının yapılması, kullanım kurallarının anlatılması.", sorumlu: "Formen / Atölye Şefi" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 10, baslik: "Kalite Standartları ve Marka Servis Prosedürleri", kapsam: "Markanın onaylı işçilik standartları, garanti kapsamındaki işlemlerde izlenmesi gereken prosedürler ve kalite kontrol adımlarının aktarılması.", sorumlu: "Servis Müdürü / Kalite Kontrol" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 11, baslik: "Müşteri Aracına Müdahale ve Hasar Önleme Kuralları", kapsam: "Müşteri araçlarının teslim alınması, iç/dış kontrol formu doldurulması, araç içi eşyaların korunması ve ek hasar oluşumunun önlenmesine dair kuralların anlatılması.", sorumlu: "Servis Danışmanı / Formen" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 12, baslik: "Ustalık/Yeterlilik Belgeleri ve Marka Sertifikasyon Takvimi", kapsam: "Mesleki yeterlilik belgesi (MYK) durumunun kontrolü, markanın zorunlu teknik eğitim/sertifikasyon takviminin çalışana bildirilmesi.", sorumlu: "İnsan Kaynakları / Servis Müdürü" },
      { kategori: "İK SÜREÇLERİ", sira: 13, baslik: "Performans Değerlendirme ve Prim Sistemi Bilgilendirmesi", kapsam: "Verimlilik/işçilik saatleri bazlı prim sisteminin, dönemsel performans değerlendirme kriterlerinin anlatılması.", sorumlu: "Servis Müdürü / İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 14, baslik: "Mesai, İzin ve Vardiya Planlama Kuralları", kapsam: "Vardiya sistemi, mesai/fazla mesai onay süreci, yıllık izin ve rapor bildirim prosedürünün aktarılması.", sorumlu: "Servis Müdürü / İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 15, baslik: "Atık Yönetimi ve Çevre Mevzuatı Bilgilendirmesi", kapsam: "Atık yağ, akü, lastik gibi atölye atıklarının mevzuata uygun ayrıştırılması ve bertaraf süreçlerinin anlatılması.", sorumlu: "Servis Müdürü / İSG Uzmanı" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 16, baslik: "30 Günlük Deneme Süresi Değerlendirme Görüşmesi", kapsam: "İlk ay sonunda teknik uyum, güvenlik kurallarına riayet ve ekip entegrasyonu konularında geri bildirim görüşmesi yapılması.", sorumlu: "Servis Müdürü / İnsan Kaynakları" },
    ]
  },
  "servis_danismanlik_destek": {
    adi: "Servis Danışmanlık ve Müşteri Destek Personeli Oryantasyonu",
    maddeler: [
      { kategori: "İK SÜREÇLERİ", sira: 1, baslik: "Özlük Dosyası ve İşe Giriş Evrakları", kapsam: "Kimlik, adli sicil, sağlık raporu, banka hesap bilgileri gibi işe giriş evraklarının teslim alınıp özlük dosyasının oluşturulması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 2, baslik: "SGK Girişi ve Bordro/Ücret Bilgilendirmesi", kapsam: "Sigorta girişi işlemleri, maaş ödeme günü, prim ve varsa hedef bazlı ek ödeme sisteminin anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 3, baslik: "Servis Danışma Alanı ve Tesis Tanıtımı", kapsam: "Servis karşılama, danışma masası, bekleme salonu, atölye giriş noktaları ve ilgili birimlerin gezdirilmesi.", sorumlu: "Servis Müdürü" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 4, baslik: "Servis Ekibi ve Raporlama Hattı ile Tanışma", kapsam: "Servis Müdürü, servis danışmanları, formen ve teknisyenlerle tanıştırılması; günlük raporlama ve iletişim akışının anlatılması.", sorumlu: "Servis Müdürü" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 5, baslik: "DMS / Servis Randevu Sistemi Kullanım Eğitimi", kapsam: "Randevu oluşturma, iş emri açma, müşteri kaydı ve araç geçmişi sorgulama işlemlerinin uygulamalı gösterilmesi.", sorumlu: "IT / Servis Müdürü" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 6, baslik: "Garanti / Ekspertiz Talep Sistemine Erişim Tanımlama", kapsam: "Marka garanti başvuru portalı veya ekspertiz raporlama sistemine kullanıcı tanımının açılması ve temel işlem adımlarının anlatılması.", sorumlu: "IT / Garanti Sorumlusu" },
      { kategori: "Müşteri Hizmetleri Süreçleri", sira: 7, baslik: "Araç Teslim Alma ve Check-in Prosedürü", kapsam: "Müşteri aracının hasar/km/yakıt kontrolü ile teslim alınması, dijital check-in formunun doldurulması ve müşteriye bilgi verilmesinin standartlarının anlatılması.", sorumlu: "Kıdemli Servis Danışmanı" },
      { kategori: "Müşteri Hizmetleri Süreçleri", sira: 8, baslik: "Fiyat Teklifi Sunumu ve Onay Süreci", kapsam: "İş emri kapsamının, ek işlemler için müşteri onayı alma sürecinin ve fiyatlandırma limitlerinin anlatılması.", sorumlu: "Servis Müdürü" },
      { kategori: "Müşteri Hizmetleri Süreçleri", sira: 9, baslik: "Müşteri Şikayeti ve Memnuniyet Yönetimi", kapsam: "Şikayet kayıt sistemine giriş, eskalasyon süreci ve müşteri memnuniyeti anketi (CSI) sonuçlarının takibine dair bilgilendirme.", sorumlu: "Servis Müdürü / Müşteri İlişkileri" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 10, baslik: "Garanti ve Ekspertiz Mevzuatı / Marka Prosedürleri", kapsam: "Garanti kapsamı, tüketici hakları mevzuatı ve markanın ekspertiz/hasar değerlendirme standartlarının aktarılması.", sorumlu: "Servis Müdürü / Hukuk Danışmanı" },
      { kategori: "İş Sağlığı ve Güvenliği", sira: 11, baslik: "Atölye Alanında Temel Güvenlik Bilgilendirmesi", kapsam: "Müşteri danışmanlarının atölye içinde bulunacağı durumlarda uyması gereken güvenlik kurallarının ve KKD kullanım alanlarının anlatılması.", sorumlu: "İş Sağlığı ve Güvenliği Uzmanı" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 12, baslik: "Randevu Planlama ve Kapasite Yönetimi", kapsam: "Atölye kapasitesine göre randevu dağılımı, iş yükü dengeleme ve gecikme yönetimi prensiplerinin anlatılması.", sorumlu: "Randevu Planlama Sorumlusu / Servis Müdürü" },
      { kategori: "Satış Yönetimi ve Performans Süreçleri", sira: 13, baslik: "Servis Performans Göstergeleri (KPI) Bilgilendirmesi", kapsam: "Müşteri memnuniyeti (CSI), randevu doluluk oranı, ek satış (upsell) hedefleri gibi performans göstergelerinin tanıtılması.", sorumlu: "Servis Müdürü" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 14, baslik: "Telefon ve CRM İletişim Standartları Eğitimi", kapsam: "Müşteri aramalarında kullanılacak karşılama cümleleri, CRM üzerinden takip notu girme ve randevu hatırlatma süreçlerinin anlatılması.", sorumlu: "Müşteri İlişkileri / Servis Müdürü" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 15, baslik: "30 Günlük Deneme Süresi Değerlendirme Görüşmesi", kapsam: "İlk ay sonunda süreç uyumu, sistem kullanım becerisi ve müşteri iletişimi konularında geri bildirim görüşmesi yapılması.", sorumlu: "Servis Müdürü / İnsan Kaynakları" },
    ]
  },
  "satis_destek_showroom": {
    adi: "Satış Destek ve Showroom Personeli Oryantasyonu",
    maddeler: [
      { kategori: "İK SÜREÇLERİ", sira: 1, baslik: "Özlük Dosyası ve İşe Giriş Evrakları", kapsam: "İşe giriş için gerekli kimlik, sağlık raporu, adli sicil kaydı ve banka bilgilerinin teslim alınarak özlük dosyasının oluşturulması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 2, baslik: "SGK Girişi, Bordro ve Prim Sistemi Bilgilendirmesi", kapsam: "Sigorta girişi, maaş ödeme takvimi ve satış/teslimat bazlı prim hesaplama sisteminin anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 3, baslik: "Showroom, Teslimat Alanı ve Genel Tesis Tanıtımı", kapsam: "Showroom teşhir alanı, teslimat bölümü, müşteri bekleme alanları ve ilgili departmanların gezdirilmesi.", sorumlu: "Satış Müdürü" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 4, baslik: "Satış Ekibi ile Tanışma ve Raporlama Hattı", kapsam: "Satış Müdürü, satış danışmanları ve destek birimleriyle tanıştırılması; günlük iş akışı ve raporlama düzeninin anlatılması.", sorumlu: "Satış Müdürü" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 5, baslik: "CRM / DMS Müşteri Kayıt Sistemi Eğitimi", kapsam: "Müşteri adayı (lead) kaydı oluşturma, randevu/teslimat takibi ve satış sonrası takip notlarının sisteme işlenmesinin uygulamalı gösterilmesi.", sorumlu: "IT / Satış Destek" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 6, baslik: "Showroom Teşhir ve Demo Araç Kullanım Kuralları", kapsam: "Teşhir araçlarının anahtar teslim prosedürü, test sürüşü kuralları ve demo araç bakım/temizlik sorumluluklarının anlatılması.", sorumlu: "Showroom Sorumlusu / Satış Müdürü" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 7, baslik: "Marka Showroom Görsel Standartları (Corporate Identity)", kapsam: "Araç teşhir düzeni, fiyat etiketleme, tanıtım materyalleri ve showroom temizlik/düzen standartlarının anlatılması.", sorumlu: "Satış Müdürü" },
      { kategori: "Müşteri Hizmetleri Süreçleri", sira: 8, baslik: "Müşteri Karşılama ve Yönlendirme Standartları", kapsam: "Showroom'a gelen müşterinin karşılanması, ilgili satış danışmanına yönlendirilmesi ve bekleme sürecinde ikram/bilgilendirme standartlarının anlatılması.", sorumlu: "Müşteri İlişkileri Sorumlusu / Satış Müdürü" },
      { kategori: "Satış Yönetimi ve Performans Süreçleri", sira: 9, baslik: "Araç Teslimat Süreci ve Evrak Yönetimi", kapsam: "Fatura, ruhsat, ÖTV/KDV belgeleri, sigorta poliçesi ve trafik tescil işlemlerinin teslimat öncesi eksiksiz hazırlanmasına dair sürecin anlatılması.", sorumlu: "Teslimat Sorumlusu / Satış Müdürü" },
      { kategori: "Satış Yönetimi ve Performans Süreçleri", sira: 10, baslik: "Trafik Tescil ve Plaka İşlemleri Süreci", kapsam: "Noter, trafik tescil bürosu ve sigorta şirketleriyle yürütülen araç tescil/plaka işlemlerinin adımlarının ve kullanılan belgelerin anlatılması.", sorumlu: "Plaka Tescil Sorumlusu / Satış Müdürü" },
      { kategori: "Satış Yönetimi ve Performans Süreçleri", sira: 11, baslik: "Kredi ve Finansman Süreçleri", kapsam: "Banka/finans kurumu kredi başvuru sistemleri, gerekli evraklar ve kredi onay/tahsis sürecinin adım adım anlatılması.", sorumlu: "Kredi Tahsis Uzmanı / Satış Müdürü" },
      { kategori: "Satış Yönetimi ve Performans Süreçleri", sira: 12, baslik: "İkinci El Araç Alım ve Ekspertiz Değerleme Süreci", kapsam: "Takas/ikinci el araç kabul kriterleri, ekspertiz raporu değerlendirme ve fiyatlandırma sürecinin anlatılması.", sorumlu: "Araç Alım Uzmanı / Satış Müdürü" },
      { kategori: "Satış Yönetimi ve Performans Süreçleri", sira: 13, baslik: "Araç Hazırlama (PDI) ve Teslimat Öncesi Kontrol Standartları", kapsam: "Yeni araçların teslimat öncesi temizlik, aksesuar montajı ve PDI (Pre-Delivery Inspection) kontrol listesinin uygulanmasının anlatılması.", sorumlu: "Araç Hazırlama Uzmanı / Servis Müdürü" },
      { kategori: "Marka ve Stratejik Yönetim", sira: 14, baslik: "Marka Ürün ve Teknoloji Bilgisi Eğitimi", kapsam: "Satılan araç modellerinin teknik özellikleri, teknoloji donanımları ve rakip karşılaştırmalarına yönelik ürün eğitiminin planlanması.", sorumlu: "Satış Müdürü / Marka Eğitim Birimi" },
      { kategori: "Satış Yönetimi ve Performans Süreçleri", sira: 15, baslik: "Satış Hedefleri ve Prim Sistemi Bilgilendirmesi", kapsam: "Aylık/yıllık satış ve teslimat hedeflerinin, prim hesaplama kriterlerinin ve performans takip sisteminin anlatılması.", sorumlu: "Satış Müdürü" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 16, baslik: "30 Günlük Deneme Süresi Değerlendirme Görüşmesi", kapsam: "İlk ay sonunda sistem kullanımı, müşteri iletişimi ve ekip uyumu konularında geri bildirim görüşmesi yapılması.", sorumlu: "Satış Müdürü / İnsan Kaynakları" },
    ]
  },
  "idari_ofis_personeli": {
    adi: "İdari / Ofis Personeli Oryantasyonu",
    maddeler: [
      { kategori: "İK SÜREÇLERİ", sira: 1, baslik: "Özlük Dosyası ve İşe Giriş Evrakları", kapsam: "Kimlik, sağlık raporu, adli sicil kaydı, diploma ve banka hesap bilgileri gibi işe giriş evraklarının teslim alınıp özlük dosyasının oluşturulması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 2, baslik: "SGK Girişi ve Bordro/Ücret Bilgilendirmesi", kapsam: "Sigorta girişi, maaş ödeme günü, yan haklar (yemek/yol vb.) ve bordro erişim sisteminin anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 3, baslik: "Genel Merkez / Ofis Tesis Tanıtımı", kapsam: "Ofis yerleşimi, toplantı odaları, arşiv, mutfak ve ilgili departmanların gezdirilmesi.", sorumlu: "İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 4, baslik: "Departman Yöneticisi ve Ekip ile Tanışma", kapsam: "Bağlı olunan yönetici ve departman çalışanlarıyla tanıştırılması, raporlama hattının ve iletişim akışının netleştirilmesi.", sorumlu: "İlgili Departman Yöneticisi" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 5, baslik: "Bilgisayar, E-posta ve Kurumsal Hesap Tanımlamaları", kapsam: "Şirket bilgisayarı, kurumsal e-posta adresi, dahili telefon hattı ve gerekli yazılım lisanslarının tanımlanması.", sorumlu: "IT / Bilgi İşlem" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 6, baslik: "ERP / Muhasebe / Departman Yazılımlarına Erişim Tanımlama", kapsam: "Görev alanına uygun ERP, muhasebe, İK veya pazarlama otomasyon sistemlerine kullanıcı yetkisinin açılması ve temel kullanımın gösterilmesi.", sorumlu: "IT / İlgili Departman Yöneticisi" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 7, baslik: "Şirket Organizasyon Şeması ve İletişim Politikaları", kapsam: "Genel organizasyon yapısının, departmanlar arası iletişim kurallarının ve kurumsal iletişim kanallarının (intranet, duyuru panosu vb.) tanıtılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 8, baslik: "Evrak/İmza Yetki Matrisi ve Onay Süreçleri", kapsam: "Harcama, sözleşme ve evrak onay süreçlerinde yetki sınırlarının ve imza sirkülerinin anlatılması.", sorumlu: "İlgili Departman Yöneticisi" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 9, baslik: "KVKK, Bilgi Güvenliği ve Gizlilik Politikaları Eğitimi", kapsam: "Kişisel verilerin korunması mevzuatı, şirket bilgi güvenliği politikaları ve gizlilik taahhütnamesinin imzalatılması.", sorumlu: "İnsan Kaynakları / Hukuk Danışmanı" },
      { kategori: "İK SÜREÇLERİ", sira: 10, baslik: "İzin, Mesai ve Rapor Bildirim Prosedürleri", kapsam: "Yıllık izin talep sistemi, mesai onay süreci ve sağlık raporu bildirim prosedürünün anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 11, baslik: "Görev Alanına Özgü Temel Süreç Eğitimi", kapsam: "Çalışanın görev tanımına uygun temel iş süreçlerinin (muhasebe kayıt akışı, pazarlama kampanya süreci, İK işe alım süreci vb.) departman yöneticisi tarafından uygulamalı anlatılması.", sorumlu: "İlgili Departman Yöneticisi" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 12, baslik: "Şirket İçi Toplantı ve Raporlama Takvimi", kapsam: "Departman içi periyodik toplantılar, aylık raporlama beklentileri ve kullanılan raporlama şablonlarının tanıtılması.", sorumlu: "İlgili Departman Yöneticisi" },
      { kategori: "İK SÜREÇLERİ", sira: 13, baslik: "Performans Değerlendirme Sistemi Bilgilendirmesi", kapsam: "Dönemsel hedef belirleme, performans değerlendirme kriterleri ve kariyer gelişim sürecinin anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 14, baslik: "Çalışma Ortamı Uyum ve Erişilebilirlik Değerlendirmesi", kapsam: "Gerekli hallerde çalışma ortamının, ekipmanların ve iş akışının çalışanın ihtiyaçlarına göre uyarlanması için İK ve İSG ile birlikte değerlendirme yapılması.", sorumlu: "İnsan Kaynakları / İş Sağlığı ve Güvenliği Uzmanı" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 15, baslik: "30 Günlük Deneme Süresi Değerlendirme Görüşmesi", kapsam: "İlk ay sonunda görev uyumu, sistem kullanım becerisi ve ekip entegrasyonu hakkında geri bildirim görüşmesi yapılması.", sorumlu: "İlgili Departman Yöneticisi / İnsan Kaynakları" },
    ]
  },
  "yonetici_direktor_genel": {
    adi: "Yönetici / Direktör Genel Oryantasyonu",
    maddeler: [
      { kategori: "İK SÜREÇLERİ", sira: 1, baslik: "Özlük Dosyası ve İş Sözleşmesi İmzası", kapsam: "Yönetici düzeyi iş sözleşmesinin, gizlilik/rekabet yasağı maddelerinin ve özlük evraklarının eksiksiz teslim alınması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 2, baslik: "Ücret Paketi ve Yan Haklar Bilgilendirmesi", kapsam: "Maaş, prim/bonus sistemi, şirket aracı, özel sağlık sigortası gibi yönetici yan haklarının detaylı olarak anlatılması.", sorumlu: "İnsan Kaynakları / Genel Müdürlük" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 3, baslik: "Şirket Geneli Tesis ve Lokasyon Tanıtım Turu", kapsam: "Sorumlu olunan şube(ler) ve varsa diğer grup şirketi lokasyonlarının üst düzey tanıtım turu ile gezdirilmesi.", sorumlu: "İnsan Kaynakları / Genel Müdürlük" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 4, baslik: "Üst Yönetim ve Yönetim Kurulu ile Tanışma", kapsam: "Yönetim kurulu üyeleri, genel müdür ve diğer üst düzey yöneticilerle tanıştırma toplantılarının planlanması.", sorumlu: "Genel Müdürlük / İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 5, baslik: "Şirket Vizyon, Misyon ve Kurumsal Strateji Sunumu", kapsam: "Grup şirketinin stratejik hedeflerinin, büyüme planlarının ve değerlerinin üst düzey bir sunumla aktarılması.", sorumlu: "Genel Müdürlük" },
      { kategori: "Marka ve Stratejik Yönetim", sira: 6, baslik: "Temsil Edilen Marka Portföyü ve Bayilik Yapısı Bilgilendirmesi", kapsam: "Grup bünyesindeki markaların, bayilik anlaşmalarının ve marka bazlı organizasyon yapısının tanıtılması.", sorumlu: "Genel Müdürlük / Marka Direktörü" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 7, baslik: "Organizasyon Şeması, Bağlı Birimler ve Raporlama Hattı", kapsam: "Yönetim ettiği ekip ve birimlerin organizasyon şemasındaki yeri, kendisine ve kendisinden raporlama yapan kişilerin netleştirilmesi.", sorumlu: "İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 8, baslik: "Bütçe, Harcama Onay Yetkileri ve İmza Sirküleri", kapsam: "Departman bütçesi, harcama onay limitleri ve şirket imza sirkülerindeki yetki kapsamının anlatılması.", sorumlu: "Mali İşler / Genel Müdürlük" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 9, baslik: "Yönetim Raporlama Sistemleri (BI/ERP) Erişim Tanımlama", kapsam: "Satış, servis, finans gibi alanlardaki üst düzey raporlama panellerine (BI dashboard, ERP yönetici modülü) erişimin tanımlanması.", sorumlu: "IT / Bilgi İşlem" },
      { kategori: "Marka ve Stratejik Yönetim", sira: 10, baslik: "Yönetim Kurulu Toplantı Takvimi ve Raporlama Formatları", kapsam: "Aylık/üç aylık yönetim toplantılarının takvimi, sunum ve raporlama formatlarının standartlarının aktarılması.", sorumlu: "Genel Müdürlük" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 11, baslik: "İnsan Kaynakları Süreçlerindeki Yönetici Sorumlulukları", kapsam: "İşe alım onayı, performans değerlendirme, disiplin süreçleri ve terfi kararlarında yöneticinin rolünün ve yetkilerinin anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 12, baslik: "Kurumsal İletişim ve Basın/Medya Temsil Politikası", kapsam: "Şirket adına kamuoyu, basın veya sosyal medya açıklaması yapma yetkisinin sınırlarının ve kurumsal iletişim biriminin sürece dahil edilme kurallarının anlatılması.", sorumlu: "Kurumsal İletişim / Genel Müdürlük" },
      { kategori: "Marka ve Stratejik Yönetim", sira: 13, baslik: "Departman/Şube Hedefleri ve KPI Sahipliği", kapsam: "Sorumlu olunan birimin yıllık satış/kârlılık/verimlilik hedeflerinin ve bu hedeflerin takip edileceği KPI setinin devralınması.", sorumlu: "Genel Müdürlük" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 14, baslik: "Kriz Yönetimi ve Acil Durum Karar Mekanizması Bilgilendirmesi", kapsam: "Operasyonel kriz, itibar riski veya acil durum hallerinde karar alma sürecinin, eskalasyon hattının ve iletişim protokolünün anlatılması.", sorumlu: "Genel Müdürlük / İSG Uzmanı" },
      { kategori: "İK SÜREÇLERİ", sira: 15, baslik: "Yıllık Hedef Sözleşmesi ve Üst Düzey Performans Değerlendirmesi", kapsam: "Yıllık bireysel hedeflerin belirlenmesi, hedef sözleşmesinin imzalanması ve üst düzey performans değerlendirme takviminin anlatılması.", sorumlu: "İnsan Kaynakları / Genel Müdürlük" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 16, baslik: "30-60-90 Günlük Uyum Değerlendirme Görüşmeleri", kapsam: "İlk 30, 60 ve 90 gün sonunda stratejik uyum, ekip liderliği ve hedeflere ilerleme konularında kademeli değerlendirme görüşmelerinin yapılması.", sorumlu: "Genel Müdürlük / İnsan Kaynakları" },
    ]
  },
  "depo_lojistik_yedek_parca": {
    adi: "Depo / Lojistik / Yedek Parça Personeli Oryantasyonu",
    maddeler: [
      { kategori: "İK SÜREÇLERİ", sira: 1, baslik: "Özlük Dosyası ve İşe Giriş Evrakları", kapsam: "Kimlik, sağlık raporu, adli sicil kaydı ve banka bilgileri gibi işe giriş evraklarının teslim alınıp özlük dosyasının oluşturulması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 2, baslik: "SGK Girişi ve Bordro Bilgilendirmesi", kapsam: "Sigorta girişi işlemleri, maaş ödeme takvimi ve varsa performans primi sisteminin anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İş Sağlığı ve Güvenliği", sira: 3, baslik: "Depo İş Güvenliği ve KKD Eğitimi", kapsam: "Raf istifleme, ağır yük kaldırma, forklift/transpalet çevresinde güvenli hareket kuralları ve gerekli KKD'lerin (eldiven, çelik burunlu ayakkabı) teslimi.", sorumlu: "İş Sağlığı ve Güvenliği Uzmanı" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 4, baslik: "Depo / Yedek Parça Bölümü Tesis Tanıtımı", kapsam: "Depo yerleşim planı, raf/lokasyon sistemi, sevkiyat ve mal kabul alanlarının gezdirilmesi.", sorumlu: "Yedek Parça Müdürü / Depo Sorumlusu" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 5, baslik: "Ekip ve Raporlama Hattı ile Tanışma", kapsam: "Yedek parça/lojistik ekibi, servis ve satış birimleriyle olan iş ilişkisinin ve raporlama hattının anlatılması.", sorumlu: "Yedek Parça Müdürü" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 6, baslik: "Stok Yönetim / ERP Sistemi Kullanım Eğitimi", kapsam: "Stok giriş-çıkış, parça rezervasyonu, minimum stok seviyesi takibi ve sipariş oluşturma işlemlerinin uygulamalı anlatılması.", sorumlu: "IT / Yedek Parça Müdürü" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 7, baslik: "Marka Parça Katalog Sistemi (EPC) Kullanım Eğitimi", kapsam: "Parça numarası sorgulama, muadil/orijinal parça karşılaştırması ve fiyatlandırma sisteminin anlatılması.", sorumlu: "Yedek Parça Müdürü" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 8, baslik: "Tedarikçi ve Lojistik Firmalarıyla Koordinasyon Süreci", kapsam: "Merkez depo, ithalatçı ve nakliye firmalarıyla sipariş takibi, teslim süreleri ve sevkiyat koordinasyonunun anlatılması.", sorumlu: "Lojistik Uzmanı / Yedek Parça Müdürü" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 9, baslik: "Sayım ve Envanter Kontrol Prosedürleri", kapsam: "Periyodik/yıllık stok sayımı, fire ve fark yönetimi ile envanter doğruluğunun sağlanmasına dair prosedürlerin anlatılması.", sorumlu: "Yedek Parça Müdürü" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 10, baslik: "İade ve Garanti Kapsamlı Parça Süreçleri", kapsam: "Arızalı/garanti kapsamındaki parçaların iade süreci, etiketleme ve üretici/ithalatçıya geri gönderim prosedürünün anlatılması.", sorumlu: "Yedek Parça Müdürü / Garanti Sorumlusu" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 11, baslik: "Araç ve Parça Sevkiyat/Nakliye Planlaması", kapsam: "Şubeler arası araç/parça transferi, nakliye araçlarının planlanması ve sevkiyat evraklarının (irsaliye vb.) düzenlenmesinin anlatılması.", sorumlu: "Lojistik Uzmanı" },
      { kategori: "İş Sağlığı ve Güvenliği", sira: 12, baslik: "Forklift/Transpalet Kullanım Yetkinlik Kontrolü", kapsam: "Forklift veya transpalet kullanacak personelin operatör sertifikasının kontrolü ve gerekli ise sertifikasyon sürecinin planlanması.", sorumlu: "İş Sağlığı ve Güvenliği Uzmanı" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 13, baslik: "Depo Düzeni ve Lokasyon Kodlama Sistemi", kapsam: "Raf/lokasyon kodlama mantığının, hızlı hareket eden (fast-moving) parçaların yerleşiminin ve düzen standartlarının anlatılması.", sorumlu: "Depo Sorumlusu" },
      { kategori: "Müşteri Hizmetleri Süreçleri", sira: 14, baslik: "İç Müşteri (Servis/Satış) Talep Karşılama Standartları", kapsam: "Servis ve satış ekiplerinden gelen parça taleplerinin önceliklendirilmesi, acil parça temini ve iletişim standartlarının anlatılması.", sorumlu: "Yedek Parça Müdürü" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 15, baslik: "30 Günlük Deneme Süresi Değerlendirme Görüşmesi", kapsam: "İlk ay sonunda sistem kullanımı, iş güvenliği kurallarına uyum ve süreç hakimiyeti konularında geri bildirim görüşmesi yapılması.", sorumlu: "Yedek Parça Müdürü / İnsan Kaynakları" },
    ]
  },
  "destek_hizmetleri": {
    adi: "Destek Hizmetleri Personeli Oryantasyonu",
    maddeler: [
      { kategori: "İK SÜREÇLERİ", sira: 1, baslik: "Özlük Dosyası ve İşe Giriş Evrakları", kapsam: "Kimlik, sağlık raporu (gerekli ise gıda/hijyen sertifikası), adli sicil kaydı ve banka bilgilerinin teslim alınarak özlük dosyasının oluşturulması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 2, baslik: "SGK Girişi, Bordro ve Vardiya/Puantaj Sistemi Bilgilendirmesi", kapsam: "Sigorta girişi, maaş ödeme takvimi ve vardiyalı çalışma düzeninde puantaj/giriş-çıkış takip sisteminin anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 3, baslik: "Tesis ve Çalışma Alanı Tanıtımı", kapsam: "Görev yapılacak alanın (showroom, atölye, bahçe, bina teknik alanları vb.) ve malzeme/ekipman depolarının gezdirilmesi.", sorumlu: "İlgili Birim Sorumlusu" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 4, baslik: "Amir/Yönetici ve Çalışma Arkadaşları ile Tanışma", kapsam: "Bağlı olunan amir ve birlikte çalışılacak ekip üyeleriyle tanıştırılması, günlük görev dağılımının anlatılması.", sorumlu: "İlgili Birim Sorumlusu" },
      { kategori: "İş Sağlığı ve Güvenliği", sira: 5, baslik: "Göreve Özgü İş Güvenliği ve KKD Eğitimi", kapsam: "Kimyasal madde kullanımı, elektrikli ekipmanla çalışma veya trafiğe çıkma gibi göreve özgü riskler ve gerekli kişisel koruyucu donanımın (eldiven, maske, reflektörlü yelek vb.) teslimi.", sorumlu: "İş Sağlığı ve Güvenliği Uzmanı" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 6, baslik: "Kıyafet/Üniforma ve Görünüm-Hijyen Standartları", kapsam: "Kurumsal üniforma teslimi, kimlik kartı verilmesi ve müşteri ile temas eden görevler için hijyen/görünüm standartlarının anlatılması.", sorumlu: "İnsan Kaynakları / İlgili Birim Sorumlusu" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 7, baslik: "Görev Ekipmanı ve Araç Zimmeti", kapsam: "Temizlik makinesi, bakım aleti, servis aracı anahtarı gibi görev ekipmanlarının zimmet kaydının yapılması ve kullanım kurallarının anlatılması.", sorumlu: "İlgili Birim Sorumlusu" },
      { kategori: "Müşteri Hizmetleri Süreçleri", sira: 8, baslik: "Misafir/Müşteri ile Temas Standartları", kapsam: "Müşteri ile doğrudan temas edilen görevlerde (vale, ikram, karşılama, yıkama teslim vb.) nezaket kuralları, selamlama ve temel iletişim standartlarının anlatılması.", sorumlu: "Müşteri İlişkileri Sorumlusu / İlgili Birim Sorumlusu" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 9, baslik: "Araç Kullanımı ve Trafik Güvenliği Kuralları", kapsam: "Şirket/müşteri araçlarını kullanacak personel için ehliyet kontrolü, hız/park kuralları ve kaza/hasar durumunda izlenecek prosedürün anlatılması.", sorumlu: "İlgili Birim Sorumlusu / İSG Uzmanı" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 10, baslik: "Periyodik Bakım/Temizlik Görev Takvimi ve Kontrol Listeleri", kapsam: "Günlük/haftalık temizlik veya bakım görevlerinin kontrol listeleri üzerinden takip edilmesi ve tamamlanma onayı sürecinin anlatılması.", sorumlu: "İlgili Birim Sorumlusu" },
      { kategori: "İş Sağlığı ve Güvenliği", sira: 11, baslik: "Elektrik ve Teknik Bakım Güvenlik Prosedürleri", kapsam: "Elektrik panosu, aydınlatma ve bina teknik sistemleri üzerinde çalışırken uyulması gereken elektrik güvenliği prosedürlerinin anlatılması (ilgili teknik pozisyonlar için).", sorumlu: "İş Sağlığı ve Güvenliği Uzmanı" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 12, baslik: "Malzeme/Kimyasal Talep ve Güvenli Kullanım Prosedürü", kapsam: "Temizlik malzemesi, kimyasal ve sarf malzeme taleplerinin nasıl yapılacağı ile kimyasalların güvenlik bilgi formlarına (MSDS) uygun kullanımının anlatılması.", sorumlu: "İlgili Birim Sorumlusu" },
      { kategori: "İK SÜREÇLERİ", sira: 13, baslik: "İzin, Mesai ve Vardiya Değişim Prosedürü", kapsam: "Yıllık izin talebi, vardiya değişimi ve fazla mesai onay sürecinin anlatılması.", sorumlu: "İnsan Kaynakları / İlgili Birim Sorumlusu" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 14, baslik: "30 Günlük Deneme Süresi Değerlendirme Görüşmesi", kapsam: "İlk ay sonunda görev uyumu, iş güvenliği kurallarına riayet ve ekip entegrasyonu hakkında geri bildirim görüşmesi yapılması.", sorumlu: "İlgili Birim Sorumlusu / İnsan Kaynakları" },
    ]
  },
  "stajyer_ogrenci": {
    adi: "Stajyer / Öğrenci Oryantasyonu",
    maddeler: [
      { kategori: "İK SÜREÇLERİ", sira: 1, baslik: "Staj Sözleşmesi ve Zorunlu Evrakların Tamamlanması", kapsam: "Staj sözleşmesi, okul tarafından istenen staj başvuru formu, SGK bildirimi ve staj defterinin teslim alınması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 2, baslik: "Staj Ücreti ve Devam Takip Sistemi Bilgilendirmesi", kapsam: "Varsa staj ücreti ödeme koşullarının, giriş-çıkış/devam takip sisteminin ve devamsızlık bildirim kurallarının anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 3, baslik: "Şirket ve Departman Genel Tanıtımı", kapsam: "Şirketin faaliyet alanı, organizasyon yapısı ve stajın yapılacağı departmanın genel işleyişinin tanıtılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 4, baslik: "Staj Danışmanı/Mentor Atanması", kapsam: "Staj boyunca yönlendirme yapacak bir mentor/danışmanın atanması ve iletişim bilgilerinin paylaşılması.", sorumlu: "İlgili Departman Yöneticisi" },
      { kategori: "İş Sağlığı ve Güvenliği", sira: 5, baslik: "Temel İş Sağlığı ve Güvenliği Eğitimi", kapsam: "Staj yapılacak alana (atölye, ofis, saha) özgü temel güvenlik kuralları ve gerekli ise kişisel koruyucu donanımın teslim edilmesi.", sorumlu: "İş Sağlığı ve Güvenliği Uzmanı" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 6, baslik: "Staj Programı Kapsamı ve Öğrenme Hedeflerinin Belirlenmesi", kapsam: "Staj süresince edinilmesi beklenen bilgi/beceri hedeflerinin mentor ile birlikte netleştirilmesi ve staj planının oluşturulması.", sorumlu: "İlgili Departman Yöneticisi / Mentor" },
      { kategori: "Sistem ve Araç Erişimleri", sira: 7, baslik: "Kısıtlı Sistem Erişimi Tanımlama", kapsam: "Görev kapsamına uygun, kısıtlı yetkili misafir/stajyer hesabının açılması ve gerekli temel yazılımlara erişimin tanımlanması.", sorumlu: "IT / Bilgi İşlem" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 8, baslik: "Gizlilik ve Kurumsal Bilgi Paylaşım Kuralları", kapsam: "Şirket içi bilgilerin, müşteri verilerinin ve ticari sırların gizliliğine ilişkin kuralların ve gizlilik taahhütnamesinin anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "ORYANTASYON SÜREÇLERİ", sira: 9, baslik: "Şirket Kuralları ve Çalışma Düzeni Bilgilendirmesi", kapsam: "Kıyafet kuralları, mesai saatleri, mola düzeni ve genel davranış kurallarının anlatılması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 10, baslik: "Haftalık Görev Planı ve Mentor Görüşmeleri", kapsam: "Haftalık verilecek görevlerin planlanması ve mentor ile düzenli aralıklarla ilerleme değerlendirme görüşmeleri yapılması.", sorumlu: "Mentor / İlgili Departman Yöneticisi" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 11, baslik: "Staj Defteri ve Değerlendirme Formu Takibi", kapsam: "Okul tarafından istenen staj defterinin düzenli doldurulmasının takip edilmesi ve dönem sonu değerlendirme formunun hazırlanması.", sorumlu: "Mentor / İnsan Kaynakları" },
      { kategori: "Kurumsal ve Operasyonel Entegrasyon", sira: 12, baslik: "Departmanlar Arası Kısa Rotasyon/Tanıtım Ziyaretleri", kapsam: "Mümkün olduğunda stajyerin şirketi bütünsel tanıması için farklı departmanlara kısa tanıtım ziyaretleri planlanması.", sorumlu: "İnsan Kaynakları" },
      { kategori: "İK SÜREÇLERİ", sira: 13, baslik: "Staj Sonu Değerlendirme Görüşmesi", kapsam: "Staj bitiminde performans, öğrenme çıktıları ve varsa şirkette istihdam potansiyeli konularının değerlendirildiği kapanış görüşmesinin yapılması.", sorumlu: "İlgili Departman Yöneticisi / İnsan Kaynakları" },
    ]
  },
};
function oryantasyonSablonSec(unvan) {
  const ham = String(unvan || "").trim();
  const key = ham.toLocaleLowerCase("tr");
  // 1) Şirketin gerçek/detaylı formu olan 4 unvan (tam eşleşme)
  for (const k in ORYANTASYON_SABLONLARI_DETAYLI) {
    if (key === k) return { sablonAdi: k.replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase("tr")), maddeler: JSON.parse(JSON.stringify(ORYANTASYON_SABLONLARI_DETAYLI[k])) };
  }
  // 2) Diğer ~80 unvan için işlev bazlı genel şablon grupları (tam eşleşme, Ağustos 2026 Çalışan Listesi'nden türetilmiştir)
  const grupAnahtar = UNVAN_GENEL_SABLON_ESLESME[ham] || UNVAN_GENEL_SABLON_ESLESME[Object.keys(UNVAN_GENEL_SABLON_ESLESME).find((u) => u.toLocaleLowerCase("tr") === key)];
  if (grupAnahtar && ORYANTASYON_SABLONLARI_GENEL_GRUPLAR[grupAnahtar]) {
    const grup = ORYANTASYON_SABLONLARI_GENEL_GRUPLAR[grupAnahtar];
    return {
      sablonAdi: grup.adi,
      maddeler: grup.maddeler.map((m) => ({ ...m, tamamlandi: false, tamamlanmaTarihi: null }))
    };
  }
  // 3) Listede hiç olmayan bir unvan (ör. "Diğer" ile elle yazılmış) — çıplak genel liste
  return { sablonAdi: "Genel", maddeler: JSON.parse(JSON.stringify(ORYANTASYON_GENEL)) };
}

// ---------------------------------------------------------------
// Deneme Süresi Değerlendirmesi — şirketin gerçek Google Form'unun
// ("DENEME SÜRESİ FORMU — PERFORMANS DEĞERLENDİRME FORMU") 10 kriteri,
// 4'lü puan skalası ve KVKK aydınlatma metni birebir işlenmiştir. Form
// yalnızca Başarılı/Başarısız sonucu tanıyor — "süre uzatma" seçeneği
// resmi formda yok, bu yüzden kaldırıldı.
// ---------------------------------------------------------------
const DENEME_KVKK_METNI = `Bu form ile paylaştığınız veriler, 6698 sayılı KVKK kapsamında; İnciroğlu Otomotiv tarafından personelin deneme süresi performans değerlendirme sürecinin yürütülmesi ve İK politikalarımızın yönetilmesi amacıyla işlenmektedir.

İşleme Amacı: Çalışanın işe uyum sürecinin analizi ve yasal özlük süreçlerinin takibi.

Gizlilik: Toplanan bilgiler yalnızca yetkili İnsan Kaynakları birimi ve ilgili üst yönetim ile paylaşılacak; üçüncü taraflara aktarılmayacaktır.

FORM; DOLDURULDUKTAN SONRA İLGİLİ ÇALIŞANIN MÜDÜRÜ, DİREKTÖRÜ VE İNSAN KAYNAKLARI DEPARTMANI TARAFINDAN İMZALANIP ÖZLÜK DOSYASINA KONULACAKTIR.`;
const DENEME_KRITERLERI = [
  { key: "ekip_uyum", kategori: "Ekip Çalışmasına Uyum ve Yatkınlık", ad: "Ekip çalışmasına yatkındır, ekip arkadaşlarıyla uyumludur." },
  { key: "iletisim", kategori: "İletişim", ad: "Anlatılanları dikkatle dinler, kendisine iletilen mesajları anlamaya çalışır. Düşünceleri ve bilgileri net, düzgün ve anlaşılır bir şekilde ifade eder." },
  { key: "kural_uyum", kategori: "İşyeri Kural ve Talimatlara Uyum", ad: "İş yeri kural ve talimatlarına uyum sağlar." },
  { key: "dikkat_ozen", kategori: "İşe Gösterilen Dikkat ve Özen", ad: "İş yapma kapasitesi ve çalışma arzusu beklenen düzeydedir, verilen işleri takip eder." },
  { key: "kendini_gelistirme", kategori: "Kendini Geliştirme", ad: "Kendini geliştirmek için çaba sarf eder ve sonuç alır." },
  { key: "sorumluluk_1", kategori: "Sorumluluk Bilinci ve Nitelikli İş Üretme", ad: "Mesai saatleri içinde işine odaklanır. İşine heves, istek ve kararlılıkla yaklaşarak çabuk harekete geçer. İşini dikkatle ve zamanında yapar." },
  { key: "sorumluluk_2", kategori: "Sorumluluk Bilinci ve Nitelikli İş Üretme", ad: "Görevini ve verilen işleri benimseyerek nitelikli iş yapar." },
  { key: "sorun_cozme_1", kategori: "Sorun Çözme ve Analiz Yeteneği", ad: "Verilen görevi kavrayarak planlı, dikkatli ve hatasız olarak yerine getirir." },
  { key: "sorun_cozme_2", kategori: "Sorun Çözme ve Analiz Yeteneği", ad: "Sorunlar karşısında alternatif çözümleri belirler ve sonuçlandırır." },
  { key: "musteri_odaklilik", kategori: "Müşteri Odaklılık", ad: "Müşteri ihtiyaçlarını anlamak ve karşılamak için çaba gösterir." }
];
const DENEME_PUAN_OPT = [
  { key: "4", label: "Çok iyi (4)" },
  { key: "3", label: "İyi (3)" },
  { key: "2", label: "Orta (2)" },
  { key: "1", label: "Zayıf (1)" }
];
const DENEME_SONUC_OPT = [
  "Değerlendirme süresinde başarılı bulunmuştur, çalışan görevine devam edecektir.",
  "Değerlendirme süresinde başarısız bulunmuştur, çalışan görevine devam etmeyecektir."
];
function denemeSuresiBitisHesapla(baslangicISO) {
  const d = new Date(baslangicISO + "T00:00:00");
  if (isNaN(d)) return null;
  d.setMonth(d.getMonth() + 2); // Türkiye'de yasal standart deneme süresi
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function gunFarki(iso) {
  if (!iso) return null;
  const a = new Date(bugunISO() + "T00:00:00"), b = new Date(iso + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

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
function gecmisEkle(mevcutGecmis, eskiDurum, yeniDurum, not) {
  return [...(mevcutGecmis || []), { tarih: bugunISO(), eskiDurum, yeniDurum, kullanici: currentProfile.adSoyad, not: not || "" }];
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
let talepler = [];
let unsubAday = null;
let unsubTalep = null;

onAuthStateChanged(auth, async (user) => {
  if (unsubAday) unsubAday();
  if (unsubTalep) unsubTalep();
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
    subscribeTalepler();
  } catch (e) {
    console.error(e);
    renderLogin("Giriş sırasında bir hata oluştu: " + e.message);
  }
});

function subscribeAdaylar() {
  // Firestore, koleksiyon ("list") sorgularında güvenlik kuralını SORGUNUN
  // KENDİSİNE göre değerlendirir, dönen belgelere göre değil — bu yüzden
  // filtresiz bir collection() dinleyicisi, resource.data'ya bakan bir kural
  // altında müdürler için TAMAMEN reddedilir (Yetenek Havuzu'ndaki
  // "evaluations" koleksiyonu da aynı nedenle where() ile sorgulanıyor).
  // Admin filtresiz okur, müdür ise sorgunun kendisi TEK bir eşitlik
  // koşuluyla (departman) kısıtlanır — "durum" için ayrıca bir where()
  // eklemek Firestore'da bileşik bir index gerektirir ve elle
  // oluşturulmadığı sürece sorguyu tamamen başarısız kılar; "olumsuz"
  // adayların müdürden gizlenmesi zaten render()'daki client-taraflı
  // filtreyle sağlanıyor, bu yüzden burada tek koşul yeterli ve sağlamdır.
  const isAdminHesap = currentProfile.role === "admin";
  const ref = isAdminHesap
    ? collection(db, "iseAlimAday")
    : query(collection(db, "iseAlimAday"), where("departman", "==", currentProfile.muduluk));
  unsubAday = onSnapshot(ref, (qs) => {
    adaylar = [];
    qs.forEach((d) => adaylar.push({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error(err);
    root().innerHTML = `<div class="center-screen"><div class="login-card"><h1>Veri okunamadı</h1><p class="hint">${esc(err.message)}</p></div></div>`;
  });
}

function subscribeTalepler() {
  // Aynı prensip: admin filtresiz okur, müdür TEK eşitlik koşuluyla (departman)
  // kısıtlanır — bkz. subscribeAdaylar() üstündeki not.
  const isAdminHesap = currentProfile.role === "admin";
  const ref = isAdminHesap
    ? collection(db, "personelTalepleri")
    : query(collection(db, "personelTalepleri"), where("departman", "==", currentProfile.muduluk));
  unsubTalep = onSnapshot(ref, (qs) => {
    talepler = [];
    qs.forEach((d) => talepler.push({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error("Personel talepleri okunamadı:", err);
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
  people: `<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4" fill="currentColor"/><path d="M2.5 20c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5" fill="currentColor" opacity=".85"/><circle cx="17.5" cy="8.5" r="2.6" fill="currentColor" opacity=".55"/><path d="M14.8 13.9c1-.6 2.1-.9 3-.9 2.8 0 5 2 5.2 5" fill="currentColor" opacity=".55"/></svg>`,
  genel: `<svg width="16" height="16" viewBox="0 0 24 24"><rect x="2.5" y="13" width="4.5" height="8.5" rx="1" fill="currentColor" opacity=".55"/><rect x="9.7" y="7" width="4.5" height="14.5" rx="1" fill="currentColor" opacity=".8"/><rect x="17" y="2.5" width="4.5" height="19" rx="1" fill="currentColor"/></svg>`,
  talep: `<svg width="16" height="16" viewBox="0 0 24 24"><rect x="3.5" y="2.5" width="17" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  oryantasyon: `<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 12.5l2.6 2.6L16.5 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
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

let TAB = "genel";
function render() {
  const isAdmin = currentProfile.role === "admin";
  // Müdürler yalnızca kendi departmanlarındaki adayları, ve "olumsuz" (reddedilen)
  // adayları HİÇBİR ZAMAN görmemeli — bkz. Firestore kuralları (aynı kısıt orada
  // da uygulanmalı, burası yalnızca istemci tarafı ek bir güvence).
  const gorulenAdaylar = isAdmin ? adaylar : adaylar.filter((a) => a.departman === currentProfile.muduluk && a.durum !== "olumsuz");
  const gorulenTalepler = isAdmin ? talepler : talepler.filter((t) => t.departman === currentProfile.muduluk);

  const navItems = [
    { key: "genel", label: "Genel Bakış", ic: ICONS.genel },
    { key: "adaylar", label: "Aday Havuzu", ic: ICONS.people },
    { key: "talepler", label: "Personel Talepleri", ic: ICONS.talep },
    { key: "oryantasyon", label: "Oryantasyon", ic: ICONS.oryantasyon }
  ];

  root().innerHTML = `
  ${topbar()}
  <div class="app-body">
    <div class="sidebar">
      ${navItems.map((n) => `<div class="nav-item ${TAB === n.key ? "active" : ""}" data-nav="${n.key}"><span class="ic">${n.ic}</span>${n.label}</div>`).join("")}
    </div>
    <div class="main-content"><div class="wrap" id="pageWrap"></div></div>
  </div>`;
  wireTopbar();
  document.querySelectorAll("[data-nav]").forEach((n) => n.addEventListener("click", () => { TAB = n.dataset.nav; render(); }));

  if (TAB === "talepler") renderTaleplerPage(gorulenTalepler, isAdmin);
  else if (TAB === "oryantasyon") renderOryantasyonPage(gorulenAdaylar, isAdmin);
  else if (TAB === "genel") renderGenelBakisPage(gorulenAdaylar, gorulenTalepler, isAdmin);
  else renderAdaylarPage(gorulenAdaylar, isAdmin);
}

// ---------------------------------------------------------------
// ADAYLAR SAYFASI — aşamaya göre gruplu görünüm (tek dropdown yerine)
// ---------------------------------------------------------------
const acikGruplar = { gorusme_bekliyor: true, evrak_bekliyor: true, sgk_bekliyor: true, ise_basladi: true, tamamlandi: false, vazgecti: false, olumsuz: false };
function renderAdaylarPage(list, isAdmin) {
  const gorunurListe = isAdmin ? list : list.filter((a) => a.durum !== "olumsuz");
  const total = gorunurListe.length;
  const gorusmeBekleyen = list.filter((a) => a.durum === "gorusme_bekliyor").length;
  const evrakBekleyen = list.filter((a) => a.durum === "evrak_bekliyor").length;
  const sgkBekleyen = list.filter((a) => a.durum === "sgk_bekliyor").length;
  const denemeSuresinde = list.filter((a) => a.durum === "ise_basladi").length;
  const tamamlandi = list.filter((a) => a.durum === "tamamlandi").length;

  const yarin = yarinISO();
  const yarinBaslayanlar = list.filter((a) => a.iseBaslamaTarihi === yarin && a.durum !== "vazgecti" && a.durum !== "olumsuz" && !a.sgkGirisYapildi);
  const bugun = bugunISO();
  const gecikenSgk = list.filter((a) => a.iseBaslamaTarihi && a.iseBaslamaTarihi <= bugun && !a.sgkGirisYapildi && a.durum !== "vazgecti" && a.durum !== "tamamlandi" && a.durum !== "olumsuz");
  const denemeYaklasan = list.filter((a) => a.durum === "ise_basladi" && a.denemeSuresi && !a.denemeSuresi.degerlendirmeYapildiMi && gunFarki(a.denemeSuresi.bitisTarihi) !== null && gunFarki(a.denemeSuresi.bitisTarihi) <= 7);
  const kararBekleyen = list.filter((a) => a.durum === "gorusme_bekliyor" && a.gorusmeTarihi && a.gorusmeTarihi <= bugun);

  const banner = (yarinBaslayanlar.length || gecikenSgk.length || denemeYaklasan.length || kararBekleyen.length) ? `
    <div class="banner">
      <div class="ic">🔔</div>
      <div>
        ${kararBekleyen.length ? `<div><b>${kararBekleyen.length} adayın</b> görüşmesi geçti ama karar (olumlu/olumsuz) girilmemiş: ${kararBekleyen.map((a) => esc(a.ad + " " + a.soyad)).join(", ")}</div>` : ""}
        ${yarinBaslayanlar.length ? `<div style="margin-top:6px"><b>Yarın işe başlayacak ${yarinBaslayanlar.length} kişi var</b> — SGK girişini unutmayın: ${yarinBaslayanlar.map((a) => esc(a.ad + " " + a.soyad)).join(", ")}</div>` : ""}
        ${gecikenSgk.length ? `<div style="margin-top:6px">⚠ <b>${gecikenSgk.length} kişinin</b> işe başlama tarihi geçti ama SGK girişi hâlâ yapılmamış: ${gecikenSgk.map((a) => esc(a.ad + " " + a.soyad)).join(", ")}</div>` : ""}
        ${denemeYaklasan.length ? `<div style="margin-top:6px">📋 <b>${denemeYaklasan.length} kişinin</b> deneme süresi yakında doluyor, değerlendirme formunu doldurmayı unutmayın: ${denemeYaklasan.map((a) => esc(a.ad + " " + a.soyad) + " (" + fmtTarih(a.denemeSuresi.bitisTarihi) + ")").join(", ")}</div>` : ""}
      </div>
    </div>` : "";

  el("#pageWrap").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Aday Havuzu</h1>
        <p>Görüşmeden deneme süresi tamamlanana kadar tüm süreci buradan yönetin.</p>
      </div>
      ${isAdmin ? `<button class="btn btn-teal" id="yeniAdayBtn">+ Yeni Aday Ekle</button>` : ""}
    </div>
    ${banner}
    <div class="stat-row">
      <div class="stat-card"><div class="n">${total}</div><div class="l">Görünen Toplam</div></div>
      <div class="stat-card"><div class="n">${gorusmeBekleyen}</div><div class="l">Görüşme / Karar Bekliyor</div></div>
      <div class="stat-card"><div class="n">${evrakBekleyen}</div><div class="l">Evrak Bekliyor</div></div>
      <div class="stat-card"><div class="n">${sgkBekleyen}</div><div class="l">SGK Bekliyor</div></div>
      <div class="stat-card"><div class="n">${denemeSuresinde}</div><div class="l">Deneme Süresinde</div></div>
      <div class="stat-card"><div class="n">${tamamlandi}</div><div class="l">Tamamlandı</div></div>
    </div>
    <div class="toolbar">
      <input type="text" id="searchBox" placeholder="İsim, unvan veya departmanla ara…" style="min-width:240px">
    </div>
    <div id="grupListesi"></div>`;

  if (isAdmin) el("#yeniAdayBtn").addEventListener("click", () => openAdayForm());

  function draw() {
    const term = el("#searchBox").value.trim().toLocaleLowerCase("tr");
    const eslesen = (a) => (a.ad + " " + a.soyad + " " + (a.unvan || "") + " " + (a.departman || "")).toLocaleLowerCase("tr").includes(term);

    const gruplarHtml = AKIS_GRUPLARI
      .filter((g) => !g.sadeceAdmin || isAdmin)
      .map((g) => {
        const grupAdaylari = gorunurListe.filter((a) => a.durum === g.key && eslesen(a))
          .sort((a, b) => (a.iseBaslamaTarihi || a.gorusmeTarihi || "").localeCompare(b.iseBaslamaTarihi || b.gorusmeTarihi || ""));
        if (!grupAdaylari.length) return "";
        const acik = acikGruplar[g.key];
        return `
        <div class="stage-group ${acik ? "open" : ""} ${g.key === "olumsuz" ? "olumsuz-grup" : ""}" data-grup="${g.key}">
          <div class="stage-group-head" data-grup-toggle="${g.key}">
            <span class="ic">${g.ic}</span>
            <span class="t">${esc(g.baslik)}</span>
            <span class="n">${grupAdaylari.length}</span>
            <span class="caret">▶</span>
          </div>
          <div class="stage-group-body">${grupAdaylari.map((a) => adayCardHtml(a)).join("")}</div>
        </div>`;
      }).join("");

    el("#grupListesi").innerHTML = gruplarHtml.trim() ? gruplarHtml : `<div class="empty-state">Aramanızla eşleşen aday bulunamadı.</div>`;
    document.querySelectorAll("[data-grup-toggle]").forEach((h) => {
      h.addEventListener("click", () => {
        const k = h.dataset.grupToggle;
        acikGruplar[k] = !acikGruplar[k];
        h.closest(".stage-group").classList.toggle("open", acikGruplar[k]);
      });
    });
    document.querySelectorAll(".aday-card[data-id]").forEach((card) => {
      card.addEventListener("click", () => {
        const aday = adaylar.find((x) => x.id === card.dataset.id);
        if (aday) openAdayDetay(aday, isAdmin);
      });
    });
  }
  function adayCardHtml(a) {
    const st = DURUM_ETIKET[a.durum] || DURUM_ETIKET.gorusme_bekliyor;
    const oran = evrakOrani(a);
    const altBilgi = a.durum === "gorusme_bekliyor"
      ? `Görüşme: ${fmtTarih(a.gorusmeTarihi)}`
      : a.durum === "olumsuz"
        ? `Red nedeni: ${esc(a.redNedeni || "—")}`
        : `İşe Başlama: ${fmtTarih(a.iseBaslamaTarihi)}`;
    return `
    <div class="aday-card" data-id="${a.id}">
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:220px">
        ${avatarHtml(a.ad + " " + a.soyad, 38)}
        <div class="main">
          <b>${esc(a.ad)} ${esc(a.soyad)}</b>
          <div class="meta">${esc(a.unvan || "")} · ${esc(a.departman || "")} · ${altBilgi}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;">
        ${(a.durum !== "gorusme_bekliyor" && a.durum !== "olumsuz") ? `
        <div style="min-width:110px">
          <div style="font-size:10.5px;color:var(--ink-soft);margin-bottom:3px">Evrak %${oran}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${oran}%"></div></div>
        </div>` : ""}
        <span class="status-badge ${st.cls}">${st.label}</span>
      </div>
    </div>`;
  }
  el("#searchBox").addEventListener("input", draw);
  draw();
}

// ---------------------------------------------------------------
// YENİ ADAY FORMU
// ---------------------------------------------------------------
// Genel amaçlı "açılır liste + Diğer (elle yaz)" bileşeni — unvan, departman
// gibi büyük/küçük harf farkına duyarlı eşleşmesi gereken tüm alanlarda
// kullanılır (bkz. satış panosundaki aynı prensip: marka adları listeden
// seçilince Firestore kural eşleşmesi asla bozulmaz).
function dropdownDigerHtml(id, secili, liste, placeholder, disabled) {
  const varMi = liste.some((u) => u.toLocaleLowerCase("tr") === String(secili || "").trim().toLocaleLowerCase("tr"));
  const dis = disabled ? "disabled" : "";
  return `
    <select id="${id}" ${dis}>
      <option value="">Seçiniz…</option>
      ${liste.map((u) => `<option value="${esc(u)}" ${secili === u ? "selected" : ""}>${esc(u)}</option>`).join("")}
      <option value="__diger__" ${secili && !varMi ? "selected" : ""}>Diğer (elle yaz)</option>
    </select>
    <input type="text" id="${id}Diger" placeholder="${esc(placeholder || "Elle yazın")}" ${dis} style="margin-top:6px;${secili && !varMi ? "" : "display:none"}" value="${secili && !varMi ? esc(secili) : ""}">`;
}
function wireDropdownDiger(id) {
  const sel = el("#" + id), diger = el("#" + id + "Diger");
  sel.addEventListener("change", () => { diger.style.display = sel.value === "__diger__" ? "" : "none"; });
}
function dropdownDigerDegeriOku(id) {
  const sel = el("#" + id), diger = el("#" + id + "Diger");
  return sel.value === "__diger__" ? diger.value.trim() : sel.value;
}
function unvanSelectHtml(id, secili, disabled) { return dropdownDigerHtml(id, secili, UNVAN_LISTESI, "Unvanı yazın", disabled); }
function wireUnvanSelect(id) { return wireDropdownDiger(id); }
function unvanDegeriOku(id) { return dropdownDigerDegeriOku(id); }
function departmanSelectHtml(id, secili, disabled) { return dropdownDigerHtml(id, secili, DEPARTMAN_LISTESI, "Departmanı yazın", disabled); }
function wireDepartmanSelect(id) { return wireDropdownDiger(id); }
function departmanDegeriOku(id) { return dropdownDigerDegeriOku(id); }
function bolumSelectHtml(id, secili, disabled) {
  return `<select id="${id}" ${disabled ? "disabled" : ""}><option value="">Seçiniz…</option>${BOLUM_LISTESI.map((b) => `<option value="${esc(b)}" ${secili === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>`;
}

// ---------------------------------------------------------------
// GENEL BAKIŞ — günlük olarak "bugün ne yapmalıyım" sorusuna cevap veren
// aksiyon odaklı özet. Statik sayaç değil, tıklanınca ilgili sayfaya/gruba
// götüren kartlardan oluşur.
// ---------------------------------------------------------------
function renderGenelBakisPage(adaylarList, talepList, isAdmin) {
  const bugun = bugunISO();
  const kararBekleyen = adaylarList.filter((a) => a.durum === "gorusme_bekliyor" && a.gorusmeTarihi && a.gorusmeTarihi <= bugun);
  const onayBekleyenTalep = talepList.filter((t) => t.durum === "talep_edildi");
  const gecikenEvrakSgk = adaylarList.filter((a) => (a.durum === "evrak_bekliyor" || a.durum === "sgk_bekliyor") && a.iseBaslamaTarihi && a.iseBaslamaTarihi <= bugun);
  const oryantasyonSurenler = adaylarList.filter((a) => a.durum === "ise_basladi" && a.oryantasyon);
  const denemeYaklasan = adaylarList.filter((a) => a.durum === "ise_basladi" && a.denemeSuresi && !a.denemeSuresi.degerlendirmeYapildiMi && gunFarki(a.denemeSuresi.bitisTarihi) !== null && gunFarki(a.denemeSuresi.bitisTarihi) <= 7);

  const kart = (n, l, ic, hedefTab) => `
    <div class="stat-card" data-git="${hedefTab}" style="cursor:pointer">
      <div class="n">${n}</div><div class="l">${ic ? ic + " " : ""}${l}</div>
    </div>`;

  el("#pageWrap").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Genel Bakış</h1>
        <p>Bugün dikkat etmeniz gereken maddelerin özeti.</p>
      </div>
    </div>
    <div class="stat-row">
      ${kart(kararBekleyen.length, "Karar Bekleyen Görüşme", "🗓️", "adaylar")}
      ${isAdmin ? kart(onayBekleyenTalep.length, "Onay Bekleyen Talep", "📋", "talepler") : ""}
      ${kart(gecikenEvrakSgk.length, "Evrak/SGK'da Gecikme", "⚠", "adaylar")}
      ${kart(oryantasyonSurenler.length, "Devam Eden Oryantasyon", "🎯", "oryantasyon")}
      ${kart(denemeYaklasan.length, "Deneme Süresi Yaklaşan", "⏳", "adaylar")}
    </div>
    ${!kararBekleyen.length && !onayBekleyenTalep.length && !gecikenEvrakSgk.length && !denemeYaklasan.length
      ? `<div class="empty-state">🎉 Şu anda bekleyen bir aksiyon yok — her şey güncel.</div>`
      : `
      <div class="card-list">
        ${kararBekleyen.map((a) => `<div class="aday-card" data-gitaday="${a.id}"><div class="main"><b>${esc(a.ad)} ${esc(a.soyad)}</b><div class="meta">Görüşme tarihi geçti, karar bekliyor (${esc(a.unvan || "")} · ${esc(a.departman || "")})</div></div><span class="status-badge st-gorusme">Karar Ver</span></div>`).join("")}
        ${isAdmin ? onayBekleyenTalep.map((t) => `<div class="aday-card" data-gittalep="${t.id}"><div class="main"><b>${esc(t.unvan)} × ${t.adet}</b><div class="meta">${esc(t.departman)} · ${esc(t.talepEdenKullanici || "")}</div></div><span class="status-badge st-gorusme">Talebi İncele</span></div>`).join("") : ""}
        ${gecikenEvrakSgk.map((a) => `<div class="aday-card" data-gitaday="${a.id}"><div class="main"><b>${esc(a.ad)} ${esc(a.soyad)}</b><div class="meta">${a.durum === "evrak_bekliyor" ? "Evrak" : "SGK"} bekliyor, işe başlama tarihi geçti (${fmtTarih(a.iseBaslamaTarihi)})</div></div><span class="status-badge st-sgk">İncele</span></div>`).join("")}
        ${denemeYaklasan.map((a) => `<div class="aday-card" data-gitaday="${a.id}"><div class="main"><b>${esc(a.ad)} ${esc(a.soyad)}</b><div class="meta">Deneme süresi ${fmtTarih(a.denemeSuresi.bitisTarihi)} tarihinde doluyor</div></div><span class="status-badge st-basladi">Değerlendir</span></div>`).join("")}
      </div>`}`;

  document.querySelectorAll("[data-git]").forEach((c) => c.addEventListener("click", () => { TAB = c.dataset.git; render(); }));
  document.querySelectorAll("[data-gitaday]").forEach((c) => c.addEventListener("click", () => {
    TAB = "adaylar"; render();
    const aday = adaylar.find((x) => x.id === c.dataset.gitaday);
    if (aday) openAdayDetay(aday, isAdmin);
  }));
  document.querySelectorAll("[data-gittalep]").forEach((c) => c.addEventListener("click", () => {
    TAB = "talepler"; render();
    const t = talepler.find((x) => x.id === c.dataset.gittalep);
    if (t) openTalepDetay(t, isAdmin);
  }));
}

// ---------------------------------------------------------------
// PERSONEL TALEPLERİ — müdür kadro talebi açar, İK onaylar/reddeder.
// Onaylanan talep, "Bu Talep İçin Aday Ekle" ile doğrudan Yeni Aday
// formunu unvan/departman/bölüm önceden dolu şekilde açar ve adayı talebe
// bağlar; adet dolunca talep otomatik "karsilandi" olur.
// ---------------------------------------------------------------
function renderTaleplerPage(list, isAdmin) {
  const acik = list.filter((t) => t.durum === "talep_edildi" || t.durum === "onaylandi" || t.durum === "revize_istendi" || t.durum === "ertelendi" || t.durum === "kismen_karsilandi");
  const kapali = list.filter((t) => t.durum === "karsilandi" || t.durum === "reddedildi" || t.durum === "iptal_edildi");

  const talepCard = (t) => {
    const st = TALEP_DURUM_ETIKET[t.durum] || TALEP_DURUM_ETIKET.talep_edildi;
    const nedenEtiket = (t.talepNedenleri || []).map((k) => (TALEP_NEDEN_OPT.find((o) => o.key === k) || {}).label).filter(Boolean).join(", ");
    return `
    <div class="aday-card" data-id="${t.id}">
      <div class="main" style="flex:1">
        <b>${esc(t.unvan)}</b> <span style="color:var(--ink-soft);font-weight:400">× ${t.adet || 1} kişi${t.karsilananAdet ? " (" + t.karsilananAdet + " karşılandı)" : ""}</span>
        <div class="meta">${esc(t.departman)} · ${esc(t.bolum || "")}${nedenEtiket ? " · " + esc(nedenEtiket) : ""}</div>
        <div class="meta">Talep eden: ${esc(t.talepEdenKullanici || "")}</div>
      </div>
      <span class="status-badge ${st.cls}">${st.label}</span>
    </div>`;
  };

  el("#pageWrap").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Personel Talepleri</h1>
        <p>${isAdmin ? "Müdürlerden gelen kadro taleplerini onaylayın/reddedin." : "Departmanınız için yeni personel ihtiyacını İK'ya iletin."}</p>
      </div>
      ${!isAdmin ? `<button class="btn btn-teal" id="yeniTalepBtn">+ Yeni Talep</button>` : ""}
    </div>
    <div class="stat-row">
      <div class="stat-card"><div class="n">${acik.length}</div><div class="l">Açık Talep</div></div>
      <div class="stat-card"><div class="n">${list.filter((t) => t.durum === "talep_edildi").length}</div><div class="l">Onay Bekliyor</div></div>
      <div class="stat-card"><div class="n">${list.filter((t) => t.durum === "karsilandi").length}</div><div class="l">Karşılandı</div></div>
    </div>
    <div class="section-title" style="margin-top:0">Açık Talepler</div>
    <div class="card-list">${acik.length ? acik.map(talepCard).join("") : `<div class="empty-state">Açık talep yok.</div>`}</div>
    ${kapali.length ? `<div class="section-title">Geçmiş</div><div class="card-list">${kapali.map(talepCard).join("")}</div>` : ""}`;

  if (!isAdmin) el("#yeniTalepBtn").addEventListener("click", () => openTalepForm());
  document.querySelectorAll(".aday-card[data-id]").forEach((c) => {
    c.addEventListener("click", () => {
      const t = talepler.find((x) => x.id === c.dataset.id);
      if (t) openTalepDetay(t, isAdmin);
    });
  });
}

function openTalepForm() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <div><h2>Yeni Personel Talebi</h2><div class="meta">${esc(currentProfile.muduluk || "")} — resmi Personel Talep Formu'nun elektronik hali</div></div>
        <button class="close-x" id="closeDrawer">✕</button>
      </div>
      <div class="drawer-body">
        <div class="section-title" style="margin-top:0">İstenilen Pozisyon Bilgileri</div>
        <div class="two-col">
          <div class="field"><label>Pozisyon Adı (Unvan)</label>${unvanSelectHtml("tUnvan", "")}</div>
          <div class="field"><label>Bölüm</label>${bolumSelectHtml("tBolum", "")}</div>
        </div>
        <div class="two-col">
          <div class="field"><label>Adet</label><input type="number" id="tAdet" min="1" value="1"></div>
          <div class="field"><label>Cinsiyet Tercihi (varsa)</label><input type="text" id="tCinsiyet" placeholder="Fark etmez / Kadın / Erkek"></div>
        </div>
        <div class="two-col">
          <div class="field"><label>Mezuniyet Bilgisi</label><input type="text" id="tMezuniyet" placeholder="Örn: Üniversite mezunu"></div>
          <div class="field"><label>Deneyim</label><input type="text" id="tDeneyim" placeholder="Örn: 2 yıl otomotiv satış deneyimi"></div>
        </div>
        <div class="field"><label>Gerekli Sertifikalar</label><input type="text" id="tSertifika" placeholder="Varsa yazınız"></div>
        <div class="field"><label>Beklentiler</label><textarea id="tBeklentiler" rows="2"></textarea></div>
        <div class="field"><label>Görev Tanımı</label><textarea id="tGorevTanimi" rows="3"></textarea></div>

        <div class="section-title">Talep Nedeni</div>
        ${checkboxGrupHtml("tNeden", [], TALEP_NEDEN_OPT)}
        <div class="field" style="margin-top:8px"><label>Yerine Alım İse: Kimin Yerine / Çıkış Tarihi</label><input type="text" id="tYerineAciklama" placeholder="Yalnızca \"Yerine Alım\" işaretlediyseniz doldurun"></div>
        <div class="field"><label>Alım Talebinin Detaylı Açıklaması</label><textarea id="tDetayliAciklama" rows="3" required></textarea></div>

        <div class="two-col">
          <div>
            <div class="section-title">İç Aday Değerlendirmesi</div>
            ${radioGrupHtml("tIcAday", "", IC_ADAY_OPT)}
          </div>
          <div>
            <div class="section-title">Eksik Personelle Devam Edilebilirlik</div>
            ${radioGrupHtml("tSurdur", "", SURDURULEBILIRLIK_OPT)}
            <div class="field" style="margin-top:8px"><label>Sürdürülemezse açıklama</label><input type="text" id="tSurdurAciklama"></div>
          </div>
        </div>

        <div class="section-title">Pozisyon Alınmazsa Oluşacak Riskler</div>
        ${checkboxGrupHtml("tRisk", [], RISK_OPT)}
        <div class="field" style="margin-top:8px"><label>Açıklama (Zorunlu Alan)</label><textarea id="tRiskAciklama" rows="2" required></textarea></div>

        <div class="section-title">Talep Edilen Ücret / Bütçe</div>
        <div class="two-col">
          <div class="field"><label>Yönetici Ücret Önerisi</label><input type="text" id="tUcretOneri" placeholder="Örn: 45.000 TL"></div>
          <div class="field"><label>Hedeflenen Başlama Tarihi</label><input type="date" id="tHedefTarih"></div>
        </div>
        <div class="two-col">
          <div class="field"><label>İlgili Birim Bütçesi (Yıllık)</label><input type="text" id="tButceYillik"></div>
          <div class="field"><label>Kalan Bütçe</label><input type="text" id="tButceKalan"></div>
        </div>

        <div class="section-title">Distribütör / Marka Zorunluluğu</div>
        ${radioGrupHtml("tMarkaZorunluluk", "", MARKA_ZORUNLULUK_OPT)}
        <div class="field" style="margin-top:8px"><label>Dayanak (marka yazısı, denetim, KPI, sözleşme maddesi vb.)</label><input type="text" id="tMarkaDayanak"></div>
      </div>
      <div class="drawer-foot">
        <button class="btn btn-ghost" id="vazgecBtn">Vazgeç</button>
        <button class="btn btn-teal" id="kaydetBtn">Talebi Gönder</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  el("#closeDrawer").onclick = () => overlay.remove();
  el("#vazgecBtn").onclick = () => overlay.remove();
  wireUnvanSelect("tUnvan");
  el("#kaydetBtn").onclick = async () => {
    const unvan = unvanDegeriOku("tUnvan"), adet = +el("#tAdet").value;
    const detayliAciklama = el("#tDetayliAciklama").value.trim();
    const riskAciklama = el("#tRiskAciklama").value.trim();
    if (!unvan || !adet || adet < 1) { toast("Pozisyon adı ve en az 1 adet girilmelidir."); return; }
    if (!detayliAciklama) { toast("Alım talebinin detaylı açıklaması zorunludur."); return; }
    if (!riskAciklama) { toast("Risk açıklaması zorunlu alandır."); return; }
    const btn = el("#kaydetBtn");
    btn.disabled = true; btn.textContent = "Gönderiliyor…";
    try {
      await addDoc(collection(db, "personelTalepleri"), {
        unvan, adet,
        bolum: el("#tBolum").value,
        departman: currentProfile.muduluk,
        cinsiyet: el("#tCinsiyet").value.trim(),
        mezuniyetBilgisi: el("#tMezuniyet").value.trim(),
        deneyim: el("#tDeneyim").value.trim(),
        gerekliSertifikalar: el("#tSertifika").value.trim(),
        beklentiler: el("#tBeklentiler").value.trim(),
        gorevTanimi: el("#tGorevTanimi").value.trim(),
        talepNedenleri: checkboxGrupOku("tNeden"),
        yerineAlimAciklama: el("#tYerineAciklama").value.trim(),
        detayliAciklama,
        icAdayDegerlendirmesi: radioGrupOku("tIcAday"),
        surdurulebilirlik: radioGrupOku("tSurdur"),
        surdurulemezAciklama: el("#tSurdurAciklama").value.trim(),
        riskler: checkboxGrupOku("tRisk"),
        riskAciklama,
        yoneticiUcretOnerisi: el("#tUcretOneri").value.trim(),
        ikUcretOnerisi: "",
        birimButcesiYillik: el("#tButceYillik").value.trim(),
        kullanilanButce: "",
        kalanButce: el("#tButceKalan").value.trim(),
        markaZorunlulugu: radioGrupOku("tMarkaZorunluluk"),
        markaDayanak: el("#tMarkaDayanak").value.trim(),
        kadroPlaninaUygunluk: null,
        hedefBaslamaTarihi: el("#tHedefTarih").value || null,
        durum: "talep_edildi",
        karsilananAdet: 0,
        ikNotu: "", kararTarihi: null, kararVerenKullanici: null,
        talepEdenKullanici: currentProfile.adSoyad,
        talepEdenUsername: currentProfile.username,
        olusturmaTarihi: serverTimestamp(),
        guncellemeTarihi: serverTimestamp()
      });
      toast("✓ Talebiniz İK'ya iletildi.");
      overlay.remove();
    } catch (e) {
      toast("Gönderilemedi: " + e.message);
      btn.disabled = false; btn.textContent = "Talebi Gönder";
    }
  };
}

function openTalepDetay(talep, isAdmin) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const st = TALEP_DURUM_ETIKET[talep.durum] || TALEP_DURUM_ETIKET.talep_edildi;
  const acikMi = talep.durum === "onaylandi" || talep.durum === "kismen_karsilandi";
  const kararVerilebilir = isAdmin && (talep.durum === "talep_edildi" || talep.durum === "revize_istendi" || talep.durum === "ertelendi");
  const nedenEtiket = (talep.talepNedenleri || []).map((k) => (TALEP_NEDEN_OPT.find((o) => o.key === k) || {}).label).filter(Boolean);
  const riskEtiket = (talep.riskler || []).map((k) => (RISK_OPT.find((o) => o.key === k) || {}).label).filter(Boolean);
  const satir = (etiket, deger) => (deger ? `<div><b>${esc(etiket)}:</b> ${esc(deger)}</div>` : "");
  const tekDeger = (deger) => (deger ? `<div>${esc(deger)}</div>` : "<div>—</div>");

  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <div><h2>${esc(talep.unvan)}</h2><div class="meta">${esc(talep.departman)} · ${esc(talep.bolum || "")}</div></div>
        <button class="close-x" id="closeDrawer">✕</button>
      </div>
      <div class="drawer-body">
        <span class="status-badge ${st.cls}">${st.label}</span>

        <div class="section-title">İstenilen Pozisyon Bilgileri</div>
        <div class="meta" style="font-size:13px;line-height:1.9">
          ${satir("Adet", (talep.adet || 1) + " kişi" + (talep.karsilananAdet ? ` (${talep.karsilananAdet} karşılandı)` : ""))}
          ${satir("Cinsiyet Tercihi", talep.cinsiyet)}
          ${satir("Mezuniyet Bilgisi", talep.mezuniyetBilgisi)}
          ${satir("Deneyim", talep.deneyim)}
          ${satir("Gerekli Sertifikalar", talep.gerekliSertifikalar)}
          ${satir("Beklentiler", talep.beklentiler)}
          ${satir("Görev Tanımı", talep.gorevTanimi)}
          ${satir("Hedeflenen Başlama", talep.hedefBaslamaTarihi ? fmtTarih(talep.hedefBaslamaTarihi) : "")}
          ${satir("Talep Eden", talep.talepEdenKullanici)}
        </div>

        <div class="section-title">Talep Nedeni</div>
        <div class="meta" style="font-size:13px;line-height:1.9">
          ${satir("Neden(ler)", nedenEtiket.join(", ") || "—")}
          ${satir("Yerine Alım Detayı", talep.yerineAlimAciklama)}
          ${satir("Detaylı Açıklama", talep.detayliAciklama)}
        </div>

        <div class="two-col">
          <div class="meta" style="font-size:13px;line-height:1.9">
            <div class="section-title" style="margin-top:0">İç Aday Değerlendirmesi</div>
            ${tekDeger((IC_ADAY_OPT.find((o) => o.key === talep.icAdayDegerlendirmesi) || {}).label)}
          </div>
          <div class="meta" style="font-size:13px;line-height:1.9">
            <div class="section-title" style="margin-top:0">Sürdürülebilirlik</div>
            ${tekDeger((SURDURULEBILIRLIK_OPT.find((o) => o.key === talep.surdurulebilirlik) || {}).label)}
            ${satir("Açıklama", talep.surdurulemezAciklama)}
          </div>
        </div>

        <div class="section-title">Pozisyon Alınmazsa Oluşacak Riskler</div>
        <div class="meta" style="font-size:13px;line-height:1.9">
          ${satir("Riskler", riskEtiket.join(", ") || "—")}
          ${satir("Açıklama", talep.riskAciklama)}
        </div>

        <div class="section-title">Ücret / Bütçe</div>
        <div class="meta" style="font-size:13px;line-height:1.9">
          ${satir("Yönetici Ücret Önerisi", talep.yoneticiUcretOnerisi)}
          ${satir("İK Ücret Önerisi", talep.ikUcretOnerisi)}
          ${satir("İlgili Birim Bütçesi (Yıllık)", talep.birimButcesiYillik)}
          ${satir("Kalan Bütçe", talep.kalanButce)}
        </div>

        <div class="section-title">Distribütör / Marka Zorunluluğu</div>
        <div class="meta" style="font-size:13px;line-height:1.9">
          ${tekDeger((MARKA_ZORUNLULUK_OPT.find((o) => o.key === talep.markaZorunlulugu) || {}).label)}
          ${satir("Dayanak", talep.markaDayanak)}
        </div>

        ${isAdmin ? `
        <div class="section-title">İnsan Kaynakları Değerlendirmesi</div>
        <div class="field"><label>Kadro Planına Uygunluk</label>
          <select id="dKadroUygun">
            <option value="">Seçiniz…</option>
            <option value="uygun" ${talep.kadroPlaninaUygunluk === "uygun" ? "selected" : ""}>Uygun</option>
            <option value="degil" ${talep.kadroPlaninaUygunluk === "degil" ? "selected" : ""}>Değil</option>
          </select>
        </div>
        <div class="field"><label>İK Ücret Önerisi</label><input type="text" id="dIkUcret" value="${esc(talep.ikUcretOnerisi || "")}"></div>` : ""}

        ${talep.ikNotu ? `<div class="section-title">İK Notu</div><div class="meta" style="font-size:13px">${esc(talep.ikNotu)}</div>` : ""}
        ${kararVerilebilir ? `
        <div class="section-title">Karar</div>
        <div class="field"><label>İK Notu (opsiyonel)</label><textarea id="dIkNotu" rows="2">${esc(talep.ikNotu || "")}</textarea></div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${TALEP_KARAR_OPT.map((k) => `<button type="button" class="btn ${k.key === "onaylandi" ? "btn-good" : k.key === "reddedildi" ? "btn-bad" : "btn-ghost"} btn-sm" data-karar="${k.key}">${k.key === "onaylandi" ? "✓ " : k.key === "reddedildi" ? "✗ " : ""}${k.label}</button>`).join("")}
        </div>` : ""}
        ${isAdmin && acikMi ? `<div class="section-title">Aksiyon</div><button type="button" class="btn btn-teal btn-sm" id="adayEkleBtn">+ Bu Talep İçin Aday Ekle</button>` : ""}
      </div>
      <div class="drawer-foot">
        ${isAdmin ? `<button class="btn btn-ghost" id="silBtn" style="color:var(--bad)">Talebi Sil</button><button class="btn btn-teal" id="guncelleBtn">Değerlendirmeyi Kaydet</button>` : ""}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  el("#closeDrawer").onclick = () => overlay.remove();

  document.querySelectorAll("[data-karar]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await setDoc(doc(db, "personelTalepleri", talep.id), {
        durum: b.dataset.karar,
        ikNotu: el("#dIkNotu").value.trim(),
        kadroPlaninaUygunluk: document.getElementById("dKadroUygun") ? document.getElementById("dKadroUygun").value : talep.kadroPlaninaUygunluk,
        ikUcretOnerisi: document.getElementById("dIkUcret") ? document.getElementById("dIkUcret").value.trim() : talep.ikUcretOnerisi,
        kararTarihi: bugunISO(), kararVerenKullanici: currentProfile.adSoyad,
        guncellemeTarihi: serverTimestamp()
      }, { merge: true });
      toast("✓ Kaydedildi.");
      overlay.remove();
    } catch (e) { toast("Kaydedilemedi: " + e.message); b.disabled = false; }
  }));
  const adayEkleBtn = document.getElementById("adayEkleBtn");
  if (adayEkleBtn) adayEkleBtn.addEventListener("click", () => {
    overlay.remove();
    openAdayForm({ unvan: talep.unvan, departman: talep.departman, bolum: talep.bolum, baglıTalepId: talep.id });
  });
  if (isAdmin) {
    const guncelleBtn = document.getElementById("guncelleBtn");
    if (guncelleBtn) guncelleBtn.onclick = async () => {
      guncelleBtn.disabled = true; guncelleBtn.textContent = "Kaydediliyor…";
      try {
        await setDoc(doc(db, "personelTalepleri", talep.id), {
          kadroPlaninaUygunluk: document.getElementById("dKadroUygun").value,
          ikUcretOnerisi: document.getElementById("dIkUcret").value.trim(),
          ikNotu: document.getElementById("dIkNotu") ? document.getElementById("dIkNotu").value.trim() : talep.ikNotu,
          guncellemeTarihi: serverTimestamp()
        }, { merge: true });
        toast("✓ Değerlendirme kaydedildi.");
        overlay.remove();
      } catch (e) { toast("Kaydedilemedi: " + e.message); guncelleBtn.disabled = false; guncelleBtn.textContent = "Değerlendirmeyi Kaydet"; }
    };
    const silBtn = document.getElementById("silBtn");
    if (silBtn) silBtn.onclick = async () => {
      if (!confirm("Bu talebi kalıcı olarak silmek istediğinize emin misiniz?")) return;
      try {
        await deleteDoc(doc(db, "personelTalepleri", talep.id));
        toast("✓ Talep silindi.");
        overlay.remove();
      } catch (e) { toast("Silinemedi: " + e.message); }
    };
  }
}

// ---------------------------------------------------------------
// ORYANTASYON — şirket genelinde, oryantasyon süreci başlamış (ise_basladi
// veya tamamlandi) HERKESİN tek bir yerden görülebildiği özet sayfa. Bir
// kişiye tıklayınca yine aynı, zaten var olan aday detay ekranı açılır —
// oryantasyon içeriği/kaydetme mantığı tek yerde kalır, tekrarlanmaz.
// ---------------------------------------------------------------
function renderOryantasyonPage(list, isAdmin) {
  const surenler = list.filter((a) => a.oryantasyon).sort((a, b) => {
    const oa = oryantasyonOrani(a), ob = oryantasyonOrani(b);
    return oa - ob;
  });

  el("#pageWrap").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Oryantasyon</h1>
        <p>İşe başlayan herkesin oryantasyon ilerlemesi tek bakışta.</p>
      </div>
    </div>
    <div class="card-list">
      ${surenler.length ? surenler.map((a) => {
        const oran = oryantasyonOrani(a);
        return `
        <div class="aday-card" data-id="${a.id}">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:220px">
            ${avatarHtml(a.ad + " " + a.soyad, 38)}
            <div class="main">
              <b>${esc(a.ad)} ${esc(a.soyad)}</b>
              <div class="meta">${esc(a.unvan || "")} · ${esc(a.departman || "")} · ${esc(a.oryantasyon.sablonAdi || "Genel")}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="min-width:130px">
              <div style="font-size:10.5px;color:var(--ink-soft);margin-bottom:3px">%${oran} tamamlandı</div>
              <div class="progress-track"><div class="progress-fill" style="width:${oran}%"></div></div>
            </div>
            <span class="status-badge ${oran === 100 ? "st-tamam" : "st-basladi"}">${oran === 100 ? "Tamamlandı" : "Devam Ediyor"}</span>
          </div>
        </div>`;
      }).join("") : `<div class="empty-state">Şu anda oryantasyon sürecinde kimse yok.</div>`}
    </div>`;

  document.querySelectorAll(".aday-card[data-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const aday = adaylar.find((x) => x.id === card.dataset.id);
      if (aday) openAdayDetay(aday, isAdmin);
    });
  });
}
function oryantasyonOrani(a) {
  const maddeler = (a.oryantasyon && a.oryantasyon.maddeler) || [];
  if (!maddeler.length) return 0;
  return Math.round((maddeler.filter((m) => m.tamamlandi).length / maddeler.length) * 100);
}

function openAdayForm(onDoldur) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="drawer">
      <div class="drawer-head">
        <div><h2>Yeni Aday Ekle</h2><div class="meta">Görüşme aşamasında eklenir — olumlu karar verilince evrak/oryantasyon süreci otomatik başlar</div></div>
        <button class="close-x" id="closeDrawer">✕</button>
      </div>
      <div class="drawer-body">
        <div class="two-col">
          <div class="field"><label>Ad</label><input type="text" id="fAd" required></div>
          <div class="field"><label>Soyad</label><input type="text" id="fSoyad" required></div>
        </div>
        <div class="two-col">
          <div class="field"><label>Unvan (görüşülen pozisyon)</label>${unvanSelectHtml("fUnvan", (onDoldur && onDoldur.unvan) || "")}</div>
          <div class="field"><label>Departman</label>${departmanSelectHtml("fDepartman", (onDoldur && onDoldur.departman) || "", !!(onDoldur && onDoldur.departman))}</div>
        </div>
        <div class="two-col">
          <div class="field"><label>Bölüm</label>${bolumSelectHtml("fBolum", (onDoldur && onDoldur.bolum) || "")}</div>
        </div>
        ${onDoldur && onDoldur.baglıTalepId ? `<div class="meta" style="margin:-6px 0 10px">📋 Bu aday, onaylanmış bir personel talebine bağlanacak.</div>` : ""}
        <div class="two-col">
          <div class="field"><label>Telefon</label><input type="text" id="fTelefon" placeholder="05xx xxx xx xx"></div>
          <div class="field"><label>E-posta</label><input type="email" id="fEmail"></div>
        </div>
        <div class="section-title" style="margin-top:22px">Görüşme Bilgisi</div>
        <div class="field"><label>Görüşme Tarihi</label><input type="date" id="fGorusmeTarihi" required></div>
        <div class="field"><label>Görüşme Notu</label><textarea id="fGorusmeNotu" rows="4" placeholder="Görüşmede alınan notlar, izlenimler…"></textarea></div>
        <div class="field"><label>Genel Not</label><textarea id="fNot" rows="2" placeholder="Varsa eklemek istediğiniz başka bir not…"></textarea></div>
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
  wireUnvanSelect("fUnvan");
  wireDepartmanSelect("fDepartman");
  el("#kaydetBtn").onclick = async () => {
    const ad = el("#fAd").value.trim(), soyad = el("#fSoyad").value.trim(), gorusmeTarihi = el("#fGorusmeTarihi").value;
    if (!ad || !soyad || !gorusmeTarihi) { toast("Ad, soyad ve görüşme tarihi zorunludur."); return; }
    const btn = el("#kaydetBtn");
    btn.disabled = true; btn.textContent = "Kaydediliyor…";
    const simdi = bugunISO();
    const baglıTalepId = (onDoldur && onDoldur.baglıTalepId) || null;
    try {
      await addDoc(collection(db, "iseAlimAday"), {
        ad, soyad,
        unvan: unvanDegeriOku("fUnvan"),
        departman: departmanDegeriOku("fDepartman"),
        bolum: el("#fBolum").value,
        telefon: el("#fTelefon").value.trim(),
        email: el("#fEmail").value.trim(),
        gorusmeTarihi,
        gorusmeNotu: el("#fGorusmeNotu").value.trim(),
        iseBaslamaTarihi: null,
        notlar: el("#fNot").value.trim(),
        durum: "gorusme_bekliyor",
        karar: null, kararTarihi: null, redNedeni: null, redAciklama: null,
        sgkGirisYapildi: false,
        sgkGirisTarihi: null,
        evraklar: [],
        baglıTalepId,
        gecmis: [{ tarih: simdi, eskiDurum: null, yeniDurum: "gorusme_bekliyor", kullanici: currentProfile.adSoyad, not: "Aday kaydı oluşturuldu." }],
        olusturanKullanici: currentProfile.adSoyad,
        olusturmaTarihi: serverTimestamp(),
        guncellemeTarihi: serverTimestamp()
      });
      if (baglıTalepId) {
        const talep = talepler.find((x) => x.id === baglıTalepId);
        if (talep) {
          const yeniKarsilanan = (talep.karsilananAdet || 0) + 1;
          await setDoc(doc(db, "personelTalepleri", baglıTalepId), {
            karsilananAdet: yeniKarsilanan,
            durum: yeniKarsilanan >= talep.adet ? "karsilandi" : "kismen_karsilandi",
            guncellemeTarihi: serverTimestamp()
          }, { merge: true });
        }
      }
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
  // Yalnızca admin genel bilgi/evrak/SGK düzenleyebilir; ama oryantasyon ve
  // deneme süresi değerlendirmesi müdür tarafından da işlenebilir olmalı —
  // zaten bir müdür yalnızca KENDİ departmanındaki adayları açabiliyor
  // (bkz. render()), o yüzden burada ekstra bir departman kontrolüne gerek yok.
  const canEditSurec = true; // admin veya ilgili müdür — ikisi de bu ekranı açabildiyse yetkilidir

  function bodyHtml(a) {
    const oran = evrakOrani(a);
    const gorusmeAsamasinda = a.durum === "gorusme_bekliyor";
    const olumsuz = a.durum === "olumsuz";
    return `
    <div class="section-title" style="margin-top:0">Genel Bilgiler</div>
    <div class="two-col">
      <div class="field"><label>Unvan</label>${unvanSelectHtml("dUnvan", a.unvan || "", !isAdmin)}</div>
      <div class="field"><label>Departman</label>${departmanSelectHtml("dDepartman", a.departman || "", !isAdmin)}</div>
    </div>
    <div class="two-col">
      <div class="field"><label>Bölüm</label>${bolumSelectHtml("dBolum", a.bolum || "", !isAdmin)}</div>
      <div class="field"><label>Telefon</label><input type="text" id="dTelefon" value="${esc(a.telefon || "")}" ${isAdmin ? "" : "disabled"}></div>
      <div class="field"><label>E-posta</label><input type="email" id="dEmail" value="${esc(a.email || "")}" ${isAdmin ? "" : "disabled"}></div>
    </div>
    ${!gorusmeAsamasinda && !olumsuz ? `<div class="field"><label>İşe Başlama Tarihi</label><input type="date" id="dTarih" value="${esc(a.iseBaslamaTarihi || "")}" ${isAdmin ? "" : "disabled"}></div>` : ""}

    ${gorusmeAsamasinda ? gorusmeHtml(a) : ""}
    ${olumsuz ? olumsuzOzetHtml(a) : ""}

    ${!gorusmeAsamasinda && !olumsuz ? `
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

    ${a.oryantasyon ? oryantasyonHtml(a) : ""}
    ${a.denemeSuresi ? denemeSuresiHtml(a) : ""}
    ` : ""}

    ${a.gecmis && a.gecmis.length ? gecmisHtml(a) : ""}

    <div class="section-title">Not</div>
    <textarea id="dNot" rows="3" ${isAdmin ? "" : "disabled"}>${esc(a.notlar || "")}</textarea>

    ${!gorusmeAsamasinda ? `<div class="field" style="margin-top:14px"><label>Durum (elle düzeltme — normalde yukarıdaki aksiyon butonları kullanılır)</label>
      <select id="dDurum" ${isAdmin ? "" : "disabled"}>
        ${Object.keys(DURUM_ETIKET).filter((k) => k !== "gorusme_bekliyor").map((k) => `<option value="${k}" ${a.durum === k ? "selected" : ""}>${DURUM_ETIKET[k].label}</option>`).join("")}
      </select>
    </div>` : ""}`;
  }

  function gorusmeHtml(a) {
    return `
    <div class="section-title">Görüşme Bilgisi</div>
    <div class="two-col">
      <div class="field"><label>Görüşme Tarihi</label><input type="date" id="dGorusmeTarihi" value="${esc(a.gorusmeTarihi || "")}" ${isAdmin ? "" : "disabled"}></div>
    </div>
    <div class="field"><label>Görüşme Notu</label><textarea id="dGorusmeNotu" rows="4" ${isAdmin ? "" : "disabled"}>${esc(a.gorusmeNotu || "")}</textarea></div>
    ${isAdmin ? `
    <div class="karar-box">
      <div style="font-size:12.5px;font-weight:700;color:var(--ink-soft);margin-bottom:4px">KARAR</div>
      <div style="font-size:12px;color:var(--ink-soft);margin-bottom:6px">Görüşme sonucunda bu aday hakkındaki kararınızı seçin.</div>
      <button type="button" class="btn btn-good btn-sm" id="olumluBtn">✓ Olumlu — İşe Alınacak</button>
      <button type="button" class="btn btn-bad btn-sm" id="olumsuzBtn">✗ Olumsuz — Reddet</button>
      <div id="olumluForm" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
        <div class="field"><label>İşe Başlama Tarihi</label><input type="date" id="fOlumluTarih" required></div>
        <button type="button" class="btn btn-teal btn-sm" id="olumluOnayBtn">İşe Alımı Onayla</button>
      </div>
      <div id="olumsuzForm" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
        <div class="field"><label>Red Nedeni</label>
          <select id="fRedNedeni">${RED_NEDENLERI.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Açıklama (opsiyonel)</label><textarea id="fRedAciklama" rows="2"></textarea></div>
        <button type="button" class="btn btn-bad btn-sm" id="olumsuzOnayBtn">Reddi Onayla</button>
      </div>
    </div>` : `<div style="font-size:12.5px;color:var(--ink-soft)">Görüşme kararı yalnızca İK tarafından girilir.</div>`}`;
  }

  function olumsuzOzetHtml(a) {
    return `
    <div class="section-title">Görüşme Sonucu</div>
    <div class="evrak-row" style="border-color:var(--bad);background:var(--bad-bg)">
      <div>
        <div style="font-weight:700;color:var(--bad)">✗ Olumsuz — ${esc(a.redNedeni || "")}</div>
        ${a.redAciklama ? `<div style="font-size:12px;margin-top:4px">${esc(a.redAciklama)}</div>` : ""}
        <div style="font-size:11px;color:var(--ink-soft);margin-top:4px">Karar tarihi: ${fmtTarih(a.kararTarihi)}</div>
      </div>
    </div>
    <div style="font-size:11.5px;color:var(--ink-soft);margin-top:6px">Bu aday müdür panelinde görünmez, yalnızca İK erişebilir.</div>`;
  }

  function gecmisHtml(a) {
    const satirlar = [...a.gecmis].reverse().map((g) => `
      <div style="font-size:11.5px;color:var(--ink-soft);padding:6px 0;border-bottom:1px solid #eef1ef">
        <b style="color:var(--ink)">${fmtTarih(g.tarih)}</b> — ${esc(g.kullanici || "")}${g.not ? ": " + esc(g.not) : ""}
      </div>`).join("");
    return `<div class="section-title">Süreç Geçmişi</div><div style="margin-bottom:4px">${satirlar}</div>`;
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

  function oryantasyonHtml(a) {
    const maddeler = a.oryantasyon.maddeler || [];
    const tamam = maddeler.length ? maddeler.filter((m) => m.tamamlandi).length : 0;
    const oran = maddeler.length ? Math.round((tamam / maddeler.length) * 100) : 0;
    // maddeler kategoriye göre grupla, orijinal sıra korunur
    const kategoriler = [];
    maddeler.forEach((m, i) => {
      const kat = m.kategori || "Genel";
      let grp = kategoriler.find((g) => g.ad === kat);
      if (!grp) { grp = { ad: kat, satirlar: [] }; kategoriler.push(grp); }
      grp.satirlar.push({ ...m, idx: i });
    });
    return `
    <div class="section-title">Oryantasyon (${esc(a.oryantasyon.sablonAdi || "Genel")}) — %${oran} tamamlandı (${tamam}/${maddeler.length})</div>
    <div class="progress-track" style="margin-bottom:12px"><div class="progress-fill" style="width:${oran}%"></div></div>
    <div id="oryantasyonListesi">
      ${kategoriler.map((grp, gi) => {
        const grpTamam = grp.satirlar.filter((m) => m.tamamlandi).length;
        const grpOran = Math.round((grpTamam / grp.satirlar.length) * 100);
        const acik = grpOran < 100;
        return `
        <div class="oryan-kategori ${acik ? "open" : ""}" data-kategori-idx="${gi}">
          <div class="oryan-kategori-head" data-kategori-toggle="${gi}">
            <span class="t">${esc(grp.ad)}</span>
            <span class="pc">${grpTamam}/${grp.satirlar.length}</span>
            <div class="progress-track"><div class="progress-fill" style="width:${grpOran}%"></div></div>
            <span class="caret">▶</span>
          </div>
          <div class="oryan-kategori-body">
            ${grp.satirlar.map((m) => `
              <div class="oryan-madde">
                <label class="baslik">
                  <input type="checkbox" data-oryantasyon-check="${m.idx}" ${m.tamamlandi ? "checked" : ""} ${canEditSurec ? "" : "disabled"}>
                  ${esc(m.baslik || m.ad || "")}
                </label>
                ${m.kapsam ? `<div class="kapsam">${esc(m.kapsam)}</div>` : ""}
                ${m.sorumlu ? `<div class="sorumlu">Sorumlu: ${esc(m.sorumlu)}${m.tamamlanmaTarihi || m.tarih ? " · Tamamlandı: " + fmtTarih(m.tamamlanmaTarihi || m.tarih) : ""}</div>` : (m.tamamlanmaTarihi || m.tarih ? `<div class="sorumlu">Tamamlandı: ${fmtTarih(m.tamamlanmaTarihi || m.tarih)}</div>` : "")}
              </div>`).join("")}
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }

  function denemeSuresiHtml(a) {
    const ds = a.denemeSuresi;
    const deg = ds.degerlendirme || {};
    const kilitli = !!ds.degerlendirmeYapildiMi;
    const kalanGun = gunFarki(ds.bitisTarihi);
    const devreDisi = kilitli || !canEditSurec;
    return `
    <div class="section-title">Deneme Süresi Değerlendirmesi</div>
    <div style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px">
      Başlangıç: ${fmtTarih(a.iseBaslamaTarihi)} · Bitiş: ${fmtTarih(ds.bitisTarihi)}
      ${kilitli ? ` · <span style="color:var(--good);font-weight:600">✓ Değerlendirme kesinleşti</span>` : (kalanGun !== null ? ` · ${kalanGun >= 0 ? kalanGun + " gün kaldı" : "süresi doldu"}` : "")}
    </div>
    ${!kilitli ? `<div class="evrak-row" style="background:var(--paper);font-size:11px;color:var(--ink-soft);line-height:1.5;white-space:pre-wrap">${esc(DENEME_KVKK_METNI)}</div>
    <label style="display:flex;align-items:flex-start;gap:8px;font-size:12.5px;font-weight:600;margin:10px 0;cursor:pointer">
      <input type="checkbox" id="dDenemeKvkk" ${deg._kvkkOnay ? "checked" : ""} ${devreDisi ? "disabled" : ""} style="margin-top:2px">
      Değerlendirme formunu okudum anladım kabul ediyorum.
    </label>` : ""}
    <div class="two-col">
      <div class="field"><label>Değerlendirilecek Çalışan</label><input type="text" value="${esc(a.ad + " " + a.soyad + ", " + (a.departman || "") + ", " + (a.unvan || ""))}" disabled></div>
      <div class="field"><label>Değerlendiren Müdür/Direktör</label><input type="text" value="${esc(deg.degerlendirenKullanici || currentProfile.adSoyad)}" disabled></div>
    </div>
    <div id="denemeKriterListesi">
      ${DENEME_KRITERLERI.map((k) => `
        <div class="evrak-row" style="align-items:flex-start;flex-direction:column;gap:6px">
          <div style="width:100%">
            <div style="font-size:12px;font-weight:700;color:var(--teal-deep)">${esc(k.kategori)}</div>
            <div class="name" style="font-weight:500">${esc(k.ad)}</div>
          </div>
          <select data-deneme-kriter="${k.key}" ${devreDisi ? "disabled" : ""} style="width:100%">
            <option value="">Seçiniz</option>
            ${DENEME_PUAN_OPT.map((p) => `<option value="${p.key}" ${deg[k.key] === p.key ? "selected" : ""}>${p.label}</option>`).join("")}
          </select>
        </div>`).join("")}
    </div>
    <div class="field" style="margin-top:10px">
      <label>Genel Değerlendirme (Yönetici Yorumu)</label>
      <textarea id="dDenemeYorum" rows="3" ${devreDisi ? "disabled" : ""}>${esc(deg.yorum || "")}</textarea>
    </div>
    <div class="field">
      <label>Sonuç</label>
      ${radioGrupHtml("dDenemeSonuc", deg.sonuc || "", DENEME_SONUC_OPT.map((s) => ({ key: s, label: s })), devreDisi)}
    </div>
    ${!kilitli && canEditSurec ? `<button class="btn btn-teal btn-sm" id="denemeKesinlestirBtn" type="button">Değerlendirmeyi Kesinleştir</button>` : ""}`;
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
        <button class="btn btn-teal" id="guncelleBtn">Kaydet</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  el("#closeDrawer").onclick = () => overlay.remove();

  let workingCopy = JSON.parse(JSON.stringify(aday));

  function wireDynamicEvents() {
    document.querySelectorAll("[data-evrak-check]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const i = +cb.dataset.evrakCheck;
        workingCopy.evraklar[i].teslimAlindi = cb.checked;
        cb.closest(".evrak-row").classList.toggle("done", cb.checked);
      });
    });
    document.querySelectorAll("[data-oryantasyon-check]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const i = +cb.dataset.oryantasyonCheck;
        workingCopy.oryantasyon.maddeler[i].tamamlandi = cb.checked;
        workingCopy.oryantasyon.maddeler[i].tamamlanmaTarihi = cb.checked ? bugunISO() : null;
        cb.closest(".oryan-madde").classList.toggle("done", cb.checked);
      });
    });
    document.querySelectorAll("[data-kategori-toggle]").forEach((h) => {
      h.addEventListener("click", () => h.closest(".oryan-kategori").classList.toggle("open"));
    });
    const unvanSel = document.getElementById("dUnvan");
    if (unvanSel) wireUnvanSelect("dUnvan");
    const departmanSel = document.getElementById("dDepartman");
    if (departmanSel) wireDepartmanSelect("dDepartman");
    const olumluBtn = document.getElementById("olumluBtn"), olumsuzBtn = document.getElementById("olumsuzBtn");
    if (olumluBtn) olumluBtn.addEventListener("click", () => {
      document.getElementById("olumluForm").style.display = "";
      document.getElementById("olumsuzForm").style.display = "none";
    });
    if (olumsuzBtn) olumsuzBtn.addEventListener("click", () => {
      document.getElementById("olumsuzForm").style.display = "";
      document.getElementById("olumluForm").style.display = "none";
    });
    const olumluOnayBtn = document.getElementById("olumluOnayBtn");
    if (olumluOnayBtn) olumluOnayBtn.addEventListener("click", async () => {
      const tarih = document.getElementById("fOlumluTarih").value;
      if (!tarih) { toast("İşe başlama tarihi zorunludur."); return; }
      olumluOnayBtn.disabled = true; olumluOnayBtn.textContent = "Kaydediliyor…";
      const unvanGuncel = unvanDegeriOku("dUnvan") || aday.unvan;
      const sablon = oryantasyonSablonSec(unvanGuncel);
      const patch = {
        unvan: unvanGuncel,
        durum: "evrak_bekliyor",
        karar: "olumlu", kararTarihi: bugunISO(),
        iseBaslamaTarihi: tarih,
        evraklar: STANDART_EVRAK_LISTESI.map((ad2) => ({ ad: ad2, teslimAlindi: false, dosyaUrl: null, dosyaAdi: null, yuklemeTarihi: null })),
        oryantasyon: { sablonAdi: sablon.sablonAdi, maddeler: sablon.maddeler },
        gecmis: gecmisEkle(aday.gecmis, "gorusme_bekliyor", "evrak_bekliyor", `Görüşme olumlu sonuçlandı, işe başlama: ${fmtTarih(tarih)}.`)
      };
      try {
        await persist(patch);
        toast("✓ Aday işe alım sürecine alındı.");
        overlay.remove();
      } catch (e) {
        toast("Kaydedilemedi: " + e.message);
        olumluOnayBtn.disabled = false; olumluOnayBtn.textContent = "İşe Alımı Onayla";
      }
    });
    const olumsuzOnayBtn = document.getElementById("olumsuzOnayBtn");
    if (olumsuzOnayBtn) olumsuzOnayBtn.addEventListener("click", async () => {
      const redNedeni = document.getElementById("fRedNedeni").value;
      const redAciklama = document.getElementById("fRedAciklama").value.trim();
      olumsuzOnayBtn.disabled = true; olumsuzOnayBtn.textContent = "Kaydediliyor…";
      const patch = {
        durum: "olumsuz",
        karar: "olumsuz", kararTarihi: bugunISO(),
        redNedeni, redAciklama,
        gecmis: gecmisEkle(aday.gecmis, "gorusme_bekliyor", "olumsuz", `Görüşme olumsuz sonuçlandı: ${redNedeni}.`)
      };
      try {
        await persist(patch);
        toast("✓ Kaydedildi.");
        overlay.remove();
      } catch (e) {
        toast("Kaydedilemedi: " + e.message);
        olumsuzOnayBtn.disabled = false; olumsuzOnayBtn.textContent = "Reddi Onayla";
      }
    });
    document.querySelectorAll("[data-deneme-kriter]").forEach((sel) => {
      sel.addEventListener("change", () => {
        if (!workingCopy.denemeSuresi.degerlendirme) workingCopy.denemeSuresi.degerlendirme = {};
        workingCopy.denemeSuresi.degerlendirme[sel.dataset.denemeKriter] = sel.value;
      });
    });
    const denemeKvkkCb = document.getElementById("dDenemeKvkk");
    if (denemeKvkkCb) denemeKvkkCb.addEventListener("change", () => {
      if (!workingCopy.denemeSuresi.degerlendirme) workingCopy.denemeSuresi.degerlendirme = {};
      workingCopy.denemeSuresi.degerlendirme._kvkkOnay = denemeKvkkCb.checked;
    });
    const denemeKesinlestirBtn = document.getElementById("denemeKesinlestirBtn");
    if (denemeKesinlestirBtn) {
      denemeKesinlestirBtn.addEventListener("click", async () => {
        const yorum = document.getElementById("dDenemeYorum").value.trim();
        const sonuc = radioGrupOku("dDenemeSonuc");
        const kvkkOnayli = document.getElementById("dDenemeKvkk") && document.getElementById("dDenemeKvkk").checked;
        const eksikKriter = DENEME_KRITERLERI.some((k) => !(workingCopy.denemeSuresi.degerlendirme || {})[k.key]);
        if (!kvkkOnayli) { toast("KVKK aydınlatma metnini onaylamanız gerekiyor."); return; }
        if (eksikKriter || !sonuc || !yorum) { toast("Tüm kriterler, genel değerlendirme yorumu ve sonuç seçilmelidir."); return; }
        denemeKesinlestirBtn.disabled = true; denemeKesinlestirBtn.textContent = "Kaydediliyor…";
        const yeniDurum = sonuc === DENEME_SONUC_OPT[0] ? "tamamlandi" : "vazgecti";
        const patch = {
          // Aynı oturumda oryantasyon kutucuklarında da değişiklik yapılmış
          // olabilir — Kesinleştir'e basınca bunlar kaybolmasın diye dahil edilir.
          oryantasyon: workingCopy.oryantasyon,
          denemeSuresi: {
            ...workingCopy.denemeSuresi,
            degerlendirmeYapildiMi: true,
            degerlendirme: { ...workingCopy.denemeSuresi.degerlendirme, yorum, sonuc, degerlendirenKullanici: currentProfile.adSoyad, tarih: bugunISO() }
          },
          durum: yeniDurum,
          gecmis: gecmisEkle(aday.gecmis, aday.durum, yeniDurum, `Deneme süresi değerlendirmesi kesinleşti: ${sonuc}`)
        };
        try {
          await persist(patch);
          toast("✓ Deneme süresi değerlendirmesi kesinleşti.");
          overlay.remove();
        } catch (e) {
          toast("Kaydedilemedi: " + e.message);
          denemeKesinlestirBtn.disabled = false; denemeKesinlestirBtn.textContent = "Değerlendirmeyi Kesinleştir";
        }
      });
    }
  }
  wireDynamicEvents();

  async function persist(patch) {
    await setDoc(doc(db, "iseAlimAday", aday.id), { ...patch, guncellemeTarihi: serverTimestamp() }, { merge: true });
  }

  el("#guncelleBtn").onclick = async () => {
    const btn = el("#guncelleBtn");
    btn.disabled = true; btn.textContent = "Kaydediliyor…";
    const ortakPatch = {
      unvan: unvanDegeriOku("dUnvan"),
      departman: departmanDegeriOku("dDepartman"),
      bolum: el("#dBolum").value,
      telefon: el("#dTelefon").value.trim(),
      email: el("#dEmail").value.trim(),
      notlar: el("#dNot").value.trim()
    };
    // Görüşme aşamasındayken "Kaydet", karar butonlarına dokunmadan sadece
    // notları/bilgileri günceller — karar yalnızca Olumlu/Olumsuz butonlarıyla verilir.
    if (aday.durum === "gorusme_bekliyor") {
      const patch = {
        ...ortakPatch,
        gorusmeTarihi: el("#dGorusmeTarihi").value,
        gorusmeNotu: el("#dGorusmeNotu").value.trim()
      };
      try {
        await persist(patch);
        toast("✓ Kaydedildi.");
        overlay.remove();
      } catch (e) {
        toast("Kaydedilemedi: " + e.message);
        btn.disabled = false; btn.textContent = "Kaydet";
      }
      return;
    }

    const sgkChecked = el("#dSgk").checked;
    const yeniDurum = el("#dDurum").value;
    const patch = {
      ...ortakPatch,
      iseBaslamaTarihi: el("#dTarih").value,
      durum: yeniDurum,
      sgkGirisYapildi: sgkChecked,
      sgkGirisTarihi: sgkChecked ? (aday.sgkGirisTarihi || bugunISO()) : null,
      evraklar: workingCopy.evraklar
    };
    if (yeniDurum !== aday.durum) patch.gecmis = gecmisEkle(aday.gecmis, aday.durum, yeniDurum, "Durum elle güncellendi.");
    // İşe Başladı durumuna ilk kez geçiliyorsa oryantasyon şablonunu ve
    // deneme süresi bitiş tarihini otomatik oluştur.
    if (yeniDurum === "ise_basladi" && !aday.oryantasyon) {
      const sablon = oryantasyonSablonSec(patch.unvan || aday.unvan);
      patch.oryantasyon = { sablonAdi: sablon.sablonAdi, maddeler: sablon.maddeler };
    } else if (workingCopy.oryantasyon) {
      patch.oryantasyon = workingCopy.oryantasyon;
    }
    if (yeniDurum === "ise_basladi" && !aday.denemeSuresi) {
      patch.denemeSuresi = { bitisTarihi: denemeSuresiBitisHesapla(patch.iseBaslamaTarihi || aday.iseBaslamaTarihi), degerlendirmeYapildiMi: false, degerlendirme: {} };
    } else if (workingCopy.denemeSuresi) {
      patch.denemeSuresi = workingCopy.denemeSuresi;
    }
    try {
      await persist(patch);
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
