const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());
app.use(cors());

require("dotenv").config();

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const dbPromise = db.promise();


db.query(`
  CREATE TABLE IF NOT EXISTS approved_emails (
    email VARCHAR(255) PRIMARY KEY
  )
`);
db.query(`
  CREATE TABLE IF NOT EXISTS votes (
    email VARCHAR(255) PRIMARY KEY,
    candidate VARCHAR(255)
  )
`);
db.query(`
  CREATE TABLE IF NOT EXISTS candidates (
    name VARCHAR(255) PRIMARY KEY
  )
`);

// Create HTTP server and socket.io

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3001", // Specify the frontend origin
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // Ensure both transports are enabled
});

// Emit vote progress updates
const emitVoteProgress = async () => {
  const [totalApproved] = await dbPromise.query("SELECT COUNT(*) as total FROM approved_emails");
  const [totalVotes] = await dbPromise.query("SELECT COUNT(DISTINCT email) as total FROM votes");

  io.emit("voteProgress", {
    totalApproved: totalApproved[0].total,
    totalVotes: totalVotes[0].total,
  });
};


// Validate email
app.post("/validate", (req, res) => {
  const { email } = req.body;
  db.query("SELECT email FROM approved_emails WHERE email = ?", [email], (err, results) => {
    res.json({ approved: results.length > 0 });
  });
});

// Vote route
app.post("/vote", async (req, res) => {
  const { email, candidate } = req.body;
  try {
    const [existingVote] = await dbPromise.query("SELECT * FROM votes WHERE email = ?", [email]);

    if (existingVote.length > 0) {
      return res.status(400).json({ message: "You have already voted!" });
    }

    await dbPromise.query("INSERT INTO votes (email, candidate) VALUES (?, ?)", [email, candidate]);
    emitVoteProgress(); // Notify all clients about vote progress
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin reset votes
app.post("/admin/reset-votes", async (req, res) => {
    const { password } = req.body;
  
    try {
      // Verify the admin password using the helper function
      await verifyAdminPassword(password);
  
      // Proceed with the rest of the logic
      await dbPromise.query("DELETE FROM votes");
      emitVoteProgress(); // Notify all clients about vote reset
      res.json({ success: true });
    } catch (error) {
      res.status(403).json({ message: error.message });
    }
  });
  

// Get voting results
app.get("/results", (req, res) => {
  db.query("SELECT candidate, COUNT(*) as count FROM votes GROUP BY candidate", (err, results) => {
    res.json(results);
  });
});

// Get candidates
app.get("/candidates", (req, res) => {
  db.query("SELECT name FROM candidates", (err, results) => {
    res.json(results.map((row) => row.name));
  });
});


app.post("/admin/login", async (req, res) => {
    const { password } = req.body;
  
    try {
      // Verify the admin password using the helper function
      await verifyAdminPassword(password);
      await emitVoteProgress();
      res.json({ success: true, message: "Login successful" });
    } catch (error) {
      res.status(401).json({ message: error.message });
    }
  });
  
  

// Add candidate
app.post("/admin/add-candidate", async (req, res) => {
    const { name, password } = req.body;
  
    try {
      // Verify the admin password using the helper function
      await verifyAdminPassword(password);
  
      // Proceed with the rest of the logic
      db.query("INSERT INTO candidates (name) VALUES (?)", [name], (err) => {
        if (err) return res.status(500).json({ message: "Candidate already exists" });
        res.json({ message: "Candidate added" });
      });
    } catch (error) {
      res.status(403).json({ message: error.message });
    }
  });
  

  app.post("/admin/remove-candidate", async (req, res) => {
    const { name, password } = req.body;
  
    try {
      // Verify the admin password using the helper function
      await verifyAdminPassword(password);
  
      // Proceed with the rest of the logic
      db.query("DELETE FROM candidates WHERE name = ?", [name], (err) => {
        if (err) return res.status(500).json({ message: "Error removing candidate" });
        res.json({ message: "Candidate removed" });
      });
    } catch (error) {
      res.status(403).json({ message: error.message });
    }
  });
  

// Admin results
app.get("/admin/results", async (req, res) => {
  try {
    const [results] = await dbPromise.query("SELECT candidate, COUNT(*) as votes FROM votes GROUP BY candidate");
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Helper function to verify admin password
const verifyAdminPassword = async (password) => {
    try {
      // Fetch the stored hashed password from the database
      const [results] = await dbPromise.query("SELECT * FROM admin WHERE id = 1");
  
      if (results.length === 0) {
        throw new Error("Admin not found");
      }
  
      const admin = results[0];
  
      // Compare the password with the stored hash
      const match = await bcrypt.compare(password, admin.password);
      if (!match) {
        throw new Error("Invalid credentials");
      }
  
      return true; // Password matches
    } catch (error) {
      throw new Error(error.message);
    }
  };
  
// Start server with socket.io
server.listen(3000, () => console.log("Server running on port 3000"));
