const sanitize = require("mongo-sanitize");
const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const User = require("../models/User");
const { requireActor } = require("../utils/RequestActor");
const Item = require("../models/Item");
const { resolveActor, recordBehaviorSignal } = require("../utils/RecommendationSignals");

const ALLOWED_STATUSES = ["placed", "processing", "shipped", "delivered", "returned", "canceled"];
const ALLOWED_PAYMENT_METHODS = ["cod", "bkash", "nagad", "bank"];

const toSafeString = (value) => (value == null ? "" : String(value).trim());

const toSafeNumber = (value, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

const generateOrderNumber = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `KC-${y}${m}${d}-${random}`;
};

const ensureSuperAdmin = async (req, res) => {
  const userid = req.user?.userId;
  if (!userid) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userid).select("_id role").lean();
  if (!me || me.role !== "SuperAdmin") {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return me;
};

exports.placeorder = async (req, res) => {
  try {
    const requestactor = requireActor(req, res);
    if (!requestactor) return;

    const payload = sanitize(req.body || {});
    const fullname = toSafeString(payload.fullname);
    const mobile = toSafeString(payload.mobile);
    const email = toSafeString(payload.email).toLowerCase();
    const district = toSafeString(payload.district);
    const city = toSafeString(payload.city);
    const upzilla = toSafeString(payload.upzilla);
    const area = toSafeString(payload.area);
    const addressline = toSafeString(payload.addressline);
    const landmark = toSafeString(payload.landmark);
    const locationtext = toSafeString(payload.locationtext);
    const notes = toSafeString(payload.notes);
    const paymentmethod = toSafeString(payload.paymentmethod).toLowerCase() || "cod";
    const paymentreference = toSafeString(payload.paymentreference);
    const paymentnote = toSafeString(payload.paymentnote);
    const latitude = toSafeNumber(payload.latitude, null);
    const longitude = toSafeNumber(payload.longitude, null);

    if (!fullname || !mobile || !district || !city || !addressline) {
      return res.status(400).json({
        success: false,
        message: "Please provide required checkout information",
      });
    }

    if (!ALLOWED_PAYMENT_METHODS.includes(paymentmethod)) {
      return res.status(400).json({ success: false, message: "Invalid payment method" });
    }

    if (paymentmethod !== "cod" && !paymentreference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required for this payment method",
      });
    }

    const cartItems = await Cart.find(requestactor.ownerfilter).sort({ updatedAt: -1 }).lean();
    if (!cartItems.length) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    const items = cartItems.map((item) => ({
      productid: item.productid,
      slug: item.slug || "",
      name: item.name || "",
      brand: item.brand || "",
      image: item.image || "",
      variantname: item.variantname || "",
      optionname: item.optionname || "",
      variantindex: Number(item.variantindex || 0),
      optionindex: Number(item.optionindex || 0),
      unitprice: Math.max(0, Number(item.unitprice || 0)),
      baseprice: Math.max(0, Number(item.baseprice || 0)),
      discountpercentage: Math.max(0, Number(item.discountpercentage || 0)),
      deliverycharge: Math.max(0, Number(item.deliverycharge || 0)),
      quantity: Math.max(1, Number(item.quantity || 1)),
      totalprice: Math.max(0, Number(item.totalprice || 0)),
      productsnapshot: item.productsnapshot || {},
    }));

    const subtotal = items.reduce((sum, item) => sum + Number(item.totalprice || 0), 0);
    const deliverytotal = items.reduce(
      (sum, item) => sum + Number(item.deliverycharge || 0) * Number(item.quantity || 0),
      0
    );
    const grandtotal = subtotal + deliverytotal;

    let ordernumber = generateOrderNumber();
    let collision = await Order.exists({ ordernumber });
    while (collision) {
      ordernumber = generateOrderNumber();
      collision = await Order.exists({ ordernumber });
    }

    const order = await Order.create({
      ownerid: requestactor.ownerid,
      userid: requestactor.userid || null,
      guestid: requestactor.guestid || "",
      ordernumber,
      customer: { fullname, email, mobile },
      shippingaddress: {
        district,
        city,
        upzilla,
        area,
        addressline,
        landmark,
        locationtext,
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
      },
      payment: {
        method: paymentmethod,
        reference: paymentreference,
        note: paymentnote,
      },
      notes,
      items,
      subtotal,
      deliverytotal,
      grandtotal,
      status: "placed",
      statushistory: [
        {
          status: "placed",
          note: "Order placed successfully",
          changedby: requestactor.userid || null,
        },
      ],
    });

    await Cart.deleteMany(requestactor.ownerfilter);
    if (requestactor.userid) {
      await User.findByIdAndUpdate(requestactor.userid, {
        $inc: { totalorders: 1, totalspent: grandtotal },
      });
    }

    const actor = resolveActor(req, payload);
    if (actor) {
      const productIds = items.map((entry) => entry.productid);
      const products = await Item.find({ _id: { $in: productIds } })
        .select("_id slug name brand categorytree categorypath variants isactive")
        .lean();
      const productMap = new Map(products.map((entry) => [String(entry._id), entry]));

      await Promise.all(
        items.map(async (entry) => {
          const product = productMap.get(String(entry.productid));
          if (!product) return;
          await recordBehaviorSignal({
            actor,
            product,
            eventtype: "order",
            quantity: Number(entry.quantity || 1),
          });
        })
      );
    }

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to place order",
      error: error.message,
    });
  }
};

exports.getmyorders = async (req, res) => {
  try {
    const requestactor = requireActor(req, res);
    if (!requestactor) return;

    const query = sanitize(req.query || {});
    const status = toSafeString(query.status).toLowerCase();
    const filters = { ...requestactor.ownerfilter };
    if (status && ALLOWED_STATUSES.includes(status)) {
      filters.status = status;
    }

    const orders = await Order.find(filters)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, count: orders.length, orders });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch your orders",
      error: error.message,
    });
  }
};

exports.getmyorderbyid = async (req, res) => {
  try {
    const requestactor = requireActor(req, res);
    if (!requestactor) return;

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const order = await Order.findOne({ _id: id, ...requestactor.ownerfilter }).lean();
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    return res.status(200).json({ success: true, order });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch order",
      error: error.message,
    });
  }
};

exports.getallordersadmin = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const query = sanitize(req.query || {});
    const status = toSafeString(query.status).toLowerCase();
    const q = toSafeString(query.q);
    const filters = {};

    if (status && ALLOWED_STATUSES.includes(status)) {
      filters.status = status;
    }

    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      filters.$or = [
        { ordernumber: regex },
        { "customer.fullname": regex },
        { "customer.mobile": regex },
        { "customer.email": regex },
        { "shippingaddress.city": regex },
      ];
    }

    const orders = await Order.find(filters)
      .sort({ createdAt: -1 })
      .populate("userid", "_id fullname email role")
      .lean();

    return res.status(200).json({ success: true, count: orders.length, orders });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
};

exports.updateorderstatus = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }

    const payload = sanitize(req.body || {});
    const status = toSafeString(payload.status).toLowerCase();
    const note = toSafeString(payload.note);

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    order.status = status;
    order.statushistory.push({
      status,
      note: note || `Status changed to ${status}`,
      changedby: me._id,
      changedat: new Date(),
    });
    await order.save();

    return res.status(200).json({
      success: true,
      message: "Order status updated",
      order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: error.message,
    });
  }
};


