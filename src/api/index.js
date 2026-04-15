

const express = require("express")
const dotenv = require("dotenv")
const cors = require("cors")
const cookieparser = require("cookie-parser")
const http = require("http")
const path = require("path")
const { Server } = require("socket.io")
const mongoose = require("mongoose")
const compression = require("compression")
const { setSocketServer } = require("../utils/SocketServer")

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const app = express()

/* ===================== TRUST PROXY (RAILWAY / CLOUD) ===================== */
app.set("trust proxy", 1)

/* ===================== HTTP SERVER ===================== */
const server = http.createServer(app)
const userrouter=require("../routers/AuthRouter.js")
const navrouter=require("../routers/Navrouter.js")
const homebannerroute=require("../routers/HomeBannerRoute.js")
const itemrouter=require("../routers/Itemrouter.js")
const categoryrouter=require("../routers/CategorySliderRouter.js")
const cartrouter=require("../routers/Cartrouter.js")
const brandrouter=require("../routers/Brandrouter.js")
const userrouteradmin=require("../routers/UserRouter.js")
const orderrouter=require("../routers/OrderRouter.js")
const engagementrouter=require("../routers/EngagementRouter.js")
const wishlistrouter=require("../routers/WishlistRouter.js")
const recommendationrouter=require("../routers/RecommendationRouter.js")
const sellerrouter=require("../routers/SellerRouter.js")
/* ===================== SOCKET.IO (REAL-TIME & FAST) ===================== */
const normalizeOrigin = (value = "") => String(value).trim().replace(/\/+$/, "")
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.SECOND_FRONTEND_URL,
  process.env.THIRD_FRONTEND_URL
].map(normalizeOrigin).filter(Boolean)

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true
  },
  pingTimeout: Number(process.env.SOCKET_PING_TIMEOUT) || 20000,
  pingInterval: Number(process.env.SOCKET_PING_INTERVAL) || 25000,
  transports: ["websocket", "polling"]
})
setSocketServer(io)

io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id)

  socket.on("join_room", (roomid) => {
    socket.join(roomid)
    console.log(`User joined room: ${roomid}`)
  })

  socket.on("send_message", (data) => {
    io.to(data.roomid).emit("receive_message", data)
  })

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id)
  })
})

/* ===================== GLOBAL PERFORMANCE MIDDLEWARE ===================== */
app.use(compression()) // gzip compression → faster
app.use(express.json({ limit: "10mb" })) // support large payload
app.use(cookieparser())
app.use("/public", express.static(path.join(__dirname, "../../public")))

/* ===================== PUBLIC CORS (CATEGORY SHOWCASE) ===================== */
const publicCorsPaths = new Set([
  "/category/public/full",
  "/category/active"
])

app.use((req, res, next) => {
  if (!publicCorsPaths.has(req.path)) return next()

  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  res.setHeader("Vary", "Origin")

  if (req.method === "OPTIONS") return res.sendStatus(204)
  return next()
})

/* ===================== CORS (FAST + SAFE) ===================== */
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (!allowedOrigins.length) return callback(null, true)
    if (allowedOrigins.includes(normalizeOrigin(origin))) return callback(null, true)
    return callback(null, false)
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  optionsSuccessStatus: 204
}))

/* ===================== GLOBAL NO-CACHE (LIVE API) ===================== */
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Expires", "0")
  next()
})

/* ===================== MONGODB (ULTRA FAST POOL) ===================== */
let isConnected = false

async function connectDBOnce() {
  if (isConnected) return
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      maxPoolSize: 50,       // massive pool for heavy load
      minPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 60000,
      family: 4
    })
    isConnected = true
    console.log("✅ MongoDB connected ")
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message)
    process.exit(1)
  }
}

connectDBOnce()

/* ===================== VERSION CHECK ===================== */
app.get("/version", (req, res) => {
  res.setHeader("Cache-Control", "no-store")
  res.json({
    version: process.env.npm_package_version || "1.0.0",
    deployedAt: new Date(),
    node: process.version
  })
})

/* ===================== ROUTES ===================== */
app.get("/", (req, res) => {
  res.status(200).send("🚀 Khancosmetics API Running")
})

app.use("/auth",userrouter)
app.use("/nav",navrouter)
app.use("/homebanner",homebannerroute)
app.use("/item",itemrouter)
app.use("/category",categoryrouter)
app.use("/cart",cartrouter)
app.use("/brand",brandrouter)
app.use("/users", userrouteradmin)
app.use("/order", orderrouter)
app.use("/engagement", engagementrouter)
app.use("/wishlist", wishlistrouter)
app.use("/recommendation", recommendationrouter)
app.use("/seller", sellerrouter)
/* ===================== GLOBAL ERROR HANDLER ===================== */
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err)
  if (!res.headersSent) {
    res.status(500).json({ message: "Internal Server Error" })
  }
})

/* ===================== KEEP ALIVE ===================== */
server.keepAliveTimeout = 65000
server.headersTimeout = 66000

/* ===================== START SERVER ===================== */
const PORT = process.env.PORT || 8080

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT} `)
})
