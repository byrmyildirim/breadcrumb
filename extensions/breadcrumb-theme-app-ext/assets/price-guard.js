(function () {
    'use strict';

    const ZERO_THRESHOLD = 0.01;

    const BUTTON_SELECTORS = [
        'button[name="add"]',
        'button[type="submit"][name="add"]',
        '.product-form__submit',
        '.shopify-payment-button',
        '.shopify-payment-button__button',
        '[data-add-to-cart]',
        '.add-to-cart',
        '.btn-add-to-cart',
        '.product__submit__add',
        '#AddToCart',
        '#add-to-cart',
        '.product-form button[type="submit"]',
        'form[action*="/cart/add"] button[type="submit"]',
        '.product-single__add-to-cart'
    ];

    function getButtons() {
        const buttons = [];
        BUTTON_SELECTORS.forEach(selector => {
            document.querySelectorAll(selector).forEach(btn => {
                if (!buttons.includes(btn)) buttons.push(btn);
            });
        });
        return buttons;
    }

    function getCurrentPrice() {
        if (typeof window.ShopifyAnalytics !== 'undefined' &&
            window.ShopifyAnalytics.meta &&
            window.ShopifyAnalytics.meta.product) {
            const variant = window.ShopifyAnalytics.meta.product.variants.find(v => v.id == getSelectedVariantId());
            if (variant) return variant.price / 100;
        }

        const priceSelectors = [
            '.price__regular .price-item--regular',
            '.product__price',
            '.product-single__price',
            '[data-product-price]',
            '.price',
            '.current-price',
            '.money'
        ];

        for (const selector of priceSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                const text = el.textContent || '';
                const match = text.replace(/[^\d.,]/g, '').replace(',', '.');
                const price = parseFloat(match);
                if (!isNaN(price)) return price;
            }
        }

        const variantInput = document.querySelector('input[name="id"]');
        if (variantInput && window.product && window.product.variants) {
            const variant = window.product.variants.find(v => v.id == variantInput.value);
            if (variant) return variant.price / 100;
        }

        return null;
    }

    function getSelectedVariantId() {
        const input = document.querySelector('input[name="id"]');
        if (input) return input.value;

        const select = document.querySelector('select[name="id"]');
        if (select) return select.value;

        return null;
    }

    function disableButtons() {
        const buttons = getButtons();
        buttons.forEach(btn => {
            btn.classList.add('price-guard-disabled');
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
        });

        const msg = document.getElementById('PriceGuardMessage');
        if (msg) msg.classList.add('is-visible');
    }

    function enableButtons() {
        const buttons = getButtons();
        buttons.forEach(btn => {
            btn.classList.remove('price-guard-disabled');
            btn.disabled = false;
            btn.removeAttribute('aria-disabled');
        });

        const msg = document.getElementById('PriceGuardMessage');
        if (msg) msg.classList.remove('is-visible');
    }

    function checkPrice() {
        const price = getCurrentPrice();

        if (price !== null && price <= ZERO_THRESHOLD) {
            disableButtons();
            console.log('[PriceGuard] Buttons disabled - Price is 0');
        } else {
            enableButtons();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(checkPrice, 500));
    } else {
        setTimeout(checkPrice, 500);
    }

    document.addEventListener('change', (e) => {
        if (e.target.matches('input[name="id"], select[name="id"], [data-variant-id]')) {
            setTimeout(checkPrice, 100);
        }
    });

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'characterData' || mutation.type === 'childList') {
                const target = mutation.target;
                if (target.closest && (
                    target.closest('[data-product-price]') ||
                    target.closest('.price') ||
                    target.closest('.product__price')
                )) {
                    setTimeout(checkPrice, 100);
                    break;
                }
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

})();
