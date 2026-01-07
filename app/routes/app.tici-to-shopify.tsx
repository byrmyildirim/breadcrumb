import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    InlineStack,
    Text,
    Button,
    Badge,
    DataTable,
    Banner,
    Modal,
    TextField,
    Spinner,
    EmptyState,
    Box,
    Divider,
    ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
    fetchTicimaxOrders,
    testTicimaxConnection,
    type TicimaxSiparis,
} from "../services/ticimaxService.server";
import {
    findOrCreateCustomer,
    createDraftOrder,
} from "../services/shopifyOrderService.server";

// Loader - Mevcut ayarları ve siparişleri yükle
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    // Ticimax config'ini al
    const config = await prisma.ticimaxConfig.findUnique({
        where: { shop },
    });

    // Son sync log'larını al
    const recentLogs = await prisma.ticimaxSyncLog.findMany({
        where: { shop },
        orderBy: { startedAt: "desc" },
        take: 5,
    });

    // Aktarılan siparişleri al
    const syncedOrders = await prisma.ticimaxOrder.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 50,
    });

    return json({
        shop,
        config,
        recentLogs,
        syncedOrders,
    });
};

// Action - Siparişleri çek ve aktar
export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const action = formData.get("action");

    // Config'i al
    const config = await prisma.ticimaxConfig.findUnique({
        where: { shop },
    });

    if (action === "save_config") {
        const wsdlUrl = formData.get("wsdlUrl") as string;
        const uyeKodu = formData.get("uyeKodu") as string;

        if (!wsdlUrl || !uyeKodu) {
            return json({ error: "WSDL URL ve Üye Kodu zorunludur" });
        }

        await prisma.ticimaxConfig.upsert({
            where: { shop },
            create: { shop, wsdlUrl, uyeKodu },
            update: { wsdlUrl, uyeKodu },
        });

        return json({ success: true, message: "Ayarlar kaydedildi" });
    }

    if (action === "test_connection") {
        if (!config) {
            return json({ error: "Önce Ticimax ayarlarını yapılandırın" });
        }

        const result = await testTicimaxConnection({
            wsdlUrl: config.wsdlUrl,
            uyeKodu: config.uyeKodu,
        });

        return json({
            testResult: result,
        });
    }

    if (action === "fetch_orders") {
        if (!config) {
            return json({ error: "Önce Ticimax ayarlarını yapılandırın" });
        }

        try {
            const orders = await fetchTicimaxOrders({
                wsdlUrl: config.wsdlUrl,
                uyeKodu: config.uyeKodu,
            });

            return json({
                orders,
                orderCount: orders.length,
            });
        } catch (error: any) {
            return json({ error: error.message });
        }
    }

    if (action === "sync_order") {
        if (!config) {
            return json({ error: "Önce Ticimax ayarlarını yapılandırın" });
        }

        const orderData = formData.get("orderData") as string;
        if (!orderData) {
            return json({ error: "Sipariş verisi eksik" });
        }

        try {
            const order: TicimaxSiparis = JSON.parse(orderData);

            // Zaten aktarılmış mı kontrol et
            const existing = await prisma.ticimaxOrder.findUnique({
                where: {
                    shop_ticimaxOrderNo: {
                        shop,
                        ticimaxOrderNo: order.siparisNo,
                    },
                },
            });

            if (existing && existing.status === "synced") {
                return json({ error: `Sipariş #${order.siparisNo} zaten aktarılmış` });
            }

            // Müşteriyi bul veya oluştur
            const customer = await findOrCreateCustomer(admin, {
                firstName: order.uyeAdi,
                lastName: order.uyeSoyadi,
                email: order.email || undefined,
                phone: order.telefon || undefined,
                address: order.adres
                    ? {
                        address1: order.adres,
                        city: order.il,
                        province: order.ilce,
                        zip: order.postaKodu,
                        country: "TR",
                    }
                    : undefined,
            });

            // Draft order oluştur
            const draftResult = await createDraftOrder(admin, {
                customerId: customer?.id,
                customerName: `${order.uyeAdi} ${order.uyeSoyadi}`,
                email: order.email,
                phone: order.telefon,
                lineItems: order.urunler.map((urun) => ({
                    title: urun.urunAdi,
                    quantity: urun.adet,
                    priceSet: {
                        shopMoney: {
                            amount: (urun.tutar + urun.kdvTutari).toFixed(2),
                            currencyCode: "TRY",
                        },
                    },
                    sku: urun.stokKodu,
                })),
                note: `Ticimax Sipariş No: ${order.siparisNo}\nTarih: ${order.siparisTarihi}`,
                shippingAddress: order.adres
                    ? {
                        address1: order.adres,
                        city: order.il,
                        province: order.ilce,
                        zip: order.postaKodu,
                        country: "TR",
                        firstName: order.uyeAdi,
                        lastName: order.uyeSoyadi,
                        phone: order.telefon,
                    }
                    : undefined,
                tags: ["ticimax-import", `ticimax-${order.siparisNo}`],
            });

            if (!draftResult.success) {
                // Hata kaydı oluştur
                await prisma.ticimaxOrder.upsert({
                    where: {
                        shop_ticimaxOrderNo: {
                            shop,
                            ticimaxOrderNo: order.siparisNo,
                        },
                    },
                    create: {
                        shop,
                        ticimaxOrderNo: order.siparisNo,
                        customerName: `${order.uyeAdi} ${order.uyeSoyadi}`,
                        customerEmail: order.email,
                        customerPhone: order.telefon,
                        totalAmount: order.toplamTutar,
                        status: "failed",
                        errorMessage: draftResult.error,
                        orderData: JSON.stringify(order),
                    },
                    update: {
                        status: "failed",
                        errorMessage: draftResult.error,
                    },
                });

                return json({ error: draftResult.error });
            }

            // Başarılı kayıt
            await prisma.ticimaxOrder.upsert({
                where: {
                    shop_ticimaxOrderNo: {
                        shop,
                        ticimaxOrderNo: order.siparisNo,
                    },
                },
                create: {
                    shop,
                    ticimaxOrderNo: order.siparisNo,
                    shopifyOrderId: draftResult.orderId,
                    shopifyOrderName: draftResult.orderName,
                    shopifyCustomerId: draftResult.customerId || customer?.id,
                    customerName: `${order.uyeAdi} ${order.uyeSoyadi}`,
                    customerEmail: order.email,
                    customerPhone: order.telefon,
                    totalAmount: order.toplamTutar,
                    status: "synced",
                    orderData: JSON.stringify(order),
                    syncedAt: new Date(),
                },
                update: {
                    shopifyOrderId: draftResult.orderId,
                    shopifyOrderName: draftResult.orderName,
                    shopifyCustomerId: draftResult.customerId || customer?.id,
                    status: "synced",
                    errorMessage: null,
                    syncedAt: new Date(),
                },
            });

            // Config'in lastSync'ini güncelle
            await prisma.ticimaxConfig.update({
                where: { shop },
                data: { lastSync: new Date() },
            });

            return json({
                success: true,
                message: `Sipariş #${order.siparisNo} başarıyla aktarıldı`,
                shopifyOrderName: draftResult.orderName,
                customerIsNew: customer?.isNew,
            });
        } catch (error: any) {
            console.error("Sipariş aktarma hatası:", error);
            return json({ error: error.message });
        }
    }

    return json({ error: "Geçersiz işlem" });
};

// Component
export default function TiciToShopify() {
    const { config, recentLogs, syncedOrders } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const isLoading = navigation.state !== "idle";

    // State
    const [settingsModalOpen, setSettingsModalOpen] = useState(false);
    const [wsdlUrl, setWsdlUrl] = useState(config?.wsdlUrl || "");
    const [uyeKodu, setUyeKodu] = useState(config?.uyeKodu || "");
    const [orders, setOrders] = useState<TicimaxSiparis[]>([]);
    const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
    const [syncingOrder, setSyncingOrder] = useState<string | null>(null);

    // Siparişleri çek
    const handleFetchOrders = useCallback(() => {
        submit({ action: "fetch_orders" }, { method: "post" });
    }, [submit]);

    // Ayarları kaydet
    const handleSaveSettings = useCallback(() => {
        submit({ action: "save_config", wsdlUrl, uyeKodu }, { method: "post" });
        setSettingsModalOpen(false);
    }, [submit, wsdlUrl, uyeKodu]);

    // Bağlantı testi
    const handleTestConnection = useCallback(() => {
        submit({ action: "test_connection" }, { method: "post" });
    }, [submit]);

    // Tek sipariş aktar
    const handleSyncOrder = useCallback(
        (order: TicimaxSiparis) => {
            setSyncingOrder(order.siparisNo);
            submit(
                {
                    action: "sync_order",
                    orderData: JSON.stringify(order),
                },
                { method: "post" }
            );
        },
        [submit]
    );

    // Action data'dan siparişleri güncelle
    if (actionData && "orders" in actionData && actionData.orders) {
        if (orders.length !== actionData.orders.length) {
            setOrders(actionData.orders);
        }
    }

    // Aktarılmış sipariş numaralarını set olarak tut
    const syncedOrderNos = new Set(
        syncedOrders
            .filter((o) => o.status === "synced")
            .map((o) => o.ticimaxOrderNo)
    );

    return (
        <Page>
            <TitleBar title="Tici to Shopify" />

            <Layout>
                <Layout.Section>
                    <BlockStack gap="400">
                        {/* Banner - Hata veya Başarı mesajları */}
                        {actionData && "error" in actionData && actionData.error && (
                            <Banner tone="critical" onDismiss={() => { }}>
                                {actionData.error}
                            </Banner>
                        )}
                        {actionData && "success" in actionData && actionData.success && (
                            <Banner tone="success" onDismiss={() => { }}>
                                {actionData.message}
                            </Banner>
                        )}
                        {actionData && "testResult" in actionData && actionData.testResult && (
                            <Banner
                                tone={actionData.testResult.success ? "success" : "critical"}
                                onDismiss={() => { }}
                            >
                                {actionData.testResult.message}
                            </Banner>
                        )}

                        {/* Ayarlar Kartı */}
                        <Card>
                            <BlockStack gap="400">
                                <InlineStack align="space-between">
                                    <BlockStack gap="100">
                                        <Text as="h2" variant="headingMd">
                                            Ticimax Bağlantısı
                                        </Text>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            {config
                                                ? `WSDL: ${config.wsdlUrl.substring(0, 50)}...`
                                                : "Henüz yapılandırılmadı"}
                                        </Text>
                                    </BlockStack>
                                    <InlineStack gap="200">
                                        {config && (
                                            <Badge tone={config.isActive ? "success" : "warning"}>
                                                {config.isActive ? "Aktif" : "Pasif"}
                                            </Badge>
                                        )}
                                        <Button onClick={() => setSettingsModalOpen(true)}>
                                            Ayarlar
                                        </Button>
                                        {config && (
                                            <Button onClick={handleTestConnection} loading={isLoading}>
                                                Bağlantı Test Et
                                            </Button>
                                        )}
                                    </InlineStack>
                                </InlineStack>
                            </BlockStack>
                        </Card>

                        {/* Siparişleri Çek */}
                        {config && (
                            <Card>
                                <BlockStack gap="400">
                                    <InlineStack align="space-between">
                                        <BlockStack gap="100">
                                            <Text as="h2" variant="headingMd">
                                                Ticimax Siparişleri
                                            </Text>
                                            <Text as="p" variant="bodySm" tone="subdued">
                                                Onaylanmış siparişleri çekin ve Shopify'a aktarın
                                            </Text>
                                        </BlockStack>
                                        <Button
                                            variant="primary"
                                            onClick={handleFetchOrders}
                                            loading={isLoading}
                                        >
                                            Siparişleri Çek
                                        </Button>
                                    </InlineStack>

                                    {isLoading && (
                                        <InlineStack align="center" gap="200">
                                            <Spinner size="small" />
                                            <Text as="span">Yükleniyor...</Text>
                                        </InlineStack>
                                    )}

                                    {orders.length === 0 && !isLoading && (
                                        <EmptyState
                                            heading="Sipariş bulunamadı"
                                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                                        >
                                            <p>
                                                Ticimax'tan siparişleri çekmek için yukarıdaki butonu
                                                kullanın.
                                            </p>
                                        </EmptyState>
                                    )}

                                    {orders.length > 0 && (
                                        <DataTable
                                            columnContentTypes={[
                                                "text",
                                                "text",
                                                "text",
                                                "numeric",
                                                "text",
                                                "text",
                                            ]}
                                            headings={[
                                                "Sipariş No",
                                                "Tarih",
                                                "Müşteri",
                                                "Tutar",
                                                "Durum",
                                                "İşlem",
                                            ]}
                                            rows={orders.map((order) => {
                                                const isSynced = syncedOrderNos.has(order.siparisNo);
                                                const isSyncing = syncingOrder === order.siparisNo && isLoading;

                                                return [
                                                    order.siparisNo,
                                                    new Date(order.siparisTarihi).toLocaleDateString("tr-TR"),
                                                    `${order.uyeAdi} ${order.uyeSoyadi}`,
                                                    `₺${order.toplamTutar.toFixed(2)}`,
                                                    isSynced ? (
                                                        <Badge tone="success">Aktarıldı</Badge>
                                                    ) : (
                                                        <Badge tone="warning">Bekliyor</Badge>
                                                    ),
                                                    isSynced ? (
                                                        <Text as="span" tone="subdued">
                                                            ✓
                                                        </Text>
                                                    ) : (
                                                        <Button
                                                            size="slim"
                                                            onClick={() => handleSyncOrder(order)}
                                                            loading={isSyncing}
                                                            disabled={isLoading}
                                                        >
                                                            Aktar
                                                        </Button>
                                                    ),
                                                ];
                                            })}
                                        />
                                    )}
                                </BlockStack>
                            </Card>
                        )}

                        {/* Aktarım Geçmişi */}
                        {syncedOrders.length > 0 && (
                            <Card>
                                <BlockStack gap="400">
                                    <Text as="h2" variant="headingMd">
                                        Aktarım Geçmişi
                                    </Text>
                                    <DataTable
                                        columnContentTypes={["text", "text", "text", "text", "text"]}
                                        headings={[
                                            "Ticimax No",
                                            "Shopify No",
                                            "Müşteri",
                                            "Tutar",
                                            "Durum",
                                        ]}
                                        rows={syncedOrders.slice(0, 20).map((order) => [
                                            order.ticimaxOrderNo,
                                            order.shopifyOrderName || "-",
                                            order.customerName,
                                            `₺${order.totalAmount.toFixed(2)}`,
                                            order.status === "synced" ? (
                                                <Badge tone="success">Başarılı</Badge>
                                            ) : order.status === "failed" ? (
                                                <Badge tone="critical">Hata</Badge>
                                            ) : (
                                                <Badge>Bekliyor</Badge>
                                            ),
                                        ])}
                                    />
                                </BlockStack>
                            </Card>
                        )}
                    </BlockStack>
                </Layout.Section>
            </Layout>

            {/* Ayarlar Modal */}
            <Modal
                open={settingsModalOpen}
                onClose={() => setSettingsModalOpen(false)}
                title="Ticimax API Ayarları"
                primaryAction={{
                    content: "Kaydet",
                    onAction: handleSaveSettings,
                    loading: isLoading,
                }}
                secondaryActions={[
                    {
                        content: "İptal",
                        onAction: () => setSettingsModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <BlockStack gap="400">
                        <TextField
                            label="WSDL URL"
                            value={wsdlUrl}
                            onChange={setWsdlUrl}
                            placeholder="http://yoursite.com/Servis/SiparisServis.svc?wsdl"
                            helpText="Ticimax sipariş servisi WSDL adresi"
                            autoComplete="off"
                        />
                        <TextField
                            label="Üye Kodu (API Key)"
                            value={uyeKodu}
                            onChange={setUyeKodu}
                            placeholder="XXXXXXXXXXXXXXXXXXXX"
                            helpText="Ticimax entegrasyon üye kodu"
                            autoComplete="off"
                        />
                    </BlockStack>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
