const mongoose = require("mongoose");
const SellerShop = require("../models/SellerShop");
const SellerBadge = require("../models/SellerBadge");
const { buildProductCardBadges } = require("./SellerSignals");

const toObjectId = (value) => {
  if (!value) return null;
  const candidate = typeof value === "object" && value?._id ? value._id : value;
  if (!candidate) return null;
  const text = String(candidate);
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : null;
};

const toObjectIdKey = (value) => {
  const oid = toObjectId(value);
  return oid ? String(oid) : "";
};

const buildStoreBadgeMapByShopId = async (products = []) => {
  const shopIds = Array.from(
    new Set(
      (products || [])
        .map((product) => toObjectIdKey(product?.shopid))
        .filter(Boolean)
    )
  );

  if (!shopIds.length) return new Map();

  const shopObjectIds = shopIds.map((id) => new mongoose.Types.ObjectId(id));
  const shops = await SellerShop.find({ _id: { $in: shopObjectIds } })
    .select("_id badgeids")
    .lean();

  const badgeIds = Array.from(
    new Set(
      (shops || [])
        .flatMap((shop) => (Array.isArray(shop?.badgeids) ? shop.badgeids : []))
        .map((id) => toObjectIdKey(id))
        .filter(Boolean)
    )
  );

  const badgeMap = new Map();
  if (badgeIds.length) {
    const badgeObjectIds = badgeIds.map((id) => new mongoose.Types.ObjectId(id));
    const badges = await SellerBadge.find({ _id: { $in: badgeObjectIds }, isactive: true })
      .select("_id name slug image priority")
      .sort({ priority: 1, createdAt: -1 })
      .lean();

    (badges || []).forEach((badge) => {
      badgeMap.set(String(badge._id), badge);
    });
  }

  const byShop = new Map();
  (shops || []).forEach((shop) => {
    const rows = (Array.isArray(shop?.badgeids) ? shop.badgeids : [])
      .map((id) => badgeMap.get(String(id)))
      .filter(Boolean);
    byShop.set(String(shop._id), rows);
  });

  return byShop;
};

const enrichProductsWithCardMeta = async (products = [], extrasByProductId = null) => {
  if (!Array.isArray(products) || !products.length) return [];

  const shopBadgeMap = await buildStoreBadgeMapByShopId(products);

  return products.map((product) => {
    const productId = String(product?._id || "");
    const shopKey = toObjectIdKey(product?.shopid);
    const storebadges = shopBadgeMap.get(shopKey) || [];
    const computed = buildProductCardBadges({
      product,
      storebadges,
    });
    const existing = typeof product?.cardmeta === "object" && product.cardmeta ? product.cardmeta : {};
    const extras = extrasByProductId instanceof Map ? extrasByProductId.get(productId) || {} : {};

    return {
      ...product,
      cardmeta: {
        ...computed,
        ...existing,
        ...extras,
      },
    };
  });
};

module.exports = {
  enrichProductsWithCardMeta,
  buildStoreBadgeMapByShopId,
};
