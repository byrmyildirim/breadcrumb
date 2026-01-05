import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    Button,
    DataTable,
    Modal,
    TextField,
    Select,
    Checkbox,
    Banner,
    Text,
    Badge,
    BlockStack,
    InlineStack,
    Box,
    Link,
    EmptyState,
    Spinner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    // Get all feeds for this shop
    const feeds = await prisma.productFeed.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
    });

    // Get collections for dropdown
    const collectionsResponse = await admin.graphql(`
    query {
      collections(first: 100) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  `);
    const collectionsData = await collectionsResponse.json();
    const collections = collectionsData.data.collections.edges.map((edge: any) => ({
        id: edge.node.id,
        title: edge.node.title,
        handle: edge.node.handle,
    }));

    const appUrl = process.env.SHOPIFY_APP_URL || "https://breadcrumb-production.up.railway.app";

    return json({ feeds, collections, shop, appUrl });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent === "create") {
        const name = formData.get("name") as string;
        const feedType = formData.get("feedType") as string;
        const language = formData.get("language") as string;
        const collectionId = formData.get("collectionId") as string || null;
        const collectionTitle = formData.get("collectionTitle") as string || null;
        const stockOnly = formData.get("stockOnly") === "true";

        // Count products for this feed
        let productCount = 0;
        try {
            const countResponse = await admin.graphql(`
        query {
          productsCount {
            count
          }
        }
      `);
            const countData = await countResponse.json();
            productCount = countData.data.productsCount.count;
        } catch (e) {
            productCount = 0;
        }

        await prisma.productFeed.create({
            data: {
                shop,
                name,
                feedType,
                language,
                collectionId,
                collectionTitle,
                stockOnly,
                productCount,
                lastGenerated: new Date(),
            },
        });

        return json({ success: true, message: "Feed oluşturuldu" });
    }

    if (intent === "delete") {
        const feedId = formData.get("feedId") as string;
        await prisma.productFeed.delete({ where: { id: feedId } });
        return json({ success: true, message: "Feed silindi" });
    }

    if (intent === "update") {
        const feedId = formData.get("feedId") as string;

        // Refresh product count
        let productCount = 0;
        try {
            const countResponse = await admin.graphql(`
        query {
          productsCount {
            count
          }
        }
      `);
            const countData = await countResponse.json();
            productCount = countData.data.productsCount.count;
        } catch (e) {
            productCount = 0;
        }

        await prisma.productFeed.update({
            where: { id: feedId },
            data: {
                productCount,
                lastGenerated: new Date(),
            },
        });

        return json({ success: true, message: "Feed güncellendi" });
    }

    return json({ success: false, message: "Bilinmeyen işlem" });
};

export default function FeedsPage() {
    const { feeds, collections, shop, appUrl } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const isLoading = navigation.state !== "idle";

    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedFeed, setSelectedFeed] = useState<any>(null);

    // Create form state
    const [feedName, setFeedName] = useState("");
    const [feedType, setFeedType] = useState("google");
    const [feedLanguage, setFeedLanguage] = useState("tr");
    const [selectedCollection, setSelectedCollection] = useState("");
    const [stockOnly, setStockOnly] = useState(false);

    const handleCreateFeed = useCallback(() => {
        const formData = new FormData();
        formData.append("intent", "create");
        formData.append("name", feedName);
        formData.append("feedType", feedType);
        formData.append("language", feedLanguage);

        if (selectedCollection) {
            const collection = collections.find((c: any) => c.id === selectedCollection);
            formData.append("collectionId", selectedCollection);
            formData.append("collectionTitle", collection?.title || "");
        }
        formData.append("stockOnly", stockOnly.toString());

        submit(formData, { method: "post" });
        setCreateModalOpen(false);
        resetForm();
    }, [feedName, feedType, feedLanguage, selectedCollection, stockOnly, collections, submit]);

    const handleDeleteFeed = useCallback((feedId: string) => {
        if (confirm("Bu feed'i silmek istediğinize emin misiniz?")) {
            const formData = new FormData();
            formData.append("intent", "delete");
            formData.append("feedId", feedId);
            submit(formData, { method: "post" });
            setDetailModalOpen(false);
        }
    }, [submit]);

    const handleUpdateFeed = useCallback((feedId: string) => {
        const formData = new FormData();
        formData.append("intent", "update");
        formData.append("feedId", feedId);
        submit(formData, { method: "post" });
    }, [submit]);

    const resetForm = () => {
        setFeedName("");
        setFeedType("google");
        setFeedLanguage("tr");
        setSelectedCollection("");
        setStockOnly(false);
    };

    const openDetailModal = (feed: any) => {
        setSelectedFeed(feed);
        setDetailModalOpen(true);
    };

    const getFeedUrl = (feed: any) => {
        return `${appUrl}/feeds/${feed.feedType}/${feed.id}`;
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const formatDate = (date: string | null) => {
        if (!date) return "-";
        return new Date(date).toLocaleString("tr-TR");
    };

    const feedTypeOptions = [
        { label: "Google", value: "google" },
        { label: "Meta (Facebook)", value: "meta" },
    ];

    const languageOptions = [
        { label: "Türkçe", value: "tr" },
        { label: "English", value: "en" },
    ];

    const collectionOptions = [
        { label: "Tüm Koleksiyonlar", value: "" },
        ...collections.map((c: any) => ({ label: c.title, value: c.id })),
    ];

    // Table rows
    const rows = feeds.map((feed: any) => [
        <Link key={feed.id} onClick={() => openDetailModal(feed)} removeUnderline>
            {feed.name}
        </Link>,
        <Badge key={`type-${feed.id}`} tone={feed.feedType === "google" ? "success" : "info"}>
            {feed.feedType === "google" ? "Google" : "Meta"}
        </Badge>,
        feed.language === "tr" ? "Türkçe" : "English",
        feed.productCount.toString(),
        <Button key={`url-${feed.id}`} size="slim" onClick={() => openDetailModal(feed)}>
            Feed Görüntüle
        </Button>,
        formatDate(feed.lastGenerated),
    ]);

    return (
        <Page
            title="XML Feed Oluşturucu"
            subtitle="XML feed'inizi tek tıkla oluşturun"
            primaryAction={{
                content: "Yeni Feed Oluştur",
                onAction: () => setCreateModalOpen(true),
            }}
        >
            <Layout>
                <Layout.Section>
                    <Banner title="Bilgi" tone="info">
                        <p>Google Merchant Center ve Meta Commerce Manager için XML feed'lerinizi bu sayfadan yönetebilirsiniz.</p>
                    </Banner>
                </Layout.Section>

                <Layout.Section>
                    <Card>
                        {isLoading && (
                            <Box padding="400">
                                <InlineStack align="center">
                                    <Spinner size="small" />
                                    <Text as="span">İşleniyor...</Text>
                                </InlineStack>
                            </Box>
                        )}

                        {feeds.length === 0 ? (
                            <EmptyState
                                heading="Henüz feed oluşturmadınız"
                                action={{
                                    content: "Yeni Feed Oluştur",
                                    onAction: () => setCreateModalOpen(true),
                                }}
                                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                            >
                                <p>Bir feed oluşturmak için lütfen yukarıdaki butona tıklayın.</p>
                            </EmptyState>
                        ) : (
                            <>
                                <DataTable
                                    columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                                    headings={["Feed Adı", "Yapı", "Dil", "Ürün Sayısı", "XML URL", "Son Güncelleme"]}
                                    rows={rows}
                                />
                                <Box padding="400">
                                    <Text as="p" tone="subdued" alignment="center">
                                        {feeds.length} feed
                                    </Text>
                                </Box>
                            </>
                        )}
                    </Card>
                </Layout.Section>
            </Layout>

            {/* Create Feed Modal */}
            <Modal
                open={createModalOpen}
                onClose={() => {
                    setCreateModalOpen(false);
                    resetForm();
                }}
                title="Yeni Feed Oluştur"
                primaryAction={{
                    content: "Feed Oluştur",
                    onAction: handleCreateFeed,
                    disabled: !feedName,
                }}
                secondaryActions={[
                    {
                        content: "İptal",
                        onAction: () => {
                            setCreateModalOpen(false);
                            resetForm();
                        },
                    },
                ]}
            >
                <Modal.Section>
                    <Banner title="Dikkat!" tone="warning">
                        <p>Mağazanızın ürün verilerini almak için Shopify API kullanıyoruz. XML dosyanız oluşturulduktan sonra feed URL'sini Google Merchant Center veya Meta Commerce Manager'a ekleyebilirsiniz.</p>
                    </Banner>
                </Modal.Section>
                <Modal.Section>
                    <BlockStack gap="400">
                        <TextField
                            label="Feed Adı"
                            value={feedName}
                            onChange={setFeedName}
                            autoComplete="off"
                            placeholder="Örn: Google Ana Feed"
                        />
                        <Select
                            label="Feed Yapısı"
                            options={feedTypeOptions}
                            value={feedType}
                            onChange={setFeedType}
                        />
                        <Select
                            label="Feed Dili"
                            options={languageOptions}
                            value={feedLanguage}
                            onChange={setFeedLanguage}
                        />
                        <Select
                            label="Koleksiyon"
                            options={collectionOptions}
                            value={selectedCollection}
                            onChange={setSelectedCollection}
                            helpText="Belirli bir koleksiyondan ürün çekmek için seçin"
                        />
                        <Checkbox
                            label="Sadece stokta olan ürünleri dahil et"
                            checked={stockOnly}
                            onChange={setStockOnly}
                        />
                    </BlockStack>
                </Modal.Section>
            </Modal>

            {/* Feed Detail Modal */}
            <Modal
                open={detailModalOpen}
                onClose={() => setDetailModalOpen(false)}
                title={selectedFeed?.name || "Feed Detayı"}
                primaryAction={{
                    content: "Feed Güncelle",
                    onAction: () => handleUpdateFeed(selectedFeed?.id),
                }}
                secondaryActions={[
                    {
                        content: "Feed Sil",
                        destructive: true,
                        onAction: () => handleDeleteFeed(selectedFeed?.id),
                    },
                ]}
            >
                <Modal.Section>
                    {selectedFeed && (
                        <BlockStack gap="400">
                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">Feed Adı</Text>
                                    <Text as="p">{selectedFeed.name}</Text>
                                </BlockStack>
                            </Box>

                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">Yapı</Text>
                                    <Text as="p">{selectedFeed.feedType === "google" ? "Google" : "Meta"}</Text>
                                </BlockStack>
                            </Box>

                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">Dil</Text>
                                    <Text as="p">{selectedFeed.language === "tr" ? "Türkçe" : "English"}</Text>
                                </BlockStack>
                            </Box>

                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">Ürün Sayısı</Text>
                                    <Text as="p">{selectedFeed.productCount}</Text>
                                </BlockStack>
                            </Box>

                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">Koleksiyon</Text>
                                    <Text as="p">{selectedFeed.collectionTitle || "Tüm Koleksiyonlar"}</Text>
                                </BlockStack>
                            </Box>

                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">Stok Filtresi</Text>
                                    <Text as="p">{selectedFeed.stockOnly ? "Sadece stokta olanlar" : "Tüm ürünler"}</Text>
                                </BlockStack>
                            </Box>

                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">Feed URL</Text>
                                    <InlineStack gap="200" align="start">
                                        <TextField
                                            label=""
                                            value={getFeedUrl(selectedFeed)}
                                            readOnly
                                            autoComplete="off"
                                        />
                                        <Button onClick={() => copyToClipboard(getFeedUrl(selectedFeed))}>
                                            Kopyala
                                        </Button>
                                    </InlineStack>
                                </BlockStack>
                            </Box>

                            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                                <BlockStack gap="200">
                                    <Text as="p" fontWeight="semibold">Son Güncelleme</Text>
                                    <Text as="p">{formatDate(selectedFeed.lastGenerated)}</Text>
                                </BlockStack>
                            </Box>
                        </BlockStack>
                    )}
                </Modal.Section>
            </Modal>
        </Page>
    );
}
