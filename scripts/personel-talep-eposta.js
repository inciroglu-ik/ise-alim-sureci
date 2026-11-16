/* Personel talebi onay e-postası şablonu (16.11.2026).
   eposta-kuyrugu.js kullanır: kuyruk kaydı kaynak "personel-talebi" ise konu ve gövde istemciden ALINMAZ; burada
   personelTalepFormlari/{ilgili} kaydından üretilir (kimse İK adresinden serbest içerikli e-posta gönderemesin diye).
   sablon: 'direktor' (talep oluşturuldu → departman direktörüne) · 'ik' (direktör onayladı → İK Direktörüne).
   Ücret ve bütçe e-postaya YAZILMAZ (e-posta iletilebilir); ayrıntı yalnız portalda, girişle görülür.
   Node (require) ve tarayıcı (window.PersonelTalepEposta, yalnız yerel test) ikisinde de çalışır. Kişi verisi içermez. */
(function (kok) {
  const BAGLANTI = 'https://inciroglu-ik.github.io/IK-PLATFORM/personel-talep.html#/talep/';
  const ASAMALAR = [
    { kod: 'talep', ad: 'Talep eden yönetici' }, { kod: 'direktor', ad: 'Onay veren direktör' },
    { kod: 'ik', ad: 'İnsan Kaynakları Direktörü' }, { kod: 'ceo', ad: 'CEO' }
  ];
  const KARAR = { onay: 'Onayladı', revize: 'Revize istedi', red: 'Reddetti', erteleme: 'Erteledi' };
  const RENK = { laci: '#16294a', celik: '#3f6c9e', zemin: '#f3f5f9', cizgi: '#dfe4ec', metin: '#1d2733', metin3: '#7a8494', vurgu: '#e9eff7', kirmizi: '#9b3a2e' };
  /* Serbest metin (pozisyon, ad, unvan) bağlantıya dönüşemesin: "://", "www." ve alan adı biçimi (a.b) etkisizleştirilir.
     Açıklama gibi uzun serbest metinler e-postaya HİÇ yazılmaz (yalnız portalda, girişle görülür). */
  const notr = (s) => String(s == null ? '' : s).replace(/:\/\//g, ' ').replace(/www\./gi, 'www ').replace(/([0-9a-zçğıöşü])\.([a-zçğıöşü])/gi, '$1․$2');
  const escHam = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = (s) => escHam(notr(s));
  const trBaslik = (s) => String(s == null ? '' : s).toLocaleLowerCase('tr').replace(/(^|[\s\-/(.'’])([^\s\-/(.'’])/gu, (m, a, b) => a + b.toLocaleUpperCase('tr'));
  const tarihTR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
  function zaman(t) {
    let d = null;
    if (t && typeof t.toDate === 'function') d = t.toDate();
    else if (t instanceof Date) d = t;
    else if (typeof t === 'number') d = new Date(t);
    else if (t && typeof t.seconds === 'number') d = new Date(t.seconds * 1000);
    else if (t && typeof t._seconds === 'number') d = new Date(t._seconds * 1000);
    if (!d || isNaN(d)) return '';
    try { return d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }); } catch (e) { return d.toISOString().slice(0, 10); }
  }
  /* imza adı: kararı verenin kendi kaydı (zincir sonradan değişse de); CEO'yu İK işaretlediyse CEO'nun adı */
  function imzaAdi(t, kod) {
    if (kod === 'talep') return (t.talepEden || {}).ad || '';
    const o = (t.onaylar || {})[kod];
    if (o && o.karar && !o.adina && o.ad) return o.ad;
    return ((t.zincir || {})[kod] || {}).ad || '';
  }
  function satir(etiket, deger) {
    return '<tr><td style="padding:8px 12px;border-bottom:1px solid ' + RENK.cizgi + ';width:38%;font-size:12.5px;color:' + RENK.metin3 + ';vertical-align:top">' + esc(etiket) + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid ' + RENK.cizgi + ';font-size:13.5px;color:' + RENK.metin + ';vertical-align:top;white-space:pre-wrap">' + esc(deger || '—') + '</td></tr>';
  }
  function onayAlanlari(t, bekleyen) {
    const o = t.onaylar || {};
    return ASAMALAR.map((a) => {
      let durum, renk = RENK.metin3, zemin = '#ffffff';
      if (a.kod === 'talep') { durum = 'Talebi oluşturdu · ' + zaman(t.olusturma); renk = RENK.celik; }
      else {
        const k = o[a.kod];
        if (k && k.karar) { durum = (KARAR[k.karar] || k.karar) + (k.adina ? ' (İK işaretledi)' : '') + ' · ' + zaman(k.zaman); renk = k.karar === 'onay' ? RENK.celik : RENK.kirmizi; }
        else if (a.kod === bekleyen) { durum = 'Onayınızı bekliyor'; renk = RENK.laci; zemin = RENK.vurgu; }
        else durum = a.kod === 'ceo' ? 'Sırada · CEO kararını İnsan Kaynakları işaretler' : 'Sırada';
      }
      return '<tr style="background:' + zemin + '"><td style="padding:9px 12px;border-bottom:1px solid ' + RENK.cizgi + ';font-size:12px;color:' + RENK.metin3 + ';text-transform:uppercase;letter-spacing:.04em;width:38%">' + esc(a.ad) + '</td>' +
        '<td style="padding:9px 12px;border-bottom:1px solid ' + RENK.cizgi + ';font-size:13.5px;color:' + RENK.metin + '"><b>' + esc(trBaslik(imzaAdi(t, a.kod)) || '—') + '</b><br><span style="font-size:12.5px;color:' + renk + ';font-weight:600">' + esc(durum) + '</span></td></tr>';
    }).join('');
  }
  function konu(sablon, t) {
    const f = t.form || {};
    return notr('Personel talebi onayınızı bekliyor · ' + String(t.departman || '') + ' ' + String(t.bolum || '') + ' · ' + String(f.pozisyon || '') + ' (' + String(t.no || '') + ')').replace(/[\r\n]+/g, ' ').slice(0, 200);
  }
  function html(sablon, t, id) {
    const f = t.form || {}, z = t.zincir || {};
    const alici = trBaslik(((z[sablon] || {}).ad) || '');
    const talepEden = trBaslik((t.talepEden || {}).ad) + ((t.talepEden || {}).unvan ? ' (' + trBaslik(t.talepEden.unvan) + ')' : '');
    const dep = String(t.departman || '') + (t.bolum ? ' ' + t.bolum : '');
    let giris;
    if (sablon === 'direktor') {
      giris = 'Ekibinizden <b>' + esc(talepEden) + '</b>, İK Portalı’nda İnsan Kaynakları ekibine gönderilmek üzere <b>' + esc(dep) + '</b> departmanı <b>' + esc(f.pozisyon) + '</b> unvanı için personel talep formu oluşturmuştur.';
    } else {
      const dir = (t.onaylar || {}).direktor || {};
      const kendi = dir.pid && t.talepEden && dir.pid === t.talepEden.pid;
      giris = '<b>' + esc(dep) + '</b> departmanı <b>' + esc(f.pozisyon) + '</b> unvanı için <b>' + esc(talepEden) + '</b> tarafından oluşturulan personel talep formu, ' +
        (kendi ? 'talebi oluşturan direktör tarafından onaylanarak gönderilmiştir.' : '<b>' + esc(trBaslik(imzaAdi(t, 'direktor'))) + '</b> tarafından direktör olarak onaylanmıştır.');
    }
    /* yalnız seçmeli alanlar (serbest metin yok: açıklama, kimin yerine, gerekçeler portalda) */
    const nedenler = (f.nedenler || []).join(', ') + ((f.nedenler || []).indexOf('Yerine alım') >= 0 && f.yerineCikis ? ' (ayrılış: ' + tarihTR(f.yerineCikis) + ')' : '');
    const ozet = [
      ['Talep no', t.no], ['Talep tarihi', tarihTR(f.tarih)], ['Departman', dep], ['Pozisyon', f.pozisyon], ['Talep nedeni', nedenler],
      ['İç aday değerlendirmesi', f.icAday], ['Eksik personelle devam', f.devam],
      ['Alınmazsa oluşacak riskler', (f.riskler || []).join(', ')], ['Distribütör / marka zorunluluğu', f.marka]
    ];
    const link = BAGLANTI + encodeURIComponent(String(id || ''));
    const btn = '<a href="' + escHam(link) + '" style="display:inline-block;background:' + RENK.laci + ';color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 26px;border-radius:10px">Talebi görüntüle ve onay ver</a>';
    const baslik = (m) => '<div style="font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + RENK.metin3 + ';margin:6px 0 8px">' + m + '</div>';
    const tablo = (ic) => '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ' + RENK.cizgi + ';border-radius:10px;border-collapse:separate;overflow:hidden">' + ic + '</table>';
    return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
      '<body style="margin:0;padding:0;background:' + RENK.zemin + ';font-family:Inter,Segoe UI,Arial,sans-serif;color:' + RENK.metin + '">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:' + RENK.zemin + ';padding:24px 0"><tr><td align="center">' +
      '<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid ' + RENK.cizgi + ';border-radius:14px;overflow:hidden">' +
      '<tr><td style="background:' + RENK.laci + ';padding:20px 28px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#b9c7dc">İnciroğlu Otomotiv · İnsan Kaynakları</div>' +
      '<div style="font-size:21px;font-weight:600;color:#ffffff;margin-top:4px;font-family:Georgia,serif">Personel Talep Formu · Onay</div></td></tr>' +
      '<tr><td style="padding:26px 28px 6px;font-size:14.5px;line-height:1.65;color:' + RENK.metin + '">' +
      '<p style="margin:0 0 12px">Sayın ' + esc(alici) + ',</p><p style="margin:0 0 12px">' + giris + '</p>' +
      '<p style="margin:0 0 4px">Aşağıdaki bağlantıdan talebin tüm ayrıntılarını görüntüleyip formun yanındaki onay alanından kararınızı vermenizi rica ederiz.</p></td></tr>' +
      '<tr><td align="center" style="padding:18px 28px 8px">' + btn + '</td></tr>' +
      '<tr><td style="padding:2px 28px 18px;font-size:12px;color:' + RENK.metin3 + ';text-align:center">Bağlantı İK Portalı girişini ister (T.C. Kimlik No ve şifreniz). Onayı yalnız siz verebilirsiniz.</td></tr>' +
      '<tr><td style="padding:0 28px 6px">' + baslik('Talep özeti') + tablo(ozet.map((s) => satir(s[0], s[1])).join('')) + '</td></tr>' +
      '<tr><td style="padding:18px 28px 6px">' + baslik('Onay alanları') + tablo(onayAlanlari(t, sablon)) + '</td></tr>' +
      '<tr><td align="center" style="padding:20px 28px 26px">' + btn + '</td></tr>' +
      '<tr><td style="background:' + RENK.zemin + ';padding:14px 28px;font-size:11.5px;color:' + RENK.metin3 + ';line-height:1.6">Bu e-posta İK Portalı tarafından otomatik gönderilmiştir. Ücret ve bütçe bilgileri güvenlik nedeniyle e-postada yer almaz; portalda görüntülenir.</td></tr>' +
      '</table></td></tr></table></body></html>';
  }
  const disa = { konu, html, BAGLANTI };
  if (typeof module !== 'undefined' && module.exports) module.exports = disa;
  else kok.PersonelTalepEposta = disa;
})(typeof window !== 'undefined' ? window : this);
