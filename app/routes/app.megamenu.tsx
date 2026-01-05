import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Button, TextField, Select, Text, Banner, InlineStack, Box } from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: { request: Request }) {
    const { admin, session } = await authenticate.admin(request);

    // 1. Fetch available menus from Shopify
    const response = await admin.graphql(
        `#graphql
    query getMenus {
      menus(first: 50) {
        nodes {
          id
          title
          handle
        }
      }
    }`
    );
    const responseJson = await response.json();
    const menus = responseJson.data?.menus?.nodes || [];

    // 2. Fetch existing config from DB
    const dbRecord = await prisma.megaMenu.findUnique({
        where: { shop: session.shop },
    });

    let initialConfig = [];
    if (dbRecord?.config) {
        try {
            initialConfig = JSON.parse(dbRecord.config);
        } catch (e) {
            console.error("Failed to parse existing config", e);
        }
    }

    // 3. Fetch Custom Menu to extract top-level items
    const customMenuQuery = await admin.graphql(
        `query {
            shop {
                metafield(namespace: "breadcrumb", key: "custom_menu") {
                    value
                }
            }
        }`
    );
    const customMenuJson = await customMenuQuery.json();
    let customMenuItems = [];
    try {
        const raw = customMenuJson.data?.shop?.metafield?.value;
        if (raw) customMenuItems = JSON.parse(raw);
    } catch (e) {
        console.error("Failed to parse custom menu", e);
    }

    return json({ menus, initialConfig, customMenuItems });
}

export async function action({ request }: { request: Request }) {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    const configString = formData.get("config") as string;

    // 1. Save to Database
    await prisma.megaMenu.upsert({
        where: { shop: session.shop },
        update: { config: configString },
        create: {
            shop: session.shop,
            config: configString,
        },
    });

    // 2. Sync to Shop Metafield
    const shopQuery = await admin.graphql(`{ shop { id } }`);
    const shopJson = await shopQuery.json();
    const shopId = shopJson.data.shop.id;

    await admin.graphql(
        `#graphql
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
           id
        }
        userErrors {
          field
          message
        }
      }
    }`,
        {
            variables: {
                metafields: [
                    {
                        ownerId: shopId,
                        namespace: "breadcrumb",
                        key: "mega_menu_config",
                        type: "json",
                        value: configString,
                    }
                ]
            }
        }
    );

    return json({ status: "success" });
}

export default function MegaMenuPage() {
    const { menus, initialConfig, customMenuItems } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const nav = useNavigation();
    const isSaving = nav.state === "submitting";

    const [items, setItems] = useState(Array.isArray(initialConfig) ? initialConfig : []);

    const addItem = () => {
        setItems([...items, { triggerTitle: "", submenuHandle: "", imageUrl: "" }]);
    };

    const removeItem = (index: number) => {
        const newItems = [...items];
        newItems.splice(index, 1);
        setItems(newItems);
    };

    const updateItem = (index: number, key: string, value: string) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [key]: value };
        setItems(newItems);
    };

    const handleSave = () => {
        const formData = new FormData();
        formData.append("config", JSON.stringify(items));
        submit(formData, { method: "post" });
    };

    // Convert menus to options for Select
    const menuOptions = (menus || []).map((m: any) => ({
        label: `Shopify: ${m.title}`,
        value: m.handle,
    }));

    // Add explicit Custom Menu options
    if (customMenuItems && customMenuItems.length > 0) {
        customMenuItems.forEach((item: any) => {
            menuOptions.unshift({
                label: `★ Özel Menü: ${item.title}`,
                value: `custom_special:${item.title}`
            });
        });
    }

    menuOptions.unshift({ label: "★ Özel Menü (Tümü/Otomatik)", value: "custom_menu_special" });
    menuOptions.unshift({ label: "Seçiniz...", value: "" });

    return (
        <Page
            title="Mega Menü Ayarları"
            subtitle="Üst menü öğeleri ile mega menü içeriklerini eşleştirin."
            primaryAction={{
                content: isSaving ? "Kaydediliyor..." : "Kaydet",
                onAction: handleSave,
                loading: isSaving,
            }}
        >
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="500">
                            <Text as="p" variant="bodyMd">
                                Web sitenizdeki üst menü öğesinin tam adını (Büyük/küçük harf duyarlı olabilir) yazın ve altında açılacak menüyü seçin.
                            </Text>

                            {items.map((item: any, index: number) => (
                                <div key={index} style={{ padding: "16px", border: "1px solid #e1e3e5", borderRadius: "8px" }}>
                                    <BlockStack gap="400">
                                        <InlineStack align="space-between">
                                            <Text variant="headingSm" as="h6">Öğe #{index + 1}</Text>
                                            <Button tone="critical" onClick={() => removeItem(index)} variant="plain">Sil</Button>
                                        </InlineStack>

                                        <InlineStack gap="400" wrap={false}>
                                            <Box width="30%">
                                                <TextField
                                                    label="Tetikleyici Başlık"
                                                    helpText="Örn: 'Bisiklet' veya 'Koşu'"
                                                    value={item.triggerTitle}
                                                    onChange={(val) => updateItem(index, "triggerTitle", val)}
                                                    autoComplete="off"
                                                />
                                            </Box>
                                            <Box width="30%">
                                                <Select
                                                    label="Alt Menü"
                                                    options={menuOptions}
                                                    value={item.submenuHandle}
                                                    onChange={(val) => updateItem(index, "submenuHandle", val)}
                                                />
                                                {/* Preview selected submenu children */}
                                                {item.submenuHandle && item.submenuHandle.startsWith('custom_special:') && (() => {
                                                    const targetTitle = item.submenuHandle.replace('custom_special:', '');
                                                    const foundItem = customMenuItems.find((c: any) => c.title === targetTitle);
                                                    if (foundItem && foundItem.children && foundItem.children.length > 0) {
                                                        return (
                                                            <div style={{ marginTop: '8px', padding: '8px', background: '#f6f6f7', borderRadius: '6px', fontSize: '12px' }}>
                                                                <strong>Alt Menü İçeriği ({foundItem.children.length} öğe):</strong>
                                                                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                                                                    {foundItem.children.slice(0, 5).map((ch: any, i: number) => (
                                                                        <li key={i}>{ch.title}</li>
                                                                    ))}
                                                                    {foundItem.children.length > 5 && <li>... ve {foundItem.children.length - 5} daha</li>}
                                                                </ul>
                                                            </div>
                                                        );
                                                    }
                                                    return <div style={{ marginTop: '8px', color: '#bf0711', fontSize: '12px' }}>⚠️ "{targetTitle}" bulunamadı veya çocuk öğe yok.</div>;
                                                })()}
                                            </Box>
                                            <Box width="40%">
                                                <TextField
                                                    label="Görsel URL"
                                                    helpText="Sol tarafta görünecek görselin bağlantısı"
                                                    value={item.imageUrl}
                                                    onChange={(val) => updateItem(index, "imageUrl", val)}
                                                    autoComplete="off"
                                                />
                                                {item.imageUrl && (
                                                    <div style={{ marginTop: '8px' }}>
                                                        <img src={item.imageUrl} alt="Preview" style={{ maxHeight: '40px', borderRadius: '4px' }} />
                                                    </div>
                                                )}
                                            </Box>
                                        </InlineStack>
                                    </BlockStack>
                                </div>
                            ))}

                            {items.length === 0 && (
                                <Banner tone="info">
                                    Henüz bir mega menü öğesi eklenmemiş. "Yeni Ekle" butonunu kullanarak başlayın.
                                </Banner>
                            )}

                            <Button onClick={addItem} variant="primary" tone="success">
                                + Yeni Öğe Ekle
                            </Button>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
