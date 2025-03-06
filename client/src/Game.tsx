// First, install three.js and its types
// npm install three @types/three

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface AnimationClip {
  name: string;
  clip: THREE.AnimationClip;
}

interface Player {
  id: number;
  color: number;
  position: THREE.Vector3;
  rotation: number;
  animation: string;
  model?: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  actions?: { [key: string]: THREE.AnimationAction };
  health: number;
  maxHealth: number;
  healthBar?: {
    container: THREE.Object3D;
    background: THREE.Mesh;
    foreground: THREE.Mesh;
  };
  lastHitTime: number;
}

console.log("Loading models from", window.location.origin);

const Game: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const controlsRef = useRef<OrbitControls | null>(null);
  const groundOffsetRef = useRef<number>(0);
  const modelLoadedRef = useRef<boolean>(false);
  const collidableObjectsRef = useRef<THREE.Object3D[]>([]);
  const coinsRef = useRef<THREE.Object3D[]>([]);
  const coinCountRef = useRef<number>(0);

  // Character movement state
  const movementRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    running: true, // Start in running mode by default
    jumping: false,
    canJump: true,
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
  });

  // Add these state tracking variables at the component level:
  const prevStateRef = useRef({
    isMoving: false,
    isRunning: false,
    isJumping: false,
  });

  // Simplify the mouse ref to only track normalized position
  const mouseRef = useRef({
    x: 0,
    y: 0,
    pixelX: window.innerWidth / 2,
    pixelY: window.innerHeight / 2,
  });

  // Add these new refs for multiplayer
  const socketRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef<number | null>(null);
  const playersRef = useRef<Map<number, Player>>(new Map());
  const syncIntervalRef = useRef<number | null>(null);

  // Add a reference for fireballs
  const fireballsRef = useRef<THREE.Object3D[]>([]);
  const fireballSpeedRef = useRef<number>(15); // Speed of fireballs
  const lastFireballTimeRef = useRef<number>(0); // Time of last fireball
  const fireballCooldownRef = useRef<number>(0.7); // Cooldown in seconds

  // Define speed constants at the top of the component
  const WALK_SPEED = 2;
  const RUN_SPEED = 8; // Increased from 5 to 8 for faster running movement

  useEffect(() => {
    if (!containerRef.current) return;

    // Prevent duplicate loading in development/StrictMode
    if (modelLoadedRef.current) return;

    // Initialize Three.js scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 2, 5);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false; // Disable shadows completely
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambientLight);

    // Single directional light, no shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(1, 1, 1);
    // Disable shadows completely
    directionalLight.castShadow = false;
    scene.add(directionalLight);

    // Ground plane
    const planeGeometry = new THREE.PlaneGeometry(100, 100);
    const planeMaterial = new THREE.MeshStandardMaterial({
      color: 0x808080, // Change from green (0x8bc34a) to gray
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0;
    plane.receiveShadow = true;
    plane.userData.ground = true;
    scene.add(plane);

    // Add environment elements
    createEnvironment(scene);

    // Load all animation models and extract animations
    loadAnimations().then((animations) => {
      if (!modelLoadedRef.current) {
        loadCharacterModel(animations);
        modelLoadedRef.current = true;
      }
    });

    // Event listeners for keyboard input
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Resize handler
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;

      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      const delta = clockRef.current.getDelta();

      // Update character movement
      updateCharacterMovement(delta);

      // Animate coins
      animateCoins(delta);

      // Update fireballs
      updateFireballs(delta);

      // Update animation mixer
      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }

      // Update other players' animations and health bars
      playersRef.current.forEach((player) => {
        if (player.mixer) {
          player.mixer.update(delta);
        }
        // Make health bar face camera
        if (player.healthBar && cameraRef.current) {
          player.healthBar.container.quaternion.copy(
            cameraRef.current.quaternion
          );
        }
      });

      // Update local player's health bar orientation
      if (modelRef.current && cameraRef.current) {
        const localPlayer = {
          model: modelRef.current,
          healthBar: modelRef.current.children.find(
            (child) =>
              child instanceof THREE.Object3D && child.children.length === 2
          ),
        };
        if (localPlayer.healthBar) {
          localPlayer.healthBar.quaternion.copy(cameraRef.current.quaternion);
        }
      }

      // Update camera to follow character
      updateCamera();

      // Render scene
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    animate();

    // Simplify the handleMouseMove function
    const handleMouseMove = (event: MouseEvent) => {
      // Track normalized coordinates for camera movement
      mouseRef.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = ((event.clientY / window.innerHeight) * 2 - 1) * 0.5;

      // Also track pixel coordinates for crosshair position
      mouseRef.current.pixelX = event.clientX;
      mouseRef.current.pixelY = event.clientY;
    };

    window.addEventListener("mousemove", handleMouseMove);

    // Make the character start in running mode by default
    movementRef.current.running = true;

    // Connect to WebSocket server
    const connectToServer = () => {
      // In development, connect through Vite's proxy
      const wsUrl = `${
        window.location.protocol === "https:" ? "wss:" : "ws:"
      }//${window.location.host}`;

      console.log(`Connecting to WebSocket server at ${wsUrl}`);

      try {
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          console.log("Connected to WebSocket server");

          // Start sending position updates
          if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
          syncIntervalRef.current = window.setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              sendPositionUpdate();
            }
          }, 50); // Send updates 20 times per second
        };

        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleServerMessage(message);
          } catch (error) {
            console.error("Error parsing message:", error);
          }
        };

        socket.onclose = (event) => {
          console.log(
            `Disconnected from WebSocket server: ${event.code} - ${event.reason}`
          );

          // Clear sync interval
          if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
            syncIntervalRef.current = null;
          }

          // Try to reconnect after a delay
          setTimeout(connectToServer, 3000);
        };

        socket.onerror = (error) => {
          console.error("WebSocket error:", error);
          // Close the socket on error to trigger reconnection
          socket.close();
        };
      } catch (error) {
        console.error("Error creating WebSocket connection:", error);
        // Try to reconnect after a delay
        setTimeout(connectToServer, 3000);
      }
    };

    // Initialize WebSocket connection
    connectToServer();

    // Mouse click listener for fireballs
    const handleMouseClick = (event: MouseEvent) => {
      // Only fire on left click
      if (event.button === 0) {
        fireFireball();
      }
    };

    window.addEventListener("click", handleMouseClick);

    // Cleanup
    return () => {
      // Remove event listeners
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("click", handleMouseClick);

      // Dispose of Three.js resources
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }

      // Reset flag if component is unmounting for real (not just in StrictMode)
      // In production, this will allow the component to work if it remounts
      setTimeout(() => {
        modelLoadedRef.current = false;
      }, 100);

      if (socketRef.current) {
        socketRef.current.close();
      }

      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }

      // Remove all other player models
      playersRef.current.forEach((player) => {
        if (player.model && sceneRef.current) {
          sceneRef.current.remove(player.model);
        }
      });
      playersRef.current.clear();
    };
  }, []);

  // Add this new useEffect to handle the DOM-based crosshair
  useEffect(() => {
    // Create a crosshair element that we'll control directly
    const crosshair = document.createElement("div");
    crosshair.style.cssText = `
      position: fixed;
      width: 20px;
      height: 20px;
      pointer-events: none;
      z-index: 1000;
      transform: translate(-50%, -50%);
    `;

    // Create the horizontal line
    const horizontalLine = document.createElement("div");
    horizontalLine.style.cssText = `
      position: absolute;
      width: 20px;
      height: 2px;
      background-color: white;
      top: 50%;
      left: 0;
      transform: translateY(-50%);
    `;

    // Create the vertical line
    const verticalLine = document.createElement("div");
    verticalLine.style.cssText = `
      position: absolute;
      width: 2px;
      height: 20px;
      background-color: white;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
    `;

    // Add the lines to the crosshair
    crosshair.appendChild(horizontalLine);
    crosshair.appendChild(verticalLine);

    // Add the crosshair to the document body
    document.body.appendChild(crosshair);

    // Set initial position to center of screen
    crosshair.style.left = `${window.innerWidth / 2}px`;
    crosshair.style.top = `${window.innerHeight / 2}px`;

    // Function to update crosshair position
    const updateCrosshairPosition = (e: MouseEvent) => {
      crosshair.style.left = `${e.clientX}px`;
      crosshair.style.top = `${e.clientY}px`;
    };

    // Add event listener for mouse movement
    window.addEventListener("mousemove", updateCrosshairPosition);

    // Hide the cursor on the entire document
    document.body.style.cursor = "none";

    // Clean up function
    return () => {
      window.removeEventListener("mousemove", updateCrosshairPosition);
      if (document.body.contains(crosshair)) {
        document.body.removeChild(crosshair);
      }

      // Restore the cursor
      document.body.style.cursor = "auto";
    };
  }, []);

  // Load animations from all models
  const loadAnimations = async (): Promise<AnimationClip[]> => {
    const loader = new GLTFLoader();

    const loadAnimation = async (
      url: string,
      animName: string
    ): Promise<AnimationClip> => {
      return new Promise((resolve, reject) => {
        loader.load(
          url,
          (result: any) => {
            // Clip is in the animations array
            const clip = result.animations[0];
            resolve({ name: animName, clip });
          },
          (progress: any) => {
            console.log(
              `Loading ${animName}: ${Math.round(
                (progress.loaded / progress.total) * 100
              )}%`
            );
          },
          (error: any) => {
            console.error(`Error loading ${animName}:`, error);
            reject(error);
          }
        );
      });
    };

    try {
      // Load all animations in parallel
      const animations = await Promise.all([
        loadAnimation(`${window.location.origin}/model_idle.gltf`, "idle"),
        loadAnimation(`${window.location.origin}/model_walk.gltf`, "walk"),
        loadAnimation(`${window.location.origin}/model_run.gltf`, "run"),
        loadAnimation(`${window.location.origin}/model_jump.gltf`, "jump"),
        loadAnimation(
          `${window.location.origin}/model_punch_right.gltf`,
          "punch"
        ),
      ]);

      return animations;
    } catch (error) {
      console.error("Error loading animations:", error);
      return [];
    }
  };

  // Function to position model on ground
  const positionModelOnGround = (model: THREE.Object3D): number => {
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y;
    model.position.y = height / 2;
    return height / 2;
  };

  // Load the character model
  const loadCharacterModel = (animations: AnimationClip[]) => {
    if (!sceneRef.current) return;

    const loader = new GLTFLoader();

    // Add debug logging
    console.log("Loading character model...");

    // Load the character model
    loader.load(
      "/model_idle.gltf",
      (gltf: any) => {
        const model = gltf.scene;

        // Log model hierarchy for debugging
        console.log("Model loaded, hierarchy:");
        model.traverse((node: THREE.Object3D) => {
          const isMesh = "isMesh" in node ? node.isMesh : false;
          const isBone = "isBone" in node ? node.isBone : false;
          console.log(
            `- ${node.name} (${node.type}) ${isMesh ? "MESH" : ""} ${
              isBone ? "BONE" : ""
            }`
          );
        });

        // No material modifications - keep original textures and appearance
        model.traverse((node: THREE.Object3D) => {
          if ((node as THREE.Mesh).isMesh) {
            const mesh = node as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        // Position and scale the model
        model.scale.set(0.02, 0.02, 0.02);
        model.position.set(0, 0, 0);
        model.rotation.y = Math.PI;

        // Calculate ground position
        const groundOffset = positionModelOnGround(model);

        sceneRef.current?.add(model);
        modelRef.current = model;

        // Create a player object for the local player
        const localPlayer: Player = {
          id: -1, // Temporary ID until server assigns one
          color: 0xcccccc,
          position: new THREE.Vector3(0, 0, 0),
          rotation: Math.PI,
          animation: "idle",
          model: model,
          health: 100,
          maxHealth: 100,
          lastHitTime: 0,
        };

        // Create health bar for local player
        createHealthBar(localPlayer);

        // Store local player in players map
        playersRef.current.set(-1, localPlayer);

        // Add other existing players (filtering out our own ID for safety)
        data.players.forEach((player: Player) => {
          if (player.id !== playerIdRef.current) {
            createOtherPlayer(player);
          }
        });
      },
      (progress: any) => {
        console.log(
          `Loading character model: ${Math.round(
            (progress.loaded / progress.total) * 100
          )}%`
        );
      },
      (error: any) => {
        console.error("Error loading character model:", error);
      }
    );
  };

  // Function to handle messages from the server
  const handleServerMessage = (message: any) => {
    const { type, data } = message;

    switch (type) {
      case "init":
        // Initialize player with server-assigned ID
        playerIdRef.current = data.id;
        console.log(`Initialized as player ${data.id}`);

        // Create local player object if we have a model
        if (modelRef.current) {
          const localPlayer: Player = {
            id: data.id,
            color: data.color,
            position: new THREE.Vector3(0, 0, 0),
            rotation: Math.PI,
            animation: "idle",
            model: modelRef.current,
            health: 100,
            maxHealth: 100,
            lastHitTime: 0,
          };

          // Create health bar for local player
          createHealthBar(localPlayer);

          // Store local player in players map
          playersRef.current.set(data.id, localPlayer);
        }

        // Add other existing players (filtering out our own ID for safety)
        data.players.forEach((player: Player) => {
          if (player.id !== playerIdRef.current) {
            createOtherPlayer(player);
          }
        });
        break;
      // Add other cases as needed
      default:
        console.warn(`Unknown message type: ${type}`);
    }
  };

  // Function to create a health bar for a player
  const createHealthBar = (player: Player) => {
    if (!player.model) return;

    // Create container for health bar
    const container = new THREE.Object3D();

    // Create background bar (gray) - make it double sided and larger
    const backgroundGeometry = new THREE.PlaneGeometry(2, 0.3); // Increased size
    const backgroundMaterial = new THREE.MeshBasicMaterial({
      color: 0x444444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
      depthTest: false, // Ensure it's always visible
    });
    const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);

    // Create foreground bar (green) - make it double sided and larger
    const foregroundGeometry = new THREE.PlaneGeometry(2, 0.3); // Increased size
    const foregroundMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false, // Ensure it's always visible
    });
    const foreground = new THREE.Mesh(foregroundGeometry, foregroundMaterial);

    // Center the bars within the container
    background.position.x = 0;
    foreground.position.x = 0;

    // Position the bars
    background.position.z = 0.01;
    foreground.position.z = 0.02;

    // Add to container
    container.add(background);
    container.add(foreground);

    // Position container well above player and forward
    container.position.y = 3; // Higher above player
    container.position.z = 1; // More forward

    // Make sure the health bar is always visible
    background.renderOrder = 999;
    foreground.renderOrder = 1000;

    // Create a debug box to make sure the container is positioned correctly
    const debugGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const debugMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const debugBox = new THREE.Mesh(debugGeometry, debugMaterial);
    container.add(debugBox);

    // Add container to player model
    player.model.add(container);

    // Store references
    player.healthBar = {
      container,
      background,
      foreground,
    };

    // Initial orientation to face camera
    if (cameraRef.current) {
      container.quaternion.copy(cameraRef.current.quaternion);
    }

    // Initial health bar update
    updateHealthBar(player);

    console.log(
      `Created health bar for player ${player.id} at position:`,
      container.position
    );
  };

  // Function to update a player's health bar
  const updateHealthBar = (player: Player) => {
    if (!player.healthBar) return;

    // Update health bar scale based on current health
    const healthPercent = player.health / player.maxHealth;
    player.healthBar.foreground.scale.x = Math.max(0, healthPercent);

    // Change color based on health level
    const foregroundMaterial = player.healthBar.foreground
      .material as THREE.MeshBasicMaterial;
    if (healthPercent > 0.6) {
      foregroundMaterial.color.setHex(0x00ff00); // Green
    } else if (healthPercent > 0.3) {
      foregroundMaterial.color.setHex(0xffff00); // Yellow
    } else {
      foregroundMaterial.color.setHex(0xff0000); // Red
    }

    console.log(
      `Updated health bar for player ${player.id}, health: ${player.health}/${player.maxHealth}`
    );
  };

  // Rest of the component code remains unchanged
  // ...
};
