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

      // Update other players' animations
      playersRef.current.forEach((player) => {
        if (player.mixer) {
          player.mixer.update(delta);
        }
      });

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
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.hostname;
      const port =
        process.env.NODE_ENV === "development" ? "3000" : window.location.port;
      const wsUrl = `${protocol}//${host}:${port}`;

      console.log(`Connecting to WebSocket server at ${wsUrl}`);

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("Connected to WebSocket server");

        // Start sending position updates
        if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = window.setInterval(() => {
          sendPositionUpdate();
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

      socket.onclose = () => {
        console.log("Disconnected from WebSocket server");

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
      };
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
        model.traverse((node) => {
          const isMesh = "isMesh" in node ? node.isMesh : false;
          const isBone = "isBone" in node ? node.isBone : false;
          console.log(
            `- ${node.name} (${node.type}) ${isMesh ? "MESH" : ""} ${
              isBone ? "BONE" : ""
            }`
          );
        });

        // No material modifications - keep original textures and appearance
        model.traverse((node) => {
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

        // Always apply the texture limit fix - we know we need it
        console.log("Scheduling texture fix...");
        setTimeout(() => {
          textureLimitFix();
        }, 200);

        // Create animation mixer with better logging
        console.log("Creating animation mixer");
        const mixer = new THREE.AnimationMixer(model);
        mixerRef.current = mixer;

        // Create animation actions with improved configuration
        animations.forEach(({ name, clip }) => {
          console.log(
            `Setting up animation: ${name}, duration: ${clip.duration}`
          );

          const action = mixer.clipAction(clip);

          // Configure action settings
          action.clampWhenFinished = false; // Don't clamp for looping animations

          if (name === "jump") {
            action.setLoop(THREE.LoopOnce, 1);
            action.repetitions = 1;
            action.clampWhenFinished = true; // Only clamp the jump animation
          } else {
            action.setLoop(THREE.LoopRepeat, Infinity);
          }

          // Store the action
          actionsRef.current[name] = action;
          console.log(`Animation ${name} added to actions`);
        });

        // Start with idle animation
        console.log("Starting idle animation");
        if (actionsRef.current["idle"]) {
          actionsRef.current["idle"].play();
        } else {
          console.error("No idle animation found!");
        }
      },
      undefined,
      (error) => {
        console.error("Error loading character model:", error);
      }
    );
  };

  // Add this helper function after loadCharacterModel
  const positionModelOnGround = (model: THREE.Object3D) => {
    // Create a bounding box for the model
    const boundingBox = new THREE.Box3().setFromObject(model);

    // Calculate the height of the model
    const height = boundingBox.max.y - boundingBox.min.y;

    // Calculate the offset needed to place the model on the ground
    const offset = -boundingBox.min.y;

    // Set the position so the bottom of the model is at y=0
    model.position.y = offset;

    // Store the offset in the ref for use elsewhere
    groundOffsetRef.current = offset;

    console.log(`Model height: ${height}, Offset: ${offset}`);

    return offset;
  };

  // Add this helper function after positionModelOnGround
  const isDescendantOf = (
    object: THREE.Object3D,
    parent: THREE.Object3D
  ): boolean => {
    let current = object;
    while (current) {
      if (current === parent) return true;
      current = current.parent as THREE.Object3D;
    }
    return false;
  };

  // Modify the textureLimitFix function to preserve character model textures
  const textureLimitFix = () => {
    console.log("Applying selective texture limit fix...");

    if (!sceneRef.current || !modelRef.current) return;

    // Create basic materials with absolutely no textures for environment objects
    const basicMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc });

    // Process all scene objects recursively
    sceneRef.current.traverse((object) => {
      // Replace all materials EXCEPT for the character model
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh;

        // Skip character model - preserve its textures
        if (isDescendantOf(object, modelRef.current!)) {
          console.log("Preserving character model material");
          return; // Don't modify character model materials
        }

        // For all other objects, use simple materials
        // Get color from original material if possible
        let color = 0xcccccc;
        try {
          if (mesh.material) {
            // Type guard to check if the material has a color property
            if ("color" in mesh.material) {
              color = (mesh.material as any).color.getHex();
            }
          }
        } catch (e) {}

        // Create a completely basic material with no textures
        mesh.material = new THREE.MeshBasicMaterial({ color });
      }

      // Disable non-essential lights
      if (
        object.type &&
        (object.type === "PointLight" || object.type === "SpotLight")
      ) {
        object.visible = false;
      }
    });

    // Keep directional lights for character shading
    console.log("Texture fix applied (preserving character model)");
  };

  // Create all environment objects
  const createEnvironment = (scene: THREE.Scene) => {
    console.log("Creating simplified environment...");

    // Create just a few simple platforms for jumping
    const platforms = [
      { x: 5, y: 0.5, z: 5, size: 3 },
      { x: -5, y: 1, z: -5, size: 3 },
      { x: 8, y: 1.5, z: -3, size: 2 },
    ];

    // Basic material for all objects
    const basicMaterial = new THREE.MeshBasicMaterial({ color: 0x999999 });

    // Create platforms
    platforms.forEach((platform) => {
      const geometry = new THREE.BoxGeometry(
        platform.size,
        platform.y * 2,
        platform.size
      );
      const mesh = new THREE.Mesh(geometry, basicMaterial.clone());
      mesh.position.set(platform.x, platform.y, platform.z);

      // Tag as collidable and add to collision tracking
      mesh.userData.collidable = true;
      mesh.userData.isPlatform = true; // Tag as platform for jumping
      mesh.userData.top = platform.y * 2; // Store height for collision
      collidableObjectsRef.current.push(mesh);

      scene.add(mesh);
    });

    // Create a few simple decorative elements
    // Tree-like shapes
    for (let i = 0; i < 5; i++) {
      const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 8);
      const trunk = new THREE.Mesh(
        trunkGeo,
        new THREE.MeshBasicMaterial({ color: 0x8b4513 })
      );

      const topGeo = new THREE.ConeGeometry(1, 2, 8);
      const top = new THREE.Mesh(
        topGeo,
        new THREE.MeshBasicMaterial({ color: 0x228b22 })
      );
      top.position.y = 2;

      const tree = new THREE.Group();
      tree.add(trunk);
      tree.add(top);

      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 10;
      tree.position.set(Math.cos(angle) * dist, 1, Math.sin(angle) * dist);

      // Add collision for tree trunk
      const collisionRadius = 0.5; // Collision radius for trunk
      trunk.userData.collidable = true;
      trunk.userData.isObstacle = true;
      trunk.userData.radius = collisionRadius;
      collidableObjectsRef.current.push(trunk);

      scene.add(tree);
    }

    // Create coins
    createCoins(scene);
  };

  // Add a function to create coins
  const createCoins = (scene: THREE.Scene) => {
    const coinPositions = [
      { x: 5, y: 1.5, z: 5 }, // On top of a platform
      { x: -5, y: 2.0, z: -5 }, // On another platform
      { x: 8, y: 1, z: -3 }, // Near a platform
      { x: 3, y: 1, z: 2 }, // On ground
      { x: -2, y: 1, z: 7 }, // On ground
      { x: -7, y: 1, z: -1 }, // On ground
      { x: 0, y: 1, z: -8 }, // On ground
    ];

    // Create a coin geometry that all coins will share
    const coinGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16);
    const coinMaterial = new THREE.MeshBasicMaterial({ color: 0xffd700 }); // Gold color

    coinPositions.forEach((position, index) => {
      const coin = new THREE.Mesh(coinGeometry, coinMaterial.clone());

      // Rotate to face up like a coin
      coin.rotation.x = Math.PI / 2;

      // Position the coin
      coin.position.set(position.x, position.y, position.z);

      // Add metadata
      coin.userData.coin = true;
      coin.userData.id = `coin-${index}`;
      coin.userData.value = 1;

      // Add to scene and tracking array
      scene.add(coin);
      coinsRef.current.push(coin);
      collidableObjectsRef.current.push(coin); // Make collidable
    });

    console.log(`Created ${coinPositions.length} coins`);
  };

  // Add a function to animate coins (rotation)
  const animateCoins = (delta: number) => {
    coinsRef.current.forEach((coin) => {
      // Rotate coins slowly
      coin.rotation.z += delta * 2;

      // Optional: Make coins bob up and down
      const time = clockRef.current.getElapsedTime();
      const yOffset = Math.sin(time * 2) * 0.05;
      coin.position.y += yOffset * delta;
    });
  };

  // Add a function to check for coin collisions
  const checkCoinCollisions = () => {
    if (!modelRef.current) return;

    // Create a bounding box for the player
    const playerBox = new THREE.Box3().setFromObject(modelRef.current);

    // Check each coin
    for (let i = coinsRef.current.length - 1; i >= 0; i--) {
      const coin = coinsRef.current[i];

      // Create a bounding box for the coin
      const coinBox = new THREE.Box3().setFromObject(coin);

      // Check for collision
      if (playerBox.intersectsBox(coinBox)) {
        // Collect the coin
        collectCoin(coin, i);
      }
    }
  };

  // Add a function to collect coins
  const collectCoin = (coin: THREE.Object3D, index: number) => {
    // Increase coin count
    coinCountRef.current += coin.userData.value || 1;

    // Remove from scene
    sceneRef.current?.remove(coin);

    // Remove from tracking arrays
    coinsRef.current.splice(index, 1);

    // Also remove from collidable objects
    const collidableIndex = collidableObjectsRef.current.findIndex(
      (obj) => obj === coin
    );
    if (collidableIndex !== -1) {
      collidableObjectsRef.current.splice(collidableIndex, 1);
    }

    // Play sound or effect (future enhancement)
    console.log(`Collected coin! Total: ${coinCountRef.current}`);

    // Update UI
    const coinCountElement = document.getElementById("coin-count");
    if (coinCountElement) {
      coinCountElement.textContent = `${coinCountRef.current}`;
    }
  };

  // Handle key down events
  const handleKeyDown = (event: KeyboardEvent) => {
    // Ignore if we're editing text input
    if (
      document.activeElement?.tagName === "INPUT" ||
      document.activeElement?.tagName === "TEXTAREA"
    ) {
      return;
    }

    // Use code to handle key events (more reliable across keyboard layouts)
    switch (event.code) {
      case "KeyW":
        movementRef.current.forward = true;
        break;
      case "KeyS":
        movementRef.current.backward = true;
        break;
      case "KeyA":
        movementRef.current.left = true;
        break;
      case "KeyD":
        movementRef.current.right = true;
        break;
      case "Space":
        // Only jump if we're on the ground
        if (movementRef.current.canJump) {
          console.log("Jump initiated");
          movementRef.current.velocity.y = 7; // Jump velocity
          movementRef.current.jumping = true;
          movementRef.current.canJump = false;

          // Schedule jump animation - it's one-time so we don't need to track it
          setAnimation("jump");
        }
        break;
      case "ShiftLeft":
      case "ShiftRight":
        // Hold Shift to walk instead of run
        movementRef.current.running = false;
        console.log("Walking mode activated");
        break;
      case "KeyF":
        // Fire a projectile
        fireFireball();
        break;
    }
  };

  // Handle key up events
  const handleKeyUp = (event: KeyboardEvent) => {
    // Use code to handle key events (more reliable across keyboard layouts)
    switch (event.code) {
      case "KeyW":
        movementRef.current.forward = false;
        break;
      case "KeyS":
        movementRef.current.backward = false;
        break;
      case "KeyA":
        movementRef.current.left = false;
        break;
      case "KeyD":
        movementRef.current.right = false;
        break;
      case "Space":
        // Reset jumping state when space is released
        movementRef.current.jumping = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        // Default to running when Shift is released
        movementRef.current.running = true;
        console.log("Running mode activated");
        break;
    }
  };

  // Update character movement and animations
  const updateCharacterMovement = (delta: number) => {
    if (!modelRef.current || !actionsRef.current || !mixerRef.current) return;

    // Access references
    const character = modelRef.current;
    const mixer = mixerRef.current;

    // Update animation mixer
    mixer.update(delta);

    // Apply gravity
    movementRef.current.velocity.y -= 9.8 * delta;

    // Update character position based on velocity
    character.position.y += movementRef.current.velocity.y * delta;

    // Floor collision
    if (character.position.y < groundOffsetRef.current) {
      character.position.y = groundOffsetRef.current;
      movementRef.current.velocity.y = 0;
      movementRef.current.canJump = true;
    }

    // Reset direction
    movementRef.current.direction.set(0, 0, 0);

    // Set direction based on input - standard WASD controls
    if (movementRef.current.forward) movementRef.current.direction.z -= 1;
    if (movementRef.current.backward) movementRef.current.direction.z += 1;
    if (movementRef.current.left) movementRef.current.direction.x -= 1;
    if (movementRef.current.right) movementRef.current.direction.x += 1;

    // Normalize direction vector
    if (movementRef.current.direction.length() > 0) {
      movementRef.current.direction.normalize();
    }

    // Apply camera rotation to direction
    if (cameraRef.current) {
      const cameraRotation = new THREE.Euler(
        0,
        cameraRef.current.rotation.y,
        0
      );
      movementRef.current.direction.applyEuler(cameraRotation);
    }

    // Calculate if we're moving
    const { direction, running, jumping } = movementRef.current;
    const speed = direction.length();
    const isMoving = speed > 0.1;
    const isRunning = isMoving && running;
    const isJumping = jumping;

    // Initialize previous state if not already done
    if (!prevStateRef.current) {
      prevStateRef.current = { isMoving, isRunning, isJumping };
    }

    // Determine which animation should be playing based on priority
    let targetAnimation = "idle"; // Default animation

    if (isJumping) {
      targetAnimation = "jump";
    } else if (isMoving) {
      targetAnimation = isRunning ? "run" : "walk";
    }

    // Only update animation if there is a state change or jump is triggered
    // Jump has highest priority and should always interrupt other animations
    const prev = prevStateRef.current;
    if (
      targetAnimation === "jump" || // Jump always triggers immediately
      prev.isMoving !== isMoving ||
      (isMoving && prev.isRunning !== isRunning) || // Only check running state if we're moving
      prev.isJumping !== isJumping
    ) {
      // Update the animation
      setAnimation(targetAnimation);

      // Update previous state right away to avoid animation flicker
      prevStateRef.current = { isMoving, isRunning, isJumping };
    }

    // Get the cursor direction for character facing when stationary
    if (cameraRef.current) {
      const cursorDirection = new THREE.Vector3(0, 0, -1);
      cursorDirection.applyQuaternion(cameraRef.current.quaternion);
      cursorDirection.y = 0;
      cursorDirection.normalize();

      // If moving, face the direction of movement. Otherwise, face the cursor
      if (isMoving) {
        const targetRotation = Math.atan2(
          movementRef.current.direction.x,
          movementRef.current.direction.z
        );
        character.rotation.y = targetRotation;
      } else {
        const cursorRotation = Math.atan2(cursorDirection.x, cursorDirection.z);
        character.rotation.y = cursorRotation;
      }
    }

    // Move character based on direction
    const moveSpeed = running ? RUN_SPEED : WALK_SPEED;
    character.position.x += direction.x * moveSpeed * delta;
    character.position.z += direction.z * moveSpeed * delta;

    // Check for platform collisions
    checkPlatformCollisions(character.position);

    // Check for all other collisions and resolve them
    resolveCollisions();

    // Check for coin collisions
    checkCoinCollisions();
  };

  // Update camera to follow character
  const updateCamera = () => {
    if (!modelRef.current || !cameraRef.current) return;

    // Set camera target to character position
    const targetPosition = modelRef.current.position.clone();

    // Calculate camera position based on character position and mouse
    const cameraDistance = 5; // Distance from character
    const cameraHeight = 2; // Height offset

    // Use mouse X position to determine camera angle around character
    const cameraRotationY = -mouseRef.current.x * Math.PI;

    // Calculate vertical angle (limited to prevent flipping)
    const verticalAngle =
      Math.max(-0.5, Math.min(0.5, -mouseRef.current.y)) * 0.5;

    // Set camera position using spherical coordinates
    cameraRef.current.position.x =
      targetPosition.x +
      Math.sin(cameraRotationY) * cameraDistance * Math.cos(verticalAngle);
    cameraRef.current.position.z =
      targetPosition.z +
      Math.cos(cameraRotationY) * cameraDistance * Math.cos(verticalAngle);
    cameraRef.current.position.y =
      targetPosition.y +
      cameraHeight +
      Math.sin(verticalAngle) * cameraDistance;

    // Look at character
    cameraRef.current.lookAt(targetPosition);
  };

  // Set active animation
  const setAnimation = (name: string) => {
    const actions = actionsRef.current;
    const mixer = mixerRef.current;

    // Check if animation exists
    if (!actions[name] || !mixer) {
      console.error(`Animation ${name} not found or mixer not initialized!`);
      return;
    }

    // Get the requested action
    const nextAction = actions[name];

    // Find the currently active animation
    let currentAction = null;
    let currentAnimName = null;

    for (const [animName, action] of Object.entries(actions)) {
      // Check if animation is actively playing
      if (
        action.isRunning() &&
        !action.paused &&
        action.getEffectiveWeight() > 0.1
      ) {
        currentAction = action;
        currentAnimName = animName;
        break;
      }
    }

    // If already playing the requested animation, don't interrupt
    // (except for jump which should always play)
    if (currentAction === nextAction && name !== "jump" && name !== "punch") {
      return;
    }

    console.log(
      `Switching animation from ${currentAnimName || "none"} to ${name}`
    );

    // Set up the next animation
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(1); // Set all animations to default speed
    nextAction.setEffectiveWeight(1);

    // Handle transition from current animation if it exists
    if (currentAction) {
      // Quick transitions for jump and punch
      const duration = name === "jump" || name === "punch" ? 0.1 : 0.3;

      // Smoother transitions between walk and run
      const smoothTransition =
        (currentAnimName === "walk" && name === "run") ||
        (currentAnimName === "run" && name === "walk");

      nextAction.crossFadeFrom(
        currentAction,
        smoothTransition ? 0.5 : duration,
        true
      );
    }

    nextAction.play();

    // Special handling for one-time animations
    if (name === "jump" || name === "punch") {
      // Configure as non-looping animation
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;

      // Create a one-time event listener for completion
      const onFinished = (e: THREE.Event) => {
        // Clean up the event listener
        mixer.removeEventListener("finished", onFinished);

        // Return to appropriate animation based on movement state
        if (movementRef.current.direction.length() >= 0.1) {
          const nextAnim = movementRef.current.running ? "run" : "walk";
          console.log(`${name} finished, transitioning to ${nextAnim}`);
          setAnimation(nextAnim);
        } else {
          console.log(`${name} finished, returning to idle`);
          setAnimation("idle");
        }
      };

      // Use the mixer's event system
      mixer.addEventListener("finished", onFinished);
    }
  };

  // Improve collision detection and handling
  const checkCollisions = () => {
    if (!modelRef.current) return;

    // Get character position
    const characterPosition = modelRef.current.position.clone();

    // First check for platform collisions (vertical)
    checkPlatformCollisions(characterPosition);

    // Then check for obstacle and platform side collisions (horizontal)
    resolveCollisions();
  };

  // New function to resolve collisions with better physics
  const resolveCollisions = () => {
    if (!modelRef.current) return;

    // Character dimensions
    const characterRadius = 0.3;
    const characterHeight = 1.0;

    // Get character position
    const characterPosition = modelRef.current.position.clone();

    // Try to resolve collisions by pushing the character out
    for (const object of collidableObjectsRef.current) {
      if (object.userData.isObstacle) {
        // Handle tree/obstacle collisions
        const obstaclePosition = new THREE.Vector3();
        object.getWorldPosition(obstaclePosition);

        // Only consider horizontal distance
        obstaclePosition.y = characterPosition.y;

        const collisionRadius = object.userData.radius || 0.5;
        const minDistance = collisionRadius + characterRadius;

        const distance = characterPosition.distanceTo(obstaclePosition);

        if (distance < minDistance) {
          // Calculate push direction
          const pushDir = new THREE.Vector3()
            .subVectors(characterPosition, obstaclePosition)
            .normalize();

          // Calculate overlap amount
          const overlap = minDistance - distance;

          // Push character out of collision
          modelRef.current.position.x += pushDir.x * overlap;
          modelRef.current.position.z += pushDir.z * overlap;
        }
      } else if (object.userData.isPlatform) {
        // Handle platform side collisions
        const platformBox = new THREE.Box3().setFromObject(object);

        // Create character box
        const characterMin = new THREE.Vector3(
          characterPosition.x - characterRadius,
          characterPosition.y,
          characterPosition.z - characterRadius
        );

        const characterMax = new THREE.Vector3(
          characterPosition.x + characterRadius,
          characterPosition.y + characterHeight,
          characterPosition.z + characterRadius
        );

        const characterBox = new THREE.Box3(characterMin, characterMax);

        // Check if character intersects with platform
        if (characterBox.intersectsBox(platformBox)) {
          // Don't handle if standing on top (that's handled by platform collision)
          if (Math.abs(characterPosition.y - platformBox.max.y) < 0.2) {
            continue;
          }

          // Calculate overlap amounts in each direction
          const overlapX = Math.min(
            Math.abs(characterMax.x - platformBox.min.x),
            Math.abs(characterMin.x - platformBox.max.x)
          );

          const overlapZ = Math.min(
            Math.abs(characterMax.z - platformBox.min.z),
            Math.abs(characterMin.z - platformBox.max.z)
          );

          // Resolve along the axis with smaller overlap
          if (overlapX < overlapZ) {
            // X-axis resolution
            if (
              characterPosition.x <
              (platformBox.min.x + platformBox.max.x) / 2
            ) {
              modelRef.current.position.x =
                platformBox.min.x - characterRadius - 0.01;
            } else {
              modelRef.current.position.x =
                platformBox.max.x + characterRadius + 0.01;
            }
          } else {
            // Z-axis resolution
            if (
              characterPosition.z <
              (platformBox.min.z + platformBox.max.z) / 2
            ) {
              modelRef.current.position.z =
                platformBox.min.z - characterRadius - 0.01;
            } else {
              modelRef.current.position.z =
                platformBox.max.z + characterRadius + 0.01;
            }
          }
        }
      }
    }
  };

  // Check if character is on a platform
  const checkPlatformCollisions = (characterPosition: THREE.Vector3) => {
    // Only check when character is falling or on ground
    if (movementRef.current.velocity.y > 0) return;

    for (const object of collidableObjectsRef.current) {
      if (!object.userData.isPlatform) continue;

      // Create character's bounding box
      const characterBox = new THREE.Box3().setFromObject(modelRef.current!);
      const characterBottom = characterBox.min.y;

      // Create platform bounding box
      const platformBox = new THREE.Box3().setFromObject(object);

      // Check if character is above platform
      if (
        characterBottom <= platformBox.max.y + 0.1 &&
        characterBottom >= platformBox.max.y - 0.1 &&
        characterPosition.x >= platformBox.min.x &&
        characterPosition.x <= platformBox.max.x &&
        characterPosition.z >= platformBox.min.z &&
        characterPosition.z <= platformBox.max.z
      ) {
        // Position character on top of platform
        const newY =
          platformBox.max.y + (modelRef.current!.position.y - characterBottom);
        modelRef.current!.position.y = newY;

        // Reset vertical velocity
        movementRef.current.velocity.y = 0;
        movementRef.current.canJump = true;
        return true;
      }
    }

    return false;
  };

  // Add back a simplified version of checkObstacleCollisions
  const checkObstacleCollisions = (
    proposedPosition: THREE.Vector3
  ): boolean => {
    for (const object of collidableObjectsRef.current) {
      if (!object.userData.isObstacle) continue;

      // Simple distance-based collision for obstacles
      const obstaclePosition = new THREE.Vector3();
      object.getWorldPosition(obstaclePosition);

      const collisionRadius = object.userData.radius || 0.5;
      const characterRadius = 0.3;
      const minDistance = collisionRadius + characterRadius;

      // Calculate horizontal distance only
      obstaclePosition.y = proposedPosition.y;
      const distance = proposedPosition.distanceTo(obstaclePosition);

      if (distance < minDistance) {
        return true; // Collision detected
      }
    }
    return false;
  };

  // Function to handle messages from the server
  const handleServerMessage = (message: any) => {
    const { type, data } = message;

    switch (type) {
      case "init":
        // Initialize player with server-assigned ID
        playerIdRef.current = data.id;
        console.log(`Initialized as player ${data.id}`);

        // Add other existing players (filtering out our own ID for safety)
        data.players.forEach((player: Player) => {
          if (player.id !== playerIdRef.current) {
            createOtherPlayer(player);
          }
        });
        break;

      case "playerJoined":
        console.log(`Player ${data.id} joined the game`);
        // Don't create a model for the current player
        if (data.id !== playerIdRef.current) {
          createOtherPlayer(data);
        }
        break;

      case "playerUpdate":
        // Ignore updates for the current player
        if (data.id !== playerIdRef.current) {
          updateOtherPlayer(data);
        }
        break;

      case "playerLeft":
        console.log(`Player ${data.id} left the game`);
        removeOtherPlayer(data.id);
        break;

      case "fireball":
        // Create a fireball from another player
        if (!sceneRef.current) return;

        console.log(`Received fireball from player ${data.playerId}`);

        // Create fireball mesh
        const geometry = new THREE.SphereGeometry(0.2, 16, 16);
        const material = new THREE.MeshStandardMaterial({
          color: 0xff4500,
          emissive: 0xff7700,
          emissiveIntensity: 2,
        });

        const fireball = new THREE.Mesh(geometry, material);

        // Set position from data
        fireball.position.set(
          data.position.x,
          data.position.y,
          data.position.z
        );

        // Convert direction from data
        const direction = new THREE.Vector3(
          data.direction.x,
          data.direction.y,
          data.direction.z
        );

        // Store in userData
        fireball.userData.direction = direction;
        fireball.userData.createdTime = performance.now() / 1000;
        fireball.userData.ownerId = data.playerId;

        // Add to scene and tracking array
        sceneRef.current.add(fireball);
        fireballsRef.current.push(fireball);

        // Add point light for glow effect
        const light = new THREE.PointLight(0xff5500, 1, 2);
        fireball.add(light);
        break;

      default:
        console.log("Unknown message type:", type);
    }
  };

  // Function to send position updates to the server
  const sendPositionUpdate = () => {
    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN ||
      !modelRef.current
    ) {
      return;
    }

    const position = modelRef.current.position;
    const rotation = modelRef.current.rotation.y;

    // Determine current animation
    let animation = "idle";

    // Check for active animations
    const actions = actionsRef.current;
    for (const [name, action] of Object.entries(actions)) {
      if (
        action.isRunning() &&
        !action.paused &&
        action.getEffectiveWeight() > 0.1
      ) {
        // Found active animation
        animation = name;
        break;
      }
    }

    // Fallback to movement-based animation determination if no active animation found
    if (animation === "idle") {
      if (movementRef.current.jumping) {
        animation = "jump";
      } else if (movementRef.current.direction.length() >= 0.1) {
        animation = movementRef.current.running ? "run" : "walk";
      }
    }

    socketRef.current.send(
      JSON.stringify({
        type: "position",
        data: {
          position: { x: position.x, y: position.y, z: position.z },
          rotation: rotation,
          animation: animation,
        },
      })
    );
  };

  // Function to create a model for another player
  const createOtherPlayer = (player: Player) => {
    if (!sceneRef.current) return;

    // Skip if this is the current player
    if (player.id === playerIdRef.current) {
      console.log(`Skipping model creation for self (player ${player.id})`);
      return;
    }

    // Skip if player model already exists
    if (playersRef.current.has(player.id)) {
      console.log(
        `Player ${player.id} model already exists, skipping creation`
      );
      return;
    }

    console.log(`Creating model for player ${player.id}`);

    // Load the character model
    const loader = new GLTFLoader();
    loader.load("/model_idle.gltf", (gltf) => {
      const model = gltf.scene;

      // Use the model exactly as loaded - no modifications at all
      // No traversal, no shadow settings, no material changes

      // Set position and scale
      model.scale.set(0.02, 0.02, 0.02);
      model.position.set(
        player.position.x,
        player.position.y,
        player.position.z
      );
      model.rotation.y = player.rotation;

      // Add to scene
      sceneRef.current!.add(model);

      // Setup animation mixer
      const mixer = new THREE.AnimationMixer(model);

      // Cache the player reference
      const newPlayer: Player = {
        ...player,
        position: new THREE.Vector3(
          player.position.x,
          player.position.y,
          player.position.z
        ),
        model,
        mixer,
        actions: {},
      };

      // Load animations for this player
      loadPlayerAnimations(newPlayer);

      // Store player reference
      playersRef.current.set(player.id, newPlayer);
    });
  };

  // Function to load animations for other players
  const loadPlayerAnimations = (player: Player) => {
    if (!player.model || !player.mixer) return;

    const animationFiles = [
      { url: "/model_idle.gltf", name: "idle" },
      { url: "/model_walk.gltf", name: "walk" },
      { url: "/model_run.gltf", name: "run" },
      { url: "/model_jump.gltf", name: "jump" },
      { url: "/model_punch_right.gltf", name: "punch" },
    ];

    const loader = new GLTFLoader();
    animationFiles.forEach(({ url, name }) => {
      loader.load(url, (gltf) => {
        const clip = gltf.animations[0];
        if (clip && player.mixer) {
          const action = player.mixer.clipAction(clip);
          if (player.actions) {
            player.actions[name] = action;
          }

          // Play idle animation by default
          if (name === "idle") {
            action.play();
          }
        }
      });
    });
  };

  // Function to update other players' positions
  const updateOtherPlayer = (data: any) => {
    const player = playersRef.current.get(data.id);
    if (!player || !player.model) return;

    // Update position
    player.position.set(data.position.x, data.position.y, data.position.z);
    player.model.position.copy(player.position);

    // Update rotation
    player.rotation = data.rotation;
    player.model.rotation.y = data.rotation;

    // Update animation
    if (player.animation !== data.animation) {
      player.animation = data.animation;
      updatePlayerAnimation(player);
    }
  };

  // Function to update a player's animation
  const updatePlayerAnimation = (player: Player) => {
    if (!player.actions || !player.mixer) return;

    // Find current animation
    let currentAction = null;
    for (const [name, action] of Object.entries(player.actions)) {
      if (
        action.isRunning() &&
        !action.paused &&
        action.getEffectiveWeight() > 0.1
      ) {
        currentAction = action;
        break;
      }
    }

    // Get next animation
    const nextAction = player.actions[player.animation];
    if (!nextAction) return;

    // If same animation, don't change
    if (currentAction === nextAction) return;

    // Switch animation
    nextAction.reset();
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);

    if (currentAction) {
      nextAction.crossFadeFrom(currentAction, 0.3, true);
    }

    nextAction.play();
  };

  // Function to remove a player
  const removeOtherPlayer = (playerId: number) => {
    const player = playersRef.current.get(playerId);
    if (player && player.model && sceneRef.current) {
      sceneRef.current.remove(player.model);
      playersRef.current.delete(playerId);
    }
  };

  // Function to create and shoot a fireball
  const fireFireball = () => {
    if (!modelRef.current || !sceneRef.current || !cameraRef.current) return;

    // Check cooldown
    const now = performance.now() / 1000; // Convert to seconds
    if (now - lastFireballTimeRef.current < fireballCooldownRef.current) {
      return; // Still on cooldown
    }
    lastFireballTimeRef.current = now;

    // Play punch animation
    setAnimation("punch");

    // Get direction directly from camera through cursor
    const direction = getCursorDirection();

    // Calculate fireball starting position (at the character's position)
    const startPosition = modelRef.current.position.clone();
    startPosition.y += 1.0; // Adjust height to come from hands

    // Create fireball mesh
    const geometry = new THREE.SphereGeometry(0.2, 16, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff4500, // Orange/red color
      emissive: 0xff7700,
      emissiveIntensity: 2,
    });

    const fireball = new THREE.Mesh(geometry, material);
    fireball.position.copy(startPosition);

    // Store direction vector for movement
    fireball.userData.direction = direction;
    fireball.userData.createdTime = now;
    fireball.userData.ownerId = playerIdRef.current;

    // Add to scene and tracking array
    sceneRef.current.add(fireball);
    fireballsRef.current.push(fireball);

    // Add point light to fireball for glow effect
    const light = new THREE.PointLight(0xff5500, 1, 2);
    fireball.add(light);

    // Broadcast fireball to other players
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "fireball",
          data: {
            position: {
              x: startPosition.x,
              y: startPosition.y,
              z: startPosition.z,
            },
            direction: { x: direction.x, y: direction.y, z: direction.z },
          },
        })
      );
    }
  };

  // Function to update fireballs position and check collisions
  const updateFireballs = (delta: number) => {
    const speed = fireballSpeedRef.current;
    const now = performance.now() / 1000;

    // Update each fireball position
    for (let i = fireballsRef.current.length - 1; i >= 0; i--) {
      const fireball = fireballsRef.current[i];
      const direction = fireball.userData.direction;

      // Move fireball
      fireball.position.add(direction.clone().multiplyScalar(speed * delta));

      // Rotate the fireball for visual effect
      fireball.rotation.x += 5 * delta;
      fireball.rotation.z += 5 * delta;

      // Check lifetime (remove after 3 seconds)
      if (now - fireball.userData.createdTime > 3) {
        sceneRef.current?.remove(fireball);
        fireballsRef.current.splice(i, 1);
        continue;
      }

      // Check collision with other players
      playersRef.current.forEach((player, playerId) => {
        if (player.model && playerId !== fireball.userData.ownerId) {
          const distance = fireball.position.distanceTo(player.model.position);
          if (distance < 0.5) {
            // Hit radius
            // Handle hit - remove fireball
            sceneRef.current?.remove(fireball);
            fireballsRef.current.splice(i, 1);

            // Could add hit effect or scoring here
            console.log(`Player ${playerId} hit by fireball!`);
          }
        }
      });
    }
  };

  // Function to get direction from character to cursor in 3D space
  const getCursorDirection = (): THREE.Vector3 => {
    if (!cameraRef.current || !modelRef.current) {
      // Default forward direction if camera or model not available
      return new THREE.Vector3(0, 0, 1);
    }

    // Create a raycaster from the camera through the cursor position
    const raycaster = new THREE.Raycaster();

    // Convert normalized coordinates to raycaster format (-1 to 1)
    raycaster.setFromCamera(
      new THREE.Vector2(mouseRef.current.x, mouseRef.current.y),
      cameraRef.current
    );

    // Calculate the direction vector
    const direction = raycaster.ray.direction.clone();

    // Maintain the horizontal direction but reduce vertical component
    direction.y *= 0.1; // Reduce vertical component to make shots more level
    direction.normalize();

    return direction;
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "absolute",
        top: 0,
        left: 0,
        cursor: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          color: "white",
          background: "rgba(0,0,0,0.5)",
          padding: "10px",
          borderRadius: "5px",
          maxWidth: "300px",
        }}
      >
        <h3 style={{ margin: "0 0 10px 0" }}>Controls:</h3>
        <p style={{ margin: "5px 0" }}>W, A, S, D - Move</p>
        <p style={{ margin: "5px 0" }}>Shift - Walk (Hold to walk slower)</p>
        <p style={{ margin: "5px 0" }}>Space - Jump</p>
        <p style={{ margin: "5px 0" }}>Mouse - Camera</p>
        <p style={{ margin: "5px 0" }}>Left Click/F - Shoot Fireball</p>
      </div>

      {/* Add coin counter display */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          color: "white",
          background: "rgba(0,0,0,0.5)",
          padding: "10px",
          borderRadius: "5px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            backgroundColor: "#ffd700",
            marginRight: "10px",
          }}
        ></div>
        <span id="coin-count" style={{ fontSize: "18px", fontWeight: "bold" }}>
          {coinCountRef.current}
        </span>
      </div>
    </div>
  );
};

export default Game;
