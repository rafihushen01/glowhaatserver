const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();
const mongoURI = process.env.MONGO_URL;
const connectdb = async () => {
  try {
    await mongoose.connect(mongoURI);
    console.log("MongoDB connected");
  } catch (error) {
    console.log(`Db error ${error}`);
  }
};
module.exports = connectdb;
