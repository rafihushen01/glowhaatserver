const mongoose = require("mongoose");
const Item = require("../models/Item");
const UserProductBehavior = require("../models/UserProductBehavior");

const toSafeString = (value) => (value == null ? "" : String(value).trim());

const slugifyLoose = (value) =>
  toSafeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const toSafeNumber = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

const getLowestPrice = (product) => {
  const prices = [];

  (product?.variants || []).forEach((variant) => {
    (variant?.options || []).forEach((option) => {
      const current = toSafeNumber(option?.currentprice, -1);
      const base = toSafeNumber(option?.baseprice, -1);
      if (current >= 0) {
        prices.push(current);
        return;
      }
      if (base >= 0) prices.push(base);
    });
  });

  if (!prices.length) return 0;
  return Math.min(...prices);
};

const getTopDiscount = (product) => {
  let top = 0;
  (product?.variants || []).forEach((variant) => {
    (variant?.options || []).forEach((option) => {
      const pct = toSafeNumber(option?.discountpercentage, 0);
      if (pct > top) top = pct;
    });
  });
  return top;
};

const extractCategoryTokens = (item) => {
  const set = new Set();
  const add = (value) => {
    const token = slugifyLoose(value);
    if (token) set.add(token);
  };

  (item?.categorytree || []).forEach(add);

  if (toSafeString(item?.categorypath)) {
    toSafeString(item.categorypath)
      .split(/\s*(?:>|\/|\\|,|\|)\s*/)
      .filter(Boolean)
      .forEach(add);
  }

  return Array.from(set);
};

const resolveCategoryLeaf = (item) => {
  if (Array.isArray(item?.categorytree) && item.categorytree.length) {
    return slugifyLoose(item.categorytree[item.categorytree.length - 1]);
  }

  const categoryPath = toSafeString(item?.categorypath);
  if (categoryPath) {
    const parts = categoryPath
      .split(/\s*(?:>|\/|\\|,|\|)\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) return slugifyLoose(parts[parts.length - 1]);
  }

  const tokens = extractCategoryTokens(item);
  return tokens[tokens.length - 1] || "";
};

const resolveActor = (req, payload = {}) => {
  const userid = req.user?.userId;
  if (userid && mongoose.Types.ObjectId.isValid(String(userid))) {
    return {
      actorid: `user:${String(userid)}`,
      userid: new mongoose.Types.ObjectId(String(userid)),
      sessionkey: "",
    };
  }

  const sessionkey = toSafeString(payload.sessionkey || req.query?.sessionkey);
  if (!sessionkey) return null;

  return {
    actorid: `guest:${sessionkey}`,
    userid: null,
    sessionkey,
  };
};

const EVENT_WEIGHTS = {
  product_click: 1.8,
  product_view: 2.5,
  wishlist_add: 5,
  wishlist_remove: 0.6,
  add_to_cart: 6,
  order: 10,
  dwell: 1,
};

const buildIncrementFromEvent = ({ eventtype, dwellseconds = 0, quantity = 1 }) => {
  const inc = {
    signalscore: 0,
    clickcount: 0,
    detailviewcount: 0,
    wishlistadds: 0,
    wishlistremoves: 0,
    cartadds: 0,
    ordercount: 0,
    orderedqty: 0,
    dwelltotalseconds: 0,
    dwellsessions: 0,
  };

  if (eventtype === "product_click") {
    inc.clickcount += 1;
    inc.signalscore += EVENT_WEIGHTS.product_click;
  }

  if (eventtype === "product_view") {
    inc.detailviewcount += 1;
    inc.signalscore += EVENT_WEIGHTS.product_view;
  }

  if (eventtype === "wishlist_add") {
    inc.wishlistadds += 1;
    inc.signalscore += EVENT_WEIGHTS.wishlist_add;
  }

  if (eventtype === "wishlist_remove") {
    inc.wishlistremoves += 1;
    inc.signalscore += EVENT_WEIGHTS.wishlist_remove;
  }

  if (eventtype === "add_to_cart") {
    inc.cartadds += Math.max(1, toSafeNumber(quantity, 1));
    inc.signalscore += EVENT_WEIGHTS.add_to_cart * Math.max(1, toSafeNumber(quantity, 1));
  }

  if (eventtype === "order") {
    inc.ordercount += 1;
    inc.orderedqty += Math.max(1, toSafeNumber(quantity, 1));
    inc.signalscore += EVENT_WEIGHTS.order * Math.max(1, toSafeNumber(quantity, 1));
  }

  if (eventtype === "dwell") {
    const seconds = Math.max(0, Math.min(1800, toSafeNumber(dwellseconds, 0)));
    if (seconds > 0) {
      inc.dwelltotalseconds += seconds;
      inc.dwellsessions += 1;
      inc.signalscore += Math.max(0.4, seconds / 20);
    }
  }

  return inc;
};

const recordBehaviorSignal = async ({
  actor,
  product,
  eventtype,
  dwellseconds = 0,
  quantity = 1,
}) => {
  if (!actor?.actorid || !product?._id) return null;

  const increment = buildIncrementFromEvent({
    eventtype,
    dwellseconds,
    quantity,
  });

  const categorytokens = extractCategoryTokens(product);
  const categoryleaf = resolveCategoryLeaf(product);
  const pricepoint = getLowestPrice(product);

  return UserProductBehavior.findOneAndUpdate(
    {
      actorid: actor.actorid,
      productid: product._id,
    },
    {
      $setOnInsert: {
        actorid: actor.actorid,
        userid: actor.userid || null,
        sessionkey: actor.sessionkey || "",
        productid: product._id,
      },
      $set: {
        slug: toSafeString(product.slug),
        productname: toSafeString(product.name),
        brand: toSafeString(product.brand),
        categorytokens,
        categoryleaf,
        pricepoint,
        lasteventtype: eventtype,
        lastinteractedat: new Date(),
      },
      $inc: increment,
    },
    { upsert: true, new: true }
  );
};

const resolveProductForSignal = async ({ productid, slug }) => {
  const safeSlug = toSafeString(slug);
  const safeProductId = toSafeString(productid);

  if (safeSlug) {
    return Item.findOne({ slug: safeSlug, isactive: true }).lean();
  }

  if (safeProductId && mongoose.Types.ObjectId.isValid(safeProductId)) {
    return Item.findOne({ _id: safeProductId, isactive: true }).lean();
  }

  return null;
};

module.exports = {
  toSafeString,
  toSafeNumber,
  slugifyLoose,
  extractCategoryTokens,
  resolveCategoryLeaf,
  getLowestPrice,
  getTopDiscount,
  resolveActor,
  resolveProductForSignal,
  recordBehaviorSignal,
};
