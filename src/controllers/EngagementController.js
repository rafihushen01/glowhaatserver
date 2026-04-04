const mongoose = require("mongoose");
const sanitize = require("mongo-sanitize");
const uploadoncloudinary = require("../utils/Cloudinary");
const Item = require("../models/Item");
const Order = require("../models/Order");
const User = require("../models/User");
const Review = require("../models/Review");
const ProductQuestion = require("../models/ProductQuestion");

const MAX_REVIEW_IMAGES = 8;

const toSafeString = (value) => (value == null ? "" : String(value).trim());
const toSafeLower = (value) => toSafeString(value).toLowerCase();

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = toSafeLower(value);
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const clampRating = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
};

const ensureObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const buildRatingBreakdown = (reviews = []) => {
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach((r) => {
    const key = String(r.rating || 0);
    if (breakdown[key] !== undefined) breakdown[key] += 1;
  });
  return breakdown;
};

const recomputeProductRating = async (productid) => {
  const [summary] = await Review.aggregate([
    {
      $match: {
        productid: new mongoose.Types.ObjectId(String(productid)),
        isapproved: true,
      },
    },
    {
      $group: {
        _id: "$productid",
        avg: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  const average = summary?.avg ? Number(summary.avg.toFixed(2)) : 0;
  const count = summary?.count || 0;

  await Item.findByIdAndUpdate(productid, {
    $set: { star: average, reviewcount: count },
  });

  return { average, count };
};

const ensureSuperAdmin = async (req, res) => {
  const userid = req.user?.userId;
  if (!userid) {
    res.status(401).json({ success: false, message: "Please sign in first to continue." });
    return null;
  }

  const me = await User.findById(userid).select("_id fullname role").lean();
  if (!me || me.role !== "SuperAdmin") {
    res.status(403).json({ success: false, message: "Forbidden" });
    return null;
  }
  return me;
};

exports.getProductEngagementSummary = async (req, res) => {
  try {
    const { productid } = req.params;
    if (!ensureObjectId(productid)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await Item.findById(productid).select("_id name slug star reviewcount").lean();
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const reviews = await Review.find({
      productid,
      isapproved: true,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const questions = await ProductQuestion.find({
      productid,
      isvisible: true,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const ratingBreakdown = buildRatingBreakdown(reviews);
    const totalReviews = reviews.length;
    const averageRating = totalReviews
      ? Number((reviews.reduce((acc, r) => acc + Number(r.rating || 0), 0) / totalReviews).toFixed(2))
      : 0;

    const viewer = {
      isloggedin: false,
      canreview: false,
      hasreviewed: false,
      revieweligibilityreason: "Please sign in to write a verified review.",
    };

    const userid = req.user?.userId;
    if (userid && ensureObjectId(userid)) {
      viewer.isloggedin = true;

      const [hasReview, hasDeliveredOrder] = await Promise.all([
        Review.exists({ productid, userid }),
        Order.exists({ userid, status: "delivered", "items.productid": productid }),
      ]);

      viewer.hasreviewed = Boolean(hasReview);
      viewer.canreview = Boolean(hasDeliveredOrder) && !Boolean(hasReview);

      if (viewer.canreview) {
        viewer.revieweligibilityreason = "You can submit a verified review.";
      } else if (viewer.hasreviewed) {
        viewer.revieweligibilityreason = "You already reviewed this product.";
      } else {
        viewer.revieweligibilityreason = "Only delivered orders can submit verified reviews.";
      }
    }

    return res.status(200).json({
      success: true,
      summary: {
        product: {
          _id: product._id,
          name: product.name,
          slug: product.slug,
          averagerating: averageRating,
          totalreviews: totalReviews,
          ratingbreakdown: ratingBreakdown,
        },
        viewer,
        reviews: reviews.map((review) => ({
          _id: review._id,
          rating: review.rating,
          comment: review.comment,
          images: Array.isArray(review.images) ? review.images : [],
          reviewername: toSafeString(review.reviewername) || "Verified Buyer",
          revieweremail: toSafeString(review.revieweremail),
          isverifiedpurchase: Boolean(review.isverifiedpurchase),
          createdAt: review.createdAt,
        })),
        questions: questions.map((entry) => ({
          _id: entry._id,
          question: entry.question,
          askedbyname: toSafeString(entry.askedbyname) || "KhanCosmetics User",
          askedbyemail: toSafeString(entry.askedbyemail),
          createdAt: entry.createdAt,
          isanswered: Boolean(entry.isanswered),
          answertext: toSafeString(entry.answertext),
          answeredbyname: toSafeString(entry.answeredbyname),
          answeredat: entry.answeredat,
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to load product engagement data",
      error: error.message,
    });
  }
};

exports.createReview = async (req, res) => {
  try {
    const userid = req.user?.userId;
    if (!userid) {
      return res.status(401).json({ success: false, message: "Please sign in first to continue." });
    }

    const { productid } = req.params;
    if (!ensureObjectId(productid)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await Item.findById(productid).select("_id name slug").lean();
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const existingReview = await Review.exists({ productid, userid });
    if (existingReview) {
      return res.status(409).json({
        success: false,
        message: "You already reviewed this product",
      });
    }

    const deliveredOrder = await Order.findOne({
      userid,
      status: "delivered",
      "items.productid": productid,
    })
      .sort({ createdAt: -1 })
      .select("_id");

    if (!deliveredOrder) {
      return res.status(403).json({
        success: false,
        message: "Only users with delivered orders can submit verified reviews.",
      });
    }

    const payload = sanitize(req.body || {});
    const rating = clampRating(payload.rating);
    const comment = toSafeString(payload.comment);
    const reviewernameInput = toSafeString(payload.reviewername);
    const revieweremailInput = toSafeLower(payload.revieweremail);
    const useplatformemail = parseBoolean(payload.useplatformemail, true);

    if (!rating) {
      return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
    }

    if (!comment || comment.length < 3) {
      return res.status(400).json({ success: false, message: "Review comment is too short." });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length > MAX_REVIEW_IMAGES) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_REVIEW_IMAGES} images are allowed per review.`,
      });
    }

    const user = await User.findById(userid).select("_id fullname email").lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const uploadTargets = files.filter((file) => String(file.mimetype || "").startsWith("image/"));
    const uploadedImages = (
      await Promise.all(
        uploadTargets.map(async (file) => {
          try {
            return await uploadoncloudinary(file.path);
          } catch (_error) {
            return null;
          }
        })
      )
    ).filter(Boolean);

    const reviewername = reviewernameInput || toSafeString(user.fullname) || "Verified Buyer";
    const revieweremail =
      (useplatformemail ? toSafeLower(user.email) : revieweremailInput) || toSafeLower(user.email) || "";

    const review = await Review.create({
      productid,
      userid,
      orderid: deliveredOrder._id,
      rating,
      comment,
      reviewername,
      revieweremail,
      useplatformemail,
      images: uploadedImages.slice(0, MAX_REVIEW_IMAGES),
      isverifiedpurchase: true,
    });

    const productRating = await recomputeProductRating(productid);

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      review: {
        _id: review._id,
        rating: review.rating,
        comment: review.comment,
        images: review.images,
        reviewername: review.reviewername,
        revieweremail: review.revieweremail,
        isverifiedpurchase: review.isverifiedpurchase,
        createdAt: review.createdAt,
      },
      productrating: productRating,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "You already reviewed this product",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to submit review",
      error: error.message,
    });
  }
};

exports.askQuestion = async (req, res) => {
  try {
    const userid = req.user?.userId;
    if (!userid) {
      return res.status(401).json({ success: false, message: "Please sign in first to continue." });
    }

    const { productid } = req.params;
    if (!ensureObjectId(productid)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await Item.findById(productid).select("_id").lean();
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const payload = sanitize(req.body || {});
    const question = toSafeString(payload.question);
    if (!question || question.length < 6) {
      return res.status(400).json({ success: false, message: "Question is too short." });
    }

    const user = await User.findById(userid).select("_id fullname email").lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const entry = await ProductQuestion.create({
      productid,
      userid,
      question,
      askedbyname: toSafeString(user.fullname) || "KhanCosmetics User",
      askedbyemail: toSafeLower(user.email),
      isanswered: false,
    });

    return res.status(201).json({
      success: true,
      message: "Question submitted successfully",
      question: entry,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to submit question",
      error: error.message,
    });
  }
};

exports.getAllQuestionsForAdmin = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const query = sanitize(req.query || {});
    const status = toSafeLower(query.status || "all");
    const q = toSafeString(query.q);
    const filters = {};

    if (status === "answered") filters.isanswered = true;
    if (status === "unanswered") filters.isanswered = false;

    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      filters.$or = [{ question: regex }, { askedbyname: regex }, { askedbyemail: regex }];
    }

    const questions = await ProductQuestion.find(filters)
      .sort({ createdAt: -1 })
      .populate("productid", "_id name slug")
      .lean();

    return res.status(200).json({
      success: true,
      count: questions.length,
      questions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch questions",
      error: error.message,
    });
  }
};

exports.answerQuestion = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const { id } = req.params;
    if (!ensureObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid question id" });
    }

    const payload = sanitize(req.body || {});
    const answertext = toSafeString(payload.answertext);
    if (!answertext || answertext.length < 2) {
      return res.status(400).json({ success: false, message: "Answer is too short." });
    }

    const updated = await ProductQuestion.findByIdAndUpdate(
      id,
      {
        $set: {
          answertext,
          isanswered: true,
          answeredby: me._id,
          answeredbyname: toSafeString(me.fullname) || "KhanCosmetics SuperAdmin",
          answeredat: new Date(),
        },
      },
      { new: true }
    )
      .populate("productid", "_id name slug")
      .lean();

    if (!updated) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Answer submitted successfully",
      question: updated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to submit answer",
      error: error.message,
    });
  }
};


