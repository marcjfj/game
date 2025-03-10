import { Pane, FolderApi } from "tweakpane";

// Default configuration values
const DEFAULT_CONFIG = {
  player: {
    walkSpeed: 2,
    runSpeed: 8,
    maxHealth: 100,
    jumpHeight: 3.5,
    jumpDuration: 0.4,
  },
  fireball: {
    speed: 25,
    cooldown: 0.4,
    size: 0.2,
    damage: 20,
    explosionSize: 1.5,
  },
  camera: {
    distance: 5,
    height: 2,
    smoothing: 0.1,
    gamepadShoulderOffset: 0.3,
    gamepadCharacterOffset: 1.2,
  },
  animation: {
    transitionSpeed: 0.2,
  },
};

// Current configuration (initialized with defaults)
let currentConfig = { ...DEFAULT_CONFIG };

// Create and initialize the control panel
export function initControlPanel() {
  // Create container for the panel
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.top = "10px";
  container.style.right = "10px";
  container.style.zIndex = "1000";
  document.body.appendChild(container);

  // Create the pane
  const pane = new Pane({
    container,
    title: "Game Controls",
  });

  // Player controls
  const playerFolder = pane.addFolder({ title: "Player" });
  playerFolder.addBinding(currentConfig.player, "walkSpeed", {
    min: 1,
    max: 5,
    step: 0.1,
  });
  playerFolder.addBinding(currentConfig.player, "runSpeed", {
    min: 4,
    max: 15,
    step: 0.5,
  });
  playerFolder.addBinding(currentConfig.player, "maxHealth", {
    min: 50,
    max: 200,
    step: 10,
  });
  playerFolder.addBinding(currentConfig.player, "jumpHeight", {
    min: 1,
    max: 5,
    step: 0.1,
  });
  playerFolder.addBinding(currentConfig.player, "jumpDuration", {
    min: 0.2,
    max: 1,
    step: 0.05,
  });

  // Fireball controls
  const fireballFolder = pane.addFolder({ title: "Fireball" });
  fireballFolder.addBinding(currentConfig.fireball, "speed", {
    min: 10,
    max: 50,
    step: 1,
  });
  fireballFolder.addBinding(currentConfig.fireball, "cooldown", {
    min: 0.1,
    max: 2,
    step: 0.05,
  });
  fireballFolder.addBinding(currentConfig.fireball, "size", {
    min: 0.1,
    max: 0.5,
    step: 0.05,
  });
  fireballFolder.addBinding(currentConfig.fireball, "damage", {
    min: 5,
    max: 50,
    step: 5,
  });
  fireballFolder.addBinding(currentConfig.fireball, "explosionSize", {
    min: 0.5,
    max: 3,
    step: 0.1,
  });

  // Camera controls
  const cameraFolder = pane.addFolder({ title: "Camera" });
  cameraFolder.addBinding(currentConfig.camera, "distance", {
    min: 2,
    max: 10,
    step: 0.5,
  });
  cameraFolder.addBinding(currentConfig.camera, "height", {
    min: 0.5,
    max: 5,
    step: 0.1,
  });
  cameraFolder.addBinding(currentConfig.camera, "smoothing", {
    min: 0.01,
    max: 0.5,
    step: 0.01,
  });

  // Add gamepad-specific camera settings
  const gamepadCameraFolder = cameraFolder.addFolder({
    title: "Gamepad Camera Settings",
    expanded: false, // Collapsed by default
  });

  gamepadCameraFolder.addBinding(
    currentConfig.camera,
    "gamepadShoulderOffset",
    {
      label: "Shoulder Offset",
      min: 0,
      max: 1.0,
      step: 0.05,
    }
  );

  gamepadCameraFolder.addBinding(
    currentConfig.camera,
    "gamepadCharacterOffset",
    {
      label: "Character Height",
      min: 0,
      max: 2.0,
      step: 0.1,
    }
  );

  // Animation controls
  const animationFolder = pane.addFolder({ title: "Animation" });
  animationFolder.addBinding(currentConfig.animation, "transitionSpeed", {
    min: 0.05,
    max: 0.5,
    step: 0.05,
  });

  // Add export button
  pane.addButton({ title: "Export Configuration" }).on("click", () => {
    exportConfiguration();
  });

  // Add import button
  pane.addButton({ title: "Import Configuration" }).on("click", () => {
    importConfigurationFromClipboard(pane);
  });

  // Add reset button
  pane.addButton({ title: "Reset to Defaults" }).on("click", () => {
    resetToDefaults(pane);
  });

  return { pane, config: currentConfig };
}

// Function to export the configuration
function exportConfiguration() {
  const configString = JSON.stringify(currentConfig, null, 2);

  // Create a temporary textarea to copy the configuration
  const textarea = document.createElement("textarea");
  textarea.value = configString;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);

  // Alert the user
  alert(
    "Configuration copied to clipboard! You can paste it to save or share."
  );
  console.log("Exported configuration:", configString);
}

// Function to import configuration from clipboard
function importConfigurationFromClipboard(pane: Pane) {
  // Prompt the user to paste the configuration
  const configString = prompt("Paste the configuration JSON here:");

  if (!configString) {
    return; // User cancelled
  }

  try {
    // Parse the configuration
    const parsedConfig = JSON.parse(configString);

    // Update the configuration
    currentConfig = { ...parsedConfig };

    // Refresh the pane to show the new values
    pane.refresh();

    // Alert the user
    alert("Configuration imported successfully!");
  } catch (error) {
    // Alert the user of the error
    alert("Failed to import configuration. Please check the JSON format.");
    console.error("Failed to import configuration:", error);
  }
}

// Function to reset to default values
function resetToDefaults(pane: Pane) {
  currentConfig = { ...DEFAULT_CONFIG };
  pane.refresh();
}

// Function to get the current configuration
export function getConfig() {
  return currentConfig;
}

// Function to update the configuration
export function updateConfig(newConfig: any) {
  currentConfig = { ...newConfig };
  return currentConfig;
}

// Function to import configuration from a string
export function importConfig(configString: string) {
  try {
    const parsedConfig = JSON.parse(configString);
    currentConfig = parsedConfig;
    return true;
  } catch (error) {
    console.error("Failed to import configuration:", error);
    return false;
  }
}
