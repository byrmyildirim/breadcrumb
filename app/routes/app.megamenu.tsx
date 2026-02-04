import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Button, TextField, Select, Text, Banner, InlineStack, Box, Divider, Icon, Tag, Listbox, Combobox, Checkbox, RangeSlider, Tabs, ResourceList, ResourceItem, Avatar, Thumbnail, EmptyState } from "@shopify/polaris";
import { useState, useCallback, useMemo } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PlusCircleIcon, DeleteIcon, MobileIcon, LayoutIcon, ImageIcon, CheckIcon } from "@shopify/polaris-icons";

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

    // 5. Fetch Extra Menu Items
    const extraMenuQuery = await admin.graphql(
        `query {
            shop {
                metafield(namespace: "breadcrumb", key: "extra_menu_items") {
                    value
                }
            }
        }`
    );
    const extraMenuJson = await extraMenuQuery.json();
    let initialExtraMenuItems = [];
    try {
        const raw = extraMenuJson.data?.shop?.metafield?.value;
        if (raw) initialExtraMenuItems = JSON.parse(raw);
    } catch (e) {
        console.error("Failed to parse extra menu items", e);
    }

    // 6. Fetch Mobile Menu Groups (NEW)
    const mobileGroupsQuery = await admin.graphql(
        `query {
            shop {
                metafield(namespace: "breadcrumb", key: "mobile_menu_groups") {
                    value
                }
            }
        }`
    );
    const mobileGroupsJson = await mobileGroupsQuery.json();
    let initialMobileGroups = [];
    try {
        const raw = mobileGroupsJson.data?.shop?.metafield?.value;
        if (raw) initialMobileGroups = JSON.parse(raw);
    } catch (e) {
        console.error("Failed to parse mobile menu groups", e);
    }

    // 7. Fetch General Settings (NEW - Hide Desktop)
    const mobileSettingsQuery = await admin.graphql(
        `query {
            shop {
                metafield(namespace: "breadcrumb", key: "mobile_menu_settings") {
                     value
                }
            }
        }`
    );
    const mobileSettingsJson = await mobileSettingsQuery.json();
    let initialMobileSettings = { hideDesktop: false };
    try {
        const raw = mobileSettingsJson.data?.shop?.metafield?.value;
        if (raw) initialMobileSettings = JSON.parse(raw);
    } catch (e) {
        console.error("Failed to parse mobile menu settings", e);
    }

    // 8. Fetch Theme Settings (NEW - Global Design)
    const themeSettingsQuery = await admin.graphql(
        `query {
            shop {
                metafield(namespace: "breadcrumb", key: "mega_menu_theme_settings") {
                     value
                }
            }
        }`
    );
    const themeSettingsJson = await themeSettingsQuery.json();
    let initialThemeSettings = {
        heightMode: "default", // default, auto, fixed
        fixedHeight: 400,
        hideDesktop: false,
        showGrandchild: false,
        expandSubmenus: true,
        maxVisibleItems: 5,
        menuStyle: "style-default",
        displayMode: "push"
    };
    try {
        const raw = themeSettingsJson.data?.shop?.metafield?.value;
        if (raw) {
            const parsed = JSON.parse(raw);
            initialThemeSettings = { ...initialThemeSettings, ...parsed };
        }
    } catch (e) {
        console.error("Failed to parse theme settings", e);
    }


    return json({ menus, initialConfig, customMenuItems, initialPageMappings, initialExtraMenuItems, initialMobileGroups, initialMobileSettings, initialThemeSettings });
}

export async function action({ request }: { request: Request }) {
    const { admin, session } = await authenticate.admin(request);
    const formData = await request.formData();

    const configString = formData.get("config") as string;
    const pageMappingsString = formData.get("pageMappings") as string;
    const extraMenuItemsString = formData.get("extraMenuItems") as string;
    const mobileGroupsString = formData.get("mobileGroups") as string;
    const mobileSettingsString = formData.get("mobileSettings") as string;
    const themeSettingsString = formData.get("themeSettings") as string;

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
                    },
                    {
                        ownerId: shopId,
                        namespace: "breadcrumb",
                        key: "extra_menu_items",
                        type: "json",
                        value: extraMenuItemsString,
                    },
                    {
                        ownerId: shopId,
                        namespace: "breadcrumb",
                        key: "mobile_menu_groups",
                        type: "json",
                        value: mobileGroupsString,
                    },
                    {
                        ownerId: shopId,
                        namespace: "breadcrumb",
                        key: "mobile_menu_settings",
                        type: "json",
                        value: mobileSettingsString,
                    },
                    {
                        ownerId: shopId,
                        namespace: "breadcrumb",
                        key: "mega_menu_theme_settings",
                        type: "json",
                        value: themeSettingsString,
                    }
                ]
            }
        }
    );

    return json({ status: "success" });
}

export default function MegaMenuPage() {
    const { menus, initialConfig, customMenuItems, initialPageMappings, initialExtraMenuItems, initialMobileGroups, initialMobileSettings, initialThemeSettings } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const nav = useNavigation();
    const isSaving = nav.state === "submitting";

    const [items, setItems] = useState(Array.isArray(initialConfig) ? initialConfig : []);
    const [pageMappings, setPageMappings] = useState(Array.isArray(initialPageMappings) ? initialPageMappings : []);
    const [extraMenuItems, setExtraMenuItems] = useState(Array.isArray(initialExtraMenuItems) ? initialExtraMenuItems : []);
    const [mobileGroups, setMobileGroups] = useState(Array.isArray(initialMobileGroups) ? initialMobileGroups : []);
    const [mobileSettings, setMobileSettings] = useState(initialMobileSettings || { hideDesktop: false });
    const [themeSettings, setThemeSettings] = useState(initialThemeSettings || {
        heightMode: "default",
        fixedHeight: 400,
        hideDesktop: false,
        showGrandchild: false,
        expandSubmenus: true,
        maxVisibleItems: 5,
        menuStyle: "style-default",
        displayMode: "push"
    });

    const [selectedTab, setSelectedTab] = useState(0);

    const handleTabChange = useCallback(
        (selectedTabIndex: number) => setSelectedTab(selectedTabIndex),
        [],
    );

    const tabs = [
        {
            id: 'general-design',
            content: 'Genel & Tasarım',
            accessibilityLabel: 'Genel ve Tasarım Ayarları',
            panelID: 'general-design-content',
            icon: LayoutIcon
        },
        {
            id: 'content-mappings',
            content: 'İçerik Yönetimi',
            panelID: 'content-mappings-content',
            icon: HelperIcon
        },
        {
            id: 'menu-visuals',
            content: 'Menü Görselleri',
            panelID: 'menu-visuals-content',
            icon: ImageIcon
        },
        {
            id: 'mobile-menu',
            content: 'Mobil Menü',
            panelID: 'mobile-menu-content',
            icon: MobileIcon
        },
    ];

    // --- Mega Menu Config Functions (Visuals) ---
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

    // --- Extra Menu Items Functions ---
    const addExtraMenuItem = () => {
        setExtraMenuItems([...extraMenuItems, { menuTitle: "", displayMode: "children" }]);
    };

    const removeExtraMenuItem = (index: number) => {
        const newItems = [...extraMenuItems];
        newItems.splice(index, 1);
        setExtraMenuItems(newItems);
    };

    const updateExtraMenuItem = (index: number, key: string, value: string) => {
        const newItems = [...extraMenuItems];
        newItems[index] = { ...newItems[index], [key]: value };
        setExtraMenuItems(newItems);
    };

    // --- Mobile Groups Functions ---
    const addMobileGroup = () => {
        setMobileGroups([...mobileGroups, { groupTitle: " Akış", groupLink: "/", childrenMenus: [] }]);
    };

    const removeMobileGroup = (index: number) => {
        const newGroups = [...mobileGroups];
        newGroups.splice(index, 1);
        setMobileGroups(newGroups);
    };

    const updateMobileGroup = (index: number, key: string, value: any) => {
        const newGroups = [...mobileGroups];
        newGroups[index] = { ...newGroups[index], [key]: value };
        setMobileGroups(newGroups);
    };

    const toggleGroupChild = (groupIndex: number, menuTitle: string) => {
        const newGroups = [...mobileGroups];
        const currentChildren = newGroups[groupIndex].childrenMenus || [];
        if (currentChildren.includes(menuTitle)) {
            newGroups[groupIndex].childrenMenus = currentChildren.filter((t: string) => t !== menuTitle);
        } else {
            newGroups[groupIndex].childrenMenus = [...currentChildren, menuTitle];
        }
        setMobileGroups(newGroups);
    }


    const handleSave = () => {
        const formData = new FormData();
        formData.append("config", JSON.stringify(items));
        formData.append("pageMappings", JSON.stringify(pageMappings));
        formData.append("extraMenuItems", JSON.stringify(extraMenuItems));
        formData.append("mobileGroups", JSON.stringify(mobileGroups));
        formData.append("mobileSettings", JSON.stringify(mobileSettings));
        formData.append("themeSettings", JSON.stringify(themeSettings));
        submit(formData, { method: "post" });
    };

    // Global Options
    const menuOptions = (menus || []).map((m: any) => ({
        label: `Shopify: ${m.title}`,
        value: m.handle,
    }));
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

    const pageMenuOptions = [{ label: "Seçiniz...", value: "" }];
    if (customMenuItems && customMenuItems.length > 0) {
        customMenuItems.forEach((item: any) => {
            pageMenuOptions.push({
                label: item.title,
                value: item.title
            });
        });
    }

    const availableMobileOptions = customMenuItems.map((item: any) => ({ label: item.title, value: item.title }));

    // --- RENDER SECTIONS ---

    const renderGeneralDesign = () => (
        <BlockStack gap="500">
            <Card>
                <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">🎨 Tema ve Görünüm Ayarları</Text>
                    <Text as="p" tone="subdued">Mega menünün genel stilini, yüksekliğini ve açılma davranışını buradan yönetebilirsiniz.</Text>
                    <Divider />

                    <InlineStack gap="400" align="start">
                        <Box width="48%">
                            <BlockStack gap="400">
                                <Text as="h3" variant="headingSm">Yükseklik & Davranış</Text>
                                <Select
                                    label="Menü Yüksekliği"
                                    options={[
                                        { label: "Varsayılan", value: "default" },
                                        { label: "İçeriğe Göre (Otomatik)", value: "auto" },
                                        { label: "Sabit Yükseklik", value: "fixed" }
                                    ]}
                                    value={themeSettings.heightMode}
                                    onChange={(val) => setThemeSettings({ ...themeSettings, heightMode: val })}
                                />
                                {themeSettings.heightMode === 'fixed' && (
                                    <TextField
                                        label="Piksel Değeri"
                                        type="number"
                                        value={String(themeSettings.fixedHeight)}
                                        onChange={(val) => setThemeSettings({ ...themeSettings, fixedHeight: parseInt(val) || 400 })}
                                        suffix="px"
                                        autoComplete="off"
                                    />
                                )}
                                <Select
                                    label="Açılma Davranışı"
                                    options={[
                                        { label: "İçeriği Aşağı İt (Push)", value: "push" },
                                        { label: "Üstüne Bin (Overlay)", value: "overlay" }
                                    ]}
                                    value={themeSettings.displayMode || "push"}
                                    onChange={(val) => setThemeSettings({ ...themeSettings, displayMode: val })}
                                    helpText="Overlay modu menüyü sayfanın üzerinde açar, push modu içeriği aşağı iter."
                                />
                            </BlockStack>
                        </Box>
                        <Box width="48%">
                            <BlockStack gap="400">
                                <Text as="h3" variant="headingSm">Stil & Görsel</Text>
                                <Select
                                    label="Tasarım Stili"
                                    options={[
                                        { value: "style-default", label: "Varsayılan" },
                                        { value: "style-modern", label: "Modern (Yuvarlak)" },
                                        { value: "style-minimal", label: "Minimal (Sade)" },
                                        { value: "style-bold", label: "Bold (Kalın)" },
                                        { value: "style-compact", label: "Kompakt (Sıkışık)" },
                                        { value: "style-grid-line", label: "Grid Çizgili" }
                                    ]}
                                    value={themeSettings.menuStyle}
                                    onChange={(val) => setThemeSettings({ ...themeSettings, menuStyle: val })}
                                />
                                <TextField
                                    label="Maksimum Alt Menü Sayısı"
                                    type="number"
                                    value={String(themeSettings.maxVisibleItems)}
                                    onChange={(val) => setThemeSettings({ ...themeSettings, maxVisibleItems: parseInt(val) || 5 })}
                                    helpText="Bu sayıdan sonrası için 'Devamını Gör' açılır."
                                    autoComplete="off"
                                />
                            </BlockStack>
                        </Box>
                    </InlineStack>

                    <Divider />
                    <Text as="h3" variant="headingSm">Gelişmiş Seçenekler</Text>
                    <InlineStack gap="800">
                        <Checkbox
                            label="Masaüstünde Gizle"
                            checked={themeSettings.hideDesktop}
                            onChange={(v) => setThemeSettings({ ...themeSettings, hideDesktop: v })}
                        />
                        <Checkbox
                            label="Torun Menüleri Göster (3. Seviye)"
                            checked={themeSettings.showGrandchild}
                            onChange={(v) => setThemeSettings({ ...themeSettings, showGrandchild: v })}
                        />
                        <Checkbox
                            label="Alt Menüleri Açık Getir"
                            checked={themeSettings.expandSubmenus}
                            onChange={(v) => setThemeSettings({ ...themeSettings, expandSubmenus: v })}
                        />
                    </InlineStack>
                </BlockStack>
            </Card>
        </BlockStack>
                    <ResourceList
                        resourceName={{ singular: 'eşleştirme', plural: 'eşleştirmeler' }}
                        items={pageMappings}
                        emptyState={
                            <EmptyState
                                heading="Henüz eşleştirme yok"
                                action={{ content: 'Eşleştirme Ekle', onAction: addPageMapping }}
                                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                            >
                                <p>Sayfalarınızı menülerle eşleştirerek gezintiyi kolaylaştırın.</p>
                            </EmptyState>
                        }
                        renderItem={(item: any, id, index) => {
                            return (
                                <ResourceItem
                                    id={String(index)}
                                    accessibilityLabel={`Mapping ${index}`}
                                    persistActions
                                >
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Box width="45%">
                                            <TextField
                                                label="Sayfa URL"
                                                labelHidden
                                                placeholder="/pages/ornek"
                                                value={item.pageUrl}
                                                onChange={(v) => updatePageMapping(index, "pageUrl", v)}
                                                autoComplete="off"
                                            />
                                        </Box>
                                        <Box width="45%">
                                            <Select
                                                label="Menü"
                                                labelHidden
                                                options={pageMenuOptions}
                                                value={item.menuTitle}
                                                onChange={(v) => updatePageMapping(index, "menuTitle", v)}
                                                placeholder="Menü Seçin"
                                            />
                                        </Box>
                                        <Button icon={DeleteIcon} tone="critical" variant="plain" onClick={() => removePageMapping(index)} />
                                    </InlineStack>
                                </ResourceItem>
                            );
                        }}
                    />
                </BlockStack >
            </Card >

        <Card>
            <BlockStack gap="400">
                <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">➕ Ekstra Menü Öğeleri</Text>
                    <Button tone="success" variant="primary" onClick={addExtraMenuItem} icon={PlusCircleIcon}>Öğe Ekle</Button>
                </InlineStack>
                <Text as="p" tone="subdued">Ana menüye eklemek istediğiniz özel öğeler.</Text>

                <ResourceList
                    resourceName={{ singular: 'öğe', plural: 'öğeler' }}
                    items={extraMenuItems}
                    emptyState={
                        <EmptyState
                            heading="Ekstra öğe yok"
                            action={{ content: 'Öğe Ekle', onAction: addExtraMenuItem }}
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                        >
                            <p>Buradan menünüze manuel öğeler ekleyebilirsiniz.</p>
                        </EmptyState>
                    }
                    renderItem={(item: any, id, index) => {
                        return (
                            <ResourceItem id={String(index)} accessibilityLabel={`Extra Item ${index}`}>
                                <InlineStack align="space-between" blockAlign="center">
                                    <Box width="40%">
                                        <Select
                                            label="Menü"
                                            labelHidden
                                            options={pageMenuOptions}
                                            value={item.menuTitle}
                                            onChange={(v) => updateExtraMenuItem(index, "menuTitle", v)}
                                        />
                                    </Box>
                                    <Box width="40%">
                                        <Select
                                            label="Mod"
                                            labelHidden
                                            options={[
                                                { label: "Alt Menüleri Göster", value: "children" },
                                                { label: "Sadece Başlık", value: "parent" }
                                            ]}
                                            value={item.displayMode}
                                            onChange={(v) => updateExtraMenuItem(index, "displayMode", v)}
                                        />
                                    </Box>
                                    <Button icon={DeleteIcon} tone="critical" variant="plain" onClick={() => removeExtraMenuItem(index)} />
                                </InlineStack>
                            </ResourceItem>
                        )
                    }}
                />
            </BlockStack>
        </Card>
        </BlockStack >
    );

    const renderMenuVisuals = () => (
        <Card>
            <BlockStack gap="400">
                <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">🖼️ Menü Görselleri</Text>
                    <Button tone="success" variant="primary" onClick={addItem} icon={PlusCircleIcon}>Görsel Ayarı Ekle</Button>
                </InlineStack>
                <Text as="p" tone="subdued">Belirli bir menü başlığının üzerine gelindiğinde sol tarafta veya menü içinde çıkacak görselleri ayarlayın.</Text>

                <ResourceList
                    resourceName={{ singular: 'görsel', plural: 'görseller' }}
                    items={items}
                    emptyState={
                        <EmptyState
                            heading="Görsel ayarı yok"
                            action={{ content: 'Ekle', onAction: addItem }}
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                        >
                            <p>Menülerinizi görsellerle zenginleştirin.</p>
                        </EmptyState>
                    }
                    renderItem={(item: any, id, index) => {
                        return (
                            <ResourceItem id={String(index)} accessibilityLabel={`Visual ${index}`}>
                                <BlockStack gap="300">
                                    <InlineStack gap="400" align="start">
                                        <Box width="30%">
                                            <Select
                                                label="Hangi Başlık İçin?"
                                                options={pageMenuOptions}
                                                value={item.triggerTitle}
                                                onChange={(v) => updateItem(index, "triggerTitle", v)}
                                                placeholder="Başlık Seçin"
                                            />
                                        </Box>
                                        <Box width="60%">
                                            <TextField
                                                label="Görsel URL"
                                                value={item.imageUrl}
                                                onChange={(v) => updateItem(index, "imageUrl", v)}
                                                autoComplete="off"
                                                prefix={<Icon source={ImageIcon} />}
                                            />
                                        </Box>
                                        <Box>
                                            <div style={{ marginTop: '28px' }}>
                                                <Button icon={DeleteIcon} tone="critical" onClick={() => removeItem(index)} />
                                            </div>
                                        </Box>
                                    </InlineStack>
                                    {item.imageUrl && (
                                        <Thumbnail
                                            source={item.imageUrl}
                                            alt={item.triggerTitle}
                                            size="large"
                                        />
                                    )}
                                </BlockStack>
                            </ResourceItem>
                        )
                    }}
                />
            </BlockStack>
        </Card>
    );

    const renderMobileMenu = () => (
        <Card>
            <BlockStack gap="400">
                <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">📱 Mobil Menü Akışları</Text>
                    <Button tone="success" variant="primary" onClick={addMobileGroup} icon={PlusCircleIcon}>Grup Ekle</Button>
                </InlineStack>
                <Text as="p" tone="subdued">Mobilde menüleri gruplayarak daha temiz bir görünüm elde edin (Örn: 'Akış' altında toplama).</Text>

                <ResourceList
                    resourceName={{ singular: 'grup', plural: 'gruplar' }}
                    items={mobileGroups}
                    emptyState={
                        <EmptyState
                            heading="Mobil grup yok"
                            action={{ content: 'Grup Ekle', onAction: addMobileGroup }}
                            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                        >
                            <p>Mobil menüyü düzenlemek için gruplar oluşturun.</p>
                        </EmptyState>
                    }
                    renderItem={(group: any, id, index) => {
                        return (
                            <ResourceItem id={String(index)} accessibilityLabel={`Group ${index}`}>
                                <BlockStack gap="400">
                                    <InlineStack align="space-between">
                                        <Text variant="headingSm" as="h3">Grup #{index + 1}</Text>
                                        <Button icon={DeleteIcon} tone="critical" variant="plain" onClick={() => removeMobileGroup(index)} />
                                    </InlineStack>

                                    <InlineStack gap="400">
                                        <Box width="45%">
                                            <TextField
                                                label="Grup Başlığı"
                                                value={group.groupTitle}
                                                onChange={(v) => updateMobileGroup(index, "groupTitle", v)}
                                                autoComplete="off"
                                            />
                                        </Box>
                                        <Box width="45%">
                                            <TextField
                                                label="Grup Linki"
                                                value={group.groupLink}
                                                onChange={(v) => updateMobileGroup(index, "groupLink", v)}
                                                autoComplete="off"
                                            />
                                        </Box>
                                    </InlineStack>

                                    <Box>
                                        <Text as="p" fontWeight="bold">Dahil Edilecek Menüler:</Text>
                                        <InlineStack gap="200" wrap>
                                            {availableMobileOptions.map((opt: any) => {
                                                const isSelected = (group.childrenMenus || []).includes(opt.value);
                                                return (
                                                    <div
                                                        key={opt.value}
                                                        onClick={() => toggleGroupChild(index, opt.value)}
                                                        style={{
                                                            padding: '6px 12px',
                                                            borderRadius: '16px',
                                                            border: isSelected ? '1px solid #005bd3' : '1px solid #d1d5db',
                                                            background: isSelected ? '#f1f8ff' : '#fff',
                                                            color: isSelected ? '#005bd3' : '#374151',
                                                            cursor: 'pointer',
                                                            fontSize: '13px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px'
                                                        }}
                                                    >
                                                        {opt.label} {isSelected && <Icon source={CheckIcon} tone="primary" />}
                                                    </div>
                                                )
                                            })}
                                        </InlineStack>
                                    </Box>
                                </BlockStack>
                            </ResourceItem>
                        )
                    }}
                />
            </BlockStack>
        </Card>
    );

    return (
        <Page
            title="Mega Menü Yönetimi"
            subtitle="Mağazanızın menü yapısını profesyonelce yönetin."
            primaryAction={{
                content: isSaving ? "Kaydediliyor..." : "Kaydet",
                onAction: handleSave,
                loading: isSaving,
            }}
            fullWidth
        >
            <BlockStack gap="500">
                <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
                    <Box padding="400">
                        {selectedTab === 0 && renderGeneralDesign()}
                        {selectedTab === 1 && renderContentMappings()}
                        {selectedTab === 2 && renderMenuVisuals()}
                        {selectedTab === 3 && renderMobileMenu()}
                    </Box>
                </Tabs>
            </BlockStack>
        </Page>
    );
}
<BlockStack gap="400">
    <InlineStack align="space-between">
}
