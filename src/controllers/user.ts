import { Request, Response, RequestHandler } from "express";
import { User } from "../models/User";
import { logger } from "../utils/logger";
import { uploadImage } from "../services/cloudinary.service";

/**
 * Update user profile details (name, email, profileImage)
 */
export const updateProfile: RequestHandler = async (req, res) => {
  console.log("---- REQUEST DEBUG (updateProfile) ----");
  console.log("BODY:", req.body);
  console.log("USER:", req.user);

  if (!req.user) {
    console.error("USER UNDEFINED - AUTH FAILED");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id;
    const { name, email, profileImage, aiName, aiBehavior, aiAvatar } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (profileImage !== undefined) updateData.profileImage = profileImage;
    if (aiName !== undefined) updateData.aiName = aiName;
    if (aiBehavior !== undefined) updateData.aiBehavior = aiBehavior;
    if (aiAvatar !== undefined) updateData.aiAvatar = aiAvatar;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Profile updated successfully",
      user,
    });
  } catch (err: any) {
    console.error("ERROR (updateProfile):", err);
    res.status(500).json({
      message: "Internal error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};

/**
 * Get current user profile
 */
export const getProfile: RequestHandler = async (req, res) => {
  console.log("---- REQUEST DEBUG (getProfile) ----");
  console.log("USER:", req.user);

  if (!req.user) {
    console.error("USER UNDEFINED - AUTH FAILED");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (err: any) {
    console.error("ERROR (getProfile):", err);
    res.status(500).json({
      message: "Internal error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};

/**
 * Upload profile avatar to Cloudinary
 */
export const uploadAvatar: RequestHandler = async (req, res) => {
  console.log("---- REQUEST DEBUG (uploadAvatar) ----");
  console.log("FILE:", req.file);
  console.log("USER:", req.user);

  if (!req.user) {
    console.error("USER UNDEFINED - AUTH FAILED");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    logger.info("📤 Uploading avatar to Cloudinary...");
    const imageUrl = await uploadImage(req.file.buffer);

    res.status(200).json({
      message: "Image uploaded successfully",
      imageUrl,
    });
  } catch (err: any) {
    console.error("ERROR (uploadAvatar):", err);
    res.status(500).json({
      message: "Internal error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};
/**
 * Upload AI avatar to Cloudinary
 */
export const uploadAiAvatar: RequestHandler = async (req, res) => {
  console.log("---- REQUEST DEBUG (uploadAiAvatar) ----");
  console.log("FILE:", req.file);
  console.log("USER:", req.user);

  if (!req.user) {
    console.error("USER UNDEFINED - AUTH FAILED");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    logger.info("📤 Uploading AI avatar to Cloudinary...");
    const imageUrl = await uploadImage(req.file.buffer);

    res.status(200).json({
      message: "AI Avatar uploaded successfully",
      imageUrl,
    });
  } catch (err: any) {
    console.error("ERROR (uploadAiAvatar):", err);
    res.status(500).json({
      message: "Internal error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};
