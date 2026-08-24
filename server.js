const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const { initializeApp, cert } =
  require("firebase-admin/app");

  const { getFirestore } =
  require("firebase-admin/firestore");

const { getMessaging } =
  require("firebase-admin/messaging");

const serviceAccountPath =
  process.env.NODE_ENV === "production"
    ? "/etc/secrets/firebase-service-account.json"
    : path.join(
        __dirname,
        "firebase-service-account.json"
      );

const serviceAccount =
  require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

console.log(
  "SERVER VERSION: AUDIO_CAMERA_SCREEN_WEBRTC_V8"
);

console.log(
  "SERVER VERSION: AUDIO_CAMERA_SCREEN_WEBRTC_V9"
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



async function getParentUid(familyId) {
  try {
    const familyDoc = await db
      .collection("families")
      .doc(familyId)
      .get();

    if (!familyDoc.exists) {
      console.log("Family not found:", familyId);
      return null;
    }

    const data = familyDoc.data();

    console.log("Family data:", data);

    return data.parentUid || null;
  } catch (error) {
    console.error("GET PARENT UID ERROR:", error);
    return null;
  }
}

async function notifyChildOnline(familyId) {
  try {
    const parentUid = await getParentUid(familyId);

    if (!parentUid) {
      console.log(
        "Cannot send Child Online notification: parent UID not found"
      );
      return;
    }

    await sendNotification(
      parentUid,
      "Child Online",
      "Your child's device is now online.",
      {
        type: "child_online",
        familyId: familyId,
      }
    );

    console.log(
      "Child Online notification processed:",
      familyId
    );
  } catch (error) {
    console.error(
      "CHILD ONLINE NOTIFICATION ERROR:",
      error
    );
  }
}



wss.on("connection", (ws, req) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  const role =
    url.searchParams.get("role");

    console.log(
  "WEBSOCKET CONNECTION ATTEMPT:",
  req.url
);

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

  notifyChildOnline(familyId);
}

else if (role === "parent") {
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

  const text = message.toString();

  try {
    const json = JSON.parse(text);

    /*
     * The server already sends viewer_ready when
     * screen_parent connects. Ignore duplicate
     * requests from older parent app versions.
     */
    if (json.type === "viewer_ready") {
      console.log(
        "IGNORED DUPLICATE SCREEN VIEWER READY"
      );

      return;
    }
  } catch (error) {
    console.log(
      "Invalid screen parent JSON:",
      error.message
    );

    return;
  }

  sendText(
    room.screenChild,
    text,
    "FORWARD SCREEN SIGNAL parent -> child"
  );

  return;
}
    }
  );

  ws.on(
    "close",
   async (code, reason) => {
      console.log(
        `${role} disconnected : ${familyId}`,
        "code:",
        code,
        "reason:",
        reason.toString()
      );

    if (room.child === ws) {
  room.child = null;

  const parentUid =
    await getParentUid(familyId);

  if (parentUid) {
    await sendNotification(
      parentUid,
      "Child Offline",
      "Your child's device has gone offline.",
      {
        type: "child_offline",
        familyId: familyId,
      }
    );
  }
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


async function sendNotification(
  parentUid,
  title,
  body,
  data = {}
) {
  try {
    const userDoc = await db
      .collection("users")
      .doc(parentUid)
      .get();

    if (!userDoc.exists) {
      console.log(
        "User not found:",
        parentUid
      );

      return false;
    }

    const userData = userDoc.data();

    const token = userData.fcmToken;

    if (!token) {
      console.log(
        "FCM token not found:",
        parentUid
      );

      return false;
    }

    const message = {
      token: token,

      notification: {
        title: title,
        body: body,
      },

      data: data,
    };

    const response =
      await getMessaging().send(message);

    console.log(
      "Notification sent:",
      response
    );

    return true;
  } catch (error) {
    console.error(
      "Notification error:",
      error
    );

    return false;
  }
}

app.get(
  "/test-parent-notification",
  async (req, res) => {
    const parentUid =
      req.query.parentUid;

    if (!parentUid) {
      return res
        .status(400)
        .send("parentUid is required");
    }

    const success =
      await sendNotification(
        parentUid,
        "Parent Controller",
        "Firestore FCM test is working!",
        {
          type: "test",
        }
      );

    if (success) {
      return res.send(
        "Notification sent successfully"
      );
    }

    return res
      .status(500)
      .send(
        "Notification could not be sent"
      );
  }
);



  app.get("/test-notification", async (req, res) => {
  try {
    const token = req.query.token;

    if (!token) {
      return res.status(400).send("FCM token is required");
    }

    const message = {
      token: token,

      notification: {
        title: "Parent Controller",
        body: "FCM test notification working!",
      },

      data: {
        type: "test",
      },
    };

    const response =
      await getMessaging().send(message);

    console.log(
      "FCM notification sent:",
      response
    );

    res.send("Notification sent successfully");
  } catch (error) {
    console.error(
      "FCM notification failed:",
      error
    );

    res.status(500).send(
      "Notification failed: " +
      error.message
    );
  }
});
