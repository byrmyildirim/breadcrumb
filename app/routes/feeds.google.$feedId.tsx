import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

// Public endpoint: /feeds/google/:feedId
// Returns XML in Google Shopping format
export const loader = async ({ params }: LoaderFunctionArgs) => {
    const feedId = params.feedId;

    if (!feedId) {
        return new Response("Feed ID required", { status: 400 });
    }

    // Get feed settings
    const feed = await prisma.productFeed.findUnique({
        where: { id: feedId },
    });

    if (!feed) {
        return new Response("Feed not found", { status: 404 });
    }

    // Get session for API access
    const session = await prisma.session.findFirst({
        where: { shop: feed.shop },
    });

    if (!session?.accessToken) {
        return new Response("Shop not authorized", { status: 401 });
    }

    // Fetch products from Shopify
    const shopDomain = feed.shop;
    const accessToken = session.accessToken;

    let allProducts: any[] = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage && allProducts.length < 1000) { // Limit to 1000 products
        const query = `
      query GetProducts($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              description
              vendor
              productType
              handle
              status
              featuredImage {
                url
              }
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    sku
                    barcode
                    price
                    inventoryQuantity
                    availableForSale
                  }
                }
              }
            }
          }
        }
      }
    `;

        const response = await fetch(
            `https://${shopDomain}/admin/api/2024-01/graphql.json`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Shopify-Access-Token": accessToken,
                },
                body: JSON.stringify({ query, variables: { cursor } }),
            }
        );

        const data = await response.json();

        if (data.errors) {
            console.error("GraphQL errors:", data.errors);
            break;
        }

        const products = data.data.products.edges.map((edge: any) => edge.node);
        allProducts = [...allProducts, ...products];

        hasNextPage = data.data.products.pageInfo.hasNextPage;
        cursor = data.data.products.pageInfo.endCursor;
    }

    // Filter products
    let filteredProducts = allProducts.filter(p => p.status === "ACTIVE");

    if (feed.stockOnly) {
        filteredProducts = filteredProducts.filter(p =>
            p.variants.edges.some((v: any) => v.node.inventoryQuantity > 0)
        );
    }

    // Generate XML
    const shopUrl = `https://${shopDomain.replace(".myshopify.com", ".com")}`;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${escapeXml(feed.name)}</title>
<link>${shopUrl}</link>
<description>Product feed for ${escapeXml(shopDomain)}</description>
`;

    for (const product of filteredProducts) {
        for (const variantEdge of product.variants.edges) {
            const variant = variantEdge.node;

            // Skip out of stock if filter is on
            if (feed.stockOnly && variant.inventoryQuantity <= 0) continue;

            const variantId = variant.id.split("/").pop();
            const availability = variant.inventoryQuantity > 0 ? "in_stock" : "out_of_stock";
            const imageUrl = product.featuredImage?.url || "";
            const productUrl = `${shopUrl}/products/${product.handle}?variant=${variantId}`;

            xml += `<item>
<g:id>${escapeXml(variantId)}</g:id>
<g:title>${escapeXml(product.title)}${variant.title !== "Default Title" ? " - " + escapeXml(variant.title) : ""}</g:title>
<g:description>${escapeXml(stripHtml(product.description || ""))}</g:description>
<g:link>${escapeXml(productUrl)}</g:link>
<g:image_link>${escapeXml(imageUrl)}</g:image_link>
<g:price>${variant.price} TRY</g:price>
<g:availability>${availability}</g:availability>
<g:brand>${escapeXml(product.vendor || "")}</g:brand>
<g:condition>new</g:condition>
${variant.barcode ? `<g:gtin>${escapeXml(variant.barcode)}</g:gtin>` : ""}
${variant.sku ? `<g:mpn>${escapeXml(variant.sku)}</g:mpn>` : ""}
<g:product_type>${escapeXml(product.productType || "")}</g:product_type>
</item>
`;
        }
    }

    xml += `</channel>
</rss>`;

    return new Response(xml, {
        headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
        },
    });
};

function escapeXml(text: string): string {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").trim();
}
