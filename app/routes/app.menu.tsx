import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Button, Text, TextField, Banner, Box, InlineStack, Divider, Modal, Tooltip } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { useState, useCallback } from "react";
import { PlusIcon, DeleteIcon, SaveIcon, ImportIcon, SearchIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";

// --- LOADER ---
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Fetch Existing Menus
  // 1. Fetch Existing Menus
  let availableMenus = [];
  let debugInfo = {};
  try {
    const menusQuery = await admin.graphql(`
      query {
        menus(first: 20) {
          nodes {
            id
            title
            items {
              title
              url
              items {
                title
                url
                items {
                  title
                  url
                }
              }
            }
          }
        }
      }
    `);
    const menusJson = await menusQuery.json();
    console.log("DEBUG_MENUS_JSON:", JSON.stringify(menusJson, null, 2));
    availableMenus = menusJson.data?.menus?.nodes || [];
    // DEBUG: Capture info to show on frontend if needed
    debugInfo = {
      status: "success",
      data: menusJson,
      scopes: process.env.SCOPES
    };
  } catch (error) {
    console.error("Failed to fetch menus:", error);
    debugInfo = { status: "error", message: error.message, stack: error.stack };
  }

  // 2. Fetch Saved Custom Menu Metafield
  const metafieldQuery = await admin.graphql(
    `query {
      currentAppInstallation {
        metafield(namespace: "breadcrumb", key: "custom_menu") {
          value
        }
      }
    }`
  );

  const mfJson = await metafieldQuery.json();
  const metafieldValue = mfJson.data?.currentAppInstallation?.metafield?.value;

  let initialMenu = [];
  if (metafieldValue) {
    try {
      initialMenu = JSON.parse(metafieldValue);
    } catch (e) {
      console.error("Failed to parse menu JSON", e);
    }
  }

  return json({ initialMenu, availableMenus });
};

// --- ACTION ---
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const menuJson = formData.get("menuJson");

  const appQuery = await admin.graphql(`query { currentAppInstallation { id } }`);
  const appResult = await appQuery.json();
  const appId = appResult.data.currentAppInstallation.id;

  const response = await admin.graphql(
    `mutation CreateAppDataMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafieldsSetInput) {
        metafields {
          id
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafieldsSetInput: [
          {
            ownerId: appId,
            namespace: "breadcrumb",
            key: "custom_menu",
            type: "json",
            value: menuJson
          }
        ]
      }
    }
  );

  const responseJson = await response.json();

  if (responseJson.data?.metafieldsSet?.userErrors?.length > 0) {
    return json({ status: "error", errors: responseJson.data.metafieldsSet.userErrors });
  }

  return json({ status: "success" });
};

// --- HELPER: CONVERT SHOPIFY MENU TO CUSTOM STRUCTURE ---
// Recursive function to parse shopify menu items
const parseShopifyMenuItem = (item) => {
  let handle = "";
  if (item.url && item.url.includes('/collections/')) {
    handle = item.url.split('/collections/')[1].split('/')[0];
  }

  return {
    id: Date.now().toString() + Math.random().toString(),
    title: item.title,
    handle: handle,
    url: item.url,
    children: item.items ? item.items.map(parseShopifyMenuItem) : []
  };
};


// --- COMPONENT: RECURSIVE ITEM ---
function MenuItemRow({ item, onChange, onDelete, depth = 0, onOpenPicker }) {
  const handleChange = (field, value) => {
    onChange({ ...item, [field]: value });
  };

  const handleChildChange = (index, newChild) => {
    const newChildren = [...(item.children || [])];
    newChildren[index] = newChild;
    onChange({ ...item, children: newChildren });
  };

  const handleAddChild = () => {
    const newChildren = [...(item.children || []), { id: Date.now().toString(), title: "Yeni Alt Kategori", url: "", children: [] }];
    onChange({ ...item, children: newChildren });
  };

  const handleDeleteChild = (index) => {
    const newChildren = [...(item.children || [])];
    newChildren.splice(index, 1);
    onChange({ ...item, children: newChildren });
  };

  const borderColor = ["#008060", "#007ace", "#8c6cc2", "#e34589", "#d86b00", "#d1c208"][depth % 6];

  return (
    <Box paddingBlockStart={depth > 0 ? "200" : "400"}>
      <div style={{
        marginLeft: `${depth * 24}px`,
        borderLeft: `4px solid ${borderColor}`,
        paddingLeft: "12px",
        background: depth % 2 === 0 ? "#fafafa" : "#fff",
        padding: "10px",
        borderRadius: "0 8px 8px 0"
      }}>
        <BlockStack gap="200">
          <InlineStack gap="200" align="start" blockAlign="center">
            <div style={{ flexGrow: 1 }}>
              <TextField
                label="Kategori Adı"
                labelHidden
                value={item.title}
                onChange={(v) => handleChange("title", v)}
                placeholder="Kategori Adı"
                autoComplete="off"
              />
            </div>

            <div style={{ flexGrow: 1 }}>
              <InlineStack gap="200" wrap={false}>
                <div style={{ flexGrow: 1 }}>
                  <TextField
                    label="Koleksiyon"
                    labelHidden
                    value={item.handle}
                    onChange={(v) => {
                      let handle = v;
                      if (v.includes('/collections/')) {
                        handle = v.split('/collections/')[1].split('/')[0];
                      }
                      handleChange("handle", handle);
                      handleChange("url", `/collections/${handle}`);
                    }}
                    placeholder="Koleksiyon (Seçiniz ->)"
                    autoComplete="off"
                  />
                </div>
                <Tooltip content="Koleksiyon Seç">
                  <Button icon={SearchIcon} onClick={() => onOpenPicker(item)} />
                </Tooltip>
              </InlineStack>
            </div>

            <Button icon={DeleteIcon} tone="critical" onClick={onDelete} accessibilityLabel="Sil" />
          </InlineStack>

          <InlineStack align="start">
            <Button size="micro" onClick={handleAddChild} icon={PlusIcon} variant="tertiary">Alt Kategori Ekle (+)</Button>
          </InlineStack>

          {item.children && item.children.length > 0 && (
            <BlockStack gap="100">
              {item.children.map((child, index) => (
                <MenuItemRow
                  key={child.id}
                  item={child}
                  depth={depth + 1}
                  onChange={(newChild) => handleChildChange(index, newChild)}
                  onDelete={() => handleDeleteChild(index)}
                  onOpenPicker={onOpenPicker}
                />
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </div>
    </Box>
  );
}

// --- MAIN PAGE COMPONENT ---
export default function MenuPage() {
  const { initialMenu, availableMenus } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const shopify = useAppBridge(); // Use App Bridge Hook

  const [menuItems, setMenuItems] = useState(initialMenu || []);
  const [importModalActive, setImportModalActive] = useState(false);

  const isSaving = nav.state === "submitting";

  // --- HANDLERS ---
  const handleAddItem = () => {
    setMenuItems([...menuItems, { id: Date.now().toString(), title: "Yeni Ana Kategori", handle: "", url: "", children: [] }]);
  };

  const handleChangeItem = (index, newItem) => {
    const newItems = [...menuItems];
    newItems[index] = newItem;
    setMenuItems(newItems);
  };

  const updateItemHandle = (items, targetId, newTitle, newHandle) => {
    return items.map(item => {
      if (item.id === targetId) {
        return { ...item, title: newTitle || item.title, handle: newHandle, url: `/collections/${newHandle}` };
      }
      if (item.children) {
        return { ...item, children: updateItemHandle(item.children, targetId, newTitle, newHandle) };
      }
      return item;
    });
  };

  const handleOpenPicker = async (item) => {
    // Use imperative Resource Picker
    const selected = await shopify.resourcePicker({
      type: 'collection',
      multiple: false
    });

    if (selected) {
      const selectedCol = selected[0];
      const newItems = updateItemHandle(menuItems, item.id, selectedCol.title, selectedCol.handle);
      setMenuItems(newItems);
    }
  };

  const handleDeleteItem = (index) => {
    const newItems = [...menuItems];
    newItems.splice(index, 1);
    setMenuItems(newItems);
  };

  const handleSave = () => {
    const jsonStr = JSON.stringify(menuItems);
    submit({ menuJson: jsonStr }, { method: "post" });
  };

  const handleImportMenu = (shopifyMenu) => {
    const newStructure = shopifyMenu.items.map(parseShopifyMenuItem);
    setMenuItems([...menuItems, ...newStructure]);
    setImportModalActive(false);
  };

  return (
    <Page
      title="Özel Menü Oluşturucu"
      primaryAction={{ content: "Yapıyı Kaydet", onAction: handleSave, loading: isSaving, icon: SaveIcon }}
      secondaryActions={[
        { content: "Mevcut Menüden Aktar", icon: ImportIcon, onAction: () => setImportModalActive(true) }
      ]}
    >
      <Layout>
        <Layout.Section>
          {actionData?.status === 'success' && (
            <Box paddingBlockEnd="400">
              <Banner tone="success" onDismiss={() => { }}>Başarıyla kaydedildi! Sitenizi kontrol edebilirsiniz.</Banner>
            </Box>
          )}

          <Box paddingBlockEnd="400">
            <Banner tone="info">
              <p>Burada oluşturduğunuz yapı <strong>sınırsız derinliktedir</strong>. 6-7 seviyeye kadar alt alta kategori oluşturabilirsiniz.</p>
              <p>Koleksiyon seçmek için büyüteç ikonunu kullanın veya "Mevcut Menüden Aktar" ile başlayın.</p>
            </Banner>
          </Box>

          <Card>
            <BlockStack gap="400">
              {menuItems.length === 0 && (
                <Box padding="800" background="bg-subdued">
                  <BlockStack align="center" inlineAlign="center" gap="400">
                    <Text variant="headingMd" as="h3">Henüz bir yapı yok</Text>
                    <InlineStack gap="300">
                      <Button onClick={() => setImportModalActive(true)} icon={ImportIcon}>Shopify Menüsü İçe Aktar</Button>
                      <Button onClick={handleAddItem} variant="primary" icon={PlusIcon}>Yeni Ekle</Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              )}

              {menuItems.map((item, index) => (
                <div key={item.id}>
                  <MenuItemRow
                    item={item}
                    onChange={(newItem) => handleChangeItem(index, newItem)}
                    onDelete={() => handleDeleteItem(index)}
                    onOpenPicker={(itm) => handleOpenPicker(itm)}
                  />
                  <Box paddingBlock="400"><Divider /></Box>
                </div>
              ))}

              {menuItems.length > 0 && (
                <Button onClick={handleAddItem} variant="primary" fullWidth icon={PlusIcon}>Yeni Ana Kategori Ekle</Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* IMPORT MODAL */}
      <Modal
        open={importModalActive}
        onClose={() => setImportModalActive(false)}
        title="Shopify Menüsü İçe Aktar"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">Mevcut bir menünüzü seçin. İçindeki tüm bağlantılar otomatik olarak buraya aktarılacaktır.</Text>
            {availableMenus.length === 0 && (
              <Box padding="400" background="bg-surface-critical-subdued">
                <Text as="p" tone="critical">Hiç menü bulunamadı.</Text>
                <Box paddingBlockStart="200">
                  <Text as="p" variant="bodySm">Teknik Detay (Debug):</Text>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: "10px" }}>{JSON.stringify(useLoaderData().debugInfo, null, 2)}</pre>
                </Box>
              </Box>
            )}

            {availableMenus.map(menu => (
              <Box key={menu.id} padding="200" background="bg-surface-secondary" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" fontWeight="bold">{menu.title}</Text>
                  <Button onClick={() => handleImportMenu(menu)}>İçe Aktar</Button>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>

    </Page>
  );
}
