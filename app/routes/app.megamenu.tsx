import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Button, TextField, Select, Text, Banner, InlineStack, Box, Divider, Icon } from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PlusCircleIcon, DeleteIcon } from "@shopify/polaris-icons";

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

    // 4. Fetch Page-Menu Mappings
    const pageMappingQuery = await admin.graphql(
        `query {
            shop {
                metafield(namespace: "breadcrumb", key: "page_menu_map") {
                    value
                }
            }
        }`
    );
    const pageMappingJson = await pageMappingQuery.json();
    let initialPageMappings = [];
    try {
        const raw = pageMappingJson.data?.shop?.metafield?.value;
        if (raw) initialPageMappings = JSON.parse(raw);
    } catch (e) {
        console.error("Failed to parse page mappings", e);
    }

    return json({ menus, initialConfig, customMenuItems, initialPageMappings });
}

export async function action({ request }: { request: Request }) {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    const configString = formData.get("config") as string;
    const pageMappingsString = formData.get("pageMappings") as string;

    // 1. Save to Database
    await prisma.megaMenu.upsert({
        where: { shop: session.shop },
        update: { config: configString },
        create: {
            shop: session.shop,
            config: configString,
        },
    });

    // 2. Sync to Shop Metafields
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
                    },
                    {
                        ownerId: shopId,
                        namespace: "breadcrumb",
                        key: "page_menu_map",
                        type: "json",
                        value: pageMappingsString,
                    }
                ]
            }
        }
    );

    return json({ status: "success" });
}

export default function MegaMenuPage() {
    const { menus, initialConfig, customMenuItems, initialPageMappings } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const nav = useNavigation();
    const isSaving = nav.state === "submitting";

    const [items, setItems] = useState(Array.isArray(initialConfig) ? initialConfig : []);
    const [pageMappings, setPageMappings] = useState(Array.isArray(initialPageMappings) ? initialPageMappings : []);

    // --- Mega Menu Config Functions ---
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

    // --- Page Mapping Functions ---
    const addPageMapping = () => {
        setPageMappings([...pageMappings, { pageUrl: "", menuTitle: "" }]);
    };

    const removePageMapping = (index: number) => {
        const newMappings = [...pageMappings];
        newMappings.splice(index, 1);
        setPageMappings(newMappings);
    };

    const updatePageMapping = (index: number, key: string, value: string) => {
        const newMappings = [...pageMappings];
        newMappings[index] = { ...newMappings[index], [key]: value };
        setPageMappings(newMappings);
    };

    const handleSave = () => {
        const formData = new FormData();
        formData.append("config", JSON.stringify(items));
        formData.append("pageMappings", JSON.stringify(pageMappings));
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

    // Custom menu options for page mapping (only top-level items with children)
    const pageMenuOptions = [{ label: "Seçiniz...", value: "" }];
    if (customMenuItems && customMenuItems.length > 0) {
        customMenuItems.forEach((item: any) => {
            if (item.children && item.children.length > 0) {
                pageMenuOptions.push({
                    label: item.title,
                    value: item.title
                });
            }
        });
    }

    return (
        <Page
            title="Mega Menü Ayarları"
            subtitle="Sayfa-menü eşleştirmeleri ve mega menü içeriklerini yapılandırın."
            primaryAction={{
                content: isSaving ? "Kaydediliyor..." : "Kaydet",
                onAction: handleSave,
                loading: isSaving,
            }}
        >
            <Layout>
                {/* === SECTION 1: PAGE-MENU MAPPINGS === */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">
                                📍 Sayfa → Menü Eşleştirmeleri
                            </Text>
                            <Text as="p" variant="bodyMd" tone="subdued">
                                Her sayfa için hangi menünün gösterileceğini belirleyin.
                                Örneğin: <code>/pages/bisiklet</code> sayfasında <strong>Bisiklet Sporu</strong> menüsünün alt öğelerini göster.
                            </Text>

                            {pageMappings.map((mapping: any, index: number) => (
                                <div key={index} style={{
                                    padding: "16px",
                                    border: "1px solid #e1e3e5",
                                    borderRadius: "8px",
                                    background: "#fafbfb"
                                }}>
                                    <InlineStack gap="400" align="start" blockAlign="end">
                                        <Box width="45%">
                                            <TextField
                                                label="Sayfa URL'si"
                                                placeholder="/pages/bisiklet"
                                                helpText="Örn: /pages/bisiklet, /pages/kosu, /collections/spor"
                                                value={mapping.pageUrl}
                                                onChange={(val) => updatePageMapping(index, "pageUrl", val)}
                                                autoComplete="off"
                                            />
                                        </Box>
                                        <Box width="45%">
                                            <Select
                                                label="Gösterilecek Menü"
                                                options={pageMenuOptions}
                                                value={mapping.menuTitle}
                                                onChange={(val) => updatePageMapping(index, "menuTitle", val)}
                                                helpText="Bu sayfada hangi menünün alt öğeleri gösterilsin?"
                                            />
                                            {mapping.menuTitle && (() => {
                                                const foundItem = customMenuItems.find((c: any) => c.title === mapping.menuTitle);
                                                if (foundItem && foundItem.children && foundItem.children.length > 0) {
                                                    return (
                                                        <div style={{ marginTop: '8px', padding: '8px', background: '#e3f1df', borderRadius: '6px', fontSize: '12px' }}>
                                                            ✓ {foundItem.children.length} alt öğe gösterilecek: {foundItem.children.slice(0, 3).map((c: any) => c.title).join(", ")}{foundItem.children.length > 3 ? "..." : ""}
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}

                                            <div style={{ marginTop: "12px" }}>
                                                <TextField
                                                    label="Ekstra Menü Linkleri (Opsiyonel)"
                                                    placeholder="Koşu Ayakkabıları | /collections/kosu-ayakkabilari"
                                                    multiline={3}
                                                    value={mapping.extraLinks || ""}
                                                    onChange={(val) => updatePageMapping(index, "extraLinks", val)}
                                                    helpText="Her satıra bir link girin. Format: Başlık | URL"
                                                    autoComplete="off"
                                                />
                                            </div>
                                        </Box>
                                        <Button
                                            tone="critical"
                                            onClick={() => removePageMapping(index)}
                                            variant="plain"
                                            icon={DeleteIcon}
                                        />
                                    </InlineStack>
                                </div>
                            ))}

                            {pageMappings.length === 0 && (
                                <Banner tone="info">
                                    Henüz sayfa-menü eşleştirmesi yapılmamış. Aşağıdaki butonla eşleştirme ekleyin.
                                </Banner>
                            )}

                            <Button onClick={addPageMapping} variant="primary" tone="success" icon={PlusCircleIcon}>
                                Yeni Sayfa Eşleştirmesi Ekle
                            </Button>
                        </BlockStack>
                    </Card>
                </Layout.Section>

                <Layout.Section>
                    <Divider />
                </Layout.Section>

                {/* === SECTION 2: MEGA MENU TRIGGER CONFIG === */}
                <Layout.Section>
                    <Card>
                        <BlockStack gap="500">
                            <Text as="h2" variant="headingMd">
                                🎨 Mega Menü Görsel Ayarları
                            </Text>
                            <Text as="p" variant="bodyMd" tone="subdued">
                                Üst menü öğelerinin üzerine gelindiğinde açılacak alt menü ve sol görsel ayarlarını yapın.
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
