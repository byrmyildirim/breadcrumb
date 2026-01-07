
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
    urunler: TicimaxUrun[];
}

/**
 * Servis URL'ini hazırla (WSDL olmayan)
 */
function getServiceUrl(url: string): string {
    let cleanUrl = url.trim();
    if (cleanUrl.toLowerCase().endsWith("?wsdl")) {
        cleanUrl = cleanUrl.substring(0, cleanUrl.length - 5);
    }
    return cleanUrl;
}

/**
 * XML tag içeriğini çek
 */
function getTagValue(xml: string, tagName: string): string {
    // Namespace'li veya namespacsiz tagleri yakalar: <tagName>...</tagName> veya <ns:tagName>...</ns:tagName>
    const regex = new RegExp(`<([a-zA-Z0-9_]+:)?${tagName}[^>]*>(.*?)</([a-zA-Z0-9_]+:)?${tagName}>`, 's');
    const match = regex.exec(xml);
    return match ? match[2].trim() : ""; // match[2] içerik
}

/**
 * Ticimax'tan siparişleri çek (Raw Fetch)
 */
export async function fetchTicimaxOrders(
    config: TicimaxApiConfig,
    filter?: Partial<WebSiparisFiltre>,
    pagination?: Partial<WebSiparisSayfalama>
): Promise<TicimaxSiparis[]> {
    const serviceUrl = getServiceUrl(config.wsdlUrl);

    // Varsayılan filtre
    const defaultFilter: WebSiparisFiltre = {
        EntegrasyonAktarildi: -1,
        OdemeDurumu: -1,
        OdemeTamamlandi: -1,
        OdemeTipi: -1,
        PaketlemeDurumu: -1,
        SiparisDurumu: -1,
        SiparisID: -1,
        KargoFirmaID: -1,
        TedarikciID: -1,
        UyeID: -1,
        ...filter,
    };

    // Varsayılan sayfalama
    const defaultPagination: WebSiparisSayfalama = {
        BaslangicIndex: 0,
        KayitSayisi: 100,
        SiralamaDeger: "ID",
        SiralamaYonu: "DESC",
        ...pagination,
    };

    // XML Envelope oluştur
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

    try {
        const response = await fetch(serviceUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://tempuri.org/ISiparisServis/SelectSiparis',
                'User-Agent': 'Node-Fetch-Client'
            },
            body: envelope
        });

        const xml = await response.text();

        // Hata kontrolü
        if (!response.ok) {
            console.error("SOAP Error:", xml);
            throw new Error(`Ticimax Servis Hatası: ${response.status} ${response.statusText}`);
        }

        if (xml.includes("Fault>") || xml.includes("faultcode>")) {
            throw new Error("Ticimax SOAP Fault: " + getTagValue(xml, "faultstring"));
        }

        return parseSoapResponse(xml);

    } catch (error: any) {
        console.error("Ticimax fetch hatası:", error);
        throw new Error(`Siparişler çekilemedi: ${error.message}`);
    }
}

/**
 * Bağlantı Testi (Raw Fetch)
 */
export async function testTicimaxConnection(config: TicimaxApiConfig): Promise<{ success: boolean; message: string; orderCount?: number }> {
    try {
        // 1 sipariş çekerek test et
        const orders = await fetchTicimaxOrders(config, {}, { KayitSayisi: 1 });
        return {
            success: true,
            message: "Ticimax bağlantısı başarılı! (SOAP Bypass Modu)",
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
 * Regex ile XML Response Parse Etme
 */
function parseSoapResponse(xml: string): TicimaxSiparis[] {
    const orders: TicimaxSiparis[] = [];

    // SelectSiparisResult içini al (Basit yaklaşım: tüm WebSiparis bloklarını bul)
    // <a:WebSiparis> ... </a:WebSiparis>

    // Regex ile tüm WebSiparis bloklarını bul
    const siparisRegex = /<([a-zA-Z0-9_]+:)?WebSiparis>(.*?)<\/\1?WebSiparis>/gs;
    let match;

    while ((match = siparisRegex.exec(xml)) !== null) {
        const siparisXml = match[2]; // İçerik

        // Temel alanları çek
        const siparisId = parseInt(getTagValue(siparisXml, "ID")) || 0;
        const siparisNo = getTagValue(siparisXml, "SiparisNo");
        const siparisTarihi = getTagValue(siparisXml, "SiparisTarihi");
        const uyeAdi = getTagValue(siparisXml, "UyeAdi");
        const uyeSoyadi = getTagValue(siparisXml, "UyeSoyadi");
        const email = getTagValue(siparisXml, "Mail");

        // Teslimat Adresi
        const teslimatXml = parseInnerTag(siparisXml, "TeslimatAdresi");
        const telefon = getTagValue(teslimatXml, "AliciTelefon");
        const adres = getTagValue(teslimatXml, "Adres");
        const il = getTagValue(teslimatXml, "Il");
        const ilce = getTagValue(teslimatXml, "Ilce");
        const postaKodu = getTagValue(teslimatXml, "PostaKodu");

        // Ürünler ve Tutar
        let toplamTutar = 0;
        const urunler: TicimaxUrun[] = [];
        const urunlerXmlBlock = parseInnerTag(siparisXml, "Urunler");

        const urunRegex = /<([a-zA-Z0-9_]+:)?WebSiparisUrun>(.*?)<\/\1?WebSiparisUrun>/gs;
        let urunMatch;

        while ((urunMatch = urunRegex.exec(urunlerXmlBlock)) !== null) {
            const urunXml = urunMatch[2];
            const tutar = parseFloat(getTagValue(urunXml, "Tutar")) || 0;
            const kdv = parseFloat(getTagValue(urunXml, "KdvTutari")) || 0;
            const adet = parseInt(getTagValue(urunXml, "Adet")) || 1;

            toplamTutar += (tutar + kdv) * adet;

            let urunAdi = getTagValue(urunXml, "UrunAdi");
            // Varyant parse (EkSecenekList) - Basitçe Tanim'ları topla
            const ekSecenekBlock = parseInnerTag(urunXml, "EkSecenekList");
            const varyantlar = extractAllTags(ekSecenekBlock, "Tanim");
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
            toplamTutar, urunler
        });
    }

    return orders;
}

// Helper: İç içe tag bul
function parseInnerTag(xml: string, tagName: string): string {
    const regex = new RegExp(`<([a-zA-Z0-9_]+:)?${tagName}[^>]*>(.*?)</([a-zA-Z0-9_]+:)?${tagName}>`, 's');
    const match = regex.exec(xml);
    return match ? match[2] : "";
}

// Helper: Tüm tag değerlerini array olarak al (Varyantlar için)
function extractAllTags(xml: string, tagName: string): string[] {
    const results: string[] = [];
    const regex = new RegExp(`<([a-zA-Z0-9_]+:)?${tagName}[^>]*>(.*?)</([a-zA-Z0-9_]+:)?${tagName}>`, 'gs');
    let match;
    while ((match = regex.exec(xml)) !== null) {
        results.push(match[2].trim());
    }
    return results;
}
