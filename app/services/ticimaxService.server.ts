
// Ticimax API yapılandırması
export interface TicimaxApiConfig {
    wsdlUrl: string;
    uyeKodu: string;
}

// Sipariş filtre parametreleri
export interface WebSiparisFiltre {
    EntegrasyonAktarildi?: number;
    OdemeDurumu?: number;
    OdemeTamamlandi?: number;
    OdemeTipi?: number;
    PaketlemeDurumu?: number;
    SiparisDurumu?: number;
    SiparisID?: number;
    KargoFirmaID?: number;
    TedarikciID?: number;
    UyeID?: number;
}

// Sayfalama parametreleri
export interface WebSiparisSayfalama {
    BaslangicIndex?: number;
    KayitSayisi?: number;
    SiralamaDeger?: string;
    SiralamaYonu?: string;
}

// Ürün bilgisi
export interface TicimaxUrun {
    stokKodu: string;
    barkod: string;
    urunAdi: string;
    adet: number;
    tutar: number;
    kdvTutari: number;
    tedarikciId?: number;
}

// Sipariş bilgisi
export interface TicimaxSiparis {
    siparisTarihi: string;
    siparisNo: string;
    siparisId: number;
    uyeAdi: string;
    uyeSoyadi: string;
    email: string;
    telefon: string;
    adres: string;
    il: string;
    ilce: string;
    postaKodu: string;
    toplamTutar: number;
    siparisDurumu: number;
    paketlemeDurumu: number;
    urunler: TicimaxUrun[];
}

/**
 * Servis URL'ini hazırla (WSDL olmayan, yalın .svc adresi) ve HTTPS zorla
 */
function getServiceUrl(url: string): string {
    let cleanUrl = url.trim();
    if (cleanUrl.toLowerCase().endsWith("?wsdl") || cleanUrl.toLowerCase().endsWith("?WSDL")) {
        cleanUrl = cleanUrl.substring(0, cleanUrl.length - 5);
    }
    // HTTP -> HTTPS Yönlendirme sorununu (POST -> GET dönüşümü) önlemek için protokolü zorla
    if (cleanUrl.startsWith("http://")) {
        cleanUrl = cleanUrl.replace("http://", "https://");
    }
    return cleanUrl;
}

/**
 * XML tag içeriğini çek (Namespace temizlendikten sonra kullanılır)
 */
function getTagValue(xml: string, tagName: string): string {
    const regex = new RegExp(`<${tagName}[^>]*>(.*?)</${tagName}>`, 'si');
    const match = regex.exec(xml);
    return match ? match[1].trim() : "";
}

/**
 * Ticimax'tan siparişleri çek (Raw Fetch - Gelişmiş Parsing)
 */
export async function fetchTicimaxOrders(
    config: TicimaxApiConfig,
    filter?: Partial<WebSiparisFiltre>,
    pagination?: Partial<WebSiparisSayfalama>,
    page: number = 1 // Yeni sayfa parametresi
): Promise<TicimaxSiparis[]> {
    const serviceUrl = getServiceUrl(config.wsdlUrl);

    // Varsayılan filtre
    const defaultFilter: WebSiparisFiltre = {
        EntegrasyonAktarildi: -1,
        OdemeDurumu: -1,
        OdemeTamamlandi: -1,
        OdemeTipi: -1,
        PaketlemeDurumu: -1,
        SiparisDurumu: -1, // Tüm sipariş durumlarını çek (Kullanıcı isteği: Sadece onaylandı değil, hepsi gelsin)
        SiparisID: -1,
        KargoFirmaID: -1,
        TedarikciID: -1,
        UyeID: -1,
        ...filter,
    };

    const limit = pagination?.KayitSayisi || 500;
    const startIndex = (page - 1) * limit;

    // Varsayılan sayfalama
    const defaultPagination: WebSiparisSayfalama = {
        BaslangicIndex: startIndex,
        KayitSayisi: limit,
        SiralamaDeger: "ID",
        SiralamaYonu: "DESC",
        ...pagination,
    };

    // XML Envelope oluştur (Namespace'ler Ticimax standardına uygun)
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:tns="http://tempuri.org/" xmlns:q1="http://schemas.datacontract.org/2004/07/">
  <soap:Body>
    <tns:SelectSiparis>
      <tns:UyeKodu>${config.uyeKodu}</tns:UyeKodu>
      <tns:f>
        <q1:EntegrasyonAktarildi>${defaultFilter.EntegrasyonAktarildi}</q1:EntegrasyonAktarildi>
        <q1:OdemeDurumu>${defaultFilter.OdemeDurumu}</q1:OdemeDurumu>
        <q1:OdemeTamamlandi>${defaultFilter.OdemeTamamlandi}</q1:OdemeTamamlandi>
        <q1:OdemeTipi>${defaultFilter.OdemeTipi}</q1:OdemeTipi>
        <q1:PaketlemeDurumu>${defaultFilter.PaketlemeDurumu}</q1:PaketlemeDurumu>
        <q1:SiparisDurumu>${defaultFilter.SiparisDurumu}</q1:SiparisDurumu>
        <q1:SiparisID>${defaultFilter.SiparisID}</q1:SiparisID>
        <q1:KargoFirmaID>${defaultFilter.KargoFirmaID}</q1:KargoFirmaID>
        <q1:TedarikciID>${defaultFilter.TedarikciID}</q1:TedarikciID>
        <q1:UyeID>${defaultFilter.UyeID}</q1:UyeID>
      </tns:f>
      <tns:s>
        <q1:BaslangicIndex>${defaultPagination.BaslangicIndex}</q1:BaslangicIndex>
        <q1:KayitSayisi>${defaultPagination.KayitSayisi}</q1:KayitSayisi>
        <q1:SiralamaDeger>${defaultPagination.SiralamaDeger}</q1:SiralamaDeger>
        <q1:SiralamaYonu>${defaultPagination.SiralamaYonu}</q1:SiralamaYonu>
      </tns:s>
    </tns:SelectSiparis>
  </soap:Body>
</soap:Envelope>`;

    console.log(`[Ticimax] Fetch Started. URL: ${serviceUrl}`);
    console.log(`[Ticimax] Params: Status=${defaultFilter.SiparisDurumu}, Limit=${defaultPagination.KayitSayisi}`);

    try {
        const response = await fetch(serviceUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '"http://tempuri.org/ISiparisServis/SelectSiparis"', // Quote içine alındı
                'User-Agent': 'PHP-SOAP/8.0.0' // PHP referansına geri dönüldü
            },
            body: envelope
        });

        console.log(`[Ticimax] Response Status: ${response.status} ${response.statusText}`);
        console.log(`[Ticimax] Redirected: ${response.redirected}, Final URL: ${response.url}`); // Redirect kontrolü
        const rawXml = await response.text();
        console.log(`[Ticimax] Raw Response (Head): ${rawXml.substring(0, 500)}`);

        // Hata kontrolü
        if (!response.ok) {
            console.error("SOAP HTTP Error:", response.status, rawXml);
            throw new Error(`Ticimax Servis Hatası: ${response.status} ${response.statusText}`);
        }

        if (rawXml.includes("Fault>") || rawXml.includes("faultcode>")) {
            // Fault temizle
            const cleanFault = rawXml.replace(/<(\/?)[a-zA-Z0-9-_]+:/g, '<$1');
            const faultString = getTagValue(cleanFault, "faultstring");
            console.error("[Ticimax] SOAP Fault:", faultString);
            throw new Error("Ticimax SOAP Fault: " + faultString);
        }

        const parsedOrders = parseSoapResponseRobust(rawXml);
        console.log(`[Ticimax] Parsed Order Count: ${parsedOrders.length}`);
        return parsedOrders;

    } catch (error: any) {
        console.error("[Ticimax] Fetch Error:", error);
        throw new Error(`Siparişler çekilemedi: ${error.message}`);
    }
}

/**
 * Bağlantı Testi (Raw Fetch)
 */
export async function testTicimaxConnection(config: TicimaxApiConfig): Promise<{ success: boolean; message: string; orderCount?: number }> {
    try {
        // 1 sipariş çekerek test et
        // Test sırasında tüm durumları (-1) çekmek daha mantıklı bağlantıyı doğrulamak için, ama kullanıcı 2'yi görmek istiyor
        // Yine de bağlantı testi için varsayılan (2) kullanmak en doğrusu
        const orders = await fetchTicimaxOrders(config, { SiparisDurumu: 2 }, { KayitSayisi: 1 });
        return {
            success: true,
            message: "Bağlantı Başarılı!",
            orderCount: orders.length
        };
    } catch (error: any) {
        return {
            success: false,
            message: `Bağlantı Hatası: ${error.message}`
        };
    }
}

/**
 * Namespace-Insensitive Robust Parser
 */
function parseSoapResponseRobust(rawXml: string): TicimaxSiparis[] {
    const orders: TicimaxSiparis[] = [];

    // 1. Tüm namespace'leri temizle (<ns:Tag> -> <Tag>)
    // Bu işlem regex'i çok basitleştirir ve hata riskini sıfıra indirir
    const cleanXml = rawXml.replace(/<(\/?)[a-zA-Z0-9-_]+:/g, '<$1');

    // 2. WebSiparis bloklarını bul
    const siparisRegex = /<WebSiparis>(.*?)<\/WebSiparis>/gs;
    let match;

    while ((match = siparisRegex.exec(cleanXml)) !== null) {
        const siparisXml = match[1]; // İçerik

        // Temel alanları çek
        const siparisId = parseInt(getTagValue(siparisXml, "ID")) || 0;
        const siparisNo = getTagValue(siparisXml, "SiparisNo");
        // Status parsing - Robust
        let rawStatus = getTagValue(siparisXml, "SiparisDurumu");
        if (!rawStatus) rawStatus = getTagValue(siparisXml, "Durum"); // Fallback

        let siparisDurumu = parseInt(rawStatus);
        if (isNaN(siparisDurumu)) {
            siparisDurumu = -1;
            // Maybe it's text? Try to map reverse if needed (Skip for now, user provided IDs)
        }

        // Fix 0 bug: parseInt("0") is 0, which is falsy in || check. Now checking isNaN.

        let rawPaket = getTagValue(siparisXml, "PaketlemeDurumu");
        let paketlemeDurumu = parseInt(rawPaket);
        if (isNaN(paketlemeDurumu)) paketlemeDurumu = -1;

        const siparisTarihi = getTagValue(siparisXml, "SiparisTarihi");
        const uyeAdi = getTagValue(siparisXml, "UyeAdi");
        const uyeSoyadi = getTagValue(siparisXml, "UyeSoyadi");
        const email = getTagValue(siparisXml, "Mail");

        // Teslimat Adresi
        const teslimatXml = getInnerTagContent(siparisXml, "TeslimatAdresi");
        const telefon = getTagValue(teslimatXml, "AliciTelefon");
        const adres = getTagValue(teslimatXml, "Adres");
        const il = getTagValue(teslimatXml, "Il");
        const ilce = getTagValue(teslimatXml, "Ilce");
        const postaKodu = getTagValue(teslimatXml, "PostaKodu");

        // Ürünler ve Tutar
        let toplamTutar = 0;
        const urunler: TicimaxUrun[] = [];
        const urunlerBlock = getInnerTagContent(siparisXml, "Urunler");

        const urunRegex = /<WebSiparisUrun>(.*?)<\/WebSiparisUrun>/gs;
        let urunMatch;

        while ((urunMatch = urunRegex.exec(urunlerBlock)) !== null) {
            const urunXml = urunMatch[1];
            const tutar = parseFloat(getTagValue(urunXml, "Tutar")) || 0;
            const kdv = parseFloat(getTagValue(urunXml, "KdvTutari")) || 0;
            const adet = parseInt(getTagValue(urunXml, "Adet")) || 1;

            toplamTutar += (tutar + kdv) * adet;

            let urunAdi = getTagValue(urunXml, "UrunAdi");

            // Varyant parse (EkSecenekList)
            const ekSecenekBlock = getInnerTagContent(urunXml, "EkSecenekList");
            const varyantlar = extractOptionValues(ekSecenekBlock, "Tanim");
            if (varyantlar.length > 0) {
                urunAdi += ` (${varyantlar.join(", ")})`;
            }

            urunler.push({
                stokKodu: getTagValue(urunXml, "StokKodu"),
                barkod: getTagValue(urunXml, "Barkod"),
                urunAdi: urunAdi,
                adet: adet,
                tutar: tutar,
                kdvTutari: kdv,
                tedarikciId: parseInt(getTagValue(urunXml, "TedarikciID")) || 0
            });
        }

        orders.push({
            siparisId, siparisNo, siparisTarihi,
            uyeAdi, uyeSoyadi, email,
            telefon, adres, il, ilce, postaKodu,
            toplamTutar, siparisDurumu, paketlemeDurumu, urunler
        });
    }

    return orders;
}

// Helper: İç içe tag bul (Namespace temizlenmiş XML için)
function getInnerTagContent(xml: string, tagName: string): string {
    const regex = new RegExp(`<${tagName}[^>]*>(.*?)</${tagName}>`, 's');
    const match = regex.exec(xml);
    return match ? match[1] : "";
}

// Helper: Liste elemanlarını çek
function extractOptionValues(xml: string, tagName: string): string[] {
    const results: string[] = [];
    // <TagName>Value</TagName>
    const regex = new RegExp(`<${tagName}[^>]*>(.*?)</${tagName}>`, 'gs');
    let match;
    while ((match = regex.exec(xml)) !== null) {
        results.push(match[1].trim());
    }
    return results;
}
