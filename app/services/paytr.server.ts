import crypto from "crypto";
import prisma from "../db.server";

interface PaytrConfig {
    merchantId: string;
    merchantKey: string;
    merchantSalt: string;
    testMode: boolean;
}

interface BasketItem {
    name: string;
    price: number; // Kuruş cinsinden
    quantity: number;
}

interface PaytrIframeParams {
    shop: string;
    merchantOid: string; // Benzersiz sipariş no
    email: string;
    paymentAmount: number; // Kuruş cinsinden toplam (örn: 15000 = 150.00 TL)
    userName: string;
    userAddress: string;
    userPhone: string;
    userBasket: BasketItem[];
    maxInstallment: number; // 0 = sınırsız, 1 = tek çekim, 2-12 = max taksit
    noInstallment?: number; // 1 olursa sadece tek çekim
    successUrl: string;
    failUrl: string;
    currency?: "TL" | "USD" | "EUR";
    lang?: "tr" | "en";
}

/**
 * PayTR için hash token üretir
 */
function generatePaytrToken(
    config: PaytrConfig,
    params: PaytrIframeParams
): string {
    const {
        merchantOid,
        email,
        paymentAmount,
        userBasket,
        noInstallment,
        maxInstallment,
        currency,
        successUrl,
        failUrl,
    } = params;

    // Basket JSON (Base64)
    const basketJson = JSON.stringify(
        userBasket.map((item) => [item.name, item.price.toString(), item.quantity])
    );
    const userBasketBase64 = Buffer.from(basketJson).toString("base64");

    // Test mode
    const testMode = config.testMode ? "1" : "0";

    // Hash string oluştur (PayTR dokümantasyonuna göre)
    const hashStr =
        config.merchantId +
        "" + // user_ip (boş bırakılabilir)
        merchantOid +
        email +
        paymentAmount.toString() +
        userBasketBase64 +
        (noInstallment || 0).toString() +
        maxInstallment.toString() +
        (currency || "TL") +
        testMode +
        config.merchantSalt;

    // HMAC SHA256
    const token = crypto
        .createHmac("sha256", config.merchantKey)
        .update(hashStr)
        .digest("base64");

    return token;
}

/**
 * PayTR iframe için POST parametrelerini hazırlar
 */
export async function preparePaytrIframe(
    shop: string,
    params: Omit<PaytrIframeParams, "shop">
): Promise<{ success: boolean; token?: string; iframeUrl?: string; error?: string; postParams?: Record<string, string> }> {
    // Config'i DB'den çek
    const configRecord = await prisma.paytrConfig.findUnique({
        where: { shop },
    });

    if (!configRecord) {
        return { success: false, error: "PayTR yapılandırması bulunamadı. Lütfen ayarları yapın." };
    }

    const config: PaytrConfig = {
        merchantId: configRecord.merchantId,
        merchantKey: configRecord.merchantKey,
        merchantSalt: configRecord.merchantSalt,
        testMode: configRecord.testMode,
    };

    // Basket JSON (Base64)
    const basketJson = JSON.stringify(
        params.userBasket.map((item) => [item.name, item.price.toString(), item.quantity])
    );
    const userBasketBase64 = Buffer.from(basketJson).toString("base64");

    // Token üret
    const token = generatePaytrToken(config, { ...params, shop });

    // POST parametreleri
    const postParams: Record<string, string> = {
        merchant_id: config.merchantId,
        user_ip: "", // Sunucu tarafında IP alınacak
        merchant_oid: params.merchantOid,
        email: params.email,
        payment_amount: params.paymentAmount.toString(),
        paytr_token: token,
        user_basket: userBasketBase64,
        debug_on: config.testMode ? "1" : "0",
        test_mode: config.testMode ? "1" : "0",
        no_installment: (params.noInstallment || 0).toString(),
        max_installment: params.maxInstallment.toString(),
        user_name: params.userName,
        user_address: params.userAddress,
        user_phone: params.userPhone,
        merchant_ok_url: params.successUrl,
        merchant_fail_url: params.failUrl,
        currency: params.currency || "TL",
        lang: params.lang || "tr",
    };

    return {
        success: true,
        token,
        iframeUrl: "https://www.paytr.com/odeme/guvenli/iframe",
        postParams,
    };
}

/**
 * Sepetteki ürünlere göre en düşük taksit limitini hesaplar
 */
export async function calculateMaxInstallment(
    shop: string,
    vendors: string[]
): Promise<number> {
    if (vendors.length === 0) return 12; // Varsayılan

    // Tüm kuralları çek
    const rules = await prisma.installmentRule.findMany({
        where: {
            shop,
            vendorName: { in: vendors },
            isActive: true,
        },
    });

    if (rules.length === 0) return 12; // Kural yoksa varsayılan

    // En düşük limiti bul
    const minInstallment = Math.min(...rules.map((r) => r.maxInstallments));
    return minInstallment;
}

/**
 * PayTR callback hash doğrulaması
 */
export function verifyPaytrCallback(
    merchantKey: string,
    merchantSalt: string,
    merchantOid: string,
    status: string,
    totalAmount: string,
    hash: string
): boolean {
    const hashStr = merchantOid + merchantSalt + status + totalAmount;
    const expectedHash = crypto
        .createHmac("sha256", merchantKey)
        .update(hashStr)
        .digest("base64");

    return hash === expectedHash;
}

/**
 * Transaction kaydı oluştur
 */
export async function createPaytrTransaction(
    shop: string,
    merchantOid: string,
    totalAmount: number,
    maxInstallment: number,
    paytrToken?: string
) {
    return prisma.paytrTransaction.create({
        data: {
            shop,
            merchantOid,
            totalAmount,
            maxInstallment,
            paytrToken,
            status: "pending",
        },
    });
}

/**
 * Transaction durumunu güncelle
 */
export async function updatePaytrTransaction(
    shop: string,
    merchantOid: string,
    status: "success" | "failed",
    shopifyOrderId?: string,
    errorMessage?: string
) {
    return prisma.paytrTransaction.update({
        where: { shop_merchantOid: { shop, merchantOid } },
        data: {
            status,
            shopifyOrderId,
            errorMessage,
            completedAt: new Date(),
        },
    });
}
