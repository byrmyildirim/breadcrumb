import { createClientAsync, Client } from "soap";

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

// SOAP client cache
let soapClientCache: { [key: string]: Client } = {};

/**
 * Ticimax SOAP client oluştur veya cache'den al
 */
async function getSoapClient(configWsdlUrl: string): Promise<Client> {
    // URL normalizasyonu: ?wsdl ekle
    let wsdlUrl = configWsdlUrl.trim();
    if (!wsdlUrl.toLowerCase().endsWith("?wsdl")) {
        wsdlUrl += "?wsdl";
    }

    if (!soapClientCache[wsdlUrl]) {
        try {
            soapClientCache[wsdlUrl] = await createClientAsync(wsdlUrl, {
                disableCache: true,
                wsdl_options: {
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Node-SOAP-Client',
                        'Content-Type': 'text/xml; charset=utf-8'
                    }
                },
            });
        } catch (error) {
            console.error("SOAP client oluşturma hatası:", error);
            throw new Error(`Ticimax WSDL'e bağlanılamadı: ${wsdlUrl}. Hata: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
        }
    }
    return soapClientCache[wsdlUrl];
}

/**
 * Ticimax'tan siparişleri çek
 */
export async function fetchTicimaxOrders(
    config: TicimaxApiConfig,
    filter?: Partial<WebSiparisFiltre>,
    pagination?: Partial<WebSiparisSayfalama>
): Promise<TicimaxSiparis[]> {
    const client = await getSoapClient(config.wsdlUrl);

    // Varsayılan filtre - Tüm siparişler (SiparisDurumu: -1)
    const defaultFilter: WebSiparisFiltre = {
        EntegrasyonAktarildi: -1,
        OdemeDurumu: -1,
        OdemeTamamlandi: -1,
        OdemeTipi: -1,
        PaketlemeDurumu: -1,
        SiparisDurumu: -1, // Tüm durumlar (0-9 ve diğerleri)
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

    const params = {
        UyeKodu: config.uyeKodu,
        f: defaultFilter,
        s: defaultPagination,
    };

    try {
        const [result] = await client.SelectSiparisAsync(params);
        return parseOrderResponse(result);
    } catch (error) {
        console.error("Ticimax sipariş çekme hatası:", error);
        throw new Error("Ticimax'tan siparişler alınamadı");
    }
}

/**
 * Ticimax bağlantısını test et
 */
export async function testTicimaxConnection(
    config: TicimaxApiConfig
): Promise<{ success: boolean; message: string; orderCount?: number }> {
    try {
        // URL normalizasyonu
        let wsdlUrl = config.wsdlUrl.trim();
        if (!wsdlUrl.toLowerCase().endsWith("?wsdl") && !wsdlUrl.toLowerCase().endsWith("?WSDL")) {
            wsdlUrl += "?wsdl";
        }

        // Ön kontrol: Raw fetch ile içeriği kontrol et
        const response = await fetch(wsdlUrl);
        const text = await response.text();

        // Hata sayfası kontrolü
        if (text.includes("svcutil.exe") || text.trim().toLowerCase().startsWith("<!doctype html") || text.trim().toLowerCase().startsWith("<html")) {
            return {
                success: false,
                message: `WSDL Hatası: Sunucu XML yerine HTML sayfası döndürüyor. URL'in sonuna '?wsdl' eklenmiş olduğundan emin olun.`,
            };
        }

        const client = await getSoapClient(config.wsdlUrl);

        // Sadece 1 sipariş çekerek bağlantıyı test et
        const params = {
            UyeKodu: config.uyeKodu,
            f: {
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
            },
            s: {
                BaslangicIndex: 0,
                KayitSayisi: 1,
                SiralamaDeger: "ID",
                SiralamaYonu: "DESC",
            },
        };

        const [result] = await client.SelectSiparisAsync(params);
        const orders = parseOrderResponse(result);

        return {
            success: true,
            message: "Ticimax bağlantısı başarılı!",
            orderCount: orders.length,
        };
    } catch (error: any) {
        console.error("Ticimax bağlantı testi hatası:", error);
        return {
            success: false,
            message: `Bağlantı hatası: ${error.message || "Bilinmeyen hata"}`,
        };
    }
}

/**
 * Sipariş response'unu parse et
 */
function parseOrderResponse(result: any): TicimaxSiparis[] {
    const orders = result?.SelectSiparisResult?.WebSiparis;

    if (!orders) {
        return [];
    }

    const ordersArray = Array.isArray(orders) ? orders : [orders];

    return ordersArray.map((siparis: any) => {
        const teslimat = siparis.TeslimatAdresi || {};
        const urunler = siparis.Urunler?.WebSiparisUrun || [];
        const urunlerArray = Array.isArray(urunler) ? urunler : [urunler];

        // Toplam tutarı hesapla
        let toplamTutar = 0;
        const parsedUrunler = urunlerArray.map((urun: any) => {
            const tutar = parseFloat(urun.Tutar) || 0;
            const kdv = parseFloat(urun.KdvTutari) || 0;
            const adet = parseInt(urun.Adet) || 1;
            toplamTutar += (tutar + kdv) * adet;

            return {
                stokKodu: urun.StokKodu || "",
                barkod: urun.Barkod || "",
                urunAdi: parseUrunAdi(urun),
                adet: adet,
                tutar: tutar,
                kdvTutari: kdv,
                tedarikciId: urun.TedarikciID,
            };
        });

        return {
            siparisTarihi: siparis.SiparisTarihi || "",
            siparisNo: siparis.SiparisNo || "",
            siparisId: siparis.ID || 0,
            uyeAdi: siparis.UyeAdi || "",
            uyeSoyadi: siparis.UyeSoyadi || "",
            email: siparis.Mail || "",
            telefon: teslimat.AliciTelefon || "",
            adres: teslimat.Adres || "",
            il: teslimat.Il || "",
            ilce: teslimat.Ilce || "",
            postaKodu: teslimat.PostaKodu || "",
            toplamTutar: toplamTutar,
            urunler: parsedUrunler,
        };
    });
}

/**
 * Ürün adını varyantlarla birlikte parse et
 */
function parseUrunAdi(urun: any): string {
    let urunAdi = urun.UrunAdi || "";

    // Ek seçenekleri (varyantları) ekle
    const ekSecenekList = urun.EkSecenekList?.WebSiparisUrunEkSecenekOzellik;
    if (ekSecenekList) {
        const secenekler = Array.isArray(ekSecenekList) ? ekSecenekList : [ekSecenekList];
        const varyantlar = secenekler
            .filter((s: any) => s.Tanim)
            .map((s: any) => s.Tanim);

        if (varyantlar.length > 0) {
            urunAdi += ` (${varyantlar.join(", ")})`;
        }
    }

    return urunAdi;
}

/**
 * Cache'i temizle (bağlantı ayarları değiştiğinde)
 */
export function clearSoapClientCache() {
    soapClientCache = {};
}
