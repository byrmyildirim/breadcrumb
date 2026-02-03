import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import { useState, useEffect } from "react";
import prisma from "../db.server";
import {
    preparePaytrIframe,
    calculateMaxInstallment,
    createPaytrTransaction,
} from "../services/paytr.server";

// Bu route PUBLIC - admin auth gerektirmez
// URL: /paytr/checkout?shop=xxx.myshopify.com

interface CartItem {
    title: string;
    vendor: string;
    price: number; // Kuruş
    quantity: number;
    variant_id?: string;
}

interface CheckoutData {
    cart: CartItem[];
    email: string;
    name: string;
    phone: string;
    address: string;
    total: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
        return json({ error: "Shop bilgisi eksik", configured: false });
    }

    // Config kontrolü
    const config = await prisma.paytrConfig.findUnique({
        where: { shop },
    });

    if (!config) {
        return json({
            error: "PayTR yapılandırması bulunamadı",
            configured: false,
            shop
        });
    }

    return json({
        configured: true,
        shop,
        testMode: config.testMode,
    });
}

export async function action({ request }: ActionFunctionArgs) {
    const formData = await request.formData();
    const shop = formData.get("shop") as string;
    const cartJson = formData.get("cart") as string;
    const email = formData.get("email") as string;
    const userName = formData.get("userName") as string;
    const userPhone = formData.get("userPhone") as string;
    const userAddress = formData.get("userAddress") as string;
    const totalAmount = parseInt(formData.get("totalAmount") as string); // Kuruş

    if (!shop || !cartJson || !email || !totalAmount) {
        return json({ success: false, error: "Eksik bilgi" });
    }

    let cart: CartItem[];
    try {
        cart = JSON.parse(cartJson);
    } catch {
        return json({ success: false, error: "Geçersiz sepet verisi" });
    }

    // Vendor'ları topla ve max taksiti hesapla
    const vendors = [...new Set(cart.map((item) => item.vendor).filter(Boolean))];
    const maxInstallment = await calculateMaxInstallment(shop, vendors);

    // Benzersiz sipariş numarası
    const merchantOid = `SP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Basket hazırla
    const userBasket = cart.map((item) => ({
        name: item.title,
        price: item.price,
        quantity: item.quantity,
    }));

    // Base URL
    const baseUrl = `https://${shop.replace(".myshopify.com", "")}.myshopify.com`;

    // PayTR iframe hazırla
    const result = await preparePaytrIframe(shop, {
        merchantOid,
        email,
        paymentAmount: totalAmount,
        userName: userName || "Müşteri",
        userAddress: userAddress || "Türkiye",
        userPhone: userPhone || "5551234567",
        userBasket,
        maxInstallment,
        successUrl: `${baseUrl}/apps/breadcrumb/paytr/success?oid=${merchantOid}`,
        failUrl: `${baseUrl}/apps/breadcrumb/paytr/fail?oid=${merchantOid}`,
    });

    if (!result.success) {
        return json({ success: false, error: result.error });
    }

    // Transaction kaydı
    await createPaytrTransaction(shop, merchantOid, totalAmount, maxInstallment, result.token);

    // PayTR'ye POST yapıp iframe token al
    const paytrResponse = await fetch("https://www.paytr.com/odeme/api/get-token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(result.postParams!).toString(),
    });

    const paytrData = await paytrResponse.json();

    if (paytrData.status !== "success") {
        return json({
            success: false,
            error: paytrData.reason || "PayTR token alınamadı",
            debug: result.postParams
        });
    }

    return json({
        success: true,
        iframeToken: paytrData.token,
        merchantOid,
        maxInstallment,
    });
}

export default function PaytrStorefrontCheckout() {
    const loaderData = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";

    const [formData, setFormData] = useState({
        email: "",
        userName: "",
        userPhone: "",
        userAddress: "",
    });

    // URL'den cart parametrelerini al
    const [cart, setCart] = useState<CartItem[]>([]);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        // URL'den veya sessionStorage'dan cart verisi al
        const urlParams = new URLSearchParams(window.location.search);
        const cartData = urlParams.get("cartData");

        if (cartData) {
            try {
                const parsed = JSON.parse(decodeURIComponent(cartData));
                setCart(parsed.items || []);
                setTotal(parsed.total || 0);
            } catch (e) {
                console.error("Cart parse error:", e);
            }
        }

        // Veya sessionStorage'dan
        const storedCart = sessionStorage.getItem("paytr_cart");
        if (storedCart && !cartData) {
            try {
                const parsed = JSON.parse(storedCart);
                setCart(parsed.items || []);
                setTotal(parsed.total || 0);
            } catch (e) {
                console.error("Storage cart parse error:", e);
            }
        }
    }, []);

    if (!loaderData.configured) {
        return (
            <div style={styles.container}>
                <div style={styles.errorBox}>
                    <h2>⚠️ Ödeme Sistemi Yapılandırılmamış</h2>
                    <p>{loaderData.error}</p>
                </div>
            </div>
        );
    }

    // iframe göster
    if (actionData?.success && actionData.iframeToken) {
        return (
            <div style={styles.container}>
                <div style={styles.iframeWrapper}>
                    <h2 style={styles.heading}>💳 Ödeme</h2>
                    <p style={styles.subtext}>
                        Max Taksit: <strong>{actionData.maxInstallment}</strong>
                    </p>
                    <iframe
                        src={`https://www.paytr.com/odeme/guvenli/${actionData.iframeToken}`}
                        style={styles.iframe}
                        frameBorder="0"
                        scrolling="yes"
                    />
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                <h1 style={styles.heading}>💳 PayTR ile Öde</h1>

                {actionData?.error && (
                    <div style={styles.errorBox}>
                        <p>Hata: {actionData.error}</p>
                    </div>
                )}

                {/* Sepet Özeti */}
                <div style={styles.cartSummary}>
                    <h3>Sepet Özeti</h3>
                    {cart.length === 0 ? (
                        <p style={styles.emptyCart}>Sepet bilgisi yükleniyor...</p>
                    ) : (
                        <>
                            {cart.map((item, i) => (
                                <div key={i} style={styles.cartItem}>
                                    <span>{item.title} x {item.quantity}</span>
                                    <span>{(item.price / 100).toFixed(2)} TL</span>
                                </div>
                            ))}
                            <div style={styles.cartTotal}>
                                <strong>Toplam</strong>
                                <strong>{(total / 100).toFixed(2)} TL</strong>
                            </div>
                        </>
                    )}
                </div>

                {/* Form */}
                <Form method="post" style={styles.form}>
                    <input type="hidden" name="shop" value={loaderData.shop} />
                    <input type="hidden" name="cart" value={JSON.stringify(cart)} />
                    <input type="hidden" name="totalAmount" value={total.toString()} />

                    <div style={styles.formGroup}>
                        <label>E-posta *</label>
                        <input
                            type="email"
                            name="email"
                            required
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            style={styles.input}
                        />
                    </div>

                    <div style={styles.formGroup}>
                        <label>Ad Soyad *</label>
                        <input
                            type="text"
                            name="userName"
                            required
                            value={formData.userName}
                            onChange={(e) => setFormData({ ...formData, userName: e.target.value })}
                            style={styles.input}
                        />
                    </div>

                    <div style={styles.formGroup}>
                        <label>Telefon</label>
                        <input
                            type="tel"
                            name="userPhone"
                            value={formData.userPhone}
                            onChange={(e) => setFormData({ ...formData, userPhone: e.target.value })}
                            style={styles.input}
                        />
                    </div>

                    <div style={styles.formGroup}>
                        <label>Adres</label>
                        <textarea
                            name="userAddress"
                            value={formData.userAddress}
                            onChange={(e) => setFormData({ ...formData, userAddress: e.target.value })}
                            style={{ ...styles.input, minHeight: "80px" }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting || cart.length === 0}
                        style={styles.submitBtn}
                    >
                        {isSubmitting ? "İşleniyor..." : "Ödemeye Geç"}
                    </button>
                </Form>

                {loaderData.testMode && (
                    <p style={styles.testMode}>⚠️ Test Modu Aktif</p>
                )}
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "20px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    card: {
        background: "#fff",
        borderRadius: "12px",
        boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
        padding: "32px",
        maxWidth: "500px",
        width: "100%",
    },
    heading: {
        margin: "0 0 16px 0",
        fontSize: "24px",
        textAlign: "center" as const,
    },
    subtext: {
        textAlign: "center" as const,
        color: "#666",
        marginBottom: "16px",
    },
    cartSummary: {
        background: "#f9fafb",
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "24px",
    },
    cartItem: {
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid #eee",
    },
    cartTotal: {
        display: "flex",
        justifyContent: "space-between",
        padding: "12px 0 0 0",
        fontSize: "18px",
    },
    emptyCart: {
        color: "#999",
        textAlign: "center" as const,
    },
    form: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "16px",
    },
    formGroup: {
        display: "flex",
        flexDirection: "column" as const,
        gap: "4px",
    },
    input: {
        padding: "12px",
        border: "1px solid #ddd",
        borderRadius: "8px",
        fontSize: "16px",
    },
    submitBtn: {
        padding: "16px",
        background: "#2563eb",
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        fontSize: "18px",
        fontWeight: "bold" as const,
        cursor: "pointer",
    },
    errorBox: {
        background: "#fee2e2",
        border: "1px solid #ef4444",
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "16px",
        color: "#b91c1c",
    },
    testMode: {
        textAlign: "center" as const,
        color: "#f59e0b",
        marginTop: "16px",
    },
    iframeWrapper: {
        background: "#fff",
        borderRadius: "12px",
        padding: "24px",
        maxWidth: "600px",
        width: "100%",
        textAlign: "center" as const,
    },
    iframe: {
        width: "100%",
        height: "600px",
        border: "none",
        borderRadius: "8px",
    },
};
