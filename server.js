const express = require("express");
const http = require("http");
const WebSocket = require("ws");

console.log("SERVER VERSION: AUDIO_BINARY_CAMERA_TEXT_V6");

const app = express();

app.get("/", (req, res) => {
  res.send("Parental Control WebSocket Server Running");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const families = new Map();

function getRoom(familyId) {
  if (!families.has(familyId)) {
    families.set(familyId, {
      child: null,
      parent: null,
      cameraChild: null,
      cameraParent: null,
    });
  }

  return families.get(familyId);
}

function safeSendBinary(target, message, label) {
  if (target && target.readyState === WebSocket.OPEN) {
    console.log(label);
    target.send(message); // audio must stay binary
    return true;
  }

  console.log(label + " FAILED - target not connected");
  return false;
}

function safeSendText(target, message, label) {
  if (target && target.readyState === WebSocket.OPEN) {
    console.log(label);
    target.send(message.toString()); // camera signaling is JSON text
    return true;
  }

  console.log(label + " FAILED - target not connected");
  return false;
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const role = url.searchParams.get("role");
  const familyId = url.searchParams.get("familyId");

  console.log(`${role} connected : ${familyId}`);

  if (!role || !familyId) {
    console.log("Socket closed: missing role or familyId");
    ws.close();
    return;
  }

  const room = getRoom(familyId);

  if (role === "child") {
    room.child = ws;
  } else if (role === "parent") {
    room.parent = ws;
  } else if (role === "camera_child") {
    room.cameraChild = ws;
  } else if (role === "camera_parent") {
    room.cameraParent = ws;
  } else {
    console.log("Unknown role:", role);
    ws.close();
    return;
  }

  ws.on("message", (message) => {
    console.log(
      "message from",
      role,
      "family:",
      familyId,
      "bytes:",
      message.length
    );

    console.log("ROOM STATE:", {
      child: !!room.child,
      parent: !!room.parent,
      cameraChild: !!room.cameraChild,
      cameraParent: !!room.cameraParent,
      parentOpen:
        room.parent &&
        room.parent.readyState === WebSocket.OPEN,
      childOpen:
        room.child &&
        room.child.readyState === WebSocket.OPEN,
      cameraParentOpen:
        room.cameraParent &&
        room.cameraParent.readyState === WebSocket.OPEN,
      cameraChildOpen:
        room.cameraChild &&
        room.cameraChild.readyState === WebSocket.OPEN,
    });

    if (role === "child") {
      safeSendBinary(
        room.parent,
        message,
        "FORWARD AUDIO child -> parent"
      );
      return;
    }

    if (role === "parent") {
      safeSendBinary(
        room.child,
        message,
        "FORWARD AUDIO parent -> child"
      );
      return;
    }

    if (role === "camera_child") {
      safeSendText(
        room.cameraParent,
        message,
        "FORWARD CAMERA child -> parent"
      );
      return;
    }

    if (role === "camera_parent") {
      safeSendText(
        room.cameraChild,
        message,
        "FORWARD CAMERA parent -> child"
      );
      return;
    }
  });

  ws.on("close", () => {
    console.log(`${role} disconnected : ${familyId}`);

    if (room.child === ws) {
      room.child = null;
    }

    if (room.parent === ws) {
      room.parent = null;
    }

    if (room.cameraChild === ws) {
      room.cameraChild = null;
    }

    if (room.cameraParent === ws) {
      room.cameraParent = null;
    }
  });

  ws.on("error", (error) => {
    console.log(`${role} socket error:`, error.message);
  });
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 30000);

wss.on("close", () => {
  clearInterval(interval);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server Running on " + PORT);
});