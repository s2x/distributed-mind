export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolDefinition = {
  description?: string;
  schema: any;
  annotations?: ToolAnnotations;
  handler: (_args: any) => Promise<any>;
};
