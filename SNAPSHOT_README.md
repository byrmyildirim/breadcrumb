# Breadcrumb Pro - v1.0 Snapshot

**Tag:** `v1.0-breadcrumb-stable`  
**Tarih:** 2026-01-05  
**Commit:** `62f7707`

---

## 🎯 Uygulama Özeti

Shopify mağazaları için özel breadcrumb navigasyonu oluşturan bir uygulama. Drag & drop menü builder ile 6 seviye derinliğe kadar hiyerarşik menüler oluşturabilir ve bunları ürün/koleksiyon sayfalarında breadcrumb olarak gösterebilirsiniz.

---

## ✅ Tamamlanan Özellikler

### 1. Drag & Drop Menü Builder
- `@dnd-kit` kütüphanesi ile sürükle-bırak
- Alt öğeler parent ile birlikte hareket eder
- Görsel derinlik (indentation) ile hiyerarşi
- Collapse/expand özelliği

### 2. Shopify Menü Import
- 100 menüye kadar import desteği
- 5 seviye derinlik
- Hedef kategori seçimi (nereye import edileceği)
- Page, Collection, Product, External URL desteği

### 3. Breadcrumb Theme Extension
- **Ürün sayfaları:** 6 seviye derinlik
- **Koleksiyon sayfaları:** 6 seviye derinlik
- Özel menü veya Shopify menü seçeneği
- Özelleştirilebilir ayırıcı ve stil

### 4. Metafield Yönetimi
- Shop metafield'ına kayıt (`shop.metafields.breadcrumb.custom_menu`)
- JSON formatında iç içe yapı
- Liquid'den direkt erişim

---

## 📁 Kritik Dosyalar

| Dosya | Açıklama |
|-------|----------|
| `app/routes/app.menu.tsx` | Menü builder ana bileşeni |
| `extensions/breadcrumb-theme-app-ext/blocks/breadcrumb.liquid` | Theme extension |
| `prisma/schema.prisma` | Veritabanı şeması (Session) |
| `shopify.app.toml` | Uygulama yapılandırması |

---

## 🔧 Çözülen Kritik Hatalar

1. **Metafield Kayıt Yeri:** `currentAppInstallation` → `shop` (Liquid erişimi için)
2. **Loader/Action Uyumsuzluğu:** Her ikisi de artık `shop` kullanıyor
3. **Drag & Drop Subtree:** Parent sürüklendiğinde children'lar birlikte hareket ediyor
4. **Handle Input:** `/pages/bisiklet` yazılabilir, silinmiyor
5. **Breadcrumb Hierarchy:** `enforceHierarchy` fonksiyonu ile parentId'ler düzeltiliyor

---

## 🌐 Deployment

- **GitHub:** `https://github.com/byrmyildirim/breadcrumb.git`
- **Railway:** PostgreSQL + Remix server
- **Shopify Partners:** Theme extension

---

## 📋 Scopes (shopify.app.toml)

```
scopes = "write_products,read_online_store_navigation,write_online_store_navigation"
```

---

## 🔄 Bu Versiyona Dönmek İçin

```bash
git checkout v1.0-breadcrumb-stable
```

---

## 📦 Dependencies

```json
{
  "@dnd-kit/core": "^6.x",
  "@dnd-kit/sortable": "^8.x",
  "@dnd-kit/utilities": "^3.x",
  "@shopify/shopify-app-remix": "^3.x",
  "@shopify/polaris": "^12.x",
  "prisma": "^5.x"
}
```

---

## 💡 Birleştirme Notları

Bu uygulamayı başka bir Shopify uygulamasıyla birleştirirken dikkat edilecekler:

1. **Prisma Schema:** `Session` modeli gerekli
2. **Scopes:** Navigation okuma/yazma izinleri eklenmeli
3. **Theme Extension:** `breadcrumb-theme-app-ext` klasörü korunmalı
4. **Routes:** `app.menu.tsx` route'u eklenmeli
5. **Metafield Namespace:** `breadcrumb` namespace'i kullanılıyor
