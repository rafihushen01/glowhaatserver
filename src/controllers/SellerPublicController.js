const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const Item = require("../models/Item");
const SellerShop = require("../models/SellerShop");

const normalizeText = (value = "") => String(value || "").trim();
const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const getAllPrices = (product) => {
  const prices = [];

  [product?.price, product?.baseprice, product?.sellingprice].forEach((value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) prices.push(n);
  });

  (product?.variants || []).forEach((variant) => {
    (variant?.options || []).forEach((option) => {
      const current = Number(option?.currentprice);
      if (Number.isFinite(current) && current >= 0) {
        prices.push(current);
        return;
      }

      const base = Number(option?.baseprice);
      if (Number.isFinite(base) && base >= 0) prices.push(base);
    });
  });

  return prices;
};

const getProductPrice = (product) => {
  const prices = getAllPrices(product);
  if (!prices.length) return 0;
  return Math.min(...prices);
};

const getProductStock = (product) => {
  let total = 0;
  (product?.variants || []).forEach((variant) => {
    (variant?.options || []).forEach((option) => {
      const stock = Number(option?.stock || 0);
      if (Number.isFinite(stock) && stock > 0) total += stock;
    });
  });
  return total;
};

const getVariantValues = (product, variantType) => {
  const target = normalizeText(variantType).toLowerCase();
  const values = new Set();

  (product?.variants || []).forEach((variant) => {
    const type = normalizeText(variant?.varianttype).toLowerCase();
    if (!type.includes(target)) return;

    if (variant?.name) values.add(normalizeText(variant.name));
    (variant?.options || []).forEach((option) => {
      if (option?.name) values.add(normalizeText(option.name));
    });
  });

  return Array.from(values);
};

const getProductRating = (product) => {
  const n = Number(product?.star);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(5, n);
};

const sortProducts = (products, sort) => {
  const next = [...products];

  if (sort === "price_low_high") {
    next.sort((a, b) => getProductPrice(a) - getProductPrice(b));
    return next;
  }

  if (sort === "price_high_low") {
    next.sort((a, b) => getProductPrice(b) - getProductPrice(a));
    return next;
  }

  if (sort === "name_az") {
    next.sort((a, b) => normalizeText(a?.name).localeCompare(normalizeText(b?.name)));
    return next;
  }

  if (sort === "oldest") {
    next.sort((a, b) => new Date(a?.createdAt || a?.createdat || 0) - new Date(b?.createdAt || b?.createdat || 0));
    return next;
  }

  if (sort === "rating_high_low") {
    next.sort((a, b) => getProductRating(b) - getProductRating(a));
    return next;
  }

  next.sort((a, b) => new Date(b?.createdAt || b?.createdat || 0) - new Date(a?.createdAt || a?.createdat || 0));
  return next;
};

const buildShopFilters = (products = []) => {
  const colors = new Set();
  const sizes = new Set();
  const brands = new Set();
  const prices = [];
  const ratings = [];

  let inStock = 0;
  let outOfStock = 0;

  products.forEach((product) => {
    getVariantValues(product, "color").forEach((value) => colors.add(value));
    getVariantValues(product, "size").forEach((value) => sizes.add(value));

    const brand = normalizeText(product?.brand);
    if (brand) brands.add(brand);

    prices.push(...getAllPrices(product));
    ratings.push(getProductRating(product));

    if (getProductStock(product) > 0) inStock += 1;
    else outOfStock += 1;
  });

  const cleanPrices = prices.filter((p) => Number.isFinite(p) && p >= 0);
  const cleanRatings = ratings.filter((r) => Number.isFinite(r) && r >= 0);

  return {
    colors: Array.from(colors).sort((a, b) => a.localeCompare(b)),
    sizes: Array.from(sizes).sort((a, b) => a.localeCompare(b)),
    brands: Array.from(brands).sort((a, b) => a.localeCompare(b)),
    minPrice: cleanPrices.length ? Math.min(...cleanPrices) : 0,
    maxPrice: cleanPrices.length ? Math.max(...cleanPrices) : 0,
    minRating: 0,
    maxRating: cleanRatings.length ? Math.min(5, Math.ceil(Math.max(...cleanRatings))) : 0,
    availability: {
      in_stock: inStock,
      out_of_stock: outOfStock,
    },
  };
};

exports.getPublicShopProfile = async (req, res) => {
  try {
    const payload = sanitize(req.query || {});
    const slug = normalizeText(req.params?.slug).toLowerCase();
    if (!slug) return res.status(400).json({ success: false, message: "Shop slug is required." });

    const shop = await SellerShop.findOne({ slug })
      .populate("sellerid", "_id fullname usersavatar role")
      .lean();

    if (!shop) return res.status(404).json({ success: false, message: "Shop not found." });

    const allProducts = await Item.find({
      shopid: shop._id,
      sellerid: shop.sellerid?._id || shop.sellerid,
      isselleritem: true,
      isactive: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    const shopFilters = buildShopFilters(allProducts);

    const selectedColors = normalizeText(payload.colors)
      .split(",")
      .map((entry) => normalizeText(entry).toLowerCase())
      .filter(Boolean);

    const selectedSizes = normalizeText(payload.sizes)
      .split(",")
      .map((entry) => normalizeText(entry).toLowerCase())
      .filter(Boolean);

    const selectedBrands = normalizeText(payload.brands)
      .split(",")
      .map((entry) => normalizeText(entry).toLowerCase())
      .filter(Boolean);

    const availability = normalizeText(payload.availability).toLowerCase();
    const search = normalizeText(payload.search || payload.q).toLowerCase();
    const minPrice = payload.minprice === undefined || payload.minprice === "" ? null : toNumber(payload.minprice, null);
    const maxPrice = payload.maxprice === undefined || payload.maxprice === "" ? null : toNumber(payload.maxprice, null);
    const minRating = payload.minrating === undefined || payload.minrating === "" ? null : toNumber(payload.minrating, null);
    const maxRating = payload.maxrating === undefined || payload.maxrating === "" ? null : toNumber(payload.maxrating, null);
    const sort = normalizeText(payload.sort || "newest").toLowerCase();

    const filtered = allProducts.filter((product) => {
      const colors = getVariantValues(product, "color").map((entry) => normalizeText(entry).toLowerCase());
      const sizes = getVariantValues(product, "size").map((entry) => normalizeText(entry).toLowerCase());
      const brand = normalizeText(product?.brand).toLowerCase();
      const stock = getProductStock(product);
      const rating = getProductRating(product);
      const prices = getAllPrices(product);

      if (selectedColors.length && !selectedColors.some((entry) => colors.includes(entry))) return false;
      if (selectedSizes.length && !selectedSizes.some((entry) => sizes.includes(entry))) return false;
      if (selectedBrands.length && (!brand || !selectedBrands.includes(brand))) return false;

      if (availability === "in_stock" && stock <= 0) return false;
      if (availability === "out_of_stock" && stock > 0) return false;

      if (minRating !== null && rating < minRating) return false;
      if (maxRating !== null && rating > maxRating) return false;

      if (minPrice !== null || maxPrice !== null) {
        const hasPriceMatch = prices.some((price) => {
          if (minPrice !== null && price < minPrice) return false;
          if (maxPrice !== null && price > maxPrice) return false;
          return true;
        });
        if (!hasPriceMatch) return false;
      }

      if (search) {
        const haystack = [
          product?.name,
          product?.brand,
          product?.categorypath,
          ...(Array.isArray(product?.categorytree) ? product.categorytree : []),
          ...(Array.isArray(product?.tags) ? product.tags : []),
        ]
          .map((entry) => normalizeText(entry).toLowerCase())
          .filter(Boolean)
          .join(" ");

        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    const sorted = sortProducts(filtered, sort);

    const page = Math.max(1, toNumber(payload.page, 1));
    const limit = Math.max(1, Math.min(80, toNumber(payload.limit, 24)));
    const start = (page - 1) * limit;
    const paginated = sorted.slice(start, start + limit);

    const totalSales = allProducts.reduce((sum, product) => sum + Math.max(0, Number(product?.totalsold || 0)), 0);

    return res.status(200).json({
      success: true,
      shop: {
        _id: shop._id,
        shopname: shop.shopname,
        slug: shop.slug,
        profileimage: shop.profileimage,
        bannerimage: shop.bannerimage,
        description: shop.description,
        contactemail: shop.contactemail,
        contactphone: shop.contactphone,
        address: shop.address,
        healthscore: Number(shop.healthscore || 0),
        seller: {
          _id: shop.sellerid?._id || null,
          fullname: shop.sellerid?.fullname || "Seller",
          usersavatar: shop.sellerid?.usersavatar || "",
        },
      },
      stats: {
        totalproducts: allProducts.length,
        totalsales: totalSales,
        averageRating:
          allProducts.length > 0
            ? Number(
                (
                  allProducts.reduce((sum, product) => sum + getProductRating(product), 0) /
                  allProducts.length
                ).toFixed(2)
              )
            : 0,
      },
      filters: shopFilters,
      count: sorted.length,
      page,
      pages: Math.max(1, Math.ceil(sorted.length / limit)),
      products: paginated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load shop profile." });
  }
};
