/** The fields consumed from the checked-in OpenAPI document by this host. */
export type JsonSchema = Record<string, unknown>;

export interface OpenApiParameter {
  in: string;
  name: string;
  required?: boolean;
  schema?: JsonSchema;
}

export interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: { content: { 'application/json': { schema: JsonSchema } } };
  tags?: string[];
}

export interface OpenApiPath {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  post?: OpenApiOperation;
}

export interface OpenApiDocument {
  paths: Record<string, OpenApiPath>;
  servers?: { url: string }[];
}
