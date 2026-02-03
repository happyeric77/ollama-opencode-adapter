// Intent extraction types

export type IntentType =
  | "turn_on"
  | "turn_off"
  | "set_temperature"
  | "set_brightness"
  | "unknown";

export type DomainType =
  | "light"
  | "switch"
  | "climate"
  | "media_player"
  | "cover"
  | "fan"
  | "unknown";

export interface Intent {
  intent: IntentType;
  domain: DomainType;
  entity_id: string; // Exact entity_id from HA context (e.g., light.living_room) - DEPRECATED, use device_name
  device_name?: string; // Friendly name of the device (e.g., "Light living room")
  attributes?: Record<string, unknown> | undefined; // e.g., { temperature: 22, brightness: 80 }
}

// Home Assistant tool mapping
export interface HAToolMapping {
  intentType: IntentType;
  toolName: string; // e.g., "HassTurnOn", "HassTurnOff"
}

// Standard HA tool names from the conversation API
// Ref - HA Built-in intents: https://developers.home-assistant.io/docs/intent_builtin/
// TODO: Support more tools as needed
export const HA_TOOLS = {
  TURN_ON: "HassTurnOn",
  TURN_OFF: "HassTurnOff",
  SET_POSITION: "HassSetPosition",
  LIGHT_SET: "HassLightSet",
  MEDIA_UNPAUSE: "HassMediaUnpause",
  MEDIA_PAUSE: "HassMediaPause",
  MEDIA_NEXT: "HassMediaNext",
  MEDIA_PREVIOUS: "HassMediaPrevious",
  VACUUM_START: "HassVacuumStart",
  VACUUM_RETURN_TO_BASE: "HassVacuumReturnToBase",
} as const;
