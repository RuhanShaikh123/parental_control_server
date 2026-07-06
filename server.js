const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();

app.get("/", (req, res) => {
    res.send("Parental Control WebSocket Server Running");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const families = new Map();

wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");

    const role = url.searchParams.get("role");
    const familyId = url.searchParams.get("familyId");

    console.log(`${role} connected : ${familyId}`);

    if (!families.has(familyId)) {
        families.set(familyId, {
            child: null,
            parent: null,
        });
    }

    const room = families.get(familyId);

    if (role === "child") {
        room.child = ws;
    }

    if (role === "parent") {
        room.parent = ws;
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

        if (role === "child") {
            if (room.parent && room.parent.readyState === WebSocket.OPEN) {
                console.log("forwarding child -> parent");
                room.parent.send(message);
            } else {
                console.log("parent not connected");
            }
        }

        if (role === "parent") {
            if (room.child && room.child.readyState === WebSocket.OPEN) {
                console.log("forwarding parent -> child");
                room.child.send(message);
            } else {
                console.log("child not connected");
            }
        }
    });

    ws.on("close", () => {
        console.log(role + " disconnected");

        if (role === "child") {
            room.child = null;
        }

        if (role === "parent") {
            room.parent = null;
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server Running on " + PORT);
});