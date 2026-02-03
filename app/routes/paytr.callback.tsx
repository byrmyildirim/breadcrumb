import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { updatePaytrTransaction, verifyPaytrCallback } from "../services/paytr.server";

/**
 * PayTR Callback Handler
 * PayTR, ödeme sonuçlarını bu endpoint'e POST eder.
 * Güvenlik için hash doğrulaması yapılır.
 */
export async function action({ request }: ActionFunctionArgs) {
    const formData = await request.formData();

    const merchantOid = formData.get("merchant_oid") as string;
    const status = formData.get("status") as string; // "success" veya "failed"
    const totalAmount = formData.get("total_amount") as string;
    const hash = formData.get("hash") as string;
    const failedReasonCode = formData.get("failed_reason_code") as string;
    const failedReasonMsg = formData.get("failed_reason_msg") as string;

    console.log("[PayTR Callback]", { merchantOid, status, totalAmount });

    if (!merchantOid) {
        return json({ status: "error", message: "merchant_oid eksik" }, { status: 400 });
    }

    // Transaction'ı bul
    const transaction = await prisma.paytrTransaction.findFirst({
        where: { merchantOid },
    });

    if (!transaction) {
        console.error("[PayTR Callback] Transaction bulunamadı:", merchantOid);
        return json({ status: "error", message: "Transaction bulunamadı" }, { status: 404 });
    }

    // Config'i al
    const config = await prisma.paytrConfig.findUnique({
        where: { shop: transaction.shop },
    });

    if (!config) {
        console.error("[PayTR Callback] Config bulunamadı:", transaction.shop);
        return json({ status: "error", message: "Config bulunamadı" }, { status: 500 });
    }

    // Hash doğrulaması
    const isValid = verifyPaytrCallback(
        config.merchantKey,
        config.merchantSalt,
        merchantOid,
        status,
        totalAmount,
        hash
    );

    if (!isValid) {
        console.error("[PayTR Callback] Hash doğrulaması başarısız:", merchantOid);
        // Güvenlik nedeniyle yine de "OK" döndürülür ama işlem yapılmaz
        return new Response("OK", { status: 200 });
    }

    // Duruma göre işlem
    if (status === "success") {
        // Ödeme başarılı - Shopify'da siparişi oluştur
        await updatePaytrTransaction(transaction.shop, merchantOid, "success");

        // TODO: Shopify Order API ile sipariş oluştur
        // Bu kısım Draft Order veya Checkout Complete API ile yapılacak
        console.log("[PayTR Callback] Ödeme başarılı:", merchantOid);

        // PayTR'ye "OK" döndür
        return new Response("OK", { status: 200 });
    } else {
        // Ödeme başarısız
        const errorMsg = failedReasonMsg || `Hata kodu: ${failedReasonCode}`;
        await updatePaytrTransaction(transaction.shop, merchantOid, "failed", undefined, errorMsg);

        console.log("[PayTR Callback] Ödeme başarısız:", merchantOid, errorMsg);

        return new Response("OK", { status: 200 });
    }
}

// GET istekleri için başarı/başarısızlık sayfaları
export async function loader({ request }: { request: Request }) {
    const url = new URL(request.url);
    const oid = url.searchParams.get("oid");
    const pathParts = url.pathname.split("/");
    const result = pathParts[pathParts.length - 1]; // "success" veya "fail"

    if (!oid) {
        return json({ status: "error", message: "Sipariş numarası bulunamadı" });
    }

    const transaction = await prisma.paytrTransaction.findFirst({
        where: { merchantOid: oid },
    });

    return json({
        status: result === "success" ? "success" : "failed",
        merchantOid: oid,
        transaction,
    });
}
