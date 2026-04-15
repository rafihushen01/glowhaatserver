const sanitize = require("mongo-sanitize");
const jwt = require("jsonwebtoken");
const path = require("path");
const validator = require("validator");
const bcrypt = require("bcryptjs");
const SellerRequest = require("../models/SellerRequest");
const User = require("../models/User");
const uploadoncloudinary = require("../utils/Cloudinary");

const normalizeEmail = (value = "") => String(value).trim().toLowerCase();
const normalizeText = (value = "") => String(value).trim();
const normalizeMobile = (value = "") => String(value).trim();
const isValidMobile = (value = "") => /^\+?\d{8,15}$/.test(String(value).trim());
const MAX_TOTAL_REQUESTS = 5;
const MAX_CONSECUTIVE_REJECTIONS = 4;

const getJwtSecret = () => process.env.SECRETKEY || "seller-secret";

const signSellerStepToken = (payload = {}) => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "20m" });
};

const verifySellerStepToken = (token = "") => {
  return jwt.verify(token, getJwtSecret());
};

const uploadSingleFile = async (fileArray = []) => {
  const file = Array.isArray(fileArray) ? fileArray[0] : null;
  if (!file?.path) return "";

  try {
    return await uploadoncloudinary(file.path);
  } catch (_error) {
    const filename = path.basename(file.path);
    return `/public/${filename}`;
  }
};

const uploadFiles = async (files = {}) => {
  return {
    storeprofileimage: await uploadSingleFile(files.storeprofileimage),
    storebannerimage: await uploadSingleFile(files.storebannerimage),
    physicalstoreimage: await uploadSingleFile(files.physicalstoreimage),
    niddocfront: await uploadSingleFile(files.niddocfront),
    niddocback: await uploadSingleFile(files.niddocback),
    dateofbirthproof: await uploadSingleFile(files.dateofbirthproof),
  };
};

const findUserByAuthOrEmail = async (req, email = "") => {
  if (req.user?.userId) {
    const byId = await User.findById(req.user.userId);
    if (byId) return byId;
  }
  if (!email) return null;
  return await User.findOne({ email });
};

const getRequestAttemptMeta = async (email = "") => {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail) {
    return {
      totalAttempts: 0,
      consecutiveRejections: 0,
      hasPending: false,
      isBlocked: false,
      canApply: true,
    };
  }

  const history = await SellerRequest.find({ email: safeEmail })
    .sort({ createdAt: -1 })
    .select("status")
    .lean();

  let consecutiveRejections = 0;
  for (const entry of history) {
    if (entry?.status === "Rejected") consecutiveRejections += 1;
    else break;
  }

  const hasPending = history.some((entry) => entry?.status === "Pending");
  const totalAttempts = history.length;
  const isBlocked =
    consecutiveRejections >= MAX_CONSECUTIVE_REJECTIONS || totalAttempts >= MAX_TOTAL_REQUESTS;

  return {
    totalAttempts,
    consecutiveRejections,
    hasPending,
    isBlocked,
    canApply: !hasPending && !isBlocked,
  };
};

const ensureSuperAdmin = async (req, res) => {
  const userid = req.user?.userId;
  if (!userid) {
    res.status(401).json({ message: "Please sign in first to continue." });
    return null;
  }
  const me = await User.findById(userid).select("_id role email").lean();
  if (!me || me.role !== "SuperAdmin") {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }
  return me;
};

exports.startSellerOnboarding = async (req, res) => {
  try {
    const payload = sanitize(req.body || {});
    const fullname = normalizeText(payload.fullname);
    const email = normalizeEmail(payload.email);
    const mobile = normalizeMobile(payload.mobile);
    const whatsapp = normalizeMobile(payload.whatsapp || "");
    const sellerpassword = normalizeText(payload.sellerpassword || "");
    const confirmpassword = normalizeText(payload.confirmpassword || "");

    if (!fullname || !email || !mobile || !sellerpassword) {
      return res
        .status(400)
        .json({ message: "Full name, email, mobile, and seller password are required." });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: "Invalid email address." });
    }

    if (!isValidMobile(mobile)) {
      return res.status(400).json({ message: "Invalid mobile number." });
    }

    if (whatsapp && !isValidMobile(whatsapp)) {
      return res.status(400).json({ message: "Invalid WhatsApp number." });
    }

    if (sellerpassword.length < 6) {
      return res.status(400).json({ message: "Seller password must be at least 6 characters." });
    }

    if (confirmpassword && sellerpassword !== confirmpassword) {
      return res.status(400).json({ message: "Seller password and confirm password do not match." });
    }

    const attempts = await getRequestAttemptMeta(email);
    if (attempts.hasPending) {
      return res.status(409).json({
        message: "Your previous seller request is still pending. Please wait for authority response.",
      });
    }
    if (attempts.isBlocked) {
      return res.status(403).json({
        message:
          "Dear applicant, our authority has rejected your seller requests multiple times. Seller request access is now blocked.",
      });
    }

    const sellerpasswordhash = await bcrypt.hash(sellerpassword, 12);
    const stepToken = signSellerStepToken({
      fullname,
      email,
      mobile,
      whatsapp,
      sellerpasswordhash,
      userid: req.user?.userId || null,
      purpose: "seller_step1_verified",
    });

    return res.status(200).json({
      success: true,
      token: stepToken,
      message: "Step 1 completed.",
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to complete step 1." });
  }
};

exports.requestSellerOtp = async (req, res) => {
  return exports.startSellerOnboarding(req, res);
};

exports.verifySellerOtp = async (req, res) => {
  return res.status(410).json({ message: "OTP verification is disabled. Use /seller/start instead." });
};

exports.submitSellerRequest = async (req, res) => {
  try {
    const payload = sanitize(req.body || {});
    const token = normalizeText(payload.stepToken);
    if (!token) return res.status(400).json({ message: "Verification token missing." });

    let decoded;
    try {
      decoded = verifySellerStepToken(token);
    } catch (_error) {
      return res.status(401).json({ message: "Step 1 verification expired. Please verify again." });
    }

    if (decoded?.purpose !== "seller_step1_verified") {
      return res.status(401).json({ message: "Invalid verification token." });
    }

    const fullname = normalizeText(decoded.fullname);
    const email = normalizeEmail(decoded.email);
    const mobile = normalizeMobile(decoded.mobile);
    const whatsapp = normalizeMobile(decoded.whatsapp || "");
    const sellerpasswordhash = normalizeText(decoded.sellerpasswordhash || "");

    const dateofbirth = payload.dateofbirth ? new Date(payload.dateofbirth) : null;
    const storetype = normalizeText(payload.storetype);
    const businessname = normalizeText(payload.businessname);
    const businessgmail = normalizeEmail(payload.businessgmail);
    const sellerloginemail = normalizeEmail(payload.sellerloginemail || email);
    const businessphone = normalizeMobile(payload.businessphone || "");
    const businessmodel = normalizeText(payload.businessmodel);
    const preferredcategories = Array.isArray(payload.preferredcategories)
      ? payload.preferredcategories.map(normalizeText).filter(Boolean)
      : String(payload.preferredcategories || "")
          .split(",")
          .map(normalizeText)
          .filter(Boolean);

    const pickup = {
      district: normalizeText(payload.pickupdistrict),
      city: normalizeText(payload.pickupcity),
      area: normalizeText(payload.pickuparea),
      addressline: normalizeText(payload.pickupaddressline),
      deliverymanphone: normalizeMobile(payload.deliverymanphone),
    };

    const businessdetails = {
      physicalstorename: normalizeText(payload.physicalstorename),
      physicalstoreaddress: normalizeText(payload.physicalstoreaddress),
      physicalstoredistrict: normalizeText(payload.physicalstoredistrict),
      physicalstorecity: normalizeText(payload.physicalstorecity),
      facebookpagename: normalizeText(payload.facebookpagename),
      facebookpagelink: normalizeText(payload.facebookpagelink),
      instagramidname: normalizeText(payload.instagramidname),
      instagramlink: normalizeText(payload.instagramlink),
      websiteurl: normalizeText(payload.websiteurl),
    };

    if (!fullname || !email || !mobile || !dateofbirth || Number.isNaN(dateofbirth.getTime())) {
      return res.status(400).json({ message: "Invalid personal information." });
    }

    if (!storetype || !businessname || !businessgmail || !businessmodel) {
      return res.status(400).json({ message: "Business information is incomplete." });
    }

    if (!sellerpasswordhash || !sellerloginemail) {
      return res.status(400).json({ message: "Seller login credentials are missing." });
    }

    if (!validator.isEmail(businessgmail)) {
      return res.status(400).json({ message: "Invalid business email." });
    }
    if (!validator.isEmail(sellerloginemail)) {
      return res.status(400).json({ message: "Invalid seller login email." });
    }

    if (!pickup.district || !pickup.city || !pickup.area || !pickup.deliverymanphone) {
      return res.status(400).json({ message: "Pickup information is required." });
    }

    if (!isValidMobile(pickup.deliverymanphone)) {
      return res.status(400).json({ message: "Invalid deliveryman contact number." });
    }

    const attempts = await getRequestAttemptMeta(email);
    if (attempts.hasPending) {
      return res.status(409).json({
        message: "You already have a pending seller request. Please wait for authority response.",
      });
    }

    if (attempts.isBlocked) {
      return res.status(403).json({
        message:
          "Dear applicant, our authority has rejected your seller requests multiple times. Seller request access is now blocked.",
      });
    }

    const files = await uploadFiles(req.files || {});
    if (!files.storeprofileimage || !files.storebannerimage || !files.niddocfront || !files.niddocback) {
      return res.status(400).json({ message: "Store profile, banner, and NID images are required." });
    }

    const linkedUser = await findUserByAuthOrEmail(req, email);

    const created = await SellerRequest.create({
      userid: linkedUser?._id || decoded.userid || null,
      fullname,
      email,
      mobile,
      whatsapp,
      dateofbirth,
      storetype,
      preferredcategories,
      businessname,
      businessgmail,
      businessphone,
      sellerloginemail,
      sellerpasswordhash,
      businessmodel,
      businessdetails,
      pickup,
      files,
      status: "Pending",
    });

    if (linkedUser) {
      linkedUser.issellerverified = false;
      await linkedUser.save();
    }

    return res.status(201).json({
      success: true,
      message: "Seller request submitted successfully.",
      requestid: created._id,
      status: created.status,
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to submit seller request." });
  }
};

exports.getSellerRequestStatus = async (req, res) => {
  try {
    const payload = sanitize(req.query || {});
    let email = normalizeEmail(payload.email);
    const userid = req.user?.userId || null;

    let request = null;

    if (userid) {
      if (!email) {
        const me = await User.findById(userid).select("email").lean();
        email = normalizeEmail(me?.email || "");
      }
      request = await SellerRequest.findOne({ userid }).sort({ createdAt: -1 }).lean();
    }

    if (!request && email) {
      request = await SellerRequest.findOne({ email }).sort({ createdAt: -1 }).lean();
    }

    if (!request) {
      return res.status(200).json({
        success: true,
        hasrequest: false,
        meta: await getRequestAttemptMeta(email),
      });
    }

    return res.status(200).json({
      success: true,
      hasrequest: true,
      request: {
        id: request._id,
        status: request.status,
        rejectreason: request.rejectreason || "",
        fullname: request.fullname,
        email: request.email,
        businessname: request.businessname,
        businessgmail: request.businessgmail,
        sellerloginemail: request.sellerloginemail || request.email,
        storetype: request.storetype,
        createdAt: request.createdAt,
        reviewedat: request.reviewedat,
      },
      meta: await getRequestAttemptMeta(request.email),
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to fetch seller status." });
  }
};

exports.listSellerRequestsForAdmin = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const payload = sanitize(req.query || {});
    const page = Math.max(1, Number(payload.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(payload.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (payload.status) filter.status = normalizeText(payload.status);
    if (payload.q) {
      const safe = normalizeText(payload.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { fullname: new RegExp(safe, "i") },
        { email: new RegExp(safe, "i") },
        { businessname: new RegExp(safe, "i") },
        { storetype: new RegExp(safe, "i") },
      ];
    }

    const [count, requests] = await Promise.all([
      SellerRequest.countDocuments(filter),
      SellerRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          "_id fullname email mobile whatsapp status rejectreason businessname businessgmail businessphone sellerloginemail storetype businessmodel preferredcategories businessdetails pickup files dateofbirth createdAt reviewedat"
        )
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      count,
      page,
      pages: Math.ceil(count / limit),
      requests,
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to fetch seller requests." });
  }
};

exports.decideSellerRequest = async (req, res) => {
  try {
    const me = await ensureSuperAdmin(req, res);
    if (!me) return;

    const requestid = normalizeText(req.params.id);
    const payload = sanitize(req.body || {});
    const decision = normalizeText(payload.decision);
    const rejectreason = normalizeText(payload.rejectreason);

    if (!["Approved", "Rejected"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be Approved or Rejected." });
    }
    if (decision === "Rejected" && !rejectreason) {
      return res.status(400).json({ message: "Reject reason is required." });
    }

    const existing = await SellerRequest.findById(requestid);
    if (!existing) return res.status(404).json({ message: "Seller request not found." });

    existing.status = decision;
    existing.rejectreason = decision === "Rejected" ? rejectreason : "";
    existing.reviewedby = me._id;
    existing.reviewedat = new Date();

    const sellerLoginEmail = normalizeEmail(existing.sellerloginemail || existing.email);
    let linkedUser =
      (existing.userid && (await User.findById(existing.userid))) ||
      (await User.findOne({ email: sellerLoginEmail })) ||
      (await User.findOne({ email: existing.email }));

    if (decision === "Approved") {
      if (!linkedUser && !existing.sellerpasswordhash) {
        return res
          .status(400)
          .json({ message: "Seller password missing in this request. Ask applicant to resubmit." });
      }

      if (!linkedUser) {
        linkedUser = await User.create({
          fullname: existing.fullname || "Seller",
          email: sellerLoginEmail,
          password: existing.sellerpasswordhash,
          mobile: existing.mobile || undefined,
          gender: "Other",
          role: "Seller",
          issellerverified: true,
          sellerapprovedat: new Date(),
        });
      } else {
        linkedUser.email = sellerLoginEmail || linkedUser.email;
        if (existing.sellerpasswordhash) linkedUser.password = existing.sellerpasswordhash;
        linkedUser.role = "Seller";
        linkedUser.issellerverified = true;
        linkedUser.sellerapprovedat = new Date();
        await linkedUser.save();
      }

      existing.userid = linkedUser._id;
    } else if (linkedUser) {
      linkedUser.issellerverified = false;
      await linkedUser.save();
    }

    await existing.save();

    return res.status(200).json({
      success: true,
      message: `Seller request ${decision.toLowerCase()}.`,
    });
  } catch (_error) {
    return res.status(500).json({ message: "Failed to update seller request." });
  }
};
