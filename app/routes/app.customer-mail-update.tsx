
import { useState, useEffect } from "react";
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useSearchParams } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    TextField,
    IndexTable,
    useIndexResourceState,
    Button,
    Banner,
    BlockStack,
    Text,
    InlineStack,
    Spinner,
    Pagination
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// Recursive function to fetch all customers
async function fetchAllCustomers(admin: any, query: string | null, cursor: string | null = null, accumulatedCustomers: any[] = []): Promise<any[]> {
    const response = await admin.graphql(
        `#graphql
        query getCustomers($first: Int!, $after: String, $query: String) {
          customers(first: $first, after: $after, query: $query, reverse: true) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                firstName
                lastName
                email
              }
            }
          }
        }
      `,
        {
            variables: {
                first: 250, // Max limit per request
                after: cursor,
                query: query
            }
        }
    );

    const responseJson = await response.json();
    const { edges, pageInfo } = responseJson.data.customers;

    const newCustomers = edges.map((edge: any) => edge.node);
    const allCustomers = [...accumulatedCustomers, ...newCustomers];

    if (pageInfo.hasNextPage) {
        // Recursive call (Warning: heavy for huge datasets, but requested for ~3500)
        return fetchAllCustomers(admin, query, pageInfo.endCursor, allCustomers);
    }

    return allCustomers;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const q = url.searchParams.get("q");

    // Build search query if q exists
    let searchQuery = null;
    if (q) {
        searchQuery = `email:*${q}* OR first_name:*${q}* OR last_name:*${q}*`;
    }

    const customers = await fetchAllCustomers(admin, searchQuery);

    return json({
        customers,
        totalCount: customers.length
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const actionType = formData.get("actionType") as string; // 'add' or 'remove'
    const customString = formData.get("customString") as string;
    const customerIdsString = formData.get("customerIds") as string;

    if (!customString || !customerIdsString) {
        return json({ status: "error", message: "Eksik bilgi.", updatedCount: 0, errors: [] });
    }

    const targets = JSON.parse(customerIdsString);
    let updatedCount = 0;
    let errors: any[] = [];

    for (const target of targets) {
        const { id, email } = target;
        if (!email) continue;

        let newEmail = email;

        if (actionType === "add") {
            // Prevent double adding if possible, or just force add
            if (email.length >= 3) {
                newEmail = email.substring(0, 3) + customString + email.substring(3);
            }
        } else if (actionType === "remove") {
            // Remove ALL occurrences of the custom string
            newEmail = email.replaceAll(customString, "");
        }

        if (newEmail === email) continue; // No change needed

        try {
            const response = await admin.graphql(
                `#graphql
              mutation customerUpdate($input: CustomerInput!) {
                customerUpdate(input: $input) {
                  customer {
                    id
                    email
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `,
                {
                    variables: {
                        input: {
                            id: id,
                            email: newEmail
                        }
                    }
                }
            );

            const result = await response.json();
            if (result.data?.customerUpdate?.userErrors?.length > 0) {
                errors.push({ id, message: result.data.customerUpdate.userErrors[0].message });
            } else {
                updatedCount++;

                // --- DRAFT ORDER UPDATE START ---
                try {
                    // 1. Find open draft orders for this customer
                    const draftResponse = await admin.graphql(
                        `#graphql
                    query getDraftOrders($query: String) {
                        draftOrders(first: 50, query: $query) {
                            edges {
                                node {
                                    id
                                }
                            }
                        }
                    }`,
                        {
                            variables: {
                                query: `customer_id:${id.split('/').pop()} AND status:open`
                            }
                        }
                    );
                    const draftJson = await draftResponse.json();
                    const draftOrders = draftJson.data.draftOrders.edges;

                    // 2. Update each draft order
                    for (const draftEdge of draftOrders) {
                        const draftId = draftEdge.node.id;
                        await admin.graphql(
                            `#graphql
                        mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
                            draftOrderUpdate(id: $id, input: $input) {
                                userErrors {
                                    field
                                    message
                                }
                            }
                        }`,
                            {
                                variables: {
                                    id: draftId,
                                    input: {
                                        email: newEmail
                                    }
                                }
                            }
                        );
                    }
                } catch (draftErr) {
                    console.error("Draft order update error:", draftErr);
                    // We don't block the valid customer update, but maybe log it?
                }
                // --- DRAFT ORDER UPDATE END ---
            }
        } catch (err) {
            errors.push({ id, message: (err as Error).message });
        }
    }

    return json({ status: "success", updatedCount, errors, actionType });
};

export default function CustomerMailUpdate() {
    const { customers, totalCount } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const actionData = useActionData<typeof action>();
    const [searchParams, setSearchParams] = useSearchParams();

    const [customString, setCustomString] = useState("");
    const [queryValue, setQueryValue] = useState(searchParams.get("q") || "");

    const resourceName = {
        singular: 'customer',
        plural: 'customers',
    };

    const { selectedResources, allResourcesSelected, handleSelectionChange } =
        useIndexResourceState(customers);

    const isLoading = navigation.state === "submitting" || navigation.state === "loading";

    // Search Debounce/Submit
    const handleQueryChange = (value: string) => {
        setQueryValue(value);
    };

    const handleSearch = () => {
        if (queryValue) {
            setSearchParams({ q: queryValue });
        } else {
            setSearchParams({});
        }
    };

    const handleClearSearch = () => {
        setQueryValue("");
        setSearchParams({});
    };

    const handleUpdate = (type: "add" | "remove") => {
        if (!customString) {
            alert("Lütfen metin girin.");
            return;
        }

        if (selectedResources.length === 0) {
            alert("Lütfen en az bir müşteri seçin.");
            return;
        }

        const actionName = type === "add" ? "eklenecek" : "silinecek";
        if (!confirm(`${selectedResources.length} müşteri için toplu işlem: "${customString}" metni ${actionName}. Onaylıyor musunuz?`)) return;

        const targets = selectedResources.map(id => {
            const customer = customers.find((c: any) => c.id === id);
            return { id, email: customer.email };
        });

        const formData = new FormData();
        formData.append("actionType", type);
        formData.append("customString", customString);
        formData.append("customerIds", JSON.stringify(targets));

        submit(formData, { method: "post" });
    };

    const rowMarkup = customers.map(
        ({ id, firstName, lastName, email }, index) => (
            <IndexTable.Row
                id={id}
                key={id}
                selected={selectedResources.includes(id)}
                position={index}
            >
                <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="bold" as="span">
                        {firstName} {lastName}
                    </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>{email}</IndexTable.Cell>
                <IndexTable.Cell>
                    {customString && email ? (
                        <span style={{ color: 'gray' }}>
                            {/* Basit önizleme mantığı, regex olmadan */}
                            {email.includes(customString) ? (
                                <>
                                    {email.split(customString).map((part, i, arr) => (
                                        <span key={i}>
                                            {part}
                                            {i < arr.length - 1 && <strong style={{ color: 'red', textDecoration: 'line-through' }}>{customString}</strong>}
                                        </span>
                                    ))}
                                    {' -> [Silinecek]'}
                                </>
                            ) : (
                                <>
                                    {email.substring(0, 3)}
                                    <strong style={{ color: 'green' }}>{customString}</strong>
                                    {email.substring(3)}
                                    {' -> [Eklenecek]'}
                                </>
                            )}
                        </span>
                    ) : '-'}
                </IndexTable.Cell>
            </IndexTable.Row>
        ),
    );

    return (
        <Page title={`Müşteri Mail Güncelleme (${totalCount} Müşteri)`}>
            <BlockStack gap="500">
                {actionData?.status === "success" && (
                    <Banner tone="success">
                        {actionData.updatedCount} işlem başarıyla tamamlandı.
                        {actionData.errors?.length > 0 && ` (${actionData.errors.length} hata)`}
                    </Banner>
                )}

                <Card>
                    <BlockStack gap="400">
                        <Text as="p" variant="bodyMd">
                            Tüm müşteriler çekilmektedir (Sınırsız). Müşterileri aratabilir ve seçili olanlara toplu işlem yapabilirsiniz.
                        </Text>

                        <InlineStack gap="300" align="start">
                            <div style={{ flex: 1 }}>
                                <TextField
                                    label="Aranacak Kelime (İsim veya Email)"
                                    value={queryValue}
                                    onChange={handleQueryChange}
                                    autoComplete="off"
                                    clearButton
                                    onClearButtonClick={handleClearSearch}
                                />
                            </div>
                            <div style={{ marginTop: '28px' }}>
                                <Button onClick={handleSearch} loading={isLoading}>Ara</Button>
                            </div>
                        </InlineStack>

                        <hr style={{ borderColor: '#eee' }} />

                        <TextField
                            label="İşlem Yapılacak Metin (Ekle/Kaldır)"
                            value={customString}
                            onChange={setCustomString}
                            autoComplete="off"
                            placeholder="Örn: _GECERSIZ_"
                            helpText="Bu metin mail adresine eklenecek veya mail adresinden silinecektir."
                        />

                        <InlineStack gap="300" align="end">
                            <Button tone="critical" onClick={() => handleUpdate("remove")} loading={isLoading} disabled={!customString || selectedResources.length === 0}>
                                Metni Kaldır (Geri Al)
                            </Button>
                            <Button variant="primary" onClick={() => handleUpdate("add")} loading={isLoading} disabled={!customString || selectedResources.length === 0}>
                                Metni Ekle (Boz)
                            </Button>
                        </InlineStack>
                    </BlockStack>
                </Card>

                <Card>
                    <IndexTable
                        resourceName={resourceName}
                        itemCount={customers.length}
                        selectedItemsCount={
                            allResourcesSelected ? 'All' : selectedResources.length
                        }
                        onSelectionChange={handleSelectionChange}
                        headings={[
                            { title: 'Ad Soyad' },
                            { title: 'Mevcut Email' },
                            { title: 'İşlem Önizleme' },
                        ]}
                    >
                        {rowMarkup}
                    </IndexTable>
                </Card>
            </BlockStack>
        </Page>
    );
}
