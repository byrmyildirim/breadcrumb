import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {
    Page,
    Layout,
    Card,
    Text,
    Button,
    Banner,
    BlockStack,
    DataTable,
    Thumbnail,
    Badge,
    EmptyState,
    InlineStack
} from "@shopify/polaris";
import { AlertCircleIcon, CheckIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";

// Loader: 0 TL olup stoğu olan ürünleri bul
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    // Query: Price 0 AND Inventory > 0 AND Status Active
    // Not: Shopify search syntax kullanılıyor.
    const response = await admin.graphql(`
        query findZeroPriceProducts {
            products(first: 50, query: "variants.price:0 AND inventory_total:>0 AND status:ACTIVE") {
                nodes {
                    id
                    title
                    totalInventory
                    status
                    featuredImage {
                        url
                    }
                    variants(first: 10) {
                        nodes {
                            id
                            title
                            price
                            inventoryQuantity
                        }
                    }
                }
            }
        }
    `);

    const data = await response.json();
    return json({
        products: data.data?.products?.nodes || []
    });
};

// Action: Ürünleri Arşivle (veya Draft yap)
export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "archive_all") {
        const productIdsStr = formData.get("productIds") as string;
        const productIds = JSON.parse(productIdsStr);

        let successCount = 0;

        // Batch updates - Parallel requests with limit
        // Shopify API rate limits might apply, but for 50 items sequential is safer
        for (const id of productIds) {
            await admin.graphql(`
                mutation archiveProduct($id: ID!) {
                    productUpdate(input: {id: $id, status: ARCHIVED}) {
                        product { id }
                        userErrors { message }
                    }
                }
            `, { variables: { id } });
            successCount++;
        }

        return json({ status: "success", message: `${successCount} ürün arşive alındı ve satışa kapatıldı.` });
    }

    return json({ status: "error", message: "Geçersiz işlem" });
};

export default function PriceAudit() {
    const { products } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();

    const isFixing = fetcher.state === "submitting";
    const actionResult = fetcher.data;

    const handleFixAll = () => {
        if (!confirm(`${products.length} adet 0 TL'lik ürün arşivlenecek (Satışa kapatılacak). Onaylıyor musunuz?`)) return;

        const ids = products.map((p: any) => p.id);
        fetcher.submit(
            { actionType: "archive_all", productIds: JSON.stringify(ids) },
            { method: "post" }
        );
    };

    const rows = products.map((product: any) => [
        <Thumbnail
            source={product.featuredImage?.url || ""}
            alt={product.title}
        />,
        <Text as="span" fontWeight="bold">{product.title}</Text>,
        product.variants.nodes.map((v: any) => (
            v.price === "0.00" ? <Badge tone="critical" key={v.id}>{v.title}: 0 TL ({v.inventoryQuantity} Adet)</Badge> : null
        )),
        <Badge tone="success">{product.totalInventory} Stok</Badge>,
        <Button size="slim" url={`shopify:admin/products/${product.id.split('/').pop()}`} target="_blank">Düzenle</Button>
    ]);

    return (
        <Page>
            <TitleBar title="Fiyat & Stok Güvenlik Denetimi" />

            <BlockStack gap="500">
                {actionResult?.status === "success" && (
                    <Banner tone="success" title="İşlem Başarılı">
                        <p>{actionResult.message}</p>
                    </Banner>
                )}

                <Layout>
                    <Layout.Section>
                        <Card>
                            <BlockStack gap="400">
                                <BlockStack gap="200">
                                    <Text as="h2" variant="headingMd">
                                        Riskli Ürünler (0 TL & Stok Var)
                                    </Text>
                                    <Text as="p" tone="subdued">
                                        Bu listedeki ürünler stokta görünüyor ancak fiyatları 0 TL girilmiş. Müşteriler bu ürünleri ücretsiz sipariş edebilir.
                                    </Text>
                                </BlockStack>

                                {products.length > 0 ? (
                                    <>
                                        <Banner tone="warning" icon={AlertCircleIcon}>
                                            <p>Dikkat: **{products.length} adet** ürün bedava satış riski taşıyor!</p>
                                        </Banner>

                                        <InlineStack align="end">
                                            <Button variant="primary" tone="critical" onClick={handleFixAll} loading={isFixing}>
                                                Tümünü Arşivle ve Kapat
                                            </Button>
                                        </InlineStack>

                                        <DataTable
                                            columnContentTypes={["text", "text", "text", "text", "text"]}
                                            headings={["Görsel", "Ürün Adı", "Riskli Varyantlar", "Toplam Stok", "İşlem"]}
                                            rows={rows}
                                        />
                                    </>
                                ) : (
                                    <EmptyState
                                        heading="Harika! Riskli ürün bulunamadı."
                                        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                                    >
                                        <p>Şu anda stokta olup fiyatı 0 TL olan ürününüz yok.</p>
                                    </EmptyState>
                                )}
                            </BlockStack>
                        </Card>
                    </Layout.Section>
                </Layout>
            </BlockStack>
        </Page>
    );
}
