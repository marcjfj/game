// First, install three.js and its types
// npm install three @types/three

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { initControlPanel, getConfig } from "./ControlPanel";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

// Constants for player health
const MAX_PLAYER_HEALTH = 100;
const HEALTH_BAR_WIDTH = 100; // Width in pixels
const HEALTH_BAR_HEIGHT = 10; // Height in pixels

// Debug settings
const GAMEPAD_DEBUG_MODE = false; // Set to true to enable gamepad debugging

// Function to update the local player's HUD health bar
const updateLocalPlayerHealthBar = (health: number) => {
  const healthBar = document.getElementById("player-health-bar");
  if (!healthBar) return;

  const healthRatio = Math.max(0, health / MAX_PLAYER_HEALTH);
  healthBar.style.width = `${healthRatio * 100}%`;

  // Change color based on health level
  if (healthRatio < 0.3) {
    healthBar.style.background = "#ff0000"; // Red when low health
  } else if (healthRatio < 0.6) {
    healthBar.style.background = "#ffff00"; // Yellow when medium health
  } else {
    healthBar.style.background = "#00ff00"; // Green when high health
  }
};

interface AnimationClip {
  name: string;
  clip: THREE.AnimationClip;
}

interface Player {
  id: number;
  position: THREE.Vector3;
  rotation: number;
  animation: string;
  model?: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  actions?: { [key: string]: THREE.AnimationAction };
  health: number;
  maxHealth: number;
  healthBar?: HTMLDivElement;
  healthBarForeground?: HTMLDivElement;
  lastHitTime?: number;
  jumpStartTime?: number;
  kills: number;
  deaths: number;
  name: string;
}

console.log("Loading models from", window.location.origin);

// Define speed constants - these will be overridden by the control panel
const WALK_SPEED = 2;
const RUN_SPEED = 8; // Increased from 5 to 8 for faster running movement

const Game: React.FC = () => {
  // Move all useRef declarations inside the component
  const prevStateRef = useRef({
    isMoving: false,
    isRunning: false,
    isJumping: false,
  });

  // Add state for player name menu
  const [showNameMenu, setShowNameMenu] = useState(true); // Show menu on initial load
  const [playerName, setPlayerName] = useState("");
  const [isRespawning, setIsRespawning] = useState(false);

  const mouseRef = useRef({
    x: 0,
    y: 0,
    pixelX: window.innerWidth / 2,
    pixelY: window.innerHeight / 2,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef<number | null>(null);
  const playersRef = useRef<Map<number, Player>>(new Map());
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fireballsRef = useRef<THREE.Object3D[]>([]);
  const fireballSpeedRef = useRef<number>(25); // Increased speed for better responsiveness
  const lastFireballTimeRef = useRef<number>(0); // Time of last fireball
  const fireballCooldownRef = useRef<number>(0.4); // Reduced cooldown for faster firing

  // Add control panel ref
  const controlPanelRef = useRef<any>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const currentAnimationRef = useRef<string>("idle");
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
    jumpStartTime: 0,
  });

  // Gamepad support
  const gamepadRef = useRef<Gamepad | null>(null);
  const gamepadConnectedRef = useRef<boolean>(false);
  const gamepadSensitivityRef = useRef<number>(0.15); // Adjust sensitivity as needed
  const gamepadDeadzoneRef = useRef<number>(0.1); // Deadzone for analog sticks
  const gamepadLastFireballTimeRef = useRef<number>(0);
  const gamepadFireRateRef = useRef<number>(500); // In milliseconds, adjust as needed

  // Add this new useEffect to handle the DOM-based crosshair
  useEffect(() => {
    // Create a crosshair element that we'll control directly
    const crosshair = document.createElement("div");
    crosshair.setAttribute("data-crosshair", "true"); // Add data attribute for easy selection
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

    // Initialize mouseRef with these coordinates
    mouseRef.current.pixelX = window.innerWidth / 2;
    mouseRef.current.pixelY = window.innerHeight / 2;
    mouseRef.current.x = 0; // Centered in normalized coordinates
    mouseRef.current.y = 0;

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
        loadAnimation(`${window.location.origin}/model_die.gltf`, "die"),
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

          // Configure action settings based on animation type
          if (name === "jump") {
            // Configure jump animation for physics synchronization
            action.setLoop(THREE.LoopOnce, 1);
            action.repetitions = 1;
            action.clampWhenFinished = true;

            // Don't set time scale here - we'll calculate it dynamically based on physics

            // Ensure animation starts and ends cleanly
            action.zeroSlopeAtStart = false; // Start animation immediately
            action.zeroSlopeAtEnd = true; // Smooth end

            // CRITICAL FIX: Make sure the animation completes properly
            action.setDuration(clip.duration); // Use original duration

            // Disable automatic crossfade for jump animation
            action.fadeIn(0);
            action.fadeOut(0.1); // Very short fade out
          } else if (name === "punch" || name === "die") {
            // Configure other one-time animations
            action.setLoop(THREE.LoopOnce, 1);
            action.repetitions = 1;
            action.clampWhenFinished = true;
          } else {
            // Configure looping animations (idle, walk, run)
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.clampWhenFinished = false;
          }

          // Store the action
          actionsRef.current[name] = action;
          console.log(`Animation ${name} added to actions`);
        });

        // Add a mixer event listener to detect when animations finish
        mixer.addEventListener("finished", (e: any) => {
          const action = e.action;

          // Check if it's the jump animation that finished
          if (action === actionsRef.current["jump"]) {
            console.log("Jump animation finished via mixer event");

            // If we're still in jump animation state, force transition to appropriate animation
            if (currentAnimationRef.current === "jump") {
              // Calculate which animation to return to
              const returnAnimation =
                movementRef.current.direction.length() > 0
                  ? movementRef.current.running
                    ? "run"
                    : "walk"
                  : "idle";

              console.log(
                `Jump animation finished, transitioning to ${returnAnimation}`
              );

              // Play return animation
              const returnAction = actionsRef.current[returnAnimation];
              if (returnAction) {
                returnAction.reset();
                returnAction.play();
                currentAnimationRef.current = returnAnimation;
              }
            }
          }
        });

        // Start with idle animation
        console.log("Starting idle animation");
        if (actionsRef.current["idle"]) {
          actionsRef.current["idle"].play();
          currentAnimationRef.current = "idle";
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
    const basicMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc }); // Changed to MeshLambertMaterial for shadows

    // Process all scene objects recursively
    sceneRef.current.traverse((object) => {
      // Replace all materials EXCEPT for player models and floor
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh;

        // Skip local player model - preserve its textures
        if (isDescendantOf(object, modelRef.current!)) {
          console.log("Preserving local player model material");
          return; // Don't modify local player model materials
        }

        // Also skip other player models - preserve their textures too
        let isPlayerModel = false;
        playersRef.current.forEach((player) => {
          if (player.model && isDescendantOf(object, player.model)) {
            isPlayerModel = true;
          }
        });

        if (isPlayerModel) {
          console.log("Preserving other player model material");
          return; // Don't modify other player model materials
        }

        // Preserve floor texture
        if (mesh.userData && (mesh.userData.isFloor || mesh.userData.ground)) {
          console.log("Preserving floor texture");
          return; // Don't modify floor materials
        }

        // Preserve platform textures
        if (mesh.userData && mesh.userData.isPlatform) {
          console.log("Preserving platform texture");
          return; // Don't modify platform materials
        }

        // Preserve palm tree materials
        if (mesh.userData && mesh.userData.isPalmTree) {
          console.log("Preserving palm tree material");
          return; // Don't modify palm tree materials
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

        // Create a completely basic material with no textures but preserve shadow properties
        const newMaterial = new THREE.MeshLambertMaterial({ color });
        const castShadow = mesh.castShadow;
        const receiveShadow = mesh.receiveShadow;

        mesh.material = newMaterial;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
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
    console.log("Creating environment with textured floor...");

    // Check if there's already a ground plane and remove it
    const existingGround = scene.children.find(
      (child) => child instanceof THREE.Mesh && child.userData.ground === true
    );

    if (existingGround) {
      console.log("Removing existing ground plane...");
      scene.remove(existingGround);
    }

    // Load the dirt floor textures first
    console.log("Loading floor textures...");
    const textureLoader = new THREE.TextureLoader();
    const normalLoader = new EXRLoader();
    const roughnessLoader = new EXRLoader();

    // Load plaster textures for platforms
    console.log("Loading plaster textures for platforms...");
    const plasterDiffuseMap = textureLoader.load(
      "/texture/painted_plaster_wall_diff_4k.jpg",
      (texture) => {
        console.log("Plaster diffuse map loaded successfully");
        // Ensure texture is configured properly
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2);
      },
      undefined,
      (error) => console.error("Error loading plaster diffuse map:", error)
    );

    const plasterDisplacementMap = textureLoader.load(
      "/texture/painted_plaster_wall_disp_4k.png",
      (texture) => {
        console.log("Plaster displacement map loaded successfully");
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2);
      },
      undefined,
      (error) => console.error("Error loading plaster displacement map:", error)
    );

    // Load diffuse and displacement immediately
    console.log("Loading diffuse and displacement maps...");
    const diffuseMap = textureLoader.load(
      "/texture/dirt_floor_diff_4k.jpg",
      (texture) => {
        console.log("Diffuse map loaded successfully");
        // Ensure texture is configured properly
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(10, 10);
      },
      undefined,
      (error) => console.error("Error loading diffuse map:", error)
    );
    const displacementMap = textureLoader.load(
      "/texture/dirt_floor_disp_4k.png",
      (texture) => {
        console.log("Displacement map loaded successfully");
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(10, 10);
      },
      undefined,
      (error) => console.error("Error loading displacement map:", error)
    );

    // Create a basic fallback floor now that we have the textures
    const createBasicFloor = () => {
      console.log("Creating basic fallback floor...");
      const floorSize = 100;
      const floorGeometry = new THREE.PlaneGeometry(floorSize, floorSize);

      // Try to use the diffuse texture right away if available
      const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b7355, // Dirt brown color
        side: THREE.DoubleSide,
        roughness: 1.0,
        map: diffuseMap, // Apply the diffuse map immediately
      });

      if (floorMaterial.map) {
        console.log("Applied diffuse map to basic floor");
        floorMaterial.map.colorSpace = THREE.SRGBColorSpace;
      }

      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      floor.receiveShadow = true;
      floor.userData.collidable = true;
      floor.userData.isFloor = true;
      floor.userData.ground = true;

      collidableObjectsRef.current.push(floor);
      scene.add(floor);
      return floor;
    };

    // Create a basic floor immediately, replace it when textures load
    const basicFloor = createBasicFloor();

    // Using Promise to handle async loading of EXR textures
    console.log("Loading normal and roughness maps...");
    Promise.all([
      new Promise<THREE.DataTexture | THREE.Texture>((resolve, reject) => {
        // Try loading EXR first
        normalLoader.load(
          "/texture/dirt_floor_nor_gl_4k.exr",
          (texture: THREE.DataTexture) => {
            console.log("Normal map loaded successfully from EXR");
            resolve(texture);
          },
          undefined,
          (error: unknown) => {
            console.warn(
              "Error loading normal EXR map, trying fallback format:",
              error
            );
            // Fallback to JPG/PNG if EXR fails
            textureLoader.load(
              "/texture/dirt_floor_nor_gl_4k.jpg",
              (texture) => {
                console.log("Normal map loaded from fallback JPG");
                resolve(texture);
              },
              undefined,
              (fallbackError) => {
                console.error("All normal map formats failed:", fallbackError);
                // Create a default normal map as last resort
                const defaultNormalMap = new THREE.Texture();
                defaultNormalMap.colorSpace = THREE.SRGBColorSpace;
                resolve(defaultNormalMap);
              }
            );
          }
        );
      }),
      new Promise<THREE.DataTexture | THREE.Texture>((resolve, reject) => {
        roughnessLoader.load(
          "/texture/dirt_floor_rough_4k.exr",
          (texture: THREE.DataTexture) => {
            console.log("Roughness map loaded successfully from EXR");
            resolve(texture);
          },
          undefined,
          (error: unknown) => {
            console.warn(
              "Error loading roughness EXR map, trying fallback format:",
              error
            );
            // Fallback to JPG/PNG if EXR fails
            textureLoader.load(
              "/texture/dirt_floor_rough_4k.jpg",
              (texture) => {
                console.log("Roughness map loaded from fallback JPG");
                resolve(texture);
              },
              undefined,
              (fallbackError) => {
                console.error(
                  "All roughness map formats failed:",
                  fallbackError
                );
                // Create a default roughness map as last resort
                const defaultRoughnessMap = new THREE.Texture();
                defaultRoughnessMap.colorSpace = THREE.SRGBColorSpace;
                resolve(defaultRoughnessMap);
              }
            );
          }
        );
      }),
    ])
      .then(([normalMap, roughnessMap]) => {
        console.log("All textures loaded successfully, creating PBR floor...");
        // Create the floor
        const floorSize = 200; // Increased from 100 to 200 for a larger map
        const floorGeometry = new THREE.PlaneGeometry(
          floorSize,
          floorSize,
          64,
          64
        );

        // Create PBR material with all textures
        const floorMaterial = new THREE.MeshStandardMaterial({
          map: diffuseMap,
          normalMap: normalMap,
          roughnessMap: roughnessMap,
          displacementMap: displacementMap,
          displacementScale: 0.1, // Reduced scale to be less dramatic
          roughness: 1.0,
          metalness: 0.0,
          side: THREE.DoubleSide,
          color: 0x8b7355, // Add a base color in case textures fail
        });

        console.log("Floor material properties:", {
          hasMap: !!floorMaterial.map,
          hasNormalMap: !!floorMaterial.normalMap,
          hasRoughnessMap: !!floorMaterial.roughnessMap,
          hasDisplacementMap: !!floorMaterial.displacementMap,
        });

        // Ensure textures are properly configured
        [diffuseMap, normalMap, roughnessMap, displacementMap].forEach(
          (map, index) => {
            if (!map) {
              console.warn(`Texture at index ${index} is undefined`);
              return;
            }
            console.log(`Texture ${index} properties:`, {
              isTexture: map instanceof THREE.Texture,
              image: !!map.image,
              needsUpdate: map.needsUpdate,
              wrapS: map.wrapS,
              wrapT: map.wrapT,
            });
          }
        );

        // Force update of textures
        floorMaterial.needsUpdate = true;

        // Adjust texture properties for proper tiling
        diffuseMap.wrapS = diffuseMap.wrapT = THREE.RepeatWrapping;
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
        displacementMap.wrapS = displacementMap.wrapT = THREE.RepeatWrapping;

        // Set encoding for the textures to ensure proper display
        diffuseMap.colorSpace = THREE.SRGBColorSpace;

        // Set repeat to tile the texture multiple times across the floor
        const repeat = 10;
        diffuseMap.repeat.set(repeat, repeat);
        normalMap.repeat.set(repeat, repeat);
        roughnessMap.repeat.set(repeat, repeat);
        displacementMap.repeat.set(repeat, repeat);

        // Create the floor mesh
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2; // Rotate to be horizontal
        floor.position.y = 0; // At ground level
        floor.receiveShadow = true;

        // Tag as collidable floor and ground
        floor.userData.collidable = true;
        floor.userData.isFloor = true;
        floor.userData.ground = true; // Mark as ground for consistency

        console.log("Floor mesh created with userData:", floor.userData);

        // Remove the basic floor and add the textured one
        console.log("Replacing basic floor with textured floor...");
        scene.remove(basicFloor);
        const basicFloorIndex =
          collidableObjectsRef.current.indexOf(basicFloor);
        if (basicFloorIndex !== -1) {
          collidableObjectsRef.current.splice(basicFloorIndex, 1);
        }

        // Add to scene and collision objects
        collidableObjectsRef.current.push(floor);
        scene.add(floor);
        console.log("Textured floor added to scene");
      })
      .catch((error) => {
        console.error(
          "Failed to load EXR textures, keeping basic floor:",
          error
        );
      });

    // Create more platforms for jumping with varied heights and sizes
    const platforms = [
      // Original platforms
      { x: 5, y: 0.5, z: 5, size: 3 },
      { x: -5, y: 1, z: -5, size: 3 },
      { x: 8, y: 1.5, z: -3, size: 2 },

      // New platforms - creating a path/course across the map
      { x: 12, y: 2, z: 8, size: 2.5 },
      { x: 18, y: 2.5, z: 12, size: 2 },
      { x: 25, y: 3, z: 15, size: 3 },
      { x: 32, y: 3.5, z: 10, size: 2.5 },
      { x: 40, y: 4, z: 5, size: 3 },
      { x: 35, y: 4.5, z: -5, size: 2 },
      { x: 28, y: 5, z: -12, size: 3.5 },
      { x: 20, y: 4.5, z: -18, size: 2.5 },
      { x: 10, y: 4, z: -25, size: 3 },
      { x: 0, y: 3.5, z: -30, size: 2.5 },
      { x: -10, y: 3, z: -25, size: 3 },
      { x: -18, y: 2.5, z: -18, size: 2.5 },
      { x: -25, y: 2, z: -10, size: 3 },
      { x: -30, y: 1.5, z: 0, size: 2.5 },
      { x: -25, y: 2, z: 10, size: 3 },
      { x: -18, y: 2.5, z: 18, size: 2.5 },
      { x: -10, y: 3, z: 25, size: 3 },
      { x: 0, y: 3.5, z: 30, size: 2.5 },

      // Some floating islands
      { x: -15, y: 6, z: -15, size: 5 },
      { x: 15, y: 7, z: 15, size: 5 },
      { x: 0, y: 8, z: 0, size: 6 },

      // Stepping stones
      { x: -40, y: 1, z: -40, size: 1.5 },
      { x: -35, y: 1.2, z: -38, size: 1.5 },
      { x: -30, y: 1.4, z: -36, size: 1.5 },
      { x: -25, y: 1.6, z: -34, size: 1.5 },
      { x: -20, y: 1.8, z: -32, size: 1.5 },

      // Platforms in corners
      { x: 45, y: 2, z: 45, size: 4 },
      { x: -45, y: 2, z: 45, size: 4 },
      { x: 45, y: 2, z: -45, size: 4 },
      { x: -45, y: 2, z: -45, size: 4 },
    ];

    // Basic material for all objects
    const basicMaterial = new THREE.MeshBasicMaterial({ color: 0x999999 });

    // Create a textured material for platforms using plaster textures
    const platformMaterial = new THREE.MeshStandardMaterial({
      map: plasterDiffuseMap,
      normalMap: plasterDisplacementMap, // Use displacement map as normal map instead
      normalScale: new THREE.Vector2(0.1, 0.1), // Subtle normal mapping
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide,
      color: 0xbbbbbb, // Light gray base color
    });

    // Configure texture settings for platforms
    [plasterDiffuseMap, plasterDisplacementMap].forEach((texture) => {
      if (texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2); // Slightly larger repeat for better edge coverage
        if (texture === plasterDiffuseMap) {
          texture.colorSpace = THREE.SRGBColorSpace;
        }
      }
    });

    // Create platforms
    platforms.forEach((platform) => {
      // Create beveled box geometry for smoother edges
      const geometry = new THREE.BoxGeometry(
        platform.size + 0.1, // Slightly larger base
        platform.y * 2,
        platform.size + 0.1,
        1, // Reduced segments since we're not using displacement
        1,
        1
      );

      // Add bevel modifier
      const beveled = new THREE.BufferGeometry();
      const positions = Array.from(geometry.attributes.position.array);
      const normals = Array.from(geometry.attributes.normal.array);
      const uvs = Array.from(geometry.attributes.uv.array);
      const indices = geometry.index ? Array.from(geometry.index.array) : [];

      // Create new arrays for the beveled geometry
      const newPositions: number[] = [];
      const newNormals: number[] = [];
      const newUvs: number[] = [];

      // Process each vertex
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];

        // Get vertex normal
        const nx = normals[i];
        const ny = normals[i + 1];
        const nz = normals[i + 2];

        // Add original vertex slightly inset
        const insetAmount = 0.02; // Bevel size
        newPositions.push(
          x - nx * insetAmount,
          y - ny * insetAmount,
          z - nz * insetAmount
        );
        newNormals.push(nx, ny, nz);
        newUvs.push(uvs[(i / 3) * 2], uvs[(i / 3) * 2 + 1]);
      }

      // Set up the new geometry
      beveled.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(newPositions, 3)
      );
      beveled.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(newNormals, 3)
      );
      beveled.setAttribute("uv", new THREE.Float32BufferAttribute(newUvs, 2));
      beveled.setIndex(indices);
      beveled.computeVertexNormals();

      // Create the mesh with beveled geometry
      const mesh = new THREE.Mesh(beveled, platformMaterial.clone());
      mesh.position.set(platform.x, platform.y, platform.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Tag as collidable and add to collision tracking
      mesh.userData.collidable = true;
      mesh.userData.isPlatform = true;
      mesh.userData.top = platform.y * 2;
      collidableObjectsRef.current.push(mesh);

      scene.add(mesh);
    });

    // Create more trees for a forest-like environment
    for (let i = 0; i < 25; i++) {
      // Increased from 5 to 25 trees
      const angle = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 80; // Increased max distance from 20 to 90
      const posX = Math.cos(angle) * dist;
      const posZ = Math.sin(angle) * dist;

      // Load palm tree GLTF model
      const loader = new GLTFLoader();
      loader.load(
        "/models/trees/scene.gltf",
        (gltf) => {
          const model = gltf.scene;

          // Scale and position the model - palm trees are typically tall
          model.scale.set(1.5, 1.5, 1.5); // Slightly smaller scale
          model.position.set(posX, 0, posZ); // Initial position

          // Tag as palm tree for texture limit fix
          model.userData.isPalmTree = true;

          // Rotate randomly for variety
          model.rotation.y = Math.random() * Math.PI * 2;

          // Find the lowest point of the model and position it on the ground
          // We need to wait for the model to be fully loaded before calculating the bounding box
          setTimeout(() => {
            const boundingBox = new THREE.Box3().setFromObject(model);
            const offset = -boundingBox.min.y;
            model.position.y = offset;
            console.log(`Palm tree positioned at offset: ${offset}`);
          }, 100);

          // Add to scene
          scene.add(model);

          // Enable shadows for all meshes in the model
          model.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
              const mesh = node as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });

          // Find the trunk for collision
          let trunkFound = false;
          model.traverse((node) => {
            if (
              node.name &&
              (node.name.includes("trunk") ||
                node.name.includes("Trunk") ||
                node.name.includes("Branches_trunk_Mat_0"))
            ) {
              // Add collision data to the trunk
              node.userData.collidable = true;
              node.userData.isObstacle = true;
              node.userData.radius = 0.5; // Smaller collision radius for better gameplay
              collidableObjectsRef.current.push(node);
              trunkFound = true;
            }
          });

          // If no specific trunk is found, add collision to the whole model
          if (!trunkFound) {
            // Add a simplified collision cylinder for the trunk
            const collisionRadius = 0.5;
            const collisionHeight = 4.0;
            const collisionGeo = new THREE.CylinderGeometry(
              collisionRadius,
              collisionRadius,
              collisionHeight,
              8
            );
            const collisionMesh = new THREE.Mesh(
              collisionGeo,
              new THREE.MeshBasicMaterial({
                color: 0xff0000,
                wireframe: true,
                visible: false, // Hide the collision mesh
              })
            );

            // Position the collision cylinder at the base of the tree
            collisionMesh.position.copy(model.position);
            collisionMesh.position.y = collisionHeight / 2; // Center vertically

            // Add collision data
            collisionMesh.userData.collidable = true;
            collisionMesh.userData.isObstacle = true;
            collisionMesh.userData.radius = collisionRadius;

            // Add to scene and collision objects
            model.add(collisionMesh);
            collidableObjectsRef.current.push(collisionMesh);
          }

          // Apply texture limit fix to the tree model to improve performance
          model.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
              const mesh = node as THREE.Mesh;

              // Keep the original material color
              let color = 0x8b4513; // Default brown
              try {
                if (mesh.material && "color" in mesh.material) {
                  color = (mesh.material as any).color.getHex();
                }
              } catch (e) {}

              // Use MeshLambertMaterial for better performance while keeping some shading
              if (
                node.name.includes("trunk") ||
                node.name.includes("Trunk") ||
                node.name.includes("Branches")
              ) {
                mesh.material = new THREE.MeshLambertMaterial({
                  color: 0x8b4513,
                }); // Brown for trunk
                mesh.castShadow = true;
                mesh.receiveShadow = true;
              } else if (
                node.name.includes("leaves") ||
                node.name.includes("Fronds")
              ) {
                mesh.material = new THREE.MeshLambertMaterial({
                  color: 0x228b22,
                  transparent: true,
                  opacity: 0.95,
                  side: THREE.DoubleSide, // Render both sides of leaf geometry
                }); // Green for leaves
                mesh.castShadow = true; // Leaves cast shadows
                mesh.receiveShadow = false; // But don't receive them for better performance
              }
            }
          });
        },
        (xhr) => {
          console.log(
            `Palm tree model ${i + 1}: ${Math.round(
              (xhr.loaded / xhr.total) * 100
            )}% loaded`
          );
        },
        (error) => {
          console.error("Error loading palm tree model:", error);

          // Fallback to simple tree if model fails to load
          const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 8);
          const trunk = new THREE.Mesh(
            trunkGeo,
            new THREE.MeshLambertMaterial({ color: 0x8b4513 })
          );
          trunk.castShadow = true;
          trunk.receiveShadow = true;

          const topGeo = new THREE.ConeGeometry(1, 2, 8);
          const top = new THREE.Mesh(
            topGeo,
            new THREE.MeshLambertMaterial({ color: 0x228b22 })
          );
          top.position.y = 2;
          top.castShadow = true;
          top.receiveShadow = true;

          const tree = new THREE.Group();
          tree.add(trunk);
          tree.add(top);
          tree.position.set(posX, 1, posZ);

          // Add collision for tree trunk
          const collisionRadius = 0.5;
          trunk.userData.collidable = true;
          trunk.userData.isObstacle = true;
          trunk.userData.radius = collisionRadius;
          collidableObjectsRef.current.push(trunk);

          scene.add(tree);
        }
      );
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

          // Apply physics first to calculate jump duration
          const jumpVelocity = 7; // Jump velocity
          movementRef.current.velocity.y = jumpVelocity;
          movementRef.current.jumping = true;
          movementRef.current.canJump = false;

          // Calculate approximate time in air (using physics formula: t = 2*v0/g)
          // This is the time to go up and come back down
          const gravity = 15; // Increased gravity for faster falling
          const timeInAir = (2 * jumpVelocity) / gravity;
          console.log(`Estimated time in air: ${timeInAir} seconds`);

          // CRITICAL FIX: Force immediate jump animation with no transitions
          // This bypasses the normal animation system to eliminate any delay
          const jumpAction = actionsRef.current["jump"];
          if (jumpAction && mixerRef.current) {
            // Store jump start time for tracking
            movementRef.current.jumpStartTime = performance.now() / 1000;

            // Stop all currently running animations immediately
            for (const action of Object.values(actionsRef.current)) {
              action.stop();
            }

            // Configure and play jump animation directly
            jumpAction.reset();
            jumpAction.setLoop(THREE.LoopOnce, 1);
            jumpAction.clampWhenFinished = true;

            // IMPORTANT: Set the time scale to match the physics
            // Original animation duration / time in air = time scale factor
            const originalDuration = jumpAction.getClip().duration;
            const timeScale = originalDuration / timeInAir;

            // Set time scale to match physics (slower than before)
            jumpAction.setEffectiveTimeScale(timeScale);
            jumpAction.setEffectiveWeight(1);
            jumpAction.play();

            // Update current animation reference
            currentAnimationRef.current = "jump";
          }
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
        // Note: We don't reset canJump here - that's handled by physics
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
    if (!modelRef.current || !mixerRef.current) return;

    // Update animation mixer
    mixerRef.current.update(delta);

    // Get the control panel configuration
    const config = getConfig();

    // Use the control panel values for movement speeds
    const walkSpeed = config.player.walkSpeed;
    const runSpeed = config.player.runSpeed;

    // Get current movement state
    const {
      forward,
      backward,
      left,
      right,
      running,
      jumping,
      velocity,
      direction,
    } = movementRef.current;

    // Determine if the character is moving
    const isMoving = forward || backward || left || right;
    const isRunning = running && isMoving;
    const isJumping = jumping;

    // Check if state has changed
    const stateChanged =
      prevStateRef.current.isMoving !== isMoving ||
      prevStateRef.current.isRunning !== isRunning ||
      prevStateRef.current.isJumping !== isJumping;

    // Update previous state
    prevStateRef.current.isMoving = isMoving;
    prevStateRef.current.isRunning = isRunning;
    prevStateRef.current.isJumping = isJumping;

    // Set appropriate animation based on state
    if (stateChanged) {
      if (isJumping) {
        setAnimation("jump");
      } else if (isMoving) {
        setAnimation(isRunning ? "run" : "walk");
      } else {
        setAnimation("idle");
      }
    }

    // Calculate movement direction
    direction.set(0, 0, 0);

    if (forward) direction.z -= 1;
    if (backward) direction.z += 1;
    if (left) direction.x -= 1;
    if (right) direction.x += 1;

    // Normalize direction if moving diagonally
    if (direction.length() > 1) {
      direction.normalize();
    }

    // Calculate movement speed based on running state
    const movementSpeed = isRunning ? runSpeed : walkSpeed;

    // Apply gravity - increased for faster falling
    const gravity = 15; // Increased from 9.8
    velocity.y -= gravity * delta;

    // Update character position based on velocity
    modelRef.current.position.y += velocity.y * delta;

    // Floor collision - check if we've landed from a jump
    const wasInAir = modelRef.current.position.y > groundOffsetRef.current;

    if (modelRef.current.position.y < groundOffsetRef.current) {
      modelRef.current.position.y = groundOffsetRef.current;

      // Only reset jump state if we were falling
      if (velocity.y < 0) {
        velocity.y = 0;
        movementRef.current.canJump = true;
        movementRef.current.jumping = false;

        // CRITICAL FIX: If we were in a jump animation and have landed, transition to appropriate animation
        if (isJumping) {
          // Calculate which animation to return to
          const returnAnimation =
            direction.length() > 0 ? (running ? "run" : "walk") : "idle";
          setAnimation(returnAnimation);
        }
      }
    }
    // Check if we're at the peak of the jump (velocity close to 0)
    else if (isJumping && Math.abs(velocity.y) < 0.5) {
      // We're at the peak of the jump - make sure animation is at the midpoint
      const jumpAction = actionsRef.current["jump"];
      if (jumpAction) {
        // Get the clip duration
        const clipDuration = jumpAction.getClip().duration;

        // If animation hasn't reached midpoint yet, adjust it
        if (jumpAction.time < clipDuration / 2) {
          // Set time to midpoint
          jumpAction.time = clipDuration / 2;
        }
      }
    }

    // CRITICAL FIX: Check for stuck jump animation
    // If we're in jump animation but on the ground and not jumping, force transition to appropriate animation
    if (
      isJumping &&
      modelRef.current.position.y <= groundOffsetRef.current &&
      !jumping
    ) {
      // Calculate which animation to return to
      const returnAnimation =
        direction.length() > 0 ? (running ? "run" : "walk") : "idle";

      console.log(
        `Fixing stuck jump animation, transitioning to ${returnAnimation}`
      );

      // Play return animation
      const returnAction = actionsRef.current[returnAnimation];
      if (returnAction) {
        // Stop jump animation
        const jumpAction = actionsRef.current["jump"];
        if (jumpAction) {
          jumpAction.stop();
        }

        // Play return animation immediately
        returnAction.reset();
        returnAction.play();
        currentAnimationRef.current = returnAnimation;
      }
    }

    // Apply camera rotation to direction
    if (cameraRef.current) {
      const cameraRotation = new THREE.Euler(
        0,
        cameraRef.current.rotation.y,
        0
      );
      direction.applyEuler(cameraRotation);
    }

    // Handle player rotation
    if (modelRef.current && cameraRef.current) {
      if (isMoving && direction.length() > 0) {
        // When moving, face the direction of movement
        // Calculate the target rotation based on movement direction
        const targetRotation = Math.atan2(direction.x, direction.z);

        // Apply rotation directly for responsive control
        modelRef.current.rotation.y = targetRotation;
      } else {
        // When not moving, face the direction of the camera
        // Get the camera's forward direction in world space
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(cameraRef.current.quaternion);

        // Project onto the horizontal plane
        forward.y = 0;
        forward.normalize();

        // Calculate rotation from the forward vector
        const targetRotation = Math.atan2(forward.x, forward.z);

        // Apply rotation directly
        modelRef.current.rotation.y = targetRotation;
      }
    }

    // Move character based on direction
    modelRef.current.position.x += direction.x * movementSpeed * delta;
    modelRef.current.position.z += direction.z * movementSpeed * delta;

    // Check for platform collisions
    checkPlatformCollisions(modelRef.current.position);

    // Check for all other collisions and resolve them
    resolveCollisions();

    // Check for coin collisions
    checkCoinCollisions();
  };

  // Update camera to follow character
  const updateCamera = () => {
    if (!modelRef.current || !cameraRef.current) return;

    // Get camera configuration from control panel
    const config = getConfig();

    // Set camera target to character position
    const targetPosition = modelRef.current.position.clone();

    // For gamepad controls, we'll use an optimized third-person shooter camera setup
    // This places the character lower in the view for better aiming
    if (gamepadConnectedRef.current) {
      // When using gamepad, modify the target position to look slightly above the player
      // This creates an "over the shoulder" view common in third-person shooters
      targetPosition.y += config.camera.gamepadCharacterOffset; // Use the configurable value
    }

    // Calculate camera position based on character position and mouse
    const cameraDistance = config.camera.distance; // Distance from character
    const cameraHeight = config.camera.height; // Height offset
    const cameraSmoothing = config.camera.smoothing; // Smoothing factor

    // Camera height adjustment for gamepad
    let effectiveCameraHeight = cameraHeight;
    if (gamepadConnectedRef.current) {
      // Lower camera height for gamepad aiming to position player lower in screen
      effectiveCameraHeight = cameraHeight * 0.7; // Reduce height by 30%

      // We also increase the vertical angle slightly to look more downward
      // This creates the "third-person shooter" camera angle
      mouseRef.current.y = Math.max(mouseRef.current.y, -0.1); // Ensure some downward angle
    }

    // Use mouse X position to determine camera angle around character
    const cameraRotationY = -mouseRef.current.x * Math.PI;

    // Calculate vertical angle (limited to prevent flipping)
    const verticalAngle =
      Math.max(-0.5, Math.min(0.5, -mouseRef.current.y)) * 0.5;

    // Calculate ideal camera position using spherical coordinates
    const idealX =
      targetPosition.x +
      Math.sin(cameraRotationY) * cameraDistance * Math.cos(verticalAngle);
    const idealZ =
      targetPosition.z +
      Math.cos(cameraRotationY) * cameraDistance * Math.cos(verticalAngle);
    const idealY =
      targetPosition.y +
      effectiveCameraHeight + // Use the adjusted height
      Math.sin(verticalAngle) * cameraDistance;

    // Apply smoothing to camera movement
    cameraRef.current.position.x +=
      (idealX - cameraRef.current.position.x) * cameraSmoothing;
    cameraRef.current.position.y +=
      (idealY - cameraRef.current.position.y) * cameraSmoothing;
    cameraRef.current.position.z +=
      (idealZ - cameraRef.current.position.z) * cameraSmoothing;

    // For gamepad, apply a slight shoulder offset for over-the-shoulder view
    if (gamepadConnectedRef.current) {
      // Add a slight horizontal offset for over-the-shoulder view
      // This offsets the camera slightly to the right for a better shooting view
      const shoulderOffset = config.camera.gamepadShoulderOffset; // Use the configurable value
      cameraRef.current.position.x +=
        Math.sin(cameraRotationY + Math.PI / 2) * shoulderOffset; // Perpendicular to look direction
      cameraRef.current.position.z +=
        Math.cos(cameraRotationY + Math.PI / 2) * shoulderOffset; // Perpendicular to look direction
    }

    // Look at target position
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

    // Store the current animation name for reference
    currentAnimationRef.current = name;

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
    // (except for jump, punch, and die which should always play)
    if (
      currentAction === nextAction &&
      name !== "jump" &&
      name !== "punch" &&
      name !== "die"
    ) {
      return;
    }

    console.log(
      `Switching animation from ${currentAnimName || "none"} to ${name}`
    );

    // Set up the next animation
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(1); // Set all animations to default speed

    // Special handling for one-time animations
    if (name === "jump" || name === "punch" || name === "die") {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
      nextAction.setEffectiveWeight(1);
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
      nextAction.clampWhenFinished = false;
      nextAction.setEffectiveWeight(1);
    }

    // Handle transition from current animation if it exists
    if (currentAction) {
      // Determine appropriate transition duration based on animation types
      let transitionDuration = 0.3; // Default transition duration

      // Quick transitions for jump, punch, and die
      if (name === "jump" || name === "punch" || name === "die") {
        transitionDuration = 0.1;
      }
      // Smoother transitions between walk and run
      else if (
        (currentAnimName === "walk" && name === "run") ||
        (currentAnimName === "run" && name === "walk")
      ) {
        transitionDuration = 0.5;
      }
      // Faster transition to idle
      else if (name === "idle") {
        transitionDuration = 0.2;
      }

      // Apply crossfade
      nextAction.crossFadeFrom(currentAction, transitionDuration, true);
    }

    // Play the animation
    nextAction.play();

    // For one-time animations, set up a callback to return to previous state
    if ((name === "jump" || name === "punch") && mixer) {
      const onFinished = (e: THREE.Event) => {
        // Only handle the event if it's from our action
        if ((e as any).action !== nextAction) return;

        // Remove the listener
        mixer.removeEventListener("finished", onFinished);

        // Determine which animation to return to
        let returnAnimation = "idle";

        // If we're moving, return to the appropriate movement animation
        if (movementRef.current.direction.length() > 0) {
          returnAnimation = movementRef.current.running ? "run" : "walk";
        }

        console.log(
          `${name} animation finished, returning to ${returnAnimation}`
        );

        // Don't call setAnimation directly to avoid recursion issues
        // Instead, play the return animation directly
        const returnAction = actions[returnAnimation];
        if (returnAction) {
          returnAction.reset();
          returnAction.enabled = true;
          returnAction.setEffectiveTimeScale(1);
          returnAction.setEffectiveWeight(1);
          returnAction.setLoop(THREE.LoopRepeat, Infinity);
          returnAction.crossFadeFrom(nextAction, 0.2, true);
          returnAction.play();

          // Update the current animation reference
          currentAnimationRef.current = returnAnimation;
        }
      };

      mixer.addEventListener("finished", onFinished);
    }

    // Get animation configuration from control panel
    const config = getConfig();
    const transitionSpeed = config.animation.transitionSpeed;

    // Use transition speed in animation blending if applicable
    // ... rest of the function ...
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

  // Function to handle server messages
  const handleServerMessage = (data: any) => {
    console.log("Received message:", data.type);

    switch (data.type) {
      case "init":
        console.log("Received init message:", data);
        const newPlayerId = data.data.id;
        console.log(`Server assigned player ID: ${newPlayerId}`);
        console.log(`Current playerIdRef: ${playerIdRef.current}`);
        console.log(`Current playerName: "${playerName}"`);

        // IMPORTANT: Store the player ID in local storage to persist across refreshes
        try {
          localStorage.setItem("playerIdRef", newPlayerId.toString());
          console.log(`Stored player ID ${newPlayerId} in local storage`);
        } catch (e) {
          console.warn("Could not store player ID in local storage:", e);
        }

        // Set the player ID
        playerIdRef.current = newPlayerId;
        console.log(`Updated playerIdRef to: ${playerIdRef.current}`);

        // Initialize the local player with a default name
        const localPlayerData = data.data.players.find(
          (p: any) => p.id === newPlayerId
        );

        if (localPlayerData) {
          console.log("Found local player data:", localPlayerData);

          // Check if the server sent a name for this player
          if (localPlayerData.name) {
            console.log(`Server provided name: "${localPlayerData.name}"`);
          } else {
            console.log("Server did not provide a name for this player");
          }

          // Determine what name to use - prioritize the name entered by the player
          const nameToUse =
            playerName || localPlayerData.name || `Player ${newPlayerId}`;
          console.log(`Using name: "${nameToUse}" for local player`);

          const localPlayer: Player = {
            id: newPlayerId,
            position: new THREE.Vector3(
              localPlayerData.position.x,
              localPlayerData.position.y,
              localPlayerData.position.z
            ),
            rotation: localPlayerData.rotation,
            animation: localPlayerData.animation,
            health: localPlayerData.health || MAX_PLAYER_HEALTH,
            maxHealth: localPlayerData.maxHealth || MAX_PLAYER_HEALTH,
            kills: localPlayerData.kills || 0,
            deaths: localPlayerData.deaths || 0,
            name: nameToUse, // Use the determined name
          };

          console.log(`Creating local player with name: "${localPlayer.name}"`);
          playersRef.current.set(newPlayerId, localPlayer);

          // Log all players after adding the local player
          console.log(
            "Players after adding local player:",
            Array.from(playersRef.current.keys())
          );

          // Force update the player name in the map
          if (playerName) {
            console.log(`Forcing player name to "${playerName}" in the map`);
            const mapPlayer = playersRef.current.get(newPlayerId);
            if (mapPlayer) {
              mapPlayer.name = playerName;
            }
          }

          // If we already have a player name set but haven't sent it to the server yet,
          // send it now
          if (
            playerName &&
            socketRef.current &&
            socketRef.current.readyState === WebSocket.OPEN
          ) {
            console.log(`Sending player name "${playerName}" to server`);
            socketRef.current.send(
              JSON.stringify({
                type: "updateName",
                data: {
                  id: newPlayerId,
                  name: playerName,
                },
              })
            );
          }

          // Force create the health bar with the correct name
          setTimeout(() => {
            const player = playersRef.current.get(newPlayerId);
            if (player && player.model) {
              console.log(
                `Creating health bar for local player with name: "${player.name}"`
              );
              createPlayerHealthBar(player);
            } else {
              console.log(
                `Cannot create health bar yet - player model not ready`
              );

              // Try again in a bit
              setTimeout(() => {
                const player = playersRef.current.get(newPlayerId);
                if (player && player.model) {
                  console.log(
                    `Second attempt: Creating health bar for local player with name: "${player.name}"`
                  );
                  createPlayerHealthBar(player);
                }
              }, 2000);
            }
          }, 1000); // Wait a second for the model to load
        } else {
          console.warn(`Local player data not found for ID: ${newPlayerId}`);
        }

        // Add other players
        data.data.players.forEach((player: any) => {
          if (player.id === newPlayerId || playersRef.current.has(player.id))
            return;

          const newPlayer: Player = {
            id: player.id,
            position: new THREE.Vector3(
              player.position.x,
              player.position.y,
              player.position.z
            ),
            rotation: player.rotation,
            animation: player.animation,
            health: player.health || MAX_PLAYER_HEALTH,
            maxHealth: player.maxHealth || MAX_PLAYER_HEALTH,
            kills: player.kills || 0,
            deaths: player.deaths || 0,
            name: player.name || `Player ${player.id}`, // Ensure name has a default
          };
          playersRef.current.set(player.id, newPlayer);
          createOtherPlayer(newPlayer);
        });
        break;

      case "nameUpdate":
        console.log("Name update received:", data);
        const updatedPlayerId = data.data.id;
        const updatedPlayerName = data.data.name;

        console.log(
          `Server updating player ${updatedPlayerId} name to "${updatedPlayerName}"`
        );

        // Check if this is for the local player
        if (updatedPlayerId === playerIdRef.current) {
          console.log(`This is a name update for the local player`);

          // Update the player object directly
          const localPlayer = playersRef.current.get(updatedPlayerId);
          if (localPlayer) {
            console.log(
              `Updating local player name from "${localPlayer.name}" to "${updatedPlayerName}"`
            );
            localPlayer.name = updatedPlayerName;

            // Update the health bar if it exists
            if (localPlayer.healthBar) {
              console.log(`Updating health bar with new name`);
              updatePlayerHealthBar(localPlayer);
            } else {
              console.log(`No health bar found, will update when created`);
            }

            // Update player stats if scoreboard is visible
            if (showScoreboard) {
              updatePlayerStats();
            }
          } else {
            console.warn(
              `Cannot update name: Local player ${updatedPlayerId} not found in playersRef`
            );
            console.log(
              "Current players:",
              Array.from(playersRef.current.keys())
            );
          }
        } else {
          // This is for another player
          console.log(`This is a name update for another player`);

          // Update the player object
          const otherPlayer = playersRef.current.get(updatedPlayerId);
          if (otherPlayer) {
            console.log(
              `Updating other player name from "${otherPlayer.name}" to "${updatedPlayerName}"`
            );
            otherPlayer.name = updatedPlayerName;

            // Update the health bar if it exists
            if (otherPlayer.healthBar) {
              updatePlayerHealthBar(otherPlayer);
            }

            // Update player stats if scoreboard is visible
            if (showScoreboard) {
              updatePlayerStats();
            }
          } else {
            console.warn(
              `Cannot update name: Other player ${updatedPlayerId} not found in playersRef`
            );
          }
        }
        break;

      case "playerJoined":
        console.log("Player joined:", data.data.id);

        if (
          playersRef.current.has(data.data.id) ||
          data.data.id === playerIdRef.current
        ) {
          break;
        }

        const newPlayer: Player = {
          id: data.data.id,
          position: new THREE.Vector3(
            data.data.position.x,
            data.data.position.y,
            data.data.position.z
          ),
          rotation: data.data.rotation,
          animation: data.data.animation,
          health: data.data.health || MAX_PLAYER_HEALTH,
          maxHealth: data.data.maxHealth || MAX_PLAYER_HEALTH,
          kills: data.data.kills || 0,
          deaths: data.data.deaths || 0,
          name: data.data.name || `Player ${data.data.id}`, // Ensure name has a default
        };
        playersRef.current.set(data.data.id, newPlayer);
        createOtherPlayer(newPlayer);
        break;

      case "playerUpdate":
        // Check if this message is about a player that doesn't exist in our map yet
        if (!playersRef.current.has(data.data.id)) {
          console.log(
            `Received update for unknown player ${data.data.id} - creating new player`
          );
          console.log("Player update data:", data.data);

          // Create a new player object
          const newPlayer: Player = {
            id: data.data.id,
            position: new THREE.Vector3(
              data.data.position.x,
              data.data.position.y,
              data.data.position.z
            ),
            rotation: data.data.rotation,
            animation: data.data.animation || "idle",
            health: data.data.health || MAX_PLAYER_HEALTH,
            maxHealth: data.data.maxHealth || MAX_PLAYER_HEALTH,
            kills: data.data.kills || 0,
            deaths: data.data.deaths || 0,
            name: data.data.name || `Player ${data.data.id}`,
          };

          // Add to the map
          playersRef.current.set(data.data.id, newPlayer);
          console.log(
            `Added new player ${data.data.id} to players map, name: ${newPlayer.name}`
          );
          console.log(
            "Current players:",
            Array.from(playersRef.current.keys())
          );

          // Create the player model
          createOtherPlayer(newPlayer);
        } else {
          // Normal update for existing player
          console.log(`Updating existing player ${data.data.id}`);
          console.log("Update data:", {
            position: data.data.position
              ? `(${data.data.position.x.toFixed(
                  2
                )}, ${data.data.position.y.toFixed(
                  2
                )}, ${data.data.position.z.toFixed(2)})`
              : "not provided",
            rotation:
              data.data.rotation !== undefined
                ? data.data.rotation.toFixed(2)
                : "not provided",
            animation: data.data.animation || "not provided",
            health:
              data.data.health !== undefined
                ? data.data.health
                : "not provided",
            name: data.data.name || "not provided",
          });
          updateOtherPlayer(data.data);
        }
        break;

      case "playerLeft":
        console.log(`Player ${data.data.id} left the game`);
        removeOtherPlayer(data.data.id);
        break;

      case "fireball":
        // Create a fireball from another player
        if (!sceneRef.current) return;

        console.log(`Received fireball from player ${data.data.playerId}`);

        // Create fireball mesh
        const geometry = new THREE.SphereGeometry(0.2, 16, 16);
        const material = new THREE.MeshStandardMaterial({
          color: 0xff4500,
          emissive: 0xff7700,
          emissiveIntensity: 2,
        });

        const fireball = new THREE.Mesh(geometry, material);

        // Set position from data
        const startPosition = new THREE.Vector3(
          data.data.position.x,
          data.data.position.y,
          data.data.position.z
        );
        fireball.position.copy(startPosition);

        // Store target point if available
        let targetPoint;
        let direction: THREE.Vector3;
        if (data.data.targetPoint) {
          targetPoint = new THREE.Vector3(
            data.data.targetPoint.x,
            data.data.targetPoint.y,
            data.data.targetPoint.z
          );
          fireball.userData.targetPoint = targetPoint;

          // Create a brief visual marker at the target point
          const targetMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 8, 8),
            new THREE.MeshBasicMaterial({
              color: 0xff0000,
              transparent: true,
              opacity: 0.5,
            })
          );
          targetMarker.position.copy(targetPoint);
          sceneRef.current.add(targetMarker);
          setTimeout(() => {
            sceneRef.current?.remove(targetMarker);
          }, 500);

          // Calculate direction from start to target for perfect aiming
          direction = new THREE.Vector3()
            .subVectors(targetPoint, startPosition)
            .normalize();

          // Store metadata for trajectory calculation
          fireball.userData.startPosition = startPosition.clone();
          fireball.userData.distanceToTarget =
            startPosition.distanceTo(targetPoint);
        } else {
          // Fallback to using the provided direction if no target point
          direction = new THREE.Vector3(
            data.data.direction.x,
            data.data.direction.y,
            data.data.direction.z
          ).normalize();
        }

        // Store direction in userData
        fireball.userData.direction = direction;
        fireball.userData.createdTime = performance.now() / 1000;
        fireball.userData.ownerId = data.data.playerId;
        fireball.userData.speed = 30; // Same speed as local fireballs

        // Add to scene and tracking array
        sceneRef.current.add(fireball);
        fireballsRef.current.push(fireball);

        // Add point light for glow effect
        const light = new THREE.PointLight(0xff5500, 1, 2);
        fireball.add(light);

        // Create burst effect at the starting position
        createBurstEffect(fireball.position.clone(), direction);
        break;

      case "playerKill":
        console.log(
          `Player ${data.data.killerId} killed player ${data.data.victimId}`
        );

        // Update killer stats
        const killerPlayer = playersRef.current.get(data.data.killerId);
        if (killerPlayer) {
          killerPlayer.kills = data.data.killerKills || 0;
          console.log(
            `Updated killer (${data.data.killerId}) kills to ${killerPlayer.kills}`
          );
        }

        // Update victim stats
        const victimPlayer = playersRef.current.get(data.data.victimId);
        if (victimPlayer) {
          victimPlayer.deaths = data.data.victimDeaths || 0;
          console.log(
            `Updated victim (${data.data.victimId}) deaths to ${victimPlayer.deaths}`
          );
        }

        // Update player stats for scoreboard
        if (playersRef.current) {
          // Create a new array with the updated stats
          const updatedStats = Array.from(playersRef.current.values()).map(
            (player) => ({
              id: player.id,
              kills: player.kills || 0,
              deaths: player.deaths || 0,
              name: player.name || `Player ${player.id}`,
            })
          );

          // Sort by kills (highest first)
          updatedStats.sort((a, b) => b.kills - a.kills);

          // Force update by creating a new array
          setPlayerStats([...updatedStats]);

          // Log the updated stats for debugging
          console.log("Updated player stats after kill:", updatedStats);
        }
        break;

      case "kill":
        // ... existing code ...
        // Update player stats for scoreboard if visible
        if (showScoreboard && playersRef.current) {
          // Create a new array with the updated stats
          const killStats = Array.from(playersRef.current.values()).map(
            (player) => ({
              id: player.id,
              kills: player.kills || 0,
              deaths: player.deaths || 0,
              name: player.name || `Player ${player.id}`,
            })
          );

          // Sort by kills (highest first)
          killStats.sort((a, b) => b.kills - a.kills);

          // Force update by creating a new array
          setPlayerStats([...killStats]);

          // Log the updated stats for debugging
          console.log("Updated player stats after kill:", killStats);
        }
        break;

      case "playerStats":
        // Update player stats with name property
        const playerStatsData = data.data.map((player: any) => ({
          id: player.id,
          kills: player.kills || 0,
          deaths: player.deaths || 0,
          name: player.name || `Player ${player.id}`,
        }));
        setPlayerStats(playerStatsData);
        break;

      case "playerList":
        // Update player list
        const playerList = data.data;
        console.log("Received player list:", playerList);

        // Create a new array with the updated stats
        const playerListStats = playerList.map((player: any) => ({
          id: player.id,
          kills: player.kills || 0,
          deaths: player.deaths || 0,
          name: player.name || `Player ${player.id}`,
        }));

        // Sort by kills (highest first)
        playerListStats.sort((a: any, b: any) => b.kills - a.kills);

        // Force update by creating a new array
        setPlayerStats([...playerListStats]);
        break;

      default:
        console.log("Unknown message type:", data.type);
    }
  };

  // Function to update an other player's position and animation
  const updateOtherPlayer = (data: any) => {
    console.log("Updating other player:", data);

    // Check if this is the local player - if so, don't update
    if (data.id === playerIdRef.current) {
      console.log("Ignoring update for local player");
      return;
    }

    // Debug: Check if player exists
    if (!playersRef.current.has(data.id)) {
      console.warn(
        `Cannot update player ${data.id} - not found in players map`
      );
      console.log("Current players:", Array.from(playersRef.current.keys()));

      // Create the player if it doesn't exist
      console.log("Creating new player for ID:", data.id);
      const newPlayer: Player = {
        id: data.id,
        position: new THREE.Vector3(
          data.position.x,
          data.position.y,
          data.position.z
        ),
        rotation: data.rotation,
        animation: data.animation,
        health: data.health || MAX_PLAYER_HEALTH,
        maxHealth: data.maxHealth || MAX_PLAYER_HEALTH,
        kills: data.kills || 0,
        deaths: data.deaths || 0,
        name: data.name || `Player ${data.id}`, // Use the name from the update if available
      };

      playersRef.current.set(data.id, newPlayer);
      createOtherPlayer(newPlayer);
      return;
    }

    // Update the player
    const player = playersRef.current.get(data.id);
    if (!player) return;

    // Update position, rotation, animation
    if (data.position) {
      if (player.model) {
        // Smoothly move toward the target position
        const targetPosition = new THREE.Vector3(
          data.position.x,
          data.position.y,
          data.position.z
        );

        // Simple lerp for smoother updates
        const lerpFactor = 0.3; // Adjust this for smoother or faster updates
        player.model.position.lerp(targetPosition, lerpFactor);

        // Also update the player's stored position
        player.position = new THREE.Vector3(
          data.position.x,
          data.position.y,
          data.position.z
        );
      } else {
        // If no model yet, just update the stored position
        player.position = new THREE.Vector3(
          data.position.x,
          data.position.y,
          data.position.z
        );
      }
    }

    if (data.rotation !== undefined && player.model) {
      player.rotation = data.rotation;
      player.model.rotation.y = data.rotation;
    }

    // Update health if provided
    if (data.health !== undefined) {
      // Store old health for reference
      const oldHealth = player.health;

      // Log every health update attempt, even if the health hasn't changed
      console.log(
        `Health update for player ${data.id}: Server=${
          data.health
        }, Client=${oldHealth}, Changed=${oldHealth !== data.health}`
      );

      // IMPORTANT: Server is the source of truth for health
      player.health = data.health;

      // Always update the health bar display to ensure it reflects the current health
      if (player.healthBar) {
        console.log(
          `Updating health bar for player ${data.id} to ${data.health}/${player.maxHealth}`
        );

        // Force immediate update of health bar without animations to ensure it's correct
        if (player.healthBarForeground) {
          // Update the width directly based on current health
          const healthRatio = Math.max(0, player.health / player.maxHealth);
          player.healthBarForeground.style.width = `${healthRatio * 100}%`;

          // Change color based on health level
          if (healthRatio < 0.3) {
            player.healthBarForeground.style.backgroundColor = "#ff0000"; // Red when low health
          } else if (healthRatio < 0.6) {
            player.healthBarForeground.style.backgroundColor = "#ffaa00"; // Orange when medium health
          } else {
            player.healthBarForeground.style.backgroundColor = "#00ff00"; // Green when high health
          }
        }
      } else {
        console.warn(`Player ${data.id} has no health bar to update!`);
        // Try to create the health bar if it doesn't exist
        createPlayerHealthBar(player);
      }

      // If health is zero, handle defeat
      if (data.health <= 0 && oldHealth > 0) {
        console.log(`Player ${data.id} health is zero, handling defeat`);
        handlePlayerDefeat(player);
      }
    }

    // Update kills if it changed
    if (data.kills !== undefined && data.kills !== player.kills) {
      player.kills = data.kills;
      console.log(
        `Player ${data.id} kills updated: ${player.kills} -> ${data.kills}`
      );
    }

    // Update deaths if it changed
    if (data.deaths !== undefined && data.deaths !== player.deaths) {
      player.deaths = data.deaths;
      console.log(
        `Player ${data.id} deaths updated: ${player.deaths} -> ${data.deaths}`
      );
    }

    // Update name if it's provided and different
    if (data.name && data.name !== player.name) {
      console.log(
        `Player ${data.id} name updated: "${player.name}" -> "${data.name}"`
      );
      player.name = data.name;

      // Update the health bar to show the new name
      if (player.healthBar) {
        updatePlayerHealthBar(player);
      }
    }

    // Update animation if it changed
    if (data.animation && data.animation !== player.animation) {
      // Don't change animation if player is in a jump
      if (
        player.animation === "jump" &&
        player.jumpStartTime &&
        performance.now() - player.jumpStartTime < 1000
      ) {
        console.log("Not interrupting jump animation");
        return;
      }

      // Update the animation
      player.animation = data.animation;

      // Set animation on the player model
      if (player.mixer && player.actions && player.actions[data.animation]) {
        console.log(`Setting ${player.id}'s animation to ${data.animation}`);
        // Stop all current animations
        Object.values(player.actions).forEach((action) => {
          action.stop();
        });
        // Play the new animation
        player.actions[data.animation].reset().play();
      } else {
        console.log(
          `Can't set animation ${data.animation} for player ${player.id} - not available`
        );
      }
    }

    // Update player stats if scoreboard is visible
    if (showScoreboard && playersRef.current) {
      // Create a new array with the updated stats
      const updatedStats = Array.from(playersRef.current.values()).map((p) => ({
        id: p.id,
        kills: p.kills || 0,
        deaths: p.deaths || 0,
        name: p.name || `Player ${p.id}`,
      }));

      // Sort by kills (highest first)
      updatedStats.sort((a, b) => b.kills - a.kills);

      // Force update by creating a new array
      setPlayerStats([...updatedStats]);
    }
  };

  // Function to remove a player when they leave
  const removeOtherPlayer = (playerId: number) => {
    const player = playersRef.current.get(playerId);
    if (player && player.model && sceneRef.current) {
      sceneRef.current.remove(player.model);
      playersRef.current.delete(playerId);
    }
  };

  // Function to send position updates to the server
  const sendPositionUpdate = () => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!modelRef.current || playerIdRef.current === null) {
      return;
    }

    const position = modelRef.current.position;
    const rotation = modelRef.current.rotation.y;
    const animation = currentAnimationRef.current;

    // Get the local player's info from the map for additional data
    const localPlayer = playersRef.current.get(playerIdRef.current);

    // IMPORTANT: Don't send health updates in position updates - server should be source of truth
    // Only send position, rotation, animation and player identity info
    const updateData = {
      type: "position", // Using "position" type instead of "playerUpdate" for movement updates
      data: {
        id: playerIdRef.current,
        position: {
          x: position.x,
          y: position.y,
          z: position.z,
        },
        rotation: rotation,
        animation: animation,
        // Include minimum identity data, but NOT health
        name: localPlayer
          ? localPlayer.name
          : playerName || `Player ${playerIdRef.current}`,
      },
    };

    socketRef.current.send(JSON.stringify(updateData));
  };

  // Function to create other player models
  const createOtherPlayer = (player: Player) => {
    console.log(`Creating other player model for player ${player.id}`);

    // CRITICAL: Check if this player should be the local player
    if (playerIdRef.current === null) {
      // If we don't have a player ID yet, assume this is the local player
      console.log(
        `No player ID set yet, assuming ${player.id} is the local player`
      );
      playerIdRef.current = player.id;
    } else if (
      !playersRef.current.has(playerIdRef.current) &&
      playersRef.current.size === 1
    ) {
      // If our player ID doesn't exist in the map but there's only one player, assume that's us
      console.log(
        `Player ID ${playerIdRef.current} not found in map, but only one player exists with ID ${player.id}`
      );
      console.log(
        `Updating playerIdRef from ${playerIdRef.current} to ${player.id}`
      );
      playerIdRef.current = player.id;
    }

    // Check if this is actually the local player
    if (player.id === playerIdRef.current) {
      console.log(`This is the local player with ID ${player.id}`);

      // If we have a name set, use it
      if (playerName) {
        console.log(`Setting local player name to "${playerName}"`);
        player.name = playerName;

        // Send name update to server
        if (
          socketRef.current &&
          socketRef.current.readyState === WebSocket.OPEN
        ) {
          console.log(`Sending name update to server: "${playerName}"`);
          socketRef.current.send(
            JSON.stringify({
              type: "updateName",
              data: {
                id: player.id,
                name: playerName,
              },
            })
          );
        }
      }
    }

    // If the player already has a model, remove it
    if (player.model) {
      console.log(`Removing existing model for player ${player.id}`);
      if (sceneRef.current) {
        sceneRef.current.remove(player.model);
      }
    }

    // Load the character model
    const loader = new GLTFLoader();
    const modelUrl = `${window.location.origin}/model_idle.gltf`;

    console.log(`Loading other player model from: ${modelUrl}`);

    loader.load(
      modelUrl,
      (gltf) => {
        console.log(`Model loaded successfully for player ${player.id}`);
        const model = gltf.scene;

        // No material modifications whatsoever - use materials exactly as they are in the model
        // Do not clone, modify colors, or add userData

        // Scale and position the model
        model.scale.set(0.02, 0.02, 0.02);
        model.position.copy(player.position);
        model.rotation.y = player.rotation;

        // Add to scene
        sceneRef.current?.add(model);
        player.model = model;

        // Create animations mixer
        console.log(`Creating animation mixer for player ${player.id}`);
        const mixer = new THREE.AnimationMixer(model);
        player.mixer = mixer;
        player.actions = {};

        // Load animations
        loadPlayerAnimations(player).then(() => {
          // Start with the current animation or idle
          if (player.actions) {
            const initialAnimation = player.animation || "idle";
            console.log(
              `Starting initial animation ${initialAnimation} for player ${player.id}`
            );
            const action = player.actions[initialAnimation];
            if (action) {
              action.reset().play();
            }
          }
        });

        // Create health bar for player
        console.log(`Creating health bar for player ${player.id}`);
        createPlayerHealthBar(player);
      },
      (progress) => {
        console.log(
          `Loading model for player ${player.id}: ${Math.round(
            (progress.loaded / progress.total) * 100
          )}%`
        );
      },
      (error) => {
        console.error(`Error loading model for player ${player.id}:`, error);
      }
    );
  };

  // Update loadPlayerAnimations to return a Promise
  const loadPlayerAnimations = async (player: Player): Promise<void> => {
    if (!player.model || !player.mixer) return;

    const animationFiles = [
      { url: "/model_idle.gltf", name: "idle" },
      { url: "/model_walk.gltf", name: "walk" },
      { url: "/model_run.gltf", name: "run" },
      { url: "/model_jump.gltf", name: "jump" },
      { url: "/model_punch_right.gltf", name: "punch" },
      { url: "/model_die.gltf", name: "die" },
    ];

    const loader = new GLTFLoader();

    try {
      await Promise.all(
        animationFiles.map(async ({ url, name }) => {
          const fullUrl = `${window.location.origin}${url}`;
          console.log(
            `Loading animation ${name} from ${fullUrl} for player ${player.id}`
          );

          return new Promise<void>((resolve, reject) => {
            loader.load(
              fullUrl,
              (gltf) => {
                const clip = gltf.animations[0];
                if (clip && player.mixer && player.actions) {
                  const action = player.mixer.clipAction(clip);

                  // Configure action settings based on animation type
                  if (name === "jump") {
                    // Configure jump animation for physics synchronization
                    action.setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true;

                    // For other players, use a standard time scale that looks good
                    // We can't sync with their physics directly
                    action.setEffectiveTimeScale(0.8); // Slower to match typical jump duration

                    // CRITICAL FIX: Make sure the animation completes properly
                    action.setDuration(clip.duration); // Use original duration

                    // Ensure animation starts and ends cleanly
                    action.zeroSlopeAtStart = false; // Start animation immediately
                    action.zeroSlopeAtEnd = true; // Smooth end

                    // Disable automatic crossfade for jump animation
                    action.fadeIn(0);
                    action.fadeOut(0.1); // Very short fade out
                  } else if (name === "punch" || name === "die") {
                    // Configure other one-time animations
                    action.setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true;
                  } else {
                    // Configure looping animations (idle, walk, run)
                    action.setLoop(THREE.LoopRepeat, Infinity);
                    action.clampWhenFinished = false;
                  }

                  player.actions[name] = action;
                  console.log(
                    `Loaded animation ${name} for player ${player.id}`
                  );
                }
                resolve();
              },
              undefined,
              (error) => {
                console.error(
                  `Error loading ${name} animation for player ${player.id}:`,
                  error
                );
                reject(error);
              }
            );
          });
        })
      );

      // Add a mixer event listener to detect when animations finish
      if (player.mixer) {
        player.mixer.addEventListener("finished", (e: any) => {
          const action = e.action;

          // Check if player has actions and if it's the jump animation that finished
          if (player.actions && action === player.actions["jump"]) {
            console.log(
              `Jump animation finished via mixer event for player ${player.id}`
            );

            // Determine which animation to return to based on player state
            let returnAnimation = "idle";

            // If player is moving, use appropriate movement animation
            if (
              player.position.distanceTo(
                player.model?.position || new THREE.Vector3()
              ) > 0.1
            ) {
              // Assume running if moving (server should send correct animation)
              returnAnimation = "run";
            }

            const returnAction = player.actions[returnAnimation];
            if (returnAction) {
              returnAction.reset().play();
            }
          }
        });
      }

      console.log(`All animations loaded for player ${player.id}`);
    } catch (error) {
      console.error(`Error loading animations for player ${player.id}:`, error);
    }
  };

  // Function to create health bar for a player
  const createPlayerHealthBar = (player: Player) => {
    console.log(`Creating health bar for player ${player.id}`);
    if (!player.model) {
      console.warn(
        `Cannot create health bar - model not ready for player ${player.id}`
      );
      return;
    }

    // If this is the local player and we have a name set, make sure it's applied
    if (
      player.id === playerIdRef.current &&
      playerName &&
      player.name !== playerName
    ) {
      console.log(
        `[createPlayerHealthBar] Local player name mismatch: "${player.name}" vs "${playerName}"`
      );
      player.name = playerName;

      // Also update the player in the map
      if (playersRef.current.has(player.id)) {
        const mapPlayer = playersRef.current.get(player.id);
        if (mapPlayer && mapPlayer.name !== playerName) {
          console.log(
            `[createPlayerHealthBar] Updating player in map: "${mapPlayer.name}" -> "${playerName}"`
          );
          mapPlayer.name = playerName;
        }
      }
    }

    // Remove existing health bar if it exists
    if (player.healthBar && document.body.contains(player.healthBar)) {
      document.body.removeChild(player.healthBar);
    }

    // Create container div for health bar
    const healthBarContainer = document.createElement("div");
    healthBarContainer.style.cssText = `
      position: fixed;
      width: ${HEALTH_BAR_WIDTH}px;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 1000;
      display: flex;
      visibility: visible;
      flex-direction: column;
      align-items: center;
    `;

    // Create player name label
    const nameLabel = document.createElement("div");

    // IMPORTANT: Get the player name directly from the player object
    // This ensures we're using the most up-to-date name
    const currentPlayer = playersRef.current.get(player.id);
    const playerNameFromRef = currentPlayer ? currentPlayer.name : null;

    // Use the player's name if available, otherwise use "Player X"
    const displayName =
      playerNameFromRef || player.name || `Player ${player.id}`;
    console.log(
      `Setting health bar name label to: ${displayName} for player ${player.id}`
    );

    // Set the name label to just show the player name (no debug info)
    nameLabel.textContent = displayName;

    nameLabel.style.cssText = `
      color: white;
      font-size: 14px;
      margin-bottom: 3px;
      text-shadow: 1px 1px 2px black;
      white-space: nowrap;
      font-weight: bold;
    `;

    // Create health bar div
    const healthBarDiv = document.createElement("div");
    healthBarDiv.style.cssText = `
      width: 100%;
      height: ${HEALTH_BAR_HEIGHT}px;
      border: 1px solid white;
      background: rgba(102, 0, 0, 0.8);
      position: relative;
      overflow: hidden;
      border-radius: 3px;
      box-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
    `;

    // Create foreground (health) div
    const healthBarForeground = document.createElement("div");
    healthBarForeground.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: #00ff00;
      width: ${(player.health / player.maxHealth) * 100}%;
      transition: width 0.2s ease-out;
    `;

    healthBarDiv.appendChild(healthBarForeground);
    healthBarContainer.appendChild(nameLabel);
    healthBarContainer.appendChild(healthBarDiv);
    document.body.appendChild(healthBarContainer);

    // Store references to DOM elements
    player.healthBar = healthBarContainer;
    player.healthBarForeground = healthBarForeground;

    // Update the position immediately
    updateHealthBarPosition(player);
  };

  // Function to update health bar position
  const updateHealthBarPosition = (player: Player) => {
    if (
      !player.model ||
      !player.healthBar ||
      !cameraRef.current ||
      !rendererRef.current
    ) {
      return;
    }

    // Get the position of the player's model in world space
    const position = new THREE.Vector3();
    // Position the health bar above the player's head
    player.model.getWorldPosition(position);
    position.y += 1.8; // Adjust this value to position the health bar above the player's head

    // Project the 3D position to 2D screen space
    const screenPosition = position.clone();
    screenPosition.project(cameraRef.current);

    // Convert to CSS coordinates
    const x =
      ((screenPosition.x + 1) / 2) * rendererRef.current.domElement.clientWidth;
    const y =
      ((1 - screenPosition.y) / 2) *
      rendererRef.current.domElement.clientHeight;

    // Only show the health bar if the player is in front of the camera
    // Use display property to show/hide based on camera position
    player.healthBar.style.display = screenPosition.z > 1 ? "none" : "block";

    // Update the position of the health bar
    player.healthBar.style.left = `${x}px`;
    player.healthBar.style.top = `${y}px`;
  };

  // Function to update player health bar
  const updatePlayerHealthBar = (player: Player) => {
    console.log(
      `Updating health bar for player ${player.id}, health=${player.health}/${player.maxHealth}`
    );

    if (!player.healthBar || !player.healthBarForeground) {
      console.warn(`No health bar for player ${player.id}, creating one`);
      createPlayerHealthBar(player);
      return;
    }

    // If this is the local player and we have a name set, make sure it's applied
    if (
      player.id === playerIdRef.current &&
      playerName &&
      player.name !== playerName
    ) {
      console.log(
        `[updatePlayerHealthBar] Local player name mismatch: "${player.name}" vs "${playerName}"`
      );
      player.name = playerName;
    }

    // Update the health bar width based on current health
    const healthRatio = Math.max(0, player.health / player.maxHealth);
    console.log(
      `Setting health bar width for player ${player.id} to ${
        healthRatio * 100
      }%`
    );

    // Directly update the DOM element
    player.healthBarForeground.style.width = `${healthRatio * 100}%`;

    // For debugging: force a redraw
    const currentDisplay = player.healthBarForeground.style.display;
    player.healthBarForeground.style.display = "none";
    void player.healthBarForeground.offsetHeight; // Force a reflow
    player.healthBarForeground.style.display = currentDisplay;

    // Change color based on health level
    if (healthRatio < 0.3) {
      player.healthBarForeground.style.background = "#ff0000"; // Red when low health
    } else if (healthRatio < 0.6) {
      player.healthBarForeground.style.background = "#ffff00"; // Yellow when medium health
    } else {
      player.healthBarForeground.style.background = "#00ff00"; // Green when high health
    }

    // Update player name if it changed
    if (player.healthBar.firstChild instanceof HTMLDivElement) {
      const nameLabel = player.healthBar.firstChild;

      // IMPORTANT: Get the player name directly from the player object in the map
      // This ensures we're using the most up-to-date name
      const currentPlayer = playersRef.current.get(player.id);
      const playerNameFromRef = currentPlayer ? currentPlayer.name : null;

      // Use the player's name if available, otherwise use "Player X"
      const displayName =
        playerNameFromRef || player.name || `Player ${player.id}`;

      // Add debug info to the displayed name
      const debugName = `${displayName} [ID:${player.id}, Raw:${
        playerNameFromRef || player.name
      }]`;

      // Only update if the name has changed
      if (nameLabel.textContent !== debugName) {
        console.log(
          `Updating health bar name from ${nameLabel.textContent} to ${debugName} for player ${player.id}`
        );
        nameLabel.textContent = displayName;
      }
    }
  };

  // Function to handle player defeat
  const handlePlayerDefeat = (player: Player) => {
    if (!player.model || !sceneRef.current) return;

    console.log(`Player ${player.id} DEFEATED! Playing death animation...`);

    // Increment deaths counter
    player.deaths = (player.deaths || 0) + 1;

    // Update player stats for scoreboard if visible
    if (showScoreboard && playersRef.current) {
      // Create a new array with the updated stats
      const updatedStats = Array.from(playersRef.current.values()).map((p) => ({
        id: p.id,
        kills: p.kills || 0,
        deaths: p.deaths || 0,
        name: p.name || `Player ${p.id}`,
      }));

      // Sort by kills (highest first)
      updatedStats.sort((a, b) => b.kills - a.kills);

      // Force update by creating a new array
      setPlayerStats([...updatedStats]);

      // Log the updated stats for debugging
      console.log("Player stats updated after defeat:", updatedStats);
    }

    // Hide health bar
    if (player.healthBar) {
      player.healthBar.style.visibility = "hidden";
    }

    // Stop any current animations
    if (player.mixer && player.actions) {
      Object.values(player.actions).forEach((action) => {
        action.stop();
      });

      // Play the death animation if available
      if (player.actions["die"]) {
        const dieAction = player.actions["die"];
        dieAction.reset();
        dieAction.setLoop(THREE.LoopOnce, 1);
        dieAction.clampWhenFinished = true;
        dieAction.play();

        // Listen for animation completion
        const onAnimationFinished = (e: any) => {
          if (player.mixer) {
            player.mixer.removeEventListener("finished", onAnimationFinished);
          }
          console.log(`Death animation completed for player ${player.id}`);

          // Check if this is the local player
          if (player.id === playerIdRef.current) {
            // Show respawn menu for local player
            setIsRespawning(true);
          }
        };

        if (player.mixer) {
          player.mixer.addEventListener("finished", onAnimationFinished);
        }
      } else {
        console.warn(`No death animation available for player ${player.id}`);

        // If no death animation, still show respawn menu for local player
        if (player.id === playerIdRef.current) {
          setIsRespawning(true);
        }
      }
    }

    // Add a dramatic red flash to the scene
    const flashGeometry = new THREE.SphereGeometry(2, 16, 16);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.3,
    });

    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(player.model.position);
    sceneRef.current.add(flash);

    // Animate the flash
    const flashStartTime = performance.now();
    const flashDuration = 500;

    const animateFlash = () => {
      const now = performance.now();
      const elapsed = now - flashStartTime;
      const progress = Math.min(1, elapsed / flashDuration);

      if (progress < 1 && sceneRef.current && flash.parent) {
        // Expand and fade out
        flash.scale.setScalar(1 + progress * 2);
        flashMaterial.opacity = 0.3 * (1 - progress);
        requestAnimationFrame(animateFlash);
      } else if (sceneRef.current) {
        sceneRef.current.remove(flash);
      }
    };

    animateFlash();

    // Only respawn non-local players automatically
    // Local player will respawn through the menu
    if (player.id !== playerIdRef.current) {
      // Respawn player after 3 seconds
      setTimeout(() => {
        if (player.model) {
          // Reset health
          player.health = player.maxHealth;

          // Reset position to a random location
          player.model.position.set(
            Math.random() * 10 - 5,
            0,
            Math.random() * 10 - 5
          );

          // Reset rotation
          player.model.rotation.x = 0;

          // Show health bar again
          if (player.healthBar) {
            player.healthBar.style.visibility = "visible";
            updatePlayerHealthBar(player);
          }

          // Reset to idle animation
          if (player.actions && player.actions["idle"]) {
            player.actions["idle"].reset().play();
          }

          console.log(`Player ${player.id} respawned!`);
        }
      }, 3000);
    }
  };

  // Function to get the direction from the player to the cursor
  const getCursorDirection = (): THREE.Vector3 => {
    if (!cameraRef.current || !modelRef.current) {
      // Default forward direction if camera or model not available
      return new THREE.Vector3(0, 0, 1);
    }

    // Create a raycaster from the camera through the cursor position
    const raycaster = new THREE.Raycaster();

    // If gamepad is connected, aim directly forward from camera
    // This gives us a centered crosshair aim for gamepad controls
    if (gamepadConnectedRef.current) {
      // Use center of screen for gamepad aiming (simulates fixed crosshair)
      raycaster.setFromCamera(new THREE.Vector2(0, 0), cameraRef.current);

      // For gamepad, we'll make the shots more level to help with aiming
      // Since we've adjusted the camera to be higher, we need to compensate
      const direction = raycaster.ray.direction.clone();

      // With our over-the-shoulder view, we need to level out shots more
      // This makes it easier to hit targets at the center of the screen
      direction.y *= 0.2; // Further reduce vertical component for gamepad aiming
      direction.normalize();

      return direction;
    } else {
      // For mouse, use the actual cursor position
      raycaster.setFromCamera(
        new THREE.Vector2(mouseRef.current.x, mouseRef.current.y),
        cameraRef.current
      );

      // Calculate the direction vector
      const direction = raycaster.ray.direction.clone();

      // Maintain the horizontal direction but reduce vertical component
      direction.y *= 0.3; // Reduce vertical component to make shots more level
      direction.normalize();

      return direction;
    }
  };

  // Create a burst effect at the fireball's starting position
  const createBurstEffect = (
    position: THREE.Vector3,
    direction: THREE.Vector3
  ) => {
    if (!sceneRef.current) return;

    // Create a burst of particles
    const particleCount = 15;
    const colors = [0xffff00, 0xff7700, 0xff4500]; // Yellow to orange to red colors

    for (let i = 0; i < particleCount; i++) {
      // Create a small particle
      const particleGeometry = new THREE.SphereGeometry(0.05, 8, 8);
      const colorIndex = Math.floor(Math.random() * colors.length);
      const particleMaterial = new THREE.MeshBasicMaterial({
        color: colors[colorIndex],
        transparent: true,
        opacity: 0.8,
      });

      const particle = new THREE.Mesh(particleGeometry, particleMaterial);

      // Position slightly randomized around start position
      particle.position.copy(position);
      particle.position.x += (Math.random() - 0.5) * 0.2;
      particle.position.y += (Math.random() - 0.5) * 0.2;
      particle.position.z += (Math.random() - 0.5) * 0.2;

      // Add to scene
      sceneRef.current.add(particle);

      // Random velocity in mostly forward direction
      const randomDirection = direction.clone();
      randomDirection.x += (Math.random() - 0.5) * 0.5;
      randomDirection.y += (Math.random() - 0.5) * 0.5;
      randomDirection.z += (Math.random() - 0.5) * 0.5;
      randomDirection.normalize();

      // Store direction in userData
      particle.userData.direction = randomDirection;
      particle.userData.speed = Math.random() * 3 + 2;

      // Remove after a short time
      setTimeout(() => {
        // Fade out particle
        const fadeOut = () => {
          if (!particle.parent) return;

          if (particleMaterial.opacity > 0.1) {
            particleMaterial.opacity -= 0.05;
            requestAnimationFrame(fadeOut);
          } else {
            sceneRef.current?.remove(particle);
          }
        };

        fadeOut();
      }, Math.random() * 200); // Random delay up to 200ms
    }

    // Add a flash effect
    const flashGeometry = new THREE.SphereGeometry(0.3, 16, 16);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.7,
    });

    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(position);
    sceneRef.current.add(flash);

    // Expand and fade out flash
    const startTime = performance.now();
    const duration = 150;

    const animateFlash = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;

      if (progress < 1 && flash.parent) {
        flash.scale.set(1 + progress, 1 + progress, 1 + progress);
        flashMaterial.opacity = 0.7 * (1 - progress);
        requestAnimationFrame(animateFlash);
      } else {
        sceneRef.current?.remove(flash);
      }
    };

    animateFlash();
  };

  // Function to create and shoot a fireball directly to cursor position
  const fireFireball = () => {
    if (!modelRef.current || !sceneRef.current || !cameraRef.current) return;

    // Get configuration from control panel
    const config = getConfig();

    // Check cooldown using the control panel value
    const now = performance.now() / 1000; // Convert to seconds
    if (now - lastFireballTimeRef.current < config.fireball.cooldown) {
      return; // Still on cooldown
    }
    lastFireballTimeRef.current = now;

    // Try to play a punch animation if available
    if (actionsRef.current && actionsRef.current["punch"]) {
      // Get the current animation state name as a string
      const currentAnimName: string = currentAnimationRef.current;

      // Play the punch animation
      const punchAction = actionsRef.current["punch"];

      // Set it to play once
      punchAction
        .reset()
        .setLoop(THREE.LoopOnce, 1)
        .setEffectiveWeight(1.0)
        .play();

      // Return to previous animation after punch completes
      if (mixerRef.current) {
        const onFinished = () => {
          mixerRef.current?.removeEventListener("finished", onFinished);
          // Use the string animation name instead of the action object
          setAnimation(currentAnimName);
        };

        mixerRef.current.addEventListener("finished", onFinished);
      }
    }

    // Check if we're using gamepad controls
    const usingGamepad = gamepadConnectedRef.current;

    // Flash the crosshair when firing with gamepad for visual feedback
    if (usingGamepad) {
      const crosshair = document.querySelector("[data-crosshair]");
      if (crosshair instanceof HTMLElement) {
        // Create and apply a flash animation
        crosshair.style.transform = "translate(-50%, -50%) scale(1.5)";
        crosshair.style.filter = "brightness(2) drop-shadow(0 0 5px #ff3300)";

        // Reset after animation
        setTimeout(() => {
          if (crosshair) {
            crosshair.style.transform = "translate(-50%, -50%)";
            crosshair.style.filter = "";
          }
        }, 150);
      }
    }

    // IMPROVED AIMING: Use the camera's exact ray for perfect aiming
    const raycaster = new THREE.Raycaster();

    // If using gamepad, always fire at the center of the screen
    if (usingGamepad) {
      // With gamepad, we use a fixed crosshair in the center of the screen
      raycaster.setFromCamera(new THREE.Vector2(0, 0), cameraRef.current);
    } else {
      // With mouse, use the actual cursor position
      raycaster.setFromCamera(
        new THREE.Vector2(mouseRef.current.x, mouseRef.current.y),
        cameraRef.current
      );
    }

    // Find where the ray intersects with objects or extends into the distance
    let targetPoint = new THREE.Vector3();
    const intersects = raycaster.intersectObjects(
      collidableObjectsRef.current,
      true
    );

    if (intersects.length > 0) {
      // Ray hit something - use the intersection point
      targetPoint.copy(intersects[0].point);
    } else {
      // Ray didn't hit anything - extend the ray to a reasonable distance
      raycaster.ray.at(100, targetPoint);
    }

    // Starting position (from player's hands/waist level)
    const startPosition = modelRef.current.position.clone();
    startPosition.y += 0.8; // Adjust to hands/waist level

    // Calculate the exact direction from start position to target point
    // This ensures the fireball will always hit the target regardless of camera position
    const direction = new THREE.Vector3()
      .subVectors(targetPoint, startPosition)
      .normalize();

    // Create visual effects
    createBurstEffect(startPosition, direction);

    // Create fireball mesh with size from config
    const geometry = new THREE.SphereGeometry(config.fireball.size, 16, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff4500,
      emissive: 0xff2000,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.9,
    });

    const fireball = new THREE.Mesh(geometry, material);
    fireball.position.copy(startPosition);

    // Add a point light to the fireball
    const light = new THREE.PointLight(0xff4500, 1, 3);
    light.position.set(0, 0, 0);
    fireball.add(light);

    // Store direction and other metadata in userData
    fireball.userData.direction = direction;
    fireball.userData.createdTime = now;
    fireball.userData.ownerId = playerIdRef.current;
    fireball.userData.speed = config.fireball.speed;
    fireball.userData.targetPoint = targetPoint.clone(); // Store target point for precise aiming
    fireball.userData.startPosition = startPosition.clone(); // Store start position for trajectory calculation
    fireball.userData.distanceToTarget = startPosition.distanceTo(targetPoint); // Store distance to target

    // Add to scene and tracking array
    sceneRef.current.add(fireball);
    fireballsRef.current.push(fireball);

    // Send fireball data to server
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
            direction: {
              x: direction.x,
              y: direction.y,
              z: direction.z,
            },
            targetPoint: {
              x: targetPoint.x,
              y: targetPoint.y,
              z: targetPoint.z,
            },
            speed: config.fireball.speed,
            damage: config.fireball.damage,
          },
        })
      );
    }

    // ... rest of the function ...
  };

  // Function to update fireballs position and check collisions
  const updateFireballs = (delta: number) => {
    if (!sceneRef.current) return;

    // Get configuration from control panel
    const config = getConfig();

    // Update each fireball
    for (let i = fireballsRef.current.length - 1; i >= 0; i--) {
      const fireball = fireballsRef.current[i];
      const direction = fireball.userData.direction;

      // Use the speed from the fireball's userData, which is set from the config
      const speed = fireball.userData.speed;

      // Move fireball
      fireball.position.x += direction.x * speed * delta;
      fireball.position.y += direction.y * speed * delta;
      fireball.position.z += direction.z * speed * delta;

      // Rotate fireball for visual effect
      fireball.rotation.x += 5 * delta;
      fireball.rotation.z += 5 * delta;

      // Check if fireball has reached or passed its target point
      if (fireball.userData.targetPoint) {
        const distanceFromStart = fireball.userData.startPosition.distanceTo(
          fireball.position
        );

        if (distanceFromStart >= fireball.userData.distanceToTarget) {
          // Snap to exact target position
          fireball.position.copy(fireball.userData.targetPoint);

          // Create explosion effect at target
          createHitEffect(fireball.userData.targetPoint);
          createExplosionEffect(
            fireball.userData.targetPoint,
            config.fireball.explosionSize,
            0xffaa00
          );

          // Remove fireball
          if (sceneRef.current) {
            sceneRef.current.remove(fireball);
          }
          fireballsRef.current.splice(i, 1);
          continue;
        }
      }

      // Check for collisions with players
      let hitDetected = false;
      playersRef.current.forEach((player) => {
        if (
          hitDetected ||
          !player.model ||
          player.id === fireball.userData.ownerId || // Changed from !== to === (we don't want to hit ourselves)
          player.health <= 0
        ) {
          return;
        }

        // Simple sphere-based collision detection
        const playerPosition = player.model.position.clone();
        playerPosition.y += 1; // Adjust to center of player
        const distance = playerPosition.distanceTo(fireball.position);

        if (distance < 1) {
          // Hit detected
          hitDetected = true;
          console.log(`Player ${player.id} hit by fireball!`);

          // Create hit effect
          createHitEffect(fireball.position);
          createExplosionEffect(
            fireball.position,
            config.fireball.explosionSize,
            0xffaa00
          );

          // Apply damage to player
          const damage = config.fireball.damage || 0;
          player.health = Math.max(0, player.health - damage);

          console.log(
            `Player ${player.id} hit by fireball! Damage: ${damage}, New health: ${player.health}`
          );

          // Update player's health bar
          updatePlayerHealthBar(player);

          // Add hit effect to player
          addHitEffect(player);

          // Check if player is defeated
          if (player.health <= 0) {
            handlePlayerDefeat(player);
          }

          // Remove fireball
          if (sceneRef.current) {
            sceneRef.current.remove(fireball);
          }
          fireballsRef.current.splice(i, 1);

          // Send hit event to server
          if (
            socketRef.current &&
            socketRef.current.readyState === WebSocket.OPEN
          ) {
            socketRef.current.send(
              JSON.stringify({
                type: "directDamage",
                data: {
                  targetId: player.id,
                  damage: config.fireball.damage || 0,
                  newHealth: player.health,
                  position: {
                    x: fireball.position.x,
                    y: fireball.position.y,
                    z: fireball.position.z,
                  },
                },
              })
            );
          }
        }
      });

      // Skip the rest of the loop if a hit was detected
      if (hitDetected) {
        continue;
      }

      // Check for collisions with obstacles
      const obstacleCollision = checkObstacleCollisions(fireball.position);
      if (obstacleCollision) {
        // Create hit effect
        createHitEffect(fireball.position);
        createExplosionEffect(
          fireball.position,
          config.fireball.explosionSize,
          0xffaa00
        );

        // Remove fireball
        if (sceneRef.current) {
          sceneRef.current.remove(fireball);
        }
        fireballsRef.current.splice(i, 1);
        continue;
      }

      // Remove fireballs that have been alive too long (5 seconds)
      const age = performance.now() / 1000 - fireball.userData.createdTime;
      if (age > 5) {
        if (sceneRef.current) {
          sceneRef.current.remove(fireball);
        }
        fireballsRef.current.splice(i, 1);
      }
    }
  };

  // Create a small explosion effect
  const createExplosionEffect = (
    position: THREE.Vector3,
    size: number,
    color: number
  ) => {
    if (!sceneRef.current) return;

    // Create explosion sphere
    const explosionGeometry = new THREE.SphereGeometry(size, 16, 16);
    const explosionMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.7,
    });

    const explosion = new THREE.Mesh(explosionGeometry, explosionMaterial);
    explosion.position.copy(position);
    sceneRef.current.add(explosion);

    // Add light for glow effect
    const light = new THREE.PointLight(color, 2, size * 5);
    light.position.copy(position);
    sceneRef.current.add(light);

    // Animate explosion
    const startTime = performance.now();
    const duration = 300; // milliseconds

    const animateExplosion = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / duration);

      if (progress < 1) {
        // Expand and fade out
        explosion.scale.setScalar(1 + progress * 2);
        explosionMaterial.opacity = 0.7 * (1 - progress);
        light.intensity = 2 * (1 - progress);

        requestAnimationFrame(animateExplosion);
      } else {
        // Remove from scene
        sceneRef.current?.remove(explosion);
        sceneRef.current?.remove(light);
      }
    };

    animateExplosion();
  };

  // Add the main initialization useEffect
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
    renderer.shadowMap.enabled = true; // Enable shadows
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Use PCF soft shadows for better quality
    renderer.sortObjects = true; // Enable manual sorting
    renderer.autoClear = true;
    renderer.setClearColor(0x87ceeb, 1); // Sky blue background
    renderer.outputColorSpace = THREE.SRGBColorSpace; // Ensure proper color space
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Initialize the control panel
    controlPanelRef.current = initControlPanel();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Reduced intensity to make shadows more visible
    scene.add(ambientLight);

    // Directional light with shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 50, 50); // Position from above
    directionalLight.castShadow = true;

    // Configure shadow properties for performance
    directionalLight.shadow.mapSize.width = 1024; // Shadow map resolution
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 10;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.bias = -0.001; // Reduce shadow acne

    scene.add(directionalLight);

    // Add a hemisphere light for better ground illumination
    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.5); // Reduced intensity
    scene.add(hemisphereLight);

    // We'll skip creating the default ground plane here
    // since we'll create a textured one in createEnvironment

    // Add environment elements with textured ground
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
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current)
        return;

      requestAnimationFrame(animate);

      const delta = clockRef.current.getDelta();

      // Check for gamepad input
      handleGamepadInput();

      // Update cursor world position
      updateCursorWorldPosition();

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
        // Update health bar position
        updateHealthBarPosition(player);
      });

      // Send position update to server
      sendPositionUpdate();

      // Update camera to follow character
      updateCamera();

      // Render scene
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };

    animate();

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

        // If we already have a player name, send it to the server immediately
        if (playerName && playerIdRef.current) {
          console.log(
            `Sending player name "${playerName}" to server on connection`
          );
          socket.send(
            JSON.stringify({
              type: "updateName",
              data: {
                id: playerIdRef.current,
                name: playerName,
              },
            })
          );
        }
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
      if (event.button === 0) {
        fireFireball();
      }
    };

    window.addEventListener("click", handleMouseClick);

    // Set up position sync interval as backup
    const syncInterval = setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        sendPositionUpdate();
      }
    }, 50); // Send updates every 50ms as backup

    // Store the interval ID
    syncIntervalRef.current = syncInterval;

    // Cleanup function
    return () => {
      // ... existing cleanup code ...

      // Remove event listeners
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("click", handleMouseClick);

      // Dispose of resources
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }

      // Clear intervals
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }

      // Close WebSocket
      if (socketRef.current) {
        socketRef.current.close();
      }

      // Remove the control panel container if it exists
      const container = document.querySelector(".tp-dfwv");
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };
  }, []);

  // Add cursor position tracking for raycasting
  const cursorWorldPositionRef = useRef(new THREE.Vector3());

  // Function to update cursor world position based on mouse position
  const updateCursorWorldPosition = () => {
    if (!cameraRef.current) return;

    // Create a raycaster from the camera through the cursor
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(mouseRef.current.x, mouseRef.current.y),
      cameraRef.current
    );

    // First check if the ray hits any objects
    const intersects = raycaster.intersectObjects(
      collidableObjectsRef.current,
      true
    );

    if (intersects.length > 0) {
      // Ray hit something - use intersection point
      cursorWorldPositionRef.current.copy(intersects[0].point);
    } else {
      // Ray didn't hit anything - use a point far along the ray
      raycaster.ray.at(100, cursorWorldPositionRef.current);
    }
  };

  // Add useEffect for mouse movement tracking
  useEffect(() => {
    // Handle mouse movement to update normalized coordinates and pixel coordinates
    const handleMouseMove = (e: MouseEvent) => {
      // Update the mouseRef with normalized coordinates (-1 to 1)
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;

      // Also store pixel coordinates for other uses
      mouseRef.current.pixelX = e.clientX;
      mouseRef.current.pixelY = e.clientY;
    };

    // Add mouse movement listener
    window.addEventListener("mousemove", handleMouseMove);

    // Remove listener on cleanup
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  // Function to create hit effect particles at the impact position
  const createHitEffect = (position: THREE.Vector3) => {
    if (!sceneRef.current) return;

    // Create a small burst of particles
    const particleCount = 15;
    const particleGeometry = new THREE.SphereGeometry(0.05, 8, 8);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.8,
    });

    for (let i = 0; i < particleCount; i++) {
      const particle = new THREE.Mesh(
        particleGeometry,
        particleMaterial.clone()
      );
      particle.position.copy(position);

      // Random velocity
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        Math.random() * 3,
        (Math.random() - 0.5) * 3
      );

      // Add to scene
      sceneRef.current.add(particle);

      // Animate the particle
      const startTime = performance.now();
      const lifetime = Math.random() * 300 + 200; // 200-500ms lifetime

      const updateParticle = () => {
        const now = performance.now();
        const elapsed = now - startTime;

        if (elapsed > lifetime || !sceneRef.current || !particle.parent) {
          if (sceneRef.current && particle.parent) {
            sceneRef.current.remove(particle);
          }
          return;
        }

        // Move particle
        particle.position.add(velocity.clone().multiplyScalar(0.01));

        // Fade out
        const material = particle.material as THREE.MeshBasicMaterial;
        material.opacity = 0.8 * (1 - elapsed / lifetime);

        requestAnimationFrame(updateParticle);
      };

      updateParticle();
    }
  };

  // Function to add hit effect (red flash) to a player without modifying materials
  const addHitEffect = (player: Player) => {
    if (!player.model) return;

    // Create a red sphere that envelops the player model
    // Get the bounding box of the player model
    const bbox = new THREE.Box3().setFromObject(player.model);
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());

    // Create a slightly larger sphere
    const radius = Math.max(size.x, size.y, size.z) * 0.6;
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });

    const hitEffect = new THREE.Mesh(geometry, material);
    hitEffect.position.copy(center);
    sceneRef.current?.add(hitEffect);

    // Animate the hit effect
    const startTime = performance.now();
    const duration = 200; // same as the original timeout

    const animateHitEffect = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;

      if (progress < 1 && hitEffect.parent) {
        // Pulse the opacity
        material.opacity = 0.3 * (1 - progress);
        requestAnimationFrame(animateHitEffect);
      } else {
        // Remove when done
        sceneRef.current?.remove(hitEffect);
        geometry.dispose();
        material.dispose();
      }
    };

    animateHitEffect();
  };

  // Add state for scoreboard visibility
  const [showScoreboard, setShowScoreboard] = useState(false);

  useEffect(() => {
    // ... existing code ...

    // Add Tab key handler for scoreboard
    const handleKeyDownForScoreboard = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        event.preventDefault(); // Prevent default tab behavior

        // Update player stats when showing scoreboard
        if (playersRef.current) {
          // Create a new array with the updated stats
          const updatedStats = Array.from(playersRef.current.values()).map(
            (player) => ({
              id: player.id,
              kills: player.kills || 0,
              deaths: player.deaths || 0,
              name: player.name || `Player ${player.id}`,
            })
          );

          // Sort by kills (highest first)
          updatedStats.sort((a, b) => b.kills - a.kills);

          // Force update by creating a new array
          setPlayerStats([...updatedStats]);

          // Log the updated stats for debugging
          console.log("Tab key pressed, updated player stats:", updatedStats);
        }

        setShowScoreboard(true);
      }
    };

    const handleKeyUpForScoreboard = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setShowScoreboard(false);
      }
    };

    // Add event listeners for scoreboard
    window.addEventListener("keydown", handleKeyDownForScoreboard);
    window.addEventListener("keyup", handleKeyUpForScoreboard);

    // ... existing code ...

    // Cleanup function
    return () => {
      // ... existing code ...

      // Remove scoreboard event listeners
      window.removeEventListener("keydown", handleKeyDownForScoreboard);
      window.removeEventListener("keyup", handleKeyUpForScoreboard);

      // ... existing code ...
    };
  }, []);

  // Function to update player stats for the scoreboard
  const updatePlayerStats = () => {
    if (!playersRef.current) return;

    const stats: Array<{
      id: number;
      kills: number;
      deaths: number;
      name: string;
    }> = [];

    // Convert players map to array of stats objects
    playersRef.current.forEach((player) => {
      stats.push({
        id: player.id,
        kills: player.kills || 0,
        deaths: player.deaths || 0,
        name: player.name || `Player ${player.id}`,
      });
    });

    // Sort by kills (highest first)
    stats.sort((a, b) => b.kills - a.kills);

    setPlayerStats(stats);
  };

  // Render the scoreboard
  const renderScoreboard = () => {
    if (!showScoreboard) return null;

    // Log the current player stats for debugging
    console.log("Rendering scoreboard with stats:", playerStats);

    return (
      <div className="scoreboard">
        <div className="scoreboard-header">Scoreboard</div>
        <div className="scoreboard-content">
          <div className="scoreboard-row header">
            <div style={{ flex: 2 }}>Player</div>
            <div>Kills</div>
            <div>Deaths</div>
            <div>K/D</div>
          </div>
          {playerStats.length > 0 ? (
            playerStats.map((player) => {
              const kills = player.kills;
              const deaths = player.deaths;
              const kd =
                deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
              const isLocalPlayer = player.id === playerIdRef.current;
              const displayName = player.name || `Player ${player.id}`;

              return (
                <div
                  key={player.id}
                  className={`scoreboard-row ${
                    isLocalPlayer ? "local-player" : ""
                  }`}
                >
                  <div
                    style={{
                      flex: 2,
                      fontWeight: isLocalPlayer ? "bold" : "normal",
                      color: isLocalPlayer ? "#ffff00" : "white",
                    }}
                  >
                    {displayName}
                  </div>
                  <div>{kills}</div>
                  <div>{deaths}</div>
                  <div>{kd}</div>
                </div>
              );
            })
          ) : (
            <div className="scoreboard-row">
              <div style={{ textAlign: "center", width: "100%" }}>
                No players yet
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Add state for player stats
  const [playerStats, setPlayerStats] = useState<
    Array<{ id: number; kills: number; deaths: number; name: string }>
  >([]);

  // Function to update a player's name
  const updatePlayerName = (playerId: number, newName: string) => {
    console.log(`Attempting to update player ${playerId} name to "${newName}"`);

    // Check if the player exists in the map
    if (!playersRef.current.has(playerId)) {
      console.warn(
        `Cannot update name: Player ${playerId} not found in playersRef`
      );
      console.log("Current players:", Array.from(playersRef.current.keys()));
      return;
    }

    const player = playersRef.current.get(playerId);
    if (player) {
      const oldName = player.name || `Player ${playerId}`;
      player.name = newName;
      console.log(
        `Updated player ${playerId} name from "${oldName}" to "${newName}"`
      );
      console.log(`Player object after update:`, {
        id: player.id,
        name: player.name,
        health: player.health,
        hasHealthBar: !!player.healthBar,
      });

      // Update the health bar if it exists
      if (player.healthBar) {
        console.log(`Updating health bar for player ${playerId}`);
        updatePlayerHealthBar(player);
      } else {
        console.log(`No health bar found for player ${playerId}, creating one`);
        createPlayerHealthBar(player);
      }

      // Update player stats if scoreboard is visible
      if (showScoreboard) {
        updatePlayerStats();
      }
    }
  };

  // Add a useEffect to check if the player name is being properly set
  useEffect(() => {
    // This will run whenever playerName or playerIdRef.current changes
    console.log(`[useEffect] playerName changed to: "${playerName}"`);
    console.log(`[useEffect] Current playerIdRef: ${playerIdRef.current}`);
    console.log(
      `[useEffect] Current players in playersRef:`,
      Array.from(playersRef.current.keys())
    );

    // If we have a player name but no player ID yet, wait for the ID to be assigned
    if (playerName && !playerIdRef.current) {
      console.log(
        `[useEffect] Have player name but no ID yet, waiting for ID to be assigned`
      );
      return;
    }

    // If we have a player name and ID, check if the player exists
    if (playerName && playerIdRef.current) {
      console.log(
        `[useEffect] Have player name "${playerName}" and ID ${playerIdRef.current}`
      );

      // Check if the player exists in the map
      if (playersRef.current.has(playerIdRef.current)) {
        console.log(
          `[useEffect] Player ${playerIdRef.current} exists in playersRef`
        );
        const player = playersRef.current.get(playerIdRef.current);

        if (player) {
          console.log(`[useEffect] Current player object:`, {
            id: player.id,
            name: player.name,
            hasHealthBar: !!player.healthBar,
          });

          // If the player name doesn't match, update it
          if (player.name !== playerName) {
            console.log(
              `[useEffect] Fixing player name mismatch: "${player.name}" -> "${playerName}"`
            );

            // Directly set the name on the player object
            player.name = playerName;

            // Update the health bar if it exists
            if (player.healthBar) {
              console.log(`[useEffect] Updating health bar with new name`);
              updatePlayerHealthBar(player);
            }

            // Update player stats if scoreboard is visible
            if (showScoreboard) {
              updatePlayerStats();
            }

            // Send the name update to the server
            if (
              socketRef.current &&
              socketRef.current.readyState === WebSocket.OPEN
            ) {
              console.log(
                `[useEffect] Sending name update to server: "${playerName}"`
              );
              socketRef.current.send(
                JSON.stringify({
                  type: "updateName",
                  data: {
                    id: playerIdRef.current,
                    name: playerName,
                  },
                })
              );
            }
          } else {
            console.log(
              `[useEffect] Player name is already correct: "${player.name}"`
            );
          }
        }
      } else {
        console.log(
          `[useEffect] Player ${playerIdRef.current} not found in playersRef yet`
        );
        console.log(
          `[useEffect] Will apply name "${playerName}" when player is created`
        );

        // Set up a watcher to check when the player is created
        const checkInterval = setInterval(() => {
          console.log(
            `[checkInterval] Checking if player ${playerIdRef.current} has been created...`
          );
          console.log(
            `[checkInterval] Current players:`,
            Array.from(playersRef.current.keys())
          );

          if (
            playerIdRef.current &&
            playersRef.current.has(playerIdRef.current)
          ) {
            console.log(
              `[checkInterval] Player ${playerIdRef.current} has been created!`
            );
            clearInterval(checkInterval);

            // Apply the name
            const player = playersRef.current.get(playerIdRef.current);
            if (player) {
              console.log(
                `[checkInterval] Setting player name to "${playerName}"`
              );
              player.name = playerName;

              // Update the health bar if it exists
              if (player.healthBar) {
                console.log(
                  `[checkInterval] Updating health bar with new name`
                );
                updatePlayerHealthBar(player);
              }

              // Send the name update to the server
              if (
                socketRef.current &&
                socketRef.current.readyState === WebSocket.OPEN
              ) {
                console.log(
                  `[checkInterval] Sending name update to server: "${playerName}"`
                );
                socketRef.current.send(
                  JSON.stringify({
                    type: "updateName",
                    data: {
                      id: playerIdRef.current,
                      name: playerName,
                    },
                  })
                );
              }
            }
          }
        }, 500); // Check every 500ms

        // Clean up the interval when the component unmounts or when the dependencies change
        return () => {
          clearInterval(checkInterval);
        };
      }
    }
  }, [playerName, playerIdRef.current]);

  // Function to directly fix the player name if needed
  const fixPlayerName = () => {
    if (playerIdRef.current && playerName) {
      console.log(
        `[fixPlayerName] Checking if player ${playerIdRef.current} name needs to be fixed`
      );
      console.log(
        `[fixPlayerName] Current players:`,
        Array.from(playersRef.current.keys())
      );

      // Check if the player ID exists in the map
      if (playersRef.current.has(playerIdRef.current)) {
        // Normal case - player ID is in the map
        const player = playersRef.current.get(playerIdRef.current);
        if (player) {
          console.log(
            `[fixPlayerName] Current player name: "${player.name}", desired name: "${playerName}"`
          );

          // Always update the name
          console.log(
            `[fixPlayerName] Fixing player name from "${player.name}" to "${playerName}"`
          );
          player.name = playerName;

          // Rest of code...
        }
      } else {
        // Player ID not found in map - this is the key issue!
        console.log(
          `[fixPlayerName] Player ${playerIdRef.current} not found in playersRef`
        );

        // CRITICAL: If there's only one player in the map, assume it's the local player
        // This handles the case where the player ID is wrong but there's only one player
        if (playersRef.current.size === 1) {
          const onlyPlayerId = Array.from(playersRef.current.keys())[0];
          console.log(
            `[fixPlayerName] Only one player in map with ID ${onlyPlayerId} - assuming this is the local player`
          );

          // Update playerIdRef to match the actual player ID
          const oldId = playerIdRef.current;
          playerIdRef.current = onlyPlayerId;
          console.log(
            `[fixPlayerName] Updated playerIdRef from ${oldId} to ${playerIdRef.current}`
          );

          // Now fix the name
          const player = playersRef.current.get(onlyPlayerId);
          if (player) {
            console.log(
              `[fixPlayerName] Current player name: "${player.name}", desired name: "${playerName}"`
            );

            // Always update the name
            console.log(
              `[fixPlayerName] Fixing player name from "${player.name}" to "${playerName}"`
            );
            player.name = playerName;

            // Update the health bar if it exists
            if (player.healthBar) {
              console.log(`[fixPlayerName] Updating health bar with new name`);
              updatePlayerHealthBar(player);
            } else {
              console.log(`[fixPlayerName] No health bar found, creating one`);
              // Try to create a health bar if the model exists
              if (player.model) {
                createPlayerHealthBar(player);
              } else {
                console.log(
                  `[fixPlayerName] Cannot create health bar - model not ready`
                );
              }
            }

            // Send the name update to the server
            if (
              socketRef.current &&
              socketRef.current.readyState === WebSocket.OPEN
            ) {
              console.log(
                `[fixPlayerName] Sending name update to server: "${playerName}"`
              );
              socketRef.current.send(
                JSON.stringify({
                  type: "updateName",
                  data: {
                    id: onlyPlayerId, // Use the correct ID
                    name: playerName,
                  },
                })
              );
            } else {
              console.warn(
                `[fixPlayerName] WebSocket not ready, cannot send name update`
              );
            }

            // Update player stats if scoreboard is visible
            if (showScoreboard) {
              updatePlayerStats();
            }

            return true; // Name was fixed
          }
        } else {
          // More than one player or no players
          console.log(
            `[fixPlayerName] Multiple players in map, can't determine which is local player`
          );
          console.log(`[fixPlayerName] Sending name update to server anyway`);

          // Send the name update to the server anyway
          if (
            socketRef.current &&
            socketRef.current.readyState === WebSocket.OPEN
          ) {
            console.log(
              `[fixPlayerName] Sending name update to server: "${playerName}"`
            );
            socketRef.current.send(
              JSON.stringify({
                type: "updateName",
                data: {
                  id: playerIdRef.current,
                  name: playerName,
                },
              })
            );
            return true; // Message was sent
          } else {
            console.warn(
              `[fixPlayerName] WebSocket not ready, cannot send name update`
            );
          }
        }
      }
    } else {
      console.log(
        `[fixPlayerName] Cannot fix player name: playerIdRef.current=${playerIdRef.current}, playerName="${playerName}"`
      );
    }

    return false; // Name was not fixed
  };

  // Add a button to the debug panel to fix the player name
  const fixNameButton = (
    <button
      onClick={fixPlayerName}
      style={{
        marginTop: "10px",
        padding: "5px 10px",
        backgroundColor: "#4CAF50",
        color: "white",
        border: "none",
        borderRadius: "3px",
        cursor: "pointer",
      }}
    >
      Fix Player Name
    </button>
  );

  // Add a useEffect to fix the player name when the component mounts
  useEffect(() => {
    // This will run once when the component mounts
    console.log(`[useEffect] Component mounted`);

    // Set up an interval to check and fix the player name
    const nameCheckInterval = setInterval(() => {
      if (playerIdRef.current && playerName && !showNameMenu && !isRespawning) {
        console.log(`[nameCheckInterval] Checking player name...`);
        fixPlayerName();
      }
    }, 2000); // Check every 2 seconds

    return () => {
      clearInterval(nameCheckInterval);
    };
  }, []);

  // Add a useEffect to check for player ID mismatch on component mount
  useEffect(() => {
    // This will run once when the component mounts
    console.log(
      `[useEffect] Component mounted, checking for player ID mismatch`
    );

    // Check if there's a player ID mismatch
    if (playerIdRef.current && !playersRef.current.has(playerIdRef.current)) {
      console.log(
        `[useEffect] Player ID mismatch detected: ${playerIdRef.current} not in playersRef`
      );
      console.log(
        `[useEffect] Current players:`,
        Array.from(playersRef.current.keys())
      );

      // If there's only one player in the map, assume it's the local player
      if (playersRef.current.size === 1) {
        const onlyPlayerId = Array.from(playersRef.current.keys())[0];
        console.log(
          `[useEffect] Only one player in map with ID ${onlyPlayerId} - assuming this is the local player`
        );

        // Update playerIdRef to match the actual player ID
        const oldId = playerIdRef.current;
        playerIdRef.current = onlyPlayerId;
        console.log(
          `[useEffect] Updated playerIdRef from ${oldId} to ${playerIdRef.current}`
        );

        // If we have a player name, update it
        if (playerName) {
          const player = playersRef.current.get(onlyPlayerId);
          if (player) {
            console.log(`[useEffect] Updating player name to "${playerName}"`);
            player.name = playerName;

            // Update the health bar if it exists
            if (player.healthBar) {
              updatePlayerHealthBar(player);
            }
          }
        }
      }
    }
  }, []);

  // Add gamepad connection and disconnection handlers
  useEffect(() => {
    if (GAMEPAD_DEBUG_MODE) console.log("🎮 Setting up gamepad handlers");

    const handleGamepadConnected = (e: GamepadEvent) => {
      if (GAMEPAD_DEBUG_MODE) {
        console.log(`Gamepad connected:`, {
          id: e.gamepad.id,
          index: e.gamepad.index,
          axes: e.gamepad.axes.length,
          buttons: e.gamepad.buttons.length,
          mapping: e.gamepad.mapping,
        });
      }
      gamepadRef.current = e.gamepad;
      gamepadConnectedRef.current = true;

      // Force re-render to update UI
      setPlayerName((prev) => prev);

      // Show a notification to the user
      showGamepadNotification(`Gamepad connected: ${e.gamepad.id}`);

      // Center the cursor/crosshair when switching to gamepad controls
      centerCrosshair();
    };

    // Function to center the crosshair when using gamepad controls
    const centerCrosshair = () => {
      // Center the mouse position in normalized coordinates
      mouseRef.current.x = 0;
      mouseRef.current.y = 0;

      // Update the pixel coordinates to the center of the screen
      mouseRef.current.pixelX = window.innerWidth / 2;
      mouseRef.current.pixelY = window.innerHeight / 2;

      // Find and center any DOM crosshair element
      const crosshair = document.querySelector("[data-crosshair]");
      if (crosshair instanceof HTMLElement) {
        crosshair.style.left = `${window.innerWidth / 2}px`;
        crosshair.style.top = `${window.innerHeight / 2}px`;
        crosshair.style.transform = "translate(-50%, -50%)";

        // Add a subtle animation to indicate the switch to centered crosshair
        crosshair.style.transition =
          "transform 0.3s ease-out, filter 0.3s ease-out";
        crosshair.style.transform = "translate(-50%, -50%) scale(1.5)";
        crosshair.style.filter = "brightness(1.5) drop-shadow(0 0 8px #4444ff)";

        // Reset after animation
        setTimeout(() => {
          if (crosshair) {
            crosshair.style.transform = "translate(-50%, -50%) scale(1.0)";
            crosshair.style.filter = "";
          }
        }, 300);
      }
    };

    const handleGamepadDisconnected = (e: GamepadEvent) => {
      if (GAMEPAD_DEBUG_MODE) {
        console.log(`Gamepad disconnected:`, {
          id: e.gamepad.id,
          index: e.gamepad.index,
        });
      }
      if (gamepadRef.current && gamepadRef.current.index === e.gamepad.index) {
        gamepadRef.current = null;
        gamepadConnectedRef.current = false;

        // Force re-render to update UI
        setPlayerName((prev) => prev);

        // Show a notification to the user
        showGamepadNotification("Gamepad disconnected");
      }
    };

    // Function to show gamepad notifications
    const showGamepadNotification = (message: string) => {
      // Create notification element
      const notification = document.createElement("div");
      notification.style.cssText = `
        position: fixed;
        top: 20%;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.8);
        color: #00ff00;
        padding: 15px 25px;
        border-radius: 8px;
        font-size: 18px;
        font-weight: bold;
        z-index: 1001;
        box-shadow: 0 0 15px rgba(0, 255, 0, 0.5);
        border: 1px solid #00ff00;
        text-align: center;
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
      `;
      notification.textContent = message;

      // Add 🎮 emoji
      const emoji = document.createElement("span");
      emoji.textContent = " 🎮 ";
      emoji.style.fontSize = "24px";
      notification.prepend(emoji);

      // Add to body
      document.body.appendChild(notification);

      // Fade in
      setTimeout(() => {
        notification.style.opacity = "1";
      }, 10);

      // Remove after 3 seconds
      setTimeout(() => {
        notification.style.opacity = "0";
        setTimeout(() => {
          if (document.body.contains(notification)) {
            document.body.removeChild(notification);
          }
        }, 300);
      }, 3000);
    };

    // Scan for gamepads function - this is used by both the initial scan and polling
    const scanForGamepads = () => {
      const gamepads = navigator.getGamepads();
      if (GAMEPAD_DEBUG_MODE) console.log("Scanning for gamepads:", gamepads);

      for (let i = 0; i < gamepads.length; i++) {
        const pad = gamepads[i];
        if (pad !== null) {
          if (GAMEPAD_DEBUG_MODE)
            console.log(`Found gamepad at index ${i}:`, pad);

          // Check if this is a new gamepad or if we're already tracking it
          if (
            !gamepadConnectedRef.current ||
            (gamepadRef.current && gamepadRef.current.index !== pad.index) ||
            !gamepadRef.current
          ) {
            gamepadRef.current = pad;
            gamepadConnectedRef.current = true;

            // Show notification only if this is a new detection
            showGamepadNotification(`Bluetooth gamepad detected: ${pad.id}`);

            // Force re-render to update UI
            setPlayerName((prev) => prev);
          }
          return true;
        }
      }
      return false;
    };

    // Log available gamepads on initialization
    if (GAMEPAD_DEBUG_MODE)
      console.log("Checking for already connected gamepads on initialization");
    if (!scanForGamepads() && GAMEPAD_DEBUG_MODE) {
      console.log("No gamepads found during initial scan");
    }

    // Create a more aggressive polling mechanism specifically for Bluetooth gamepads
    // These can sometimes be missed by normal event listeners
    const gamepadPollInterval = setInterval(() => {
      if (!gamepadConnectedRef.current) {
        scanForGamepads();
      } else {
        // Even if we think we're connected, do a quick check that the gamepad is still there
        // Some browsers lose track of Bluetooth gamepads
        const gamepads = navigator.getGamepads();
        const currentIndex = gamepadRef.current?.index ?? -1;

        // Check if our current gamepad is still connected
        if (
          currentIndex >= 0 &&
          (gamepads[currentIndex] === null ||
            !gamepads[currentIndex]?.connected)
        ) {
          console.log(
            "Previously connected gamepad appears to be disconnected, scanning again"
          );
          scanForGamepads();
        }
      }
    }, 1000); // Poll every second for better Bluetooth gamepad detection

    // Add special handling for Bluetooth gamepads in Safari and other browsers
    // This helps with controllers that only register after a button press
    const handleAnyUserInteraction = () => {
      if (!gamepadConnectedRef.current) {
        console.log(
          "User interaction detected, trying to detect Bluetooth gamepads..."
        );
        scanForGamepads();
      }
    };

    // Register for events that might help activate Bluetooth gamepads
    window.addEventListener("click", handleAnyUserInteraction);
    window.addEventListener("keydown", handleAnyUserInteraction);
    window.addEventListener("touchstart", handleAnyUserInteraction);

    window.addEventListener("gamepadconnected", handleGamepadConnected);
    window.addEventListener("gamepaddisconnected", handleGamepadDisconnected);

    // Add an instruction to press a button on the gamepad
    console.log(
      "🎮 If your gamepad isn't detected automatically, try pressing any button on it"
    );

    // Show a notification to help users connect Bluetooth gamepads
    setTimeout(() => {
      if (!gamepadConnectedRef.current) {
        showGamepadNotification(
          "Press buttons on your Bluetooth controller to activate it"
        );
      }
    }, 2000);

    return () => {
      window.removeEventListener("gamepadconnected", handleGamepadConnected);
      window.removeEventListener(
        "gamepaddisconnected",
        handleGamepadDisconnected
      );
      window.removeEventListener("click", handleAnyUserInteraction);
      window.removeEventListener("keydown", handleAnyUserInteraction);
      window.removeEventListener("touchstart", handleAnyUserInteraction);
      clearInterval(gamepadPollInterval);
    };
  }, []);

  // Handle gamepad input
  const handleGamepadInput = () => {
    // Skip if gamepad not connected
    if (!gamepadConnectedRef.current) return;

    // Get all gamepads from the browser
    const gamepads = navigator.getGamepads();

    // Ensure we have gamepads array
    if (!gamepads) return;

    // Ensure we have a gamepad reference
    if (!gamepadConnectedRef.current || !gamepadRef.current) {
      return;
    }

    // Get fresh gamepad state from the correct index
    const gamepadIndex = gamepadRef.current.index;

    // CRITICAL: The Gamepad API sometimes returns null even for connected gamepads
    // We need to handle this case gracefully
    let currentGamepad = gamepads[gamepadIndex];

    // Handle the case where the gamepad reference is temporarily null
    // but we know it's still connected (common browser bug particularly with Bluetooth)
    if (currentGamepad === null) {
      // Check if any of the gamepad slots have a valid gamepad
      // This handles the case where the index might have changed
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] !== null) {
          if (GAMEPAD_DEBUG_MODE) {
            console.log(
              `Bluetooth gamepad found at different index: ${i} (was ${gamepadIndex})`
            );
          }
          gamepadRef.current = gamepads[i];
          currentGamepad = gamepads[i];
          break;
        }
      }

      // If we still don't have a gamepad, skip this frame but don't disconnect
      if (currentGamepad === null) {
        // Just log it less frequently to avoid console spam
        if (GAMEPAD_DEBUG_MODE && Math.random() < 0.01) {
          console.log(
            "Bluetooth gamepad temporarily disconnected, waiting for reconnection"
          );
        }
        return;
      }
    }

    // Debug - log gamepad state periodically
    if (GAMEPAD_DEBUG_MODE && Math.random() < 0.01) {
      // Log roughly once every 100 frames to avoid console spam
      console.log("Gamepad state:", {
        id: currentGamepad.id,
        index: currentGamepad.index,
        connected: currentGamepad.connected,
        mapping: currentGamepad.mapping,
        bluetoothId: currentGamepad.id.includes("Wireless")
          ? "Bluetooth device detected"
          : "Wired/Unknown",
        axes: Array.from(currentGamepad.axes).map((v) => v.toFixed(2)),
        buttons: Array.from(currentGamepad.buttons).map((b) => ({
          pressed: b.pressed,
          value: b.value.toFixed(2),
        })),
      });
    }

    // Apply deadzone to analog stick values
    const applyDeadzone = (value: number): number => {
      return Math.abs(value) < gamepadDeadzoneRef.current
        ? 0
        : value >= 0
        ? (value - gamepadDeadzoneRef.current) /
          (1 - gamepadDeadzoneRef.current)
        : (value + gamepadDeadzoneRef.current) /
          (1 - gamepadDeadzoneRef.current);
    };

    // Determine which axes to use based on the gamepad mapping and device type
    let leftXAxis = 0;
    let leftYAxis = 1;
    let rightXAxis = 2;
    let rightYAxis = 3;

    // Get the ID in lowercase for easier matching
    const gamepadId = currentGamepad.id.toLowerCase();
    const isBluetooth =
      gamepadId.includes("wireless") ||
      gamepadId.includes("bluetooth") ||
      gamepadId.includes("le") || // Bluetooth LE
      gamepadId.includes("dualsock") ||
      gamepadId.includes("dualsense");

    // Some Bluetooth controllers have special needs
    if (isBluetooth) {
      if (GAMEPAD_DEBUG_MODE) {
        console.log("Using Bluetooth controller handling for:", gamepadId);
      }

      // Different Bluetooth controllers
      if (gamepadId.includes("xbox")) {
        // Bluetooth Xbox controller mapping
        leftXAxis = 0;
        leftYAxis = 1;
        rightXAxis = 2;
        rightYAxis = 3;
      } else if (
        gamepadId.includes("dualshock") ||
        gamepadId.includes("dualsense") ||
        gamepadId.includes("playstation")
      ) {
        // PlayStation controller over Bluetooth
        leftXAxis = 0;
        leftYAxis = 1;
        rightXAxis = 2;
        rightYAxis = 3;

        // Some browsers report different mappings for PlayStation controllers
        if (currentGamepad.axes.length >= 6) {
          console.log("Using 6-axis mapping for PlayStation controller");
          leftXAxis = 0;
          leftYAxis = 1;
          rightXAxis = 3;
          rightYAxis = 4;
        }
      } else if (
        gamepadId.includes("nintendo") ||
        gamepadId.includes("switch")
      ) {
        // Nintendo controllers over Bluetooth
        leftXAxis = 0;
        leftYAxis = 1;
        rightXAxis = 2;
        rightYAxis = 3;
      } else if (currentGamepad.axes.length >= 4) {
        // Generic Bluetooth controller with enough axes
        console.log(
          `Using default mapping for unknown Bluetooth controller: "${gamepadId}" with ${currentGamepad.axes.length} axes`
        );
        leftXAxis = 0;
        leftYAxis = 1;
        rightXAxis = 2;
        rightYAxis = 3;
      } else {
        console.log(
          `Unknown Bluetooth controller with too few axes: "${gamepadId}" (${currentGamepad.axes.length} axes)`
        );
      }
    } else if (currentGamepad.mapping !== "standard") {
      // Handle non-standard wired controllers
      if (gamepadId.includes("xbox") || gamepadId.includes("xinput")) {
        // Standard Xbox controller mapping
        leftXAxis = 0;
        leftYAxis = 1;
        rightXAxis = 2;
        rightYAxis = 3;
      } else if (
        gamepadId.includes("playstation") ||
        gamepadId.includes("dualshock") ||
        gamepadId.includes("ps4") ||
        gamepadId.includes("ps5")
      ) {
        // Typical PlayStation controller mapping
        leftXAxis = 0;
        leftYAxis = 1;
        rightXAxis = 2;
        rightYAxis = 3;
      }
      // Safari on macOS might have different mappings
      else if (
        gamepadId.includes("wireless controller") &&
        /safari/i.test(navigator.userAgent)
      ) {
        leftXAxis = 0;
        leftYAxis = 1;
        rightXAxis = 2;
        rightYAxis = 3;
      }
      // Generic controllers on different browsers
      else if (currentGamepad.axes.length >= 4) {
        // Just use the first 4 axes in the common layout
        leftXAxis = 0;
        leftYAxis = 1;
        rightXAxis = 2;
        rightYAxis = 3;
        console.log(
          `Using default axis mapping for unknown controller: "${gamepadId}"`
        );
      } else {
        console.log(
          `Unknown controller with too few axes: "${gamepadId}" (${currentGamepad.axes.length} axes)`
        );
      }
    }

    // If it's a Bluetooth controller, add an extra logging message
    if (isBluetooth) {
      console.log(
        `Using Bluetooth controller mapping: left(${leftXAxis},${leftYAxis}), right(${rightXAxis},${rightYAxis})`
      );
    }

    // Make sure the axes exist before using them
    const hasLeftStick =
      currentGamepad.axes.length > Math.max(leftXAxis, leftYAxis);
    const hasRightStick =
      currentGamepad.axes.length > Math.max(rightXAxis, rightYAxis);

    // Left stick for movement (if available)
    if (hasLeftStick) {
      const leftX = applyDeadzone(currentGamepad.axes[leftXAxis]);
      const leftY = applyDeadzone(currentGamepad.axes[leftYAxis]);

      // Set movement based on left stick
      const prevMovement = {
        left: movementRef.current.left,
        right: movementRef.current.right,
        forward: movementRef.current.forward,
        backward: movementRef.current.backward,
      };

      // Some Bluetooth controllers have inverted Y axis
      const invertY =
        isBluetooth &&
        (gamepadId.includes("dualshock") ||
          gamepadId.includes("dualsense") ||
          gamepadId.includes("playstation"));

      // Apply inverted Y axis for some controllers if needed
      movementRef.current.left = leftX < -0.2;
      movementRef.current.right = leftX > 0.2;

      // Handle potentially inverted Y axis
      if (invertY) {
        movementRef.current.forward = leftY > 0.2;
        movementRef.current.backward = leftY < -0.2;
      } else {
        movementRef.current.forward = leftY < -0.2;
        movementRef.current.backward = leftY > 0.2;
      }

      // Log movement changes from gamepad
      if (
        prevMovement.left !== movementRef.current.left ||
        prevMovement.right !== movementRef.current.right ||
        prevMovement.forward !== movementRef.current.forward ||
        prevMovement.backward !== movementRef.current.backward
      ) {
        console.log("Gamepad movement updated:", {
          left: movementRef.current.left,
          right: movementRef.current.right,
          forward: movementRef.current.forward,
          backward: movementRef.current.backward,
          leftStick: { x: leftX.toFixed(2), y: leftY.toFixed(2) },
          inverted: invertY,
        });
      }
    }

    // Right stick for camera/aiming (if available)
    if (hasRightStick) {
      const rightX = applyDeadzone(currentGamepad.axes[rightXAxis]);
      const rightY = applyDeadzone(currentGamepad.axes[rightYAxis]);

      if (Math.abs(rightX) > 0 || Math.abs(rightY) > 0) {
        // For gamepad, we'll rotate the camera instead of moving the cursor
        // This creates a more console-like control scheme with centered crosshair

        // Create a gamepad camera rotation speed variable
        const gamepadRotationSpeed = 2.5; // Adjust this value to change rotation speed

        // Update the camera rotation based on the right stick input
        // This is equivalent to moving the mouse, but we're directly changing the view angle
        if (Math.abs(rightX) > 0) {
          const rotationAmount = rightX * gamepadRotationSpeed * 0.05;

          // Adjust the look direction based on right stick X axis
          // This uses the existing camera system by simulating a mouse movement
          // but we're keeping the cursor centered
          mouseRef.current.x += rotationAmount;

          // Log camera rotation changes occasionally
          if (Math.random() < 0.02) {
            console.log("Gamepad camera rotation (X):", rotationAmount);
          }
        }

        // Vertical camera adjustment with the right stick
        if (Math.abs(rightY) > 0) {
          const verticalAmount = rightY * gamepadRotationSpeed * 0.03;

          // Adjust the vertical look with constraints to prevent flipping
          mouseRef.current.y = Math.max(
            -0.9,
            Math.min(0.9, mouseRef.current.y + verticalAmount)
          );

          // Log vertical adjustments occasionally
          if (Math.random() < 0.02) {
            console.log("Gamepad camera vertical:", mouseRef.current.y);
          }
        }

        // When using a gamepad, we keep the crosshair centered rather than moving it
        // Update the pixel coordinates to the center of the screen for any UI elements
        mouseRef.current.pixelX = window.innerWidth / 2;
        mouseRef.current.pixelY = window.innerHeight / 2;

        // Also center any DOM crosshair element
        const crosshair = document.querySelector("[data-crosshair]");
        if (crosshair instanceof HTMLElement) {
          crosshair.style.left = `${window.innerWidth / 2}px`;
          crosshair.style.top = `${window.innerHeight / 2}px`;
        }

        if (Math.random() < 0.05) {
          // Log occasionally to avoid console spam
          console.log("Gamepad camera update:", {
            rightStick: { x: rightX.toFixed(2), y: rightY.toFixed(2) },
            lookDirection: {
              x: mouseRef.current.x.toFixed(2),
              y: mouseRef.current.y.toFixed(2),
            },
          });
        }
      }
    }

    // Determine button mappings based on controller type
    let jumpButtonIndex = 0; // Default A/Cross button
    let fireButton1Index = 7; // Default RT/R2 button
    let fireButton2Index = 5; // Default RB/R1 button
    let scoreButton1Index = 8; // Default Back/Select button
    let scoreButton2Index = 9; // Default Start button

    // Adjust button indices for different controllers
    if (isBluetooth) {
      // Bluetooth controllers often have different mappings
      if (gamepadId.includes("xbox")) {
        // Bluetooth Xbox controller
        jumpButtonIndex = 0; // A
        fireButton1Index = 7; // RT
        fireButton2Index = 5; // RB
        scoreButton1Index = 8; // Back/View
        scoreButton2Index = 9; // Start/Menu
      } else if (
        gamepadId.includes("playstation") ||
        gamepadId.includes("dualshock") ||
        gamepadId.includes("dualsense")
      ) {
        // Bluetooth PlayStation controller
        jumpButtonIndex = 0; // Cross
        fireButton1Index = 7; // R2
        fireButton2Index = 5; // R1
        scoreButton1Index = 8; // Select/Share
        scoreButton2Index = 9; // Options/Start

        // Some PS controllers use different mappings on different browsers
        if (currentGamepad.buttons.length >= 17) {
          console.log("Using extended mapping for PlayStation controller");
          jumpButtonIndex = 0; // Cross
          fireButton1Index = 7; // R2
          fireButton2Index = 5; // R1
          scoreButton1Index = 8; // Share/Select
          scoreButton2Index = 9; // Options/Start
        }
      } else if (
        gamepadId.includes("nintendo") ||
        gamepadId.includes("switch")
      ) {
        // Bluetooth Nintendo controller
        jumpButtonIndex = 0; // B/A (depends on controller)
        fireButton1Index = 7; // ZR
        fireButton2Index = 5; // R
        scoreButton1Index = 8; // Minus
        scoreButton2Index = 9; // Plus
      } else {
        // Generic Bluetooth controller - try common mappings
        console.log(
          `Using default button mapping for Bluetooth controller: "${gamepadId}"`
        );
        // Try to locate jump button (usually first button)
        jumpButtonIndex = 0;
        // Try to locate trigger buttons (usually high indices)
        if (currentGamepad.buttons.length >= 8) {
          fireButton1Index = 7;
          fireButton2Index = 5;
        } else if (currentGamepad.buttons.length >= 6) {
          fireButton1Index = 5;
          fireButton2Index = 4;
        } else {
          fireButton1Index = 1;
          fireButton2Index = 2;
        }
        // Try to locate menu buttons
        if (currentGamepad.buttons.length >= 10) {
          scoreButton1Index = 8;
          scoreButton2Index = 9;
        } else {
          scoreButton1Index = 3;
          scoreButton2Index = 3;
        }
      }
    } else if (currentGamepad.mapping !== "standard") {
      // Non-Bluetooth, non-standard controllers
      if (gamepadId.includes("xbox") || gamepadId.includes("xinput")) {
        // Use standard Xbox mapping
        jumpButtonIndex = 0; // A
        fireButton1Index = 7; // RT
        fireButton2Index = 5; // RB
        scoreButton1Index = 8; // Back
        scoreButton2Index = 9; // Start
      } else if (
        gamepadId.includes("playstation") ||
        gamepadId.includes("dualshock") ||
        gamepadId.includes("ps4") ||
        gamepadId.includes("ps5")
      ) {
        jumpButtonIndex = 0; // Cross
        fireButton1Index = 7; // R2
        fireButton2Index = 5; // R1
        scoreButton1Index = 8; // Share/Select
        scoreButton2Index = 9; // Options/Start
      } else {
        // Generic controllers - try common mappings
        console.log(`Using default button mapping for: "${gamepadId}"`);
      }
    }

    // Safety check to make sure button indices are within bounds
    const buttonCount = currentGamepad ? currentGamepad.buttons.length : 0;
    const safeGetButton = (index: number) => {
      return currentGamepad && index < buttonCount
        ? currentGamepad.buttons[index]
        : { pressed: false, value: 0 };
    };

    const jumpButton = safeGetButton(jumpButtonIndex);
    const fireButton1 = safeGetButton(fireButton1Index);
    const fireButton2 = safeGetButton(fireButton2Index);
    const scoreButton1 = safeGetButton(scoreButton1Index);
    const scoreButton2 = safeGetButton(scoreButton2Index);

    // Try all buttons for jump if we need to (useful for debugging and for Bluetooth controllers)
    let jumpPressed = jumpButton.pressed;

    // For Bluetooth controllers, check additional buttons that might be used for jump
    if (!jumpPressed && isBluetooth && currentGamepad.buttons.length > 1) {
      // Check other common jump buttons depending on controller
      if (
        gamepadId.includes("playstation") ||
        gamepadId.includes("dualshock")
      ) {
        // On PlayStation controllers, Circle (button 1) or X (button 2) might be used
        jumpPressed =
          currentGamepad.buttons[1].pressed ||
          currentGamepad.buttons[2].pressed;
      } else if (
        gamepadId.includes("nintendo") ||
        gamepadId.includes("switch")
      ) {
        // On Nintendo controllers, A (button 1) or B (button 0) might be used
        jumpPressed =
          currentGamepad.buttons[0].pressed ||
          currentGamepad.buttons[1].pressed;
      } else {
        // Generic controller - try a few common buttons
        // The second button (B on Xbox, Circle on PS) is sometimes also used for jump
        jumpPressed = currentGamepad.buttons[1].pressed;

        // If we have enough buttons, also try the X button (Xbox) or Square (PS)
        if (!jumpPressed && currentGamepad.buttons.length > 2) {
          jumpPressed = currentGamepad.buttons[2].pressed;
        }
      }
    }

    // Jump with button
    if (jumpPressed && movementRef.current.canJump) {
      if (GAMEPAD_DEBUG_MODE) {
        console.log("Gamepad jump button pressed");
      }
      // Apply jump physics
      const jumpVelocity = 7;
      movementRef.current.velocity.y = jumpVelocity;
      movementRef.current.jumping = true;
      movementRef.current.canJump = false;
      setAnimation("jump");
    }

    // For Bluetooth controllers, try all trigger/shoulder buttons for fire
    let firePressed = fireButton1.pressed || fireButton2.pressed;

    // For Bluetooth controllers, try more buttons for fire
    if (!firePressed && isBluetooth && currentGamepad.buttons.length > 4) {
      // Try L1/L2 as well (buttons 4/6) in case R1/R2 aren't detected correctly
      if (currentGamepad.buttons.length > 6) {
        firePressed =
          currentGamepad.buttons[4].pressed ||
          currentGamepad.buttons[6].pressed;
      }
      // Or just try buttons 3 and 4 for smaller button sets
      else {
        firePressed =
          currentGamepad.buttons[3].pressed ||
          currentGamepad.buttons[4].pressed;
      }
    }

    // Fire with primary or secondary fire buttons
    const now = Date.now();
    if (
      firePressed &&
      now - gamepadLastFireballTimeRef.current > gamepadFireRateRef.current
    ) {
      if (GAMEPAD_DEBUG_MODE) {
        console.log("Gamepad fire button pressed");
      }
      fireFireball();
      gamepadLastFireballTimeRef.current = now;
    }

    // Toggle scoreboard with select/back or start
    const scoreboardVisible = scoreButton1.pressed || scoreButton2.pressed;
    if (scoreboardVisible) {
      setShowScoreboard(true);
    } else {
      setShowScoreboard(false);
    }
  };

  // Return the JSX
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
      {/* CSS for gamepad animation */}
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
          }
        `}
      </style>

      {/* Player Name Menu */}
      {(showNameMenu || isRespawning) && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#222",
              padding: "30px",
              borderRadius: "10px",
              boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
              width: "400px",
              textAlign: "center",
            }}
          >
            <h2 style={{ color: "#fff", marginBottom: "20px" }}>
              {isRespawning ? "You Died!" : "Welcome to the Game"}
            </h2>
            <p style={{ color: "#ccc", marginBottom: "20px" }}>
              {isRespawning
                ? "Enter your name to respawn:"
                : "Enter your name to begin:"}
            </p>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              style={{
                width: "100%",
                padding: "10px",
                marginBottom: "20px",
                borderRadius: "5px",
                border: "none",
                fontSize: "16px",
              }}
              autoFocus
            />
            <button
              onClick={() => {
                console.log(
                  `Name menu button clicked. playerName: "${playerName}", isRespawning: ${isRespawning}`
                );
                console.log(`Current playerIdRef: ${playerIdRef.current}`);
                console.log(
                  `Current players in playersRef:`,
                  Array.from(playersRef.current.keys())
                );

                if (playerName.trim()) {
                  console.log(`Name is valid: "${playerName}"`);

                  // Store the name in state but don't try to update the player object yet
                  // The useEffect hook will handle applying the name when the player is created
                  console.log(
                    `Storing name "${playerName}" to be applied when player is created`
                  );

                  // Hide the name menu
                  setShowNameMenu(false);

                  // If we're respawning, handle that separately
                  if (isRespawning) {
                    console.log(`Handling respawn with name: "${playerName}"`);
                    // Handle respawn
                    const localPlayer = playersRef.current.get(
                      playerIdRef.current || 0
                    );
                    console.log(
                      `Found local player:`,
                      localPlayer
                        ? {
                            id: localPlayer.id,
                            name: localPlayer.name,
                            health: localPlayer.health,
                          }
                        : "null"
                    );

                    if (localPlayer && playerIdRef.current) {
                      // Update player name
                      updatePlayerName(playerIdRef.current, playerName);

                      // Reset health
                      localPlayer.health = localPlayer.maxHealth;

                      // Reset position to a random location
                      if (localPlayer.model) {
                        localPlayer.model.position.set(
                          Math.random() * 10 - 5,
                          0,
                          Math.random() * 10 - 5
                        );

                        // Reset rotation
                        localPlayer.model.rotation.x = 0;

                        // Show health bar again
                        if (localPlayer.healthBar) {
                          localPlayer.healthBar.style.visibility = "visible";
                          updatePlayerHealthBar(localPlayer);
                        }

                        // Reset to idle animation
                        if (
                          localPlayer.actions &&
                          localPlayer.actions["idle"]
                        ) {
                          localPlayer.actions["idle"].reset().play();
                        }

                        console.log(
                          `Player ${localPlayer.id} respawned as ${localPlayer.name}!`
                        );
                      }
                    }
                    setIsRespawning(false);
                  } else {
                    console.log(
                      `Initial game start with name: "${playerName}"`
                    );
                    // We'll let the useEffect hook handle applying the name when the player is created
                  }
                }
              }}
              style={{
                padding: "10px 20px",
                backgroundColor: "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: "5px",
                fontSize: "16px",
                cursor: "pointer",
              }}
              disabled={!playerName.trim()}
            >
              {isRespawning ? "Respawn" : "Start Game"}
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
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
          zIndex: 1000,
        }}
      >
        <h3 style={{ margin: "0 0 10px 0" }}>Controls:</h3>
        <p style={{ margin: "5px 0" }}>W, A, S, D - Move</p>
        <p style={{ margin: "5px 0" }}>Shift - Walk (Hold to walk slower)</p>
        <p style={{ margin: "5px 0" }}>Space - Jump</p>
        <p style={{ margin: "5px 0" }}>Mouse - Camera</p>
        <p style={{ margin: "5px 0" }}>Left Click/F - Shoot Fireball</p>
        <p style={{ margin: "5px 0" }}>Tab - Show Scoreboard (Hold)</p>

        {/* Gamepad indicator */}
        {gamepadConnectedRef.current && (
          <>
            <h3 style={{ margin: "10px 0 5px 0" }}>Gamepad Controls:</h3>
            <p style={{ margin: "5px 0" }}>Left Stick - Move</p>
            <p style={{ margin: "5px 0" }}>Right Stick - Camera Control</p>
            <p style={{ margin: "5px 0" }}>A Button - Jump</p>
            <p style={{ margin: "5px 0" }}>RT/RB - Shoot Fireball</p>
            <p style={{ margin: "5px 0" }}>Start/Select - Scoreboard (Hold)</p>
            <div
              style={{
                marginTop: "10px",
                backgroundColor: "rgba(50,205,50,0.7)",
                color: "white",
                padding: "8px",
                borderRadius: "4px",
                fontWeight: "bold",
                textAlign: "center",
                boxShadow: "0 0 5px rgba(0,255,0,0.5)",
                animation: "pulse 2s infinite",
              }}
            >
              🎮 Controller Connected
            </div>
            <div
              style={{
                marginTop: "8px",
                backgroundColor: "rgba(90,120,255,0.7)",
                color: "white",
                padding: "8px",
                borderRadius: "4px",
                fontWeight: "bold",
                textAlign: "center",
                fontSize: "12px",
              }}
            >
              Console-Style Controls Enabled
            </div>
          </>
        )}

        {/* Debug info for gamepad - Only visible in debug mode */}
        {GAMEPAD_DEBUG_MODE && (
          <div
            style={{
              marginTop: "15px",
              backgroundColor: "rgba(0,0,0,0.7)",
              color: "#00ff00",
              padding: "8px",
              borderRadius: "4px",
              fontSize: "12px",
              fontFamily: "monospace",
              boxShadow: "0 0 10px rgba(0,0,0,0.7)",
              border: "1px solid #444",
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
              🎮 Gamepad Debug:
            </div>
            <div>Connected: {gamepadConnectedRef.current ? "Yes" : "No"}</div>
            <div>ID: {gamepadRef.current?.id || "None"}</div>
            <div>Mapping: {gamepadRef.current?.mapping || "None"}</div>
            <div>Buttons: {gamepadRef.current?.buttons.length || 0}</div>
            <div>Axes: {gamepadRef.current?.axes.length || 0}</div>
            <div
              style={{
                display: "flex",
                gap: "4px",
                marginTop: "8px",
              }}
            >
              <button
                style={{
                  backgroundColor: "#444",
                  color: "white",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "10px",
                  flex: 1,
                }}
                onClick={() => {
                  // Force scan for gamepads
                  const gamepads = navigator.getGamepads();
                  if (GAMEPAD_DEBUG_MODE)
                    console.log("Manual gamepad scan:", gamepads);

                  // Try to connect to any gamepad found
                  for (let i = 0; i < gamepads.length; i++) {
                    const pad = gamepads[i];
                    if (pad !== null) {
                      if (GAMEPAD_DEBUG_MODE) {
                        console.log(`Found gamepad at index ${i}:`, pad);
                      }
                      gamepadRef.current = pad;
                      gamepadConnectedRef.current = true;

                      // Force component to re-render to update debug info
                      setPlayerName(playerName);

                      alert(`Gamepad connected: ${pad.id}`);
                      return;
                    }
                  }

                  alert(
                    "No gamepads found. Make sure your controller is connected and try pressing a button on it."
                  );
                }}
              >
                Scan for Gamepads
              </button>
              <button
                style={{
                  backgroundColor: "#2a5",
                  color: "white",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "10px",
                  flex: 1,
                }}
                onClick={() => {
                  // Create a test input modal
                  const modal = document.createElement("div");
                  modal.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.85);
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    z-index: 1002;
                    font-family: monospace;
                    color: white;
                  `;

                  // Title
                  const title = document.createElement("h2");
                  title.textContent = "Controller Test Mode";
                  title.style.color = "#00ff00";
                  modal.appendChild(title);

                  // Instructions
                  const instructions = document.createElement("p");
                  instructions.textContent =
                    "Press any button or move any stick on your controller";
                  instructions.style.marginBottom = "20px";
                  modal.appendChild(instructions);

                  // Create input display areas
                  const display = document.createElement("div");
                  display.style.width = "80%";
                  display.style.maxWidth = "500px";
                  display.style.marginBottom = "20px";

                  // Buttons display
                  const buttonsDisplay = document.createElement("div");
                  buttonsDisplay.style.cssText = `
                    background-color: rgba(50, 50, 50, 0.6);
                    border-radius: 4px;
                    padding: 10px;
                    margin-bottom: 10px;
                  `;
                  buttonsDisplay.innerHTML =
                    "<h3>Buttons:</h3><div id='buttons-info'>No input yet</div>";

                  // Axes display
                  const axesDisplay = document.createElement("div");
                  axesDisplay.style.cssText = `
                    background-color: rgba(50, 50, 50, 0.6);
                    border-radius: 4px;
                    padding: 10px;
                  `;
                  axesDisplay.innerHTML =
                    "<h3>Axes:</h3><div id='axes-info'>No input yet</div>";

                  display.appendChild(buttonsDisplay);
                  display.appendChild(axesDisplay);
                  modal.appendChild(display);

                  // Close button
                  const closeButton = document.createElement("button");
                  closeButton.textContent = "Close";
                  closeButton.style.cssText = `
                    padding: 8px 20px;
                    background-color: #f44;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-top: 20px;
                    font-size: 14px;
                  `;
                  closeButton.onclick = () => {
                    document.body.removeChild(modal);
                    testMode = false;
                  };
                  modal.appendChild(closeButton);

                  document.body.appendChild(modal);

                  // Set up gamepad polling
                  const buttonsInfo = document.getElementById("buttons-info");
                  const axesInfo = document.getElementById("axes-info");

                  let testMode = true;

                  // Function to update the display
                  const updateDisplay = () => {
                    if (!testMode) return;

                    const gamepads = navigator.getGamepads();
                    let anyGamepad = null;

                    // Find a gamepad
                    for (let i = 0; i < gamepads.length; i++) {
                      if (gamepads[i]) {
                        anyGamepad = gamepads[i];
                        break;
                      }
                    }

                    if (!buttonsInfo || !axesInfo) {
                      console.error(
                        "Could not find buttons or axes info elements"
                      );
                      return;
                    }

                    if (anyGamepad) {
                      // Update buttons
                      let buttonsHtml = "";
                      for (let i = 0; i < anyGamepad.buttons.length; i++) {
                        const button = anyGamepad.buttons[i];
                        const isPressed = button.pressed || button.value > 0.1;
                        const color = isPressed ? "#00ff00" : "#777";
                        buttonsHtml += `<div style="margin: 5px 0; color: ${color}">Button ${i}: ${
                          isPressed ? "PRESSED" : "released"
                        } (${button.value.toFixed(2)})</div>`;
                      }
                      buttonsInfo.innerHTML =
                        buttonsHtml || "No buttons detected";

                      // Update axes
                      let axesHtml = "";
                      for (let i = 0; i < anyGamepad.axes.length; i++) {
                        const value = anyGamepad.axes[i];
                        const absValue = Math.abs(value);
                        const color = absValue > 0.1 ? "#00ff00" : "#777";
                        const barWidth = Math.abs(value * 100);
                        axesHtml += `
                          <div style="margin: 10px 0;">
                            <div style="color: ${color}">Axis ${i}: ${value.toFixed(
                          2
                        )}</div>
                            <div style="width: 100%; background-color: #333; height: 10px; border-radius: 5px; position: relative;">
                              <div style="position: absolute; top: 0; left: 50%; width: 2px; height: 100%; background-color: #aaa;"></div>
                              <div style="
                                position: absolute; 
                                top: 0; 
                                ${value < 0 ? "right: 50%;" : "left: 50%;"} 
                                width: ${barWidth}%; 
                                height: 100%; 
                                background-color: ${color};
                                border-radius: 5px;
                              "></div>
                            </div>
                          </div>
                        `;
                      }
                      axesInfo.innerHTML = axesHtml || "No axes detected";
                    } else {
                      buttonsInfo.innerHTML = "No gamepad connected";
                      axesInfo.innerHTML = "No gamepad connected";
                    }

                    // Continue the animation loop
                    requestAnimationFrame(updateDisplay);
                  };

                  // Start the animation loop
                  updateDisplay();
                }}
              >
                Test Controller
              </button>
            </div>
          </div>
        )}
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

      {/* Health bar */}
      <div className="health-bar-container">
        <div id="player-health-bar" className="health-bar"></div>
      </div>

      {/* Render scoreboard */}
      {renderScoreboard()}

      {/* ... rest of existing UI ... */}
    </div>
  );
};

export default Game;
