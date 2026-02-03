// Application configuration

export interface Config {
  // Server settings
  port: number;
  host: string;
  
  // OpenCode settings
  opencodeUrl: string;
  opencodePort: number;
  
  // Model settings
  modelProvider: string;
  modelId: string;
  
  // API settings
  apiKey: string | undefined; // Optional API key for securing the proxy
  
  // Home Assistant settings
  haUrl: string | undefined;
  haToken: string | undefined;
  
  // Logging
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  
  // Conversation settings
  conversationTone: 'friendly' | 'professional' | 'concise';
  conversationLanguage: 'auto' | 'en' | 'zh' | 'ja';
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return num;
}

export function loadConfig(): Config {
  return {
    // Server settings
    port: getEnvNumber('PORT', 3000),
    host: getEnv('HOST', '0.0.0.0'),
    
    // OpenCode settings
    opencodeUrl: getEnv('OPENCODE_URL', 'http://localhost'),
    opencodePort: getEnvNumber('OPENCODE_PORT', 7272),
    
    // Model settings
    modelProvider: getEnv('MODEL_PROVIDER', 'github-copilot'),
    modelId: getEnv('MODEL_ID', 'gpt-4o'),
    
    // API settings
    apiKey: process.env.API_KEY,
    
    // Home Assistant settings
    haUrl: process.env.HA_URL,
    haToken: process.env.HA_TOKEN,
    
    // Logging
    logLevel: (getEnv('LOG_LEVEL', 'info') as Config['logLevel']),
    
    // Conversation settings
    conversationTone: (getEnv('CONVERSATION_TONE', 'friendly') as Config['conversationTone']),
    conversationLanguage: (getEnv('CONVERSATION_LANGUAGE', 'auto') as Config['conversationLanguage']),
  };
}

export const config = loadConfig();
