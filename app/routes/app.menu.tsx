
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useActionData, useNavigation } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Button, Text, TextField, Banner, Box, InlineStack, Divider, Modal, Tooltip, Icon } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { useState, useMemo, useEffect } from "react";
import { PlusIcon, DeleteIcon, SaveIcon, ImportIcon, SearchIcon, DragHandleIcon, ChevronDownIcon, ChevronRightIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// --- TYPES ---
// Flat item structure for DND
export type FlatItem = {
  id: string;
  title: string;
  handle: string;
  url: string;
  depth: number;
  parentId: string | null;
  index: number;
  collapsed?: boolean;
};

// --- LOADER ---
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Fetch Existing Menus
  let availableMenus = [];
  let debugInfo = {};
  try {
    const menusQuery = await admin.graphql(`
      query {
        menus(first: 100) {
          nodes {
            id
            title
            items {
              title
              url
              items {
                title
                url
                items {
                  title
                  url
                  items {
                    title
                    url
                  }
                }
              }
            }
          }
        }
      }
    `);
    const menusJson = await menusQuery.json();
    availableMenus = menusJson.data?.menus?.nodes || [];
    debugInfo = { status: "success", scopes: process.env.SCOPES };
  } catch (error) {
    debugInfo = { status: "error", message: error.message };
  }

  // 2. Fetch Saved Custom Menu Metafield (from SHOP, not AppInstallation)
  const metafieldQuery = await admin.graphql(
    `query {
      shop {
        metafield(namespace: "breadcrumb", key: "custom_menu") {
          value
        }
      }
    }`
  );

  const mfJson = await metafieldQuery.json();
  const metafieldValue = mfJson.data?.shop?.metafield?.value;

  let initialMenu = [];
  if (metafieldValue) {
    try {
      initialMenu = JSON.parse(metafieldValue);
    } catch (e) {
      console.error("Failed to parse menu JSON", e);
    }
  }

  return json({ initialMenu, availableMenus, debugInfo });
};

// --- ACTION ---
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const menuJson = formData.get("menuJson");

  // Get the SHOP ID (not App Installation) so Liquid can access via shop.metafields
  const shopQuery = await admin.graphql(`query { shop { id } }`);
  const shopResult = await shopQuery.json();
  const shopId = shopResult.data.shop.id;

  const response = await admin.graphql(
    `mutation CreateShopMetafield($metafieldsSetInput: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafieldsSetInput) {
        metafields {
          id
          namespace
          key
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafieldsSetInput: [
          {
            ownerId: shopId,
            namespace: "breadcrumb",
            key: "custom_menu",
            type: "json",
            value: menuJson
          }
        ]
      }
    }
  );

  const responseJson = await response.json();
  if (responseJson.data?.metafieldsSet?.userErrors?.length > 0) {
    return json({ status: "error", errors: responseJson.data.metafieldsSet.userErrors });
  }

  return json({ status: "success" });
};

// --- UTILS: TREE <-> FLAT ---

// Flatten a tree structure into a flat list
function flattenTree(items, parentId = null, depth = 0): FlatItem[] {
  return items.reduce((acc, item, index) => {
    const flatItem: FlatItem = {
      id: item.id,
      title: item.title,
      handle: item.handle,
      url: item.url,
      depth,
      parentId,
      index,
      collapsed: item.collapsed || false
    };
    return [
      ...acc,
      flatItem,
      ...(item.children ? flattenTree(item.children, item.id, depth + 1) : [])
    ];
  }, []);
}

// Convert flat list back to tree structure
function buildTree(flatItems: FlatItem[]) {
  const rootItems = [];
  const lookup = {};

  flatItems.forEach(item => {
    lookup[item.id] = { ...item, children: [] };
  });

  flatItems.forEach(item => {
    if (item.parentId === null) {
      rootItems.push(lookup[item.id]);
    } else {
      const parentItem = lookup[item.parentId];
      if (parentItem) {
        parentItem.children.push(lookup[item.id]);
      } else {
        // Orphaned item (shouldn't happen logic wise, but safety fallback: treat as root)
        rootItems.push(lookup[item.id]);
      }
    }
  });

  return rootItems;
}

// Projection logic for nesting drag
// Determine the new depth and parent based on horizontal offset
function getProjection(items: FlatItem[], activeId: string, overId: string, dragOffset: number, indentationWidth: number) {
  const overItemIndex = items.findIndex(({ id }) => id === overId);
  const activeItemIndex = items.findIndex(({ id }) => id === activeId);

  const activeItem = items[activeItemIndex];
  const newItems = arrayMove(items, activeItemIndex, overItemIndex);

  const previousItem = newItems[overItemIndex - 1];
  const nextItem = newItems[overItemIndex + 1];

  const dragDepth = Math.round(dragOffset / indentationWidth);
  const projectedDepth = activeItem.depth + dragDepth;

  const maxDepth = previousItem ? previousItem.depth + 1 : 0;
  const minDepth = nextItem ? nextItem.depth : 0; // Can't be shallower than next sibling's depth relative to new position logic roughly

  // Actually simpler logic for parent finding:
  // If we move item to index i:
  // Parent is the nearest item above i that has depth = projectedDepth - 1

  let depth = projectedDepth;
  if (depth > maxDepth) depth = maxDepth;
  if (depth < 0) depth = 0;

  // Find parent
  let parentId = null;
  if (depth > 0) {
    const parent = newItems.slice(0, overItemIndex).reverse().find(i => i.depth === depth - 1);
    parentId = parent ? parent.id : null;
  }

  return { depth, parentId };
}


// --- COMPONENTS ---

const SortableItem = ({ item, depth, indentationWidth, onCollapse, collapsed, onRemove, onEdit, onPicker, isOverlay }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    marginLeft: `${depth * indentationWidth}px`, // Visual indentation
    opacity: isDragging ? 0.5 : 1,
  };

  // If it's an overlay (drag preview), we force specific styles
  if (isOverlay) {
    return (
      <div style={{ ...style, marginLeft: 0, opacity: 1, zIndex: 999 }}>
        <ItemCard item={item} dragHandleProps={{}} collapsed={collapsed} onCollapse={onCollapse} isOverlay={true} />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <ItemCard
        item={item}
        dragHandleProps={listeners}
        collapsed={collapsed}
        onCollapse={onCollapse}
        onRemove={onRemove}
        onEdit={onEdit}
        onPicker={onPicker}
        isOverlay={false}
      />
    </div>
  );
};

const ItemCard = ({ item, dragHandleProps, collapsed, onCollapse, onRemove, onEdit, onPicker, isOverlay }) => {
  return (
    <Box paddingBlockEnd="200">
      <div style={{
        background: "#fff",
        border: "1px solid #e1e3e5",
        borderRadius: "8px",
        // boxShadow: isOverlay ? "0 4px 12px rgba(0,0,0,0.1)" : "0 1px 0 rgba(0,0,0,0.05)",
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: "12px"
      }}>
        {/* Drag Handle */}
        <div
          {...dragHandleProps}
          style={{ cursor: 'grab', color: '#5c5f62', display: 'flex', alignItems: 'center' }}
        >
          <Icon source={DragHandleIcon} tone="subdued" />
        </div>

        {/* Collapse Toggle */}
        <div style={{ width: '20px', display: 'flex', justifyContent: 'center' }}>
          {/* Logic to show chevron only if it has children? In flattened list hard to know efficiently without lookahead, but we can pass 'hasChildren' prop */}
          <div onClick={() => onCollapse && onCollapse(item.id)} style={{ cursor: 'pointer' }}>
            {collapsed ? <Icon source={ChevronRightIcon} tone="subdued" /> : <Icon source={ChevronDownIcon} tone="subdued" />}
          </div>
        </div>

        {/* Content Inputs */}
        <div style={{ flexGrow: 1 }}>
          <InlineStack gap="200">
            <div style={{ flex: 2 }}>
              <TextField
                label="Title"
                labelHidden
                value={item.title}
                onChange={(v) => onEdit && onEdit(item.id, 'title', v)}
                autoComplete="off"
                placeholder="Başlık"
                size="slim"
              />
            </div>
            <div style={{ flex: 3 }}>
              <InlineStack gap="100" wrap={false}>
                <div style={{ flexGrow: 1 }}>
                  <TextField
                    label="Link"
                    labelHidden
                    value={item.handle}
                    onChange={(v) => onEdit && onEdit(item.id, 'handle', v)}
                    autoComplete="off"
                    placeholder="Koleksiyon Handle"
                    size="slim"
                  />
                </div>
                <Button icon={SearchIcon} onClick={() => onPicker && onPicker(item.id)} size="slim" />
              </InlineStack>
            </div>
          </InlineStack>
        </div>

        {/* Actions */}
        <Button icon={DeleteIcon} tone="critical" variant="plain" onClick={() => onRemove && onRemove(item.id)} />
      </div>
    </Box>
  );
};


// --- MAIN PAGE ---

export default function MenuPage() {
  const { initialMenu, availableMenus, debugInfo } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const nav = useNavigation();
  const shopify = useAppBridge();
  const isSaving = nav.state === "submitting";

  // State for Flat Items
  const [activeId, setActiveId] = useState(null);
  const [items, setItems] = useState(() => flattenTree(initialMenu || []));

  // Collapse state map: { [id]: boolean }
  const [collapsedState, setCollapsedState] = useState({});

  const [importModalActive, setImportModalActive] = useState(false);
  const [importTargetId, setImportTargetId] = useState("");

  const indentationWidth = 30; // pixels per depth level

  // Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), // 5px movement to start drag
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // --- ACTIONS ---

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragMove = (event) => {
    // Optional: Real-time projection visual feedback could go here
  };

  const handleDragEnd = (event) => {
    const { active, over, delta } = event;
    setActiveId(null);

    // If dropped outside or no change effectively (ignoring depth for a moment)
    if (!active || !over) return;

    const activeId = active.id;
    const overId = over.id;

    // 1. Find the active item and its subtree block
    const oldIndex = items.findIndex(i => i.id === activeId);
    if (oldIndex === -1) return;

    const activeItem = items[oldIndex];

    // Identify Subtree: All valid items immediately following activeItem with depth > activeItem.depth
    let subtreeCount = 0;
    for (let i = oldIndex + 1; i < items.length; i++) {
      if (items[i].depth > activeItem.depth) {
        subtreeCount++;
      } else {
        break;
      }
    }

    // 2. Determine Target Location
    // We are essentially moving the block [oldIndex, oldIndex + 1 + subtreeCount]
    // To a new positions.
    // If activeId !== overId, we are reordering.

    // Logic for reordering with dnd-kit's "over":
    // "over" is the item we are hovering over.
    // If we move the block, where does it go relative to "over"?
    // Standard Sortable logic: 
    // If moving down (oldIndex < overIndex), usually goes AFTER over.
    // If moving up (oldIndex > overIndex), usually goes BEFORE over.

    let overIndex = items.findIndex(i => i.id === overId);
    // Note: overIndex might be inside our own subtree if we drag into ourselves (should be impossible with standard sensors, but safety check)
    if (overIndex > oldIndex && overIndex <= oldIndex + subtreeCount) {
      // Dragging into own child? Invalid operation usually.
      return;
    }

    // Determine "Insertion Index" in the list *assuming the block is removed*.
    // It's easier to think: We remove the block. Then we insert it.
    // But we need to know where "over" ends up after removal.

    // Let's create `validItems` = items without the moving block.
    const movingBlock = items.slice(oldIndex, oldIndex + 1 + subtreeCount);
    const remainingItems = [...items];
    remainingItems.splice(oldIndex, 1 + subtreeCount);

    // Find 'over' in remainingItems (if active !== over)
    let insertionIndex = -1;

    if (activeId === overId) {
      // Dropped in place (vertically). Insertion index is same as oldIndex (relative to removed list.. wait)
      // If we removed it from oldIndex, we put it back at oldIndex.
      insertionIndex = oldIndex;
    } else {
      // Find index of overId in remainingItems
      const overIndexInRemaining = remainingItems.findIndex(i => i.id === overId);

      if (overIndexInRemaining === -1) {
        // Should not happen unless over was in moving block
        return;
      }

      // Decide before or after
      // If we moved down (oldIndex < originalOverIndex), we probably want to appear AFTER the over item.
      // If we moved up, we want to appear AT the over item index (pushing it down).

      // Let's look at original indices
      const originalOverIndex = items.findIndex(i => i.id === overId);

      if (oldIndex < originalOverIndex) {
        // Moved down. Insert after over.
        insertionIndex = overIndexInRemaining + 1;
      } else {
        // Moved up. Insert at over.
        insertionIndex = overIndexInRemaining;
      }
    }

    // 3. depth Projection
    const dragDepth = Math.round(delta.x / indentationWidth);
    let projectedDepth = activeItem.depth + dragDepth;

    // Constrain depth
    // Look at previous item at insertion point
    const prevItem = remainingItems[insertionIndex - 1];
    const maxDepth = prevItem ? prevItem.depth + 1 : 0;

    if (projectedDepth > maxDepth) projectedDepth = maxDepth;
    if (projectedDepth < 0) projectedDepth = 0;

    // Calculate Diff
    const depthDiff = projectedDepth - activeItem.depth;

    // 4. Update Block
    // Find new parent for head
    let newParentId = null;
    if (projectedDepth > 0) {
      for (let i = insertionIndex - 1; i >= 0; i--) {
        if (remainingItems[i].depth === projectedDepth - 1) {
          newParentId = remainingItems[i].id;
          break;
        }
      }
    }

    const updatedBlock = movingBlock.map((item, idx) => {
      if (idx === 0) {
        return { ...item, depth: projectedDepth, parentId: newParentId };
      }
      return { ...item, depth: item.depth + depthDiff };
    });

    // 5. Merge
    const newItems = [...remainingItems];
    newItems.splice(insertionIndex, 0, ...updatedBlock);

    setItems(newItems);
  };

  const handleEdit = (id, field, value) => {
    setItems(items => items.map(item => {
      if (item.id === id) {
        const updates = { [field]: value };
        if (field === 'handle') {
          // Smart URL detection - preserve user input, only compute URL
          let url = value;

          // Case 1: Full collection URL pasted
          if (value.includes('/collections/')) {
            const handle = value.split('/collections/')[1].split('/')[0].split('?')[0];
            url = `/collections/${handle}`;
          }
          // Case 2: Page URL (e.g., /pages/bisiklet or pages/bisiklet)
          else if (value.includes('/pages/') || value.includes('pages/')) {
            const handle = value.replace(/^.*pages\//, '');
            url = `/pages/${handle}`;
          }
          // Case 3: Absolute URL (external link)
          else if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('#')) {
            url = value;
          }
          // Case 4: Just a handle (assume collection)
          else if (value.trim() !== '') {
            url = `/collections/${value.replace(/^\//, '')}`;
          }

          // IMPORTANT: Keep original value user typed (don't modify handle)
          updates.handle = value;
          updates.url = url;
        }
        return { ...item, ...updates };
      }
      return item;
    }));
  };

  const handleResourcePicker = async (id) => {
    const selected = await shopify.resourcePicker({ type: 'collection', multiple: false });
    if (selected) {
      const col = selected[0];
      handleEdit(id, 'handle', col.handle); // logic above handles url update
      handleEdit(id, 'title', col.title);
    }
  };

  const handleRemove = (id) => {
    // Remove item and its children
    // 1. Find item and its depth
    const index = items.findIndex(i => i.id === id);
    if (index === -1) return;

    const item = items[index];
    // 2. Find all subsequent items with depth > item.depth (until depth <= item.depth)
    let count = 1;
    for (let i = index + 1; i < items.length; i++) {
      if (items[i].depth > item.depth) {
        count++;
      } else {
        break;
      }
    }

    const newItems = [...items];
    newItems.splice(index, count);
    setItems(newItems);
  };

  const handleAddItem = () => {
    const newItem: FlatItem = {
      id: Date.now().toString(),
      title: "Yeni Başlık",
      handle: "",
      url: "",
      depth: 0,
      parentId: null,
      index: items.length
    };
    setItems([...items, newItem]);
  };

  // Ensure the tree structure is valid based on visual depth before saving
  const enforceHierarchy = (currentItems) => {
    // We clone to avoid mutation during iterate (though we map)
    // We strictly assume: Parent of item at index i is the nearest preceding item with depth < item.depth
    // Actually strict rule: Parent must have depth == item.depth - 1
    // If there is a gap (e.g. 0 -> 2), we force depth down.

    // We'll reset depths to be valid too? 
    // Yes, a valid tree cannot have depth jumps > 1.

    const validatedItems = [];

    currentItems.forEach((item, index) => {
      // 1. Constraint Depth
      // First item must be 0
      let validDepth = item.depth;
      if (index === 0) {
        validDepth = 0;
      } else {
        const prev = validatedItems[index - 1];
        // Max depth is prev.depth + 1
        if (validDepth > prev.depth + 1) {
          validDepth = prev.depth + 1;
        }
        // Min depth is 0
        if (validDepth < 0) validDepth = 0;
      }

      // 2. Find Parent
      let parentId = null;
      if (validDepth > 0) {
        // Find closest item above with depth == validDepth - 1
        for (let k = index - 1; k >= 0; k--) {
          if (validatedItems[k].depth === validDepth - 1) {
            parentId = validatedItems[k].id;
            break;
          }
        }
      }

      validatedItems.push({ ...item, depth: validDepth, parentId });
    });

    return validatedItems;
  };

  const handleSave = () => {
    const cleanItems = enforceHierarchy(items);
    // Optimistically update state to reflect cleaned structure (e.g. fix visual gaps)
    setItems(cleanItems);

    const tree = buildTree(cleanItems);
    submit({ menuJson: JSON.stringify(tree) }, { method: "post" });
  };

  // --- IMPORT LOGIC ---
  const parseShopifyMenuItem = (item) => {
    let handle = "";
    if (item.url && item.url.includes('/collections/')) {
      handle = item.url.split('/collections/')[1].split('/')[0];
    }
    return {
      id: Date.now().toString() + Math.random().toString(),
      title: item.title,
      handle: handle,
      url: item.url,
      children: item.items ? item.items.map(parseShopifyMenuItem) : []
    };
  };

  const handleImportMenu = (shopifyMenu) => {
    const newStructure = shopifyMenu.items.map(parseShopifyMenuItem);

    // We need to flatten this new structure and append it
    // If targetId is set, we need to find that item, append to its children (which means inserting into array after its last child, and adjusting depths)

    let parentDepth = 0;
    let insertionIndex = items.length;
    let parentId = null;

    if (importTargetId) {
      const targetIndex = items.findIndex(i => i.id === importTargetId);
      if (targetIndex !== -1) {
        const target = items[targetIndex];
        parentId = target.id;
        parentDepth = target.depth + 1;

        // Find insertion point: after target and all its current children
        let i = targetIndex + 1;
        while (i < items.length && items[i].depth > target.depth) {
          i++;
        }
        insertionIndex = i;
      }
    }

    // Helper to flatten imported structure with correct initial depth/parent
    const flattenImport = (list, pId, startDepth) => {
      let res = [];
      list.forEach(item => {
        const flatItem = {
          id: item.id,
          title: item.title,
          handle: item.handle,
          url: item.url,
          depth: startDepth,
          parentId: pId,
          index: 0, // irrelevant during merge
          collapsed: false
        };
        res.push(flatItem);
        if (item.children) {
          res = res.concat(flattenImport(item.children, item.id, startDepth + 1));
        }
      });
      return res;
    };

    const flatNewItems = flattenImport(newStructure, parentId, parentDepth);

    const newItemsList = [...items];
    newItemsList.splice(insertionIndex, 0, ...flatNewItems);
    setItems(newItemsList);
    setImportModalActive(false);
  };

  const activeItem = activeId ? items.find(i => i.id === activeId) : null;

  // Filtering for visual display (Collapse Logic)
  // We don't remove from DOM for DND to work best, usually we hide them.
  // Or better: filter `items` passed to generic rendering BUT DndKit `items` prop needs to match.
  // For simplicity, let's just render all for now, collapse is visual hiding.

  const visibleItemIds = useMemo(() => {
    // Logic: If parent is collapsed, child is hidden.
    // We traverse list top to bottom.
    const visibleSet = new Set();
    // const collapsedSet = new Set(); // IDs that are collapsed

    // Initial root items are visible
    // This requires sequential scan
    let hiddenDepth = -1; // -1 means showing. if >= 0, we are hiding everything > hiddenDepth

    // Wait, simpler:
    // Loop items. Maintain a stack of "is collapsed".
    // Actually, standard approach:
    // If an item is collapsed, all its descendants are hidden.

    // Let's just create a list of IDs to render.
    // DND sortable context requires ALL ids if we want to drag into hidden areas? No, typically we only drag visible.

    // TODO: Collapsing + DND is tricky. Let's implementing Sortable Context only on visible items.

    const visible = [];
    let skipUntilDepth = -1;

    for (const item of items) {
      if (skipUntilDepth !== -1) {
        if (item.depth > skipUntilDepth) {
          continue; // Skip child of collapsed parent
        } else {
          skipUntilDepth = -1; // Reset
        }
      }

      visible.push(item);

      if (collapsedState[item.id]) {
        skipUntilDepth = item.depth;
      }
    }
    return visible.map(i => i.id);
  }, [items, collapsedState]);


  return (
    <Page
      title="Menü Düzenleyici (Sürükle & Bırak)"
      primaryAction={{ content: "Kaydet", onAction: handleSave, loading: isSaving, icon: SaveIcon }}
      secondaryActions={[{ content: "İçe Aktar", icon: ImportIcon, onAction: () => setImportModalActive(true) }]}
    >
      <Layout>
        <Layout.Section>
          {actionData?.status === 'success' && (
            <Box paddingBlockEnd="400"><Banner tone="success">Kaydedildi</Banner></Box>
          )}

          <Card>
            <BlockStack gap="400">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={visibleItemIds}
                  strategy={verticalListSortingStrategy}
                >
                  <div style={{ minHeight: '200px' }}>
                    {items.map(item => {
                      // Only render if visible (handle collapse logic)
                      // We replicate the visibility logic simply:
                      if (!visibleItemIds.includes(item.id)) return null;

                      return (
                        <SortableItem
                          key={item.id}
                          item={item}
                          depth={item.depth}
                          indentationWidth={indentationWidth}
                          collapsed={collapsedState[item.id]}
                          onCollapse={() => setCollapsedState(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                          onEdit={handleEdit}
                          onRemove={handleRemove}
                          onPicker={handleResourcePicker}
                          isOverlay={false}
                        />
                      );
                    })}
                  </div>
                </SortableContext>

                <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }) }}>
                  {activeItem ? (
                    <SortableItem
                      item={activeItem}
                      depth={0} // Overlay usually 0 or relative
                      indentationWidth={indentationWidth}
                      isOverlay={true}
                      collapsed={collapsedState[activeItem.id]} // Keep state visual
                    />
                  ) : null}
                </DragOverlay>
              </DndContext>

              <Button fullWidth onClick={handleAddItem} variant="primary" icon={PlusIcon}>Yeni Ekle</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* IMPORT MODAL */}
      <Modal open={importModalActive} onClose={() => setImportModalActive(false)} title="Menü İçe Aktar">
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">İçe aktarmak için bir menü seçin.</Text>
            <div style={{ marginBottom: '1rem' }}>
              <RequestSelect
                label="Hedef"
                options={[{ label: "Ana Dizin", value: "" }, ...items.map(i => ({ label: "-".repeat(i.depth) + " " + i.title, value: i.id }))]}
                value={importTargetId}
                onChange={setImportTargetId}
              />
            </div>
            {availableMenus.map(menu => (
              <Box key={menu.id} padding="200" background="bg-surface-secondary" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" fontWeight="bold">{menu.title}</Text>
                  <Button onClick={() => handleImportMenu(menu)}>İçe Aktar</Button>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// Wrapper for Select to avoid import issues if any
const RequestSelect = ({ label, options, value, onChange }) => {
  return (
    <div className="Polaris-FormLayout__Item">
      <div className="Polaris-Labelled__LabelWrapper">
        <div className="Polaris-Label">
          <label className="Polaris-Label__Text">{label}</label>
        </div>
      </div>
      <div className="Polaris-Select">
        <select className="Polaris-Select__Input" value={value} onChange={e => onChange(e.target.value)}>
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="Polaris-Select__Content" aria-hidden="true">
          <span className="Polaris-Select__SelectedOption">{options.find(o => o.value === value)?.label}</span>
          <span className="Polaris-Select__Icon">
            <span className="Polaris-Icon">
              <svg viewBox="0 0 20 20" className="Polaris-Icon__Svg" focusable="false" aria-hidden="true"><path d="M7.676 9h4.648c.563 0 .879-.603.53-1.014l-2.323-2.746a.708.708 0 0 0-1.062 0l-2.324 2.746c-.347.411-.032 1.014.531 1.014Zm4.648 2h-4.648c-.563 0-.878.603-.53 1.014l2.323 2.746c.27.32.792.32 1.062 0l2.323-2.746c.349-.411.033-1.014-.53-1.014Z"></path></svg>
            </span>
          </span>
        </div>
        <div className="Polaris-Select__Backdrop"></div>
      </div>
    </div>
  );
}
