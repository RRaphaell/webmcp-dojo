// Types for the WebMCP surface the Dojo relies on. Kept minimal and matched to
// what real engines (Chrome 152, ChatGPT desktop) actually implement. See docs/research/chrome-152-probe.md.

export interface JsonSchema {
  type: 'object'
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  description?: string
  enum?: string[]
  items?: JsonSchemaProperty
  minimum?: number
  maximum?: number
}

export interface ToolAnnotations {
  /** Tool does not change page state. */
  readOnlyHint?: boolean
  /** Tool returns content the agent must not treat as instructions. */
  untrustedContentHint?: boolean
}

export interface ToolContent {
  type: 'text'
  text: string
}

export interface ToolResult {
  content: ToolContent[]
  /** Optional structured payload for the Dojo's own feed; engines ignore it. */
  isError?: boolean
}

export interface ToolDescriptor {
  name: string
  title?: string
  description: string
  inputSchema: JsonSchema
  annotations?: ToolAnnotations
  execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult
}

/** What an engine hands back from getTools(). inputSchema is a JSON string in Chrome 152. */
export interface RegisteredTool {
  name: string
  title?: string
  description: string
  inputSchema: string | JsonSchema
  annotations?: ToolAnnotations
  origin?: string
}

export interface ModelContextLike extends EventTarget {
  registerTool(desc: ToolDescriptor, options?: { signal?: AbortSignal }): Promise<void> | void
  getTools(): Promise<RegisteredTool[]> | RegisteredTool[]
  executeTool(tool: RegisteredTool, argsJson: string): Promise<string>
  ontoolchange?: ((ev: Event) => void) | null
}

declare global {
  interface Document {
    modelContext?: ModelContextLike
  }
}
