const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },

    email: { type: String, required: true, unique: true },
    contact: { type: String, default: "" },
    address1: { type: String, default: "" },

    username: { type: String, unique: true, sparse: true },

    password: { type: String },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    // Xác thực email
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationExpiry: { type: Date },

    // OAuth
    googleId: { type: String },
    lastActivity: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);  
