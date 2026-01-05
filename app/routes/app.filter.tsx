import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
    Page,
    Layout,
    Text,
    Card,
    Button,
    BlockStack,
    TextField,
    Banner,
    List,
    Checkbox,
    Scrollable,
    Box,
    Divider
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// Loader: Ayarları ve Koleksiyonları Çeker
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    try {
        // 1. Mevcut Ayarı Çek (Sadece Metafield)
        const settingsQuery = await admin.graphql(
            `#graphql
        query getSettings {
          shop {
              id
              metafield(namespace: "filter_app", key: "target_label") {
                  value
              }
          }
        }`,
        );
        const settingsJson = await settingsQuery.json();
        const currentLabel = settingsJson.data?.shop?.metafield?.value || "Kategori";
        const shopId = settingsJson.data?.shop?.id;

        // 2. TÜM Koleksiyonları Çek (Pagination Loop)
        let allCollections: any[] = [];
        let hasNextPage = true;
        let cursor: string | null = null; // null | string

        while (hasNextPage) {
            const collectionsQuery: any = await admin.graphql(
                `#graphql
            query getCollections($after: String) {
              collections(first: 250, after: $after) {
                  pageInfo {
                      hasNextPage
                      endCursor
                  }
                  edges {
                      node {
                          id
                          title
                          productsCount {
                              count
                          }
                      }
                  }
              }
            }`,
                { variables: { after: cursor } }
            );

            const responseJson: any = await collectionsQuery.json();

            if (responseJson.errors) {
                console.error("GraphQL Errors:", JSON.stringify(responseJson.errors, null, 2));
                break;
            }

            const edges = responseJson.data?.collections?.edges || [];
            const nodes = edges.map((edge: any) => edge.node);
            allCollections = [...allCollections, ...nodes];

            const pageInfo: any = responseJson.data?.collections?.pageInfo;
            hasNextPage = pageInfo?.hasNextPage;
            cursor = pageInfo?.endCursor;
        }

        const collections = allCollections;

        return json({ currentLabel, collections, shopId });
    } catch (error: any) {
        console.error("Loader Error Object:", JSON.stringify(error, null, 2));
        if (error && error.graphQLErrors) {
            console.error("Detailed GraphQL Errors:", JSON.stringify(error.graphQLErrors, null, 2));
        }
        return json({ currentLabel: "Error", collections: [], shopId: "" });
    }
};

// Action: Hem Ayar Kaydeder hem de Eşitleme Yapar
export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const intent = formData.get("intent");

    // SENARYO 1: Ayarları Kaydet
    if (intent === "save_settings") {
        const targetLabel = formData.get("targetLabel");
        const shopId = formData.get("shopId"); // Hidden input ile gelir

        const response = await admin.graphql(
            `#graphql
            mutation setSettings($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                userErrors {
                  field
                  message
                }
              }
            }`,
            {
                variables: {
                    metafields: [{
                        namespace: "filter_app",
                        key: "target_label",
                        type: "single_line_text_field",
                        value: targetLabel,
                        ownerId: shopId
                    }]
                },
            },
        );
        return json({ status: "success_settings", message: "Ayarlar kaydedildi." });
    }

    // SENARYO 2: Koleksiyon Eşitleme (Bulk Sync)
    if (intent === "sync_collections") {
        const selectedCollectionIds = JSON.parse(formData.get("selectedCollectionIds") as string);

        let processedCount = 0;

        // Her bir koleksiyon için dön
        for (const collectionId of selectedCollectionIds) {

            // 1. Koleksiyonun Adını ve Ürünlerini Çek
            // Not: Pagination yapılmalı ama şimdilik ilk 50 ürün diyoruz.
            const collectionQuery = await admin.graphql(
                `#graphql
                query getCollectionProducts($id: ID!) {
                    collection(id: $id) {
                        title
                        products(first: 50) {
                            edges {
                                node {
                                    id
                                }
                            }
                        }
                    }
                }`,
                { variables: { id: collectionId } }
            );

            const collectionData = await collectionQuery.json();
            const collectionTitle = collectionData.data.collection.title;
            const products = collectionData.data.collection.products.edges;

            // 2. Ürünlere Metafield Yaz
            if (products.length > 0) {
                // Bulk Mutation kullanmak daha iyi ama şimdilik döngüyle yapıyoruz (Basitlik için)
                for (const productEdge of products) {
                    const productId = productEdge.node.id;

                    await admin.graphql(
                        `#graphql
                        mutation updateProductMetafield($input: ProductInput!) {
                            productUpdate(input: $input) {
                                userErrors {
                                    field
                                    message
                                }
                            }
                        }`,
                        {
                            variables: {
                                input: {
                                    id: productId,
                                    metafields: [
                                        {
                                            namespace: "custom",
                                            key: "kategori", // Standart olarak 'custom.kategori' kullanıyoruz
                                            value: collectionTitle,
                                            type: "single_line_text_field"
                                        }
                                    ]
                                }
                            }
                        }
                    );
                }
                processedCount += products.length;
            }
        }

        return json({ status: "success_sync", message: `${processedCount} ürün etiketlendi!` });
    }

    return json({ status: "error", message: "Bilinmeyen işlem." });
};


export default function FilterPage() {
    const { currentLabel, collections, shopId } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const nav = useNavigation();
    const shopify = useAppBridge();

    const [label, setLabel] = useState(currentLabel);
    const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState("");

    const filteredCollections = collections.filter((col: any) =>
        col.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const isLoading = nav.state === "submitting";

    useEffect(() => {
        if (actionData?.status?.includes("success")) {
            shopify.toast.show(actionData.message);
        }
    }, [actionData, shopify]);

    const handleSaveSettings = () => {
        submit({ intent: "save_settings", targetLabel: label, shopId }, { method: "POST" });
    };

    const handleSync = () => {
        if (selectedCollections.length === 0) {
            shopify.toast.show("Lütfen en az bir koleksiyon seçin.");
            return;
        }

        // JSON array olarak gönder
        submit(
            {
                intent: "sync_collections",
                selectedCollectionIds: JSON.stringify(selectedCollections)
            },
            { method: "POST" }
        );
    };

    return (
        <Page>
            <TitleBar title="Filtre Uygulaması & Otomasyon" />
            <BlockStack gap="500">
                <Layout>
                    {/* SOL KOLON: Ayarlar */}
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">
                                    1. Filtre Ayarı
                                </Text>
                                <TextField
                                    label="Hedef Filtre Adı"
                                    value={label}
                                    onChange={setLabel}
                                    autoComplete="off"
                                    helpText="Search & Discovery'deki etiket adı (Örn: Kategori)"
                                    disabled={isLoading}
                                />
                                <Button loading={isLoading} onClick={handleSaveSettings}>
                                    Ayarları Kaydet
                                </Button>
                            </BlockStack>
                        </Card>
                    </Layout.Section>

                    {/* SAĞ KOLON: Otomasyon */}
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">
                                    2. Koleksiyon Eşitleyici (Otomasyon) 🤖
                                </Text>
                                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                                    <Text as="p" tone="subdued">
                                        Seçtiğiniz koleksiyonlardaki ürünlere, koleksiyonun ismini
                                        <strong>"custom.kategori"</strong> olarak otomatik yazar.
                                        Böylece elle tek tek ürün düzenlemenize gerek kalmaz.
                                    </Text>
                                </Box>

                                <Text as="h3" variant="headingSm">Koleksiyon Listesi:</Text>

                                <TextField
                                    label="Koleksiyon Ara"
                                    value={searchTerm}
                                    onChange={setSearchTerm}
                                    autoComplete="off"
                                    placeholder="Koleksiyon adı..."
                                    clearButton
                                    onClearButtonClick={() => setSearchTerm("")}
                                />

                                <Box borderRadius="200" borderColor="border" borderWidth="025">
                                    <Scrollable shadow style={{ height: '300px' }}>
                                        <List>
                                            {filteredCollections.map((col: any) => (
                                                <Box key={col.id} padding="300" borderBlockEndWidth="025" borderColor="border">
                                                    <Checkbox
                                                        label={`${col.title} (${col.productsCount?.count ?? 0} Ürün)`}
                                                        checked={selectedCollections.includes(col.id)}
                                                        onChange={(newChecked) => {
                                                            if (newChecked) setSelectedCollections([...selectedCollections, col.id]);
                                                            else setSelectedCollections(selectedCollections.filter(id => id !== col.id));
                                                        }}
                                                    />
                                                </Box>
                                            ))}
                                        </List>
                                    </Scrollable>
                                </Box>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                    {selectedCollections.length > 0 && (
                                        <Button onClick={() => setSelectedCollections([])}>
                                            Seçimi Temizle
                                        </Button>
                                    )}
                                    <Button
                                        variant="primary"
                                        tone="critical"
                                        loading={isLoading}
                                        onClick={handleSync}
                                        disabled={selectedCollections.length === 0}
                                    >
                                        Seçili {String(selectedCollections.length)} Koleksiyonu Eşitle
                                    </Button>
                                </div>
                            </BlockStack>
                        </Card>
                    </Layout.Section>

                </Layout>
            </BlockStack>
        </Page>
    );
}
