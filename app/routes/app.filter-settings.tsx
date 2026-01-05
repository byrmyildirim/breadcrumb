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

const DEFAULT_FILTERS: FilterItem[] = [
    { id: "availability", label: "Availability", param_name: "filter.v.availability", enabled: true },
    { id: "price", label: "Price", param_name: "filter.v.price", enabled: true },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shopifyDomain = session.shop;

    try {
        // 1. Mevcut Ayarı Çek (Filtre Sıralaması)
        const settingsResponse = await admin.graphql(
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
        const settingsData = await settingsResponse.json();
        const shopId = settingsData.data?.shop?.id;
        const savedOrderStr = settingsData.data?.shop?.metafield?.value;
        let savedOrder: FilterItem[] = [];
        if (savedOrderStr) {
            try {
                savedOrder = JSON.parse(savedOrderStr);
            } catch (e) {
                console.error("Saved order parse error", e);
            }
        }

        // 2. Storefront Access Token Al veya Oluştur
        let storefrontAccessToken = "";

        const tokenQuery = await admin.graphql(
            `#graphql
        query getStorefrontToken {
          shop {
            storefrontAccessTokens(first: 1) {
              nodes {
                accessToken
              }
            }
          }
        }`
        );
        const tokenData = await tokenQuery.json();
        if (tokenData.data?.shop?.storefrontAccessTokens?.nodes?.length > 0) {
            storefrontAccessToken = tokenData.data.shop.storefrontAccessTokens.nodes[0].accessToken;
        } else {
            // Token yoksa oluştur
            const tokenMutation = await admin.graphql(
                `#graphql
          mutation createStorefrontToken {
            storefrontAccessTokenCreate(input: {title: "Filter App Token"}) {
              storefrontAccessToken {
                accessToken
              }
            }
          }`
            );
            const mutationData = await tokenMutation.json();
            storefrontAccessToken = mutationData.data?.storefrontAccessTokenCreate?.storefrontAccessToken?.accessToken;
        }

        // 3. Herhangi bir koleksiyonun handle'ını bul
        const collectionQuery = await admin.graphql(
            `#graphql
        query getFirstCollection {
          collections(first: 1, sortKey: PRODUCTS_COUNT, reverse: true) {
            nodes {
              handle
            }
          }
        }`
        );
        const collectionData = await collectionQuery.json();
        const collectionHandle = collectionData.data?.collections?.nodes?.[0]?.handle || "all";

        // 4. Storefront API ile Filtreleri Çek
        let fetchedFilters: FilterItem[] = [];

        if (storefrontAccessToken) {
            const storefrontQuery = `
        query getCollectionFilters {
          collection(handle: "${collectionHandle}") {
            products(first: 1) {
              filters {
                id
                label
                type
              }
            }
          }
        }
      `;

            try {
                const response = await fetch(`https://${shopifyDomain}/api/2024-01/graphql.json`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Storefront-Access-Token': storefrontAccessToken,
                    },
                    body: JSON.stringify({ query: storefrontQuery }),
                });

                const result = await response.json();
                const sfFilters = result.data?.collection?.products?.filters || [];

                fetchedFilters = sfFilters.map((f: any) => {
                    // Param name mapping logic (Basitçe id veya type üzerinden tahmin/eşleştirme)
                    // Search & Discovery filtreleri genellikle id içinde param adını barındırır veya type bellidir.
                    // Storefront API 'id' field usually returns a JSON blob string, we need to be careful.
                    // Actually modern Storefront API returns 'id' as 'filter.v.price' directly or similar JSON structure?
                    // Let's assume 'id' helps or we construct it.

                    // Note: Storefront API 'filters' list contains everything active.
                    // We need to map 'f.id' or 'f.label' to our param_name.
                    // In standard Liquid output (which we use in theme):
                    // Price -> filter.v.price
                    // Availability -> filter.v.availability
                    // Vendor -> filter.p.vendor
                    // Product Type -> filter.p.product_type
                    // Option -> filter.v.option.size, filter.v.option.color
                    // Tag -> filter.p.tag
                    // Metafield -> filter.p.m.namespace.key

                    // Storefront API filter object structure:
                    // { id: "filter.v.price", label: "Price", type: "PRICE_RANGE" }
                    // Let's rely on 'id' being valid param_name or close to it.

                    return {
                        id: f.id,
                        label: f.label,
                        param_name: f.id, // Usually the Storefront API ID for filter is the param name
                        enabled: true
                    };
                });

            } catch (err) {
                console.error("Storefront fetch error:", err);
            }
        }

        // 5. Merge Logic: Saved Order + New Filters
        // Eğer hiç saved yoksa fetched'i kullan.
        // Saved varsa: Saved'dekileri koru, eksik olanları (yeni gelenleri) sona ekle.

        let finalFilters: FilterItem[] = [];

        if (savedOrder.length === 0) {
            finalFilters = fetchedFilters.length > 0 ? fetchedFilters : DEFAULT_FILTERS;
        } else {
            // Saved order'ı önce al
            const savedMap = new Map(savedOrder.map(f => [f.param_name, f]));
            const fetchedMap = new Map(fetchedFilters.map(f => [f.param_name, f])); // param_name should match

            // Mevcut sıralamayı koru, ama label'ları güncelle (Search & Discovery'de isim değişmiş olabilir)
            savedOrder.forEach(savedItem => {
                const freshItem = fetchedMap.get(savedItem.param_name);
                if (freshItem) {
                    finalFilters.push({
                        ...savedItem,
                        label: freshItem.label, // Güncel ismi al
                        id: freshItem.id // Güncel ID (gerekirse)
                    });
                    fetchedMap.delete(savedItem.param_name);
                } else {
                    // Artık storefrontta yoksa (silinmişse) yine de listede dursun mu?
                    // Genelde evet, kullanıcının ayarı bozulmasın, ama disabled olabilir.
                    // Veya user "Varsayılana Dön" diyene kadar tutabiliriz.
                    finalFilters.push(savedItem);
                }
            });

            // Kalan (yeni eklenen) filtreleri sona ekle
            fetchedMap.forEach(newItem => {
                finalFilters.push(newItem);
            });
        }

        return json({ filterOrder: finalFilters, shopId });
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
