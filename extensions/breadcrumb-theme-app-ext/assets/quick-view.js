// ========== QUICK VIEW MODAL LOGIC ==========
document.addEventListener("DOMContentLoaded", function () {
    const modal = document.getElementById('quick-view-modal');
    if (!modal) return;

    const overlay = modal.querySelector('.qv-overlay');
    const closeBtns = modal.querySelectorAll('[data-close]');
    let currentProduct = null;
    let currentImages = [];
    let currentImageIndex = 0;

    // --- Image Slider Logic ---
    const imgEl = document.getElementById('qv-main-image');
    const prevBtn = document.getElementById('qv-prev-btn');
    const nextBtn = document.getElementById('qv-next-btn');

    function updateMainImage(index) {
        if (!currentImages || currentImages.length === 0) return;
        if (index < 0) index = currentImages.length - 1;
        if (index >= currentImages.length) index = 0;
        currentImageIndex = index;

        let src = currentImages[currentImageIndex];
        if (src.startsWith('//')) src = 'https:' + src;
        imgEl.src = src;
    }

    if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); updateMainImage(currentImageIndex - 1); };
    if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); updateMainImage(currentImageIndex + 1); };


    // --- Click Listener ---
    const triggerSelector = modal.dataset.triggerSelector || '.js-quick-view-trigger';

    document.body.addEventListener('click', (e) => {
        let trigger = e.target.closest(triggerSelector);
        if (!trigger) {
            const link = e.target.closest('a[href*="/products/"]');
            if (link && (link.classList.contains('js-quick-view-trigger') || link.dataset.quickView)) {
                trigger = link;
            }
        }

        if (trigger) {
            e.preventDefault(); e.stopPropagation();
            let handle = trigger.dataset.productHandle;
            if (!handle && trigger.href) {
                const parts = trigger.href.split('/products/');
                if (parts.length > 1) handle = parts[1].split('?')[0];
            }
            if (!handle && trigger.dataset.url) {
                const parts = trigger.dataset.url.split('/products/');
                if (parts.length > 1) handle = parts[1].split('?')[0];
            }
            if (handle) {
                openModal(handle);
            }
        }
    });

    closeBtns.forEach(b => b.addEventListener('click', closeModal));
    overlay.addEventListener('click', closeModal);

    // Drag handle close logic
    const dragHandle = modal.querySelector('.qv-drag-handle');
    if (dragHandle) dragHandle.addEventListener('click', closeModal);

    function openModal(handle) {
        modal.classList.add('open');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        modal.querySelector('.qv-loading').style.display = 'flex';
        modal.querySelector('.qv-body').style.display = 'none';

        fetch(`/products/${handle}.js`)
            .then(res => res.json())
            .then(renderProduct)
            .catch(err => { console.error(err); closeModal(); });
    }

    // Make openModal available globally for color indicators
    window.qvOpenModal = openModal;

    function closeModal() {
        modal.classList.remove('open');
        setTimeout(() => { if (!modal.classList.contains('open')) modal.style.display = 'none'; }, 200);
        document.body.style.overflow = '';
        currentProduct = null;
        currentImages = [];
    }

    function renderProduct(product) {
        currentProduct = product;

        // Images (All)
        currentImages = product.images || [product.featured_image];
        currentImageIndex = 0;
        updateMainImage(0);

        if (currentImages.length > 1) {
            prevBtn.style.display = 'flex';
            nextBtn.style.display = 'flex';
        } else {
            prevBtn.style.display = 'none';
            nextBtn.style.display = 'none';
        }

        // Basic Info
        const vendorText = product.vendor;
        const titleText = product.title;
        const productUrl = product.url;

        // UPDATE DETAILS BUTTON HREF
        const detailsBtn = document.getElementById('qv-details-btn');
        if (detailsBtn) detailsBtn.href = productUrl;

        // Desktop
        document.getElementById('qv-vendor').textContent = vendorText;
        document.getElementById('qv-title').textContent = titleText;

        // Mobile
        document.getElementById('qv-vendor-mob').textContent = vendorText;
        document.getElementById('qv-title-mob').textContent = titleText;

        // Initial Mobile Image
        let mobImg = product.featured_image || '';
        if (mobImg.startsWith('//')) mobImg = 'https:' + mobImg;
        document.getElementById('qv-mobile-image').src = mobImg;

        // Delivery
        const d1 = new Date(); d1.setDate(d1.getDate() + 3);
        const d2 = new Date(); d2.setDate(d2.getDate() + 6);
        const opts = { day: '2-digit', month: 'long' };
        let dateStr = `${d1.toLocaleDateString('tr-TR', opts)} - ${d2.toLocaleDateString('tr-TR', opts)}`;
        document.getElementById('qv-delivery-date').textContent = dateStr;

        // Options
        const container = document.getElementById('qv-options');
        container.innerHTML = '';

        product.options.forEach((option, idx) => {
            const group = document.createElement('div');
            group.className = 'qv-option-group';
            if (option.name === 'Title' && option.values[0] === 'Default Title') group.classList.add('hidden');

            const header = document.createElement('div');
            header.className = 'qv-option-header';
            header.innerHTML = `${option.name}: <span class="qv-active-val" id="opt-txt-${idx}">-</span>`;
            group.appendChild(header);

            const row = document.createElement('div');
            row.className = 'qv-swatch-container';
            option.values.forEach(val => {
                const btn = document.createElement('div');
                btn.className = 'qv-swatch-rect';
                btn.textContent = val;
                btn.dataset.value = val;
                btn.dataset.index = idx;
                btn.onclick = () => selectOption(idx, val);
                row.appendChild(btn);
            });
            group.appendChild(row);

            container.appendChild(group);
        });

        // Select First Available
        const firstAvailable = product.variants.find(v => v.available) || product.variants[0];
        if (firstAvailable) updateVariant(firstAvailable);

        modal.querySelector('.qv-loading').style.display = 'none';
        modal.querySelector('.qv-body').style.display = 'flex';
    }

    function selectOption(idx, val) {
        const group = document.querySelectorAll('.qv-option-group')[idx];
        const txt = document.getElementById(`opt-txt-${idx}`);
        if (txt) txt.textContent = val;

        group.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
        const btn = group.querySelector(`.qv-swatch-rect[data-value="${CSS.escape(val)}"]`);
        if (btn) btn.classList.add('selected');

        // Resolve Variant
        const selectedMap = {};
        document.querySelectorAll('.qv-option-group').forEach((g, i) => {
            if (g.classList.contains('hidden')) {
                selectedMap[i] = "Default Title";
            } else {
                const sel = g.querySelector('.selected');
                if (sel) selectedMap[i] = sel.dataset.value;
            }
        });

        const matched = currentProduct.variants.find(v => {
            return v.options.every((opt, i) => {
                const g = document.querySelectorAll('.qv-option-group')[i];
                if (g.classList.contains('hidden')) return true;
                return opt === selectedMap[i];
            });
        });

        if (matched) updateVariant(matched);
        else setUnavailable();
    }

    function updateVariant(variant) {
        document.getElementById('qv-variant-id').value = variant.id;

        const p = formatMoney(variant.price);
        const cp = variant.compare_at_price > variant.price ? formatMoney(variant.compare_at_price) : '';

        document.querySelectorAll('.qv-price').forEach(el => el.innerHTML = p);
        document.querySelectorAll('.qv-compare-price').forEach(el => el.innerHTML = cp);

        const btn = document.getElementById('qv-add-btn');

        // Zero Price Guard
        if (variant.price === 0) {
            btn.disabled = true;
            btn.textContent = "FİYAT ALINIZ";
            btn.style.backgroundColor = "#ccc";
        } else if (variant.available) {
            btn.disabled = false;
            btn.textContent = "SEPETE EKLE";
            btn.style.backgroundColor = "";
        } else {
            btn.disabled = true;
            btn.textContent = "TÜKENDİ";
            btn.style.backgroundColor = "";
        }

        variant.options.forEach((val, idx) => {
            const txt = document.getElementById(`opt-txt-${idx}`);
            if (txt) txt.textContent = val;
            const group = document.querySelectorAll('.qv-option-group')[idx];
            if (!group.querySelector('.selected')) {
                const el = group.querySelector(`[data-value="${CSS.escape(val)}"]`);
                if (el) el.classList.add('selected');
            }
        });

        // Image update
        if (variant.featured_image) {
            let src = variant.featured_image.src;
            if (src.startsWith('//')) src = 'https:' + src;

            // Mobile Image logic
            document.getElementById('qv-mobile-image').src = src;

            // Desktop Slider logic
            const foundIdx = currentImages.findIndex(u => u.includes(src) || src.includes(u));
            if (foundIdx !== -1) {
                currentImageIndex = foundIdx;
                updateMainImage(foundIdx);
            } else {
                imgEl.src = src;
            }
        }
    }

    function setUnavailable() {
        const btn = document.getElementById('qv-add-btn');
        btn.disabled = true; btn.textContent = "TÜKENDİ";
    }

    function formatMoney(cents) {
        let val = (cents / 100).toFixed(2);
        val = val.replace('.', ',');
        val = val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        return val + " TL";
    }

    // Cart
    document.getElementById('qv-form').addEventListener('submit', function (e) {
        e.preventDefault();
        const btn = document.getElementById('qv-add-btn');
        const oldText = btn.textContent;
        btn.textContent = "EKLENİYOR..."; btn.disabled = true;

        const formData = new FormData(this);
        formData.append('quantity', 1);

        fetch('/cart/add.js', { method: 'POST', body: formData })
            .then(res => res.json())
            .then(() => {
                btn.textContent = "EKLENDİ!";
                setTimeout(() => {
                    closeModal();
                    document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
                    btn.textContent = oldText; btn.disabled = false;
                }, 800);
            })
            .catch((err) => {
                console.error(err);
                btn.textContent = "HATA";
                setTimeout(() => { btn.textContent = oldText; btn.disabled = false; }, 1000);
            });
    });

    // ========== COLOR INDICATOR LOGIC ==========
    const colorOptionNames = ['renk', 'color', 'colour', 'barva', 'farbe'];
    const productDataCache = {};

    const colorMap = {
        'siyah': '#000000', 'black': '#000000',
        'beyaz': '#ffffff', 'white': '#ffffff',
        'kırmızı': '#e53935', 'red': '#e53935',
        'mavi': '#1e88e5', 'blue': '#1e88e5',
        'lacivert': '#1a237e', 'navy': '#1a237e',
        'yeşil': '#43a047', 'green': '#43a047',
        'sarı': '#fdd835', 'yellow': '#fdd835',
        'turuncu': '#fb8c00', 'orange': '#fb8c00',
        'mor': '#8e24aa', 'purple': '#8e24aa',
        'pembe': '#ec407a', 'pink': '#ec407a',
        'kahverengi': '#6d4c41', 'brown': '#6d4c41',
        'gri': '#757575', 'grey': '#757575', 'gray': '#757575',
        'bej': '#d7ccc8', 'beige': '#d7ccc8',
        'bordo': '#7b1fa2', 'burgundy': '#7b1fa2',
        'altın': '#ffc107', 'gold': '#ffc107',
        'gümüş': '#bdbdbd', 'silver': '#bdbdbd',
        'krem': '#fffde7', 'cream': '#fffde7',
        'haki': '#827717', 'khaki': '#827717'
    };

    function getColorHex(colorName) {
        if (!colorName) return '#cccccc';
        const lower = colorName.toLowerCase().trim();
        for (const [key, hex] of Object.entries(colorMap)) {
            if (lower.includes(key)) return hex;
        }
        let hash = 0;
        for (let i = 0; i < lower.length; i++) {
            hash = lower.charCodeAt(i) + ((hash << 5) - hash);
        }
        return `hsl(${hash % 360}, 60%, 50%)`;
    }

    function findColorOption(product) {
        if (!product || !product.options) return null;
        for (const opt of product.options) {
            if (colorOptionNames.some(c => opt.name.toLowerCase().includes(c))) return opt;
        }
        return null;
    }

    function getDistinctColors(product) {
        const colorOpt = findColorOption(product);
        return colorOpt ? (colorOpt.values || []) : [];
    }

    function createColorIndicator(colors, handle) {
        if (colors.length < 2) return null;

        const container = document.createElement('div');
        container.className = 'qv-color-indicator';
        container.dataset.productHandle = handle;

        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'qv-color-dots';

        // Create 2 gradient dots
        const dot1 = document.createElement('span');
        dot1.className = 'qv-color-dot gradient-1';
        dotsContainer.appendChild(dot1);

        const dot2 = document.createElement('span');
        dot2.className = 'qv-color-dot gradient-2';
        dotsContainer.appendChild(dot2);

        const countSpan = document.createElement('span');
        countSpan.className = 'qv-color-count';
        countSpan.textContent = `+${colors.length} Renk`;

        container.appendChild(dotsContainer);
        container.appendChild(countSpan);

        // No click handler - visual only indicator

        return container;
    }

    function findProductCards() {
        // Removed '.product' to avoid targeting main product wrapper on PDP
        const selectors = ['.product-card', '.product-item', '.grid__item .card', '.collection-product-card', '[data-product-card]', '.product-grid-item', '.grid-product'];
        for (const sel of selectors) {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) return Array.from(found);
        }

        const productLinks = document.querySelectorAll('a[href*="/products/"]');
        const cardSet = new Set();
        productLinks.forEach(link => {
            let parent = link.parentElement;
            for (let i = 0; i < 5 && parent; i++) {
                if (parent.querySelector('img') && parent.querySelector('a[href*="/products/"]')) {
                    // Avoid selecting the main product gallery or info
                    if (parent.tagName === 'MAIN' || parent.id.includes('MainProduct') || parent.classList.contains('product__media-wrapper')) break;

                    cardSet.add(parent);
                    break;
                }
                parent = parent.parentElement;
            }
        });
        return Array.from(cardSet);
    }

    function getProductHandleFromCard(card) {
        const link = card.querySelector('a[href*="/products/"]');
        if (link) {
            const match = link.href.match(/\/products\/([^?#/]+)/);
            if (match) return match[1];
        }
        return null;
    }

    function findImageContainer(card) {
        const imgSelectors = ['.card__media', '.product-card__image', '.product-image', '.card-media', '.product__media', '.grid-product__image-wrapper', '.product-card-image-wrapper'];
        for (const sel of imgSelectors) {
            const el = card.querySelector(sel);
            if (el) return el;
        }
        const img = card.querySelector('img');
        return (img && img.parentElement) ? img.parentElement : card;
    }

    async function fetchProductData(handle) {
        if (productDataCache[handle]) return productDataCache[handle];
        try {
            const res = await fetch(`/products/${handle}.js`);
            if (!res.ok) return null;
            const data = await res.json();
            productDataCache[handle] = data;
            return data;
        } catch (e) {
            return null;
        }
    }

    async function initColorIndicators() {
        const cards = findProductCards();
        for (const card of cards) {
            if (card.dataset.qvColorProcessed) continue;
            card.dataset.qvColorProcessed = 'true';

            // 1. Skip if inside Quick View Modal
            if (card.closest('#quick-view-modal')) continue;

            // 2. Skip if it is the Main Product on Product Detail Page
            // (Check if it contains H1 or is inside main product section)
            if (window.location.pathname.includes('/products/') && (card.querySelector('h1') || card.closest('.product__info-wrapper') || card.closest('.product__media-wrapper'))) continue;



            const handle = getProductHandleFromCard(card);
            if (!handle) continue;

            const product = await fetchProductData(handle);
            if (!product) continue;

            const colors = getDistinctColors(product);
            if (colors.length < 2) continue;

            const indicator = createColorIndicator(colors, handle);
            if (!indicator) continue;

            const imageContainer = findImageContainer(card);
            const computedStyle = window.getComputedStyle(imageContainer);
            if (computedStyle.position === 'static') {
                imageContainer.style.position = 'relative';
            }
            imageContainer.appendChild(indicator);
        }
    }

    setTimeout(initColorIndicators, 500);

    const observer = new MutationObserver((mutations) => {
        let shouldRun = false;
        for (const m of mutations) {
            if (m.addedNodes.length > 0) { shouldRun = true; break; }
        }
        if (shouldRun) setTimeout(initColorIndicators, 300);
    });

    const gridSelectors = ['#product-grid', '.product-grid', '.collection-grid', '.grid', '#CollectionProductGrid', 'main'];
    for (const sel of gridSelectors) {
        const grid = document.querySelector(sel);
        if (grid) { observer.observe(grid, { childList: true, subtree: true }); break; }
    }
});
