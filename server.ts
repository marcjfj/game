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
      health: 100,
      maxHealth: 100,
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
        health: 100,
        maxHealth: 100,
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
                health: player.health,
                maxHealth: player.maxHealth,
              },
            });
          }
        } else if (data.type === "playerUpdate") {
          // Handle player updates (including health changes)
          const player = players.get(ws);
          if (player) {
            // Update player data
            player.position = data.data.position;
            player.rotation = data.data.rotation;
            player.animation = data.data.animation;
            player.health = data.data.health;

            // Broadcast update to all other clients
            broadcastToOthers(wss, ws, {
              type: "playerUpdate",
              data: {
                id: player.id,
                position: player.position,
                rotation: player.rotation,
                animation: player.animation,
                health: player.health,
                maxHealth: player.maxHealth,
              },
            });
          }
        } else if (
          data.type === "damagePlayer" ||
          data.type === "directDamage"
        ) {
          // Handle direct damage to a player
          const sourcePlayer = players.get(ws);
          if (!sourcePlayer) return;

          const targetId = data.data.targetId;
          const damage = data.data.damage;
          const newHealth = data.data.newHealth || data.data.health;

          console.log(
            `[DAMAGE] Player ${sourcePlayer.id} damaged player ${targetId} for ${damage} damage. New health: ${newHealth}`
          );

          // Find the target player
          let targetPlayer = null;
          let targetWs = null;

          // Find the WebSocket connection for the target player
          for (const [playerWs, playerData] of players.entries()) {
            if (playerData.id === targetId) {
              targetPlayer = playerData;
              targetWs = playerWs;
              break;
            }
          }

          if (targetPlayer && targetWs) {
            // Update the target player's health
            targetPlayer.health = newHealth;

            console.log(
              `[HEALTH] Updated player ${targetPlayer.id} health to ${targetPlayer.health}`
            );

            // Broadcast the health update to all clients
            broadcastToAll(wss, {
              type: "playerUpdate",
              data: {
                id: targetPlayer.id,
                position: targetPlayer.position,
                rotation: targetPlayer.rotation,
                animation: targetPlayer.animation,
                health: targetPlayer.health,
                maxHealth: targetPlayer.maxHealth,
              },
            });
          } else {
            console.log(`[ERROR] Target player ${targetId} not found!`);
          }
        } else if (data.type === "fireball") {
          // Handle fireball
          const player = players.get(ws);
          if (player) {
            console.log(`Player ${player.id} fired a fireball:`, {
              position: data.data.position,
              direction: data.data.direction,
            });

            // Broadcast fireball to all other clients
            broadcastToOthers(wss, ws, {
              type: "fireball",
              data: {
                playerId: player.id,
                position: data.data.position,
                direction: data.data.direction,
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

// Generate a fixed color for all players
function getRandomColor() {
  // Return a fixed neutral color (light gray) instead of random colors
  return 0xcccccc;
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
