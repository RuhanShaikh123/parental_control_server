const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

// familyId -> { child, parent }
const rooms = new Map();

wss.on("connection", (ws) => {
    console.log("Client Connected");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // First message = register client
            if (data.type === "join") {

                const familyId = data.familyId;
                const role = data.role;

                if (!rooms.has(familyId)) {
                    rooms.set(familyId, {});
                }

                rooms.get(familyId)[role] = ws;

                ws.familyId = familyId;
                ws.role = role;

                console.log(`${role} joined ${familyId}`);
                return;
            }

            // Audio packets
            if (data.type === "audio") {

                const room = rooms.get(ws.familyId);

                if (room && room.parent) {
                    room.parent.send(message);
                }

                return;
            }

        } catch (e) {
            console.log(e);
        }
    });

    ws.on("close", () => {

        if (!ws.familyId) return;

        const room = rooms.get(ws.familyId);

        if (!room) return;

        delete room[ws.role];

        console.log(`${ws.role} disconnected`);

    });

});

app.get("/", (req, res) => {
    res.send("Parental Control Server Running");
});

server.listen(8080, () => {
    console.log("Server running on port 8080");
});