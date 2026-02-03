// OpenAI Chat Completions API types
// Reference: https://platform.openai.com/docs/api-reference/chat

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string | undefined;
  tool_calls?: ToolCall[] | undefined;
  tool_call_id?: string | undefined;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string | undefined;
    parameters?: Record<string, unknown> | undefined;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Tool[] | undefined;
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } } | undefined;
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  stream?: boolean | undefined;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}
