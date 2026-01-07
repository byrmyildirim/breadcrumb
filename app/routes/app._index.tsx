import { useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link as RemixLink } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Box,
  Icon,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  MenuIcon,
  FilterIcon,
  DatabaseIcon,
  ViewIcon,
  HomeIcon,
  OrderIcon,
} from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  // Get shop domain for deep linking if needed
  const url = new URL(request.url);
  return { shop: url.hostname };
};

export default function Index() {
  const { shop } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Temel Uygulamalar" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">

              {/* Introduction Card */}
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Hoş Geldiniz 👋
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Mağazanızı yönetmek için gerekli olan temel araçlara buradan hızlıca erişebilirsiniz.
                  </Text>
                </BlockStack>
              </Card>

              {/* Apps Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem" }}>

                {/* Mega Menu */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="start" gap="400">
                      <div style={{ background: "#f1f2f3", padding: "10px", borderRadius: "8px" }}>
                        <Icon source={MenuIcon} tone="base" />
                      </div>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Mega Menu</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Gelişmiş menü yapıları, görseller ve tab'lı navigasyon yönetimi.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack align="end">
                      <Button as={RemixLink} to="/app/megamenu" variant="primary">
                        Yönet
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Filters */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="start" gap="400">
                      <div style={{ background: "#e3f1fc", padding: "10px", borderRadius: "8px" }}>
                        <Icon source={FilterIcon} tone="info" />
                      </div>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Filtre & Breadcrumb</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Koleksiyon sayfaları için gelişmiş filtreleme ve navigasyon yolları.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack align="end">
                      <Button as={RemixLink} to="/app/filter" variant="primary">
                        Ayarlar
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Feeds */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="start" gap="400">
                      <div style={{ background: "#fcefe3", padding: "10px", borderRadius: "8px" }}>
                        <Icon source={DatabaseIcon} tone="critical" />
                      </div>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">XML Feed Yönetimi</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Google, Meta ve diğer platformlar için ürün beslemeleri oluşturun.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack align="end">
                      <Button as={RemixLink} to="/app/feeds" variant="primary">
                        Feed Oluştur
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Quick View (Theme Link) */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="start" gap="400">
                      <div style={{ background: "#e4f7eb", padding: "10px", borderRadius: "8px" }}>
                        <Icon source={ViewIcon} tone="success" />
                      </div>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Hızlı Bakış (Quick View)</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Tema düzenleyici üzerinden renk, stil ve görsel ayarlarını yapın.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack align="end">
                      <Button url={`https://admin.shopify.com/store/${shop?.split('.')[0]}/themes/current/editor?context=apps`} target="_blank">
                        Tema Ayarlarına Git
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {/* Tici to Shopify */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="start" gap="400">
                      <div style={{ background: "#fce4ec", padding: "10px", borderRadius: "8px" }}>
                        <Icon source={OrderIcon} tone="critical" />
                      </div>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Tici to Shopify</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Ticimax siparişlerini çekin ve Shopify mağazanıza aktarın.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <InlineStack align="end">
                      <Button as={RemixLink} to="/app/tici-to-shopify" variant="primary">
                        Siparişleri Yönet
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>

              </div>

            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
