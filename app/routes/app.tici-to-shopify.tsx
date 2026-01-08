import { useState, useCallback, useEffect, useMemo } from "react";
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
    Select,
    Collapsible,
    Icon,
    List,
    Checkbox
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
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
// Action - Siparişleri çek ve aktar
export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent");

    // 1. Ayarları Kaydet
    if (intent === "saveSettings") {
        const wsdlUrl = formData.get("wsdlUrl") as string;
        const uyeKodu = formData.get("apiKey") as string;

        if (!wsdlUrl || !uyeKodu) {
            return json({ status: "error", message: "WSDL URL ve Üye Kodu zorunludur" });
        }

        await prisma.ticimaxConfig.upsert({
            where: { shop },
            create: { shop, wsdlUrl, uyeKodu },
            update: { wsdlUrl, uyeKodu },
        });

        return json({ status: "success", message: "Ayarlar kaydedildi." });
    }

    // 2. Bağlantı Testi
    if (intent === "testConnection") {
        try {
            const config = await prisma.ticimaxConfig.findFirst({ where: { shop } });
            if (!config) {
                return json({ status: "error", message: "Önce ayarları kaydedin." });
            }
            const result = await testTicimaxConnection(config);
            return json({
                status: result.success ? "success" : "error",
                message: result.message
            });
        } catch (error: any) {
            return json({ status: "error", message: "Bağlantı hatası: " + error.message });
        }
    }

    // 3. Siparişleri Çek ve Müşteri Eşleştir
    if (intent === "fetchOrders") {
        try {
            const config = await prisma.ticimaxConfig.findFirst({ where: { shop } });
            if (!config) {
                return json({ status: "error", message: "Konfigürasyon bulunamadı." });
            }

            const statusParam = formData.get("status");
            const pageParam = formData.get("page");

            const siparisDurumu = statusParam ? parseInt(statusParam as string) : -1;
            const page = pageParam ? parseInt(pageParam as string) : 1;

            const orders = await fetchTicimaxOrders(config, { SiparisDurumu: siparisDurumu }, {}, page);

            // Müşteri eşleştirmelerini yap
            const enrichedOrders = await Promise.all(orders.map(async (order) => {
                let shopifyCustomerId = null;
                // E-posta ile kontrol
                if (order.email) {
                    const customers = await admin.graphql(
                        `#graphql
                    query findCustomer($query: String!) {
                        customers(first: 1, query: $query) {
                            edges {
                                node {
                                    id
                                }
                            }
                        }
                    }`,
                        { variables: { query: `email:${order.email}` } }
                    );

                    const responseJson = await customers.json();
                    const edge = responseJson.data?.customers?.edges?.[0];
                    if (edge) {
                        shopifyCustomerId = edge.node.id;
                    }
                }
                // Telefon ile kontrol (Alternatif)
                if (!shopifyCustomerId && order.telefon) {
                    const customers = await admin.graphql(
                        `#graphql
                    query findCustomer($query: String!) {
                        customers(first: 1, query: $query) {
                            edges {
                                node {
                                    id
                                }
                            }
                        }
                    }`,
                        { variables: { query: `phone:${order.telefon}` } }
                    );
                    const responseJson = await customers.json();
                    const edge = responseJson.data?.customers?.edges?.[0];
                    if (edge) {
                        shopifyCustomerId = edge.node.id;
                    }
                }

                return {
                    ...order,
                    _shopifyCustomerId: shopifyCustomerId
                };
            }));

            return json({
                status: "success",
                orders: enrichedOrders,
                message: `${orders.length} sipariş çekildi.`
            });
        } catch (error: any) {
            return json({ status: "error", message: "Siparişler çekilemedi: " + error.message });
        }
    }

    // 4. Sipariş Aktar (Sync)
    if (intent === "syncOrders") {
        try {
            const orderId = formData.get("orderId") as string; // This is now SiparisID (int) sent as string
            const orderNo = formData.get("orderNo") as string; // Verification key

            const config = await prisma.ticimaxConfig.findFirst({ where: { shop } });
            if (!config) throw new Error("Ayar yok");

            // Siparişi ID ile doğrudan çek (Hata riskini ve yükü azaltır)
            // Filtreleme ID ile yapıldığı için sayfalama sorunu olmaz
            const orders = await fetchTicimaxOrders(config, { SiparisID: parseInt(orderId) });
            const orderData = orders[0];

            if (!orderData) {
                throw new Error("Sipariş Ticimax verisinde bulunamadı. (Filtre: " + orderId + ")");
            }

            // Güvenlik Kontrolü: Çekilen siparişin numarası, istenen numara ile eşleşiyor mu?
            if (orderNo && orderData.siparisNo !== orderNo) {
                console.error(`Mismatch! Requested ID: ${orderId}, Req No: ${orderNo}, Found No: ${orderData.siparisNo}`);
                throw new Error(`Sipariş eşleşmedi! İstenen: ${orderNo}, Bulunan: ${orderData.siparisNo}. Lütfen sayfayı yenileyip tekrar deneyin.`);
            }

            // Müşteriyi bul veya oluştur
            const customerResult = await findOrCreateCustomer(admin, {
                firstName: orderData.uyeAdi,
                lastName: orderData.uyeSoyadi,
                email: orderData.email,
                phone: orderData.telefon,
                address: orderData.adres ? {
                    address1: orderData.adres,
                    city: orderData.il,
                    province: orderData.ilce,
                    country: "Turkey"
                } : undefined
            });

            // Draft Order Oluştur
            const result = await createDraftOrder(admin, {
                customerId: customerResult?.id,
                customerName: `${orderData.uyeAdi} ${orderData.uyeSoyadi}`,
                email: orderData.email,
                phone: orderData.telefon,
                lineItems: orderData.urunler.map(u => ({
                    title: u.urunAdi,
                    quantity: u.adet,
                    priceSet: {
                        shopMoney: {
                            amount: (u.tutar + u.kdvTutari).toString(), // KDV dahil birim fiyat varsayımı veya KDV eklenecek mi? Ticimax'tan gelen Tutar genelde KDV hariçtir.
                            currencyCode: "TRY"
                        }
                    },
                    sku: u.stokKodu
                })),
                note: `Ticimax Sipariş No: ${orderData.siparisNo}\nTarih: ${orderData.siparisTarihi}`,
                tags: ["ticimax-import", `ticimax-${orderData.siparisNo}`],
                shippingAddress: orderData.adres ? {
                    address1: orderData.adres,
                    city: orderData.il,
                    province: orderData.ilce,
                    country: "Turkey",
                    firstName: orderData.uyeAdi, // Alıcı adı ayrı değilse üye adı kullanılır
                    lastName: orderData.uyeSoyadi,
                    phone: orderData.telefon
                } : undefined
            });

            if (result.success) {
                await prisma.ticimaxOrder.create({
                    data: {
                        shop,
                        ticimaxOrderNo: orderData.siparisNo,
                        shopifyOrderId: result.orderId,
                        shopifyOrderName: result.orderName,
                        customerName: `${orderData.uyeAdi} ${orderData.uyeSoyadi}`,
                        shopifyCustomerId: customerResult?.id,
                        totalAmount: orderData.toplamTutar,
                        status: "synced",
                        orderData: JSON.stringify(orderData),
                        syncedAt: new Date()
                    }
                });

                return json({ status: "success", message: `Sipariş ${result.orderName} olarak aktarıldı.` });
            } else {
                // Hata
                await prisma.ticimaxOrder.create({
                    data: {
                        shop,
                        ticimaxOrderNo: orderData.siparisNo,
                        customerName: `${orderData.uyeAdi} ${orderData.uyeSoyadi}`,
                        totalAmount: orderData.toplamTutar,
                        status: "failed",
                        errorMessage: result.error,
                        orderData: JSON.stringify(orderData),
                        syncedAt: new Date()
                    }
                });
                return json({ status: "error", message: `Draft Order hatası: ${result.error}` });
            }
        } catch (error: any) {
            return json({ status: "error", message: error.message });
        }
    }

    // 5. Silme İşlemi
    if (intent === "deleteSync") {
        const id = formData.get("id") as string;
        try {
            await prisma.ticimaxOrder.delete({
                where: { id }
            });
            return json({ status: "success", message: "Kayıt başarıyla silindi." });
        } catch (error) {
            return json({ status: "error", message: "Silme sırasında hata." });
        }
    }

    return json({ status: "error", message: "Geçersiz işlem" });
};

const STATUS_MAP: Record<number, string> = {
    0: "Ön Sipariş",
    1: "Onay Bekliyor",
    2: "Onaylandı",
    3: "Ödeme Bekliyor",
    4: "Paketleniyor",
    5: "Tedarik Ediliyor",
    6: "Kargoya Verildi",
    7: "Teslim Edildi",
    8: "İptal Edildi",
    9: "İade Edildi",
    10: "Silinmiş",
    11: "İade Talebi Alındı",
    12: "İade Ulaştı Ödeme Yapılacak",
    13: "İade Ödemesi Yapıldı",
    14: "Teslimat Öncesi İptal Talebi",
    15: "İptal Talebi",
    16: "Kısmi İade Talebi",
    17: "Kısmi İade Yapıldı"
};

function CustomerGroup({ group, syncedOrders, isSyncing, onSync }: {
    group: { customerName: string; email: string; shopifyId: string | null; orders: any[] },
    syncedOrders: any[],
    isSyncing: boolean,
    onSync: (id: number, no: string) => void
}) {
    const [open, setOpen] = useState(false);

    return (
        <Card>
            <BlockStack gap="200">
                <div
                    onClick={() => setOpen(!open)}
                    style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                    <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">{group.customerName}</Text>
                        <Text as="p" tone="subdued">{group.email} • {group.orders.length} Sipariş</Text>
                        {group.shopifyId ?
                            <Text as="span" tone="success">Shopify ID: {group.shopifyId.split("/").pop()}</Text> :
                            <Badge tone="attention">Eşleşmedi</Badge>
                        }
                    </BlockStack>
                    <Icon source={open ? ChevronUpIcon : ChevronDownIcon} tone="base" />
                </div>

                <Collapsible open={open} id={`collapse-${group.email}`} transition={{ duration: '500ms', timingFunction: 'ease-in-out' }}>
                    <Box paddingBlockStart="400">
                        <DataTable
                            columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                            headings={["Sipariş No", "Tarih", "Tutar", "Durum (Ticimax)", "Sync", "İşlem"]}
                            rows={group.orders.map(order => {
                                const isAlreadySynced = syncedOrders.some(s => s.ticimaxOrderNo === order.siparisNo && s.status === "synced");
                                let ticimaxStatus = STATUS_MAP[order.siparisDurumu] || `Bilinmiyor (${order.siparisDurumu})`;
                                if (order.siparisDurumu === -1 && order.rawStatus) {
                                    ticimaxStatus += ` [DEBUG: ${order.rawStatus}]`;
                                }

                                return [
                                    order.siparisNo,
                                    new Date(order.siparisTarihi).toLocaleDateString("tr-TR"),
                                    `₺${order.toplamTutar}`,
                                    ticimaxStatus,
                                    isAlreadySynced ? <Badge tone="success">Aktarıldı</Badge> : <Badge tone="attention">Bekliyor</Badge>,
                                    <Button size="slim" onClick={(e) => { e.stopPropagation(); onSync(order.siparisId, order.siparisNo); }} disabled={isAlreadySynced || isSyncing}>
                                        {isAlreadySynced ? "✓" : "Aktar"}
                                    </Button>
                                ]
                            })}
                        />
                    </Box>
                </Collapsible>
            </BlockStack>
        </Card>
    );
}

// Component
export default function TiciToShopify() {
    const { config, recentLogs, syncedOrders } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();

    // State
    const [settingsModalOpen, setSettingsModalOpen] = useState(false);
    const [wsdlUrl, setWsdlUrl] = useState(config?.wsdlUrl || "http://www.goatjump.com/Servis/SiparisServis.svc?wsdl");
    const [apiKey, setApiKey] = useState(config?.uyeKodu || "");
    const [fetchedOrders, setFetchedOrders] = useState<any[]>([]);
    const [selectedStatus, setSelectedStatus] = useState("7"); // Varsayılan: Teslim Edildi
    const [hideSynced, setHideSynced] = useState(true); // Varsayılan: Aktarılanları gizle
    const [currentPage, setCurrentPage] = useState(1);

    // Action'dan gelen verileri yakala
    useEffect(() => {
        const data = actionData as any;
        if (data?.status === "success") {
            if (data.orders) {
                setFetchedOrders(data.orders);
                shopify.toast.show(data.message || "Siparişler yüklendi");
            } else {
                shopify.toast.show(data.message || "İşlem başarılı");
            }
        } else if (data?.status === "error") {
            shopify.toast.show(data.message || "Hata oluştu", { duration: 5000, isError: true });
        }
    }, [actionData]);

    // Loading durumları
    const isFetching = navigation.state === "submitting" && navigation.formData?.get("intent") === "fetchOrders";
    const isSyncing = navigation.state === "submitting" && navigation.formData?.get("intent") === "syncOrders";
    const isTesting = navigation.state === "submitting" && navigation.formData?.get("intent") === "testConnection";

    // Aksiyonlar
    const handleSaveSettings = () => submit({ intent: "saveSettings", wsdlUrl, apiKey }, { method: "post" });
    const handleTestConnection = () => submit({ intent: "testConnection" }, { method: "post" });

    const handleFetchOrders = useCallback((page = 1) => {
        setCurrentPage(page);
        submit({ intent: "fetchOrders", status: selectedStatus, page: page.toString() }, { method: "post" });
    }, [submit, selectedStatus]);

    const handleSyncOrder = (id: number, no: string) => {
        submit({ intent: "syncOrders", orderId: id.toString(), orderNo: no }, { method: "post" });
    };

    const handleDeleteSync = (id: string) => {
        if (confirm("Silmek istediğinize emin misiniz?")) {
            submit({ intent: "deleteSync", id }, { method: "post" });
        }
    }

    const statusOptions = [
        { label: 'Hepsi (-1)', value: '-1' },
        { label: 'Ön Sipariş (0)', value: '0' },
        { label: 'Onay Bekliyor (1)', value: '1' },
        { label: 'Onaylandı (2)', value: '2' },
        { label: 'Ödeme Bekliyor (3)', value: '3' },
        { label: 'Paketleniyor (4)', value: '4' },
        { label: 'Tedarik Ediliyor (5)', value: '5' },
        { label: 'Kargoya Verildi (6)', value: '6' },
        { label: 'Teslim Edildi (7)', value: '7' },
        { label: 'İptal Edildi (8)', value: '8' },
        { label: 'İade Edildi (9)', value: '9' },
        { label: 'Silinmiş (10)', value: '10' },
        { label: 'İade Talebi Alındı (11)', value: '11' },
        { label: 'İade Ulaştı Ödeme Yapılacak (12)', value: '12' },
        { label: 'İade Ödemesi Yapıldı (13)', value: '13' },
        { label: 'Teslimat Öncesi İptal Talebi (14)', value: '14' },
        { label: 'İptal Talebi (15)', value: '15' },
        { label: 'Kısmi İade Talebi (16)', value: '16' },
        { label: 'Kısmi İade Yapıldı (17)', value: '17' }
    ];

    // Gruplama Mantığı
    // Gruplama Mantığı: Müşteri bazlı gruplama
    const groupedOrders = useMemo(() => {
        if (!fetchedOrders.length) return [];

        const groups: Record<string, {
            customerName: string;
            email: string;
            shopifyId: string | null;
            orders: any[];
        }> = {};

        fetchedOrders.forEach((order) => {
            // Gruplama anahtarı: Shopify ID > Email > Ad Soyad
            const key = order._shopifyCustomerId || order.email || `${order.uyeAdi} ${order.uyeSoyadi}`;

            const isAlreadySynced = syncedOrders.some(s => s.ticimaxOrderNo === order.siparisNo && s.status === "synced");
            if (hideSynced && isAlreadySynced) return; // Aktarılanları gizle

            if (!groups[key]) {
                groups[key] = {
                    customerName: `${order.uyeAdi} ${order.uyeSoyadi}`,
                    email: order.email,
                    shopifyId: order._shopifyCustomerId,
                    orders: []
                };
            }
            groups[key].orders.push(order);
        });

        // Objeden array'e çevir ve sırala
        return Object.values(groups).sort((a, b) => a.customerName.localeCompare(b.customerName));
    }, [fetchedOrders]);

    return (
        <Page fullWidth>
            <TitleBar title="Tici to Shopify">
            </TitleBar>

            <BlockStack gap="500">
                {/* Ayarlar ve Test */}
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">Ticimax Bağlantısı</Text>
                                <Text as="p" tone="subdued">WSDL: {config?.wsdlUrl ? (config.wsdlUrl.length > 50 ? config.wsdlUrl.substring(0, 50) + "..." : config.wsdlUrl) : "Tanımlı değil"}</Text>
                            </BlockStack>
                            <InlineStack gap="300">
                                {config ? (
                                    <Badge tone="success">Aktif</Badge>
                                ) : (
                                    <Badge tone="critical">Pasif</Badge>
                                )}
                                <Button onClick={() => setSettingsModalOpen(true)}>Ayarlar</Button>
                                <Button onClick={handleTestConnection} loading={isTesting}>Bağlantı Test Et</Button>
                            </InlineStack>
                        </InlineStack>
                    </BlockStack>
                </Card>

                {/* Sipariş Listesi */}
                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100">
                                <Text as="h2" variant="headingMd">Ticimax Siparişleri</Text>
                                <Text as="p" tone="subdued">Siparişleri çekin ve Shopify'a aktarın (Sayfa: {currentPage})</Text>
                            </BlockStack>
                            <InlineStack gap="300">
                                <Select
                                    label="Durum"
                                    labelHidden
                                    options={statusOptions}
                                    onChange={setSelectedStatus}
                                    value={selectedStatus}
                                />
                                <Checkbox
                                    label="Aktarılanları Gizle"
                                    checked={hideSynced}
                                    onChange={setHideSynced}
                                />
                                <Button
                                    disabled={currentPage <= 1}
                                    onClick={() => handleFetchOrders(currentPage - 1)}
                                >
                                    &lt; Önceki
                                </Button>
                                <Button variant="primary" onClick={() => handleFetchOrders(currentPage)} loading={isFetching}>
                                    Yenile / Çek (Bulk)
                                </Button>
                                <Button
                                    onClick={() => handleFetchOrders(currentPage + 1)}
                                >
                                    Sonraki &gt;
                                </Button>
                            </InlineStack>
                        </InlineStack>

                        {groupedOrders.length > 0 ? (
                            <BlockStack gap="200">
                                {groupedOrders.map((group: any) => (
                                    <CustomerGroup
                                        key={group.email + (group.shopifyId || "")}
                                        group={group}
                                        syncedOrders={syncedOrders}
                                        isSyncing={isSyncing}
                                        onSync={handleSyncOrder}
                                    />
                                ))}
                            </BlockStack>
                        ) : (
                            isFetching ? <Text as="p" tone="subdued">Yükleniyor...</Text> : <Text as="p" tone="subdued">Listelenecek sipariş yok.</Text>
                        )}
                    </BlockStack>
                </Card>

                {/* Geçmiş */}
                {syncedOrders.length > 0 && (
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">
                                Aktarım Geçmişi
                            </Text>
                            <DataTable
                                columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
                                headings={[
                                    "Ticimax No",
                                    "Shopify No",
                                    "Müşteri",
                                    "Tutar",
                                    "Durum",
                                    "İşlem",
                                    "Yönet"
                                ]}
                                rows={syncedOrders.slice(0, 50).map((order) => {
                                    const cleanId = (gid: string | null) => {
                                        if (!gid) return "";
                                        return gid.split("/").pop();
                                    };

                                    const shopName = config?.shop.replace(".myshopify.com", "");

                                    return [
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
                                        <InlineStack gap="200">
                                            {order.shopifyOrderId && (
                                                <Button
                                                    size="slim"
                                                    url={`https://admin.shopify.com/store/${shopName}/draft_orders/${cleanId(order.shopifyOrderId)}`}
                                                    target="_blank"
                                                >
                                                    Siparişi Gör
                                                </Button>
                                            )}
                                            {order.shopifyCustomerId && (
                                                <Button
                                                    size="slim"
                                                    url={`https://admin.shopify.com/store/${shopName}/customers/${cleanId(order.shopifyCustomerId)}`}
                                                    target="_blank"
                                                >
                                                    Müşteriyi Gör
                                                </Button>
                                            )}
                                        </InlineStack>,
                                        <Button tone="critical" size="slim" onClick={() => handleDeleteSync(order.id)}>Sil</Button>
                                    ];
                                })}
                            />
                        </BlockStack>
                    </Card>
                )}
            </BlockStack>

            {/* Ayar Modalı */}
            {settingsModalOpen && (
                <Modal
                    open={settingsModalOpen}
                    onClose={() => setSettingsModalOpen(false)}
                    title="Ticimax API Ayarları"
                    primaryAction={{
                        content: 'Kaydet',
                        onAction: handleSaveSettings,
                    }}
                    secondaryActions={[
                        {
                            content: 'İptal',
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
                                autoComplete="off"
                                helpText="Ticimax sipariş servisi WSDL adresi"
                            />
                            <TextField
                                label="Üye Kodu (API Key)"
                                value={apiKey}
                                onChange={setApiKey}
                                autoComplete="off"
                                helpText="Ticimax entegrasyon üye kodu"
                            />
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            )}
        </Page>
    );
}
