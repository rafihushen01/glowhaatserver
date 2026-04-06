const sanitize = require("mongo-sanitize");
const Cart = require("../models/Cart");
const Item = require("../models/Item");
const User = require("../models/User");
const { resolveActor, recordBehaviorSignal } = require("../utils/RecommendationSignals");
const { requireActor } = require("../utils/RequestActor");
const { calculateDeliveryCharge } = require("../utils/DeliveryPricing");

const toSafeInt = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toSafePrice = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n >= 0 ? n : fallback;
};

const toSafeString = (value) => (value == null ? "" : String(value).trim());

const resolveHasFreeDelivery = async (items) => {
  if (!Array.isArray(items) || items.length === 0) return false;

  const missingProductIds = items
    .filter((entry) => typeof entry.isfreeshipping !== "boolean")
    .map((entry) => entry.productid)
    .filter(Boolean)
    .map((entry) => String(entry));

  const productMap = new Map();
  if (missingProductIds.length) {
    const products = await Item.find({ _id: { $in: missingProductIds } })
      .select("_id deliveryschema.isfreeshipping")
      .lean();
    products.forEach((product) => {
      productMap.set(String(product._id), Boolean(product?.deliveryschema?.isfreeshipping));
    });
  }

  return items.every((entry) => {
    if (typeof entry.isfreeshipping === "boolean") return entry.isfreeshipping;
    return Boolean(productMap.get(String(entry.productid)));
  });
};

exports.addtocart = async (req, res) => {
  try {
    const requestactor = requireActor(req, res);
    if (!requestactor) return;

    const payload = sanitize(req.body || {});
    const { slug } = payload;

    if (!slug) {
      return res.status(400).json({ success: false, message: "Product slug is required" });
    }

    const product = await Item.findOne({ slug, isactive: true }).lean();
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const variantindex = Math.max(0, toSafeInt(payload.variantindex, 0));
    const optionindex = Math.max(0, toSafeInt(payload.optionindex, 0));
    const quantity = Math.max(1, toSafeInt(payload.quantity, 1));

    const variant = product.variants?.[variantindex];
    const option = variant?.options?.[optionindex];

    if (!variant || !option) {
      return res.status(400).json({
        success: false,
        message: "Invalid variant or option selection",
      });
    }

    const unitprice = toSafePrice(option.currentprice, 0);
    const baseprice = toSafePrice(option.baseprice, 0);
    const discountpercentage = toSafePrice(option.discountpercentage, 0);
    const deliverycharge = toSafePrice(product?.deliveryschema?.deliverycharge, 0);
    const isfreeshipping = Boolean(product?.deliveryschema?.isfreeshipping);
    const image =
      variant?.images?.[0] ||
      product.whiteimage ||
      product.hoverimage ||
      product.gallery?.[0] ||
      "";

    const existing = await Cart.findOne({
      productid: product._id,
      variantindex,
      optionindex,
      ...requestactor.ownerfilter,
    });

    if (existing) {
      existing.ownerid = requestactor.ownerid;
      existing.userid = requestactor.userid || null;
      existing.guestid = requestactor.guestid || "";
      existing.quantity += quantity;
      existing.unitprice = unitprice;
      existing.baseprice = baseprice;
      existing.discountpercentage = discountpercentage;
      existing.deliverycharge = deliverycharge;
      existing.isfreeshipping = isfreeshipping;
      existing.totalprice = existing.quantity * unitprice;
      existing.image = image;
      existing.productsnapshot = {
        description: product.description || "",
        highlight: product.highlight || "",
        aboutitems: product.aboutitems || "",
      };
      await existing.save();

      const actor = resolveActor(req, payload);
      if (actor) {
        await recordBehaviorSignal({
          actor,
          product,
          eventtype: "add_to_cart",
          quantity,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Cart item quantity updated",
        item: existing,
      });
    }

    const created = await Cart.create({
      ownerid: requestactor.ownerid,
      userid: requestactor.userid || null,
      guestid: requestactor.guestid || "",
      productid: product._id,
      slug: product.slug,
      name: product.name,
      brand: product.brand || "",
      image,
      variantname: variant.name || "",
      optionname: option.name || "",
      variantindex,
      optionindex,
      unitprice,
      baseprice,
      discountpercentage,
      deliverycharge,
      isfreeshipping,
      quantity,
      totalprice: quantity * unitprice,
      productsnapshot: {
        description: product.description || "",
        highlight: product.highlight || "",
        aboutitems: product.aboutitems || "",
      },
    });

    const actor = resolveActor(req, payload);
    if (actor) {
      await recordBehaviorSignal({
        actor,
        product,
        eventtype: "add_to_cart",
        quantity,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Product added to cart",
      item: created,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to add product to cart",
      error: error.message,
    });
  }
};

exports.getmycart = async (req, res) => {
  try {
    const requestactor = requireActor(req, res);
    if (!requestactor) return;

    const items = await Cart.find(requestactor.ownerfilter).sort({ updatedAt: -1 }).lean();
    const subtotal = items.reduce((sum, item) => sum + toSafePrice(item.totalprice, 0), 0);
    const hasfreedelivery = await resolveHasFreeDelivery(items);

    const districtFromQuery = toSafeString(req.query?.district);
    let district = districtFromQuery;
    if (!district && requestactor.userid) {
      const me = await User.findById(requestactor.userid).select("District").lean();
      district = toSafeString(me?.District);
    }

    const deliverytotal = items.length
      ? calculateDeliveryCharge({
          district,
          hasFreeDelivery: hasfreedelivery,
        })
      : 0;

    return res.status(200).json({
      success: true,
      count: items.length,
      subtotal,
      hasfreedelivery,
      district,
      deliverytotal,
      grandtotal: subtotal + deliverytotal,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch cart",
      error: error.message,
    });
  }
};

exports.updatecartquantity = async (req, res) => {
  try {
    const requestactor = requireActor(req, res);
    if (!requestactor) return;

    const { id } = req.params;
    const payload = sanitize(req.body || {});
    const quantity = Math.max(1, toSafeInt(payload.quantity, 1));

    const item = await Cart.findOne({ _id: id, ...requestactor.ownerfilter });
    if (!item) {
      return res.status(404).json({ success: false, message: "Cart item not found" });
    }

    item.ownerid = requestactor.ownerid;
    item.userid = requestactor.userid || null;
    item.guestid = requestactor.guestid || "";
    item.quantity = quantity;
    item.totalprice = quantity * toSafePrice(item.unitprice, 0);
    await item.save();

    return res.status(200).json({
      success: true,
      message: "Cart quantity updated",
      item,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update quantity",
      error: error.message,
    });
  }
};

exports.removefromcart = async (req, res) => {
  try {
    const requestactor = requireActor(req, res);
    if (!requestactor) return;

    const { id } = req.params;
    const deleted = await Cart.findOneAndDelete({ _id: id, ...requestactor.ownerfilter });

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Cart item not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Cart item removed",
      item: deleted,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to remove cart item",
      error: error.message,
    });
  }
};

exports.clearcart = async (req, res) => {
  try {
    const requestactor = requireActor(req, res);
    if (!requestactor) return;

    await Cart.deleteMany(requestactor.ownerfilter);
    return res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to clear cart",
      error: error.message,
    });
  }
};

