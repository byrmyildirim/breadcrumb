import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Button, Text, TextField, Banner, Box, InlineStack, Divider, Modal, Listbox, Combobox, Icon, EmptyState, Tag } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { useState, useMemo, useCallback } from "react";
import { PlusIcon, DeleteIcon, SaveIcon, SearchIcon, AlertCircleIcon } from "@shopify/polaris-icons";

// --- TYPES ---
type BrandGroup = {
    id: string; // unique ID
    title: string;
    vendors: string[]; // List of vendor names
};

// --- LOADER ---
export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    // 1. Fetch All Vendors (using productVendors query)
    // Note: 'productVendors' returns a list of strings
    const vendorsQuery = await admin.graphql(`
    query {
      shop {
        productVendors(first: 250) {
          edges {
            node
          }
        }
      }
    }
  `);
    const vendorsJson = await vendorsQuery.json();
    const allVendors = vendorsJson.data?.shop?.productVendors?.edges?.map((e: any) => e.node) || [];

    // 2. Fetch Existing Brand Groups Metafield
    const metafieldQuery = await admin.graphql(
        `query {
      shop {
        metafield(namespace: "breadcrumb", key: "brand_groups") {
          value
        }
      }
    }`
    );
    const mfJson = await metafieldQuery.json();
    const rawValue = mfJson.data?.shop?.metafield?.value;

    let brandGroups: BrandGroup[] = [];
    if (rawValue) {
        try {
            brandGroups = JSON.parse(rawValue);
        } catch (e) {
            console.error("Failed to parse brand_groups", e);
        }
    }

    return json({ allVendors, brandGroups });
};

// --- ACTION ---
export const action = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const brandGroupsJson = formData.get("brandGroups");

    if (typeof brandGroupsJson !== "string") {
        return json({ status: "error", message: "Invalid data" });
    }

    // Save to Metafield
    const response = await admin.graphql(
        `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          key
          namespace
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
                metafields: [
                    {
                        namespace: "breadcrumb",
                        key: "brand_groups",
                        type: "json",
                        value: brandGroupsJson,
                        ownerId: (await admin.graphql(`query { shop { id } }`).then(r => r.json())).data.shop.id
                    }
                ]
            },
        }
    );

    const responseJson = await response.json();
    if (responseJson.data?.metafieldsSet?.userErrors?.length > 0) {
        return json({ status: "error", errors: responseJson.data.metafieldsSet.userErrors });
    }

    return json({ status: "success" });
};

// --- COMPONENT ---
export default function BrandGroups() {
    const { allVendors, brandGroups: initialGroups } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const isSaving = navigation.state === "submitting";

    const [groups, setGroups] = useState<BrandGroup[]>(initialGroups);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);

    // New Group Modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newGroupTitle, setNewGroupTitle] = useState("");

    // Vendor Selector State
    const [vendorSearch, setVendorSearch] = useState("");

    const selectedGroup = useMemo(() => groups.find(g => g.id === selectedGroupId), [groups, selectedGroupId]);

    // --- HANDLERS ---

    const handleAddGroup = () => {
        if (!newGroupTitle.trim()) return;
        const newGroup: BrandGroup = {
            id: Date.now().toString(),
            title: newGroupTitle,
            vendors: []
        };
        setGroups([...groups, newGroup]);
        setSelectedGroupId(newGroup.id);
        setHasChanges(true);
        setNewGroupTitle("");
        setIsModalOpen(false);
    };

    const handleDeleteGroup = (id: string) => {
        if (confirm("Bu grubu silmek istediğinize emin misiniz?")) {
            setGroups(groups.filter(g => g.id !== id));
            if (selectedGroupId === id) setSelectedGroupId(null);
            setHasChanges(true);
        }
    };

    const handleUpdateTitle = (newTitle: string) => {
        if (!selectedGroupId) return;
        setGroups(groups.map(g => g.id === selectedGroupId ? { ...g, title: newTitle } : g));
        setHasChanges(true);
    };

    const handleToggleVendor = (vendor: string) => {
        if (!selectedGroupId) return;

        setGroups(prevGroups => {
            return prevGroups.map(group => {
                if (group.id === selectedGroupId) {
                    const exists = group.vendors.includes(vendor);
                    const newVendors = exists
                        ? group.vendors.filter(v => v !== vendor)
                        : [...group.vendors, vendor];
                    return { ...group, vendors: newVendors };
                }
                return group;
            });
        });
        setHasChanges(true);
    };

    const handleSave = () => {
        const formData = new FormData();
        formData.append("brandGroups", JSON.stringify(groups));
        submit(formData, { method: "post" });
        setHasChanges(false);
    };

    // Vendor Filter Logic
    const filteredVendors = useMemo(() => {
        if (!vendorSearch) return allVendors;
        return allVendors.filter(v => v.toLowerCase().includes(vendorSearch.toLowerCase()));
    }, [allVendors, vendorSearch]);

    return (
        <Page
            title="Marka Grupları"
            subtitle="Slider uygulamasında göstermek için marka grupları oluşturun."
            primaryAction={
                <Button variant="primary" onClick={handleSave} disabled={!hasChanges} loading={isSaving}>
                    Kaydet
                </Button>
            }
        >
            <Layout>
                {/* LEFT COLUMN: GROUP LIST */}
                <Layout.Section variant="oneThird">
                    <Card padding="0">
                        <Box padding="400" borderBlockEndWidth="016" borderColor="border">
                            <InlineStack align="space-between" blockAlign="center">
                                <Text as="h2" variant="headingMd">Gruplar</Text>
                                <Button icon={PlusIcon} onClick={() => setIsModalOpen(true)} variant="plain" />
                            </InlineStack>
                        </Box>
                        {groups.length === 0 ? (
                            <Box padding="400">
                                <Text as="p" tone="subdued">Henüz grup yok.</Text>
                            </Box>
                        ) : (
                            groups.map(group => (
                                <Box
                                    key={group.id}
                                    padding="300"
                                    background={selectedGroupId === group.id ? "bg-surface-active" : "bg-surface"}
                                    borderBlockEndWidth="016"
                                    borderColor="border"
                                >
                                    <div
                                        onClick={() => setSelectedGroupId(group.id)}
                                        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                    >
                                        <div>
                                            <Text as="p" fontWeight={selectedGroupId === group.id ? "bold" : "regular"}>{group.title}</Text>
                                            <Text as="p" variant="bodySm" tone="subdued">{group.vendors.length} Marka</Text>
                                        </div>
                                        {selectedGroupId === group.id && (
                                            <Button
                                                icon={DeleteIcon}
                                                variant="plain"
                                                tone="critical"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteGroup(group.id);
                                                }}
                                            />
                                        )}
                                    </div>
                                </Box>
                            ))
                        )}
                    </Card>
                </Layout.Section>

                {/* RIGHT COLUMN: EDITOR */}
                <Layout.Section>
                    {selectedGroup ? (
                        <Card>
                            <BlockStack gap="500">
                                <Text as="h2" variant="headingLg">{selectedGroup.title} Düzenle</Text>

                                <TextField
                                    label="Grup Adı"
                                    value={selectedGroup.title}
                                    onChange={handleUpdateTitle}
                                    autoComplete="off"
                                />

                                <Divider />

                                <BlockStack gap="200">
                                    <Text as="h3" variant="headingSm">Bu Gruba Dahil Markalar</Text>
                                    <TextField
                                        label="Marka Ara"
                                        value={vendorSearch}
                                        onChange={setVendorSearch}
                                        prefix={<Icon source={SearchIcon} />}
                                        autoComplete="off"
                                        placeholder="Tedarikçi adı yazın..."
                                    />

                                    <Box
                                        padding="400"
                                        background="bg-surface-secondary"
                                        borderRadius="200"
                                        maxHeight="400px"
                                        overflowY="scroll"
                                    >
                                        {filteredVendors.length === 0 && (
                                            <Text as="p" tone="subdued" alignment="center">Sonuç bulunamadı.</Text>
                                        )}
                                        <InlineStack gap="200">
                                            {filteredVendors.map(vendor => {
                                                const isSelected = selectedGroup.vendors.includes(vendor);
                                                return (
                                                    <div
                                                        key={vendor}
                                                        onClick={() => handleToggleVendor(vendor)}
                                                        style={{ cursor: 'pointer' }}
                                                    >
                                                        <Tag onClick={() => handleToggleVendor(vendor)}>
                                                            {isSelected ? (
                                                                <span style={{ fontWeight: 'bold', color: '#005fcc' }}>✓ {vendor}</span>
                                                            ) : (
                                                                <span style={{ color: '#666' }}>+ {vendor}</span>
                                                            )}
                                                        </Tag>
                                                    </div>
                                                );
                                            })}
                                        </InlineStack>
                                    </Box>

                                    <Box paddingBlockStart="200">
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            Seçilenler: {selectedGroup.vendors.join(", ")}
                                        </Text>
                                    </Box>
                                </BlockStack>

                            </BlockStack>
                        </Card>
                    ) : (
                        <Card>
                            <EmptyState
                                heading="Bir grup seçin veya oluşturun"
                                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                            >
                                <p>Markaları yönetmek için soldan bir grup seçin.</p>
                            </EmptyState>
                        </Card>
                    )}
                </Layout.Section>
            </Layout>

            {/* CREATE MODAL */}
            <Modal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Yeni Marka Grubu"
                primaryAction={{
                    content: 'Oluştur',
                    onAction: handleAddGroup,
                }}
                secondaryActions={[
                    {
                        content: 'İptal',
                        onAction: () => setIsModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <TextField
                        label="Grup Adı"
                        value={newGroupTitle}
                        onChange={setNewGroupTitle}
                        autoComplete="off"
                        placeholder="Örn: Bisiklet Markaları"
                    />
                </Modal.Section>
            </Modal>

            {/* CHANGES BANNER */}
            {hasChanges && (
                <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 999 }}>
                    <Banner title="Kaydedilmemiş değişiklikler var" tone="warning">
                        <Button onClick={handleSave} loading={isSaving}>Değişiklikleri Kaydet</Button>
                    </Banner>
                </div>
            )}
        </Page>
    );
}
