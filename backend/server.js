import express from "express";
import db from "./db.js";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import cors from "cors";

const app = express();
const saltRounds = parseInt(process.env.SALT_ROUNDS);
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only images allowed"), false);
    }
  },
});

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

dotenv.config();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
  res.json({ message: "Aaalu le lo" });
});

app.post(
  "/signup",
  async (req, res, next) => {
    console.log("signup middleware");
    if (
      !(req.body.email &&
      req.body.password &&
      req.body.type &&
      req.body.fullName &&
      req.body.type == "employer"
        ? req.body.companyName
        : true)
    ) {
      return res.status(400).json({
        success: false,
        name: "INCOMPLETE_BODY",
        code: 61,
        message: "signup request body is incomplete.",
      });
    }
    const { email } = req.body;
    try {
      const response = await db.query(
        "SELECT * FROM users WHERE user_email = $1",
        [email]
      );
      if (response.rows.length == 0) {
        next();
      } else {
        return res.status(409).json({
          success: false,
          name: "INVALID_CREDENTIALS",
          code: 62,
          message: "the email passed for signup already exists in the server",
        });
      }
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  },
  async (req, res) => {
    console.log("signup route handler");

    const body = req.body;
    const { email, password, type, fullName } = body;
    const salt = await bcrypt.genSalt(saltRounds);
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      const data = await db.query(
        "INSERT INTO users(user_email, user_password, user_type) VALUES ($1,$2,$3) RETURNING user_id",
        [email, hashedPassword, type]
      );
      const user_id = await data.rows[0].user_id;
      if (type == "seeker") {
        await db.query(
          "insert into user_details(details_user_id,details_user_full_name) values ($1, $2)",
          [user_id, fullName]
        );
      } else {
        await db.query(
          "insert into user_details(details_user_id,details_user_full_name, details_company_name) values ($1, $2)",
          [user_id, fullName, body.companyName]
        );
      }
      res.status(200).json({
        success: true,
        code: 64,
        message: "user signup was successful",
      });
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  }
);

app.post(
  "/signin",
  async (req, res, next) => {
    if (!(req.body.email && req.body.password)) {
      return res.status(400).json({
        success: false,
        name: "INCOMPLETE_BODY",
        code: 61,
        message: "signin request body is incomplete.",
      });
    }
    const { email } = req.body;
    try {
      const response = await db.query(
        "SELECT * FROM users WHERE user_email = $1",
        [email]
      );
      if (response.rows.length == 1) {
        next();
      } else {
        return res.status(401).json({
          success: false,
          name: "INVALID_CREDENTIALS",
          code: 62,
          message:
            "the email passed for signin does not exist in the server, please signup",
        });
      }
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  },
  async (req, res) => {
    const body = req.body;
    const { email, password } = body;
    try {
      const result = await db.query(
        "SELECT * FROM users WHERE user_email = $1",
        [email]
      );
      const hashedPassword = result.rows[0].user_password;
      const userType = result.rows[0].user_type;
      const userId = result.rows[0].user_id;
      const isMatching = await bcrypt.compare(password, hashedPassword);
      if (isMatching) {
        const accessToken = jwt.sign(
          {
            user_email: email,
            user_type: userType,
            user_id: userId,
          },
          process.env.ACCESS_TOKEN_SECRET_KEY,
          { expiresIn: "15m" }
        );

        const refreshToken = jwt.sign(
          { user_email: email, user_id: userId },
          process.env.REFRESH_TOKEN_SECRET_KEY,
          { expiresIn: "7d" }
        );

        const refreshTokenExpiryTime = jwt.decode(refreshToken).exp;

        await db.query(
          "DELETE FROM user_refresh_tokens WHERE refresh_user_email = $1",
          [email]
        );

        await db.query(
          "INSERT INTO user_refresh_tokens (refresh_user_email, refresh_token, refresh_token_expires_at) VALUES ($1, $2, to_timestamp($3))",
          [email, refreshToken, refreshTokenExpiryTime]
        );

        res.cookie("jobify_refresh_token", refreshToken, {
          httpOnly: true,
          secure: true,
          sameSite: "strict",
        });
        res.status(200).json({
          success: true,
          code: 64,
          message: "user signin was successful",
          access_token: accessToken,
        });
      } else {
        return res.status(401).json({
          success: false,
          name: "INVALID_CREDENTIALS",
          code: 65,
          message: "the password passed for signin is invalid.",
        });
      }
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  }
);

app.post(
  "/login",
  (req, res, next) => {
    if (!req.headers.authorization) {
      return res.status(400).json({
        success: false,
        name: "INCOMPLETE_BODY",
        code: 61,
        message: "access token missing.",
      });
    } else {
      next();
    }
  },
  (req, res) => {
    const accessToken = req.headers.authorization.split(" ")[1];
    jwt.verify(
      accessToken,
      process.env.ACCESS_TOKEN_SECRET_KEY,
      (err, user) => {
        if (err) {
          return res.status(401).json({
            success: false,
            name: "INVALID_CREDENTIALS",
            code: 66,
            message: "the access token passed for login is invalid.",
          });
        } else {
          res.status(200).json({
            success: true,
            code: 64,
            message: "user login was successful",
          });
        }
      }
    );
  }
);

app.post(
  "/refresh",
  async (req, res, next) => {
    if (!req.cookies.jobify_refresh_token) {
      return res.status(400).json({
        success: false,
        name: "INCOMPLETE_BODY",
        code: 61,
        message: "refresh token missing.",
      });
    }
    try {
      const refreshToken = req.cookies.jobify_refresh_token;
      const result = await db.query(
        "SELECT * FROM user_refresh_tokens WHERE refresh_token = $1",
        [refreshToken]
      );
      if (result.rows.length == 0) {
        return res.status(403).json({
          success: false,
          name: "INVALID_CREDENTIALS",
          code: 67,
          message: "the refresh token passed for login is invalid.",
        });
      } else {
        jwt.verify(
          refreshToken,
          process.env.REFRESH_TOKEN_SECRET_KEY,
          async (err, user) => {
            if (err) {
              if (err.name === "TokenExpiredError") {
                await db.query(
                  "DELETE FROM user_refresh_tokens WHERE refresh_token = $1",
                  [refreshToken]
                );
              }
              return res.status(403).json({
                success: false,
                name: "INVALID_CREDENTIALS",
                code: 67,
                message: "the refresh token passed for login has expired.",
              });
            }
            next();
          }
        );
      }
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  },
  async (req, res) => {
    try {
      const refreshToken = req.cookies.jobify_refresh_token;
      const userEmail = jwt.decode(refreshToken).user_email;
      const result = await db.query(
        "SELECT * FROM users WHERE user_email = $1",
        [userEmail]
      );
      if (result.rows.length == 0) {
        return res.status(404).json({
          success: false,
          name: "INVALID_CREDENTIALS",
          code: 68,
          message: "user for refresh token not found.",
        });
      } else {
        const user = result.rows[0];
        const newAccessToken = jwt.sign(
          {
            user_email: user.user_email,
            user_type: user.user_type,
            user_id: user.user_id,
          },
          process.env.ACCESS_TOKEN_SECRET_KEY,
          { expiresIn: "15m" }
        );
        res.status(200).json({
          success: true,
          code: 64,
          message: "access token refreshed successfully",
          access_token: newAccessToken,
        });
      }
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  }
);

app.delete("/logout", async (req, res) => {
  if (!req.cookies.jobify_refresh_token) {
    return res.status(400).json({
      success: false,
      name: "INCOMPLETE_BODY",
      code: 61,
      message: "refresh token missing.",
    });
  } else {
    try {
      await db.query(
        "DELETE FROM user_refresh_tokens WHERE refresh_token = $1",
        [req.cookies.jobify_refresh_token]
      );
      res.status(200).json({
        success: true,
        code: 64,
        message: "user logout successful",
      });
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  }
});

app.post(
  "/profile/create/seeker/:id",
  (req, res, next) => {
    const uploadSingle = upload.single("profileImage");
    uploadSingle(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          name: "MULTER_ERROR",
          code: 72,
          message: err.message,
        });
      }
      next();
    });
  },
  async (req, res, next) => {
    if (!req.headers.authorization) {
      return res.status(400).json({
        success: false,
        name: "TOKEN_ERROR",
        code: 77,
        message: "access token not found",
      });
    } else {
      const accessToken = req.headers.authorization.split(" ")[1];
      const id = req.params.id;
      jwt.verify(
        accessToken,
        process.env.ACCESS_TOKEN_SECRET_KEY,
        async (err, user) => {
          if (err) {
            return res.status(403).json({
              success: false,
              name: "INVALID_CREDENTIALS",
              code: 66,
              message: "the access token passed for action is invalid.",
            });
          } else {
            if (user.user_type != "seeker") {
              return res.status(401).json({
                success: false,
                name: "INVALID_TYPE",
                code: 79,
                message: "invalid user type field",
              });
            } else {
              if (user.user_id != id) {
                return res.status(401).json({
                  success: false,
                  name: "TOKEN_ERROR",
                  code: 77,
                  message: "unauthorized access to the action",
                });
              } else {
                req.body.id = user.user_id;
                next();
              }
            }
          }
        }
      );
    }
  },
  async (req, res, next) => {
    if (
      !(
        req.body.id &&
        req.body.number &&
        req.body.city &&
        req.body.state &&
        req.body.country &&
        req.body.bio &&
        req.body.skills &&
        req.body.experience &&
        req.body.education &&
        req.body.resume &&
        req.body.imageStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        name: "INCOMPLETE_BODY",
        code: 71,
        message: "required fields are missing",
      });
    }
    const imageStatus = JSON.parse(req.body.imageStatus);

    if (imageStatus.status && !req.file) {
      return res.status(400).json({
        success: false,
        name: "CONTRADICTING_REQUEST",
        code: 73,
        message: "file not received",
      });
    }

    try {
      const response = await db.query(
        "SELECT * FROM users WHERE user_id = $1",
        [req.body.id]
      );
      if (response.rows.length == 0) {
        return res.status(401).json({
          success: false,
          name: "INVALID_CREDENTIALS",
          code: 62,
          message:
            "the user passed for profile creation does not exist in the server, please signup",
        });
      } else {
        next();
      }
    } catch (error) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  },
  async (req, res) => {
    const imageStatus = JSON.parse(req.body.imageStatus);
    const skills = JSON.parse(req.body.skills);
    try {
      const response = await db.query(
        "SELECT * FROM seeker_profile_details WHERE seeker_user_id = $1",
        [req.body.id]
      );
      if (response.rows.length != 0) {
        return res.status(401).json({
          success: false,
          name: "INVALID_REQUEST",
          code: 74,
          message:
            "the user passed for profile creation already exists in the server",
        });
      }
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }

    if (imageStatus.status) {
      try {
        const fileStr = `data:${
          req.file.mimetype
        };base64,${req.file.buffer.toString("base64")}`;
        const uploadResponse = await cloudinary.uploader.upload(fileStr, {
          folder: "jobify",
        });
        console.log(skills);
        const imageUrl = uploadResponse.secure_url;
        await db.query(
          "INSERT INTO seeker_profile_details(seeker_user_id, seeker_phone_number, seeker_city, seeker_state, seeker_country, seeker_bio, seeker_skills, seeker_work_experience, seeker_education, seeker_resume_link,seeker_profile_image_link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            req.body.id,
            req.body.number,
            req.body.city,
            req.body.state,
            req.body.country,
            req.body.bio,
            req.body.skills,
            req.body.experience,
            req.body.education,
            req.body.resume,
            imageUrl,
          ]
        );
        res.status(200).json({
          success: true,
          code: 76,
          message: "user profile created with image",
        });
      } catch (err) {
        console.log(err);
        if (err.http_code || err.message?.includes("cloudinary")) {
          console.error("CLOUDINARY ERROR:", err.message);
          return res.status(500).json({
            success: false,
            name: "CLOUDINARY_ERROR",
            code: 75,
            message: "uploading image to the cloud was unsuccessfull",
          });
        } else {
          return res.status(500).json({
            success: false,
            name: "DATABASE_SERVER_ERROR",
            code: 63,
            message: "internal database server error",
          });
        }
      }
    } else {
      try {
        await db.query(
          "INSERT INTO seeker_profile_details(seeker_user_id, seeker_phone_number, seeker_city, seeker_state, seeker_country, seeker_bio, seeker_skills, seeker_work_experience, seeker_education, seeker_resume_link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            req.body.id,
            req.body.number,
            req.body.city,
            req.body.state,
            req.body.country,
            req.body.bio,
            req.body.skills,
            req.body.experience,
            req.body.education,
            req.body.resume,
          ]
        );
        res.status(200).json({
          success: true,
          code: 76,
          message: "user profile created without image",
        });
      } catch (err) {
        console.log(err);
        return res.status(500).json({
          success: false,
          name: "DATABASE_SERVER_ERROR",
          code: 63,
          message: "internal database server error",
        });
      }
    }
  }
);

app.post(
  "/profile/create/employer/:id",
  (req, res, next) => {
    const uploadSingle = upload.single("companyLogoImage");
    uploadSingle(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          name: "MULTER_ERROR",
          code: 72,
          message: err.message,
        });
      }
      next();
    });
  },
  async (req, res, next) => {
    if (!req.headers.authorization) {
      return res.status(400).json({
        success: false,
        name: "TOKEN_ERROR",
        code: 77,
        message: "access token not found",
      });
    } else {
      const accessToken = req.headers.authorization.split(" ")[1];
      const id = req.params.id;
      jwt.verify(
        accessToken,
        process.env.ACCESS_TOKEN_SECRET_KEY,
        async (err, user) => {
          if (err) {
            return res.status(403).json({
              success: false,
              name: "INVALID_CREDENTIALS",
              code: 66,
              message: "the access token passed for action is invalid.",
            });
          } else {
            if (user.user_type != "seeker") {
              return res.status(401).json({
                success: false,
                name: "INVALID_TYPE",
                code: 79,
                message: "invalid user type field",
              });
            } else {
              if (user.user_id != id) {
                return res.status(401).json({
                  success: false,
                  name: "TOKEN_ERROR",
                  code: 77,
                  message: "unauthorized access to the action",
                });
              } else {
                req.body.id = user.user_id;
                next();
              }
            }
          }
        }
      );
    }
  },
  async (req, res, next) => {
    if (
      !(
        req.body.id &&
        req.body.name &&
        req.body.industry &&
        req.body.size &&
        req.body.website &&
        req.body.contactEmail &&
        req.body.number &&
        req.body.city &&
        req.body.state &&
        req.body.country &&
        req.body.description &&
        req.body.imageStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        name: "INCOMPLETE_BODY",
        code: 71,
        message: "required fields are missing",
      });
    }
    const imageStatus = JSON.parse(req.body.imageStatus);

    if (imageStatus.status && !req.file) {
      return res.status(400).json({
        success: false,
        name: "CONTRADICTING_REQUEST",
        code: 73,
        message: "file not received",
      });
    }

    try {
      const response = await db.query(
        "SELECT * FROM users WHERE user_id = $1",
        [req.body.id]
      );
      if (response.rows.length == 0) {
        return res.status(401).json({
          success: false,
          name: "INVALID_CREDENTIALS",
          code: 62,
          message:
            "the user passed for profile creation does not exist in the server, please signup",
        });
      } else {
        next();
      }
    } catch (error) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }
  },
  async (req, res) => {
    const imageStatus = JSON.parse(req.body.imageStatus);
    try {
      const response = await db.query(
        "SELECT * FROM employer_profile_details WHERE employer_user_id = $1",
        [req.body.id]
      );
      if (response.rows.length != 0) {
        return res.status(401).json({
          success: false,
          name: "INVALID_REQUEST",
          code: 74,
          message:
            "the user passed for profile creation already exists in the server",
        });
      }
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        name: "DATABASE_SERVER_ERROR",
        code: 63,
        message: "internal database server error",
      });
    }

    if (imageStatus.status) {
      try {
        const fileStr = `data:${
          req.file.mimetype
        };base64,${req.file.buffer.toString("base64")}`;
        const uploadResponse = await cloudinary.uploader.upload(fileStr, {
          folder: "jobify",
        });
        const imageUrl = uploadResponse.secure_url;
        await db.query(
          "INSERT INTO seeker_profile_details(employer_user_id,employer_company_name,employer_industry,employer_company_size,employer_website_link,employer_contact_email,employer_phone_number,employer_city,employer_state,employer_country,employer_description,employer_company_logo_link) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            req.body.id,
            req.body.name,
            req.body.industry,
            req.body.size,
            req.body.website,
            req.body.contactEmail,
            req.body.number,
            req.body.city,
            req.body.state,
            req.body.country,
            req.body.description,
            imageUrl,
          ]
        );
        res.status(200).json({
          success: true,
          code: 76,
          message: "user profile created with image",
        });
      } catch (err) {
        console.log(err);
        if (err.http_code || err.message?.includes("cloudinary")) {
          console.error("CLOUDINARY ERROR:", err.message);
          return res.status(500).json({
            success: false,
            name: "CLOUDINARY_ERROR",
            code: 75,
            message: "uploading image to the cloud was unsuccessfull",
          });
        } else {
          return res.status(500).json({
            success: false,
            name: "DATABASE_SERVER_ERROR",
            code: 63,
            message: "internal database server error",
          });
        }
      }
    } else {
      try {
        await db.query(
          "INSERT INTO seeker_profile_details(employer_user_id,employer_company_name,employer_industry,employer_company_size,employer_website_link,employer_contact_email,employer_phone_number,employer_city,employer_state,employer_country,employer_description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            req.body.id,
            req.body.name,
            req.body.industry,
            req.body.size,
            req.body.website,
            req.body.contactEmail,
            req.body.number,
            req.body.city,
            req.body.state,
            req.body.country,
            req.body.description,
          ]
        );
        res.status(200).json({
          success: true,
          code: 76,
          message: "user profile created without image",
        });
      } catch (err) {
        console.log(err);
        return res.status(500).json({
          success: false,
          name: "DATABASE_SERVER_ERROR",
          code: 63,
          message: "internal database server error",
        });
      }
    }
  }
);

app.get("/profile/seeker/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await db.query(
      "SELECT * FROM seeker_profile_details WHERE seeker_user_id = $1",
      [id]
    );
    if (result.rows.length == 0) {
      return res.status(404).json({
        success: false,
        name: "PROFILE_NOT_FOUND",
        code: 80,
        message: "no seeker profile found for given user id",
      });
    } else {
      res.status(200).json({
        success: true,
        code: 81,
        message: "seeker profile found",
        profile: result.rows[0],
      });
    }
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      name: "DATABASE_SERVER_ERROR",
      code: 63,
      message: "internal database server error",
    });
  }
});

app.get("/profile/employer/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await db.query(
      "SELECT * FROM employer_profile_details WHERE employer_user_id = $1",
      [id]
    );
    if (result.rows.length == 0) {
      return res.status(404).json({
        success: false,
        name: "PROFILE_NOT_FOUND",
        code: 80,
        message: "no employer profile found for given user id",
      });
    } else {
      res.status(200).json({
        success: true,
        code: 81,
        message: "employer profile found",
        profile: result.rows[0],
      });
    }
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      name: "DATABASE_SERVER_ERROR",
      code: 63,
      message: "internal database server error",
    });
  }
});

app.listen(process.env.SERVER_PORT, () => {
  console.log("Server is live ...", process.env.SERVER_PORT);
});
