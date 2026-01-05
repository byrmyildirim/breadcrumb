import { useState, useEffect, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
    Page,
    Card,
    BlockStack,
    Text,
    Button,
    Box,
    InlineStack,
    Icon,
    Banner,
    TextField,
    Modal,
    ButtonGroup,
} from "@shopify/polaris";
import { DragHandleIcon, EditIcon, DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

interface FilterItem {
    id: string;
    label: string;
    param_name: string;
    enabled: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    try {
        // 1. Metafield Definition Kontrolü (Storefront Access için)
        // Eğer tanım yoksa oluşturulmalı, ama loader side-effect yapmamalı.
        // Action'da halledeceğiz.

        // 2. Mevcut ayarı çek
        const response = await admin.graphql(
            `#graphql
        query getFilterOrder {
          shop {
            id
            metafield(namespace: "filter_panel", key: "filter_order") {
              value
            }
          }
        }`
        );

        const data = await response.json();
        const shopId = data.data?.shop?.id;
        const savedOrder = data.data?.shop?.metafield?.value;

        let filterOrder: FilterItem[] = [];
        if (savedOrder) {
            try {
                filterOrder = JSON.parse(savedOrder);
            } catch {
                filterOrder = [];
            }
        }

        return json({ filterOrder, shopId });
    } catch (error) {
        console.error("Loader error:", error);
        return json({ filterOrder: [], shopId: "" });
    }
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const intent = formData.get("intent");

    if (intent === "save_order") {
        const shopId = formData.get("shopId") as string;
        const filterOrder = formData.get("filterOrder") as string;

        // 1. Metafield Definition Oluştur/Güncelle (Storefront Access Ver)
        // Bu işlem her kayıtta yapılabilir veya check edilebilir.
        // Güvenlik ve garanti için definition create mutation'ı deneyelim.
        // Hata verirse (zaten varsa) update deneriz veya yoksayarız.

        const definitionMutation = await admin.graphql(
            `#graphql
            mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
              metafieldDefinitionCreate(definition: $definition) {
                createdDefinition {
                  id
                }
                userErrors {
                  field
                  message
                  code
                }
              }
            }`,
            {
                variables: {
                    definition: {
                        name: "Filter Panel Order",
                        namespace: "filter_panel",
                        key: "filter_order",
                        description: "Order configuration for filter panel",
                        type: "json",
                        ownerType: "SHOP",
                        access: {
                            storefront: "PUBLIC_READ" // Storefront erişimi için KRİTİK
                        }
                    }
                }
            }
        );

        const defResult = await definitionMutation.json();
        console.log("Metafield Def Result:", JSON.stringify(defResult));

        // Eğer zaten varsa (TAKEN hatası) sorun yok, devam et.

        // 2. Metafield Değerini Kaydet
        const response = await admin.graphql(
            `#graphql
        mutation setFilterOrder($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
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
                            namespace: "filter_panel",
                            key: "filter_order",
                            type: "json",
                            value: filterOrder,
                            ownerId: shopId,
                        },
                    ],
                },
            }
        );

        const result = await response.json();
        console.log("Save Result:", JSON.stringify(result));

        return json({ status: "success", message: "Filtre sıralaması güncellendi ve storefront erişimi açıldı!" });
    }

    return json({ status: "error", message: "Bilinmeyen işlem" });
};

const DEFAULT_FILTERS: FilterItem[] = [
    { id: "availability", label: "STOK", param_name: "filter.v.availability", enabled: true },
    { id: "price", label: "FİYAT", param_name: "filter.v.price", enabled: true },
    { id: "product_type", label: "KATEGORİ", param_name: "filter.p.product_type", enabled: true },
    { id: "vendor", label: "MARKA", param_name: "filter.p.vendor", enabled: true },
    { id: "option_color", label: "RENK", param_name: "filter.v.option.color", enabled: true },
    { id: "option_size", label: "BEDEN", param_name: "filter.v.option.size", enabled: true },
    { id: "tag", label: "ETİKET", param_name: "filter.p.tag", enabled: true },
];

export default function FilterSettings() {
    const { filterOrder: savedOrder, shopId } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const nav = useNavigation();

    const [filters, setFilters] = useState<FilterItem[]>(
        savedOrder.length > 0 ? savedOrder : DEFAULT_FILTERS
    );
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    // Manual Add/Edit Modal
    const [modalActive, setModalActive] = useState(false);
    const [editingItem, setEditingItem] = useState<FilterItem | null>(null); // null means new item
    const [formLabel, setFormLabel] = useState("");
    const [formParam, setFormParam] = useState("");

    const isLoading = nav.state === "submitting";

    useEffect(() => {
        if (actionData?.status === "success") {
            // Toast logic removed for simplicity
        }
    }, [actionData]);

    const handleDragStart = (index: number) => {
        setDraggedIndex(index);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === index) return;

        const newFilters = [...filters];
        const draggedItem = newFilters[draggedIndex];
        newFilters.splice(draggedIndex, 1);
        newFilters.splice(index, 0, draggedItem);

        setFilters(newFilters);
        setDraggedIndex(index);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
    };

    const toggleFilter = (index: number) => {
        const newFilters = [...filters];
        newFilters[index].enabled = !newFilters[index].enabled;
        setFilters(newFilters);
    };

    const moveUp = (index: number) => {
        if (index === 0) return;
        const newFilters = [...filters];
        [newFilters[index - 1], newFilters[index]] = [newFilters[index], newFilters[index - 1]];
        setFilters(newFilters);
    };

    const moveDown = (index: number) => {
        if (index === filters.length - 1) return;
        const newFilters = [...filters];
        [newFilters[index], newFilters[index + 1]] = [newFilters[index + 1], newFilters[index]];
        setFilters(newFilters);
    };

    const deleteFilter = (index: number) => {
        const newFilters = [...filters];
        newFilters.splice(index, 1);
        setFilters(newFilters);
    };

    const openEditModal = (item: FilterItem) => {
        setEditingItem(item);
        setFormLabel(item.label);
        setFormParam(item.param_name);
        setModalActive(true);
    };

    const openAddModal = () => {
        setEditingItem(null);
        setFormLabel("");
        setFormParam("");
        setModalActive(true);
    };

    const handleModalClose = () => {
        setModalActive(false);
        setEditingItem(null);
    };

    const handleModalSave = () => {
        if (editingItem) {
            // Edit existing
            const newFilters = filters.map(f =>
                f.id === editingItem.id
                    ? { ...f, label: formLabel, param_name: formParam }
                    : f
            );
            setFilters(newFilters);
        } else {
            // Add new
            const newFilter: FilterItem = {
                id: `manual_${Date.now()}`,
                label: formLabel,
                param_name: formParam,
                enabled: true
            };
            setFilters([...filters, newFilter]);
        }
        handleModalClose();
    };

    const handleSave = () => {
        submit(
            {
                intent: "save_order",
                shopId,
                filterOrder: JSON.stringify(filters),
            },
            { method: "POST" }
        );
    };

    const resetToDefault = () => {
        setFilters(DEFAULT_FILTERS);
    };

    return (
        <Page
            title="Filtre Panel Ayarları"
            primaryAction={{
                content: "Kaydet",
                onAction: handleSave,
                loading: isLoading,
                /* @ts-ignore */
                variant: "primary"
            }}
            secondaryActions={[
                {
                    content: "Yeni Filtre Ekle",
                    icon: PlusIcon,
                    onAction: openAddModal
                }
            ]}
        >
            <BlockStack gap="500">
                <Banner tone="info">
                    <p>
                        <strong>Not:</strong> Shopify API kısıtlamaları nedeniyle Search & Discovery filtrelerini doğrudan çekemiyoruz.
                        Eğer aşağıdaki listesi eksikse <strong>"Yeni Filtre Ekle"</strong> butonu ile eksik filtreleri ekleyebilirsiniz.
                        Örneğin bir Metafield filtresi için başlık ve parametre adını (örn: <code>filter.p.m.custom.malzeme</code>) girmeniz gerekir.
                    </p>
                    <p>
                        Sıralama değişikliğinin mağazada görünmesi için <strong>mutlaka "Kaydet" butonuna basınız.</strong>
                    </p>
                </Banner>

                <Card>
                    <BlockStack gap="400">
                        <InlineStack align="space-between">
                            <Text as="h2" variant="headingMd">Filtre Sıralaması</Text>
                            <Button onClick={resetToDefault} size="slim">Varsayılana Dön</Button>
                        </InlineStack>

                        <Box
                            background="bg-surface-secondary"
                            padding="400"
                            borderRadius="200"
                        >
                            <BlockStack gap="200">
                                {filters.map((filter, index) => (
                                    <Box
                                        key={filter.id}
                                        background={draggedIndex === index ? "bg-surface-selected" : "bg-surface"}
                                        padding="300"
                                        borderRadius="200"
                                        borderWidth="025"
                                        borderColor="border"
                                    >
                                        <div
                                            draggable
                                            onDragStart={() => handleDragStart(index)}
                                            onDragOver={(e) => handleDragOver(e, index)}
                                            onDragEnd={handleDragEnd}
                                            style={{ cursor: "grab" }}
                                        >
                                            <InlineStack align="space-between" blockAlign="center">
                                                <InlineStack gap="300" blockAlign="center">
                                                    <div style={{ cursor: "grab", opacity: 0.5 }}>
                                                        <Icon source={DragHandleIcon} />
                                                    </div>
                                                    <BlockStack gap="050">
                                                        <Text
                                                            as="span"
                                                            variant="bodyMd"
                                                            fontWeight={filter.enabled ? "semibold" : "regular"}
                                                            tone={filter.enabled ? undefined : "subdued"}
                                                        >
                                                            {filter.label}
                                                        </Text>
                                                        <Text as="span" variant="bodySm" tone="subdued">
                                                            {filter.param_name}
                                                        </Text>
                                                    </BlockStack>
                                                    {!filter.enabled && (
                                                        <Text as="span" variant="bodySm" tone="subdued">
                                                            (Gizli)
                                                        </Text>
                                                    )}
                                                </InlineStack>

                                                <ButtonGroup>
                                                    <Button
                                                        icon={EditIcon}
                                                        variant="tertiary"
                                                        onClick={() => openEditModal(filter)}
                                                        accessibilityLabel="Düzenle"
                                                    />
                                                    <Button
                                                        size="slim"
                                                        disabled={index === 0}
                                                        onClick={() => moveUp(index)}
                                                    >
                                                        ↑
                                                    </Button>
                                                    <Button
                                                        size="slim"
                                                        disabled={index === filters.length - 1}
                                                        onClick={() => moveDown(index)}
                                                    >
                                                        ↓
                                                    </Button>
                                                    <Button
                                                        size="slim"
                                                        onClick={() => toggleFilter(index)}
                                                    >
                                                        {filter.enabled ? "Gizle" : "Göster"}
                                                    </Button>
                                                    <Button
                                                        icon={DeleteIcon}
                                                        variant="tertiary"
                                                        tone="critical"
                                                        onClick={() => deleteFilter(index)}
                                                        accessibilityLabel="Sil"
                                                    />
                                                </ButtonGroup>
                                            </InlineStack>
                                        </div>
                                    </Box>
                                ))}
                            </BlockStack>
                        </Box>
                    </BlockStack>
                </Card>

                {actionData?.status === "success" && (
                    <Banner tone="success">
                        <p>{actionData.message}</p>
                    </Banner>
                )}
            </BlockStack>

            <Modal
                open={modalActive}
                onClose={handleModalClose}
                title={editingItem ? "Filtreyi Düzenle" : "Yeni Filtre Ekle"}
                primaryAction={{
                    content: "Kaydet",
                    onAction: handleModalSave,
                }}
                secondaryActions={[
                    {
                        content: "İptal",
                        onAction: handleModalClose,
                    },
                ]}
            >
                <Modal.Section>
                    <BlockStack gap="400">
                        <TextField
                            label="Filtre Başlığı (Görünen Ad)"
                            value={formLabel}
                            onChange={setFormLabel}
                            autoComplete="off"
                            helpText="Mağazada müşterilerin göreceği başlık (Örn: MATERYAL)"
                        />
                        <TextField
                            label="Parametre Adı (ID)"
                            value={formParam}
                            onChange={setFormParam}
                            autoComplete="off"
                            helpText={
                                <>
                                    Shopify filtre parametresi. Search & Discovery uygulamasından veya URL'den bulabilirsiniz.
                                    <br />
                                    Örnekler: <code>filter.p.vendor</code> (Marka), <code>filter.p.product_type</code> (Kategori), <code>filter.v.option.color</code> (Renk Varyantı), <code>filter.p.m.custom.alan_adi</code> (Metafield)
                                </>
                            }
                        />
                    </BlockStack>
                </Modal.Section>
            </Modal>
        </Page>
    );
}
