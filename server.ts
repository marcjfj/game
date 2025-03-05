import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { WebSocketServer, WebSocket as WS } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// For development mode, use a random port to avoid conflicts with nodemon restarting
const IS_DEV = process.env.NODE_ENV === "development";
const DEFAULT_PORT = 3000;
const PORT: number = process.env.PORT
  ? parseInt(process.env.PORT)
  : DEFAULT_PORT;

// Serve static files from the React app build directory
app.use(express.static(path.join(__dirname, "../client/build")));

// API routes can be defined here
app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from the server!" });
});

// For any request that doesn't match the above, serve the React app
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build", "index.html"));
});

// Create an HTTP server
const server = createServer(app);

// Create a WebSocket server
const wss = new WebSocketServer({ server });

// Move setupWebSockets function to before createServer
function setupWebSockets(wss: WebSocketServer): void {
  // Store connected players
  const players = new Map();

  // Assign unique player IDs
  let nextPlayerId = 1;

  // Handle WebSocket connections
  wss.on("connection", (ws) => {
    // Assign a player ID
    const playerId = nextPlayerId++;
    const playerColor = getRandomColor();

    console.log(`Player ${playerId} connected`);

    // Add player to connected players
    players.set(ws, {
      id: playerId,
      color: playerColor,
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      animation: "idle",
    });

    // Send initial player ID to the client
    ws.send(
      JSON.stringify({
        type: "init",
        data: {
          id: playerId,
          color: playerColor,
          players: Array.from(players.values()).filter(
            (p) => p.id !== playerId
          ),
        },
      })
    );

    // Broadcast to other players that a new player joined
    broadcastToOthers(wss, ws, {
      type: "playerJoined",
      data: {
        id: playerId,
        color: playerColor,
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        animation: "idle",
      },
    });

    // Handle messages from clients
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === "position") {
          // Update player position
          const player = players.get(ws);
          if (player) {
            player.position = data.data.position;
            player.rotation = data.data.rotation;
            player.animation = data.data.animation;

            // Broadcast position to all other clients
            broadcastToOthers(wss, ws, {
              type: "playerUpdate",
              data: {
                id: player.id,
                position: player.position,
                rotation: player.rotation,
                animation: player.animation,
              },
            });
          }
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    });

    // Handle client disconnections
    ws.on("close", () => {
      const player = players.get(ws);
      if (player) {
        console.log(`Player ${player.id} disconnected`);

        // Broadcast player left message
        broadcastToAll(wss, {
          type: "playerLeft",
          data: { id: player.id },
        });

        // Remove player from the map
        players.delete(ws);
      }
    });
  });
}

// Update broadcast functions to accept wss parameter
function broadcastToOthers(
  wss: WebSocketServer,
  sender: WS,
  message: any
): void {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client !== sender && client.readyState === 1) {
      client.send(messageStr);
    }
  });
}

function broadcastToAll(wss: WebSocketServer, message: any): void {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(messageStr);
    }
  });
}

// Generate a random color for players
function getRandomColor() {
  const colors = [
    0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xffa500,
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Set up WebSocket handlers directly (remove the setupServer function)
setupWebSockets(wss);

// Simplified server startup with better error handling
server
  .listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  })
  .on("error", (e: any) => {
    if (e.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is in use. Please free the port and restart the server.`
      );
      process.exit(1);
    } else {
      console.error("Server error:", e);
      process.exit(1);
    }
  });

// Improve graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down server gracefully...");
  // First close all WebSocket connections
  wss.clients.forEach((client) => {
    client.terminate();
  });

  // Then close the server
  wss.close(() => {
    console.log("WebSocket server closed");
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
  });
});
