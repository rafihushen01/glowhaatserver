const mongoose = require("mongoose");
const sanitize = require("mongo-sanitize");
const Item = require("../models/Item");
const Order = require("../models/Order");
const User = require("../models/User");
const Wishlist = require("../models/Wishlist");

const toSafeString = (value) => (value == null ? "" : String(value).trim());
const toSafeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const ensureSuperAdmin = async (req, res) => {
  const userid = req.user?.userId;
  if (!userid) {
    res.status(401).json({ success: false, message: "Unauthorized access" });
    return null;
  }

  const me = await User.findById(userid).select("_id role").lean();
  if (!me || me.role !== "SuperAdmin") {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return me;
};

const getProductImage = (product) =>
  product?.variants?.[0]?.images?.[0] ||
  product?.whiteimage ||
  product?.hoverimage ||
  product?.gallery?.[0] ||
  "";

const getDefaultPrice = (product) => {
  const variant = product?.variants?.[0];
  const option = variant?.options?.[0];
  return {
    baseprice: Math.max(0, toSafeNumber(option?.baseprice, 0)),
    currentprice: Math.max(0, toSafeNumber(option?.currentprice, 0)),
  };
};

const resolveProduct = async (payload = {}) => {
  const slug = toSafeString(payload.slug);
  const rawProductId = toSafeString(payload.productid);

  if (slug) {
    return Item.findOne({ slug, isactive: true }).lean();
  }

  if (rawProductId && mongoose.Types.ObjectId.isValid(rawProductId)) {
    return Item.findOne({ _id: rawProductId, isactive: true }).lean();
  }

  return null;
};

exports.addtowishlist = async (req, res) => {
  try {
    const userid = req.user?.userId;
    if (!userid) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    const payload = sanitize(req.body || {});
    const product = await resolveProduct(payload);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const prices = getDefaultPrice(product);
    const doc = await Wishlist.findOneAndUpdate(
      { userid, productid: product._id },
      {
        $setOnInsert: {
          userid,
          productid: product._id,
          slug: product.slug,
        },
        $set: {
          name: toSafeString(product.name),
          brand: toSafeString(product.brand),
          image: getProductImage(product),
          baseprice: prices.baseprice,
          currentprice: prices.currentprice,
          productsnapshot: {
            description: toSafeString(product.description),
            highlight: toSafeString(product.highlight),
            aboutitems: toSafeString(product.aboutitems),
            star: toSafeNumber(product.star, 0),
            reviewcount: toSafeNumber(product.reviewcount, 0),
          },
        },
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: "Product added to wishlist",
      iswishlisted: true,
      item: doc,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to add wishlist item",
      error: error.message,
    });
  }
};

exports.removewishlist = async (req, res) => {
  try {
    const userid = req.user?.userId;
    if (!userid) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    const { productid } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(productid || ""))) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    await Wishlist.findOneAndDelete({ userid, productid });
    return res.status(200).json({
      success: true,
      message: "Product removed from wishlist",
      iswishlisted: false,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to remove wishlist item",
      error: error.message,
    });
  }
};

exports.togglewishlist = async (req, res) => {
  try {
    const userid = req.user?.userId;
    if (!userid) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    const payload = sanitize(req.body || {});
    const product = await resolveProduct(payload);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const existing = await Wishlist.findOne({ userid, productid: product._id }).lean();
    if (existing) {
      await Wishlist.deleteOne({ _id: existing._id });
      return res.status(200).json({
        success: true,
        message: "Product removed from wishlist",
        iswishlisted: false,
      });
    }

    const prices = getDefaultPrice(product);
    const created = await Wishlist.create({
      userid,
      productid: product._id,
      slug: product.slug,
      name: toSafeString(product.name),
      brand: toSafeString(product.brand),
      image: getProductImage(product),
      baseprice: prices.baseprice,
      currentprice: prices.currentprice,
      productsnapshot: {
        description: toSafeString(product.description),
        highlight: toSafeString(product.highlight),
        aboutitems: toSafeString(product.aboutitems),
        star: toSafeNumber(product.star, 0),
        reviewcount: toSafeNumber(product.reviewcount, 0),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Product added to wishlist",
      iswishlisted: true,
      item: created,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update wishlist",
      error: error.message,
    });
  }
};

exports.getmywishlist = async (req, res) => {
  try {
    const userid = req.user?.userId;
    if (!userid) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    const items = await Wishlist.find({ userid }).sort({ updatedAt: -1 }).lean();
    const productids = items.map((entry) => String(entry.productid));

    return res.status(200).json({
      success: true,
      count: items.length,
      productids,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wishlist",
      error: error.message,
    });
  }
};

exports.getwishliststatus = async (req, res) => {
  try {
    const userid = req.user?.userId;
    if (!userid) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    const slug = toSafeString(req.params?.slug);
    if (!slug) {
      return res.status(400).json({ success: false, message: "Product slug is required" });
    }

    const product = await Item.findOne({ slug }).select("_id").lean();
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const exists = await Wishlist.exists({ userid, productid: product._id });
    return res.status(200).json({
      success: true,
      iswishlisted: Boolean(exists),
      productid: product._id,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to check wishlist status",
      error: error.message,
    });
  }
};

exports.getwishlistinsightsadmin = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const [wishlistRows, deliveredPurchaseRows, conversionRows] = await Promise.all([
      Wishlist.aggregate([
        {
          $group: {
            _id: "$productid",
            wishlistcount: { $sum: 1 },
            uniqueusers: { $addToSet: "$userid" },
            lastwishlistedat: { $max: "$createdAt" },
          },
        },
      ]),
      Order.aggregate([
        { $match: { status: "delivered" } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productid",
            deliveredorders: { $sum: 1 },
            deliveredunits: { $sum: "$items.quantity" },
          },
        },
      ]),
      Wishlist.aggregate([
        {
          $lookup: {
            from: "orders",
            let: { wishuserid: "$userid", wishproductid: "$productid", wishedat: "$createdAt" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$userid", "$$wishuserid"] },
                      { $eq: ["$status", "delivered"] },
                      { $gte: ["$createdAt", "$$wishedat"] },
                    ],
                  },
                },
              },
              {
                $match: {
                  $expr: {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: "$items",
                            as: "orderitem",
                            cond: { $eq: ["$$orderitem.productid", "$$wishproductid"] },
                          },
                        },
                      },
                      0,
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: "matchedorders",
          },
        },
        {
          $addFields: {
            converted: { $gt: [{ $size: "$matchedorders" }, 0] },
          },
        },
        {
          $group: {
            _id: "$productid",
            convertedwishlistusers: {
              $sum: {
                $cond: ["$converted", 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const purchaseMap = new Map(deliveredPurchaseRows.map((row) => [String(row._id), row]));
    const conversionMap = new Map(conversionRows.map((row) => [String(row._id), row]));

    const productIds = wishlistRows.map((row) => row._id);
    const products = await Item.find({ _id: { $in: productIds } })
      .select("_id name slug brand whiteimage hoverimage gallery")
      .lean();
    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const topproducts = wishlistRows
      .map((row) => {
        const key = String(row._id);
        const product = productMap.get(key) || {};
        const purchases = purchaseMap.get(key) || {};
        const conversions = conversionMap.get(key) || {};
        const uniquewishlistusers = Array.isArray(row.uniqueusers) ? row.uniqueusers.length : 0;
        const convertedwishlistusers = Number(conversions.convertedwishlistusers || 0);
        const conversionrate = uniquewishlistusers
          ? Number(((convertedwishlistusers / uniquewishlistusers) * 100).toFixed(2))
          : 0;

        return {
          productid: row._id,
          name: toSafeString(product.name) || "Unknown Product",
          slug: toSafeString(product.slug),
          brand: toSafeString(product.brand),
          image: getProductImage(product),
          wishlistcount: Number(row.wishlistcount || 0),
          uniquewishlistusers,
          deliveredorders: Number(purchases.deliveredorders || 0),
          deliveredunits: Number(purchases.deliveredunits || 0),
          convertedwishlistusers,
          conversionrate,
          lastwishlistedat: row.lastwishlistedat || null,
        };
      })
      .sort((a, b) => b.wishlistcount - a.wishlistcount);

    const totalwishlistentries = topproducts.reduce((sum, row) => sum + Number(row.wishlistcount || 0), 0);
    const totaluniquewishlisters = topproducts.reduce(
      (sum, row) => sum + Number(row.uniquewishlistusers || 0),
      0
    );
    const totalconvertedwishlists = topproducts.reduce(
      (sum, row) => sum + Number(row.convertedwishlistusers || 0),
      0
    );
    const overallconversionrate = totaluniquewishlisters
      ? Number(((totalconvertedwishlists / totaluniquewishlisters) * 100).toFixed(2))
      : 0;

    return res.status(200).json({
      success: true,
      summary: {
        totalwishlistentries,
        totaluniquewishlisters,
        totalconvertedwishlists,
        overallconversionrate,
      },
      topproducts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wishlist insights",
      error: error.message,
    });
  }
};
