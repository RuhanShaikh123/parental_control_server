const express = require("express");
const http = require("http");
const WebSocket = require("ws");

console.log(
  "SERVER VERSION: AUDIO_CAMERA_SCREEN_WEBRTC_V8"
);

const app = express();

app.get("/", (req, res) => {
  res.send(
    "Parental Control WebSocket Server Running"
  );
});

const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
});

const families = new Map();

function getRoom(familyId) {
  if (!families.has(familyId)) {
    families.set(familyId, {
      // Existing microphone
      child: null,
      parent: null,

      // Existing camera WebRTC
      cameraChild: null,
      cameraParent: null,

      // New screen WebRTC
      screenChild: null,
      screenParent: null,
    });
  }

  return families.get(familyId);
}

function isOpen(socket) {
  return (
    socket &&
    socket.readyState === WebSocket.OPEN
  );
}

function replaceSocket(
  room,
  field,
  newSocket
) {
  const oldSocket = room[field];

  if (
    oldSocket &&
    oldSocket !== newSocket &&
    isOpen(oldSocket)
  ) {
    oldSocket.close(
      4000,
      "Replaced by new connection"
    );
  }

  room[field] = newSocket;
}

function sendBinary(
  target,
  message,
  label
) {
  if (!isOpen(target)) {
    console.log(
      label +
        " FAILED - target not connected"
    );

    return false;
  }

  target.send(message, {
    binary: true,
  });

  console.log(label);

  return true;
}

function sendText(
  target,
  message,
  label
) {
  if (!isOpen(target)) {
    console.log(
      label +
        " FAILED - target not connected"
    );

    return false;
  }

  target.send(
    message.toString(),
    {
      binary: false,
    }
  );

  console.log(label);

  return true;
}

function sendJson(
  target,
  object,
  label
) {
  return sendText(
    target,
    JSON.stringify(object),
    label
  );
}

function roomIsEmpty(room) {
  return (
    !room.child &&
    !room.parent &&
    !room.cameraChild &&
    !room.cameraParent &&
    !room.screenChild &&
    !room.screenParent
  );
}

wss.on("connection", (ws, req) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  const role =
    url.searchParams.get("role");

  const familyId =
    url.searchParams.get("familyId");

  if (!role || !familyId) {
    console.log(
      "Connection rejected: missing role or familyId"
    );

    ws.close(
      4001,
      "Missing role or familyId"
    );

    return;
  }

  console.log(
    `${role} connected : ${familyId}`
  );

  const room = getRoom(familyId);

  if (role === "child") {
    replaceSocket(
      room,
      "child",
      ws
    );
  } else if (role === "parent") {
    replaceSocket(
      room,
      "parent",
      ws
    );
  } else if (role === "camera_child") {
    replaceSocket(
      room,
      "cameraChild",
      ws
    );
  } else if (role === "camera_parent") {
    replaceSocket(
      room,
      "cameraParent",
      ws
    );
  } else if (role === "screen_child") {
    replaceSocket(
      room,
      "screenChild",
      ws
    );

    if (isOpen(room.screenParent)) {
      sendJson(
        room.screenChild,
        {
          type: "viewer_ready",
        },
        "SCREEN VIEWER READY"
      );

      sendJson(
        room.screenParent,
        {
          type: "child_ready",
        },
        "SCREEN CHILD READY"
      );
    }
  } else if (role === "screen_parent") {
    replaceSocket(
      room,
      "screenParent",
      ws
    );

    if (isOpen(room.screenChild)) {
      sendJson(
        room.screenChild,
        {
          type: "viewer_ready",
        },
        "SCREEN VIEWER READY"
      );

      sendJson(
        room.screenParent,
        {
          type: "child_ready",
        },
        "SCREEN CHILD READY"
      );
    } else {
      sendJson(
        room.screenParent,
        {
          type: "child_disconnected",
        },
        "SCREEN CHILD OFFLINE"
      );
    }
  } else {
    console.log(
      "Unknown role:",
      role
    );

    ws.close(
      4002,
      "Unknown role"
    );

    return;
  }

  ws.on(
    "message",
    (message, isBinary) => {
      /*
       * Existing microphone audio.
       */
      if (role === "child") {
        sendBinary(
          room.parent,
          message,
          "FORWARD AUDIO child -> parent"
        );

        return;
      }

      if (role === "parent") {
        sendBinary(
          room.child,
          message,
          "FORWARD AUDIO parent -> child"
        );

        return;
      }

      /*
       * Existing camera WebRTC signaling.
       */
      if (role === "camera_child") {
        sendText(
          room.cameraParent,
          message,
          "FORWARD CAMERA child -> parent"
        );

        return;
      }

      if (role === "camera_parent") {
        sendText(
          room.cameraChild,
          message,
          "FORWARD CAMERA parent -> child"
        );

        return;
      }

      /*
       * New screen WebRTC signaling.
       *
       * No screen video bytes pass through Render.
       * Only JSON offer/answer/ICE messages pass here.
       */
      if (role === "screen_child") {
        if (isBinary) {
          console.log(
            "Old JPEG screen frame ignored"
          );

          return;
        }

        sendText(
          room.screenParent,
          message,
          "FORWARD SCREEN SIGNAL child -> parent"
        );

        return;
      }

      if (role === "screen_parent") {
        if (isBinary) {
          console.log(
            "Unexpected screen parent binary message"
          );

          return;
        }

        sendText(
          room.screenChild,
          message,
          "FORWARD SCREEN SIGNAL parent -> child"
        );
      }
    }
  );

  ws.on(
    "close",
    (code, reason) => {
      console.log(
        `${role} disconnected : ${familyId}`,
        "code:",
        code,
        "reason:",
        reason.toString()
      );

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

      if (room.screenParent === ws) {
        room.screenParent = null;

        sendJson(
          room.screenChild,
          {
            type: "viewer_left",
          },
          "SCREEN VIEWER LEFT"
        );
      }

      if (room.screenChild === ws) {
        room.screenChild = null;

        sendJson(
          room.screenParent,
          {
            type: "child_disconnected",
          },
          "SCREEN CHILD DISCONNECTED"
        );
      }

      if (roomIsEmpty(room)) {
        families.delete(familyId);

        console.log(
          "Room removed:",
          familyId
        );
      }
    }
  );

  ws.on("error", (error) => {
    console.log(
      `${role} socket error:`,
      error.message
    );
  });
});

const heartbeatInterval =
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, 30000);

wss.on("close", () => {
  clearInterval(
    heartbeatInterval
  );
});

const PORT =
  process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    "Server Running on " + PORT
  );
});