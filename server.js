const express = require("express");
const http = require("http");
const cors = require("cors");
const fs = require("node:fs/promises");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const app = express();
const path = require("path");
const dotenv = require("dotenv").config();
const { v4: uuidv4 } = require("uuid");
const server = http.createServer(app);
const { generateAccessToken } = require("./config/function");
const io = require("socket.io")(server, {
  pingTimeout: 60000,
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});
var jwt = require("jsonwebtoken");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: false }));
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(bodyParser.json());
app.use("/static", express.static(path.join(__dirname, "uploads")));
const users = {};
const rooms = {};
const userDataFile = "./users.json";
io.on("connection", (socket) => {
  // console.log("User connected:", socket);
  socket.on("login", (phone) => {
    socket.broadcast.emit("userConnected", phone);
    users[phone] = socket.id;
    console.log(`User ${phone} is now connected.`);
    console.log("Connected users:", Object.keys(users));
  });
  socket.on("joinChat", ({ from, to }) => {
    if (isNaN(+from) || isNaN(+to)) {
      console.log("Invalid phone number(s) for room creation:", from, to);
      return;
    }
    const roomId = `chat_${Math.min(+from, +to)}_${Math.max(+from, +to)}`;
    console.log("roomId", roomId);
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { users: [], messages: [] };
    }
    if (!rooms[roomId].users.includes(from)) {
      rooms[roomId].users.push(from);
    }
    console.log(`${from} joined room: ${roomId}`);
  });

  socket.on("leaveChat", ({ from, to }) => {
    if (isNaN(+from) || isNaN(+to)) {
      console.log("Invalid phone number(s) for room creation:", from, to);
      return;
    }
    const roomId = `chat_${Math.min(+from, +to)}_${Math.max(+from, +to)}`;
    leaveRoom(roomId, from);
  });
  function leaveRoom(roomId, user) {
    if (rooms[roomId]) {
      const userIndex = rooms[roomId].users.indexOf(user);
      if (userIndex !== -1) {
        rooms[roomId].users.splice(userIndex, 1);
        console.log(`User ${user} left room: ${roomId}`);
        if (rooms[roomId].users.length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted`);
        }
      }
    }
  }
  socket.on("sendMessage", ({ from, to, message }) => {
    if (isNaN(+from) || isNaN(+to)) {
      console.log("Invalid phone number(s) for room creation:", from, to);
      return;
    }
    const roomId = `chat_${Math.min(+from, +to)}_${Math.max(+from, +to)}`;
    const userInRoom = rooms[roomId].users.includes(to);
    console.log("userInRoom", rooms[roomId].users);
    if (userInRoom) {
      io.to(roomId).emit("receiveMessage", { from, to, message });
      console.log(`Message sent from ${from} to ${to} in room: ${roomId}`);
    } else {
      if (!rooms[roomId].users.includes(to)) {
        console.log(
          `User ${to} is not in room: ${roomId}, sending notification`
        );
        socket.broadcast.emit("newMessageNotification", {
          from,
          to,
          message,
          roomId,
        });
      } else {
        console.log(`User with phone ${to} is not connected.`);
      }
    }
  });
  socket.on("disconnect", (phone) => {
    if (users[phone] === socket.id) {
      delete users[phone];
      console.log(`User disconnected: ${phone}`);
      socket.broadcast.emit("userDisconnected", phone);
    }
  });
});
const Auth = async (req, res, next) => {
  const token = req.cookies["access_token"];
  if (token == null) return res.sendStatus(401);
  jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user;
    // console.log("Auth req.user", req.user);
    next();
  });
};
app.get("/", Auth, async (req, res) => {
  const data = await fs.readFile(userDataFile, { encoding: "utf8" });
  const user = JSON.parse(data).find((ele) => ele.phone === req.user["phone"]);
  return res.send(JSON.stringify(user));
});
app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, "uploads", filename);

  res.download(filePath, (err) => {
    if (err) {
      res.setHeader("error", "File not found");
      return res.status(404).send("File not found");
    }
  });
});
app.get("/connected-users", Auth, async (req, res) => {
  const data = await fs.readFile(userDataFile, { encoding: "utf8" });
  const fileData = JSON.parse(data);
  const keys = Object.keys(users);
  const connectedUsers = keys
    .map((key) => {
      const user = fileData.find((user) => user.phone === key);
      if (user) {
        return {
          ...user,
        };
      }
      return null;
    })
    .filter((user) => user !== null);
  return res.json({ connectedUsers: connectedUsers });
});

app.post("/register", upload.single("myfile"), async (req, res) => {
  const myData = {};
  const { name, password, phone } = req.body;
  Object.assign(myData, {
    id: uuidv4(),
    name: name,
    password: password,
    phone: phone,
    messages: [
      {
        from: "",
        to: "",
        message: "",
        time: "",
      },
    ],
    avatar: req.file?.filename,
  });
  try {
    const data = await fs.readFile(userDataFile, { encoding: "utf8" });

    if (JSON.parse(data).some((ele) => ele["phone"] === phone)) {
      console.log(
        "req.body",
        JSON.parse(data).some((ele) => ele["phone"] === phone)
      );
      return res.status(400).json({ error: "User already exists" });
    } else {
      // const allData = JSON.parse(data);
      // allData.push({ phone: phone, password: password });
      var obj = JSON.parse(data);
      obj.push(myData);
      const allData = JSON.stringify(obj, null, 3);
      await fs.writeFile(userDataFile, allData);
      return res.json({ message: `User ${phone} registered successfully.` });
    }
  } catch (err) {
    return res
      .status(500)
      .json({ error: "An error occurred while registering" });
  }
});

app.post("/login", async (req, res) => {
  const { phone, password } = req.body;
  try {
    const data = await fs.readFile(userDataFile, { encoding: "utf8" });
    const user = await JSON.parse(data).find(
      (ele) => ele.phone === phone && ele.password === password
    );
    if (!user) {
      return res.status(404).send("Invalid UserData ");
    }
    const accessToken = generateAccessToken({
      phone: user.phone,
    });
    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure: true,
    });
    io.emit("login", phone);
    return res.sendStatus(200);
  } catch (err) {
    return res.sendStatus(400);
  }
});

app.post("/message-send/:from/:to", async (req, res) => {
  const { message } = req.body;
  const { from, to } = req.params;

  const data = await fs.readFile(userDataFile, { encoding: "utf8" });
  const user = JSON.parse(data);

  const receiver = user.find((ele) => ele["phone"] === to);
  const sender = user.find((ele) => ele["phone"] === from);

  if (!receiver || !sender) {
    return res.status(404).json({ error: "User not found" });
  }

  if (users[to]) {
    const messageObject = {
      from,
      to,
      message,
      time: new Date().toISOString(),
    };
    // const roomId = `chat_${from}_${to}`;
    // console.log(`Sendinng message from ${from} to ${to} in room: ${roomId}`);
    // // io.to(roomId).emit("receiveMessage", { from, to, messageObject });
    // users[from].to(roomId).emit("sendMessage", { from, to, messageObject });
    // console.log(`Sending  ${to}:`, messageObject);
    sender.messages.push(messageObject);
    receiver.messages.push(messageObject);
    await fs.writeFile(userDataFile, JSON.stringify(user));
    return res.status(200).json({ message: "Message sent successfully" });
  } else {
    return res.status(404).json({ error: "Recipient not connected" });
  }
});

app.get("/messages/:userPhone", async (req, res) => {
  try {
    const { userPhone } = req.params;
    const data = await fs.readFile(userDataFile, { encoding: "utf8" });
    const allUsers = JSON.parse(data);

    const user = allUsers.find((ele) => ele["phone"] === userPhone);
    if (user) {
      const arr = user["messages"]
        .map((ele) => ele["from"])
        .concat(user.messages.map((ele) => ele["to"]));
      const keys = [...new Set(arr)].filter((ele) => ele !== userPhone);

      const Chats = keys
        .map((key) => {
          const user = allUsers.find((user) => user.phone === key);
          if (user) {
            return {
              ...user,
            };
          }
          return null;
        })
        .filter((user) => user !== null);

      return res.status(200).json({ chats: Chats });
    } else {
      return res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    console.log(err);
    // return res
    //   .status(500)
    //   .json({ error: "An error occurred while fetching messages" });
  }
});

app.get("/messages/:userPhone/:phoneTo", async (req, res) => {
  try {
    const { userPhone, phoneTo } = req.params;
    const data = await fs.readFile(userDataFile, { encoding: "utf8" });
    const allUsers = JSON.parse(data);

    const user = allUsers
      .find((ele) => ele["phone"] === userPhone)
      ["messages"].filter((e) => e["from"] == phoneTo || e["to"] == phoneTo);
    if (user) {
      return res.status(200).json({ messages: user });
    } else {
      return res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    return res
      .status(500)
      .json({ error: "An error occurred while fetching messages" });
  }
});
app.post("/logout", (req, res) => {
  const { phone } = req.body;

  if (users[phone]) {
    res.cookie("access_token", "", { maxAge: 0 });
    delete users[phone];
    // socket.broadcast.emit("userDisconnected", phone);
    io.emit("userDisconnected", phone);
    return res
      .status(200)
      .json({ message: `User ${phone} logged out successfully.` });
  } else {
    return res.status(404).json({ error: "User not found" });
  }
});
server.listen(4000, () => {
  console.log(`Server is running on http://localhost:${4000}`);
});
