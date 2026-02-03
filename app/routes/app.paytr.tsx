import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    TextField,
    Button,
    Banner,
    Checkbox,
    IndexTable,
    Badge,
    Modal,
    FormLayout,
    Select,
    InlineStack,
    EmptyState,
    Divider,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Loader: PayTR config ve kuralları çek
export async function loader({ request }: LoaderFunctionArgs) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const config = await prisma.paytrConfig.findUnique({
        where: { shop },
    });

    const rules = await prisma.installmentRule.findMany({
        where: { shop },
        orderBy: { vendorName: "asc" },
    });

    // Mağazadaki vendor listesini çek
    const { admin } = await authenticate.admin(request);
    let vendors: string[] = [];

    try {
        const response = await admin.graphql(`
      query {
        products(first: 250) {
          edges {
            node {
              vendor
            }
          }
        }
      }
    `);
        const data = await response.json();
        const allVendors = data.data?.products?.edges?.map((e: any) => e.node.vendor) || [];
        vendors = [...new Set(allVendors)].filter(Boolean).sort() as string[];
    } catch (e) {
        console.error("Vendor fetch error:", e);
    }

    return json({ config, rules, vendors });
}

// Action: Config kaydet veya kural ekle/sil
export async function action({ request }: ActionFunctionArgs) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "saveConfig") {
        const merchantId = formData.get("merchantId") as string;
        const merchantKey = formData.get("merchantKey") as string;
        const merchantSalt = formData.get("merchantSalt") as string;
        const testMode = formData.get("testMode") === "true";

        await prisma.paytrConfig.upsert({
            where: { shop },
            update: { merchantId, merchantKey, merchantSalt, testMode },
            create: { shop, merchantId, merchantKey, merchantSalt, testMode },
        });

        return json({ success: true, message: "PayTR ayarları kaydedildi." });
    }

    if (actionType === "addRule") {
        const vendorName = formData.get("vendorName") as string;
        const maxInstallments = parseInt(formData.get("maxInstallments") as string);
        const commissionRate = parseFloat(formData.get("commissionRate") as string) || 0;

        await prisma.installmentRule.upsert({
            where: { shop_vendorName: { shop, vendorName } },
            update: { maxInstallments, commissionRate },
            create: { shop, vendorName, maxInstallments, commissionRate },
        });

        return json({ success: true, message: `${vendorName} için kural eklendi.` });
    }

    if (actionType === "deleteRule") {
        const ruleId = formData.get("ruleId") as string;
        await prisma.installmentRule.delete({ where: { id: ruleId } });
        return json({ success: true, message: "Kural silindi." });
    }

    return json({ success: false, message: "Bilinmeyen işlem" });
}

export default function PaytrSettings() {
    const { config, rules, vendors } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const isLoading = navigation.state === "submitting";

    // Config state
    const [merchantId, setMerchantId] = useState(config?.merchantId || "");
    const [merchantKey, setMerchantKey] = useState(config?.merchantKey || "");
    const [merchantSalt, setMerchantSalt] = useState(config?.merchantSalt || "");
    const [testMode, setTestMode] = useState(config?.testMode ?? true);

    // Modal state
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedVendor, setSelectedVendor] = useState("");
    const [selectedInstallments, setSelectedInstallments] = useState("3");
    const [commissionRate, setCommissionRate] = useState("0");

    const handleSaveConfig = useCallback(() => {
        const formData = new FormData();
        formData.append("actionType", "saveConfig");
        formData.append("merchantId", merchantId);
        formData.append("merchantKey", merchantKey);
        formData.append("merchantSalt", merchantSalt);
        formData.append("testMode", testMode.toString());
        submit(formData, { method: "post" });
    }, [merchantId, merchantKey, merchantSalt, testMode, submit]);

    const handleAddRule = useCallback(() => {
        if (!selectedVendor) return;
        const formData = new FormData();
        formData.append("actionType", "addRule");
        formData.append("vendorName", selectedVendor);
        formData.append("maxInstallments", selectedInstallments);
        formData.append("commissionRate", commissionRate);
        submit(formData, { method: "post" });
        setModalOpen(false);
        setSelectedVendor("");
    }, [selectedVendor, selectedInstallments, commissionRate, submit]);

    const handleDeleteRule = useCallback((ruleId: string) => {
        const formData = new FormData();
        formData.append("actionType", "deleteRule");
        formData.append("ruleId", ruleId);
        submit(formData, { method: "post" });
    }, [submit]);

    const installmentOptions = [
        { label: "Tek Çekim", value: "1" },
        { label: "2 Taksit", value: "2" },
        { label: "3 Taksit", value: "3" },
        { label: "4 Taksit", value: "4" },
        { label: "5 Taksit", value: "5" },
        { label: "6 Taksit", value: "6" },
        { label: "9 Taksit", value: "9" },
        { label: "12 Taksit", value: "12" },
    ];

    const vendorOptions = vendors.map((v) => ({ label: v, value: v }));

    return (
        <Page
            title="PayTR Entegrasyonu"
            subtitle="Marka bazlı taksit kısıtlama sistemi"
            primaryAction={{
                content: "Kural Ekle",
                onAction: () => setModalOpen(true),
            }}
        >
            <Layout>
                {/* API Credentials */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">API Bilgileri</Text>
                            <Text as="p" tone="subdued">
                                PayTR mağaza panelinizden alacağınız bilgileri girin.
                            </Text>

                            <TextField
                                label="Merchant ID"
                                value={merchantId}
                                onChange={setMerchantId}
                                autoComplete="off"
                            />
                            <TextField
                                label="Merchant Key"
                                value={merchantKey}
                                onChange={setMerchantKey}
                                type="password"
                                autoComplete="off"
                            />
                            <TextField
                                label="Merchant Salt"
                                value={merchantSalt}
                                onChange={setMerchantSalt}
                                type="password"
                                autoComplete="off"
                            />
                            <Checkbox
                                label="Test Modu (Sandbox)"
                                checked={testMode}
                                onChange={setTestMode}
                            />
                            <Button
                                variant="primary"
                                onClick={handleSaveConfig}
                                loading={isLoading}
                            >
                                Kaydet
                            </Button>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {/* Installment Rules */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">Taksit Kuralları</Text>
                            <Text as="p" tone="subdued">
                                Marka bazlı max taksit sayısını belirleyin. Sepette birden fazla kural varsa en düşük olan uygulanır.
                            </Text>

                            {rules.length === 0 ? (
                                <EmptyState
                                    heading="Henüz kural yok"
                                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                                >
                                    <p>Marka bazlı taksit kısıtlaması eklemek için "Kural Ekle" butonuna tıklayın.</p>
                                </EmptyState>
                            ) : (
                                <IndexTable
                                    itemCount={rules.length}
                                    headings={[
                                        { title: "Marka" },
                                        { title: "Max Taksit" },
                                        { title: "Vade Farkı" },
                                        { title: "İşlemler" },
                                    ]}
                                    selectable={false}
                                >
                                    {rules.map((rule, index) => (
                                        <IndexTable.Row key={rule.id} id={rule.id} position={index}>
                                            <IndexTable.Cell>
                                                <Text as="span" fontWeight="bold">{rule.vendorName}</Text>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Badge tone={rule.maxInstallments === 1 ? "warning" : "info"}>
                                                    {rule.maxInstallments === 1 ? "Tek Çekim" : `${rule.maxInstallments} Taksit`}
                                                </Badge>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                {rule.commissionRate > 0 ? `%${rule.commissionRate}` : "-"}
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Button
                                                    variant="plain"
                                                    tone="critical"
                                                    onClick={() => handleDeleteRule(rule.id)}
                                                >
                                                    Sil
                                                </Button>
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    ))}
                                </IndexTable>
                            )}
                        </BlockStack>
                    </Card>
                </Layout.Section>

                {/* Usage Info */}
                <Layout.Section>
                    <Banner title="Nasıl Çalışır?" tone="info">
                        <BlockStack gap="200">
                            <Text as="p">
                                1. Yukarıdan marka kurallarını ekleyin (örn: Adidas = Max 3 Taksit)
                            </Text>
                            <Text as="p">
                                2. Checkout'ta müşteri "Kredi Kartı" seçtiğinde bizim PayTR ekranımız açılır
                            </Text>
                            <Text as="p">
                                3. Sepetteki en kısıtlayıcı kural otomatik uygulanır
                            </Text>
                        </BlockStack>
                    </Banner>
                </Layout.Section>
            </Layout>

            {/* Add Rule Modal */}
            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title="Taksit Kuralı Ekle"
                primaryAction={{
                    content: "Ekle",
                    onAction: handleAddRule,
                    disabled: !selectedVendor,
                }}
                secondaryActions={[
                    { content: "İptal", onAction: () => setModalOpen(false) },
                ]}
            >
                <Modal.Section>
                    <FormLayout>
                        <Select
                            label="Marka (Vendor)"
                            options={[{ label: "Seçiniz...", value: "" }, ...vendorOptions]}
                            value={selectedVendor}
                            onChange={setSelectedVendor}
                        />
                        <Select
                            label="Maksimum Taksit"
                            options={installmentOptions}
                            value={selectedInstallments}
                            onChange={setSelectedInstallments}
                        />
                        <TextField
                            label="Vade Farkı (%)"
                            type="number"
                            value={commissionRate}
                            onChange={setCommissionRate}
                            helpText="0 = Vade farkı yok"
                            autoComplete="off"
                        />
                    </FormLayout>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
