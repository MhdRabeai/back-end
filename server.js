const express = require("express");
const http = require("http");
const cors = require("cors");
const fs = require("node:fs/promises");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);

const io = require("socket.io")(server, {
  pingTimeout: 60000,
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

const users = {};
const rooms = {};
const userDataFile = "./users.json";
app.get("/connected-users", (req, res) => {
  res.json({ connectedUsers: Object.keys(users) });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket);
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

app.post("/register", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const data = await fs.readFile(userDataFile, { encoding: "utf8" });

    if (JSON.parse(data).some((ele) => ele["phone"] === phone)) {
      return res.status(400).json({ error: "User already exists" });
    } else {
      const allData = JSON.parse(data);
      allData.push({ phone: phone, password: password });
      await fs.writeFile(userDataFile, JSON.stringify(allData));
      res.json({ message: `User ${phone} registered successfully.` });
    }
  } catch (err) {
    res.status(500).json({ error: "An error occurred while registering" });
  }
});

app.post("/login", async (req, res) => {
  const { phone, password } = req.body;
  const data = await fs.readFile(userDataFile, { encoding: "utf8" });

  if (
    !JSON.parse(data).some(
      (ele) => ele["phone"] === phone && ele["password"] === password
    )
  ) {
    return res.status(401).json({ error: "Invalid credentials" });
  } else {
    io.emit("login", phone);
    res.status(200).json({ message: `User ${phone} logged in.` });
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
    res.status(200).json({ message: "Message sent successfully" });
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
      res.status(200).json({ messages: user.messages });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "An error occurred while fetching messages" });
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
      res.status(200).json({ messages: user });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "An error occurred while fetching messages" });
  }
});
app.post("/logout", (req, res) => {
  const { phone } = req.body;

  if (users[phone]) {
    delete users[phone];
    // socket.broadcast.emit("userDisconnected", phone);
    io.emit("userDisconnected", phone);
    res.status(200).json({ message: `User ${phone} logged out successfully.` });
  } else {
    res.status(404).json({ error: "User not found" });
  }
});
server.listen(4000, () => {
  console.log(`Server is running on http://localhost:${4000}`);
});