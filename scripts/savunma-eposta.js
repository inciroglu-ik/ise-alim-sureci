/* Savunma talebi e-postaları (25.11.2026). eposta-kuyrugu.js kullanır: kuyruk kaydı kaynak "savunma" ise konu ve gövde
   istemciden ALINMAZ; savunmalar/{ilgili} kaydından burada üretilir ve alıcı talepte kayıtlı adresle karşılaştırılır.
   sablon:
   - 'onay'    İK belgeleri onayladı → talebi açan müdüre (talep.mudurEposta). Ek: savunma istem yazısı + olay tespit tutanağı
               (PDF; savunmalar/{id}/ekler/{istem|tutanak}). Müdürden: imzalatıp taranmış PDF'i portala yüklemesi istenir.
   - 'kapanis' Müdür taranmış belgeyi yükledi ya da "çalışan imtina etti" işaretledi → çalışanın direktörüne (talep.direktorEposta).
   Olayın serbest metin açıklaması e-postaya YAZILMAZ (yalnız konu başlığı; ayrıntı PDF'te ve portalda, girişle).
   Node (require) ve tarayıcı (window.SavunmaEposta, yalnız yerel test) ikisinde de çalışır. Kişi verisi içermez. */
(function (kok) {
  const BAGLANTI = 'https://inciroglu-ik.github.io/IK-PLATFORM/savunma.html#/t/';
  const RENK = { laci: '#16294a', celik: '#3f6c9e', zemin: '#f3f5f9', cizgi: '#dfe4ec', metin: '#1d2733', metin3: '#7a8494', vurgu: '#e9eff7', uyari: '#8a560d', uyariZemin: '#fdf6e8' };
  const notr = (s) => String(s == null ? '' : s).replace(/:\/\//g, ' ').replace(/www\./gi, 'www ').replace(/([0-9a-zçğıöşü])\.([a-zçğıöşü])/gi, '$1․$2');
  const escHam = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = (s) => escHam(notr(s));
  const trBaslik = (s) => String(s == null ? '' : s).toLocaleLowerCase('tr').replace(/(^|[\s\-/(.'’])([^\s\-/(.'’])/gu, (m, a, b) => a + b.toLocaleUpperCase('tr'));
  const tarihTR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
  const tek = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
  /* Departman / unvan: 4 harfe kadar sözcükler (BMW, PSA, FIAT) korunur, "ve" küçük; diğerleri baş harfi büyük (portal ile aynı) */
  const ust = (s) => String(s).replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
  const depBicim = (s) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!t || t !== ust(t)) return t;
    return t.split(' ').map((w, i) => {
      const k = w.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
      if (i > 0 && (k === 've' || k === 'ile')) return k;
      if (w.replace(/[^\p{L}]/gu, '').length <= 4 && /\p{L}/u.test(w)) return w;
      return k ? (k[0] === 'i' ? 'İ' : k[0] === 'ı' ? 'I' : k[0].toUpperCase()) + k.slice(1) : w;
    }).join(' ');
  };

  function bilgi(t) {
    const c = t.calisan || {}, o = t.olay || {}, m = t.mudur || {};
    return { ad: trBaslik(c.ad), unvan: depBicim(c.unvan), dep: depBicim(c.departman), bolum: c.bolum || '', direktor: trBaslik(c.direktor),
      mudur: trBaslik(m.ad), konu: tek(o.konu), tarih: tarihTR(o.tarih), no: tek(t.no), sure: +t.sure || 2 };
  }
  function konu(sablon, t) {
    const b = bilgi(t);
    const k = sablon === 'onay'
      ? 'Savunma talebiniz onaylandı · ' + b.no
      : (t.kapanis && t.kapanis.tur === 'imtina' ? 'Savunma süreci · çalışan imtina etti · ' : 'Savunma süreci tamamlandı · ') + b.no;
    return notr(k).slice(0, 200);
  }
  function satir(etiket, deger) {
    return '<tr><td style="padding:8px 12px;border-bottom:1px solid ' + RENK.cizgi + ';width:36%;font-size:12.5px;color:' + RENK.metin3 + ';vertical-align:top">' + esc(etiket) + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid ' + RENK.cizgi + ';font-size:13.5px;color:' + RENK.metin + ';vertical-align:top">' + esc(deger || '—') + '</td></tr>';
  }
  const tablo = (ic) => '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ' + RENK.cizgi + ';border-radius:10px;border-collapse:separate;overflow:hidden">' + ic + '</table>';
  const kutuBaslik = (m) => '<div style="font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' + RENK.metin3 + ';margin:6px 0 8px">' + m + '</div>';
  function kabuk(ust, govde, alt) {
    return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
      '<body style="margin:0;padding:0;background:' + RENK.zemin + ';font-family:Inter,Segoe UI,Arial,sans-serif;color:' + RENK.metin + '">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:' + RENK.zemin + ';padding:24px 0"><tr><td align="center">' +
      '<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid ' + RENK.cizgi + ';border-radius:14px;overflow:hidden">' +
      '<tr><td style="background:' + RENK.laci + ';padding:20px 28px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#b9c7dc">İnciroğlu Otomotiv · İnsan Kaynakları</div>' +
      '<div style="font-size:21px;font-weight:600;color:#ffffff;margin-top:4px;font-family:Georgia,serif">' + ust + '</div></td></tr>' + govde +
      '<tr><td style="background:' + RENK.zemin + ';padding:14px 28px;font-size:11.5px;color:' + RENK.metin3 + ';line-height:1.6">' + alt + '</td></tr>' +
      '</table></td></tr></table></body></html>';
  }
  function html(sablon, t, id) {
    const b = bilgi(t);
    const link = BAGLANTI + encodeURIComponent(String(id || ''));
    const ozet = tablo([['Talep no', b.no], ['Çalışan', b.ad], ['Unvan', b.unvan], ['Departman', b.dep + (b.bolum ? ' / ' + b.bolum : '')], ['Konu', b.konu], ['Olay tarihi', b.tarih]].map((s) => satir(s[0], s[1])).join(''));
    if (sablon === 'onay') {
      const btn = '<a href="' + escHam(link) + '" style="display:inline-block;background:' + RENK.laci + ';color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 26px;border-radius:10px">Taranmış belgeyi yükle</a>';
      const adim = (n, m) => '<tr><td style="padding:7px 0;vertical-align:top;width:30px"><span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:' + RENK.vurgu + ';color:' + RENK.laci + ';font-weight:700;font-size:12px;text-align:center;line-height:22px">' + n + '</span></td><td style="padding:7px 0;font-size:14px;line-height:1.55">' + m + '</td></tr>';
      const govde = '<tr><td style="padding:26px 28px 6px;font-size:14.5px;line-height:1.65">' +
        '<p style="margin:0 0 12px">Sayın ' + esc(b.mudur) + ',</p>' +
        '<p style="margin:0 0 12px"><b>' + esc(b.dep) + '</b> departmanında <b>' + esc(b.unvan) + '</b> unvanıyla görev yapan <b>' + esc(b.ad) + '</b> için açtığınız savunma talebi İnsan Kaynakları tarafından onaylanmıştır. Çalışandan yazılı savunma alınması gerekmektedir.</p>' +
        '<p style="margin:0 0 4px">Hukuka uygun olarak hazırlanan <b>Savunma İstem Yazısı</b> ve <b>Olay Tespit Tutanağı</b> bu e-postanın ekindedir (PDF).</p></td></tr>' +
        '<tr><td style="padding:10px 28px 4px">' + kutuBaslik('Yapmanız gerekenler') + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">' +
        adim(1, 'İki belgeyi yazdırın. <b>Olay tespit tutanağını</b> olaya tanık olanlarla birlikte imzalayın.') +
        adim(2, '<b>Savunma istem yazısını</b> çalışana tebliğ edip imzalatın. Çalışan yazılı savunmasını <b>yazıda belirtilen süre içinde</b> yazının ikinci sayfasına ya da ayrı bir dilekçeye yazar.') +
        adim(3, 'İmzalı belgeleri ve çalışanın yazılı savunmasını <b>tarayıp tek PDF olarak</b> aşağıdaki bağlantıdan talebinize yükleyin.') +
        adim(4, 'Islak imzalı asılları İnsan Kaynakları Departmanına iletin.') + '</table></td></tr>' +
        '<tr><td style="padding:10px 28px 4px"><div style="background:' + RENK.uyariZemin + ';border-left:4px solid #c9831c;border-radius:8px;padding:10px 14px;font-size:13.5px;line-height:1.55;color:' + RENK.uyari + '">' +
        '<b>Önemli:</b> İmzalı belgeler taranıp sisteme yüklenmedikçe savunma talebi tamamlanmış sayılmaz ve geçersizdir. Çalışan belgeleri imzalamaktan ya da savunma vermekten imtina ederse, yükleme ekranındaki <b>“Çalışan imzadan / savunma vermekten imtina etti”</b> kutucuğunu işaretleyin; imtina tutanağı İnsan Kaynakları tarafından hazırlanır.</div></td></tr>' +
        '<tr><td align="center" style="padding:20px 28px 8px">' + btn + '</td></tr>' +
        '<tr><td style="padding:2px 28px 18px;font-size:12px;color:' + RENK.metin3 + ';text-align:center">Bağlantı İK Portalı girişini ister (T.C. Kimlik No ve şifreniz). Belgeler portaldaki talebinizde de indirilebilir.</td></tr>' +
        '<tr><td style="padding:0 28px 22px">' + kutuBaslik('Talep özeti') + ozet + '</td></tr>';
      return kabuk('Savunma Talebi · Onaylandı', govde, 'Bu e-posta İK Portalı tarafından otomatik gönderilmiştir. Ekteki belgeler kişisel veri içerir; yalnız savunma süreci için kullanınız, başkasıyla paylaşmayınız.');
    }
    const imtina = t.kapanis && t.kapanis.tur === 'imtina';
    const metin = imtina
      ? '<b>' + esc(b.dep) + '</b> departmanında <b>' + esc(b.unvan) + '</b> unvanıyla görev yapan <b>' + esc(b.ad) + '</b> için <b>' + esc(b.konu) + '</b> nedeniyle <b>' + esc(b.mudur) + '</b> isimli müdürünüzden İnsan Kaynaklarına savunma talebi gelmiştir. Savunma talebine istinaden hazırlanan savunma istem yazısı ve olay tespit tutanağı çalışana tebliğ edilmek istenmiş; ancak <b>' + esc(b.ad) + '</b> isimli çalışan belgeleri imzalamaktan / savunma vermekten <b>imtina etmiştir</b>. Durum imtina tutanağı ile kayıt altına alınarak özlük dosyasına eklenecektir.'
      : '<b>' + esc(b.dep) + '</b> departmanında <b>' + esc(b.unvan) + '</b> unvanıyla görev yapan <b>' + esc(b.ad) + '</b> için <b>' + esc(b.konu) + '</b> nedeniyle <b>' + esc(b.mudur) + '</b> isimli müdürünüzden İnsan Kaynaklarına savunma talebi gelmiştir. Savunma talebine istinaden savunma ve tutanak <b>' + esc(b.ad) + '</b> isimli çalışana imzalatılarak özlük dosyasına eklenmiştir.';
    const govde = '<tr><td style="padding:26px 28px 6px;font-size:14.5px;line-height:1.65">' +
      '<p style="margin:0 0 12px">Sayın ' + esc(b.direktor || 'Direktör') + ',</p><p style="margin:0 0 12px">' + metin + '</p><p style="margin:0 0 6px">Bilgilerinize sunarız.</p></td></tr>' +
      '<tr><td style="padding:10px 28px 22px">' + kutuBaslik('Özet') + ozet + '</td></tr>';
    return kabuk('Savunma Süreci · Bilgilendirme', govde, 'Bu e-posta İK Portalı tarafından otomatik gönderilmiştir. Kaydın ayrıntısı İK Portalı › Savunma Talepleri ekranındadır.');
  }
  const disa = { konu, html, BAGLANTI };
  if (typeof module !== 'undefined' && module.exports) module.exports = disa;
  else kok.SavunmaEposta = disa;
})(typeof window !== 'undefined' ? window : this);
