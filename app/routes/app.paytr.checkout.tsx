import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Banner, Button, Spinner, InlineStack } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
    preparePaytrIframe,
    calculateMaxInstallment,
    createPaytrTransaction,
} from "../services/paytr.server";

interface CartItem {
    title: string;
    vendor: string;
    price: number;
    quantity: number;
}

// Loader: Sepet bilgilerini al ve max taksiti hesapla
export async function loader({ request }: LoaderFunctionArgs) {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    // PayTR config kontrolü
    const config = await prisma.paytrConfig.findUnique({
        where: { shop },
    });

    if (!config) {
        return json({
            configured: false,
            error: "PayTR yapılandırması yapılmamış. Lütfen PayTR ayarlarını yapın.",
            cartItems: [],
            maxInstallment: 0,
            totalAmount: 0,
        });
    }

    // URL'den checkout token al (Shopify checkout ID veya cart token)
    const url = new URL(request.url);
    const checkoutToken = url.searchParams.get("checkout");
    const cartToken = url.searchParams.get("cart");

    // Demo amaçlı sabit sepet (gerçekte Storefront API veya Session'dan alınır)
    // Bu kısım gerçek implementasyonda Checkout veya Cart API'den çekilecek
    let cartItems: CartItem[] = [];
    let totalAmount = 0;

    // Gerçek implementasyon için: Storefront API ile cart/checkout bilgisi çekilir
    // Şimdilik demo verisi
    if (!checkoutToken && !cartToken) {
        return json({
            configured: true,
            error: "Sepet bilgisi bulunamadı.",
            cartItems: [],
            maxInstallment: 12,
            totalAmount: 0,
            demo: true,
        });
    }

    // Vendor'ları topla ve max taksiti hesapla
    const vendors = [...new Set(cartItems.map((item) => item.vendor))];
    const maxInstallment = await calculateMaxInstallment(shop, vendors);

    return json({
        configured: true,
        cartItems,
        maxInstallment,
        totalAmount,
        shop,
        testMode: config.testMode,
    });
}

// Action: PayTR iframe oluştur
export async function action({ request }: ActionFunctionArgs) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();

    const email = formData.get("email") as string;
    const userName = formData.get("userName") as string;
    const userPhone = formData.get("userPhone") as string;
    const userAddress = formData.get("userAddress") as string;
    const totalAmount = parseInt(formData.get("totalAmount") as string);
    const maxInstallment = parseInt(formData.get("maxInstallment") as string);
    const basketJson = formData.get("basket") as string;

    // Benzersiz sipariş numarası oluştur
    const merchantOid = `SP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Basket parse
    let userBasket;
    try {
        userBasket = JSON.parse(basketJson);
    } catch {
        userBasket = [{ name: "Sepet", price: totalAmount, quantity: 1 }];
    }

    // Base URL'i al
    const baseUrl = `https://${shop.replace(".myshopify.com", "")}.myshopify.com`;

    const result = await preparePaytrIframe(shop, {
        merchantOid,
        email,
        paymentAmount: totalAmount,
        userName,
        userAddress,
        userPhone,
        userBasket,
        maxInstallment,
        successUrl: `${baseUrl}/apps/breadcrumb/paytr/success?oid=${merchantOid}`,
        failUrl: `${baseUrl}/apps/breadcrumb/paytr/fail?oid=${merchantOid}`,
    });

    if (!result.success) {
        return json({ success: false, error: result.error });
    }

    // Transaction kaydı oluştur
    await createPaytrTransaction(shop, merchantOid, totalAmount, maxInstallment, result.token);

    return json({
        success: true,
        iframeUrl: result.iframeUrl,
        postParams: result.postParams,
        merchantOid,
    });
}

export default function PaytrCheckout() {
    const data = useLoaderData<typeof loader>();

    if (!data.configured) {
        return (
            <Page title="PayTR Ödeme">
                <Card>
                    <Banner title="Yapılandırma Gerekli" tone="warning">
                        <p>{data.error}</p>
                        <Button url="/app/paytr">PayTR Ayarlarına Git</Button>
                    </Banner>
                </Card>
            </Page>
        );
    }

    if (data.demo) {
        return (
            <Page title="PayTR Checkout Demo">
                <Card>
                    <BlockStack gap="400">
                        <Banner title="Demo Modu" tone="info">
                            <p>
                                Bu sayfa, gerçek Checkout akışına entegre edildiğinde sepet bilgileri
                                otomatik olarak alınacaktır.
                            </p>
                        </Banner>

                        <Text as="h2" variant="headingMd">Entegrasyon Bilgisi</Text>
                        <Text as="p">
                            Shopify Checkout'tan bu sayfaya yönlendirme yapılmalıdır. Örnek URL:
                        </Text>
                        <code>/apps/breadcrumb/paytr/checkout?cart=TOKEN</code>

                        <Text as="p" tone="subdued">
                            Bu entegrasyon için Shopify Plus veya Custom Storefront API gerekebilir.
                        </Text>
                    </BlockStack>
                </Card>
            </Page>
        );
    }

    return (
        <Page title="Ödeme">
            <Card>
                <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">Sipariş Özeti</Text>

                    {data.cartItems.map((item: CartItem, i: number) => (
                        <InlineStack key={i} align="space-between">
                            <Text as="span">{item.title} x {item.quantity}</Text>
                            <Text as="span">{(item.price / 100).toFixed(2)} TL</Text>
                        </InlineStack>
                    ))}

                    <InlineStack align="space-between">
                        <Text as="span" fontWeight="bold">Toplam</Text>
                        <Text as="span" fontWeight="bold">{(data.totalAmount / 100).toFixed(2)} TL</Text>
                    </InlineStack>

                    <Banner title={`Max Taksit: ${data.maxInstallment}`} tone={data.maxInstallment <= 3 ? "warning" : "info"}>
                        <p>
                            Sepetinizdeki ürünler nedeniyle en fazla {data.maxInstallment} taksit seçebilirsiniz.
                        </p>
                    </Banner>

                    {/* Gerçek formda müşteri bilgileri alınır */}
                    <Form method="post">
                        <input type="hidden" name="totalAmount" value={data.totalAmount} />
                        <input type="hidden" name="maxInstallment" value={data.maxInstallment} />
                        <input type="hidden" name="basket" value={JSON.stringify(data.cartItems)} />
                        {/* Müşteri bilgileri Session/Checkout'tan alınacak */}
                        <input type="hidden" name="email" value="test@test.com" />
                        <input type="hidden" name="userName" value="Test Kullanıcı" />
                        <input type="hidden" name="userPhone" value="5551234567" />
                        <input type="hidden" name="userAddress" value="Test Adres" />

                        <Button variant="primary" submit>
                            PayTR ile Öde
                        </Button>
                    </Form>
                </BlockStack>
            </Card>
        </Page>
    );
}
