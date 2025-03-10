import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { WebSocketServer, WebSocket as WS } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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
      kills: 0,
      deaths: 0,
      name: `Player ${playerId}`,
    });

    // Send initial player ID to the client
    ws.send(
      JSON.stringify({
        type: "init",
        data: {
          id: playerId,
          players: Array.from(players.values()),
        },
      })
    );

    // Broadcast to others that a new player has joined
    broadcastToOthers(
      wss,
      ws,
      JSON.stringify({
        type: "playerJoined",
        data: players.get(ws),
      })
    );

    // Handle messages from clients
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        // console.log("Received message:", data);

        // Handle different message types
        switch (data.type) {
          case "updateName":
            // Update player name
            const playerId = data.data.id;
            const playerName = data.data.name;

            console.log(`Updating player ${playerId} name to "${playerName}"`);

            // Find the player
            const playerData = players.get(ws);
            if (playerData && playerData.id === playerId) {
              // Update the name
              playerData.name = playerName;

              // Broadcast the name update to all clients
              broadcastToAll(
                wss,
                JSON.stringify({
                  type: "nameUpdate",
                  data: {
                    id: playerId,
                    name: playerName,
                  },
                })
              );
            } else {
              console.log(`Player ${playerId} not found or ID mismatch`);
            }
            break;

          case "position":
            // Update player position
            const posPlayer = players.get(ws);
            if (posPlayer) {
              // Update movement-related properties
              posPlayer.position = data.data.position;
              posPlayer.rotation = data.data.rotation;
              posPlayer.animation = data.data.animation;

              // IMPORTANT: Do NOT update health from position updates
              // Health should only be changed by damage events or health-specific updates

              // Broadcast position update to other players
              broadcastToOthers(
                wss,
                ws,
                JSON.stringify({
                  type: "playerUpdate",
                  data: posPlayer,
                })
              );
            }
            break;
          case "playerUpdate":
            // Handle player updates (including health changes)
            const updatePlayer = players.get(ws);
            if (updatePlayer) {
              // Update player data
              if (data.data.position) {
                updatePlayer.position = data.data.position;
              }
              if (data.data.rotation !== undefined) {
                updatePlayer.rotation = data.data.rotation;
              }
              if (data.data.animation) {
                updatePlayer.animation = data.data.animation;
              }
              if (data.data.health !== undefined) {
                updatePlayer.health = data.data.health;
              }
              if (data.data.name) {
                updatePlayer.name = data.data.name;
              }

              // Broadcast to other players
              broadcastToOthers(
                wss,
                ws,
                JSON.stringify({
                  type: "playerUpdate",
                  data: updatePlayer,
                })
              );
            }
            break;
          case "damagePlayer":
          case "directDamage":
            // Handle direct damage to a player
            const sourcePlayer = players.get(ws);
            if (!sourcePlayer) return;

            const targetId = data.data.targetId;
            let targetPlayer = null;

            // Find the target player
            for (const [playerWs, playerData] of players.entries()) {
              if (playerData.id === targetId) {
                targetPlayer = playerData;
                break;
              }
            }

            if (targetPlayer) {
              // Process damage
              const damage = data.data.damage || 10;
              const oldHealth = targetPlayer.health;
              targetPlayer.health = Math.max(0, targetPlayer.health - damage);

              console.log(
                `[HEALTH] Player ${targetPlayer.id} health changed: ${oldHealth} -> ${targetPlayer.health} (damage: ${damage})`
              );

              // Log the full player object that we're about to send
              console.log(
                `[DEBUG] Sending full player update:`,
                JSON.stringify({
                  id: targetPlayer.id,
                  health: targetPlayer.health,
                  maxHealth: targetPlayer.maxHealth,
                  position: targetPlayer.position,
                  rotation: targetPlayer.rotation,
                  animation: targetPlayer.animation,
                  name: targetPlayer.name,
                })
              );

              // Broadcast health update to all players - use a full player update
              broadcastToAll(
                wss,
                JSON.stringify({
                  type: "playerUpdate",
                  data: targetPlayer,
                })
              );

              // Check if player is defeated
              if (targetPlayer.health <= 0) {
                // Increment kill/death counters
                sourcePlayer.kills = (sourcePlayer.kills || 0) + 1;
                targetPlayer.deaths = (targetPlayer.deaths || 0) + 1;

                console.log(
                  `[KILL] Player ${sourcePlayer.id} killed player ${targetPlayer.id}. ` +
                    `Kills: ${sourcePlayer.kills}, Deaths: ${targetPlayer.deaths}`
                );

                // Broadcast kill message to all players
                broadcastToAll(
                  wss,
                  JSON.stringify({
                    type: "playerKill",
                    data: {
                      killerId: sourcePlayer.id,
                      killerKills: sourcePlayer.kills,
                      victimId: targetPlayer.id,
                      victimDeaths: targetPlayer.deaths,
                    },
                  })
                );
              }
            } else {
              console.log(`[ERROR] Target player ${targetId} not found!`);
            }
            break;
          case "fireball":
            // Handle fireball
            const fireballPlayer = players.get(ws);
            if (fireballPlayer) {
              console.log(`Player ${fireballPlayer.id} fired a fireball:`, {
                position: data.data.position,
                direction: data.data.direction,
              });

              // Broadcast fireball to all players
              broadcastToOthers(
                wss,
                ws,
                JSON.stringify({
                  type: "fireball",
                  data: {
                    playerId: fireballPlayer.id,
                    position: data.data.position,
                    direction: data.data.direction,
                    color: fireballPlayer.color,
                    damage: data.data.damage,
                  },
                })
              );
            }
            break;
          default:
            console.log(`Unknown message type: ${data.type}`);
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    });

    // Handle disconnections
    ws.on("close", () => {
      const player = players.get(ws);
      if (player) {
        console.log(`Player ${player.id} disconnected`);

        // Broadcast player left message to all remaining clients
        broadcastToAll(
          wss,
          JSON.stringify({
            type: "playerLeft",
            data: {
              id: player.id,
              name: player.name,
            },
          })
        );

        // Remove player from connected players
        players.delete(ws);
      }
    });
  });
}

// Function to broadcast message to all clients except the sender
function broadcastToOthers(
  wss: WebSocketServer,
  sender: WS,
  message: any
): void {
  wss.clients.forEach((client) => {
    if (client !== sender && client.readyState === WS.OPEN) {
      // If message is already a string, send it directly
      // Otherwise, stringify it
      if (typeof message === "string") {
        client.send(message);
      } else {
        client.send(JSON.stringify(message));
      }
    }
  });
}

// Function to broadcast message to all connected clients
function broadcastToAll(wss: WebSocketServer, message: any): void {
  wss.clients.forEach((client) => {
    if (client.readyState === WS.OPEN) {
      // If message is already a string, send it directly
      // Otherwise, stringify it
      if (typeof message === "string") {
        client.send(message);
      } else {
        client.send(JSON.stringify(message));
      }
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
