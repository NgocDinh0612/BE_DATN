const jwt = require('jsonwebtoken');
const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET;

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Thiếu hoặc sai định dạng token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ message: "Không tìm thấy User" });

    req.user = {
      userId: user._id,
      role: user.role,
      username: user.username,
      email: user.email,
    };

    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(401).json({ message: "Token không hợp lệ hoặc đã hết hạn" });
  }
}

function authorize(roles = []) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Không đủ quyền truy cập" });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
