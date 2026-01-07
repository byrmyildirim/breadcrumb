// Admin GraphQL client type
type AdminGraphqlClient = {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// Müşteri bilgisi
interface CustomerData {
    email?: string;
    firstName: string;
    lastName: string;
    phone?: string;
    address?: {
        address1: string;
        city: string;
        province?: string;
        zip?: string;
        country?: string;
    };
}

// Sipariş satır bilgisi
interface OrderLineItem {
    title: string;
    quantity: number;
    priceSet: {
        shopMoney: {
            amount: string;
            currencyCode: string;
        };
    };
    sku?: string;
}

// Draft Order oluşturma sonucu
interface DraftOrderResult {
    success: boolean;
    orderId?: string;
    orderName?: string;
    customerId?: string;
    error?: string;
}

/**
 * E-posta ile mevcut müşteriyi ara
 */
export async function findCustomerByEmail(
    admin: AdminGraphqlClient,
    email: string
): Promise<{ id: string; displayName: string } | null> {
    if (!email) return null;

    try {
        const response = await admin.graphql(`
      query getCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              displayName
              email
            }
          }
        }
      }
    `, {
            variables: {
                query: `email:${email}`,
            },
        });

        const data = await response.json();
        const customers = data?.data?.customers?.edges || [];

        if (customers.length > 0) {
            return {
                id: customers[0].node.id,
                displayName: customers[0].node.displayName,
            };
        }

        return null;
    } catch (error) {
        console.error("Müşteri arama hatası:", error);
        return null;
    }
}

/**
 * Telefon ile mevcut müşteriyi ara
 */
export async function findCustomerByPhone(
    admin: AdminGraphqlClient,
    phone: string
): Promise<{ id: string; displayName: string } | null> {
    if (!phone) return null;

    try {
        const response = await admin.graphql(`
      query getCustomerByPhone($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
              displayName
              phone
            }
          }
        }
      }
    `, {
            variables: {
                query: `phone:${phone}`,
            },
        });

        const data = await response.json();
        const customers = data?.data?.customers?.edges || [];

        if (customers.length > 0) {
            return {
                id: customers[0].node.id,
                displayName: customers[0].node.displayName,
            };
        }

        return null;
    } catch (error) {
        console.error("Telefon ile müşteri arama hatası:", error);
        return null;
    }
}

/**
 * Yeni müşteri oluştur
 */
export async function createCustomer(
    admin: AdminGraphqlClient,
    customer: CustomerData
): Promise<{ id: string; displayName: string } | null> {
    try {
        const input: any = {
            firstName: customer.firstName,
            lastName: customer.lastName,
        };

        if (customer.email) {
            input.email = customer.email;
        }

        if (customer.phone) {
            input.phone = customer.phone;
        }

        if (customer.address) {
            input.addresses = [{
                address1: customer.address.address1,
                city: customer.address.city,
                province: customer.address.province || "",
                zip: customer.address.zip || "",
                country: customer.address.country || "TR",
            }];
        }

        const response = await admin.graphql(`
      mutation customerCreate($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
            displayName
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
            variables: { input },
        });

        const data = await response.json();
        const result = data?.data?.customerCreate;

        if (result?.userErrors?.length > 0) {
            console.error("Müşteri oluşturma hatası:", result.userErrors);
            return null;
        }

        if (result?.customer) {
            return {
                id: result.customer.id,
                displayName: result.customer.displayName,
            };
        }

        return null;
    } catch (error) {
        console.error("Müşteri oluşturma hatası:", error);
        return null;
    }
}

/**
 * Müşteriyi bul veya oluştur
 */
export async function findOrCreateCustomer(
    admin: AdminGraphqlClient,
    customer: CustomerData
): Promise<{ id: string; displayName: string; isNew: boolean } | null> {
    // Önce email ile ara
    if (customer.email) {
        const existing = await findCustomerByEmail(admin, customer.email);
        if (existing) {
            return { ...existing, isNew: false };
        }
    }

    // Sonra telefon ile ara
    if (customer.phone) {
        const existing = await findCustomerByPhone(admin, customer.phone);
        if (existing) {
            return { ...existing, isNew: false };
        }
    }

    // Bulunamadıysa yeni oluştur
    const newCustomer = await createCustomer(admin, customer);
    if (newCustomer) {
        return { ...newCustomer, isNew: true };
    }

    return null;
}

/**
 * Draft Order oluştur (Ticimax siparişi için)
 */
export async function createDraftOrder(
    admin: AdminGraphqlClient,
    options: {
        customerId?: string;
        customerName: string;
        email?: string;
        phone?: string;
        lineItems: OrderLineItem[];
        note?: string;
        shippingAddress?: {
            address1: string;
            city: string;
            province?: string;
            zip?: string;
            country?: string;
            firstName: string;
            lastName: string;
            phone?: string;
        };
        tags?: string[];
    }
): Promise<DraftOrderResult> {
    try {
        const input: any = {
            note: options.note || `Ticimax'tan aktarıldı`,
            tags: options.tags || ["ticimax-import"],
            lineItems: options.lineItems.map(item => ({
                title: item.title,
                quantity: item.quantity,
                originalUnitPrice: item.priceSet.shopMoney.amount,
                sku: item.sku || "",
            })),
        };

        // Müşteri ID varsa ekle
        if (options.customerId) {
            input.customerId = options.customerId;
        }

        // E-posta varsa ekle (müşteri yoksa)
        if (options.email && !options.customerId) {
            input.email = options.email;
        }

        // Telefon varsa ekle
        if (options.phone && !options.customerId) {
            input.phone = options.phone;
        }

        // Teslimat adresi varsa ekle
        if (options.shippingAddress) {
            input.shippingAddress = {
                address1: options.shippingAddress.address1,
                city: options.shippingAddress.city,
                province: options.shippingAddress.province || "",
                zip: options.shippingAddress.zip || "",
                country: options.shippingAddress.country || "TR",
                firstName: options.shippingAddress.firstName,
                lastName: options.shippingAddress.lastName,
                phone: options.shippingAddress.phone || "",
            };
        }

        // Payload'ı logla
        console.log("Draft Order Input Payload:", JSON.stringify(input, null, 2));

        const response = await admin.graphql(`
      mutation draftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            name
            customer {
              id
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
            variables: { input },
        });

        const data = await response.json();
        const result = data?.data?.draftOrderCreate;

        if (result?.userErrors?.length > 0) {
            console.error("Draft order oluşturma hatası:", result.userErrors);
            return {
                success: false,
                error: result.userErrors.map((e: any) => e.message).join(", "),
            };
        }

        if (result?.draftOrder) {
            return {
                success: true,
                orderId: result.draftOrder.id,
                orderName: result.draftOrder.name,
                customerId: result.draftOrder.customer?.id,
            };
        }

        return {
            success: false,
            error: "Beklenmeyen hata oluştu",
        };
    } catch (error: any) {
        console.error("Draft order oluşturma hatası:", error);
        return {
            success: false,
            error: error.message || "Bilinmeyen hata",
        };
    }
}

/**
 * Draft Order'ı Complete et (gerçek siparişe çevir)
 */
export async function completeDraftOrder(
    admin: AdminGraphqlClient,
    draftOrderId: string
): Promise<{ success: boolean; orderId?: string; orderName?: string; error?: string }> {
    try {
        const response = await admin.graphql(`
      mutation draftOrderComplete($id: ID!) {
        draftOrderComplete(id: $id) {
          draftOrder {
            order {
              id
              name
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
            variables: { id: draftOrderId },
        });

        const data = await response.json();
        const result = data?.data?.draftOrderComplete;

        if (result?.userErrors?.length > 0) {
            return {
                success: false,
                error: result.userErrors.map((e: any) => e.message).join(", "),
            };
        }

        if (result?.draftOrder?.order) {
            return {
                success: true,
                orderId: result.draftOrder.order.id,
                orderName: result.draftOrder.order.name,
            };
        }

        return {
            success: false,
            error: "Sipariş oluşturulamadı",
        };
    } catch (error: any) {
        console.error("Draft order tamamlama hatası:", error);
        return {
            success: false,
            error: error.message || "Bilinmeyen hata",
        };
    }
}
