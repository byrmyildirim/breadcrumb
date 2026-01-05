import { useState, useEffect } from "react";
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
} from "@shopify/polaris";
import { DragHandleIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Drag-drop kütüphanesi olmadan basit sıralama
interface FilterItem {
    id: string;
    label: string;
    param_name: string;
    enabled: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    try {
        // Mevcut ayarı çek
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

        await admin.graphql(
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

        return json({ status: "success", message: "Filtre sıralaması kaydedildi!" });
    }

    return json({ status: "error", message: "Bilinmeyen işlem" });
};

// Varsayılan filtre listesi (Shopify'dan gelen tipik filtreler)
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

    // Kaydedilmiş sıralama varsa onu kullan, yoksa varsayılanı
    const [filters, setFilters] = useState<FilterItem[]>(
        savedOrder.length > 0 ? savedOrder : DEFAULT_FILTERS
    );
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

    const isLoading = nav.state === "submitting";

    useEffect(() => {
        if (actionData?.status === "success") {
            // Toast göster - App Bridge kullanılabilir
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
        <Page>
            <TitleBar title="Filtre Panel Ayarları" />
            <BlockStack gap="500">
                <Banner tone="info">
                    <p>
                        Filtrelerin görüntülenme sırasını aşağıdan ayarlayabilirsiniz.
                        Yukarı/aşağı oklarını kullanarak sıralamayı değiştirin veya
                        sürükle-bırak yapın.
                    </p>
                </Banner>

                <Card>
                    <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                            Filtre Sıralaması
                        </Text>

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
                                                    <Text
                                                        as="span"
                                                        variant="bodyMd"
                                                        fontWeight={filter.enabled ? "semibold" : "regular"}
                                                        tone={filter.enabled ? undefined : "subdued"}
                                                    >
                                                        {filter.label}
                                                    </Text>
                                                    {!filter.enabled && (
                                                        <Text as="span" variant="bodySm" tone="subdued">
                                                            (Gizli)
                                                        </Text>
                                                    )}
                                                </InlineStack>

                                                <InlineStack gap="200">
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
                                                </InlineStack>
                                            </InlineStack>
                                        </div>
                                    </Box>
                                ))}
                            </BlockStack>
                        </Box>

                        <InlineStack align="end" gap="300">
                            <Button onClick={resetToDefault}>Varsayılana Dön</Button>
                            <Button variant="primary" onClick={handleSave} loading={isLoading}>
                                Kaydet
                            </Button>
                        </InlineStack>
                    </BlockStack>
                </Card>

                {actionData?.status === "success" && (
                    <Banner tone="success">
                        <p>{actionData.message}</p>
                    </Banner>
                )}
            </BlockStack>
        </Page>
    );
}
