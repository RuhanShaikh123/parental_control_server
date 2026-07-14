const express = require("express");
const http = require("http");
const WebSocket = require("ws");

console.log(
  "SERVER VERSION: AUDIO_CAMERA_SCREEN_V7"
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
      // Existing microphone connections
      child: null,
      parent: null,

      // Existing camera connections
      cameraChild: null,
      cameraParent: null,

      // New screen connections
      screenChild: null,
      screenParent: null,
    });
  }

  return families.get(familyId);
}

function isSocketOpen(socket) {
  return (
    socket &&
    socket.readyState === WebSocket.OPEN
  );
}

function replaceSocket(room, key, newSocket) {
  const oldSocket = room[key];

  if (
    oldSocket &&
    oldSocket !== newSocket &&
    isSocketOpen(oldSocket)
  ) {
    oldSocket.close(
      4000,
      "Replaced by new connection"
    );
  }

  room[key] = newSocket;
}

function safeSendBinary(
  target,
  message,
  label,
  showLog = true
) {
  if (isSocketOpen(target)) {
    if (showLog) {
      console.log(label);
    }

    target.send(message, {
      binary: true,
    });

    return true;
  }

  if (showLog) {
    console.log(
      label +
        " FAILED - target not connected"
    );
  }

  return false;
}

function safeSendText(
  target,
  message,
  label,
  showLog = true
) {
  if (isSocketOpen(target)) {
    if (showLog) {
      console.log(label);
    }

    target.send(
      message.toString(),
      {
        binary: false,
      }
    );

    return true;
  }

  if (showLog) {
    console.log(
      label +
        " FAILED - target not connected"
    );
  }

  return false;
}

function isRoomEmpty(room) {
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

  console.log(
    `${role} connected : ${familyId}`
  );

  if (!role || !familyId) {
    console.log(
      "Socket closed: missing role or familyId"
    );

    ws.close(
      4001,
      "Missing role or familyId"
    );

    return;
  }

  const room = getRoom(familyId);

  /*
   * Register socket based on role.
   */
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

    /*
     * If parent screen page is already open,
     * tell child to begin sending frames.
     */
    if (isSocketOpen(room.screenParent)) {
      safeSendText(
        room.screenChild,
        "viewer_ready",
        "SCREEN VIEWER READY"
      );

      safeSendText(
        room.screenParent,
        "child_screen_ready",
        "SCREEN CHILD READY"
      );
    }
  } else if (role === "screen_parent") {
    replaceSocket(
      room,
      "screenParent",
      ws
    );

    /*
     * If child capture service is connected,
     * tell it that a viewer is ready.
     */
    if (isSocketOpen(room.screenChild)) {
      safeSendText(
        room.screenChild,
        "viewer_ready",
        "SCREEN VIEWER READY"
      );

      safeSendText(
        room.screenParent,
        "child_screen_ready",
        "SCREEN CHILD READY"
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
       * Do not print every screen-frame size.
       * Screen frames arrive several times per
       * second and would fill Render logs.
       */
      if (
        role !== "screen_child" ||
        !isBinary
      ) {
        console.log(
          "Message from",
          role,
          "family:",
          familyId,
          "bytes:",
          message.length,
          "binary:",
          isBinary
        );
      }

      /*
       * Existing microphone:
       * child -> parent
       */
      if (role === "child") {
        safeSendBinary(
          room.parent,
          message,
          "FORWARD AUDIO child -> parent"
        );

        return;
      }

      /*
       * Existing microphone:
       * parent -> child
       */
      if (role === "parent") {
        safeSendBinary(
          room.child,
          message,
          "FORWARD AUDIO parent -> child"
        );

        return;
      }

      /*
       * Existing camera signaling:
       * camera child -> camera parent
       */
      if (role === "camera_child") {
        safeSendText(
          room.cameraParent,
          message,
          "FORWARD CAMERA child -> parent"
        );

        return;
      }

      /*
       * Existing camera signaling:
       * camera parent -> camera child
       */
      if (role === "camera_parent") {
        safeSendText(
          room.cameraChild,
          message,
          "FORWARD CAMERA parent -> child"
        );

        return;
      }

      /*
       * New screen streaming:
       * child sends binary JPEG frames.
       */
      if (role === "screen_child") {
        if (isBinary) {
          safeSendBinary(
            room.screenParent,
            message,
            "FORWARD SCREEN child -> parent",
            false
          );

          return;
        }

        const text =
          message.toString();

        console.log(
          "Screen child message:",
          text
        );

        if (
          text === "screen_child_ready"
        ) {
          if (
            isSocketOpen(
              room.screenParent
            )
          ) {
            safeSendText(
              room.screenChild,
              "viewer_ready",
              "SCREEN VIEWER READY"
            );

            safeSendText(
              room.screenParent,
              "child_screen_ready",
              "SCREEN CHILD READY"
            );
          }
        }

        return;
      }

      /*
       * Optional parent screen messages.
       */
      if (role === "screen_parent") {
        const text =
          message.toString();

        console.log(
          "Screen parent message:",
          text
        );

        if (text === "viewer_ready") {
          safeSendText(
            room.screenChild,
            "viewer_ready",
            "SCREEN VIEWER READY"
          );
        }
      }
    }
  );

  ws.on("close", (code, reason) => {
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

      /*
       * Parent closed Live Screen page.
       * Child stops producing JPEG frames but
       * MediaProjection service remains active.
       */
      safeSendText(
        room.screenChild,
        "viewer_left",
        "SCREEN VIEWER LEFT"
      );
    }

    if (room.screenChild === ws) {
      room.screenChild = null;

      /*
       * Child capture service disconnected.
       */
      safeSendText(
        room.screenParent,
        "child_screen_disconnected",
        "SCREEN CHILD DISCONNECTED"
      );
    }

    if (isRoomEmpty(room)) {
      families.delete(familyId);

      console.log(
        "Room removed:",
        familyId
      );
    }
  });

  ws.on("error", (error) => {
    console.log(
      `${role} socket error:`,
      error.message
    );
  });
});

/*
 * Keeps Render and connected sockets alive.
 */
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (
      ws.readyState === WebSocket.OPEN
    ) {
      ws.ping();
    }
  });
}, 30000);

wss.on("close", () => {
  clearInterval(interval);
});

const PORT =
  process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    "Server Running on " + PORT
  );
});