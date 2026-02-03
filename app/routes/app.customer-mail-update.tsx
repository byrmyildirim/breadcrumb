
import { useState } from "react";
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(
        `#graphql
      query getCustomers {
        customers(first: 50, reverse: true) {
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
    `
    );

    const responseJson = await response.json();
    return json({
        customers: responseJson.data.customers.edges.map((edge: any) => edge.node),
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

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
        if (!email || email.length < 3) continue;

        const newEmail = email.substring(0, 3) + customString + email.substring(3);

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
            }
        } catch (err) {
            errors.push({ id, message: (err as Error).message });
        }
    }

    return json({ status: "success", updatedCount, errors });
};

export default function CustomerMailUpdate() {
    const { customers } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const actionData = useActionData<typeof action>();

    const [customString, setCustomString] = useState("");

    const resourceName = {
        singular: 'customer',
        plural: 'customers',
    };

    const { selectedResources, allResourcesSelected, handleSelectionChange } =
        useIndexResourceState(customers);

    const isLoading = navigation.state === "submitting";

    const handleUpdate = () => {
        if (!customString) {
            alert("Lütfen eklenecek metni girin.");
            return;
        }

        if (selectedResources.length === 0) {
            alert("Lütfen en az bir müşteri seçin.");
            return;
        }

        if (!confirm(`${selectedResources.length} müşterinin maili güncellenecek. Onaylıyor musunuz?`)) return;

        const targets = selectedResources.map(id => {
            const customer = customers.find((c: any) => c.id === id);
            return { id, email: customer.email };
        });

        const formData = new FormData();
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
                    {customString && email && email.length >= 3 ? (
                        <span style={{ color: 'gray' }}>
                            {email.substring(0, 3)}
                            <strong style={{ color: 'red' }}>{customString}</strong>
                            {email.substring(3)}
                        </span>
                    ) : '-'}
                </IndexTable.Cell>
            </IndexTable.Row>
        ),
    );

    return (
        <Page title="Müşteri Mail Güncelleme (Toplu)">
            <BlockStack gap="500">
                {actionData?.status === "success" && (
                    <Banner tone="success">
                        {actionData.updatedCount} müşteri başarıyla güncellendi.
                        {actionData.errors?.length > 0 && ` (${actionData.errors.length} hata)`}
                    </Banner>
                )}

                <Card>
                    <BlockStack gap="400">
                        <Text as="p" variant="bodyMd">
                            Seçili müşterilerin mail adreslerinin 3. karakterinden sonrasına girdiğiniz metni ekler.
                            Böylece sistemden bu müşterilere mail gitmesi engellenmiş olur (Email geçersiz hale gelir veya size ait olmayan bir adrese döner).
                        </Text>

                        <TextField
                            label="Eklenecek Metin"
                            value={customString}
                            onChange={setCustomString}
                            autoComplete="off"
                            placeholder="Örn: _GECERSIZ_"
                        />

                        <div style={{ textAlign: 'right' }}>
                            <Button variant="primary" onClick={handleUpdate} loading={isLoading} disabled={!customString}>
                                Toplu Düzenle ({selectedResources.length})
                            </Button>
                        </div>
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
                            { title: 'Önizleme' },
                        ]}
                    >
                        {rowMarkup}
                    </IndexTable>
                </Card>
            </BlockStack>
        </Page>
    );
}
